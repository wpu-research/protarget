const { readdirSync, readFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '../../apps/web/.next/static');
const values = ['JWT_ACCESS_SECRET', 'PROXY_SHARED_SECRET', 'DATABASE_URL', 'SEED_ADMIN_PASSWORD',
  'SEED_TENANT_PASSWORD', 'BOOTSTRAP_ADMIN_PASSWORD', 'SMTP_PASSWORD']
  .map(key => process.env[key]).filter(value => value && value.length >= 12);
let files = 0;
function scan(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) { scan(file); continue; }
    if (!/\.(js|json|map|html)$/.test(entry.name)) continue;
    const text = readFileSync(file, 'utf8');
    if (values.some(value => text.includes(value)) || /\b(JWT_ACCESS_SECRET|PROXY_SHARED_SECRET|BOOTSTRAP_ADMIN_PASSWORD)\b/.test(text)) {
      throw new Error('Secret marker found in public assets');
    }
    files++;
  }
}
try {
  scan(root);
  if (!files) throw new Error('No browser artifacts found');
  console.log(JSON.stringify({ publicAssetScan: 'passed', files, suppliedSecretValues: values.length }));
} catch {
  console.error('Public asset scan failed; details withheld');
  process.exitCode = 1;
}
