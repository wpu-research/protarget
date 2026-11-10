/* Production bootstrap: no demo tenants, no fixed password, no updates to existing users. */
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { hash } = require('bcryptjs');

async function bootstrapAdmin(db, env = process.env) {
  if (!env.BOOTSTRAP_ADMIN_EMAIL && !env.BOOTSTRAP_ADMIN_PASSWORD) return { created: false, skipped: true };
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      !password || password.length < 20 || Buffer.byteLength(password) > 72) {
    throw new Error('Valid bootstrap email and 20+ character password required');
  }
  const passwordHash = await hash(password, 12);
  return db.$transaction(async tx => {
    const existing = await tx.user.findUnique({ where: { email }, include: { org: true } });
    if (existing) {
      if (existing.role !== 'ADMIN' || existing.org.type !== 'ADMIN') throw new Error('Bootstrap identity conflict');
      return { created: false, skipped: false };
    }
    if (await tx.user.count({ where: { role: 'ADMIN' } })) {
      throw new Error('Administrator already exists; bootstrap cannot add another');
    }
    const organization = await tx.organization.create({ data: {
      id: randomUUID(), name: 'Protarget', type: 'ADMIN',
    } });
    const user = await tx.user.create({ data: {
      id: randomUUID(), email, passwordHash, name: 'Protarget Admin',
      role: 'ADMIN', orgId: organization.id, active: true,
    } });
    await tx.auditLog.create({ data: {
      userId: user.id, action: 'ADMIN_BOOTSTRAPPED', entityType: 'user', entityId: user.id,
      after: { email, role: 'ADMIN', orgId: organization.id },
    } });
    return { created: true, skipped: false };
  }, { isolationLevel: 'Serializable', timeout: 15000 });
}
module.exports = { bootstrapAdmin };
if (require.main === module) {
  const db = new PrismaClient();
  bootstrapAdmin(db).then(result => console.log(JSON.stringify({ bootstrap: result })))
    .catch(() => { console.error('Administrator bootstrap failed'); process.exitCode = 1; })
    .finally(() => db.$disconnect());
}
