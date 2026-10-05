#!/usr/bin/env node
// @fast
// @semantic
/**
 * Windows paths are case-insensitive but fs.realpath keeps the case it was given. Two junctions
 * to the same directory spelled with different case must not make the walk list its files twice.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

if (process.platform !== 'win32') {
  console.log('skipped: case-insensitive file systems only');
  process.exit(0);
}

async function main() {
  const root = makeTempDir('wb-case-alias-');
  try {
    const real = path.join(root, 'real');
    fs.mkdirSync(path.join(real, 'src'), { recursive: true });
    fs.writeFileSync(path.join(real, 'src', 'a.js'), 'module.exports = 1;\n');
    const target = path.join(real, 'src');
    fs.symlinkSync(target, path.join(root, 'alias-exact'), 'junction');
    fs.symlinkSync(target.toUpperCase(), path.join(root, 'alias-upper'), 'junction');

    const index = new FileIndex(root, new WorkspaceCache(root, { cacheDir: path.join(root, '.wb-cache') }));
    index._extSet = new Set(['.js']); // normally set by build(); the walk is exercised on its own here
    const found = [];
    for await (const file of index.findFilesAsync(root, 12, new AbortController().signal)) found.push(file);
    const listed = found.filter((f) => path.basename(f) === 'a.js');
    assert.strictEqual(listed.length, 1, `a.js reached through ${listed.length} aliases: ${listed.join(' | ')}`);
  } finally {
    cleanupTempDir(root);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
