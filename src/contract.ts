import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/, 'Use a short lowercase identifier.');
const relativePath = z.string().max(500).refine(
  value => value.startsWith('/') && !value.startsWith('//') && !/[\\\s\x00-\x1f]/.test(value)
    && !/^\/(?:%2f|%5c)/i.test(value),
  'Use a path on the configured app, beginning with a single slash.',
);
const origin = z.string().url().refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}, 'Use an HTTP(S) origin without credentials, a path, or query parameters.');

export const contractSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(100),
  adapter: z.literal('document-demo'),
  baseUrl: origin,
  actors: z.array(z.object({
    id: identifier,
    label: z.string().min(1).max(80),
    fixtureKey: z.enum(['owner', 'other', 'viewer']),
  }).strict()).min(2).max(20),
  resources: z.array(z.object({
    id: identifier,
    label: z.string().min(1).max(100),
    path: relativePath,
    updatePath: relativePath,
    apiPath: relativePath,
    marker: z.string().min(1).max(100),
  }).strict()).min(1).max(20),
  checks: z.array(z.object({
    id: identifier,
    actor: identifier,
    resource: identifier,
    action: z.enum(['read', 'update']),
    expect: z.enum(['allow', 'deny']),
  }).strict()).min(2).max(100),
}).strict().superRefine((contract, context) => {
  for (const name of ['actors', 'resources', 'checks'] as const) {
    const seen = new Set<string>();
    contract[name].forEach((item, index) => {
      if (seen.has(item.id)) context.addIssue({code: 'custom', path: [name, index, 'id'], message: 'Identifiers must be unique.'});
      seen.add(item.id);
    });
  }
  const actorIds = new Set(contract.actors.map(actor => actor.id));
  const resourceIds = new Set(contract.resources.map(resource => resource.id));
  const tuples = new Set<string>();
  let denied = 0;
  contract.checks.forEach((check, index) => {
    if (!actorIds.has(check.actor)) context.addIssue({code: 'custom', path: ['checks', index, 'actor'], message: 'Actor is not declared.'});
    if (!resourceIds.has(check.resource)) context.addIssue({code: 'custom', path: ['checks', index, 'resource'], message: 'Resource is not declared.'});
    const tuple = `${check.actor}/${check.resource}/${check.action}`;
    if (tuples.has(tuple)) context.addIssue({code: 'custom', path: ['checks', index], message: 'An actor/resource/action may have only one expectation.'});
    tuples.add(tuple);
    if (check.expect === 'deny') {
      denied++;
      if (!contract.checks.some(control => control.resource === check.resource && control.action === check.action && control.expect === 'allow')) {
        context.addIssue({code: 'custom', path: ['checks', index], message: 'A denied action needs an allowed-user control for the same resource and action.'});
      }
    }
  });
  if (!denied) context.addIssue({code: 'custom', path: ['checks'], message: 'Declare at least one forbidden action to verify a permission boundary.'});
});

export type PermissionContract = z.infer<typeof contractSchema>;
export type PermissionCheck = PermissionContract['checks'][number];
export type Actor = PermissionContract['actors'][number];
export type Resource = PermissionContract['resources'][number];

export function parseContract(value: unknown): PermissionContract {
  return contractSchema.parse(value);
}

export function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function loadContract(path: string): Promise<{contract: PermissionContract; hash: string}> {
  const text = await readFile(path, 'utf8');
  return {contract: parseContract(JSON.parse(text)), hash: digest(text)};
}

export function allowedControl(contract: PermissionContract, check: PermissionCheck): string | undefined {
  return contract.checks.find(item => item.resource === check.resource && item.action === check.action && item.expect === 'allow')?.id;
}
