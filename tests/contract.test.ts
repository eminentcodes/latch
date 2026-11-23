import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseContract } from '../src/contract.js';

const example = () => JSON.parse(readFileSync('examples/permissions.json', 'utf8'));

test('the reviewed fixture contract includes permitted controls and forbidden actions', () => {
  const contract = parseContract(example());
  assert.equal(contract.checks.length, 5);
  assert.equal(contract.checks.filter(check => check.expect === 'deny').length, 2);
});
test('an unknown actor cannot silently become another identity', () => {
  const input = example(); input.checks[1].actor = 'unknown';
  assert.throws(() => parseContract(input), /Actor is not declared/);
});
test('a forbidden update without an allowed editor control is rejected', () => {
  const input = example(); input.checks = input.checks.filter((check: {id: string}) => check.id !== 'owner-update');
  assert.throws(() => parseContract(input), /allowed-user control/);
});
test('an all-success feature suite does not establish a permission boundary', () => {
  const input = example(); input.checks = input.checks.filter((check: {expect: string}) => check.expect === 'allow');
  assert.throws(() => parseContract(input), /forbidden action/);
});
test('conflicting expectations for the same actor, resource and action are rejected', () => {
  const input = example(); input.checks.push({...input.checks[0], id: 'conflicting-owner', expect: 'deny'});
  assert.throws(() => parseContract(input), /only one expectation/);
});
test('duplicated identities and resource bindings are rejected', () => {
  const input = example(); input.actors.push({...input.actors[0]});
  assert.throws(() => parseContract(input), /Identifiers must be unique/);
});
test('credentials cannot be accidentally embedded in the contract', () => {
  const input = example(); input.actors[0].password = 'a-value-that-does-not-belong-here';
  assert.throws(() => parseContract(input));
  const withUrl = example(); withUrl.baseUrl = 'https://username:password@example.com';
  assert.throws(() => parseContract(withUrl), /without credentials/);
});
test('a resource cannot redirect the browser to a different origin', () => {
  for (const path of ['//other.example/document', '/\\other.example', '/%2fother.example', 'https://other.example/document']) {
    const input = example(); input.resources[0].path = path;
    assert.throws(() => parseContract(input));
  }
});
