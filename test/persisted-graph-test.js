// @contract
// Restart integration tests: a second container start over the same cache
// must reflect files added, changed or deleted in between.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function testWarmStartRestoresGraph() {
  const tmpDir = makeTempDir('wb-persisted-graph-');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
  fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), "import { b } from './b';\nexport const a = 1;");
  fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), "export const b = 2;");

  // 1. Cold start
  const container1 = new ServiceContainer({ quiet: true });
  await container1.initialize(tmpDir, 60000, { watch: false });
  assert.strictEqual(container1._depGraph.getFileCount(), 2, 'should index 2 source files');
  const aImports = container1._depGraph.getFileInfo(path.posix.join(tmpDir, 'src/a.js'))?.imports || [];
  assert(aImports.some((i) => i.includes('b.js')), 'a.js should import b.js');
  await container1.shutdown();

  const cache = new WorkspaceCache(tmpDir);
  assert.strictEqual(cache.load(), true, 'cache should load after cold start');
  assert.strictEqual(cache.parseResults.size, 2, 'both parse results should be persisted');
  cache.close();

  // 2. Warm start — the graph is rebuilt from cached parse results
  const container2 = new ServiceContainer({ quiet: true });
  await container2.initialize(tmpDir, 60000, { watch: false });
  assert.strictEqual(container2._depGraph.getFileCount(), 2, 'warm start should restore 2 files');
  const aImports2 = container2._depGraph.getFileInfo(path.posix.join(tmpDir, 'src/a.js'))?.imports || [];
  assert(aImports2.some((i) => i.includes('b.js')), 'warm start should resolve the import edge');
  assert.ok(container2._depGraph.symbolRegistry.exports.size > 0, 'warm start should rebuild non-empty symbolRegistry');
  await container2.shutdown();

  cleanupTempDir(tmpDir);
}

async function testWarmStartPicksUpNewFile() {
  const tmpDir = makeTempDir('wb-persisted-graph-');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
  fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), "import { b } from './b';\nexport const a = 1;");
  fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), "export const b = 2;");

  // 1. Cold start
  const container1 = new ServiceContainer({ quiet: true });
  await container1.initialize(tmpDir, 60000, { watch: false });
  assert.strictEqual(container1._depGraph.getFileCount(), 2);
  await container1.shutdown();

  // 2. Add new file
  fs.writeFileSync(path.join(tmpDir, 'src/c.js'), "export const c = 3;");

  // 3. Warm start with new file
  const container2 = new ServiceContainer({ quiet: true });
  await container2.initialize(tmpDir, 60000, { watch: false });
  assert.strictEqual(container2._depGraph.getFileCount(), 3, 'warm start should add new file');
  assert(container2._depGraph.hasFile(path.posix.join(tmpDir, 'src/c.js')), 'c.js should be in graph');
  await container2.shutdown();

  cleanupTempDir(tmpDir);
}

async function testWarmStartPicksUpChangedFile() {
  const tmpDir = makeTempDir('wb-persisted-graph-');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
  fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), "import { b } from './b';\nexport const a = 1;");
  fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), "export const b = 2;");
  fs.writeFileSync(path.join(tmpDir, 'src', 'c.js'), "export const c = 3;");

  // 1. Cold start
  const container1 = new ServiceContainer({ quiet: true });
  await container1.initialize(tmpDir, 60000, { watch: false });
  assert.strictEqual(container1._depGraph.getFileCount(), 3);
  const aInfo1 = container1._depGraph.getFileInfo(path.posix.join(tmpDir, 'src/a.js'));
  assert(aInfo1.imports.length === 1, 'a.js should import 1 file initially');
  await container1.shutdown();

  // 2. Modify a.js to also import c.js
  fs.writeFileSync(path.join(tmpDir, 'src/a.js'), "import { b } from './b';\nimport { c } from './c';\nexport const a = 1;");

  // 3. Warm start with changed file — should update a.js imports
  const container2 = new ServiceContainer({ quiet: true });
  await container2.initialize(tmpDir, 60000, { watch: false });
  const aInfo2 = container2._depGraph.getFileInfo(path.posix.join(tmpDir, 'src/a.js'));
  assert.strictEqual(aInfo2.imports.length, 2, 'a.js should now import 2 files');
  assert(aInfo2.imports.some((i) => i.includes('c.js')), 'a.js should import c.js after update');
  await container2.shutdown();

  cleanupTempDir(tmpDir);
}

async function testWarmStartDropsDeletedFile() {
  const tmpDir = makeTempDir('wb-persisted-graph-');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
  fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), "import { b } from './b';\nexport const a = 1;");
  fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), "export const b = 2;");

  // 1. Cold start
  const container1 = new ServiceContainer({ quiet: true });
  await container1.initialize(tmpDir, 60000, { watch: false });
  assert.strictEqual(container1._depGraph.getFileCount(), 2);
  await container1.shutdown();

  // 2. Delete b.js
  fs.unlinkSync(path.join(tmpDir, 'src/b.js'));

  // 3. Warm start with deleted file — should remove b.js from graph
  const container2 = new ServiceContainer({ quiet: true });
  await container2.initialize(tmpDir, 60000, { watch: false });
  assert.strictEqual(container2._depGraph.getFileCount(), 1, 'warm start should remove deleted file');
  assert(!container2._depGraph.hasFile(path.posix.join(tmpDir, 'src/b.js')), 'b.js should not be in graph');
  await container2.shutdown();

  cleanupTempDir(tmpDir);
}

async function testAggregatesAvailableOnWarmStart() {
  const tmpDir = makeTempDir('wb-persisted-graph-');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
  fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), "import { b } from './b';\nexport const a = 1;");
  fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), "export const b = 2;");

  // 1. Cold start
  const container1 = new ServiceContainer({ quiet: true });
  await container1.initialize(tmpDir, 60000, { watch: false });
  // Force precompute by querying aggregates
  container1._depGraph.findDeadExports();
  container1._depGraph.findCircularDependencies();
  await container1.shutdown();

  // 2. Warm start — aggregates are recomputed on build
  const container2 = new ServiceContainer({ quiet: true });
  await container2.initialize(tmpDir, 60000, { watch: false });
  const analyzer = container2._depGraph.analyzer;
  assert(analyzer._aggregateCache, 'aggregates should be available after a warm start');
  assert.strictEqual(analyzer._aggregateCache.stats?.files, 2, 'stats should describe the current graph');
  await container2.shutdown();

  cleanupTempDir(tmpDir);
}

async function main() {
  await testWarmStartRestoresGraph();
  await testWarmStartPicksUpNewFile();
  await testWarmStartPicksUpChangedFile();
  await testWarmStartDropsDeletedFile();
  await testAggregatesAvailableOnWarmStart();
  console.log('All persisted-graph tests passed');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
