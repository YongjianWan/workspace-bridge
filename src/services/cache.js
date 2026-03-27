/**
 * WorkspaceCache - In-memory cache with disk persistence
 * Cache file: .workspace-bridge-cache.json (5-minute TTL)
 */
const fs = require('fs');
const path = require('path');

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
      this.fileMetadata = new Map(data.fileMetadata || []);
      this.symbolIndex = new Map(data.symbolIndex || []);
      this.diagnostics = new Map(data.diagnostics || []);
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

      fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2));
      this.lastSaved = Date.now();
      console.error('[Cache] Saved');
      return true;
    } catch (err) {
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
    return this.fileMetadata.get(filePath);
  }

  setFileMetadata(filePath, metadata) {
    this.fileMetadata.set(filePath, metadata);
  }

  hasFileMetadata(filePath) {
    return this.fileMetadata.has(filePath);
  }

  deleteFileMetadata(filePath) {
    this.fileMetadata.delete(filePath);
  }

  // Symbol index cache
  getSymbols(name) {
    return this.symbolIndex.get(name) || [];
  }

  setSymbols(name, locations) {
    this.symbolIndex.set(name, locations);
  }

  // Diagnostics cache
  getDiagnostics(filePath) {
    return this.diagnostics.get(filePath) || [];
  }

  setDiagnostics(filePath, diags) {
    this.diagnostics.set(filePath, diags);
  }

  clearDiagnostics(filePath) {
    this.diagnostics.delete(filePath);
  }

  getStats() {
    return {
      files: this.fileMetadata.size,
      symbols: this.symbolIndex.size,
      diagnostics: Array.from(this.diagnostics.values()).flat().length,
    };
  }
}

module.exports = {
  WorkspaceCache,
  CACHE_FILENAME,
};
