#!/usr/bin/env node
/**
 * Regression test for #41: Python zombie process (no SIGKILL fallback).
 */
const assert = require('assert');

async function testSigkillFallbackAndUnref() {
  const cp = require('child_process');
  const fs = require('fs');
  const constants = require('../src/config/constants');

  // Speed up the test by reducing the fallback delay.
  const originalDelay = constants.TIMEOUTS.PYTHON_AST_SIGKILL_DELAY_MS;
  constants.TIMEOUTS.PYTHON_AST_SIGKILL_DELAY_MS = 50;

  const originalSpawn = cp.spawn;
  const originalExistsSync = fs.existsSync;
  fs.existsSync = () => true;

  let mockProcess = null;
  const killCalls = [];
  let unrefCalled = false;

  cp.spawn = function () {
    const handlers = {};
    mockProcess = {
      stdout: {
        on(event, fn) {
          handlers[`stdout:${event}`] = fn;
        },
        destroy() {},
      },
      stderr: {
        on(event, fn) {
          handlers[`stderr:${event}`] = fn;
        },
        destroy() {},
      },
      stdin: {
        write() {
          return true;
        },
        end() {},
        on() {},
      },
      on(event, fn) {
        handlers[event] = fn;
      },
      kill(signal) {
        killCalls.push(signal);
      },
      unref() {
        unrefCalled = true;
      },
      emit(event, ...args) {
        if (handlers[event]) handlers[event](...args);
      },
    };
    return mockProcess;
  };

  delete require.cache[require.resolve('../src/services/dep-graph/parsers/spawn-ast')];
  const { spawnPythonASTParser } = require('../src/services/dep-graph/parsers/spawn-ast');

  try {
    const promise = spawnPythonASTParser('dummy.py', 'print("hello")', 30);

    // Wait for term timer to fire (30ms + buffer).
    await new Promise((r) => setTimeout(r, 50));
    assert(killCalls.includes('SIGTERM'), 'should send SIGTERM on timeout');

    // Wait for kill timer to fire (30ms + 50ms = 80ms total).
    await new Promise((r) => setTimeout(r, 60));
    assert(killCalls.includes('SIGKILL'), 'should send SIGKILL after fallback delay');

    assert(unrefCalled, 'should call unref() on subprocess');

    // Resolve the pending promise so it does not hang the runner.
    mockProcess.emit('close', 1);
    await promise;
  } finally {
    cp.spawn = originalSpawn;
    fs.existsSync = originalExistsSync;
    constants.TIMEOUTS.PYTHON_AST_SIGKILL_DELAY_MS = originalDelay;
    delete require.cache[require.resolve('../src/services/dep-graph/parsers/spawn-ast')];
  }
}

async function main() {
  await testSigkillFallbackAndUnref();
  console.log('spawn-ast-test: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
