#!/usr/bin/env node
// @contract — project-context 导出面收紧；scratch 目录按 archive 排除后不再被报为 orphan 模块

const assert = require('assert');
const projectContext = require('../src/utils/project-context');
const { runCliInProcess } = require('./test-helpers');

function testProjectContextExportsAreMinimal() {
  assert.strictEqual(typeof projectContext.ProjectContext, 'function', 'ProjectContext must remain exported');
  assert.ok(!('JS_TS_EXTS' in projectContext), 'JS_TS_EXTS should not be exported from project-context (only used internally)');
  assert.ok(!('normalizeRelativePath' in projectContext), 'normalizeRelativePath should not be exported from project-context (no external importers)');
}

async function testScratchFilesAreNotOrphanModules() {
  const result = await runCliInProcess(['--cwd', '.', '--json', '--quiet', 'audit-overview']);
  assert.ok(result && result.orphans, 'audit-overview should return orphans');

  const moduleSamples = result.orphans.samples?.modules || result.orphans.modules || [];
  const scratchOrphans = moduleSamples.filter((p) => typeof p === 'string' && p.startsWith('scratch/'));
  assert.strictEqual(scratchOrphans.length, 0, `scratch/*.js files should not be reported as orphan modules, got: ${scratchOrphans.join(', ')}`);
  assert.strictEqual(result.orphans.counts?.modules, 0, 'orphans.modules count should be 0 after scratch is archived');
}

async function main() {
  testProjectContextExportsAreMinimal();
  console.log('  PASS testProjectContextExportsAreMinimal');
  await testScratchFilesAreNotOrphanModules();
  console.log('  PASS testScratchFilesAreNotOrphanModules');
  console.log('test/dead-exports-imports-scratch-config-test.js ... PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
