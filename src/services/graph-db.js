/**
 * GraphDB - SQLite-backed persistence for WorkspaceCache
 *
 * Replaces JSON file serialization with SQLite WAL-mode database.
 * Provides bulk load/save for cache metadata, file metadata, parse results,
 * symbol index, and diagnostics.
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { CACHE_VERSION } = require('../config/constants');

const CACHE_TABLE_SCHEMA = {
  file_metadata: {
    resultKey: 'fileMetadata',
    incrementalKeys: { dirty: 'dirtyFiles', deleted: 'deletedFiles' },
    idColumn: 'path',
    columns: ['path', 'mtime', 'size', 'hash', 'line_count', 'original_path'],
    serialize: (path, meta) => [
      path,
      meta.mtime ?? 0,
      meta.size ?? 0,
      meta.hash ?? '',
      meta.lineCount ?? 0,
      meta.originalPath || null,
    ],
    deserialize: (row) => ({
      mtime: Number(row.mtime),
      size: Number(row.size),
      hash: row.hash,
      lineCount: Number(row.line_count),
      originalPath: row.original_path,
    }),
  },
  parse_results: {
    resultKey: 'parseResults',
    incrementalKeys: { dirty: 'dirtyParseResults', deleted: 'deletedParseResults' },
    idColumn: 'path',
    columns: ['path', 'mtime', 'imports', 'exports', 'import_records', 'export_records', 'function_records', 'parse_mode', 'parse_mode_reason', 'confidence'],
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
    original_path TEXT
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
    confidence TEXT
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
    version INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_precomputed_impact_version ON precomputed_impact(version);
`;

let _originalEmitWarning;
let _suppressCount = 0;

function _debugError(label, err) {
  if (process.env.DEBUG) {
    console.error(`[GraphDB] ${label} failed:`, err?.message || err);
  }
}

function _suppressSqliteExperimentalWarning() {
  if (_suppressCount === 0) {
    _originalEmitWarning = process.emitWarning;
    process.emitWarning = (warning, name, ctor) => {
      const msg = typeof warning === 'string' ? warning : warning.message;
      const type = typeof warning === 'string' ? name : warning.name;
      if (type === 'ExperimentalWarning' && msg?.toLowerCase().includes('sqlite')) return;
      _originalEmitWarning.call(process, warning, name, ctor);
    };
  }
  _suppressCount++;
}

function _restoreEmitWarning() {
  _suppressCount = Math.max(0, _suppressCount - 1);
  if (_suppressCount === 0 && _originalEmitWarning) {
    process.emitWarning = _originalEmitWarning;
    _originalEmitWarning = undefined;
  }
}

class GraphDB {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  _ensureOpen() {
    if (this.db) return;
    _suppressSqliteExperimentalWarning();
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA journal_size_limit = 67108864'); // 64MB — auto-checkpoint, prevent unbounded WAL growth
    this.db.exec('PRAGMA mmap_size = 268435456');          // 256MB — memory-map hot pages, reduce read syscalls
    this.db.exec('PRAGMA synchronous = NORMAL');           // WAL mode: NORMAL is crash-safe and faster than FULL
    this.db.exec(SCHEMA);
    this._migrate();
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
    const cols = this.db.prepare('PRAGMA table_info(file_metadata)').all();
    const hasOriginalPath = cols.some((c) => c.name === 'original_path');
    if (!hasOriginalPath) {
      this.db.prepare('ALTER TABLE file_metadata ADD COLUMN original_path TEXT').run();
    }
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
    _restoreEmitWarning();
  }

  getMetadata(key) {
    try {
      this._ensureOpen();
      const row = this.db.prepare('SELECT value FROM cache_metadata WHERE key = ?').get(key);
      return row ? row.value : null;
    } catch {
      return null;
    }
  }

  setMetadata(key, value) {
    try {
      this._ensureOpen();
      this.db.prepare('INSERT OR REPLACE INTO cache_metadata (key, value) VALUES (?, ?)').run(key, value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load all cache data from SQLite into memory structures.
   * Returns null on any error (caller should treat as cold start).
   */
  loadAll() {
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
  }

  /**
   * Save all cache data to SQLite in a single transaction.
   */
  saveAll(data) {
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
  }

  /**
   * Save dirty/deleted cache data to SQLite incrementally in a single transaction.
   */
  saveIncremental(data) {
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
  }

  /**
   * Save all dependency edges to SQLite in a single transaction.
   * Edges are stored after post-process so they include implicit/framework edges.
   * @param {Array<{source:string,target:string,edgeType?:string,confidence?:number}>} edges
   * @param {{cacheVersion?:number,fileMetadataCount?:number,parseResultsCount?:number,timestamp?:number}} [meta]
   */
  saveEdges(edges, meta = {}) {
    try {
      this._ensureOpen();

      this._executeInTransaction(() => {
        this.db.prepare('DELETE FROM edges').run();
        const insert = this.db.prepare(
          'INSERT OR REPLACE INTO edges (source, target, edge_type, confidence) VALUES (?, ?, ?, ?)'
        );
        for (const edge of edges) {
          insert.run(
            edge.source,
            edge.target,
            edge.edgeType || 'import',
            Number(edge.confidence ?? 1.0)
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
  }

  /**
   * Load all dependency edges from SQLite.
   * @returns {Array<{source:string,target:string,edgeType:string,confidence:number}>|null}
   */
  loadEdges() {
    try {
      this._ensureOpen();
      const rows = this.db.prepare(
        'SELECT source, target, edge_type, confidence FROM edges'
      ).all();
      return rows.map((r) => ({
        source: r.source,
        target: r.target,
        edgeType: r.edge_type,
        confidence: Number(r.confidence),
      }));
    } catch (err) {
      _debugError('Load edges', err);
      return null;
    }
  }

  /**
   * Save precomputed aggregate summaries to SQLite.
   * @param {Array<{key:string,data:string,version:number,fileCount:number}>} rows
   */
  savePrecomputedAggregates(rows) {
    try {
      this._ensureOpen();
      this._executeInTransaction(() => {
        this.db.prepare('DELETE FROM precomputed_aggregates').run();
        const insert = this.db.prepare(
          'INSERT INTO precomputed_aggregates (key, data, version, file_count, computed_at) VALUES (?, ?, ?, ?, ?)'
        );
        const now = Math.floor(Date.now() / 1000);
        for (const row of rows) {
          insert.run(row.key, row.data, row.version ?? 0, row.fileCount ?? 0, now);
        }
      });
      return true;
    } catch (err) {
      _debugError('Save precomputed aggregates', err);
      return false;
    }
  }

  /**
   * Load precomputed aggregate summaries from SQLite.
   * @returns {Array<{key:string,data:string,version:number,fileCount:number,computedAt:number}>|null}
   */
  loadPrecomputedAggregates() {
    try {
      this._ensureOpen();
      const rows = this.db.prepare(
        'SELECT key, data, version, file_count, computed_at FROM precomputed_aggregates'
      ).all();
      return rows.map((r) => ({
        key: r.key,
        data: r.data,
        version: isNaN(Number(r.version)) ? r.version : Number(r.version),
        fileCount: Number(r.file_count),
        computedAt: Number(r.computed_at),
      }));
    } catch (err) {
      _debugError('Load precomputed aggregates', err);
      return null;
    }
  }

  /**
   * Save precomputed per-file impact data to SQLite.
   * @param {Array<{file:string,directDeps:number,transitiveDeps:number,directDependents:number,transitiveDependents:number,affectedTests?:string,version:number}>} records
   */
  savePrecomputedImpact(records) {
    try {
      this._ensureOpen();
      this._executeInTransaction(() => {
        this.db.prepare('DELETE FROM precomputed_impact').run();
        const insert = this.db.prepare(
          'INSERT INTO precomputed_impact (file, direct_deps, transitive_deps, direct_dependents, transitive_dependents, affected_tests, version) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        for (const rec of records) {
          insert.run(
            rec.file,
            rec.directDeps ?? 0,
            rec.transitiveDeps ?? 0,
            rec.directDependents ?? 0,
            rec.transitiveDependents ?? 0,
            rec.affectedTests || null,
            rec.version ?? 0
          );
        }
      });
      return true;
    } catch (err) {
      _debugError('Save precomputed impact', err);
      return false;
    }
  }

  /**
   * Load precomputed per-file impact data from SQLite.
   * @returns {Array<{file:string,directDeps:number,transitiveDeps:number,directDependents:number,transitiveDependents:number,affectedTests:string|null,version:number}>|null}
   */
  loadPrecomputedImpact() {
    try {
      this._ensureOpen();
      const rows = this.db.prepare(
        'SELECT file, direct_deps, transitive_deps, direct_dependents, transitive_dependents, affected_tests, version FROM precomputed_impact'
      ).all();
      return rows.map((r) => ({
        file: r.file,
        directDeps: Number(r.direct_deps),
        transitiveDeps: Number(r.transitive_deps),
        directDependents: Number(r.direct_dependents),
        transitiveDependents: Number(r.transitive_dependents),
        affectedTests: r.affected_tests,
        version: Number(r.version),
      }));
    } catch (err) {
      _debugError('Load precomputed impact', err);
      return null;
    }
  }

  /**
   * Delete specific precomputed impact rows (for incremental updates).
   * @param {string[]} files
   */
  deletePrecomputedImpact(files) {
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
  }
}

module.exports = {
  GraphDB,
};
