import type { PermissionCheck } from './contract.js';
import type { DriverResult, Observation, Verdict } from './types.js';

export function judgeCase(check: PermissionCheck, driver: DriverResult, observation: Observation | null, expectedActor = check.actor): {verdict: Verdict; reason: string} {
  if (driver.state === 'error' || driver.state === 'timeout' || !driver.terminal) {
    return {verdict: 'incomplete', reason: driver.summary || 'Browser verification did not finish.'};
  }
  if (!observation) return {verdict: 'incomplete', reason: 'No matching protected request was observed.'};
  if (observation.actor !== expectedActor || observation.resource !== check.resource || observation.action !== check.action) {
    return {verdict: 'incomplete', reason: 'The protected request did not match the declared actor, resource, and action.'};
  }
  if (!driver.evidence.length) return {verdict: 'incomplete', reason: 'The browser run has no evidence artifact.'};
  const successful = observation.status >= 200 && observation.status < 300;
  const denied = [401, 403, 404].includes(observation.status);
  const changed = observation.beforeHash !== observation.afterHash;
  if (check.expect === 'deny') {
    if (successful || observation.disclosed || changed) {
      return {verdict: 'failed', reason: check.action === 'read' ? 'Another user received the protected document.' : 'A forbidden update changed the protected document.'};
    }
    if (!denied) return {verdict: 'incomplete', reason: `HTTP ${observation.status} does not establish a permission denial.`};
  } else {
    if (!successful || (check.action === 'read' && !observation.disclosed) || (check.action === 'update' && !changed)) {
      return {verdict: 'failed', reason: 'The permitted user could not complete the protected action.'};
    }
  }
  if (driver.state !== 'passed') return {verdict: 'failed', reason: driver.summary || 'The browser assertion failed.'};
  return {verdict: 'passed', reason: check.expect === 'deny' ? 'The protected action was denied without disclosure or mutation.' : 'The permitted user completed the protected action.'};
}

export function judgeRun(verdicts: Verdict[], expectedCases: number): Verdict {
  if (verdicts.includes('failed')) return 'failed';
  if (expectedCases < 1 || verdicts.length !== expectedCases || verdicts.includes('incomplete')) return 'incomplete';
  return 'passed';
}
