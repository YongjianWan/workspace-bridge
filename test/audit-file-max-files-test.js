// @contract
// Verifies that audit-file honors --max-files for impact and affected-tests.
const assert = require('assert');
const path = require('path');
const { assembleFile } = require('../src/tools/audit-assembler');
const { DEFAULTS } = require('../src/config/constants');

const TEST_FILE = 'src/tools/audit-assembler.js';

function makeMockContainer(workspaceRoot, size = 3) {
  const names = (prefix) => Array.from({ length: size }, (_, i) => path.join(workspaceRoot, `${prefix}${i + 1}.js`));
  return {
    workspaceRoot,
    ensureReady: async () => {},
    snapshot: {
      graph: {
        hasFile: () => true,
        getImpactRadius: () => names('a').map((file) => ({ file, level: 1 })),
        getSymbolImpact: () => ({ mode: 'file-fallback', impactedFiles: [] }),
        findAffectedHttpRoutes: () => [],
        findAffectedTests: () => names('t').map((file) => ({ file, distance: 1 })),
        _displayPath: (p) => p,
        getFrameworkHint: () => null,
      },
    },
    cache: { coChanges: null },
    gitEnvironment: { dataQuality: 'certain' },
  };
}

async function testAuditFileMaxFiles() {
  const workspaceRoot = process.cwd();
  const container = makeMockContainer(workspaceRoot);
  const result = await assembleFile({ file: TEST_FILE, cwd: workspaceRoot, maxFiles: 2 }, container);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.impact.impact.length, 2, 'impact should be capped by --max-files');
  assert.strictEqual(result.impact.truncated, true, 'impact should report truncated');
  assert.strictEqual(result.affectedTests.affectedTests.length, 2, 'affectedTests should be capped by --max-files');
  assert.strictEqual(result.affectedTests.truncated, true, 'affectedTests should report truncated');
}

async function testAuditFileNoMaxFiles() {
  const workspaceRoot = process.cwd();
  const container = makeMockContainer(workspaceRoot);
  const result = await assembleFile({ file: TEST_FILE, cwd: workspaceRoot }, container);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.impact.impact.length, 3, 'impact should not be truncated without --max-files');
  assert.strictEqual(result.affectedTests.affectedTests.length, 3, 'affectedTests should not be truncated without --max-files');
}

async function testAuditFileCompact() {
  const workspaceRoot = process.cwd();
  const container = makeMockContainer(workspaceRoot, 12);
  const result = await assembleFile({ file: TEST_FILE, cwd: workspaceRoot, compact: true }, container);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.compact, true, 'compact flag should be set');
  // A list that is empty next to a non-zero count reads as "no impact": compact keeps the head.
  assert.strictEqual(result.impact.impact.length, DEFAULTS.COMPACT_IMPACT_MAX, 'compact keeps the first entries of impact');
  assert.strictEqual(result.affectedTests.affectedTests.length, DEFAULTS.COMPACT_AFFECTED_TESTS_MAX, 'compact keeps the first entries of affectedTests');
  assert.strictEqual(result.impact.impact[0].file, path.join(workspaceRoot, 'a1.js'), 'the kept entries are the head of the ordered list');
  assert.strictEqual(result.impact.impactCount, 12, 'impactCount should remain total');
  assert.strictEqual(result.affectedTests.affectedTestsCount, 12, 'affectedTestsCount should remain total');
  assert.strictEqual(result.truncated, true);
  const cut = result.elided.find((e) => e.path === 'affectedTests.affectedTests');
  assert.deepStrictEqual(cut, { path: 'affectedTests.affectedTests', kind: 'array', shown: DEFAULTS.COMPACT_AFFECTED_TESTS_MAX, total: 12, reason: 'compact' });
  assert.ok(result.validationAdvice.suggestedCommand || result.validationAdvice.suggestedCommand === null, 'suggestedCommand field should exist');
}

async function testAuditFileCompactHonorsMaxFiles() {
  const workspaceRoot = process.cwd();
  const container = makeMockContainer(workspaceRoot, 12);
  const result = await assembleFile({ file: TEST_FILE, cwd: workspaceRoot, compact: true, maxFiles: 8 }, container);
  assert.strictEqual(result.impact.impact.length, 8, '--max-files is the caller budget in compact mode too');
  assert.strictEqual(result.affectedTests.affectedTests.length, 8);
}

async function testAuditFileCompactSmallListUntouched() {
  const workspaceRoot = process.cwd();
  const container = makeMockContainer(workspaceRoot, 3);
  const result = await assembleFile({ file: TEST_FILE, cwd: workspaceRoot, compact: true }, container);
  assert.strictEqual(result.impact.impact.length, 3);
  assert.ok(!result.elided, 'nothing cut, nothing listed');
}

async function main() {
  await testAuditFileMaxFiles();
  await testAuditFileNoMaxFiles();
  await testAuditFileCompact();
  await testAuditFileCompactHonorsMaxFiles();
  await testAuditFileCompactSmallListUntouched();
  console.log('audit-file-max-files-test: all passed');
}

main();
