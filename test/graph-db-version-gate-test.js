#!/usr/bin/env node
// @contract
// 版本闸的唯一不变量：CACHE_VERSION 不匹配时，没有任何表能被读出来。
//
// 病史（同一个洞补了四次）：wave8 预计算污染 → analysis_snapshots 逐行盖戳 →
// loader.js 的 edgeMeta 门禁 → savePrecomputed 的 test_map 无条件重写。四次都是
// "闸只开在读侧的某一个入口，别的入口裸读"。loadAll() 版本不符时只 return null
// 而不清表，loadEdges / loadTestMap / loadMetrics / loadRoutes /
// loadPrecomputedImpact / loadPrecomputedAggregates 各自裸读。
//
// 本测试锁的是「每一个读入口」，新增 loadXxx 时必须来这里加一行——加不进来说明
// 它绕过了 _readGuard。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GraphDB } = require('../src/services/graph-db');
const { CACHE_VERSION } = require('../src/config/constants');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-version-gate-'));
  const db = new GraphDB(path.join(dir, 'cache.db'));
  return { db, dir };
}

function seedEveryTable(db) {
  db.saveAll({
    workspaceInfo: { root: '/repo' },
    workspaceRoot: '/repo',
    fileMetadata: new Map([['a.js', { mtime: 1, size: 1, hash: 'h' }]]),
    parseResults: new Map(),
    symbolIndex: new Map(),
    diagnostics: new Map(),
    timestamp: Date.now(),
  });
  db.saveEdges([{ source: 'a.js', target: 'b.js', edgeType: 'import' }], {
    cacheVersion: CACHE_VERSION,
    fileMetadataCount: 1,
    parseResultsCount: 0,
    timestamp: Date.now(),
  });
  db.saveRoutes([{ file: 'a.js', method: 'GET', path: '/x', framework: 'express', handler: 'h' }]);
  db.saveMetrics([{ file: 'a.js', dimension: 'complexity', value: 3 }]);
  db.saveTestMap([{ source: 'a.js', testFile: 'a-test.js', signal: 'import', distance: 1 }]);
  db.savePrecomputedAggregates([{ key: 'overview', data: '{}', version: 1, fileCount: 1, configHash: 'c' }]);
  db.savePrecomputedImpact([{ file: 'a.js', impactedFiles: ['b.js'], severity: 'low' }]);
}

// Every read entry point, with the value it must produce once the stored
// version no longer matches. Adding a loadXxx without adding it here is the
// bug this file exists to catch.
const READ_ENTRY_POINTS = [
  { name: 'loadAll', call: (db) => db.loadAll(), expectStale: null },
  { name: 'loadEdges', call: (db) => db.loadEdges(), expectStale: null },
  { name: 'loadRoutes', call: (db) => db.loadRoutes(), expectStale: null },
  { name: 'loadMetrics', call: (db) => db.loadMetrics(), expectStale: null },
  { name: 'loadTestMap', call: (db) => db.loadTestMap(), expectStale: null },
  { name: 'loadPrecomputedAggregates', call: (db) => db.loadPrecomputedAggregates(), expectStale: null },
  { name: 'loadPrecomputedImpact', call: (db) => db.loadPrecomputedImpact(), expectStale: null },
  { name: 'loadRoutesForFiles', call: (db) => db.loadRoutesForFiles(['a.js']), expectStale: [] },
  { name: 'loadMetricsForFiles', call: (db) => db.loadMetricsForFiles(['a.js']), expectStale: [] },
  { name: 'loadTestMapForFiles', call: (db) => db.loadTestMapForFiles(['a.js']), expectStale: [] },
  // Recursive CTE over edges + routes — the easiest read path to forget,
  // because it doesn't look like a "load" at all.
  { name: 'findAffectedHttpRoutes', call: (db) => db.findAffectedHttpRoutes('b.js', 3), expectStale: null },
];

function isNonEmpty(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function testAllReadsSucceedAtCurrentVersion() {
  const { db, dir } = makeDb();
  seedEveryTable(db);

  for (const entry of READ_ENTRY_POINTS) {
    const value = entry.call(db);
    assert.ok(
      isNonEmpty(value),
      `${entry.name} should return data at the current CACHE_VERSION (got ${JSON.stringify(value)})`
    );
  }

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testNoTableSurvivesAVersionMismatch() {
  const { db, dir } = makeDb();
  seedEveryTable(db);

  // Simulate a database written by an older build: rows stay, stamp goes stale.
  db.db.prepare("INSERT OR REPLACE INTO cache_metadata (key, value) VALUES ('version', ?)")
    .run(String(CACHE_VERSION - 1));

  for (const entry of READ_ENTRY_POINTS) {
    const value = entry.call(db);
    assert.deepStrictEqual(
      value,
      entry.expectStale,
      `${entry.name} must not serve rows written under a different CACHE_VERSION (got ${JSON.stringify(value)})`
    );
  }

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testRewriteRestoresReadability() {
  const { db, dir } = makeDb();
  seedEveryTable(db);
  db.db.prepare("INSERT OR REPLACE INTO cache_metadata (key, value) VALUES ('version', ?)")
    .run(String(CACHE_VERSION - 1));
  assert.strictEqual(db.loadEdges(), null, 'precondition: gate is closed');

  // A fresh build re-stamps the version — the gate must open again, otherwise
  // a version bump would permanently brick the cache directory.
  seedEveryTable(db);
  for (const entry of READ_ENTRY_POINTS) {
    assert.ok(isNonEmpty(entry.call(db)), `${entry.name} must be readable again after a re-stamped write`);
  }

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testUnstampedDatabaseIsReadableAndGetsStamped() {
  const { db, dir } = makeDb();
  // Partial writes only — no saveAll, so nothing stamps the version explicitly.
  db.saveEdges([{ source: 'a.js', target: 'b.js', edgeType: 'import' }]);

  assert.strictEqual(
    db.getMetadata('version'),
    String(CACHE_VERSION),
    'any write must give an unstamped database its provenance'
  );
  assert.strictEqual((db.loadEdges() || []).length, 1, 'a process must be able to read back what it just wrote');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function testForeignStampSurvivesPartialWrites() {
  const { db, dir } = makeDb();
  seedEveryTable(db);
  db.db.prepare("INSERT OR REPLACE INTO cache_metadata (key, value) VALUES ('version', ?)")
    .run(String(CACHE_VERSION - 1));

  // A partial write must NOT re-stamp a foreign database: that would re-open
  // the gate onto rows written under semantics this build cannot interpret.
  db.saveRoutes([{ file: 'c.js', method: 'POST', path: '/y', framework: 'express' }]);

  assert.strictEqual(db.getMetadata('version'), String(CACHE_VERSION - 1), 'foreign stamp must not be overwritten');
  assert.strictEqual(db.loadEdges(), null, 'gate must stay closed after a partial write');
  assert.strictEqual(db.loadRoutes(), null, 'even the table just written stays gated until a full rebuild');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

const tests = [
  testAllReadsSucceedAtCurrentVersion,
  testUnstampedDatabaseIsReadableAndGetsStamped,
  testForeignStampSurvivesPartialWrites,
  testNoTableSurvivesAVersionMismatch,
  testRewriteRestoresReadability,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log(`  PASS: ${t.name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${t.name} —`, e.message);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed > 0) process.exit(1);
