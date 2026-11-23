import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = new URL('../.cache/', import.meta.url);
const destination = new URL('vercel-settings.env', directory);
await mkdir(directory, {recursive: true});
const values = `LATCH_DEMO_ENABLED=true\nLATCH_SESSION_SECRET=${randomBytes(48).toString('base64url')}\n`;
try {
  await writeFile(destination, values, {flag: 'wx', mode: 0o600});
  console.log(`Created private settings at ${fileURLToPath(destination)}. Values are not printed or published.`);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log(`Keeping existing private settings at ${fileURLToPath(destination)}.`);
}
