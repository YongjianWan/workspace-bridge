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
    assert.strictEqual(s.thresholdMs, 300000, 'default threshold should be 5min');
    console.log('before-init: ok');
  }

  // Fresh index (1 second ago)
  {
    container.indexBuildTime = Date.now() - 1000;
    const s = container.getStaleness();
    assert(s.indexAgeMs >= 1000 && s.indexAgeMs < 5000, `age should be ~1000ms, got ${s.indexAgeMs}`);
    assert.strictEqual(s.isStale, false, 'should not be stale after 1s');
    console.log('fresh-index: ok');
  }

  // Stale index (>5min)
  {
    container.indexBuildTime = Date.now() - 400000;
    const s = container.getStaleness();
    assert.strictEqual(s.isStale, true, 'should be stale after 400s');
    console.log('stale-index: ok');
  }

  // Custom threshold
  {
    container.indexBuildTime = Date.now() - 5000;
    const s = container.getStaleness(3000);
    assert.strictEqual(s.isStale, true, 'should be stale with 3s threshold');
    assert.strictEqual(s.thresholdMs, 3000);
    console.log('custom-threshold: ok');
  }

  // Boundary: exactly at threshold
  {
    container.indexBuildTime = Date.now() - 300000;
    const s = container.getStaleness();
    assert.strictEqual(s.isStale, false, 'exactly at threshold should not be stale');
    console.log('boundary-exact: ok');
  }

  // Boundary: 1ms over threshold
  {
    container.indexBuildTime = Date.now() - 300001;
    const s = container.getStaleness();
    assert.strictEqual(s.isStale, true, '1ms over threshold should be stale');
    console.log('boundary-over: ok');
  }

  console.log('\nAll staleness tests passed.');
}

try {
  main();
} catch (e) {
  console.error('Test failed:', e.message);
  process.exit(1);
}
