import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const secret = () => randomBytes(32).toString('hex');
const owner = secret(), app = secret();
const values = {
  NODE_ENV: 'development',
  POSTGRES_USER: 'protarget_owner', POSTGRES_PASSWORD: owner, POSTGRES_DB: 'protarget',
  APP_DB_PASSWORD: app, POSTGRES_PORT: '5544',
  DATABASE_URL: `postgresql://protarget_app:${app}@127.0.0.1:5544/protarget`,
  TEST_DATABASE_URL: `postgresql://protarget_app:${app}@127.0.0.1:5544/protarget_test`,
  MIGRATION_DATABASE_URL: `postgresql://protarget_owner:${owner}@127.0.0.1:5544/protarget`,
  API_PORT: '4100', API_HOST: '127.0.0.1', WEB_PORT: '3100', WEB_HOST: '127.0.0.1',
  WEB_ORIGIN: 'http://localhost:3100', API_INTERNAL_URL: 'http://127.0.0.1:4100',
  JWT_ACCESS_SECRET: secret(), SMTP_HOST: '127.0.0.1', SMTP_PORT: '1125',
  SMTP_FROM: 'invitations@protarget.local', MAILPIT_SMTP_PORT: '1125', MAILPIT_UI_PORT: '8125',
  REDIS_PORT: '6390', REDIS_URL: 'redis://127.0.0.1:6390',
  SEED_ADMIN_PASSWORD: secret(), SEED_TENANT_PASSWORD: secret(),
  S3_ACCESS_KEY: 'protarget', S3_SECRET_KEY: secret(),
  MINIO_PORT: '9100', MINIO_CONSOLE_PORT: '9101',
};
try {
  await writeFile(resolve(root, '.env'), '# Local-only generated credentials. Never commit or share.\n' +
    Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n',
  { flag: 'wx', mode: 0o600 });
  console.log('.env created (0600); secrets were not printed. Existing files are never overwritten.');
} catch (error) {
  console.error(error.code === 'EEXIST' ? '.env already exists; preserved without changes.' : 'Environment setup failed.');
  process.exitCode = 1;
}
