#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DiagnosticsEngine } = require('../src/services/diagnostics-engine');
const { WorkspaceCache } = require('../src/services/cache');

function testScheduleCheckDebouncing() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-diag-'));
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
  fs.rmSync(dir, { recursive: true, force: true });
}

function testClearScheduledChecks() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-diag-'));
  const cache = new WorkspaceCache(dir);
  const engine = new DiagnosticsEngine(dir, cache);

  engine.scheduleCheck(path.join(dir, 'a.js'));
  engine.scheduleCheck(path.join(dir, 'b.js'));
  assert.strictEqual(engine.scheduledChecks.size, 2);

  engine.clearScheduledChecks();
  assert.strictEqual(engine.scheduledChecks.size, 0);
  assert.strictEqual(engine.checkQueue.size, 0);
  assert.strictEqual(engine.runningChecks.size, 0);

  fs.rmSync(dir, { recursive: true, force: true });
}

function testIsSafePathRejectsOutsideWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-diag-'));
  const cache = new WorkspaceCache(dir);
  const engine = new DiagnosticsEngine(dir, cache);

  const outside = path.join(dir, '..', 'outside.js');
  assert.strictEqual(engine.isSafePath(outside), false);

  const inside = path.join(dir, 'inside.js');
  assert.strictEqual(engine.isSafePath(inside), true);

  fs.rmSync(dir, { recursive: true, force: true });
}

function testHandleFileDeleted() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-diag-'));
  const cache = new WorkspaceCache(dir);
  const engine = new DiagnosticsEngine(dir, cache);

  const file = path.join(dir, 'gone.js');
  cache.setDiagnostics(file, { mtime: 1, diagnostics: [{ file, line: 1, message: 'x' }] });
  engine.handleFileDeleted(file);
  assert.deepStrictEqual(cache.getDiagnostics(file), []);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testConcurrencyLimit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-diag-'));
  const cache = new WorkspaceCache(dir);
  const engine = new DiagnosticsEngine(dir, cache);

  // Artificially fill runningChecks to max
  for (let i = 0; i < engine.config.MAX_CONCURRENT_CHECKS; i++) {
    engine.runningChecks.add(`file-${i}.js`);
  }

  let rescheduled = false;
  engine.scheduleCheck = () => { rescheduled = true; };

  engine._runBackgroundCheck('overflow.js');
  // _runBackgroundCheck reschedules via setTimeout, so wait a tick
  await new Promise((resolve) => setTimeout(resolve, engine.config.CONCURRENT_RETRY_DELAY_MS + 50));
  assert.strictEqual(rescheduled, true, 'should reschedule when concurrency limit hit');

  fs.rmSync(dir, { recursive: true, force: true });
}

function main() {
  testScheduleCheckDebouncing();
  testClearScheduledChecks();
  testIsSafePathRejectsOutsideWorkspace();
  testHandleFileDeleted();
  testConcurrencyLimit();
  console.log('diagnostics-engine-test: all passed');
}

main();
