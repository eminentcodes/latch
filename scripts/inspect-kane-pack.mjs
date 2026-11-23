import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

if (!process.argv[2]) throw new Error('Pass a Kane .evidence file to list its entries.');
const entries = [];
unzipSync(await readFile(process.argv[2]), {filter: file => {
  entries.push({path: file.name, bytes: file.originalSize});
  return false;
}});
console.log(JSON.stringify({count: entries.length, entries: entries.slice(0, 100)}, null, 2));
