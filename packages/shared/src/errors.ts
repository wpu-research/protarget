export type Severity = 'Info' | 'Warning' | 'Critical' | 'Security';

/** Spec v2 §31 hata kataloğu. */
export const ERROR_CATALOGUE = {
  PLAYER_OFFLINE: { severity: 'Warning', adminAction: 'Check device/network' },
  CREATIVE_DOWNLOAD_FAILED: { severity: 'Critical', adminAction: 'Retry/check CDN' },
  CREATIVE_CHECKSUM_MISMATCH: { severity: 'Critical', adminAction: 'Invalidate asset/re-upload' },
  POP_DUPLICATE: { severity: 'Info', adminAction: 'No action' },
  MISSING_MULTIPLIER: { severity: 'Critical', adminAction: 'Create valid multiplier profile' },
  DEAL_SYNC_FAILED: { severity: 'Critical', adminAction: 'Retry / inspect connector log' },
  DEAL_STATUS_MISMATCH: { severity: 'Warning', adminAction: 'Resync' },
  UNDERPACING: { severity: 'Warning', adminAction: 'Adjust schedule/screen allocation' },
  SCREEN_CONFLICT: { severity: 'Warning', adminAction: 'Review scheduling' },
  UNAUTHORIZED_PORTAL_ACCESS: { severity: 'Security', adminAction: 'Log/security review' },
} as const satisfies Record<string, { severity: Severity; adminAction: string }>;

export type OpsErrorCode = keyof typeof ERROR_CATALOGUE;

/** API'nin döndürdüğü genel hata kodları (katalog + HTTP düzeyi). */
export type ApiErrorCode =
  | OpsErrorCode
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_STATE_TRANSITION'
  | 'MAPPING_ERROR'
  | 'RATE_LIMITED'
  | 'INVITATIONS_DISABLED'
  | 'PAYLOAD_TOO_LARGE'
  | 'STORAGE_UNAVAILABLE'
  | 'DUPLICATE_CREATIVE'
  | 'CAMPAIGN_NOT_READY'
  | 'ADDON_DISABLED'
  | 'ADDON_NOT_AVAILABLE'
  | 'INTERNAL_ERROR';

/** Spec v2 §33 standart hata zarfı. */
export interface ErrorEnvelope {
  error: {
    code: ApiErrorCode | string;
    message: string;
    details: Record<string, unknown>;
  };
}
