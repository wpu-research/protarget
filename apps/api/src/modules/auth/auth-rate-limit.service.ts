import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RuntimeConfig } from '../../common/runtime-config';
import { ApiError } from '../../common/api-error';

@Injectable()
export class AuthRateLimitService {
  constructor(private readonly db: PrismaService, private readonly config: RuntimeConfig) {}

  async consume(subject: string, limit: number, windowSeconds: number): Promise<void> {
    const key = createHmac('sha256', this.config.values.secret).update(subject).digest('hex');
    const rows = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO "auth_rate_limits" ("key", "count", "startedAt")
      VALUES (${key}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "auth_rate_limits"."startedAt" <
          CURRENT_TIMESTAMP - (${windowSeconds} * interval '1 second')
          THEN 1 ELSE "auth_rate_limits"."count" + 1 END,
        "startedAt" = CASE WHEN "auth_rate_limits"."startedAt" <
          CURRENT_TIMESTAMP - (${windowSeconds} * interval '1 second')
          THEN CURRENT_TIMESTAMP ELSE "auth_rate_limits"."startedAt" END
      RETURNING "count"`;
    // Opportunistic pruning keeps the table bounded without a scheduler. The longest window is
    // 15 minutes, so day-old buckets can never affect a decision. Failure must not block auth.
    if (Math.random() < 0.02) {
      await this.db.$executeRaw`
        DELETE FROM "auth_rate_limits" WHERE "startedAt" < CURRENT_TIMESTAMP - interval '1 day'`
        .catch(() => undefined);
    }
    if (rows[0].count > limit) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts; try again later');
  }
}
