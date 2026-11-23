import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { extractKaneScreenshots } from '../dist/src/drivers/kane-evidence.js';
import { renderReport } from '../dist/src/report.js';

const root = resolve(process.argv[2] ?? 'artifacts/kane-proof');
const before = JSON.parse(await readFile(resolve(root, 'before-run.json'), 'utf8'));
const after = JSON.parse(await readFile(resolve(root, 'after-run.json'), 'utf8'));
for (const run of [before, after]) {
  for (const item of run.cases) {
    for (const pack of item.driver.evidence.filter(evidence => evidence.kind === 'kane-pack')) {
      const path = resolve(root, pack.path);
      const screenshots = await extractKaneScreenshots(path, resolve(path, '..'), root);
      item.driver.evidence = item.driver.evidence.filter(evidence => evidence.kind !== 'screenshot').concat(screenshots);
      const contents = unzipSync(await readFile(path), {filter: file => /\/step\.json$|\/0-run_summary\.json$|\/0-actions\.ndjson$/.test(file.name)});
      const debug = Object.entries(contents).map(([entry, bytes]) => {
        const value = new TextDecoder().decode(bytes);
        if (entry.endsWith('.ndjson')) return {entry, events: value.trim().split('\n').map(line => {
          try {const event = JSON.parse(line); return {keys: Object.keys(event), type: event.type, status: event.status};} catch {return {unparsed: true};}
        })};
        const object = JSON.parse(value);
        return {entry, keys: Object.keys(object), fields: Object.fromEntries(Object.entries(object).filter(([key, field]) =>
          ['kind', 'status', 'duration', 'ordinal', 'url', 'reason', 'summary'].includes(key) && ['string', 'number'].includes(typeof field)))};
      });
      console.log(JSON.stringify({check: item.check.id, screenshots: screenshots.length, debug}, null, 2));
    }
  }
}
await writeFile(resolve(root, 'before-run.json'), JSON.stringify(before, null, 2) + '\n');
await writeFile(resolve(root, 'after-run.json'), JSON.stringify(after, null, 2) + '\n');
await writeFile(resolve(root, 'run.json'), JSON.stringify(after, null, 2) + '\n');
await writeFile(resolve(root, 'index.html'), renderReport(after, before));
