import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Principal } from '../../common/identity';
import { conflict, inventoryTransaction, missing, requirePatch } from '../../common/inventory-validation';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { CreateVenueDto, UpdateVenueDto, VenuePageDto, VenueQueryDto, VenueResponseDto } from './venues.dto';

export const venueSelect = {
  id: true, name: true, type: true, country: true, city: true,
  timezone: true, notes: true, active: true, createdAt: true, updatedAt: true,
} satisfies Prisma.VenueSelect;
export function presentVenue(row: Prisma.VenueGetPayload<{ select: typeof venueSelect }>): VenueResponseDto {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

@Injectable()
export class VenuesService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService,
    private readonly sessions: SessionService) {}

  list(actor: Principal, query: VenueQueryDto): Promise<VenuePageDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const where: Prisma.VenueWhereInput = { active: query.active };
      const items = await tx.venue.findMany({ where, select: venueSelect, skip: query.skip, take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
      return { items: items.map(presentVenue), total: await tx.venue.count({ where }), page: query.page, pageSize: query.pageSize };
    });
  }
  get(actor: Principal, id: string): Promise<VenueResponseDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const row = await tx.venue.findUnique({ where: { id }, select: venueSelect });
      if (!row) throw missing('Venue');
      return presentVenue(row);
    });
  }
  create(actor: Principal, dto: CreateVenueDto): Promise<VenueResponseDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const row = await tx.venue.create({ data: { ...dto, type: dto.type ?? 'ferry' }, select: venueSelect });
      const after = presentVenue(row);
      await this.audit.append(tx, { userId: actor.user.id, action: 'VENUE_CREATED',
        entityType: 'venue', entityId: row.id, after });
      return after;
    });
  }
  update(actor: Principal, id: string, dto: UpdateVenueDto): Promise<VenueResponseDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      requirePatch(dto);
      const row = await tx.venue.findUnique({ where: { id }, select: venueSelect });
      if (!row) throw missing('Venue');
      if (dto.active === false && await tx.screen.count({ where: { venueId: id, active: true, deletedAt: null } })) {
        throw conflict('Deactivate the venue screens first');
      }
      const after = presentVenue(await tx.venue.update({ where: { id }, data: dto, select: venueSelect }));
      await this.audit.append(tx, { userId: actor.user.id, action: 'VENUE_UPDATED',
        entityType: 'venue', entityId: id, before: presentVenue(row), after });
      return after;
    });
  }
}
