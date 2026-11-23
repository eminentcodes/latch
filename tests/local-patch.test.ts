import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { digest } from '../src/contract.js';
import { executePatchRepair, validateLocalPatch, type LocalPatch } from '../src/repair.js';
import { runSuite } from '../src/runner.js';

const policyPath = 'demo/policy.ts';
async function repairPatch(): Promise<LocalPatch> {
  const source = await readFile(policyPath, 'utf8');
  return {format: 'latch-file-patch-v1', files: [{path: policyPath, beforeHash: digest(source),
    content: source.replace(/^  if \(mode === 'vulnerable'\) return true;\r?\n/gm, '')}]};
}

test('a local patch rejects stale source, undeclared or protected files, duplicate edits and no-op changes', async () => {
  const patch = await repairPatch();
  assert.equal((await validateLocalPatch(process.cwd(), [policyPath], patch)).files[0]!.path, policyPath);
  await assert.rejects(validateLocalPatch(process.cwd(), [policyPath], {...patch, files: [{...patch.files[0], beforeHash: '0'.repeat(64)}]}), /stale/);
  await assert.rejects(validateLocalPatch(process.cwd(), [], patch), /undeclared/);
  await assert.rejects(validateLocalPatch(process.cwd(), [policyPath], {...patch, files: [patch.files[0], patch.files[0]]}), /repeats/);
  await assert.rejects(validateLocalPatch(process.cwd(), [policyPath], {...patch, files: [{...patch.files[0], content: await readFile(policyPath, 'utf8')}]}), /does not change/);
  for (const path of ['demo/data.ts', 'src/scenario.ts', 'examples/permissions.json', 'scripts/browser-check.mjs', 'package.json']) {
    await assert.rejects(validateLocalPatch(process.cwd(), [path], {...patch, files: [{...patch.files[0], path}]}), /cannot change/);
  }
});

// This includes three five-case browser suites, two isolated compilations, and
// evidence copying. Keep the outer allowance above the bounded inner operations.
test('an isolated file repair passes the same browser cases while a deny-everyone patch is rejected', {timeout: 360_000}, async () => {
  const cacheRoot = resolve('.cache');
  await mkdir(cacheRoot, {recursive: true});
  const directory = join(cacheRoot, `local-patch-${randomUUID()}`);
  await mkdir(directory);
  const original = await readFile(policyPath);
  try {
    const contractPath = resolve('examples/permissions.json');
    const beforeDir = join(directory, 'before');
    const before = await runSuite({projectRoot: process.cwd(), contractPath, outputDir: beforeDir, engine: 'local', mode: 'vulnerable'});
    assert.equal(before.verdict, 'failed');
    assert.deepEqual(before.cases.filter(item => item.verdict === 'failed').map(item => item.check.id), ['other-read', 'viewer-update']);
    const patch = await repairPatch();
    const patchPath = join(directory, 'patch.json');
    await writeFile(patchPath, JSON.stringify(patch));
    const options = {projectRoot: process.cwd(), contractPath, runPath: join(beforeDir, 'run.json'), allowed: [policyPath], patchPath};
    const verified = await executePatchRepair({...options, outputDir: join(directory, 'accepted')});
    assert.equal(verified.verdict, 'passed');
    assert.equal(verified.engine, before.engine);
    assert.equal(verified.mode, before.mode);
    assert.equal(verified.contractHash, before.contractHash);
    assert.deepEqual(verified.inputs, before.inputs);
    assert.equal(verified.cases.length, 5);
    assert.equal(verified.repair?.method, 'local-patch');
    assert.equal(verified.repair?.applied, false);
    assert.deepEqual(verified.repair?.files.map(file => file.path), [policyPath]);
    assert.notEqual(verified.repair?.files[0]?.beforeHash, verified.repair?.files[0]?.afterHash);
    for (const item of verified.cases.filter(item => item.check.expect === 'deny')) {
      assert.equal(item.observation?.status, 403);
      assert.equal(item.observation?.beforeHash, item.observation?.afterHash);
    }
    const copiedBefore = JSON.parse(await readFile(join(directory, 'accepted/before-run.json'), 'utf8'));
    const screenshot = copiedBefore.cases[1].driver.evidence.find((evidence: {kind: string}) => evidence.kind === 'screenshot');
    assert.ok((await readFile(join(directory, 'accepted', screenshot.path))).length > 0);
    assert.deepEqual(await readFile(policyPath), original);
    patch.files[0]!.content = patch.files[0]!.content.replace('return actor.workspace === document.workspace;', 'return false;')
      .replace("return actor.workspace === document.workspace && actor.role === 'editor';", 'return false;');
    await writeFile(patchPath, JSON.stringify(patch));
    await assert.rejects(executePatchRepair({...options, outputDir: join(directory, 'rejected')}), /did not pass the original/);
    const rejected = JSON.parse(await readFile(join(directory, 'rejected/run.json'), 'utf8'));
    assert.equal(rejected.verdict, 'failed');
    assert.equal(rejected.cases.find((item: {check: {id: string}}) => item.check.id === 'owner-read').verdict, 'failed');
    assert.deepEqual(await readFile(policyPath), original);
  } finally {
    const target = await realpath(directory);
    assert.ok(target.startsWith(await realpath(cacheRoot) + sep) && basename(target).startsWith('local-patch-'));
    await rm(target, {recursive: true, force: true});
  }
});
