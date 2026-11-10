/** Spec v2 §36 arka plan işleri. */
export const QUEUES = {
  MANIFEST_BUILDER: 'manifest-builder',
  IMPRESSION_PROCESSOR: 'impression-processor',
  PACING_CALCULATOR: 'pacing-calculator',
  DEAL_SYNC: 'deal-sync',
  DAILY_AGGREGATION: 'daily-aggregation',
  OFFLINE_SCREEN_DETECTOR: 'offline-screen-detector',
  CREATIVE_CLEANUP: 'creative-cleanup',
  REPORT_GENERATION: 'report-generation',
  CAMPAIGN_COMPLETER: 'campaign-completer',
  NOTIFICATIONS: 'notifications',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
