import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { actors, freshDocument, type DemoActor } from './data.js';
import { mayRead, mayUpdate, type PolicyMode } from './policy.js';
import { documentPage, homePage, loginPage, updatePage } from './views.js';
import type { Observation } from '../src/types.js';

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  response.end(JSON.stringify(body));
}
function html(response: ServerResponse, body: string): void {
  response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  response.end(body);
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += Buffer.byteLength(chunk);
    if (length > 16_384) throw new Error('Request body too large.');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export type DemoServer = {
  baseUrl: string;
  mode: PolicyMode;
  observerKey: string;
  reset(): void;
  observation(caseTag: string): Observation | null;
  close(): Promise<void>;
};

export async function startDemo(options: {port?: number; mode?: PolicyMode; host?: string} = {}): Promise<DemoServer> {
  const mode = options.mode ?? 'secure';
  let document = freshDocument();
  const observations: Observation[] = [];
  const sessions = new Map<string, DemoActor>();
  const observerKey = randomBytes(24).toString('hex');
  const reset = () => { document = freshDocument(); observations.length = 0; sessions.clear(); };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const cookies = (request.headers.cookie ?? '').split(';').map(part => part.trim());
      const token = cookies.find(cookie => cookie.startsWith('latch_session='))?.slice('latch_session='.length);
      const actor = token ? sessions.get(token) : undefined;
      if (request.method === 'GET' && url.pathname === '/health') { send(response, 200, {ok: true, fixture: 'latch-document-demo'}); return; }
      if (request.method === 'POST' && url.pathname === '/auth/session') {
        const body = await readBody(request) as {actor?: unknown};
        const selected = actors.find(item => item.id === body?.actor);
        if (!selected) { send(response, 400, {error: 'Unknown test identity.'}); return; }
        const session = randomBytes(24).toString('hex');
        sessions.set(session, selected);
        response.setHeader('Set-Cookie', `latch_session=${session}; HttpOnly; SameSite=Strict; Path=/`);
        send(response, 200, {name: selected.name}); return;
      }
      if (request.method === 'GET' && url.pathname === '/auth/me') {
        send(response, actor ? 200 : 401, actor ?? {error: 'Choose a test identity.'}); return;
      }
      if (url.pathname.startsWith('/__latch/')) {
        if (request.headers['x-latch-observer'] !== observerKey) { send(response, 403, {error: 'Observer access denied.'}); return; }
        if (url.pathname === '/__latch/reset' && request.method === 'POST') { reset(); send(response, 200, {reset: true}); return; }
        if (url.pathname === '/__latch/observation' && request.method === 'GET') {
          const matching = observations.filter(item => item.caseTag === url.searchParams.get('case'));
          send(response, 200, {observation: matching.at(-1) ?? null}); return;
        }
        send(response, 404, {error: 'Observer route missing.'}); return;
      }
      if (url.pathname === '/api/documents/launch-plan' && ['GET', 'PUT'].includes(request.method ?? '')) {
        const action = request.method === 'PUT' ? 'update' : 'read';
        const beforeHash = hash(document);
        let status = actor ? 403 : 401;
        let disclosed = false;
        let result: unknown = {error: 'Access denied'};
        if (action === 'read' && mayRead(actor, document, mode)) { status = 200; disclosed = true; result = {...document}; }
        if (action === 'update' && mayUpdate(actor, document, mode)) {
          const body = await readBody(request) as {content?: unknown};
          if (typeof body?.content !== 'string' || !body.content.trim() || body.content.length > 5000) {
            status = 400; result = {error: 'Content must be a short non-empty string.'};
          } else {
            document = {...document, content: body.content}; status = 200; result = {updated: true};
          }
        }
        const caseTag = typeof request.headers['x-latch-case'] === 'string' ? request.headers['x-latch-case'] : '';
        observations.push({caseTag, actor: actor?.id ?? null, resource: document.id, action, status, disclosed,
          beforeHash, afterHash: hash(document), at: new Date().toISOString()});
        send(response, status, result); return;
      }
      if (request.method === 'GET') {
        if (url.pathname === '/') { html(response, homePage()); return; }
        if (url.pathname === '/login') { html(response, loginPage()); return; }
        if (url.pathname === '/documents/launch-plan') { html(response, documentPage()); return; }
        if (url.pathname === '/probe/documents/launch-plan') { html(response, updatePage()); return; }
      }
      send(response, 404, {error: 'Route not found.'});
    } catch { if (!response.headersSent) send(response, 400, {error: 'Invalid test request.'}); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`, mode, observerKey, reset,
    observation: caseTag => observations.filter(item => item.caseTag === caseTag).at(-1) ?? null,
    close: () => new Promise<void>((resolve, reject) => {server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();}),
  };
}
