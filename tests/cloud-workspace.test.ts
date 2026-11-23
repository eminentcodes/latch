import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import {unzipSync} from 'fflate';
import { startJudgeDemo } from '../src/judge-demo.js';

test('the cloud workspace exposes public URLs, enforces its origin and rejects unconfigured native verification', {timeout: 120_000}, async () => {
  await mkdir(resolve('.cache'), {recursive: true});
  const cache = await realpath(resolve('.cache'));
  const output = join(cache, `cloud-workspace-${randomUUID()}`);
  await mkdir(output);
  const cloud = {workspaceUrl: 'https://workspace.sandbox.test', originalUrl: 'https://original.sandbox.test',
    repairedUrl: 'https://repaired.sandbox.test', homeUrl: 'https://latch.test',
    expiresAt: new Date(Date.now() + 2_700_000).toISOString(), kaneEnabled: false};
  const demo = await startJudgeDemo({projectRoot: process.cwd(), artifactsRoot: output, port: 0, appPort: 0, repairedPort: 0, host: '0.0.0.0', cloud});
  try {
    const html = await (await fetch(demo.url)).text();
    assert.ok(html.includes('href="https://original.sandbox.test/login"'));
    assert.ok(html.includes('href="https://repaired.sandbox.test/login"'));
    assert.ok(html.includes('Native Kane is unavailable'));
    const detail = await (await fetch(demo.url + '/api/demo')).json() as {original: {url: string; mode: string}; repaired: {url: string; mode: string}};
    assert.equal(detail.original.url, cloud.originalUrl);
    assert.equal(detail.repaired.url, cloud.repairedUrl);
    assert.equal(detail.original.mode, detail.repaired.mode);
    const post = (origin: string, engine: string) => fetch(demo.url + '/api/run', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin},
      body: JSON.stringify({engine, compare: false, target: 'repaired'})});
    assert.equal((await post('https://another.test', 'local')).status, 403);
    assert.equal((await post(cloud.workspaceUrl, 'kane')).status, 409);
    assert.equal((await post(cloud.workspaceUrl, 'unsupported')).status, 400);
    assert.equal((await fetch(demo.url + '/health')).status, 200);
    await mkdir(join(output, 'run-1'));
    await writeFile(join(output, 'run-1', 'observation.txt'), 'Actual judge evidence download.');
    const download = await fetch(demo.url + '/download/run-1.zip');
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/zip');
    const archive = new Uint8Array(await download.arrayBuffer());
    assert.equal(Number(download.headers.get('content-length')), archive.byteLength);
    assert.equal(Buffer.from(unzipSync(archive)['observation.txt']!).toString(), 'Actual judge evidence download.');
  } finally {
    await demo.close();
    const target = await realpath(output);
    assert.ok(target.startsWith(cache + sep));
    await rm(target, {recursive: true, force: true});
  }
});
