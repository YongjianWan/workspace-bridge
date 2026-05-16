#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { runCliRaw, REPO_ROOT } = require('./test-helpers');

function main() {
  const tmpDir = path.join(REPO_ROOT, 'fixture-temp-init-test');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });

  try {
    const result = runCliRaw(['init', '--cwd', tmpDir, '--json'], { cwd: tmpDir });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.ok, true);
    assert(parsed.message.includes('node_modules'), 'message should mention detected generated dirs');
    assert(parsed.message.includes('docs'), 'message should mention detected reference dirs');

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.workspace-bridge.json'), 'utf8'));
    assert(config.directories.generated.includes('node_modules'));
    assert(config.directories.generated.includes('dist'));
    assert(config.directories.reference.includes('docs'));

    const dup = runCliRaw(['init', '--cwd', tmpDir, '--json'], { cwd: tmpDir });
    assert.strictEqual(dup.status, 1, 'init should exit with code 1 when config already exists');
    const dupParsed = JSON.parse(dup.stdout);
    assert.strictEqual(dupParsed.ok, false);
    assert(dupParsed.error.includes('already exists'));
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

main();
