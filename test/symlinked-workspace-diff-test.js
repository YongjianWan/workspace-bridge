#!/usr/bin/env node
// @fast
// @semantic
/**
 * A workspace reached through a symlinked ancestor (macOS temp dirs live under /var, a symlink to
 * /private/var) still reports its changed files: git prints the real location, and the paths must
 * be translated back to the spelling the caller used instead of being dropped as "outside root".
 * Windows junctions keep the caller's spelling in git output, so this case is POSIX only.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { getChangedFiles } = require('../src/tools/git-tools');

async function main() {
  if (process.platform === 'win32') {
    console.log('skipped: symlinked ancestors are a POSIX case');
    return;
  }
  const base = makeTempDir('wb-symlink-');
  try {
    const real = path.join(base, 'real');
    fs.mkdirSync(path.join(real, 'src'), { recursive: true });
    fs.writeFileSync(path.join(real, 'src', 'a.js'), 'module.exports = 1;\n');
    const git = (args) => {
      const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', ...args], { cwd: real, encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
    };
    git(['init', '-q']);
    git(['add', '-A']);
    git(['commit', '-qm', 'init']);
    fs.writeFileSync(path.join(real, 'src', 'a.js'), 'module.exports = 2;\n');

    const link = path.join(base, 'link');
    fs.symlinkSync(real, link, 'dir');
    const viaLink = path.join(link, 'src', '..');
    for (const root of [link, viaLink]) {
      const result = await getChangedFiles(root, {});
      assert.strictEqual(result.ok, true);
      assert.deepStrictEqual(result.changedFiles, ['src/a.js'], `changed files through ${root}`);
    }
  } finally {
    cleanupTempDir(base);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
