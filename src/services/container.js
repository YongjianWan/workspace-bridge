/**
 * ServiceContainer - Lifecycle management for all stateful services
 * Provides initialization gate with ensureReady()
 */
const { WorkspaceCache } = require('./cache');
const { FileIndex } = require('./file-index');
const { DiagnosticsEngine } = require('./diagnostics-engine');
const { DependencyGraph } = require('./dep-graph');
const { initializeDepGraph } = require('./orchestrator');
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

const STATES = {
  IDLE: 'IDLE',
  INITIALIZING: 'INITIALIZING',
  READY: 'READY',
  SHUTTING_DOWN: 'SHUTTING_DOWN',
  ERROR: 'ERROR',
};

const VALID_TRANSITIONS = {
  [STATES.IDLE]: [STATES.INITIALIZING, STATES.SHUTTING_DOWN],
  [STATES.INITIALIZING]: [STATES.READY, STATES.ERROR, STATES.SHUTTING_DOWN],
  [STATES.READY]: [STATES.SHUTTING_DOWN],
  [STATES.SHUTTING_DOWN]: [STATES.IDLE],
  [STATES.ERROR]: [STATES.INITIALIZING, STATES.SHUTTING_DOWN],
};

class ServiceContainer {
  constructor(options = {}) {
    this._state = STATES.IDLE;
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

  get state() {
    return this._state;
  }

  get initialized() {
    return this._state === STATES.READY;
  }

  get initializing() {
    return this._state === STATES.INITIALIZING;
  }

  _transition(toState) {
    const from = this._state;
    if (from === toState) return;
    const valid = VALID_TRANSITIONS[from] || [];
    if (!valid.includes(toState)) {
      throw new Error(`[Container] Invalid transition: ${from} → ${toState}`);
    }
    this._state = toState;
  }

  _checkAborted() {
    if ((this._state !== STATES.INITIALIZING && this._state !== STATES.READY) || this._readyPromise === null) {
      throw new Error('Container shut down during initialization');
    }
  }

  /**
   * Initialize all services. Thread-safe with mutex-like behavior.
   */
  async initialize(cwd, timeoutMs = TIMEOUTS.INIT_TIMEOUT_MS, options = {}) {
    if (this._state === STATES.SHUTTING_DOWN) {
      throw new Error('Container is shutting down');
    }

    // Allow re-initialization after shutdown by clearing the fatal error
    this.initError = null;

    // Mutex: if already initializing, wait on shared promise
    if (this._state === STATES.INITIALIZING) {
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
    if (this._state === STATES.READY) {
      return true;
    }

    this._transition(STATES.INITIALIZING);
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
      await this._runPipeline(cwd, options);
      this._transition(STATES.READY);
      this.indexBuildTime = Date.now();

      if (!this.quiet) {
        console.error(`[Container] Ready: ${this.fileIndex.getStats().files} files indexed`);
      }

      resolveReady(true);
      return true;
    } catch (err) {
      if (this._readyPromise === null) {
        return false;
      }
      this._transition(STATES.ERROR);
      this.initError = err;
      console.error('[Container] Initialization failed:', err);
      rejectReady(err);
      return false;
    } finally {
      if (this._state === STATES.INITIALIZING) {
        this._transition(STATES.ERROR);
      }
    }
  }

  /**
   * Explicit initialization pipeline.
   * Each stage is named, timed, and wrapped with error context so that
   * failures point directly to the responsible phase.
   */
  async _runPipeline(cwd, options) {
    this._phaseTimes = {};

    await this._runStage('workspaceRoot', () => {
      this._findWorkspaceRoot(cwd, options);
      this._checkAborted();
    });

    await this._runStage('cache', () => {
      this._initCache();
    });

    await this._runStage('projectContext', () => {
      this._initProjectContext(options);
    });

    await this._runStage('fileIndex', async () => {
      await this._initFileIndex(options);
      this._checkAborted();
    });

    await this._runStage('diagnostics', () => {
      this._initDiagnostics();
    });

    await this._runStage('depGraph', async () => {
      await this._initDepGraph(options);
      this._checkAborted();
    });

    await this._runStage('aggregate', () => {
      const loadedAggregate = this.cache.loadAggregateSummary();
      if (loadedAggregate && loadedAggregate.stats?.files === this._depGraph.getFileCount()) {
        // Only fallback to aggregateSummary if loadGraph didn't already inject
        // precomputed aggregates (avoids stale overwrite from dual persistence).
        if (!this._depGraph.analyzer.getAggregateCache()) {
          this._depGraph.analyzer.restoreAggregateCache(loadedAggregate);
        }
      }
    });

    await this._runStage('snapshot', () => {
      this._assembleSnapshot();
    });

    await this._runStage('callbacks', () => {
      this._registerCallbacks();
    });

    await this._runStage('gitHead', () => {
      let gitHead = null;
      try {
        const { execSync } = require('child_process');
        gitHead = execSync('git rev-parse HEAD', {
          cwd: this.workspaceRoot,
          encoding: 'utf8',
          timeout: TIMEOUTS.GIT_SHORT_MS,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        // Not a git repo or git not available — stale detection falls back to time-based only
      }
      this._checkAborted();
      this.cache.setWorkspaceInfo({ ...this.cache.getWorkspaceInfo(), gitHead });
    });
  }

  async _runStage(name, fn) {
    const t0 = Date.now();
    try {
      return await fn();
    } catch (err) {
      err.message = `[Container] Stage '${name}' failed: ${err.message}`;
      throw err;
    } finally {
      const elapsed = Date.now() - t0;
      this._phaseTimes[name] = elapsed;
    }
  }

  _findWorkspaceRoot(cwd, options = {}) {
    if (options.strictCwd) {
      const { normalizePath } = require('../utils/path');
      this.workspaceRoot = normalizePath(cwd);
      if (!this.quiet) {
        console.error(`[Container] Initializing for ${this.workspaceRoot} (strict-cwd)`);
      }
      return;
    }
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
      service: options.service || null,
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
    // A-2: initialization decision tree (load/build/update) moved to
    // orchestrator.js so container.js stays a thin pipeline stage.
    this._depGraph = await initializeDepGraph({
      DependencyGraphClass: DependencyGraph,
      workspaceRoot: this.workspaceRoot,
      cache: this.cache,
      fileIndex: this.fileIndex,
      projectContext: this.projectContext,
      quiet: this.quiet,
      options,
    });
  }

  _assembleSnapshot() {
    try {
      const staleness = this.getStaleness();

      this.snapshot = new WorkspaceSnapshot({
        workspaceRoot: this.workspaceRoot,
        fileIndex: this.fileIndex,
        graph: new DependencyGraphView(this._depGraph),
        gitStatus: { head: this.cache?.getWorkspaceInfo?.()?.gitHead || null },
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
      this._depGraph.analyzer.setOverviewData({ hotspots, stability });
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
    
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Initialization timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      if (this._readyPromise) {
        await Promise.race([this._readyPromise, timeoutPromise]);
      } else {
        // initialize() was never called — behave like old polling: wait for timeout
        await timeoutPromise;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Shutdown: persist cache and cleanup
   */
  async shutdown() {
    if (this._state === STATES.SHUTTING_DOWN) return;
    this._transition(STATES.SHUTTING_DOWN);

    // Mark as aborted if we are initializing to prevent background racing
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
        const aggregate = this._depGraph?.analyzer?.getAggregateCache();
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
    this.initError = new Error('Container shut down');
    this._readyPromise = null;
    this._transition(STATES.IDLE);
  }

  getStats() {
    return {
      initialized: this.initialized,
      workspaceRoot: this.workspaceRoot,
      fileIndex: this.fileIndex?.getStats(),
    };
  }

  getStaleness(thresholdMs = DEFAULTS.STALENESS_THRESHOLD_MS) {
    if (!this.indexBuildTime) {
      return {
        indexAgeMs: 0,
        isStale: false,
        gitHeadChanged: false,
        filesChanged: false,
        changedFiles: [],
        thresholdMs,
        thresholdDescription: formatDuration(thresholdMs),
      };
    }

    const ageMs = Date.now() - this.indexBuildTime;

    let gitHeadChanged = false;
    const cachedInfo = this.cache?.getWorkspaceInfo?.();
    const cachedHead = cachedInfo?.gitHead;
    if (cachedHead && this.workspaceRoot) {
      try {
        const { execSync } = require('child_process');
        const currentHead = execSync('git rev-parse HEAD', {
          cwd: this.workspaceRoot,
          encoding: 'utf8',
          timeout: TIMEOUTS.GIT_SHORT_MS,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
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
  STATES,
};
