import { randomBytes, createHmac } from 'node:crypto';
import { clientAddress } from '../src/common/client-address';
import { validateEnvironment } from '../src/common/runtime-config';

describe('Authenticated proxy client identity', () => {
  const secret = randomBytes(48).toString('base64url');
  const path = '/api/v1/auth/login';
  function request(ip = '198.51.100.1', time = String(Date.now())) {
    return { ip: '127.0.0.1', method: 'POST', path, headers: {
      'x-protarget-client-ip': ip, 'x-protarget-proxy-time': time,
      'x-protarget-proxy-signature': createHmac('sha256', secret)
        .update(`${time}\n${ip}\nPOST\n${path}`).digest('hex'),
    } };
  }
  it('uses independently signed client addresses instead of the shared backend socket', () => {
    expect(clientAddress(request(), secret)).toBe('198.51.100.1');
    expect(clientAddress(request('198.51.100.2'), secret)).toBe('198.51.100.2');
  });
  it('ignores unsigned X-Forwarded-For locally and rejects it in proxy mode', () => {
    const req = { ip: '127.0.0.1', method: 'POST', path, headers: { 'x-forwarded-for': '198.51.100.99' } };
    expect(clientAddress(req)).toBe('127.0.0.1');
    expect(() => clientAddress(req, secret)).toThrow('Trusted proxy required');
  });
  it('rejects changed identities, endpoints, times, malformed addresses and signatures', () => {
    for (const req of [
      { ...request(), path: '/api/v1/auth/refresh' }, { ...request(), method: 'GET' },
      request('198.51.100.1', String(Date.now() - 61000)),
      request('198.51.100.1', String(Date.now() + 61000)), request('not-an-ip'),
      { ...request(), headers: { ...request().headers, 'x-protarget-client-ip': '198.51.100.9' } },
      { ...request(), headers: { ...request().headers, 'x-protarget-proxy-signature': 'a' } },
      { ...request(), headers: { ...request().headers, 'x-protarget-proxy-time': ['123'] } },
    ]) expect(() => clientAddress(req, secret)).toThrow('Trusted proxy required');
  });
  it('normalizes equivalent IPv6 addresses', () => {
    expect(clientAddress(request('2001:0db8:0:0:0:0:0:1'), secret))
      .toBe(clientAddress(request('2001:db8::1'), secret));
  });
  it('requires a distinct strong proxy secret in production and permits explicitly disabled SMTP', () => {
    const env = { NODE_ENV: 'production', WEB_ORIGIN: 'https://panel.example.test',
      DATABASE_URL: 'postgresql://app:pass@localhost/test', JWT_ACCESS_SECRET: secret,
      INVITATIONS_ENABLED: 'false' };
    expect(() => validateEnvironment(env)).toThrow('PROXY_SHARED_SECRET');
    expect(() => validateEnvironment({ ...env, PROXY_SHARED_SECRET: secret })).toThrow('PROXY_SHARED_SECRET');
    expect(validateEnvironment({ ...env, PROXY_SHARED_SECRET: randomBytes(48).toString('base64url') }))
      .toMatchObject({ secureCookies: true, invitationsEnabled: false });
  });
});
