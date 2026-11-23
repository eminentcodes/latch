import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { runSuite } from '../dist/src/runner.js';

const chromium = join(homedir(), 'AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe');
if (!process.env.KANE_CLI_CHROME_PATH && await access(chromium).then(() => true, () => false)) {
  process.env.KANE_CLI_CHROME_PATH = chromium;
}
const root = process.cwd();
const outputDir = resolve(process.argv[2] ?? 'artifacts/kane-agent-before');
console.log('Running five original permission cases with native Kane. Results come from live browser requests.');
const run = await runSuite({projectRoot: root, contractPath: resolve('examples/permissions.json'), outputDir,
  engine: 'kane', mode: 'vulnerable', onCase: result => console.log(`${result.check.id}: ${result.verdict} · ${result.reason}`)});
console.log(JSON.stringify({id: run.id, verdict: run.verdict, cases: run.cases.map(item => ({id: item.check.id, verdict: item.verdict,
  status: item.observation?.status, reason: item.reason})), report: join(outputDir, 'index.html')}, null, 2));
process.exitCode = run.verdict === 'failed' && run.cases.length === run.expectedCases
  && run.cases.every(item => item.verdict !== 'incomplete') ? 0 : 2;
