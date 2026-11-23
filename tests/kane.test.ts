import assert from 'node:assert/strict';
import test from 'node:test';
import { parseKaneOutput, redactKaneDiagnostic } from '../src/drivers/kane.js';
import type { ProcessResult } from '../src/process.js';

const result = (events: unknown[], code = 0): ProcessResult => ({code, stdout: events.map(event => JSON.stringify(event)).join('\n'), stderr: '', timedOut: false});
const end = {type: 'run_end', v: 1, status: 'passed', summary: 'Permission assertion complete.'};

test('native startup diagnostics preserve the error while removing credentials', () => {
  const safe = redactKaneDiagnostic('fetch failed: Authorization: Bearer abc.def.ghi\naccess_key="private-value"\nSaved key is env-private-value', ['env-private-value']);
  assert.match(safe, /fetch failed/);
  assert.doesNotMatch(safe, /abc\.def\.ghi|private-value|env-private-value/);
});

test('Kane parsing accepts typeless steps, future fields and unknown events', () => {
  const parsed = parseKaneOutput(result([{type: 'stream_start', v: 1}, {step: 1, status: 'done', remark: 'Opened the document'}, {type: 'a_future_event', detail: 1}, {...end, a_future_field: true}]));
  assert.equal(parsed.state, 'passed');
});
test('progress alone is not a terminal permission result', () => {
  assert.equal(parseKaneOutput(result([{step: 1, status: 'done'}])).state, 'error');
});
test('duplicate terminal results are ambiguous and cannot pass', () => {
  assert.equal(parseKaneOutput(result([end, end])).state, 'error');
});
test('a process error cannot be rescued by a claimed passing result', () => {
  assert.equal(parseKaneOutput(result([end], 2)).state, 'error');
  assert.equal(parseKaneOutput(result([end], 1)).state, 'error');
});
test('unresolved variables and human-input requests stop automated verification', () => {
  assert.equal(parseKaneOutput(result([{type: 'warning', code: 'unresolved_variables', message: 'A credential variable is missing.'}, end])).state, 'error');
  assert.equal(parseKaneOutput(result([{type: 'ask_user', question: 'Which account?'}, end])).state, 'error');
});
test('a cancelled run and an unsupported breaking schema are incomplete', () => {
  assert.equal(parseKaneOutput(result([end], 3)).state, 'timeout');
  assert.equal(parseKaneOutput(result([{...end, v: 2}])).state, 'error');
});
