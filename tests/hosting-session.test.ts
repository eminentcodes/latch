import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { handleSession, type CloudProvider } from '../src/hosting/handler.js';
import { cookieValue, hostingConfig, readTicket, sameOrigin, SESSION_MS, signTicket } from '../src/hosting/session.js';

const ref = 'a'.repeat(40);
const secret = 'an-owner-only-session-signing-key-with-entropy';

test('an early setup process failure is reported, redacted and stopped instead of waiting indefinitely', async () => {
  const nativeKey = 'a-dedicated-native-test-key';
  const signingKey = secret + nativeKey;
  let stopped = 0;
  const connection = {name: 'latch-judge-test', status: 'running', cwd: '/vercel',
    domain: (port: number) => `https://port-${port}.sandbox.test`,
    runCommand: async ({args}: {args: string[]}) => args[0] === '--input-type=module'
      ? {exitCode: 0, stdout: async () => JSON.stringify({checkoutRoot: '/vercel/sandbox'})}
      : {wait: async () => ({exitCode: 1,
        stderr: async () => `Cannot find the bootstrap module. ${nativeKey} ${signingKey}`})},
    stop: async () => {stopped++;}} as unknown as Awaited<ReturnType<CloudProvider['create']>>;
  const cloud: CloudProvider = {create: async () => connection, get: async () => {throw new Error('Unexpected lookup');}};
  const env = {LATCH_DEMO_ENABLED: 'true', LATCH_SESSION_SECRET: signingKey, LT_ACCESS_KEY: nativeKey};
  const server = createServer((request, response) => {void handleSession(request, response, {sourceRef: ref, env, cloud});});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(url, {method: 'POST', headers: {Origin: url}});
    assert.equal(response.status, 502);
    const data = await response.json() as {error: string; details: string};
    assert.equal(data.error, 'The demo setup process stopped before its workspace started.');
    assert.ok(data.details.includes('Cannot find the bootstrap module.'));
    assert.ok(!data.details.includes(nativeKey));
    assert.ok(!data.details.includes(secret));
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(stopped, 1);
  } finally {await new Promise<void>(resolve => {server.close(() => resolve()); server.closeAllConnections();});}
});

test('bootstrap and later signed-session requests use the discovered checkout rather than the image directory', async () => {
  const checkoutRoot = '/vercel/sandbox';
  const commands: Array<{cwd: string; args: string[]}> = [];
  const reads: Array<{cwd: string; path: string}> = [];
  let allocations = 0;
  const connection = {name: 'latch-judge-checkout', status: 'running', cwd: '/vercel',
    domain: (port: number) => `https://port-${port}.sandbox.test`,
    runCommand: async (options: {cwd: string; args: string[]}) => {
      commands.push(options);
      if (options.args[0] === '--input-type=module') {
        return {exitCode: 0, stdout: async () => JSON.stringify({checkoutRoot})};
      }
      return {wait: async ({signal}: {signal: AbortSignal}) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {once: true});
      })};
    },
    readFileToBuffer: async (options: {cwd: string; path: string}) => {
      reads.push(options);
      return Buffer.from(JSON.stringify({state: 'ready', message: 'The demo is ready.'}));
    },
    stop: async () => {}} as unknown as Awaited<ReturnType<CloudProvider['create']>>;
  const cloud: CloudProvider = {create: async () => {allocations++; return connection;}, get: async () => connection};
  const env = {LATCH_DEMO_ENABLED: 'true', LATCH_SESSION_SECRET: secret};
  const server = createServer((request, response) => {void handleSession(request, response, {sourceRef: ref, env, cloud});});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const post = (cookie?: string) => fetch(url, {method: 'POST', headers: {Origin: url,
      ...(cookie ? {Cookie: cookie} : {})}});
    const response = await post();
    assert.equal(response.status, 202);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    assert.equal(readTicket(cookieValue(cookie), secret, ref)?.checkoutRoot, checkoutRoot);
    assert.equal(commands[0]!.cwd, '/vercel');
    assert.equal(commands[1]!.cwd, checkoutRoot);
    assert.deepEqual(commands[1]!.args, ['scripts/sandbox-bootstrap.mjs']);
    const status = await fetch(url, {headers: {Cookie: cookie}});
    assert.equal(status.status, 200);
    assert.equal((await status.json() as {state: string}).state, 'ready');
    assert.equal((await post(cookie)).status, 200);
    assert.equal(allocations, 1);
    assert.deepEqual(reads, [
      {path: '.cache/latch-cloud-state.json', cwd: checkoutRoot},
      {path: '.cache/latch-cloud-state.json', cwd: checkoutRoot}
    ]);
  } finally {await new Promise<void>(resolve => {server.close(() => resolve()); server.closeAllConnections();});}
});

test('public cloud sessions need only owner configuration and a published revision, with no visitor code', () => {
  assert.equal(hostingConfig({}, ref, 'https://latch.test').enabled, false);
  assert.equal(hostingConfig({LATCH_DEMO_ENABLED: 'true', LATCH_SESSION_SECRET: 'short'}, ref, 'https://latch.test').enabled, false);
  assert.equal(hostingConfig({LATCH_DEMO_ENABLED: 'true', LATCH_SESSION_SECRET: secret}, 'main', 'https://latch.test').enabled, false);
  const env = {LATCH_DEMO_ENABLED: 'true', LATCH_SESSION_SECRET: secret, LATCH_KANE_ENABLED: 'true', LT_USERNAME: 'test-user'};
  const config = hostingConfig(env, ref, 'https://latch.test');
  assert.equal(config.enabled, true);
  assert.equal(hostingConfig({...env, LATCH_SESSION_SECRET: ''}, ref, 'https://latch.test').enabled, false);
  assert.equal(config.kaneEnabled, false);
  assert.equal(hostingConfig({...env, LT_ACCESS_KEY: 'dedicated-test-key'}, ref, 'https://latch.test').kaneEnabled, true);
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
  assert.equal(readTicket(signTicket(ticket, 'a-public-placeholder-key'), secret, ref, now), null);
  for (const checkoutRoot of ['/tmp/latch', '/vercel/../outside', '/vercel/sandbox/./child', '/vercel/sandbox\n']) {
    assert.equal(readTicket(signTicket({...ticket, checkoutRoot}, secret), secret, ref, now), null);
  }
});

test('cross-origin browser requests cannot create or stop a cloud session', () => {
  assert.equal(sameOrigin('https://latch.test', 'latch.test'), true);
  assert.equal(sameOrigin('https://another.test', 'latch.test'), false);
  assert.equal(sameOrigin('javascript://latch.test', 'latch.test'), false);
  assert.equal(sameOrigin(undefined, 'latch.test'), true);
});

test('disabled, cross-origin and unsupported HTTP requests allocate no cloud resources', async () => {
  let allocations = 0;
  const cloud: CloudProvider = {create: async () => {allocations++; throw new Error('Unexpected allocation');},
    get: async () => {throw new Error('Unexpected lookup');}};
  const env = {LATCH_DEMO_ENABLED: 'true', LATCH_SESSION_SECRET: secret};
  const server = createServer((request, response) => {void handleSession(request, response, {sourceRef: ref, env, cloud});});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const post = (origin = url) => fetch(url, {method: 'POST', headers: {Origin: origin}});
    assert.equal((await post('https://another.test')).status, 403);
    assert.equal((await fetch(url, {method: 'DELETE', headers: {Origin: url}})).status, 401);
    assert.equal((await fetch(url, {method: 'PUT'})).status, 405);
    const status = await (await fetch(url)).json() as Record<string, unknown>;
    assert.equal(status.enabled, true);
    assert.equal(status.state, 'idle');
    assert.equal(JSON.stringify(status).includes(secret), false);
    env.LATCH_DEMO_ENABLED = 'false';
    assert.equal((await post()).status, 503);
    assert.equal(allocations, 0);
  } finally {await new Promise<void>(resolve => {server.close(() => resolve()); server.closeAllConnections();});}
});

test('public launches ignore visitor-supplied source and lifetime even with Vercel pre-parsed JSON', async () => {
  let allocation: Parameters<CloudProvider['create']>[0] | undefined;
  const cloud: CloudProvider = {create: async options => {allocation = options; throw new Error('No cloud is allocated by this test');},
    get: async () => {throw new Error('Unexpected lookup');}};
  const env = {LATCH_DEMO_ENABLED: 'true', LATCH_SESSION_SECRET: secret};
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    Object.assign(request, {body: JSON.parse(raw)});
    await handleSession(request, response, {sourceRef: ref, env, cloud});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const post = () => fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: url},
      body: JSON.stringify({sourceRef: 'main', repository: 'https://another.invalid/repo', timeout: 999_999_999})});
    assert.equal((await post()).status, 502);
    assert.equal(allocation!.source!.type, 'git');
    assert.equal((allocation!.source as {url: string; revision: string}).url, 'https://github.com/eminentcodes/latch.git');
    assert.equal((allocation!.source as {url: string; revision: string}).revision, ref);
    assert.equal(allocation!.timeout, SESSION_MS);
    assert.equal(allocation!.persistent, false);
    assert.deepEqual(allocation!.ports, [4317, 4318, 4319]);
  } finally {await new Promise<void>(resolve => {server.close(() => resolve()); server.closeAllConnections();});}
});
