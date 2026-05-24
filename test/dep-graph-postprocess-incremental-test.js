#!/usr/bin/env node
// @slow
// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { DependencyGraph } = require('../src/services/dep-graph');
const { WorkspaceCache } = require('../src/services/cache');

async function testFrameworkImplicitDependenciesCacheIntegration() {
  const root = makeTempDir('wb-implicit-cache-');
  const write = (rel, content) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  try {
    write('src/router.js', 'const Home = () => import("./views/Home.vue");\n');
    write('src/views/Home.vue', '<template><div>Home</div></template>\n');
    write('src/other.js', 'console.log("unrelated");\n');

    const cache = new WorkspaceCache(root);
    const graph = new DependencyGraph(root, cache, { quiet: true });

    const files = ['src/router.js', 'src/views/Home.vue', 'src/other.js'].map((f) => path.join(root, f));
    for (const file of files) {
      const stats = fs.statSync(file);
      cache.setFileMetadata(file, { mtime: stats.mtimeMs, size: stats.size });
    }

    await graph.build();

    const routerKey = graph.normalizeFilePath(path.join(root, 'src/router.js'));
    const homeKey = graph.normalizeFilePath(path.join(root, 'src/views/Home.vue'));

    // Verify framework implicit dependency is successfully resolved
    const routerInfo = graph.getFileInfo(routerKey);
    assert(routerInfo.imports.includes(homeKey), 'router should implicitly import Home.vue');

    // Verify it exists in cache database
    assert(cache.hasParseResult(path.join(root, 'src/router.js')), 'router parse result should be cached');
    const cachedResult = cache.getParseResult(path.join(root, 'src/router.js'));
    assert(cachedResult.imports.includes(homeKey), 'cached router result should contain Home.vue');

    // Spy on fs.readFileSync to ensure router.js is NOT read again during update of other.js
    let routerReadCount = 0;
    const originalRead = fs.readFileSync;
    fs.readFileSync = (...args) => {
      if (typeof args[0] === 'string' && args[0].endsWith('router.js')) {
        routerReadCount++;
      }
      return originalRead.apply(fs, args);
    };

    try {
      write('src/other.js', 'console.log("unrelated updated");\n');
      const statsOther = fs.statSync(path.join(root, 'src/other.js'));
      cache.setFileMetadata(path.join(root, 'src/other.js'), { mtime: statsOther.mtimeMs, size: statsOther.size });

      // Trigger incremental update of other.js
      await graph.updateFiles([path.join(root, 'src/other.js')]);

      // Verify other.js was updated, router.js is loaded from cache without disk I/O
      assert.strictEqual(routerReadCount, 0, 'router.js should not be re-read from disk during unrelated update');
      const updatedRouterInfo = graph.getFileInfo(routerKey);
      assert(updatedRouterInfo.imports.includes(homeKey), 'router.js should still import Home.vue via cache');
    } finally {
      fs.readFileSync = originalRead;
    }
  } finally {
    cleanupTempDir(root);
  }
}

async function testJavaPackageChangeConsistency() {
  const root = makeTempDir('wb-java-pkg-consistency-');
  const write = (rel, content) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  try {
    write('src/A.java', 'package com.app;\nimport com.other.*;\npublic class A {}');
    write('src/B.java', 'package com.other;\npublic class B {}');
    write('src/C.java', 'package com.app;\nimport com.newpkg.*;\npublic class C {}');

    const cache = new WorkspaceCache(root);
    const graph = new DependencyGraph(root, cache, { quiet: true });

    const files = ['src/A.java', 'src/B.java', 'src/C.java'].map((f) => path.join(root, f));
    for (const file of files) {
      const stats = fs.statSync(file);
      cache.setFileMetadata(file, { mtime: stats.mtimeMs, size: stats.size });
    }

    await graph.build();

    const aKey = graph.normalizeFilePath(path.join(root, 'src/A.java'));
    const bKey = graph.normalizeFilePath(path.join(root, 'src/B.java'));
    const cKey = graph.normalizeFilePath(path.join(root, 'src/C.java'));

    // Assert initial wildcard import is expanded
    assert(graph.getFileInfo(aKey).imports.includes(bKey), 'A should import B via com.other.*');
    assert(!graph.getFileInfo(cKey).imports.includes(bKey), 'C should not import B yet');

    // Move B.java to a different package com.newpkg
    write('src/B.java', 'package com.newpkg;\npublic class B {}');
    const bStats = fs.statSync(path.join(root, 'src/B.java'));
    cache.setFileMetadata(path.join(root, 'src/B.java'), { mtime: bStats.mtimeMs, size: bStats.size });

    // Incremental update of B.java
    await graph.updateFiles([path.join(root, 'src/B.java')]);

    // Assert B.java's package shift correctly updated dependencies
    assert(!graph.getFileInfo(aKey).imports.includes(bKey), 'A should no longer import B because B is no longer in com.other');
    assert(graph.getFileInfo(cKey).imports.includes(bKey), 'C should now import B via com.newpkg.*');
  } finally {
    cleanupTempDir(root);
  }
}

async function testCycleCacheFineGrainedInvalidation() {
  const { createMockDepGraph } = require('./test-helpers');

  const graph = createMockDepGraph({
    mode: 'instance',
    schema: {
      '/repo/src/a.js': { imports: [], exports: [] },
      '/repo/src/b.js': { imports: [], exports: [] },
      '/repo/src/c.js': { imports: [], exports: [] },
      '/repo/src/d.js': { imports: [], exports: [] },
    },
  });

  // Manually wire the cycle to bypass fromSchema/normalizeFilePath mismatch on Windows
  const aKey = Array.from(graph.graph.keys()).find((k) => k.endsWith('a.js'));
  const bKey = Array.from(graph.graph.keys()).find((k) => k.endsWith('b.js'));
  const cKey = Array.from(graph.graph.keys()).find((k) => k.endsWith('c.js'));
  const dKey = Array.from(graph.graph.keys()).find((k) => k.endsWith('d.js'));

  graph.graph.get(aKey).imports = [bKey];
  graph.graph.get(bKey).imports = [cKey];
  graph.graph.get(cKey).imports = [aKey];
  graph.buildReverseGraph();

  // Normalize normalizeFilePath to identity for stable cross-platform test
  const origNormalize = graph.normalizeFilePath.bind(graph);
  graph.normalizeFilePath = (p) => p;

  // Compute and cache cycles
  const cycles = graph.analyzer.findCircularDependencies();
  assert.strictEqual(cycles.length, 1, 'should find one cycle');
  assert(graph.analyzer._cachedCycles, 'cycles should be cached after first computation');
  assert(graph.analyzer._cycleFiles, '_cycleFiles set should be populated');

  // Update a file NOT in any cycle — cache should be preserved
  graph.bus.emit('graph:updated', { changedFiles: [dKey] });
  assert(graph.analyzer._cachedCycles, 'cache preserved when unrelated file changes');
  assert(graph.analyzer._cycleFiles, '_cycleFiles preserved when unrelated file changes');

  // Update a file that IS in a cycle — cache should be invalidated
  graph.bus.emit('graph:updated', { changedFiles: [aKey] });
  assert.strictEqual(graph.analyzer._cachedCycles, null, 'cache cleared when cycle file changes');
  assert.strictEqual(graph.analyzer._cycleFiles, null, '_cycleFiles cleared when cycle file changes');

  // Recompute and verify fullRebuild also clears cache
  graph.analyzer.findCircularDependencies();
  assert(graph.analyzer._cachedCycles, 'cycles recached after recomputation');
  graph.bus.emit('graph:updated', { fullRebuild: true });
  assert.strictEqual(graph.analyzer._cachedCycles, null, 'cache cleared on fullRebuild');

  graph.normalizeFilePath = origNormalize;
}

async function testJavaPackageExpansionIncrementalAffectedOnly() {
  const root = makeTempDir('wb-java-affected-only-');
  const write = (rel, content) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  try {
    write('src/A.java', 'package com.app;\nimport com.other.*;\npublic class A {}');
    write('src/B.java', 'package com.other;\npublic class B {}');
    write('src/Unrelated.java', 'package com.unrelated;\npublic class Unrelated {}');

    const cache = new WorkspaceCache(root);
    const graph = new DependencyGraph(root, cache, { quiet: true });

    const files = ['src/A.java', 'src/B.java', 'src/Unrelated.java'].map((f) => path.join(root, f));
    for (const file of files) {
      const stats = fs.statSync(file);
      cache.setFileMetadata(file, { mtime: stats.mtimeMs, size: stats.size });
    }

    await graph.build();

    const aKey = graph.normalizeFilePath(path.join(root, 'src/A.java'));
    const bKey = graph.normalizeFilePath(path.join(root, 'src/B.java'));
    const uKey = graph.normalizeFilePath(path.join(root, 'src/Unrelated.java'));

    // Count expansions of _expandJavaForFile to verify O(k) behavior
    let expansionCount = 0;
    const originalExpand = graph.builder._expandJavaForFile;
    graph.builder._expandJavaForFile = function (...args) {
      expansionCount++;
      return originalExpand.apply(this, args);
    };

    try {
      // Modify Unrelated.java (unrelated to com.other.* package group)
      write('src/Unrelated.java', 'package com.unrelated;\n// updated comment\npublic class Unrelated {}');
      const uStats = fs.statSync(path.join(root, 'src/Unrelated.java'));
      cache.setFileMetadata(path.join(root, 'src/Unrelated.java'), { mtime: uStats.mtimeMs, size: uStats.size });

      await graph.updateFiles([path.join(root, 'src/Unrelated.java')]);

      // Only Unrelated.java itself is affected. com.other package files should NOT be re-expanded!
      assert.strictEqual(expansionCount, 1, 'Only the updated Unrelated.java file should have been expanded');
    } finally {
      graph.builder._expandJavaForFile = originalExpand;
    }
  } finally {
    cleanupTempDir(root);
  }
}

async function main() {
  await testFrameworkImplicitDependenciesCacheIntegration();
  await testJavaPackageChangeConsistency();
  await testCycleCacheFineGrainedInvalidation();
  await testJavaPackageExpansionIncrementalAffectedOnly();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
