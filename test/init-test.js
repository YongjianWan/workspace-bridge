#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');

function runCli(args, cwd) {
  return spawnSync('node', [cliPath, ...args], {
    cwd: cwd || repoRoot,
    encoding: 'utf8',
  });
}

function main() {
  const tmpDir = path.join(repoRoot, 'fixture-temp-init-test');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });

  try {
    const result = runCli(['init', '--cwd', tmpDir, '--json'], tmpDir);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.ok, true);
    assert(parsed.message.includes('node_modules'), 'message should mention detected generated dirs');
    assert(parsed.message.includes('docs'), 'message should mention detected reference dirs');

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.workspace-bridge.json'), 'utf8'));
    assert(config.directories.generated.includes('node_modules'));
    assert(config.directories.generated.includes('dist'));
    assert(config.directories.reference.includes('docs'));

    const dup = runCli(['init', '--cwd', tmpDir, '--json'], tmpDir);
    assert.strictEqual(dup.status, 0);
    const dupParsed = JSON.parse(dup.stdout);
    assert.strictEqual(dupParsed.ok, false);
    assert(dupParsed.error.includes('already exists'));

    console.log('init-test: ok');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

main();
