#!/usr/bin/env node
// @contract
// Wave 5 boundary hardening regression tests.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

/* --------------------------------------------------------------------------
 * #14: file-index build() fast-paths empty directories but still prunes
 * deleted cache entries.
 * -------------------------------------------------------------------------- */
async function testEmptyDirectoryPrunesStaleCache() {
  const root = makeTempDir('wb-empty-');
  const fileA = path.join(root, 'a.js');

  // Phase 1: create file, build index, save cache
  fs.writeFileSync(fileA, 'export const x = 1;\n');
  const cache1 = new WorkspaceCache(root);
  const index1 = new FileIndex(root, cache1);
  await index1.build(30000, { watch: false });
  await cache1.save();
  assert.strictEqual(cache1.fileMetadata.size, 1, 'cache should have 1 file after build');

  // Phase 2: delete file, rebuild with fresh FileIndex loading stale cache
  fs.unlinkSync(fileA);
  const cache2 = new WorkspaceCache(root);
  cache2.load();
  assert.strictEqual(cache2.fileMetadata.size, 1, 'loaded cache should still have 1 file');

  const index2 = new FileIndex(root, cache2);
  await index2.build(30000, { watch: false });

  assert.strictEqual(cache2.fileMetadata.size, 0, 'cache should have 0 files after pruning deleted');
  assert.deepStrictEqual(index2._indexedFiles, [], '_indexedFiles should be empty array');

  cleanupTempDir(root);
}

/* --------------------------------------------------------------------------
 * #16: builder analyzeFile tolerates string rejections (WASM edge case).
 * -------------------------------------------------------------------------- */
function testAnalyzeFileSwallowsStringRejection() {
  const { GraphBuilder } = require('../src/services/dep-graph/builder');
  const { DependencyGraph } = require('../src/services/dep-graph');

  const dg = new DependencyGraph(process.cwd(), new WorkspaceCache(process.cwd()));
  const builder = new GraphBuilder(dg);

  // Temporarily replace the real parser registry lookup so analyzeFile
  // throws a plain string, simulating a misbehaving WASM loader.
  const originalFindByExt = require('../src/services/dep-graph/parsers/registry').registry.findByExt;
  require('../src/services/dep-graph/parsers/registry').registry.findByExt = () => ({
    parser: () => { throw 'WASM init failed'; },
    async: false,
  });

  try {
    // Should not throw — catch block must handle plain strings
    builder.analyzeFile(path.join(__dirname, 'wave5-boundary-hardening-test.js'));
  } finally {
    require('../src/services/dep-graph/parsers/registry').registry.findByExt = originalFindByExt;
  }
}

/* --------------------------------------------------------------------------
 * #17: container execSync calls include timeout option.
 * -------------------------------------------------------------------------- */
function testContainerGitTimeout() {
  const containerSrc = fs.readFileSync(path.join(__dirname, '../src/services/container.js'), 'utf8');
  const matches = containerSrc.match(/execSync\('git rev-parse HEAD'/g);
  assert(matches && matches.length >= 2, 'container.js should have at least 2 git rev-parse HEAD calls');

  const timeoutMatches = containerSrc.match(/timeout:\s*TIMEOUTS\.GIT_SHORT_MS/g);
  assert(timeoutMatches && timeoutMatches.length >= 2, 'each git rev-parse HEAD call should have timeout option');
}

/* --------------------------------------------------------------------------
 * #13: diagnostics build checks include explicit timeout.
 * -------------------------------------------------------------------------- */
function testDiagnosticsBuildChecksTimeout() {
  const toolsSrc = fs.readFileSync(path.join(__dirname, '../src/tools/workspace-tools.js'), 'utf8');
  assert(toolsSrc.includes("timeout: TIMEOUTS.DIAGNOSTICS_LONG_MS"), 'node:build/node:test/pytest checks should have timeout');
  assert(toolsSrc.includes('buildChecks timeout'), 'runDiagnostics should guard buildChecks with a timeout');
}

async function main() {
  await testEmptyDirectoryPrunesStaleCache();
  testAnalyzeFileSwallowsStringRejection();
  testContainerGitTimeout();
  testDiagnosticsBuildChecksTimeout();
  console.log('wave5-boundary-hardening-test.js: all passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
