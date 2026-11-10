import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { proxyAddressHeaders } from '../../apps/web/src/lib/proxy-address.ts';

const secret = randomBytes(48).toString('base64url');
const env = { PROXY_SHARED_SECRET: secret, TRUSTED_INGRESS: 'railway', RAILWAY_ENVIRONMENT_ID: 'test-only' };
const path = '/api/v1/auth/login';
test('signs only Railway X-Real-IP, replacing all caller-provided proxy identities', () => {
  const headers = proxyAddressHeaders(new Request(`https://panel.test${path}`, { method: 'POST', headers: {
    'x-real-ip': '198.51.100.23', 'x-forwarded-for': '198.51.100.24',
    'x-protarget-client-ip': '198.51.100.25', 'x-protarget-proxy-signature': 'forged',
  } }), path, env);
  assert.equal(headers['x-protarget-client-ip'], '198.51.100.23');
  assert.equal(headers['x-protarget-proxy-signature'], createHmac('sha256', secret)
    .update(`${headers['x-protarget-proxy-time']}\n198.51.100.23\nPOST\n${path}`).digest('hex'));
  assert.equal(headers['x-forwarded-for'], undefined);
});
test('fails closed with absent/ambiguous IP, missing secret or wrong ingress', () => {
  for (const ip of ['', '198.51.100.1, 198.51.100.2', 'not-an-ip']) {
    assert.throws(() => proxyAddressHeaders(new Request('https://panel.test', {
      headers: { 'x-real-ip': ip },
    }), path, env));
  }
  const request = new Request('https://panel.test', { headers: { 'x-real-ip': '198.51.100.1' } });
  assert.throws(() => proxyAddressHeaders(request, path, { ...env, PROXY_SHARED_SECRET: '' }));
  assert.throws(() => proxyAddressHeaders(request, path, { ...env, TRUSTED_INGRESS: '' }));
  assert.throws(() => proxyAddressHeaders(request, path, { ...env, RAILWAY_ENVIRONMENT_ID: '' }));
  assert.deepEqual(proxyAddressHeaders(request, path, {}), {});
});
