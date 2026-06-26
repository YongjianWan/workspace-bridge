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
  parse_results: {
    resultKey: 'parseResults',
    incrementalKeys: { dirty: 'dirtyParseResults', deleted: 'deletedParseResults' },
    idColumn: 'path',
    columns: ['path', 'mtime', 'imports', 'exports', 'import_records', 'export_records', 'function_records', 'parse_mode', 'parse_mode_reason', 'confidence', 'framework_hint', 'routes'],
    serialize: (path, result) => [
      path,
      result.mtime ?? 0,
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
    ],
    deserialize: (row) => ({
      mtime: Number(row.mtime),
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
    mtime INTEGER,
    imports TEXT,
    exports TEXT,
    import_records TEXT,
    export_records TEXT,
    function_records TEXT,
    parse_mode TEXT,
    parse_mode_reason TEXT,
    confidence TEXT,
    framework_hint TEXT,
    routes TEXT
  );

  CREATE TABLE IF NOT EXISTS symbol_index (
    name TEXT PRIMARY KEY,
    locations TEXT
  );

  CREATE TABLE IF NOT EXISTS diagnostics (
    path TEXT PRIMARY KEY,
    data TEXT
  );

  CREATE TABLE IF NOT EXISTS edges (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    edge_type TEXT NOT NULL DEFAULT 'import',
    confidence REAL NOT NULL DEFAULT 1.0,
    tier TEXT NOT NULL DEFAULT 'tier1',
    resolution_method TEXT NOT NULL DEFAULT 'import',
    PRIMARY KEY (source, target, edge_type)
  );
  CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
  CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
  CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edge_type);

  CREATE TABLE IF NOT EXISTS precomputed_aggregates (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    file_count INTEGER NOT NULL,
    config_hash TEXT NOT NULL DEFAULT '',
    computed_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_precomputed_aggregates_version ON precomputed_aggregates(version);

  CREATE TABLE IF NOT EXISTS precomputed_impact (
    file TEXT PRIMARY KEY,
    direct_deps INTEGER NOT NULL DEFAULT 0,
    transitive_deps INTEGER NOT NULL DEFAULT 0,
    direct_dependents INTEGER NOT NULL DEFAULT 0,
    transitive_dependents INTEGER NOT NULL DEFAULT 0,
    affected_tests TEXT,
    impact_radius TEXT,
    version INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_precomputed_impact_version ON precomputed_impact(version);

  CREATE TABLE IF NOT EXISTS routes (
    file TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    framework TEXT NOT NULL,
    handler TEXT,
    PRIMARY KEY (file, method, path)
  );
  CREATE INDEX IF NOT EXISTS idx_routes_file ON routes(file);
  CREATE INDEX IF NOT EXISTS idx_routes_path ON routes(path);

  CREATE TABLE IF NOT EXISTS metrics (
    file TEXT NOT NULL,
    dimension TEXT NOT NULL,
    value REAL NOT NULL,
    computed_at INTEGER NOT NULL,
    PRIMARY KEY (file, dimension)
  );

  CREATE TABLE IF NOT EXISTS test_map (
    source TEXT NOT NULL,
    test_file TEXT NOT NULL,
    signal TEXT NOT NULL DEFAULT 'import',
    distance INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (source, test_file)
  );
  CREATE INDEX IF NOT EXISTS idx_test_map_source ON test_map(source);

  CREATE TABLE IF NOT EXISTS analysis_snapshots (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    version TEXT NOT NULL,
    file_count INTEGER NOT NULL,
    config_hash TEXT NOT NULL DEFAULT '',
    computed_at INTEGER NOT NULL DEFAULT 0
  );
`;

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
      return fn();
    } finally {
      releaseLockSync(this.lockPath);
    }
  }

  _ensureOpen() {
    if (this.db) return;
    _runWithReadRetry(() => {
      const sqlite = _withSqliteWarningSuppressed(() => require('node:sqlite'));
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
      // Wave 9-1: add impact_radius column to precomputed_impact
      const impactCols = this.db.prepare('PRAGMA table_info(precomputed_impact)').all();
      if (impactCols.length > 0 && !impactCols.some((c) => c.name === 'impact_radius')) {
        this.db.prepare('ALTER TABLE precomputed_impact ADD COLUMN impact_radius TEXT').run();
      }
      // Wave 10-2: add tier and resolution_method columns to edges
      const edgeCols = this.db.prepare('PRAGMA table_info(edges)').all();
      if (edgeCols.length > 0 && !edgeCols.some((c) => c.name === 'tier')) {
        this.db.prepare("ALTER TABLE edges ADD COLUMN tier TEXT NOT NULL DEFAULT 'tier1'").run();
        this.db.prepare("ALTER TABLE edges ADD COLUMN resolution_method TEXT NOT NULL DEFAULT 'import'").run();
      }
      // Increment schema migration: add framework_hint column to parse_results
      const parseCols = this.db.prepare('PRAGMA table_info(parse_results)').all();
      if (parseCols.length > 0 && !parseCols.some((c) => c.name === 'framework_hint')) {
        this.db.prepare('ALTER TABLE parse_results ADD COLUMN framework_hint TEXT').run();
      }
      if (parseCols.length > 0 && !parseCols.some((c) => c.name === 'routes')) {
        this.db.prepare('ALTER TABLE parse_results ADD COLUMN routes TEXT').run();
      }
      // Wave B-2: add config_hash column to precomputed_aggregates so query-* snapshots
      // can invalidate when .workspace-bridge.json changes.
      const aggregateCols = this.db.prepare('PRAGMA table_info(precomputed_aggregates)').all();
      if (aggregateCols.length > 0 && !aggregateCols.some((c) => c.name === 'config_hash')) {
        this.db.prepare("ALTER TABLE precomputed_aggregates ADD COLUMN config_hash TEXT NOT NULL DEFAULT ''").run();
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
    return _runWithReadRetry(() => {
      try {
        this._ensureOpen();

        // Metadata
        const metaRows = this.db.prepare('SELECT key, value FROM cache_metadata').all();
        const metadata = {};
        for (const row of metaRows) {
          metadata[row.key] = row.value;
        }

        const version = Number(metadata.version || 0);
        if (version !== CACHE_VERSION) {
          return null;
        }

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
      } catch (err) {
        _debugError('Load', err);
        return null;
      }
    });
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
   * Save all dependency edges to SQLite in a single transaction.
   * Edges are stored after post-process so they include implicit/framework edges.
   * @param {Array<{source:string,target:string,edgeType?:string,confidence?:number}>} edges
   * @param {{cacheVersion?:number,fileMetadataCount?:number,parseResultsCount?:number,timestamp?:number}} [meta]
   */
  saveEdges(edges, meta = {}) {
    return this._withWriteLock(() => {
      try {
        this._ensureOpen();

        this._executeInTransaction(() => {
          this.db.prepare('DELETE FROM edges').run();
          const insert = this.db.prepare(
            'INSERT OR REPLACE INTO edges (source, target, edge_type, confidence, tier, resolution_method) VALUES (?, ?, ?, ?, ?, ?)'
          );
          for (const edge of edges) {
            insert.run(
              edge.source,
              edge.target,
              edge.edgeType || 'import',
              Number(edge.confidence ?? 1.0),
              edge.tier || 'tier1',
              edge.resolutionMethod || 'import'
            );
          }

          if (meta && Object.keys(meta).length > 0) {
            this.db.prepare('INSERT OR REPLACE INTO cache_metadata (key, value) VALUES (?, ?)').run(
              'edgeMeta',
              JSON.stringify(meta)
            );
          }
        });

        return true;
      } catch (err) {
        _debugError('Save edges', err);
        return false;
      }
    });
  }

  /**
   * Load all dependency edges from SQLite.
   * @returns {Array<{source:string,target:string,edgeType:string,confidence:number,tier:string,resolutionMethod:string}>|null}
   */
  loadEdges() {
    return _runWithReadRetry(() => {
      try {
        this._ensureOpen();
        const rows = this.db.prepare(
          'SELECT source, target, edge_type, confidence, tier, resolution_method FROM edges'
        ).all();
        return rows.map((r) => ({
          source: r.source,
          target: r.target,
          edgeType: r.edge_type,
          confidence: Number(r.confidence),
          tier: r.tier || 'tier1',
          resolutionMethod: r.resolution_method || 'import',
        }));
      } catch (err) {
        _debugError('Load edges', err);
        return null;
      }
    });
  }

  /**
   * Save precomputed aggregate summaries to SQLite.
   * @param {Array<{key:string,data:string,version:number,fileCount:number,configHash?:string}>} rows
   */
  savePrecomputedAggregates(rows) {
    return this._withWriteLock(() => {
      try {
        this._ensureOpen();
        this._executeInTransaction(() => {
          this.db.prepare('DELETE FROM precomputed_aggregates').run();
          const insert = this.db.prepare(
            'INSERT INTO precomputed_aggregates (key, data, version, file_count, config_hash, computed_at) VALUES (?, ?, ?, ?, ?, ?)'
          );
          const now = Math.floor(Date.now() / 1000);
          for (const row of rows) {
            insert.run(row.key, row.data, row.version ?? 0, row.fileCount ?? 0, row.configHash ?? '', now);
          }
        });
        return true;
      } catch (err) {
        _debugError('Save precomputed aggregates', err);
        return false;
      }
    });
  }

  /**
   * Load precomputed aggregate summaries from SQLite.
   * @returns {Array<{key:string,data:string,version:number,fileCount:number,configHash:string,computedAt:number}>|null}
   */
  loadPrecomputedAggregates() {
    return _runWithReadRetry(() => {
      try {
        this._ensureOpen();
        const rows = this.db.prepare(
          'SELECT key, data, version, file_count, config_hash, computed_at FROM precomputed_aggregates'
        ).all();
        return rows.map((r) => ({
          key: r.key,
          data: r.data,
          version: isNaN(Number(r.version)) ? r.version : Number(r.version),
          fileCount: Number(r.file_count),
          configHash: r.config_hash ?? '',
          computedAt: Number(r.computed_at),
        }));
      } catch (err) {
        _debugError('Load precomputed aggregates', err);
        return null;
      }
    });
  }

  /**
   * Save precomputed per-file impact data to SQLite.
   * @param {Array<{file:string,directDeps:number,transitiveDeps:number,directDependents:number,transitiveDependents:number,affectedTests?:string,impactRadius?:string,version:number}>} records
   */
  savePrecomputedImpact(records) {
    return this._withWriteLock(() => {
      try {
        this._ensureOpen();
        this._executeInTransaction(() => {
          this.db.prepare('DELETE FROM precomputed_impact').run();
          const insert = this.db.prepare(
            'INSERT INTO precomputed_impact (file, direct_deps, transitive_deps, direct_dependents, transitive_dependents, affected_tests, impact_radius, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          );
          for (const rec of records) {
            insert.run(
              rec.file,
              rec.directDeps ?? 0,
              rec.transitiveDeps ?? 0,
              rec.directDependents ?? 0,
              rec.transitiveDependents ?? 0,
              rec.affectedTests || null,
              rec.impactRadius || null,
              rec.version ?? 0
            );
          }
        });
        return true;
      } catch (err) {
        _debugError('Save precomputed impact', err);
        return false;
      }
    });
  }

  /**
   * Load precomputed per-file impact data from SQLite.
   * @returns {Array<{file:string,directDeps:number,transitiveDeps:number,directDependents:number,transitiveDependents:number,affectedTests:string|null,impactRadius:string|null,version:number}>|null}
   */
  loadPrecomputedImpact() {
    return _runWithReadRetry(() => {
      try {
        this._ensureOpen();
        const rows = this.db.prepare(
          'SELECT file, direct_deps, transitive_deps, direct_dependents, transitive_dependents, affected_tests, impact_radius, version FROM precomputed_impact'
        ).all();
        return rows.map((r) => ({
          file: r.file,
          directDeps: Number(r.direct_deps),
          transitiveDeps: Number(r.transitive_deps),
          directDependents: Number(r.direct_dependents),
          transitiveDependents: Number(r.transitive_dependents),
          affectedTests: r.affected_tests,
          impactRadius: r.impact_radius,
          version: Number(r.version),
        }));
      } catch (err) {
        _debugError('Load precomputed impact', err);
        return null;
      }
    });
  }

  /**
   * Delete specific precomputed impact rows (for incremental updates).
   * @param {string[]} files
   */
  deletePrecomputedImpact(files) {
    return this._withWriteLock(() => {
      try {
        this._ensureOpen();
        const stmt = this.db.prepare('DELETE FROM precomputed_impact WHERE file = ?');
        this._executeInTransaction(() => {
          for (const file of files) {
            stmt.run(file);
          }
        });
        return true;
      } catch (err) {
        _debugError('Delete precomputed impact', err);
        return false;
      }
    });
  }

  /**
   * Batch save helper.
   */
  _saveBatch(tableName, queryStr, mapperFn, items) {
    return this._withWriteLock(() => {
      try {
        this._ensureOpen();
        this._executeInTransaction(() => {
          this.db.prepare(`DELETE FROM ${tableName}`).run();
          const stmt = this.db.prepare(queryStr);
          for (const item of items) {
            stmt.run(...mapperFn(item));
          }
        });
        return true;
      } catch (err) {
        _debugError(`Save ${tableName}`, err);
        return false;
      }
    });
  }

  /**
   * Load all helper.
   */
  _loadAll(tableName, queryStr, mapperFn) {
    return _runWithReadRetry(() => {
      try {
        this._ensureOpen();
        const rows = this.db.prepare(queryStr).all();
        return rows.map(mapperFn);
      } catch (err) {
        _debugError(`Load ${tableName}`, err);
        return null;
      }
    });
  }

  /**
   * Load helper filtered by files.
   */
  _loadForFiles(tableName, queryStrPattern, files, mapperFn) {
    return _runWithReadRetry(() => {
      try {
        this._ensureOpen();
        if (!files || files.length === 0) return [];
        const placeholders = files.map(() => '?').join(',');
        const rows = this.db.prepare(
          queryStrPattern.replace('$PLACEHOLDERS', placeholders)
        ).all(...files);
        return rows.map(mapperFn);
      } catch (err) {
        _debugError(`Load ${tableName} for files`, err);
        return [];
      }
    });
  }

  /**
   * Save HTTP route declarations to SQLite.
   * @param {Array<{file:string,method:string,path:string,framework:string,handler?:string}>} routes
   */
  saveRoutes(routes) {
    return this._saveBatch(
      'routes',
      'INSERT OR REPLACE INTO routes (file, method, path, framework, handler) VALUES (?, ?, ?, ?, ?)',
      (r) => [r.file, r.method, r.path, r.framework, r.handler || null],
      routes
    );
  }

  /**
   * Load all HTTP route declarations from SQLite.
   * @returns {Array<{file:string,method:string,path:string,framework:string,handler:string|null}>|null}
   */
  loadRoutes() {
    return this._loadAll(
      'routes',
      'SELECT file, method, path, framework, handler FROM routes',
      (r) => ({
        file: r.file,
        method: r.method,
        path: r.path,
        framework: r.framework,
        handler: r.handler,
      })
    );
  }

  /**
   * Load routes for a specific set of files (for impact-based queries).
   * @param {string[]} files
   * @returns {Array<{file:string,method:string,path:string,framework:string,handler:string|null}>}
   */
  loadRoutesForFiles(files) {
    return this._loadForFiles(
      'routes',
      'SELECT file, method, path, framework, handler FROM routes WHERE file IN ($PLACEHOLDERS)',
      files,
      (r) => ({
        file: r.file,
        method: r.method,
        path: r.path,
        framework: r.framework,
        handler: r.handler,
      })
    );
  }

  /**
   * Find affected HTTP routes by traversing dependents via SQLite recursive CTE.
   * @param {string} filePath
   * @param {number} depth
   * @returns {Array<{file:string,method:string,path:string,framework:string,handler:string|null}>|null}
   */
  findAffectedHttpRoutes(filePath, depth = 3) {
    return _runWithReadRetry(() => {
      try {
        this._ensureOpen();
        const rows = this.db.prepare(`
          WITH RECURSIVE dependents(file_path, lvl) AS (
            SELECT ?, 0
            UNION
            SELECT e.source, d.lvl + 1
            FROM edges e
            JOIN dependents d ON e.target = d.file_path
            WHERE e.edge_type = 'import' AND d.lvl < ?
          )
          SELECT DISTINCT r.file, r.method, r.path, r.framework, r.handler
          FROM routes r
          JOIN dependents d ON r.file = d.file_path
        `).all(filePath, depth);
        return rows.map((r) => ({
          file: r.file,
          method: r.method,
          path: r.path,
          framework: r.framework,
          handler: r.handler,
        }));
      } catch (err) {
        _debugError('findAffectedHttpRoutes query', err);
        return null;
      }
    });
  }

  /**
   * Save per-file metrics (PageRank, hotspot_score, risk_score, etc.) to SQLite.
   * @param {Array<{file:string,dimension:string,value:number}>} metrics
   */
  saveMetrics(metrics) {
    const now = Math.floor(Date.now() / 1000);
    return this._saveBatch(
      'metrics',
      'INSERT OR REPLACE INTO metrics (file, dimension, value, computed_at) VALUES (?, ?, ?, ?)',
      (m) => [m.file, m.dimension, Number(m.value), now],
      metrics
    );
  }

  /**
   * Load all metrics from SQLite.
   * @returns {Array<{file:string,dimension:string,value:number,computedAt:number}>|null}
   */
  loadMetrics() {
    return this._loadAll(
      'metrics',
      'SELECT file, dimension, value, computed_at FROM metrics',
      (r) => ({
        file: r.file,
        dimension: r.dimension,
        value: Number(r.value),
        computedAt: Number(r.computed_at),
      })
    );
  }

  /**
   * Load metrics for specific files.
   * @param {string[]} files
   * @returns {Array<{file:string,dimension:string,value:number,computedAt:number}>}
   */
  loadMetricsForFiles(files) {
    return this._loadForFiles(
      'metrics',
      'SELECT file, dimension, value, computed_at FROM metrics WHERE file IN ($PLACEHOLDERS)',
      files,
      (r) => ({
        file: r.file,
        dimension: r.dimension,
        value: Number(r.value),
        computedAt: Number(r.computed_at),
      })
    );
  }

  /**
   * Save test mappings to SQLite.
   * @param {Array<{source:string,testFile:string,signal:string,distance:number}>} testMaps
   */
  saveTestMap(testMaps) {
    return this._saveBatch(
      'test_map',
      'INSERT OR REPLACE INTO test_map (source, test_file, signal, distance) VALUES (?, ?, ?, ?)',
      (tm) => [tm.source, tm.testFile, tm.signal || 'import', tm.distance ?? 1],
      testMaps
    );
  }

  /**
   * Load all test maps.
   */
  loadTestMap() {
    return this._loadAll(
      'test_map',
      'SELECT source, test_file, signal, distance FROM test_map',
      (r) => ({
        source: r.source,
        testFile: r.test_file,
        signal: r.signal,
        distance: Number(r.distance),
      })
    );
  }

  /**
   * Load test map for specific source files.
   */
  loadTestMapForFiles(files) {
    return this._loadForFiles(
      'test_map',
      'SELECT source, test_file, signal, distance FROM test_map WHERE source IN ($PLACEHOLDERS)',
      files,
      (r) => ({
        source: r.source,
        testFile: r.test_file,
        signal: r.signal,
        distance: Number(r.distance),
      })
    );
  }

  /**
   * Save analysis snapshot to SQLite.
   * @param {string} key
   * @param {object} data
   * @param {string} version
   * @param {number} fileCount
   * @param {string} configHash
   */
  saveAnalysisSnapshot(key, data, version, fileCount, configHash) {
    return this._withWriteLock(() => {
      try {
        this._ensureOpen();
        const stmt = this.db.prepare(
          'INSERT OR REPLACE INTO analysis_snapshots (key, data, version, file_count, config_hash, computed_at) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const now = Math.floor(Date.now() / 1000);
        stmt.run(key, JSON.stringify(data), version || '', fileCount ?? 0, configHash || '', now);
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
    return _runWithReadRetry(() => {
      try {
        this._ensureOpen();
        const row = this.db.prepare(
          'SELECT data, version, file_count, config_hash, computed_at FROM analysis_snapshots WHERE key = ?'
        ).get(key);
        if (!row) return null;
        return {
          data: JSON.parse(row.data),
          version: row.version,
          fileCount: Number(row.file_count),
          configHash: row.config_hash,
          computedAt: Number(row.computed_at),
        };
      } catch (err) {
        _debugError('Load analysis snapshot', err);
        return null;
      }
    });
  }

  /**
   * Execute a read-only SQL query against the cache DB.
   * Only SELECT, EXPLAIN SELECT, and PRAGMA table_info are allowed.
   * Multi-statement queries and modification keywords are rejected.
   * Results are capped to avoid dumping huge tables (e.g. edges).
   *
   * @param {string} sql
   * @param {object} [options]
   * @param {number} [options.maxRows]
   * @returns {{ok: true, rows: object[], count: number, truncated: boolean} | {ok: false, error: string}}
   */
  queryReadOnly(sql, options = {}) {
    return _runWithReadRetry(() => {
      try {
        this._ensureOpen();
        const normalized = String(sql || '').trim();
        if (!normalized) {
          return { ok: false, error: 'Empty SQL query' };
        }

        const lower = normalized.toLowerCase();
        const isSelect = lower.startsWith('select ');
        const isExplainSelect = lower.startsWith('explain ') && lower.includes('select');
        const isPragmaTableInfo = /^pragma\s+table_info\s*\(/i.test(normalized);
        if (!isSelect && !isExplainSelect && !isPragmaTableInfo) {
          return { ok: false, error: 'Only SELECT, EXPLAIN SELECT, or PRAGMA table_info are allowed' };
        }

        // Independent defense layer: reject data-modification keywords
        // and set operations (UNION/INTERSECT/EXCEPT) that can be used to
        // leak schema or cross-table data through an otherwise valid SELECT.
        const forbidden = /\b(insert|update|delete|drop|create|alter|replace|vacuum|attach|detach|begin|commit|rollback|savepoint|union|intersect|except)\b/i;
        if (forbidden.test(normalized)) {
          return { ok: false, error: 'Database modification or set-operation keywords are not allowed' };
        }

        // Strip a single trailing semicolon, then reject any remaining semicolons
        // to prevent multi-statement attacks.
        const singleStatement = normalized.replace(/;\s*$/, '');
        if (singleStatement.includes(';')) {
          return { ok: false, error: 'Multiple statements are not allowed' };
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
        return { ok: false, error: err.message || String(err) };
      }
    });
  }
}

module.exports = {
  GraphDB,
  acquireLockSync,
  releaseLockSync,
};

