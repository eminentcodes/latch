import { copyFile, mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { capture, kaneCommand, type ProcessResult } from '../process.js';
import type { DriverResult, Evidence } from '../types.js';
import { extractKaneScreenshots } from './kane-evidence.js';

type EndEvent = {type: 'run_end'; status: 'passed' | 'failed'; summary?: string; reason?: string; duration?: number; credits_consumed?: number; test_url?: string; session_dir?: string};
export function redactKaneDiagnostic(value: string, secrets: readonly string[] = []): string {
  let safe = value.replace(/\u001b\[[0-9;]*m/g, '');
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) safe = safe.split(secret).join('[redacted]');
  safe = safe.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/((?:access[_-]?key|api[_-]?key|token|secret|password)\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[redacted]');
  return safe.slice(-12_000);
}
export function parseKaneOutput(result: ProcessResult): {end: EndEvent | null; state: DriverResult['state']; summary: string; events: Record<string, unknown>[]} {
  const events: Record<string, unknown>[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    try {const value: unknown = JSON.parse(line); if (value && typeof value === 'object' && !Array.isArray(value)) events.push(value as Record<string, unknown>);} catch { /* vendor output may include non-JSON lines */ }
  }
  const ends = events.filter(event => event.type === 'run_end');
  const end = ends.length === 1 && ['passed', 'failed'].includes(String(ends[0]?.status)) ? ends[0] as unknown as EndEvent : null;
  if (result.timedOut || result.code === 3) return {end, state: 'timeout', summary: 'Kane did not finish within the allotted time.', events};
  const refusal = events.find(event => event.type === 'error' || event.type === 'ask_user' || (event.type === 'warning' && event.code === 'unresolved_variables') || (event.v !== undefined && event.v !== 1));
  if (refusal || result.code === 2 || result.code === null || !end) {
    const message = typeof refusal?.message === 'string' ? refusal.message : 'Kane did not return a complete usable verification result.';
    return {end, state: 'error', summary: message, events};
  }
  if (result.code !== (end.status === 'passed' ? 0 : 1)) return {end, state: 'error', summary: 'Kane process status disagreed with its verification result.', events};
  return {end, state: end.status, summary: end.summary ?? end.reason ?? `Kane ${end.status}.`, events};
}

function sanitizedEvents(events: Record<string, unknown>[]): string {
  const allowed = ['type', 'v', 'ts', 'cli_version', 'surface', 'step', 'status', 'remark', 'summary', 'reason', 'duration', 'credits_consumed', 'code'];
  let output = events.map(event => JSON.stringify(Object.fromEntries(Object.entries(event).filter(([key]) => allowed.includes(key))))).join('\n') + '\n';
  for (const key of ['LT_ACCESS_KEY', 'GH_TOKEN', 'GITHUB_TOKEN']) if (process.env[key]) output = output.split(process.env[key]!).join('[redacted]');
  return output;
}

export async function kaneCase(options: {objective: string; projectRoot: string; baseUrl: string; outputDir: string; reportRoot: string; timeoutSeconds?: number; maxSteps?: number}): Promise<DriverResult> {
  const started = Date.now();
  await mkdir(options.outputDir, {recursive: true});
  const evidence: Evidence[] = [];
  try {
    const executable = await kaneCommand(options.projectRoot);
    const timeout = options.timeoutSeconds ?? 360;
    if (Boolean(process.env.LT_USERNAME) !== Boolean(process.env.LT_ACCESS_KEY)) throw new Error('Set both LT_USERNAME and LT_ACCESS_KEY for CI authentication, or use local Kane OAuth login.');
    const authentication = process.env.LT_USERNAME && process.env.LT_ACCESS_KEY ? ['--username', process.env.LT_USERNAME, '--access-key', process.env.LT_ACCESS_KEY] : [];
    const result = await capture(executable.command, [...executable.args, 'run', options.objective, '--agent', '--headless',
      '--assertion-mode', 'dom', '--final-validation', 'on', '--assertion-failure-mode', 'stop', '--bug-detection', 'off',
      '--timeout', String(timeout), '--max-steps', String(options.maxSteps ?? 18), '--url', options.baseUrl, ...authentication], {cwd: options.projectRoot, timeoutMs: (timeout + 15) * 1000});
    const parsed = parseKaneOutput(result);
    if (parsed.state === 'error' || parsed.state === 'timeout') {
      const secretValues = Object.entries(process.env).filter(([key]) => /(?:TOKEN|SECRET|PASSWORD|ACCESS_KEY|API_KEY)/i.test(key))
        .map(([, value]) => value ?? '');
      const diagnostic = redactKaneDiagnostic(`Process exit: ${result.code ?? 'no exit code'}\nTimed out: ${result.timedOut}\n\nSTDERR\n${result.stderr}\n\nSTDOUT\n${result.stdout}`, secretValues)
        .split(homedir()).join('[user-home]');
      const diagnosticPath = join(options.outputDir, 'kane-diagnostics.txt');
      await writeFile(diagnosticPath, diagnostic, 'utf8');
      evidence.push({kind: 'trace', path: relative(options.reportRoot, diagnosticPath).split('\\').join('/'), label: 'Kane process diagnostics; no completed verification'});
    }
    const eventsPath = join(options.outputDir, 'kane-events.ndjson');
    await writeFile(eventsPath, sanitizedEvents(parsed.events), 'utf8');
    evidence.push({kind: 'events', path: relative(options.reportRoot, eventsPath).split('\\').join('/'), label: 'Kane run events'});
    if (parsed.end?.session_dir) {
      const given = parsed.end.session_dir.replace(/^~(?=[/\\])/, homedir());
      const sessionRoot = await realpath(join(homedir(), '.testmuai/kaneai/sessions')).catch(() => '');
      const session = isAbsolute(given) ? await realpath(given).catch(() => '') : '';
      if (sessionRoot && session.startsWith(sessionRoot + sep)) {
        const packs = await readdir(join(session, 'evidence')).catch(() => [] as string[]);
        for (const filename of packs.filter(name => name.endsWith('.evidence'))) {
          const source = join(session, 'evidence', filename);
          const info = await stat(source);
          if (info.isFile() && info.mtimeMs >= started - 5000 && info.size > 0) {
            const destination = join(options.outputDir, 'kane.evidence');
            await copyFile(source, destination);
            evidence.push({kind: 'kane-pack', path: relative(options.reportRoot, destination).split('\\').join('/'), label: 'Kane evidence pack'});
            evidence.push(...await extractKaneScreenshots(destination, options.outputDir, options.reportRoot));
            break;
          }
        }
      }
    }
    const state = parsed.state === 'passed' && !evidence.some(item => item.kind === 'kane-pack') ? 'error' : parsed.state;
    return {engine: 'kane', state, summary: state === 'error' && parsed.state === 'passed' ? 'Kane returned success without a fresh evidence pack.' : parsed.summary,
      durationMs: Date.now() - started, evidence: evidence.filter(item => item.kind !== 'events' || evidence.some(artifact => artifact.kind === 'kane-pack')),
      terminal: state === 'passed' || state === 'failed', ...(typeof parsed.end?.credits_consumed === 'number' ? {credits: parsed.end.credits_consumed} : {}),
      ...(parsed.end?.test_url && /^https:\/\//.test(parsed.end.test_url) ? {testUrl: parsed.end.test_url} : {})};
  } catch (error) {
    return {engine: 'kane', state: 'error', summary: error instanceof Error ? error.message : 'Kane could not start.', durationMs: Date.now() - started, evidence, terminal: false};
  }
}
