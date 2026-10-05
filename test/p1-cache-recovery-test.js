// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
async function main() {
  const root = makeTempDir('wb-corrupt-recovery-');
  const cacheDir = path.join(root, 'cache');
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(path.join(cacheDir, 'cache.db'), 'this is not SQLite');
  const cache = new WorkspaceCache(root, { cacheDir });
  const rename = fs.renameSync;
  fs.renameSync = () => { const error = new Error('bad file descriptor'); error.code = 'EBADF'; throw error; };
  try {
    assert.strictEqual(cache.load(), false);
    fs.renameSync = rename;
    assert(cache.ledger.warnings().some(w => w.type === 'cache-load-failed'));
    assert(fs.readdirSync(cacheDir).some(name => name.startsWith('cache.db.corrupt-')), 'corrupt input must be preserved for diagnosis');
    cache.setWorkspaceInfo({ root });
    const file = path.join(root, 'a.js');
    fs.writeFileSync(file, 'module.exports = 1;');
    cache.setFileMetadata(file, { originalPath: file, hash: 'rebuilt-content', mtime: fs.statSync(file).mtimeMs, size: fs.statSync(file).size });
    assert.strictEqual(await cache.save(), true, 'a fresh database must be writable after recovery');
    assert.strictEqual(cache.load(), true, 'recovered database must serve a warm read');
    console.log('cache recovery: 5/5 passed');
  } finally { fs.renameSync = rename; cache.close(); cleanupTempDir(root); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
