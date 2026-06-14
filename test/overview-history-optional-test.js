// @semantic — audit-overview/summary should not run per-file blame by default
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { buildProjectOverview } = require('../src/tools/overview-tools');
const { buildKnowledgeRisk, assembleOverviewData } = require('../src/tools/overview-assembler');
const { parseBlamePorcelain } = require('../src/tools/git-tools');
const { makeTempDir, cleanupTempDir, runInDir, makeMockSnapshot } = require('./test-helpers');

const root = path.resolve('C:/tmp/overview-history-fixture');
const fileA = path.join(root, 'src', 'a.js');
const fileB = path.join(root, 'src', 'b.js');

const snapshot = makeMockSnapshot({
  root,
  graph: new Map([
    [fileA, {}],
    [fileB, {}],
  ]),
  entryFiles: new Set([fileB]),
  projectContext: {
    classifyFile(file) {
      const rel = path.relative(root, file).replace(/\\/g, '/');
      return { isMainline: true, fileRole: rel.endsWith('app.js') ? 'entry' : 'library' };
    },
  },
  depGraphOverrides: {
    getDependents: () => [],
    getDependencies: () => [],
  },
});

const container = {
  workspaceRoot: root,
  depGraph: snapshot.graph,
  async ensureReady() { return true; },
};

async function testDefaultOverviewSkipsKnowledgeRisk() {
  const result = await buildProjectOverview({}, container);
  assert.strictEqual(result.knowledgeRisk.filesAnalyzed, 0, 'default overview should not analyze knowledge risk');
  assert.strictEqual(result.knowledgeRisk.high.length, 0);
  assert.strictEqual(result.knowledgeRisk.medium.length, 0);
  assert.strictEqual(result.knowledgeRisk.low.length, 0);
  assert.strictEqual(result.knowledgeRisk.disabledReason, 'history-not-enabled');
  assert.strictEqual(result.knowledgeRiskMeta.disabledReason, 'history-not-enabled');
}

async function testExplicitHistoryProviderStillCalled() {
  let calls = 0;
  const historyProvider = async (calledRoot, file) => {
    calls++;
    assert.strictEqual(calledRoot, root);
    return { ok: true, historyRisk: { level: 'low', commitCount: 1, authorCount: 1, signals: ['quiet'] } };
  };
  // Explicit provider is treated as an opt-in request for history.
  const result = await buildProjectOverview({ historyProvider }, container);
  assert.strictEqual(calls, 2, 'explicit historyProvider should still be called for all mainline files');
  assert.notStrictEqual(result.knowledgeRisk.disabledReason, 'history-not-enabled',
    'knowledge risk should not be disabled for history-not-enabled when provider is explicit');
}

async function testWithHistoryFlagTriggersHistoryProvider() {
  let calls = 0;
  const historyProvider = async () => {
    calls++;
    return { ok: true, historyRisk: { level: 'low', commitCount: 1, authorCount: 1, signals: ['quiet'] } };
  };
  const result = await buildProjectOverview({ withHistory: true, historyProvider }, container);
  assert.strictEqual(calls, 2, 'withHistory should trigger history provider');
  assert.notStrictEqual(result.knowledgeRisk.disabledReason, 'history-not-enabled');
}

async function testAssembleOverviewDataRespectsWithHistory() {
  const depGraph = snapshot.graph;
  const c = {
    workspaceRoot: root,
    snapshot: { graph: depGraph },
  };
  const noHistory = await assembleOverviewData({ cwd: root, now: new Date().toISOString() }, c, null);
  assert.strictEqual(noHistory.knowledgeRisk.filesAnalyzed, 0);
  assert.strictEqual(noHistory.knowledgeRisk.disabledReason, 'history-not-enabled');

  let calls = 0;
  const historyProvider = async () => { calls++; return { ok: true, historyRisk: null }; };
  const withHistory = await assembleOverviewData({ cwd: root, withHistory: true, now: new Date().toISOString() }, c, historyProvider);
  assert.strictEqual(calls, 2);
  assert.notStrictEqual(withHistory.knowledgeRisk.disabledReason, 'history-not-enabled');
}

async function testPersonalRepoKnowledgeRiskDisabled() {
  const tempRoot = makeTempDir('wb-kr-personal-');
  try {
    const srcFile = path.join(tempRoot, 'src', 'util.js');
    fs.mkdirSync(path.dirname(srcFile), { recursive: true });
    fs.writeFileSync(srcFile, 'export function helper() { return 1; }\n', 'utf8');
    runInDir('git', ['init'], tempRoot);
    runInDir('git', ['config', 'user.email', 'solo@example.com'], tempRoot);
    runInDir('git', ['config', 'user.name', 'Solo'], tempRoot);
    runInDir('git', ['add', '.'], tempRoot);
    runInDir('git', ['commit', '-m', 'init'], tempRoot);

    const result = await buildKnowledgeRisk(tempRoot, [srcFile]);
    assert.strictEqual(result.filesAnalyzed, 0, 'personal repo should disable knowledge risk');
    assert.ok(/too-few-authors/i.test(result.disabledReason), 'disabledReason should mention too-few-authors');
    assert.strictEqual(result.high.length, 0);
    assert.strictEqual(result.medium.length, 0);
    assert.strictEqual(result.low.length, 0);
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testUncommittedLinesNotCountedAsAuthor() {
  const porcelain = [
    '0000000000000000000000000000000000000000 1 1 1',
    'author Not Committed Yet',
    'author-mail <not.committed.yet>',
    '\texport function helper() { return 1; }',
    'abc123def456abc123def456abc123def456abc1 2 2 2',
    'author Real Author',
    'author-mail <real@example.com>',
    '\tconst x = 1;',
  ].join('\n');
  const authors = parseBlamePorcelain(porcelain);
  assert.strictEqual(authors.size, 1, 'uncommitted pseudo-author should be ignored');
  assert(authors.has('real@example.com'), 'only real author should remain');
}

async function main() {
  await testDefaultOverviewSkipsKnowledgeRisk();
  await testExplicitHistoryProviderStillCalled();
  await testWithHistoryFlagTriggersHistoryProvider();
  await testAssembleOverviewDataRespectsWithHistory();
  await testPersonalRepoKnowledgeRiskDisabled();
  await testUncommittedLinesNotCountedAsAuthor();
  console.log('overview-history-optional-test.js: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
