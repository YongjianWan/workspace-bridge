#!/usr/bin/env node
// @semantic — however many checks need a source file's text during one analysis pass (entry
// detection, import.meta.glob scan, symbol-usage scans), the file is read once, and never stat-ed
// just to learn its size before reading.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { DependencyGraph } = require('../src/services/dep-graph');
const { LIMITS } = require('../src/config/constants');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function countFsCalls(target, fn) {
  const originals = { readFileSync: fs.readFileSync, openSync: fs.openSync, statSync: fs.statSync };
  const wanted = path.resolve(target).toLowerCase();
  const counts = { reads: 0, stats: 0 };
  const matches = (arg) => typeof arg === 'string' && path.resolve(arg).toLowerCase() === wanted;
  fs.readFileSync = (...args) => { if (matches(args[0])) counts.reads++; return originals.readFileSync.apply(fs, args); };
  fs.openSync = (...args) => { if (matches(args[0])) counts.reads++; return originals.openSync.apply(fs, args); };
  fs.statSync = (...args) => { if (matches(args[0])) counts.stats++; return originals.statSync.apply(fs, args); };
  try {
    fn();
  } finally {
    Object.assign(fs, originals);
  }
  return counts;
}

async function main() {
  const root = makeTempDir('wb-read-once-');
  const cache = new WorkspaceCache(root, { cacheDir: path.join(root, '.cache') });
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"t","version":"1.0.0"}');
    const file = path.join(root, 'loader.js');
    fs.writeFileSync(file, 'const mods = import.meta.glob("./x/*.js");\nexports.load = () => mods;\nexports.spare = () => 1;\n');
    const big = path.join(root, 'big.js');
    fs.writeFileSync(big, `exports.big = 1;\n// ${'x'.repeat(LIMITS.PARSER_MAX_FILE_BYTES)}\n`);
    const graph = new DependencyGraph(root, cache, { quiet: true });
    await graph.build([file, big]);
    const key = [...graph.graph.keys()].find((k) => k.endsWith('loader.js'));
    const bigKey = [...graph.graph.keys()].find((k) => k.endsWith('big.js'));
    // A warm start restores file info without a framework hint, which sends entry detection to the file.
    graph.getFileInfo(file).frameworkHint = null;
    graph.entryDetector._cache.clear();
    graph.analyzer._globPatternsByFile.clear();
    graph.analyzer.clearScanCaches();

    const counts = countFsCalls(file, () => {
      graph.entryDetector.isKnownEntryFile(key);
      graph.analyzer._readImportMetaGlobPatterns(key);
      graph.analyzer._scanLocalSymbolUsage(key, ['spare']);
      graph.analyzer._scanSymbolUsageInImporters([key], ['load'], bigKey);
    });
    assert.strictEqual(counts.reads, 1, `the file was read ${counts.reads} times by four consumers`);
    assert.strictEqual(counts.stats, 0, 'entry detection must not stat the file before reading it');

    // The entry-detection size bound still holds when the text is already cached by another scan.
    graph.entryDetector._cache.clear();
    graph.getFileInfo(big).frameworkHint = null;
    graph.analyzer._scanLocalSymbolUsage(bigKey, ['big']);
    assert.strictEqual(graph.entryDetector.isKnownEntryFile(bigKey), false);
    assert.strictEqual(graph.analyzer._readSource(bigKey, LIMITS.PARSER_MAX_FILE_BYTES), null, 'a file over the cap is not returned to capped readers');
    console.log('source-read-once-test: OK');
  } finally {
    cache.close();
    cleanupTempDir(root);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
