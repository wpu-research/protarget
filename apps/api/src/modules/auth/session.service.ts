import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RuntimeConfig } from '../../common/runtime-config';
import { compatibleRole, forbidden, Principal, presentUser, unauthenticated } from '../../common/identity';
import { hashToken, verifyAccess } from './tokens';

@Injectable()
export class SessionService {
  constructor(private readonly db: PrismaService, private readonly config: RuntimeConfig) {}

  async authenticate(raw: string | undefined): Promise<Principal> {
    if (!raw) throw unauthenticated();
    let claims: ReturnType<typeof verifyAccess>;
    try { claims = verifyAccess(this.config.values.secret, raw); } catch { throw unauthenticated(); }
    const accessHash = hashToken(raw);
    const session = await this.db.session.findUnique({
      where: { id: claims.sid }, include: { user: { include: { org: true } } },
    });
    if (!session || session.userId !== claims.sub || session.accessTokenHash !== accessHash ||
        !this.isUsable(session)) throw unauthenticated();
    return { sessionId: session.id, accessHash, user: presentUser(session.user) };
  }

  isUsable(session: Prisma.SessionGetPayload<{ include: { user: { include: { org: true } } } }>) {
    const user = session.user;
    return !session.revokedAt && session.expiresAt.getTime() > Date.now() &&
      user.active && user.org.active && !user.mfaEnabled &&
      session.role === user.role && session.orgId === user.orgId && compatibleRole(user.role, user.org.type);
  }

  /** Recheck authorization in the same serializable transaction as every business write. */
  async requireAdmin(tx: Prisma.TransactionClient, actor: Principal): Promise<void> {
    const session = await tx.session.findUnique({
      where: { id: actor.sessionId }, include: { user: { include: { org: true } } },
    });
    if (!session || session.accessTokenHash !== actor.accessHash || !this.isUsable(session)) throw unauthenticated();
    if (session.user.role !== Role.ADMIN) throw forbidden();
  }

  async revokeUser(tx: Prisma.TransactionClient, userId: string, now = new Date()) {
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  }

  async revokeFamily(tx: Prisma.TransactionClient, familyId: string, now = new Date()) {
    await tx.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } });
    await tx.refreshToken.updateMany({
      where: { session: { familyId }, revokedAt: null }, data: { revokedAt: now },
    });
  }
}
