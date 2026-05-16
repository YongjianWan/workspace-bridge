#!/usr/bin/env node
/**
 * Cache consistency: deleted files must not leave ghost data in graph or cache.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { FileIndex } = require('../src/services/file-index');
const { DependencyGraph } = require('../src/services/dep-graph');

function setupTempWorkspace() {
  const root = makeTempDir('wb-cache-consistency-');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'consistency-test', version: '1.0.0' }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(root, 'src', 'alive.js'),
    "export function alive() { return 1; }\n",
    'utf8'
  );
  fs.writeFileSync(
    path.join(root, 'src', 'ghost.js'),
    "export function ghostFunc() { return 2; }\n",
    'utf8'
  );
  fs.writeFileSync(
    path.join(root, 'src', 'orphan.js'),
    "export function orphanFunc() { return 3; }\n",
    'utf8'
  );
  fs.writeFileSync(
    path.join(root, 'src', 'importer.js'),
    'import { alive } from "./alive";\nimport { ghostFunc } from "./ghost";\nexport function use() { return alive() + ghostFunc(); }\n',
    'utf8'
  );
  return root;
}

async function buildServices(root) {
  const cache = new WorkspaceCache(root);
  cache.load();
  cache.setWorkspaceInfo({ root });

  const fileIndex = new FileIndex(root, cache);
  await fileIndex.build(60000, { watch: false });

  const depGraph = new DependencyGraph(root, cache);
  await depGraph.build();

  return { cache, fileIndex, depGraph };
}

function normalizeKey(filePath) {
  const { normalizePathKey } = require('../src/utils/path');
  return normalizePathKey(filePath);
}

async function testGraphClearedOnRebuild() {
  const root = setupTempWorkspace();
  try {
    const { cache, fileIndex, depGraph } = await buildServices(root);

    const ghostFile = path.join(root, 'src', 'ghost.js');
    const ghostKey = normalizeKey(ghostFile);

    // Pre-condition: ghost.js is in the graph
    assert(depGraph.hasFile(ghostKey), 'pre: ghost.js should be in graph');

    // Delete the file
    fs.unlinkSync(ghostFile);

    // Rebuild services (simulates next CLI run with cache load)
    const services2 = await buildServices(root);

    // Post-condition: ghost.js must NOT be in graph
    assert(
      !services2.depGraph.hasFile(ghostKey),
      'post: ghost.js should be removed from graph after rebuild'
    );

    // alive.js should still be present
    const aliveKey = normalizeKey(path.join(root, 'src', 'alive.js'));
    assert(services2.depGraph.hasFile(aliveKey), 'alive.js should still be in graph');
  } finally {
    cleanupTempDir(root);
  }
}

async function testParseResultsPrunedForDeletedFiles() {
  const root = setupTempWorkspace();
  try {
    const { cache } = await buildServices(root);

    const ghostFile = path.join(root, 'src', 'ghost.js');
    const ghostKey = normalizeKey(ghostFile);

    // Pre-condition: parse result exists
    assert(cache.hasParseResult(ghostKey), 'pre: ghost.js parse result should exist');

    // Delete the file
    fs.unlinkSync(ghostFile);

    // Rebuild services
    const { cache: cache2 } = await buildServices(root);

    // Post-condition: parse result must be gone
    assert(
      !cache2.hasParseResult(ghostKey),
      'post: ghost.js parse result should be pruned'
    );
  } finally {
    cleanupTempDir(root);
  }
}

async function testPruneCatchesOrphanParseResults() {
  const root = setupTempWorkspace();
  try {
    const cache = new WorkspaceCache(root);
    cache.load();

    const ghostFile = path.join(root, 'src', 'ghost.js');
    const ghostKey = normalizeKey(ghostFile);

    // Simulate historical inconsistency: parseResult exists but fileMetadata does not
    cache.setParseResult(ghostKey, {
      imports: [],
      exports: ['ghostFunc'],
      importRecords: [],
      exportRecords: [{ name: 'ghostFunc', kind: 'function', lineStart: 1, lineEnd: 1, fingerprint: '' }],
      functionRecords: [],
      parseMode: 'regex',
      mtime: 1,
    });
    // Intentionally do NOT set fileMetadata for ghost.js

    // Delete the actual file so pruneDeletedCacheEntries finds it missing
    fs.unlinkSync(ghostFile);

    const fileIndex = new FileIndex(root, cache);
    await fileIndex.build(60000, { watch: false });

    // Post-condition: orphan parse result must be pruned even without fileMetadata
    assert(
      !cache.hasParseResult(ghostKey),
      'orphan parseResult without fileMetadata should be pruned'
    );
  } finally {
    cleanupTempDir(root);
  }
}

async function testUpdateFilesCleansAllCacheSlotsOnDelete() {
  const root = setupTempWorkspace();
  try {
    const { cache, depGraph } = await buildServices(root);

    const ghostFile = path.join(root, 'src', 'ghost.js');
    const ghostKey = normalizeKey(ghostFile);

    // Pre-condition
    assert(depGraph.hasFile(ghostKey), 'pre: ghost.js should be in graph');
    assert(cache.hasFileMetadata(ghostKey), 'pre: ghost.js should be in fileMetadata');
    assert(cache.hasParseResult(ghostKey), 'pre: ghost.js should be in parseResults');

    // Delete the file and trigger incremental update directly
    fs.unlinkSync(ghostFile);
    await depGraph.updateFiles([ghostFile]);

    // Post-condition: all slots should be clean
    assert(!depGraph.hasFile(ghostKey), 'post: ghost.js should be removed from graph');
    assert(!cache.hasFileMetadata(ghostKey), 'post: ghost.js fileMetadata should be removed');
    assert(!cache.hasParseResult(ghostKey), 'post: ghost.js parseResult should be removed');
  } finally {
    cleanupTempDir(root);
  }
}

async function testDeadExportsExcludeDeletedFiles() {
  const root = setupTempWorkspace();
  try {
    // orphan.js exports orphanFunc but has no importers -> dead export
    const services1 = await buildServices(root);
    const dead1 = services1.depGraph.findDeadExports();
    assert(dead1.some((d) => d.file.includes('orphan.js')), 'pre: orphan.js should be dead export');

    // Delete orphan.js and rebuild
    const orphanFile = path.join(root, 'src', 'orphan.js');
    fs.unlinkSync(orphanFile);
    const services2 = await buildServices(root);

    // orphan.js must not appear as dead export after deletion
    const dead2 = services2.depGraph.findDeadExports();
    assert(
      !dead2.some((d) => d.file.includes('orphan.js')),
      'post: deleted orphan.js should not appear in dead exports'
    );
  } finally {
    cleanupTempDir(root);
  }
}

async function testUnresolvedImportsExcludeDeletedFiles() {
  const root = setupTempWorkspace();
  try {
    const services1 = await buildServices(root);
    const unresolved1 = services1.depGraph.findUnresolvedImports();
    // importer.js imports ghost.js which exists, so no unresolved
    assert.strictEqual(
      unresolved1.filter((u) => u.file.includes('importer.js')).length,
      0,
      'pre: importer.js should have no unresolved imports while ghost.js exists'
    );

    // Delete ghost.js and rebuild
    const ghostFile = path.join(root, 'src', 'ghost.js');
    fs.unlinkSync(ghostFile);
    const services2 = await buildServices(root);

    // importer.js now has an unresolved import to the deleted ghost.js.
    // This is CORRECT behavior — the import is genuinely unresolved.
    // The bug we are fixing is that ghost.js ITSELF should not appear as a
    // dead-export entry after being deleted.
    const unresolved2 = services2.depGraph.findUnresolvedImports();
    assert(
      unresolved2.some((u) => u.file.includes('importer.js')),
      'importer.js should report unresolved import after ghost.js is deleted'
    );
  } finally {
    cleanupTempDir(root);
  }
}

async function runAll() {
  await testGraphClearedOnRebuild();
  await testParseResultsPrunedForDeletedFiles();
  await testPruneCatchesOrphanParseResults();
  await testUpdateFilesCleansAllCacheSlotsOnDelete();
  await testDeadExportsExcludeDeletedFiles();
  await testUnresolvedImportsExcludeDeletedFiles();
}

runAll().catch((e) => {
  console.error('cache-consistency-test failed:', e);
  process.exit(1);
});
