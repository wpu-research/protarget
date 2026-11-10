import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import { CreateVenueDto, UpdateVenueDto, VenueQueryDto } from '../src/modules/venues/venues.dto';
import { CreateScreenDto, ScreenQueryDto, UpdateScreenDto } from '../src/modules/screens/screens.dto';
import { ApproveMultiplierDto, CreateMultiplierDto } from '../src/modules/multipliers/multipliers.dto';
import { ScreensService, validateScreenTiming } from '../src/modules/screens/screens.service';
import { effectiveMultiplierWhere, isWholeScreen, presentMultiplier } from '../src/modules/multipliers/multipliers.service';
import { inventoryTransaction, requirePatch } from '../src/common/inventory-validation';
import { PrismaService } from '../src/prisma/prisma.service';
import { redact } from '../src/common/redact';
import type { Principal } from '../src/common/identity';
import type { AuditService } from '../src/modules/audit/audit.service';
import type { SessionService } from '../src/modules/auth/session.service';

const venue = { name: ' Ship ', country: ' Turkey ', city: ' Istanbul ', timezone: 'Europe/Istanbul' };
const screen = { screenId: ' scr-01 ', name: ' Screen ', venueId: randomUUID(), timezone: 'Europe/Istanbul' };
const multiplier = { value: '1.2500', sourceRef: ' Operator estimate ', changeReason: ' Initial estimate ' };
const errors = async (type: new () => object, input: object) => validate(plainToInstance(type, input), {
  whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
});

describe('Inventory request contracts', () => {
  it('trims metadata and canonicalizes physical codes without inventing equipment defaults', async () => {
    const v = plainToInstance(CreateVenueDto, venue);
    const s = plainToInstance(CreateScreenDto, screen);
    expect(v.name).toBe('Ship');
    expect(s.screenId).toBe('SCR-01');
    expect(s.resolutionWidth).toBeUndefined();
    expect(s.defaultSlotLengthSec).toBeUndefined();
    expect(await validate(v)).toHaveLength(0);
    expect(await validate(s)).toHaveLength(0);
  });
  it.each([
    { name: ' ' }, { city: '' }, { country: null }, { timezone: 'Mars/Port' },
    { timezone: '+03:00' }, { active: null }, { type: 'boat' }, { notes: ' ' }, { name: 'a'.repeat(161) },
  ])('rejects invalid venue metadata %j', async patch => {
    expect((await errors(CreateVenueDto, { ...venue, ...patch })).length).toBeGreaterThan(0);
  });
  it.each([
    { screenId: 'bad code' }, { screenId: 'İ' }, { screenId: 'a'.repeat(65) },
    { venueId: 'not-uuid' }, { resolutionWidth: 0 }, { resolutionHeight: -1 }, { loopLengthSec: 1.2 },
    { defaultSlotLengthSec: '10' }, { resolutionWidth: 2147483648 },
    { orientation: 'unknown' }, { operatingStart: '24:00' }, { operatingEnd: '8:00' },
    { cmsName: ' ' }, { cmsReference: 'a'.repeat(501) }, { name: null },
  ])('rejects invalid screen metadata %j', async patch => {
    expect((await errors(CreateScreenDto, { ...screen, ...patch })).length).toBeGreaterThan(0);
  });
  it('allows nullable equipment and note fields, but not null required PATCH properties', async () => {
    expect(await errors(UpdateScreenDto, { os: null, orientation: null, operatingStart: null,
      operatingEnd: null, resolutionWidth: null, notes: null })).toHaveLength(0);
    expect(await errors(UpdateVenueDto, { notes: null })).toHaveLength(0);
    expect((await errors(UpdateScreenDto, { active: null, name: null, venueId: null })).length).toBe(3);
    expect((await errors(UpdateVenueDto, { active: null, timezone: null })).length).toBe(2);
  });
  it('rejects empty patches including class fields initialized to undefined', () => {
    expect(() => requirePatch(plainToInstance(UpdateScreenDto, {}))).toThrow('at least one');
    expect(() => requirePatch(plainToInstance(UpdateVenueDto, {}))).toThrow('at least one');
    expect(() => requirePatch({ notes: null })).not.toThrow();
  });
  it.each(['owner', 'player', 'playerType', 'tokenHash', 'floorCpm', 'dealEligible', 'screenIdLocked'])(
    'rejects protected screen input %s', async key => {
      expect((await errors(CreateScreenDto, { ...screen, [key]: 'injected' })).length).toBeGreaterThan(0);
    });
  it('parses boolean filters without coercing false to true and validates pagination/UUIDs', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const query = await pipe.transform({ active: 'false', page: '2', pageSize: '5' }, { type: 'query', metatype: ScreenQueryDto });
    expect(query).toMatchObject({ active: false, page: 2, pageSize: 5, skip: 5 });
    for (const input of [{ active: '0' }, { page: '0' }, { pageSize: '101' }, { venueId: 'bad' }]) {
      await expect(pipe.transform(input, { type: 'query', metatype: ScreenQueryDto })).rejects.toThrow();
    }
    expect(await errors(VenueQueryDto, { active: null })).not.toHaveLength(0);
  });
  it.each(['0', '0.0000', '-1', '1e2', '100000000', '99999999.99999', '.1', '1.', ' 1 ', '01', 'NaN', 1, null])(
    'rejects invalid multiplier decimal %j', async value => {
      expect((await errors(CreateMultiplierDto, { ...multiplier, value })).length).toBeGreaterThan(0);
    });
  it.each(['0.0001', '1', '1.2000', '99999999.9999'])('accepts exact decimal %s', async value => {
    expect(await errors(CreateMultiplierDto, { ...multiplier, value })).toHaveLength(0);
  });
  it.each(['sourceType', 'createdBy', 'version', 'approvalStatus', 'validFrom', 'supersedesId', 'daypartStart', 'weekdays'])(
    'rejects server-owned draft input %s', async key => {
      expect((await errors(CreateMultiplierDto, { ...multiplier, [key]: 'injected' })).length).toBeGreaterThan(0);
    });
  it('requires source reference and change reason', async () => {
    expect((await errors(CreateMultiplierDto, { value: '1', sourceRef: ' ', changeReason: ' ' })).length).toBe(2);
  });
  it.each(['2026-02-30T12:00:00Z', '2026-12-01', '2026-12-01T12:00:00+03:00', '2026-12-01T24:00:00Z', null])(
    'rejects invalid UTC start %j', async validFrom => {
      expect((await errors(ApproveMultiplierDto, { validFrom })).length).toBeGreaterThan(0);
    });
  it('accepts server-now, UTC starts, nullable ends/predecessors and rejects value edits', async () => {
    expect(await errors(ApproveMultiplierDto, {})).toHaveLength(0);
    expect(await errors(ApproveMultiplierDto, { validFrom: '2027-01-01T12:00:00.000Z', validTo: null, supersedesId: null })).toHaveLength(0);
    expect((await errors(ApproveMultiplierDto, { value: '2' })).length).toBe(1);
  });
});

describe('Inventory invariants', () => {
  it('permits unknown timing and overnight hours, rejecting unpaired/equal hours and oversized slots', () => {
    for (const data of [{}, { operatingStart: null, operatingEnd: null },
      { operatingStart: '22:00', operatingEnd: '06:00' }, { loopLengthSec: 10, defaultSlotLengthSec: 10 }]) {
      expect(() => validateScreenTiming(data)).not.toThrow();
    }
    for (const data of [{ operatingStart: '08:00' }, { operatingStart: '08:00', operatingEnd: '08:00' },
      { loopLengthSec: 10, defaultSlotLengthSec: 11 }]) expect(() => validateScreenTiming(data)).toThrow();
  });
  describe('legacy timing edits', () => {
    const legacy = { operatingStart: '08:00', operatingEnd: '08:00', loopLengthSec: 10, defaultSlotLengthSec: 20 };
    it('preserves unchanged inconsistent groups on metadata/deactivation and no-op writes', () => {
      expect(() => validateScreenTiming({ ...legacy }, legacy)).not.toThrow();
      expect(() => validateScreenTiming(legacy)).toThrow(); // Still invalid for a new screen.
    });
    it('allows correcting either group without requiring correction of the other group', () => {
      expect(() => validateScreenTiming({ ...legacy, operatingEnd: '20:00' }, legacy)).not.toThrow();
      expect(() => validateScreenTiming({ ...legacy, loopLengthSec: 30 }, legacy)).not.toThrow();
      expect(() => validateScreenTiming({ ...legacy, operatingStart: null, operatingEnd: null }, legacy)).not.toThrow();
      expect(() => validateScreenTiming({ ...legacy, defaultSlotLengthSec: null }, legacy)).not.toThrow();
    });
    it('validates the entire changed group, including an omitted malformed legacy counterpart', () => {
      expect(() => validateScreenTiming({ ...legacy, loopLengthSec: 15 }, legacy)).toThrow('Slot length');
      expect(() => validateScreenTiming({ ...legacy, operatingEnd: null }, legacy)).toThrow('Operating hours');
      const malformed = { ...legacy, operatingStart: '25:00' };
      expect(() => validateScreenTiming({ ...malformed, operatingEnd: '22:00' }, malformed)).toThrow('Operating hours');
      expect(() => validateScreenTiming({ ...malformed, loopLengthSec: 30 }, malformed)).not.toThrow();
      expect(() => validateScreenTiming({ operatingStart: '25:00', operatingEnd: '22:00' })).toThrow('Operating hours');
    });
    it.each([{ active: false }, { name: 'Metadata only' }, { operatingEnd: '20:00' }, { loopLengthSec: 30 }])(
      'persists and audits PATCH %j without normalizing unrelated legacy timing', async patch => {
        const row = { ...legacy, id: randomUUID(), ...screen, venueId: randomUUID(), active: true, screenIdLocked: false,
          venue: { ...venue, id: randomUUID(), active: false, createdAt: new Date(), updatedAt: new Date() },
          createdAt: new Date(), updatedAt: new Date() };
        const update = jest.fn(async ({ data }: { data: object }) => ({ ...row, ...data }));
        const tx = { screen: { findFirst: jest.fn().mockResolvedValue(row), update } };
        const db = { serializable: jest.fn(work => work(tx)) } as unknown as PrismaService;
        const append = jest.fn().mockResolvedValue({});
        const requireAdmin = jest.fn().mockResolvedValue(undefined);
        const service = new ScreensService(db, { append } as unknown as AuditService, { requireAdmin } as unknown as SessionService);
        await service.update({ user: { id: randomUUID() } } as Principal, row.id, plainToInstance(UpdateScreenDto, patch));
        expect(requireAdmin).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ where: { id: row.id }, data: patch, select: expect.any(Object) });
        expect(append).toHaveBeenCalledWith(tx, expect.objectContaining({
          before: expect.objectContaining(legacy), after: expect.objectContaining({ ...legacy, ...patch }),
        }));
      });
  });
  it('queries effective whole-screen approvals with inclusive start and exclusive end', () => {
    const at = new Date('2027-01-01T00:00:00Z');
    expect(effectiveMultiplierWhere('screen', at)).toEqual({
      screenId: 'screen', approvalStatus: 'APPROVED', specificityKey: '', daypartStart: null, daypartEnd: null,
      weekdays: { isEmpty: true }, validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gt: at } }],
    });
    expect(isWholeScreen({ specificityKey: '', daypartStart: null, daypartEnd: null, weekdays: [] })).toBe(true);
    expect(isWholeScreen({ specificityKey: '', daypartStart: null, daypartEnd: null, weekdays: [1] })).toBe(false);
  });
  it('normalizes Decimal audit values to strings and hides provisional draft dates', () => {
    const row = { id: randomUUID(), screenId: randomUUID(), value: new Prisma.Decimal('1.25'),
      sourceType: 'MANUAL' as const, sourceRef: 'ref', changeReason: 'reason', confidenceNote: null,
      validFrom: new Date(), validTo: null, daypartStart: null, daypartEnd: null, weekdays: [], specificityKey: '',
      approvalStatus: 'DRAFT' as const, version: 1, createdBy: randomUUID(), approvedBy: null,
      approvedAt: null, supersedesId: null, createdAt: new Date() };
    const snapshot = presentMultiplier(row);
    expect(snapshot.value).toBe('1.2500');
    expect(snapshot.validFrom).toBeNull();
    expect(snapshot).not.toHaveProperty('specificityKey');
    expect(redact(snapshot)).toMatchObject({ value: '1.2500' });
  });
  it('retries serialization failures using the existing transaction policy', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '6.19.3' });
    const transaction = jest.fn().mockRejectedValueOnce(conflict).mockResolvedValue('ok');
    const db = { $transaction: transaction };
    expect(await PrismaService.prototype.serializable.call(db as unknown as PrismaService, async () => 'ok')).toBe('ok');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: 'Serializable' });
  });
  it('maps exhausted conflicts safely but never swallows audit/internal failures', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('private SQL', { code: 'P2034', clientVersion: '6.19.3' });
    const db = { serializable: jest.fn().mockRejectedValue(error) } as unknown as PrismaService;
    await expect(inventoryTransaction(db, async () => null)).rejects.toMatchObject({ status: 409 });
    const auditError = new Error('audit');
    (db.serializable as jest.Mock).mockRejectedValue(auditError);
    await expect(inventoryTransaction(db, async () => null)).rejects.toBe(auditError);
  });
});
