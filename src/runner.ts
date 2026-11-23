import { randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startDemo, type DemoServer } from '../demo/app.js';
import type { PolicyMode } from '../demo/policy.js';
import { allowedControl, loadContract } from './contract.js';
import { kaneCase } from './drivers/kane.js';
import { launchLocalBrowser, localCase } from './drivers/local.js';
import { capture } from './process.js';
import { renderReport, renderSummary } from './report.js';
import { scenarioObjective } from './scenario.js';
import type { CaseResult, DriverResult, EngineName, RunResult } from './types.js';
import { judgeCase, judgeRun } from './verdict.js';
import { fingerprintVerification, sameVerificationInputs } from './verification-inputs.js';

async function commitAt(root: string): Promise<string | null> {
  if (process.env.GITHUB_SHA && /^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA)) return process.env.GITHUB_SHA;
  try {
    await access(join(root, '.git'));
    const top = await capture('git', ['rev-parse', '--show-toplevel'], {cwd: root, timeoutMs: 5000});
    if (top.code !== 0 || await realpath(top.stdout.trim()) !== await realpath(root)) return null;
    const result = await capture('git', ['rev-parse', 'HEAD'], {cwd: root, timeoutMs: 5000});
    return result.code === 0 && /^[a-f0-9]{40}$/i.test(result.stdout.trim()) ? result.stdout.trim() : null;
  } catch { return null; }
}

export async function runSuite(options: {
  projectRoot: string; contractPath: string; outputDir: string; engine: EngineName; mode?: PolicyMode;
  fixture?: DemoServer; evidencePrefix?: string; onCase?: (result: CaseResult) => void;
}): Promise<RunResult> {
  const {contract, hash} = await loadContract(options.contractPath);
  const inputs = await fingerprintVerification(options.projectRoot);
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  await mkdir(options.outputDir, {recursive: true});
  const fixture = options.fixture ?? await startDemo({mode: options.mode ?? 'secure'});
  const ownsFixture = !options.fixture;
  const cases: CaseResult[] = [];
  let browser: Awaited<ReturnType<typeof launchLocalBrowser>> | null = null;
  let launchError: string | null = null;
  try {
    if (options.engine === 'local') {
      try {browser = await launchLocalBrowser();} catch (error) {launchError = error instanceof Error ? error.message.split('\n')[0] ?? 'Local browser could not start.' : 'Local browser could not start.';}
    }
    for (const check of contract.checks) {
      const actor = contract.actors.find(item => item.id === check.actor)!;
      const resource = contract.resources.find(item => item.id === check.resource)!;
      fixture.reset();
      const caseTag = `${id}-${check.id}`;
      const outputDir = join(options.outputDir, options.evidencePrefix ?? '', 'cases', check.id);
      let driver: DriverResult;
      if (options.engine === 'local') {
        driver = browser ? await localCase(browser, {check, actor, resource, baseUrl: fixture.baseUrl, caseTag, outputDir, reportRoot: options.outputDir})
          : {engine: 'local', state: 'error', summary: launchError ?? 'Local browser unavailable.', durationMs: 0, evidence: [], terminal: false};
      } else {
        driver = await kaneCase({objective: scenarioObjective(check, actor, resource, fixture.baseUrl, caseTag), projectRoot: options.projectRoot,
          baseUrl: fixture.baseUrl, outputDir, reportRoot: options.outputDir});
      }
      const observation = fixture.observation(caseTag);
      const judged = judgeCase(check, driver, observation, actor.fixtureKey);
      const result: CaseResult = {check, actorLabel: actor.label, resourceLabel: resource.label, ...judged, driver, observation, controlId: allowedControl(contract, check) ?? null};
      cases.push(result);
      options.onCase?.(result);
      // An account/browser precondition failure cannot be fixed by repeating paid work.
      if (options.engine === 'kane' && !observation && (driver.state === 'error' || driver.state === 'timeout' || driver.state === 'failed')) break;
    }
  } finally {
    if (browser) await browser.close();
    if (ownsFixture) await fixture.close();
  }
  const inputsUnchanged = sameVerificationInputs(inputs, await fingerprintVerification(options.projectRoot))
    && (await loadContract(options.contractPath)).hash === hash;
  const run: RunResult = {version: 1, id, name: contract.name, engine: options.engine, startedAt, finishedAt: new Date().toISOString(),
    inputs,
    commit: await commitAt(resolve(options.projectRoot)), contractHash: hash, verdict: inputsUnchanged ? judgeRun(cases.map(item => item.verdict), contract.checks.length) : 'incomplete',
    cases, expectedCases: contract.checks.length, baseUrl: fixture.baseUrl, mode: fixture.mode};
  const suffix = options.evidencePrefix ? options.evidencePrefix + '-' : '';
  await writeFile(join(options.outputDir, suffix + 'run.json'), JSON.stringify(run, null, 2) + '\n', 'utf8');
  if (!options.evidencePrefix) await writeFile(join(options.outputDir, 'index.html'), renderReport(run), 'utf8');
  await writeFile(join(options.outputDir, suffix + 'summary.md'), renderSummary(run), 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, renderSummary(run), 'utf8');
  return run;
}

export async function runComparison(options: {projectRoot: string; contractPath: string; outputDir: string; engine: EngineName; onCase?: (result: CaseResult) => void}): Promise<{before: RunResult; after: RunResult | null}> {
  const before = await runSuite({...options, mode: 'vulnerable', evidencePrefix: 'before'});
  if (before.verdict === 'incomplete' || before.cases.length !== before.expectedCases || before.cases.some(item => item.verdict === 'incomplete')) {
    await writeFile(join(options.outputDir, 'index.html'), renderReport(before), 'utf8');
    await writeFile(join(options.outputDir, 'run.json'), JSON.stringify(before, null, 2) + '\n', 'utf8');
    return {before, after: null};
  }
  const after = await runSuite({...options, mode: 'secure', evidencePrefix: 'after'});
  if (before.contractHash !== after.contractHash) throw new Error('The permission contract changed during the comparison.');
  if (!sameVerificationInputs(before.inputs, after.inputs)) throw new Error('The fixture, scenarios, or verifier changed during the comparison.');
  await writeFile(join(options.outputDir, 'index.html'), renderReport(after, before), 'utf8');
  await writeFile(join(options.outputDir, 'run.json'), JSON.stringify(after, null, 2) + '\n', 'utf8');
  return {before, after};
}
