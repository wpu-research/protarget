import type { ApiErrorCode } from '@protarget/shared';

/** Belirli bir hata koduyla (örn. MISSING_MULTIPLIER) dönmek için. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
