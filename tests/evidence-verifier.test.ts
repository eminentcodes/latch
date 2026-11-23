import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {join, resolve, sep} from 'node:path';
import test from 'node:test';
import {zipSync} from 'fflate';

test('the independent verifier checks real evidence and rejects altered bytes, cases, inputs and source metadata', {timeout: 90_000}, async () => {
  const root = process.cwd();
  const recorded = resolve(root, 'evidence/native-repair');
  const script = resolve(root, 'scripts/verify-evidence.mjs');
  const run = (path: string) => spawnSync(process.execPath, [script, path], {cwd: root, encoding: 'utf8', timeout: 30_000});
  const original = run(recorded);
  assert.equal(original.status, 0, original.stderr);
  const summary = JSON.parse(original.stdout);
  assert.equal(summary.engine, 'kane');
  assert.equal(summary.originalFailures, 2);
  assert.equal(summary.repairedPasses, 5);
  assert.equal(summary.verifiedFiles, 119);

  const manifest = JSON.parse(await readFile(join(recorded, 'manifest.json'), 'utf8'));
  const files: Record<string, Uint8Array> = {};
  for (const entry of manifest.files) files[entry.path] = await readFile(join(recorded, entry.path));
  const cache = resolve(root, '.cache');
  await mkdir(cache, {recursive: true});
  const directory = join(cache, 'evidence-verifier-' + randomUUID());
  await mkdir(directory);
  const target = await realpath(directory);
  assert.ok(target.startsWith(await realpath(cache) + sep));
  try {
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    const writeArchive = async (name: string, mutations: Record<string, Uint8Array>, updateManifest: boolean) => {
      const archive = {...files, ...mutations};
      const metadata = structuredClone(manifest);
      if (updateManifest) for (const entry of metadata.files) if (mutations[entry.path]) {
        entry.bytes = archive[entry.path]!.length;
        entry.sha256 = digest(archive[entry.path]!);
      }
      archive['manifest.json'] = Buffer.from(JSON.stringify(metadata));
      const path = join(target, name + '.zip');
      await writeFile(path, zipSync(archive, {level: 0}));
      return path;
    };
    const good = run(await writeArchive('valid', {}, false));
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).sameContractAndInputs, true);

    const badBytes = run(await writeArchive('altered-bytes', {'summary.md': Buffer.from('Changed evidence.')}, false));
    assert.equal(badBytes.status, 1);
    assert.match(badBytes.stderr, /SHA-256 mismatch/);

    const after = JSON.parse(Buffer.from(files['run.json']!).toString('utf8'));
    const changedInputs = structuredClone(after);
    changedInputs.inputs.verifierHash = 'a'.repeat(64);
    const badInputs = run(await writeArchive('changed-inputs', {'run.json': Buffer.from(JSON.stringify(changedInputs))}, true));
    assert.equal(badInputs.status, 1);
    assert.match(badInputs.stderr, /Verification input changed: inputs/);

    const missing = structuredClone(after);
    missing.cases.pop();
    const badCases = run(await writeArchive('missing-case', {'run.json': Buffer.from(JSON.stringify(missing))}, true));
    assert.equal(badCases.status, 1);
    assert.match(badCases.stderr, /missing declared cases/);

    const deniedOwner = structuredClone(after);
    deniedOwner.cases[0].observation.status = 403;
    const badControl = run(await writeArchive('denied-owner', {'run.json': Buffer.from(JSON.stringify(deniedOwner))}, true));
    assert.equal(badControl.status, 1);
    assert.match(badControl.stderr, /Allowed operation did not succeed/);

    const patch = JSON.parse(Buffer.from(files['application-patch.json']!).toString('utf8'));
    patch.files[0].content += '\n// Unverified replacement.\n';
    const badPatch = run(await writeArchive('changed-source', {'application-patch.json': Buffer.from(JSON.stringify(patch))}, true));
    assert.equal(badPatch.status, 1);
    assert.match(badPatch.stderr, /Repaired source differs from the supplied patch/);
  } finally {
    assert.ok(target.startsWith(await realpath(cache) + sep));
    await rm(target, {recursive: true, force: true});
  }
});
