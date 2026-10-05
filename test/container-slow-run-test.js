#!/usr/bin/env node
// @fast
// @semantic
/**
 * A long initialization must be visible: a stage over the heartbeat interval prints a
 * "still running" line even under --quiet, a fast stage prints nothing, and a slow total
 * leaves a slow-run entry in the ledger (-> warnings[]).
 */
const assert = require('assert');
const { ServiceContainer } = require('../src/services/container');
const { TIMEOUTS } = require('../src/config/constants');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureStderr(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.error = original; }
  return lines;
}

async function main() {
  const original = TIMEOUTS.INIT_HEARTBEAT_MS;
  TIMEOUTS.INIT_HEARTBEAT_MS = 40;
  try {
    const container = new ServiceContainer({ quiet: true });
    container._phaseTimes = {};
    container._state = 'INITIALIZING';
    container._readyPromise = Promise.resolve();

    const fast = await captureStderr(() => container._runStage('fast', async () => {}));
    assert.deepStrictEqual(fast, [], 'a fast stage must stay silent under --quiet');

    const slow = await captureStderr(() => container._runStage('slowStage', () => sleep(150)));
    assert(slow.some((l) => l.includes('still running: slowStage')), `slow stage must print a heartbeat, got ${JSON.stringify(slow)}`);

    container.fileIndex = { getStats: () => ({ files: 123 }) };
    container._phaseTimes = { fileIndex: 25, depGraph: 25 };
    container._noteSlowRun();
    const warning = container.ledger.warnings().find((w) => w.type === 'slow-run');
    assert(warning, 'slow total must record slow-run');
    assert.strictEqual(warning.files, 123);
    assert.strictEqual(warning.totalMs, 50);

    const quick = new ServiceContainer({ quiet: true });
    quick.fileIndex = { getStats: () => ({ files: 1 }) };
    quick._phaseTimes = { fileIndex: 5 };
    quick._noteSlowRun();
    assert(!quick.ledger.has('slow-run'), 'a fast run must not record slow-run');
  } finally {
    TIMEOUTS.INIT_HEARTBEAT_MS = original;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
