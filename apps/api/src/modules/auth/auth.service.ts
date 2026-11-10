import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { RuntimeConfig } from '../../common/runtime-config';
import { ApiError } from '../../common/api-error';
import { compatibleRole, presentUser, unauthenticated } from '../../common/identity';
import { AuditService } from '../audit/audit.service';
import { AcceptInviteDto, LoginDto } from './auth.dto';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { SessionService } from './session.service';
import { hashToken, issueAccess, opaqueToken, SESSION_MS, validOpaque } from './tokens';

@Injectable()
export class AuthService {
  // Equal-cost comparison for unknown identities; not a usable embedded account password.
  private readonly dummyHash = hash(opaqueToken(), 12);
  constructor(private readonly db: PrismaService, private readonly config: RuntimeConfig,
    private readonly sessions: SessionService, private readonly audit: AuditService,
    private readonly limiter: AuthRateLimitService) {}

  async login(dto: LoginDto, ip: string) {
    await this.limiter.consume(`login:ip:${ip}`, 100, 900);
    await this.limiter.consume(`login:email:${dto.email}`, 10, 900);
    const candidate = await this.db.user.findUnique({ where: { email: dto.email }, include: { org: true } });
    const matches = await compare(dto.password, candidate?.passwordHash ?? await this.dummyHash);
    const result = await this.db.serializable(async tx => {
      const user = candidate ? await tx.user.findUnique({
        where: { id: candidate.id }, include: { org: true },
      }) : null;
      if (!matches || !user || !user.passwordHash || user.passwordHash !== candidate?.passwordHash ||
          !user.active || !user.org.active || user.mfaEnabled || !compatibleRole(user.role, user.org.type)) {
        await this.audit.append(tx, { action: 'AUTH_LOGIN_FAILED', entityType: 'authentication', entityId: 'login' });
        return null;
      }
      const id = randomUUID();
      const access = issueAccess(this.config.values.secret, user.id, id);
      const refresh = opaqueToken();
      const expiresAt = new Date(Date.now() + SESSION_MS);
      await tx.session.create({ data: {
        id, userId: user.id, orgId: user.orgId, role: user.role, accessTokenHash: hashToken(access), expiresAt,
        refreshTokens: { create: { userId: user.id, tokenHash: hashToken(refresh), expiresAt } },
      } });
      await tx.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
      await this.audit.append(tx, { userId: user.id, action: 'AUTH_LOGIN', entityType: 'session', entityId: id });
      return { user: presentUser(user), access, refresh, expiresAt };
    });
    if (!result) throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid email or password');
    return result;
  }

  async refresh(raw: string | undefined, ip: string) {
    await this.limiter.consume(`refresh:ip:${ip}`, 120, 60);
    if (!validOpaque(raw)) throw unauthenticated();
    // READ COMMITTED + a row lock serializes this family. Always re-read after waiting.
    // Returning null (not throwing) commits revocation before the controller sends a 401.
    const result = await this.db.$transaction(async tx => {
      const initial = await tx.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
      if (!initial?.sessionId) return null;
      await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${initial.sessionId}::uuid FOR UPDATE`;
      const token = await tx.refreshToken.findUnique({ where: { id: initial.id } });
      const session = await tx.session.findUnique({
        where: { id: initial.sessionId }, include: { user: { include: { org: true } } },
      });
      if (!token || !session) return null;
      if (token.usedAt) {
        await this.sessions.revokeFamily(tx, session.familyId);
        await this.audit.append(tx, { userId: session.userId, action: 'AUTH_REFRESH_REPLAY',
          entityType: 'session', entityId: session.id, metadata: { severity: 'SECURITY' } });
        return null;
      }
      if (token.revokedAt || token.expiresAt.getTime() <= Date.now() || !this.sessions.isUsable(session)) {
        await this.sessions.revokeFamily(tx, session.familyId);
        return null;
      }
      const now = new Date();
      const used = await tx.refreshToken.updateMany({
        where: { id: token.id, usedAt: null, revokedAt: null }, data: { usedAt: now },
      });
      if (used.count !== 1) {
        await this.sessions.revokeFamily(tx, session.familyId);
        return null;
      }
      const access = issueAccess(this.config.values.secret, session.userId, session.id);
      const refresh = opaqueToken();
      await tx.session.update({ where: { id: session.id }, data: { accessTokenHash: hashToken(access) } });
      await tx.refreshToken.create({ data: {
        userId: session.userId, sessionId: session.id, tokenHash: hashToken(refresh), expiresAt: session.expiresAt,
      } });
      await this.audit.append(tx, { userId: session.userId, action: 'AUTH_REFRESH',
        entityType: 'session', entityId: session.id });
      return { user: presentUser(session.user), access, refresh, expiresAt: session.expiresAt };
    }, { maxWait: 5000, timeout: 10000 });
    if (!result) throw unauthenticated();
    return result;
  }

  async logout(access: string | undefined, refresh: string | undefined) {
    await this.db.serializable(async tx => {
      // Possession is sufficient to revoke, including an expired access token.
      const token = validOpaque(refresh) ?
        await tx.refreshToken.findUnique({ where: { tokenHash: hashToken(refresh) } }) : null;
      const sessions = await tx.session.findMany({ where: { OR: [
        ...(token?.sessionId ? [{ id: token.sessionId }] : []),
        ...(access ? [{ accessTokenHash: hashToken(access) }] : []),
      ], revokedAt: null } });
      for (const session of sessions) {
        await this.sessions.revokeFamily(tx, session.familyId);
        await this.audit.append(tx, { userId: session.userId, action: 'AUTH_LOGOUT',
          entityType: 'session', entityId: session.id });
      }
    });
    return { ok: true as const };
  }

  async acceptInvite(dto: AcceptInviteDto, ip: string) {
    await this.limiter.consume(`accept:ip:${ip}`, 30, 900);
    const passwordHash = await hash(dto.password, 12);
    const accepted = await this.db.serializable(async tx => {
      const invite = await tx.invitation.findUnique({
        where: { tokenHash: hashToken(dto.token) }, include: { user: { include: { org: true } } },
      });
      if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt.getTime() <= Date.now() ||
          !invite.user.org.active || invite.user.passwordHash || invite.user.ssoId ||
          invite.user.mfaEnabled || !compatibleRole(invite.user.role, invite.user.org.type)) return false;
      const used = await tx.invitation.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (used.count !== 1) return false;
      await tx.user.update({ where: { id: invite.userId }, data: { passwordHash, active: true } });
      await tx.invitation.updateMany({
        where: { userId: invite.userId, id: { not: invite.id }, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.sessions.revokeUser(tx, invite.userId);
      await this.audit.append(tx, { userId: invite.userId, action: 'INVITATION_ACCEPTED',
        entityType: 'user', entityId: invite.userId, after: { active: true } });
      return true;
    });
    if (!accepted) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid or expired invitation');
    return { ok: true as const };
  }
}
