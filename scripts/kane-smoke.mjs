import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startDemo } from '../dist/demo/app.js';
import { loadContract } from '../dist/src/contract.js';
import { kaneCase } from '../dist/src/drivers/kane.js';
import { scenarioObjective } from '../dist/src/scenario.js';
import { judgeCase } from '../dist/src/verdict.js';
import { fingerprintVerification } from '../dist/src/verification-inputs.js';

const root = process.cwd();
const output = resolve('artifacts/native-smoke-' + Date.now());
await mkdir(output, {recursive: true});
const {contract, hash} = await loadContract(resolve('examples/permissions.json'));
const checkId = process.argv[2] ?? 'owner-read';
const mode = process.argv[3] ?? 'secure';
if (!['secure', 'vulnerable'].includes(mode)) throw new Error('Choose secure or vulnerable for the one-case setup check.');
const check = contract.checks.find(check => check.id === checkId);
if (!check) throw new Error('Select a declared check ID from examples/permissions.json.');
const actor = contract.actors.find(actor => actor.id === check.actor);
const resource = contract.resources.find(resource => resource.id === check.resource);
const tag = randomUUID();
const fixture = await startDemo({mode});
try {
  const driver = await kaneCase({projectRoot: root, baseUrl: fixture.baseUrl,
    objective: scenarioObjective(check, actor, resource, fixture.baseUrl, tag),
    outputDir: join(output, checkId), reportRoot: output, timeoutSeconds: 360});
  const observation = fixture.observation(tag);
  const judged = judgeCase(check, driver, observation, actor.fixtureKey);
  const result = {scope: `One ${mode}-policy ${checkId} setup check. This is not the full permission suite.`,
    contractHash: hash, inputs: await fingerprintVerification(root), ...judged, driver, observation};
  await writeFile(join(output, 'setup-check.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = judged.verdict === 'passed' ? 0 : 2;
} finally {await fixture.close();}
