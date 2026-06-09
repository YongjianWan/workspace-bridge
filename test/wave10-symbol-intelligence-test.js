#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { GraphDB } = require('../src/services/graph-db');
const { WorkspaceCache } = require('../src/services/cache');
const { DependencyGraph } = require('../src/services/dep-graph');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { resolveImport } = require('../src/services/dep-graph/resolvers');

// 1. Verify schema migrations and existing data preservation
function testSchemaMigration() {
  const tmpDir = makeTempDir('wb-db-migration-');
  const dbPath = path.join(tmpDir, 'cache.db');

  // Step A: Manually create database with old schema (pre-migration)
  const tempDb = new DatabaseSync(dbPath);
  tempDb.exec(`
    CREATE TABLE edges (
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      edge_type TEXT NOT NULL DEFAULT 'import',
      confidence REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (source, target, edge_type)
    );
  `);

  // Insert mock data into old edges table
  const insert = tempDb.prepare('INSERT INTO edges (source, target, edge_type, confidence) VALUES (?, ?, ?, ?)');
  insert.run('src/file1.js', 'src/file2.js', 'import', 1.0);
  insert.run('src/file2.js', 'src/file3.js', 'implicit-framework', 0.9);
  tempDb.close();

  // Step B: Initialize GraphDB (should run migration)
  const db = new GraphDB(dbPath);
  db._ensureOpen();

  // Step C: Verify new columns exist with defaults and old data is intact
  const loaded = db.loadEdges();
  assert.strictEqual(loaded.length, 2, 'Migration should preserve existing 2 edges');

  const edge1 = loaded.find(e => e.source === 'src/file1.js');
  assert(edge1, 'file1 edge should be found');
  assert.strictEqual(edge1.tier, 'tier1', 'tier should fall back to default');
  assert.strictEqual(edge1.resolutionMethod, 'import', 'resolutionMethod should fall back to default');
  assert.strictEqual(edge1.confidence, 1.0, 'confidence should be preserved');

  const edge2 = loaded.find(e => e.source === 'src/file2.js');
  assert(edge2, 'file2 edge should be found');
  assert.strictEqual(edge2.tier, 'tier1', 'tier should fall back to default');
  assert.strictEqual(edge2.resolutionMethod, 'import', 'resolutionMethod should fall back to default');
  assert.strictEqual(edge2.confidence, 0.9, 'confidence should be preserved');

  db.close();
  cleanupTempDir(tmpDir);
}

// 2. Resolution metadata save/load roundtrip
function testMetadataPersistenceRoundtrip() {
  const tmpDir = makeTempDir('wb-db-persistence-');
  const dbPath = path.join(tmpDir, 'cache.db');
  const db = new GraphDB(dbPath);

  const edges = [
    { source: 'src/a.js', target: 'src/b.js', edgeType: 'import', confidence: 0.8, tier: 'tier2', resolutionMethod: 'symbol-table' },
    { source: 'src/b.js', target: 'src/c.js', edgeType: 'implicit-framework', confidence: 1.0, tier: 'tier1', resolutionMethod: 'implicit-framework' },
  ];

  db.saveEdges(edges, { cacheVersion: 1 });

  const loaded = db.loadEdges();
  assert.strictEqual(loaded.length, 2);

  const edgeA = loaded.find(e => e.source === 'src/a.js');
  assert.strictEqual(edgeA.confidence, 0.8);
  assert.strictEqual(edgeA.tier, 'tier2');
  assert.strictEqual(edgeA.resolutionMethod, 'symbol-table');

  const edgeB = loaded.find(e => e.source === 'src/b.js');
  assert.strictEqual(edgeB.confidence, 1.0);
  assert.strictEqual(edgeB.tier, 'tier1');
  assert.strictEqual(edgeB.resolutionMethod, 'implicit-framework');

  db.close();
  cleanupTempDir(tmpDir);
}

// 3. Verify trySymbolTable fallback metadata and resolvers outMeta updates
function testResolverOutMetaUpdates() {
  const { SymbolRegistry } = require('../src/services/dep-graph/symbol-registry');
  const registry = new SymbolRegistry();
  registry.register('/src/target.js', [{ name: 'UniqueSymbol' }]);

  const outMeta = {};
  const root = '/';

  // Use trySymbolTable fallback
  const resolved = resolveImport('/src/caller.js', 'UniqueSymbol', '.js', root, registry, outMeta);
  assert.strictEqual(resolved, '/src/target.js');
  assert.strictEqual(outMeta.method, 'symbol-table');
  assert.strictEqual(outMeta.tier, 'tier2');
  assert.strictEqual(outMeta.confidence, 0.8);
}

// 4. Two-phase build resolves circular/forward symbol table lookups on cold start
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
  testSchemaMigration();
  testMetadataPersistenceRoundtrip();
  testResolverOutMetaUpdates();
  await testTwoPhaseBuildSymbolResolution();
  console.log('All Wave 10 tests passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
