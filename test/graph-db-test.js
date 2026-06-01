const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { GraphDB } = require('../src/services/graph-db');
const { CACHE_VERSION } = require('../src/config/constants');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testSchemaCreation() {
  const tmpDir = makeTempDir('wb-graphdb-');
  const dbPath = path.join(tmpDir, 'cache.db');
  const db = new GraphDB(dbPath);

  db._ensureOpen();
  assert(fs.existsSync(dbPath), 'database file should be created');

  db.close();
  cleanupTempDir(tmpDir);
}

function testRoundTrip() {
  const tmpDir = makeTempDir('wb-graphdb-');
  const dbPath = path.join(tmpDir, 'cache.db');
  const db = new GraphDB(dbPath);

  const data = {
    workspaceRoot: '/test/project',
    workspaceInfo: { name: 'test', version: '1.0.0' },
    fileMetadata: new Map([
      ['src/index.js', { mtime: 1234567890, size: 1024, hash: 'abc123', lineCount: 42, originalPath: '/test/project/src/index.js' }],
    ]),
    parseResults: new Map([
      ['src/index.js', {
        mtime: 1234567890,
        imports: ['./utils'],
        exports: ['main'],
        importRecords: [{ source: './utils', imported: ['helper'] }],
        exportRecords: [{ name: 'main', kind: 'function' }],
        functionRecords: [{ name: 'main', kind: 'function', lineStart: 1, lineEnd: 10 }],
        parseMode: 'ast',
        parseModeReason: 'tree-sitter',
        confidence: 'high',
      }],
    ]),
    symbolIndex: new Map([['main', [{ file: 'src/index.js', line: 1 }]]]),
    diagnostics: new Map([['src/index.js', { diagnostics: [{ message: 'test' }] }]]),
  };

  const saved = db.saveAll(data);
  assert.strictEqual(saved, true, 'saveAll should return true');

  const loaded = db.loadAll();
  assert(loaded, 'loadAll should return data');
  assert.strictEqual(loaded.version, CACHE_VERSION, 'version should match CACHE_VERSION');
  assert.strictEqual(loaded.workspaceRoot, '/test/project', 'workspaceRoot should match');
  assert.deepStrictEqual(loaded.workspaceInfo, data.workspaceInfo, 'workspaceInfo should match');

  assert(loaded.fileMetadata.has('src/index.js'), 'fileMetadata should contain src/index.js');
  const fileMeta = loaded.fileMetadata.get('src/index.js');
  assert.strictEqual(fileMeta.mtime, 1234567890, 'mtime should match');
  assert.strictEqual(fileMeta.size, 1024, 'size should match');
  assert.strictEqual(fileMeta.hash, 'abc123', 'hash should match');
  assert.strictEqual(fileMeta.lineCount, 42, 'lineCount should match');
  assert.strictEqual(fileMeta.originalPath, '/test/project/src/index.js', 'originalPath should match');

  assert(loaded.parseResults.has('src/index.js'), 'parseResults should contain src/index.js');
  const parseResult = loaded.parseResults.get('src/index.js');
  assert.deepStrictEqual(parseResult.imports, ['./utils'], 'imports should match');
  assert.deepStrictEqual(parseResult.exports, ['main'], 'exports should match');
  assert.strictEqual(parseResult.parseMode, 'ast', 'parseMode should match');
  assert.strictEqual(parseResult.confidence, 'high', 'confidence should match');

  assert(loaded.symbolIndex.has('main'), 'symbolIndex should contain main');
  assert.deepStrictEqual(loaded.symbolIndex.get('main'), [{ file: 'src/index.js', line: 1 }], 'symbol locations should match');

  assert(loaded.diagnostics.has('src/index.js'), 'diagnostics should contain src/index.js');

  db.close();
  cleanupTempDir(tmpDir);
}

function testVersionMismatchReturnsNull() {
  const tmpDir = makeTempDir('wb-graphdb-');
  const dbPath = path.join(tmpDir, 'cache.db');
  const db = new GraphDB(dbPath);

  // Manually insert wrong version
  db._ensureOpen();
  db.db.prepare('INSERT INTO cache_metadata (key, value) VALUES (?, ?)').run('version', '99999');
  db.db.prepare('INSERT INTO cache_metadata (key, value) VALUES (?, ?)').run('timestamp', '0');
  db.db.prepare('INSERT INTO cache_metadata (key, value) VALUES (?, ?)').run('workspaceRoot', '');
  db.db.prepare('INSERT INTO cache_metadata (key, value) VALUES (?, ?)').run('workspaceInfo', '');

  const loaded = db.loadAll();
  assert.strictEqual(loaded, null, 'version mismatch should return null');

  db.close();
  cleanupTempDir(tmpDir);
}

function testCloseIdempotent() {
  const tmpDir = makeTempDir('wb-graphdb-');
  const dbPath = path.join(tmpDir, 'cache.db');
  const db = new GraphDB(dbPath);

  db._ensureOpen();
  db.close();
  db.close(); // should not throw
  assert.strictEqual(db.db, null, 'db should be null after close');

  cleanupTempDir(tmpDir);
}

function testWALFileGenerated() {
  const tmpDir = makeTempDir('wb-graphdb-');
  const dbPath = path.join(tmpDir, 'cache.db');
  const db = new GraphDB(dbPath);

  db._ensureOpen();
  assert(fs.existsSync(dbPath), 'database file should exist');
  assert(fs.existsSync(dbPath + '-wal') || fs.existsSync(dbPath + '-shm'), 'WAL files should be generated');

  db.close();
  cleanupTempDir(tmpDir);
}

function testEdgesRoundTrip() {
  const tmpDir = makeTempDir('wb-graphdb-');
  const dbPath = path.join(tmpDir, 'cache.db');
  const db = new GraphDB(dbPath);

  const edges = [
    { source: 'src/index.js', target: 'src/utils.js', edgeType: 'import', confidence: 1.0 },
    { source: 'src/index.js', target: 'src/lib.js', edgeType: 'implicit-framework', confidence: 0.9 },
    { source: 'src/utils.js', target: 'src/lib.js', edgeType: 'import', confidence: 1.0 },
  ];

  const meta = { cacheVersion: CACHE_VERSION, fileMetadataCount: 3, parseResultsCount: 3, timestamp: Date.now() };

  const saved = db.saveEdges(edges, meta);
  assert.strictEqual(saved, true, 'saveEdges should return true');

  const loaded = db.loadEdges();
  assert(loaded, 'loadEdges should return edges');
  assert.strictEqual(loaded.length, 3, 'should load 3 edges');

  const sorted = loaded.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  assert.strictEqual(sorted[0].source, 'src/index.js');
  assert.strictEqual(sorted[0].target, 'src/lib.js');
  assert.strictEqual(sorted[0].edgeType, 'implicit-framework');
  assert.strictEqual(sorted[0].confidence, 0.9);

  assert.strictEqual(sorted[1].source, 'src/index.js');
  assert.strictEqual(sorted[1].target, 'src/utils.js');
  assert.strictEqual(sorted[1].edgeType, 'import');

  assert.strictEqual(sorted[2].source, 'src/utils.js');
  assert.strictEqual(sorted[2].target, 'src/lib.js');

  // Edge meta persisted
  const edgeMetaRaw = db.getMetadata('edgeMeta');
  assert(edgeMetaRaw, 'edgeMeta should be persisted');
  const edgeMeta = JSON.parse(edgeMetaRaw);
  assert.strictEqual(edgeMeta.cacheVersion, CACHE_VERSION);
  assert.strictEqual(edgeMeta.fileMetadataCount, 3);

  db.close();
  cleanupTempDir(tmpDir);
}

function testEdgesLoadEmptyReturnsNull() {
  const tmpDir = makeTempDir('wb-graphdb-');
  const dbPath = path.join(tmpDir, 'cache.db');
  const db = new GraphDB(dbPath);

  const loaded = db.loadEdges();
  assert.deepStrictEqual(loaded, [], 'loadEdges on fresh DB should return empty array');

  db.close();
  cleanupTempDir(tmpDir);
}

function testSaveIncrementalMetadataOnly() {
  const tmpDir = makeTempDir('wb-graphdb-');
  const dbPath = path.join(tmpDir, 'cache.db');
  const db = new GraphDB(dbPath);

  // Baseline save with dirty files
  db.saveIncremental({
    workspaceRoot: '/test',
    metadata: { version: '1', timestamp: '1000' },
    dirtyFiles: [['a.js', { mtime: 1, size: 1, hash: 'h1', lineCount: 1, originalPath: '/test/a.js' }]],
    deletedFiles: [],
    dirtyParseResults: [],
    deletedParseResults: [],
    dirtySymbols: [],
    deletedSymbols: [],
    dirtyDiagnostics: [],
    deletedDiagnostics: [],
  });

  // Metadata-only update: all dirty sets are empty but metadata changed
  const ok = db.saveIncremental({
    workspaceRoot: '/test',
    metadata: { version: '2', timestamp: '2000' },
    dirtyFiles: [],
    deletedFiles: [],
    dirtyParseResults: [],
    deletedParseResults: [],
    dirtySymbols: [],
    deletedSymbols: [],
    dirtyDiagnostics: [],
    deletedDiagnostics: [],
  });
  assert.strictEqual(ok, true, 'metadata-only saveIncremental should succeed');

  const loadedVersion = db.getMetadata('version');
  assert.strictEqual(loadedVersion, '2', 'version metadata should be updated even with empty dirty sets');
  const loadedTimestamp = db.getMetadata('timestamp');
  assert.strictEqual(loadedTimestamp, '2000', 'timestamp metadata should be updated');

  db.close();
  cleanupTempDir(tmpDir);
}

function testTransactionRollbackPreservesOriginalError() {
  const tmpDir = makeTempDir('wb-graphdb-');
  const dbPath = path.join(tmpDir, 'cache.db');
  const db = new GraphDB(dbPath);
  db._ensureOpen();

  // Simulate a scenario where the body throws and ROLLBACK also fails.
  // We monkey-patch exec to fail on ROLLBACK while still allowing BEGIN.
  let callCount = 0;
  const originalExec = db.db.exec.bind(db.db);
  db.db.exec = (sql) => {
    callCount++;
    if (sql === 'ROLLBACK') {
      throw new Error('disk full');
    }
    return originalExec(sql);
  };

  try {
    db._executeInTransaction(() => {
      throw new Error('original failure');
    });
    assert.fail('should have thrown');
  } catch (err) {
    assert.strictEqual(err.message, 'original failure', 'original error message should be preserved');
    assert.strictEqual(err.rollbackError, 'disk full', 'rollback error should be attached');
  }

  db.db.exec = originalExec;
  db.close();
  cleanupTempDir(tmpDir);
}

function testTransactionRejectsAsyncFunction() {
  const tmpDir = makeTempDir('wb-graphdb-');
  const dbPath = path.join(tmpDir, 'cache.db');
  const db = new GraphDB(dbPath);
  db._ensureOpen();

  try {
    db._executeInTransaction(async () => 'result');
    assert.fail('should have thrown for async function');
  } catch (err) {
    assert(err.message.includes('does not support async'), 'should reject async functions');
  }

  db.close();
  cleanupTempDir(tmpDir);
}

function main() {
  testSchemaCreation();
  testRoundTrip();
  testVersionMismatchReturnsNull();
  testCloseIdempotent();
  testWALFileGenerated();
  testEdgesRoundTrip();
  testEdgesLoadEmptyReturnsNull();
  testSaveIncrementalMetadataOnly();
  testTransactionRollbackPreservesOriginalError();
  testTransactionRejectsAsyncFunction();
}

main();
