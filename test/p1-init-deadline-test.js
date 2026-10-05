// @fast
// @semantic
const assert = require('assert');
const { ServiceContainer } = require('../src/services/container');
async function main() {
  const container = new ServiceContainer({ quiet: true });
  let completed = false;
  container._runPipeline = async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    completed = true;
  };
  const result = await container.initialize(process.cwd(), 1, { watch: false });
  assert.strictEqual(result, false, 'initialize must honor its supplied deadline');
  assert.match(container.initError.message, /timeout/i);
  await container.shutdown();
  assert(completed, 'shutdown must drain the abandoned pipeline before closing shared resources');
  console.log('initialization deadline: 3/3 passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
