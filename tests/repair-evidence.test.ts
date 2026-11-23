import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import test from 'node:test';
import { copyRunEvidence } from '../src/repair.js';
import type { RunResult } from '../src/types.js';

test('a repair report keeps the actual before evidence available under its new report root', async () => {
  const tempRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(tempRoot, 'latch-evidence-'));
  try {
    const source = join(root, 'source');
    const destination = join(root, 'report');
    await mkdir(join(source, 'cases', 'other-read'), {recursive: true});
    const bytes = Buffer.from('actual retained browser evidence');
    await writeFile(join(source, 'cases', 'other-read', 'screenshot.jpg'), bytes);
    const run = {cases: [{driver: {evidence: [{kind: 'screenshot', path: 'cases/other-read/screenshot.jpg', label: 'Before evidence'}]}}]} as RunResult;
    const copied = await copyRunEvidence(run, source, destination, 'before-evidence');
    const path = copied.cases[0]!.driver.evidence[0]!.path;
    assert.equal(path, 'before-evidence/cases/other-read/screenshot.jpg');
    assert.deepEqual(await readFile(join(destination, path)), bytes);
    assert.equal(run.cases[0]!.driver.evidence[0]!.path, 'cases/other-read/screenshot.jpg');
  } finally {
    const target = await realpath(root);
    assert.ok(target.startsWith(tempRoot + sep) && basename(target).startsWith('latch-evidence-'));
    await rm(target, {recursive: true, force: true});
  }
});

test('a repair report cannot import traversal paths or write evidence outside its output directory', async () => {
  const tempRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(tempRoot, 'latch-evidence-'));
  try {
    const source = join(root, 'source');
    const destination = join(root, 'report');
    await mkdir(source);
    await writeFile(join(root, 'private.txt'), 'outside the source report');
    const run = {cases: [{driver: {evidence: [{kind: 'screenshot', path: '../private.txt', label: 'Unexpected reference'}]}}]} as RunResult;
    await assert.rejects(copyRunEvidence(run, source, destination), /inside its report directory/);
    await writeFile(join(source, 'image.jpg'), 'retained evidence');
    run.cases[0]!.driver.evidence[0]!.path = 'image.jpg';
    await assert.rejects(copyRunEvidence(run, source, destination, '../../escape'), /inside its report directory/);
  } finally {
    const target = await realpath(root);
    assert.ok(target.startsWith(tempRoot + sep) && basename(target).startsWith('latch-evidence-'));
    await rm(target, {recursive: true, force: true});
  }
});
