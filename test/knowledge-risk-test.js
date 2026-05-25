// @semantic — knowledge risk integration + assembler wiring tests
const assert = require('assert');
const path = require('path');
const { buildKnowledgeRisk, assembleOverviewData } = require('../src/tools/overview-assembler');
const { createMockDepGraph } = require('./test-helpers');

const REPO_ROOT = path.resolve(__dirname, '..');

async function testBuildKnowledgeRiskStructure() {
  // Dogfood on a couple of known files to keep test fast
  const files = ['cli.js', 'src/tools/git-tools.js'];
  const result = await buildKnowledgeRisk(REPO_ROOT, files);
  assert(result, 'result should exist');
  assert(Array.isArray(result.high), 'high should be array');
  assert(Array.isArray(result.medium), 'medium should be array');
  assert(Array.isArray(result.low), 'low should be array');
  assert.strictEqual(typeof result.filesAnalyzed, 'number');
  assert.strictEqual(result.filesAnalyzed, 2);

  // Each entry should have expected shape
  const all = [...result.high, ...result.medium, ...result.low];
  for (const item of all) {
    assert.strictEqual(typeof item.file, 'string');
    assert.strictEqual(typeof item.totalLines, 'number');
    assert.strictEqual(typeof item.authorCount, 'number');
    assert(item.authorCount >= 1, `authorCount should be >= 1 for ${item.file}`);
    assert.ok(['high', 'medium', 'low'].includes(item.riskLevel), `riskLevel should be valid, got ${item.riskLevel}`);
  }
}

async function testBuildKnowledgeRiskSingleAuthor() {
  // A newly created file in this repo is guaranteed to have at least 1 author (us)
  // We test the scoring logic indirectly by checking that cli.js has reasonable data
  const result = await buildKnowledgeRisk(REPO_ROOT, ['cli.js']);
  assert.strictEqual(result.filesAnalyzed, 1);
  const entry = result.high[0] || result.medium[0] || result.low[0];
  assert(entry, 'should have an entry for cli.js');
  assert.strictEqual(entry.file, 'cli.js');
  assert(entry.totalLines > 0, 'cli.js should have lines');
  assert(entry.authorCount >= 1, 'cli.js should have at least 1 author');
}

async function testAssembleOverviewDataIncludesKnowledgeRisk() {
  // Use a mock depGraph with minimal data to verify wiring
  const depGraph = createMockDepGraph({
    mode: 'instance',
    root: REPO_ROOT,
    schema: {
      [path.join(REPO_ROOT, 'src/index.js')]: {
        imports: [],
        exports: [],
        exportRecords: [],
        importRecords: [],
        parseMode: 'ast',
      },
    },
  });

  // Stub projectContext to classify src/index.js as mainline library
  depGraph.projectContext = {
    classifyFile: (f) => ({
      isMainline: true,
      fileRole: f.includes('test') ? 'test' : 'library',
      directoryRole: 'active',
    }),
    summarizeFiles: () => ({ entryFiles: [], counts: {} }),
  };
  depGraph.getStats = () => ({});

  const container = {
    workspaceRoot: REPO_ROOT,
    snapshot: { graph: depGraph },
  };

  const args = { cwd: REPO_ROOT, now: new Date().toISOString() };
  const result = await assembleOverviewData(args, container, () => ({ ok: true, historyRisk: null }));
  assert.strictEqual(result.ok, true);
  assert(result.knowledgeRisk, 'knowledgeRisk should be present in assembleOverviewData result');
  assert(Array.isArray(result.knowledgeRisk.high));
  assert(Array.isArray(result.knowledgeRisk.medium));
  assert(Array.isArray(result.knowledgeRisk.low));
}

async function main() {
  await testBuildKnowledgeRiskStructure();
  await testBuildKnowledgeRiskSingleAuthor();
  await testAssembleOverviewDataIncludesKnowledgeRisk();
}

main();
