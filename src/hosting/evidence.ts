import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { zipSync } from 'fflate';
import { renderReport } from '../report.js';
import type { RunResult } from '../types.js';

export function publicRun(value: RunResult): RunResult {
  const run = structuredClone(value);
  for (const item of run.cases) {
    delete item.driver.testUrl;
    item.driver.evidence = item.driver.evidence.filter(evidence => evidence.kind !== 'kane-pack');
  }
  return run;
}

export async function publicEvidenceFile(path: string, downloadUrl?: string, homeUrl?: string): Promise<Buffer> {
  const name = basename(path);
  if (name === 'run.json' || name === 'before-run.json') {
    return Buffer.from(JSON.stringify(publicRun(JSON.parse(await readFile(path, 'utf8'))), null, 2) + '\n');
  }
  if (name === 'index.html') {
    const folder = dirname(path);
    const run = publicRun(JSON.parse(await readFile(join(folder, 'run.json'), 'utf8')));
    const beforePath = join(folder, 'before-run.json');
    const before = await readFile(beforePath, 'utf8').then(data => publicRun(JSON.parse(data))).catch(() => null);
    return Buffer.from(renderReport(run, before, run.repair ? 'repair' : 'seeded', {
      ...(downloadUrl ? {downloadUrl} : {}), ...(homeUrl ? {homeUrl} : {})}));
  }
  return readFile(path);
}

export async function evidenceArchive(directory: string): Promise<Uint8Array> {
  const root = await realpath(directory);
  const files: Record<string, Uint8Array> = {};
  const hashes: Record<string, string> = {};
  const privatePackHashes: Record<string, string> = {};
  let size = 0;
  const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
  async function visit(folder: string): Promise<void> {
    for (const item of await readdir(folder, {withFileTypes: true})) {
      if (item.isSymbolicLink()) throw new Error('Evidence export cannot include symbolic links.');
      const path = join(folder, item.name);
      const actual = await realpath(path);
      if (!actual.startsWith(root + sep)) throw new Error('Evidence export is outside the report directory.');
      if (item.isDirectory()) {await visit(path); continue;}
      if (!item.isFile()) continue;
      const name = relative(root, path).split('\\').join('/');
      if (name.endsWith('.evidence')) {privatePackHashes[name] = hash(await readFile(path)); continue;}
      if (name.endsWith('kane-diagnostics.txt')) continue;
      const info = await stat(path);
      size += info.size;
      if (size > 100 * 1024 * 1024) throw new Error('This report is too large for one archive; download its evidence files individually.');
      const data = await publicEvidenceFile(path);
      files[name] = data;
      hashes[name] = hash(data);
    }
  }
  await visit(root);
  files['manifest.json'] = Buffer.from(JSON.stringify({format: 'latch-live-evidence-v1', createdAt: new Date().toISOString(),
    files: hashes, privateKanePacks: privatePackHashes,
    note: 'Raw vendor packs and account share links stay private. Screenshots, events and permission observations are genuine run evidence.'}, null, 2) + '\n');
  return zipSync(files, {level: 1});
}
