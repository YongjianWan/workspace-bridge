#!/usr/bin/env node
/**
 * Test that FileIndex excludes directories marked as archive/reference/generated
 * in .workspace-bridge.json from indexing.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

async function testArchiveDirExcluded() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-exclude-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'legacy'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'legacy', 'old.js'), 'export const y = 2;\n');
  fs.writeFileSync(
    path.join(root, '.workspace-bridge.json'),
    JSON.stringify({ directories: { archive: ['legacy'] } })
  );

  const cache = new WorkspaceCache(root);
  const index = new FileIndex(root, cache);
  await index.build(30000, { watch: false });

  const files = Array.from(cache.fileMetadata.keys());
  assert.strictEqual(files.length, 1, `expected 1 indexed file, got ${files.length}`);
  assert(files.some((f) => f.includes('app.js')), 'app.js should be indexed');
  assert(!files.some((f) => f.includes('old.js')), 'old.js in archive dir should NOT be indexed');

  fs.rmSync(root, { recursive: true, force: true });
}

async function testReferenceDirExcluded() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-exclude-ref-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'reference'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'reference', 'util.js'), 'export const z = 3;\n');
  fs.writeFileSync(
    path.join(root, '.workspace-bridge.json'),
    JSON.stringify({ directories: { reference: ['reference'] } })
  );

  const cache = new WorkspaceCache(root);
  const index = new FileIndex(root, cache);
  await index.build(30000, { watch: false });

  const files = Array.from(cache.fileMetadata.keys());
  assert.strictEqual(files.length, 1, `expected 1 indexed file, got ${files.length}`);
  assert(!files.some((f) => f.includes('util.js')), 'util.js in reference dir should NOT be indexed');

  fs.rmSync(root, { recursive: true, force: true });
}

async function testGeneratedDirExcluded() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-exclude-gen-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'dist', 'bundle.js'), 'var x=1;\n');
  fs.writeFileSync(
    path.join(root, '.workspace-bridge.json'),
    JSON.stringify({ directories: { generated: ['dist'] } })
  );

  const cache = new WorkspaceCache(root);
  const index = new FileIndex(root, cache);
  await index.build(30000, { watch: false });

  const files = Array.from(cache.fileMetadata.keys());
  assert.strictEqual(files.length, 1, `expected 1 indexed file, got ${files.length}`);
  assert(!files.some((f) => f.includes('bundle.js')), 'bundle.js in generated dir should NOT be indexed');

  fs.rmSync(root, { recursive: true, force: true });
}

async function testActiveDirNotExcluded() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-exclude-act-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const x = 1;\n');
  fs.writeFileSync(
    path.join(root, '.workspace-bridge.json'),
    JSON.stringify({ directories: { active: ['src'] } })
  );

  const cache = new WorkspaceCache(root);
  const index = new FileIndex(root, cache);
  await index.build(30000, { watch: false });

  const files = Array.from(cache.fileMetadata.keys());
  assert.strictEqual(files.length, 1, `expected 1 indexed file, got ${files.length}`);
  assert(files.some((f) => f.includes('app.js')), 'app.js in active dir should be indexed');

  fs.rmSync(root, { recursive: true, force: true });
}

async function main() {
  await testArchiveDirExcluded();
  await testReferenceDirExcluded();
  await testGeneratedDirExcluded();
  await testActiveDirNotExcluded();
  console.log('file-index-exclude-test: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
