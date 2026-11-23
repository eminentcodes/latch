import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { evidenceArchive, publicRun } from '../src/hosting/evidence.js';
import type { RunResult } from '../src/types.js';

test('a public native report preserves observations and screenshots while omitting account links and raw packs', async () => {
  const run = JSON.parse(await readFile('evidence/native-repair/run.json', 'utf8')) as RunResult;
  run.cases[0]!.driver.testUrl = 'https://private.invalid/account-share';
  run.cases[0]!.driver.evidence.push({kind: 'kane-pack', path: 'private.evidence', label: 'Private raw pack'});
  const exported = publicRun(run);
  assert.equal(exported.verdict, run.verdict);
  assert.deepEqual(exported.inputs, run.inputs);
  assert.deepEqual(exported.cases.map(item => item.observation), run.cases.map(item => item.observation));
  assert.equal(exported.cases[0]!.driver.testUrl, undefined);
  assert.equal(exported.cases[0]!.driver.evidence.some(item => item.kind === 'kane-pack'), false);
  assert.deepEqual(exported.cases[0]!.driver.evidence.filter(item => item.kind === 'screenshot'), run.cases[0]!.driver.evidence.filter(item => item.kind === 'screenshot'));
});

test('downloaded evidence has verifiable hashes and retains genuine screenshot bytes', async () => {
  await mkdir(resolve('.cache'), {recursive: true});
  const cache = await realpath(resolve('.cache'));
  const folder = join(cache, `cloud-export-${randomUUID()}`);
  await mkdir(folder);
  const run = JSON.parse(await readFile('evidence/native-repair/run.json', 'utf8')) as RunResult;
  run.cases[0]!.driver.testUrl = 'https://private.invalid/account-share';
  const screenshot = run.cases[0]!.driver.evidence.find(item => item.kind === 'screenshot')!;
  const pixels = await readFile(join('evidence/native-repair', screenshot.path));
  run.cases[0]!.driver.evidence = [{...screenshot, path: 'genuine.png'}, {kind: 'kane-pack', path: 'private.evidence', label: 'Raw pack'}];
  try {
    await writeFile(join(folder, 'run.json'), JSON.stringify(run));
    await writeFile(join(folder, 'index.html'), 'This is regenerated from run.json.');
    await writeFile(join(folder, 'genuine.png'), pixels);
    await writeFile(join(folder, 'private.evidence'), 'A test-only private vendor pack');
    await writeFile(join(folder, 'kane-diagnostics.txt'), 'Private diagnostic fixture');
    const files = unzipSync(await evidenceArchive(folder));
    assert.deepEqual(Buffer.from(files['genuine.png']!), pixels);
    assert.equal(files['private.evidence'], undefined);
    assert.equal(files['kane-diagnostics.txt'], undefined);
    assert.equal(Buffer.from(files['index.html']!).toString().includes('private.invalid'), false);
    const manifest = JSON.parse(Buffer.from(files['manifest.json']!).toString()) as {files: Record<string, string>; privateKanePacks: Record<string, string>};
    for (const [name, hash] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(files[name]!).digest('hex'), hash);
    assert.ok(manifest.privateKanePacks['private.evidence']);
  } finally {
    const target = await realpath(folder);
    assert.ok(target.startsWith(cache + sep));
    await rm(target, {recursive: true, force: true});
  }
});
