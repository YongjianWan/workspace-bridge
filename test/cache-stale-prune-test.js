#!/usr/bin/env node
/**
 * Test that FileIndex prunes deleted files from cache on rebuild.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-stale-'));
  const fileA = path.join(root, 'a.js');

  // Phase 1: create file, build index
  fs.writeFileSync(fileA, 'export const x = 1;\n');
  const cache1 = new WorkspaceCache(root);
  const index1 = new FileIndex(root, cache1);
  await index1.build(30000, { watch: false });
  await cache1.save();

  assert.strictEqual(cache1.fileMetadata.size, 1, 'cache should have 1 file after build');

  // Phase 2: delete file, rebuild with fresh FileIndex loading stale cache
  fs.unlinkSync(fileA);
  const cache2 = new WorkspaceCache(root);
  cache2.load(); // loads saved cache from disk
  assert.strictEqual(cache2.fileMetadata.size, 1, 'loaded cache should still have 1 file');

  const index2 = new FileIndex(root, cache2);
  await index2.build(30000, { watch: false });

  assert.strictEqual(cache2.fileMetadata.size, 0, 'cache should have 0 files after pruning deleted');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('cache-stale-prune-test: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
