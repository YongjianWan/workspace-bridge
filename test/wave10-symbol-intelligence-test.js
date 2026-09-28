#!/usr/bin/env node
// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { DependencyGraph } = require('../src/services/dep-graph');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { resolveImport } = require('../src/services/dep-graph/resolvers');

// Verify trySymbolTable fallback metadata and resolvers outMeta updates
function testResolverOutMetaUpdates() {
  const { SymbolRegistry } = require('../src/services/dep-graph/symbol-registry');
  const registry = new SymbolRegistry();
  registry.register('/src/Target.java', [{ name: 'UniqueSymbol' }]);

  const outMeta = {};
  const root = '/';

  // Use trySymbolTable fallback — via a JVM caller: T6 (2026-07-31) removed
  // the fallback from JS/Python chains; the outMeta contract it locks lives
  // in trySymbolTable itself and is language-agnostic.
  const resolved = resolveImport('/src/Caller.java', 'UniqueSymbol', '.java', root, registry, outMeta);
  assert.strictEqual(resolved, '/src/Target.java');
  assert.strictEqual(outMeta.method, 'symbol-table');
  assert.strictEqual(outMeta.tier, 'tier2');
  assert.strictEqual(outMeta.confidence, 0.8);
}

// Two-phase build resolves circular/forward symbol table lookups on cold start
async function testTwoPhaseBuildSymbolResolution() {
  const tmpDir = makeTempDir('wb-twophase-');
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}', 'utf8');

  // We place FileOne.java and FileTwo.java in src/main/java/com/example/
  const javaDir = path.join(tmpDir, 'src', 'main', 'java', 'com', 'example');
  fs.mkdirSync(javaDir, { recursive: true });

  fs.writeFileSync(path.join(javaDir, 'FileOne.java'), `
    package com.example;
    public class ClassOne {}
  `, 'utf8');

  fs.writeFileSync(path.join(javaDir, 'FileTwo.java'), `
    package com.example;
    public class ClassTwo {}
  `, 'utf8');

  // CallerOne.java imports ClassTwo
  fs.writeFileSync(path.join(javaDir, 'CallerOne.java'), `
    package com.example;
    import com.example.ClassTwo;
    public class CallerOne {}
  `, 'utf8');

  // CallerTwo.java imports ClassOne
  fs.writeFileSync(path.join(javaDir, 'CallerTwo.java'), `
    package com.example;
    import com.example.ClassOne;
    public class CallerTwo {}
  `, 'utf8');

  const cache = new WorkspaceCache(tmpDir);
  // Seed file metadata
  const files = [
    path.join(javaDir, 'FileOne.java'),
    path.join(javaDir, 'FileTwo.java'),
    path.join(javaDir, 'CallerOne.java'),
    path.join(javaDir, 'CallerTwo.java'),
  ];
  files.forEach(f => cache.setFileMetadata(f, { mtime: 1, size: 1 }));

  const dg = new DependencyGraph(tmpDir, cache);
  await dg.build();

  // If two-phase build worked:
  // - Phase 1: parsed FileOne.java -> exports ClassOne; FileTwo.java -> exports ClassTwo
  // - Phase 2: resolved CallerOne's import of ClassTwo -> FileTwo.java; CallerTwo's import of ClassOne -> FileOne.java
  const callerOneKey = dg.normalizeFilePath(path.join(javaDir, 'CallerOne.java'));
  const callerTwoKey = dg.normalizeFilePath(path.join(javaDir, 'CallerTwo.java'));
  const fileOneKey = dg.normalizeFilePath(path.join(javaDir, 'FileOne.java'));
  const fileTwoKey = dg.normalizeFilePath(path.join(javaDir, 'FileTwo.java'));

  const callerOneInfo = dg.graph.get(callerOneKey);
  const callerTwoInfo = dg.graph.get(callerTwoKey);

  assert(callerOneInfo.imports.includes(fileTwoKey), 'CallerOne should resolve to FileTwo.java');
  assert(callerTwoInfo.imports.includes(fileOneKey), 'CallerTwo should resolve to FileOne.java');

  // Assert metadata is populated on import records
  const imp1 = callerOneInfo.importRecords.find(r => r.resolved === fileTwoKey);
  assert.strictEqual(imp1.tier, 'tier2');
  assert.strictEqual(imp1.resolutionMethod, 'symbol-table');
  assert.strictEqual(imp1.confidence, 0.8);

  const imp2 = callerTwoInfo.importRecords.find(r => r.resolved === fileOneKey);
  assert.strictEqual(imp2.tier, 'tier2');
  assert.strictEqual(imp2.resolutionMethod, 'symbol-table');
  assert.strictEqual(imp2.confidence, 0.8);

  cleanupTempDir(tmpDir);
}

async function main() {
  testResolverOutMetaUpdates();
  await testTwoPhaseBuildSymbolResolution();
  console.log('All Wave 10 tests passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
