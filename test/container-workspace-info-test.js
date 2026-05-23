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
const { workspaceInfo } = require('../src/tools/workspace-tools');
const { ServiceContainer } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function testContainerSetsWorkspaceInfo() {
  const tmpDir = makeTempDir('wb-container-');
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8');

  const container = new ServiceContainer();
  try {
    await container.initialize(tmpDir, 30000, { watch: false });

    assert.strictEqual(container.initialized, true, 'container should be initialized');
    const info = container.cache.getWorkspaceInfo();
    assert(info !== null && info !== undefined, 'workspaceInfo should be set');
    assert.strictEqual(info.root, container.workspaceRoot, 'workspaceInfo.root should match');
    assert.ok(info.gitHead === null || typeof info.gitHead === 'string', 'gitHead should be null or string');

    // High-signal: assert workspaceInfo tool output using container
    const wsInfo = workspaceInfo({}, container);
    assert.strictEqual(wsInfo.ok, true, 'workspaceInfo tool should return ok');
    assert.strictEqual(wsInfo.workspaceRoot, container.workspaceRoot, 'workspaceRoot in tool output should match');
    assert.strictEqual(wsInfo.detected.node, true, 'detected.node should be true');
    assert.strictEqual(wsInfo.detected.python, false, 'detected.python should be false');
    assert.strictEqual(wsInfo.stack.isNode, true, 'stack.isNode should be true');
    assert.strictEqual(wsInfo.stack.isPython, false, 'stack.isPython should be false');
  } finally {
    await container.shutdown();
    cleanupTempDir(tmpDir);
  }
}

async function main() {
  await testContainerSetsWorkspaceInfo();

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
