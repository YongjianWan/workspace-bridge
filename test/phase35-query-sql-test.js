// @contract
// @slow — initializes ServiceContainer and runs CLI commands
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ServiceContainer } = require('../src/services/container');
const { GraphDB } = require('../src/services/graph-db');
const { buildProjectOverview } = require('../src/tools/overview-tools');
const { runCliInProcess } = require('../cli');

async function withContainer(fn) {
  const container = new ServiceContainer();
  await container.initialize(process.cwd(), 30000, { watch: false });
  try {
    return await fn(container);
  } finally {
    await container.shutdown();
  }
}

async function testGraphDbSnapshotSaveAndLoad() {
  const tmpDir = path.join(os.tmpdir(), `wb-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const dbPath = path.join(tmpDir, 'test-cache.db');
  const db = new GraphDB(dbPath);

  try {
    const mockData = { foo: 'bar', nested: { val: 42 } };
    const ok = db.saveAnalysisSnapshot('overview_test', mockData, 'mock-hash', 10, 'conf-hash');
    assert.strictEqual(ok, true);

    const loaded = db.loadAnalysisSnapshot('overview_test');
    assert.ok(loaded);
    assert.deepStrictEqual(loaded.data, mockData);
    assert.strictEqual(loaded.version, 'mock-hash');
    assert.strictEqual(loaded.fileCount, 10);
    assert.strictEqual(loaded.configHash, 'conf-hash');
    assert.ok(loaded.computedAt > 0);
  } finally {
    db.close();
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(dbPath + '.lock');
      fs.rmdirSync(tmpDir);
    } catch {}
  }
}

async function testOverviewShortCircuitAndSave() {
  await withContainer(async (container) => {
    // 1. Build overview once to populate DB and snapshot
    const firstResult = await buildProjectOverview({}, container);
    assert.strictEqual(firstResult.ok, true);

    // Verify it was saved to analysis_snapshots
    const snapshot = container.cache?.loadAnalysisSnapshot?.('overview');
    assert.ok(snapshot, 'Snapshot should be saved in DB');
    assert.strictEqual(snapshot.fileCount, firstResult.scope?.counts?.totalFiles);

    // 2. Inject mock result into analysis_snapshots to verify short-circuit cache hit
    const mockOverview = {
      ok: true,
      workspaceRoot: firstResult.workspaceRoot,
      isMock: true,
      hotspots: [{ file: 'mocked-file.js', score: 100 }],
      scope: firstResult.scope,
      knowledgeRisk: firstResult.knowledgeRisk,
    };
    const gitHead = container.cache?.getWorkspaceInfo?.()?.gitHead || '';
    container.cache?.saveAnalysisSnapshot?.('overview', mockOverview, gitHead, snapshot.fileCount, snapshot.configHash);

    // Disable file change checking to simulate fresh environment
    const originalCheckFileChanges = container.cache.checkFileChanges;
    container.cache.checkFileChanges = () => ({ changed: false, changedFiles: [] });

    try {
      // 3. Call buildProjectOverview again; it should short-circuit and return our mock Overview
      const secondResult = await buildProjectOverview({}, container);
      assert.strictEqual(secondResult.isMock, true, 'Should short-circuit with cached snapshot');
      assert.strictEqual(secondResult.hotspots[0].file, 'mocked-file.js');
    } finally {
      container.cache.checkFileChanges = originalCheckFileChanges;
    }
  });
}

async function testFieldsFiltering() {
  // Test fields filtering via in-process CLI execution
  const res = await runCliInProcess(['audit-overview', '--fields', 'hotspots,cycles', '--json', '--quiet']);
  assert.strictEqual(res.status, 0);
  const data = JSON.parse(res.stdout);
  assert.strictEqual(data.ok, true);
  
  // hotspots and cycles should exist
  assert.ok(data.hotspots !== undefined);
  assert.ok(data.cycles !== undefined);

  // other non-essential fields (like stability, knowledgeRisk, summary, astRules) should be pruned
  assert.strictEqual(data.stability, undefined);
  assert.strictEqual(data.knowledgeRisk, undefined);
  assert.strictEqual(data.summary, undefined);
  assert.strictEqual(data.astRules, undefined);

  // essential fields must remain
  assert.strictEqual(data.command, 'audit-overview');
  assert.strictEqual(data.ok, true);
}

async function testSqlQueryValidationAndSecurity() {
  // 1. Valid Select Query
  const validRes = await runCliInProcess(['query', '--sql', 'SELECT key, file_count FROM analysis_snapshots', '--json', '--quiet']);
  assert.strictEqual(validRes.status, 0);
  const data = JSON.parse(validRes.stdout);
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.command, 'query');
  assert.ok(Array.isArray(data.rows));

  // 2. Reject modifying queries
  const invalidRes1 = await runCliInProcess(['query', '--sql', 'DROP TABLE analysis_snapshots', '--json', '--quiet']);
  assert.strictEqual(invalidRes1.status, 1);
  const data1 = JSON.parse(invalidRes1.stdout);
  assert.strictEqual(data1.ok, false);
  assert.ok(data1.error.includes('allowed') || data1.error.includes('modification'));

  const invalidRes2 = await runCliInProcess(['query', '--sql', 'INSERT INTO analysis_snapshots VALUES ("a","b","c",1,"d",0)', '--json', '--quiet']);
  assert.strictEqual(invalidRes2.status, 1);
  const data2 = JSON.parse(invalidRes2.stdout);
  assert.strictEqual(data2.ok, false);
  assert.ok(data2.error.includes('allowed') || data2.error.includes('modification'));
}

async function testSqlQueryFormatting() {
  const { formatHuman, formatSummary, formatMarkdown, formatJsonl } = require('../src/cli/formatters/human-formatters');

  const mockResult = {
    ok: true,
    count: 2,
    rows: [
      { file: 'a.js', cc: 5 },
      { file: 'b.js', cc: 10 },
    ]
  };

  const human = formatHuman('query', mockResult);
  assert.ok(human.includes('queryCount: 2'));
  assert.ok(human.includes('file | cc'));
  assert.ok(human.includes('a.js | 5'));
  assert.ok(human.includes('b.js | 10'));

  const summary = formatSummary('query', mockResult);
  assert.ok(summary.includes('Query results: 2 row(s) matched'));

  const md = formatMarkdown('query', mockResult);
  assert.ok(md.includes('# SQL Query Result'));
  assert.ok(md.includes('| file | cc |'));

  const jsonl = formatJsonl('query', mockResult);
  const lines = jsonl.split('\n');
  assert.strictEqual(lines.length, 3);
  assert.ok(JSON.parse(lines[0])._type === 'summary');
  assert.ok(JSON.parse(lines[1])._type === 'row');
}

async function main() {
  try {
    console.log('[Phase 3.5] Starting tests...');
    await testGraphDbSnapshotSaveAndLoad();
    console.log('  - testGraphDbSnapshotSaveAndLoad: PASSED');
    await testOverviewShortCircuitAndSave();
    console.log('  - testOverviewShortCircuitAndSave: PASSED');
    await testFieldsFiltering();
    console.log('  - testFieldsFiltering: PASSED');
    await testSqlQueryValidationAndSecurity();
    console.log('  - testSqlQueryValidationAndSecurity: PASSED');
    await testSqlQueryFormatting();
    console.log('  - testSqlQueryFormatting: PASSED');
    console.log('[Phase 3.5] All tests passed.');
  } catch (err) {
    console.error('[Phase 3.5] Test failed:', err);
    process.exit(1);
  }
}

main();
