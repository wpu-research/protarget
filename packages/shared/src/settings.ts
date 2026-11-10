/** Settings tablosundaki anahtarlar ve varsayılanları. Hepsi admin panelinden değiştirilebilir. */
export const DEFAULT_SETTINGS = {
  'player.health.warningAfterSeconds': 120,
  'player.health.offlineAfterSeconds': 600,
  'player.manifest.pollSeconds': 60,
  'player.manifest.validMinutes': 30,
  'player.manifest.offlineGraceHours': 24,
  'player.clockDriftToleranceSeconds': 120,
  'pacing.underThreshold': 0.9,
  'pacing.overThreshold': 1.1,
  'pacing.intervalMinutes': 10,
  'deal.sync.intervalMinutes': 10,
  'deal.requireActiveToLaunch': false,
  'deal.continueCampaignOnConnectorFailure': true,
  'portal.showMultiplierSourceReference': false,
  'campaign.defaultOverdeliveryTolerancePct': 1,
  'creative.allowedDurationsSeconds': [10, 15, 20],
  'logs.retentionDays': 90,
  'pop.retentionMonths': 24,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
