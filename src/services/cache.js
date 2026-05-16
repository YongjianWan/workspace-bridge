/**
 * WorkspaceCache - In-memory cache with SQLite persistence
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { normalizePathKey } = require('../utils/path');
const { GraphDB } = require('./graph-db');
const { CACHE_VERSION } = require('../config/constants');

const CACHE_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

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

    this.lastSaved = 0;
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
    try {
      const ok = this._graphDb.saveAll({
        workspaceRoot: this.workspaceRoot,
        workspaceInfo: this.workspaceInfo,
        fileMetadata: Array.from(this.fileMetadata.entries()),
        parseResults: Array.from(this.parseResults.entries()),
        symbolIndex: Array.from(this.symbolIndex.entries()),
        diagnostics: Array.from(this.diagnostics.entries()),
      });
      if (ok) {
        this.lastSaved = Date.now();
      }
      return ok;
    } catch (err) {
      if (process.env.DEBUG) {
        console.error('[Cache] SQLite save failed:', err.message);
      }
      return false;
    }
  }

  // Workspace info cache
  getWorkspaceInfo() {
    return this.workspaceInfo;
  }

  setWorkspaceInfo(info) {
    this.workspaceInfo = info;
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
  }

  deleteSymbol(name) {
    this.symbolIndex.delete(name);
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

  setDiagnostics(filePath, diags) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return;
    this.diagnostics.set(key, diags);
  }

  clearDiagnostics(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return;
    this.diagnostics.delete(key);
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

  /**
   * Check whether any cached file has changed on disk since it was indexed.
   * Compares stored mtime/size against current fs.statSync values.
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
        if (stat.mtimeMs !== storedMtime || stat.size !== storedSize) {
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
