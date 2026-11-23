#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { startDemo } from '../demo/app.js';
import type { PolicyMode } from '../demo/policy.js';
import { loadContract } from './contract.js';
import { executePatchRepair, executeRepair, prepareRepair } from './repair.js';
import { runComparison, runSuite } from './runner.js';
import { serveWorkspace } from './server.js';
import type { EngineName, Verdict } from './types.js';

const help = `Latch — permission checks with evidence

Commands:
  latch dev                    Open the report workspace and synthetic app
  latch validate <contract>    Validate a contract without running a browser
  latch run                    Run declared checks (Kane by default)
  latch demo --engine local    Compare seeded and corrected fixture policies
  latch repair --run <json>    Prepare a guarded repair from a complete failure

Options:
  --contract <path>            Default: examples/permissions.json
  --engine kane|local         Verification engine
  --mode secure|vulnerable|deny-all
  --out <directory>            Evidence report destination
  --port <number>              Local workspace port; default 4318
  --allow <file,file>          Application files the repair may edit
  --patch <json>              Verify reviewed file replacements in isolation
  --apply                     Apply a local patch after the original checks pass
  --execute                   Invoke the locally authenticated Codex CLI

Repairs repeat the failed run's engine, mode, contract and verification inputs.
No command commits or pushes code. Local proof is labeled separately from Kane.
`;

const exitFor = (verdict: Verdict) => verdict === 'passed' ? 0 : verdict === 'failed' ? 1 : 2;

async function main(): Promise<void> {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    help: {type: 'boolean', short: 'h'}, contract: {type: 'string'}, engine: {type: 'string'}, mode: {type: 'string'},
    out: {type: 'string'}, port: {type: 'string'}, run: {type: 'string'}, allow: {type: 'string'}, execute: {type: 'boolean'},
    patch: {type: 'string'}, apply: {type: 'boolean'},
  }});
  const command = positionals[0];
  if (values.help || !command) {console.log(help); return;}
  const projectRoot = process.cwd();
  const contractPath = resolve(projectRoot, values.contract ?? (command === 'validate' ? positionals[1] : undefined) ?? 'examples/permissions.json');
  if (command === 'validate') {
    const {contract, hash} = await loadContract(contractPath);
    console.log(`Valid permission contract: ${contract.name} (${contract.checks.length} checks).\nSHA-256: ${hash}\nValidation only; no browser permission checks have run.`); return;
  }
  const engine = values.engine ?? (command === 'demo' || command === 'dev' ? 'local' : 'kane');
  if (!['local', 'kane'].includes(engine)) throw new Error('Choose --engine kane or --engine local.');
  const mode = values.mode ?? 'secure';
  if (!['secure', 'vulnerable', 'deny-all'].includes(mode)) throw new Error('Choose --mode secure, vulnerable, or deny-all.');
  const outputDir = resolve(projectRoot, values.out ?? `artifacts/run-${Date.now()}`);
  const parameters = {projectRoot, contractPath, outputDir, engine: engine as EngineName,
    onCase: (result: import('./types.js').CaseResult) => console.log(`${result.check.id}: ${result.verdict} — ${result.reason}`)};
  if (command === 'run') {
    const result = await runSuite({...parameters, mode: mode as PolicyMode});
    console.log(`\nLatch ${result.verdict}. Report: ${resolve(outputDir, 'index.html')}`);
    process.exitCode = exitFor(result.verdict); return;
  }
  if (command === 'demo') {
    console.log(`Comparing explicit fixture policies with ${engine === 'kane' ? 'Kane' : 'the local development browser'}. This comparison is not an executed agent repair.\n`);
    const result = await runComparison(parameters);
    console.log(`\nSeeded policy: ${result.before.verdict}. Corrected policy: ${result.after?.verdict ?? 'not run'}.\nReport: ${resolve(outputDir, 'index.html')}`);
    process.exitCode = result.before.verdict === 'failed' && result.after?.verdict === 'passed' ? 0 : 2; return;
  }
  if (command === 'repair') {
    if (!values.run) throw new Error('Specify the failed run with --run <run.json>.');
    if (values.patch && values.execute) throw new Error('Choose a local --patch or a Codex --execute repair.');
    if (values.apply && !values.patch) throw new Error('--apply requires a reviewed local --patch.');
    const options = {projectRoot, contractPath, outputDir, runPath: resolve(projectRoot, values.run), allowed: (values.allow ?? 'demo/policy.ts').split(',')};
    if (values.patch) {
      const result = await executePatchRepair({...options, patchPath: resolve(projectRoot, values.patch), apply: values.apply ?? false});
      console.log(`Local patch verified: ${result.verdict}. ${result.repair?.applied ? 'Verified application changes applied.' : 'Verified in an isolated copy.'}\nReport: ${resolve(outputDir, 'index.html')}`);
    } else if (values.execute) {const result = await executeRepair(options); console.log(`Verified repair: ${result.verdict}. No commit or push was made.`);}
    else {const result = await prepareRepair(options); console.log(`Repair prompt ready: ${result.promptPath}\nAllowed application files: ${result.allowed.join(', ')}.\nUse --execute to invoke your locally authenticated Codex CLI. No model call, app change, commit, or push was made.`);}
    return;
  }
  if (command === 'dev') {
    const port = Number(values.port ?? 4318);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a local port from 1024 to 65535.');
    await mkdir(resolve(projectRoot, 'artifacts'), {recursive: true});
    const fixture = await startDemo({port: 4317, mode: mode as PolicyMode});
    const workspace = await serveWorkspace({projectRoot, contractPath, artifactsRoot: resolve(projectRoot, 'artifacts'), fixture, port});
    console.log(`Latch workspace: ${workspace.url}\nSynthetic test app: ${fixture.baseUrl}\nPress Ctrl+C to stop. No commits or pushes are made.`);
    const close = async () => {await workspace.close(); await fixture.close(); process.exit(0);};
    process.once('SIGINT', close); process.once('SIGTERM', close); return;
  }
  throw new Error(`Unknown command: ${command}. Run latch --help.`);
}

main().catch(error => {
  if (error instanceof z.ZodError) console.error('Invalid Latch input:\n' + error.issues.map(issue => `- ${issue.path.join('.') || 'input'}: ${issue.message}`).join('\n'));
  else console.error(error instanceof Error ? error.message : 'Latch could not complete the command.');
  process.exitCode = 2;
});
