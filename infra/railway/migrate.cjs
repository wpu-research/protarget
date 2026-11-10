/* Run only in the isolated migration service. API/web never receive owner credentials. */
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const root = resolve(__dirname, '../..');

function execute(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  // Prisma/psql errors can echo connection strings or SQL. Keep raw child output out of platform logs.
  if (result.error || result.status !== 0) throw new Error('Migration step failed; inspect configuration securely');
}

try {
  const owner = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
  const password = process.env.APP_DB_PASSWORD ?? '';
  if (!['postgres:', 'postgresql:'].includes(owner.protocol) || password.length < 32 ||
      !/^[A-Za-z0-9_-]+$/.test(password)) throw new Error('Invalid migration environment');
  const env = { ...process.env, DATABASE_URL: owner.toString(),
    PGHOST: owner.hostname, PGPORT: owner.port || '5432',
    PGUSER: decodeURIComponent(owner.username), PGPASSWORD: decodeURIComponent(owner.password),
    PGDATABASE: decodeURIComponent(owner.pathname.slice(1)) };
  const stage = (name, run) => {
    console.log(JSON.stringify({ migration: name, status: 'started' }));
    run();
    console.log(JSON.stringify({ migration: name, status: 'complete' }));
  };
  stage('schema', () => execute('pnpm', ['--filter', '@protarget/api', 'exec', 'prisma', 'migrate', 'deploy'], env));
  stage('runtime-role', () => execute('psql', ['-X', '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-f', 'infra/railway/runtime-role.sql'], env));
  stage('runtime-grants', () => execute('psql', ['-X', '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-f', 'infra/runtime-grants.sql'], env));
  stage('administrator', () => execute('node', ['apps/api/prisma/bootstrap-admin.cjs'], env));
  stage('status', () => execute('pnpm', ['--filter', '@protarget/api', 'exec', 'prisma', 'migrate', 'status'], env));
  console.log(JSON.stringify({ migration: 'all', status: 'complete' }));
} catch {
  console.error(JSON.stringify({ migration: 'failed', message: 'Check migration service credentials, SQL and database availability' }));
  process.exitCode = 1;
}
