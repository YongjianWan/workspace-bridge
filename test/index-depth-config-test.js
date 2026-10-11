#!/usr/bin/env node
// @fast
// @semantic
/**
 * Source below the default index depth (12) must be reachable through
 * .workspace-bridge.json "maxIndexDepth", not only by editing an internal constant.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');
const { loadWorkspaceConfig } = require('../src/utils/project-context');

const DEEP_LEVELS = 14;

async function indexedFiles(root) {
  const index = new FileIndex(root, new WorkspaceCache(root, { cacheDir: path.join(root, '.wb-cache') }));
  await index.build(30000, { watch: false });
  return { count: index.getStats().files, warnings: index.ledger.warnings() };
}

async function main() {
  const root = makeTempDir('wb-depth-config-');
  try {
    const deepDir = path.join(root, ...Array.from({ length: DEEP_LEVELS }, (_, i) => `d${i}`));
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(deepDir, 'deep.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(root, 'top.js'), 'module.exports = 1;\n');

    const byDefault = await indexedFiles(root);
    assert.strictEqual(byDefault.count, 1, 'default depth indexes only top.js');
    const truncated = byDefault.warnings.find((w) => w.type === 'depth-truncated');
    assert(truncated, 'the cut must be reported');
    assert(truncated.message.includes('maxIndexDepth'), 'the warning must say how to raise the limit');

    fs.writeFileSync(path.join(root, '.workspace-bridge.json'), JSON.stringify({ maxIndexDepth: 20 }));
    assert.strictEqual(loadWorkspaceConfig(root).maxIndexDepth, 20);
    const configured = await indexedFiles(root);
    assert.strictEqual(configured.count, 2, 'maxIndexDepth 20 reaches deep.js');
    assert(!configured.warnings.some((w) => w.type === 'depth-truncated'));

    fs.writeFileSync(path.join(root, '.workspace-bridge.json'), JSON.stringify({ maxIndexDepth: 0 }));
    assert.throws(() => loadWorkspaceConfig(root), /maxIndexDepth/, 'a non-positive depth is a config error');
  } finally {
    cleanupTempDir(root);
  }
  await gitignoredDeepDirsAreNotACoverageGap();
}

// A deep subtree that .gitignore excludes would be dropped even with an
// unlimited depth, so cutting it costs no coverage and must not degrade the
// index; a deep subtree git keeps must still be reported.
async function gitignoredDeepDirsAreNotACoverageGap() {
  const root = makeTempDir('wb-depth-gitignore-');
  try {
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    };
    git('init', '-q');
    fs.writeFileSync(path.join(root, '.gitignore'), 'corpus/\n');
    fs.writeFileSync(path.join(root, 'top.js'), 'module.exports = 1;\n');
    const deepUnder = (top) => path.join(root, top, ...Array.from({ length: DEEP_LEVELS }, (_, i) => `d${i}`));
    fs.mkdirSync(deepUnder('corpus'), { recursive: true });
    fs.writeFileSync(path.join(deepUnder('corpus'), 'deep.js'), 'module.exports = 1;\n');

    const ignoredOnly = await indexedFiles(root);
    assert.strictEqual(ignoredOnly.count, 1);
    assert(!ignoredOnly.warnings.some((w) => w.type === 'depth-truncated'),
      'a gitignored deep subtree is not a coverage gap');

    fs.mkdirSync(deepUnder('src'), { recursive: true });
    fs.writeFileSync(path.join(deepUnder('src'), 'deep.js'), 'module.exports = 1;\n');
    const mixed = await indexedFiles(root);
    const truncated = mixed.warnings.find((w) => w.type === 'depth-truncated');
    assert(truncated, 'a kept deep subtree is still reported');
    assert.strictEqual(truncated.files, 1, 'only the kept subtree counts');
  } finally {
    cleanupTempDir(root);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
