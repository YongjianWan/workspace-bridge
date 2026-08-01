#!/usr/bin/env node
// @semantic
/**
 * Guards for two spots registered as zero-coverage on 2026-08-01 (mutation
 * experiment: each killed individually, full suite stayed green):
 *
 *  1. analyzer.js Rule 5 — tier3 same-package implicit edges must NOT feed
 *     cycle detection. The observable signal is getCycleMeta().sccCount, NOT
 *     the cycles list: the list is ALSO post-filtered by _isSamePackageCycle,
 *     so a cycles===0 assertion alone stays green when Rule 5 is killed while
 *     same-package files silently form SCCs (the severity signal consumers
 *     read). This test asserts both.
 *     Since 2026-08-01 tier3 edges exist for Java AND Go — one fixture each.
 *
 *  2. analyzer.js precomputeImpact — files reached via a same-package implicit
 *     edge must carry reason 'implicit-same-package' in impactRadius (killing
 *     the check silently downgrades them to 'direct-import'). The criterion is
 *     tier==='tier3' (language-neutral since 2026-08-01), so both a Java and a
 *     Go fixture are locked here.
 *
 * Mutation protocol (run manually when touching either spot): kill the
 * condition to `if (false)`, this file must go RED; restore, it must go GREEN.
 */
const assert = require('assert');
const path = require('path');
const { DependencyGraph, GraphBuilder } = require('../src/services/dep-graph');

function javaFile(filePath, pkg, overrides = {}) {
  return {
    originalPath: filePath,
    imports: [],
    exports: [path.basename(filePath, '.java')],
    importRecords: [],
    exportRecords: [{ name: path.basename(filePath, '.java') }],
    functionRecords: [],
    parseMode: 'ast',
    confidence: 'high',
    package: pkg,
    ...overrides,
  };
}

function goFile(filePath) {
  return {
    originalPath: filePath,
    imports: [],
    exports: [],
    importRecords: [],
    exportRecords: [],
    functionRecords: [],
    parseMode: 'ast',
    confidence: 'high',
  };
}

// Case 1 (Java): same-package tier3 edges exist but must produce neither
// reported cycles nor multi-node SCCs.
async function testJavaSamePackageEdgesFeedNoCycles() {
  const tmpDir = path.resolve('/tmp/wb-guard-java-cycles');
  const aPath = path.join(tmpDir, 'A.java');
  const bPath = path.join(tmpDir, 'B.java');

  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [aPath]: javaFile(aPath, 'com.example'),
    [bPath]: javaFile(bPath, 'com.example'),
  });
  const builder = new GraphBuilder(depGraph);
  await builder.expandJavaPackageImports();

  // Precondition: the fixture really carries tier3 same-package edges —
  // without them the assertions below guard nothing.
  const aInfo = depGraph.graph.get(depGraph.normalizeFilePath(aPath));
  assert(
    aInfo.importRecords.some((r) => r.tier === 'tier3' && r.resolutionMethod === 'java-same-package'),
    'fixture must contain a java-same-package tier3 record'
  );

  const cycles = depGraph.findCircularDependencies();
  assert.strictEqual(cycles.length, 0, `same-package-only graph must report no cycles, got ${JSON.stringify(cycles)}`);
  const meta = depGraph.getCycleMeta();
  assert.strictEqual(meta.sccCount, 0, `tier3 edges must not form SCCs (Rule 5), got sccCount=${meta.sccCount}`);
}

// Case 2 (Go): same shape, through the expand-go-packages postProcess stage.
async function testGoSamePackageEdgesFeedNoCycles() {
  const tmpDir = path.resolve('/tmp/wb-guard-go-cycles');
  const aPath = path.join(tmpDir, 'a.go');
  const bPath = path.join(tmpDir, 'b.go');

  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [aPath]: goFile(aPath),
    [bPath]: goFile(bPath),
  });
  const builder = new GraphBuilder(depGraph);
  await builder.expandGoPackageImports();

  const aInfo = depGraph.graph.get(depGraph.normalizeFilePath(aPath));
  assert(
    aInfo.importRecords.some((r) => r.tier === 'tier3' && r.resolutionMethod === 'go-same-package'),
    'fixture must contain a go-same-package tier3 record'
  );

  const cycles = depGraph.findCircularDependencies();
  assert.strictEqual(cycles.length, 0, `same-package-only Go graph must report no cycles, got ${JSON.stringify(cycles)}`);
  const meta = depGraph.getCycleMeta();
  assert.strictEqual(meta.sccCount, 0, `Go tier3 edges must not form SCCs (Rule 5), got sccCount=${meta.sccCount}`);
}

// Case 3 (Java): files reached via a same-package implicit edge are tagged
// 'implicit-same-package' in the precomputed impactRadius; files reached via a
// real import keep 'direct-import'.
async function testSamePackageReasonTagInImpactRadius() {
  const tmpDir = path.resolve('/tmp/wb-guard-reason-tag');
  const aPath = path.join(tmpDir, 'A.java');
  const bPath = path.join(tmpDir, 'B.java');
  const cPath = path.join(tmpDir, 'C.java');

  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [aPath]: javaFile(aPath, 'com.example'),
    [bPath]: javaFile(bPath, 'com.example'),
    // C really imports A (different package) — control case. The edge is
    // patched in below, where depGraph.normalizeFilePath is available.
    [cPath]: javaFile(cPath, 'com.other'),
  });

  const aKey = depGraph.normalizeFilePath(aPath);
  const bKey = depGraph.normalizeFilePath(bPath);
  const cKey = depGraph.normalizeFilePath(cPath);
  const cInfo = depGraph.graph.get(cKey);
  cInfo.imports.push(aKey);
  cInfo.importRecords.push({
    source: 'com.example.A',
    imported: ['A'],
    usesAllExports: false,
    resolved: aKey,
  });
  depGraph.reverseGraph.set(aKey, [...(depGraph.reverseGraph.get(aKey) || []), cKey]);

  const builder = new GraphBuilder(depGraph);
  await builder.expandJavaPackageImports();

  depGraph.analyzer.precomputeImpact();
  const entry = depGraph.analyzer.getPrecomputedImpact(aPath);
  assert(entry && Array.isArray(entry.impactRadius), 'precomputed impact for A must carry impactRadius');

  const bEntry = entry.impactRadius.find((r) => r.file === bKey);
  assert(bEntry, 'B must appear in A\'s impactRadius (same-package dependent)');
  assert.strictEqual(
    bEntry.reason,
    'implicit-same-package',
    `B reached via same-package edge must be tagged implicit-same-package, got '${bEntry.reason}'`
  );

  const cEntry = entry.impactRadius.find((r) => r.file === cKey);
  assert(cEntry, 'C must appear in A\'s impactRadius (real importer)');
  assert.strictEqual(
    cEntry.reason,
    'direct-import',
    `C reached via real import must keep direct-import, got '${cEntry.reason}'`
  );
}

// Case 4 (Go): after the read-side swap to tier==='tier3', the reason tag is
// language-neutral — Go same-package dependents are tagged too.
async function testGoSamePackageReasonTagInImpactRadius() {
  const tmpDir = path.resolve('/tmp/wb-guard-go-reason-tag');
  const aPath = path.join(tmpDir, 'a.go');
  const bPath = path.join(tmpDir, 'b.go');

  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [aPath]: goFile(aPath),
    [bPath]: goFile(bPath),
  });
  const builder = new GraphBuilder(depGraph);
  await builder.expandGoPackageImports();

  depGraph.analyzer.precomputeImpact();
  const entry = depGraph.analyzer.getPrecomputedImpact(aPath);
  assert(entry && Array.isArray(entry.impactRadius), 'precomputed impact for a.go must carry impactRadius');

  const bKey = depGraph.normalizeFilePath(bPath);
  const bEntry = entry.impactRadius.find((r) => r.file === bKey);
  assert(bEntry, 'b.go must appear in a.go\'s impactRadius (same-package dependent)');
  assert.strictEqual(
    bEntry.reason,
    'implicit-same-package',
    `b.go reached via go-same-package edge must be tagged implicit-same-package, got '${bEntry.reason}'`
  );
}

async function main() {
  await testJavaSamePackageEdgesFeedNoCycles();
  await testGoSamePackageEdgesFeedNoCycles();
  await testSamePackageReasonTagInImpactRadius();
  await testGoSamePackageReasonTagInImpactRadius();
  console.log('analyzer-same-package-guards-test: all tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
