#!/usr/bin/env node
/**
 * Core integration regression:
 * - path normalization consistency (relative/absolute/backslash)
 * - non-ASCII path handling
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { runCli, makeTempDir, cleanupTempDir } = require('./test-helpers');

function toPosix(input) {
  return String(input || '').replace(/\\/g, '/');
}

function testPathVariants() {
  const tempRoot = makeTempDir('wb-core-path-');
  const write = (rel, content) => {
    const full = path.join(tempRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  try {
    write('package.json', JSON.stringify({
      name: 'core-path-test',
      version: '1.0.0',
      main: 'src/app.js',
    }, null, 2));
    write('src/util.js', 'export function helper() { return 1; }\n');
    write('src/app.js', 'import { helper } from "./util";\nexport function run() { return helper(); }\n');
    write('test/app.test.js', 'import { run } from "../src/app";\nexport function t() { return run(); }\n');

    const rel = 'src/util.js';
    const abs = path.join(tempRoot, rel);
    const variants = [rel, abs];
    if (process.platform === 'win32') {
      variants.push(rel.replace(/\//g, '\\'));
      if (/^[a-z]:/.test(abs)) {
        variants.push(`${abs[0].toUpperCase()}${abs.slice(1)}`);
      }
    }

    const impactResults = variants.map((file) =>
      runCli(['impact', '--cwd', tempRoot, '--file', file, '--json', '--quiet'], { cwd: tempRoot })
    );
    const affectedResults = variants.map((file) =>
      runCli(['affected-tests', '--cwd', tempRoot, '--file', file, '--json', '--quiet'], { cwd: tempRoot })
    );

    const baseImpact = impactResults[0];
    const baseAffected = affectedResults[0];
    for (const item of impactResults.slice(1)) {
      assert.strictEqual(item.impactCount, baseImpact.impactCount, 'impactCount should be stable across path variants');
      assert.strictEqual(toPosix(item.resolvedPath), toPosix(baseImpact.resolvedPath), 'resolvedPath should be stable');
    }
    for (const item of affectedResults.slice(1)) {
      assert.strictEqual(item.affectedTestsCount, baseAffected.affectedTestsCount, 'affectedTestsCount should be stable');
      assert.strictEqual(toPosix(item.resolvedPath), toPosix(baseAffected.resolvedPath), 'resolvedPath should be stable');
    }
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testNonAsciiPath() {
  const tempRoot = makeTempDir('wb-core-cn-');
  const write = (rel, content) => {
    const full = path.join(tempRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  try {
    write('package.json', JSON.stringify({ name: 'core-cn-test', version: '1.0.0', main: 'src/index.js' }, null, 2));
    write('src/模块.js', 'export function 你好() { return 42; }\n');
    write('src/index.js', 'import { 你好 } from "./模块";\nexport function main() { return 你好(); }\n');

    const unresolved = runCli(['unresolved', '--cwd', tempRoot, '--json', '--quiet'], { cwd: tempRoot });
    assert.strictEqual(unresolved.unresolvedCount, 0, 'non-ASCII import should not produce unresolved entries');

    const impact = runCli(['impact', '--cwd', tempRoot, '--file', 'src/模块.js', '--json', '--quiet'], { cwd: tempRoot });
    assert.strictEqual(impact.impactCount, 1, 'non-ASCII source should map one dependent');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function main() {
  testPathVariants();
  testNonAsciiPath();
}

main();
