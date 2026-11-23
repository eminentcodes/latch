import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { startDemo } from '../dist/demo/app.js';
import { kaneCase } from '../dist/src/drivers/kane.js';
import { serveWorkspace } from '../dist/src/server.js';
import { fingerprintVerification, sameVerificationInputs } from '../dist/src/verification-inputs.js';

const root = process.cwd();
const artifactsRoot = resolve('artifacts');
const reportRoot = resolve(process.argv[2] ?? 'artifacts/local-repair');
const reportPath = relative(artifactsRoot, reportRoot);
if (!reportPath || isAbsolute(reportPath) || reportPath.split(sep).includes('..')) {
  throw new Error('Choose a generated repair report inside artifacts/.');
}
if (!process.env.KANE_CLI_CHROME_PATH && await access(chromium.executablePath()).then(() => true, () => false)) {
  process.env.KANE_CLI_CHROME_PATH = chromium.executablePath();
}
const before = JSON.parse(await readFile(join(reportRoot, 'before-run.json'), 'utf8'));
const after = JSON.parse(await readFile(join(reportRoot, 'run.json'), 'utf8'));
if (before.verdict !== 'failed' || after.verdict !== 'passed' || !['local-patch', 'codex'].includes(after.repair?.method)
  || before.cases.length !== before.expectedCases || after.cases.length !== after.expectedCases
  || before.cases.some(item => item.verdict === 'incomplete') || after.cases.some(item => item.verdict !== 'passed')
  || before.contractHash !== after.contractHash || before.engine !== after.engine || before.mode !== after.mode
  || !sameVerificationInputs(before.inputs, after.inputs) || !sameVerificationInputs(after.inputs, await fingerprintVerification(root))) {
  throw new Error('Choose a current, complete source-repair report with unchanged permission verification inputs.');
}
const outputDir = resolve(`artifacts/kane-report-${Date.now()}`);
await mkdir(outputDir, {recursive: true});
const fixture = await startDemo();
const workspace = await serveWorkspace({projectRoot: root, artifactsRoot,
  contractPath: resolve('examples/permissions.json'), fixture, port: 0});
try {
  const url = `${workspace.url}/reports/${reportPath.split(sep).map(encodeURIComponent).join('/')}/index.html`;
  console.log(`Kane is verifying the report UI. The application source repair used ${after.engine === 'kane' ? 'native Kane' : 'the local development browser'}.`);
  const objective = `Open ${url}.
Click "Before · failed run".
Click the permission case "other-read".
Assert that the heading "A permission boundary broke." is visible.
Assert that the observed result shows "HTTP 200 · failed".
Assert that the allowed-user control shows "owner-read · passed".
Assert that a browser screenshot is visible in "Actual browser evidence".
Click "After · verified repair".
Click the permission case "viewer-update".
Assert that the observed result shows "HTTP 403 · passed".
Assert that "Protected data" shows "Unchanged".
Assert that the allowed-user control shows "owner-update · passed".
Assert that a browser screenshot is visible in "Actual browser evidence".`;
  const driver = await kaneCase({projectRoot: root, baseUrl: url, objective,
    outputDir: join(outputDir, 'report'), reportRoot: outputDir, timeoutSeconds: 360, maxSteps: 24});
  const verdict = driver.state === 'passed' ? 'passed' : driver.state === 'failed' ? 'failed' : 'incomplete';
  const result = {scope: `Native Kane verification of Latch report interaction and evidence previews. The source application repair was verified with ${after.engine === 'kane' ? 'native Kane' : 'the local development browser'}.`,
    verdict, sourceRunIds: {before: before.id, after: after.id}, sourcePermissionEngine: after.engine,
    contractHash: after.contractHash, sourceReport: reportPath.split(sep).join('/'), driver};
  await writeFile(join(outputDir, 'workflow-proof.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = verdict === 'passed' ? 0 : 2;
} finally {await workspace.close(); await fixture.close();}
