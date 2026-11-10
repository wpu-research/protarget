import type { OrganizationType, Role } from './enums';

export interface Identity {
  id: string; name: string; email: string; role: Role; orgId: string;
  organization: { id: string; name: string; type: OrganizationType };
}
export interface OrganizationSummary {
  id: string; name: string; type: OrganizationType; brandName: string | null; active: boolean;
}
export interface Organization extends OrganizationSummary {
  taxLegalLabel: string | null; spendVisible: boolean; revenueShareVisible: boolean;
  createdAt: string; updatedAt: string;
}
export interface ManagedUser extends Identity {
  active: boolean; lastLogin: string | null; createdAt: string;
}
export interface PageResult<T> { items: T[]; total: number; page: number; pageSize: number }
export interface AuditRecord {
  id: string; userId: string | null; action: string; entityType: string;
  entityId: string; timestamp: string; before: unknown; after: unknown; metadata: unknown;
}
export const homeForRole = (role: Role) => role === 'ADMIN' ? '/admin' : role === 'SUPPORT' ? '/support' : '/portal';
export function rolesForOrganization(type: OrganizationType): Role[] {
  if (type === 'ADMIN') return ['ADMIN', 'SUPPORT'];
  if (type === 'AGENCY') return ['AGENCY'];
  if (type === 'ADVERTISER') return ['ADVERTISER'];
  return [];
}
