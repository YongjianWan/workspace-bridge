/**
 * WorkspaceCache - In-memory cache with SQLite persistence
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { normalizeFilePath } = require('../utils/path');
const { GraphDB } = require('./graph-db');
const { DEFAULTS } = require('../config/constants');

const CACHE_STALE_MS = DEFAULTS.STALENESS_THRESHOLD_MS;
const WINDOWS_ABSOLUTE_PATH_RE = /^([A-Za-z]):[\\/](.*)$/;
const WSL_MOUNT_ROOT = '/mnt';

function isolateCorruptFile(source, destination) {
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    // Windows can reject rename with EBADF while copy/delete remain available.
    if (error.code !== 'EBADF') throw error;
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.unlinkSync(source);
  }
}

/**
 * The one content hash every cache layer keys on. Hashes raw bytes, so a file
 * that is not valid UTF-8 still gets a stable key.
 * @param {Buffer} bytes
 * @returns {string}
 */
function hashFileContent(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

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
        dataQuality: v.dataQuality,
        remediation: v.remediation,
      });
    },
    deserialize(raw) {
      const obj = JSON.parse(raw);
      return {
        pairCounts: new Map(obj.pairCounts || []),
        fileChangeCounts: new Map(obj.fileChangeCounts || []),
        commitCount: obj.commitCount || 0,
        dataQuality: obj.dataQuality || null,
        remediation: obj.remediation || null,
      };
    },
  },
};

function computeDefaultCacheDir(workspaceRoot, warnings = []) {
  const hash = crypto.createHash('md5').update(workspaceRoot).digest('hex').slice(0, 8);
  const cacheRoot = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : (process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
  const preferredDir = path.join(cacheRoot, 'workspace-bridge', hash);
  const fallbackDir = path.join(os.tmpdir(), 'workspace-bridge', hash);
  let cacheDir = preferredDir;

  try {
    fs.mkdirSync(preferredDir, { recursive: true });
    const testFile = path.join(preferredDir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch (error) {
    cacheDir = fallbackDir;
    warnings.push({ type: 'cache-directory-fallback', severity: 'medium',
      message: `Preferred cache directory is not writable (${error.message}); using ${fallbackDir}` });
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const newDbPath = path.join(cacheDir, 'cache.db');
  const legacyDirs = [path.join(workspaceRoot, '.workspace-bridge'), fallbackDir];
  for (const legacyDir of legacyDirs) {
    if (legacyDir === cacheDir || fs.existsSync(newDbPath)) break;
    const legacyDbPath = path.join(legacyDir, 'cache.db');
    if (!fs.existsSync(legacyDbPath)) continue;
    const lockPath = legacyDbPath + '.lock';
    if (fs.existsSync(lockPath)) {
      try {
        const pid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
        if (!Number.isNaN(pid)) {
          try {
            process.kill(pid, 0);
            continue;
          } catch (err) {
            if (err.code === 'EPERM') continue;
          }
        }
      } catch {}
    }

    // Move the SQLite database and WAL peers together; keep unknown files.
    for (const suffix of ['', '-wal', '-shm']) {
      const src = legacyDbPath + suffix;
      if (!fs.existsSync(src)) continue;
      const dst = newDbPath + suffix;
      try {
        fs.renameSync(src, dst);
      } catch {
        try {
          fs.copyFileSync(src, dst);
          fs.unlinkSync(src);
        } catch {}
      }
    }
    try {
      fs.rmdirSync(legacyDir);
    } catch {}
  }

  return cacheDir;
}

function windowsPathToWslPath(filePath) {
  if (!filePath || process.platform === 'win32') return null;
  const match = WINDOWS_ABSOLUTE_PATH_RE.exec(String(filePath));
  if (!match) return null;
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/');
  return path.join(WSL_MOUNT_ROOT, drive, rest);
}

function uniquePathCandidates(paths) {
  const seen = new Set();
  const result = [];
  for (const candidate of paths) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}

function resolveCachedFilePath(filePath, key) {
  const candidates = uniquePathCandidates([
    filePath,
    key,
    windowsPathToWslPath(filePath),
    windowsPathToWslPath(key),
  ]);
  for (const candidate of candidates) {
    try {
      return { filePath: candidate, stat: fs.statSync(candidate) };
    } catch {
      // Try the next historical path shape.
    }
  }
  return { filePath: filePath || key, stat: null };
}

class DirtyTracker {
  constructor(dataMap) {
    this._dataMap = dataMap;
    this.dirty = new Set();
    this.deleted = new Set();
  }
  mark(key) {
    this.dirty.add(key);
    this.deleted.delete(key);
  }
  unmark(key) {
    this.deleted.add(key);
    this.dirty.delete(key);
  }
  clear() {
    this.dirty.clear();
    this.deleted.clear();
  }
  getDirtyEntries() {
    const entries = [];
    for (const key of this.dirty) {
      const val = this._dataMap.get(key);
      if (val) entries.push([key, val]);
    }
    return entries;
  }
  getDeletedArray() {
    return Array.from(this.deleted);
  }
}

class WorkspaceCache {
  constructor(workspaceRoot, options = {}) {
    this.warnings = options.warnings || [];
    this.workspaceRoot = workspaceRoot;
    this.normalizeFilePath = (filePath) => normalizeFilePath(filePath, workspaceRoot);
    this.cacheDir = options.cacheDir || computeDefaultCacheDir(workspaceRoot, this.warnings);
    this.cachePath = path.join(this.cacheDir, 'cache.db');
    this._graphDb = new GraphDB(this.cachePath);

    // In-memory caches
    this.workspaceInfo = null;
    this.fileMetadata = new Map(); // file -> {mtime, size, hash}
    this.parseResults = new Map(); // file -> {imports, exports, importRecords, exportRecords, functionRecords, parseMode, confidence, mtime}
    this.symbolIndex = new Map();  // symbol -> [{file, line, type}]
    this.diagnostics = new Map();  // file -> [diagnostics]

    // Incremental tracking — INVARIANT enforced by DirtyTracker structure
    this._fileTracker = new DirtyTracker(this.fileMetadata);
    this._parseTracker = new DirtyTracker(this.parseResults);
    this._symbolTracker = new DirtyTracker(this.symbolIndex);
    this._diagTracker = new DirtyTracker(this.diagnostics);
    this.hasLoaded = false;

    // Schema-driven metadata fields — register in METADATA_SCHEMA to add new ones
    for (const [key, def] of Object.entries(METADATA_SCHEMA)) {
      this[key] = typeof def.default === 'function' ? def.default() : def.default;
    }

    this.lastSaved = 0;
    this.dirty = false;
    // When FileIndex last confirmed every tracked file's hash against disk (ms since epoch; 0 = never).
    this.contentVerifiedAt = 0;
  }

  _resetTrackers() {
    this._fileTracker = new DirtyTracker(this.fileMetadata);
    this._parseTracker = new DirtyTracker(this.parseResults);
    this._symbolTracker = new DirtyTracker(this.symbolIndex);
    this._diagTracker = new DirtyTracker(this.diagnostics);
  }

  _resolveKeys(filePath) {
    const key = this.normalizeFilePath(filePath);
    return uniquePathCandidates([key, filePath]);
  }

  _normalizeEntries(entries, options = {}) {
    const {
      keyMapper = (k) => this.normalizeFilePath(k),
      valueMapper = (v) => v,
      mergeMtime = false,
    } = options;
    const normalized = new Map();
    const iterable = Array.isArray(entries) ? entries : [];
    for (const [rawKey, rawValue] of iterable) {
      const key = keyMapper ? keyMapper(rawKey) : rawKey;
      if (keyMapper && !key) continue;
      let value = valueMapper(rawValue);
      if (mergeMtime) {
        const existing = normalized.get(key);
        if (existing) {
          const existingMtime = Number(existing?.mtime);
          const nextMtime = Number(value?.mtime);
          const existingSafe = Number.isNaN(existingMtime) ? 0 : existingMtime;
          const nextSafe = Number.isNaN(nextMtime) ? 0 : nextMtime;
          if (nextSafe <= existingSafe) continue;
        }
      }
      normalized.set(key, value);
    }
    return normalized;
  }

  normalizeFileMapEntries(entries) {
    return this._normalizeEntries(entries, { mergeMtime: true });
  }

  normalizeDiagnosticsEntries(entries) {
    return this._normalizeEntries(entries);
  }

  normalizeSymbolEntries(entries) {
    return this._normalizeEntries(entries, {
      keyMapper: null,
      valueMapper: (locations) => {
        const list = Array.isArray(locations) ? locations : [];
        return list
          .map((location) => {
            const key = this.normalizeFilePath(location?.file);
            if (!key) return null;
            return { ...location, file: key };
          })
          .filter(Boolean);
      },
    });
  }

  normalizeParseResultEntries(entries) {
    return this._normalizeEntries(entries);
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
      if (!data) {
        const error = this._graphDb.lastError;
        if (error) {
          this.warnings.push({ type: 'cache-load-failed', severity: 'medium', message: `Cache could not be loaded: ${error.message}; rebuilding from source` });
          if (/not a database|malformed|corrupt/i.test(error.message)) {
            this._graphDb._withWriteLock(() => {
              this._graphDb.close();
              const suffix = `.corrupt-${Date.now()}`;
              for (const peer of ['', '-wal', '-shm']) {
                if (fs.existsSync(this.cachePath + peer)) isolateCorruptFile(this.cachePath + peer, this.cachePath + suffix + peer);
              }
            });
          }
        }
        return false;
      }
      this.workspaceInfo = data.workspaceInfo;
      this.fileMetadata = data.fileMetadata || new Map();
      this.parseResults = data.parseResults || new Map();
      this.symbolIndex = data.symbolIndex || new Map();
      this.diagnostics = data.diagnostics || new Map();
      this._resetTrackers();
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
      this._fileTracker.clear();
      this._parseTracker.clear();
      this._symbolTracker.clear();
      this._diagTracker.clear();
      this.hasLoaded = true;

      return true;
    } catch (err) {
      this.warnings.push({ type: 'cache-load-failed', severity: 'medium', message: `Cache recovery failed: ${err.message}; rebuilding from source` });
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
        for (const key of this.fileMetadata.keys()) this._fileTracker.mark(key);
        for (const key of this.parseResults.keys()) this._parseTracker.mark(key);
        for (const name of this.symbolIndex.keys()) this._symbolTracker.mark(name);
        for (const key of this.diagnostics.keys()) this._diagTracker.mark(key);
        this.hasLoaded = true;
      }

      const ok = this._graphDb.saveIncremental({
        workspaceRoot: this.workspaceRoot,
        workspaceInfo: this.workspaceInfo,
        metadata,
        dirtyFiles: this._fileTracker.getDirtyEntries(),
        deletedFiles: this._fileTracker.getDeletedArray(),
        dirtyParseResults: this._parseTracker.getDirtyEntries(),
        deletedParseResults: this._parseTracker.getDeletedArray(),
        dirtySymbols: this._symbolTracker.getDirtyEntries(),
        deletedSymbols: this._symbolTracker.getDeletedArray(),
        dirtyDiagnostics: this._diagTracker.getDirtyEntries(),
        deletedDiagnostics: this._diagTracker.getDeletedArray(),
      });

      if (ok) {
        this._fileTracker.clear();
        this._parseTracker.clear();
        this._symbolTracker.clear();
        this._diagTracker.clear();
        this.lastSaved = Date.now();
        this.dirty = false;
      } else {
        this._warnWriteFailure('SQLite write failed');
      }
      return ok;
    } catch (err) {
      this._warnWriteFailure(err.message);
      if (process.env.DEBUG) {
        console.error('[Cache] SQLite save failed:', err.message);
      }
      return false;
    }
  }

  _warnWriteFailure(message) {
    this.warnings = this.warnings.filter(warning => warning.type !== 'cache-write-failed');
    this.warnings.push({ type: 'cache-write-failed', severity: 'medium',
      message: `Cache could not be saved at ${this.cachePath}: ${message}; the next run will rebuild it` });
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

  saveCoChanges(coChanges) {
    return this.saveMetadata('coChanges', coChanges);
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
    if (!key) return this.fileMetadata.get(filePath);
    if (this.fileMetadata.has(key)) return this.fileMetadata.get(key);
    return this.fileMetadata.get(key);
  }

  setFileMetadata(filePath, metadata) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return;
    // Preserve the platform-native path for display consistency
    this.fileMetadata.set(key, { ...metadata, originalPath: filePath });
    this._fileTracker.mark(key);
    this.dirty = true;
  }

  hasFileMetadata(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return this.fileMetadata.has(filePath);
    return this.fileMetadata.has(key) || this.fileMetadata.has(filePath);
  }

  deleteFileMetadata(filePath) {
    const keys = this._resolveKeys(filePath);
    if (keys.length === 0) return;
    for (const candidate of keys) {
      this.fileMetadata.delete(candidate);
      this._fileTracker.unmark(candidate);
      // Cascade to associated cache slots so deletion leaves no ghost data.
      this.parseResults.delete(candidate);
      this._parseTracker.unmark(candidate);
      this.diagnostics.delete(candidate);
      this._diagTracker.unmark(candidate);
    }
    const normalizedKey = this.normalizeFilePath(filePath);
    if (normalizedKey) {
      for (const [name, locations] of this.symbolIndex) {
        const remaining = locations.filter((loc) => loc.file !== normalizedKey && loc.file !== filePath);
        if (remaining.length === 0) {
          this.symbolIndex.delete(name);
          this._symbolTracker.unmark(name);
        } else if (remaining.length !== locations.length) {
          this.symbolIndex.set(name, remaining);
          this._symbolTracker.mark(name);
        }
      }
    }
    this.dirty = true;
  }

  // Parse result cache
  getParseResult(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return this.parseResults.get(filePath);
    return this.parseResults.get(key) || this.parseResults.get(filePath);
  }

  setParseResult(filePath, result) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return;
    this.parseResults.set(key, result);
    this._parseTracker.mark(key);

    this.dirty = true;
  }

  hasParseResult(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return this.parseResults.has(filePath);
    return this.parseResults.has(key) || this.parseResults.has(filePath);
  }

  deleteParseResult(filePath) {
    const keys = this._resolveKeys(filePath);
    if (keys.length === 0) return;
    for (const candidate of keys) {
      this.parseResults.delete(candidate);
      this._parseTracker.unmark(candidate);
    }
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
    this._symbolTracker.mark(name);
    this.dirty = true;
  }

  deleteSymbol(name) {
    this.symbolIndex.delete(name);
    this._symbolTracker.unmark(name);
    this.dirty = true;
  }

  // Diagnostics cache
  getDiagnostics(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return [];
    const entry = this.diagnostics.get(key) || this.diagnostics.get(filePath);
    return entry?.diagnostics || [];
  }

  getDiagnosticsEntry(filePath) {
    const key = this.normalizeFilePath(filePath);
    if (!key) return this.diagnostics.get(filePath) || null;
    return this.diagnostics.get(key) || this.diagnostics.get(filePath) || null;
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
    this._diagTracker.mark(key);
    this.dirty = true;
  }

  clearDiagnostics(filePath) {
    const keys = this._resolveKeys(filePath);
    if (keys.length === 0) return;
    for (const candidate of keys) {
      this.diagnostics.delete(candidate);
      this._diagTracker.unmark(candidate);
    }
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

  /**
   * Check whether any cached file has changed on disk since it was indexed.
   *
   * Compare SHA-256 content even when mtime and size match. Copies and
   * archive extraction can restore timestamps after changing content.
   *
   * Files that no longer exist are treated as changed.
   *
   * @returns {{ changed: boolean, changedFiles: string[] }}
   */
  checkFileChanges() {
    const changedFiles = [];
    for (const [key, meta] of this.fileMetadata) {
      const cachedPath = meta?.originalPath || key;
      const resolved = resolveCachedFilePath(cachedPath, key);
      const filePath = resolved.filePath;
      try {
        if (!resolved.stat) {
          throw new Error('cached file missing');
        }
        const stat = resolved.stat;
        const storedMtime = Number(meta?.mtime);
        const storedSize = Number(meta?.size);
        const pathDrifted = filePath !== cachedPath;
        // mtime and size are only hints. An archive or copy can restore both
        // after changing content, so trust the stored content hash.
        const storedHash = meta?.hash;
        if (!storedHash) {
          changedFiles.push(filePath);
          continue;
        }
        const currentHash = hashFileContent(fs.readFileSync(filePath));
        if (currentHash !== storedHash) {
          changedFiles.push(filePath);
          continue;
        }
        // Keep SQLite metadata aligned without dirtying an unchanged cache.
        if (pathDrifted || Math.round(stat.mtimeMs) !== Math.round(storedMtime) || stat.size !== storedSize) {
          this.fileMetadata.set(key, { ...meta, originalPath: filePath, mtime: Math.round(stat.mtimeMs), size: stat.size });
          this._fileTracker.mark(key);
          this.dirty = true;
        }
      } catch {
        // File deleted or inaccessible — treat as changed
        changedFiles.push(filePath);
      }
    }
    return { changed: changedFiles.length > 0, changedFiles };
  }

  saveAnalysisSnapshot(key, data, version, fileCount, configHash, contentSignature) {
    return this._graphDb.saveAnalysisSnapshot(key, data, version, fileCount, configHash, contentSignature);
  }

  /**
   * Fingerprint of the indexed file set: path + content hash of every tracked
   * file. Snapshot freshness compares this, so any content edit invalidates a
   * stored snapshot — including one that restores mtime and size.
   *
   * Reads the metadata the index already holds; FileIndex verifies every hash
   * against disk during initialize, so signatures taken post-initialize
   * describe the tree as it is.
   * @returns {string} hex digest, or '' when nothing is indexed
   */
  getContentSignature() {
    if (!this.fileMetadata || this.fileMetadata.size === 0) return '';
    const hash = crypto.createHash('sha256');
    for (const key of [...this.fileMetadata.keys()].sort()) {
      const meta = this.fileMetadata.get(key);
      // Every indexed entry carries its content hash; one without it cannot
      // be vouched for, and signing it would make the snapshot unverifiable.
      if (!meta.hash) throw new Error(`[Cache] file metadata without content hash: ${key}`);
      hash.update(key).update('|').update(meta.hash).update('\n');
    }
    return hash.digest('hex');
  }

  loadAnalysisSnapshot(key) {
    return this._graphDb.loadAnalysisSnapshot(key);
  }

  queryReadOnly(sql, options) {
    return this._graphDb.queryReadOnly(sql, options);
  }

  close() {
    if (this._graphDb) {
      try {
        this._graphDb.close();
      } catch {
        // Best effort: avoid leaking a shutdown error to callers.
      }
    }
  }

  walCheckpoint(mode) {
    if (this._graphDb) {
      try {
        this._graphDb.walCheckpoint(mode);
      } catch {
        // Best effort: WAL checkpoint is advisory.
      }
    }
  }
}

module.exports = {
  WorkspaceCache,
  computeDefaultCacheDir,
  hashFileContent,
};
