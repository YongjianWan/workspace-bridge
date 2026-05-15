#!/usr/bin/env node
/**
 * Staleness detection unit tests.
 */
const assert = require('assert');
const { ServiceContainer } = require('../src/services/container');

function main() {
  console.log('=== staleness-test ===\n');

  const container = new ServiceContainer();

  // Before initialization
  {
    const s = container.getStaleness();
    assert.strictEqual(s.indexAgeMs, 0, 'age should be 0 before init');
    assert.strictEqual(s.isStale, false, 'should not be stale before init');
    assert.strictEqual(s.gitHeadChanged, false, 'should not report git head changed before init');
    assert.strictEqual(s.thresholdMs, 86400000, 'default threshold should be 24h');
    assert.strictEqual(s.thresholdDescription, '24 hours', 'should include human-readable threshold');
    console.log('before-init: ok');
  }

  // Fresh index (1 second ago)
  {
    container.indexBuildTime = Date.now() - 1000;
    const s = container.getStaleness();
    assert(s.indexAgeMs >= 1000 && s.indexAgeMs < 5000, `age should be ~1000ms, got ${s.indexAgeMs}`);
    assert.strictEqual(s.isStale, false, 'should not be stale after 1s');
    assert.strictEqual(s.gitHeadChanged, false, 'git head should not be changed when no cache');
    console.log('fresh-index: ok');
  }

  // Stale index (>24h)
  {
    container.indexBuildTime = Date.now() - 90000000;
    const s = container.getStaleness();
    assert.strictEqual(s.isStale, true, 'should be stale after 25h');
    console.log('stale-index: ok');
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
    console.log('git-head-changed: ok');
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
    console.log('custom-threshold: ok');
  }

  // Boundary: exactly at threshold
  {
    container.indexBuildTime = Date.now() - 86400000;
    const s = container.getStaleness();
    assert.strictEqual(s.isStale, false, 'exactly at threshold should not be stale');
    console.log('boundary-exact: ok');
  }

  // Boundary: 1ms over threshold
  {
    container.indexBuildTime = Date.now() - 86400001;
    const s = container.getStaleness();
    assert.strictEqual(s.isStale, true, '1ms over threshold should be stale');
    console.log('boundary-over: ok');
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
      console.log('git-head-unchanged: ok');
      container.cache = null;
      container.workspaceRoot = null;
    }
  }

  console.log('\nAll staleness tests passed.');
}

try {
  main();
} catch (e) {
  console.error('Test failed:', e.message);
  process.exit(1);
}
