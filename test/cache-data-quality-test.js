#!/usr/bin/env node
// @semantic
/**
 * Co-change dataQuality/remediation must survive SQLite cache round-trip.
 *
 * Regression test for the bug where METADATA_SCHEMA.coChanges only serialized
 * pairCounts/fileChangeCounts/commitCount, causing shallow-clone DEGRADED
 * signals to become UNAVAILABLE on warm starts.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { normalizeFilePath } = require('../src/utils/path');
const { DATA_QUALITY, REMEDIATION } = require('../src/config/data-quality');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function testCoChangeDataQualityRoundTrip() {
  const workspaceRoot = makeTempDir('wb-dq-workspace-');
  const cacheDir = makeTempDir('wb-dq-cache-');
  try {
    const coChanges = {
      pairCounts: new Map([['src/a.js|src/b.js', 3]]),
      fileChangeCounts: new Map([['src/a.js', 2], ['src/b.js', 2]]),
      commitCount: 5,
      dataQuality: DATA_QUALITY.DEGRADED,
      remediation: REMEDIATION.SHALLOW_CLONE,
    };

    const cache = new WorkspaceCache(workspaceRoot, { cacheDir });
    cache.saveCoChanges(coChanges);
    const saved = cache.save();
    assert.ok(saved, 'cache.save() should succeed');

    const restored = new WorkspaceCache(workspaceRoot, { cacheDir });
    const loaded = restored.load();
    assert.ok(loaded, 'cache.load() should succeed');

    const rt = restored.coChanges;
    assert.ok(rt, 'restored coChanges should exist');
    assert.strictEqual(rt.dataQuality, DATA_QUALITY.DEGRADED, 'dataQuality should survive round-trip');
    assert.strictEqual(rt.remediation, REMEDIATION.SHALLOW_CLONE, 'remediation should survive round-trip');
    assert.strictEqual(rt.commitCount, 5);
    assert.strictEqual(rt.pairCounts.get('src/a.js|src/b.js'), 3);
  } finally {
    cleanup(workspaceRoot);
    cleanup(cacheDir);
  }
}

function testCoChangeCertainRoundTrip() {
  const workspaceRoot = makeTempDir('wb-dq-certain-');
  const cacheDir = makeTempDir('wb-dq-cache2-');
  try {
    const coChanges = {
      pairCounts: new Map(),
      fileChangeCounts: new Map(),
      commitCount: 0,
      dataQuality: DATA_QUALITY.CERTAIN,
      remediation: null,
    };

    const cache = new WorkspaceCache(workspaceRoot, { cacheDir });
    cache.saveCoChanges(coChanges);
    cache.save();

    const restored = new WorkspaceCache(workspaceRoot, { cacheDir });
    restored.load();
    assert.strictEqual(restored.coChanges.dataQuality, DATA_QUALITY.CERTAIN);
    assert.strictEqual(restored.coChanges.remediation, null);
  } finally {
    cleanup(workspaceRoot);
    cleanup(cacheDir);
  }
}

function testLfsPointerForcesHashVerification() {
  const workspaceRoot = makeTempDir('wb-lfs-cache-');
  const cacheDir = makeTempDir('wb-lfs-cache-dir-');
  try {
    const pointerFile = path.join(workspaceRoot, 'data.bin');
    const pointerContent = 'version https://git-lfs.github.com/spec/v1\noid sha256:abc123\nsize 123\n';
    fs.writeFileSync(pointerFile, pointerContent, 'utf8');
    const stats = fs.statSync(pointerFile);
    const key = normalizeFilePath(pointerFile, workspaceRoot);

    const cache = new WorkspaceCache(workspaceRoot, { cacheDir });
    // Simulate a stale cache where mtime/size match but the stored hash is wrong.
    cache.fileMetadata.set(key, {
      mtime: stats.mtimeMs,
      size: stats.size,
      hash: 'wrong-hash',
      originalPath: pointerFile,
    });

    const { changedFiles } = cache.checkFileChanges();
    assert.ok(changedFiles.includes(pointerFile), 'LFS pointer with wrong hash must be reported as changed');

    // Now store the correct hash and verify the file is considered unchanged.
    const correctHash = require('crypto').createHash('sha256').update(pointerContent).digest('hex');
    cache.fileMetadata.set(key, {
      mtime: stats.mtimeMs,
      size: stats.size,
      hash: correctHash,
      originalPath: pointerFile,
    });
    const second = cache.checkFileChanges();
    assert.ok(!second.changedFiles.includes(pointerFile), 'LFS pointer with correct hash must be considered unchanged');
  } finally {
    cleanup(workspaceRoot);
    cleanup(cacheDir);
  }
}

function main() {
  console.log('cache-data-quality-test.js: running...');
  testCoChangeDataQualityRoundTrip();
  testCoChangeCertainRoundTrip();
  testLfsPointerForcesHashVerification();
  console.log('cache-data-quality-test.js: all passed');
}

main();
