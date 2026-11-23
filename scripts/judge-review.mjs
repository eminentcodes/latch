import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startJudgeDemo } from '../dist/src/judge-demo.js';
import { launchLocalBrowser } from '../dist/src/drivers/local.js';

const output = resolve('artifacts/ui/judge');
await mkdir(output, {recursive: true});
const demo = await startJudgeDemo({projectRoot: process.cwd(), artifactsRoot: resolve('artifacts/judge-review'),
  port: 0, appPort: 0, repairedPort: 0});
const browser = await launchLocalBrowser();
const manual = [];
const errors = [];
try {
  for (const [stage, app, blockedStatus] of [['original', demo.original, 200], ['repaired', demo.repaired, 403]]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const login = async name => {
      await page.goto(`${app.baseUrl}/login`);
      await page.getByRole('button', {name: `Continue as ${name}`}).click();
      await page.getByText(`Signed in as ${name}`, {exact: false}).waitFor();
    };
    const read = async () => {
      const pending = page.waitForResponse(response => response.url().endsWith('/api/documents/launch-plan') && response.request().method() === 'GET');
      await page.goto(`${app.baseUrl}/documents/launch-plan`);
      const response = await pending;
      await page.locator('#document[data-ready="true"]').waitFor();
      return {status: response.status(), body: await response.json(), visible: await page.locator('#document').innerText()};
    };
    const update = async content => {
      await page.goto(`${app.baseUrl}/probe/documents/launch-plan`);
      await page.getByLabel('Proposed content').fill(content);
      const pending = page.waitForResponse(response => response.url().endsWith('/api/documents/launch-plan') && response.request().method() === 'PUT');
      await page.getByRole('button', {name: 'Send update request'}).click();
      const response = await pending;
      await page.locator('#result[data-status]').waitFor();
      return {status: response.status(), body: await response.json()};
    };
    await login('Avery');
    const owner = await read();
    assert.equal(owner.status, 200);
    const initialContent = owner.body.content;
    await login('Morgan');
    const other = await read();
    assert.equal(other.status, blockedStatus);
    assert.equal(other.visible.includes('ORION-PRIVATE-2026'), stage === 'original');
    await page.screenshot({path: resolve(output, `${stage}-other-read.png`), fullPage: true});
    await login('Sam');
    assert.equal((await read()).status, 200);
    const content = `Judge entered ${stage} text ${randomUUID()}`;
    const viewer = await update(content);
    assert.equal(viewer.status, blockedStatus);
    await page.screenshot({path: resolve(output, `${stage}-viewer-update.png`), fullPage: true});
    await login('Avery');
    const stored = await read();
    assert.equal(stored.body.content, stage === 'original' ? content : initialContent);
    const ownerContent = `Owner can still edit ${randomUUID()}`;
    const ownerUpdate = await update(ownerContent);
    assert.equal(ownerUpdate.status, 200);
    assert.equal((await read()).body.content, ownerContent);
    manual.push({stage, ownerRead: owner.status, otherRead: other.status, viewerUpdate: viewer.status,
      viewerContentChanged: stored.body.content !== initialContent, ownerUpdate: ownerUpdate.status,
      userSuppliedTextVerified: true});
    await context.close();
  }
  const page = await browser.newPage({viewport: {width: 1440, height: 1050}});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(demo.url);
  await page.getByRole('link', {name: 'Try repaired app', exact: true}).waitFor();
  await page.screenshot({path: resolve(output, 'judge-workspace.png'), fullPage: true});
  const details = await (await page.request.get(`${demo.url}/api/demo`)).json();
  assert.equal(details.original.mode, details.repaired.mode);
  assert.notEqual(details.repaired.files[0].beforeHash, details.repaired.files[0].afterHash);
  await page.getByRole('button', {name: 'Generate fresh before/after proof', exact: true}).click();
  await page.waitForURL(/\/reports\/run-\d+\/index\.html$/, {timeout: 120_000});
  const resultUrl = page.url();
  const before = await (await page.request.get(new URL('before-run.json', resultUrl).href)).json();
  const after = await (await page.request.get(new URL('run.json', resultUrl).href)).json();
  assert.equal(before.verdict, 'failed');
  assert.equal(after.verdict, 'passed');
  assert.equal(before.cases.filter(item => item.verdict === 'failed').length, 2);
  assert.equal(after.cases.length, 5);
  assert.equal(before.mode, 'vulnerable');
  assert.equal(after.mode, before.mode);
  assert.equal(after.engine, before.engine);
  assert.equal(after.contractHash, before.contractHash);
  assert.deepEqual(after.inputs, before.inputs);
  assert.notEqual(before.id, after.id);
  assert.deepEqual(after.repair.files, details.repaired.files);
  await page.getByRole('button', {name: 'Before · failed run'}).click();
  await page.locator('[data-case="other-read"]').click();
  assert.match(await page.locator('#observed').innerText(), /HTTP 200/);
  await page.getByRole('button', {name: 'After · verified repair'}).click();
  await page.locator('[data-case="viewer-update"]').click();
  assert.match(await page.locator('#observed').innerText(), /HTTP 403/);
  assert.equal(await page.locator('#mutation').innerText(), 'Unchanged');
  await page.waitForFunction(() => {
    const img = document.querySelector('#preview img');
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  });
  await page.screenshot({path: resolve(output, 'fresh-source-proof.png'), fullPage: true});
  await page.goto(demo.url);
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({path: resolve(output, 'judge-mobile.png'), fullPage: true});
  const forbidden = await page.request.post(`${demo.url}/api/run`, {headers: {Origin: 'https://unrelated.example'},
    data: {engine: 'local', compare: true, target: 'original'}});
  assert.equal(forbidden.status(), 403);
  const simultaneous = await Promise.all([0, 1].map(() => page.request.post(`${demo.url}/api/run`,
    {data: {engine: 'local', compare: false, target: 'repaired'}})));
  assert.deepEqual(simultaneous.map(response => response.status()).sort(), [202, 409]);
  let single;
  for (let attempt = 0; attempt < 120; attempt++) {
    single = await (await page.request.get(`${demo.url}/api/job`)).json();
    if (single.state === 'done' || single.state === 'error') break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(single.state, 'done');
  const selectedProof = await (await page.request.get(`${demo.url}/reports/${single.directory}/run.json`)).json();
  assert.equal(selectedProof.verdict, 'passed');
  assert.deepEqual(selectedProof.repair.files, details.repaired.files);
  assert.notEqual(selectedProof.id, after.id);
  assert.deepEqual(errors, []);
  const result = {verdict: 'passed', scope: 'Independent manual UI requests and a newly generated source-repair report.',
    manual, freshRunIds: {before: before.id, after: after.id}, contractHash: after.contractHash,
    identicalVerificationInputs: true, identicalFixtureMode: true, sourceFiles: after.repair.files,
    screenshotsLoaded: true, mobileOverflow: false, browserErrors: errors, concurrentRunsSerialized: true,
    selectedRepairedAppVerified: true, engine: 'Playwright local development',
    nativeKaneVerification: 'Separate evidence; this review does not claim a native pass.'};
  await writeFile(resolve(output, 'review.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {await browser.close(); await demo.close();}
