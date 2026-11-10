import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const PUBLIC_ROUTE = 'phase0:public';
export const ROUTE_ROLES = 'phase0:roles';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROUTE_ROLES, roles);
