// @contract
// Persisted graph (SQLite edges) integration tests — verify loadGraph
// hybrid path in container.js: edges load + incremental update for
// new/changed/deleted files.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { WorkspaceCache } = require('../src/services/cache');
const { CACHE_VERSION } = require('../src/config/constants');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function testLoadGraphRestoresGraphAndReverseGraph() {
  const tmpDir = makeTempDir('wb-persisted-graph-');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
  fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), "import { b } from './b';\nexport const a = 1;");
  fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), "export const b = 2;");

  // 1. Cold start — build graph and persist edges
  const container1 = new ServiceContainer({ quiet: true });
  await container1.initialize(tmpDir, 60000, { watch: false });
  assert.strictEqual(container1._depGraph.getFileCount(), 2, 'should index 2 source files');
  const aImports = container1._depGraph.getFileInfo(path.posix.join(tmpDir, 'src/a.js'))?.imports || [];
  assert(aImports.some((i) => i.includes('b.js')), 'a.js should import b.js');
  await container1.shutdown();

  const cache = new WorkspaceCache(tmpDir);
  assert.strictEqual(cache.load(), true, 'cache should load after cold start');
  assert.strictEqual(cache.edgeMeta.cacheVersion, CACHE_VERSION, 'edge metadata should persist cache version');
  assert.strictEqual(cache.edgeMeta.fileMetadataCount, cache.fileMetadata.size, 'edge metadata should match file metadata count');
  assert.strictEqual(cache.edgeMeta.parseResultsCount, cache.parseResults.size, 'edge metadata should match parse result count');
  cache.close();

  // 2. Warm start — loadGraph should restore graph from edges
  const container2 = new ServiceContainer({ quiet: true });
  await container2.initialize(tmpDir, 60000, { watch: false });
  assert.strictEqual(container2._depGraph.getFileCount(), 2, 'loadGraph should restore 2 files');
  const aImports2 = container2._depGraph.getFileInfo(path.posix.join(tmpDir, 'src/a.js'))?.imports || [];
  assert(aImports2.some((i) => i.includes('b.js')), 'loadGraph should restore import edge');
  await container2.shutdown();

  cleanupTempDir(tmpDir);
}

async function testHybridPathIncrementalNewFile() {
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

  // 3. Warm start with new file — should load edges then incrementally add c.js
  const container2 = new ServiceContainer({ quiet: true });
  await container2.initialize(tmpDir, 60000, { watch: false });
  assert.strictEqual(container2._depGraph.getFileCount(), 3, 'hybrid path should add new file');
  assert(container2._depGraph.hasFile(path.posix.join(tmpDir, 'src/c.js')), 'c.js should be in graph');
  await container2.shutdown();

  cleanupTempDir(tmpDir);
}

async function testHybridPathIncrementalChangedFile() {
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

async function testHybridPathIncrementalDeletedFile() {
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
  assert.strictEqual(container2._depGraph.getFileCount(), 1, 'hybrid path should remove deleted file');
  assert(!container2._depGraph.hasFile(path.posix.join(tmpDir, 'src/b.js')), 'b.js should not be in graph');
  await container2.shutdown();

  cleanupTempDir(tmpDir);
}

async function testPrecomputedRestoredOnWarmStart() {
  const tmpDir = makeTempDir('wb-persisted-graph-');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
  fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), "import { b } from './b';\nexport const a = 1;");
  fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), "export const b = 2;");

  // 1. Cold start — triggers precompute save
  const container1 = new ServiceContainer({ quiet: true });
  await container1.initialize(tmpDir, 60000, { watch: false });
  // Force precompute by querying aggregates
  container1._depGraph.findDeadExports();
  container1._depGraph.findCircularDependencies();
  await container1.shutdown();

  // 2. Warm start — precomputed should be restored
  const container2 = new ServiceContainer({ quiet: true });
  await container2.initialize(tmpDir, 60000, { watch: false });
  const analyzer = container2._depGraph.analyzer;
  assert(analyzer._aggregateCache, 'precomputed aggregates should be restored');
  assert.strictEqual(analyzer._aggregateCache.stats?.files, 2, 'stats should be restored');
  await container2.shutdown();

  cleanupTempDir(tmpDir);
}

async function main() {
  await testLoadGraphRestoresGraphAndReverseGraph();
  await testHybridPathIncrementalNewFile();
  await testHybridPathIncrementalChangedFile();
  await testHybridPathIncrementalDeletedFile();
  await testPrecomputedRestoredOnWarmStart();
  console.log('All persisted-graph tests passed');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
