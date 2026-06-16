// @contract
// @slow — initializes ServiceContainer 6 times, ~6-7s total
const assert = require('assert');
const { queryHotspots, queryKnowledgeRisk, queryStability } = require('../src/tools/query-tools');
const { ServiceContainer } = require('../src/services/container');
const { computeConfigHash } = require('../src/utils/project-context');

async function withContainer(fn) {
  const container = new ServiceContainer();
  await container.initialize(process.cwd(), 30000, { watch: false });
  try {
    return await fn(container);
  } finally {
    await container.shutdown();
  }
}

async function testQueryHotspotsReturnsData() {
  const result = await withContainer((c) => queryHotspots({}, c));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.command, 'query-hotspots');
  assert.ok(Array.isArray(result.hotspots));
  assert.ok(result.count > 0);
}

async function testQueryHotspotsFiltersByRisk() {
  const result = await withContainer((c) => queryHotspots({ risk: 'high' }, c));
  assert.strictEqual(result.ok, true);
  for (const h of result.hotspots) {
    assert.strictEqual(h.risk, 'high');
  }
}

async function testQueryHotspotsRespectsLimit() {
  const result = await withContainer((c) => queryHotspots({ limit: 2 }, c));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.count, 2);
  assert.strictEqual(result.hotspots.length, 2);
}

async function testQueryKnowledgeRisk() {
  const result = await withContainer((c) => queryKnowledgeRisk({ level: 'high', limit: 5 }, c));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.command, 'query-knowledge-risk');
  assert.ok(Array.isArray(result.files));
  assert.ok(result.count <= 5);
}

async function testQueryStability() {
  const result = await withContainer((c) => queryStability({ limit: 5 }, c));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.command, 'query-stability');
  assert.ok(Array.isArray(result.files));
  assert.ok(result.count <= 5);
}

async function testQueryStabilityFiltersByAssessment() {
  const result = await withContainer((c) => queryStability({ assessment: 'moderate', limit: 3 }, c));
  assert.strictEqual(result.ok, true);
  for (const s of result.files) {
    assert.strictEqual(s.assessment, 'moderate');
  }
}

async function testQueryToolsCacheHit() {
  await withContainer(async (container) => {
    // 1. Build project overview first to populate basic database cache
    const { buildProjectOverview } = require('../src/tools/overview-tools');
    await buildProjectOverview({}, container);

    // 1b. Verify the persisted snapshot carries the current config hash
    const currentConfigHash = computeConfigHash(container.projectContext?.config || null);
    const persistedRows = container.cache.loadPrecomputedAggregates() || [];
    const persistedSnapshot = persistedRows.find((r) => r.key === 'analysis_snapshot');
    assert.ok(persistedSnapshot, 'buildProjectOverview should persist a snapshot');
    assert.strictEqual(persistedSnapshot.configHash, currentConfigHash, 'persisted snapshot should record current config hash');

    // 2. Inject a custom mock snapshot into SQLite to verify cache hit
    const gitHead = container.cache?.getWorkspaceInfo?.()?.gitHead || 'mock-commit-hash';
    const mockPayload = {
      hotspots: [{ file: 'mock-hotspot.js', score: 99.9, risk: 'high', lines: 123, churn: 45 }],
      knowledgeRisk: { high: [{ file: 'mock-kr.js', riskLevel: 'high', authorCount: 1, primaryAuthor: 'Mock', primaryAuthorPct: 1 }] },
      stability: [{ file: 'mock-stable.js', cc: 5, loc: 50, assessment: 'stable' }],
      languageSupport: {},
      deadExports: { deadExportsCount: 0, deadExports: [] },
      unresolved: { unresolvedCount: 0, unresolved: [] },
      cycles: { cyclesCount: 0, cycles: [] },
      orphans: { counts: { total: 0 }, samples: {} },
      aggregates: {},
      summary: { severity: 'low' },
    };
    
    container.cache.savePrecomputedAggregates([
      {
        key: 'analysis_snapshot',
        data: JSON.stringify(mockPayload),
        version: gitHead,
        fileCount: container.snapshot?.graph?.getAllFilePaths?.().length || 0,
        configHash: computeConfigHash(container.projectContext?.config || null),
      }
    ]);

    const originalCheckFileChanges = container.cache.checkFileChanges;
    container.cache.checkFileChanges = () => ({ changed: false, changedFiles: [] });

    try {
      // 3. Query hotspots and verify it returns the mock data
      const result = await queryHotspots({}, container);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.count, 1);
      assert.strictEqual(result.hotspots[0].file, 'mock-hotspot.js');

      // 4. Query knowledge-risk and verify mock data
      const krResult = await queryKnowledgeRisk({ level: 'high' }, container);
      assert.strictEqual(krResult.ok, true);
      assert.strictEqual(krResult.count, 1);
      assert.strictEqual(krResult.files[0].file, 'mock-kr.js');

      // 5. Query stability and verify mock data
      const stResult = await queryStability({}, container);
      assert.strictEqual(stResult.ok, true);
      assert.strictEqual(stResult.count, 1);
      assert.strictEqual(stResult.files[0].file, 'mock-stable.js');
    } finally {
      container.cache.checkFileChanges = originalCheckFileChanges;
    }
  });
}

async function testQueryToolsFormatters() {
  const { formatHuman, formatSummary, formatMarkdown, formatJsonl, formatAi } = require('../src/cli/formatters/human-formatters');
  
  const mockResult = {
    ok: true,
    count: 1,
    total: 10,
    level: 'high',
    hotspots: [{ file: 'foo.js', score: 12.34, risk: 'high', lines: 100, churn: 5 }],
    files: [
      { file: 'foo.js', riskLevel: 'high', authorCount: 1, primaryAuthor: 'Alice', primaryAuthorPct: 1, cc: 2, loc: 50, assessment: 'stable' }
    ]
  };

  // query-hotspots formatting
  const hotspotsHuman = formatHuman('query-hotspots', mockResult);
  assert.ok(hotspotsHuman.includes('hotspotsCount: 1'));
  assert.ok(hotspotsHuman.includes('foo.js'));

  const hotspotsSummary = formatSummary('query-hotspots', mockResult);
  assert.ok(hotspotsSummary.includes('Hotspots: 1'));

  const hotspotsMarkdown = formatMarkdown('query-hotspots', mockResult);
  assert.ok(hotspotsMarkdown.includes('# Query Hotspots'));
  assert.ok(hotspotsMarkdown.includes('| foo.js | 12.34 |'));

  const hotspotsJsonl = formatJsonl('query-hotspots', mockResult);
  assert.ok(hotspotsJsonl.includes('"_type":"summary"'));
  assert.ok(hotspotsJsonl.includes('"_type":"hotspot"'));

  const hotspotsAi = formatAi('query-hotspots', mockResult);
  assert.ok(hotspotsAi.includes('"command": "query-hotspots"'));

  // query-knowledge-risk formatting
  const krHuman = formatHuman('query-knowledge-risk', mockResult);
  assert.ok(krHuman.includes('knowledgeRiskCount: 1'));

  const krMarkdown = formatMarkdown('query-knowledge-risk', mockResult);
  assert.ok(krMarkdown.includes('# Query Knowledge Risk'));

  const krJsonl = formatJsonl('query-knowledge-risk', mockResult);
  assert.ok(krJsonl.includes('"_type":"knowledge-risk-item"'));

  // query-stability formatting
  const stHuman = formatHuman('query-stability', mockResult);
  assert.ok(stHuman.includes('stabilityCount: 1'));

  const stMarkdown = formatMarkdown('query-stability', mockResult);
  assert.ok(stMarkdown.includes('# Query Stability'));

  const stJsonl = formatJsonl('query-stability', mockResult);
  assert.ok(stJsonl.includes('"_type":"stability-item"'));
}

async function main() {
  await testQueryHotspotsReturnsData();
  await testQueryHotspotsFiltersByRisk();
  await testQueryHotspotsRespectsLimit();
  await testQueryKnowledgeRisk();
  await testQueryStability();
  await testQueryStabilityFiltersByAssessment();
  await testQueryToolsCacheHit();
  await testQueryToolsFormatters();
  console.log('query-tools-test: all passed');
}

main();
