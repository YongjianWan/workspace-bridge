#!/usr/bin/env node
// @semantic
// @slow
/**
 * getStaleness must not re-read and re-hash every file right after the index
 * build already did, and must go back to the disk once that verification ages.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { DEFAULTS } = require('../src/config/constants');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const root = makeTempDir('wb-staleness-verified-');
  const cacheDir = makeTempDir('wb-staleness-verified-cache-');
  process.env.WB_CACHE_DIR = cacheDir;
  fs.writeFileSync(path.join(root, 'a.js'), 'module.exports = 1;\n');
  const container = new ServiceContainer({ quiet: true });
  try {
    await container.initialize(root, 60000, { watch: false });

    let scans = 0;
    const realCheck = container.cache.checkFileChanges.bind(container.cache);
    container.cache.checkFileChanges = () => { scans++; return realCheck(); };

    const fresh = container.getStaleness();
    assert.strictEqual(scans, 0, 'index build just verified every hash; getStaleness must not re-scan');
    assert.strictEqual(fresh.filesChanged, false);

    // Same size, later content: only a hash comparison can see it.
    fs.writeFileSync(path.join(root, 'a.js'), 'module.exports = 2;\n');
    container.cache.contentVerifiedAt -= DEFAULTS.INDEX_VERIFIED_FRESH_MS + 1;
    const aged = container.getStaleness();
    assert.strictEqual(scans, 1, 'aged verification must fall back to the disk scan');
    assert.strictEqual(aged.filesChanged, true, 'content edit after the window must be reported');
    assert.strictEqual(aged.isStale, true);
  } finally {
    await container.shutdown?.();
    delete process.env.WB_CACHE_DIR;
    cleanupTempDir(root);
    cleanupTempDir(cacheDir);
  }
  console.log('staleness-index-verified-test OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
