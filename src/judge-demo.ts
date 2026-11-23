import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startDemo, type DemoServer } from '../demo/app.js';
import { digest, loadContract } from './contract.js';
import { capture } from './process.js';
import { guardedChanges, sourceSnapshot, validateLocalPatch } from './repair.js';
import { serveWorkspace } from './server.js';
import type { RunResult } from './types.js';
import type { CloudWorkspace } from './workspace-page.js';
import { fingerprintVerification, sameVerificationInputs } from './verification-inputs.js';

export async function startJudgeDemo(options: {
  projectRoot: string; artifactsRoot?: string; patchPath?: string;
  port?: number; appPort?: number; repairedPort?: number;
  host?: string; cloud?: CloudWorkspace;
}): Promise<{url: string; original: DemoServer; repaired: DemoServer; close(): Promise<void>}> {
  const root = await realpath(options.projectRoot);
  const contractPath = join(root, 'examples/permissions.json');
  const patch = await validateLocalPatch(root, ['demo/policy.ts'], JSON.parse(await readFile(
    options.patchPath ?? join(root, 'examples/permission-fix.json'), 'utf8')));
  const originalSources = await sourceSnapshot(root);
  const inputs = await fingerprintVerification(root);
  const {hash: contractHash} = await loadContract(contractPath);
  const candidate = resolve(root, '.cache/latch-judge', randomUUID());
  await mkdir(candidate, {recursive: true});
  for (const path of Object.keys(originalSources)) {
    const destination = join(candidate, path);
    await mkdir(resolve(destination, '..'), {recursive: true});
    await copyFile(join(root, path), destination);
  }
  const before = await sourceSnapshot(candidate);
  for (const file of patch.files) await writeFile(join(candidate, file.path), file.content, 'utf8');
  const after = await sourceSnapshot(candidate);
  if (guardedChanges(before, after, ['demo/policy.ts']).length
    || !sameVerificationInputs(inputs, await fingerprintVerification(candidate))) {
    throw new Error('The judge candidate changed protected files or verification inputs.');
  }
  const compiler = join(root, 'node_modules/typescript/bin/tsc');
  const build = await capture(process.execPath, [compiler, '-p', join(candidate, 'tsconfig.json')],
    {cwd: candidate, timeoutMs: 60_000});
  if (build.code !== 0) throw new Error('The isolated judge candidate did not compile.');
  const repair: NonNullable<RunResult['repair']> = {method: 'local-patch', applied: false,
    files: patch.files.map(file => ({path: file.path, beforeHash: file.beforeHash, afterHash: digest(file.content)}))};
  const assertSources = async () => {
    for (const file of repair.files) {
      if (digest(await readFile(join(root, file.path))) !== file.beforeHash
        || digest(await readFile(join(candidate, file.path))) !== file.afterHash) {
        throw new Error('The application source changed. Restart the judge demo to test the current code.');
      }
    }
    if (!sameVerificationInputs(inputs, await fingerprintVerification(root))
      || !sameVerificationInputs(inputs, await fingerprintVerification(candidate))
      || (await loadContract(contractPath)).hash !== contractHash) {
      throw new Error('The reviewed checklist or verification inputs changed. Restart the judge demo.');
    }
  };
  await assertSources();
  const candidateApp = await import(pathToFileURL(join(candidate, 'dist/demo/app.js')).href) as {startDemo: typeof startDemo};
  const original = await startDemo({port: options.appPort ?? 4317, mode: 'vulnerable', host: options.host ?? '127.0.0.1'});
  let repaired: DemoServer | null = null;
  try {
    repaired = await candidateApp.startDemo({port: options.repairedPort ?? 4319, mode: 'vulnerable', host: options.host ?? '127.0.0.1'});
    const workspace = await serveWorkspace({projectRoot: root,
      artifactsRoot: options.artifactsRoot ?? join(root, 'artifacts'), contractPath, fixture: original,
      port: options.port ?? 4318, host: options.host ?? '127.0.0.1', ...(options.cloud ? {cloud: options.cloud} : {}),
      sourceRepair: {fixture: repaired, patch, repair, assertSources}});
    const repairedApp = repaired;
    return {url: workspace.url, original, repaired: repairedApp,
      close: async () => {await workspace.close(); await original.close(); await repairedApp.close();}};
  } catch (error) {await original.close(); if (repaired) await repaired.close(); throw error;}
}
