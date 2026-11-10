const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const requireApi = createRequire(resolve(__dirname, '../../apps/api/package.json'));
const { PrismaClient } = requireApi('@prisma/client');
const db = new PrismaClient();
(async () => {
  const [role] = await db.$queryRaw`
    SELECT current_user AS name, rolsuper, rolcreaterole, rolcreatedb,
      has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
      has_table_privilege(current_user, 'public.audit_logs', 'UPDATE') AS audit_update,
      has_table_privilege(current_user, 'public.audit_logs', 'DELETE') AS audit_delete,
      has_table_privilege(current_user, 'public.audit_logs', 'TRUNCATE') AS audit_truncate,
      has_table_privilege(current_user, 'public._prisma_migrations', 'SELECT') AS migration_read
    FROM pg_roles WHERE rolname = current_user`;
  if (!role || role.name !== 'protarget_app' ||
      Object.entries(role).some(([key, value]) => key !== 'name' && value !== false)) {
    throw new Error('Runtime role is overprivileged');
  }
  const activeAdmins = await db.user.count({ where: { role: 'ADMIN', active: true, org: { active: true } } });
  const demoAccounts = await db.user.count({ where: { email: { endsWith: '@example.test' } } });
  const [version] = await db.$queryRaw`SELECT current_setting('server_version') AS version`;
  if (activeAdmins < 1 || demoAccounts !== 0) throw new Error('Invalid production bootstrap state');
  console.log(JSON.stringify({ runtimeRole: 'restricted', auditTampering: 'denied',
    migrationMetadata: 'denied', activeAdmins, demoAccounts, postgres: version.version }));
})().catch(() => {
  console.error('Production runtime verification failed; details withheld');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
