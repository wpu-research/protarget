const { randomBytes } = require('node:crypto');

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required; never run integration tests on the runtime database');
let testUrl;
try { testUrl = new URL(process.env.TEST_DATABASE_URL); }
catch { throw new Error('Invalid TEST_DATABASE_URL'); }
if (!['postgresql:', 'postgres:'].includes(testUrl.protocol) || !/test/i.test(testUrl.pathname)) {
  throw new Error('TEST_DATABASE_URL must name a dedicated PostgreSQL test database');
}
if (process.env.DATABASE_URL) {
  const runtime = new URL(process.env.DATABASE_URL);
  if (runtime.hostname === testUrl.hostname && (runtime.port || '5432') === (testUrl.port || '5432') &&
      runtime.pathname === testUrl.pathname) {
    throw new Error('TEST_DATABASE_URL must differ from the configured runtime database');
  }
}
// Override before importing Prisma/AppModule. Never load a source-project .env file.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
process.env.WEB_ORIGIN = 'http://127.0.0.1:13172';
process.env.SMTP_HOST = 'smtp.invalid';
process.env.SMTP_PORT = '1025';
process.env.SMTP_FROM = 'invitations@example.test';
delete process.env.SMTP_USER;
delete process.env.SMTP_PASSWORD;
