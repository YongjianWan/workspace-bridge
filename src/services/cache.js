/**
 * WorkspaceCache - In-memory cache with SQLite persistence
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { normalizePathKey, normalizeFilePath } = require('../utils/path');
const { isLfsPointerFile } = require('../utils/git-environment-probe');
const { GraphDB } = require('./graph-db');
const { CACHE_VERSION, DEFAULTS } = require('../config/constants');

const CACHE_STALE_MS = DEFAULTS.STALENESS_THRESHOLD_MS;
const WINDOWS_ABSOLUTE_PATH_RE = /^([A-Za-z]):[\\/](.*)$/;
const WSL_MOUNT_ROOT = '/mnt';

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
  edgeMeta: {
    default: null,
    serialize: (v) => v ? JSON.stringify(v) : null,
    deserialize: (raw) => JSON.parse(raw),
  },
};

function computeDefaultCacheDir(workspaceRoot) {
  const preferredDir = path.join(workspaceRoot, '.workspace-bridge');
  const hash = crypto.createHash('md5').update(workspaceRoot).digest('hex').slice(0, 8);
  const fallbackDir = path.join(os.tmpdir(), 'workspace-bridge', hash);

  // Check if preferred is writeable, otherwise fallback
  let cacheDir = preferredDir;
  try {
    if (!fs.existsSync(preferredDir)) {
      fs.mkdirSync(preferredDir, { recursive: true });
    }
    const testFile = path.join(preferredDir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch {
    cacheDir = fallbackDir;
  }

  // Ensure gitignore if we are using the preferred workspace directory.
  // Only append to an existing .gitignore; do not create a new one, so
  // read-only commands like audit-diff do not surprise the user with an
  // untracked .gitignore file. Users can run `init` to create one.
  if (cacheDir === preferredDir) {
    try {
      const gitignorePath = path.join(workspaceRoot, '.gitignore');
      const entry = '.workspace-bridge/\n';
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf8');
        if (!content.split(/\r?\n/).some(line => line.trim() === '.workspace-bridge' || line.trim() === '.workspace-bridge/')) {
          const separator = content.endsWith('\n') ? '' : '\n';
          fs.appendFileSync(gitignorePath, separator + entry, 'utf8');
        }
      }
    } catch {}
  }

  // Migrate legacy cache.db if new location doesn't have one, but old one does
  const newDbPath = path.join(cacheDir, 'cache.db');
  const legacyDbPath = path.join(fallbackDir, 'cache.db');
  const legacyLockPath = legacyDbPath + '.lock';

  let isLegacyLocked = false;
  if (fs.existsSync(legacyLockPath)) {
    try {
      const content = fs.readFileSync(legacyLockPath, 'utf8').trim();
      const pid = Number.parseInt(content, 10);
      if (!Number.isNaN(pid)) {
        try {
          process.kill(pid, 0);
          isLegacyLocked = true;
        } catch (err) {
          isLegacyLocked = err.code === 'EPERM';
        }
      }
    } catch {}
  }

  if (cacheDir === preferredDir && !isLegacyLocked && !fs.existsSync(newDbPath) && fs.existsSync(legacyDbPath)) {
    // WAL-mode SQLite produces cache.db-wal and cache.db-shm peers. Migrate
    // them together so uncheckpointed data is not lost.
    const migrateFile = (src, dst) => {
      try {
        fs.renameSync(src, dst);
      } catch {
        try {
          fs.copyFileSync(src, dst);
          fs.unlinkSync(src);
        } catch {}
      }
    };
    migrateFile(legacyDbPath, newDbPath);
    migrateFile(legacyDbPath + '-wal', newDbPath + '-wal');
    migrateFile(legacyDbPath + '-shm', newDbPath + '-shm');
    try {
      fs.rmdirSync(fallbackDir);
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
    this.workspaceRoot = workspaceRoot;
    this.normalizeFilePath = (filePath) => normalizeFilePath(filePath, workspaceRoot);
    this.cacheDir = options.cacheDir || computeDefaultCacheDir(workspaceRoot);
    this.cachePath = path.join(this.cacheDir, 'cache.db');
    this._graphDb = new GraphDB(this.cachePath);

    // In-memory caches
    this.workspaceInfo = null;
    this.fileMetadata = new Map(); // file -> {mtime, size, hash}
    this.parseResults = new Map(); // file -> {imports, exports, importRecords, exportRecords, functionRecords, parseMode, confidence, mtime}
    this.parsedHashes = new Map(); // file -> hash at parse time
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
      if (!data) return false;
      this.workspaceInfo = data.workspaceInfo;
      this.fileMetadata = data.fileMetadata || new Map();
      this.parseResults = data.parseResults || new Map();
      this.parsedHashes.clear();
      for (const [key, meta] of this.fileMetadata.entries()) {
        if (meta.hash) {
          this.parsedHashes.set(key, meta.hash);
        }
      }
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
      this.parsedHashes.delete(candidate);
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
    
    // Also track the parsed content hash in memory
    const meta = this.getFileMetadata(filePath);
    if (meta && meta.hash) {
      this.parsedHashes.set(key, meta.hash);
    }
    
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
      this.parsedHashes.delete(candidate);
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
        // LFS pointer files must not use the mtime+size fast path: the pointer
        // content is stable even when the real binary content changes, so we
        // force the SHA-256 slow path to avoid a false "unchanged" conclusion.
        const lfsPointer = isLfsPointerFile(filePath);
        // Fast path: mtime+size identical → unchanged (unless LFS pointer).
        // mtime is stored as SQLite INTEGER (whole milliseconds), so compare
        // at integer precision to tolerate sub-millisecond stat drift.
        if (!lfsPointer && Math.round(stat.mtimeMs) === Math.round(storedMtime) && stat.size === storedSize) {
          if (pathDrifted) {
            this.fileMetadata.set(key, { ...meta, originalPath: filePath });
            this._fileTracker.mark(key);
            this.dirty = true;
          }
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
            // so next check stays on the fast path. Round mtime to integer ms
            // to stay aligned with SQLite INTEGER storage.
            this.fileMetadata.set(key, { ...meta, originalPath: filePath, mtime: Math.round(stat.mtimeMs), size: stat.size });
            this._fileTracker.mark(key);
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

  /**
   * Persist dependency edges to SQLite (full replacement).
   * Called by GraphBuilder after build()/updateFiles() post-process.
   */
  saveEdges(edges, meta = null) {
    const edgeMeta = meta || {
      cacheVersion: CACHE_VERSION,
      fileMetadataCount: this.fileMetadata.size,
      parseResultsCount: this.parseResults.size,
      timestamp: Date.now(),
    };
    const ok = this._graphDb.saveEdges(edges, edgeMeta);
    if (ok) this.edgeMeta = edgeMeta;
    return ok;
  }

  /**
   * Load dependency edges from SQLite.
   * @returns {Array<{source:string,target:string,edgeType:string,confidence:number}>|null}
   */
  loadEdges() {
    return this._graphDb.loadEdges();
  }

  // D7-D8: Precomputed aggregates / impact proxy methods

  savePrecomputedAggregates(rows) {
    return this._graphDb.savePrecomputedAggregates(rows);
  }

  loadPrecomputedAggregates() {
    return this._graphDb.loadPrecomputedAggregates();
  }

  savePrecomputedImpact(records) {
    return this._graphDb.savePrecomputedImpact(records);
  }

  loadPrecomputedImpact() {
    return this._graphDb.loadPrecomputedImpact();
  }

  deletePrecomputedImpact(files) {
    return this._graphDb.deletePrecomputedImpact(files);
  }

  saveMetrics(metrics) {
    return this._graphDb.saveMetrics(metrics);
  }

  loadMetrics() {
    return this._graphDb.loadMetrics();
  }

  loadMetricsForFiles(files) {
    return this._graphDb.loadMetricsForFiles(files);
  }

  saveTestMap(testMaps) {
    return this._graphDb.saveTestMap(testMaps);
  }

  loadTestMap() {
    return this._graphDb.loadTestMap();
  }

  loadTestMapForFiles(files) {
    return this._graphDb.loadTestMapForFiles(files);
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
};
