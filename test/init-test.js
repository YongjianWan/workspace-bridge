#!/usr/bin/env node
// @semantic
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { runCliInProcessRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const tmpDir = makeTempDir('wb-init-');
  fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });

  try {
    // 1. Basic init succeeds and classifies directories correctly
    const result = await runCliInProcessRaw(['init', '--cwd', tmpDir, '--json'], { cwd: tmpDir });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.ok, true);
    assert(parsed.gitignoreUpdated, 'gitignoreUpdated should be true on first init');
    assert(parsed.message.includes('src'), 'message should mention active dir src');
    assert(parsed.message.includes('node_modules'), 'message should mention detected generated dirs');
    assert(parsed.message.includes('docs'), 'message should mention detected reference dirs');

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.workspace-bridge.json'), 'utf8'));
    assert(config.directories.active.includes('src'), 'active should include src');
    assert(!config.directories.active.includes('.github'), 'active should not include hidden dirs like .github');
    assert(config.directories.generated.includes('node_modules'));
    assert(config.directories.generated.includes('dist'));
    assert(config.directories.reference.includes('docs'));

    // 2. .gitignore created with cache entries
    const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    assert(gitignore.includes('.workspace-bridge-cache.json'), '.gitignore should cache entries');
    assert(gitignore.includes('cache.db'), '.gitignore should include cache.db');

    // 3. Duplicate init fails
    const dup = await runCliInProcessRaw(['init', '--cwd', tmpDir, '--json'], { cwd: tmpDir });
    assert.strictEqual(dup.status, 1, 'init should exit with code 1 when config already exists');
    const dupParsed = JSON.parse(dup.stdout);
    assert.strictEqual(dupParsed.ok, false);
    assert(dupParsed.error.includes('already exists'));

    // 4. Re-init after deleting config should not duplicate gitignore entries
    fs.unlinkSync(path.join(tmpDir, '.workspace-bridge.json'));
    const reinit = await runCliInProcessRaw(['init', '--cwd', tmpDir, '--json'], { cwd: tmpDir });
    assert.strictEqual(reinit.status, 0, reinit.stderr || reinit.stdout);
    const reinitParsed = JSON.parse(reinit.stdout);
    assert.strictEqual(reinitParsed.gitignoreUpdated, false, 'gitignore should not be updated when entries already exist');
    const gitignore2 = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    const occurrences = gitignore2.split('\n').filter((line) => line.trim() === '.workspace-bridge-cache.json').length;
    assert.strictEqual(occurrences, 1, 'cache entry should not be duplicated in .gitignore');

    // 5. Init with invalid option fails
    const invalidOpt = await runCliInProcessRaw(['init', '--cwd', tmpDir, '--invalid-option-xyz', '--json'], { cwd: tmpDir });
    assert.strictEqual(invalidOpt.status, 1, 'should exit 1 for invalid option');
    assert(invalidOpt.stdout.includes('Unknown argument') || invalidOpt.stderr.includes('Unknown argument'), 'should surface unknown option error');
  } finally {
    cleanupTempDir(tmpDir);
  }
}

main();
