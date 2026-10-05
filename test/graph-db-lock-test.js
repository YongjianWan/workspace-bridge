#!/usr/bin/env node
// @fast
// @semantic
/**
 * Two cache writers must never both believe they hold the lock, and a writer that meets a busy
 * database must wait for it instead of failing on the first collision.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { GraphDB, acquireLockSync, releaseLockSync } = require('../src/services/graph-db');

const SECOND_MS = 1000;
const root = makeTempDir('wb-graph-db-lock-');
try {
  // A lock file that has just been created is still empty until its owner writes its pid. It
  // is a lock being taken, not a stale one.
  const lockPath = path.join(root, 'young.lock');
  fs.writeFileSync(lockPath, '');
  assert.throws(() => acquireLockSync(lockPath, 300, 50), /timed out/, 'a young empty lock must be waited on');
  assert(fs.existsSync(lockPath), 'a young empty lock must not be deleted');

  // An empty lock that has been empty for a while was abandoned mid-creation.
  const old = new Date(Date.now() - 10 * SECOND_MS);
  fs.utimesSync(lockPath, old, old);
  assert.strictEqual(acquireLockSync(lockPath, 1000, 50), true, 'an old empty lock is taken over');
  assert.strictEqual(fs.readFileSync(lockPath, 'utf8').trim(), String(process.pid));
  releaseLockSync(lockPath);
  assert(!fs.existsSync(lockPath), 'released lock disappears');

  // A lock whose owner is gone is taken over at once.
  fs.writeFileSync(lockPath, '2147483646');
  assert.strictEqual(acquireLockSync(lockPath, 1000, 50), true);
  releaseLockSync(lockPath);

  // The connection waits for a busy database.
  const dbPath = path.join(root, 'cache.db');
  const db = new GraphDB(dbPath);
  db._ensureOpen();
  const waitMs = db.db.prepare('PRAGMA busy_timeout').get().timeout;
  assert(waitMs >= SECOND_MS, `busy_timeout must give a concurrent writer time to finish, got ${waitMs}`);
  db.db.close();

  // Behaviour, not just the setting: a second connection that starts writing while the first
  // holds the write lock for 700 ms succeeds instead of failing with SQLITE_BUSY.
  const holder = `
    const { GraphDB } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'services', 'graph-db'))});
    const db = new GraphDB(process.argv[1]); db._ensureOpen();
    db.db.exec('BEGIN IMMEDIATE');
    process.stdout.write('locked');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
    db.db.exec('COMMIT');`;
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, ['-e', holder, dbPath], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.once('data', () => {
    const writer = spawnSync(process.execPath, ['-e', `
      const { GraphDB } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'services', 'graph-db'))});
      const db = new GraphDB(process.argv[1]); db._ensureOpen();
      db.db.exec('BEGIN IMMEDIATE'); db.db.exec('COMMIT');`, dbPath], { encoding: 'utf8', timeout: 20 * SECOND_MS });
    assert.strictEqual(writer.status, 0, `second writer must wait, not fail: ${writer.stderr}`);
  });
  child.on('exit', (code) => assert.strictEqual(code, 0));
} finally {
  process.on('exit', () => cleanupTempDir(root));
}
