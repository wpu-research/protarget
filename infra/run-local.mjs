import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Existing process variables take precedence. No shell evaluation of .env contents.
try { process.loadEnvFile(resolve(root, '.env')); }
catch { console.error('A local .env is required; run pnpm setup:env first.'); process.exit(1); }
const commands = {
  api: ['--filter', '@protarget/api', 'start'],
  web: ['--filter', '@protarget/web', 'start'],
  seed: ['seed:foundation'],
  integration: ['test:integration'],
  e2e: ['test:e2e'],
  openapi: ['--filter', '@protarget/api', 'exec', 'ts-node', 'src/export-openapi.ts'],
};
const action = process.argv[2];
if (!(action in commands)) { console.error('Choose: api, web, seed, integration, e2e, openapi'); process.exit(1); }
const env = { ...process.env, PLAYWRIGHT_BASE_URL: process.env.WEB_ORIGIN };
if (action === 'web') env.NODE_ENV = 'production';
const child = spawn('pnpm', commands[action], { cwd: root, env, stdio: 'inherit' });
child.on('error', () => { console.error('Unable to start pnpm'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
