import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

export type ProcessResult = {code: number | null; stdout: string; stderr: string; timedOut: boolean};

export async function capture(command: string, args: string[], options: {cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; input?: string}): Promise<ProcessResult> {
  return new Promise(resolveResult => {
    const child = spawn(command, args, {cwd: options.cwd, env: options.env ?? process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false});
    let stdout = '', stderr = '', timedOut = false, finished = false;
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      resolveResult({code, stdout, stderr, timedOut});
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
        killer.once('error', () => child.kill());
      } else child.kill('SIGTERM');
      setTimeout(() => {child.kill('SIGKILL'); finish(null);}, 3000).unref();
    }, options.timeoutMs ?? 180_000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {stdout += chunk; if (stdout.length > 8_000_000) {stderr += '\nOutput exceeded the bounded capture size.'; child.kill();}});
    child.stderr.on('data', chunk => {if (stderr.length < 2_000_000) stderr += chunk;});
    child.once('error', error => {stderr = error.message; finish(null);});
    child.once('close', code => finish(code));
    child.stdin.on('error', () => undefined);
    if (options.input) child.stdin.write(options.input);
    child.stdin.end();
  });
}

async function exists(path: string): Promise<boolean> {try {await access(path, constants.F_OK); return true;} catch {return false;}}

export async function kaneCommand(projectRoot: string): Promise<{command: string; args: string[]}> {
  const wrapper = resolve(projectRoot, 'node_modules/@testmuai/kane-cli/bin/kane-cli.cjs');
  if (await exists(wrapper)) return {command: process.execPath, args: [wrapper]};
  for (const path of (process.env.PATH ?? '').split(delimiter)) {
    const native = join(path, process.platform === 'win32' ? 'kane-cli.exe' : 'kane-cli');
    if (await exists(native)) return {command: native, args: []};
    const globalWrapper = join(path, 'node_modules/@testmuai/kane-cli/bin/kane-cli.cjs');
    if (await exists(globalWrapper)) return {command: process.execPath, args: [globalWrapper]};
  }
  throw new Error('Kane CLI is not installed. Run npm install -D @testmuai/kane-cli, then npm run kane:login.');
}

export async function codexCommand(): Promise<{command: string; args: string[]}> {
  for (const path of (process.env.PATH ?? '').split(delimiter)) {
    const native = join(path, process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (await exists(native)) return {command: native, args: []};
    const wrapper = join(path, 'node_modules/@openai/codex/bin/codex.js');
    if (await exists(wrapper)) return {command: process.execPath, args: [wrapper]};
    const unixWrapper = resolve(dirname(path), 'lib/node_modules/@openai/codex/bin/codex.js');
    if (await exists(unixWrapper)) return {command: process.execPath, args: [unixWrapper]};
  }
  throw new Error('Codex CLI is not installed or is not on PATH.');
}
