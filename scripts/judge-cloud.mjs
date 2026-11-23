import { writeFile } from 'node:fs/promises';
import { startJudgeDemo } from '../dist/src/judge-demo.js';

function requiredUrl(name) {
  const url = new URL(process.env[name] ?? '');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(`Invalid ${name}`);
  return url.origin;
}
const expiresAt = process.env.LATCH_SESSION_EXPIRES_AT;
if (!expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
  throw new Error('The cloud judging session has expired.');
}
const cloud = {workspaceUrl: requiredUrl('LATCH_PUBLIC_WORKSPACE_URL'), originalUrl: requiredUrl('LATCH_PUBLIC_ORIGINAL_URL'),
  repairedUrl: requiredUrl('LATCH_PUBLIC_REPAIRED_URL'), homeUrl: requiredUrl('LATCH_HOME_URL'), expiresAt,
  kaneEnabled: process.env.LATCH_KANE_ENABLED === 'true' && Boolean(process.env.LT_USERNAME && process.env.LT_ACCESS_KEY)};
const demo = await startJudgeDemo({projectRoot: process.cwd(), host: '0.0.0.0', cloud});
await writeFile('.cache/latch-cloud-state.json', JSON.stringify({state: 'ready', message: 'Your live demo is ready.'}) + '\n');
console.log('Latch cloud judge workspace is ready.');
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await demo.close();
  process.exit(0);
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
setTimeout(close, Math.max(1, Date.parse(expiresAt) - Date.now())).unref();
