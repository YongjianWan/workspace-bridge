#!/usr/bin/env node
/**
 * Verify ServiceContainer.initialize() sets workspaceInfo on cache,
 * enabling runDiagnostics() fast-path.
 * Bug: SESSION.md #22 — runDiagnostics cache path never hit because
 *      getWorkspaceInfo() was always null.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ServiceContainer } = require('../src/services/container');

async function testContainerSetsWorkspaceInfo() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-container-'));
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8');

  const container = new ServiceContainer();
  try {
    await container.initialize(tmpDir, 30000, { watch: false });

    assert.strictEqual(container.initialized, true, 'container should be initialized');
    const info = container.cache.getWorkspaceInfo();
    assert(info !== null && info !== undefined, 'workspaceInfo should be set');
    assert.strictEqual(info.root, container.workspaceRoot, 'workspaceInfo.root should match');
  } finally {
    await container.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  await testContainerSetsWorkspaceInfo();
  console.log('container-workspace-info-test: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
