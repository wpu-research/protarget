import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, ftruncateSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CampaignDetail, CreativeSummary, InventoryScreen, InventoryVenue, Organization, PageResult } from '@protarget/shared';
import tr from '../../../packages/i18n/src/tr.json';
import en from '../../../packages/i18n/src/en.json';

const baseURL = process.env.PLAYWRIGHT_BASE_URL!;
const tenantPassword = process.env.SEED_TENANT_PASSWORD!;
const run = `BK-E2E-${randomUUID().slice(0, 8).toUpperCase()}`;
const shotDir = process.env.BOOKING_SHOT_DIR;
const ffmpeg = '/usr/bin/ffmpeg';
type Texts = typeof tr;
let admin: APIRequestContext;
let advertiser: Organization;
let ownerName = '';
let ownerId = '';
let sequence = 0;
const drafts = new Set<string>();
const screensToClose = new Set<string>();
const venuesToClose = new Set<string>();
test.use({ timezoneId: 'Europe/Istanbul', actionTimeout: 15000 });

/** Real media generated at test time; a random color per file keeps every upload unique. */
function media(kind: 'mp4' | 'png' | 'mpeg4') {
  const dir = mkdtempSync(join(tmpdir(), 'bk-e2e-'));
  const color = randomUUID().replace(/-/g, '').slice(0, 6);
  const file = join(dir, `${kind}-${color}.${kind === 'png' ? 'png' : 'mp4'}`);
  const input = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${color}:s=320x180:d=2:r=10`];
  const encode = kind === 'png' ? ['-frames:v', '1'] : kind === 'mp4'
    ? ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'] : ['-c:v', 'mpeg4'];
  execFileSync(ffmpeg, [...input, ...encode, file]);
  return { file, name: file.split('/').pop()!, color };
}
function sparse(name: string, bytes: number) {
  const path = join(mkdtempSync(join(tmpdir(), 'bk-e2e-')), name);
  const fd = openSync(path, 'w'); ftruncateSync(fd, bytes); closeSync(fd);
  return path;
}
async function listAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const response = await admin.get(`/api/v1/${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=100`);
    expect(response.status()).toBe(200);
    const result = await response.json() as PageResult<T>;
    items.push(...result.items);
    if (page * result.pageSize >= result.total) return items;
  }
}
async function venue() {
  const response = await admin.post('/api/v1/venues', { data: { name: `${run} venue ${++sequence}`, country: 'Türkiye', city: 'İstanbul', timezone: 'Europe/Istanbul' } });
  expect(response.status()).toBe(201);
  const result = await response.json() as InventoryVenue; venuesToClose.add(result.id); return result;
}
async function screen(parent: InventoryVenue, label: string) {
  const response = await admin.post('/api/v1/screens', { data: { screenId: `${run}-${label}`, name: `${run} screen ${label}`, venueId: parent.id, timezone: 'Europe/Istanbul' } });
  expect(response.status()).toBe(201);
  const result = await response.json() as InventoryScreen; screensToClose.add(result.id); return result;
}
async function session(page: Page, language: 'tr' | 'en') {
  await page.context().addCookies((await admin.storageState()).cookies);
  await page.context().addCookies([{ name: 'protarget_locale', value: language, url: baseURL }]);
}
async function overflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function submit<T>(page: Page, path: string, button: Locator, status = 200, method = 'POST'): Promise<T> {
  const [response] = await Promise.all([
    page.waitForResponse(item => new URL(item.url()).pathname === `/api/v1${path}` && item.request().method() === method),
    button.click(),
  ]);
  expect(response.status()).toBe(status);
  return response.json() as Promise<T>;
}
/** Local wall-clock text for the booking time zone plus its expected UTC instant (Istanbul is a fixed UTC+3). */
function istanbul(offsetDays: number, hour: number) {
  const day = new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  const hh = String(hour).padStart(2, '0');
  return { local: `${day}T${hh}:00`, utc: new Date(`${day}T${String(hour - 3).padStart(2, '0')}:00:00.000Z`).toISOString() };
}
async function shot(page: Page, name: string) {
  if (!shotDir) return;
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
}

test.beforeAll(async ({ playwright }) => {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Campaign E2E requires an explicitly configured loopback runtime');
  admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const login = await admin.post('/api/v1/auth/login', { data: { email: 'admin@example.test', password: process.env.SEED_ADMIN_PASSWORD } });
  expect(login.status()).toBe(200);
  const org = await admin.post('/api/v1/organizations', { data: { name: `${run} advertiser`, type: 'ADVERTISER' } });
  expect(org.status()).toBe(201);
  advertiser = await org.json() as Organization;
  const owner = (await listAll<{ id: string; name: string; email: string }>('users')).find(user => user.email === 'admin@example.test')!;
  ownerName = owner.name; ownerId = owner.id;
});
test.afterAll(async () => {
  if (!admin) return;
  try {
    for (const id of drafts) await admin.post(`/api/v1/campaigns/${id}/archive`, { data: {} });
    for (const id of screensToClose) await admin.patch(`/api/v1/screens/${id}`, { data: { active: false } });
    for (const id of venuesToClose) await admin.patch(`/api/v1/venues/${id}`, { data: { active: false } });
    if (advertiser) await admin.patch(`/api/v1/organizations/${advertiser.id}`, { data: { active: false } });
  } finally { await admin.dispose(); }
});

/** Full operator flow with real API/storage: create -> screens -> creative -> daypart -> goal -> READY -> CMS -> LIVE -> PAUSED -> COMPLETED. */
async function lifecycle(page: Page, language: 'tr' | 'en', mobile: boolean) {
  const T: Texts = language === 'tr' ? tr : en;
  const label = (key: keyof Texts) => T[key];
  const ship = await venue();
  const first = await screen(ship, `${language}${mobile ? 'm' : 'd'}A`);
  const second = await screen(ship, `${language}${mobile ? 'm' : 'd'}B`);
  const name = `${run} ${language} ${mobile ? 'mobile' : 'desktop'} booking`;
  if (mobile) await page.setViewportSize({ width: 375, height: 812 });
  await session(page, language);
  await page.goto('/admin/campaigns');
  await expect(page.getByRole('heading', { level: 1, name: label('nav.campaigns'), exact: true })).toBeVisible();
  await page.getByRole('link', { name: label('booking.new'), exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/campaigns\/new$/);

  // Step 1 – basics. Dates are typed in the booking zone and must reach the API as UTC.
  const start = istanbul(1, 10); const end = istanbul(8, 22);
  await page.getByLabel(label('field.name'), { exact: true }).fill(name);
  await page.locator('select[name="advertiserId"]').selectOption({ label: advertiser.name });
  await page.locator('select[name="internalOwnerId"]').selectOption({ label: ownerName });
  await page.getByLabel(label('booking.startAt'), { exact: true }).fill(start.local);
  await page.getByLabel(label('booking.endAt'), { exact: true }).fill(end.local);
  await expect(page.getByText(start.utc, { exact: false })).toBeVisible();
  const created = await submit<CampaignDetail>(page, '/campaigns', page.getByRole('button', { name: label('booking.saveNext'), exact: true }), 201);
  drafts.add(created.id);
  expect(created.status).toBe('DRAFT');
  expect(created.startAt).toBe(start.utc); expect(created.endAt).toBe(end.utc);
  expect(created.code).toMatch(/^CMP-\d{4}-\d{4}$/);
  await expect(page).toHaveURL(new RegExp(`/admin/campaigns/${created.id}/edit$`));

  // Step 2 – screens: filter, bulk add, bulk remove, add again. Unknown hardware stays "unknown".
  await expect(page.getByRole('heading', { level: 2, name: label('booking.step.screens'), exact: true })).toBeVisible();
  await page.getByLabel(label('booking.search'), { exact: true }).fill(run);
  await page.getByRole('button', { name: label('inventory.filter'), exact: true }).click();
  const rowA = page.locator(`tr[data-screen="${first.screenId}"]`); const rowB = page.locator(`tr[data-screen="${second.screenId}"]`);
  await expect(rowA).toBeVisible(); await expect(rowB).toBeVisible();
  await expect(rowA.getByText(label('booking.unknown')).first()).toBeVisible();
  await expect(rowA.getByText(label('booking.notComputable'))).toBeVisible();
  await rowA.getByRole('checkbox').check(); await rowB.getByRole('checkbox').check();
  await submit(page, `/campaigns/${created.id}/screens`, page.getByRole('button', { name: label('booking.addSelected'), exact: true }));
  await expect(page.getByRole('status')).toHaveText(label('booking.screensAdded'));
  await expect(rowB.getByText(label('booking.inBooking'))).toBeVisible();
  await rowB.getByRole('checkbox').check();
  await submit(page, `/campaigns/${created.id}/screens/remove`, page.getByRole('button', { name: label('booking.removeSelected'), exact: true }));
  await expect(rowB.getByText(label('booking.inBooking'))).toHaveCount(0);
  await rowB.getByRole('checkbox').check();
  await submit(page, `/campaigns/${created.id}/screens`, page.getByRole('button', { name: label('booking.addSelected'), exact: true }));
  await expect(rowB.getByText(label('booking.inBooking'))).toBeVisible();
  await overflow(page); await shot(page, `wizard-screens-${mobile ? 'mobile' : 'desktop'}`);
  await page.getByRole('button', { name: label('booking.next'), exact: true }).click();

  // Step 3 – commercial and goal.
  await page.locator('select[name="pricingModel"]').selectOption('CPM');
  await page.getByLabel(label('booking.unitPrice'), { exact: true }).fill('12.5');
  await page.locator('select[name="primaryGoal"]').selectOption('PLAYOUTS');
  await page.getByLabel(label('booking.targetPlayouts'), { exact: true }).fill('1000');
  await overflow(page);
  const priced = await submit<CampaignDetail>(page, `/campaigns/${created.id}`, page.getByRole('button', { name: label('booking.saveNext'), exact: true }), 200, 'PATCH');
  expect(priced.commercial.unitPrice).toBe('12.5000'); expect(priced.targetPlayouts).toBe('1000');

  // Blockers are visible and READY is disabled while creative and daypart are missing.
  const steps = page.getByRole('list', { name: label('booking.steps') });
  await steps.getByRole('button', { name: new RegExp(label('booking.step.summary')) }).click();
  await expect(page.locator('[data-testid="validation"] [data-code="NO_APPROVED_CREATIVE"]')).toBeVisible();
  await expect(page.locator('[data-testid="validation"] [data-code="NO_SCHEDULE"]')).toBeVisible();
  await expect(page.getByRole('button', { name: label('booking.action.READY'), exact: true })).toBeDisabled();
  await overflow(page);

  // Step 4 – upload a real H.264 MP4, approve it, link it.
  await steps.getByRole('button', { name: new RegExp(label('booking.step.creatives')) }).click();
  await page.getByRole('button', { name: label('creative.uploadInline'), exact: true }).click();
  const upload = page.getByRole('form', { name: label('creative.upload') });
  const video = media('mp4');
  await upload.locator('input[type="file"]').setInputFiles(video.file);
  const uploaded = await submit<CreativeSummary>(page, '/creatives', upload.getByRole('button', { name: label('creative.upload'), exact: true }), 201);
  expect(uploaded.status).toBe('VALIDATING'); expect(uploaded.videoCodec).toBe('h264'); expect(uploaded.kind).toBe('VIDEO');
  const creativeRow = page.locator(`tr[data-creative="${uploaded.code}"]`);
  await expect(creativeRow).toBeVisible();
  await expect(creativeRow.getByText(label('creative.status.VALIDATING'))).toBeVisible();
  await submit(page, `/creatives/${uploaded.id}/approve`, creativeRow.getByRole('button', { name: label('creative.approve'), exact: true }));
  await expect(creativeRow.getByText(label('creative.status.APPROVED'))).toBeVisible();
  await submit(page, `/campaigns/${created.id}/creatives`, creativeRow.getByRole('button', { name: `${label('booking.link')} ${uploaded.code}`, exact: true }));
  await expect(creativeRow.getByText(label('booking.linked'))).toBeVisible();
  await overflow(page);
  await page.getByRole('button', { name: label('booking.next'), exact: true }).click();

  // Step 5 – daypart on Monday, copied to all days.
  const monday = page.getByRole('group', { name: label('weekday.1') });
  await monday.getByRole('button', { name: label('booking.addDaypart'), exact: true }).click();
  await monday.locator('input[type="time"]').nth(0).fill('09:00');
  await monday.locator('input[type="time"]').nth(1).fill('21:00');
  await page.getByRole('button', { name: label('booking.copyMonday'), exact: true }).click();
  await overflow(page);
  const scheduled = await submit<CampaignDetail>(page, `/campaigns/${created.id}/schedule`, page.getByRole('button', { name: label('booking.saveNext'), exact: true }));
  expect(scheduled.schedule).toHaveLength(7);

  // Step 6 – no blockers; READY.
  await expect(page.locator('[data-testid="validation"] .blocker')).toHaveCount(0);
  const readyButton = page.getByRole('button', { name: label('booking.action.READY'), exact: true });
  await expect(readyButton).toBeEnabled();
  await overflow(page);
  const ready = await submit<CampaignDetail>(page, `/campaigns/${created.id}/transitions`, readyButton);
  expect(ready.status).toBe('READY');
  await expect(page).toHaveURL(new RegExp(`/admin/campaigns/${created.id}$`));
  await expect(page.locator('.status-card .badge').first()).toHaveText(label('booking.status.READY'));
  const live = page.getByRole('button', { name: label('booking.action.LIVE'), exact: true });
  await expect(live).toBeDisabled(); // no CMS_UPLOADED declaration yet
  await expect(page.getByText(label('booking.liveBlockedCms')).first()).toBeVisible();
  await overflow(page); await shot(page, `detail-${mobile ? 'mobile' : 'desktop'}`);
  // Tabs: screens, creatives, schedule render and never overflow.
  for (const tab of ['screens', 'creatives', 'schedule'] as const) {
    await page.getByRole('tab', { name: label(`booking.tab.${tab}`), exact: true }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible(); await overflow(page);
    if (tab === 'creatives') await expect(page.locator(`[data-creative="${uploaded.code}"]`)).toBeVisible();
  }

  // CMS tab – operator declarations, append-only, per screen.
  await page.getByRole('tab', { name: label('booking.tab.cms'), exact: true }).click();
  await expect(page.getByRole('note').filter({ hasText: label('booking.operatorDeclaration') })).toBeVisible();
  for (const row of [first, second]) {
    const form = page.getByRole('form', { name: label('booking.cmsRecord') });
    await form.locator('select[name="screenId"]').selectOption({ label: `${row.screenId} · ${row.name}` });
    await form.locator('select[name="type"]').selectOption('CMS_UPLOADED');
    await form.getByLabel(label('booking.cmsReference'), { exact: true }).fill(`${run}-ref-${row.screenId}`);
    await submit(page, `/campaigns/${created.id}/cms-operations`, form.getByRole('button', { name: label('booking.cmsSubmit'), exact: true }), 201);
    await expect(form.getByRole('status')).toHaveText(label('booking.cmsRecorded'));
    await expect(page.locator(`tr[data-screen="${row.screenId}"]`).first().getByText(label('booking.cmsUploaded'))).toBeVisible();
  }
  await expect(page.locator('tr[data-operation="CMS_UPLOADED"]')).toHaveCount(2);
  await expect(page.locator('tr[data-operation="CMS_UPLOADED"]').first().getByText(label('booking.operatorDeclaration'))).toBeVisible();
  await overflow(page);
  await expect(live).toBeEnabled();
  const wentLive = await submit<CampaignDetail>(page, `/campaigns/${created.id}/transitions`, live);
  expect(wentLive.status).toBe('LIVE');
  await expect(page.locator('.status-card .badge').first()).toHaveText(label('booking.status.LIVE'));
  await expect(page.locator('.status-card').getByText(label('booking.operatorDeclaration'))).toBeVisible();

  // PAUSED needs a reason; the dialog refuses an empty one.
  await page.getByRole('button', { name: label('booking.action.PAUSED'), exact: true }).click();
  const dialog = page.getByRole('dialog', { name: label('booking.reasonTitle') });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: label('booking.action.PAUSED'), exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(label('booking.error.reason'));
  await dialog.getByLabel(label('booking.reason'), { exact: true }).fill(`${run} pause reason`);
  const paused = await submit<CampaignDetail>(page, `/campaigns/${created.id}/transitions`, dialog.getByRole('button', { name: label('booking.action.PAUSED'), exact: true }));
  expect(paused.status).toBe('PAUSED');
  await expect(page.locator('.status-card .badge').first()).toHaveText(label('booking.status.PAUSED'));
  await page.getByRole('tab', { name: label('booking.tab.general'), exact: true }).click();
  await expect(page.getByText(label('booking.limitedEdit'))).toBeVisible(); // only notes and end extension while PAUSED
  await overflow(page);

  // COMPLETED is terminal and read-only.
  const completed = await submit<CampaignDetail>(page, `/campaigns/${created.id}/transitions`, page.getByRole('button', { name: label('booking.action.COMPLETED'), exact: true }));
  expect(completed.status).toBe('COMPLETED');
  await expect(page.locator('.status-card .badge').first()).toHaveText(label('booking.status.COMPLETED'));
  await expect(page.getByText(label('common.readOnly'))).toBeVisible();
  await expect(page.locator('.status-actions button')).toHaveCount(0);
  await expect(page.getByText(label('booking.limitedEdit'))).toHaveCount(0);
  await page.getByRole('tab', { name: label('booking.tab.activity'), exact: true }).click();
  // Activity is localized and metadata is a readable key/value list, never raw action codes or JSON.
  await expect(page.getByText(label('booking.activity.CAMPAIGN_STATUS_CHANGED')).first()).toBeVisible();
  await expect(page.getByText(label('booking.activity.CAMPAIGN_CMS_OPERATION_RECORDED')).first()).toBeVisible();
  await expect(page.getByRole('tabpanel').getByText(/CAMPAIGN_[A-Z_]+/)).toHaveCount(0);
  await expect(page.getByRole('tabpanel').locator('pre')).toHaveCount(0);
  const cmsRow = page.getByRole('tabpanel').locator('tr[data-action="CAMPAIGN_CMS_OPERATION_RECORDED"]').first();
  await cmsRow.locator('summary').click();
  await expect(cmsRow.getByText(label('booking.metaValue.OPERATOR_DECLARED'))).toBeVisible();
  await overflow(page);

  // Server-side truth matches what the browser showed, in UTC.
  const finalDetail = await (await admin.get(`/api/v1/campaigns/${created.id}`)).json() as CampaignDetail;
  expect(finalDetail.status).toBe('COMPLETED'); expect(finalDetail.screens).toHaveLength(2);
  expect(finalDetail.screens.every(row => row.cmsUploaded)).toBe(true);
  drafts.delete(created.id);

  // Reopen the finished booking read-only; the wizard route redirects to the detail page.
  await page.goto(`/admin/campaigns/${created.id}/edit`);
  await expect(page).toHaveURL(new RegExp(`/admin/campaigns/${created.id}$`));
  // Locale switch keeps the page and localizes status text.
  await page.getByRole('button', { name: label('common.language'), exact: true }).click();
  const other: Texts = language === 'tr' ? en : tr;
  await expect(page.locator('.status-card .badge').first()).toHaveText(other['booking.status.COMPLETED']);
}

test('booking lifecycle, Turkish, desktop', async ({ page }) => { test.setTimeout(240000); await lifecycle(page, 'tr', false); });
test('booking lifecycle, English, 375 px mobile', async ({ page }) => { test.setTimeout(240000); await lifecycle(page, 'en', true); });

test('creative library: pre-checks, upload, rejection, preview, approve/reject, new version, duplicate', async ({ page }) => {
  test.setTimeout(180000);
  await session(page, 'en');
  await page.goto('/admin/creatives');
  await expect(page.getByRole('heading', { level: 1, name: en['nav.campaigns.creatives'], exact: true })).toBeVisible();
  await page.getByRole('button', { name: en['creative.upload'], exact: true }).first().click();
  const form = page.getByRole('form', { name: en['creative.upload'] });
  const input = form.locator('input[type="file"]');
  const send = form.getByRole('button', { name: en['creative.upload'], exact: true });
  await form.locator('select[name="advertiserId"]').selectOption({ label: advertiser.name });

  // Client pre-checks never reach the API.
  let posted = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/creatives') posted++; });
  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not media') });
  await send.click();
  await expect(form.getByRole('alert')).toHaveText(en['creative.error.type']);
  await input.setInputFiles(sparse('too-large.mp4', 200 * 1024 * 1024 + 1));
  await send.click();
  await expect(form.getByRole('alert')).toHaveText(en['creative.error.size']);
  const image = media('png');
  await input.setInputFiles(image.file);
  await send.click();
  await expect(form.getByRole('alert')).toHaveText(en['creative.error.duration']);
  expect(posted).toBe(0);

  // PNG needs an explicit duration; the server stores it as manual, never a default.
  await form.getByLabel(en['creative.displayDuration'], { exact: true }).fill('7');
  const png = await submit<CreativeSummary>(page, '/creatives', send, 201);
  expect(png.status).toBe('VALIDATING'); expect(png.kind).toBe('IMAGE'); expect(png.durationManual).toBe(true); expect(Number(png.durationSeconds)).toBe(7);
  expect(png.width).toBe(320); expect(png.height).toBe(180);
  await expect(form.getByRole('status')).toContainText(png.code);

  // A real MPEG-4 (non-H.264) video is rejected by technical validation with a localized reason.
  const bad = media('mpeg4');
  await input.setInputFiles(bad.file);
  const rejected = await submit<CreativeSummary>(page, '/creatives', send, 201);
  expect(rejected.status).toBe('REJECTED'); expect(rejected.rejectionReason).toBe('VIDEO_CODEC_NOT_H264');
  await expect(form.getByRole('alert')).toContainText(en['creative.reason.VIDEO_CODEC_NOT_H264']);

  // A valid video, then the identical file again -> 409 DUPLICATE_CREATIVE with a localized message.
  const video = media('mp4');
  await input.setInputFiles(video.file);
  const mp4 = await submit<CreativeSummary>(page, '/creatives', send, 201);
  expect(mp4.status).toBe('VALIDATING'); expect(mp4.videoCodec).toBe('h264'); expect(Number(mp4.durationSeconds)).toBeGreaterThan(1);
  await input.setInputFiles(video.file);
  await submit(page, '/creatives', send, 409);
  await expect(form.getByRole('alert')).toHaveText(en['booking.error.duplicate']);

  // Filters (advertiser + status) are URL-driven.
  await page.goto('/admin/creatives');
  await page.locator('form[aria-label="'+en['creative.filters']+'"] select[name="advertiserId"]').selectOption({ label: advertiser.name });
  await page.locator('select[name="status"]').selectOption('VALIDATING');
  await page.getByRole('button', { name: en['inventory.filter'], exact: true }).click();
  await expect(page).toHaveURL(/status=VALIDATING/);
  await expect(page.getByRole('row').filter({ hasText: png.code })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: rejected.code })).toHaveCount(0);

  // Preview streams binary media through the web proxy with the right content type.
  await page.getByRole('button', { name: `${en['common.details']} ${png.code}` }).click();
  const img = page.locator('img.creative-preview');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(320);
  await page.getByRole('button', { name: `${en['common.details']} ${mp4.code}` }).click();
  await expect(page.locator('video.creative-preview')).toBeVisible();
  const file = await page.request.get(`/api/v1/creatives/${mp4.id}/file`);
  expect(file.status()).toBe(200); expect(file.headers()['content-type']).toBe('video/mp4');
  expect((await file.body()).length).toBe(readFileSync(video.file).length);

  // Approve the video, reject the image with a reason, then upload a new version of the approved one.
  await page.goto(`/admin/creatives?advertiserId=${advertiser.id}`); // statuses change below, so drop the VALIDATING filter
  await page.getByRole('button', { name: `${en['common.details']} ${mp4.code}` }).click();
  await submit(page, `/creatives/${mp4.id}/approve`, page.getByRole('button', { name: en['creative.approve'], exact: true }));
  await expect(page.getByRole('region', { name: `${en['creative.detail']} ${mp4.code}` }).getByText(en['creative.status.APPROVED']).first()).toBeVisible();
  await page.getByRole('button', { name: `${en['common.details']} ${png.code}` }).click();
  await page.getByRole('button', { name: en['creative.reject'], exact: true }).click();
  await page.getByRole('button', { name: en['creative.rejectConfirm'], exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: en['creative.error.reason'] })).toHaveText(en['creative.error.reason']);
  await page.getByLabel(en['creative.rejectReason'], { exact: true }).fill(`${run} wrong aspect`);
  const refused = await submit<CreativeSummary>(page, `/creatives/${png.id}/reject`, page.getByRole('button', { name: en['creative.rejectConfirm'], exact: true }));
  expect(refused.status).toBe('REJECTED'); expect(refused.rejectionReason).toBe(`${run} wrong aspect`);
  await page.getByRole('button', { name: `${en['common.details']} ${mp4.code}` }).click();
  await page.getByRole('button', { name: en['creative.newVersion'], exact: true }).click();
  const version = page.getByRole('form', { name: en['creative.newVersion'] });
  await version.locator('input[type="file"]').setInputFiles(media('mp4').file);
  const next = await submit<CreativeSummary>(page, '/creatives', version.getByRole('button', { name: en['creative.newVersion'], exact: true }), 201);
  expect(next.version).toBe(2); expect(next.replacesId).toBe(mp4.id);
});

test('upload API errors are mapped: storage and size limits stay honest (labeled intercepted responses)', async ({ page }) => {
  // INTERCEPTED FIXTURE: the real runtime has local storage configured, so a 503 STORAGE_UNAVAILABLE
  // response is injected here only to test the message mapping, not the storage driver.
  await session(page, 'en');
  await page.goto('/admin/creatives');
  await page.getByRole('button', { name: en['creative.upload'], exact: true }).first().click();
  await page.route('**/api/v1/creatives', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', json: { error: { code: 'STORAGE_UNAVAILABLE', message: 'x', details: {} } } }) : route.continue());
  const form = page.getByRole('form', { name: en['creative.upload'] });
  await form.locator('select[name="advertiserId"]').selectOption({ label: advertiser.name });
  await form.locator('input[type="file"]').setInputFiles(media('mp4').file);
  await submit(page, '/creatives', form.getByRole('button', { name: en['creative.upload'], exact: true }), 503);
  await expect(form.getByRole('alert')).toHaveText(en['booking.error.storage']);
});

test('list shows flight-ended bookings and operator-declaration labels', async ({ page }) => {
  test.setTimeout(180000);
  // Real API seeding: a booking whose flight ends moments after it goes LIVE.
  const ship = await venue(); const target = await screen(ship, 'ended');
  const now = Date.now();
  const create = await admin.post('/api/v1/campaigns', { data: {
    name: `${run} ended flight`, advertiserId: advertiser.id, internalOwnerId: ownerId, timezone: 'Europe/Istanbul',
    startAt: new Date(now - 3600_000).toISOString(), endAt: new Date(now + 25_000).toISOString() } });
  expect(create.status()).toBe(201);
  const campaign = await create.json() as CampaignDetail;
  expect((await admin.post(`/api/v1/campaigns/${campaign.id}/screens`, { data: { screenIds: [target.id] } })).status()).toBe(200);
  const file = media('mp4');
  const upload = await admin.post('/api/v1/creatives', { multipart: { advertiserId: advertiser.id, file: { name: file.name, mimeType: 'video/mp4', buffer: readFileSync(file.file) } } });
  expect(upload.status()).toBe(201);
  const creative = await upload.json() as CreativeSummary;
  expect((await admin.post(`/api/v1/creatives/${creative.id}/approve`, { data: {} })).status()).toBe(200);
  expect((await admin.post(`/api/v1/campaigns/${campaign.id}/creatives`, { data: { creativeId: creative.id } })).status()).toBe(200);
  const slots = [1, 2, 3, 4, 5, 6, 7].map(dayOfWeek => ({ dayOfWeek, startTime: '00:00', endTime: '23:59' }));
  expect((await admin.post(`/api/v1/campaigns/${campaign.id}/schedule`, { data: { slots } })).status()).toBe(200);
  expect((await admin.patch(`/api/v1/campaigns/${campaign.id}`, { data: { primaryGoal: 'PLAYOUTS', targetPlayouts: '100' } })).status()).toBe(200);
  expect((await admin.post(`/api/v1/campaigns/${campaign.id}/transitions`, { data: { to: 'READY' } })).status()).toBe(200);
  expect((await admin.post(`/api/v1/campaigns/${campaign.id}/cms-operations`, { data: { screenId: target.id, type: 'CMS_UPLOADED', performedAt: new Date().toISOString() } })).status()).toBe(201);
  expect((await admin.post(`/api/v1/campaigns/${campaign.id}/transitions`, { data: { to: 'LIVE' } })).status()).toBe(200);

  await session(page, 'tr');
  await page.goto(`/admin/campaigns?search=${encodeURIComponent(run + ' ended')}`);
  const row = page.getByRole('row').filter({ hasText: campaign.code });
  await expect(row).toBeVisible();
  await expect(row.getByText(tr['booking.operatorDeclaration'])).toBeVisible();
  await expect.poll(async () => { await page.reload(); return row.getByText(tr['booking.flightEnded']).count(); }, { timeout: 60000, intervals: [3000] }).toBe(1);
  // Status filter narrows the list; unknown filter values are ignored by the server page.
  await page.goto(`/admin/campaigns?status=LIVE&advertiserId=${advertiser.id}`);
  await expect(page.getByRole('row').filter({ hasText: campaign.code })).toBeVisible();
  await page.goto(`/admin/campaigns?status=CANCELLED&advertiserId=${advertiser.id}`);
  await expect(page.getByText(tr['booking.empty'])).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/admin/campaigns'); await overflow(page);
  await page.goto('/admin/creatives'); await overflow(page);
  await page.goto('/admin/campaigns/new'); await overflow(page);
});

test('non-admin roles cannot see campaign navigation or data', async ({ page, playwright }) => {
  const logins = [['agency-a@example.test', /\/portal$/], ['advertiser@example.test', /\/portal$/], ['support@example.test', /\/support$/]] as const;
  for (const [email, home] of logins) {
    const context = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
    try {
      expect((await context.post('/api/v1/auth/login', { data: { email, password: tenantPassword } })).status()).toBe(200);
      for (const path of ['/campaigns', '/creatives']) expect((await context.get(`/api/v1${path}`)).status()).toBe(403);
      expect((await context.get(`/api/v1/campaigns/${randomUUID()}`)).status()).toBe(403);
      expect((await context.get(`/api/v1/creatives/${randomUUID()}/file`)).status()).toBe(403);
      expect((await context.post('/api/v1/campaigns', { data: { name: `${run} forbidden` } })).status()).toBe(403);
      await page.context().clearCookies();
      await page.context().addCookies((await context.storageState()).cookies);
      await page.context().addCookies([{ name: 'protarget_locale', value: 'tr', url: baseURL }]);
      for (const path of ['/admin/campaigns', '/admin/campaigns/new', '/admin/creatives']) {
        await page.goto(path);
        await expect(page).toHaveURL(home);
      }
      await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
      await expect(page.getByText(run)).toHaveCount(0);
    } finally { await context.dispose(); }
  }
  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    expect((await anonymous.get('/api/v1/campaigns')).status()).toBe(401);
    expect((await anonymous.get('/api/v1/creatives')).status()).toBe(401);
  } finally { await anonymous.dispose(); }
  await page.context().clearCookies();
  await page.goto('/admin/campaigns');
  await expect(page).toHaveURL(/\/login$/);
});

/** Real-API fixture: a READY booking (approved MP4, daily dayparts, goal) with `screens` screens. `seconds` stores the end with seconds. */
async function seedReady(label: string, options: { screens?: number; seconds?: boolean; status?: 'DRAFT' | 'READY' } = {}) {
  const ship = await venue();
  const targets: InventoryScreen[] = [];
  for (let index = 0; index < (options.screens ?? 1); index++) targets.push(await screen(ship, `${label}${index}`));
  const now = Date.now();
  const create = await admin.post('/api/v1/campaigns', { data: {
    name: `${run} ${label}`, advertiserId: advertiser.id, internalOwnerId: ownerId, timezone: 'Europe/Istanbul',
    startAt: new Date(now - 3600_000).toISOString(),
    endAt: new Date(now + 7 * 86400_000 + (options.seconds ? 37_000 : 0)).toISOString() } });
  expect(create.status()).toBe(201);
  const campaign = await create.json() as CampaignDetail; drafts.add(campaign.id);
  expect((await admin.post(`/api/v1/campaigns/${campaign.id}/screens`, { data: { screenIds: targets.map(item => item.id) } })).status()).toBe(200);
  const file = media('mp4');
  const upload = await admin.post('/api/v1/creatives', { multipart: { advertiserId: advertiser.id, file: { name: file.name, mimeType: 'video/mp4', buffer: readFileSync(file.file) } } });
  expect(upload.status()).toBe(201);
  const creative = await upload.json() as CreativeSummary;
  expect((await admin.post(`/api/v1/creatives/${creative.id}/approve`, { data: {} })).status()).toBe(200);
  expect((await admin.post(`/api/v1/campaigns/${campaign.id}/creatives`, { data: { creativeId: creative.id } })).status()).toBe(200);
  const slots = [1, 2, 3, 4, 5, 6, 7].map(dayOfWeek => ({ dayOfWeek, startTime: '00:00', endTime: '23:59' }));
  expect((await admin.post(`/api/v1/campaigns/${campaign.id}/schedule`, { data: { slots } })).status()).toBe(200);
  expect((await admin.patch(`/api/v1/campaigns/${campaign.id}`, { data: { primaryGoal: 'PLAYOUTS', targetPlayouts: '100', pricingModel: 'CPM', unitPrice: '12.5' } })).status()).toBe(200);
  if (options.status !== 'DRAFT') expect((await admin.post(`/api/v1/campaigns/${campaign.id}/transitions`, { data: { to: 'READY' } })).status()).toBe(200);
  return { campaign, creative, targets };
}
const detailOf = async (id: string) => await (await admin.get(`/api/v1/campaigns/${id}`)).json() as CampaignDetail;
async function cms(campaignId: string, screenId: string, type: string, performedAt = new Date().toISOString()) {
  const response = await admin.post(`/api/v1/campaigns/${campaignId}/cms-operations`, { data: { screenId, type, performedAt } });
  expect(response.status()).toBe(201);
}
async function transition(campaignId: string, to: string, reason?: string) {
  const response = await admin.post(`/api/v1/campaigns/${campaignId}/transitions`, { data: reason ? { to, reason } : { to } });
  expect(response.status()).toBe(200);
}

test('revoke: approved creative -> REVOKED from the library and the wizard; READY bookings return to DRAFT; LIVE keeps status and can unlink', async ({ page }) => {
  test.setTimeout(240000);
  await session(page, 'en');
  // Library: reason dialog, then the badge and the server agree.
  const viaLibrary = await seedReady('revoke-lib');
  await page.goto(`/admin/creatives?advertiserId=${advertiser.id}`);
  await page.getByRole('button', { name: `${en['common.details']} ${viaLibrary.creative.code}` }).click();
  await page.getByRole('button', { name: `${en['creative.revoke']} ${viaLibrary.creative.code}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: en['creative.revokeTitle'] });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: en['creative.revokeConfirm'], exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(en['creative.error.revokeReason']);
  await dialog.getByLabel(en['creative.revokeReason'], { exact: true }).fill(`${run} wrong brand`);
  const revoked = await submit<CreativeSummary>(page, `/creatives/${viaLibrary.creative.id}/revoke`, dialog.getByRole('button', { name: en['creative.revokeConfirm'], exact: true }));
  expect(revoked.status).toBe('REVOKED'); expect(revoked.revocationReason).toBe(`${run} wrong brand`);
  const region = page.getByRole('region', { name: `${en['creative.detail']} ${viaLibrary.creative.code}` });
  await expect(region.getByText(en['creative.status.REVOKED']).first()).toBeVisible();
  await expect(region.getByText(`${run} wrong brand`)).toBeVisible();
  await expect(page.getByRole('button', { name: `${en['creative.revoke']} ${viaLibrary.creative.code}` })).toHaveCount(0);
  expect((await detailOf(viaLibrary.campaign.id)).status).toBe('DRAFT'); // READY -> DRAFT, automatically
  await overflow(page);

  // Wizard: revoke from the creatives step; the header reloads the booking (READY -> DRAFT).
  const viaWizard = await seedReady('revoke-wiz');
  await page.goto(`/admin/campaigns/${viaWizard.campaign.id}/edit`);
  await expect(page.locator('.wizard .section-heading .badge').first()).toHaveText(en['booking.status.READY']);
  await page.getByRole('list', { name: en['booking.steps'] }).getByRole('button', { name: new RegExp(en['booking.step.creatives']) }).click();
  const row = page.locator(`tr[data-creative="${viaWizard.creative.code}"]`);
  await row.getByRole('button', { name: `${en['creative.revoke']} ${viaWizard.creative.code}`, exact: true }).click();
  const wizardDialog = page.getByRole('dialog', { name: en['creative.revokeTitle'] });
  await wizardDialog.getByLabel(en['creative.revokeReason'], { exact: true }).fill(`${run} contract ended`);
  await submit(page, `/creatives/${viaWizard.creative.id}/revoke`, wizardDialog.getByRole('button', { name: en['creative.revokeConfirm'], exact: true }));
  await expect(row.locator('.badge.creative-revoked')).toBeVisible();
  await expect(row.getByText(en['creative.revokedNotice'])).toBeVisible();
  await expect(page.locator('.wizard .section-heading .badge').first()).toHaveText(en['booking.status.DRAFT']);
  await expect(row.getByRole('button', { name: `${en['booking.unlink']} ${viaWizard.creative.code}` })).toBeVisible();
  await overflow(page);

  // LIVE booking: status stays (a declaration), a warning appears, and only the revoked creative may be unlinked.
  const live = await seedReady('revoke-live');
  await cms(live.campaign.id, live.targets[0].id, 'CMS_UPLOADED');
  await transition(live.campaign.id, 'LIVE');
  expect((await admin.post(`/api/v1/creatives/${live.creative.id}/revoke`, { data: { reason: `${run} api revoke` } })).status()).toBe(200);
  expect((await detailOf(live.campaign.id)).status).toBe('LIVE');
  await page.goto(`/admin/campaigns/${live.campaign.id}`);
  await expect(page.locator('[data-testid="validation"] [data-code="REVOKED_CREATIVE"]')).toBeVisible();
  await page.getByRole('tab', { name: en['booking.tab.creatives'], exact: true }).click();
  await expect(page.getByText(en['creative.revokedNotice'])).toBeVisible();
  await submit(page, `/campaigns/${live.campaign.id}/creatives/remove`, page.getByRole('button', { name: `${en['booking.unlink']} ${live.creative.code}` }));
  await expect(page.locator(`[data-creative="${live.creative.code}"]`)).toHaveCount(0);
  expect((await detailOf(live.campaign.id)).creatives).toHaveLength(0);
});

test('stale CMS upload after a plan change disables LIVE and shows the stale notice until a new record is entered', async ({ page }) => {
  test.setTimeout(180000);
  await session(page, 'tr');
  const seeded = await seedReady('stale');
  await cms(seeded.campaign.id, seeded.targets[0].id, 'CMS_UPLOADED');
  expect((await detailOf(seeded.campaign.id)).screens[0].cmsUploaded).toBe(true);
  // A real plan change (READY -> DRAFT), then READY again: the earlier upload record no longer counts.
  expect((await admin.patch(`/api/v1/campaigns/${seeded.campaign.id}`, { data: { targetPlayouts: '250' } })).status()).toBe(200);
  await transition(seeded.campaign.id, 'READY');
  const stale = await detailOf(seeded.campaign.id);
  expect(stale.screens[0].cmsUploaded).toBe(false); expect(stale.screens[0].cmsUploadStale).toBe(true);
  await page.goto(`/admin/campaigns/${seeded.campaign.id}`);
  const live = page.getByRole('button', { name: tr['booking.action.LIVE'], exact: true });
  await expect(live).toBeDisabled();
  await page.getByRole('tab', { name: tr['booking.tab.cms'], exact: true }).click();
  await expect(page.getByTestId('cms-stale')).toContainText(tr['booking.cmsStaleHint']);
  await expect(page.locator(`tr[data-screen="${seeded.targets[0].screenId}"]`).first().getByText(tr['booking.cmsStale'])).toBeVisible();
  await overflow(page);
  await page.getByRole('tab', { name: tr['booking.tab.screens'], exact: true }).click();
  await expect(page.locator(`tr[data-screen="${seeded.targets[0].screenId}"]`).getByText(tr['booking.cmsStale'])).toBeVisible();
  // A fresh record clears the notice and enables LIVE.
  await page.getByRole('tab', { name: tr['booking.tab.cms'], exact: true }).click();
  const form = page.getByRole('form', { name: tr['booking.cmsRecord'] });
  await form.locator('select[name="screenId"]').selectOption({ label: `${seeded.targets[0].screenId} · ${seeded.targets[0].name}` });
  await submit(page, `/campaigns/${seeded.campaign.id}/cms-operations`, form.getByRole('button', { name: tr['booking.cmsSubmit'], exact: true }), 201);
  await expect(page.getByTestId('cms-stale')).toHaveCount(0);
  await expect(live).toBeEnabled();
  expect((await detailOf(seeded.campaign.id)).screens[0].cmsUploaded).toBe(true);
});

test('CMS form: drafts accept only notes; NOTE needs text; server status/time errors map to specific messages', async ({ page }) => {
  test.setTimeout(180000);
  await session(page, 'en');
  const draft = await seedReady('cms-draft', { status: 'DRAFT' });
  await page.goto(`/admin/campaigns/${draft.campaign.id}`);
  await page.getByRole('tab', { name: en['booking.tab.cms'], exact: true }).click();
  const form = page.getByRole('form', { name: en['booking.cmsRecord'] });
  await expect(form.locator('select[name="type"] option')).toHaveCount(1);
  await expect(form.getByText(en['booking.cmsDraftHint'])).toBeVisible();
  await form.locator('select[name="screenId"]').selectOption({ label: `${draft.targets[0].screenId} · ${draft.targets[0].name}` });
  await form.locator('textarea[name="note"]').evaluate((node: HTMLTextAreaElement) => { node.required = false; });
  await form.getByRole('button', { name: en['booking.cmsSubmit'], exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText(en['booking.error.noteRequired']);
  // The default time is the current minute (never in the future) and records fine.
  await form.getByLabel(en['booking.cmsNote'], { exact: true }).fill(`${run} draft note`);
  await submit(page, `/campaigns/${draft.campaign.id}/cms-operations`, form.getByRole('button', { name: en['booking.cmsSubmit'], exact: true }), 201);
  // API truth for the wrong-status case (COMPLETED/CANCELLED -> 409): the mapped message, not a generic one.
  const gone = await seedReady('cms-cancel', { status: 'DRAFT' });
  expect((await admin.post(`/api/v1/campaigns/${gone.campaign.id}/transitions`, { data: { to: 'CANCELLED', reason: 'x' } })).status()).toBe(200);
  const refused = await admin.post(`/api/v1/campaigns/${gone.campaign.id}/cms-operations`, { data: { screenId: gone.targets[0].id, type: 'NOTE', note: 'n', performedAt: new Date().toISOString() } });
  expect(refused.status()).toBe(409);
});

test('pause dialog lists screens without a PLAYBACK_PAUSED record; limited edit sends only the changed field', async ({ page }) => {
  test.setTimeout(180000);
  await session(page, 'en');
  const seeded = await seedReady('pause', { screens: 2, seconds: true });
  const [first, second] = seeded.targets;
  for (const target of seeded.targets) await cms(seeded.campaign.id, target.id, 'CMS_UPLOADED');
  await transition(seeded.campaign.id, 'LIVE');
  await cms(seeded.campaign.id, first.id, 'PLAYBACK_PAUSED');
  await page.goto(`/admin/campaigns/${seeded.campaign.id}`);
  // P14: an end time stored with seconds must not be sent when only the notes change.
  const notes = page.getByLabel(en['inventory.notes'], { exact: true });
  await notes.fill(`${run} notes only`);
  const [request] = await Promise.all([
    page.waitForRequest(item => new URL(item.url()).pathname === `/api/v1/campaigns/${seeded.campaign.id}` && item.method() === 'PATCH'),
    page.getByRole('button', { name: en['common.save'], exact: true }).click(),
  ]);
  expect(Object.keys(request.postDataJSON())).toEqual(['notes']);
  await expect(page.getByRole('status').filter({ hasText: en['common.saved'] })).toBeVisible();
  expect((await detailOf(seeded.campaign.id)).status).toBe('LIVE');
  // P11: the dialog warns about the screen that still has no PLAYBACK_PAUSED record, and only that one.
  await page.getByRole('button', { name: en['booking.action.PAUSED'], exact: true }).click();
  const dialog = page.getByRole('dialog', { name: en['booking.reasonTitle'] });
  const warning = dialog.getByTestId('declaration-warning');
  await expect(warning).toContainText(en['booking.pauseWarning']);
  await expect(warning.locator(`li[data-screen="${second.screenId}"]`)).toBeVisible();
  await expect(warning.locator(`li[data-screen="${first.screenId}"]`)).toHaveCount(0);
  await overflow(page);
  await dialog.getByLabel(en['booking.reason'], { exact: true }).fill(`${run} pause`);
  const paused = await submit<CampaignDetail>(page, `/campaigns/${seeded.campaign.id}/transitions`, dialog.getByRole('button', { name: en['booking.action.PAUSED'], exact: true }));
  expect(paused.status).toBe('PAUSED');
  // A second booking whose screens are all paused shows no warning.
  const quiet = await seedReady('pause-quiet');
  await cms(quiet.campaign.id, quiet.targets[0].id, 'CMS_UPLOADED');
  await transition(quiet.campaign.id, 'LIVE');
  await cms(quiet.campaign.id, quiet.targets[0].id, 'PLAYBACK_PAUSED');
  await page.goto(`/admin/campaigns/${quiet.campaign.id}`);
  await page.getByRole('button', { name: en['booking.action.PAUSED'], exact: true }).click();
  await expect(page.getByRole('dialog', { name: en['booking.reasonTitle'] })).toBeVisible();
  await expect(page.getByTestId('declaration-warning')).toHaveCount(0);
});

test('no-op saves keep READY: wizard basics and commercial send nothing; archive and 409s are handled', async ({ page }) => {
  test.setTimeout(180000);
  await session(page, 'en');
  const seeded = await seedReady('noop', { seconds: true });
  const before = await detailOf(seeded.campaign.id);
  const patches: string[] = [];
  page.on('request', request => { if (request.method() === 'PATCH' && new URL(request.url()).pathname === `/api/v1/campaigns/${seeded.campaign.id}`) patches.push(request.postData() ?? ''); });
  await page.goto(`/admin/campaigns/${seeded.campaign.id}/edit`);
  await expect(page.getByRole('heading', { level: 2, name: en['booking.step.basic'], exact: true })).toBeVisible();
  await page.getByRole('button', { name: en['booking.saveNext'], exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: en['booking.step.screens'], exact: true })).toBeVisible();
  await page.getByRole('button', { name: en['booking.next'], exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: en['booking.step.commercial'], exact: true })).toBeVisible();
  await page.getByRole('button', { name: en['booking.saveNext'], exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: en['booking.step.creatives'], exact: true })).toBeVisible();
  expect(patches).toEqual([]); // nothing sent: stored seconds and "12.5000" vs "12.5" are not changes
  const after = await detailOf(seeded.campaign.id);
  expect(after.status).toBe('READY'); expect(after.planChangedAt).toBe(before.planChangedAt); expect(after.updatedAt).toBe(before.updatedAt);
  // Archive asks first; cancelling changes nothing.
  const draft = await seedReady('archive', { status: 'DRAFT' });
  await page.goto(`/admin/campaigns/${draft.campaign.id}`);
  await page.getByRole('button', { name: en['booking.archive'], exact: true }).click();
  const confirm = page.getByRole('dialog', { name: en['booking.archiveTitle'] });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: en['common.cancel'], exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect((await detailOf(draft.campaign.id)).status).toBe('DRAFT');
  await page.getByRole('button', { name: en['booking.archive'], exact: true }).click();
  const [archived] = await Promise.all([
    page.waitForResponse(item => new URL(item.url()).pathname === `/api/v1/campaigns/${draft.campaign.id}/archive`),
    page.getByRole('dialog', { name: en['booking.archiveTitle'] }).getByRole('button', { name: en['booking.archive'], exact: true }).click(),
  ]);
  expect(archived.status()).toBe(204);
  await expect(page).toHaveURL(/\/admin\/campaigns$/);
  drafts.delete(draft.campaign.id);
  // 409 on a transition reloads the real state: the booking moved to DRAFT elsewhere, the page follows.
  const other = await seedReady('conflict', { status: 'READY' });
  await page.goto(`/admin/campaigns/${other.campaign.id}`);
  await expect(page.locator('.status-card .badge').first()).toHaveText(en['booking.status.READY']);
  await transition(other.campaign.id, 'DRAFT');
  await page.getByRole('button', { name: en['booking.action.DRAFT'], exact: true }).click();
  await expect(page.getByRole('alert').first()).toHaveText(en['booking.error.conflict']);
  await expect(page.locator('.status-card .badge').first()).toHaveText(en['booking.status.DRAFT']);
});

test('commercial step accepts a decimal comma, confirms removing the pricing model and nulls only what was set', async ({ page }) => {
  test.setTimeout(180000);
  await session(page, 'tr');
  const draft = await seedReady('comma', { status: 'DRAFT' });
  await page.goto(`/admin/campaigns/${draft.campaign.id}/edit`);
  const steps = page.getByRole('list', { name: tr['booking.steps'] });
  await steps.getByRole('button', { name: new RegExp(tr['booking.step.commercial']) }).click();
  await page.getByLabel(tr['booking.unitPrice'], { exact: true }).fill('125,50');
  await page.getByLabel(tr['booking.budget'], { exact: true }).fill('1000,5');
  const [request, response] = await Promise.all([
    page.waitForRequest(item => item.method() === 'PATCH' && new URL(item.url()).pathname === `/api/v1/campaigns/${draft.campaign.id}`),
    page.waitForResponse(item => item.request().method() === 'PATCH' && new URL(item.url()).pathname === `/api/v1/campaigns/${draft.campaign.id}`),
    page.getByRole('button', { name: tr['booking.saveNext'], exact: true }).click(),
  ]);
  expect(request.postDataJSON()).toEqual({ unitPrice: '125.50', budget: '1000.5' });
  expect(response.status()).toBe(200);
  const saved = await response.json() as CampaignDetail;
  expect(Number(saved.commercial.unitPrice)).toBe(125.5); expect(Number(saved.commercial.budget)).toBe(1000.5);
  // Removing the model asks first. Cancel keeps it; confirm clears only the fields that were set.
  await steps.getByRole('button', { name: new RegExp(tr['booking.step.commercial']) }).click();
  await page.locator('select[name="pricingModel"]').selectOption('');
  const dialog = page.getByRole('dialog', { name: tr['booking.pricingNoneTitle'] });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: tr['common.cancel'], exact: true }).click();
  await expect(page.locator('select[name="pricingModel"]')).toHaveValue('CPM');
  await page.locator('select[name="pricingModel"]').selectOption('');
  await page.getByRole('dialog', { name: tr['booking.pricingNoneTitle'] }).getByRole('button', { name: tr['booking.pricingNoneConfirm'], exact: true }).click();
  await expect(page.locator('select[name="pricingModel"]')).toHaveValue('');
  await expect(page.getByLabel(tr['booking.currency'], { exact: true })).toHaveCount(0); // G3: defaults hidden without a model
  const [cleared] = await Promise.all([
    page.waitForRequest(item => item.method() === 'PATCH' && new URL(item.url()).pathname === `/api/v1/campaigns/${draft.campaign.id}`),
    page.getByRole('button', { name: tr['booking.saveNext'], exact: true }).click(),
  ]);
  const body = cleared.postDataJSON() as Record<string, unknown>;
  expect(body.pricingModel).toBeNull(); expect(body.unitPrice).toBeNull(); expect(body.budget).toBeNull();
  expect(Object.keys(body).sort()).toEqual(['budget', 'pricingModel', 'unitPrice']);
});
