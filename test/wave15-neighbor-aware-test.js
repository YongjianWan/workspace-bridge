#!/usr/bin/env node
// @contract — Neighbor-aware 1-hop 依赖更新校验

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { WorkspaceCache } = require('../src/services/cache');

async function testDependentRelinkedAfterExportChange() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-neighbor-relink-'));
  const fileB = path.join(tmpDir, 'b.js');
  const fileA = path.join(tmpDir, 'a.js');

  // B exports foo
  fs.writeFileSync(fileB, 'export const foo = 1;', 'utf8');
  // A imports foo from B
  fs.writeFileSync(fileA, 'import { foo } from "./b";', 'utf8');

  try {
    const cache = new WorkspaceCache(tmpDir);
    const dg = new DependencyGraph(tmpDir, cache, { quiet: true });

    // Set metadata so graph.build() resolves files
    const statA = fs.statSync(fileA);
    const statB = fs.statSync(fileB);
    cache.setFileMetadata(fileA, { mtime: statA.mtimeMs, size: statA.size });
    cache.setFileMetadata(fileB, { mtime: statB.mtimeMs, size: statB.size });

    await dg.build();

    const keyA = dg.normalizeFilePath(fileA);
    const keyB = dg.normalizeFilePath(fileB);

    assert.ok(dg.graph.has(keyA));
    assert.ok(dg.graph.has(keyB));
    
    // a.js imports b.js
    let infoA = dg.graph.get(keyA);
    assert.deepStrictEqual(infoA.imports, [keyB]);

    // Set a dirty flag on a.js info in graph. If a.js is re-linked, this flag will be wiped out.
    infoA.testFlag = 'dirty';

    // Step 2: Modifying B to export bar instead of foo
    fs.writeFileSync(fileB, 'export const bar = 2;', 'utf8');
    const newStatB = fs.statSync(fileB);
    cache.setFileMetadata(fileB, { mtime: newStatB.mtimeMs, size: newStatB.size });

    // Run updateFiles only for b.js
    await dg.builder.updateFiles([fileB]);

    // a.js should have been re-linked as a dependent, causing its graph entry to be overwritten (thus testFlag is cleared)
    infoA = dg.graph.get(keyA);
    assert.strictEqual(infoA.testFlag, undefined, 'Expected a.js to be re-linked and its graph entry overwritten');
    assert.deepStrictEqual(infoA.imports, [keyB], 'File-level import should still exist as b.js still exists');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function testShadowCandidateOnNewFile() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-neighbor-shadow-'));
  const fileJs = path.join(tmpDir, 'foo.js');
  const fileA = path.join(tmpDir, 'a.js');

  fs.writeFileSync(fileJs, 'export const bar = 1;', 'utf8');
  fs.writeFileSync(fileA, 'import { bar } from "./foo";', 'utf8');

  try {
    const cache = new WorkspaceCache(tmpDir);
    const dg = new DependencyGraph(tmpDir, cache, { quiet: true });

    const statA = fs.statSync(fileA);
    const statJs = fs.statSync(fileJs);
    cache.setFileMetadata(fileA, { mtime: statA.mtimeMs, size: statA.size });
    cache.setFileMetadata(fileJs, { mtime: statJs.mtimeMs, size: statJs.size });

    await dg.build();

    const keyJs = dg.normalizeFilePath(fileJs);
    const keyA = dg.normalizeFilePath(fileA);

    // Initial check: a.js imports foo.js
    let infoA = dg.graph.get(keyA);
    assert.deepStrictEqual(infoA.imports, [keyJs]);

    // Step 2: Add foo.ts, which shadows foo.js (since ts shadows js)
    const fileTs = path.join(tmpDir, 'foo.ts');
    fs.writeFileSync(fileTs, 'export const bar = 1;', 'utf8');
    const statTs = fs.statSync(fileTs);
    cache.setFileMetadata(fileTs, { mtime: statTs.mtimeMs, size: statTs.size });

    // Update with the newly added file
    await dg.builder.updateFiles([fileTs]);

    const keyTs = dg.normalizeFilePath(fileTs);
    // a.js should now be resolved to foo.ts instead of foo.js
    infoA = dg.graph.get(keyA);
    assert.deepStrictEqual(infoA.imports, [keyTs], 'a.js should link to foo.ts due to shadow candidate expansion');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function testDeletedFileCleanup() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-neighbor-delete-'));
  const fileB = path.join(tmpDir, 'b.js');
  const fileA = path.join(tmpDir, 'a.js');

  fs.writeFileSync(fileB, 'export const foo = 1;', 'utf8');
  fs.writeFileSync(fileA, 'import { foo } from "./b";', 'utf8');

  try {
    const cache = new WorkspaceCache(tmpDir);
    const dg = new DependencyGraph(tmpDir, cache, { quiet: true });

    const statA = fs.statSync(fileA);
    const statB = fs.statSync(fileB);
    cache.setFileMetadata(fileA, { mtime: statA.mtimeMs, size: statA.size });
    cache.setFileMetadata(fileB, { mtime: statB.mtimeMs, size: statB.size });

    await dg.build();

    const keyA = dg.normalizeFilePath(fileA);
    const keyB = dg.normalizeFilePath(fileB);

    assert.deepStrictEqual(dg.graph.get(keyA).imports, [keyB]);

    // Step 2: Delete b.js
    fs.unlinkSync(fileB);
    cache.deleteFileMetadata(fileB);

    // Update
    await dg.builder.updateFiles([fileB]);

    // a.js should have its import to b.js cleaned up
    assert.ok(!dg.graph.has(keyB));
    const infoA = dg.graph.get(keyA);
    assert.ok(!infoA.imports.includes(keyB), 'a.js imports should no longer contain b.js key after deleting b.js');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/* -------------------------------------------------------------------------- */
// Runner
/* -------------------------------------------------------------------------- */
const tests = [
  testDependentRelinkedAfterExportChange,
  testShadowCandidateOnNewFile,
  testDeletedFileCleanup,
];

(async () => {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      passed++;
      console.log(`  PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${t.name}: ${err.stack || err.message}`);
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  if (failed > 0) process.exit(1);
  else process.exit(0);
})();
