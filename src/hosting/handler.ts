import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Sandbox } from '@vercel/sandbox';
import { CHECKOUT_PROBE, validCheckoutRoot } from './checkout.js';
import { cookieValue, hostingConfig, readTicket, REPOSITORY_URL, sameOrigin,
  SANDBOX_PORTS, SESSION_COOKIE, SESSION_MS, signTicket, type HostingConfig, type SessionTicket } from './session.js';

type Connection = Pick<Sandbox, 'name' | 'status' | 'cwd' | 'domain' | 'runCommand' | 'readFileToBuffer' | 'stop'>;
export type CloudProvider = {
  create(options: Parameters<typeof Sandbox.create>[0]): Promise<Connection>;
  get(options: Parameters<typeof Sandbox.get>[0]): Promise<Connection>;
};
const provider: CloudProvider = {create: options => Sandbox.create(options), get: options => Sandbox.get(options)};

class BootstrapFailure extends Error {
  constructor(readonly details: string) {
    super('The demo setup process stopped before its workspace started.');
    this.name = 'BootstrapFailure';
  }
}
function setupDetails(text: string, config: HostingConfig): string {
  for (const value of [config.sessionSecret, config.kaneUsername, config.kaneAccessKey].sort((a, b) => b.length - a.length)) {
    if (value) text = text.split(value).join('[redacted]');
  }
  return text.slice(-3000);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  response.end(JSON.stringify(value));
}
function setCookie(response: ServerResponse, value: string, maxAge: number): void {
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api/session; Max-Age=${maxAge}`);
}
function links(sandbox: Connection) {
  return {workspaceUrl: sandbox.domain(SANDBOX_PORTS.workspace), originalUrl: sandbox.domain(SANDBOX_PORTS.original),
    repairedUrl: sandbox.domain(SANDBOX_PORTS.repaired)};
}
async function sessionStatus(sandbox: Connection, ticket: SessionTicket) {
  if (sandbox.status !== 'running') return {state: 'expired', message: 'This demo has ended. Start a new session.'};
  const content = await sandbox.readFileToBuffer({path: '.cache/latch-cloud-state.json', cwd: ticket.checkoutRoot ?? sandbox.cwd}, {signal: AbortSignal.timeout(10_000)});
  let state: {state: string; message: string} = {state: 'starting', message: 'Preparing your isolated demo.'};
  if (content && content.length < 4096) {
    const parsed = JSON.parse(content.toString()) as {state?: unknown; message?: unknown};
    if (['installing', 'building', 'starting', 'ready', 'error'].includes(String(parsed.state)) && typeof parsed.message === 'string') {
      state = {state: String(parsed.state), message: parsed.message.slice(0, 240)};
    }
  }
  return {...state, ...links(sandbox), expiresAt: new Date(ticket.expiresAt).toISOString()};
}
function notFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'status' in error && error.status === 404);
}

export async function handleSession(request: IncomingMessage, response: ServerResponse, options: {
  sourceRef: string; env?: NodeJS.ProcessEnv; cloud?: CloudProvider;
}): Promise<void> {
  const env = options.env ?? process.env;
  const client = options.cloud ?? provider;
  const host = request.headers.host;
  const protocol = host?.startsWith('localhost:') || host?.startsWith('127.0.0.1:') ? 'http' : 'https';
  const config: HostingConfig = hostingConfig(env, options.sourceRef, `${protocol}://${host ?? ''}`);
  const ticket = readTicket(cookieValue(request.headers.cookie), config.sessionSecret, config.sourceRef);
  const configuration = {enabled: config.enabled, kaneEnabled: config.kaneEnabled, sourceRef: config.sourceRef,
    maxSessionMinutes: 45};
  try {
    if (request.method === 'GET') {
      if (!ticket || !config.enabled) {json(response, 200, {...configuration, state: 'idle'}); return;}
      try {
        const sandbox = await client.get({name: ticket.name, resume: false, signal: AbortSignal.timeout(15_000)});
        json(response, 200, {...configuration, ...await sessionStatus(sandbox, ticket)});
      } catch (error) {
        if (!notFound(error)) throw error;
        setCookie(response, '', 0);
        json(response, 200, {...configuration, state: 'expired', message: 'This demo has ended. Start a new session.'});
      }
      return;
    }
    if (!['POST', 'DELETE'].includes(request.method ?? '')) {response.setHeader('Allow', 'GET, POST, DELETE'); json(response, 405, {error: 'Method not supported.'}); return;}
    if (!sameOrigin(request.headers.origin, host)) {json(response, 403, {error: 'Start the demo from this website.'}); return;}
    if (request.method === 'DELETE') {
      if (!ticket) {json(response, 401, {error: 'There is no active session in this browser.'}); return;}
      try {
        const sandbox = await client.get({name: ticket.name, resume: false, signal: AbortSignal.timeout(15_000)});
        if (sandbox.status === 'running') await sandbox.stop({signal: AbortSignal.timeout(15_000)});
      } catch (error) {if (!notFound(error)) throw error;}
      setCookie(response, '', 0);
      json(response, 200, {state: 'stopped', message: 'Your demo has stopped.'}); return;
    }
    if (!config.enabled) {json(response, 503, {error: 'Live sessions are not configured yet. The project owner can finish the Vercel setup.'}); return;}
    if (ticket) {
      try {
        const existing = await client.get({name: ticket.name, resume: false, signal: AbortSignal.timeout(15_000)});
        if (existing.status === 'running') {json(response, 200, {...configuration, ...await sessionStatus(existing, ticket)}); return;}
      } catch (error) {if (!notFound(error)) throw error;}
    }
    const expiresAt = Date.now() + SESSION_MS;
    const sandbox = await client.create({name: `latch-judge-${randomUUID()}`, image: 'vercel/sandbox/node:22',
      source: {type: 'git', url: REPOSITORY_URL, revision: config.sourceRef, depth: 1},
      ports: Object.values(SANDBOX_PORTS), resources: {vcpus: 2}, timeout: SESSION_MS, persistent: false,
      tags: {app: 'latch-judge'}, signal: AbortSignal.timeout(40_000)});
    const urls = links(sandbox);
    const commandEnv: Record<string, string> = {LATCH_PUBLIC_WORKSPACE_URL: urls.workspaceUrl, LATCH_PUBLIC_ORIGINAL_URL: urls.originalUrl,
      LATCH_PUBLIC_REPAIRED_URL: urls.repairedUrl, LATCH_HOME_URL: config.homeUrl, LATCH_SESSION_EXPIRES_AT: new Date(expiresAt).toISOString(),
      LATCH_KANE_ENABLED: String(config.kaneEnabled)};
    if (config.kaneEnabled) {commandEnv.LT_USERNAME = config.kaneUsername; commandEnv.LT_ACCESS_KEY = config.kaneAccessKey;}
    let checkoutRoot: string;
    try {
      const probe = await sandbox.runCommand({cmd: 'node', args: ['--input-type=module', '--eval', CHECKOUT_PROBE],
        cwd: sandbox.cwd, signal: AbortSignal.timeout(10_000)});
      if (probe.exitCode !== 0) throw new BootstrapFailure(setupDetails(await probe.stderr(), config));
      const found = JSON.parse(await probe.stdout()) as {checkoutRoot?: unknown};
      if (!validCheckoutRoot(found.checkoutRoot)) throw new BootstrapFailure('The checkout directory is invalid.');
      checkoutRoot = found.checkoutRoot;
      const bootstrap = await sandbox.runCommand({cmd: 'node', args: ['scripts/sandbox-bootstrap.mjs'], cwd: checkoutRoot, detached: true,
        env: commandEnv, signal: AbortSignal.timeout(10_000)});
      const startupWindow = AbortSignal.timeout(2000);
      let ended;
      try {ended = await bootstrap.wait({signal: startupWindow});}
      catch (error) {if (!startupWindow.aborted) throw error;}
      if (ended) throw new BootstrapFailure(setupDetails(await ended.stderr(), config) || `Setup ended with exit code ${ended.exitCode}.`);
    } catch (error) {
      await sandbox.stop({signal: AbortSignal.timeout(10_000)}).catch(() => undefined);
      throw error;
    }
    setCookie(response, signTicket({name: sandbox.name, sourceRef: config.sourceRef, expiresAt, checkoutRoot}, config.sessionSecret), Math.floor(SESSION_MS / 1000));
    json(response, 202, {...configuration, state: 'starting', message: 'Preparing your isolated demo.', ...urls,
      expiresAt: new Date(expiresAt).toISOString()});
  } catch (error) {
    console.error('Latch Sandbox request failed.', {type: error instanceof Error ? error.name : 'Error',
      status: error && typeof error === 'object' && 'status' in error ? error.status : undefined});
    json(response, 502, error instanceof BootstrapFailure ? {error: error.message, details: error.details}
      : {error: 'Vercel Sandbox could not complete this request. The owner can check the project runtime logs and Sandbox allowance.'});
  }
}
