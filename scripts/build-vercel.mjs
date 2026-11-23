import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const sourceRef = process.env.VERCEL_GIT_COMMIT_SHA || execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
if (!/^[a-f0-9]{40}$/.test(sourceRef)) throw new Error('Build needs the actual published Git commit SHA.');
await mkdir('public/evidence', {recursive: true});
await cp('evidence/native-repair', 'public/evidence/native-repair', {recursive: true});
const info = {sourceRef, repository: 'https://github.com/eminentcodes/latch', builtAt: new Date().toISOString()};
await writeFile('api/build-info.json', JSON.stringify(info, null, 2) + '\n');
await writeFile('public/build.json', JSON.stringify(info, null, 2) + '\n');
await readFile('public/index.html');
console.log('Vercel site and genuine recorded evidence are ready.');
