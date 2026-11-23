import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { startJudgeDemo } from '../dist/src/judge-demo.js';
import { launchLocalBrowser } from '../dist/src/drivers/local.js';
import { handleSession } from '../dist/src/hosting/handler.js';

const output = resolve('artifacts/ui/vercel');
await mkdir(output, {recursive: true});
async function listen(server) {
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  await new Promise(resolveDone => {server.close(() => resolveDone()); server.closeAllConnections();});
}
async function proxy() {
  let target;
  const server = createServer((request, response) => {
    if (!target) {response.writeHead(503); response.end('Preparing the real local application.'); return;}
    const destination = new URL(request.url, target);
    const upstream = httpRequest(destination, {method: request.method, headers: {...request.headers, host: destination.host}}, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(response);
    });
    upstream.on('error', () => {if (!response.headersSent) response.writeHead(502); response.end('Local proxy failed.');});
    request.pipe(upstream);
  });
  const url = await listen(server);
  return {url, setTarget(value) {target = value;}, close: () => close(server)};
}

const root = await realpath('public');
const staticServer = createServer(async (request, response) => {
  if (request.url.startsWith('/api/session')) {
    await handleSession(request, response, {sourceRef: 'a'.repeat(40), env: {}});
    return;
  }
  try {
    const name = new URL(request.url, 'http://localhost').pathname;
    const actual = await realpath(resolve(root, '.' + (name === '/' ? '/index.html' : decodeURIComponent(name))));
    if (!actual.startsWith(root + sep)) throw new Error('Outside public');
    const type = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}[extname(actual)] ?? 'application/octet-stream';
    response.writeHead(200, {'Content-Type': type});
    response.end(await readFile(actual));
  } catch {response.writeHead(404); response.end('Missing public artifact');}
});
const siteUrl = await listen(staticServer);
const fronts = await Promise.all([proxy(), proxy(), proxy()]);
const cloud = {originalUrl: fronts[0].url, workspaceUrl: fronts[1].url, repairedUrl: fronts[2].url,
  homeUrl: siteUrl, expiresAt: new Date(Date.now() + 2_700_000).toISOString(), kaneEnabled: false};
const demo = await startJudgeDemo({projectRoot: process.cwd(), artifactsRoot: resolve('artifacts/vercel-review'),
  port: 0, appPort: 0, repairedPort: 0, cloud});
fronts[0].setTarget(demo.original.baseUrl);
fronts[1].setTarget(demo.url);
fronts[2].setTarget(demo.repaired.baseUrl);
const browser = await launchLocalBrowser();
const errors = [];
const manual = [];
try {
  const home = await browser.newPage({viewport: {width: 1440, height: 1000}});
  home.on('pageerror', error => errors.push(error.message));
  await home.goto(siteUrl);
  await home.getByText('The owner has not enabled live sessions yet.', {exact: false}).waitFor();
  assert.equal(await home.getByRole('button', {name: 'Start live demo', exact: true}).isDisabled(), true);
  await home.screenshot({path: join(output, 'vercel-site.png'), fullPage: true});
  await home.setViewportSize({width: 390, height: 844});
  assert.equal(await home.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await home.screenshot({path: join(output, 'vercel-site-mobile.png'), fullPage: true});
  await home.goto(siteUrl + '/recorded.html');
  const frame = home.frameLocator('iframe');
  await frame.locator('#after').click();
  await frame.locator('#case-list button').nth(1).click();
  await frame.locator('#preview img').waitFor();
  assert.equal(await frame.locator('#preview img').evaluate(image => image.complete && image.naturalWidth > 0), true);
  assert.equal(await frame.locator('body').evaluate(body => body.scrollWidth <= innerWidth), true);
  await home.screenshot({path: join(output, 'recorded-mobile.png'), fullPage: true});

  for (const [stage, url, forbiddenStatus] of [['original', cloud.originalUrl, 200], ['repaired', cloud.repairedUrl, 403]]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const login = async name => {await page.goto(url + '/login'); await page.getByRole('button', {name: `Continue as ${name}`, exact: true}).click(); await page.getByText(`Signed in as ${name}`, {exact: false}).waitFor();};
    const read = async () => {
      const pending = page.waitForResponse(response => response.url().endsWith('/api/documents/launch-plan') && response.request().method() === 'GET');
      await page.goto(url + '/documents/launch-plan');
      const response = await pending;
      await page.locator('#document[data-ready="true"]').waitFor();
      return {status: response.status(), body: await response.json()};
    };
    const update = async content => {
      await page.goto(url + '/probe/documents/launch-plan');
      await page.getByLabel('Proposed content').fill(content);
      const pending = page.waitForResponse(response => response.url().endsWith('/api/documents/launch-plan') && response.request().method() === 'PUT');
      await page.getByRole('button', {name: 'Send update request'}).click();
      return (await pending).status();
    };
    await login('Avery');
    const originalContent = (await read()).body.content;
    await login('Morgan');
    const other = await read();
    assert.equal(other.status, forbiddenStatus);
    await page.screenshot({path: join(output, `${stage}-read.png`), fullPage: true});
    await login('Sam');
    assert.equal((await read()).status, 200);
    const text = `Cloud-style judge text ${randomUUID()}`;
    assert.equal(await update(text), forbiddenStatus);
    await login('Avery');
    assert.equal((await read()).body.content, stage === 'original' ? text : originalContent);
    const ownerText = `Owner remains permitted ${randomUUID()}`;
    assert.equal(await update(ownerText), 200);
    assert.equal((await read()).body.content, ownerText);
    manual.push({stage, otherRead: forbiddenStatus, viewerUpdate: forbiddenStatus, ownerUpdate: 200, actualUserTextVerified: true});
    await context.close();
  }
  const page = await browser.newPage({viewport: {width: 1440, height: 1050}});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(cloud.workspaceUrl);
  assert.equal(await page.getByRole('link', {name: 'Try original app', exact: true}).getAttribute('href'), cloud.originalUrl + '/login');
  assert.equal(await page.locator('#engine option[value="kane"]').isDisabled(), true);
  await page.getByRole('button', {name: 'Generate fresh before/after proof', exact: true}).click();
  await page.waitForURL(/\/reports\/run-\d+\/index\.html$/, {timeout: 180_000});
  const resultUrl = page.url();
  const before = await (await page.request.get(new URL('before-run.json', resultUrl).href)).json();
  const after = await (await page.request.get(new URL('run.json', resultUrl).href)).json();
  assert.deepEqual(before.cases.filter(item => item.verdict === 'failed').map(item => item.check.id), ['other-read', 'viewer-update']);
  assert.equal(after.verdict, 'passed');
  assert.equal(after.cases.length, 5);
  assert.equal(before.contractHash, after.contractHash);
  assert.deepEqual(before.inputs, after.inputs);
  assert.equal(before.mode, after.mode);
  assert.equal(after.engine, 'local');
  for (const item of after.cases.filter(item => item.check.expect === 'deny')) {assert.equal(item.observation.status, 403); assert.equal(item.observation.beforeHash, item.observation.afterHash);}
  await page.screenshot({path: join(output, 'fresh-report.png'), fullPage: true});
  const archiveUrl = await page.getByRole('link', {name: 'Download evidence archive', exact: true}).last().getAttribute('href');
  const archiveResponse = await page.request.get(new URL(archiveUrl, resultUrl).href);
  assert.equal(archiveResponse.status(), 200);
  const archive = unzipSync(await archiveResponse.body());
  const manifest = JSON.parse(Buffer.from(archive['manifest.json']).toString());
  for (const [name, hash] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(archive[name]).digest('hex'), hash);
  assert.equal(JSON.parse(Buffer.from(archive['run.json']).toString()).id, after.id);
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.getByRole('link', {name: 'Download evidence archive', exact: true}).last().isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({path: join(output, 'fresh-report-mobile.png'), fullPage: true});

  let recordedFiles = 0;
  async function verifyCopy(folder, prefix = '') {
    for (const item of await readdir(folder, {withFileTypes: true})) {
      const name = prefix ? prefix + '/' + item.name : item.name;
      if (item.isDirectory()) {await verifyCopy(join(folder, item.name), name); continue;}
      assert.deepEqual(await readFile(join(folder, item.name)), await readFile(join(root, 'evidence/native-repair', name)));
      recordedFiles++;
    }
  }
  await verifyCopy('evidence/native-repair');
  assert.deepEqual(errors, []);
  const review = {scope: 'Local HTTP proxies and actual Chromium checks of the cloud adapter; no Vercel Sandbox was created.',
    manual, before: before.id, after: after.id, archiveFiles: Object.keys(manifest.files).length,
    recordedFilesPreserved: recordedFiles, mobileVerified: true, browserErrors: errors};
  await writeFile(join(output, 'review.json'), JSON.stringify(review, null, 2) + '\n');
  console.log(JSON.stringify(review, null, 2));
} finally {
  await browser.close();
  await demo.close();
  await Promise.all(fronts.map(front => front.close()));
  await close(staticServer);
}
