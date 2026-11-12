import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanActivate, ExecutionContext, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { AuthRequest } from '../../common/identity';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';

/** Dedicated directory for in-flight multipart uploads (not the shared system temp root). */
export const UPLOAD_DIR = join(tmpdir(), 'protarget-creative-uploads');
/** Per admin: a 200 MB body is written to disk before the handler runs, so uploads are throttled. */
export const UPLOAD_LIMIT = 60;
export const UPLOAD_WINDOW_SECONDS = 600;
/** A request that dies mid-flight (crash, kill) leaves a file behind; nothing legitimate lives this long. */
export const UPLOAD_MAX_AGE_MS = 3_600_000;

export function ensureUploadDir(dir = UPLOAD_DIR): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Remove files older than `maxAgeMs`; returns how many were removed. Never throws. */
export function sweepUploads(dir = UPLOAD_DIR, maxAgeMs = UPLOAD_MAX_AGE_MS, now = Date.now()): number {
  let removed = 0;
  let names: string[];
  try { names = readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    const path = join(dir, name);
    try {
      if (now - statSync(path).mtimeMs > maxAgeMs) { rmSync(path, { force: true }); removed++; }
    } catch { /* raced with the owner's own cleanup */ }
  }
  return removed;
}

/** Runs after the global AuthGuard (JWT + DB session + ADMIN role) and before the multipart interceptor. */
@Injectable()
export class UploadRateLimitGuard implements CanActivate {
  constructor(private readonly limits: AuthRateLimitService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    await this.limits.consume(`creative-upload:${request.principal.user.id}`, UPLOAD_LIMIT, UPLOAD_WINDOW_SECONDS);
    return true;
  }
}

/** Creates the upload directory and removes leftovers on start and hourly. */
@Injectable()
export class UploadSweeper implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  onModuleInit() {
    ensureUploadDir();
    sweepUploads();
    this.timer = setInterval(() => sweepUploads(), UPLOAD_MAX_AGE_MS);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
