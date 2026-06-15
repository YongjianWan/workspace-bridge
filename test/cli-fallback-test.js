#!/usr/bin/env node
// @contract

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { runCliWithFallback } = require('../src/utils/cli-fallback');

const repoRoot = path.join(__dirname, '..');

function _withCacheDir(args) {
  const cacheDir = process.env.WB_TEST_CACHE_DIR;
  if (cacheDir && !args.includes('--cache-dir')) {
    return ['--cache-dir', cacheDir, ...args];
  }
  return args;
}

function testFallbackWhenGlobalMissing() {
  const run = runCliWithFallback(
    _withCacheDir(['workspace-info', '--cwd', repoRoot, '--json', '--quiet']),
    {
      stdio: 'pipe',
      cwd: repoRoot,
      env: process.env,
      globalCmd: 'workspace-bridge-cli-does-not-exist',
    }
  );
  assert.strictEqual(run.used, 'local', 'should fallback to local cli');
  assert.strictEqual(run.result.status, 0, run.result.stderr?.toString() || run.result.stdout?.toString());
  const parsed = JSON.parse(run.result.stdout.toString('utf8'));
  assert.strictEqual(parsed.workspaceRoot, repoRoot);
}

function testForceLocalMode() {
  const run = runCliWithFallback(
    _withCacheDir(['workspace-info', '--cwd', repoRoot, '--json', '--quiet']),
    {
      stdio: 'pipe',
      cwd: repoRoot,
      env: process.env,
      globalCmd: 'workspace-bridge-cli',
      forceLocal: true,
    }
  );
  assert.strictEqual(run.used, 'local', 'forceLocal should bypass global cli');
  assert.strictEqual(run.result.status, 0, run.result.stderr?.toString() || run.result.stdout?.toString());
}

function testScriptEntry() {
  const scriptPath = path.join(repoRoot, 'scripts', 'cli-fallback.js');
  const args = _withCacheDir(['workspace-info', '--cwd', repoRoot, '--json', '--quiet']);
  const result = spawnSync('node', [scriptPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      WB_GLOBAL_CLI: 'workspace-bridge-cli-does-not-exist',
    },
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.workspaceRoot, repoRoot);
}

function main() {
  testFallbackWhenGlobalMissing();
  testForceLocalMode();
  testScriptEntry();
}

main();

