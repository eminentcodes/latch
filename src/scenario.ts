import type { Actor, PermissionCheck, Resource } from './contract.js';

const names = {owner: 'Avery', other: 'Morgan', viewer: 'Sam'} as const;
export function actorName(actor: Actor): string {return names[actor.fixtureKey];}

export function scenarioObjective(check: PermissionCheck, actor: Actor, resource: Resource, baseUrl: string, caseTag: string): string {
  const target = new URL(check.action === 'read' ? resource.path : resource.updatePath, baseUrl);
  target.searchParams.set('case', caseTag);
  const setup = `Open ${baseUrl}/login.\nClick "Continue as ${actorName(actor)}".\nWait for the visible text "Signed in as ${actorName(actor)}".\nNavigate to ${target.href}.\nKeep this identity for the rest of the test.`;
  if (check.action === 'read') {
    const assertion = check.expect === 'allow'
      ? `Assert that the visible page contains the heading "${resource.label}".\nAssert that the visible page contains the exact text "${resource.marker}".`
      : `Assert that the visible page contains the heading "Access denied".\nAssert that the text "${resource.marker}" is not visible on this page.`;
    return `${setup}\n${assertion}`;
  }
  const content = `Latch synthetic update ${caseTag}`;
  const assertion = check.expect === 'allow' ? 'Update accepted' : 'Update denied';
  return `${setup}\nFill "Proposed content" with "${content}".\nClick "Send update request".\nAssert that the visible result contains the exact text "${assertion}".`;
}
