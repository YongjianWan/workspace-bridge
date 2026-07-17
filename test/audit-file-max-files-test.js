// @contract
// Verifies that audit-file honors --max-files for impact and affected-tests.
const assert = require('assert');
const path = require('path');
const { assembleFile } = require('../src/tools/audit-assembler');

const TEST_FILE = 'src/tools/audit-assembler.js';

function makeMockContainer(workspaceRoot) {
  return {
    workspaceRoot,
    ensureReady: async () => {},
    snapshot: {
      graph: {
        getImpactRadius: () => [
          { file: path.join(workspaceRoot, 'a.js'), level: 1 },
          { file: path.join(workspaceRoot, 'b.js'), level: 1 },
          { file: path.join(workspaceRoot, 'c.js'), level: 1 },
        ],
        getSymbolImpact: () => ({ mode: 'file-fallback', impactedFiles: [] }),
        findAffectedHttpRoutes: () => [],
        findAffectedTests: () => [
          { file: path.join(workspaceRoot, 't1.js'), distance: 1 },
          { file: path.join(workspaceRoot, 't2.js'), distance: 1 },
          { file: path.join(workspaceRoot, 't3.js'), distance: 1 },
        ],
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
  const container = makeMockContainer(workspaceRoot);
  const result = await assembleFile({ file: TEST_FILE, cwd: workspaceRoot, compact: true }, container);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.compact, true, 'compact flag should be set');
  assert.deepStrictEqual(result.impact.impact, [], 'impact list should be empty in compact mode');
  assert.deepStrictEqual(result.impact.coChanges, [], 'coChanges should be empty in compact mode');
  assert.deepStrictEqual(result.impact.affectedRoutes, [], 'affectedRoutes should be empty in compact mode');
  assert.deepStrictEqual(result.affectedTests.affectedTests, [], 'affectedTests list should be empty in compact mode');
  assert.deepStrictEqual(result.validationAdvice.commands, { smoke: [], focused: [], full: [] }, 'command lists should be empty in compact mode');
  assert.deepStrictEqual(result.validationAdvice.phases, [], 'phases should be empty in compact mode');
  assert.deepStrictEqual(result.validationAdvice.fileSpecificAdvice, [], 'fileSpecificAdvice should be empty in compact mode');
  assert.deepStrictEqual(result.validationAdvice.environmentNotes, [], 'environmentNotes should be empty in compact mode');
  // Counts and suggested command must survive compact mode.
  assert.strictEqual(result.impact.impactCount, 3, 'impactCount should remain total');
  assert.strictEqual(result.affectedTests.affectedTestsCount, 3, 'affectedTestsCount should remain total');
  assert.ok(result.validationAdvice.suggestedCommand || result.validationAdvice.suggestedCommand === null, 'suggestedCommand field should exist');
}

async function main() {
  await testAuditFileMaxFiles();
  await testAuditFileNoMaxFiles();
  await testAuditFileCompact();
  console.log('audit-file-max-files-test: all passed');
}

main();
