import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiError } from '../../common/api-error';
import { assertCompatible, forbidden, Principal } from '../../common/identity';
import { PaginationDto } from '../../common/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { CreateOrganizationDto, UpdateOrganizationDto } from './organizations.dto';

export const portalOrganizationSelect = {
  id: true, name: true, type: true, brandName: true, active: true,
} satisfies Prisma.OrganizationSelect;

@Injectable()
export class OrganizationsService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService,
    private readonly sessions: SessionService) {}

  async list(actor: Principal, query: PaginationDto) {
    const admin = actor.user.role === Role.ADMIN;
    const where: Prisma.OrganizationWhereInput = admin ? {} : { id: actor.user.orgId, active: true };
    const [items, total] = await this.db.$transaction([
      this.db.organization.findMany({ where, ...(admin ? {} : { select: portalOrganizationSelect }),
        skip: query.skip, take: query.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
      this.db.organization.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(actor: Principal, id: string, ownOnly = false) {
    if (ownOnly || actor.user.role !== Role.ADMIN) {
      if (id !== actor.user.orgId) {
        await this.db.$transaction(tx => this.audit.append(tx, {
          userId: actor.user.id, action: 'UNAUTHORIZED_PORTAL_ACCESS',
          entityType: 'organization', entityId: id,
          metadata: { severity: 'SECURITY', organizationId: actor.user.orgId },
        }));
        throw forbidden();
      }
      // Tenant predicate is part of the repository query, not post-fetch filtering.
      const organization = await this.db.organization.findFirst({
        where: { id, AND: { id: actor.user.orgId }, active: true }, select: portalOrganizationSelect,
      });
      if (!organization) throw new ApiError(404, 'NOT_FOUND', 'Organization not found');
      return organization;
    }
    const organization = await this.db.organization.findUnique({ where: { id } });
    if (!organization) throw new ApiError(404, 'NOT_FOUND', 'Organization not found');
    return organization;
  }

  create(actor: Principal, dto: CreateOrganizationDto) {
    return this.db.serializable(async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const organization = await tx.organization.create({ data: dto });
      await this.audit.append(tx, { userId: actor.user.id, action: 'ORGANIZATION_CREATED',
        entityType: 'organization', entityId: organization.id, after: organization });
      return organization;
    });
  }

  update(actor: Principal, id: string, dto: UpdateOrganizationDto) {
    if (Object.keys(dto).length === 0) throw new ApiError(400, 'VALIDATION_FAILED', 'Provide at least one field');
    return this.db.serializable(async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const before = await tx.organization.findUnique({ where: { id } });
      if (!before) throw new ApiError(404, 'NOT_FOUND', 'Organization not found');
      if (id === actor.user.orgId && dto.active === false) {
        throw new ApiError(400, 'INVALID_STATE_TRANSITION', 'Cannot deactivate your own administrator organization');
      }
      if (dto.type && dto.type !== before.type) {
        const users = await tx.user.findMany({ where: { orgId: id }, select: { role: true } });
        for (const user of users) assertCompatible(user.role, dto.type);
      }
      const after = await tx.organization.update({ where: { id }, data: dto });
      if (dto.active === false) {
        // A disable is permanent for existing sessions, even if the organization is re-enabled.
        await tx.session.updateMany({ where: { user: { orgId: id }, revokedAt: null },
          data: { revokedAt: new Date() } });
        await tx.refreshToken.updateMany({ where: { user: { orgId: id }, revokedAt: null },
          data: { revokedAt: new Date() } });
        await tx.invitation.updateMany({ where: { user: { orgId: id }, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() } });
      }
      await this.audit.append(tx, { userId: actor.user.id, action: 'ORGANIZATION_UPDATED',
        entityType: 'organization', entityId: id, before, after });
      return after;
    });
  }
}
