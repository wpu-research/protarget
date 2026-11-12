import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { FleetScene, InventoryScreen, InventoryVenue } from '@protarget/shared';
import tr from '../../../packages/i18n/src/tr.json';
import en from '../../../packages/i18n/src/en.json';

const baseURL = process.env.PLAYWRIGHT_BASE_URL!;
const run = `FLT-E2E-${randomUUID().slice(0, 8).toUpperCase()}`;
let admin: APIRequestContext;
let authenticated = false;
let venue: InventoryVenue;
const screens: InventoryScreen[] = [];

test.beforeAll(async ({ playwright }) => {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Fleet E2E requires a loopback runtime');
  admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const login = await admin.post('/api/v1/auth/login', { data: { email: 'admin@example.test', password: process.env.SEED_ADMIN_PASSWORD } });
  expect(login.status()).toBe(200);
  authenticated = true;
  const v = await admin.post('/api/v1/venues', { data: { name: `${run} Ferry`, country: 'Türkiye', city: 'İstanbul', timezone: 'Europe/Istanbul', type: 'ferry' } });
  expect(v.status()).toBe(201);
  venue = await v.json();
  for (const [i, extra] of [{ resolutionWidth: 1920, resolutionHeight: 1080, orientation: 'LANDSCAPE' }, {}].entries()) {
    const s = await admin.post('/api/v1/screens', { data: { screenId: `${run}-${i + 1}`, name: `${run} screen ${i + 1}`, venueId: venue.id, timezone: 'Europe/Istanbul', ...extra } });
    expect(s.status()).toBe(201);
    screens.push(await s.json());
  }
});
test.afterAll(async () => {
  if (!admin) return;
  try {
    if (!authenticated) return;
    for (const s of screens) expect((await admin.patch(`/api/v1/screens/${s.id}`, { data: { active: false } })).status()).toBe(200);
    if (venue) expect((await admin.patch(`/api/v1/venues/${venue.id}`, { data: { active: false } })).status()).toBe(200);
  } finally { await admin.post('/api/v1/auth/logout', { data: {} }); await admin.dispose(); }
});

test('scene API is read-only, ADMIN-only and returns only inventory facts', async ({ playwright }) => {
  const response = await admin.get('/api/v1/fleet/scene');
  expect(response.status()).toBe(200);
  const scene = await response.json() as FleetScene;
  const ship = scene.ships.find(s => s.id === venue.id);
  expect(ship?.screens.map(s => s.screenId)).toEqual([`${run}-1`, `${run}-2`]);
  expect(ship?.screens[1]).toMatchObject({ resolutionWidth: null, resolutionHeight: null, orientation: null, declarations: [] });
  expect(JSON.stringify(scene)).not.toMatch(/"(lat|lon|latitude|longitude|position|ownerOrgId)"/);
  expect((await admin.post('/api/v1/fleet/scene', { data: {} })).status()).toBeGreaterThanOrEqual(400);
  const anonymous = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  try { expect((await anonymous.get('/api/v1/fleet/scene')).status()).toBe(401); } finally { await anonymous.dispose(); }
});

test('TR/EN fleet tab: simulation label, ship list, screen detail with unknowns, board and leave', async ({ page }) => {
  test.setTimeout(120000);
  await page.context().addCookies((await admin.storageState()).cookies);
  await page.context().addCookies([{ name: 'protarget_locale', value: 'tr', url: baseURL }]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/admin/fleet');
  await expect(page.getByRole('heading', { level: 1, name: tr['nav.fleet'] })).toBeVisible();
  await expect(page.getByTestId('fleet-sim-badge')).toHaveText(tr['fleet.simBadge']);
  await expect(page.getByTestId('fleet-notes')).toContainText(tr['fleet.declNote']);
  const item = page.getByTestId('fleet-ship-item').filter({ hasText: `${run} Ferry` });
  await expect(item).toBeVisible();
  await item.locator('summary').click();
  await item.getByTestId('fleet-screen-item').filter({ hasText: `${run}-2` }).click();
  const detail = page.getByTestId('fleet-screen-detail');
  await expect(detail).toContainText(`${run}-2`);
  await expect(detail).toContainText(tr['fleet.unknown']);
  await expect(detail).toContainText(tr['fleet.noDeclarations']);
  await expect(detail).toContainText(tr['fleet.declNote']);
  await item.getByTestId('fleet-screen-item').filter({ hasText: `${run}-1` }).click();
  await expect(detail).toContainText('1920×1080');
  // 3D: only when the browser can create a WebGL context; the list above is the fallback.
  if (await page.getByText(tr['fleet.noWebgl']).isVisible()) { test.info().annotations.push({ type: 'skip-3d', description: 'WebGL unavailable' }); }
  else {
    await item.getByRole('button', { name: `${tr['fleet.enter']}: ${run} Ferry` }).click();
    await expect(page.getByTestId('fleet-root')).toHaveAttribute('data-mode', 'interior', { timeout: 90000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('fleet-root')).toHaveAttribute('data-mode', 'overview', { timeout: 90000 });
  }
  await page.context().addCookies([{ name: 'protarget_locale', value: 'en', url: baseURL }]);
  await page.reload();
  await expect(page.getByTestId('fleet-sim-badge')).toHaveText(en['fleet.simBadge']);
});

test('narrow touch viewport falls back to low quality', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  try {
    await context.addCookies((await admin.storageState()).cookies);
    const page = await context.newPage();
    await page.goto('/admin/fleet');
    await expect(page.getByTestId('fleet-root')).toHaveAttribute('data-quality', 'low');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  } finally { await context.close(); }
});

test('non-admin roles cannot reach the tab or the API', async ({ playwright, browser }) => {
  for (const email of ['agency-a@example.test', 'advertiser@example.test', 'support@example.test']) {
    const context = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
    const browserContext = await browser.newContext({ baseURL });
    try {
      expect((await context.post('/api/v1/auth/login', { data: { email, password: process.env.SEED_TENANT_PASSWORD } })).status()).toBe(200);
      await browserContext.addCookies((await context.storageState()).cookies);
      const page = await browserContext.newPage();
      await page.goto('/admin/fleet');
      await expect(page).toHaveURL(email.startsWith('support') ? /\/support$/ : /\/portal$/);
      expect((await context.get('/api/v1/fleet/scene')).status()).toBe(403);
    } finally { await browserContext.close(); await context.dispose(); }
  }
});
