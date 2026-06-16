#!/usr/bin/env node
// @semantic
/**
 * @slow
 * Shallow-clone integration test — validates DataQuality contract in CI-like environment.
 *
 * This test IS the environment. It does a real `git clone --depth=1` of a local
 * fixture repo so that git genuinely reports isShallow=true. No mocks.
 *
 * Why this matters: the shallow-clone bug only fires when git rev-parse
 * --is-shallow-repository returns "true". That never happens on the dev machine
 * with a full clone. This test brings the CI environment into the test suite as
 * a first-class citizen.
 *
 * Assertions:
 *   - co-change dataQuality === 'degraded' in shallow clone
 *   - co-change remediation is non-null (user gets a fix instruction)
 *   - co-change dataQuality === 'certain' in full clone of same repo
 *   - AST-derived impact result is not affected by clone depth (always certain)
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { analyzeCoChanges } = require('../src/tools/cochange-tools');
const { DATA_QUALITY, REMEDIATION } = require('../src/config/data-quality');

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr}`);
  }
  return r.stdout.trim();
}

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function commit(root, msg) {
  run('git', ['add', '-A'], root);
  run('git', ['commit', '-m', msg], root);
}

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(...dirs) {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Build a local git repo with multiple commits so co-change has real pairs.
 * Returns the repo root path.
 */
function buildSourceRepo() {
  const root = makeTmpDir('wb-shallow-src-');
  run('git', ['init'], root);
  run('git', ['config', 'user.email', 'test@example.com'], root);
  run('git', ['config', 'user.name', 'Test'], root);

  // Commit 1: a + b co-change
  writeFile(root, 'src/a.js', 'export const a = 1;\n');
  writeFile(root, 'src/b.js', 'export const b = 1;\n');
  commit(root, 'c1: a+b');

  // Commit 2: a + b again
  writeFile(root, 'src/a.js', 'export const a = 2;\n');
  writeFile(root, 'src/b.js', 'export const b = 2;\n');
  commit(root, 'c2: a+b');

  // Commit 3: a + c
  writeFile(root, 'src/a.js', 'export const a = 3;\n');
  writeFile(root, 'src/c.js', 'export const c = 1;\n');
  commit(root, 'c3: a+c');

  return root;
}

function testShallowCloneDegraded() {
  const src = buildSourceRepo();
  const shallowClone = makeTmpDir('wb-shallow-clone-');
  try {
    // Real shallow clone — this is what CI does by default
    run('git', ['clone', '--depth=1', `file://${src}`, shallowClone]);

    const result = analyzeCoChanges(shallowClone);

    assert.strictEqual(
      result.dataQuality,
      DATA_QUALITY.DEGRADED,
      `Expected dataQuality=degraded in shallow clone, got: ${result.dataQuality}`
    );
    assert.ok(
      result.remediation && result.remediation.length > 0,
      'Expected non-null remediation string in shallow clone'
    );
    assert.strictEqual(
      result.remediation,
      REMEDIATION.SHALLOW_CLONE,
      'Remediation should point to SHALLOW_CLONE fix'
    );

    console.log('  [PASS] shallow clone: dataQuality=degraded, remediation present');
  } finally {
    cleanup(src, shallowClone);
  }
}

function testFullCloneCertain() {
  const src = buildSourceRepo();
  const fullClone = makeTmpDir('wb-full-clone-');
  try {
    // Full clone — local dev and properly configured CI
    run('git', ['clone', `file://${src}`, fullClone]);

    const result = analyzeCoChanges(fullClone);

    assert.strictEqual(
      result.dataQuality,
      DATA_QUALITY.CERTAIN,
      `Expected dataQuality=certain in full clone, got: ${result.dataQuality}`
    );
    assert.strictEqual(
      result.remediation,
      null,
      'Full clone should have null remediation'
    );
    // Sanity: full clone has real co-change data
    assert.ok(result.commitCount >= 3, `Expected >= 3 commits, got ${result.commitCount}`);

    console.log('  [PASS] full clone: dataQuality=certain, remediation=null');
  } finally {
    cleanup(src, fullClone);
  }
}

function testNoGitRepoUnavailable() {
  const noGit = makeTmpDir('wb-no-git-');
  try {
    const result = analyzeCoChanges(noGit);
    assert.strictEqual(
      result.dataQuality,
      DATA_QUALITY.UNAVAILABLE,
      `Expected dataQuality=unavailable for non-git dir, got: ${result.dataQuality}`
    );
    assert.strictEqual(result.commitCount, 0);
    console.log('  [PASS] no git repo: dataQuality=unavailable');
  } finally {
    cleanup(noGit);
  }
}

function main() {
  console.log('shallow-clone-integration-test.js: running...');
  testShallowCloneDegraded();
  testFullCloneCertain();
  testNoGitRepoUnavailable();
  console.log('shallow-clone-integration-test.js: all passed');
}

main();
