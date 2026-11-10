import type { PlaybackResult } from '@protarget/shared';

/** Player API sözleşmesi (Spec v2 §19–20). Referans player ve simülatör bu tipleri kullanır. */

export interface ManifestItem {
  slot_id: string;
  campaign_id: string;
  creative_id: string;
  /** Signed ve süreli indirme adresi */
  asset_url: string;
  /** "sha256:…" — oynatmadan önce doğrulanır */
  checksum: string;
  duration_seconds: number;
  valid_from: string;
  valid_to: string;
  priority: number;
}

export interface Manifest {
  manifest_version: string;
  screen_id: string;
  valid_until: string;
  items: ManifestItem[];
}

export interface ProofOfPlayEvent {
  /** Player'ın ürettiği UUID; sunucuda UNIQUE (idempotency) */
  event_id: string;
  screen_id: string;
  campaign_id: string;
  creative_id: string;
  scheduled_slot_id?: string;
  /** ISO 8601, timezone'lu */
  played_at: string;
  duration_seconds: number;
  result: PlaybackResult;
  offline_recorded: boolean;
  player_version: string;
}

export interface HeartbeatPayload {
  screen_id: string;
  player_version: string;
  device_time: string;
  disk_free_bytes?: number;
  current_manifest_version?: string;
  last_successful_playback?: string;
  last_error?: { code: string; message?: string };
}
