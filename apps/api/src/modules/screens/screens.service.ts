import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Principal } from '../../common/identity';
import { conflict, invalid, inventoryTransaction, missing, requirePatch } from '../../common/inventory-validation';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { presentVenue, venueSelect } from '../venues/venues.service';
import { CreateScreenDto, ScreenPageDto, ScreenQueryDto, ScreenResponseDto, UpdateScreenDto } from './screens.dto';

export const screenSelect = {
  id: true, screenId: true, screenIdLocked: true, venueId: true, venue: { select: venueSelect },
  name: true, timezone: true, active: true, locationLabel: true, resolutionWidth: true, resolutionHeight: true,
  orientation: true, physicalSize: true, os: true, cmsName: true, cmsVersion: true, cmsReference: true, notes: true,
  loopLengthSec: true, defaultSlotLengthSec: true, operatingStart: true, operatingEnd: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.ScreenSelect;
export function presentScreen(row: Prisma.ScreenGetPayload<{ select: typeof screenSelect }>): ScreenResponseDto {
  return { ...row, venue: presentVenue(row.venue), connectionStatus: 'NOT_CONNECTED',
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
type ScreenTiming = Pick<CreateScreenDto, 'operatingStart' | 'operatingEnd' | 'loopLengthSec' | 'defaultSlotLengthSec'>;

/** Inserts validate both groups; edits validate only groups whose stored values change.
 * Legacy inconsistencies must not prevent metadata edits, deactivation, or correction
 * of the other timing group. Keep this aligned with the database edit triggers.
 */
export function validateScreenTiming(data: ScreenTiming, before?: ScreenTiming) {
  const hoursChanged = !before || data.operatingStart !== before.operatingStart || data.operatingEnd !== before.operatingEnd;
  const slotChanged = !before || data.loopLengthSec !== before.loopLengthSec || data.defaultSlotLengthSec !== before.defaultSlotLengthSec;
  const hhmm = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
  if (hoursChanged && ((data.operatingStart == null) !== (data.operatingEnd == null) ||
      (data.operatingStart != null && !hhmm.test(data.operatingStart)) ||
      (data.operatingEnd != null && !hhmm.test(data.operatingEnd)) ||
      (data.operatingStart != null && data.operatingStart === data.operatingEnd))) {
    throw invalid('Operating hours must be a distinct HH:mm pair, or both null');
  }
  if (slotChanged && data.loopLengthSec != null && data.defaultSlotLengthSec != null && data.defaultSlotLengthSec > data.loopLengthSec) {
    throw invalid('Slot length must not exceed loop length');
  }
}

@Injectable()
export class ScreensService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService,
    private readonly sessions: SessionService) {}
  list(actor: Principal, query: ScreenQueryDto): Promise<ScreenPageDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const where: Prisma.ScreenWhereInput = { deletedAt: null, venueId: query.venueId, active: query.active };
      const items = await tx.screen.findMany({ where, select: screenSelect, skip: query.skip, take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
      return { items: items.map(presentScreen), total: await tx.screen.count({ where }), page: query.page, pageSize: query.pageSize };
    });
  }
  get(actor: Principal, id: string): Promise<ScreenResponseDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const row = await tx.screen.findFirst({ where: { id, deletedAt: null }, select: screenSelect });
      if (!row) throw missing('Screen');
      return presentScreen(row);
    });
  }
  create(actor: Principal, dto: CreateScreenDto): Promise<ScreenResponseDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      validateScreenTiming(dto);
      await this.requireActiveVenue(tx, dto.venueId);
      const after = presentScreen(await tx.screen.create({
        data: { ...dto, playerType: 'EXTERNAL_SIGNAGE', dealEligible: false }, select: screenSelect,
      }));
      await this.audit.append(tx, { userId: actor.user.id, action: 'SCREEN_CREATED',
        entityType: 'screen', entityId: after.id, after });
      return after;
    });
  }
  update(actor: Principal, id: string, dto: UpdateScreenDto): Promise<ScreenResponseDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      requirePatch(dto);
      const row = await tx.screen.findFirst({ where: { id, deletedAt: null }, select: screenSelect });
      if (!row) throw missing('Screen');
      if (row.screenIdLocked && dto.screenId !== undefined && dto.screenId !== row.screenId) {
        throw conflict('Screen code is locked');
      }
      // A same-venue deactivation remains possible even for legacy inconsistent data.
      if ((dto.venueId !== undefined && dto.venueId !== row.venueId) || dto.active === true) {
        await this.requireActiveVenue(tx, dto.venueId ?? row.venueId);
      }
      // Class instances may contain own properties with undefined values; omission must not clear stored timing.
      const changes = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as UpdateScreenDto;
      validateScreenTiming({ ...row, ...changes }, row);
      const after = presentScreen(await tx.screen.update({ where: { id }, data: changes, select: screenSelect }));
      await this.audit.append(tx, { userId: actor.user.id, action: 'SCREEN_UPDATED',
        entityType: 'screen', entityId: id, before: presentScreen(row), after });
      return after;
    });
  }
  private async requireActiveVenue(tx: Prisma.TransactionClient, id: string) {
    const venue = await tx.venue.findUnique({ where: { id }, select: { active: true } });
    if (!venue) throw missing('Venue');
    if (!venue.active) throw conflict('Cannot assign or activate a screen under an inactive venue');
  }
}
