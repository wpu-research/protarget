import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RuntimeConfig } from '../../common/runtime-config';
import { AuthRequest, forbidden } from '../../common/identity';
import { PUBLIC_ROUTE, ROUTE_ROLES } from './auth.policy';
import { ACCESS_COOKIE, readCookie } from './tokens';
import { SessionService } from './session.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly config: RuntimeConfig,
    private readonly sessions: SessionService, private readonly audit: AuditService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    // Run before @Public: login CSRF and refresh/logout/acceptance CSRF are also blocked.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        request.headers.origin !== this.config.values.webOrigin) throw forbidden();
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;
    request.principal = await this.sessions.authenticate(readCookie(request, ACCESS_COOKIE));
    const roles = this.reflector.getAllAndOverride<Role[]>(ROUTE_ROLES, targets);
    // An accidentally added controller is NOT automatically available to signed-in users.
    const businessWrite = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (!roles?.includes(request.principal.user.role) ||
        (businessWrite && request.principal.user.role !== Role.ADMIN)) {
      if (request.path.startsWith('/api/v1/portal/')) {
        const requestedId = request.params.id;
        await this.audit.recordSecurity({
          userId: request.principal.user.id, action: 'UNAUTHORIZED_PORTAL_ACCESS',
          entityType: 'organization',
          entityId: typeof requestedId === 'string' && /^[0-9a-f-]{36}$/i.test(requestedId) ? requestedId : 'unknown',
        });
      }
      throw forbidden();
    }
    return true;
  }
}
