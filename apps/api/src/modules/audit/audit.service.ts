import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { redact } from '../../common/redact';
import { PaginationDto } from '../../common/pagination.dto';

export interface AuditEntry {
  userId?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: PrismaService) {}

  /** Standalone security decisions have no business write to couple to. */
  recordSecurity(entry: AuditEntry) {
    return this.db.$transaction(tx => this.append(tx, {
      ...entry, metadata: { severity: 'SECURITY' },
    }));
  }

  append(tx: Prisma.TransactionClient, entry: AuditEntry) {
    return tx.auditLog.create({ data: this.row(entry) });
  }

  /** One INSERT for many entries (fan-out writes such as a creative revoke); same redaction as `append`. */
  appendMany(tx: Prisma.TransactionClient, entries: AuditEntry[]) {
    if (!entries.length) return Promise.resolve({ count: 0 });
    return tx.auditLog.createMany({ data: entries.map(entry => this.row(entry)) });
  }

  private row(entry: AuditEntry) {
    return {
      userId: entry.userId, action: entry.action, entityType: entry.entityType, entityId: entry.entityId,
      ...(entry.before === undefined ? {} : { before: redact(entry.before) as Prisma.InputJsonValue }),
      ...(entry.after === undefined ? {} : { after: redact(entry.after) as Prisma.InputJsonValue }),
      ...(entry.metadata === undefined ? {} : { metadata: redact(entry.metadata) as Prisma.InputJsonValue }),
    };
  }

  async list(query: PaginationDto) {
    const [items, total] = await this.db.$transaction([
      this.db.auditLog.findMany({ skip: query.skip, take: query.pageSize,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }] }),
      this.db.auditLog.count(),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    // Redact again on read, including records created by older application versions.
    return { items: items.map(item => ({ ...item,
      before: item.before === null ? null : redact(item.before),
      after: item.after === null ? null : redact(item.after),
      metadata: item.metadata === null ? null : redact(item.metadata),
    })), total, page: query.page, pageSize: query.pageSize };
  }
}
