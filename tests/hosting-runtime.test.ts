import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

const runNode = promisify(execFile);

test('the session handler serves HTTP when CommonJS cannot require ES modules', async () => {
  const handler = new URL('../src/hosting/handler.js', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { createServer } from 'node:http';
    const { handleSession } = await import(${JSON.stringify(handler)});
    const sourceRef = 'a'.repeat(40);
    const env = { LATCH_DEMO_ENABLED: 'true',
      LATCH_SESSION_SECRET: 'an-owner-only-session-signing-key-with-entropy' };
    const server = createServer((request, response) => {
      void handleSession(request, response, { sourceRef, env }).catch(error => {
        response.writeHead(500); response.end(error.name);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    try {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      const status = await response.json();
      assert.equal(status.enabled, true);
      assert.equal(status.state, 'idle');
      assert.equal(status.sourceRef, sourceRef);
      env.LATCH_DEMO_ENABLED = 'false';
      const rejected = await fetch(url, { method: 'POST', headers: { Origin: url } });
      assert.equal(rejected.status, 503);
      console.log('Session HTTP 200; disabled launch HTTP 503; no cloud session created.');
    } finally {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  `;
  const { stdout } = await runNode(process.execPath,
    ['--no-experimental-require-module', '--input-type=module', '--eval', script],
    { windowsHide: true, timeout: 30_000, env: { ...process.env, NODE_OPTIONS: '' } });
  assert.equal(stdout.trim(), 'Session HTTP 200; disabled launch HTTP 503; no cloud session created.');
});
