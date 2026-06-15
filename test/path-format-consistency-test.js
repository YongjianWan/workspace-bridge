#!/usr/bin/env node
// @contract

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function testDisplayPathPreservesPlatformFormat() {
  const dir = makeTempDir('wb-pathfmt-');
  const srcDir = path.join(dir, 'src');
  const fileA = path.join(srcDir, 'FilePreview.js');
  const fileB = path.join(srcDir, 'HelperUtils.js');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(fileA, "export const preview = 1;\n", 'utf8');
  fs.writeFileSync(fileB, "import { preview } from './FilePreview';\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  cache.setFileMetadata(fileA, { mtime: Date.now(), size: 1 });
  cache.setFileMetadata(fileB, { mtime: Date.now(), size: 1 });

  const dg = new DependencyGraph(dir, cache);
  // Pass raw platform-native paths as sourceFiles
  await dg.builder.build([fileA, fileB]);

  const keyA = dg.normalizeFilePath(fileA);
  const displayA = dg._displayPath(keyA);
  const keyB = dg.normalizeFilePath(fileB);
  const displayB = dg._displayPath(keyB);

  // On Windows, the display path must preserve original backslashes and casing.
  // On POSIX, it must preserve original casing (slashes are already POSIX).
  if (process.platform === 'win32') {
    assert(displayA.includes('\\'), 'Windows: display path should use backslashes');
    assert(displayA.includes('FilePreview'), 'Windows: display path should preserve original casing');
    assert(!displayA.includes('filepreview'), 'Windows: display path should not be lowercased');
    assert(displayB.includes('HelperUtils'), 'Windows: display path should preserve original casing for importer too');
  } else {
    assert.strictEqual(displayA, fileA, 'POSIX: display path should match original absolute path');
    assert.strictEqual(displayB, fileB, 'POSIX: display path should match original absolute path');
  }

  // Impact radius should also use platform-native paths
  const impact = dg.getImpactRadius(keyA);
  assert(impact.length > 0, 'fileA should have dependents');
  const impactedFile = impact[0].file;
  if (process.platform === 'win32') {
    assert(impactedFile.includes('\\'), 'Windows: impact file should use backslashes');
    assert(impactedFile.includes('HelperUtils'), 'Windows: impact file should preserve casing');
  } else {
    assert.strictEqual(impactedFile, fileB, 'POSIX: impact file should match original path');
  }

  cache.close();
  cleanupTempDir(dir);
}

async function testCachedBuildRestoresOriginalPath() {
  const dir = makeTempDir('wb-pathfmt-');
  const srcDir = path.join(dir, 'src');
  const fileA = path.join(srcDir, 'FilePreview.js');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(fileA, "export const preview = 1;\n", 'utf8');

  const cacheDir = path.join(dir, '.cache');
  const cache = new WorkspaceCache(dir, { cacheDir });
  cache.setFileMetadata(fileA, { mtime: Date.now(), size: 1 });

  const dg1 = new DependencyGraph(dir, cache);
  await dg1.builder.build([fileA]);

  // Persist to SQLite
  await cache.save();
  cache.close();

  // Load fresh cache
  const cache2 = new WorkspaceCache(dir, { cacheDir });
  const loaded = cache2.load();
  assert(loaded, 'cache should load');

  // Re-build using cached data (no sourceFiles passed)
  const dg2 = new DependencyGraph(dir, cache2);
  await dg2.builder.build();

  const keyA = dg2.normalizeFilePath(fileA);
  const displayA = dg2._displayPath(keyA);

  if (process.platform === 'win32') {
    assert(displayA.includes('\\'), 'Windows cached build: display path should use backslashes');
    assert(displayA.includes('FilePreview'), 'Windows cached build: display path should preserve casing');
  } else {
    assert.strictEqual(displayA, fileA, 'POSIX cached build: display path should match original path');
  }

  cache.close();
  cache2.close();
  cleanupTempDir(dir);
}

async function main() {
  await testDisplayPathPreservesPlatformFormat();
  await testCachedBuildRestoresOriginalPath();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
