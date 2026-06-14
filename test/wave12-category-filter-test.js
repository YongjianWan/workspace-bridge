// @contract + @semantic — Wave 12-3: --category filtering and finding categories

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runCliInProcessRaw, assertOk, makeTempDir, cleanupTempDir } = require('./test-helpers');
const { checkBoundaries } = require('../src/tools/dep-tools/boundaries');
const { filterByCategory } = require('../src/tools/audit-assembler');

const REPO_ROOT = path.resolve(__dirname, '..');

async function run(args, options = {}) {
  return runCliInProcessRaw([...args, '--json', '--quiet'], { cwd: REPO_ROOT, ...options });
}

async function runInTemp(args, tempDir) {
  return runCliInProcessRaw([...args, '--json', '--quiet'], { cwd: tempDir });
}

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function initGit(root) {
  spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root, encoding: 'utf8' });
}

function createCategoryTestProject() {
  const tempDir = makeTempDir('wb-cat-');
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'cat-test', version: '1.0.0' }, null, 2));

  // Dead export: exported but never imported.
  writeFile(tempDir, 'src/dead.js', 'export function dead() { return 42; }\n');

  // Smell: flat dispatcher with 6 arms.
  writeFile(tempDir, 'src/dispatch.js', `export function dispatch(x) {
  if (x === 1) return 'a';
  else if (x === 2) return 'b';
  else if (x === 3) return 'c';
  else if (x === 4) return 'd';
  else if (x === 5) return 'e';
  else if (x === 6) return 'f';
  return 'g';
}
`);

  // Security findings: eval + hardcoded secret.
  writeFile(tempDir, 'src/secret.js', "eval('1');\nconst password = 'supersecret123';\n");

  initGit(tempDir);
  return tempDir;
}

async function testDeadExportFindingHasCategory() {
  const tempDir = createCategoryTestProject();
  try {
    const result = await runInTemp(['dead-exports'], tempDir);
    assertOk(result, 'dead-exports should succeed');
    const data = JSON.parse(result.stdout);
    assert(data.deadExportsCount > 0, 'should detect dead exports');
    assert.strictEqual(data.deadExports[0].category, 'dead-exports', 'dead-export finding should have category field');
  } finally {
    cleanupTempDir(tempDir);
  }
}

async function testSmellFindingHasCategory() {
  const tempDir = createCategoryTestProject();
  try {
    const result = await runInTemp(['audit-smells'], tempDir);
    assertOk(result, 'audit-smells should succeed');
    const data = JSON.parse(result.stdout);
    assert(data.smellsCount > 0, 'should detect smells');
    assert.strictEqual(data.smells[0].category, 'smells', 'smell finding should have category field');
  } finally {
    cleanupTempDir(tempDir);
  }
}

async function testSecurityFindingHasCategory() {
  const tempDir = createCategoryTestProject();
  try {
    const result = await runInTemp(['audit-security', '--builtin-only'], tempDir);
    assertOk(result, 'audit-security should succeed');
    const data = JSON.parse(result.stdout);
    assert(data.findings.length > 0, 'should detect security findings');
    assert(
      data.findings.every((f) => f.category === 'security'),
      'all security findings should have category field'
    );
  } finally {
    cleanupTempDir(tempDir);
  }
}

function testBoundaryViolationHasCategory() {
  const graph = {
    getAllFilePaths: () => ['/project/src/api/index.js', '/project/src/utils/index.js'],
    getDependencies: (file) => (file === '/project/src/api/index.js' ? ['/project/src/utils/index.js'] : []),
    projectContext: {
      root: '/project',
      classifyFile: (filePath) => ({ isMainline: true }),
      config: {
        boundaries: [{ from: 'src/api/**', deny: ['src/utils/**'] }],
      },
    },
  };
  const container = {
    snapshot: { graph },
    projectContext: graph.projectContext,
    workspaceRoot: '/project',
  };
  const result = checkBoundaries({}, container);
  assert(result.violationsCount > 0, 'should detect boundary violations');
  assert.strictEqual(result.violations[0].category, 'boundaries', 'boundary violation should have category field');
}

async function testAuditSummaryCategoryFilterPreservesSelection() {
  const result = await run(['audit-summary', '--category', 'dead-exports']);
  assertOk(result, 'audit-summary --category dead-exports should succeed');
  const data = JSON.parse(result.stdout);

  assert.strictEqual(data.smells?.smellsCount || 0, 0, 'smells should be filtered out');
  assert.strictEqual(data.boundaries?.violationsCount || 0, 0, 'boundaries should be filtered out');
  assert.strictEqual(data.unresolved?.unresolvedCount || 0, 0, 'unresolved should be filtered out');
  assert.strictEqual(data.cycles?.cyclesCount || 0, 0, 'cycles should be filtered out');

  assert.strictEqual(data.summary?.counts?.deadExports !== undefined, true, 'deadExports count should exist');
  assert.strictEqual(data.summary?.counts?.unresolved === undefined, true, 'unresolved count should be omitted');
  assert.strictEqual(data.summary?.counts?.cycles === undefined, true, 'cycles count should be omitted');
  assert.strictEqual(data.summary?.counts?.health === undefined, true, 'health count should be omitted');

  const nextStepsStr = JSON.stringify(data.summary?.nextSteps || []);
  assert.strictEqual(nextStepsStr.includes('unresolved'), false, 'nextSteps should not contain unresolved recommendation');
  assert.strictEqual(nextStepsStr.includes('circular'), false, 'nextSteps should not contain cycle recommendation');
}

async function testAuditOverviewCategoryFilter() {
  const unfiltered = JSON.parse((await run(['audit-overview'])).stdout);
  const filtered = JSON.parse((await run(['audit-overview', '--category', 'smells'])).stdout);

  assert.strictEqual(filtered.deadExports?.deadExportsCount || 0, 0, 'dead exports should be filtered out');
  assert.strictEqual(filtered.boundaries?.violationsCount || 0, 0, 'boundaries should be filtered out');
  assert.strictEqual(filtered.unresolved?.unresolvedCount || 0, 0, 'unresolved should be filtered out');
  assert.strictEqual(filtered.cycles?.cyclesCount || 0, 0, 'cycles should be filtered out');
  assert.strictEqual(
    filtered.smells?.smellsCount || 0,
    unfiltered.smells?.smellsCount || 0,
    'selected smells category should be preserved'
  );

  assert.strictEqual(filtered.summary?.counts?.smells !== undefined, true, 'smells count should exist');
  assert.strictEqual(filtered.summary?.counts?.deadExports === undefined, true, 'deadExports count should be omitted');
  assert.strictEqual(filtered.summary?.counts?.unresolved === undefined, true, 'unresolved count should be omitted');
  assert.strictEqual(filtered.summary?.counts?.cycles === undefined, true, 'cycles count should be omitted');
  assert.strictEqual(filtered.summary?.counts?.boundaries === undefined, true, 'boundaries count should be omitted');
}

async function testAuditSecurityCategoryFilterExcludes() {
  const tempDir = createCategoryTestProject();
  try {
    const result = await runInTemp(['audit-security', '--builtin-only', '--category', 'dead-exports'], tempDir);
    assertOk(result, 'audit-security --category dead-exports should succeed');
    const data = JSON.parse(result.stdout);
    assert.strictEqual(data.findings.length, 0, 'security findings should be excluded');
    assert.strictEqual(data.summary.total, 0, 'security summary total should be 0');
    assert.strictEqual(data.hasFindings, false, 'hasFindings should be false');
  } finally {
    cleanupTempDir(tempDir);
  }
}

async function testInvalidCategoryValue() {
  const result = await runCliInProcessRaw(['audit-summary', '--category', 'invalid', '--json', '--quiet'], { cwd: REPO_ROOT });
  assert.notStrictEqual(result.status, 0, 'invalid category should exit non-zero');
  assert(result.stderr.includes('Invalid --category value'), `stderr should contain error: ${result.stderr}`);
}

function testFilterByCategoryZerosSections() {
  const result = {
    ok: true,
    deadExports: { ok: true, deadExportsCount: 1, deadExports: [{ file: 'a.js' }] },
    unresolved: { ok: true, unresolvedCount: 2, unresolved: [{ file: 'b.js' }] },
    cycles: { ok: true, cyclesCount: 1, cycles: [['a.js', 'b.js']] },
    boundaries: { ok: true, violationsCount: 1, violations: [{ sourceFile: 'a.js' }] },
    smells: { ok: true, smellsCount: 1, smells: [{ file: 'c.js' }] },
  };
  filterByCategory(result, 'dead-exports', ['deadExports', 'unresolved', 'cycles', 'boundaries', 'smells']);
  assert.strictEqual(result.deadExports.deadExportsCount, 1, 'deadExports should remain');
  assert.strictEqual(result.unresolved.unresolvedCount, 0, 'unresolved should be zeroed');
  assert.strictEqual(result.cycles.cyclesCount, 0, 'cycles should be zeroed');
  assert.strictEqual(result.boundaries.violationsCount, 0, 'boundaries should be zeroed');
  assert.strictEqual(result.smells.smellsCount, 0, 'smells should be zeroed');
}

async function testMultiCategoryFilter() {
  const result = await run(['audit-summary', '--category', 'dead-exports,smells']);
  assertOk(result, 'multi-category filter should succeed');
  const data = JSON.parse(result.stdout);

  assert.strictEqual(data.unresolved?.unresolvedCount || 0, 0, 'unresolved should be filtered out');
  assert.strictEqual(data.cycles?.cyclesCount || 0, 0, 'cycles should be filtered out');
  assert.strictEqual(data.boundaries?.violationsCount || 0, 0, 'boundaries should be filtered out');
}

async function testIncrementalDiffCategoryFilter() {
  const tempDir = createCategoryTestProject();
  try {
    const result = await runInTemp(['audit-diff', '--incremental', '--category', 'unresolved'], tempDir);
    assertOk(result, 'audit-diff --incremental --category unresolved should succeed');
    const data = JSON.parse(result.stdout);

    assert.strictEqual(data.incremental, true, 'incremental flag should be true');
    assert.strictEqual(data.incrementalFindings.unresolvedCount !== undefined, true, 'unresolvedCount should exist');
    assert.strictEqual(data.incrementalFindings.deadExportsCount === undefined, true, 'deadExportsCount should be omitted');
    assert.strictEqual(data.incrementalFindings.cyclesCount === undefined, true, 'cyclesCount should be omitted');
  } finally {
    cleanupTempDir(tempDir);
  }
}

async function main() {
  await testDeadExportFindingHasCategory();
  await testSmellFindingHasCategory();
  await testSecurityFindingHasCategory();
  await testBoundaryViolationHasCategory();
  await testAuditSummaryCategoryFilterPreservesSelection();
  await testAuditOverviewCategoryFilter();
  await testAuditSecurityCategoryFilterExcludes();
  await testInvalidCategoryValue();
  await testFilterByCategoryZerosSections();
  await testMultiCategoryFilter();
  await testIncrementalDiffCategoryFilter();
}

main();
