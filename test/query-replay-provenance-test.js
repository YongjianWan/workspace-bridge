// @semantic
//
// query-* deliberately keeps a coarse freshness check (gitHead + fileCount +
// config) so it stays a fast cached-aggregate reader — audit-overview since
// L2-15 additionally compares a content signature and recomputes on any
// in-place edit. That divergence is a design choice, but it means query-*
// can serve numbers the tree has already moved past, reading the SAME
// snapshot row audit-overview just rejected.
//
// L1-4: a stale answer is allowed, a SILENT stale answer is not. Every
// snapshot-served query response must carry `replayedFrom` (with contentMatch
// telling the consumer whether the tree moved) and must raise a warning when
// it did. An AI agent does not doubt its inputs — the signal has to be in the
// payload.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { queryHotspots, queryKnowledgeRisk, queryStability } = require('../src/tools/query-tools');
const { computeConfigHash } = require('../src/utils/project-context');
const { runCliInProcessRaw, assertOk, makeTempDir, cleanupTempDir } = require('./test-helpers');
const { GraphDB } = require('../src/services/graph-db');

const MOCK_OVERVIEW = {
  hotspots: [{ file: 'a.js', score: 99, risk: 'high', lines: 100, churn: 10 }],
  knowledgeRisk: { high: [{ file: 'kr.js', riskLevel: 'high', authorCount: 1 }], medium: [], low: [] },
  stability: [{ file: 's.js', cc: 15, loc: 200, assessment: 'fragile' }],
};

// storedSignature = what the snapshot row carries; liveSignature = what the
// current index hashes to. Equal → the tree has not moved.
function makeMockContainer({ storedSignature, liveSignature }) {
  const gitHead = 'mock-head';
  const fileCount = 3;
  const configHash = computeConfigHash(null);
  return {
    projectContext: { config: null },
    snapshot: {
      graph: {
        getScopeSummary: () => ({ counts: { totalFiles: fileCount } }),
        getAllFilePaths: () => [],
      },
    },
    cache: {
      loadAnalysisSnapshot: () => ({
        data: MOCK_OVERVIEW,
        version: gitHead,
        fileCount,
        configHash,
        computedAt: 1700000000,
        contentSignature: storedSignature,
      }),
      getWorkspaceInfo: () => ({ gitHead }),
      getContentSignature: () => liveSignature,
    },
  };
}

function driftWarnings(result) {
  return (result.warnings || []).filter((w) => w.type === 'snapshot-content-drift');
}

async function testUnmovedTreeReplayIsMarkedAndSilent() {
  const container = makeMockContainer({ storedSignature: 'sig-a', liveSignature: 'sig-a' });
  const result = await queryHotspots({}, container);
  assert.strictEqual(result.ok, true);
  assert.ok(result.replayedFrom, 'snapshot-served response must declare its provenance');
  assert.strictEqual(result.replayedFrom.contentMatch, true, 'unmoved tree must report contentMatch true');
  assert.strictEqual(result.replayedFrom.computedAt, 1700000000);
  assert.strictEqual(driftWarnings(result).length, 0, 'an unmoved tree must not raise a drift warning');
}

async function testMovedTreeReplayRaisesDriftWarning() {
  const container = makeMockContainer({ storedSignature: 'sig-a', liveSignature: 'sig-b' });
  const result = await queryHotspots({}, container);
  // Still served — the speed tradeoff is deliberate and stays. What must not
  // stay is the silence.
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.count, 1, 'query-* must still serve the cached aggregate');
  assert.strictEqual(result.replayedFrom.contentMatch, false, 'a moved tree must report contentMatch false');
  assert.strictEqual(driftWarnings(result).length, 1, 'a moved tree must raise exactly one drift warning');
}

async function testLegacySnapshotCountsAsUnverifiable() {
  // Rows written before the content_signature column carry ''. Unverifiable
  // is not the same as verified-equal; it must warn, not claim a match.
  const container = makeMockContainer({ storedSignature: '', liveSignature: 'sig-b' });
  const result = await queryHotspots({}, container);
  assert.strictEqual(result.replayedFrom.contentMatch, false, 'an unsigned snapshot must not claim contentMatch');
  assert.strictEqual(driftWarnings(result).length, 1, 'an unsigned snapshot must warn');
}

async function testAllThreeQueryCommandsCarryProvenance() {
  const container = makeMockContainer({ storedSignature: 'sig-a', liveSignature: 'sig-b' });
  for (const [name, fn] of [
    ['query-hotspots', queryHotspots],
    ['query-knowledge-risk', queryKnowledgeRisk],
    ['query-stability', queryStability],
  ]) {
    const result = await fn({}, container);
    assert.ok(result.replayedFrom, `${name} must declare provenance on a snapshot replay`);
    assert.strictEqual(driftWarnings(result).length, 1, `${name} must warn on content drift`);
  }
}

// The T5 lesson: asserting on the tool function proves the number is computed,
// not that the user receives it. cli.js assigns result.warnings from the graph
// after runCommand — an overwrite there deletes the drift warning on the only
// path that matters.
async function testDriftWarningSurvivesTheRealCliPath() {
  const repo = makeTempDir('wb-qprov-repo-');
  const cache = makeTempDir('wb-qprov-cache-');
  try {
    fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"qprov","version":"1.0.0"}');
    fs.writeFileSync(path.join(repo, 'a.js'), "const b = require('./b');\nmodule.exports = { b };\n");
    fs.writeFileSync(path.join(repo, 'b.js'), 'module.exports = 1;\n');

    const cold = await runCliInProcessRaw(
      ['audit-overview', '--cwd', repo, '--cache-dir', cache, '--json', '--quiet'],
      { cwd: repo }
    );
    assertOk(cold, 'cold audit-overview should succeed');

    // In-place edit: same file count, same (absent) git head, same config —
    // exactly the shape the coarse check cannot see.
    fs.writeFileSync(path.join(repo, 'b.js'), 'module.exports = 2;\n');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(repo, 'b.js'), future, future);

    const warm = await runCliInProcessRaw(
      ['query-hotspots', '--cwd', repo, '--cache-dir', cache, '--json', '--quiet'],
      { cwd: repo }
    );
    assertOk(warm, 'query-hotspots on a moved tree should still succeed');
    const data = JSON.parse(warm.stdout);
    if (!data.replayedFrom) return; // recomputed, not replayed — nothing to signal
    assert.strictEqual(data.replayedFrom.contentMatch, false, 'CLI response must report the drift');
    assert.ok(
      (data.warnings || []).some((w) => w.type === 'snapshot-content-drift'),
      'the drift warning must survive cli.js warning assembly'
    );
  } finally {
    cleanupTempDir(repo);
    cleanupTempDir(cache);
  }
}

// The recompute branch is not automatically honest. When the coarse check
// passes but the row carries no `hotspots`, query-* falls through to
// buildProjectOverview — which finds the SAME row fresh by its own (stricter)
// check and replays it, tagging its result with `replayedFrom`. That tag has
// to travel back out: hardcoding `replayedFrom: null` on the fallthrough path
// makes the response claim "computed this run" about a replay, which is the
// exact lie the rest of this file exists to prevent, one layer up.
async function testProvenanceSurvivesTheRecomputeBranch() {
  const repo = makeTempDir('wb-qprov-recompute-repo-');
  const cache = makeTempDir('wb-qprov-recompute-cache-');
  try {
    fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"qprov2","version":"1.0.0"}');
    fs.writeFileSync(path.join(repo, 'a.js'), "const b = require('./b');\nmodule.exports = { b };\n");
    fs.writeFileSync(path.join(repo, 'b.js'), 'module.exports = 1;\n');

    const cold = await runCliInProcessRaw(
      ['audit-overview', '--cwd', repo, '--cache-dir', cache, '--json', '--quiet'],
      { cwd: repo }
    );
    assertOk(cold, 'cold audit-overview should succeed');

    // Strip `hotspots` from the stored row while leaving every freshness key
    // (head / count / config / signature) byte-identical. The tree has not
    // moved — only query-*'s own payload precondition fails.
    const dbPath = findCacheDb(cache);
    assert.ok(dbPath, 'cold run should have produced a cache.db');
    const db = new GraphDB(dbPath);
    let stored;
    try {
      stored = db.loadAnalysisSnapshot('overview');
      assert.ok(stored && stored.data, 'cold run should have stored an overview snapshot');
      const { hotspots: _dropped, ...withoutHotspots } = stored.data;
      assert.ok('hotspots' in stored.data, 'precondition: the cold snapshot carries hotspots');
      db.saveAnalysisSnapshot(
        'overview',
        withoutHotspots,
        stored.version,
        stored.fileCount,
        stored.configHash,
        stored.contentSignature
      );
    } finally {
      db.close();
    }

    const warm = await runCliInProcessRaw(
      ['query-hotspots', '--cwd', repo, '--cache-dir', cache, '--json', '--quiet'],
      { cwd: repo }
    );
    assertOk(warm, 'query-hotspots should still succeed on a hotspot-less snapshot');
    const data = JSON.parse(warm.stdout);
    assert.ok(
      data.replayedFrom,
      'a response served from a replayed overview must declare provenance even when it reached the replay through the recompute branch'
    );
    assert.strictEqual(
      data.replayedFrom.contentMatch,
      true,
      'the tree never moved, so the replayed data must report contentMatch true'
    );
  } finally {
    cleanupTempDir(repo);
    cleanupTempDir(cache);
  }
}

function findCacheDb(dir) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === 'cache.db') return full;
    }
  }
  return null;
}

async function main() {
  await testUnmovedTreeReplayIsMarkedAndSilent();
  await testMovedTreeReplayRaisesDriftWarning();
  await testLegacySnapshotCountsAsUnverifiable();
  await testAllThreeQueryCommandsCarryProvenance();
  await testDriftWarningSurvivesTheRealCliPath();
  await testProvenanceSurvivesTheRecomputeBranch();
}

main();
