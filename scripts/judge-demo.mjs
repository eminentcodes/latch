import { startJudgeDemo } from '../dist/src/judge-demo.js';

const demo = await startJudgeDemo({projectRoot: process.cwd()});
console.log(`Latch judge workspace: ${demo.url}`);
console.log(`Original application: ${demo.original.baseUrl}/login`);
console.log(`Repaired application: ${demo.repaired.baseUrl}/login`);
console.log('Both applications run in the same fixture mode. Only the isolated application policy source differs.');
console.log('Use the workspace to generate fresh browser results. No commit or push is made.');
const close = async () => {await demo.close(); process.exit(0);};
process.once('SIGINT', close);
process.once('SIGTERM', close);
