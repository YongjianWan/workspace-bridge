// @fast
// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const root = makeTempDir('wb-unsupported-ignored-');
  const cacheDir = makeTempDir('wb-unsupported-cache-');
  const cache = new WorkspaceCache(root, { cacheDir });
  try {
    execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
    fs.writeFileSync(path.join(root, 'app.js'), 'exports.app = 1;');
    fs.writeFileSync(path.join(root, 'Ignored.cs'), 'class Ignored {}');
    fs.writeFileSync(path.join(root, '.gitignore'), '*.cs\n');
    cache.load();
    const index = new FileIndex(root, cache, { quiet: true });
    await index.build(30000, { watch: false });
    assert.strictEqual(index._unsupportedCandidates.length, 1, 'discovery must see the unsupported candidate before gitignore filtering');
    assert.deepStrictEqual(index.unsupportedSourceFiles, []);
    assert(!index.ledger.warnings().some((w) => w.type === 'unsupported-source-files'), 'ignored unsupported files must not produce an empty high warning');

    fs.writeFileSync(path.join(root, '.gitignore'), 'Ignored.cs\n');
    fs.writeFileSync(path.join(root, 'Visible.cs'), 'class Visible {}');
    await index.build(30000, { watch: false });
    const warning = index.ledger.warnings().find((w) => w.type === 'unsupported-source-files');
    assert(warning, 'real unsupported source must still warn');
    assert.strictEqual(warning.files, 1);
    assert.deepStrictEqual(warning.extensions, { '.cs': 1 });
    assert.strictEqual(warning.severity, 'high');
    console.log('unsupported-ignored-warning-test: all passed');
  } finally {
    cache.close();
    cleanupTempDir(root);
    cleanupTempDir(cacheDir);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
