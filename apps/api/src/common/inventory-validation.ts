import { Transform } from 'class-transformer';
import { registerDecorator, ValidateIf } from 'class-validator';
import { Prisma } from '@prisma/client';
import { ApiError } from './api-error';
import type { PrismaService } from '../prisma/prisma.service';

export const Optional = () => ValidateIf((_object, value: unknown) => value !== undefined);
export const Nullable = () => ValidateIf((_object, value: unknown) => value !== undefined && value !== null);
export const TrimText = () => Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value);
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

/** Preserve the existing retry policy; exhausted races/constraints expose no database details. */
export async function inventoryTransaction<T>(db: PrismaService, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try { return await db.serializable(work); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (['P2002', 'P2004', 'P2034'].includes(error.code)) {
        throw conflict('Inventory conflict; reload and retry');
      }
      if (error.code === 'P2025') throw missing('Inventory record');
    }
    throw error;
  }
}
