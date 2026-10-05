#!/usr/bin/env node
// @fast
// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const projectContext = require('../src/utils/project-context');
const { runCliInProcess, makeTempDir, cleanupTempDir } = require('./test-helpers');
async function main() {
  assert.strictEqual(typeof projectContext.ProjectContext, 'function');
  assert(!('JS_TS_EXTS' in projectContext));
  assert(!('normalizeRelativePath' in projectContext));
  const root = makeTempDir('wb-scratch-archive-');
  try {
    fs.mkdirSync(path.join(root, 'scratch'));
    fs.writeFileSync(path.join(root, 'scratch', 'unused.js'), 'module.exports = 1;');
    fs.writeFileSync(path.join(root, 'main.js'), 'console.log("entry");');
    fs.writeFileSync(path.join(root, '.workspace-bridge.json'), JSON.stringify({ directories: { archive: ['scratch'] } }));
    const result = await runCliInProcess(['--cwd', root, '--strict-cwd', '--json', '--quiet', 'audit-overview']);
    assert(result.ok);
    assert.strictEqual(result.skeleton.totalFiles, 1, 'archived scratch source must not enter the graph');
    assert.strictEqual(result.orphans.counts.modules, 0, 'archived scratch files must not become orphan modules');
    console.log('scratch archive contract: 6/6 passed');
  } finally { cleanupTempDir(root); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
