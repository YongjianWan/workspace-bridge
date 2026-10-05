/**
 * GraphDB - SQLite-backed persistence for WorkspaceCache
 *
 * Replaces JSON file serialization with SQLite WAL-mode database.
 * Provides bulk load/save for cache metadata, file metadata, parse results,
 * symbol index, and diagnostics.
 */
const fs = require('fs');
const path = require('path');
const { CACHE_VERSION } = require('../config/constants');
const { failure } = require('../utils/failure');

// Quoted data and comments must not trigger keyword or statement checks.
const SQL_NON_CODE = /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:\]\]|[^\]])*\]|--[^\r\n]*|\/\*[\s\S]*?\*\//g;

const CACHE_TABLE_SCHEMA = {
  file_metadata: {
    resultKey: 'fileMetadata',
    incrementalKeys: { dirty: 'dirtyFiles', deleted: 'deletedFiles' },
    idColumn: 'path',
    columns: ['path', 'mtime', 'size', 'hash', 'line_count', 'original_path', 'type', 'role', 'lang'],
    serialize: (path, meta) => [
      path,
      meta.mtime ?? 0,
      meta.size ?? 0,
      meta.hash ?? '',
      meta.lineCount ?? 0,
      meta.originalPath || null,
      meta.type || 'source',
      meta.role || null,
      meta.lang || null,
    ],
    deserialize: (row) => ({
      mtime: Number(row.mtime),
      size: Number(row.size),
      hash: row.hash,
      lineCount: Number(row.line_count),
      originalPath: row.original_path,
      type: row.type || 'source',
      role: row.role || null,
      lang: row.lang || null,
    }),
  },
  // What a parser extracted from one file's content, before import
  // resolution. Valid exactly while the content hash matches: resolution
  // depends on which other files exist, so it is never stored here.
  parse_results: {
    resultKey: 'parseResults',
    incrementalKeys: { dirty: 'dirtyParseResults', deleted: 'deletedParseResults' },
    idColumn: 'path',
    columns: ['path', 'hash', 'imports', 'exports', 'import_records', 'export_records', 'function_records', 'parse_mode', 'parse_mode_reason', 'confidence', 'framework_hint', 'routes', 'package', 'implicit_sources'],
    serialize: (path, result) => [
      path,
      result.hash || '',
      JSON.stringify(result.imports || []),
      JSON.stringify(result.exports || []),
      JSON.stringify(result.importRecords || []),
      JSON.stringify(result.exportRecords || []),
      JSON.stringify(result.functionRecords || []),
      result.parseMode || '',
      result.parseModeReason || '',
      result.confidence || '',
      result.frameworkHint ? JSON.stringify(result.frameworkHint) : null,
      JSON.stringify(result.routes || []),
      result.package ?? null,
      JSON.stringify(result.implicitSources || []),
    ],
    deserialize: (row) => ({
      hash: row.hash || '',
      implicitSources: row.implicit_sources ? JSON.parse(row.implicit_sources) : [],
      imports: row.imports ? JSON.parse(row.imports) : [],
      exports: row.exports ? JSON.parse(row.exports) : [],
      importRecords: row.import_records ? JSON.parse(row.import_records) : [],
      exportRecords: row.export_records ? JSON.parse(row.export_records) : [],
      functionRecords: row.function_records ? JSON.parse(row.function_records) : [],
      parseMode: row.parse_mode,
      parseModeReason: row.parse_mode_reason,
      confidence: row.confidence,
      frameworkHint: row.framework_hint ? JSON.parse(row.framework_hint) : null,
      routes: row.routes ? JSON.parse(row.routes) : [],
      package: row.package ?? null,
    }),
  },
  symbol_index: {
    resultKey: 'symbolIndex',
    incrementalKeys: { dirty: 'dirtySymbols', deleted: 'deletedSymbols' },
    idColumn: 'name',
    columns: ['name', 'locations'],
    serialize: (name, locations) => [
      name,
      JSON.stringify(locations || []),
    ],
    deserialize: (row) => (row.locations ? JSON.parse(row.locations) : []),
  },
  diagnostics: {
    resultKey: 'diagnostics',
    incrementalKeys: { dirty: 'dirtyDiagnostics', deleted: 'deletedDiagnostics' },
    idColumn: 'path',
    columns: ['path', 'data'],
    serialize: (path, entry) => [
      path,
      JSON.stringify(entry || { diagnostics: [] }),
    ],
    deserialize: (row) => (row.data ? JSON.parse(row.data) : { diagnostics: [] }),
  },
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS cache_metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS file_metadata (
    path TEXT PRIMARY KEY,
    mtime INTEGER,
    size INTEGER,
    hash TEXT,
    line_count INTEGER,
    original_path TEXT,
    type TEXT NOT NULL DEFAULT 'source',
    role TEXT,
    lang TEXT
  );

  CREATE TABLE IF NOT EXISTS parse_results (
    path TEXT PRIMARY KEY,
    hash TEXT NOT NULL DEFAULT '',
    imports TEXT,
    exports TEXT,
    import_records TEXT,
    export_records TEXT,
    function_records TEXT,
    parse_mode TEXT,
    parse_mode_reason TEXT,
    confidence TEXT,
    framework_hint TEXT,
    routes TEXT,
    package TEXT,
    implicit_sources TEXT
  );

  CREATE TABLE IF NOT EXISTS symbol_index (
    name TEXT PRIMARY KEY,
    locations TEXT
  );

  CREATE TABLE IF NOT EXISTS diagnostics (
    path TEXT PRIMARY KEY,
    data TEXT
  );

  CREATE TABLE IF NOT EXISTS analysis_snapshots (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    version TEXT NOT NULL,
    file_count INTEGER NOT NULL,
    config_hash TEXT NOT NULL DEFAULT '',
    computed_at INTEGER NOT NULL DEFAULT 0,
    cache_version INTEGER NOT NULL DEFAULT 0,
    -- Fingerprint of the indexed file set (path|content hash). Freshness
    -- needs it because git head, file count and config all survive an in-place
    -- edit. '' means "written before this column existed" → unverifiable →
    -- recompute. _migrate() adds it to pre-existing databases.
    content_signature TEXT NOT NULL DEFAULT ''
  );
`;

const OBSOLETE_TABLES = ['edges', 'precomputed_aggregates', 'precomputed_impact', 'routes', 'metrics', 'test_map'];

function _debugError(label, err) {
  if (process.env.DEBUG) {
    console.error(`[GraphDB] ${label} failed:`, err?.message || err);
  }
}

/**
 * Temporarily intercept process.emitWarning to swallow the node:sqlite
 * ExperimentalWarning, then immediately restore the original function.
 *
 * This avoids the previous global monkey-patch that remained active for the
 * lifetime of GraphDB instances and leaked into embedded / multi-instance use.
 */
function _withSqliteWarningSuppressed(fn) {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = (warning, name, ctor) => {
    const msg = typeof warning === 'string' ? warning : warning.message;
    const type = typeof warning === 'string' ? name : warning.name;
    if (type === 'ExperimentalWarning' && msg?.toLowerCase().includes('sqlite')) return;
    originalEmitWarning.call(process, warning, name, ctor);
  };
  try {
    return fn();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

let _sqliteUnavailableWarned = false;
function _warnSqliteUnavailableOnce() {
  if (_sqliteUnavailableWarned) return;
  _sqliteUnavailableWarned = true;
  console.error(
    '[workspace-bridge] node:sqlite is not available in this Node.js runtime: ' +
    'persistent cache disabled, every run is a cold start. ' +
    'Upgrade to Node.js >= 22.13.0.'
  );
}

function acquireLockSync(lockPath, timeoutMs = 5000, retryIntervalMs = 100) {
  const start = Date.now();
  const dir = path.dirname(lockPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const content = fs.readFileSync(lockPath, 'utf8').trim();
          const pid = Number.parseInt(content, 10);
          if (Number.isNaN(pid) || content.length === 0) {
            try {
              fs.unlinkSync(lockPath);
            } catch {}
            continue; // retry
          }
          let processExists = true;
          try {
            process.kill(pid, 0);
          } catch (killErr) {
            processExists = killErr.code === 'EPERM';
          }
          if (!processExists) {
            try {
              fs.unlinkSync(lockPath);
            } catch {}
            continue; // retry
          }
        } catch {}
      } else {
        throw err;
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Lock acquisition timed out after ${timeoutMs}ms: ${lockPath}`);
    }
    const delay = Math.min(retryIntervalMs, timeoutMs - (Date.now() - start));
    if (delay <= 0) {
      throw new Error(`Lock acquisition timed out after ${timeoutMs}ms: ${lockPath}`);
    }
    const sab = new SharedArrayBuffer(4);
    const int32 = new Int32Array(sab);
    Atomics.wait(int32, 0, 0, delay);
  }
}

function releaseLockSync(lockPath) {
  try {
    const content = fs.readFileSync(lockPath, 'utf8').trim();
    const pid = Number.parseInt(content, 10);
    if (pid === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch {}
}

function _runWithReadRetry(fn) {
  let retries = 3;
  let delay = 50;
  while (true) {
    try {
      return fn();
    } catch (err) {
      const isBusy = err.message?.includes('BUSY') || err.message?.includes('locked') || err.code === 'EBUSY';
      if (isBusy && retries > 0 && process.platform === 'win32') {
        retries--;
        const sab = new SharedArrayBuffer(4);
        const int32 = new Int32Array(sab);
        Atomics.wait(int32, 0, 0, delay);
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
}

class GraphDB {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.lockPath = `${dbPath}.lock`;
  }

  _withWriteLock(fn) {
    acquireLockSync(this.lockPath);
    try {
      const result = fn();
      this._stampVersionIfUnset();
      return result;
    } finally {
      releaseLockSync(this.lockPath);
    }
  }

  /**
   * Give an unstamped database its provenance, once.
   *
   * The read gate rejects anything whose stamp is not the current
   * CACHE_VERSION, and "no stamp at all" must not be a way in. A database that
   * only ever received partial writes (setMetadata / saveAnalysisSnapshot
   * without a full save) had no stamp, so without this its own rows would
   * be unreadable by the process that just wrote them.
   *
   * Deliberately *if unset*: a stamp that exists but differs marks a database
   * written under other semantics. Overwriting it would re-open the gate onto
   * rows this build cannot interpret — which is the exact failure this whole
   * mechanism exists to prevent. Such a database becomes readable only after a
   * full rebuild, because saveAll clears every table and re-stamps.
   */
  _stampVersionIfUnset() {
    if (!this.db) return;
    try {
      const row = this.db.prepare("SELECT value FROM cache_metadata WHERE key = 'version'").get();
      if (row === undefined) {
        this.db.prepare("INSERT INTO cache_metadata (key, value) VALUES ('version', ?)").run(String(CACHE_VERSION));
      }
    } catch (err) {
      _debugError('Stamp cache version', err);
    }
  }

  /**
   * node:sqlite became a usable builtin in Node 22.13. On older runtimes the
   * require throws ERR_UNKNOWN_BUILTIN_MODULE and every read silently degrades
   * to a cache miss while writes go nowhere: the cache directory stays empty
   * and every run is a cold start, with no hint why. Surface that once
   * instead of letting it fail silently.
   */
  _loadSqlite() {
    try {
      return _withSqliteWarningSuppressed(() => require('node:sqlite'));
    } catch (err) {
      const isMissingBuiltin = err && err.code === 'ERR_UNKNOWN_BUILTIN_MODULE' && /node:sqlite/.test(String(err.message));
      if (isMissingBuiltin) {
        _warnSqliteUnavailableOnce();
      }
      throw err;
    }
  }

  _ensureOpen() {
    if (this.db) return;
    _runWithReadRetry(() => {
      const sqlite = this._loadSqlite();
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = _withSqliteWarningSuppressed(() => new sqlite.DatabaseSync(this.dbPath));
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA journal_size_limit = 67108864'); // 64MB — auto-checkpoint, prevent unbounded WAL growth
      this.db.exec('PRAGMA mmap_size = 268435456');          // 256MB — memory-map hot pages, reduce read syscalls
      this.db.exec('PRAGMA synchronous = NORMAL');           // WAL mode: NORMAL is crash-safe and faster than FULL
      this.db.exec(SCHEMA);
      this._migrate();
    });
  }

  /**
   * True when the database on disk was written by this build's CACHE_VERSION.
   *
   * Deliberately queried per read rather than cached on the connection: another
   * process may rebuild the cache underneath us, and a cached "current" would
   * then serve rows written under semantics we no longer speak.
   */
  _isStoredVersionCurrent() {
    const row = this.db.prepare("SELECT value FROM cache_metadata WHERE key = 'version'").get();
    // No stamp is not a mismatch. Every write path stamps an unstamped
    // database (see _stampVersionIfUnset), so the only way to observe a
    // missing stamp is an empty database — nothing to serve, nothing to
    // misinterpret. Rejecting it would turn "fresh cache" into "null" and
    // break the loadXxx-returns-[] contract on a cold directory.
    if (row === undefined) return true;
    return Number(row.value || 0) === CACHE_VERSION;
  }

  /**
   * The single choke point every table read must pass through.
   *
   * A version mismatch does not clear the tables, so any loadXxx reading its
   * table raw would serve stale rows. Enforcing the gate here means a new
   * loadXxx cannot forget it — it inherits it.
   *
   * Reads fall back to a miss rather than wiping rows: a concurrent process may
   * be mid-write, and a rebuild re-stamps the version anyway (see saveAll).
   *
   * @param {string} label — debug label
   * @param {() => any} fn — the actual read, run only when the version matches
   * @param {any} fallback — value meaning "cache miss" for this call site
   */
  _readGuard(label, fn, fallback = null) {
    this.lastError = null;
    return _runWithReadRetry(() => {
      try {
        this._ensureOpen();
        if (!this._isStoredVersionCurrent()) return fallback;
        return fn();
      } catch (err) {
        this.lastError = err;
        _debugError(label, err);
        return fallback;
      }
    });
  }

  _executeInTransaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        throw new Error('_executeInTransaction does not support async functions');
      }
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch (rollbackErr) {
        err.rollbackError = rollbackErr.message;
      }
      throw err;
    }
  }

  _migrate() {
    if (!this.db) return;
    this._executeInTransaction(() => {
      const cols = this.db.prepare('PRAGMA table_info(file_metadata)').all();
      const hasOriginalPath = cols.some((c) => c.name === 'original_path');
      if (!hasOriginalPath) {
        this.db.prepare('ALTER TABLE file_metadata ADD COLUMN original_path TEXT').run();
      }
      const hasType = cols.some((c) => c.name === 'type');
      if (!hasType) {
        this.db.prepare("ALTER TABLE file_metadata ADD COLUMN type TEXT NOT NULL DEFAULT 'source'").run();
        this.db.prepare('ALTER TABLE file_metadata ADD COLUMN role TEXT').run();
        this.db.prepare('ALTER TABLE file_metadata ADD COLUMN lang TEXT').run();
      }
      // Graph-level results are recomputed every run from parse results; the
      // tables that used to hold them only take disk space in older caches.
      for (const table of OBSOLETE_TABLES) {
        this.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
      }
      // A parse_results table without the content-hash key stored resolved
      // imports keyed by mtime. Its rows cannot be reinterpreted, only redone.
      const parseCols = this.db.prepare('PRAGMA table_info(parse_results)').all();
      if (!parseCols.some((c) => c.name === 'hash') || !parseCols.some((c) => c.name === 'implicit_sources')) {
        this.db.prepare('DROP TABLE IF EXISTS parse_results').run();
        this.db.exec(SCHEMA);
      }
      // v6: stamp analysis_snapshots rows with the CACHE_VERSION they were
      // computed under. analysis_snapshots survives the version-mismatch
      // discard (loadAll returns null but deletes nothing), so without a
      // per-row gate a version bump lets buildProjectOverview / query-*
      // short-circuit on snapshots computed under obsolete semantics.
      // DEFAULT 0 intentionally invalidates all pre-migration rows.
      const snapshotCols = this.db.prepare('PRAGMA table_info(analysis_snapshots)').all();
      if (snapshotCols.length > 0 && !snapshotCols.some((c) => c.name === 'cache_version')) {
        this.db.prepare('ALTER TABLE analysis_snapshots ADD COLUMN cache_version INTEGER NOT NULL DEFAULT 0').run();
      }
      // Content_signature makes a snapshot invalidate on an in-place
      // edit, which moves no git head, no file count and no config. Its own
      // column on purpose — folding it into config_hash would also invalidate
      // query-*, which deliberately trades content freshness for speed.
      // DEFAULT '' marks pre-migration rows as unverifiable, so they recompute.
      if (snapshotCols.length > 0 && !snapshotCols.some((c) => c.name === 'content_signature')) {
        this.db.prepare("ALTER TABLE analysis_snapshots ADD COLUMN content_signature TEXT NOT NULL DEFAULT ''").run();
      }

    });
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch (_) {
        // Best effort
      }
      this.db = null;
    }
  }

  walCheckpoint(mode) {
    try {
      this._ensureOpen();
      this.db.exec(`PRAGMA wal_checkpoint(${mode});`);
      return true;
    } catch (err) {
      _debugError(`WAL Checkpoint ${mode}`, err);
      return false;
    }
  }

  getMetadata(key) {
    return _runWithReadRetry(() => {
      try {
        this._ensureOpen();
        const row = this.db.prepare('SELECT value FROM cache_metadata WHERE key = ?').get(key);
        return row ? row.value : null;
      } catch {
        return null;
      }
    });
  }

  setMetadata(key, value) {
    return this._withWriteLock(() => {
      try {
        this._ensureOpen();
        this.db.prepare('INSERT OR REPLACE INTO cache_metadata (key, value) VALUES (?, ?)').run(key, value);
        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * Load all cache data from SQLite into memory structures.
   * Returns null on any error (caller should treat as cold start).
   */
  loadAll() {
    return this._readGuard('Load all', () => {
      {
        // Metadata
        const metaRows = this.db.prepare('SELECT key, value FROM cache_metadata').all();
        const metadata = {};
        for (const row of metaRows) {
          metadata[row.key] = row.value;
        }

        // Only saveAll / saveIncremental write 'timestamp'. Without it this
        // database never received a full save — it is a directory that happens
        // to contain some tables (or nothing at all), not a cache. Callers must
        // treat that as a cold start, not as a successful empty load.
        if (metadata.timestamp === undefined) return null;

        // Version mismatch is rejected by _readGuard before this body runs;
        // the stamp is read here only to report it back to the caller.
        const version = Number(metadata.version || 0);

        const workspaceInfo = metadata.workspaceInfo ? JSON.parse(metadata.workspaceInfo) : null;
        const workspaceRoot = metadata.workspaceRoot || null;
        const timestamp = Number(metadata.timestamp || 0);

        const result = {
          version,
          workspaceInfo,
          workspaceRoot,
          timestamp,
          _metadata: metadata, // raw metadata for schema-driven loading
        };

        for (const [tableName, schema] of Object.entries(CACHE_TABLE_SCHEMA)) {
          const columns = schema.columns.join(', ');
          const rows = this.db.prepare(`SELECT ${columns} FROM ${tableName}`).all();
          const map = new Map();
          for (const row of rows) {
            map.set(row[schema.idColumn], schema.deserialize(row));
          }
          result[schema.resultKey] = map;
        }

        return result;
      }
    }, null);
  }

  /**
   * Save all cache data to SQLite in a single transaction.
   */
  saveAll(data) {
    return this._withWriteLock(() => {
      try {
        this._ensureOpen();

        this._executeInTransaction(() => {
          // Clear all tables via schema registry
          this.db.prepare('DELETE FROM cache_metadata').run();
          for (const tableName of Object.keys(CACHE_TABLE_SCHEMA)) {
            this.db.prepare(`DELETE FROM ${tableName}`).run();
          }

          // Insert metadata
          const insertMeta = this.db.prepare('INSERT INTO cache_metadata (key, value) VALUES (?, ?)');
          insertMeta.run('version', String(CACHE_VERSION));
          insertMeta.run('timestamp', String(Date.now()));
          insertMeta.run('workspaceRoot', data.workspaceRoot || '');
          insertMeta.run('workspaceInfo', data.workspaceInfo ? JSON.stringify(data.workspaceInfo) : '');

          if (data.metadata) {
            for (const [key, value] of Object.entries(data.metadata)) {
              insertMeta.run(key, value);
            }
          }

          // Schema-driven table inserts — add a table to CACHE_TABLE_SCHEMA and it saves automatically
          for (const [tableName, schema] of Object.entries(CACHE_TABLE_SCHEMA)) {
            const columns = schema.columns.join(', ');
            const placeholders = schema.columns.map(() => '?').join(', ');
            const insert = this.db.prepare(`INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`);
            const map = data[schema.resultKey];
            if (!map) continue;
            for (const [id, value] of map) {
              insert.run(...schema.serialize(id, value));
            }
          }
        });

        return true;
      } catch (err) {
        _debugError('Save', err);
        return false;
      }
    });
  }

  /**
   * Save dirty/deleted cache data to SQLite incrementally in a single transaction.
   */
  saveIncremental(data) {
    return this._withWriteLock(() => {
      try {
        this._ensureOpen();

        let hasWork = data.metadata && Object.keys(data.metadata).length > 0;
        if (!hasWork) {
          for (const schema of Object.values(CACHE_TABLE_SCHEMA)) {
            const { dirty, deleted } = schema.incrementalKeys || {};
            if ((deleted && data[deleted]?.length > 0) || (dirty && data[dirty]?.length > 0)) {
              hasWork = true;
              break;
            }
          }
        }
        if (!hasWork) {
          return true;
        }

        this._executeInTransaction(() => {
          // 1. Metadata
          const insertMeta = this.db.prepare('INSERT OR REPLACE INTO cache_metadata (key, value) VALUES (?, ?)');
          insertMeta.run('version', String(CACHE_VERSION));
          insertMeta.run('timestamp', String(Date.now()));
          if (data.workspaceRoot !== undefined) {
            insertMeta.run('workspaceRoot', data.workspaceRoot || '');
          }
          if (data.workspaceInfo !== undefined) {
            insertMeta.run('workspaceInfo', data.workspaceInfo ? JSON.stringify(data.workspaceInfo) : '');
          }
          if (data.metadata) {
            for (const [key, value] of Object.entries(data.metadata)) {
              insertMeta.run(key, value);
            }
          }

          // 2. Schema-driven incremental updates — add a table to CACHE_TABLE_SCHEMA and it upserts automatically
          for (const [tableName, schema] of Object.entries(CACHE_TABLE_SCHEMA)) {
            const { dirty: dirtyKey, deleted: deletedKey } = schema.incrementalKeys || {};

            if (deletedKey && data[deletedKey]?.length > 0) {
              const deleteStmt = this.db.prepare(`DELETE FROM ${tableName} WHERE ${schema.idColumn} = ?`);
              for (const id of data[deletedKey]) {
                deleteStmt.run(id);
              }
            }

            if (dirtyKey && data[dirtyKey]) {
              const columns = schema.columns.join(', ');
              const placeholders = schema.columns.map(() => '?').join(', ');
              const insertStmt = this.db.prepare(
                `INSERT OR REPLACE INTO ${tableName} (${columns}) VALUES (${placeholders})`
              );
              for (const [id, value] of data[dirtyKey]) {
                insertStmt.run(...schema.serialize(id, value));
              }
            }
          }
        });
        return true;
      } catch (err) {
        _debugError('Save incremental', err);
        return false;
      }
    });
  }

  /**
   * Save analysis snapshot to SQLite.
   * @param {string} key
   * @param {object} data
   * @param {string} version
   * @param {number} fileCount
   * @param {string} configHash
   * @param {string} [contentSignature] fingerprint of the indexed file set
   */
  saveAnalysisSnapshot(key, data, version, fileCount, configHash, contentSignature) {
    return this._withWriteLock(() => {
      try {
        this._ensureOpen();
        const stmt = this.db.prepare(
          'INSERT OR REPLACE INTO analysis_snapshots (key, data, version, file_count, config_hash, computed_at, cache_version, content_signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        const now = Math.floor(Date.now() / 1000);
        stmt.run(key, JSON.stringify(data), version || '', fileCount ?? 0, configHash || '', now, CACHE_VERSION, contentSignature || '');
        return true;
      } catch (err) {
        _debugError('Save analysis snapshot', err);
        return false;
      }
    });
  }

  /**
   * Load analysis snapshot from SQLite.
   * @param {string} key
   */
  loadAnalysisSnapshot(key) {
    return this._readGuard('Load analysis snapshot', () => {
      const row = this.db.prepare(
        'SELECT data, version, file_count, config_hash, computed_at, cache_version, content_signature FROM analysis_snapshots WHERE key = ?'
      ).get(key);
      if (!row) return null;
      // Per-row gate on top of _readGuard's database-level one: snapshot rows
      // outlive individual writes (saveAnalysisSnapshot does not clear the
      // table), so a row can carry an obsolete stamp inside an otherwise
      // current database. Consumers (buildProjectOverview short-circuit,
      // query-*) treat null as a cache miss and recompute.
      if (Number(row.cache_version) !== CACHE_VERSION) return null;
      return {
        data: JSON.parse(row.data),
        version: row.version,
        fileCount: Number(row.file_count),
        configHash: row.config_hash,
        computedAt: Number(row.computed_at),
        contentSignature: row.content_signature || '',
      };
    }, null);
  }

  /**
   * Execute a read-only SQL query against the cache DB.
   * Only SELECT, EXPLAIN SELECT, and PRAGMA table_info are allowed.
   * Multi-statement queries and modification keywords are rejected.
   * Results are capped to avoid dumping huge tables (e.g. parse_results).
   *
   * @param {string} sql
   * @param {object} [options]
   * @param {number} [options.maxRows]
   * @returns {{ok: true, rows: object[], count: number, truncated: boolean} | {ok: false, error: string}}
   */
  // Deliberately NOT behind _readGuard: this is the operator escape hatch
  // (`query-sql`) for inspecting a cache database, including a stale one.
  // Gating it would hide exactly the rows someone runs it to look at. Callers
  // that turn its output into analysis results must apply their own gate.
  queryReadOnly(sql, options = {}) {
    return _runWithReadRetry(() => {
      try {
        this._ensureOpen();
        const normalized = String(sql || '').trim();
        if (!normalized) {
          return failure('query_error', 'Empty SQL query');
        }

        const lower = normalized.toLowerCase();
        const isSelect = lower.startsWith('select ');
        const isExplainSelect = lower.startsWith('explain ') && lower.includes('select');
        const isPragmaTableInfo = /^pragma\s+table_info\s*\(/i.test(normalized);
        if (!isSelect && !isExplainSelect && !isPragmaTableInfo) {
          return failure('query_error', 'Only SELECT, EXPLAIN SELECT, or PRAGMA table_info are allowed');
        }

        // Independent defense layer: reject data-modification keywords
        // and set operations (UNION/INTERSECT/EXCEPT) that can be used to
        // leak schema or cross-table data through an otherwise valid SELECT.
      const singleStatement = normalized.replace(/;\s*$/, '');
      const sqlCode = singleStatement.replace(SQL_NON_CODE, ' ');
        const forbidden = /\b(insert|update|delete|drop|create|alter|replace|vacuum|attach|detach|begin|commit|rollback|savepoint|union|intersect|except)\b/i;
      if (forbidden.test(sqlCode)) {
          return failure('query_error', 'Database modification or set-operation keywords are not allowed');
        }

        // Strip a single trailing semicolon, then reject any remaining semicolons
        // to prevent multi-statement attacks.
      if (sqlCode.includes(';')) {
          return failure('query_error', 'Multiple statements are not allowed');
        }

        const maxRows = options.maxRows ?? 1000;
        const stmt = this.db.prepare(singleStatement);
        const rows = stmt.all();
        const limited = rows.slice(0, maxRows);
        return {
          ok: true,
          rows: limited,
          count: limited.length,
          truncated: rows.length > maxRows,
        };
      } catch (err) {
        _debugError('Read-only query', err);
        return failure('query_error', err.message || String(err));
      }
    });
  }
}

module.exports = {
  GraphDB,
  acquireLockSync,
  releaseLockSync,
};
