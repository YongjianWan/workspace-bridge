/**
 * WorkspaceCache - In-memory cache with SQLite persistence
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { normalizePathKey } = require('../utils/path');
const { GraphDB } = require('./graph-db');
const { CACHE_VERSION, DEFAULTS } = require('../config/constants');

const CACHE_STALE_MS = DEFAULTS.STALENESS_THRESHOLD_MS;

/**
 * Metadata schema registry — add a new cached field by registering here.
 * Eliminates copy-paste of _loadXxx / saveXxx boilerplate.
 */
const METADATA_SCHEMA = {
  coChanges: {
    default: null,
    serialize(v) {
      if (!v) return null;
      return JSON.stringify({
        pairCounts: Array.from(v.pairCounts.entries()),
        fileChangeCounts: Array.from(v.fileChangeCounts.entries()),
        commitCount: v.commitCount,
      });
    },
    deserialize(raw) {
      const obj = JSON.parse(raw);
      return {
        pairCounts: new Map(obj.pairCounts || []),
        fileChangeCounts: new Map(obj.fileChangeCounts || []),
        commitCount: obj.commitCount || 0,
      };
    },
  },
  pageRanks: {
    default: () => new Map(),
    serialize: (v) => JSON.stringify(Array.from(v.entries())),
    deserialize: (raw) => new Map(JSON.parse(raw)),
  },
  aggregateSummary: {
    default: null,
    serialize: (v) => JSON.stringify(v),
    deserialize: (raw) => JSON.parse(raw),
  },
};

function computeDefaultCacheDir(workspaceRoot) {
  const hash = crypto.createHash('md5').update(workspaceRoot).digest('hex').slice(0, 8);
  return path.join(os.tmpdir(), 'workspace-bridge', hash);
}

class WorkspaceCache {
  constructor(workspaceRoot, options = {}) {
    this.workspaceRoot = workspaceRoot;
    this.cacheDir = options.cacheDir || computeDefaultCacheDir(workspaceRoot);
    this.cachePath = path.join(this.cacheDir, 'cache.db');
    this._graphDb = new GraphDB(this.cachePath);

    // In-memory caches
    this.workspaceInfo = null;
    this.fileMetadata = new Map(); // file -> {mtime, size, hash}
    this.parseResults = new Map(); // file -> {imports, exports, importRecords, exportRecords, functionRecords, parseMode, confidence, mtime}
    this.symbolIndex = new Map();  // symbol -> [{file, line, type}]
    this.diagnostics = new Map();  // file -> [diagnostics]

    // Incremental tracking sets
    this._dirtyFiles = new Set();
    this._deletedFiles = new Set();
    this._dirtyParseResults = new Set();
    this._deletedParseResults = new Set();
    this._dirtySymbols = new Set();
    this._deletedSymbols = new Set();
    this._dirtyDiagnostics = new Set();
    this._deletedDiagnostics = new Set();
    this.hasLoaded = false;

    // Schema-driven metadata fields — register in METADATA_SCHEMA to add new ones
    for (const [key, def] of Object.entries(METADATA_SCHEMA)) {
      this[key] = typeof def.default === 'function' ? def.default() : def.default;
    }

    this.lastSaved = 0;
    this.dirty = false;
  }

  normalizeFilePath(filePath) {
    if (!filePath || typeof filePath !== 'string') return null;
    const absolute = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workspaceRoot, filePath);
    return normalizePathKey(absolute);
  }

  normalizeFileMapEntries(entries) {
    const normalized = new Map();
    const iterable = Array.isArray(entries) ? entries : [];
    for (const [filePath, metadata] of iterable) {
      const key = this.normalizeFilePath(filePath);
      if (!key) continue;
      const existing = normalized.get(key);
      if (!existing) {
        normalized.set(key, metadata);
        continue;
      }
      const existingMtime = Number(existing?.mtime);
      const nextMtime = Number(metadata?.mtime);
      const existingSafe = Number.isNaN(existingMtime) ? 0 : existingMtime;
      const nextSafe = Number.isNaN(nextMtime) ? 0 : nextMtime;
      if (nextSafe > existingSafe) {
        normalized.set(key, metadata);
      }
    }
    return normalized;
  }

  normalizeDiagnosticsEntries(entries) {
    const normalized = new Map();
    const iterable = Array.isArray(entries) ? entries : [];
    for (const [filePath, diagnostics] of iterable) {
      const key = this.normalizeFilePath(filePath);
      if (!key) continue;
      normalized.set(key, diagnostics);
    }
    return normalized;
  }

  normalizeSymbolEntries(entries) {
    const normalized = new Map();
    for (const [name, locations] of entries || []) {
      const list = Array.isArray(locations) ? locations : [];
      const mapped = list
        .map((location) => {
          const key = this.normalizeFilePath(location?.file);
          if (!key) return null;
          return { ...location, file: key };
        })
        .filter(Boolean);
      normalized.set(name, mapped);
    }
    return normalized;
  }

  normalizeParseResultEntries(entries) {
    const normalized = new Map();
    const iterable = Array.isArray(entries) ? entries : [];
    for (const [filePath, result] of iterable) {
      const key = this.normalizeFilePath(filePath);
      if (!key) continue;
      normalized.set(key, result);
    }
    return normalized;
  }

  /**
   * Load from disk if exists and fresh
   */
  load() {
    try {
      // Staleness check: treat stale database as cold start
      if (fs.existsSync(this.cachePath)) {
        const stat = fs.statSync(this.cachePath);
        const age = Date.now() - stat.mtimeMs;
        if (age > CACHE_STALE_MS) {
          return false;
        }
      }

      const data = this._graphDb.loadAll();
      if (!data) return false;
      this.workspaceInfo = data.workspaceInfo;
      this.fileMetadata = data.fileMetadata || new Map();
      this.parseResults = data.parseResults || new Map();
      this.symbolIndex = data.symbolIndex || new Map();
      this.diagnostics = data.diagnostics || new Map();
      this.lastSaved = data.timestamp || 0;

      // Schema-driven metadata loading — eliminates _loadXxx boilerplate
      const metadata = data._metadata || {};
      for (const [key, def] of Object.entries(METADATA_SCHEMA)) {
        const raw = metadata[key];
        if (raw) {
          try {
            this[key] = def.deserialize(raw);
          } catch {
            this[key] = typeof def.default === 'function' ? def.default() : def.default;
          }
        } else {
          this[key] = typeof def.default === 'function' ? def.default() : def.default;
        }
      }
      this._dirtyFiles.clear();
      this._deletedFiles.clear();
      this._dirtyParseResults.clear();
      this._deletedParseResults.clear();
      this._dirtySymbols.clear();
      this._deletedSymbols.clear();
      this._dirtyDiagnostics.clear();
      this._deletedDiagnostics.clear();
      this.hasLoaded = true;

      return true;
    } catch (err) {
      if (process.env.DEBUG) {
        console.error('[Cache] SQLite load failed:', err.message);
      }
      return false;
    }
  }

  /**
   * Save to disk
   */
  async save() {
    if (!this.dirty) {
      return true; // No changes to save, skip database write storm
    }
    try {
      const metadata = {};
      for (const key of Object.keys(METADATA_SCHEMA)) {
        const def = METADATA_SCHEMA[key];
        const val = this[key];
        if (val !== undefined) {
          const serialized = def.serialize(val);
          if (serialized != null) {
            metadata[key] = serialized;
          }
        }
      }

      // Safeguard: if never loaded successfully, treat all current memory map entries as dirty.
      if (!this.hasLoaded) {
        for (const key of this.fileMetadata.keys()) this._dirtyFiles.add(key);
        for (const key of this.parseResults.keys()) this._dirtyParseResults.add(key);
        for (const name of this.symbolIndex.keys()) this._dirtySymbols.add(name);
        for (const key of this.diagnostics.keys()) this._dirtyDiagnostics.add(key);
        this.hasLoaded = true;
      }

      const dirtyFiles = [];
      for (const key of this._dirtyFiles) {
        const val = this.fileMetadata.get(key);
        if (val) dirtyFiles.push([key, val]);
      }
      const dirtyParseResults = [];
      for (const key of this._dirtyParseResults) {
        const val = this.parseResults.get(key);
        if (val) dirtyParseResults.push([key, val]);
      }
      const dirtySymbols = [];
      for (const name of this._dirtySymbols) {
        const val = this.symbolIndex.get(name);
        if (val) dirtySymbols.push([name, val]);
      }
      const dirtyDiagnostics = [];
      for (const key of this._dirtyDiagnostics) {
        const val = this.diagnostics.get(key);
        if (val) dirtyDiagnostics.push([key, val]);
      }

      const ok = this._graphDb.saveIncremental({
        workspaceRoot: this.workspaceRoot,
        workspaceInfo: this.workspaceInfo,
        metadata,
        dirtyFiles,
        deletedFiles: Array.from(this._deletedFiles),
        dirtyParseResults,
        deletedParseResults: Array.from(this._deletedParseResults),
        dirtySymbols,
        deletedSymbols: Array.from(this._deletedSymbols),
        dirtyDiagnostics,
        deletedDiagnostics: Array.from(this._deletedDiagnostics),
      });

      if (ok) {
        this._dirtyFiles.clear();
        this._deletedFiles.clear();
        this._dirtyParseResults.clear();
        this._deletedParseResults.clear();
        this._dirtySymbols.clear();
        this._deletedSymbols.clear();
        this._dirtyDiagnostics.clear();
        this._deletedDiagnostics.clear();
        this.lastSaved = Date.now();
        this.dirty = false;
      }
      return ok;
    } catch (err) {
      if (process.env.DEBUG) {
        console.error('[Cache] SQLite save failed:', err.message);
      }
      return false;
    }
  }

  /**
   * Generic metadata save — new fields only need schema registration.
   */
  saveMetadata(key, value) {
    const def = METADATA_SCHEMA[key];
    if (!def) throw new Error(`Unknown metadata key: ${key}`);
    try {
      const serialized = def.serialize(value);
      if (serialized != null) {
        this._graphDb.setMetadata(key, serialized);
      }
      this[key] = value;
      this.dirty = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generic metadata load — new fields only need schema registration.
   */
  loadMetadata(key) {
    const def = METADATA_SCHEMA[key];
    if (!def) throw new Error(`Unknown metadata key: ${key}`);
    const raw = this._graphDb.getMetadata(key);
    if (!raw) {
      this[key] = typeof def.default === 'function' ? def.default() : def.default;
      return this[key];
    }
    try {
      this[key] = def.deserialize(raw);
    } catch {
      this[key] = typeof def.default === 'function' ? def.default() : def.default;
    }
    return this[key];
  }

  // Backwards-compat wrappers around saveMetadata / loadMetadata

  saveCoChanges(coChanges) {
    return this.saveMetadata('coChanges', coChanges);
  }

  savePageRanks(pageRanks) {
    return this.saveMetadata('pageRanks', pageRanks);
  }

  // Workspace info cache
  getWorkspaceInfo() {
    return this.workspaceInfo;
  }

  setWorkspaceInfo(info) {
    this.workspaceInfo = info;
    this.dirty = true;
  }

  // File metadata cache
  getFileMetadata(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return undefined;
    return this.fileMetadata.get(key);
  }

  setFileMetadata(filePath, metadata) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return;
    // Preserve the platform-native path for display consistency
    this.fileMetadata.set(key, { ...metadata, originalPath: filePath });
    this._dirtyFiles.add(key);
    this._deletedFiles.delete(key);
    this.dirty = true;
  }

  hasFileMetadata(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return false;
    return this.fileMetadata.has(key);
  }

  deleteFileMetadata(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return;
    this.fileMetadata.delete(key);
    this._deletedFiles.add(key);
    this._dirtyFiles.delete(key);
    this.dirty = true;
  }

  // Parse result cache
  getParseResult(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return undefined;
    return this.parseResults.get(key);
  }

  setParseResult(filePath, result) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return;
    this.parseResults.set(key, result);
    this._dirtyParseResults.add(key);
    this._deletedParseResults.delete(key);
    this.dirty = true;
  }

  hasParseResult(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return false;
    return this.parseResults.has(key);
  }

  deleteParseResult(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return;
    this.parseResults.delete(key);
    this._deletedParseResults.add(key);
    this._dirtyParseResults.delete(key);
    this.dirty = true;
  }

  // Symbol index cache
  getSymbols(name) {
    return this.symbolIndex.get(name) || [];
  }

  setSymbols(name, locations) {
    const normalized = (Array.isArray(locations) ? locations : [])
      .map((location) => {
        const key = this.normalizeFilePath(location?.file);
        if (!key) return null;
        return { ...location, file: key };
      })
      .filter(Boolean);
    this.symbolIndex.set(name, normalized);
    this._dirtySymbols.add(name);
    this._deletedSymbols.delete(name);
    this.dirty = true;
  }

  deleteSymbol(name) {
    this.symbolIndex.delete(name);
    this._deletedSymbols.add(name);
    this._dirtySymbols.delete(name);
    this.dirty = true;
  }

  // Diagnostics cache
  getDiagnostics(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return [];
    const entry = this.diagnostics.get(key);
    return entry?.diagnostics || [];
  }

  getDiagnosticsEntry(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return null;
    return this.diagnostics.get(key) || null;
  }

  getAllDiagnostics() {
    const all = [];
    for (const [, entry] of this.diagnostics) {
      const diags = entry?.diagnostics;
      if (Array.isArray(diags)) all.push(...diags);
    }
    return all;
  }

  hasDiagnosticEntries() {
    return this.diagnostics.size > 0;
  }

  setDiagnostics(filePath, diags) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return;
    this.diagnostics.set(key, diags);
    this._dirtyDiagnostics.add(key);
    this._deletedDiagnostics.delete(key);
    this.dirty = true;
  }

  clearDiagnostics(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return;
    this.diagnostics.delete(key);
    this._deletedDiagnostics.add(key);
    this._dirtyDiagnostics.delete(key);
    this.dirty = true;
  }

  getStats() {
    let diagnosticCount = 0;
    let totalLines = 0;
    for (const entry of this.diagnostics.values()) {
      const diags = entry?.diagnostics;
      if (Array.isArray(diags)) diagnosticCount += diags.length;
    }
    for (const meta of this.fileMetadata.values()) {
      totalLines += Number(meta?.lineCount) || 0;
    }
    return {
      files: this.fileMetadata.size,
      parseResults: this.parseResults.size,
      symbols: this.symbolIndex.size,
      diagnostics: diagnosticCount,
      totalLines,
    };
  }

  loadAggregateSummary() {
    // Already loaded by schema-driven load(); return memory value directly
    return this.aggregateSummary;
  }

  saveAggregateSummary(summary) {
    return this.saveMetadata('aggregateSummary', summary);
  }

  /**
   * Check whether any cached file has changed on disk since it was indexed.
   *
   * Fast path: mtime+size unchanged → skip (zero extra I/O).
   * Slow path: mtime+size changed → SHA-256 content hash to verify
   * actual change vs git-checkout-style mtime drift.
   *
   * Files that no longer exist are treated as changed.
   *
   * @returns {{ changed: boolean, changedFiles: string[] }}
   */
  checkFileChanges() {
    const changedFiles = [];
    for (const [key, meta] of this.fileMetadata) {
      const filePath = meta?.originalPath || key;
      try {
        const stat = fs.statSync(filePath);
        const storedMtime = Number(meta?.mtime);
        const storedSize = Number(meta?.size);
        // Fast path: mtime+size identical → unchanged
        if (stat.mtimeMs === storedMtime && stat.size === storedSize) {
          continue;
        }
        // Slow path: mtime/size drifted → verify with SHA-256 content hash
        const storedHash = meta?.hash;
        if (storedHash) {
          const content = fs.readFileSync(filePath, 'utf8');
          const currentHash = crypto.createHash('sha256').update(content).digest('hex');
          if (currentHash !== storedHash) {
            changedFiles.push(filePath);
          } else {
            // Content unchanged (e.g. git checkout); update stored mtime/size
            // so next check stays on the fast path.
            this.fileMetadata.set(key, { ...meta, mtime: stat.mtimeMs, size: stat.size });
            this._dirtyFiles.add(key);
            this._deletedFiles.delete(key);
            this.dirty = true;
          }
        } else {
          // Legacy cache without hash → fall back to mtime+size
          changedFiles.push(filePath);
        }
      } catch {
        // File deleted or inaccessible — treat as changed
        changedFiles.push(filePath);
      }
    }
    return { changed: changedFiles.length > 0, changedFiles };
  }

  close() {
    if (this._graphDb) {
      this._graphDb.close();
    }
  }
}

module.exports = {
  WorkspaceCache,
  computeDefaultCacheDir,
};
