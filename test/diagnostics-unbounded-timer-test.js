#!/usr/bin/env node
/**
 * Regression test for #42: DiagnosticsEngine unbounded timer.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DiagnosticsEngine } = require('../src/services/diagnostics-engine');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

class MockCache {
  getDiagnosticsEntry() {
    return null;
  }
  setDiagnostics() {}
  clearDiagnostics() {}
}

async function testScheduledChecksBoundedUnderLoad() {
  const engine = new DiagnosticsEngine('/tmp', new MockCache());

  // Mock checkFile to be slow so concurrency saturates.
  engine.checkFile = async function () {
    await new Promise((r) => setTimeout(r, 3000));
    return [];
  };

  // Schedule many more checks than the limit.
  for (let i = 0; i < 50; i++) {
    engine.scheduleCheck(`/tmp/file${i}.py`);
  }

  // Wait for debounce timers to fire.
  await new Promise((r) => setTimeout(r, 1200));

  assert(
    engine.runningChecks.size <= engine.config.MAX_CONCURRENT_CHECKS,
    `running checks should respect limit, got ${engine.runningChecks.size}`,
  );
  assert(
    engine.scheduledChecks.size <= engine.config.MAX_SCHEDULED_CHECKS,
    `scheduled checks should be bounded, got ${engine.scheduledChecks.size}`,
  );

  engine.clearScheduledChecks();
}

async function testQueueDrainedWhenSlotFrees() {
  const dir = makeTempDir('wb-diag-');
  fs.writeFileSync(path.join(dir, 'a.py'), 'x=1\n');
  fs.writeFileSync(path.join(dir, 'b.py'), 'x=2\n');
  fs.writeFileSync(path.join(dir, 'c.py'), 'x=3\n');

  const engine = new DiagnosticsEngine(dir, new MockCache());
  let checkCount = 0;

  engine.checkFile = async function (filePath) {
    checkCount++;
    return [];
  };

  // Schedule 3 files with low concurrency limit.
  engine.config.MAX_CONCURRENT_CHECKS = 1;
  engine.config.MAX_SCHEDULED_CHECKS = 10;

  engine.scheduleCheck(path.join(dir, 'a.py'));
  engine.scheduleCheck(path.join(dir, 'b.py'));
  engine.scheduleCheck(path.join(dir, 'c.py'));

  // Wait for debounce.
  await new Promise((r) => setTimeout(r, 1200));

  // All three should eventually run because the queue is drained as slots free.
  assert.strictEqual(checkCount, 3, 'all queued files should be checked');

  engine.clearScheduledChecks();
  cleanupTempDir(dir);
}

async function main() {
  await testScheduledChecksBoundedUnderLoad();
  await testQueueDrainedWhenSlotFrees();

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
