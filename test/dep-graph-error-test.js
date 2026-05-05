#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { WorkspaceCache } = require('../src/services/cache');

async function testUpdateFilesEmptyArray() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  const cache = new WorkspaceCache(dir);
  const dg = new DependencyGraph(dir, cache);

  // Should not crash on empty array
  await dg.updateFiles([]);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testUpdateFilesDeletedFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), "export const a = 1;\n", 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), "import { a } from './a';\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  // Seed cache with file metadata so dep-graph sees the files
  const aPath = path.join(dir, 'src', 'a.js');
  const bPath = path.join(dir, 'src', 'b.js');
  cache.setFileMetadata(aPath, { mtime: 1, size: 1 });
  cache.setFileMetadata(bPath, { mtime: 1, size: 1 });

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  assert(dg.hasFile(bPath), 'b.js should be in graph after build');

  // Now delete a.js and update
  fs.unlinkSync(aPath);
  await dg.updateFiles([aPath]);

  assert.strictEqual(dg.hasFile(aPath), false);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testAnalyzeFileHandlesMissingFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  const cache = new WorkspaceCache(dir);
  const dg = new DependencyGraph(dir, cache);

  // Should not crash on missing file
  await dg.analyzeFile(path.join(dir, 'missing.js'));
  assert.strictEqual(dg.hasFile(path.join(dir, 'missing.js')), false);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testReentrantUpdateFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'x.js'), "export const x = 1;\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  // Simulate overlapping calls: second should return immediately
  const p1 = dg.updateFiles([path.join(dir, 'src', 'x.js')]);
  const p2 = dg.updateFiles([path.join(dir, 'src', 'x.js')]);
  await Promise.all([p1, p2]);

  // Should complete without deadlock
  assert.strictEqual(dg._updating, false);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testGetStatsLazyCycles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const aPath = path.join(dir, 'src', 'a.js');
  const bPath = path.join(dir, 'src', 'b.js');
  fs.writeFileSync(aPath, "import './b';\nexport const a = 1;\n", 'utf8');
  fs.writeFileSync(bPath, "import './a';\nexport const b = 1;\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  cache.setFileMetadata(aPath, { mtime: 1, size: 1 });
  cache.setFileMetadata(bPath, { mtime: 1, size: 1 });

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  const stats1 = dg.getStats();
  assert.strictEqual(stats1.cycles, 1);

  // After update, cycle count should be recalculated
  fs.writeFileSync(bPath, "export const b = 1;\n", 'utf8');
  // Simulate mtime change so updateFiles does not skip the file
  cache.setFileMetadata(bPath, { mtime: Date.now(), size: 1 });
  await dg.updateFiles([bPath]);

  const stats2 = dg.getStats();
  assert.strictEqual(stats2.cycles, 0);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  await testUpdateFilesEmptyArray();
  await testUpdateFilesDeletedFile();
  await testAnalyzeFileHandlesMissingFile();
  await testReentrantUpdateFiles();
  await testGetStatsLazyCycles();
  console.log('dep-graph-error-test: all passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
