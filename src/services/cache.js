/**
 * WorkspaceCache - In-memory cache with disk persistence
 * Cache file: .workspace-bridge-cache.json (5-minute TTL)
 */
const fs = require('fs');
const path = require('path');
const { normalizePathKey } = require('../utils/path');

const CACHE_FILENAME = '.workspace-bridge-cache.json';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours — enables incremental reuse across CI runs
const CACHE_VERSION = 3; // Increment when cache structure changes

class WorkspaceCache {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.cachePath = path.join(workspaceRoot, CACHE_FILENAME);
    
    // In-memory caches
    this.workspaceInfo = null;
    this.fileMetadata = new Map(); // file -> {mtime, size, hash}
    this.symbolIndex = new Map();  // symbol -> [{file, line, type}]
    this.diagnostics = new Map();  // file -> [diagnostics]
    this.graphData = new Map();    // file -> {imports, exports, importRecords, exportRecords, parseMode, mtime, size}
    
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
    for (const [filePath, metadata] of entries || []) {
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
    for (const [filePath, diagnostics] of entries || []) {
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

  normalizeGraphEntries(entries) {
    const normalized = new Map();
    for (const [filePath, data] of entries || []) {
      const key = this.normalizeFilePath(filePath);
      if (!key) continue;
      normalized.set(key, data);
    }
    return normalized;
  }

  /**
   * Load from disk if exists and fresh
   */
  async load() {
    try {
      if (!fs.existsSync(this.cachePath)) {
        console.error('[Cache] No cache file found');
        return false;
      }

      const stat = fs.statSync(this.cachePath);
      const age = Date.now() - stat.mtimeMs;
      
      if (age > CACHE_TTL_MS) {
        console.error(`[Cache] Cache expired (${Math.round(age/1000)}s old)`);
        return false;
      }

      const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      
      // Version check
      if (data.version !== CACHE_VERSION) {
        console.error(`[Cache] Version mismatch: ${data.version} != ${CACHE_VERSION}, ignoring cache`);
        return false;
      }
      
      // Restore data
      this.workspaceInfo = data.workspaceInfo || null;
      this.fileMetadata = this.normalizeFileMapEntries(data.fileMetadata || []);
      this.symbolIndex = this.normalizeSymbolEntries(data.symbolIndex || []);
      this.diagnostics = this.normalizeDiagnosticsEntries(data.diagnostics || []);
      this.graphData = this.normalizeGraphEntries(data.graphData || []);
      this.lastSaved = stat.mtimeMs;

      console.error(`[Cache] Loaded: ${this.fileMetadata.size} files, ${this.symbolIndex.size} symbols`);
      return true;
    } catch (err) {
      console.error('[Cache] Load failed:', err.message);
      return false;
    }
  }

  /**
   * Save to disk
   */
  async save() {
    let tempPath = null;
    try {
      const data = {
        version: CACHE_VERSION,
        timestamp: Date.now(),
        workspaceRoot: this.workspaceRoot,
        workspaceInfo: this.workspaceInfo,
        fileMetadata: Array.from(this.fileMetadata.entries()),
        symbolIndex: Array.from(this.symbolIndex.entries()),
        diagnostics: Array.from(this.diagnostics.entries()),
        graphData: Array.from(this.graphData.entries()),
      };

      tempPath = `${this.cachePath}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempPath, this.cachePath);
      this.lastSaved = Date.now();
      console.error('[Cache] Saved');
      return true;
    } catch (err) {
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch (_) {
          // Best effort cleanup.
        }
      }
      console.error('[Cache] Save failed:', err.message);
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
    this.fileMetadata.set(key, metadata);
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

  // Diagnostics cache
  getDiagnostics(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return [];
    return this.diagnostics.get(key) || [];
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

  // Dep-graph data cache (imports/exports per file, used for incremental analysis)
  getGraphData(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return undefined;
    return this.graphData.get(key);
  }

  setGraphData(filePath, data) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return;
    this.graphData.set(key, data);
  }

  hasGraphData(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return false;
    return this.graphData.has(key);
  }

  deleteGraphData(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return;
    this.graphData.delete(key);
  }

  getStats() {
    return {
      files: this.fileMetadata.size,
      symbols: this.symbolIndex.size,
      diagnostics: Array.from(this.diagnostics.values()).flat().length,
      graphEntries: this.graphData.size,
    };
  }
}

module.exports = {
  WorkspaceCache,
  CACHE_FILENAME,
};
