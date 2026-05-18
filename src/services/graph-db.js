/**
 * GraphDB - SQLite-backed persistence for WorkspaceCache
 *
 * Replaces JSON file serialization with SQLite WAL-mode database.
 * Provides bulk load/save for cache metadata, file metadata, parse results,
 * symbol index, and diagnostics.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { CACHE_VERSION } = require('../config/constants');

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
`;

class GraphDB {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  _ensureOpen() {
    if (this.db) return;
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this._migrate();
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

      // File metadata
      const fileMetadata = new Map();
      const fileRows = this.db.prepare('SELECT path, mtime, size, hash, line_count, original_path FROM file_metadata').all();
      for (const row of fileRows) {
        fileMetadata.set(row.path, {
          mtime: Number(row.mtime),
          size: Number(row.size),
          hash: row.hash,
          lineCount: Number(row.line_count),
          originalPath: row.original_path,
        });
      }

      // Parse results
      const parseResults = new Map();
      const parseRows = this.db.prepare(
        'SELECT path, mtime, imports, exports, import_records, export_records, function_records, parse_mode, parse_mode_reason, confidence FROM parse_results'
      ).all();
      for (const row of parseRows) {
        parseResults.set(row.path, {
          mtime: Number(row.mtime),
          imports: row.imports ? JSON.parse(row.imports) : [],
          exports: row.exports ? JSON.parse(row.exports) : [],
          importRecords: row.import_records ? JSON.parse(row.import_records) : [],
          exportRecords: row.export_records ? JSON.parse(row.export_records) : [],
          functionRecords: row.function_records ? JSON.parse(row.function_records) : [],
          parseMode: row.parse_mode,
          parseModeReason: row.parse_mode_reason,
          confidence: row.confidence,
        });
      }

      // Symbol index
      const symbolIndex = new Map();
      const symbolRows = this.db.prepare('SELECT name, locations FROM symbol_index').all();
      for (const row of symbolRows) {
        symbolIndex.set(row.name, row.locations ? JSON.parse(row.locations) : []);
      }

      // Diagnostics
      const diagnostics = new Map();
      const diagRows = this.db.prepare('SELECT path, data FROM diagnostics').all();
      for (const row of diagRows) {
        diagnostics.set(row.path, row.data ? JSON.parse(row.data) : { diagnostics: [] });
      }

      return {
        version,
        workspaceInfo,
        workspaceRoot,
        timestamp,
        fileMetadata,
        parseResults,
        symbolIndex,
        diagnostics,
      };
    } catch (err) {
      if (process.env.DEBUG) {
        console.error('[GraphDB] Load failed:', err.message);
      }
      return null;
    }
  }

  /**
   * Save all cache data to SQLite in a single transaction.
   */
  saveAll(data) {
    try {
      this._ensureOpen();

      const tx = this.db.transaction(() => {
        // Clear old data
        this.db.prepare('DELETE FROM cache_metadata').run();
        this.db.prepare('DELETE FROM file_metadata').run();
        this.db.prepare('DELETE FROM parse_results').run();
        this.db.prepare('DELETE FROM symbol_index').run();
        this.db.prepare('DELETE FROM diagnostics').run();

        // Insert metadata
        const insertMeta = this.db.prepare('INSERT INTO cache_metadata (key, value) VALUES (?, ?)');
        insertMeta.run('version', String(CACHE_VERSION));
        insertMeta.run('timestamp', String(Date.now()));
        insertMeta.run('workspaceRoot', data.workspaceRoot || '');
        insertMeta.run('workspaceInfo', data.workspaceInfo ? JSON.stringify(data.workspaceInfo) : '');

        // Insert file metadata
        const insertFile = this.db.prepare(
          'INSERT INTO file_metadata (path, mtime, size, hash, line_count, original_path) VALUES (?, ?, ?, ?, ?, ?)'
        );
        for (const [filePath, meta] of data.fileMetadata) {
          insertFile.run(
            filePath,
            meta.mtime ?? 0,
            meta.size ?? 0,
            meta.hash ?? '',
            meta.lineCount ?? 0,
            meta.originalPath || null
          );
        }

        // Insert parse results
        const insertParse = this.db.prepare(
          'INSERT INTO parse_results (path, mtime, imports, exports, import_records, export_records, function_records, parse_mode, parse_mode_reason, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        for (const [filePath, result] of data.parseResults) {
          insertParse.run(
            filePath,
            result.mtime ?? 0,
            JSON.stringify(result.imports || []),
            JSON.stringify(result.exports || []),
            JSON.stringify(result.importRecords || []),
            JSON.stringify(result.exportRecords || []),
            JSON.stringify(result.functionRecords || []),
            result.parseMode || '',
            result.parseModeReason || '',
            result.confidence || ''
          );
        }

        // Insert symbol index
        const insertSymbol = this.db.prepare('INSERT INTO symbol_index (name, locations) VALUES (?, ?)');
        for (const [name, locations] of data.symbolIndex) {
          insertSymbol.run(name, JSON.stringify(locations || []));
        }

        // Insert diagnostics
        const insertDiag = this.db.prepare('INSERT INTO diagnostics (path, data) VALUES (?, ?)');
        for (const [filePath, entry] of data.diagnostics) {
          insertDiag.run(filePath, JSON.stringify(entry || { diagnostics: [] }));
        }
      });

      tx();
      return true;
    } catch (err) {
      if (process.env.DEBUG) {
        console.error('[GraphDB] Save failed:', err.message);
      }
      return false;
    }
  }
}

module.exports = {
  GraphDB,
};
