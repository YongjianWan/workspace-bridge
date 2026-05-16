#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
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

async function main() {
  await testInitializeCreatesServices();
  await testShutdownSetsInitError();
  await testReinitializeAfterShutdown();
  await testEnsureReadyTimeout();
  await testEnsureReadyPassesWhenInitialized();

}

main().catch((e) => { console.error(e); process.exit(1); });
