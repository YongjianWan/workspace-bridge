#!/usr/bin/env node
// @contract — WalCadence 节流状态机校验

const assert = require('assert');
const { WalCadence } = require('../src/services/dep-graph/wal-cadence');

function testFirstTickReturnsTruncate() {
  const cadence = new WalCadence();
  const res = cadence.tick();
  assert.strictEqual(res, 'TRUNCATE', 'First tick must initiate a TRUNCATE checkpoint');
}

function testSubsequentTicksReturnPassive() {
  const cadence = new WalCadence();
  cadence.tick(); // first tick (truncate)

  const res = cadence.tick();
  assert.strictEqual(res, 'PASSIVE', 'Subsequent tick within timeframe must be PASSIVE');
}

function testTruncateAfterInterval() {
  const cadence = new WalCadence();
  cadence.tick(); // first tick

  // Simulate time drift (60 seconds)
  cadence.lastTruncate = Date.now() - 60100;

  const res = cadence.tick();
  assert.strictEqual(res, 'TRUNCATE', 'Tick after 60s elapsed must trigger TRUNCATE');
}

function testBatchCounterBackstop() {
  const cadence = new WalCadence();
  cadence.tick(); // first tick

  // Run 31 more times (total 32 ticks since last truncate)
  for (let i = 0; i < 31; i++) {
    const res = cadence.tick();
    assert.strictEqual(res, 'PASSIVE');
  }

  // The 33rd tick (32nd incremental batch) should force TRUNCATE
  const finalRes = cadence.tick();
  assert.strictEqual(finalRes, 'TRUNCATE', 'Forced TRUNCATE after 32 incremental batches');
}

/* -------------------------------------------------------------------------- */
// Runner
/* -------------------------------------------------------------------------- */
const tests = [
  testFirstTickReturnsTruncate,
  testSubsequentTicksReturnPassive,
  testTruncateAfterInterval,
  testBatchCounterBackstop,
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
else process.exit(0);
