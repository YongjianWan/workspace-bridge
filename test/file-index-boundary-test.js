#!/usr/bin/env node
// @fast
// @semantic
/**
 * Boundary tests for file-index.js:
 * - readdir permission-denied graceful skip
 * - AbortController timeout in build() (findFilesAsync signature contract)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

async function testReaddirPermissionDeniedSkipped() {
  const root = makeTempDir('wb-fidx-');
  fs.mkdirSync(path.join(root, 'readable'));
  fs.writeFileSync(path.join(root, 'readable', 'a.js'), 'export const a = 1;\n');
  fs.mkdirSync(path.join(root, 'unreadable'));
  fs.writeFileSync(path.join(root, 'unreadable', 'b.js'), 'export const b = 2;\n');

  // We need to patch fs.readdir itself because FileIndex uses promisify(fs.readdir)
  const originalFsReaddir = fs.readdir;
  fs.readdir = function(dir, options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = {};
    }
    if (dir.includes('unreadable')) {
      cb(new Error('EACCES: permission denied'));
      return;
    }
    return originalFsReaddir(dir, options, cb);
  };

  try {
    const cache = new WorkspaceCache(root);
    const index = new FileIndex(root, cache);
    await index.build(30000, { watch: false });

    const stats = index.getStats();
    assert(stats.files >= 1, `expected at least 1 file indexed, got ${stats.files}`);
    // unreadable directory should have been skipped
  } finally {
    fs.readdir = originalFsReaddir;
    cleanupTempDir(root);
  }
}

async function testBuildAbortControllerTimeout() {
  const root = makeTempDir('wb-fidx-to-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');

  try {
    const cache = new WorkspaceCache(root);
    const index = new FileIndex(root, cache);
    let sawAbort = false;
    index.findFilesAsync = async function* (_dir, _maxDepth, signal) {
      assert(
        typeof _maxDepth === 'number' && signal && typeof signal === 'object',
        `findFilesAsync 签名应为 (dir, maxDepth, signal)，实际 (${typeof _dir}, ${typeof _maxDepth}, ${typeof signal})`
      );
      const stallUntil = Date.now() + 250;
      while (Date.now() < stallUntil) {
        if (signal.aborted) {
          sawAbort = true;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield path.join(root, 'src', 'a.js');
      }
    };

    const startedAt = Date.now();
    await index.build(20, { watch: false });
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(sawAbort, true, 'build timeout should abort a scan stuck inside the walk');
    assert(elapsedMs < 150, `build timeout should stop promptly, took ${elapsedMs}ms`);
  } finally {
    cleanupTempDir(root);
  }
}

async function main() {
  await testReaddirPermissionDeniedSkipped();
  await testBuildAbortControllerTimeout();
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
