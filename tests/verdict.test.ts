import assert from 'node:assert/strict';
import test from 'node:test';
import { judgeCase, judgeRun } from '../src/verdict.js';
import type { DriverResult, Observation } from '../src/types.js';

const check = {id: 'other-read', actor: 'other', resource: 'launch-plan', action: 'read', expect: 'deny'} as const;
const driver: DriverResult = {engine: 'local', state: 'passed', summary: 'Assertion complete.', durationMs: 100, terminal: true, evidence: [{kind: 'screenshot', path: 'case/browser.png', label: 'Browser screenshot'}]};
const observation: Observation = {caseTag: 'case', actor: 'other', resource: 'launch-plan', action: 'read', status: 403, disclosed: false, beforeHash: 'original', afterHash: 'original', at: new Date().toISOString()};

test('an observed forbidden read with complete browser evidence passes', () => {
  assert.equal(judgeCase(check, driver, observation).verdict, 'passed');
});
test('a friendly browser assertion cannot hide a real document disclosure', () => {
  assert.equal(judgeCase(check, driver, {...observation, status: 200, disclosed: true}).verdict, 'failed');
});
test('a denied response that still changes protected data is a failed permission check', () => {
  const update = {...check, action: 'update'} as const;
  assert.equal(judgeCase(update, driver, {...observation, action: 'update', afterHash: 'changed'}).verdict, 'failed');
});
test('a server error is incomplete proof rather than a successful denial', () => {
  assert.equal(judgeCase(check, driver, {...observation, status: 500}).verdict, 'incomplete');
});
test('checking the wrong identity cannot produce a verified result', () => {
  assert.equal(judgeCase(check, driver, {...observation, actor: 'owner'}).verdict, 'incomplete');
});
test('missing evidence and missing completion block a pass', () => {
  assert.equal(judgeCase(check, {...driver, evidence: []}, observation).verdict, 'incomplete');
  assert.equal(judgeCase(check, {...driver, terminal: false}, observation).verdict, 'incomplete');
  assert.equal(judgeCase(check, driver, null).verdict, 'incomplete');
});
test('a fix that denies the legitimate owner fails its positive control', () => {
  assert.equal(judgeCase({...check, actor: 'owner', expect: 'allow'}, driver, {...observation, actor: 'owner'}).verdict, 'failed');
});
test('missing cases, zero-case runs and timeouts cannot turn a suite green', () => {
  assert.equal(judgeRun(['passed'], 5), 'incomplete');
  assert.equal(judgeRun([], 0), 'incomplete');
  assert.equal(judgeRun(['passed', 'incomplete'], 2), 'incomplete');
  assert.equal(judgeRun(['passed', 'failed'], 2), 'failed');
});
