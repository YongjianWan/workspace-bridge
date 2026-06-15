#!/usr/bin/env node
// @semantic
/**
 * Regression test for #43: fs.watch rename vs delete.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

async function testPruneDeletedCacheEntriesReturnsPrunedFiles() {
  const root = makeTempDir('wb-prune-');
  fs.writeFileSync(path.join(root, 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'b.js'), 'export const b = 2;\n');

  const cache = new WorkspaceCache(root);
  const index = new FileIndex(root, cache);
  await index.build(30000, { watch: false });

  fs.unlinkSync(path.join(root, 'a.js'));

  const pruned = await index.pruneDeletedCacheEntries();
  assert(pruned.some((f) => f.includes('a.js')), 'pruned should include a.js');
  assert(!pruned.some((f) => f.includes('b.js')), 'pruned should not include b.js');

  cleanupTempDir(root);
}

async function testRenameWithoutFilenameTriggersPruneAndCallback() {
  const root = makeTempDir('wb-rename-');
  fs.writeFileSync(path.join(root, 'a.js'), 'export const a = 1;\n');

  const cache = new WorkspaceCache(root);
  const index = new FileIndex(root, cache);

  // Mock fs.watch to capture the callback
  const originalWatch = fs.watch;
  let capturedCallback = null;
  fs.watch = function (p, options, callback) {
    capturedCallback = callback;
    return { on() {}, close() {} };
  };

  await index.build(30000, { watch: true });

  fs.unlinkSync(path.join(root, 'a.js'));

  let prunedFiles = null;
  index.bus.on('pending:processed', (files) => {
    prunedFiles = files;
  });

  // Trigger rename event without filename (platform-specific edge case)
  capturedCallback('rename', null);

  // Poll for callback instead of fixed delay.
  const startTime = Date.now();
  while (!prunedFiles && Date.now() - startTime < 2000) {
    await new Promise((r) => setTimeout(r, 50));
  }

  assert(prunedFiles, 'onPendingProcessed should be called');
  assert(prunedFiles.some((f) => f.includes('a.js')), 'pruned files should include a.js');

  fs.watch = originalWatch;
  cleanupTempDir(root);
}

async function main() {
  await testPruneDeletedCacheEntriesReturnsPrunedFiles();
  await testRenameWithoutFilenameTriggersPruneAndCallback();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
