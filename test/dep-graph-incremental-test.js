#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { DependencyGraph } = require('../src/services/dep-graph');
const { WorkspaceCache } = require('../src/services/cache');

async function testIncrementalUpdateChangesImports() {
  const root = makeTempDir('wb-inc-');
  const write = (rel, content) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  try {
    write('src/b.js', 'export function helper() { return 1; }\n');
    write('src/a.js', 'import { helper } from "./b";\nexport function run() { return helper(); }\n');
    write('src/c.js', 'import { run } from "./a";\nexport function main() { return run(); }\n');

    const cache = new WorkspaceCache(root);
    const graph = new DependencyGraph(root, cache, {});

    const files = ['src/a.js', 'src/b.js', 'src/c.js'].map((f) => path.join(root, f));
    for (const file of files) {
      const stats = fs.statSync(file);
      cache.setFileMetadata(file, { mtime: stats.mtimeMs, size: stats.size });
    }

    await graph.build();

    const bKey = graph.normalizeFilePath(path.join(root, 'src/b.js'));
    const aKey = graph.normalizeFilePath(path.join(root, 'src/a.js'));
    const cKey = graph.normalizeFilePath(path.join(root, 'src/c.js'));

    assert.deepStrictEqual(graph.getDependents(bKey).sort(), [aKey].sort());
    assert.deepStrictEqual(graph.getDependents(aKey).sort(), [cKey].sort());

    write('src/d.js', 'export function newHelper() { return 2; }\n');
    write('src/a.js', 'import { newHelper } from "./d";\nexport function run() { return newHelper(); }\n');

    const newStatsA = fs.statSync(path.join(root, 'src/a.js'));
    const newStatsD = fs.statSync(path.join(root, 'src/d.js'));
    cache.setFileMetadata(path.join(root, 'src/a.js'), { mtime: newStatsA.mtimeMs, size: newStatsA.size });
    cache.setFileMetadata(path.join(root, 'src/d.js'), { mtime: newStatsD.mtimeMs, size: newStatsD.size });

    await graph.updateFiles([path.join(root, 'src/a.js'), path.join(root, 'src/d.js')]);

    assert.deepStrictEqual(graph.getDependents(bKey).sort(), []);
    const dKey = graph.normalizeFilePath(path.join(root, 'src/d.js'));
    assert.deepStrictEqual(graph.getDependents(dKey).sort(), [aKey].sort());
    assert.deepStrictEqual(graph.getDependents(aKey).sort(), [cKey].sort());

    const aInfo = graph.getFileInfo(aKey);
    assert(aInfo.imports.includes(dKey));
    assert(!aInfo.imports.includes(bKey));
  } finally {
    cleanupTempDir(root);
  }
}

async function testIncrementalUpdateSkipsUnchanged() {
  const root = makeTempDir('wb-inc-skip-');
  const write = (rel, content) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  try {
    write('src/x.js', 'export function x() { return 1; }\n');
    write('src/y.js', 'import { x } from "./x";\nexport function y() { return x(); }\n');

    const cache = new WorkspaceCache(root);
    const graph = new DependencyGraph(root, cache, {});

    const files = ['src/x.js', 'src/y.js'].map((f) => path.join(root, f));
    for (const file of files) {
      const stats = fs.statSync(file);
      cache.setFileMetadata(file, { mtime: stats.mtimeMs, size: stats.size });
    }

    await graph.build();

    const xKey = graph.normalizeFilePath(path.join(root, 'src/x.js'));
    const yKey = graph.normalizeFilePath(path.join(root, 'src/y.js'));

    await graph.updateFiles(files);

    assert.deepStrictEqual(graph.getDependents(xKey).sort(), [yKey].sort());
    assert(cache.hasParseResult(path.join(root, 'src/x.js')));
    assert(cache.hasParseResult(path.join(root, 'src/y.js')));
  } finally {
    cleanupTempDir(root);
  }
}

async function testIncrementalUpdateDeletesFile() {
  const root = makeTempDir('wb-inc-del-');
  const write = (rel, content) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  try {
    write('src/m.js', 'export function m() { return 1; }\n');
    write('src/n.js', 'import { m } from "./m";\nexport function n() { return m(); }\n');

    const cache = new WorkspaceCache(root);
    const graph = new DependencyGraph(root, cache, {});

    const mFile = path.join(root, 'src/m.js');
    const nFile = path.join(root, 'src/n.js');
    const files = [mFile, nFile];
    for (const file of files) {
      const stats = fs.statSync(file);
      cache.setFileMetadata(file, { mtime: stats.mtimeMs, size: stats.size });
    }

    await graph.build();

    const mKey = graph.normalizeFilePath(mFile);
    const nKey = graph.normalizeFilePath(nFile);

    fs.unlinkSync(mFile);
    cache.deleteFileMetadata(mFile);

    await graph.updateFiles([mFile]);

    assert.strictEqual(graph.hasFile(mKey), false);
    assert.strictEqual(cache.hasParseResult(mFile), false);
    assert.strictEqual(graph.hasFile(nKey), true);
    // P102: deleted file's incoming edges cleaned up — n.js no longer references m.js
    const nInfo = graph.getFileInfo(nKey);
    assert(!nInfo.imports.includes(mKey), 'n should no longer reference m after deletion');
    assert(!nInfo.importRecords.some((r) => r.resolved === mKey), 'n importRecords should not contain m');
    assert.deepStrictEqual(graph.getDependents(mKey), []);
    assert(!graph.reverseGraph.has(mKey), 'reverseGraph should not have deleted file key');
  } finally {
    cleanupTempDir(root);
  }
}

async function main() {
  console.log('=== dep-graph incremental update test ===');
  await testIncrementalUpdateChangesImports();
  await testIncrementalUpdateSkipsUnchanged();
  await testIncrementalUpdateDeletesFile();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
