import { spawn } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('.cache', {recursive: true});
await mkdir('artifacts', {recursive: true});
const statePath = resolve('.cache/latch-cloud-state.json');
let phase = 'installing';
async function state(next, message) {
  phase = next;
  const temporary = statePath + '.tmp';
  await writeFile(temporary, JSON.stringify({state: next, message}) + '\n');
  await rename(temporary, statePath);
}
async function run(command, args) {
  await new Promise((resolveDone, reject) => {
    const child = spawn(command, args, {cwd: process.cwd(), env: process.env, stdio: ['ignore', 'inherit', 'inherit']});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveDone() : reject(new Error(`${command} exited with ${code}`)));
  });
}
try {
  await state('installing', 'Preparing your isolated browser workspace.');
  await run('npm', ['ci', '--no-audit', '--no-fund']);
  await state('installing', 'Preparing the real browser for your checks.');
  const playwrightCli = resolve('node_modules/playwright/cli.js');
  await run('sudo', [process.execPath, playwrightCli, 'install-deps', 'chromium']);
  await run(process.execPath, [playwrightCli, 'install', 'chromium']);
  await state('building', 'Preparing the original and source-repaired apps.');
  await run('npm', ['run', 'build']);
  const {chromium} = await import('playwright');
  process.env.KANE_CLI_CHROME_PATH = chromium.executablePath();
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = chromium.executablePath();
  await state('starting', 'Starting the live document applications.');
  await import('./judge-cloud.mjs');
} catch (error) {
  console.error(`Latch bootstrap failed during ${phase}.`, error instanceof Error ? error.name : 'Error');
  await state('error', `The demo could not finish ${phase}. The owner can inspect the Sandbox logs.`);
  process.exitCode = 1;
}
