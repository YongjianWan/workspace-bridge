#!/usr/bin/env node
// @contract
// Regression tests for Bug 27, 28, and 29.

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { shouldExcludeCli } = require('../src/utils/exclude-patterns');
const { normalizePath, resolveWorkspaceFilePath, toPosixPath } = require('../src/utils/path');

/* --------------------------------------------------------------------------
 * Bug 27: Exclude glob support
 * -------------------------------------------------------------------------- */
function testBug27GlobExclusions() {
  console.log('Running testBug27GlobExclusions...');

  // 1. "*.test.js" pattern
  assert.strictEqual(
    shouldExcludeCli('src/foo.test.js', ['*.test.js']),
    true,
    '*.test.js should exclude src/foo.test.js'
  );
  assert.strictEqual(
    shouldExcludeCli('test/watch-test.js', ['*.test.js']),
    false,
    '*.test.js should not exclude watch-test.js'
  );

  // 2. "test/**/*.js" pattern (directory recursive)
  assert.strictEqual(
    shouldExcludeCli('test/watch-test.js', ['test/**/*.js']),
    true,
    'test/**/*.js should exclude test/watch-test.js'
  );
  assert.strictEqual(
    shouldExcludeCli('test/subdir/deep.js', ['test/**/*.js']),
    true,
    'test/**/*.js should exclude test/subdir/deep.js'
  );
  assert.strictEqual(
    shouldExcludeCli('src/utils/path.js', ['test/**/*.js']),
    false,
    'test/**/*.js should not exclude src/utils/path.js'
  );

  // 3. "src/utils/*" pattern (single dir level wildcard)
  assert.strictEqual(
    shouldExcludeCli('src/utils/path.js', ['src/utils/*']),
    true,
    'src/utils/* should exclude src/utils/path.js'
  );
  assert.strictEqual(
    shouldExcludeCli('src/utils/subdir/deep.js', ['src/utils/*']),
    false,
    'src/utils/* should not exclude src/utils/subdir/deep.js'
  );
}

/* --------------------------------------------------------------------------
 * Bug 29: Windows backslash path normalization
 * -------------------------------------------------------------------------- */
function testBug29WindowsBackslashPath() {
  console.log('Running testBug29WindowsBackslashPath...');

  const root = process.cwd();

  // Test normalizePath
  const mixedPath = 'src\\services\\container.js';
  const resolved = normalizePath(mixedPath);
  assert(toPosixPath(resolved).endsWith('src/services/container.js'), `normalizePath failed: resolved to ${resolved}`);

  // Test resolveWorkspaceFilePath
  const resolvedWorkspace = resolveWorkspaceFilePath(mixedPath, root);
  assert(toPosixPath(resolvedWorkspace).endsWith('src/services/container.js'), `resolveWorkspaceFilePath failed: resolved to ${resolvedWorkspace}`);
}

/* --------------------------------------------------------------------------
 * Bug 28: REPL eval exit codes
 * -------------------------------------------------------------------------- */
function testBug28ReplEvalExitCodes() {
  console.log('Running testBug28ReplEvalExitCodes...');

  const CLI_PATH = path.join(__dirname, '../cli.js');

  // Case 1: Invalid command should exit 2
  const run1 = spawnSync('node', [CLI_PATH, 'repl', '--eval', 'invalid_cmd'], { encoding: 'utf8' });
  assert.strictEqual(run1.status, 2, `repl eval invalid_cmd should exit 2, got ${run1.status}`);

  // Case 2: Business failure (nonexistent target file) should exit 1
  const run2 = spawnSync('node', [CLI_PATH, 'repl', '--eval', 'dependencies nonexistent.js'], { encoding: 'utf8' });
  assert.strictEqual(run2.status, 1, `repl eval nonexistent target should exit 1, got ${run2.status}`);

  // Case 3: Valid command should exit 0
  const run3 = spawnSync('node', [CLI_PATH, 'repl', '--eval', 'help'], { encoding: 'utf8' });
  assert.strictEqual(run3.status, 0, `repl eval help should exit 0, got ${run3.status}`);

  // Case 4: JSON Mode - Invalid command should exit 2
  const run4 = spawnSync('node', [CLI_PATH, 'repl', '--eval', 'invalid_cmd', '--json'], { encoding: 'utf8' });
  assert.strictEqual(run4.status, 2, `repl eval JSON invalid_cmd should exit 2, got ${run4.status}`);

  // Case 5: JSON Mode - Business failure should exit 1
  const run5 = spawnSync('node', [CLI_PATH, 'repl', '--eval', 'dependencies nonexistent.js', '--json'], { encoding: 'utf8' });
  assert.strictEqual(run5.status, 1, `repl eval JSON nonexistent target should exit 1, got ${run5.status}`);
}

function main() {
  testBug27GlobExclusions();
  testBug29WindowsBackslashPath();
  testBug28ReplEvalExitCodes();
  console.log('bug-27-28-29-regression-test.js: all passed');
}

main();
