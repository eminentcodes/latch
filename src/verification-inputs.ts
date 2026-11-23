import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from './contract.js';
import type { VerificationInputs } from './types.js';

const groups = {
  fixtureHash: ['demo/data.ts', 'demo/app.ts', 'demo/views.ts'],
  scenarioHash: ['src/scenario.ts'],
  verifierHash: ['src/contract.ts', 'src/verdict.ts', 'src/runner.ts', 'src/verification-inputs.ts',
    'src/types.ts', 'src/process.ts', 'src/drivers/local.ts', 'src/drivers/kane.ts', 'src/drivers/kane-evidence.ts',
    'package.json', 'package-lock.json', 'tsconfig.json'],
} as const;

export async function fingerprintVerification(root: string): Promise<VerificationInputs> {
  const result = {} as VerificationInputs;
  for (const [key, paths] of Object.entries(groups)) {
    const manifest = await Promise.all(paths.map(async path => [path, digest(await readFile(join(root, path)))]));
    result[key as keyof VerificationInputs] = digest(JSON.stringify(manifest));
  }
  return result;
}

export function sameVerificationInputs(before: unknown, after: VerificationInputs): boolean {
  if (!before || typeof before !== 'object' || Array.isArray(before)) return false;
  const candidate = before as Record<string, unknown>;
  return Object.keys(groups).every(key => /^[a-f0-9]{64}$/.test(String(candidate[key]))
    && candidate[key] === after[key as keyof VerificationInputs]);
}
