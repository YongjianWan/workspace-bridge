// @semantic
// @slow
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { buildProjectOverview } = require('../src/tools/overview-tools');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
async function main() {
  const root = makeTempDir('wb-history-replay-');
  fs.writeFileSync(path.join(root, 'a.js'), 'module.exports = require("./b");');
  fs.writeFileSync(path.join(root, 'b.js'), 'module.exports = 1;');
  const container = new ServiceContainer({ quiet: true, cacheDir: path.join(root, '.cache') });
  try {
    assert(await container.initialize(root, 60000, { watch: false, strictCwd: true }));
    await container.ensurePrecomputed(['overview']);
    container._depGraph.ledger.replace('history-unavailable', [{ files: 1, message: 'Injected history failure' }]);
    const first = await buildProjectOverview({}, container);
    assert(first.warnings.some(w => w.type === 'history-unavailable'), 'computed results must carry history quality');
    container._depGraph.ledger.replace('history-unavailable', []);
    const second = await buildProjectOverview({}, container);
    assert(second.replayedFrom, 'fixture must exercise snapshot replay');
    assert(second.warnings.some(w => w.type === 'history-unavailable'), 'replayed scores must retain their original history quality');
    console.log('overview warning replay: 3/3 passed');
  } finally { await container.shutdown(); cleanupTempDir(root); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
