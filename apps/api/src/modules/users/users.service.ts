import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiError } from '../../common/api-error';
import { assertCompatible, presentUser, Principal, userSelect } from '../../common/identity';
import { PaginationDto } from '../../common/pagination.dto';
import { SessionService } from '../auth/session.service';
import { hashToken, opaqueToken } from '../auth/tokens';
import { AuditService } from '../audit/audit.service';
import { InviteUserDto, UpdateUserDto } from './users.dto';
import { InvitationMailer } from './invitation-mailer.service';

const adminUserSelect = { ...userSelect, active: true, lastLogin: true, createdAt: true } satisfies Prisma.UserSelect;
type AdminUser = Prisma.UserGetPayload<{ select: typeof adminUserSelect }>;
const presentAdminUser = (user: AdminUser) => ({
  ...presentUser(user), active: user.active, lastLogin: user.lastLogin, createdAt: user.createdAt,
});

@Injectable()
export class UsersService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService,
    private readonly sessions: SessionService, private readonly mailer: InvitationMailer) {}

  async list(query: PaginationDto) {
    const [items, total] = await this.db.$transaction([
      this.db.user.findMany({ select: adminUserSelect, skip: query.skip, take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
      this.db.user.count(),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items: items.map(presentAdminUser), total, page: query.page, pageSize: query.pageSize };
  }

  update(actor: Principal, id: string, dto: UpdateUserDto) {
    if (!Object.keys(dto).length) throw new ApiError(400, 'VALIDATION_FAILED', 'Provide at least one field');
    return this.db.serializable(async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const before = await tx.user.findUnique({ where: { id }, include: { org: true } });
      if (!before) throw new ApiError(404, 'NOT_FOUND', 'User not found');
      if (actor.user.id === id && (dto.active === false ||
          (dto.role !== undefined && dto.role !== Role.ADMIN) ||
          (dto.orgId !== undefined && dto.orgId !== before.orgId))) {
        throw new ApiError(400, 'INVALID_STATE_TRANSITION', 'Cannot deactivate, demote or move your own administrator account');
      }
      const org = await tx.organization.findUnique({ where: { id: dto.orgId ?? before.orgId } });
      if (!org || !org.active) throw new ApiError(400, 'VALIDATION_FAILED', 'An active organization is required');
      const role = dto.role ?? before.role;
      assertCompatible(role, org.type);
      if (before.role === Role.ADMIN && before.active && before.org.active &&
          (role !== Role.ADMIN || dto.active === false)) {
        const others = await tx.user.count({
          where: { id: { not: id }, role: Role.ADMIN, active: true, org: { active: true } },
        });
        if (!others) throw new ApiError(400, 'INVALID_STATE_TRANSITION', 'Cannot remove the last active administrator');
      }
      if (dto.active === true && !before.passwordHash && !before.ssoId) {
        throw new ApiError(400, 'INVALID_STATE_TRANSITION', 'User must accept an invitation before activation');
      }
      const after = await tx.user.update({ where: { id }, data: dto, select: adminUserSelect });
      if (dto.active === false || role !== before.role || org.id !== before.orgId) {
        await this.sessions.revokeUser(tx, id);
        await tx.invitation.updateMany({ where: { userId: id, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() } });
      }
      await this.audit.append(tx, { userId: actor.user.id, action: 'USER_UPDATED',
        entityType: 'user', entityId: id, before: presentAdminUser(before), after: presentAdminUser(after) });
      return presentAdminUser(after);
    });
  }

  async invite(actor: Principal, dto: InviteUserDto) {
    const rawToken = opaqueToken();
    const issued = await this.db.serializable(async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const org = await tx.organization.findUnique({ where: { id: dto.orgId } });
      if (!org || !org.active) throw new ApiError(400, 'VALIDATION_FAILED', 'An active organization is required');
      assertCompatible(dto.role, org.type);
      const existing = await tx.user.findUnique({ where: { email: dto.email } });
      if (existing && (existing.passwordHash || existing.ssoId || existing.mfaEnabled || existing.active)) {
        throw new ApiError(409, 'INVALID_STATE_TRANSITION', 'Account already exists');
      }
      const user = existing ? await tx.user.update({
        where: { id: existing.id }, data: { name: dto.name, orgId: dto.orgId, role: dto.role },
        select: adminUserSelect,
      }) : await tx.user.create({ data: { ...dto, active: false }, select: adminUserSelect });
      await tx.invitation.updateMany({ where: { userId: user.id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() } });
      const invitation = await tx.invitation.create({ data: {
        userId: user.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }, select: { id: true, expiresAt: true } });
      await this.audit.append(tx, { userId: actor.user.id, action: 'USER_INVITED',
        entityType: 'user', entityId: user.id, after: presentAdminUser(user),
        metadata: { invitationId: invitation.id } });
      return { user: presentAdminUser(user), invitation };
    });
    // SMTP must be outside retryable transactions. Delivery failures preserve an inactive user
    // so an administrator can retry, but invalidate the undelivered invitation immediately.
    const sent = await this.mailer.send(dto.email, rawToken);
    await this.db.serializable(async tx => {
      await tx.invitation.update({ where: { id: issued.invitation.id }, data: {
        deliveryStatus: sent ? 'sent' : 'failed', ...(sent ? {} : { revokedAt: new Date() }),
      } });
      await this.audit.append(tx, { userId: actor.user.id,
        action: sent ? 'INVITATION_DELIVERED' : 'INVITATION_DELIVERY_FAILED',
        entityType: 'user', entityId: issued.user.id, metadata: { invitationId: issued.invitation.id } });
    });
    return { ...issued, invitation: { ...issued.invitation, status: sent ? 'sent' : 'failed' } };
  }
}
