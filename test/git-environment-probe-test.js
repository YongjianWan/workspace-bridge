#!/usr/bin/env node
// @semantic
/**
 * @slow
 * Git environment probe integration tests.
 *
 * Creates real git repositories to verify shallow/sparse/submodule/LFS/monorepo
 * detection. Each test is self-contained and cleans up after itself.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const {
  analyzeGitEnvironment,
  isGitRepo,
  isShallowClone,
  isSparseCheckout,
  isInsideSubmodule,
  hasSubmodules,
  hasLfsPointers,
  isMonorepoSubpackage,
} = require('../src/utils/git-environment-probe');
const { analyzeCoChanges } = require('../src/tools/cochange-tools');
const { DATA_QUALITY, REMEDIATION } = require('../src/config/data-quality');
const { makeTempDir, cleanupTempDir, runInDir } = require('./test-helpers');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function commit(root, msg) {
  runInDir('git', ['add', '-A'], root);
  runInDir('git', ['commit', '-m', msg], root);
}

function initRepo(root) {
  runInDir('git', ['init'], root);
  runInDir('git', ['config', 'user.email', 'test@example.com'], root);
  runInDir('git', ['config', 'user.name', 'Test User'], root);
}

function gitLfsAvailable() {
  const r = spawnSync('git', ['lfs', 'version'], { encoding: 'utf8' });
  return r.status === 0;
}

function gitUrl(dir) {
  return pathToFileURL(dir).href;
}

function testNonGitRepoUnavailable() {
  const noGit = makeTempDir('wb-no-git-');
  try {
    assert.strictEqual(isGitRepo(noGit), false, 'non-git dir should not be a repo');
    const env = analyzeGitEnvironment(noGit);
    assert.strictEqual(env.isGitRepo, false);
    assert.strictEqual(env.dataQuality, DATA_QUALITY.UNAVAILABLE);
    assert.strictEqual(env.remediation, null);
  } finally {
    cleanupTempDir(noGit);
  }
}

function testFullRepoCertain() {
  const root = makeTempDir('wb-full-repo-');
  try {
    initRepo(root);
    writeFile(root, 'src/a.js', 'export const a = 1;\n');
    commit(root, 'initial');

    const env = analyzeGitEnvironment(root);
    assert.strictEqual(env.isGitRepo, true);
    assert.strictEqual(env.isShallow, false);
    assert.strictEqual(env.isSparseCheckout, false);
    assert.strictEqual(env.hasSubmodules, false);
    assert.strictEqual(env.hasLfsPointers, false);
    assert.strictEqual(env.isMonorepoSubpackage, false);
    assert.strictEqual(env.dataQuality, DATA_QUALITY.CERTAIN);
    assert.strictEqual(env.remediation, null);

    const co = analyzeCoChanges(root);
    assert.strictEqual(co.dataQuality, DATA_QUALITY.CERTAIN);
    assert.strictEqual(co.remediation, null);
  } finally {
    cleanupTempDir(root);
  }
}

function testShallowCloneDegraded() {
  const src = makeTempDir('wb-shallow-src-');
  const clone = makeTempDir('wb-shallow-clone-');
  try {
    initRepo(src);
    writeFile(src, 'src/a.js', 'export const a = 1;\n');
    writeFile(src, 'src/b.js', 'export const b = 1;\n');
    commit(src, 'c1');
    runInDir('git', ['clone', '--depth=1', gitUrl(src), clone]);

    assert.strictEqual(isShallowClone(clone), true);
    const env = analyzeGitEnvironment(clone);
    assert.strictEqual(env.isShallow, true);
    assert.strictEqual(env.dataQuality, DATA_QUALITY.DEGRADED);
    assert.ok(env.remediation.includes(REMEDIATION.SHALLOW_CLONE));

    const co = analyzeCoChanges(clone);
    assert.strictEqual(co.dataQuality, DATA_QUALITY.DEGRADED);
    assert.ok(co.remediation.includes(REMEDIATION.SHALLOW_CLONE));
  } finally {
    cleanupTempDir(src);
    cleanupTempDir(clone);
  }
}

function testSparseCheckoutDegraded() {
  const root = makeTempDir('wb-sparse-src-');
  try {
    initRepo(root);
    writeFile(root, 'src/a.js', 'export const a = 1;\n');
    writeFile(root, 'docs/readme.md', '# readme\n');
    commit(root, 'initial');

    // Sparse checkout may not be supported on very old git; skip if it fails.
    const sparseInit = spawnSync('git', ['sparse-checkout', 'init', '--cone'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (sparseInit.status !== 0) {
      console.log('  [SKIP] git sparse-checkout not supported');
      return;
    }
    runInDir('git', ['sparse-checkout', 'set', 'src'], root);

    assert.strictEqual(isSparseCheckout(root), true, 'sparse-checkout should be detected');
    const env = analyzeGitEnvironment(root);
    assert.strictEqual(env.isSparseCheckout, true);
    assert.strictEqual(env.dataQuality, DATA_QUALITY.DEGRADED);
    assert.ok(env.remediation.includes(REMEDIATION.SPARSE_CHECKOUT));

    const co = analyzeCoChanges(root);
    assert.strictEqual(co.dataQuality, DATA_QUALITY.DEGRADED);
    assert.ok(co.remediation.includes(REMEDIATION.SPARSE_CHECKOUT));
  } finally {
    cleanupTempDir(root);
  }
}

function testSubmodulesDegraded() {
  const child = makeTempDir('wb-submodule-child-');
  const parent = makeTempDir('wb-submodule-parent-');
  try {
    initRepo(child);
    writeFile(child, 'child.js', 'module.exports = 1;\n');
    commit(child, 'child initial');

    initRepo(parent);
    // Allow local file:// transport for submodule add. The -c flag is required
    // because submodule add performs its own clone and does not inherit the
    // parent repo's local config for the transport protocol check.
    const addResult = spawnSync('git', [
      '-C', parent,
      '-c', 'protocol.file.allow=always',
      'submodule', 'add', gitUrl(child), 'libs/child',
    ], { encoding: 'utf8' });
    assert.strictEqual(addResult.status, 0, `submodule add failed: ${addResult.stderr}`);
    runInDir('git', ['commit', '-m', 'add submodule'], parent);

    // Parent repo has submodules.
    assert.strictEqual(hasSubmodules(parent), true);
    assert.strictEqual(isInsideSubmodule(parent), false);
    let env = analyzeGitEnvironment(parent);
    assert.strictEqual(env.hasSubmodules, true);
    assert.strictEqual(env.isInsideSubmodule, false);
    assert.strictEqual(env.dataQuality, DATA_QUALITY.DEGRADED);
    assert.ok(env.remediation.includes(REMEDIATION.SUBMODULE_BOUNDARY));

    let co = analyzeCoChanges(parent);
    assert.strictEqual(co.dataQuality, DATA_QUALITY.DEGRADED);
    assert.ok(co.remediation.includes(REMEDIATION.SUBMODULE_BOUNDARY));

    // The submodule checkout itself is inside a submodule.
    const childCheckout = path.join(parent, 'libs', 'child');
    assert.strictEqual(isInsideSubmodule(childCheckout), true);
    env = analyzeGitEnvironment(childCheckout);
    assert.strictEqual(env.isInsideSubmodule, true);
    assert.strictEqual(env.dataQuality, DATA_QUALITY.DEGRADED);
  } finally {
    cleanupTempDir(child);
    cleanupTempDir(parent);
  }
}

function testLfsPointerDegraded() {
  const root = makeTempDir('wb-lfs-');
  try {
    initRepo(root);

    // Test .gitattributes fallback detection first (no git-lfs required).
    writeFile(root, '.gitattributes', '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    writeFile(root, 'data.bin', 'version https://git-lfs.github.com/spec/v1\n');
    commit(root, 'add lfs attributes');

    assert.strictEqual(hasLfsPointers(root), true, 'LFS should be detected via .gitattributes');
    const env = analyzeGitEnvironment(root);
    assert.strictEqual(env.hasLfsPointers, true);
    assert.strictEqual(env.dataQuality, DATA_QUALITY.DEGRADED);
    assert.ok(env.remediation.includes(REMEDIATION.LFS_POINTER));

    const co = analyzeCoChanges(root);
    assert.strictEqual(co.dataQuality, DATA_QUALITY.DEGRADED);
    assert.ok(co.remediation.includes(REMEDIATION.LFS_POINTER));

    // If git-lfs is installed, also verify it detects actual LFS-tracked files.
    if (gitLfsAvailable()) {
      const lfsRoot = makeTempDir('wb-lfs-real-');
      try {
        initRepo(lfsRoot);
        runInDir('git', ['lfs', 'track', '*.bin'], lfsRoot);
        writeFile(lfsRoot, 'real.bin', 'binary content\n');
        commit(lfsRoot, 'add lfs file');
        assert.strictEqual(hasLfsPointers(lfsRoot), true, 'git-lfs ls-files should detect tracked files');
      } finally {
        cleanupTempDir(lfsRoot);
      }
    }
  } finally {
    cleanupTempDir(root);
  }
}

function testMonorepoSubpackageDegraded() {
  const root = makeTempDir('wb-monorepo-');
  try {
    initRepo(root);
    writeFile(root, 'packages/pkg-a/package.json', '{"name":"pkg-a"}\n');
    writeFile(root, 'packages/pkg-b/package.json', '{"name":"pkg-b"}\n');
    writeFile(root, 'packages/pkg-a/index.js', 'module.exports = 1;\n');
    writeFile(root, 'packages/pkg-b/index.js', 'module.exports = 2;\n');
    commit(root, 'monorepo initial');

    const pkgRoot = path.join(root, 'packages', 'pkg-a');
    assert.strictEqual(isMonorepoSubpackage(pkgRoot), true, 'subpackage should be detected');

    const env = analyzeGitEnvironment(pkgRoot);
    assert.strictEqual(env.isMonorepoSubpackage, true);
    assert.strictEqual(env.dataQuality, DATA_QUALITY.DEGRADED);
    assert.ok(env.remediation.includes(REMEDIATION.MONOREPO_ROOT));

    const co = analyzeCoChanges(pkgRoot);
    assert.strictEqual(co.dataQuality, DATA_QUALITY.DEGRADED);
    assert.ok(co.remediation.includes(REMEDIATION.MONOREPO_ROOT));

    // Running from the actual repo root should not flag it as a subpackage.
    assert.strictEqual(isMonorepoSubpackage(root), false);
  } finally {
    cleanupTempDir(root);
  }
}

function testWorkspacesMonorepoDegraded() {
  const root = makeTempDir('wb-workspaces-');
  try {
    initRepo(root);
    writeFile(root, 'package.json', '{"workspaces":["packages/*"]}\n');
    writeFile(root, 'packages/a/package.json', '{"name":"a"}\n');
    writeFile(root, 'packages/b/package.json', '{"name":"b"}\n');
    commit(root, 'workspaces initial');

    const pkgRoot = path.join(root, 'packages', 'a');
    assert.strictEqual(isMonorepoSubpackage(pkgRoot), true);
  } finally {
    cleanupTempDir(root);
  }
}

function main() {
  console.log('git-environment-probe-test.js: running...');
  testNonGitRepoUnavailable();
  testFullRepoCertain();
  testShallowCloneDegraded();
  testSparseCheckoutDegraded();
  testSubmodulesDegraded();
  testLfsPointerDegraded();
  testMonorepoSubpackageDegraded();
  testWorkspacesMonorepoDegraded();
  console.log('git-environment-probe-test.js: all passed');
}

main();
