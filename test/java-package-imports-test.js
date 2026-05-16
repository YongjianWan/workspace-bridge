#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const { normalizePathKey } = require('../src/utils/path');
const { DependencyGraph, GraphBuilder } = require('../src/services/dep-graph');
const { buildMockDepGraph } = require('./test-helpers');

function n(p) {
  return normalizePathKey(p);
}

function testJavaWildcardImportExpansion() {
  const tmpDir = path.resolve('/tmp/wb-java-pkg-wildcard');
  const aPath = path.join(tmpDir, 'A.java');
  const bPath = path.join(tmpDir, 'B.java');
  const cPath = path.join(tmpDir, 'C.java');

  const aKey = n(aPath);
  const bKey = n(bPath);
  const cKey = n(cPath);

  const depGraph = new DependencyGraph(tmpDir);
  depGraph.graph = buildMockDepGraph({
    [aKey]: {
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
    [bKey]: {
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
    [cKey]: {
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

  depGraph.reverseGraph = new Map();

  const builder = new GraphBuilder(depGraph);
  builder.expandJavaPackageImports();

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

  const aKey = n(aPath);
  const bKey = n(bPath);

  const depGraph = new DependencyGraph(tmpDir);
  depGraph.graph = buildMockDepGraph({
    [aKey]: {
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
    [bKey]: {
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

  depGraph.reverseGraph = new Map();

  const builder = new GraphBuilder(depGraph);
  builder.expandJavaPackageImports();

  const aInfo = depGraph.graph.get(aKey);
  const bInfo = depGraph.graph.get(bKey);

  assert(aInfo.imports.includes(bKey), 'A should implicitly import B (same package)');
  assert(bInfo.imports.includes(aKey), 'B should implicitly import A (same package)');

  // Should have importRecords with special source marker
  const aRecord = aInfo.importRecords.find((r) => r.source === '<same-package:com.example>');
  assert(aRecord, 'A should have same-package import record');
  assert.strictEqual(aRecord.resolved, bKey);

  const bRecord = bInfo.importRecords.find((r) => r.source === '<same-package:com.example>');
  assert(bRecord, 'B should have same-package import record');
  assert.strictEqual(bRecord.resolved, aKey);
}

function testJavaWildcardExternalPackageIgnored() {
  const tmpDir = path.resolve('/tmp/wb-java-pkg-ext');
  const aPath = path.join(tmpDir, 'A.java');

  const aKey = n(aPath);

  const depGraph = new DependencyGraph(tmpDir);
  depGraph.graph = buildMockDepGraph({
    [aKey]: {
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

  depGraph.reverseGraph = new Map();

  const builder = new GraphBuilder(depGraph);
  builder.expandJavaPackageImports();

  const aInfo = depGraph.graph.get(aKey);
  assert.strictEqual(aInfo.imports.length, 0, 'External wildcard should not create edges');
}

function main() {
  testJavaWildcardImportExpansion();
  testJavaSamePackageImplicitRefs();
  testJavaWildcardExternalPackageIgnored();
}

main();
