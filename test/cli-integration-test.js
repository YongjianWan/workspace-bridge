#!/usr/bin/env node
/**
 * CLI integration tests for commands lacking dedicated pipeline coverage.
 * Covers audit-file, dead-exports, tree, impact with real CLI invocations.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { runCli, runCliText, makeTempDir, cleanupTempDir, runInDir } = require('./test-helpers');

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
    assert(typeof result.impact?.impactCount === 'number', 'audit-file should return impact.impactCount');
    assert(result.impact.impactCount >= 1, 'util.js should have at least 1 dependent');
    assert(typeof result.affectedTests?.affectedTestsCount === 'number', 'audit-file should return affectedTests.affectedTestsCount');
    assert(result.affectedTests.affectedTestsCount >= 1, 'util.js should affect at least 1 test');
    assert(Array.isArray(result.impact?.symbolImpact?.impactedFiles), 'impact.symbolImpact.impactedFiles should be an array');
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
    assert(typeof result.deadExportsCount === 'number', 'dead-exports should return deadExportsCount');
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

function main() {
  testAuditFileDeep();
  testDeadExports();
  testTree();
  testImpactDepth();
  console.log('cli-integration-test.js: all passed');
}

main();
