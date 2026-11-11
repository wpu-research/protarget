import { Prisma } from '@prisma/client';

/** Next human-readable code for the current UTC year, e.g. CMP-2026-0001 / CR-2026-00001.
 * Runs inside a serializable transaction; concurrent allocations conflict and are retried,
 * and the UNIQUE constraint remains the final guard.
 */
export async function nextCode(tx: Prisma.TransactionClient, table: 'campaigns' | 'creatives', prefix: 'CMP' | 'CR',
  pad: number, now = new Date()): Promise<string> {
  const head = `${prefix}-${now.getUTCFullYear()}-`;
  const pattern = `^${head}[0-9]+$`;
  const rows = table === 'campaigns'
    ? await tx.$queryRaw<{ max: number | null }[]>`SELECT max(split_part("code", '-', 3)::int) AS max FROM "campaigns" WHERE "code" ~ ${pattern}`
    : await tx.$queryRaw<{ max: number | null }[]>`SELECT max(split_part("code", '-', 3)::int) AS max FROM "creatives" WHERE "code" ~ ${pattern}`;
  return `${head}${String((rows[0]?.max ?? 0) + 1).padStart(pad, '0')}`;
}
