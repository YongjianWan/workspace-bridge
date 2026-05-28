#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer, STATES } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function testInitializeCreatesServices() {
  const dir = makeTempDir('wb-container-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');

  const container = new ServiceContainer();
  const ok = await container.initialize(dir, 30000, { watch: false });
  assert.strictEqual(ok, true);
  assert.strictEqual(container.initialized, true);
  assert(container.cache);
  assert(container.fileIndex);
  assert(container.depGraph);
  // O6: Graph should be READY after container initialization
  assert.strictEqual(container.depGraph.state, 'READY');

  await container.shutdown();
  cleanupTempDir(dir);
}

async function testShutdownSetsInitError() {
  const dir = makeTempDir('wb-container-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');

  const container = new ServiceContainer();
  await container.initialize(dir, 30000, { watch: false });
  await container.shutdown();

  assert.strictEqual(container.initialized, false);
  assert(container.initError);

  cleanupTempDir(dir);
}

async function testReinitializeAfterShutdown() {
  const dir = makeTempDir('wb-container-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');

  const container = new ServiceContainer();
  await container.initialize(dir, 30000, { watch: false });
  await container.shutdown();

  // Re-initialization should succeed because initError is cleared at start of initialize()
  const ok = await container.initialize(dir, 30000, { watch: false });
  assert.strictEqual(ok, true);
  assert.strictEqual(container.initialized, true);

  await container.shutdown();
  cleanupTempDir(dir);
}

async function testEnsureReadyTimeout() {
  const container = new ServiceContainer();
  // Never initialized, so ensureReady should timeout quickly
  try {
    await container.ensureReady(50);
    assert.fail('should have thrown');
  } catch (e) {
    assert(e.message.includes('timeout') || e.message.includes('Initialization'));
  }
}

async function testEnsureReadyPassesWhenInitialized() {
  const dir = makeTempDir('wb-container-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');

  const container = new ServiceContainer();
  await container.initialize(dir, 30000, { watch: false });

  // Should not throw
  await container.ensureReady(1000);

  await container.shutdown();
  cleanupTempDir(dir);
}

async function testInvalidTransitionThrows() {
  const container = new ServiceContainer();
  // Force into INITIALIZING and attempt an illegal transition to IDLE
  container._transition(STATES.INITIALIZING);
  try {
    container._transition(STATES.IDLE);
    assert.fail('should have thrown for INITIALIZING → IDLE');
  } catch (e) {
    assert(e.message.includes('Invalid transition'), 'error should mention invalid transition');
  }
}

async function testStateConvergesAfterShutdown() {
  const dir = makeTempDir('wb-container-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');

  const container = new ServiceContainer();
  await container.initialize(dir, 30000, { watch: false });
  assert.strictEqual(container.state, STATES.READY, 'state should be READY after init');

  await container.shutdown();
  assert.strictEqual(container.state, STATES.IDLE, 'state should be IDLE after shutdown');

  cleanupTempDir(dir);
}

function testSetterBackdoorRemoved() {
  const container = new ServiceContainer();
  // Setters were removed — in non-strict mode assignment to a getter-only property is a no-op.
  assert.strictEqual(container.initialized, false);
  container.initialized = true;
  assert.strictEqual(container.initialized, false, 'initialized setter backdoor must be removed');
  assert.strictEqual(container.state, STATES.IDLE, 'state must not be bypassed by setter');

  assert.strictEqual(container.initializing, false);
  container.initializing = true;
  assert.strictEqual(container.initializing, false, 'initializing setter backdoor must be removed');
  assert.strictEqual(container.state, STATES.IDLE, 'state must not be bypassed by setter');
}

async function main() {
  await testInitializeCreatesServices();
  await testShutdownSetsInitError();
  await testReinitializeAfterShutdown();
  await testEnsureReadyTimeout();
  await testEnsureReadyPassesWhenInitialized();
  await testInvalidTransitionThrows();
  await testStateConvergesAfterShutdown();
  testSetterBackdoorRemoved();

}

main().catch((e) => { console.error(e); process.exit(1); });
