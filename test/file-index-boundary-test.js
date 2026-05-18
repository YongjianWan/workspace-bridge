#!/usr/bin/env node
/**
 * Boundary tests for file-index.js:
 * - readdir permission-denied graceful skip
 * - AbortController timeout in build()
 * - AbortController timeout in indexByPattern()
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

const originalReaddir = fs.promises.readdir;

async function testReaddirPermissionDeniedSkipped() {
  const root = makeTempDir('wb-fidx-');
  fs.mkdirSync(path.join(root, 'readable'));
  fs.writeFileSync(path.join(root, 'readable', 'a.js'), 'export const a = 1;\n');
  fs.mkdirSync(path.join(root, 'unreadable'));
  fs.writeFileSync(path.join(root, 'unreadable', 'b.js'), 'export const b = 2;\n');

  // Patch the promisified readdir used by FileIndex
  const { promisify } = require('util');
  const realReaddir = promisify(fs.readdir);

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
    // Very short timeout to force abort
    await index.build(1, { watch: false });
    // Should complete without throwing even if aborted
  } finally {
    cleanupTempDir(root);
  }
}

async function testIndexByPatternAbortTimeout() {
  const root = makeTempDir('wb-fidx-ptn-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');

  try {
    const cache = new WorkspaceCache(root);
    const index = new FileIndex(root, cache);
    // Very short timeout to force abort
    await index.indexByPattern('**/*.js', 10, 1);
    // Should complete without throwing even if aborted
  } finally {
    cleanupTempDir(root);
  }
}

async function main() {
  await testReaddirPermissionDeniedSkipped();
  await testBuildAbortControllerTimeout();
  await testIndexByPatternAbortTimeout();
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
