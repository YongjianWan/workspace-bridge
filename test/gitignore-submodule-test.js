#!/usr/bin/env node
// @fast
// @semantic
/**
 * A file inside a submodule makes `git check-ignore` from the superproject fail for the whole
 * batch. The files outside the submodule must still be filtered by the superproject's rules, and
 * the files inside by the submodule's own.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { filterGitIgnored } = require('../src/utils/gitignore');

// A submodule clone is slow when the whole suite runs 12 tests at once on a cold cache.
const GIT_TIMEOUT_MS = 120000;

function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', '-c', 'protocol.file.allow=always', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

async function main() {
  const base = makeTempDir('wb-gitignore-sub-');
  try {
    const lib = path.join(base, 'lib');
    fs.mkdirSync(lib);
    git(lib, ['init', '-q']);
    fs.writeFileSync(path.join(lib, '.gitignore'), 'generated.js\n');
    fs.writeFileSync(path.join(lib, 'x.js'), '1');
    git(lib, ['add', '-A']);
    git(lib, ['commit', '-qm', 'lib']);

    const main = path.join(base, 'main');
    fs.mkdirSync(main);
    git(main, ['init', '-q']);
    fs.writeFileSync(path.join(main, '.gitignore'), 'ignored.js\n');
    fs.writeFileSync(path.join(main, 'b.js'), '1');
    fs.writeFileSync(path.join(main, 'ignored.js'), '1');
    git(main, ['submodule', 'add', '-q', lib, 'sub']);
    git(main, ['add', '-A']);
    git(main, ['commit', '-qm', 'main']);
    fs.writeFileSync(path.join(main, 'sub', 'generated.js'), '1'); // ignored by the submodule's own .gitignore

    const files = ['b.js', 'ignored.js', path.join('sub', 'x.js'), path.join('sub', 'generated.js')].map((f) => path.join(main, f));
    const { kept, warning } = await filterGitIgnored(main, files);
    const names = kept.map((f) => path.relative(main, f).split(path.sep).join('/')).sort();
    assert.deepStrictEqual(names, ['b.js', 'sub/x.js'], 'superproject and submodule rules both apply');
    assert.strictEqual(warning, null, 'a submodule is not a reason to report the filter unavailable');

    // A repository without a submodule that git still rejects keeps the explicit warning.
    const plain = path.join(base, 'plain');
    fs.mkdirSync(plain);
    fs.writeFileSync(path.join(plain, '.gitignore'), 'x\n');
    const outside = await filterGitIgnored(plain, [path.join(base, 'elsewhere.js')]);
    assert.strictEqual(outside.warning && outside.warning.type, 'gitignore-unavailable');
    assert.deepStrictEqual(outside.kept, [path.join(base, 'elsewhere.js')]);
  } finally {
    cleanupTempDir(base);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
