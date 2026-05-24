#!/usr/bin/env node
/**
 * @slow
 * Co-change analysis tests
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { makeTempDir, cleanupTempDir, runInDir } = require('./test-helpers');
const { analyzeCoChanges, getCoChangePartners } = require('../src/tools/cochange-tools');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function commit(root, msg) {
  runInDir('git', ['add', '-A'], root);
  runInDir('git', ['commit', '-m', msg], root);
}

function testAnalyzeCoChangesBasic() {
  const tempRoot = makeTempDir('wb-cochange-');
  try {
    runInDir('git', ['init'], tempRoot);
    runInDir('git', ['config', 'user.email', 'test@example.com'], tempRoot);
    runInDir('git', ['config', 'user.name', 'Test User'], tempRoot);

    // Commit 1: a.js and b.js changed together
    writeFile(tempRoot, 'src/a.js', 'export const a = 1;\n');
    writeFile(tempRoot, 'src/b.js', 'export const b = 1;\n');
    commit(tempRoot, 'c1');

    // Commit 2: a.js and b.js changed together again
    writeFile(tempRoot, 'src/a.js', 'export const a = 2;\n');
    writeFile(tempRoot, 'src/b.js', 'export const b = 2;\n');
    commit(tempRoot, 'c2');

    // Commit 3: a.js and c.js changed together
    writeFile(tempRoot, 'src/a.js', 'export const a = 3;\n');
    writeFile(tempRoot, 'src/c.js', 'export const c = 1;\n');
    commit(tempRoot, 'c3');

    // Commit 4: only d.js (single file, should be ignored for pairs)
    writeFile(tempRoot, 'src/d.js', 'export const d = 1;\n');
    commit(tempRoot, 'c4');

    const result = analyzeCoChanges(tempRoot, { commitLimit: 10 });
    assert.strictEqual(result.commitCount, 4, 'should walk all 4 commits');
    assert(result.pairCounts.size >= 2, 'should have at least 2 pairs');

    // a-b pair should have count 2
    const abKey = 'src/a.js|src/b.js';
    const baKey = 'src/b.js|src/a.js';
    const abCount = result.pairCounts.get(abKey) || result.pairCounts.get(baKey);
    assert.strictEqual(abCount, 2, 'a-b pair should appear in 2 commits');

    // a-c pair should have count 1
    const acKey = 'src/a.js|src/c.js';
    const caKey = 'src/c.js|src/a.js';
    const acCount = result.pairCounts.get(acKey) || result.pairCounts.get(caKey);
    assert.strictEqual(acCount, 1, 'a-c pair should appear in 1 commit');

    // d should not appear in any pair (single-file commits are skipped)
    for (const key of result.pairCounts.keys()) {
      assert(!key.includes('src/d.js'), 'single-file commit should not generate pairs');
    }
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testGetCoChangePartners() {
  const pairCounts = new Map([
    ['src/a.js|src/b.js', 3],
    ['src/a.js|src/c.js', 2],
    ['src/a.js|src/d.js', 1], // below minCount=2, should be filtered
    ['src/b.js|src/c.js', 5],
  ]);
  const data = { pairCounts, fileChangeCounts: new Map(), commitCount: 10 };

  const partners = getCoChangePartners('src/a.js', data, { minCount: 2, partnerLimit: 10 });
  assert.strictEqual(partners.length, 2, 'should return 2 partners (b and c), d filtered by minCount');
  assert.strictEqual(partners[0].file, 'src/b.js', 'b should be top partner (count 3)');
  assert.strictEqual(partners[0].count, 3);
  assert.strictEqual(partners[1].file, 'src/c.js', 'c should be second partner (count 2)');
  assert.strictEqual(partners[1].count, 2);

  const limited = getCoChangePartners('src/a.js', data, { minCount: 2, partnerLimit: 1 });
  assert.strictEqual(limited.length, 1, 'should respect partnerLimit');
}

function testAnalyzeCoChangesMergeCommitsSkipped() {
  const tempRoot = makeTempDir('wb-cochange-merge-');
  try {
    runInDir('git', ['init'], tempRoot);
    runInDir('git', ['config', 'user.email', 'test@example.com'], tempRoot);
    runInDir('git', ['config', 'user.name', 'Test User'], tempRoot);

    writeFile(tempRoot, 'src/base.js', 'export const base = 1;\n');
    commit(tempRoot, 'base');

    // Create a branch, change a file
    runInDir('git', ['checkout', '-b', 'feature'], tempRoot);
    writeFile(tempRoot, 'src/feature.js', 'export const feat = 1;\n');
    commit(tempRoot, 'feature');

    // Merge back to main
    runInDir('git', ['checkout', 'main'], tempRoot);
    runInDir('git', ['merge', '--no-ff', 'feature', '-m', 'merge feature'], tempRoot);

    const result = analyzeCoChanges(tempRoot, { commitLimit: 10 });
    // merge commit should be skipped by --no-merges, so only 2 commits walked
    assert.strictEqual(result.commitCount, 2, 'should skip merge commit');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testAnalyzeCoChangesLargeCommitSkipped() {
  const tempRoot = makeTempDir('wb-cochange-large-');
  try {
    runInDir('git', ['init'], tempRoot);
    runInDir('git', ['config', 'user.email', 'test@example.com'], tempRoot);
    runInDir('git', ['config', 'user.name', 'Test User'], tempRoot);

    // Create 25 files in one commit (> maxFiles=20, should be skipped)
    for (let i = 0; i < 25; i++) {
      writeFile(tempRoot, `src/f${i}.js`, `export const f${i} = 1;\n`);
    }
    commit(tempRoot, 'large commit');

    // Create a normal 2-file commit
    writeFile(tempRoot, 'src/a.js', 'export const a = 1;\n');
    writeFile(tempRoot, 'src/b.js', 'export const b = 1;\n');
    commit(tempRoot, 'normal commit');

    const result = analyzeCoChanges(tempRoot, { commitLimit: 10, maxFiles: 20 });
    assert.strictEqual(result.commitCount, 2, 'should walk 2 commits');
    // Only 1 pair from the normal commit
    assert.strictEqual(result.pairCounts.size, 1, 'large commit should be skipped');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function main() {
  testAnalyzeCoChangesBasic();
  testGetCoChangePartners();
  testAnalyzeCoChangesMergeCommitsSkipped();
  testAnalyzeCoChangesLargeCommitSkipped();
  console.log('cochange-test.js: all passed');
}

main();
