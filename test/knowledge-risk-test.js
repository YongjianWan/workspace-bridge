// @semantic — knowledge risk integration + assembler wiring tests
// @slow
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { buildKnowledgeRisk, assembleOverviewData } = require('../src/tools/overview-assembler');
const { getFileKnowledgeRisk, getRepoEffectiveAuthorCount } = require('../src/tools/git-tools');
const { createMockDepGraph, makeTempDir, cleanupTempDir } = require('./test-helpers');

const REPO_ROOT = path.resolve(__dirname, '..');

function initTempGitRepo(dir, authorName = 'Real Author', authorEmail = 'real@example.com') {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name ' + JSON.stringify(authorName), { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email ' + JSON.stringify(authorEmail), { cwd: dir, stdio: 'ignore' });
}

function commitFile(dir, fileName, content, message = 'initial') {
  fs.writeFileSync(path.join(dir, fileName), content, 'utf8');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m ' + JSON.stringify(message), { cwd: dir, stdio: 'ignore' });
}

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

async function testGetRepoEffectiveAuthorCount() {
  const tempDir = makeTempDir('wb-kr-repo-');
  try {
    initTempGitRepo(tempDir);
    commitFile(tempDir, 'a.js', '// a\n');
    const result = await getRepoEffectiveAuthorCount(tempDir);
    assert.strictEqual(result.ok, true, 'should succeed for valid repo');
    assert.strictEqual(result.count, 1, 'single-author repo should count as 1');
  } finally {
    cleanupTempDir(tempDir);
  }
}

async function testGetFileKnowledgeRiskIgnoresUncommittedAuthor() {
  const tempDir = makeTempDir('wb-kr-uncommitted-');
  try {
    initTempGitRepo(tempDir);
    commitFile(tempDir, 'a.js', '// committed line 1\n// committed line 2\n');
    // Add uncommitted lines so blame reports "Not Committed Yet" for them
    fs.writeFileSync(path.join(tempDir, 'a.js'), '// committed line 1\n// committed line 2\n// uncommitted line 3\n', 'utf8');

    const result = await getFileKnowledgeRisk(tempDir, 'a.js');
    assert.strictEqual(result.ok, true, 'should succeed');
    assert.strictEqual(result.authorCount, 1, 'uncommitted lines should not count as an author');
    assert(!result.authors.some((a) => /not committed yet/i.test(a.name || '') || /not\.committed\.yet/i.test(a.email || '')),
      'should not include Not Committed Yet as an author');
    assert.strictEqual(result.riskLevel, 'high', 'single real author should still be high risk');
  } finally {
    cleanupTempDir(tempDir);
  }
}

async function testBuildKnowledgeRiskDisabledForPersonalRepo() {
  const tempDir = makeTempDir('wb-kr-personal-');
  try {
    initTempGitRepo(tempDir);
    commitFile(tempDir, 'a.js', '// a\n');
    commitFile(tempDir, 'b.js', '// b\n', 'second commit');

    const result = await buildKnowledgeRisk(tempDir, ['a.js', 'b.js']);
    assert.strictEqual(result.disabled, true, 'personal repo should disable knowledge risk');
    assert(result.disabledReason, 'should provide disabledReason');
    assert.strictEqual(result.disabledReason, 'too-few-authors', 'disabledReason should be too-few-authors for personal repo');
    assert.strictEqual(result.filesAnalyzed, 0, 'should not analyze files when disabled');
    assert.strictEqual(result.high.length, 0, 'high should be empty when disabled');
    assert.strictEqual(result.medium.length, 0, 'medium should be empty when disabled');
    assert.strictEqual(result.low.length, 0, 'low should be empty when disabled');
  } finally {
    cleanupTempDir(tempDir);
  }
}

async function main() {
  await testBuildKnowledgeRiskStructure();
  await testBuildKnowledgeRiskSingleAuthor();
  await testAssembleOverviewDataIncludesKnowledgeRisk();
  await testGetRepoEffectiveAuthorCount();
  await testGetFileKnowledgeRiskIgnoresUncommittedAuthor();
  await testBuildKnowledgeRiskDisabledForPersonalRepo();
}

main();
