import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchLocalBrowser } from '../dist/src/drivers/local.js';
import { renderReport } from '../dist/src/report.js';
import { startDemo } from '../dist/demo/app.js';
import { serveWorkspace } from '../dist/src/server.js';
import { runComparison } from '../dist/src/runner.js';

const output = resolve('artifacts/ui');
await mkdir(output, {recursive: true});
const {before, after} = await runComparison({projectRoot: process.cwd(), contractPath: resolve('examples/permissions.json'),
  outputDir: resolve('artifacts/local-proof'), engine: 'local'});
if (before.verdict !== 'failed' || !after || after.verdict !== 'passed') throw new Error('The current local comparison must complete before reviewing its report.');
await writeFile('artifacts/local-proof/index.html', renderReport(after, before));
const browser = await launchLocalBrowser();
const checks = [];
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('artifacts/local-proof/index.html')).href);
  await page.getByRole('heading', {name: 'The right users. The right access.'}).waitFor();
  assert.equal(await page.locator('#passed-count').innerText(), '5');
  await page.getByRole('button', {name: 'Before · seeded bug'}).click();
  await page.getByRole('heading', {name: 'A permission boundary broke.'}).waitFor();
  assert.equal(await page.locator('#failed-count').innerText(), '2');
  await page.locator('[data-case="other-read"]').click();
  assert.match(await page.locator('#observed').innerText(), /HTTP 200/);
  assert.match(await page.locator('#control').innerText(), /owner-read · passed/);
  await page.waitForFunction(() => {
    const screenshot = document.querySelector('#preview img');
    return screenshot instanceof HTMLImageElement && screenshot.complete && screenshot.naturalWidth > 0;
  });
  await page.screenshot({path: resolve(output, 'desktop-failure.png'), fullPage: true});
  checks.push('The seeded document leak has a loaded screenshot and a passing owner control.');
  await page.locator('[data-case="viewer-update"]').click();
  assert.equal(await page.locator('#mutation').innerText(), 'Changed');
  await page.getByRole('button', {name: 'After · corrected policy'}).click();
  await page.locator('[data-case="viewer-update"]').click();
  assert.match(await page.locator('#observed').innerText(), /HTTP 403/);
  assert.equal(await page.locator('#mutation').innerText(), 'Unchanged');
  assert.match(await page.locator('#control').innerText(), /owner-update · passed/);
  checks.push('The denied viewer update leaves data unchanged and retains the owner update control.');
  await page.getByLabel('Filter cases').selectOption('failed');
  await page.getByText('No cases match this filter.').waitFor();
  assert.equal(await page.locator('#inspector').isVisible(), false);
  assert.equal(await page.locator('#empty-case').isVisible(), true);
  await page.getByLabel('Filter cases').selectOption('all');
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({path: resolve(output, 'mobile-proof.png'), fullPage: true});
  checks.push('The report works at 390px without horizontal overflow.');
  const repairRoot = resolve('artifacts/local-repair');
  const repairBefore = JSON.parse(await readFile(resolve(repairRoot, 'before-run.json'), 'utf8'));
  const repairAfter = JSON.parse(await readFile(resolve(repairRoot, 'run.json'), 'utf8'));
  assert.equal(repairAfter.verdict, 'passed');
  assert.equal(repairAfter.repair.method, 'local-patch');
  assert.equal(repairAfter.repair.applied, false);
  assert.equal(repairBefore.mode, repairAfter.mode);
  assert.equal(repairBefore.engine, repairAfter.engine);
  assert.equal(repairBefore.contractHash, repairAfter.contractHash);
  assert.deepEqual(repairBefore.inputs, repairAfter.inputs);
  assert.notEqual(repairAfter.repair.files[0].beforeHash, repairAfter.repair.files[0].afterHash);
  await page.setViewportSize({width: 1440, height: 1100});
  await page.goto(pathToFileURL(resolve(repairRoot, 'index.html')).href);
  await page.getByRole('button', {name: 'After · verified repair'}).waitFor();
  assert.match(await page.locator('#proof-note').innerText(), /Reviewed local patch.*isolated candidate/);
  await page.getByRole('button', {name: 'Before · failed run'}).click();
  await page.locator('[data-case="other-read"]').click();
  assert.match(await page.locator('#observed').innerText(), /HTTP 200/);
  await page.waitForFunction(() => {
    const screenshot = document.querySelector('#preview img');
    return screenshot instanceof HTMLImageElement && screenshot.complete && screenshot.naturalWidth > 0;
  });
  await page.getByRole('button', {name: 'After · verified repair'}).click();
  await page.locator('[data-case="viewer-update"]').click();
  assert.match(await page.locator('#observed').innerText(), /HTTP 403/);
  assert.equal(await page.locator('#mutation').innerText(), 'Unchanged');
  assert.match(await page.locator('#control').innerText(), /owner-update · passed/);
  await page.waitForFunction(() => {
    const screenshot = document.querySelector('#preview img');
    return screenshot instanceof HTMLImageElement && screenshot.complete && screenshot.naturalWidth > 0;
  });
  await page.screenshot({path: resolve(output, 'verified-repair.png'), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({path: resolve(output, 'verified-repair-mobile.png'), fullPage: true});
  checks.push('The source-repair report preserves engine, mode and verification inputs, loads before/after screenshots, and identifies the reviewed local patch.');
  const nativeRoot = resolve('artifacts/kane-verified');
  const nativeBefore = JSON.parse(await readFile(resolve(nativeRoot, 'before-run.json'), 'utf8'));
  const nativeAfter = JSON.parse(await readFile(resolve(nativeRoot, 'after-run.json'), 'utf8'));
  await writeFile(resolve(nativeRoot, 'index.html'), renderReport(nativeAfter, nativeBefore));
  await page.setViewportSize({width: 1440, height: 1100});
  await page.goto(pathToFileURL(resolve(nativeRoot, 'index.html')).href);
  await page.getByRole('heading', {name: 'The browser proof needs review.'}).waitFor();
  assert.match(await page.locator('#run-status').innerText(), /Browser assertion failed/);
  assert.equal(await page.locator('#failed-count').innerText(), '2');
  assert.equal(await page.locator('#incomplete-count').innerText(), '3');
  await page.locator('[data-case="owner-read"]').click();
  assert.match(await page.locator('#case-reason').innerText(), /parent assertion/);
  assert.match(await page.locator('#observed').innerText(), /HTTP 200 · failed/);
  await page.waitForFunction(() => {
    const screenshot = document.querySelector('#preview img');
    return screenshot instanceof HTMLImageElement && screenshot.complete && screenshot.naturalWidth > 0;
  });
  await page.screenshot({path: resolve(output, 'native-incomplete.png'), fullPage: true});
  await page.getByRole('button', {name: 'Before · seeded bug'}).click();
  await page.locator('[data-case="other-read"]').click();
  assert.match(await page.locator('#observed').innerText(), /HTTP 200/);
  assert.match(await page.locator('#control').innerText(), /owner-read · passed/);
  await page.waitForFunction(() => {
    const screenshot = document.querySelector('#preview img');
    return screenshot instanceof HTMLImageElement && screenshot.complete && screenshot.naturalWidth > 0;
  });
  await page.screenshot({path: resolve(output, 'native-seeded-failure.png'), fullPage: true});
  checks.push('Genuine native screenshots load, and the corrected native phase retains its failed assertions and three incomplete cases.');

  const fixture = await startDemo();
  const workspace = await serveWorkspace({projectRoot: process.cwd(), artifactsRoot: resolve(output, 'workspace'),
    contractPath: resolve('examples/permissions.json'), fixture, port: 0});
  try {
    await page.goto(workspace.url);
    await page.locator('#engine').selectOption('local');
    await page.locator('#demo').click();
    await page.waitForURL(/\/reports\/run-\d+\/index\.html$/, {timeout: 90_000});
    await page.getByRole('heading', {name: 'The right users. The right access.'}).waitFor();
    assert.equal(await page.locator('#passed-count').innerText(), '5');
    await page.getByRole('button', {name: 'Before · seeded bug'}).click();
    assert.equal(await page.locator('#failed-count').innerText(), '2');
    await page.locator('[data-case="other-read"]').click();
    const screenshotUrl = await page.locator('#preview img').getAttribute('src');
    const screenshotResponse = await page.request.get(new URL(screenshotUrl, page.url()).href);
    assert.equal(screenshotResponse.status(), 200);
    const resultsResponse = await page.request.get(new URL('./run.json', page.url()).href);
    assert.equal(resultsResponse.status(), 200);
    assert.equal((await resultsResponse.json()).verdict, 'passed');
    await page.screenshot({path: resolve(output, 'workspace-flow.png'), fullPage: true});
    const deniedOrigin = await page.request.post(new URL('/api/run', workspace.url).href, {
      headers: {Origin: 'https://unrelated.example'}, data: {engine: 'local', compare: false}
    });
    assert.equal(deniedOrigin.status(), 403);
    const traversal = await page.request.get(new URL('/reports/%2e%2e%2f%2e%2e%2fREADME.md', workspace.url).href);
    assert.notEqual(traversal.status(), 200);
    checks.push('The web workspace starts a real comparison, opens its report, serves screenshots/results, and rejects unrelated-origin runs and outside report paths.');
  } finally {await workspace.close(); await fixture.close();}
  assert.deepEqual(errors, []);
  assert.equal(before.contractHash, after.contractHash);
  assert.deepEqual(before.inputs, after.inputs);
  const result = {checks, browserErrors: errors, contractHashUnchanged: true, verificationInputsUnchanged: true,
    sourceRuns: {localBefore: before.id, localAfter: after.id, repairBefore: repairBefore.id, repairAfter: repairAfter.id,
      historicalNativeBefore: nativeBefore.id, historicalNativeAfter: nativeAfter.id},
    engine: 'Playwright local development', kaneVerified: false};
  await writeFile(resolve(output, 'review.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {await browser.close();}
