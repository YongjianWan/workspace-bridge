#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');

async function testInitializeCreatesServices() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-container-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');

  const container = new ServiceContainer();
  const ok = await container.initialize(dir, 30000, { watch: false });
  assert.strictEqual(ok, true);
  assert.strictEqual(container.initialized, true);
  assert(container.cache);
  assert(container.fileIndex);
  assert(container.depGraph);

  await container.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testShutdownSetsInitError() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-container-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');

  const container = new ServiceContainer();
  await container.initialize(dir, 30000, { watch: false });
  await container.shutdown();

  assert.strictEqual(container.initialized, false);
  assert(container.initError);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testReinitializeAfterShutdown() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-container-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');

  const container = new ServiceContainer();
  await container.initialize(dir, 30000, { watch: false });
  await container.shutdown();

  // Re-initialization should succeed because initError is cleared at start of initialize()
  const ok = await container.initialize(dir, 30000, { watch: false });
  assert.strictEqual(ok, true);
  assert.strictEqual(container.initialized, true);

  await container.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-container-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');

  const container = new ServiceContainer();
  await container.initialize(dir, 30000, { watch: false });

  // Should not throw
  await container.ensureReady(1000);

  await container.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  await testInitializeCreatesServices();
  await testShutdownSetsInitError();
  await testReinitializeAfterShutdown();
  await testEnsureReadyTimeout();
  await testEnsureReadyPassesWhenInitialized();
  console.log('container-lifecycle-test: all passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
