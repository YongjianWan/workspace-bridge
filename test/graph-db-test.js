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

function main() {
  testSchemaCreation();
  testRoundTrip();
  testVersionMismatchReturnsNull();
  testCloseIdempotent();
  testWALFileGenerated();
}

main();
