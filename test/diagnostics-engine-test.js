#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { DiagnosticsEngine } = require('../src/services/diagnostics-engine');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { WorkspaceCache } = require('../src/services/cache');

function testScheduleCheckDebouncing() {
  const dir = makeTempDir('wb-diag-');
  const cache = new WorkspaceCache(dir);
  const engine = new DiagnosticsEngine(dir, cache);

  let callCount = 0;
  engine.checkFile = async () => { callCount++; return []; };

  // Schedule multiple checks for the same file rapidly
  engine.scheduleCheck(path.join(dir, 'test.js'));
  engine.scheduleCheck(path.join(dir, 'test.js'));
  engine.scheduleCheck(path.join(dir, 'test.js'));

  // Before debounce fires, only one timer should exist
  assert.strictEqual(engine.scheduledChecks.size, 1, 'same file should share one timer');

  engine.clearScheduledChecks();
  cleanupTempDir(dir);
}

function testClearScheduledChecks() {
  const dir = makeTempDir('wb-diag-');
  const cache = new WorkspaceCache(dir);
  const engine = new DiagnosticsEngine(dir, cache);

  engine.scheduleCheck(path.join(dir, 'a.js'));
  engine.scheduleCheck(path.join(dir, 'b.js'));
  assert.strictEqual(engine.scheduledChecks.size, 2);

  engine.clearScheduledChecks();
  assert.strictEqual(engine.scheduledChecks.size, 0);
  assert.strictEqual(engine.checkQueue.size, 0);
  assert.strictEqual(engine.runningChecks.size, 0);

  cleanupTempDir(dir);
}

function testIsSafePathRejectsOutsideWorkspace() {
  const dir = makeTempDir('wb-diag-');
  const cache = new WorkspaceCache(dir);
  const engine = new DiagnosticsEngine(dir, cache);

  const outside = path.join(dir, '..', 'outside.js');
  assert.strictEqual(engine.isSafePath(outside), false);

  const inside = path.join(dir, 'inside.js');
  assert.strictEqual(engine.isSafePath(inside), true);

  cleanupTempDir(dir);
}

function testHandleFileDeleted() {
  const dir = makeTempDir('wb-diag-');
  const cache = new WorkspaceCache(dir);
  const engine = new DiagnosticsEngine(dir, cache);

  const file = path.join(dir, 'gone.js');
  cache.setDiagnostics(file, { mtime: 1, diagnostics: [{ file, line: 1, message: 'x' }] });
  engine.handleFileDeleted(file);
  assert.deepStrictEqual(cache.getDiagnostics(file), []);

  cleanupTempDir(dir);
}

async function testConcurrencyLimit() {
  const dir = makeTempDir('wb-diag-');
  const cache = new WorkspaceCache(dir);
  const engine = new DiagnosticsEngine(dir, cache);

  // Artificially fill runningChecks to max
  for (let i = 0; i < engine.config.MAX_CONCURRENT_CHECKS; i++) {
    engine.runningChecks.add(`file-${i}.js`);
  }

  engine._runBackgroundCheck('overflow.js');
  // With the queue-based design, the file is re-queued instead of
  // spawning an unbounded retry timer.
  assert.strictEqual(
    engine.checkQueue.has('overflow.js'),
    true,
    'should re-queue when concurrency limit hit',
  );

  cleanupTempDir(dir);
}

function main() {
  testScheduleCheckDebouncing();
  testClearScheduledChecks();
  testIsSafePathRejectsOutsideWorkspace();
  testHandleFileDeleted();
  testConcurrencyLimit();

}

main();
