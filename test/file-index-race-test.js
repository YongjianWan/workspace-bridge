#!/usr/bin/env node
// @semantic
/**
 * Regression test for #39: processPending() atomic snapshot.
 * Ensures that updates arriving during processPending are not lost
 * and that re-entrant calls do not interfere with each other.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

async function testUpdatesArrivingDuringProcessingAreNotLost() {
  const root = makeTempDir('wb-race-');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'b.js'), 'export const b = 2;\n');

  const cache = new WorkspaceCache(root);
  const index = new FileIndex(root, cache);
  await index.build(30000, { watch: false });

  const processed = [];
  const originalHandleFileChange = index.handleFileChange.bind(index);
  index.handleFileChange = async function(filePath) {
    processed.push(path.basename(filePath));
    // Simulate a new file change arriving while a.js is being processed.
    if (path.basename(filePath) === 'a.js') {
      index.pendingUpdates.add(path.join(root, 'src', 'b.js'));
    }
    await new Promise((r) => setTimeout(r, 20));
    return originalHandleFileChange(filePath);
  };

  index.pendingUpdates.add(path.join(root, 'src', 'a.js'));
  await index.processPending();

  assert.deepStrictEqual(processed, ['a.js'], 'only a.js should be processed in first round');
  assert(
    index.pendingUpdates.has(path.join(root, 'src', 'b.js')),
    'b.js should remain pending for next round',
  );

  await index.processPending();
  assert.deepStrictEqual(
    processed,
    ['a.js', 'b.js'],
    'b.js should be processed in second round',
  );

  cleanupTempDir(root);
}

async function testReentrantProcessPendingDoesNotDuplicate() {
  const root = makeTempDir('wb-reent-');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');

  const cache = new WorkspaceCache(root);
  const index = new FileIndex(root, cache);
  await index.build(30000, { watch: false });

  let processedCount = 0;
  const originalHandleFileChange = index.handleFileChange.bind(index);
  index.handleFileChange = async function(filePath) {
    processedCount++;
    if (processedCount === 1) {
      // Trigger a re-entrant processPending while the outer one is in flight.
      index.pendingUpdates.add(path.join(root, 'src', 'a.js'));
      await index.processPending();
    }
    return originalHandleFileChange(filePath);
  };

  index.pendingUpdates.add(path.join(root, 'src', 'a.js'));
  await index.processPending();

  // With atomic swap the re-entrant call processes the second a.js,
  // so total count should be 2 (not 1, not 3+).
  assert.strictEqual(processedCount, 2, 're-entrant processPending should process each snapshot once');

  cleanupTempDir(root);
}

async function main() {
  await testUpdatesArrivingDuringProcessingAreNotLost();
  await testReentrantProcessPendingDoesNotDuplicate();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
