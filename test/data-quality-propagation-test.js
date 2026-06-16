#!/usr/bin/env node
// @semantic
/**
 * @slow
 * DataQuality propagation integration tests.
 *
 * Verifies that environmental degradations (shallow clone, submodule, etc.)
 * are reflected not only in co-change but also in impact, dead-exports, and
 * audit-overview knowledgeRisk outputs.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { DATA_QUALITY, REMEDIATION } = require('../src/config/data-quality');
const { makeTempDir, cleanupTempDir, runInDir, runCli } = require('./test-helpers');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function commit(root, msg, author) {
  const env = author
    ? { ...process.env, GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email }
    : process.env;
  runInDir('git', ['add', '-A'], root);
  const r = spawnSync('git', ['commit', '-m', msg], { cwd: root, encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, `commit failed: ${r.stderr}`);
}

function initRepo(root) {
  runInDir('git', ['init'], root);
  runInDir('git', ['config', 'user.email', 'test@example.com'], root);
  runInDir('git', ['config', 'user.name', 'Test User'], root);
}

function gitUrl(dir) {
  return pathToFileURL(dir).href;
}

function runCliWithCache(args, cwd, cacheDir) {
  return runCli([...args, '--cache-dir', cacheDir], { cwd });
}

function testImpactDataQualityInShallowClone() {
  const src = makeTempDir('wb-dq-impact-src-');
  const clone = makeTempDir('wb-dq-impact-clone-');
  const cacheDir = makeTempDir('wb-dq-impact-cache-');
  try {
    initRepo(src);
    writeFile(src, 'src/a.js', "import { b } from './b';\nexport const a = b + 1;\n");
    writeFile(src, 'src/b.js', 'export const b = 1;\n');
    commit(src, 'initial');
    runInDir('git', ['clone', '--depth=1', gitUrl(src), clone]);

    const result = runCliWithCache(['impact', '--file', 'src/a.js', '--json', '--quiet'], clone, cacheDir);

    assert.strictEqual(result.dataQuality, DATA_QUALITY.DEGRADED, 'impact should be degraded in shallow clone');
    assert.ok(
      result.environmentRemediation && result.environmentRemediation.includes(REMEDIATION.SHALLOW_CLONE),
      'impact should include shallow clone remediation'
    );
    assert.strictEqual(result.coChangesDataQuality, DATA_QUALITY.DEGRADED);
  } finally {
    cleanupTempDir(src);
    cleanupTempDir(clone);
    cleanupTempDir(cacheDir);
  }
}

function testDeadExportsDataQualityInSparseCheckout() {
  const root = makeTempDir('wb-dq-de-src-');
  const cacheDir = makeTempDir('wb-dq-de-cache-');
  try {
    initRepo(root);
    writeFile(root, 'src/used.js', 'export const used = 1;\n');
    writeFile(root, 'src/consumer.js', "import { used } from './used';\nexport const c = used;\n");
    writeFile(root, 'src/orphan.js', 'export const orphan = 1;\n');
    commit(root, 'initial');

    const sparseInit = spawnSync('git', ['sparse-checkout', 'init'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (sparseInit.status !== 0) {
      console.log('  [SKIP] git sparse-checkout not supported');
      return;
    }
    runInDir('git', ['sparse-checkout', 'set', '--skip-checks', 'src/used.js', 'src/orphan.js'], root);

    const result = runCliWithCache(['dead-exports', '--json', '--quiet'], root, cacheDir);

    assert.strictEqual(result.dataQuality, DATA_QUALITY.DEGRADED, 'dead-exports should be degraded in sparse checkout');
    assert.ok(
      result.environmentRemediation && result.environmentRemediation.includes(REMEDIATION.SPARSE_CHECKOUT),
      'dead-exports should include sparse checkout remediation'
    );
  } finally {
    cleanupTempDir(root);
    cleanupTempDir(cacheDir);
  }
}

function testOverviewKnowledgeRiskDataQualityInSubmodule() {
  const child = makeTempDir('wb-dq-kr-child-');
  const parent = makeTempDir('wb-dq-kr-parent-');
  const cacheDir = makeTempDir('wb-dq-kr-cache-');
  try {
    initRepo(child);
    writeFile(child, 'child.js', 'module.exports = 1;\n');
    commit(child, 'child initial');

    initRepo(parent);
    runInDir('git', ['config', 'protocol.file.allow', 'always'], parent);
    const addResult = spawnSync('git', [
      '-C', parent,
      '-c', 'protocol.file.allow=always',
      'submodule', 'add', gitUrl(child), 'libs/child',
    ], { encoding: 'utf8' });
    assert.strictEqual(addResult.status, 0, `submodule add failed: ${addResult.stderr}`);

    writeFile(parent, 'src/a.js', 'export const a = 1;\n');
    commit(parent, 'add submodule and src', { name: 'Author One', email: 'one@example.com' });

    // Add two more authors so knowledgeRisk is not disabled for too-few-authors.
    writeFile(parent, 'src/b.js', 'export const b = 1;\n');
    commit(parent, 'add b', { name: 'Author Two', email: 'two@example.com' });
    writeFile(parent, 'src/c.js', 'export const c = 1;\n');
    commit(parent, 'add c', { name: 'Author Three', email: 'three@example.com' });

    const result = runCliWithCache(['audit-overview', '--with-history', '--json', '--quiet'], parent, cacheDir);

    assert.ok(result.knowledgeRisk, 'overview should include knowledgeRisk');
    if (result.knowledgeRisk.disabled) {
      console.log('  [SKIP] knowledgeRisk disabled in this environment; cannot verify dataQuality propagation');
      return;
    }
    assert.strictEqual(
      result.knowledgeRisk.dataQuality,
      DATA_QUALITY.DEGRADED,
      'knowledgeRisk should be degraded when submodules are present'
    );
    assert.ok(
      result.knowledgeRisk.remediation && result.knowledgeRisk.remediation.includes(REMEDIATION.SUBMODULE_BOUNDARY),
      'knowledgeRisk should include submodule remediation'
    );
  } finally {
    cleanupTempDir(child);
    cleanupTempDir(parent);
    cleanupTempDir(cacheDir);
  }
}

function testCyclesDataQualityInShallowClone() {
  const src = makeTempDir('wb-dq-cycles-src-');
  const clone = makeTempDir('wb-dq-cycles-clone-');
  const cacheDir = makeTempDir('wb-dq-cycles-cache-');
  try {
    initRepo(src);
    writeFile(src, 'src/a.js', "import { b } from './b';\nexport const a = 1;\n");
    writeFile(src, 'src/b.js', "import { a } from './a';\nexport const b = 1;\n");
    commit(src, 'cycle');
    runInDir('git', ['clone', '--depth=1', gitUrl(src), clone]);

    const result = runCliWithCache(['cycles', '--json', '--quiet'], clone, cacheDir);

    assert.strictEqual(result.dataQuality, DATA_QUALITY.DEGRADED, 'cycles should be degraded in shallow clone');
    assert.ok(
      result.environmentRemediation && result.environmentRemediation.includes(REMEDIATION.SHALLOW_CLONE),
      'cycles should include shallow clone remediation'
    );
  } finally {
    cleanupTempDir(src);
    cleanupTempDir(clone);
    cleanupTempDir(cacheDir);
  }
}

function testUnresolvedDataQualityInSparseCheckout() {
  const root = makeTempDir('wb-dq-unresolved-src-');
  const cacheDir = makeTempDir('wb-dq-unresolved-cache-');
  try {
    initRepo(root);
    writeFile(root, 'src/a.js', "import { missing } from './missing';\nexport const a = missing;\n");
    commit(root, 'initial');

    const sparseInit = spawnSync('git', ['sparse-checkout', 'init'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (sparseInit.status !== 0) {
      console.log('  [SKIP] git sparse-checkout not supported');
      return;
    }
    runInDir('git', ['sparse-checkout', 'set', '--skip-checks', 'src/a.js'], root);

    const result = runCliWithCache(['unresolved', '--json', '--quiet'], root, cacheDir);

    assert.strictEqual(result.dataQuality, DATA_QUALITY.DEGRADED, 'unresolved should be degraded in sparse checkout');
    assert.ok(
      result.environmentRemediation && result.environmentRemediation.includes(REMEDIATION.SPARSE_CHECKOUT),
      'unresolved should include sparse checkout remediation'
    );
  } finally {
    cleanupTempDir(root);
    cleanupTempDir(cacheDir);
  }
}

function testAuditDiffDataQualityInSubmodule() {
  const child = makeTempDir('wb-dq-diff-child-');
  const parent = makeTempDir('wb-dq-diff-parent-');
  const cacheDir = makeTempDir('wb-dq-diff-cache-');
  try {
    initRepo(child);
    writeFile(child, 'child.js', 'module.exports = 1;\n');
    commit(child, 'child initial');

    initRepo(parent);
    runInDir('git', ['config', 'protocol.file.allow', 'always'], parent);
    const addResult = spawnSync('git', [
      '-C', parent,
      '-c', 'protocol.file.allow=always',
      'submodule', 'add', gitUrl(child), 'libs/child',
    ], { encoding: 'utf8' });
    assert.strictEqual(addResult.status, 0, `submodule add failed: ${addResult.stderr}`);

    writeFile(parent, 'src/a.js', 'export const a = 1;\n');
    commit(parent, 'add submodule and src');

    // Make an uncommitted change so audit-diff has something to report.
    writeFile(parent, 'src/a.js', 'export const a = 2;\n');

    const result = runCliWithCache(['audit-diff', '--json', '--quiet'], parent, cacheDir);

    assert.strictEqual(result.dataQuality, DATA_QUALITY.DEGRADED, 'audit-diff should be degraded when submodules are present');
    assert.ok(
      result.environmentRemediation && result.environmentRemediation.includes(REMEDIATION.SUBMODULE_BOUNDARY),
      'audit-diff should include submodule remediation'
    );
  } finally {
    cleanupTempDir(child);
    cleanupTempDir(parent);
    cleanupTempDir(cacheDir);
  }
}

function main() {
  console.log('data-quality-propagation-test.js: running...');
  testImpactDataQualityInShallowClone();
  testDeadExportsDataQualityInSparseCheckout();
  testOverviewKnowledgeRiskDataQualityInSubmodule();
  testCyclesDataQualityInShallowClone();
  testUnresolvedDataQualityInSparseCheckout();
  testAuditDiffDataQualityInSubmodule();
  console.log('data-quality-propagation-test.js: all passed');
}

main();
