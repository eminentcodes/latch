import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { handleSession, type CloudProvider } from '../src/hosting/handler.js';
import { hostingConfig, matchesAccessCode, readTicket, sameOrigin, SESSION_MS, signTicket } from '../src/hosting/session.js';

const ref = 'a'.repeat(40);
const code = 'a-private-judge-code';
const secret = 'an-owner-only-session-signing-key-with-entropy';

test('cloud sessions require explicit enabling, a long access code and a published revision', () => {
  assert.equal(hostingConfig({}, ref, 'https://latch.test').enabled, false);
  assert.equal(hostingConfig({LATCH_DEMO_ENABLED: 'true', LATCH_DEMO_ACCESS_CODE: 'short'}, ref, 'https://latch.test').enabled, false);
  assert.equal(hostingConfig({LATCH_DEMO_ENABLED: 'true', LATCH_DEMO_ACCESS_CODE: code}, 'main', 'https://latch.test').enabled, false);
  const env = {LATCH_DEMO_ENABLED: 'true', LATCH_DEMO_ACCESS_CODE: code, LATCH_SESSION_SECRET: secret, LATCH_KANE_ENABLED: 'true', LT_USERNAME: 'test-user'};
  const config = hostingConfig(env, ref, 'https://latch.test');
  assert.equal(config.enabled, true);
  assert.equal(hostingConfig({...env, LATCH_DEMO_ACCESS_CODE: secret}, ref, 'https://latch.test').enabled, false);
  assert.equal(config.kaneEnabled, false);
  assert.equal(hostingConfig({...env, LT_ACCESS_KEY: 'dedicated-test-key'}, ref, 'https://latch.test').kaneEnabled, true);
  assert.equal(matchesAccessCode(code, code), true);
  assert.equal(matchesAccessCode('wrong', code), false);
  assert.equal(matchesAccessCode(null, code), false);
});

test('session tickets reject tampering, expiry, another revision and unbounded lifetimes', () => {
  const now = 1_000_000;
  const ticket = {name: 'latch-judge-test', sourceRef: ref, expiresAt: now + SESSION_MS};
  const signed = signTicket(ticket, secret);
  assert.deepEqual(readTicket(signed, secret, ref, now), ticket);
  assert.equal(readTicket(signed.slice(0, -1) + '!', secret, ref, now), null);
  assert.equal(readTicket('e30.' + '\u00e9'.repeat(43), secret, ref, now), null);
  assert.equal(readTicket(signed, 'another-owner-only-private-session-key', ref, now), null);
  assert.equal(readTicket(signed, secret, 'b'.repeat(40), now), null);
  assert.equal(readTicket(signed, secret, ref, ticket.expiresAt), null);
  assert.equal(readTicket(signTicket({...ticket, expiresAt: now + SESSION_MS + 1}, secret), secret, ref, now), null);
  assert.equal(readTicket(signTicket(ticket, code), secret, ref, now), null);
});

test('cross-origin browser requests cannot create or stop a cloud session', () => {
  assert.equal(sameOrigin('https://latch.test', 'latch.test'), true);
  assert.equal(sameOrigin('https://another.test', 'latch.test'), false);
  assert.equal(sameOrigin('javascript://latch.test', 'latch.test'), false);
  assert.equal(sameOrigin(undefined, 'latch.test'), true);
});

test('disabled, wrong-code and cross-origin HTTP requests allocate no cloud resources', async () => {
  let allocations = 0;
  const cloud: CloudProvider = {create: async () => {allocations++; throw new Error('Unexpected allocation');},
    get: async () => {throw new Error('Unexpected lookup');}};
  const env = {LATCH_DEMO_ENABLED: 'true', LATCH_DEMO_ACCESS_CODE: code, LATCH_SESSION_SECRET: secret};
  const server = createServer((request, response) => {void handleSession(request, response, {sourceRef: ref, env, cloud});});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const post = (accessCode: string, origin = url) => fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin}, body: JSON.stringify({accessCode})});
    assert.equal((await post('wrong-code')).status, 401);
    assert.equal((await post(code, 'https://another.test')).status, 403);
    const status = await (await fetch(url)).json() as Record<string, unknown>;
    assert.equal(status.enabled, true);
    assert.equal(status.state, 'idle');
    assert.equal(JSON.stringify(status).includes(code), false);
    env.LATCH_DEMO_ENABLED = 'false';
    assert.equal((await post(code)).status, 503);
    assert.equal(allocations, 0);
  } finally {await new Promise<void>(resolve => {server.close(() => resolve()); server.closeAllConnections();});}
});

test('Vercel pre-parsed JSON preserves the code gate and the server-selected source and lifetime', async () => {
  let allocation: Parameters<CloudProvider['create']>[0] | undefined;
  const cloud: CloudProvider = {create: async options => {allocation = options; throw new Error('No cloud is allocated by this test');},
    get: async () => {throw new Error('Unexpected lookup');}};
  const env = {LATCH_DEMO_ENABLED: 'true', LATCH_DEMO_ACCESS_CODE: code, LATCH_SESSION_SECRET: secret};
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    Object.assign(request, {body: JSON.parse(raw)});
    await handleSession(request, response, {sourceRef: ref, env, cloud});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const post = (accessCode: string) => fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: url},
      body: JSON.stringify({accessCode, sourceRef: 'main', repository: 'https://another.invalid/repo', timeout: 999_999_999})});
    assert.equal((await post('wrong-code')).status, 401);
    assert.equal(allocation, undefined);
    assert.equal((await post(code)).status, 502);
    assert.equal(allocation!.source!.type, 'git');
    assert.equal((allocation!.source as {url: string; revision: string}).url, 'https://github.com/eminentcodes/latch.git');
    assert.equal((allocation!.source as {url: string; revision: string}).revision, ref);
    assert.equal(allocation!.timeout, SESSION_MS);
    assert.equal(allocation!.persistent, false);
    assert.deepEqual(allocation!.ports, [4317, 4318, 4319]);
  } finally {await new Promise<void>(resolve => {server.close(() => resolve()); server.closeAllConnections();});}
});
