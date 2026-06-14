#!/usr/bin/env node
/**
 * CLI parameter pipeline integration test.
 * Verifies that --format ai, --depth, and --token-budget flow through the
 * entire CLI → container → formatter pipeline and produce correct output shapes.
 *
 * Note: --format ai produces curated JSON for audit-summary, and a lightweight
 * JSON wrapper for all other commands. We test audit-summary for the full
 * ai-format pipeline (depth/token-budget), and audit-file/impact/tree/dead-exports
 * for --format ai JSON fidelity.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcess, makeTempDir, cleanupTempDir } = require('./test-helpers');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

async function testAuditSummaryAiSurface() {
  const tempRoot = makeTempDir('wb-ai-surface-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'ai', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/util.js', 'export function helper() { return 1; }\n');
    writeFile(tempRoot, 'src/app.js', 'import { helper } from "./util";\nexport function run() { return helper(); }\n');

    // formatAi for audit-summary returns JSON string; runCli parses it.
    const result = await runCliInProcess(['audit-summary', '--cwd', tempRoot, '--format', 'ai', '--depth', 'surface', '--json', '--quiet']);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.severity, 'medium', 'surface severity should be medium');
    assert.strictEqual(result.counts.deadExports, 0, 'deadExports should be 0');
    assert.strictEqual(result.counts.unresolved, 0, 'unresolved should be 0');
    assert.strictEqual(result.counts.cycles, 0, 'cycles should be 0');
    assert.ok(Array.isArray(result.topRisks), 'surface should include topRisks array');
    for (const risk of result.topRisks) {
      assert.ok(typeof risk.category === 'string' && risk.category.length > 0, 'risk category should be non-empty');
      assert.ok(['low', 'medium', 'high'].includes(risk.severity), 'risk severity should be valid enum');
    }
    // Surface should NOT include deeply nested fields like meta/actions/schemaVersion
    assert.strictEqual(result.schemaVersion, undefined, 'surface should not include schemaVersion');
    assert.strictEqual(result.meta, undefined, 'surface should not include meta');
    assert.strictEqual(result.actions, undefined, 'surface should not include actions');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testAuditSummaryAiDetail() {
  const tempRoot = makeTempDir('wb-ai-detail-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'detail', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/util.js', 'export function helper() { return 1; }\n');
    writeFile(tempRoot, 'src/app.js', 'import { helper } from "./util";\nexport function run() { return helper(); }\n');

    const result = await runCliInProcess(['audit-summary', '--cwd', tempRoot, '--format', 'ai', '--depth', 'detail', '--json', '--quiet']);
    assert.strictEqual(result.ok, true);
    assert(['low', 'medium', 'high'].includes(result.severity), 'severity should be a valid level');
    assert(typeof result.counts === 'object' && result.counts !== null);
    // Detail SHOULD include schemaVersion + meta + actions
    assert.strictEqual(typeof result.schemaVersion, 'string', 'detail should include schemaVersion');
    assert(result.meta, 'detail should include meta');
    assert(result.actions, 'detail should include actions');
    assert(Array.isArray(result.topRisks));
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testAuditSummaryAiTokenBudget() {
  const tempRoot = makeTempDir('wb-ai-budget-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'budget', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/util.js', 'export function helper() { return 1; }\n');
    writeFile(tempRoot, 'src/app.js', 'import { helper } from "./util";\nexport function run() { return helper(); }\n');

    // Use a very low budget (50) to force downgrade on this small fixture project.
    // The detail output for a 3-file project is ~150 tokens, so 50 will trigger
    // surface downgrade; 8000 comfortably retains detail.
    const lowBudget = await runCliInProcess(['audit-summary', '--cwd', tempRoot, '--format', 'ai', '--token-budget', '50', '--json', '--quiet']);
    assert.strictEqual(lowBudget.ok, true);
    // Low budget should force surface-level output (no schemaVersion/meta/actions)
    assert.strictEqual(lowBudget.schemaVersion, undefined, 'low budget should downgrade to surface');
    assert.strictEqual(lowBudget.meta, undefined, 'low budget should not include meta');
    assert.strictEqual(lowBudget.actions, undefined, 'low budget should not include actions');

    const highBudget = await runCliInProcess(['audit-summary', '--cwd', tempRoot, '--format', 'ai', '--token-budget', '8000', '--json', '--quiet']);
    assert.strictEqual(highBudget.ok, true);
    // High budget should retain detail-level output (includes schemaVersion/meta/actions)
    assert.strictEqual(typeof highBudget.schemaVersion, 'string', 'high budget should retain detail');
    assert(highBudget.meta, 'high budget should include meta');
    assert(highBudget.actions, 'high budget should include actions');

    // Low budget output should be more compact than high budget
    const lowStr = JSON.stringify(lowBudget);
    const highStr = JSON.stringify(highBudget);
    assert(lowStr.length < highStr.length, 'low budget output should be more compact than high budget');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testAuditFileJsonFidelity() {
  const tempRoot = makeTempDir('wb-json-fid-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'fid', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/util.js', 'export function helper() { return 1; }\n');
    writeFile(tempRoot, 'src/app.js', 'import { helper } from "./util";\nexport function run() { return helper(); }\n');

    const result = await runCliInProcess(['audit-file', '--cwd', tempRoot, '--file', 'src/util.js', '--json', '--quiet']);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.file, 'src/util.js');
    assert.strictEqual(result.impact.impactCount, 1, 'impactCount should be 1');
    assert.strictEqual(result.impact.symbolImpact.impactedFiles.length, 1, 'impactedFiles length should be 1');
    assert.ok(result.impact.symbolImpact.impactedFiles[0].file.endsWith('src/app.js') || result.impact.symbolImpact.impactedFiles[0].file.endsWith('src\\app.js'), 'dependent should be app.js');
    assert(result.validationAdvice, 'audit-file should include validationAdvice');
    assert.strictEqual(typeof result.validationAdvice.commands, 'object', 'validationAdvice.commands should be grouped object');
    assert(Array.isArray(result.validationAdvice.commands.smoke), 'commands.smoke should be array');
    assert(Array.isArray(result.validationAdvice.commands.focused), 'commands.focused should be array');
    assert(Array.isArray(result.validationAdvice.commands.full), 'commands.full should be array');
    assert.strictEqual(result.validationAdvice.suggestedCommand, 'git diff --check', 'validationAdvice suggestedCommand should be git diff --check');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testImpactJsonFidelity() {
  const tempRoot = makeTempDir('wb-impact-fid-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'imp', version: '1.0.0', main: 'src/a.js' }, null, 2));
    writeFile(tempRoot, 'src/a.js', 'import { b } from "./b";\nexport function a() { return b(); }\n');
    writeFile(tempRoot, 'src/b.js', 'export function b() { return 1; }\n');

    const result = await runCliInProcess(['impact', '--cwd', tempRoot, '--file', 'src/b.js', '--json', '--quiet']);
    assert.strictEqual(result.ok, true);
    assert(Number.isFinite(result.impactCount) && result.impactCount >= 0, 'impactCount should be a non-negative finite number');
    assert(Array.isArray(result.impact));
    assert(result.symbolImpact, 'impact should include symbolImpact');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testTreeJsonFidelity() {
  const tempRoot = makeTempDir('wb-tree-fid-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'tree', version: '1.0.0', main: 'src/a.js' }, null, 2));
    writeFile(tempRoot, 'src/a.js', 'import { c } from "./b/c";\nexport const a = c;\n');
    writeFile(tempRoot, 'src/b/c.js', 'export const c = 1;\n');

    const result = await runCliInProcess(['tree', '--cwd', tempRoot, '--file', 'src/a.js', '--json', '--quiet']);
    assert.strictEqual(result.ok, true);
    assert(result.tree && typeof result.tree === 'object');
    assert(Array.isArray(result.tree.imports));
    assert(result.tree.imports.some((n) => n.file.endsWith('c.js')));
  } finally {
    cleanupTempDir(tempRoot);
  }
}

// --format ai JSON fidelity for non-audit-summary commands
async function testImpactAiFormat() {
  const tempRoot = makeTempDir('wb-impact-ai-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'imp', version: '1.0.0', main: 'src/a.js' }, null, 2));
    writeFile(tempRoot, 'src/a.js', 'import { b } from "./b";\nexport function a() { return b(); }\n');
    writeFile(tempRoot, 'src/b.js', 'export function b() { return 1; }\n');

    const result = await runCliInProcess(['impact', '--cwd', tempRoot, '--file', 'src/b.js', '--format', 'ai']);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.command, 'impact');
    assert.strictEqual(typeof result.schemaVersion, 'string');
    assert(typeof result.severity === 'string');
    assert(typeof result.summary === 'string');
    // Passing --depth/--token-budget on non-audit-summary should not crash
    const withOpts = await runCliInProcess(['impact', '--cwd', tempRoot, '--file', 'src/b.js', '--format', 'ai', '--depth', 'surface', '--token-budget', '50']);
    assert.strictEqual(withOpts.ok, true);
    assert.strictEqual(withOpts.command, 'impact');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testTreeAiFormat() {
  const tempRoot = makeTempDir('wb-tree-ai-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'tree', version: '1.0.0', main: 'src/a.js' }, null, 2));
    writeFile(tempRoot, 'src/a.js', 'import { c } from "./b/c";\nexport const a = c;\n');
    writeFile(tempRoot, 'src/b/c.js', 'export const c = 1;\n');

    const result = await runCliInProcess(['tree', '--cwd', tempRoot, '--file', 'src/a.js', '--format', 'ai']);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.command, 'tree');
    assert.strictEqual(typeof result.schemaVersion, 'string');
    assert(typeof result.summary === 'string');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testAuditFileAiFormat() {
  const tempRoot = makeTempDir('wb-afile-ai-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'fid', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/util.js', 'export function helper() { return 1; }\n');
    writeFile(tempRoot, 'src/app.js', 'import { helper } from "./util";\nexport function run() { return helper(); }\n');

    const result = await runCliInProcess(['audit-file', '--cwd', tempRoot, '--file', 'src/util.js', '--format', 'ai']);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.command, 'audit-file');
    assert.strictEqual(typeof result.schemaVersion, 'string');
    assert(typeof result.summary === 'string');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testDeadExportsAiFormat() {
  const tempRoot = makeTempDir('wb-dead-ai-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'dead', version: '1.0.0', main: 'src/a.js' }, null, 2));
    writeFile(tempRoot, 'src/a.js', 'export function unused() { return 1; }\n');
    writeFile(tempRoot, 'src/b.js', 'export function used() { return 2; }\n');

    const result = await runCliInProcess(['dead-exports', '--cwd', tempRoot, '--format', 'ai']);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.command, 'dead-exports');
    assert.strictEqual(typeof result.schemaVersion, 'string');
    assert(typeof result.summary === 'string');
    // dead-exports for a 2-file project with 1 unused export should report it
    assert(result.summary.includes('unused') || result.summary.includes('1') || result.summary.includes('export'));
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function main() {
  await testAuditSummaryAiSurface();
  await testAuditSummaryAiDetail();
  await testAuditSummaryAiTokenBudget();
  await testAuditFileJsonFidelity();
  await testImpactJsonFidelity();
  await testTreeJsonFidelity();
  await testImpactAiFormat();
  await testTreeAiFormat();
  await testAuditFileAiFormat();
  await testDeadExportsAiFormat();
  console.log('cli-pipeline-depth-test.js: all passed');
}

main();
