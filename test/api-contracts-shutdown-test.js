#!/usr/bin/env node
// @fast
// @semantic
/**
 * runApiContracts opens a frontend and a backend container. A failing shutdown of the first
 * must not leave the second open, and must be reported instead of swallowed.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { ServiceContainer } = require('../src/services/container');
const { runApiContracts } = require('../src/tools/api-contract-tools');

async function main() {
  const root = makeTempDir('wb-api-shutdown-');
  const original = ServiceContainer.prototype.shutdown;
  const shutdownRoots = [];
  try {
    for (const dir of ['web', 'api']) {
      fs.mkdirSync(path.join(root, dir));
      fs.writeFileSync(path.join(root, dir, 'index.js'), 'module.exports = 1;\n');
    }

    ServiceContainer.prototype.shutdown = async function () {
      shutdownRoots.push(path.basename(this.workspaceRoot));
      try {
        if (shutdownRoots.length === 1) throw new Error('injected shutdown failure');
      } finally {
        await original.call(this);
      }
    };

    const result = await runApiContracts({ cwd: root, frontend: 'web', backend: 'api', quiet: true });

    assert.deepStrictEqual(shutdownRoots.sort(), ['api', 'web'], 'both containers must be shut down');
    assert.strictEqual(result.ok !== false, true, 'a successful analysis must keep its result');
    const warning = (result.warnings || []).find((w) => w.type === 'container-shutdown-failed');
    assert(warning, 'the failed shutdown must be reported in warnings[]');
    assert(warning.message.includes('injected shutdown failure'));
  } finally {
    ServiceContainer.prototype.shutdown = original;
    cleanupTempDir(root);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
