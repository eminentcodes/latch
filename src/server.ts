import { createServer } from 'node:http';
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { DemoServer } from '../demo/app.js';
import { loadContract } from './contract.js';
import { renderReport, renderSummary } from './report.js';
import { runComparison, runSuite } from './runner.js';
import type { CaseResult, EngineName, RunResult } from './types.js';
import { sameVerificationInputs } from './verification-inputs.js';
import { workspacePage, type CloudWorkspace } from './workspace-page.js';
import { evidenceArchive, publicEvidenceFile } from './hosting/evidence.js';

type SourceRepair = {fixture: DemoServer; patch: unknown; repair: NonNullable<RunResult['repair']>; assertSources(): Promise<void>};

async function compareSourceRepair(parameters: {projectRoot: string; contractPath: string; outputDir: string;
  engine: EngineName; onCase: (result: CaseResult) => void}, fixture: DemoServer, source: SourceRepair): Promise<void> {
  await source.assertSources();
  const before = await runSuite({...parameters, fixture, evidencePrefix: 'before'});
  if (before.verdict === 'incomplete' || before.cases.length !== before.expectedCases
    || before.cases.some(item => item.verdict === 'incomplete')) {
    await writeFile(join(parameters.outputDir, 'index.html'), renderReport(before), 'utf8');
    await writeFile(join(parameters.outputDir, 'run.json'), JSON.stringify(before, null, 2) + '\n', 'utf8');
    return;
  }
  const after = await runSuite({...parameters, fixture: source.fixture, evidencePrefix: 'after'});
  await source.assertSources();
  if (before.contractHash !== after.contractHash || before.engine !== after.engine || before.mode !== after.mode
    || !sameVerificationInputs(before.inputs, after.inputs)) throw new Error('The original permission checklist or verification inputs changed.');
  after.repair = source.repair;
  await writeFile(join(parameters.outputDir, 'before-run.json'), JSON.stringify(before, null, 2) + '\n', 'utf8');
  await writeFile(join(parameters.outputDir, 'run.json'), JSON.stringify(after, null, 2) + '\n', 'utf8');
  await writeFile(join(parameters.outputDir, 'repair.json'), JSON.stringify(source.repair, null, 2) + '\n', 'utf8');
  await writeFile(join(parameters.outputDir, 'application-patch.json'), JSON.stringify(source.patch, null, 2) + '\n', 'utf8');
  await writeFile(join(parameters.outputDir, 'index.html'), renderReport(after, before, 'repair'), 'utf8');
  await writeFile(join(parameters.outputDir, 'summary.md'), renderSummary(after), 'utf8');
}


export async function serveWorkspace(options: {projectRoot: string; artifactsRoot: string; contractPath: string; fixture: DemoServer; port?: number; host?: string; cloud?: CloudWorkspace; sourceRepair?: SourceRepair}): Promise<{url: string; close(): Promise<void>}> {
  let job: {state: 'idle' | 'running' | 'done' | 'error'; message: string; directory?: string} = {state: 'idle', message: 'Ready.'};
  const isRunning = () => job.state === 'running';
  const contentTypes: Record<string, string> = {'.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webm': 'video/webm', '.zip': 'application/zip', '.evidence': 'application/zip', '.ndjson': 'application/x-ndjson', '.md': 'text/plain; charset=utf-8'};
  const sendJson = (response: import('node:http').ServerResponse, code: number, value: unknown) => {response.writeHead(code, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); response.end(JSON.stringify(value));};
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/') {response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}); response.end(workspacePage(options.cloud?.originalUrl ?? options.fixture.baseUrl,
        options.sourceRepair ? {url: options.cloud?.repairedUrl ?? options.sourceRepair.fixture.baseUrl, files: options.sourceRepair.repair.files} : undefined, options.cloud)); return;}
      if (request.method === 'GET' && url.pathname === '/health') {sendJson(response, 200, {ok: true}); return;}
      if (request.method === 'GET' && url.pathname === '/api/demo') {
        const {contract, hash} = await loadContract(options.contractPath);
        sendJson(response, 200, {scope: 'A controlled document-sharing demonstration; all verification results are generated from live browser requests.',
          original: {url: options.cloud?.originalUrl ?? options.fixture.baseUrl, mode: options.fixture.mode},
          repaired: options.sourceRepair ? {url: options.cloud?.repairedUrl ?? options.sourceRepair.fixture.baseUrl, mode: options.sourceRepair.fixture.mode,
            files: options.sourceRepair.repair.files, method: options.sourceRepair.repair.method} : null,
          contractHash: hash, checks: contract.checks}); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/patch' && options.sourceRepair) {
        sendJson(response, 200, options.sourceRepair.patch); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/job') {sendJson(response, 200, job); return;}
      if (request.method === 'GET' && url.pathname === '/api/runs') {
        const index: unknown[] = [];
        for (const directory of await readdir(options.artifactsRoot).catch(() => [] as string[])) {
          if (!/^[a-z0-9-]+$/i.test(directory)) continue;
          try {const run = JSON.parse(await readFile(join(options.artifactsRoot, directory, 'run.json'), 'utf8')); index.push({directory, name: run.name, engine: run.engine, verdict: run.verdict, finishedAt: run.finishedAt, repair: Boolean(run.repair)});} catch { /* an unfinished run has no index row */ }
        }
        index.sort((a, b) => String((b as {finishedAt: string}).finishedAt).localeCompare(String((a as {finishedAt: string}).finishedAt)));
        sendJson(response, 200, index); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/run') {
        const address = server.address() as AddressInfo;
        const allowedOrigins = [`http://127.0.0.1:${address.port}`, `http://localhost:${address.port}`, ...(options.cloud ? [new URL(options.cloud.workspaceUrl).origin] : [])];
        if (request.headers.origin && !allowedOrigins.includes(request.headers.origin)) {sendJson(response, 403, {error: 'Start checks from this Latch workspace.'}); return;}
        if (!request.headers['content-type']?.startsWith('application/json')) {sendJson(response, 415, {error: 'Use a JSON request.'}); return;}
        if (isRunning()) {sendJson(response, 409, {error: 'A permission check is already running.'}); return;}
        let text = '';for await (const chunk of request) {text += chunk; if (text.length > 1024) throw new Error('Run request too large.');}
        const body = JSON.parse(text) as {engine?: unknown; compare?: unknown; target?: unknown};
        if (!['local', 'kane'].includes(String(body.engine)) || typeof body.compare !== 'boolean') {sendJson(response, 400, {error: 'Select a supported engine and comparison mode.'}); return;}
        if (options.cloud && body.engine === 'kane' && !options.cloud.kaneEnabled) {
          sendJson(response, 409, {error: 'Native Kane is not configured. Choose the quick browser check or ask the owner to configure dedicated test access.'}); return;
        }
        const target = body.target ?? 'original';
        if (!['original', 'repaired'].includes(String(target)) || (target === 'repaired' && !options.sourceRepair)) {
          sendJson(response, 400, {error: 'Select a running original or repaired application.'}); return;
        }
        if (options.sourceRepair) {
          try {await options.sourceRepair.assertSources();} catch (error) {
            sendJson(response, 409, {error: error instanceof Error ? error.message : 'The application source changed.'}); return;
          }
        }
        if (isRunning()) {sendJson(response, 409, {error: 'A permission check is already running.'}); return;}
        const directory = `run-${Date.now()}`;
        job = {state: 'running', message: 'Starting browser verification…', directory};
        const parameters = {projectRoot: options.projectRoot, contractPath: options.contractPath, outputDir: join(options.artifactsRoot, directory), engine: body.engine as EngineName,
          onCase: (result: import('./types.js').CaseResult) => {job = {...job, message: `${result.check.id}: ${result.verdict} — ${result.reason}`};}};
        const single = async () => {
          const run = await runSuite({...parameters, fixture: target === 'repaired' ? options.sourceRepair!.fixture : options.fixture});
          if (options.sourceRepair) await options.sourceRepair.assertSources();
          if (target === 'repaired' && options.sourceRepair) {
            run.repair = options.sourceRepair.repair;
            await writeFile(join(parameters.outputDir, 'run.json'), JSON.stringify(run, null, 2) + '\n', 'utf8');
            await writeFile(join(parameters.outputDir, 'index.html'), renderReport(run, undefined, 'repair'), 'utf8');
            await writeFile(join(parameters.outputDir, 'summary.md'), renderSummary(run), 'utf8');
          }
        };
        const operation = body.compare
          ? options.sourceRepair ? compareSourceRepair(parameters, options.fixture, options.sourceRepair) : runComparison(parameters)
          : single();
        operation.then(() => {job = {state: 'done', message: 'Evidence report ready.', directory};}).catch(error => {job = {state: 'error', message: error instanceof Error ? error.message : 'Verification failed.', directory};});
        sendJson(response, 202, {directory}); return;
      }
      if (request.method === 'GET' && /^\/download\/run-\d+\.zip$/.test(url.pathname)) {
        const root = await realpath(options.artifactsRoot);
        const directory = url.pathname.slice('/download/'.length, -4);
        const actual = await realpath(join(root, directory));
        if (!actual.startsWith(root + sep) || !(await stat(actual)).isDirectory()) {sendJson(response, 403, {error: 'Report is outside the artifact directory.'}); return;}
        const archive = await evidenceArchive(actual);
        response.writeHead(200, {'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="latch-${directory}.zip"`, 'Cache-Control': 'no-store'});
        response.end(archive); return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/reports/')) {
        const root = await realpath(options.artifactsRoot);
        const requested = resolve(root, decodeURIComponent(url.pathname.slice('/reports/'.length)));
        const actual = await realpath(requested);
        if (!actual.startsWith(root + sep) || !(await stat(actual)).isFile()) {sendJson(response, 403, {error: 'Report path is outside the artifact directory.'}); return;}
        if (options.cloud && (actual.endsWith('.evidence') || actual.endsWith('kane-diagnostics.txt'))) {
          sendJson(response, 403, {error: 'Raw vendor packs and diagnostics remain private. Download the exported evidence archive.'}); return;
        }
        const directory = url.pathname.slice('/reports/'.length).split('/')[0]!;
        const data = options.cloud ? await publicEvidenceFile(actual, `/download/${encodeURIComponent(directory)}.zip`, '/') : await readFile(actual);
        response.writeHead(200, {'Content-Type': contentTypes[extname(actual)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
        response.end(data); return;
      }
      sendJson(response, 404, {error: 'Route not found.'});
    } catch {sendJson(response, 404, {error: 'Requested report or route is unavailable.'});}
  });
  await new Promise<void>((resolveReady, reject) => {server.once('error', reject); server.listen(options.port ?? 4318, options.host ?? '127.0.0.1', resolveReady);});
  const address = server.address() as AddressInfo;
  return {url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolveDone => {server.close(() => resolveDone()); server.closeAllConnections();})};
}
