import { access, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { Actor, PermissionCheck, Resource } from '../contract.js';
import { actorName } from '../scenario.js';
import type { DriverResult, Evidence } from '../types.js';

export async function launchLocalBrowser(): Promise<Browser> {
  const candidates = [process.env.KANE_CLI_CHROME_PATH, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    join(homedir(), 'AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe')].filter((path): path is string => Boolean(path));
  for (const executablePath of candidates) {
    try {await access(executablePath);} catch {continue;}
    return chromium.launch({executablePath, headless: true});
  }
  return chromium.launch({headless: true});
}

export async function localCase(browser: Browser, options: {check: PermissionCheck; actor: Actor; resource: Resource; baseUrl: string; caseTag: string; outputDir: string; reportRoot: string}): Promise<DriverResult> {
  const started = Date.now();
  const {check, actor, resource} = options;
  await mkdir(options.outputDir, {recursive: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 960}, recordVideo: {dir: options.outputDir, size: {width: 1440, height: 960}}});
  await context.tracing.start({screenshots: true, snapshots: true});
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const evidence: Evidence[] = [];
  let state: DriverResult['state'] = 'passed';
  let summary = 'The browser assertion matched the declared permission.';
  try {
    await page.goto(`${options.baseUrl}/login`);
    await page.getByRole('button', {name: `Continue as ${actorName(actor)}`, exact: true}).click();
    await page.getByText(`Signed in as ${actorName(actor)}`, {exact: false}).waitFor();
    const target = new URL(check.action === 'read' ? resource.path : resource.updatePath, options.baseUrl);
    target.searchParams.set('case', options.caseTag);
    await page.goto(target.href);
    if (check.action === 'read') {
      await page.locator('#document[data-ready="true"]').waitFor();
      const content = await page.locator('#document').innerText();
      const actualAllowed = content.includes(resource.marker);
      if (actualAllowed !== (check.expect === 'allow')) {
        state = 'failed'; summary = check.expect === 'deny' ? 'The browser received the private document instead of a denial.' : 'The permitted user could not read the document.';
      }
    } else {
      await page.getByLabel('Proposed content').fill(`Latch synthetic update ${options.caseTag}`);
      await page.getByRole('button', {name: 'Send update request'}).click();
      await page.locator('#result[data-status]').waitFor();
      const status = Number(await page.locator('#result').getAttribute('data-status'));
      if ((status >= 200 && status < 300) !== (check.expect === 'allow')) {
        state = 'failed'; summary = check.expect === 'deny' ? 'The server accepted a viewer update from the browser.' : 'The permitted owner update was denied.';
      }
    }
  } catch (error) {
    state = error instanceof Error && /timeout/i.test(error.message) ? 'timeout' : 'error';
    summary = error instanceof Error ? error.message.split('\n')[0] ?? 'Browser verification failed.' : 'Browser verification failed.';
  } finally {
    const screenshot = join(options.outputDir, 'browser.png');
    try {await page.screenshot({path: screenshot, fullPage: true}); evidence.push({kind: 'screenshot', path: relative(options.reportRoot, screenshot).split('\\').join('/'), label: 'Browser screenshot'});} catch { /* no usable screenshot */ }
    const trace = join(options.outputDir, 'browser-trace.zip');
    try {await context.tracing.stop({path: trace}); evidence.push({kind: 'trace', path: relative(options.reportRoot, trace).split('\\').join('/'), label: 'Playwright trace'});} catch { /* preserve the original failure */ }
    const video = page.video();
    await context.close();
    if (video) {
      const videoPath = await video.path();
      evidence.push({kind: 'video', path: relative(options.reportRoot, videoPath).split('\\').join('/'), label: 'Browser recording'});
    }
  }
  return {engine: 'local', state, summary, durationMs: Date.now() - started, evidence, terminal: state === 'passed' || state === 'failed'};
}
