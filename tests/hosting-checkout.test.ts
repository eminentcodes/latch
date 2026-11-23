import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {CHECKOUT_PROBE, validCheckoutRoot} from '../src/hosting/checkout.js';

const runNode = promisify(execFile);

test('the real discovery command finds a Git checkout beneath the image working directory', async () => {
  const imageRoot = await mkdtemp(join(tmpdir(), 'latch-checkout-'));
  try {
    const checkoutRoot = join(imageRoot, 'sandbox');
    await mkdir(join(checkoutRoot, 'scripts'), {recursive: true});
    await writeFile(join(imageRoot, 'package.json'), JSON.stringify({name: 'image-tools'}));
    await writeFile(join(checkoutRoot, 'package.json'), JSON.stringify({name: 'latch'}));
    await writeFile(join(checkoutRoot, 'scripts/sandbox-bootstrap.mjs'), '');
    const {stdout} = await runNode(process.execPath, ['--input-type=module', '--eval', CHECKOUT_PROBE],
      {cwd: imageRoot, windowsHide: true, timeout: 10_000});
    assert.deepEqual(JSON.parse(stdout), {checkoutRoot: await realpath(checkoutRoot)});
    const fromCheckout = await runNode(process.execPath, ['--input-type=module', '--eval', CHECKOUT_PROBE],
      {cwd: checkoutRoot, windowsHide: true, timeout: 10_000});
    assert.deepEqual(JSON.parse(fromCheckout.stdout), {checkoutRoot: await realpath(checkoutRoot)});
  } finally {
    assert.ok(imageRoot.startsWith(join(tmpdir(), 'latch-checkout-')));
    await rm(imageRoot, {recursive: true, force: true});
  }
});

test('checkout discovery rejects unrelated packages and reports the directories it inspected', async () => {
  const imageRoot = await mkdtemp(join(tmpdir(), 'latch-checkout-missing-'));
  try {
    await mkdir(join(imageRoot, 'other-app', 'scripts'), {recursive: true});
    await writeFile(join(imageRoot, 'other-app', 'package.json'), JSON.stringify({name: 'another-project'}));
    await writeFile(join(imageRoot, 'other-app', 'scripts/sandbox-bootstrap.mjs'), '');
    await assert.rejects(runNode(process.execPath, ['--input-type=module', '--eval', CHECKOUT_PROBE],
      {cwd: imageRoot, windowsHide: true, timeout: 10_000}), (error: unknown) => {
      const result = error as {code?: number; stderr?: string};
      assert.equal(result.code, 1);
      assert.ok(result.stderr?.includes('The pinned Latch checkout was not found'));
      assert.ok(result.stderr?.includes('other-app'));
      return true;
    });
    assert.equal(validCheckoutRoot('/vercel/sandbox'), true);
    assert.equal(validCheckoutRoot('/vercel'), true);
    assert.equal(validCheckoutRoot('/vercel/../other'), false);
    assert.equal(validCheckoutRoot('/vercel/sandbox\n'), false);
    assert.equal(validCheckoutRoot('/tmp/other'), false);
  } finally {
    assert.ok(imageRoot.startsWith(join(tmpdir(), 'latch-checkout-missing-')));
    await rm(imageRoot, {recursive: true, force: true});
  }
});
