#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, realpath, stat} from 'node:fs/promises';
import {isAbsolute, resolve, sep} from 'node:path';
import {unzipSync} from 'fflate';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha256 = /^[a-f0-9]{64}$/;
const maxBytes = 110 * 1024 * 1024;

function safePath(name) {
  assert.equal(typeof name, 'string', 'Evidence paths must be strings.');
  assert.ok(name && !isAbsolute(name) && !/[\\?#\x00-\x1f]/.test(name)
    && name.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe evidence path: ' + name);
  return name;
}

async function openEvidence(input) {
  if (/^https?:\/\//i.test(input)) {
    const base = new URL(input.endsWith('manifest.json') ? input.slice(0, -13) : input.replace(/\/?$/, '/'));
    assert.ok(!base.username && !base.password && !base.search && !base.hash, 'Use an evidence directory URL without credentials or query parameters.');
    return async name => {
      const url = new URL(safePath(name), base);
      assert.ok(url.href.startsWith(base.href), 'Evidence URL escaped its directory.');
      const response = await fetch(url, {signal: AbortSignal.timeout(60_000)});
      assert.equal(response.status, 200, 'Evidence download failed: ' + name + ' (HTTP ' + response.status + ').');
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.ok(bytes.length <= maxBytes, 'Evidence file exceeds the size limit.');
      return bytes;
    };
  }
  const path = await realpath(resolve(input));
  const info = await stat(path);
  if (info.isDirectory()) return async name => {
    const actual = await realpath(resolve(path, safePath(name)));
    assert.ok(actual.startsWith(path + sep), 'Evidence file escaped its directory.');
    const file = await stat(actual);
    assert.ok(file.isFile() && file.size <= maxBytes, 'Evidence must be a bounded regular file.');
    return readFile(actual);
  };
  assert.ok(info.isFile() && info.size <= maxBytes && /\.zip$/i.test(path), 'Choose a report directory, evidence ZIP or report directory URL.');
  const archive = unzipSync(await readFile(path));
  let bytes = 0;
  for (const [name, value] of Object.entries(archive)) {
    if (name.endsWith('/') && !value.length) continue;
    safePath(name);
    bytes += value.length;
    assert.ok(bytes <= maxBytes, 'Uncompressed evidence exceeds the size limit.');
  }
  return async name => {
    const value = archive[safePath(name)];
    assert.ok(value, 'Evidence ZIP is missing ' + name + '.');
    return Buffer.from(value);
  };
}

function checkRun(run, expectedVerdict) {
  assert.equal(run.version, 1, 'Unsupported run version.');
  assert.match(run.id, /^[a-f0-9-]{36}$/, 'Run ID is missing.');
  assert.ok(['local', 'kane'].includes(run.engine), 'Unknown permission engine.');
  assert.ok(['vulnerable', 'secure', 'deny-all'].includes(run.mode), 'Unknown fixture mode.');
  assert.match(run.contractHash, sha256, 'Contract hash is missing.');
  for (const key of ['fixtureHash', 'scenarioHash', 'verifierHash']) assert.match(run.inputs?.[key], sha256, 'Missing verification fingerprint: ' + key);
  assert.equal(run.verdict, expectedVerdict, 'Unexpected run verdict.');
  assert.ok(Number.isInteger(run.expectedCases) && run.expectedCases > 0, 'Expected case count is missing.');
  assert.equal(run.cases?.length, run.expectedCases, 'The report is missing declared cases.');
  const ids = new Set();
  for (const item of run.cases) {
    assert.ok(item.check?.id && !ids.has(item.check.id), 'A case is missing or duplicated.');
    ids.add(item.check.id);
    assert.ok(['allow', 'deny'].includes(item.check.expect), 'Unknown permission expectation.');
    assert.ok(['read', 'update'].includes(item.check.action), 'Unknown protected action.');
    assert.equal(item.driver?.engine, run.engine, 'Case engine differs from the run.');
    assert.equal(item.driver.terminal, true, 'A browser run did not finish.');
    assert.ok(['passed', 'failed'].includes(item.driver.state), 'Tool failure or timeout cannot establish a repair.');
    assert.ok(item.observation, 'A protected request was not observed.');
    const observation = item.observation;
    assert.equal(observation.resource, item.check.resource, 'Observed resource differs from the case.');
    assert.equal(observation.action, item.check.action, 'Observed operation differs from the case.');
    assert.ok(observation.actor, 'Observed identity is missing.');
    assert.match(observation.beforeHash, sha256, 'Missing data hash before the request.');
    assert.match(observation.afterHash, sha256, 'Missing data hash after the request.');
    assert.ok(item.driver.evidence?.some(file => file.kind === 'screenshot'), 'The case has no browser screenshot.');
    const successful = observation.status >= 200 && observation.status < 300;
    const changed = observation.beforeHash !== observation.afterHash;
    if (item.verdict === 'passed') {
      assert.equal(item.driver.state, 'passed', 'A passing case has a failed browser assertion.');
      if (item.check.expect === 'deny') {
        assert.ok([401, 403, 404].includes(observation.status), 'Forbidden operation did not return a denial.');
        assert.equal(observation.disclosed, false, 'Forbidden operation disclosed protected content.');
        assert.equal(changed, false, 'Forbidden operation changed protected data.');
      } else {
        assert.equal(successful, true, 'Allowed operation did not succeed.');
        if (item.check.action === 'read') assert.equal(observation.disclosed, true, 'Allowed read did not return the document.');
        if (item.check.action === 'update') assert.equal(changed, true, 'Allowed update did not change the document.');
      }
    } else {
      assert.equal(item.verdict, 'failed', 'Incomplete case cannot establish a repair.');
      assert.equal(item.check.expect, 'deny', 'Original failure is not a forbidden-operation regression.');
      assert.ok(successful || observation.disclosed || changed, 'Original failure has no observed permission violation.');
    }
  }
  if (expectedVerdict === 'passed') assert.ok(run.cases.every(item => item.verdict === 'passed'), 'The repaired run contains a failed case.');
  else assert.ok(run.cases.some(item => item.verdict === 'failed'), 'The original run has no actual failure.');
}

async function verify(input) {
  const get = await openEvidence(input);
  const manifest = JSON.parse((await get('manifest.json')).toString('utf8'));
  assert.ok(manifest.kind === 'recorded-native-source-repair' || manifest.format === 'latch-live-evidence-v1', 'Unsupported evidence manifest.');
  const entries = Array.isArray(manifest.files) ? manifest.files
    : Object.entries(manifest.files ?? {}).map(([path, sha256]) => ({path, sha256}));
  assert.ok(entries.length > 0 && entries.length <= 1000, 'The manifest must list a bounded set of files.');
  const verified = new Map();
  let totalBytes = 0;
  for (const entry of entries) {
    safePath(entry.path);
    assert.match(entry.sha256, sha256, 'Invalid file digest: ' + entry.path);
    assert.ok(!verified.has(entry.path), 'Duplicate manifest path: ' + entry.path);
    verified.set(entry.path, null);
  }
  // Small batches keep public-host requests bounded while checking every file.
  for (let offset = 0; offset < entries.length; offset += 4) {
    const batch = await Promise.all(entries.slice(offset, offset + 4).map(async entry => {
      const bytes = await get(entry.path);
      assert.equal(hash(bytes), entry.sha256, 'SHA-256 mismatch: ' + entry.path);
      if (entry.bytes !== undefined) assert.equal(bytes.length, entry.bytes, 'Byte-length mismatch: ' + entry.path);
      return [entry.path, bytes];
    }));
    for (const [path, bytes] of batch) {
      totalBytes += bytes.length;
      assert.ok(totalBytes <= maxBytes, 'Evidence exceeds the size limit.');
      verified.set(path, bytes);
    }
  }
  const json = name => {
    assert.ok(verified.get(name), 'Manifest does not cover ' + name + '.');
    return JSON.parse(verified.get(name).toString('utf8'));
  };
  const before = json('before-run.json');
  const after = json('run.json');
  checkRun(before, 'failed');
  checkRun(after, 'passed');
  assert.notEqual(before.id, after.id, 'Before and after reuse the same run ID.');
  for (const key of ['contractHash', 'engine', 'mode', 'expectedCases', 'inputs']) assert.deepEqual(before[key], after[key], 'Verification input changed: ' + key);
  assert.deepEqual(before.cases.map(item => item.check), after.cases.map(item => item.check), 'Permission cases changed after repair.');
  for (const run of [before, after]) for (const item of run.cases) {
    for (const evidence of item.driver.evidence) if (evidence.kind !== 'kane-pack') {
      assert.ok(verified.get(safePath(evidence.path))?.length, 'Manifest is missing case evidence: ' + evidence.path);
    }
  }
  for (const [index, item] of after.cases.entries()) {
    assert.equal(before.cases[index].observation.actor, item.observation.actor, 'Observed identity changed between runs.');
    if (item.check.expect === 'deny') assert.ok(after.cases.some(control => control.check.id === item.controlId
      && control.check.expect === 'allow' && control.check.resource === item.check.resource
      && control.check.action === item.check.action && control.verdict === 'passed'), 'Forbidden case is missing its passing allowed-user control.');
  }
  const patch = json('application-patch.json');
  assert.equal(patch.format, 'latch-file-patch-v1', 'Unsupported application patch.');
  assert.ok(Array.isArray(patch.files) && patch.files.length > 0, 'Application patch is empty.');
  assert.equal(patch.files.length, after.repair?.files?.length, 'Patch differs from repaired-source metadata.');
  const changed = new Set();
  for (const file of patch.files) {
    safePath(file.path);
    assert.ok(!changed.has(file.path), 'Application patch repeats a file.');
    changed.add(file.path);
    const repair = after.repair.files.find(item => item.path === file.path);
    assert.ok(repair, 'Patch file is missing from repaired-source metadata.');
    assert.match(file.beforeHash, sha256);
    assert.equal(repair.beforeHash, file.beforeHash, 'Original source hash differs from the patch.');
    assert.equal(repair.afterHash, hash(Buffer.from(file.content)), 'Repaired source differs from the supplied patch.');
    assert.notEqual(repair.beforeHash, repair.afterHash, 'Application patch changes no source.');
    if (file.path === 'demo/policy.ts' && verified.has('original-policy.ts.txt')) {
      assert.equal(hash(verified.get('original-policy.ts.txt')), repair.beforeHash, 'Original policy snapshot differs from the patch.');
      assert.equal(hash(verified.get('repaired-policy.ts.txt')), repair.afterHash, 'Repaired policy snapshot differs from the patch.');
    }
  }
  if (manifest.sourceRunIds) {
    assert.deepEqual(manifest.sourceRunIds, {before: before.id, after: after.id}, 'Manifest names different runs.');
    assert.equal(manifest.contractHash, after.contractHash);
    assert.deepEqual(manifest.inputs, after.inputs);
    assert.deepEqual(manifest.repair, after.repair);
  }
  return {evidence: input, kind: manifest.kind ?? manifest.format, verifiedFiles: entries.length,
    verifiedBytes: totalBytes, engine: after.engine, beforeRun: before.id, afterRun: after.id,
    originalFailures: before.cases.filter(item => item.verdict === 'failed').length,
    repairedPasses: after.cases.length, sameContractAndInputs: true, sourcePatchVerified: true,
    note: 'Checks exported bytes and recorded observations. The manifest is not signed; run fresh browser checks to independently reproduce the behavior.'};
}

const input = process.argv[2];
if (!input || process.argv.length !== 3 || input === '--help') {
  console.log('Usage: node scripts/verify-evidence.mjs <report-directory | evidence.zip | report-directory-URL>');
  if (!input || process.argv.length !== 3) process.exitCode = 2;
} else {
  try {console.log(JSON.stringify(await verify(input), null, 2));}
  catch (error) {console.error('Evidence verification failed: ' + error.message); process.exitCode = 1;}
}
