#!/usr/bin/env node
/**
 * Core integration regression:
 * - path normalization consistency (relative/absolute/backslash)
 * - non-ASCII path handling
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');

function runCli(args, cwd = repoRoot) {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function toPosix(input) {
  return String(input || '').replace(/\\/g, '/');
}

function testPathVariants() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-core-path-'));
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
      runCli(['impact', '--cwd', tempRoot, '--file', file, '--json', '--quiet'], tempRoot)
    );
    const affectedResults = variants.map((file) =>
      runCli(['affected-tests', '--cwd', tempRoot, '--file', file, '--json', '--quiet'], tempRoot)
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
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function testNonAsciiPath() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-core-cn-'));
  const write = (rel, content) => {
    const full = path.join(tempRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  try {
    write('package.json', JSON.stringify({ name: 'core-cn-test', version: '1.0.0', main: 'src/index.js' }, null, 2));
    write('src/模块.js', 'export function 你好() { return 42; }\n');
    write('src/index.js', 'import { 你好 } from "./模块";\nexport function main() { return 你好(); }\n');

    const unresolved = runCli(['unresolved', '--cwd', tempRoot, '--json', '--quiet'], tempRoot);
    assert.strictEqual(unresolved.unresolvedCount, 0, 'non-ASCII import should not produce unresolved entries');

    const impact = runCli(['impact', '--cwd', tempRoot, '--file', 'src/模块.js', '--json', '--quiet'], tempRoot);
    assert.strictEqual(impact.impactCount, 1, 'non-ASCII source should map one dependent');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  console.log('=== core integration regression test ===');
  testPathVariants();
  console.log('path-variants: ok');
  testNonAsciiPath();
  console.log('non-ascii: ok');
  console.log('integration-core-test: ok');
}

main();
