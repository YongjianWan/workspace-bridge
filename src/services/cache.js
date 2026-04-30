/**
 * WorkspaceCache - In-memory cache with disk persistence
 * Cache file: .workspace-bridge-cache.json (5-minute TTL)
 */
const fs = require('fs');
const path = require('path');
const { normalizePathKey } = require('../utils/path');

const CACHE_FILENAME = '.workspace-bridge-cache.json';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_VERSION = 2; // Increment when cache structure changes

class WorkspaceCache {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.cachePath = path.join(workspaceRoot, CACHE_FILENAME);
    
    // In-memory caches
    this.workspaceInfo = null;
    this.fileMetadata = new Map(); // file -> {mtime, size, hash}
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

  /**
   * Load from disk if exists and fresh
   */
  load() {
    try {
      if (!fs.existsSync(this.cachePath)) {
        return false;
      }

      const stat = fs.statSync(this.cachePath);
      const age = Date.now() - stat.mtimeMs;
      
      if (age > CACHE_TTL_MS) {
        return false;
      }

      const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      
      // Version check
      if (data.version !== CACHE_VERSION) {
        return false;
      }
      
      // Restore data
      this.workspaceInfo = data.workspaceInfo || null;
      this.fileMetadata = this.normalizeFileMapEntries(data.fileMetadata || []);
      this.symbolIndex = this.normalizeSymbolEntries(data.symbolIndex || []);
      this.diagnostics = this.normalizeDiagnosticsEntries(data.diagnostics || []);
      this.lastSaved = stat.mtimeMs;

      return true;
    } catch (err) {
      console.error('[Cache] Load failed:', err.message);
      return false;
    }
  }

  /**
   * Save to disk
   */
  save() {
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
      };

      tempPath = `${this.cachePath}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempPath, this.cachePath);
      this.lastSaved = Date.now();
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
    for (const entry of this.diagnostics.values()) {
      const diags = entry?.diagnostics;
      if (Array.isArray(diags)) diagnosticCount += diags.length;
    }
    return {
      files: this.fileMetadata.size,
      symbols: this.symbolIndex.size,
      diagnostics: diagnosticCount,
    };
  }
}

module.exports = {
  WorkspaceCache,
  CACHE_FILENAME,
};
