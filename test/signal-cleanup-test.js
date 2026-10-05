#!/usr/bin/env node
// @fast
// @semantic
/**
 * An interrupted one-shot run shuts its container down before exiting.
 * Signals are delivered with process.emit so the check runs on every platform
 * (a real kill() terminates a Windows process without running handlers).
 */
const assert = require('assert');
const { installSignalCleanup } = require('../src/cli/signal-cleanup');

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function main() {
  const calls = [];
  const container = { shutdown: async () => { calls.push('shutdown'); } };
  const remove = installSignalCleanup({ getContainer: () => container, exit: (code) => calls.push(`exit:${code}`) });
  try {
    process.emit('SIGTERM');
    process.emit('SIGINT'); // a second signal while cleaning up must not shut down twice
    await tick(); await tick();
    assert.deepStrictEqual(calls, ['shutdown', 'exit:143'], 'SIGTERM: shut down, then exit 128+15');
  } finally {
    remove();
  }

  const failing = [];
  const remove2 = installSignalCleanup({
    getContainer: () => ({ shutdown: async () => { throw new Error('boom'); } }),
    exit: (code) => failing.push(code),
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    process.emit('SIGINT');
    await tick(); await tick();
  } finally {
    console.error = originalError;
    remove2();
  }
  assert.deepStrictEqual(failing, [130], 'a failing shutdown must not block the exit (128+2)');

  const idle = [];
  const remove3 = installSignalCleanup({ getContainer: () => null, exit: (code) => idle.push(code) });
  try {
    process.emit('SIGTERM');
    await tick();
  } finally {
    remove3();
  }
  assert.deepStrictEqual(idle, [143], 'no container yet: still exits');

  assert.strictEqual(process.listenerCount('SIGTERM'), 0, 'handlers must be removable');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
