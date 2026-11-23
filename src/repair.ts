import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { DemoServer } from '../demo/app.js';
import { digest, loadContract } from './contract.js';
import { capture, codexCommand } from './process.js';
import { renderReport, renderSummary } from './report.js';
import { runSuite } from './runner.js';
import type { RunResult } from './types.js';
import { fingerprintVerification, sameVerificationInputs } from './verification-inputs.js';

const excluded = new Set(['.git', 'node_modules', 'dist', 'artifacts', '.cache', '.testmuai', '.auth']);
export type Snapshot = Record<string, string>;
export type RepairOptions = {projectRoot: string; runPath: string; contractPath: string; outputDir: string; allowed: string[]};
const localPatchSchema = z.object({
  format: z.literal('latch-file-patch-v1'),
  files: z.array(z.object({
    path: z.string().min(1).max(512),
    beforeHash: z.string().regex(/^[a-f0-9]{64}$/),
    content: z.string().max(512_000),
  }).strict()).min(1).max(32),
}).strict();
export type LocalPatch = z.infer<typeof localPatchSchema>;

export async function sourceSnapshot(root: string): Promise<Snapshot> {
  const result: Snapshot = {};
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      if (excluded.has(entry.name) || entry.name === '.env' || (entry.name.startsWith('.env.') && entry.name !== '.env.example')) continue;
      if (entry.isSymbolicLink()) throw new Error('Repair guard does not allow symbolic links in source inputs.');
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result[relative(root, path).split('\\').join('/')] = digest(await readFile(path));
    }
  }
  await visit(root);
  return result;
}

export function guardedChanges(before: Snapshot, after: Snapshot, allowed: readonly string[]): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(key => before[key] !== after[key] && !allowed.includes(key));
}

export async function validateAllowedPaths(root: string, paths: readonly string[]): Promise<string[]> {
  const resolvedRoot = await realpath(root);
  if (!paths.length) throw new Error('Declare the application files that the repair may change.');
  const allowed: string[] = [];
  for (const path of paths) {
    if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new Error('Repair paths must be files inside the application workspace.');
    const absolute = await realpath(resolve(root, path));
    if (!absolute.startsWith(resolvedRoot + sep) || !(await stat(absolute)).isFile()) throw new Error('Repair paths must resolve to existing files inside the application workspace.');
    const normalized = relative(resolvedRoot, absolute).split('\\').join('/');
    if (normalized.split('/').some(part => excluded.has(part) || part === '.env' || part.startsWith('.env.'))
      || ['src/', 'tests/', 'scripts/', 'examples/', 'research/', '.github/'].some(prefix => normalized.startsWith(prefix)) || ['demo/data.ts', 'demo/app.ts', 'demo/views.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'agent.md', 'AGENTS.md', 'projectplan.md'].includes(normalized)) {
      throw new Error('Application repair cannot change the verifier, reviewed contract, fixture definitions, build configuration, or project instructions.');
    }
    allowed.push(normalized);
  }
  return [...new Set(allowed)];
}

export function repairPrompt(run: RunResult, allowed: readonly string[]): string {
  const failures = run.cases.filter(item => item.verdict === 'failed').map(item => ({rule: item.check, reason: item.reason, observation: item.observation,
    screenshots: item.driver.evidence.filter(evidence => evidence.kind === 'screenshot').map(evidence => `artifacts/latch-before/${evidence.path}`)}));
  return `Repair the application permission enforcement identified by Latch.\n\nAllowed application files: ${allowed.join(', ')}.\nContract SHA-256: ${run.contractHash}.\nFixture mode for repeat verification: ${run.mode}.\n\n${JSON.stringify(failures, null, 2)}\n\nChange only the allowed application files. Preserve all permission expectations, legitimate-user controls, identity bindings, fixtures, observers, scenarios, and verifier code. Do not change tests, commands, build configuration, or dependencies. Do not commit, push, publish, contact services, or modify account credentials. Fix enforcement rather than hiding the affected interface. The same browser cases will be run again; blocking all users is a failed repair.\n`;
}

export async function copyRunEvidence(run: RunResult, sourceRoot: string, destinationRoot: string, prefix = ''): Promise<RunResult> {
  const source = await realpath(sourceRoot);
  const destination = resolve(destinationRoot);
  await mkdir(destination, {recursive: true});
  if (await realpath(destination) !== destination) throw new Error('Evidence destination must be a normal report directory.');
  const copy = structuredClone(run);
  for (const item of copy.cases) {
    for (const evidence of item.driver.evidence) {
      const path = evidence.path;
      if (isAbsolute(path) || path.includes('\\') || path.split('/').includes('..') || !path) throw new Error('Run evidence must use paths inside its report directory.');
      const original = await realpath(resolve(source, path));
      if (!original.startsWith(source + sep) || !(await stat(original)).isFile()) throw new Error('Run evidence resolves outside its report directory.');
      const target = resolve(destination, prefix, path);
      if (!target.startsWith(destination + sep)) throw new Error('Copied evidence must stay inside its report directory.');
      let parent = destination;
      for (const directory of relative(destination, dirname(target)).split(sep).filter(Boolean)) {
        parent = join(parent, directory);
        const info = await lstat(parent).catch(() => null);
        if (info?.isSymbolicLink() || (info && !info.isDirectory())) throw new Error('Evidence destination parents must be normal directories.');
        if (!info) await mkdir(parent);
        if (!(await realpath(parent)).startsWith(destination + sep)) throw new Error('Evidence destination resolves outside the report directory.');
      }
      if ((await lstat(target).catch(() => null))?.isSymbolicLink()) throw new Error('Evidence destination must not be a link.');
      if (original !== target) await copyFile(original, target);
      evidence.path = relative(destination, target).split('\\').join('/');
    }
  }
  return copy;
}

export async function prepareRepair(options: RepairOptions): Promise<{run: RunResult; allowed: string[]; promptPath: string}> {
  const run = JSON.parse(await readFile(options.runPath, 'utf8')) as RunResult;
  if (run.version !== 1 || run.verdict !== 'failed' || !Array.isArray(run.cases) || !run.cases.some(item => item.verdict === 'failed')) throw new Error('Repair requires a failed Latch run with a concrete permission case.');
  const {contract, hash} = await loadContract(options.contractPath);
  if (hash !== run.contractHash) throw new Error('The reviewed contract differs from the failed run. Restore the original contract before repair.');
  if (!['local', 'kane'].includes(run.engine) || !['secure', 'vulnerable', 'deny-all'].includes(run.mode)
    || run.expectedCases !== contract.checks.length || run.cases.length !== contract.checks.length
    || run.cases.some(item => item.verdict === 'incomplete')
    || contract.checks.some((check, index) => !run.cases[index]?.check
      || (['id', 'actor', 'resource', 'action', 'expect'] as const).some(key => run.cases[index]!.check[key] !== check[key]))) {
    throw new Error('The failed run does not contain the original complete permission cases and a supported fixture mode.');
  }
  if (!sameVerificationInputs(run.inputs, await fingerprintVerification(options.projectRoot))) {
    throw new Error('The fixture, scenarios, or verifier differ from the failed run. Run fresh checks before repair.');
  }
  const permissionFailure = run.cases.some(item => {
    const observation = item.observation;
    const actor = contract.actors.find(candidate => candidate.id === item.check.actor);
    if (item.verdict !== 'failed' || !observation || observation.actor !== actor?.fixtureKey
      || observation.resource !== item.check.resource || observation.action !== item.check.action) return false;
    const successful = observation.status >= 200 && observation.status < 300;
    const changed = observation.beforeHash !== observation.afterHash;
    return item.check.expect === 'deny' ? successful || observation.disclosed || changed
      : [401, 403, 404].includes(observation.status) || (successful && (item.check.action === 'read' ? !observation.disclosed : !changed));
  });
  if (!permissionFailure) throw new Error('The observed permissions matched the contract. Review the browser assertions before proposing an application permission repair.');
  const allowed = await validateAllowedPaths(options.projectRoot, options.allowed);
  await mkdir(options.outputDir, {recursive: true});
  const promptPath = join(options.outputDir, 'repair-prompt.md');
  await writeFile(promptPath, repairPrompt(run, allowed), 'utf8');
  return {run, allowed, promptPath};
}

export async function validateLocalPatch(root: string, allowed: readonly string[], value: unknown): Promise<LocalPatch> {
  const patch = localPatchSchema.parse(value);
  const seen = new Set<string>();
  for (const file of patch.files) {
    const [path] = await validateAllowedPaths(root, [file.path]);
    if (!path || !allowed.includes(path)) throw new Error(`The patch changes an undeclared application file: ${file.path}.`);
    if (seen.has(path)) throw new Error(`The patch repeats an application file: ${path}.`);
    seen.add(path);
    file.path = path;
    if (digest(await readFile(join(root, path))) !== file.beforeHash) throw new Error(`The patch is stale: ${path} no longer matches its reviewed source hash.`);
    if (digest(file.content) === file.beforeHash) throw new Error(`The patch does not change application enforcement: ${path}.`);
  }
  return patch;
}

async function verifyCandidate(options: RepairOptions, method: 'local-patch' | 'codex', apply: boolean,
  edit: (isolated: string, prepared: Awaited<ReturnType<typeof prepareRepair>>) => Promise<void>): Promise<RunResult> {
  const prepared = await prepareRepair(options);
  const original = await sourceSnapshot(options.projectRoot);
  const isolated = resolve(options.projectRoot, '.cache/latch-repair', randomUUID());
  await mkdir(isolated, {recursive: true});
  for (const path of Object.keys(original)) {
    const destination = join(isolated, path);
    await mkdir(resolve(destination, '..'), {recursive: true});
    await copyFile(join(options.projectRoot, path), destination);
  }
  const baseline = await sourceSnapshot(isolated);
  await copyRunEvidence(prepared.run, dirname(options.runPath), join(isolated, 'artifacts/latch-before'));
  await edit(isolated, prepared);
  const changed = await sourceSnapshot(isolated);
  const violations = guardedChanges(baseline, changed, prepared.allowed);
  if (violations.length) throw new Error(`Repair changed protected files: ${violations.join(', ')}. The original application has not been changed.`);
  if (!prepared.allowed.some(path => baseline[path] !== changed[path])) throw new Error('The repair did not change an allowed application file.');
  if (!sameVerificationInputs(prepared.run.inputs, await fingerprintVerification(isolated))) throw new Error('The candidate changed protected verification inputs. The original application has not been changed.');
  const compiler = resolve(options.projectRoot, 'node_modules/typescript/bin/tsc');
  const build = await capture(process.execPath, [compiler, '-p', join(isolated, 'tsconfig.json')], {cwd: isolated, timeoutMs: 60_000});
  if (build.code !== 0) throw new Error('The isolated repair does not compile. The original application has not been changed.');
  const app = await import(pathToFileURL(join(isolated, 'dist/demo/app.js')).href) as {startDemo: (options: {mode: string}) => Promise<DemoServer>};
  const fixture = await app.startDemo({mode: prepared.run.mode});
  let verified: RunResult;
  try {
    verified = await runSuite({projectRoot: options.projectRoot, contractPath: options.contractPath, outputDir: options.outputDir,
      engine: prepared.run.engine, fixture, evidencePrefix: 'repaired'});
  } finally {await fixture.close();}
  verified.repair = {method, applied: false, files: prepared.allowed.filter(path => baseline[path] !== changed[path])
    .map(path => ({path, beforeHash: baseline[path]!, afterHash: changed[path]!}))};
  const before = await copyRunEvidence(prepared.run, dirname(options.runPath), options.outputDir, 'before-evidence');
  await writeFile(join(options.outputDir, 'before-run.json'), JSON.stringify(before, null, 2) + '\n', 'utf8');
  await writeFile(join(options.outputDir, 'index.html'), renderReport(verified, before, 'repair'), 'utf8');
  await writeFile(join(options.outputDir, 'run.json'), JSON.stringify(verified, null, 2) + '\n', 'utf8');
  if (verified.verdict !== 'passed' || verified.contractHash !== prepared.run.contractHash
    || verified.engine !== prepared.run.engine || verified.mode !== prepared.run.mode
    || !sameVerificationInputs(prepared.run.inputs, verified.inputs)) throw new Error('The repaired application did not pass the original permission cases and verification inputs. The original application has not been changed. Inspect the candidate report.');
  if (guardedChanges(changed, await sourceSnapshot(isolated), []).length) throw new Error('The candidate source changed during verification. The original application has not been changed.');
  const current = await sourceSnapshot(options.projectRoot);
  if (Object.keys(original).some(path => current[path] !== original[path]) || Object.keys(current).some(path => !(path in original))) throw new Error('The working source changed during repair; review the isolated result before applying it.');
  if (apply) {
    for (const file of verified.repair.files) await copyFile(join(isolated, file.path), join(options.projectRoot, file.path));
    verified.repair.applied = true;
  }
  await writeFile(join(options.outputDir, 'repair.json'), JSON.stringify(verified.repair, null, 2) + '\n', 'utf8');
  await writeFile(join(options.outputDir, 'index.html'), renderReport(verified, before, 'repair'), 'utf8');
  await writeFile(join(options.outputDir, 'run.json'), JSON.stringify(verified, null, 2) + '\n', 'utf8');
  await writeFile(join(options.outputDir, 'summary.md'), renderSummary(verified), 'utf8');
  return verified;
}

export async function executePatchRepair(options: RepairOptions & {patchPath: string; apply?: boolean}): Promise<RunResult> {
  const bytes = await readFile(options.patchPath);
  if (bytes.length > 1_000_000) throw new Error('The local patch exceeds the bounded input size.');
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  return verifyCandidate(options, 'local-patch', options.apply ?? false, async (isolated, prepared) => {
    const patch = await validateLocalPatch(isolated, prepared.allowed, value);
    for (const file of patch.files) await writeFile(join(isolated, file.path), file.content, 'utf8');
    await writeFile(join(options.outputDir, 'application-patch.json'), JSON.stringify(patch, null, 2) + '\n', 'utf8');
  });
}

export async function executeRepair(options: RepairOptions): Promise<RunResult> {
  return verifyCandidate(options, 'codex', true, async (isolated, prepared) => {
    const command = await codexCommand();
    const execution = await capture(command.command, [...command.args, 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--json', '-'],
      {cwd: isolated, timeoutMs: 300_000, input: await readFile(prepared.promptPath, 'utf8')});
    if (execution.timedOut || execution.code !== 0) throw new Error('The coding-agent repair did not complete. The original application has not been changed.');
  });
}
