import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { digest } from '../dist/src/contract.js';
import { executePatchRepair } from '../dist/src/repair.js';
import { runSuite } from '../dist/src/runner.js';

const root = process.cwd();
const engine = process.argv[2] ?? 'local';
if (!['local', 'kane'].includes(engine)) throw new Error('Choose local or kane.');
const outputDir = resolve(`artifacts/${engine}-repair`);
const contractPath = resolve('examples/permissions.json');
const baseline = join(outputDir, 'baseline');
await mkdir(outputDir, {recursive: true});
const before = await runSuite({projectRoot: root, contractPath, outputDir: baseline, engine, mode: 'vulnerable',
  onCase: result => console.log(`${result.check.id}: ${result.verdict} — ${result.reason}`)});
if (before.verdict !== 'failed' || before.cases.length !== before.expectedCases || before.cases.some(item => item.verdict === 'incomplete')) {
  throw new Error('The complete seeded permission failure is required before repairing. Inspect the baseline report.');
}
const path = 'demo/policy.ts';
const source = await readFile(path, 'utf8');
const branches = source.match(/^  if \(mode === 'vulnerable'\) return true;\r?\n/gm);
if (branches?.length !== 2) throw new Error('The synthetic enforcement source differs from the reviewed local patch.');
const content = source.replace(/^  if \(mode === 'vulnerable'\) return true;\r?\n/gm, '');
const patchPath = join(outputDir, 'permission-fix.json');
await writeFile(patchPath, JSON.stringify({format: 'latch-file-patch-v1', files: [{path, beforeHash: digest(source), content}]}, null, 2) + '\n');
const result = await executePatchRepair({projectRoot: root, contractPath, outputDir, runPath: join(baseline, 'run.json'),
  allowed: [path], patchPath});
console.log(JSON.stringify({verdict: result.verdict, engine: result.engine, mode: result.mode, repair: result.repair,
  report: join(outputDir, 'index.html'), patch: patchPath}, null, 2));
