#!/usr/bin/env node
/**
 * CLI integration tests for commands lacking dedicated pipeline coverage.
 * Covers audit-file, dead-exports, tree, impact with real CLI invocations.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { runCli, runCliRaw, runCliText, makeTempDir, cleanupTempDir, runInDir } = require('./test-helpers');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function initGit(root) {
  runInDir('git', ['init'], root);
  runInDir('git', ['config', 'user.email', 'test@example.com'], root);
  runInDir('git', ['config', 'user.name', 'Test User'], root);
  runInDir('git', ['add', '.'], root);
  runInDir('git', ['commit', '-m', 'init'], root);
}

function testAuditFileDeep() {
  const tempRoot = makeTempDir('wb-cli-audit-file-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'af-test', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/util.js', 'export function helper() { return 1; }\n');
    writeFile(tempRoot, 'src/app.js', 'import { helper } from "./util";\nexport function run() { return helper(); }\n');
    writeFile(tempRoot, 'test/app.test.js', 'import { run } from "../src/app";\nexport function t() { return run(); }\n');
    initGit(tempRoot);

    const result = runCli(['audit-file', '--cwd', tempRoot, '--file', 'src/util.js', '--json', '--quiet']);
    assert(Number.isFinite(result.impact?.impactCount), 'audit-file should return impact.impactCount');
    assert(result.impact.impactCount >= 1, 'util.js should have at least 1 dependent');
    assert(Number.isFinite(result.affectedTests?.affectedTestsCount), 'audit-file should return affectedTests.affectedTestsCount');
    assert(result.affectedTests.affectedTestsCount >= 1, 'util.js should affect at least 1 test');
    assert(Array.isArray(result.impact?.symbolImpact?.impactedFiles), 'impact.symbolImpact.impactedFiles should be an array');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testAuditFileCustomRunnerValidationAdvice() {
  const tempRoot = makeTempDir('wb-cli-custom-runner-');
  try {
    // No jest/vitest/mocha config => detectStack returns 'custom' testRunner
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'cr-test', version: '1.0.0', main: 'src/app.js', scripts: { test: 'node test/runner.js' } }, null, 2));
    writeFile(tempRoot, 'src/app.js', 'export function run() { return 1; }\n');
    writeFile(tempRoot, 'test/app.test.js', 'import { run } from "../src/app";\nexport function t() { return run(); }\n');
    initGit(tempRoot);

    const result = runCli(['audit-file', '--cwd', tempRoot, '--file', 'src/app.js', '--json', '--quiet']);
    const advice = result.validationAdvice;
    assert(advice, 'audit-file should return validationAdvice');
    assert.strictEqual(advice.stackProfile, 'node-first', 'should detect node-first stack');
    // Custom runner must NOT produce meaningless 'npx custom <files>'
    const focused = advice.commands?.find((c) => c.name === 'node-focused-tests');
    assert(!focused, 'custom runner should not generate node-focused-tests');
    // Full test command should be present and executable
    const full = advice.commands?.find((c) => c.name === 'node-all-tests');
    assert(full, 'custom runner should generate node-all-tests');
    assert(full.cmd.includes('test'), 'full test command should reference test');
    // suggestedCommand should fall back to full suite, not 'npx custom ...'
    assert(advice.suggestedCommand, 'suggestedCommand should not be null');
    assert(!advice.suggestedCommand.includes('custom'), 'suggestedCommand must not include meaningless "custom"');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testDeadExports() {
  const tempRoot = makeTempDir('wb-cli-dead-exports-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'de-test', version: '1.0.0', main: 'src/index.js' }, null, 2));
    writeFile(tempRoot, 'src/lib.js', 'export function used() { return 1; }\nexport function unused() { return 2; }\n');
    writeFile(tempRoot, 'src/index.js', 'import { used } from "./lib";\nconsole.log(used());\n');
    initGit(tempRoot);

    const result = runCli(['dead-exports', '--cwd', tempRoot, '--json', '--quiet']);
    assert(Number.isFinite(result.deadExportsCount), 'dead-exports should return deadExportsCount');
    assert(result.deadExportsCount >= 1, 'should find at least 1 dead export');
    const found = result.deadExports?.find((d) => path.basename(d.file) === 'lib.js');
    assert(found, 'src/lib.js should appear in dead exports');
    assert(found.exports.includes('unused'), 'unused export should be flagged');
    assert(found.confidence === 'medium' || found.confidence === 'high', 'confidence should be medium or high');
    assert(found.confidenceSource, 'confidenceSource should be present');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testTree() {
  const tempRoot = makeTempDir('wb-cli-tree-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'tree-test', version: '1.0.0', main: 'src/a.js' }, null, 2));
    writeFile(tempRoot, 'src/a.js', 'import { c } from "./b/c";\nexport const a = c;\n');
    writeFile(tempRoot, 'src/b/c.js', 'export const c = 1;\n');
    initGit(tempRoot);

    const result = runCli(['tree', '--cwd', tempRoot, '--file', 'src/a.js', '--json', '--quiet']);
    assert(result.tree && typeof result.tree === 'object', 'tree should return a tree object');
    assert(Array.isArray(result.tree.imports), 'tree.imports should be an array');
    assert(result.tree.imports.length >= 1, 'tree should have at least one import');
    assert(result.tree.imports.some((n) => n.file.endsWith('c.js')), 'tree should include c.js import');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testImpactDepth() {
  const tempRoot = makeTempDir('wb-cli-impact-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'impact-test', version: '1.0.0', main: 'src/a.js' }, null, 2));
    writeFile(tempRoot, 'src/a.js', 'import { b } from "./b";\nexport function a() { return b(); }\n');
    writeFile(tempRoot, 'src/b.js', 'import { c } from "./c";\nexport function b() { return c(); }\n');
    writeFile(tempRoot, 'src/c.js', 'import { d } from "./d";\nexport function c() { return d(); }\n');
    writeFile(tempRoot, 'src/d.js', 'export function d() { return 1; }\n');
    initGit(tempRoot);

    const d1 = runCli(['impact', '--cwd', tempRoot, '--file', 'src/d.js', '--max-depth', '1', '--json', '--quiet']);
    assert.strictEqual(d1.impactCount, 1, 'depth 1 should show only direct dependent (c)');

    const d2 = runCli(['impact', '--cwd', tempRoot, '--file', 'src/d.js', '--max-depth', '2', '--json', '--quiet']);
    assert.strictEqual(d2.impactCount, 2, 'depth 2 should show c and b');

    const d3 = runCli(['impact', '--cwd', tempRoot, '--file', 'src/d.js', '--max-depth', '3', '--json', '--quiet']);
    assert.strictEqual(d3.impactCount, 3, 'depth 3 should show c, b, and a');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testAffectedTests() {
  const tempRoot = makeTempDir('wb-cli-affected-tests-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'at-test', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/util.js', 'export function helper() { return 1; }\n');
    writeFile(tempRoot, 'src/app.js', 'import { helper } from "./util";\nexport function run() { return helper(); }\n');
    writeFile(tempRoot, 'test/app.test.js', 'import { run } from "../src/app";\nexport function t() { return run(); }\n');
    initGit(tempRoot);

    const result = runCli(['affected-tests', '--cwd', tempRoot, '--file', 'src/util.js', '--json', '--quiet']);
    assert(Number.isFinite(result.affectedTestsCount), 'affected-tests should return affectedTestsCount');
    assert(result.affectedTestsCount >= 1, 'src/util.js should affect at least 1 test');
    assert(
      result.affectedTests.some((t) => path.basename(t.file) === 'app.test.js'),
      'affected-tests should include test/app.test.js'
    );
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testDependencies() {
  const tempRoot = makeTempDir('wb-cli-dependencies-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'dep-test', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/lib.js', 'export const x = 1;\n');
    writeFile(tempRoot, 'src/app.js', 'import { x } from "./lib";\nexport const y = x;\n');
    initGit(tempRoot);

    const result = runCli(['dependencies', '--cwd', tempRoot, '--file', 'src/app.js', '--json', '--quiet']);
    assert(Array.isArray(result.dependencies), 'dependencies should return an array');
    assert(result.dependencies.length >= 1, 'src/app.js should have at least 1 dependency');
    assert(
      result.dependencies.some((d) => path.basename(d.file || d) === 'lib.js'),
      'dependencies should include src/lib.js'
    );
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testDependents() {
  const tempRoot = makeTempDir('wb-cli-dependents-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'dent-test', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/lib.js', 'export const x = 1;\n');
    writeFile(tempRoot, 'src/app.js', 'import { x } from "./lib";\nexport const y = x;\n');
    initGit(tempRoot);

    const result = runCli(['dependents', '--cwd', tempRoot, '--file', 'src/lib.js', '--json', '--quiet']);
    assert(Array.isArray(result.dependents), 'dependents should return an array');
    assert(result.dependents.length >= 1, 'src/lib.js should have at least 1 dependent');
    assert(
      result.dependents.some((d) => path.basename(d.file || d) === 'app.js'),
      'dependents should include src/app.js'
    );
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testPathSanitization() {
  const tempRoot = makeTempDir('wb-cli-path-sanitization-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'ps-test', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/app.js', 'export function run() { return 1; }\n');
    initGit(tempRoot);

    // --file with path traversal should be rejected
    const badFile = runCliRaw(['impact', '--cwd', tempRoot, '--file', '../escape.js', '--json', '--quiet']);
    assert.strictEqual(badFile.status, 1, 'path traversal in --file should exit 1');
    assert(badFile.stdout.includes('path traversal') || badFile.stderr.includes('path traversal') || badFile.stdout.includes('path_error') || badFile.stderr.includes('path_error'), 'should mention path traversal or path_error');

    // --files with path traversal should be rejected
    const badFiles = runCliRaw(['audit-security', '--cwd', tempRoot, '--files', 'src/app.js,../evil.js', '--json', '--quiet']);
    assert.strictEqual(badFiles.status, 1, 'path traversal in --files should exit 1');

    // Normal relative path should succeed
    const good = runCli(['impact', '--cwd', tempRoot, '--file', 'src/app.js', '--json', '--quiet']);
    assert.strictEqual(good.ok, true, 'normal --file should succeed');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testCycles() {
  const tempRoot = makeTempDir('wb-cli-cycles-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'cycle-test', version: '1.0.0', main: 'src/a.js' }, null, 2));
    writeFile(tempRoot, 'src/a.js', 'import { b } from "./b";\nexport function a() { return b(); }\n');
    writeFile(tempRoot, 'src/b.js', 'import { c } from "./c";\nexport function b() { return c(); }\n');
    writeFile(tempRoot, 'src/c.js', 'import { a } from "./a";\nexport function c() { return a(); }\n');
    initGit(tempRoot);

    const result = runCli(['cycles', '--cwd', tempRoot, '--json', '--quiet']);
    assert(Number.isFinite(result.cyclesCount), 'cycles should return cyclesCount');
    assert(result.cyclesCount >= 1, 'should detect at least 1 cycle in a→b→c→a');
    assert(Array.isArray(result.cycles), 'cycles should return an array of cycles');
    const cycleFiles = result.cycles.flat();
    assert(
      cycleFiles.some((f) => path.basename(f) === 'a.js'),
      'cycle should include src/a.js'
    );
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function main() {
  testAuditFileDeep();
  testAuditFileCustomRunnerValidationAdvice();
  testDeadExports();
  testTree();
  testImpactDepth();
  testAffectedTests();
  testDependencies();
  testDependents();
  testCycles();
  testPathSanitization();
  console.log('cli-integration-test.js: all passed');
}

main();
