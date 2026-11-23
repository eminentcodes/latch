import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { loadContract } from '../src/contract.js';
import { guardedChanges, prepareRepair, validateAllowedPaths } from '../src/repair.js';
import type { CaseResult, RunResult } from '../src/types.js';
import { fingerprintVerification } from '../src/verification-inputs.js';

test('an enforcement edit is allowed while changing a permission expectation is rejected', () => {
  const before = {'demo/policy.ts': 'old-policy', 'examples/permissions.json': 'reviewed', 'demo/data.ts': 'canonical'};
  const valid = {...before, 'demo/policy.ts': 'new-policy'};
  assert.deepEqual(guardedChanges(before, valid, ['demo/policy.ts']), []);
  assert.deepEqual(guardedChanges(before, {...valid, 'examples/permissions.json': 'weakened'}, ['demo/policy.ts']), ['examples/permissions.json']);
});
test('new and deleted protected source files are detected', () => {
  assert.deepEqual(guardedChanges({'src/verdict.ts': 'original'}, {'new-command.ts': 'injected'}, ['demo/policy.ts']).sort(), ['new-command.ts', 'src/verdict.ts']);
});
test('repair cannot allow fixture definitions, verifier code or traversal paths', async () => {
  assert.deepEqual(await validateAllowedPaths(process.cwd(), ['demo/policy.ts']), ['demo/policy.ts']);
  for (const path of ['demo/data.ts', 'src/verdict.ts', 'examples/permissions.json', '../package.json']) {
    await assert.rejects(validateAllowedPaths(process.cwd(), [path]));
  }
});

test('browser-only assertion failures cannot be represented as an observed permission bug', async () => {
  const cacheRoot = resolve('.cache');
  await mkdir(cacheRoot, {recursive: true});
  const directory = join(cacheRoot, `assertion-review-${randomUUID()}`);
  await mkdir(directory);
  try {
    const contractPath = resolve('examples/permissions.json');
    const {contract, hash} = await loadContract(contractPath);
    const cases = contract.checks.map(check => {
      const denied = check.expect === 'deny';
      return {check, verdict: denied ? 'failed' : 'passed', reason: 'Browser assertion state disagreed.',
        observation: {actor: contract.actors.find(actor => actor.id === check.actor)!.fixtureKey,
          resource: check.resource, action: check.action, status: denied ? 403 : 200,
          disclosed: check.action === 'read' && !denied, beforeHash: 'before',
          afterHash: check.action === 'update' && !denied ? 'updated' : 'before'},
        driver: {engine: 'local', state: denied ? 'failed' : 'passed', terminal: true, evidence: []}} as unknown as CaseResult;
    });
    const run = {version: 1, verdict: 'failed', engine: 'local', mode: 'secure', cases,
      expectedCases: cases.length, contractHash: hash, inputs: await fingerprintVerification(process.cwd())} as RunResult;
    const runPath = join(directory, 'run.json');
    await writeFile(runPath, JSON.stringify(run));
    const options = {projectRoot: process.cwd(), contractPath, runPath, outputDir: join(directory, 'review'), allowed: ['demo/policy.ts']};
    await assert.rejects(prepareRepair(options), /observed permissions matched/);
    const leak = run.cases.find(item => item.check.id === 'other-read')!;
    leak.observation!.status = 200;
    leak.observation!.disclosed = true;
    await writeFile(runPath, JSON.stringify(run));
    assert.equal((await prepareRepair(options)).run.verdict, 'failed');
  } finally {
    const target = await realpath(directory);
    assert.ok(target.startsWith(await realpath(cacheRoot) + sep) && basename(target).startsWith('assertion-review-'));
    await rm(target, {recursive: true, force: true});
  }
});
