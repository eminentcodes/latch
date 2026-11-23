export type DemoActor = {id: 'owner' | 'other' | 'viewer'; name: string; workspace: string; role: 'editor' | 'viewer'};
export type DemoDocument = {id: string; title: string; workspace: string; marker: string; content: string};
export const actors: readonly DemoActor[] = [
  {id: 'owner', name: 'Avery', workspace: 'orion', role: 'editor'},
  {id: 'other', name: 'Morgan', workspace: 'atlas', role: 'editor'},
  {id: 'viewer', name: 'Sam', workspace: 'orion', role: 'viewer'},
];
export const documentDefinition: DemoDocument = {
  id: 'launch-plan', title: 'Orion launch plan', workspace: 'orion',
  marker: 'ORION-PRIVATE-2026', content: 'Release window: Thursday. Internal reviewers only.',
};
export function freshDocument(): DemoDocument { return {...documentDefinition}; }
