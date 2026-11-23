import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import test from 'node:test';
import { fingerprintVerification, sameVerificationInputs } from '../src/verification-inputs.js';

test('a policy repair preserves verification identity while fixture and scenario changes invalidate it', async () => {
  const tempRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(tempRoot, 'latch-inputs-'));
  try {
    for (const path of ['demo', 'src', 'package.json', 'package-lock.json', 'tsconfig.json']) {
      await cp(join(process.cwd(), path), join(root, path), {recursive: true});
    }
    const original = await fingerprintVerification(root);
    await writeFile(join(root, 'demo/policy.ts'), '// candidate enforcement repair\n');
    assert.equal(sameVerificationInputs(original, await fingerprintVerification(root)), true);
    const scenarioPath = join(root, 'src/scenario.ts');
    const scenario = await readFile(scenarioPath);
    await writeFile(scenarioPath, '// weakened browser check\n');
    assert.equal(sameVerificationInputs(original, await fingerprintVerification(root)), false);
    await writeFile(scenarioPath, scenario);
    await writeFile(join(root, 'demo/data.ts'), '// changed identities or protected document\n');
    assert.equal(sameVerificationInputs(original, await fingerprintVerification(root)), false);
  } finally {
    const target = await realpath(root);
    assert.ok(target.startsWith(tempRoot + sep) && basename(target).startsWith('latch-inputs-'));
    await rm(target, {recursive: true, force: true});
  }
});

test('old or incomplete run fingerprints cannot claim that verification inputs stayed fixed', async () => {
  const inputs = await fingerprintVerification(process.cwd());
  assert.equal(sameVerificationInputs(undefined, inputs), false);
  assert.equal(sameVerificationInputs({...inputs, verifierHash: ''}, inputs), false);
});
