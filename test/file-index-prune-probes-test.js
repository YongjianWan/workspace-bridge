#!/usr/bin/env node
// @fast
// @semantic
/**
 * A warm build has already stat/read every discovered file, so pruning must
 * only probe cache entries the build did not just confirm — and must still
 * drop entries whose file is gone.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const root = makeTempDir('wb-prune-probes-');
  const cacheDir = makeTempDir('wb-prune-probes-cache-');
  try {
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(root, `f${i}.js`), `exports.v${i} = ${i};\n`);
    const cache = new WorkspaceCache(root, { cacheDir });
    cache.load();
    const index = new FileIndex(root, cache, { quiet: true });
    await index.build(20000, { watch: false });
    assert.strictEqual(cache.fileMetadata.size, 20);

    // A file deleted since the last build; only it may still be probed.
    fs.unlinkSync(path.join(root, 'f0.js'));
    const realExists = fs.existsSync;
    const probed = [];
    fs.existsSync = function (p) { if (/[\\/]f\d+\.js$/i.test(String(p))) probed.push(String(p)); return realExists.apply(this, arguments); };
    try {
      await new FileIndex(root, cache, { quiet: true }).build(20000, { watch: false });
    } finally {
      fs.existsSync = realExists;
    }
    assert.strictEqual(cache.fileMetadata.size, 19, 'deleted file must leave the cache');
    assert(probed.length <= 1, `warm build re-probed ${probed.length}: ${probed.join(', ')}`);
    assert.strictEqual(probed.length, 1, 'probe instrumentation must observe the deleted file on either path separator');
  } finally {
    cleanupTempDir(root);
    cleanupTempDir(cacheDir);
  }
  console.log('file-index-prune-probes-test OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
