#!/usr/bin/env node
// @slow

const assert = require('assert');
const cp = require('child_process');
const EventEmitter = require('events');

// Save original spawn so we can restore it after mocking
const originalSpawn = cp.spawn;

let activeMockProcesses = 0;
let maxConcurrentMockProcesses = 0;
let closeCallbacks = [];

function mockSpawn(command, args, options) {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = {
    end: () => {},
    on: () => {},
  };

  const proc = new EventEmitter();
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = stdin;
  proc.unref = () => {};
  proc.kill = (signal) => {
    proc.emit('close', 1, signal);
  };

  activeMockProcesses++;
  if (activeMockProcesses > maxConcurrentMockProcesses) {
    maxConcurrentMockProcesses = activeMockProcesses;
  }

  // Defer close to simulate async work
  setTimeout(() => {
    activeMockProcesses--;
    proc.emit('close', 0);
  }, 50);

  return proc;
}

async function testParserConcurrencyLimit() {
  cp.spawn = mockSpawn;
  activeMockProcesses = 0;
  maxConcurrentMockProcesses = 0;

  try {
    const { spawnPythonASTParser, getActiveParserCount } = require('../src/services/dep-graph/parsers/spawn-ast');

    // Fire 10 concurrent parser requests using a real script name so
    // fs.existsSync passes and spawn is actually invoked.
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(spawnPythonASTParser('python_ast_parser.py', 'dummy content'));
    }

    // Give the event loop a tick to let some spawns start
    await new Promise((r) => setImmediate(r));

    // At this point, some should be queued; active count should never exceed 4
    const activeDuringQueue = getActiveParserCount();
    assert(activeDuringQueue <= 4, `active parsers ${activeDuringQueue} should be <= 4`);

    const results = await Promise.all(promises);

    // All 10 should have resolved (null because mock returns no stdout JSON)
    assert.strictEqual(results.length, 10, 'all 10 requests should resolve');
    assert(results.every((r) => r === null), 'mock returns null for invalid JSON');

    // After all done, active count should be 0
    assert.strictEqual(getActiveParserCount(), 0, 'active parsers should be 0 after all complete');

    // The max concurrent mock processes should also be <= 4
    assert(maxConcurrentMockProcesses <= 4, `max concurrent processes ${maxConcurrentMockProcesses} should be <= 4`);
  } finally {
    cp.spawn = originalSpawn;
    // Clear require cache so subsequent tests see the real spawn
    delete require.cache[require.resolve('../src/services/dep-graph/parsers/spawn-ast')];
  }
}

async function testParserQueueDrainsCorrectly() {
  cp.spawn = mockSpawn;
  activeMockProcesses = 0;
  maxConcurrentMockProcesses = 0;

  try {
    const { spawnPythonASTParser, getActiveParserCount } = require('../src/services/dep-graph/parsers/spawn-ast');

    // Sequential calls should not queue (active < limit)
    const r1 = await spawnPythonASTParser('python_ast_parser.py', 'a');
    assert.strictEqual(getActiveParserCount(), 0);

    // A second sequential call should also go through without queueing
    const r2 = await spawnPythonASTParser('python_ast_parser.py', 'b');
    assert.strictEqual(getActiveParserCount(), 0);
    assert.strictEqual(maxConcurrentMockProcesses, 1, 'sequential calls should never exceed 1 concurrent');
  } finally {
    cp.spawn = originalSpawn;
    delete require.cache[require.resolve('../src/services/dep-graph/parsers/spawn-ast')];
  }
}

async function main() {
  await testParserConcurrencyLimit();
  await testParserQueueDrainsCorrectly();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
