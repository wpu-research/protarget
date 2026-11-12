import { ArgumentMetadata, Injectable, ParseUUIDPipe } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { registerDecorator, ValidateIf } from 'class-validator';
import { Prisma } from '@prisma/client';
import { ApiError } from './api-error';
import type { PrismaService } from '../prisma/prisma.service';

export const Optional = () => ValidateIf((_object, value: unknown) => value !== undefined);
export const Nullable = () => ValidateIf((_object, value: unknown) => value !== undefined && value !== null);
export const TrimText = () => Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value);
/** UUIDs are canonical lowercase everywhere (ids compared as strings, storage keys, audit entity ids). */
export const LowerUuid = () => Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : Array.isArray(value) ? value.map(item => typeof item === 'string' ? item.toLowerCase() : item) : value);
/** Path-parameter counterpart of LowerUuid. */
@Injectable()
export class LowerUuidPipe extends ParseUUIDPipe {
  override async transform(value: string, metadata: ArgumentMetadata): Promise<string> {
    return String(await super.transform(value, metadata)).toLowerCase();
  }
}
export const BooleanQuery = () => Transform(({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value);

export function IsTimezone() {
  return (object: object, propertyName: string) => registerDecorator({
    name: 'isTimezone', target: object.constructor, propertyName,
    options: { message: `${propertyName} must be a known IANA timezone` },
    validator: { validate(value: unknown) {
      if (typeof value !== 'string' || /^[+-]/.test(value)) return false;
      try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
    } },
  });
}
export const invalid = (message: string) => new ApiError(400, 'VALIDATION_FAILED', message);
export const conflict = (message: string) => new ApiError(409, 'INVALID_STATE_TRANSITION', message);
export const missing = (entity: string) => new ApiError(404, 'NOT_FOUND', `${entity} not found`);
export function requirePatch(dto: object) {
  if (!Object.values(dto).some(value => value !== undefined)) throw invalid('Provide at least one field');
}

/** Message of the generic 409 that folds exhausted race/constraint errors (P2002, P2004, P2034). Callers match on this constant. */
export const INVENTORY_CONFLICT_MESSAGE = 'Inventory conflict; reload and retry';

/** Preserve the existing retry policy; exhausted races/constraints expose no database details. */
export async function inventoryTransaction<T>(db: PrismaService, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try { return await db.serializable(work); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (['P2002', 'P2004', 'P2034'].includes(error.code)) {
        throw conflict(INVENTORY_CONFLICT_MESSAGE);
      }
      if (error.code === 'P2025') throw missing('Inventory record');
    }
    if (isCheckViolation(error)) throw conflict('The change violates a booking rule; reload and retry');
    throw error;
  }
}

/** Postgres CHECK/trigger violations (SQLSTATE 23514). Verified against real Prisma 6 errors (integration test D11):
 *  - `$executeRaw*`/`$queryRaw*`: PrismaClientKnownRequestError P2010 with `meta.code === '23514'`;
 *  - model API (`create`/`update`…): PrismaClientUnknownRequestError, no code/meta; the engine text carries
 *    `PostgresError { code: "23514", ...`. A bare number in the message is NOT enough (the text embeds the
 *    failing row, so user data such as "23514" could appear in an unrelated error).
 * The database text itself is never exposed. */
const ENGINE_CHECK_VIOLATION = /PostgresError \{ code: "23514"/;
export function isCheckViolation(error: unknown): boolean {
  if (error instanceof ApiError) return false;
  const e = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.code === '23514' || e.meta?.code === '23514') return true;
  return error instanceof Prisma.PrismaClientUnknownRequestError && ENGINE_CHECK_VIOLATION.test(String(e.message ?? ''));
}
