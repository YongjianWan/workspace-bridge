#!/usr/bin/env node
// @semantic
const assert = require('assert');
const path = require('path');
const { DependencyGraph, GraphBuilder } = require('../src/services/dep-graph');

function testJavaWildcardImportExpansion() {
  const tmpDir = path.resolve('/tmp/wb-java-pkg-wildcard');
  const aPath = path.join(tmpDir, 'A.java');
  const bPath = path.join(tmpDir, 'B.java');
  const cPath = path.join(tmpDir, 'C.java');

  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [aPath]: {
      originalPath: aPath,
      imports: [],
      exports: ['A'],
      importRecords: [{
        source: 'com.other.*',
        imported: [],
        usesAllExports: true,
        resolved: null,
      }],
      exportRecords: [{ name: 'A' }],
      functionRecords: [],
      parseMode: 'ast',
      confidence: 'high',
      package: 'com.example',
    },
    [bPath]: {
      originalPath: bPath,
      imports: [],
      exports: ['B'],
      importRecords: [],
      exportRecords: [{ name: 'B' }],
      functionRecords: [],
      parseMode: 'ast',
      confidence: 'high',
      package: 'com.other',
    },
    [cPath]: {
      originalPath: cPath,
      imports: [],
      exports: ['C'],
      importRecords: [],
      exportRecords: [{ name: 'C' }],
      functionRecords: [],
      parseMode: 'ast',
      confidence: 'high',
      package: 'com.other',
    },
  });

  const builder = new GraphBuilder(depGraph);
  builder.expandJavaPackageImports();

  const aKey = depGraph.normalizeFilePath(aPath);
  const bKey = depGraph.normalizeFilePath(bPath);
  const cKey = depGraph.normalizeFilePath(cPath);

  const aInfo = depGraph.graph.get(aKey);
  assert(aInfo.imports.includes(bKey), 'A should import B via wildcard expansion');
  assert(aInfo.imports.includes(cKey), 'A should import C via wildcard expansion');

  // B and C are in the same package (com.other), so they also implicitly reference each other
  const bInfo = depGraph.graph.get(bKey);
  const cInfo = depGraph.graph.get(cKey);
  assert(bInfo.imports.includes(cKey), 'B should implicitly import C (same package)');
  assert(cInfo.imports.includes(bKey), 'C should implicitly import B (same package)');

  // Reverse graph should be updated
  const bDependents = depGraph.reverseGraph.get(bKey);
  assert(bDependents.includes(aKey), 'B should be depended by A via wildcard');
  assert(bDependents.includes(cKey), 'B should be depended by C via same-package');

  const cDependents = depGraph.reverseGraph.get(cKey);
  assert(cDependents.includes(aKey), 'C should be depended by A via wildcard');
  assert(cDependents.includes(bKey), 'C should be depended by B via same-package');
}

function testJavaSamePackageImplicitRefs() {
  const tmpDir = path.resolve('/tmp/wb-java-pkg-same');
  const aPath = path.join(tmpDir, 'A.java');
  const bPath = path.join(tmpDir, 'B.java');

  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [aPath]: {
      originalPath: aPath,
      imports: [],
      exports: ['A'],
      importRecords: [],
      exportRecords: [{ name: 'A' }],
      functionRecords: [],
      parseMode: 'ast',
      confidence: 'high',
      package: 'com.example',
    },
    [bPath]: {
      originalPath: bPath,
      imports: [],
      exports: ['B'],
      importRecords: [],
      exportRecords: [{ name: 'B' }],
      functionRecords: [],
      parseMode: 'ast',
      confidence: 'high',
      package: 'com.example',
    },
  });

  const builder = new GraphBuilder(depGraph);
  builder.expandJavaPackageImports();

  const aKey = depGraph.normalizeFilePath(aPath);
  const bKey = depGraph.normalizeFilePath(bPath);

  const aInfo = depGraph.graph.get(aKey);
  const bInfo = depGraph.graph.get(bKey);

  assert(aInfo.imports.includes(bKey), 'A should implicitly import B (same package)');
  assert(bInfo.imports.includes(aKey), 'B should implicitly import A (same package)');

  // Should have importRecords with special source marker
  const aRecord = aInfo.importRecords.find((r) => r.source === '<same-package:com.example>');
  assert(aRecord, 'A should have same-package import record');
  assert.strictEqual(aRecord.resolved, bKey);
  assert.strictEqual(aRecord.tier, 'tier3', 'same-package refs should be low-confidence tier3');
  assert.strictEqual(aRecord.confidence, 0.3, 'same-package refs should have reduced confidence');
  assert.strictEqual(aRecord.resolutionMethod, 'java-same-package');

  const bRecord = bInfo.importRecords.find((r) => r.source === '<same-package:com.example>');
  assert(bRecord, 'B should have same-package import record');
  assert.strictEqual(bRecord.resolved, aKey);
  assert.strictEqual(bRecord.tier, 'tier3');
  assert.strictEqual(bRecord.confidence, 0.3);

  // GraphQuery should expose the implicit reason, not pretend it's a real direct-import
  const impact = depGraph.query.getImpactRadius(aPath, 3);
  const bImpact = impact.find((r) => r.file === bPath);
  assert(bImpact, 'A should impact B via same-package visibility');
  assert.strictEqual(bImpact.reason, 'implicit-same-package', 'same-package visibility should be labelled as implicit');
}

function testJavaWildcardExternalPackageIgnored() {
  const tmpDir = path.resolve('/tmp/wb-java-pkg-ext');
  const aPath = path.join(tmpDir, 'A.java');

  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [aPath]: {
      originalPath: aPath,
      imports: [],
      exports: ['A'],
      importRecords: [{
        source: 'java.util.*',
        imported: [],
        usesAllExports: true,
        resolved: null,
      }],
      exportRecords: [{ name: 'A' }],
      functionRecords: [],
      parseMode: 'ast',
      confidence: 'high',
      package: 'com.example',
    },
  });

  const builder = new GraphBuilder(depGraph);
  builder.expandJavaPackageImports();

  const aKey = depGraph.normalizeFilePath(aPath);
  const aInfo = depGraph.graph.get(aKey);
  assert.strictEqual(aInfo.imports.length, 0, 'External wildcard should not create edges');
}

function main() {
  testJavaWildcardImportExpansion();
  testJavaSamePackageImplicitRefs();
  testJavaWildcardExternalPackageIgnored();
}

main();
