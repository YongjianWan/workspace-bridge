#!/usr/bin/env node
// @contract — query-* snapshot freshness should detect content changes and exact file counts

const assert = require('assert');
const { isSnapshotFresh } = require('../src/tools/query-tools');

function makeContainer({ gitHead = 'abc', fileCount = 10, changed = false } = {}) {
  return {
    cache: {
      getWorkspaceInfo: () => ({ gitHead }),
      checkFileChanges: () => ({ changed, changedFiles: changed ? ['src/a.js'] : [] }),
    },
    snapshot: {
      graph: {
        getAllFilePaths: () => Array(fileCount).fill('file.js'),
      },
    },
  };
}

function testFreshSnapshot() {
  const container = makeContainer({ gitHead: 'abc', fileCount: 10, changed: false });
  const snapshot = { version: 'abc', fileCount: 10 };
  assert.strictEqual(isSnapshotFresh(snapshot, container), true, 'matching head, count and no changes should be fresh');
}

function testStaleGitHead() {
  const container = makeContainer({ gitHead: 'def', fileCount: 10, changed: false });
  const snapshot = { version: 'abc', fileCount: 10 };
  assert.strictEqual(isSnapshotFresh(snapshot, container), false, 'different gitHead should be stale');
}

function testStaleFileCount() {
  const container = makeContainer({ gitHead: 'abc', fileCount: 12, changed: false });
  const snapshot = { version: 'abc', fileCount: 10 };
  assert.strictEqual(isSnapshotFresh(snapshot, container), false, 'different fileCount should be stale (no tolerance)');
}

function testStaleContentChange() {
  const container = makeContainer({ gitHead: 'abc', fileCount: 10, changed: true });
  const snapshot = { version: 'abc', fileCount: 10 };
  assert.strictEqual(isSnapshotFresh(snapshot, container), false, 'content changes should make snapshot stale');
}

function testFreshWithMissingMetadata() {
  const container = makeContainer({ gitHead: '', fileCount: 0, changed: false });
  const snapshot = { version: '', fileCount: 0 };
  assert.strictEqual(isSnapshotFresh(snapshot, container), true, 'empty metadata should not falsely stale');
}

function main() {
  const tests = [
    testFreshSnapshot,
    testStaleGitHead,
    testStaleFileCount,
    testStaleContentChange,
    testFreshWithMissingMetadata,
  ];
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      passed++;
      console.log(`  PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${t.name}: ${err.message}`);
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  if (failed > 0) process.exit(1);
}

main();
