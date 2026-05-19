#!/usr/bin/env node
/**
 * CLI parameter pipeline integration test.
 * Verifies that --format ai, --depth, and --token-budget flow through the
 * entire CLI → container → formatter pipeline and produce correct output shapes.
 *
 * Note: --format ai currently only produces curated JSON for audit-summary;
 * other commands fall back to plain-text summary. We test audit-summary for
 * the full ai-format pipeline, and audit-file/impact/tree for --json fidelity.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCli, runCliText, makeTempDir, cleanupTempDir } = require('./test-helpers');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function testAuditSummaryAiSurface() {
  const tempRoot = makeTempDir('wb-ai-surface-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'ai', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/util.js', 'export function helper() { return 1; }\n');
    writeFile(tempRoot, 'src/app.js', 'import { helper } from "./util";\nexport function run() { return helper(); }\n');

    // formatAi for audit-summary returns JSON string; runCli parses it.
    const result = runCli(['audit-summary', '--cwd', tempRoot, '--format', 'ai', '--depth', 'surface', '--json', '--quiet']);
    assert.strictEqual(result.ok, true);
    assert(typeof result.severity === 'string', 'surface should include severity');
    assert(typeof result.counts === 'object' && result.counts !== null, 'surface should include counts');
    assert(Array.isArray(result.topRisks), 'surface should include topRisks array');
    // Surface should NOT include deeply nested fields like meta/actions/schemaVersion
    assert.strictEqual(result.schemaVersion, undefined, 'surface should not include schemaVersion');
    assert.strictEqual(result.meta, undefined, 'surface should not include meta');
    assert.strictEqual(result.actions, undefined, 'surface should not include actions');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testAuditSummaryAiDetail() {
  const tempRoot = makeTempDir('wb-ai-detail-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'detail', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/util.js', 'export function helper() { return 1; }\n');
    writeFile(tempRoot, 'src/app.js', 'import { helper } from "./util";\nexport function run() { return helper(); }\n');

    const result = runCli(['audit-summary', '--cwd', tempRoot, '--format', 'ai', '--depth', 'detail', '--json', '--quiet']);
    assert.strictEqual(result.ok, true);
    assert(typeof result.severity === 'string');
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

function testAuditSummaryAiTokenBudget() {
  const tempRoot = makeTempDir('wb-ai-budget-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'budget', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/util.js', 'export function helper() { return 1; }\n');
    writeFile(tempRoot, 'src/app.js', 'import { helper } from "./util";\nexport function run() { return helper(); }\n');

    // Use a very low budget (50) to force downgrade on this small fixture project.
    // The detail output for a 3-file project is ~150 tokens, so 50 will trigger
    // surface downgrade; 8000 comfortably retains detail.
    const lowBudget = runCli(['audit-summary', '--cwd', tempRoot, '--format', 'ai', '--token-budget', '50', '--json', '--quiet']);
    assert.strictEqual(lowBudget.ok, true);
    // Low budget should force surface-level output (no schemaVersion/meta/actions)
    assert.strictEqual(lowBudget.schemaVersion, undefined, 'low budget should downgrade to surface');
    assert.strictEqual(lowBudget.meta, undefined, 'low budget should not include meta');
    assert.strictEqual(lowBudget.actions, undefined, 'low budget should not include actions');

    const highBudget = runCli(['audit-summary', '--cwd', tempRoot, '--format', 'ai', '--token-budget', '8000', '--json', '--quiet']);
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

function testAuditFileJsonFidelity() {
  const tempRoot = makeTempDir('wb-json-fid-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'fid', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/util.js', 'export function helper() { return 1; }\n');
    writeFile(tempRoot, 'src/app.js', 'import { helper } from "./util";\nexport function run() { return helper(); }\n');

    const result = runCli(['audit-file', '--cwd', tempRoot, '--file', 'src/util.js', '--json', '--quiet']);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.file, 'src/util.js');
    assert(typeof result.impact?.impactCount === 'number');
    assert(Array.isArray(result.impact?.symbolImpact?.impactedFiles));
    assert(result.validationAdvice, 'audit-file should include validationAdvice');
    assert(Array.isArray(result.validationAdvice.commands), 'validationAdvice.commands should be an array');
    assert(result.validationAdvice.commands.length >= 1, 'validationAdvice should have at least one command');
    assert(typeof result.validationAdvice.suggestedCommand === 'string', 'validationAdvice should include suggestedCommand');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testImpactJsonFidelity() {
  const tempRoot = makeTempDir('wb-impact-fid-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'imp', version: '1.0.0', main: 'src/a.js' }, null, 2));
    writeFile(tempRoot, 'src/a.js', 'import { b } from "./b";\nexport function a() { return b(); }\n');
    writeFile(tempRoot, 'src/b.js', 'export function b() { return 1; }\n');

    const result = runCli(['impact', '--cwd', tempRoot, '--file', 'src/b.js', '--json', '--quiet']);
    assert.strictEqual(result.ok, true);
    assert(typeof result.impactCount === 'number');
    assert(Array.isArray(result.impact));
    assert(result.symbolImpact, 'impact should include symbolImpact');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testTreeJsonFidelity() {
  const tempRoot = makeTempDir('wb-tree-fid-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'tree', version: '1.0.0', main: 'src/a.js' }, null, 2));
    writeFile(tempRoot, 'src/a.js', 'import { c } from "./b/c";\nexport const a = c;\n');
    writeFile(tempRoot, 'src/b/c.js', 'export const c = 1;\n');

    const result = runCli(['tree', '--cwd', tempRoot, '--file', 'src/a.js', '--json', '--quiet']);
    assert.strictEqual(result.ok, true);
    assert(result.tree && typeof result.tree === 'object');
    assert(Array.isArray(result.tree.imports));
    assert(result.tree.imports.some((n) => n.file.endsWith('c.js')));
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function main() {
  testAuditSummaryAiSurface();
  testAuditSummaryAiDetail();
  testAuditSummaryAiTokenBudget();
  testAuditFileJsonFidelity();
  testImpactJsonFidelity();
  testTreeJsonFidelity();
  console.log('cli-pipeline-depth-test.js: all passed');
}

main();
