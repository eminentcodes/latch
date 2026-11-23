import assert from 'node:assert/strict';
import test from 'node:test';
import { startDemo } from '../demo/app.js';

test('the secure fixture isolates workspaces and preserves owner and viewer reads', async () => {
  const app = await startDemo();
  try {
    for (const [actor, expected] of [['owner', 200], ['viewer', 200], ['other', 403]] as const) {
      const login = await fetch(app.baseUrl + '/auth/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({actor})});
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
      const response = await fetch(app.baseUrl + '/api/documents/launch-plan', {headers: {Cookie: cookie, 'X-Latch-Case': actor + '-read'}});
      assert.equal(response.status, expected);
      const body = await response.json() as {marker?: string};
      assert.equal(Boolean(body.marker), expected === 200);
      assert.equal(app.observation(actor + '-read')?.actor, actor);
    }
    const anonymous = await fetch(app.baseUrl + '/api/documents/launch-plan');
    assert.equal(anonymous.status, 401);
  } finally {await app.close();}
});

test('a forbidden viewer write is denied without mutation while the owner can update', async () => {
  const app = await startDemo();
  try {
    for (const [actor, expected] of [['viewer', 403], ['owner', 200]] as const) {
      const login = await fetch(app.baseUrl + '/auth/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({actor})});
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
      const response = await fetch(app.baseUrl + '/api/documents/launch-plan', {method: 'PUT', headers: {Cookie: cookie, 'Content-Type': 'application/json', 'X-Latch-Case': actor + '-update'}, body: JSON.stringify({content: `Changed by ${actor}`})});
      assert.equal(response.status, expected);
      const observation = app.observation(actor + '-update')!;
      assert.equal(observation.beforeHash !== observation.afterHash, expected === 200);
    }
  } finally {await app.close();}
});

test('the fixture observer cannot become an unprotected data endpoint', async () => {
  const app = await startDemo();
  try {
    const response = await fetch(app.baseUrl + '/__latch/observation?case=owner-read');
    assert.equal(response.status, 403);
  } finally {await app.close();}
});
