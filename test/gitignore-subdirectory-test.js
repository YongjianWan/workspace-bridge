#!/usr/bin/env node
// @fast
// @semantic
/**
 * Analysing a subdirectory of a git repository must still honour the repository's
 * .gitignore: the root has neither .git nor .gitignore of its own, but git decides.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runInDir, makeTempDir, cleanupTempDir } = require('./test-helpers');
const { filterGitIgnored } = require('../src/utils/gitignore');

async function main() {
  const repo = makeTempDir('wb-gitignore-sub-');
  try {
    runInDir('git', ['init', '-q'], repo);
    const sub = path.join(repo, 'sub');
    fs.mkdirSync(path.join(sub, 'ignored-dir'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.gitignore'), 'sub/skip.js\n/sub/ignored-dir/\n');
    const files = ['keep.js', 'skip.js', path.join('ignored-dir', 'x.js')].map((f) => path.join(sub, f));
    for (const f of files) fs.writeFileSync(f, 'module.exports = 1;\n');

    const fromSub = await filterGitIgnored(sub, files);
    assert.deepStrictEqual(fromSub.kept.map((f) => path.basename(f)), ['keep.js'], 'subdirectory root must apply the repository .gitignore');
    assert.strictEqual(fromSub.warning, null);

    const fromRoot = await filterGitIgnored(repo, files);
    assert.deepStrictEqual(fromRoot.kept.map((f) => path.basename(f)), ['keep.js'], 'repository root result is the reference');
  } finally {
    cleanupTempDir(repo);
  }

  // Outside any repository and without a .gitignore nothing is promised: files pass through.
  const plain = makeTempDir('wb-gitignore-none-');
  try {
    const f = path.join(plain, 'a.js');
    fs.writeFileSync(f, 'module.exports = 1;\n');
    const res = await filterGitIgnored(plain, [f]);
    assert.deepStrictEqual(res, { kept: [f], warning: null });
  } finally {
    cleanupTempDir(plain);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
