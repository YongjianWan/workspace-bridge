#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { getChangedLineRanges } = require('../src/tools/git-tools');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function testLineRangesStagedSeparation() {
  const tmpDir = makeTempDir('wb-linerange-');
  const aPath = path.join(tmpDir, 'a.js');
  fs.writeFileSync(aPath, 'line1\nline2\nline3\n');

  spawnSync('git', ['init'], { cwd: tmpDir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
  spawnSync('git', ['add', 'a.js'], { cwd: tmpDir });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });

  // Unstaged change
  fs.writeFileSync(aPath, 'line1\nmodified2\nline3\n');

  const unstaged = await getChangedLineRanges(tmpDir, 'a.js', { staged: false });
  assert.strictEqual(unstaged.ok, true);
  assert(unstaged.lineRanges.length > 0, 'unstaged change should produce line ranges');

  const stagedBeforeAdd = await getChangedLineRanges(tmpDir, 'a.js', { staged: true });
  assert.strictEqual(stagedBeforeAdd.ok, true);
  assert.strictEqual(stagedBeforeAdd.lineRanges.length, 0, 'no staged change yet should produce empty ranges');

  // Stage the change
  spawnSync('git', ['add', 'a.js'], { cwd: tmpDir });

  const unstagedAfterAdd = await getChangedLineRanges(tmpDir, 'a.js', { staged: false });
  assert.strictEqual(unstagedAfterAdd.ok, true);
  assert.strictEqual(unstagedAfterAdd.lineRanges.length, 0, 'after staging, unstaged should be empty');

  const stagedAfterAdd = await getChangedLineRanges(tmpDir, 'a.js', { staged: true });
  assert.strictEqual(stagedAfterAdd.ok, true);
  assert(stagedAfterAdd.lineRanges.length > 0, 'after staging, staged should produce line ranges');

  cleanupTempDir(tmpDir);
}

async function main() {
  await testLineRangesStagedSeparation();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
