import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { InventoryVenue, InventoryScreen, InventoryMultiplier, InventoryMultiplierHistory, PageResult } from '@protarget/shared';
import tr from '../../../packages/i18n/src/tr.json';
import en from '../../../packages/i18n/src/en.json';

const baseURL = process.env.PLAYWRIGHT_BASE_URL!;
const run = `INV-E2E-${randomUUID().slice(0, 8).toUpperCase()}`;
const root = '/admin/inventory';
let admin: APIRequestContext;
let authenticated = false;
let sequence = 0;
const ownedVenues = new Set<string>();
const ownedScreens = new Set<string>();
test.use({ timezoneId: 'Europe/Istanbul' });

async function listAll<T>(path: string, context = admin): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const response = await context.get(`/api/v1/${path}?page=${page}&pageSize=100`);
    expect(response.status()).toBe(200);
    const result = await response.json() as PageResult<T>;
    items.push(...result.items);
    if (page * result.pageSize >= result.total) return items;
  }
}
async function venue(overrides: Partial<InventoryVenue> = {}) {
  const response = await admin.post('/api/v1/venues', { data: {
    name: `${run} venue ${++sequence}`, country: 'Türkiye', city: 'İstanbul',
    timezone: 'Europe/Istanbul', ...overrides,
  } });
  expect(response.status()).toBe(201);
  const result = await response.json() as InventoryVenue; ownedVenues.add(result.id); return result;
}
async function screen(parent: InventoryVenue, overrides: Partial<InventoryScreen> = {}) {
  const response = await admin.post('/api/v1/screens', { data: {
    screenId: `${run}-${++sequence}`, name: `${run} screen ${sequence}`, venueId: parent.id,
    timezone: 'Europe/Istanbul', ...overrides,
  } });
  expect(response.status()).toBe(201);
  const result = await response.json() as InventoryScreen; ownedScreens.add(result.id); return result;
}
async function session(page: Page, language: 'tr' | 'en' = 'tr') {
  await page.context().addCookies((await admin.storageState()).cookies);
  await page.context().addCookies([{ name: 'protarget_locale', value: language, url: baseURL }]);
}
async function locale(page: Page, from: 'tr' | 'en') {
  await page.getByRole('button', { name: (from === 'tr' ? tr : en)['common.language'], exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', from === 'tr' ? 'en' : 'tr');
}
async function submit<T>(page: Page, path: string, button: Locator, method = 'POST'): Promise<T> {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === method),
    button.click(),
  ]);
  expect(response.status()).toBe(method === 'POST' && !path.endsWith('/approve') ? 201 : 200);
  return response.json() as Promise<T>;
}
async function draft(page: Page, id: string, value: string, suffix: string) {
  const form = page.locator('form').filter({ has: page.locator('input[name="value"]') });
  await form.getByLabel(en['multiplier.value'], { exact: true }).fill(value);
  await form.getByLabel(en['multiplier.sourceRef'], { exact: true }).fill(`${run} source ${suffix}`);
  await form.getByRole('textbox', { name: en['multiplier.reason'], exact: true }).fill(`${run} reason ${suffix}`);
  return submit<InventoryMultiplier>(page, `/screens/${id}/multipliers`, form.getByRole('button', { name: en['multiplier.create'], exact: true }));
}
async function history(id: string) {
  const response = await admin.get(`/api/v1/screens/${id}/multipliers`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<InventoryMultiplierHistory>;
}
/** Honest presentation fixture: the database record remains valid. Real PATCH requests
 * still reach the API; only successful browser responses overlay pre-upgrade values.
 * This tests rendering/dirty PATCH behavior, not migration or backend legacy validation.
 */
async function legacyPresentation(page: Page, display: InventoryScreen, fields: Partial<InventoryScreen>) {
  const overrides = { ...fields };
  const patches: Record<string, unknown>[] = [];
  await page.route(`**/api/v1/screens/${display.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const patch = route.request().postDataJSON() as Record<string, unknown>;
    patches.push(patch);
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    // Explicit repairs stop overriding those fields; untouched legacy data remains.
    for (const key of Object.keys(patch)) delete overrides[key as keyof InventoryScreen];
    await route.fulfill({ response, json: { ...await response.json(), ...overrides } });
  });
  await session(page, 'en');
  await page.goto(`${root}/screens/${display.id}`);
  await page.getByRole('textbox', { name: en['inventory.notes'], exact: true }).fill(`${run} legacy presentation fixture`);
  await submit(page, `/screens/${display.id}`, page.getByRole('button', { name: en['common.save'], exact: true }), 'PATCH');
  await expect(page.getByRole('status')).toHaveText(en['common.saved']);
  patches.length = 0;
  return patches;
}
async function openHardware(page: Page) {
  const section = page.locator('.hardware-section');
  if (await section.getAttribute('open') === null) await section.locator('summary').click();
}
async function futureLocal(page: Page) {
  return page.evaluate(() => {
    const date = new Date(Date.now() + 86400000);
    const pad = (value: number) => String(value).padStart(2, '0');
    const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return { local, utc: new Date(local).toISOString() };
  });
}

test.beforeAll(async ({ playwright }) => {
  // The suite refuses remote targets and never reads or prints credentials.
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) {
    throw new Error('Inventory E2E requires an explicitly configured loopback runtime');
  }
  admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const response = await admin.post('/api/v1/auth/login', {
    data: { email: 'admin@example.test', password: process.env.SEED_ADMIN_PASSWORD },
  });
  expect(response.status()).toBe(200);
  authenticated = true;
});
test.afterAll(async () => {
  if (!admin) return;
  try {
    if (!authenticated) return;
    // Recover committed IDs even when a browser response/assertion failed. Only this run's
    // prefix is touched. Soft deactivation preserves the auditable history by design.
    for (const row of await listAll<InventoryScreen>('screens')) {
      if (row.screenId.startsWith(run)) ownedScreens.add(row.id);
    }
    for (const row of await listAll<InventoryVenue>('venues')) {
      if (row.name.startsWith(run)) ownedVenues.add(row.id);
    }
    for (const id of ownedScreens) {
      const result = await admin.patch(`/api/v1/screens/${id}`, { data: { active: false } });
      expect(result.status()).toBe(200);
      expect((await result.json()).active).toBe(false);
    }
    for (const id of ownedVenues) {
      const result = await admin.patch(`/api/v1/venues/${id}`, { data: { active: false } });
      expect(result.status()).toBe(200);
      expect((await result.json()).active).toBe(false);
    }
  } finally {
    await admin.post('/api/v1/auth/logout', { data: {} });
    await admin.dispose();
  }
});

test('TR/EN ship and screen CRUD, nullable hardware, changed-field patches, mobile and domain conflicts', async ({ page }) => {
  await session(page);
  await page.goto(`${root}/venues`);
  const name = `${run} browser ferry`;
  await page.getByLabel(tr['field.name'], { exact: true }).fill(name);
  await page.getByLabel(tr['inventory.country'], { exact: true }).fill('Türkiye');
  await page.getByLabel(tr['inventory.city'], { exact: true }).fill('İstanbul');
  await page.getByRole('textbox', { name: tr['inventory.notes'], exact: true }).fill('Ship notes');
  await locale(page, 'tr');
  await expect(page.getByLabel(en['field.name'], { exact: true })).toHaveValue(name);
  const created = await submit<InventoryVenue>(page, '/venues', page.getByRole('button', { name: en['common.save'], exact: true }));
  ownedVenues.add(created.id);
  expect(created.type).toBe('ferry');
  await expect(page).toHaveURL(`${baseURL}${root}/venues/${created.id}`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const patches: unknown[] = [];
  page.on('request', request => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === `/api/v1/venues/${created.id}`) patches.push(request.postDataJSON());
  });
  await page.getByRole('button', { name: en['common.save'], exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(en['inventory.noChanges']);
  expect(patches).toEqual([]);
  await page.getByRole('textbox', { name: en['inventory.notes'], exact: true }).fill('');
  const updated = await submit<InventoryVenue>(page, `/venues/${created.id}`, page.getByRole('button', { name: en['common.save'], exact: true }), 'PATCH');
  expect(updated.notes).toBeNull(); expect(patches).toEqual([{ notes: null }]);

  await page.goto(`${root}/screens?venueId=${created.id}`);
  const code = `${run}-BROWSER`;
  await page.getByLabel(en['inventory.screenCode'], { exact: true }).fill(code.toLowerCase());
  await page.getByLabel(en['field.name'], { exact: true }).fill(`${run} saloon screen`);
  await expect(page.locator('#screen-venue')).toHaveValue(created.id);
  const display = await submit<InventoryScreen>(page, '/screens', page.getByRole('button', { name: en['common.save'], exact: true }));
  ownedScreens.add(display.id);
  expect(display.screenId).toBe(code);
  expect(display.id).not.toBe(code);
  for (const field of ['resolutionWidth', 'resolutionHeight', 'orientation', 'os', 'cmsName', 'loopLengthSec', 'defaultSlotLengthSec', 'operatingStart', 'operatingEnd'] as const) {
    expect(display[field]).toBeNull();
  }
  expect(display.connectionStatus).toBe('NOT_CONNECTED');
  await expect(page).toHaveURL(`${baseURL}${root}/screens/${display.id}`);
  await expect(page.getByText(en['inventory.notConnected'], { exact: true })).toBeVisible();
  await page.getByText(en['inventory.hardware'], { exact: true }).click();
  await expect(page.getByLabel(en['inventory.width'], { exact: true })).toHaveValue('');
  await expect(page.getByLabel(en['inventory.width'], { exact: true })).toHaveAttribute('placeholder', en['inventory.unknown']);
  await page.getByLabel(en['inventory.cmsName'], { exact: true }).fill('Unsaved CMS metadata');
  await page.getByLabel(en['inventory.width'], { exact: true }).fill('1920');
  await page.getByLabel(en['inventory.height'], { exact: true }).fill('1080');
  await page.getByLabel(en['inventory.loop'], { exact: true }).fill('60');
  await page.getByLabel(en['inventory.slot'], { exact: true }).fill('90');
  await page.getByRole('button', { name: en['common.save'], exact: true }).click();
  await expect(page.locator('.inventory [role="alert"]')).toHaveText(en['inventory.error.hardware']);
  await page.getByLabel(en['inventory.slot'], { exact: true }).fill('10');
  await page.getByLabel(en['inventory.operatingStart'], { exact: true }).fill('22:00');
  await page.getByRole('button', { name: en['common.save'], exact: true }).click();
  await expect(page.locator('.inventory [role="alert"]')).toHaveText(en['inventory.error.hours']);
  await page.getByLabel(en['inventory.operatingEnd'], { exact: true }).fill('06:00');
  await page.setViewportSize({ width: 375, height: 812 });
  await locale(page, 'en');
  await expect(page.getByLabel(tr['inventory.cmsName'], { exact: true })).toHaveValue('Unsaved CMS metadata');
  await expect(page.getByLabel(tr['inventory.operatingEnd'], { exact: true })).toHaveValue('06:00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const [screenPatch] = await Promise.all([
    page.waitForRequest(request => request.method() === 'PATCH' && new URL(request.url()).pathname === `/api/v1/screens/${display.id}`),
    submit<InventoryScreen>(page, `/screens/${display.id}`, page.getByRole('button', { name: tr['common.save'], exact: true }), 'PATCH'),
  ]);
  expect(screenPatch.postDataJSON()).toEqual({
    cmsName: 'Unsaved CMS metadata', resolutionWidth: 1920, resolutionHeight: 1080,
    loopLengthSec: 60, defaultSlotLengthSec: 10, operatingStart: '22:00', operatingEnd: '06:00',
  });
  await page.reload();
  await page.getByText(tr['inventory.hardware'], { exact: true }).click();
  await expect(page.getByLabel(tr['inventory.cmsName'], { exact: true })).toHaveValue('Unsaved CMS metadata');

  await page.goto(`${root}/screens?venueId=${created.id}`);
  await page.getByLabel(tr['inventory.screenCode'], { exact: true }).fill(code);
  await page.getByLabel(tr['field.name'], { exact: true }).fill(`${run} duplicate`);
  await page.getByRole('button', { name: tr['common.save'], exact: true }).click();
  await expect(page.locator('.inventory [role="alert"]')).toHaveText(tr['inventory.error.screenConflict']);
  await page.goto(`${root}/venues/${created.id}`);
  await page.getByLabel(tr['common.active'], { exact: true }).uncheck();
  await page.getByRole('button', { name: tr['common.save'], exact: true }).click();
  await expect(page.locator('.inventory [role="alert"]')).toHaveText(tr['inventory.error.venueConflict']);
  await locale(page, 'tr');
  await expect(page.locator('.inventory [role="alert"]')).toHaveText(en['inventory.error.venueConflict']);
  await expect(page.getByLabel(en['common.active'], { exact: true })).not.toBeChecked();
  await page.goto(`${root}/screens/${display.id}`);
  await page.getByLabel(en['common.active'], { exact: true }).uncheck();
  await submit(page, `/screens/${display.id}`, page.getByRole('button', { name: en['common.save'], exact: true }), 'PATCH');
  await page.goto(`${root}/venues/${created.id}`);
  await page.getByLabel(en['common.active'], { exact: true }).uncheck();
  await submit(page, `/venues/${created.id}`, page.getByRole('button', { name: en['common.save'], exact: true }), 'PATCH');
  await page.goto(`${root}/screens/${display.id}`);
  await expect(page.locator('#screen-venue')).toHaveValue(created.id);
  await expect(page.locator('#screen-venue option:checked')).toContainText(en['common.inactive']);
  await page.getByLabel(en['field.name'], { exact: true }).fill(`${run} inactive rename`);
  const renamed = await submit<InventoryScreen>(page, `/screens/${display.id}`, page.getByRole('button', { name: en['common.save'], exact: true }), 'PATCH');
  expect(renamed.active).toBe(false);
  await page.getByLabel(en['common.active'], { exact: true }).check();
  await page.getByRole('button', { name: en['common.save'], exact: true }).click();
  await expect(page.locator('.inventory [role="alert"]')).toHaveText(en['inventory.error.screenConflict']);
});

test('real draft versions, explicit approval/supersession, future UTC validity, provenance and immutable history', async ({ page }) => {
  const parent = await venue();
  const display = await screen(parent);
  await session(page, 'en');
  await page.goto(`${root}/screens/${display.id}/multipliers`);
  await expect(page.getByRole('region', { name: en['multiplier.current'], exact: true })).toContainText(en['multiplier.noneCurrent']);
  const form = page.locator('form').filter({ has: page.locator('input[name="value"]') });
  await form.getByLabel(en['multiplier.value'], { exact: true }).fill('1e3');
  await form.getByLabel(en['multiplier.sourceRef'], { exact: true }).fill('Invalid draft source');
  await form.getByRole('textbox', { name: en['multiplier.reason'], exact: true }).fill('Invalid draft reason');
  await form.getByRole('button', { name: en['multiplier.create'], exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText(en['inventory.error.multiplierValidation']);
  expect((await history(display.id)).total).toBe(0);
  const first = await draft(page, display.id, '1.2500', 'first');
  expect(first.version).toBe(1); expect(first.sourceType).toBe('MANUAL'); expect(first.validFrom).toBeNull();
  await expect(page.locator('[data-version="1"]')).toContainText(`${run} reason first`);
  await expect(page.getByRole('region', { name: en['multiplier.current'], exact: true })).toContainText(en['multiplier.noneCurrent']);
  await page.locator('[data-version="1"]').getByRole('button', { name: en['multiplier.review'] }).click();
  const approval = page.locator('.approval-panel');
  await expect(approval.getByRole('button', { name: en['multiplier.approve'] })).toBeDisabled();
  await approval.getByLabel(en['multiplier.confirm'], { exact: true }).check();
  const [nowRequest] = await Promise.all([
    page.waitForRequest(request => new URL(request.url()).pathname.endsWith(`/${first.id}/approve`)),
    submit<InventoryMultiplier>(page, `/screens/${display.id}/multipliers/${first.id}/approve`, approval.getByRole('button', { name: en['multiplier.approve'] })),
  ]);
  expect(nowRequest.postDataJSON()).toEqual({});
  await expect(page.getByRole('region', { name: en['multiplier.current'], exact: true })).toContainText('1.2500');
  const before = (await history(display.id)).current!;
  expect(before.approvalStatus).toBe('APPROVED');

  const second = await draft(page, display.id, '2.5000', 'second');
  await page.locator('[data-version="2"]').getByRole('button', { name: en['multiplier.review'] }).click();
  await expect(approval.getByRole('combobox', { name: en['multiplier.predecessor'], exact: true }).locator(`option[value="${first.id}"]`)).toHaveCount(1);
  await approval.getByRole('combobox', { name: en['multiplier.startMode'], exact: true }).selectOption('future');
  const dates = await page.evaluate(() => {
    const format = (value: Date) => {
      const pad = (value: number) => String(value).padStart(2, '0');
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
    };
    const start = format(new Date(Date.now() + 86400000));
    const end = format(new Date(Date.now() + 172800000));
    return { start, end, startUTC: new Date(start).toISOString(), endUTC: new Date(end).toISOString() };
  });
  await approval.getByLabel(en['multiplier.localStart'], { exact: true }).fill(dates.start);
  await approval.getByLabel(en['multiplier.localEnd'], { exact: true }).fill(dates.end);
  await approval.getByRole('combobox', { name: en['multiplier.predecessor'], exact: true }).selectOption(first.id);
  await approval.getByLabel(en['multiplier.confirm'], { exact: true }).check();
  await expect(approval.getByRole('button', { name: en['multiplier.approve'] })).toBeDisabled();
  await approval.getByLabel(en['multiplier.confirmReplace'], { exact: true }).check();
  await expect(approval.locator('.utc-preview')).toContainText(dates.startUTC);
  await expect(approval).toContainText('Europe/Istanbul');
  // Approval fields and explicit selection survive an RSC locale refresh.
  await locale(page, 'en');
  await expect(approval.getByLabel(tr['multiplier.localStart'], { exact: true })).toHaveValue(dates.start);
  await expect(approval.getByRole('combobox', { name: tr['multiplier.predecessor'], exact: true })).toHaveValue(first.id);
  await expect(approval.getByLabel(tr['multiplier.confirmReplace'], { exact: true })).toBeChecked();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const approved = await submit<InventoryMultiplier>(page, `/screens/${display.id}/multipliers/${second.id}/approve`,
    approval.getByRole('button', { name: tr['multiplier.approve'] }));
  expect(approved.validFrom).toBe(dates.startUTC); expect(approved.validTo).toBe(dates.endUTC);
  expect(approved.supersedesId).toBe(first.id);
  const after = await history(display.id);
  expect(after.current?.id).toBe(first.id);
  expect(after.latest?.id).toBe(second.id);
  const preserved = after.items.find(item => item.id === first.id)!;
  expect(preserved).toMatchObject({
    value: before.value, createdBy: before.createdBy, sourceRef: before.sourceRef,
    sourceType: before.sourceType, approvedBy: before.approvedBy, validFrom: before.validFrom, validTo: dates.startUTC,
  });
  await expect(page.getByRole('region', { name: tr['multiplier.current'], exact: true })).toContainText('1.2500');
  await expect(page.getByRole('region', { name: tr['multiplier.latest'], exact: true })).toContainText('2.5000');
  await expect(page.locator('[data-version="2"]')).toContainText(first.id);
  await expect(page.locator('[data-version="2"]')).toContainText(approved.approvedBy!);
  await expect(page.locator('[data-version="2"]')).toContainText(tr['multiplier.source.MANUAL']);
  await expect(page.locator('[data-version="2"]').getByRole('button')).toHaveCount(0);
  await locale(page, 'tr');
  await draft(page, display.id, '3.7500', 'third');
  await expect(page.getByRole('region', { name: en['multiplier.current'], exact: true })).toContainText('1.2500');
  await expect(page.getByRole('region', { name: en['multiplier.latest'], exact: true })).toContainText(en['multiplier.draft']);
  await page.locator('[data-version="3"]').getByRole('button', { name: en['multiplier.review'] }).click();
  await approval.getByLabel(en['multiplier.confirm'], { exact: true }).check();
  await approval.getByRole('button', { name: en['multiplier.approve'] }).click();
  await expect(approval.getByRole('alert')).toHaveText(en['inventory.error.approvalConflict']);
  await expect(approval.getByLabel(en['multiplier.confirm'], { exact: true })).not.toBeChecked();
  expect((await history(display.id)).current?.id).toBe(first.id);
  await page.goto(`${root}/screens/${display.id}/multipliers?pageSize=1`);
  await page.getByRole('link', { name: en['common.next'], exact: true }).click();
  await expect(page).toHaveURL(/page=2&pageSize=1$/);
  await expect(page.locator('[data-version="2"]')).toBeVisible();
});

test('paginated venue choices retain off-page, inactive and newly-created selections; table filters persist', async ({ page }) => {
  test.setTimeout(60000);
  const offpage = await venue();
  const first = await screen(offpage, { active: false });
  await screen(offpage, { active: false });
  // Oldest fixture is now beyond the first 20 choices regardless of earlier test data.
  for (let index = 0; index < 21; index++) await venue();
  await session(page, 'en');
  await page.goto(`${root}/screens`);
  const picker = page.locator('#screen-venue');
  await expect(picker.locator(`option[value="${offpage.id}"]`)).toHaveCount(0);
  const editor = page.locator('.inventory-editor').first();
  while (!(await picker.locator(`option[value="${offpage.id}"]`).count())) {
    await editor.getByRole('button', { name: en['inventory.loadVenues'], exact: true }).click();
    await expect(editor.getByRole('button', { name: en['common.working'], exact: true })).toHaveCount(0);
  }
  await picker.selectOption(offpage.id);
  await editor.getByLabel(en['field.name'], { exact: true }).fill('Unsaved off-page screen');
  await locale(page, 'en');
  await expect(picker).toHaveValue(offpage.id);
  await expect(editor.getByLabel(tr['field.name'], { exact: true })).toHaveValue('Unsaved off-page screen');
  await editor.getByRole('button', { name: tr['inventory.venueCreate'], exact: true }).click();
  const inline = page.locator('.inline-venue');
  const newName = `${run} inline ferry`;
  await inline.getByLabel(tr['field.name'], { exact: true }).fill(newName);
  await inline.getByLabel(tr['inventory.country'], { exact: true }).fill('Türkiye');
  await inline.getByLabel(tr['inventory.city'], { exact: true }).fill('İzmir');
  const added = await submit<InventoryVenue>(page, '/venues', inline.getByRole('button', { name: tr['common.save'], exact: true }));
  ownedVenues.add(added.id);
  await expect(picker).toHaveValue(added.id);
  await expect(picker.locator('option:checked')).toHaveText(newName);
  await locale(page, 'tr');
  await expect(picker).toHaveValue(added.id);
  await expect(editor.getByLabel(en['field.name'], { exact: true })).toHaveValue('Unsaved off-page screen');
  const inactive = await admin.patch(`/api/v1/venues/${offpage.id}`, { data: { active: false } });
  expect(inactive.status()).toBe(200);
  await page.goto(`${root}/screens/${first.id}`);
  await expect(page.locator('#screen-venue')).toHaveValue(offpage.id);
  await expect(page.locator('#screen-venue option:checked')).toContainText(en['common.inactive']);
  await page.getByRole('textbox', { name: en['inventory.notes'], exact: true }).fill('Unsaved under inactive venue');
  await locale(page, 'en');
  await expect(page.locator('#screen-venue')).toHaveValue(offpage.id);
  await expect(page.getByRole('textbox', { name: tr['inventory.notes'], exact: true })).toHaveValue('Unsaved under inactive venue');
  await locale(page, 'tr');
  await page.goto(`${root}/screens?active=false&venueId=${offpage.id}&pageSize=1`);
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: en['common.next'], exact: true }).click();
  await expect(page).toHaveURL(/page=2&active=false&venueId=.*&pageSize=1$/);
  const url = new URL(page.url());
  expect(Object.fromEntries(url.searchParams)).toEqual({ page: '2', active: 'false', venueId: offpage.id, pageSize: '1' });
  await expect(page.locator('.table-scroll tbody tr')).toContainText(first.screenId);
  await expect(page.locator('#filter-venue')).toHaveValue(offpage.id);
  await page.getByRole('link', { name: en['common.previous'], exact: true }).click();
  await expect(page).toHaveURL(/page=1&active=false&venueId=.*&pageSize=1$/);
  await page.goto(`${root}/screens?active=true&venueId=${offpage.id}`);
  await expect(page.getByText(en['inventory.emptyScreens'], { exact: true })).toBeVisible();
});

test('current-by-server-time switches at the approved boundary and expires independently of latest', async ({ page }) => {
  const parent = await venue();
  const display = await screen(parent);
  const makeDraft = async (value: string) => {
    const response = await admin.post(`/api/v1/screens/${display.id}/multipliers`, {
      data: { value, sourceRef: `${run} boundary source`, changeReason: `${run} boundary reason` },
    });
    expect(response.status()).toBe(201);
    return response.json() as Promise<InventoryMultiplier>;
  };
  const first = await makeDraft('4');
  expect((await admin.post(`/api/v1/screens/${display.id}/multipliers/${first.id}/approve`, { data: {} })).status()).toBe(200);
  const next = await makeDraft('5');
  const start = new Date(Date.now() + 5000).toISOString();
  const end = new Date(Date.parse(start) + 4000).toISOString();
  expect((await admin.post(`/api/v1/screens/${display.id}/multipliers/${next.id}/approve`, {
    data: { validFrom: start, validTo: end, supersedesId: first.id },
  })).status()).toBe(200);
  await session(page, 'en');
  await page.goto(`${root}/screens/${display.id}/multipliers`);
  const current = page.getByRole('region', { name: en['multiplier.current'], exact: true });
  await expect(current).toContainText('4.0000');
  await expect.poll(async () => (await history(display.id)).current?.id, { timeout: 10000 }).toBe(next.id);
  await page.getByRole('button', { name: en['multiplier.refresh'], exact: true }).click();
  await expect(current).toContainText('5.0000');
  await expect.poll(async () => (await history(display.id)).current, { timeout: 10000 }).toBeNull();
  await page.getByRole('button', { name: en['multiplier.refresh'], exact: true }).click();
  await expect(current).toContainText(en['multiplier.noneCurrent']);
  await expect(page.getByRole('region', { name: en['multiplier.latest'], exact: true })).toContainText('5.0000');
  const persisted = (await history(display.id)).items.find(item => item.id === first.id)!;
  expect(persisted.value).toBe('4.0000'); expect(persisted.validTo).toBe(start);
});

test('anonymous, agency, advertiser and support cannot access inventory routes or mutate persisted records', async ({ browser, playwright }) => {
  test.setTimeout(60000);
  const parent = await venue();
  const display = await screen(parent);
  const created = await admin.post(`/api/v1/screens/${display.id}/multipliers`, {
    data: { value: '1', sourceRef: `${run} access source`, changeReason: `${run} access reason` },
  });
  const version = await created.json() as InventoryMultiplier;
  const before = await (await admin.get(`/api/v1/screens/${display.id}`)).json();
  const beforeVenue = await (await admin.get(`/api/v1/venues/${parent.id}`)).json();
  const beforeHistory = await history(display.id);
  for (const email of [null, 'agency-a@example.test', 'advertiser@example.test', 'support@example.test']) {
    const context = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
    const browserContext = await browser.newContext({ baseURL });
    try {
      if (email) {
        const login = await context.post('/api/v1/auth/login', { data: { email, password: process.env.SEED_TENANT_PASSWORD } });
        expect(login.status()).toBe(200);
        await browserContext.addCookies((await context.storageState()).cookies);
      }
      const page = await browserContext.newPage();
      const destination = email === null ? /\/login$/ : email.startsWith('support') ? /\/support$/ : /\/portal$/;
      for (const path of [`${root}/venues`, `${root}/venues/${parent.id}`, `${root}/screens`, `${root}/screens/${display.id}`, `${root}/screens/${display.id}/multipliers`]) {
        await page.goto(path); await expect(page).toHaveURL(destination);
      }
      const status = email ? 403 : 401;
      for (const path of ['/venues', `/venues/${parent.id}`, '/screens', `/screens/${display.id}`, `/screens/${display.id}/multipliers`]) {
        const result = await context.get(`/api/v1${path}`);
        expect(result.status()).toBe(status);
        const payload = await result.json();
        expect(payload).not.toHaveProperty('items'); expect(payload).not.toHaveProperty('screenId');
      }
      for (const [path, data] of [
        ['/venues', { name: `${run} forbidden`, city: 'City', country: 'Country', timezone: 'UTC' }],
        ['/screens', { screenId: `${run}-FORBIDDEN`, name: 'Denied', venueId: parent.id, timezone: 'UTC' }],
        [`/screens/${display.id}/multipliers`, { value: '9', sourceRef: 'Denied', changeReason: 'Denied' }],
        [`/screens/${display.id}/multipliers/${version.id}/approve`, {}],
      ] as const) expect((await context.post(`/api/v1${path}`, { data })).status()).toBe(status);
      expect((await context.patch(`/api/v1/venues/${parent.id}`, { data: { name: 'Denied' } })).status()).toBe(status);
      expect((await context.patch(`/api/v1/screens/${display.id}`, { data: { name: 'Denied' } })).status()).toBe(status);
    } finally {
      if (email) await context.post('/api/v1/auth/logout', { data: {} });
      await context.dispose(); await browserContext.close();
    }
  }
  expect(await (await admin.get(`/api/v1/screens/${display.id}`)).json()).toEqual(before);
  expect(await (await admin.get(`/api/v1/venues/${parent.id}`)).json()).toEqual(beforeVenue);
  const afterHistory = await history(display.id);
  expect(afterHistory.items).toEqual(beforeHistory.items);
  expect(afterHistory.total).toBe(beforeHistory.total);
  expect(afterHistory.current).toBeNull();
});

test('inventory discovery is live, future modules remain planned, and invalid/missing detail routes are 404', async ({ page }) => {
  await session(page, 'en');
  await page.goto('/admin');
  const navigation = page.getByRole('navigation', { name: en['common.navigation'] });
  await expect(navigation.getByRole('link', { name: en['nav.inventory.venues'], exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: en['nav.inventory.screens'], exact: true })).toBeVisible();
  await expect(page.getByText(en['dashboard.foundationDescription'], { exact: true })).toBeVisible();
  await page.goto('/admin/reporting');
  await expect(page.getByRole('heading', { name: en['common.notImplemented'], exact: true })).toBeVisible();
  for (const path of [`${root}/screens/not-a-uuid`, `${root}/screens/${randomUUID()}`, `${root}/venues/${randomUUID()}`, `${root}/venues/${randomUUID()}/multipliers`]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});

for (const repairFirst of ['hours', 'slot'] as const) {
  test(`legacy invalid timing permits metadata/deactivation and independent ${repairFirst}-first repairs (HTTP presentation fixture)`, async ({ page }) => {
    const display = await screen(await venue(), {
      loopLengthSec: 60, defaultSlotLengthSec: 10, operatingStart: '22:00', operatingEnd: '06:00',
    });
    const patches = await legacyPresentation(page, display, {
      loopLengthSec: 60, defaultSlotLengthSec: 90, operatingStart: '22:00', operatingEnd: '22:00',
    });
    const save = page.getByRole('button', { name: en['common.save'], exact: true });
    await save.click();
    await expect(page.getByRole('status')).toHaveText(en['inventory.noChanges']);
    expect(patches).toEqual([]);
    const renamed = `${run} legacy timing metadata ${repairFirst}`;
    await page.getByLabel(en['field.name'], { exact: true }).fill(renamed);
    await submit(page, `/screens/${display.id}`, save, 'PATCH');
    expect(patches.at(-1)).toEqual({ name: renamed });
    await page.getByLabel(en['common.active'], { exact: true }).uncheck();
    await submit(page, `/screens/${display.id}`, save, 'PATCH');
    expect(patches.at(-1)).toEqual({ active: false });
    await openHardware(page);
    await expect(page.getByLabel(en['inventory.slot'], { exact: true })).toHaveValue('90');
    await expect(page.getByLabel(en['inventory.operatingEnd'], { exact: true })).toHaveValue('22:00');
    // An actually edited invalid group must still be rejected; reverting it must
    // not cause validation of that legacy group during an independent repair.
    const loop = page.getByLabel(en['inventory.loop'], { exact: true });
    await loop.fill('');
    await loop.pressSequentially('-');
    await expect.poll(() => loop.evaluate((input: HTMLInputElement) => input.validity.badInput)).toBe(true);
    await save.click();
    await expect(page.locator('.inventory [role="alert"]')).toHaveText(en['inventory.error.hardware']);
    expect(patches).toHaveLength(2);
    await page.getByLabel(en['inventory.loop'], { exact: true }).fill('20');
    await save.click();
    await expect(page.locator('.inventory [role="alert"]')).toHaveText(en['inventory.error.hardware']);
    expect(patches).toHaveLength(2);
    await page.getByLabel(en['inventory.loop'], { exact: true }).fill('60');
    for (const group of [repairFirst, repairFirst === 'hours' ? 'slot' : 'hours']) {
      await openHardware(page);
      const field = group === 'hours' ? 'inventory.operatingEnd' : 'inventory.slot';
      await page.getByLabel(en[field], { exact: true }).fill(group === 'hours' ? '06:00' : '10');
      await submit(page, `/screens/${display.id}`, save, 'PATCH');
      expect(patches.at(-1)).toEqual(group === 'hours' ? { operatingEnd: '06:00' } : { defaultSlotLengthSec: 10 });
    }
  });
}

for (const action of ['clear', 'repair'] as const) {
  test(`malformed legacy hours remain raw and unchanged until explicit ${action} (HTTP presentation fixture)`, async ({ page }) => {
    // Real API state is a valid pair, so explicit single-field repairs are validated
    // against that pair as usual. Invalid legacy presentation is injected only above.
    const display = await screen(await venue(), { operatingStart: '09:00', operatingEnd: '17:00' });
    const patches = await legacyPresentation(page, display, { operatingStart: '25:00', operatingEnd: '26:00' });
    await openHardware(page);
    await expect(page.getByLabel(en['inventory.operatingStart'], { exact: true })).toHaveValue('25:00');
    await expect(page.getByLabel(en['inventory.operatingEnd'], { exact: true })).toHaveValue('26:00');
    await expect(page.getByText(en['inventory.legacyHours'], { exact: true })).toBeVisible();
    const notes = `${run} untouched legacy hours`;
    await page.getByRole('textbox', { name: en['inventory.notes'], exact: true }).fill(notes);
    await locale(page, 'en');
    await expect(page.getByLabel(tr['inventory.operatingStart'], { exact: true })).toHaveValue('25:00');
    await submit(page, `/screens/${display.id}`, page.getByRole('button', { name: tr['common.save'], exact: true }), 'PATCH');
    expect(patches.at(-1)).toEqual({ notes });
    await page.getByLabel(tr['common.active'], { exact: true }).uncheck();
    await submit(page, `/screens/${display.id}`, page.getByRole('button', { name: tr['common.save'], exact: true }), 'PATCH');
    expect(patches.at(-1)).toEqual({ active: false });
    await locale(page, 'tr');
    await openHardware(page);
    await expect(page.getByLabel(en['inventory.operatingEnd'], { exact: true })).toHaveValue('26:00');
    if (action === 'clear') {
      await page.getByRole('button', { name: en['inventory.clearHours'], exact: true }).click();
      await locale(page, 'en'); // Explicit clear intent also survives a locale refresh.
      await expect(page.getByLabel(tr['inventory.operatingStart'], { exact: true })).toHaveValue('');
      await locale(page, 'tr');
    } else {
      await page.getByLabel(en['inventory.operatingStart'], { exact: true }).fill('07:00');
      await page.getByRole('button', { name: en['common.save'], exact: true }).click();
      await expect(page.locator('.inventory [role="alert"]')).toHaveText(en['inventory.error.hours']);
      expect(patches).toHaveLength(2);
      await page.getByLabel(en['inventory.operatingEnd'], { exact: true }).fill('08:00');
    }
    await submit(page, `/screens/${display.id}`, page.getByRole('button', { name: en['common.save'], exact: true }), 'PATCH');
    expect(patches.at(-1)).toEqual(action === 'clear'
      ? { operatingStart: null, operatingEnd: null } : { operatingStart: '07:00', operatingEnd: '08:00' });
    const persisted = await (await admin.get(`/api/v1/screens/${display.id}`)).json();
    expect(persisted.operatingStart).toBe(action === 'clear' ? null : '07:00');
    expect(persisted.operatingEnd).toBe(action === 'clear' ? null : '08:00');
  });
}

for (const [label, locked, code] of [
  ['locked lowercase', true, 'legacy_lowercase'],
  ['unlocked lowercase', false, 'legacy_lowercase'],
  ['unlocked noncanonical', false, 'legacy code/old'],
] as const) {
  test(`${label} code is never normalized by unrelated edits (HTTP presentation fixture)`, async ({ page }) => {
    const display = await screen(await venue());
    const patches = await legacyPresentation(page, display, { screenId: code, screenIdLocked: locked });
    const input = page.getByLabel(en['inventory.screenCode'], { exact: true });
    await expect(input).toHaveValue(code);
    if (locked) await expect(input).toBeDisabled();
    await page.getByRole('textbox', { name: en['inventory.notes'], exact: true }).fill(`${run} code metadata`);
    await submit(page, `/screens/${display.id}`, page.getByRole('button', { name: en['common.save'], exact: true }), 'PATCH');
    expect(patches.at(-1)).toEqual({ notes: `${run} code metadata` });
    await expect(input).toHaveValue(code);
    await page.getByLabel(en['common.active'], { exact: true }).uncheck();
    await submit(page, `/screens/${display.id}`, page.getByRole('button', { name: en['common.save'], exact: true }), 'PATCH');
    expect(patches.at(-1)).toEqual({ active: false });
    await expect(input).toHaveValue(code);
    await page.getByRole('button', { name: en['common.save'], exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(en['inventory.noChanges']);
    expect(patches).toHaveLength(2);
    if (!locked) {
      await input.fill('invalid new code/');
      await page.getByRole('button', { name: en['common.save'], exact: true }).click();
      await expect(page.locator('.inventory [role="alert"]')).toHaveText(en['inventory.error.screenCode']);
      expect(patches).toHaveLength(2);
      const replacement = `${run}-REPAIRED-${++sequence}`;
      await input.fill(replacement.toLowerCase());
      await submit(page, `/screens/${display.id}`, page.getByRole('button', { name: en['common.save'], exact: true }), 'PATCH');
      expect(patches.at(-1)).toEqual({ screenId: replacement });
      await expect(input).toHaveValue(replacement);
    }
  });
}

for (const [padding, code] of [
  ['spaces', ' legacy-reverted-code '], ['CR/LF', '\nlegacy-reverted-code\r'],
] as const) test(`editing then reverting ${padding} legacy code preserves raw spelling (HTTP presentation fixture)`, async ({ page }) => {
  const display = await screen(await venue());
  const patches = await legacyPresentation(page, display, { screenId: code });
  const input = page.getByLabel(en['inventory.screenCode'], { exact: true });
  const displayedCode = await input.inputValue();
  expect(displayedCode).toBe(code.replace(/[\r\n]/g, ''));
  await input.fill('TEMPORARY-CODE');
  await input.fill(displayedCode);
  const notes = `${run} reverted-code metadata`;
  await page.getByRole('textbox', { name: en['inventory.notes'], exact: true }).fill(notes);
  await submit(page, `/screens/${display.id}`, page.getByRole('button', { name: en['common.save'], exact: true }), 'PATCH');
  expect(patches).toEqual([{ notes }]);
  await expect(input).toHaveValue(displayedCode);
});

test('screen saving and inline venue creation are mutually exclusive and preserve the new selection', async ({ page }) => {
  const original = await venue();
  const display = await screen(original);
  await session(page, 'en');
  await page.goto(`${root}/screens/${display.id}`);
  await page.getByRole('button', { name: en['inventory.venueCreate'], exact: true }).click();
  const mainForm = page.locator('form').filter({ has: page.locator('#screen-venue') });
  const inline = page.locator('.inline-venue');
  await mainForm.getByLabel(en['field.name'], { exact: true }).fill(`${run} delayed metadata`);
  let release!: () => void;
  let entered!: () => void;
  let releaseVenue!: () => void;
  let enteredVenue!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const venueGate = new Promise<void>(resolve => { releaseVenue = resolve; });
  const venueStarted = new Promise<void>(resolve => { enteredVenue = resolve; });
  let first = true;
  await page.route(`**/api/v1/screens/${display.id}`, async route => {
    if (route.request().method() !== 'PATCH' || !first) return route.continue();
    first = false;
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response });
  });
  await page.route('**/api/v1/venues', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    enteredVenue();
    await venueGate;
    await route.fulfill({ response });
  });
  try {
    await mainForm.getByRole('button', { name: en['common.save'], exact: true }).click();
    await started;
    await expect(inline.getByLabel(en['field.name'], { exact: true })).toBeDisabled();
    await expect(inline.getByRole('button', { name: en['common.save'], exact: true })).toBeDisabled();
    release();
    await expect(mainForm.getByRole('status')).toHaveText(en['common.saved']);
    await inline.getByLabel(en['field.name'], { exact: true }).fill(`${run} late inline venue`);
    await inline.getByLabel(en['inventory.country'], { exact: true }).fill('Türkiye');
    await inline.getByLabel(en['inventory.city'], { exact: true }).fill('İstanbul');
    const response = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/v1/venues' && response.request().method() === 'POST');
    await inline.getByRole('button', { name: en['common.save'], exact: true }).click();
    await venueStarted;
    await expect(mainForm.getByRole('button', { name: en['common.save'], exact: true })).toBeDisabled();
    await expect(mainForm.getByRole('button', { name: en['common.cancel'], exact: true })).toBeDisabled();
    releaseVenue();
    const createdResponse = await response;
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json() as InventoryVenue;
    ownedVenues.add(created.id);
    await expect(page.locator('#screen-venue')).toHaveValue(created.id);
    await expect(mainForm.getByRole('button', { name: en['common.save'], exact: true })).toBeEnabled();
    expect((await (await admin.get(`/api/v1/screens/${display.id}`)).json()).venueId).toBe(original.id);
    await submit(page, `/screens/${display.id}`, mainForm.getByRole('button', { name: en['common.save'], exact: true }), 'PATCH');
    expect((await (await admin.get(`/api/v1/screens/${display.id}`)).json()).venueId).toBe(created.id);
  } finally { release(); releaseVenue(); }
});

test('successful metadata PATCH synchronizes a concurrent venue move before the next save', async ({ page }) => {
  const first = await venue();
  const second = await venue();
  const display = await screen(first);
  await session(page, 'en');
  await page.goto(`${root}/screens/${display.id}`);
  await expect(page.locator('#screen-venue')).toHaveValue(first.id);
  expect((await admin.patch(`/api/v1/screens/${display.id}`, { data: { venueId: second.id } })).status()).toBe(200);
  const patches: unknown[] = [];
  page.on('request', request => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === `/api/v1/screens/${display.id}`) patches.push(request.postDataJSON());
  });
  const name = `${run} externally moved`;
  await page.getByLabel(en['field.name'], { exact: true }).fill(name);
  await submit(page, `/screens/${display.id}`, page.getByRole('button', { name: en['common.save'], exact: true }), 'PATCH');
  await expect(page.locator('#screen-venue')).toHaveValue(second.id);
  await expect(page.locator('#screen-venue option:checked')).toHaveText(second.name);
  await page.getByRole('textbox', { name: en['inventory.notes'], exact: true }).fill(`${run} second metadata edit`);
  await locale(page, 'en');
  await expect(page.locator('#screen-venue')).toHaveValue(second.id);
  await submit(page, `/screens/${display.id}`, page.getByRole('button', { name: tr['common.save'], exact: true }), 'PATCH');
  expect(patches).toEqual([{ name }, { notes: `${run} second metadata edit` }]);
  expect((await (await admin.get(`/api/v1/screens/${display.id}`)).json()).venueId).toBe(second.id);
  await page.locator('#screen-venue').selectOption(first.id);
  await submit(page, `/screens/${display.id}`, page.getByRole('button', { name: tr['common.save'], exact: true }), 'PATCH');
  expect(patches.at(-1)).toEqual({ venueId: first.id });
});

for (const refreshMode of ['explicit refresh', '409 conflict'] as const) {
  test(`approval ${refreshMode} replaces stale predecessor choices and clears confirmations`, async ({ page }) => {
    const display = await screen(await venue());
    const makeDraft = async (value: string) => {
      const response = await admin.post(`/api/v1/screens/${display.id}/multipliers`, {
        data: { value, sourceRef: `${run} refresh source`, changeReason: `${run} refresh reason` },
      });
      expect(response.status()).toBe(201);
      return response.json() as Promise<InventoryMultiplier>;
    };
    const first = await makeDraft('1');
    expect((await admin.post(`/api/v1/screens/${display.id}/multipliers/${first.id}/approve`, { data: {} })).status()).toBe(200);
    const target = await makeDraft('2');
    const competitor = await makeDraft('3');
    await session(page, 'en');
    await page.goto(`${root}/screens/${display.id}/multipliers`);
    await page.locator(`[data-version="${target.version}"]`).getByRole('button', { name: en['multiplier.review'] }).click();
    const panel = page.locator('.approval-panel');
    const picker = panel.getByRole('combobox', { name: en['multiplier.predecessor'], exact: true });
    await expect(picker.locator(`option[value="${first.id}"]`)).toHaveCount(1);
    const date = await futureLocal(page);
    await panel.getByRole('combobox', { name: en['multiplier.startMode'], exact: true }).selectOption('future');
    await panel.getByLabel(en['multiplier.localStart'], { exact: true }).fill(date.local);
    await picker.selectOption(first.id);
    await panel.getByLabel(en['multiplier.confirm'], { exact: true }).check();
    await panel.getByLabel(en['multiplier.confirmReplace'], { exact: true }).check();
    expect((await admin.post(`/api/v1/screens/${display.id}/multipliers/${competitor.id}/approve`, {
      data: { supersedesId: first.id },
    })).status()).toBe(200);
    if (refreshMode === 'explicit refresh') {
      await page.getByRole('button', { name: en['multiplier.refresh'], exact: true }).click();
    } else {
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${target.id}/approve`)),
        panel.getByRole('button', { name: en['multiplier.approve'], exact: true }).click(),
      ]);
      expect(response.status()).toBe(409);
      await expect(panel.getByRole('alert')).toHaveText(en['inventory.error.approvalConflict']);
    }
    await expect(picker).toHaveValue('');
    await expect(picker.locator(`option[value="${first.id}"]`)).toHaveCount(0);
    await expect(picker.locator(`option[value="${competitor.id}"]`)).toHaveCount(1);
    await expect(panel.getByLabel(en['multiplier.confirm'], { exact: true })).not.toBeChecked();
    await expect(panel.getByLabel(en['multiplier.confirmReplace'], { exact: true })).toHaveCount(0);
    await expect(panel.getByLabel(en['multiplier.localStart'], { exact: true })).toHaveValue(date.local);
    await expect(panel.getByRole('button', { name: en['multiplier.approve'], exact: true })).toBeDisabled();
    await picker.selectOption(competitor.id);
    await expect(panel.getByLabel(en['multiplier.confirmReplace'], { exact: true })).not.toBeChecked();
    await panel.getByLabel(en['multiplier.confirm'], { exact: true }).check();
    await panel.getByLabel(en['multiplier.confirmReplace'], { exact: true }).check();
    const approved = await submit<InventoryMultiplier>(page, `/screens/${display.id}/multipliers/${target.id}/approve`,
      panel.getByRole('button', { name: en['multiplier.approve'], exact: true }));
    expect(approved.supersedesId).toBe(competitor.id);
    expect(approved.validFrom).toBe(date.utc);
    expect((await history(display.id)).current?.id).toBe(competitor.id);
  });
}
