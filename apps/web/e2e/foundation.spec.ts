import { test, expect, type Page, type APIRequestContext, type BrowserContext } from '@playwright/test';
import type { ManagedUser, PageResult } from '@protarget/shared';
import { createServer, type Server } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import tr from '../../../packages/i18n/src/tr.json';
import en from '../../../packages/i18n/src/en.json';

const baseURL = process.env.PLAYWRIGHT_BASE_URL!;
const adminPassword = process.env.SEED_ADMIN_PASSWORD!;
const tenantPassword = process.env.SEED_TENANT_PASSWORD!;
const runId = randomUUID().slice(0, 8);
const messages: string[] = [];
let smtp: Server;
let admin: APIRequestContext;
const trackedOrganizations: string[] = [];

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('E-posta', { exact: true }).fill(email);
  await page.getByLabel('Parola', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
}
async function adminContext(page: Page) {
  await page.context().addCookies((await admin.storageState()).cookies);
}
async function findManagedUser(email: string) {
  for (let page = 1; ; page++) {
    const response = await admin.get(`/api/v1/users?page=${page}&pageSize=100`);
    expect(response.status()).toBe(200);
    const result = await response.json() as PageResult<ManagedUser>;
    const user = result.items.find(user => user.email === email);
    if (user || result.page * result.pageSize >= result.total) return user;
  }
}

test.beforeAll(async ({ playwright }) => {
  // Isolated loopback SMTP capture; never sends email to real recipients or prints invitation tokens.
  if (!['127.0.0.1', 'localhost'].includes(process.env.SMTP_HOST ?? '')) {
    throw new Error('E2E SMTP capture requires a loopback SMTP_HOST');
  }
  smtp = createServer(socket => {
    socket.setEncoding('utf8');
    socket.write('220 local-test ESMTP\r\n');
    let buffer = '';
    let inData = false;
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          messages.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5); inData = false;
          socket.write('250 Message captured\r\n'); continue;
        }
        const end = buffer.indexOf('\r\n');
        const command = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (/^EHLO/i.test(command)) socket.write('250-local-test\r\n250 SIZE 65536\r\n');
        else if (/^DATA/i.test(command)) { inData = true; socket.write('354 End with dot\r\n'); }
        else if (/^QUIT/i.test(command)) { socket.end('221 Goodbye\r\n'); return; }
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    smtp.once('error', reject); smtp.listen(Number(process.env.SMTP_PORT), '127.0.0.1', resolve);
  });
  admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const response = await admin.post('/api/v1/auth/login', { data: { email: 'admin@example.test', password: adminPassword } });
  expect(response.status()).toBe(200);
});
test.afterAll(async () => {
  if (admin) {
    for (const id of trackedOrganizations) await admin.patch(`/api/v1/organizations/${id}`, { data: { active: false } });
    await admin.post('/api/v1/auth/logout', { data: {} });
    await admin.dispose();
  }
  messages.length = 0;
  if (smtp) await new Promise<void>(resolve => smtp.close(() => resolve()));
});

test('TR/EN dictionaries have identical keys and interpolation placeholders', () => {
  expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(tr) as (keyof typeof tr)[]) {
    expect(tr[key].match(/\{\w+\}/g) ?? []).toEqual(en[key].match(/\{\w+\}/g) ?? []);
  }
});
test('transparent logo loads above the Protarget wordmark on login and panel', async ({ page }) => {
  await page.goto('/login');
  const logo = page.locator('.brand-logo');
  await expect(logo).toBeVisible();
  const alpha = await logo.evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return { transparent: pixels.some((value, index) => index % 4 === 3 && value === 0),
      opaque: pixels.some((value, index) => index % 4 === 3 && value === 255) };
  });
  expect(alpha).toEqual({ transparent: true, opaque: true });
  await adminContext(page);
  await page.goto('/admin');
  const mark = await page.locator('.sidebar .brand-logo').boundingBox();
  const word = await page.locator('.sidebar .wordmark').boundingBox();
  expect(mark).not.toBeNull(); expect(word).not.toBeNull();
  expect(mark!.y + mark!.height).toBeLessThanOrEqual(word!.y);
});
test('anonymous admin access redirects to login; invalid login is generic', async ({ page }) => {
  await page.goto('/admin/organizations');
  await expect(page).toHaveURL(/\/login$/);
  await login(page, `unknown-${runId}@example.test`, randomBytes(18).toString('hex'));
  await expect(page.locator('form [role="alert"]')).toContainText('Giriş bilgileri');
  const missingOrigin = await page.request.post('/api/v1/auth/login', { data: {} });
  expect(missingOrigin.status()).toBe(403);
});
test('admin browser login, organization create/edit, nullable labels and audit screen', async ({ page }) => {
  await login(page, 'admin@example.test', adminPassword);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Panel', exact: true })).toBeVisible();
  await page.goto('/admin/organizations');
  const name = `Browser Agency ${runId}`;
  await page.getByLabel('Ad / unvan', { exact: true }).fill(name);
  await page.getByLabel('Kurum türü', { exact: true }).selectOption('AGENCY');
  await page.getByLabel('Marka adı (isteğe bağlı)', { exact: true }).fill('Editable brand');
  await expect(page.getByLabel('Harcama görünürlüğü', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('kaydedildi');
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
  const organizations = await (await admin.get('/api/v1/organizations?pageSize=100')).json();
  const organization = organizations.items.find((org: { name: string }) => org.name === name);
  expect(Boolean(organization?.id)).toBe(true);
  trackedOrganizations.push(organization.id);
  await page.getByRole('button', { name: `Düzenle ${name}`, exact: true }).click();
  await page.getByLabel('Marka adı (isteğe bağlı)', { exact: true }).fill('');
  await page.getByLabel('Harcama görünürlüğü', { exact: true }).check();
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('kaydedildi');
  const updated = await (await admin.get(`/api/v1/organizations/${organization.id}`)).json();
  expect(updated.brandName).toBeNull();
  expect(updated.spendVisible).toBe(true);
  // A server refresh updates picker metadata without clearing the selected org or draft.
  await page.goto('/admin/organizations/users');
  await page.getByLabel(tr['field.organization'], { exact: true }).selectOption(organization.id);
  await page.getByLabel(tr['field.name'], { exact: true }).fill('Unsaved invitation draft');
  const refreshedName = `${name} refreshed`;
  expect((await admin.patch(`/api/v1/organizations/${organization.id}`, { data: { name: refreshedName } })).status()).toBe(200);
  await page.getByRole('button', { name: tr['common.language'], exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const picker = page.getByLabel(en['field.organization'], { exact: true });
  await expect(picker).toHaveValue(organization.id);
  await expect(picker.locator('option:checked')).toHaveText(refreshedName);
  await expect(page.getByLabel(en['field.name'], { exact: true })).toHaveValue('Unsaved invitation draft');
  await page.getByRole('button', { name: en['common.language'], exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await page.goto('/admin/settings/audit-log');
  await expect(page.getByRole('heading', { name: 'Denetim Kaydı', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('ORGANIZATION_UPDATED');
});
for (const [email, heading] of [
  ['agency-a@example.test', 'Agency A'], ['agency-b@example.test', 'Agency B'],
  ['advertiser@example.test', 'Demo Advertiser'],
]) {
  test(`tenant browser routing and scoped reads: ${email}`, async ({ page }) => {
    await login(page, email, tenantPassword);
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await page.goto('/admin/organizations');
    await expect(page).toHaveURL(/\/portal$/);
    const own = await (await page.request.get('/api/v1/me')).json();
    const list = await (await page.request.get('/api/v1/organizations')).json();
    expect(list.total).toBe(1);
    expect(list.items[0].id).toBe(own.orgId);
    expect(list.items[0]).not.toHaveProperty('spendVisible');
    const otherId = own.orgId === '00000000-0000-4000-8000-000000000002'
      ? '00000000-0000-4000-8000-000000000003' : '00000000-0000-4000-8000-000000000002';
    expect((await page.request.get(`/api/v1/portal/organizations/${otherId}`)).status()).toBe(403);
    expect((await page.request.post('/api/v1/organizations', { headers: { Origin: baseURL }, data: { name: 'Denied', type: 'AGENCY' } })).status()).toBe(403);
  });
}
test('support browser routing permits health/identity but not business data', async ({ page }) => {
  await login(page, 'support@example.test', tenantPassword);
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.getByText('Servis ve veritabanı erişilebilir', { exact: true })).toBeVisible();
  await page.goto('/portal');
  await expect(page).toHaveURL(/\/support$/);
  expect((await page.request.get('/api/v1/organizations')).status()).toBe(403);
  expect((await page.request.get('/api/v1/users')).status()).toBe(403);
});
test('inactive invite name edit, locale-safe fragment acceptance, single-use token and cleanup', async ({ page, browser }) => {
  const email = `browser-${runId}@example.test`;
  let invitedUserId: string | undefined;
  let context: BrowserContext | undefined;
  try {
    await adminContext(page);
    await page.goto('/admin/organizations/users');
    await page.getByLabel('Ad / unvan', { exact: true }).fill('Invited Browser User');
    await page.getByLabel('E-posta', { exact: true }).fill(email);
    await page.getByLabel('Organizasyon', { exact: true }).selectOption('00000000-0000-4000-8000-000000000002');
    const [invitationResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/users/invite' && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Davet gönder', exact: true }).click(),
    ]);
    const issued = await invitationResponse.json();
    invitedUserId = issued.user?.id;
    expect(invitationResponse.status()).toBe(201);
    expect(Boolean(invitedUserId)).toBe(true);
    await expect(page.getByRole('status')).toContainText('e-postası gönderildi');

    const userPatches: unknown[] = [];
    page.on('request', request => {
      if (request.method() === 'PATCH' && new URL(request.url()).pathname === `/api/v1/users/${invitedUserId}`) {
        userPatches.push(request.postDataJSON());
      }
    });
    const invitedRow = page.getByRole('row').filter({ hasText: email });
    await invitedRow.getByRole('button', { name: 'Düzenle Invited Browser User', exact: true }).click();
    await expect(page.getByLabel(tr['common.active'], { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: tr['common.save'], exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(tr['common.saved']);
    expect(userPatches).toEqual([]);

    const renamed = 'Renamed Invited Browser User';
    await page.getByLabel(tr['field.name'], { exact: true }).fill(renamed);
    const [updateResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/users/${invitedUserId}` && response.request().method() === 'PATCH'),
      page.getByRole('button', { name: tr['common.save'], exact: true }).click(),
    ]);
    expect(updateResponse.status()).toBe(200);
    expect(userPatches).toEqual([{ name: renamed }]);
    expect((await updateResponse.json()).active).toBe(false);
    await expect(invitedRow).toContainText(renamed);

    const message = messages.find(value => value.includes(email)) ?? '';
    const decoded = message.replace(/=\r?\n/g, '').replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    const link = decoded.match(/https?:\/\/[^\s]+\/accept-invite#token=[A-Za-z0-9_-]{43}/)?.[0];
    expect(Boolean(link)).toBe(true);
    const password = randomBytes(18).toString('base64url');
    context = await browser.newContext({ baseURL });
    const invited = await context.newPage();
    await invited.goto(link!);
    await expect.poll(() => new URL(invited.url()).hash.length).toBe(0);
    await invited.getByLabel('Parola', { exact: true }).fill(password);
    await invited.getByLabel('Parola tekrarı', { exact: true }).fill(password);
    await invited.getByRole('button', { name: tr['common.language'], exact: true }).click();
    await expect(invited.locator('html')).toHaveAttribute('lang', 'en');
    await expect.poll(() => new URL(invited.url()).hash.length).toBe(0);
    expect(await invited.getByLabel(en['field.password'], { exact: true }).inputValue() === password).toBe(true);
    expect(await invited.getByLabel(en['field.confirmPassword'], { exact: true }).inputValue() === password).toBe(true);
    await invited.getByRole('button', { name: en['auth.accept'], exact: true }).click();
    await expect(invited.getByRole('status')).toContainText(en['auth.inviteAccepted']);
    const token = new URLSearchParams(new URL(link!).hash.slice(1)).get('token');
    const reused = await invited.request.post('/api/v1/auth/accept-invite', { headers: { Origin: baseURL }, data: { token, password } });
    expect(reused.status()).toBe(400);
    await invited.getByRole('button', { name: en['common.language'], exact: true }).click();
    await expect(invited.locator('html')).toHaveAttribute('lang', 'tr');
    await login(invited, email, password);
    await expect(invited).toHaveURL(/\/portal$/);
    await invited.getByRole('button', { name: 'Çıkış yap', exact: true }).click();
    await expect(invited).toHaveURL(/\/login$/);
    expect((await invited.request.get('/api/v1/me')).status()).toBe(401);
  } finally {
    try {
      // Recover the ID even if the invite committed but a later UI/response assertion failed.
      const id = invitedUserId ?? (await findManagedUser(email))?.id;
      if (id) {
        const response = await admin.patch(`/api/v1/users/${id}`, { data: { active: false } });
        expect(response.status()).toBe(200);
        expect((await response.json()).active).toBe(false);
        expect((await findManagedUser(email))?.active).toBe(false);
      }
    } finally { await context?.close(); }
  }
});
test('expired access cookie renews through HttpOnly refresh cookie, including two tabs', async ({ page }) => {
  // Use an independent session; do not revoke the shared setup administrator session.
  await login(page, 'agency-a@example.test', tenantPassword);
  await expect(page).toHaveURL(/\/portal$/);
  const cookies = await page.context().cookies();
  expect(cookies.filter(cookie => cookie.name.startsWith('protarget_')).every(cookie => cookie.httpOnly)).toBe(true);
  await page.context().clearCookies({ name: 'protarget_access' });
  const second = await page.context().newPage();
  await Promise.all([page.goto('/portal'), second.goto('/portal')]);
  await expect(page).toHaveURL(/\/portal$/);
  await expect(second).toHaveURL(/\/portal$/);
  expect((await page.request.get('/api/v1/me')).status()).toBe(200);
});
test('language switch, explicit future state and mobile layout', async ({ page }) => {
  await adminContext(page);
  await page.goto('/admin/reporting');
  await expect(page.getByRole('heading', { name: 'Bu ekran henüz geliştirilmedi.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dili değiştir', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/admin');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/foundation-mobile.png' });
});
