import { Injectable } from '@nestjs/common';

export function validateEnvironment(env: NodeJS.ProcessEnv) {
  const fail = (name: string): never => { throw new Error(`Invalid or missing ${name}`); };
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) fail('NODE_ENV');
  const secret = env.JWT_ACCESS_SECRET ?? '';
  if (Buffer.byteLength(secret) < 32 || new Set(secret).size < 10 ||
      /change.?me|placeholder|your.?secret|example/i.test(secret)) fail('JWT_ACCESS_SECRET');
  let origin: URL;
  try { origin = new URL(env.WEB_ORIGIN ?? ''); } catch { return fail('WEB_ORIGIN'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== env.WEB_ORIGIN ||
      (nodeEnv === 'production' && origin.protocol !== 'https:')) fail('WEB_ORIGIN');
  let database: URL;
  try { database = new URL(env.DATABASE_URL ?? ''); } catch { return fail('DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) fail('DATABASE_URL');
  const smtpHost = env.SMTP_HOST?.trim();
  const smtpFrom = env.SMTP_FROM?.trim();
  const smtpPort = Number(env.SMTP_PORT ?? '587');
  if (!smtpHost || /[\r\n]/.test(smtpHost)) fail('SMTP_HOST');
  if (!smtpFrom || /[\r\n]/.test(smtpFrom) || !smtpFrom.includes('@')) fail('SMTP_FROM');
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) fail('SMTP_PORT');
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) fail('SMTP_USER/SMTP_PASSWORD');
  return {
    nodeEnv, secret, webOrigin: origin.origin, smtpHost: smtpHost!, smtpFrom: smtpFrom!,
    smtpPort, smtpUser: env.SMTP_USER, smtpPassword: env.SMTP_PASSWORD,
    secureCookies: nodeEnv === 'production',
  };
}

@Injectable()
export class RuntimeConfig {
  readonly values = validateEnvironment(process.env);
}
