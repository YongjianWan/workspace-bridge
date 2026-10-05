/**
 * Pruning of project-isolated caches whose workspace no longer exists.
 *
 * Each workspace gets <base>/<8 hex chars>/cache.db, and the database records the workspace
 * root it belongs to. A cache is removed only when that recorded root is gone while the drive
 * or mount it lived on is still reachable, and nothing holds the database. Everything else —
 * unreadable databases, caches without a recorded root, roots on unreachable drives, entries
 * that are not cache directories — is reported as unknown and left alone.
 */
const fs = require('fs');
const path = require('path');
const { cacheBaseDirs } = require('./cache');

const CACHE_DIR_NAME = /^[0-9a-f]{8}$/;

function directoryBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    try {
      total += entry.isDirectory() ? directoryBytes(full) : fs.statSync(full).size;
    } catch {
      // A file that disappears while being measured contributes nothing.
    }
  }
  return total;
}

function readRecordedWorkspaceRoot(dbPath) {
  let db = null;
  try {
    const sqlite = require('node:sqlite');
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("SELECT value FROM cache_metadata WHERE key = 'workspaceRoot'").get();
    return row && row.value ? row.value : null;
  } catch {
    // Not a database, an unknown schema, or node:sqlite is unavailable: the owner is unknown.
    return null;
  } finally {
    if (db) db.close();
  }
}

function isLockHeld(lockPath) {
  let content;
  try {
    content = fs.readFileSync(lockPath, 'utf8').trim();
  } catch {
    return false;
  }
  const pid = Number.parseInt(content, 10);
  if (Number.isNaN(pid)) return true; // a lock we cannot read is treated as held
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function classify(dir, workspaceRoot) {
  if (isLockHeld(path.join(dir, 'cache.db.lock'))) return 'in-use';
  if (!workspaceRoot) return 'unknown';
  if (fs.existsSync(workspaceRoot)) return 'active';
  // A missing root only counts as deleted when the drive or share it was on is reachable;
  // an unplugged disk or a disconnected network share makes every path on it look missing.
  return fs.existsSync(path.parse(workspaceRoot).root) ? 'orphaned' : 'unknown';
}

/** Every cache directory under `base` with its recorded workspace, size and status. */
function scanCacheBase(base) {
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !CACHE_DIR_NAME.test(entry.name)) continue;
    const dir = path.join(base, entry.name);
    const dbPath = path.join(dir, 'cache.db');
    if (!fs.existsSync(dbPath)) continue;
    const workspaceRoot = readRecordedWorkspaceRoot(dbPath);
    found.push({ dir, workspaceRoot, bytes: directoryBytes(dir), status: classify(dir, workspaceRoot) });
  }
  return found;
}

/**
 * Report (and with `apply`, remove) the orphaned caches under `base`.
 * @returns {{base: string, scanned: number, candidates: object[], removed: object[], failed: object[]}}
 */
function pruneCacheBase(base, { apply = false } = {}) {
  const scanned = scanCacheBase(base);
  const candidates = scanned.filter((entry) => entry.status === 'orphaned');
  const removed = [];
  const failed = [];
  if (apply) {
    for (const entry of candidates) {
      try {
        fs.rmSync(entry.dir, { recursive: true, force: true });
        removed.push(entry);
      } catch (err) {
        failed.push({ ...entry, error: err.message });
      }
    }
  }
  return { base, scanned: scanned.length, candidates, removed, failed };
}

/** Prune every default cache location (per-user cache dir and the temp fallback). */
function pruneDefaultCaches(options) {
  const { preferred, fallback } = cacheBaseDirs();
  return [...new Set([preferred, fallback])].map((base) => pruneCacheBase(base, options));
}

module.exports = { scanCacheBase, pruneCacheBase, pruneDefaultCaches };
