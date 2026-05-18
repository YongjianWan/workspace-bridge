#!/usr/bin/env node
/**
 * Staleness detection unit tests.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function main() {

  const container = new ServiceContainer();

  // Before initialization
  {
    const s = container.getStaleness();
    assert.strictEqual(s.indexAgeMs, 0, 'age should be 0 before init');
    assert.strictEqual(s.isStale, false, 'should not be stale before init');
    assert.strictEqual(s.gitHeadChanged, false, 'should not report git head changed before init');
    assert.strictEqual(s.thresholdMs, 86400000, 'default threshold should be 24h');
    assert.strictEqual(s.thresholdDescription, '24 hours', 'should include human-readable threshold');
  }

  // Fresh index (1 second ago)
  {
    container.indexBuildTime = Date.now() - 1000;
    const s = container.getStaleness();
    assert(s.indexAgeMs >= 1000 && s.indexAgeMs < 5000, `age should be ~1000ms, got ${s.indexAgeMs}`);
    assert.strictEqual(s.isStale, false, 'should not be stale after 1s');
    assert.strictEqual(s.gitHeadChanged, false, 'git head should not be changed when no cache');
  }

  // Stale index (>24h)
  {
    container.indexBuildTime = Date.now() - 90000000;
    const s = container.getStaleness();
    assert.strictEqual(s.isStale, true, 'should be stale after 25h');
  }

  // Git HEAD changed detection
  {
    container.indexBuildTime = Date.now() - 1000;
    // Mock cache with a mismatched git HEAD
    const mockCache = {
      getWorkspaceInfo() {
        return { gitHead: 'deadbeef00000000000000000000000000000000' };
      },
    };
    container.cache = mockCache;
    container.workspaceRoot = process.cwd();
    const s = container.getStaleness();
    assert.strictEqual(s.gitHeadChanged, true, 'should detect git head change');
    assert.strictEqual(s.isStale, true, 'isStale should be true when git head changed');
    // Clean up mock
    container.cache = null;
    container.workspaceRoot = null;
  }

  // Custom threshold
  {
    container.indexBuildTime = Date.now() - 5000;
    const s = container.getStaleness(3000);
    assert.strictEqual(s.isStale, true, 'should be stale with 3s threshold');
    assert.strictEqual(s.thresholdMs, 3000);
    assert.strictEqual(s.thresholdDescription, '3 seconds');
  }

  // Boundary: exactly at threshold
  {
    container.indexBuildTime = Date.now() - 86400000;
    const s = container.getStaleness();
    assert.strictEqual(s.isStale, false, 'exactly at threshold should not be stale');
  }

  // Boundary: 1ms over threshold
  {
    container.indexBuildTime = Date.now() - 86400001;
    const s = container.getStaleness();
    assert.strictEqual(s.isStale, true, '1ms over threshold should be stale');
  }

  // Git HEAD unchanged detection
  {
    container.indexBuildTime = Date.now() - 1000;
    const { execSync } = require('child_process');
    let currentHead = null;
    try {
      currentHead = execSync('git rev-parse HEAD', { cwd: process.cwd(), encoding: 'utf8' }).trim();
    } catch {
      // skip if not in git repo
    }
    if (currentHead) {
      const mockCache = {
        getWorkspaceInfo() {
          return { gitHead: currentHead };
        },
      };
      container.cache = mockCache;
      container.workspaceRoot = process.cwd();
      const s = container.getStaleness();
      assert.strictEqual(s.gitHeadChanged, false, 'should not flag unchanged head');
      assert.strictEqual(s.isStale, false, 'should not be stale when head matches and age is fresh');
      container.cache = null;
      container.workspaceRoot = null;
    }
  }

  // File mtime mismatch → filesChanged
  {
    const dir = makeTempDir('wb-staleness-');
    const file = path.join(dir, 'a.js');
    fs.writeFileSync(file, 'export const a = 1;\n');

    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
    cache.setFileMetadata(file, { mtime: 0, size: fs.statSync(file).size });

    const c = new ServiceContainer();
    c.workspaceRoot = dir;
    c.indexBuildTime = Date.now() - 1000;
    c.cache = cache;

    const s = c.getStaleness();
    assert.strictEqual(s.filesChanged, true, 'should detect mtime mismatch');
    assert.strictEqual(s.isStale, true, 'isStale should be true when files changed');
    assert.ok(s.changedFiles.includes(file), 'changedFiles should include the modified file');

    cleanupTempDir(dir);
  }

  // File size mismatch → filesChanged
  {
    const dir = makeTempDir('wb-staleness-');
    const file = path.join(dir, 'b.js');
    fs.writeFileSync(file, 'export const b = 1;\n');

    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
    cache.setFileMetadata(file, { mtime: fs.statSync(file).mtimeMs, size: 99999 });

    const c = new ServiceContainer();
    c.workspaceRoot = dir;
    c.indexBuildTime = Date.now() - 1000;
    c.cache = cache;

    const s = c.getStaleness();
    assert.strictEqual(s.filesChanged, true, 'should detect size mismatch');
    assert.strictEqual(s.isStale, true, 'isStale should be true when size changed');

    cleanupTempDir(dir);
  }

  // File unchanged → filesChanged false
  {
    const dir = makeTempDir('wb-staleness-');
    const file = path.join(dir, 'c.js');
    fs.writeFileSync(file, 'export const c = 1;\n');
    const stats = fs.statSync(file);

    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
    cache.setFileMetadata(file, { mtime: stats.mtimeMs, size: stats.size });

    const c = new ServiceContainer();
    c.workspaceRoot = dir;
    c.indexBuildTime = Date.now() - 1000;
    c.cache = cache;

    const s = c.getStaleness();
    assert.strictEqual(s.filesChanged, false, 'should not flag unchanged file');
    assert.strictEqual(s.isStale, false, 'should not be stale when file matches cache');
    assert.deepStrictEqual(s.changedFiles, [], 'changedFiles should be empty');

    cleanupTempDir(dir);
  }

  // File deleted → filesChanged
  {
    const dir = makeTempDir('wb-staleness-');
    const file = path.join(dir, 'd.js');
    fs.writeFileSync(file, 'export const d = 1;\n');
    const stats = fs.statSync(file);

    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });
    cache.setFileMetadata(file, { mtime: stats.mtimeMs, size: stats.size });

    fs.unlinkSync(file);

    const c = new ServiceContainer();
    c.workspaceRoot = dir;
    c.indexBuildTime = Date.now() - 1000;
    c.cache = cache;

    const s = c.getStaleness();
    assert.strictEqual(s.filesChanged, true, 'should detect deleted file');
    assert.strictEqual(s.isStale, true, 'isStale should be true when file deleted');
    assert.ok(s.changedFiles.includes(file), 'changedFiles should include deleted file');

    cleanupTempDir(dir);
  }

  // No fileMetadata → filesChanged false
  {
    const dir = makeTempDir('wb-staleness-');
    const cache = new WorkspaceCache(dir, { cacheDir: path.join(dir, '.cache') });

    const c = new ServiceContainer();
    c.workspaceRoot = dir;
    c.indexBuildTime = Date.now() - 1000;
    c.cache = cache;

    const s = c.getStaleness();
    assert.strictEqual(s.filesChanged, false, 'should not flag changes when no metadata');
    assert.strictEqual(s.isStale, false, 'should not be stale with empty metadata');

    cleanupTempDir(dir);
  }

}

try {
  main();
} catch (e) {
  console.error('Test failed:', e.message);
  process.exit(1);
}
