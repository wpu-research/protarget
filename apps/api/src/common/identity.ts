import { OrganizationType, Prisma, Role } from '@prisma/client';
import type { Request } from 'express';
import { ApiError } from './api-error';

export const userSelect = {
  id: true, name: true, email: true, role: true, orgId: true,
  org: { select: { id: true, name: true, type: true } },
} satisfies Prisma.UserSelect;

export type SelectedUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;
export function presentUser(user: SelectedUser) {
  return { id: user.id, name: user.name, email: user.email, role: user.role,
    orgId: user.orgId, organization: user.org };
}

export function compatibleRole(role: Role, type: OrganizationType): boolean {
  return (role === Role.ADMIN || role === Role.SUPPORT) ? type === OrganizationType.ADMIN :
    role === Role.AGENCY ? type === OrganizationType.AGENCY :
      role === Role.ADVERTISER && type === OrganizationType.ADVERTISER;
}

export function assertCompatible(role: Role, type: OrganizationType): void {
  if (!compatibleRole(role, type)) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Role is incompatible with organization type');
  }
}

export interface Principal {
  user: ReturnType<typeof presentUser>;
  sessionId: string;
  accessHash: string;
}
export type AuthRequest = Request & { principal: Principal; requestId: string };
export const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
export const forbidden = () => new ApiError(403, 'FORBIDDEN', 'Access denied');
