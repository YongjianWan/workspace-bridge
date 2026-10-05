#!/usr/bin/env node
// @fast
// @semantic
/**
 * A submodule that moved shows up in the parent's git diff as one gitlink entry, not as source
 * files. audit-diff must say so (with the path and where to run the analysis) instead of
 * reporting an empty change set, and must not treat the submodule directory as a changed file.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeTempDir, cleanupTempDir, runCli } = require('./test-helpers');

// A submodule clone is slow when the whole suite runs 12 tests at once on a cold cache.
const GIT_TIMEOUT_MS = 120000;

function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', '-c', 'protocol.file.allow=always', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

const base = makeTempDir('wb-diff-submodule-');
try {
  const lib = path.join(base, 'lib');
  fs.mkdirSync(lib);
  git(lib, ['init', '-q']);
  fs.writeFileSync(path.join(lib, 'helper.js'), 'module.exports = 1;\n');
  git(lib, ['add', '-A']);
  git(lib, ['commit', '-qm', 'lib']);

  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(main, ['init', '-q']);
  fs.writeFileSync(path.join(main, 'app.js'), 'module.exports = 1;\n');
  git(main, ['submodule', 'add', '-q', lib, 'sub']);
  git(main, ['add', '-A']);
  git(main, ['commit', '-qm', 'main']);

  // The submodule gets a new commit; the parent sees only a moved gitlink.
  fs.writeFileSync(path.join(main, 'sub', 'helper.js'), 'module.exports = 2;\n');
  git(path.join(main, 'sub'), ['commit', '-qam', 'change helper']);

  const result = runCli(['audit-diff', '--cwd', main, '--json', '--quiet']);
  assert(!JSON.stringify(result.changedFiles || []).includes('"sub"'), 'the submodule directory is not a changed file');
  const warning = (result.warnings || []).find((w) => w.type === 'submodule-not-expanded');
  assert(warning, `a moved submodule must be reported, got warnings: ${JSON.stringify(result.warnings)}`);
  assert.deepStrictEqual(warning.submodules, ['sub']);
  assert(/--cwd/.test(warning.message), 'the message says where to run the analysis');
} finally {
  cleanupTempDir(base);
}
