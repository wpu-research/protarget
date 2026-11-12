import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./upload-loader.mjs', import.meta.url);
const { uploadCreative, UPLOAD_ABORTED } = await import('../src/lib/upload.ts');
const { renew } = await import('./upload-client-stub.mjs');

const STALL = 2 * 60 * 1000;
const RESPONSE_WAIT = 12 * 60 * 1000;
const creative = { id: 'c1', code: 'CR-00001', status: 'VALIDATING' };

/** Minimal controllable XMLHttpRequest; instances are collected so a test can drive the transfer by hand. */
class FakeXhr {
  static instances = [];
  constructor() { this.upload = {}; this.aborted = false; this.status = 0; this.responseText = ''; FakeXhr.instances.push(this); }
  open() {}
  send() { this.sentForm = true; }
  abort() { this.aborted = true; this.onabort?.(); }
  progress(loaded, total) { this.upload.onprogress?.({ lengthComputable: true, loaded, total }); }
  bodySent() { this.upload.onload?.(); }
  respond(status, body) { this.status = status; this.responseText = typeof body === 'string' ? body : JSON.stringify(body); this.onload?.(); }
}
const last = () => FakeXhr.instances.at(-1);
const flush = () => new Promise(resolve => setImmediate(resolve));
const form = () => { const data = new FormData(); data.set('file', new File(['x'], 'a.png', { type: 'image/png' })); return data; };

test.beforeEach(() => {
  FakeXhr.instances = [];
  renew.calls = 0; renew.fail = null;
  globalThis.XMLHttpRequest = FakeXhr;
  globalThis.window = { location: { assign: mock.fn() } };
  mock.timers.enable({ apis: ['setTimeout'] });
});
test.afterEach(() => { mock.timers.reset(); delete globalThis.XMLHttpRequest; delete globalThis.window; });

const settle = promise => promise.then(value => ({ value }), error => ({ error }));

test('a transfer with no progress for 2 minutes is aborted and reported as unavailable (nothing was sent)', async () => {
  const outcome = settle(uploadCreative(form(), () => {}));
  const xhr = last();
  mock.timers.tick(STALL - 1);
  assert.equal(xhr.aborted, false);
  mock.timers.tick(1);
  const { error } = await outcome;
  assert.equal(xhr.aborted, true);
  assert.equal(error.code, 'SERVICE_UNAVAILABLE');
});

test('upload progress re-arms the stall watchdog and is reported as a percentage', async () => {
  const seen = [];
  const outcome = settle(uploadCreative(form(), percent => seen.push(percent)));
  const xhr = last();
  mock.timers.tick(STALL - 1000);
  xhr.progress(25, 100);
  mock.timers.tick(STALL - 1000);
  assert.equal(xhr.aborted, false, 'progress kept the transfer alive past the original deadline');
  xhr.progress(50, 100);
  mock.timers.tick(STALL);
  const { error } = await outcome;
  assert.equal(xhr.aborted, true);
  assert.equal(error.code, 'SERVICE_UNAVAILABLE');
  assert.deepEqual(seen, [0, 25, 50]);
});

test('after the body is out the response wait is 12 minutes and a lost response is "unconfirmed"', async () => {
  const outcome = settle(uploadCreative(form(), () => {}));
  const xhr = last();
  xhr.progress(100, 100);
  xhr.bodySent();
  mock.timers.tick(STALL * 2);
  mock.timers.tick(RESPONSE_WAIT - STALL * 2 - 1);
  assert.equal(xhr.aborted, false, 'the stall watchdog no longer applies once the body is out');
  mock.timers.tick(1);
  const { error } = await outcome;
  assert.equal(xhr.aborted, true);
  assert.equal(error.code, 'UPLOAD_UNCONFIRMED');
});

test('progress events after the body is out do not shorten the response wait', async () => {
  const outcome = settle(uploadCreative(form(), () => {}));
  const xhr = last();
  xhr.bodySent();
  mock.timers.tick(RESPONSE_WAIT - 1000);
  xhr.progress(100, 100);
  mock.timers.tick(1000);
  const { error } = await outcome;
  assert.equal(error.code, 'UPLOAD_UNCONFIRMED');
});

test('a response clears the timers and resolves the creative', async () => {
  const seen = [];
  const outcome = settle(uploadCreative(form(), percent => seen.push(percent)));
  const xhr = last();
  xhr.progress(100, 100);
  xhr.bodySent();
  xhr.respond(201, creative);
  const { value } = await outcome;
  assert.deepEqual(value, creative);
  assert.equal(seen.at(-1), 100);
  mock.timers.tick(RESPONSE_WAIT * 2);
  assert.equal(xhr.aborted, false, 'no timer fires after completion');
});

test('aborting through the signal reports UPLOAD_ABORTED, not a lost connection, and clears the watchdog', async () => {
  const controller = new AbortController();
  const outcome = settle(uploadCreative(form(), () => {}, controller.signal));
  const xhr = last();
  controller.abort();
  const { error } = await outcome;
  assert.equal(error.code, UPLOAD_ABORTED);
  mock.timers.tick(RESPONSE_WAIT * 2);
  assert.equal(FakeXhr.instances.length, 1);
  const already = settle(uploadCreative(form(), () => {}, controller.signal));
  assert.equal((await already).error.code, UPLOAD_ABORTED);
  assert.equal(FakeXhr.instances.length, 1, 'an already-aborted signal never opens a request');
  assert.equal(xhr.aborted, true);
});

test('a 401 renews the session once and sends the form again', async () => {
  const outcome = settle(uploadCreative(form(), () => {}));
  last().bodySent();
  last().respond(401, { error: { code: 'UNAUTHENTICATED' } });
  await flush();
  assert.equal(renew.calls, 1);
  assert.equal(FakeXhr.instances.length, 2);
  last().bodySent();
  last().respond(201, creative);
  assert.deepEqual((await outcome).value, creative);
});

test('a code-less 5xx after the full body is "unconfirmed"; before it, "unavailable"; 413 is its own code', async () => {
  const after = settle(uploadCreative(form(), () => {}));
  last().bodySent(); last().respond(502, 'Bad gateway');
  assert.equal((await after).error.code, 'UPLOAD_UNCONFIRMED');
  const before = settle(uploadCreative(form(), () => {}));
  last().respond(503, '');
  assert.equal((await before).error.code, 'SERVICE_UNAVAILABLE');
  const big = settle(uploadCreative(form(), () => {}));
  last().respond(413, '');
  assert.equal((await big).error.code, 'PAYLOAD_TOO_LARGE');
});

test('a 2xx with an unreadable body is "unconfirmed" and a network error depends on whether the body was out', async () => {
  const garbled = settle(uploadCreative(form(), () => {}));
  last().bodySent(); last().respond(201, 'not json');
  assert.equal((await garbled).error.code, 'UPLOAD_UNCONFIRMED');
  const dropped = settle(uploadCreative(form(), () => {}));
  last().onerror();
  assert.equal((await dropped).error.code, 'SERVICE_UNAVAILABLE');
  const late = settle(uploadCreative(form(), () => {}));
  last().bodySent(); last().onerror();
  assert.equal((await late).error.code, 'UPLOAD_UNCONFIRMED');
});
