import type { DemoActor, DemoDocument } from './data.js';

export type PolicyMode = 'secure' | 'vulnerable' | 'deny-all';

// Explicit seeded regressions are for the local demonstration only.
// The default mode enforces the declared ownership and role rules.
export function mayRead(actor: DemoActor | undefined, document: DemoDocument, mode: PolicyMode): boolean {
  if (!actor || mode === 'deny-all') return false;
  if (mode === 'vulnerable') return true;
  return actor.workspace === document.workspace;
}

export function mayUpdate(actor: DemoActor | undefined, document: DemoDocument, mode: PolicyMode): boolean {
  if (!actor || mode === 'deny-all') return false;
  if (mode === 'vulnerable') return true;
  return actor.workspace === document.workspace && actor.role === 'editor';
}
