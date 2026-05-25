/**
 * ServiceContainer - Lifecycle management for all stateful services
 * Provides initialization gate with ensureReady()
 */
const { WorkspaceCache } = require('./cache');
const { FileIndex } = require('./file-index');
const { DiagnosticsEngine } = require('./diagnostics-engine');
const { DependencyGraph } = require('./dep-graph');
const { ProjectContext } = require('../utils/project-context');
const { TIMEOUTS, DEFAULTS } = require('../config/constants');
const {
  WorkspaceSnapshot,
  DependencyGraphView,
  computeKnownBlindSpots,
  computeConfidenceByDomain,
} = require('../models/workspace-snapshot');

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)} seconds`;
  if (ms < 3600000) return `${Math.round(ms / 60000)} minutes`;
  return `${Math.round(ms / 3600000)} hours`;
}

class ServiceContainer {
  constructor(options = {}) {
    this.initialized = false;
    this.initializing = false;
    this._shuttingDown = false;
    this.initError = null;
    this.workspaceRoot = null;
    this.quiet = options.quiet || false;
    this.options = options;
    
    // Services
    this.cache = null;
    this.fileIndex = null;
    this.diagnostics = null;
    this._depGraph = null;
    this._depGraphAccessWarned = false;
    this.projectContext = null;
    this.snapshot = null;

    /** @deprecated Use `this.snapshot.graph` instead. Direct depGraph access will be removed in a future version. */
    Object.defineProperty(this, 'depGraph', {
      get: () => {
        if (!this._depGraphAccessWarned) {
          console.error('[deprecated] container.depGraph is deprecated. Use container.snapshot.graph instead.');
          this._depGraphAccessWarned = true;
        }
        return this._depGraph;
      },
      set: (value) => {
        this._depGraph = value;
      },
      enumerable: true,
      configurable: true,
    });
    
    // Shared promise for concurrent waiters (eliminates busy-loop polling)
    this._readyPromise = null;
  }

  _checkAborted() {
    if (!this.initializing || this._readyPromise === null) {
      throw new Error('Container shut down during initialization');
    }
  }

  /**
   * Initialize all services. Thread-safe with mutex-like behavior.
   */
  async initialize(cwd, timeoutMs = TIMEOUTS.INIT_TIMEOUT_MS, options = {}) {
    if (this._shuttingDown) {
      throw new Error('Container is shutting down');
    }

    // Allow re-initialization after shutdown by clearing the fatal error
    this.initError = null;

    // Mutex: if already initializing, wait on shared promise
    if (this.initializing) {
      if (this._readyPromise) {
        try {
          await this._readyPromise;
        } catch {
          // First init failed — return outcome below
        }
      }
      return this.initialized;
    }

    // If already initialized, skip
    if (this.initialized) {
      return true;
    }

    this.initializing = true;
    this.initError = null;
    this._readyPromise = null;
    
    let resolveReady, rejectReady;
    this._readyPromise = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this._readyPromise.catch(() => {});

    try {
      this._phaseTimes = {};
      this._findWorkspaceRoot(cwd);
      this._checkAborted();
      this._initCache();
      this._initProjectContext(options);
      const t0 = Date.now();
      await this._initFileIndex(options);
      this._phaseTimes.fileIndex = Date.now() - t0;
      this._checkAborted();
      this._initDiagnostics();
      const t1 = Date.now();
      await this._initDepGraph(options);
      this._phaseTimes.depGraph = Date.now() - t1;
      this._checkAborted();
      // P2: load precomputed aggregate summary if graph hasn't changed since last run
      const loadedAggregate = this.cache.loadAggregateSummary();
      if (loadedAggregate && loadedAggregate.stats?.files === this._depGraph.getFileCount()) {
        // Only fallback to aggregateSummary if loadGraph didn't already inject
        // precomputed aggregates (avoids stale overwrite from dual persistence).
        if (!this._depGraph.analyzer._aggregateCache) {
          this._depGraph.analyzer._aggregateCache = loadedAggregate;
          this._depGraph.analyzer._aggregateVersion = loadedAggregate.version || 0;
        }
      }
      this._assembleSnapshot();
      this._registerCallbacks();

      this.initialized = true;
      this.indexBuildTime = Date.now();

      // Staleness: record git HEAD so getStaleness can detect branch switches
      let gitHead = null;
      try {
        const { execSync } = require('child_process');
        gitHead = execSync('git rev-parse HEAD', { cwd: this.workspaceRoot, encoding: 'utf8' }).trim();
      } catch {
        // Not a git repo or git not available — stale detection falls back to time-based only
      }
      this._checkAborted();
      this.cache.setWorkspaceInfo({ ...this.cache.getWorkspaceInfo(), gitHead });

      if (!this.quiet) {
        console.error(`[Container] Ready: ${this.fileIndex.getStats().files} files indexed`);
      }

      resolveReady(true);
      return true;
    } catch (err) {
      if (this._readyPromise === null) {
        return false;
      }
      this.initError = err;
      console.error('[Container] Initialization failed:', err);
      rejectReady(err);
      return false;
    } finally {
      if (this._readyPromise !== null) {
        this.initializing = false;
      }
    }
  }

  _findWorkspaceRoot(cwd) {
    const { findWorkspaceRoot } = require('../utils/path');
    this.workspaceRoot = findWorkspaceRoot(cwd);
    
    // 记录工作区根目录来源
    const envWorkspaceRoot = process.env.WORKSPACE_ROOT;
    const source = envWorkspaceRoot ? 'WORKSPACE_ROOT env' : 'auto-detected';
    if (!this.quiet) {
      console.error(`[Container] Initializing for ${this.workspaceRoot} (${source})`);
    }
  }

  _initCache() {
    this.cache = new WorkspaceCache(this.workspaceRoot, {
      cacheDir: this.options.cacheDir,
    });
    this.cache.load();
    this.cache.setWorkspaceInfo({ root: this.workspaceRoot });
  }

  _initProjectContext(options) {
    this.projectContext = new ProjectContext(this.workspaceRoot, {
      excludeDirs: options.excludeDirs || [],
    });
  }

  async _initFileIndex(options) {
    this.fileIndex = new FileIndex(this.workspaceRoot, this.cache, {
      excludeDirs: options.excludeDirs || [],
      projectContext: this.projectContext,
      quiet: this.quiet,
    });
    await this.fileIndex.build(DEFAULTS.FILE_INDEX_BUILD_TIMEOUT_MS, {
      watch: options.watch !== false,
      excludeDirs: options.excludeDirs || [],
    });
  }

  _initDiagnostics() {
    this.diagnostics = new DiagnosticsEngine(this.workspaceRoot, this.cache);
  }

  async _initDepGraph(options) {
    this._depGraph = new DependencyGraph(this.workspaceRoot, this.cache, {
      excludeDirs: this.fileIndex?.baseExcludeDirs || [],
      cliExcludeDirs: this.fileIndex?.cliExcludeDirs || [],
      projectContext: this.projectContext,
      quiet: this.quiet,
    });
    // D3: attempt fast-path load from persisted edges; fall back to full build()
    const loaded = this._depGraph.loadGraph({ skipChangeCheck: true });
    if (!loaded) {
      await this._depGraph.build(this.fileIndex?._indexedFiles || null);
    } else {
      // Hybrid path: edges loaded — compute delta and incrementally update
      const indexedFiles = new Set(this.fileIndex?._indexedFiles || []);
      const indexedKeys = new Set([...indexedFiles].map((f) => this._depGraph.normalizeFilePath(f)));
      const graphFiles = new Set(this._depGraph.getAllFilePaths());
      const filesToUpdate = [];

      // New files: in index but not in graph
      for (const f of indexedFiles) {
        const key = this._depGraph.normalizeFilePath(f);
        if (!graphFiles.has(key)) {
          // Apply same exclusion logic as GraphBuilder.build() to avoid
          // re-introducing files that were filtered out during build().
          if (this._depGraph.shouldExclude(f)) continue;
          if (this._depGraph.projectContext && !this._depGraph.projectContext.isActiveSourceFile(f)) {
            if (!this._depGraph.shouldExcludeCli(f)) continue;
          }
          filesToUpdate.push(f);
        }
      }

      // Deleted files: in graph but not in index and no metadata
      for (const f of graphFiles) {
        if (!indexedKeys.has(f) && !this.cache.hasFileMetadata(f)) {
          filesToUpdate.push(f);
        }
      }

      // Changed files: files that fileIndex re-indexed (mtime/size mismatch)
      const changedFiles = this.fileIndex?.changedFiles || [];
      for (const f of changedFiles) {
        filesToUpdate.push(f);
      }

      if (filesToUpdate.length > 0) {
        const uniqueFiles = [...new Set(filesToUpdate)];
        const graphSize = this._depGraph.getFileCount();
        // Fallback to full build if delta is too large (>50% of graph)
        if (graphSize > 0 && uniqueFiles.length > graphSize * 0.5) {
          if (!this.quiet) {
            console.error(`[Container] ${uniqueFiles.length} files delta (>50% of ${graphSize}), falling back to full build`);
          }
          await this._depGraph.build(this.fileIndex?._indexedFiles || null);
        } else {
          await this._depGraph.updateFiles(uniqueFiles);
        }
      } else {
        // Fully warm start — no files changed since last edge save
        this._depGraph.analyzer.precomputeAggregates();
      }
    }
    // Precompute-on-demand: hotspot/stability and co-changes computed on first query
  }

  _assembleSnapshot() {
    try {
      const staleness = this.getStaleness();

      this.snapshot = new WorkspaceSnapshot({
        workspaceRoot: this.workspaceRoot,
        fileIndex: this.fileIndex,
        graph: new DependencyGraphView(this._depGraph),
        gitStatus: { head: this.cache?.getWorkspaceInfo?.()?.gitHead || null },
        frameworkHints: this._collectFrameworkHints(),
        projectContext: this._depGraph?.projectContext || null,
        fileIndexVersion: this.indexBuildTime || null,
        cacheStaleness: staleness,
        gitHead: this.cache?.getWorkspaceInfo?.()?.gitHead || null,
        knownBlindSpots: computeKnownBlindSpots(this._depGraph?.projectContext || null, this._depGraph),
        confidenceByDomain: computeConfidenceByDomain(this._depGraph?.projectContext || null, this._depGraph),
      });
    } catch (e) {
      // L1 data-consistency: preserve existing snapshot on incremental re-assembly
      // failure so that REPL watch mode doesn't lose the view after a transient error.
      if (!this.snapshot) {
        this.snapshot = null;
      }
      if (process.env.DEBUG) {
        console.error('[Container] Snapshot assembly failed:', e.message);
      }
    }
  }

  _collectFrameworkHints() {
    const hints = new Map();
    if (!this._depGraph) return hints;
    for (const filePath of this._depGraph.getAllFilePaths()) {
      const hint = this._depGraph.getFrameworkHint(filePath);
      if (hint) {
        hints.set(filePath, hint);
      }
    }
    return hints;
  }

  _registerCallbacks() {
    // Phase 2: 注册文件变更回调 → 触发后台诊断
    this.fileIndex.bus.on('file:changed', (filePath) => {
      this.diagnostics?.scheduleCheck(filePath);
    });

    // Phase 3: 注册批量变更回调 → 触发 dep-graph 增量更新
    this.fileIndex.bus.on('pending:processed', async (files) => {
      try {
        await this._depGraph?.updateFiles?.(files);
        // L1 data-consistency: re-assemble snapshot so that files (live view)
        // and graph metadata stay in sync after incremental updates.
        this._assembleSnapshot();
        // Hotspot/stability recomputed on next query (precompute-on-demand)
        // Co-change is based on git history, not file changes; skip here
      } catch (e) {
        console.error(`[Container] DepGraph incremental update failed:`, e.message);
      }
    });
  }

  async _precomputeOverview() {
    if (!this._depGraph?.analyzer) return;
    try {
      const { precomputeHotspotsAndStability } = require('../tools/overview-tools');
      const { hotspots, stability } = await precomputeHotspotsAndStability(this._depGraph);
      if (!this._depGraph.analyzer._aggregateCache) {
        this._depGraph.analyzer._aggregateCache = { version: this._depGraph.analyzer._aggregateVersion };
      }
      if (hotspots) this._depGraph.analyzer._aggregateCache.hotspots = hotspots;
      if (stability) this._depGraph.analyzer._aggregateCache.stability = stability;
    } catch (e) {
      if (process.env.DEBUG) {
        console.error('[Container] Precompute overview failed:', e.message);
      }
    }
  }

  async _precomputeCoChanges() {
    try {
      const { analyzeCoChanges } = require('../tools/cochange-tools');
      const coChanges = analyzeCoChanges(this.workspaceRoot);
      if (coChanges.commitCount > 0) {
        this.cache.saveCoChanges(coChanges);
      }
    } catch (e) {
      if (process.env.DEBUG) {
        console.error('[Container] Precompute co-changes failed:', e.message);
      }
    }
  }

  /**
   * On-demand precompute — called by query paths when cached data is missing.
   * Eliminates unconditional预热 in initialize() for lightweight commands (tree/stats).
   */
  async ensurePrecomputed(types) {
    if (!Array.isArray(types)) types = [types];
    if (types.includes('overview')) {
      await this._precomputeOverview();
    }
    if (types.includes('cochanges') && !this.cache?.coChanges) {
      await this._precomputeCoChanges();
    }
  }

  /**
   * Gate: ensures initialization is complete before proceeding
   */
  async ensureReady(timeoutMs = TIMEOUTS.CONTAINER_ENSURE_READY_TIMEOUT_MS) {
    if (this.initialized) return;
    if (this.initError) throw this.initError;
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Initialization timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    
    if (this._readyPromise) {
      await Promise.race([this._readyPromise, timeoutPromise]);
    } else {
      // initialize() was never called — behave like old polling: wait for timeout
      await timeoutPromise;
    }
  }

  /**
   * Shutdown: persist cache and cleanup
   */
  async shutdown() {
    if (this._shuttingDown) return;
    this._shuttingDown = true;

    // Mark as aborted if we are initializing to prevent background racing
    this.initializing = false;
    this._readyPromise = null;

    // Phase 2: 清理待执行的诊断检查
    if (this.diagnostics) {
      try {
        this.diagnostics.clearScheduledChecks();
      } catch (e) {
        if (process.env.DEBUG) console.error('[Container] clearScheduledChecks failed:', e.message);
      }
    }

    // Wait for pending updates before stopping
    if (this.fileIndex) {
      try {
        await this.fileIndex.processPending?.();
      } catch (e) {
        if (process.env.DEBUG) console.error('[Container] processPending failed:', e.message);
      }
      try {
        this.fileIndex.stopWatching();
      } catch (e) {
        if (process.env.DEBUG) console.error('[Container] stopWatching failed:', e.message);
      }
    }
    if (this.cache) {
      try {
        // P2: persist aggregate summary for O(1) startup on next run
        const aggregate = this._depGraph?.analyzer?._aggregateCache;
        if (aggregate) {
          this.cache.saveAggregateSummary(aggregate);
        }
      } catch (e) {
        if (process.env.DEBUG) console.error('[Container] cache.saveAggregateSummary failed:', e.message);
      }
      try {
        await this.cache.save();
      } catch (e) {
        if (process.env.DEBUG) console.error('[Container] cache.save failed:', e.message);
      }
      try {
        this.cache.close();
      } catch (e) {
        if (process.env.DEBUG) console.error('[Container] cache.close failed:', e.message);
      }
    }
    this.snapshot = null;
    this.diagnostics = null;
    this._depGraph = null;
    this.projectContext = null;
    this.initialized = false;
    this.initError = new Error('Container shut down');
    this._readyPromise = null;
    this._shuttingDown = false;
  }

  getStats() {
    return {
      initialized: this.initialized,
      workspaceRoot: this.workspaceRoot,
      fileIndex: this.fileIndex?.getStats(),
    };
  }

  getStaleness(thresholdMs = DEFAULTS.STALENESS_THRESHOLD_MS) {
    const ageMs = this.indexBuildTime ? Date.now() - this.indexBuildTime : 0;

    let gitHeadChanged = false;
    const cachedInfo = this.cache?.getWorkspaceInfo?.();
    const cachedHead = cachedInfo?.gitHead;
    if (cachedHead && this.workspaceRoot) {
      try {
        const { execSync } = require('child_process');
        const currentHead = execSync('git rev-parse HEAD', { cwd: this.workspaceRoot, encoding: 'utf8' }).trim();
        gitHeadChanged = currentHead !== cachedHead;
      } catch {
        // Non-git repo or git unavailable — keep gitHeadChanged false
      }
    }

    let filesChanged = false;
    let changedFiles = [];
    if (this.cache?.checkFileChanges) {
      const fileCheck = this.cache.checkFileChanges();
      filesChanged = fileCheck.changed;
      changedFiles = fileCheck.changedFiles;
    }

    return {
      indexAgeMs: ageMs,
      isStale: ageMs > thresholdMs || gitHeadChanged || filesChanged,
      gitHeadChanged,
      filesChanged,
      changedFiles,
      thresholdMs,
      thresholdDescription: formatDuration(thresholdMs),
    };
  }
}

module.exports = {
  ServiceContainer,
};
