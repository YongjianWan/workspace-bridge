#!/usr/bin/env node
// @fast
// @semantic
/**
 * Cache pruning removes the project-isolated cache of a workspace that no longer exists and
 * nothing else: not a cache whose workspace is still there, not one in use, not one whose
 * workspace cannot be judged, not files that are not cache directories.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { scanCacheBase, pruneCacheBase } = require('../src/services/cache-prune');

const sqlite = require('node:sqlite');

function makeCacheDir(base, hash, workspaceRoot) {
  const dir = path.join(base, hash);
  fs.mkdirSync(dir, { recursive: true });
  const db = new sqlite.DatabaseSync(path.join(dir, 'cache.db'));
  db.exec('CREATE TABLE cache_metadata (key TEXT PRIMARY KEY, value TEXT)');
  if (workspaceRoot !== null) {
    db.prepare('INSERT INTO cache_metadata (key, value) VALUES (?, ?)').run('workspaceRoot', workspaceRoot);
  }
  db.close();
  return dir;
}

const sandbox = makeTempDir('wb-cache-prune-');
try {
  const base = path.join(sandbox, 'cache-base');
  const liveWorkspace = path.join(sandbox, 'live-project');
  fs.mkdirSync(liveWorkspace);

  const active = makeCacheDir(base, 'aaaaaaaa', liveWorkspace);
  const orphan = makeCacheDir(base, 'bbbbbbbb', path.join(sandbox, 'deleted-project'));
  const inUse = makeCacheDir(base, 'cccccccc', path.join(sandbox, 'deleted-while-running'));
  fs.writeFileSync(path.join(inUse, 'cache.db.lock'), String(process.pid));
  const noRoot = makeCacheDir(base, 'dddddddd', null);
  const notHashName = makeCacheDir(base, 'keep-me', path.join(sandbox, 'deleted-project-2'));
  fs.mkdirSync(path.join(base, 'eeeeeeee'));
  fs.writeFileSync(path.join(base, 'eeeeeeee', 'notes.txt'), 'not a cache');
  fs.writeFileSync(path.join(base, 'stray-file'), 'x');
  const corrupt = path.join(base, 'ffffffff');
  fs.mkdirSync(corrupt);
  fs.writeFileSync(path.join(corrupt, 'cache.db'), 'this is not a database');
  const unreachable = process.platform === 'win32' ? 'Q:' + String.fromCharCode(92) + 'unmounted' + String.fromCharCode(92) + 'proj' : null;
  const unreachableDir = unreachable && !fs.existsSync('Q:' + String.fromCharCode(92)) ? makeCacheDir(base, '11111111', unreachable) : null;

  const scan = Object.fromEntries(scanCacheBase(base).map((e) => [path.basename(e.dir), e.status]));
  assert.deepStrictEqual(scan, {
    aaaaaaaa: 'active',
    bbbbbbbb: 'orphaned',
    cccccccc: 'in-use',
    dddddddd: 'unknown',
    ffffffff: 'unknown',
    ...(unreachableDir ? { 11111111: 'unknown' } : {}),
  }, 'only hash-named directories holding cache.db are cache directories');

  const orphanEntry = scanCacheBase(base).find((e) => e.dir === orphan);
  assert.strictEqual(orphanEntry.workspaceRoot, path.join(sandbox, 'deleted-project'));
  assert(orphanEntry.bytes > 0, 'size is reported');

  // Dry run changes nothing.
  const dry = pruneCacheBase(base, { apply: false });
  assert.deepStrictEqual(dry.removed, []);
  assert.deepStrictEqual(dry.candidates.map((e) => path.basename(e.dir)), ['bbbbbbbb']);
  assert(fs.existsSync(orphan), 'dry run keeps the orphan');

  const applied = pruneCacheBase(base, { apply: true });
  assert.deepStrictEqual(applied.removed.map((e) => path.basename(e.dir)), ['bbbbbbbb']);
  assert(!fs.existsSync(orphan), 'orphaned cache is removed');
  for (const kept of [active, inUse, noRoot, notHashName, path.join(base, 'eeeeeeee'), path.join(base, 'stray-file'), corrupt, liveWorkspace]) {
    assert(fs.existsSync(kept), `${path.basename(kept)} must be kept`);
  }
  if (unreachableDir) assert(fs.existsSync(unreachableDir), 'a workspace on an unmounted drive is not judged');

  // A base directory that does not exist is an empty result, not an error.
  assert.deepStrictEqual(scanCacheBase(path.join(sandbox, 'nowhere')), []);
} finally {
  cleanupTempDir(sandbox);
}
