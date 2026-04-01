#!/usr/bin/env node
/**
 * CLI 功能可用性测试
 */
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');

function runCli(args) {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function main() {
  console.log('=== workspace-bridge CLI 功能可用性测试 ===\n');

  const workspaceInfo = runCli(['workspace-info', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(workspaceInfo.workspaceRoot, repoRoot);
  console.log('workspace-info: ok');

  const health = runCli(['health', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(health.ok, true);
  console.log('health: ok');

  const summary = runCli(['audit-summary', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(summary.ok, true);
  assert(summary.scope.counts.totalFiles >= 1);
  console.log('audit-summary: ok');

  const fileAudit = runCli(['audit-file', '--cwd', '.', '--file', 'src/services/container.js', '--json', '--quiet']);
  assert.strictEqual(fileAudit.ok, true);
  assert(fileAudit.impact.impactCount >= 0);
  console.log('audit-file: ok');

  const diffAudit = runCli(['audit-diff', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(diffAudit.ok, true);
  assert(diffAudit.summary.counts.changedFiles >= 1);
  console.log('audit-diff: ok');

  // Non-ASCII path regression check
  {
    const fs = require('fs');
    const os = require('os');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cli-cn-'));
    const write = (rel, content) => {
      const full = path.join(tempRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    };
    write('package.json', JSON.stringify({ name: 'cn-test', version: '1.0.0', main: 'src/index.js' }, null, 2));
    write('src/模块.js', 'export function 你好() { return 42; }\n');
    write('src/index.js', 'import { 你好 } from "./模块";\nexport function main() { return 你好(); }\n');
    const cnUnresolved = runCli(['unresolved', '--cwd', tempRoot, '--json', '--quiet']);
    const cnImpact = runCli(['impact', '--cwd', tempRoot, '--file', 'src/模块.js', '--json', '--quiet']);
    assert.strictEqual(cnUnresolved.unresolvedCount, 0);
    assert.strictEqual(cnImpact.impactCount, 1);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('non-ascii-paths: ok');
  }

  const deadExports = runCli(['dead-exports', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(deadExports.ok, true);
  assert(Array.isArray(deadExports.deadExports));
  console.log('dead-exports: ok');

  const unresolved = runCli(['unresolved', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(unresolved.ok, true);
  assert(Array.isArray(unresolved.unresolved));
  console.log('unresolved: ok');

  const cycles = runCli(['cycles', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(cycles.ok, true);
  assert(Array.isArray(cycles.cycles));
  console.log('cycles: ok');

  console.log('\nAll CLI functionality tests passed');
}

main();
