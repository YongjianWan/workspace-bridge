#!/usr/bin/env node
// @semantic
/**
 * Regression tests for large-repo indexing progress reporting.
 * Verifies that FileIndex emits percentage progress events and that
 * the CLI prints phase-level progress for human consumers.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { cleanupTempDir } = require('./test-helpers');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

const REPO_ROOT = path.join(__dirname, '..');
const CLI_PATH = path.join(REPO_ROOT, 'cli.js');

function makeTempDir(prefix = 'wb-test-progress-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix + crypto.randomBytes(4).toString('hex')));
}

function writeFiles(root, count) {
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(root, `file${i}.js`), `export const v${i} = ${i};\n`);
  }
}

async function testFileIndexProgressEvents() {
  const tmpDir = makeTempDir();
  try {
    // Need at least DEFAULTS.FILE_INDEX_PROGRESS_BATCH (100) + 1 files
    // to guarantee at least one progress event.
    writeFiles(tmpDir, 101);

    const cache = new WorkspaceCache(tmpDir, { cacheDir: path.join(tmpDir, '.cache') });
    cache.load();

    const fileIndex = new FileIndex(tmpDir, cache, { quiet: true });
    const events = [];
    fileIndex.bus.on('progress', (evt) => events.push(evt));

    await fileIndex.build(30000, { watch: false });

    assert.ok(events.length > 0, 'Should emit at least one progress event');
    for (const evt of events) {
      assert.strictEqual(evt.phase, 'index');
      assert.ok(Number.isFinite(evt.current) && evt.current > 0);
      assert.ok(Number.isFinite(evt.total) && evt.total >= 101);
      assert.ok(Number.isFinite(evt.percent) && evt.percent >= 0 && evt.percent <= 100);
    }

    // Percent should be monotonically non-decreasing for this sequential batch design.
    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i].percent >= events[i - 1].percent, 'Progress percent should not decrease');
    }
  } finally {
    cleanupTempDir(tmpDir);
  }
}

function testCliPhaseProgress() {
  const tmpDir = makeTempDir();
  try {
    writeFiles(tmpDir, 10);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'progress-test' }));

    const result = spawnSync('node', [CLI_PATH, 'audit-summary', '--cwd', tmpDir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 5 * 1024 * 1024,
    });
    assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
    const stderr = result.stderr || '';
    assert.ok(stderr.includes('[Container] Phase: fileIndex'), 'Should print fileIndex phase');
    assert.ok(stderr.includes('[Container] Phase: depGraph'), 'Should print depGraph phase');
    assert.ok(stderr.includes('[Container] Phase: snapshot'), 'Should print snapshot phase');
  } finally {
    cleanupTempDir(tmpDir);
  }
}

async function main() {
  await testFileIndexProgressEvents();
  testCliPhaseProgress();
  console.log('PASS: indexing-progress-test');
}

main().catch((err) => {
  console.error('FAIL: indexing-progress-test failed:', err);
  process.exit(1);
});
