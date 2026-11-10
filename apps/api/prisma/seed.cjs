/* Run with an explicitly supplied DATABASE_URL and seed passwords:
 *   node apps/api/prisma/seed.cjs
 * No dotenv loading, embedded passwords, updates to existing identities, or destructive reset.
 */
const { PrismaClient, OrganizationType, Role } = require('@prisma/client');
const { hash } = require('bcryptjs');

const organizations = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Protarget Administration', type: OrganizationType.ADMIN },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Agency A', type: OrganizationType.AGENCY },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Agency B', type: OrganizationType.AGENCY },
  { id: '00000000-0000-4000-8000-000000000004', name: 'Demo Advertiser', type: OrganizationType.ADVERTISER },
];
const accounts = [
  { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.test', name: 'Demo Administrator', role: Role.ADMIN, org: 0 },
  { id: '10000000-0000-4000-8000-000000000002', email: 'agency-a@example.test', name: 'Agency A User', role: Role.AGENCY, org: 1 },
  { id: '10000000-0000-4000-8000-000000000003', email: 'agency-b@example.test', name: 'Agency B User', role: Role.AGENCY, org: 2 },
  { id: '10000000-0000-4000-8000-000000000004', email: 'advertiser@example.test', name: 'Advertiser User', role: Role.ADVERTISER, org: 3 },
  { id: '10000000-0000-4000-8000-000000000005', email: 'support@example.test', name: 'Support User', role: Role.SUPPORT, org: 0 },
];

function seedPassword(env, key) {
  const value = env[key];
  if (!value || value.length < 12 || Buffer.byteLength(value, 'utf8') > 72) {
    throw new Error(`${key} must contain at least 12 characters and at most 72 UTF-8 bytes`);
  }
  return value;
}

async function seed(db, env = process.env) {
  const adminHash = await hash(seedPassword(env, 'SEED_ADMIN_PASSWORD'), 12);
  const tenantHash = await hash(seedPassword(env, 'SEED_TENANT_PASSWORD'), 12);
  return db.$transaction(async tx => {
    let createdUsers = 0;
    for (const org of organizations) {
      const existing = await tx.organization.findUnique({ where: { id: org.id } });
      if (existing) {
        if (existing.type !== org.type) throw new Error('Seed organization type conflicts with existing data');
        continue;
      }
      await tx.organization.create({ data: org });
      await tx.auditLog.create({ data: {
        action: 'ORGANIZATION_SEEDED', entityType: 'organization', entityId: org.id, after: org,
      } });
    }
    for (const account of accounts) {
      const { org, ...data } = account;
      const orgId = organizations[org].id;
      const existing = await tx.user.findUnique({ where: { email: data.email } });
      if (existing) {
        if (existing.orgId !== orgId || existing.role !== data.role) {
          throw new Error('Seed identity conflicts with an existing organization or role; resolve explicitly');
        }
        // Deliberately preserve password, name, active/MFA status and all session state.
        continue;
      }
      await tx.user.create({ data: {
        ...data, orgId, passwordHash: data.role === Role.ADMIN ? adminHash : tenantHash,
      } });
      await tx.auditLog.create({ data: {
        action: 'USER_SEEDED', entityType: 'user', entityId: data.id,
        after: { id: data.id, email: data.email, role: data.role, orgId },
      } });
      createdUsers++;
    }
    return { createdUsers };
  }, { isolationLevel: 'Serializable', timeout: 15000 });
}

module.exports = { seed, seedPassword, organizations, accounts };
if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exitCode = 1;
  } else {
    const db = new PrismaClient();
    seed(db).then(result => console.log(JSON.stringify({ status: 'seeded', ...result })))
      .catch(() => {
        console.error('Seed failed; verify seed environment, migrations and identity conflicts');
        process.exitCode = 1;
      }).finally(() => db.$disconnect());
  }
}
