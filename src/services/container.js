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

class ServiceContainer {
  constructor(options = {}) {
    this.initialized = false;
    this.initializing = false;
    this.initError = null;
    this.workspaceRoot = null;
    this.quiet = options.quiet || false;
    
    // Services
    this.cache = null;
    this.fileIndex = null;
    this.diagnostics = null;
    this.depGraph = null;
    this.projectContext = null;
    
    // Shared promise for concurrent waiters (eliminates busy-loop polling)
    this._readyPromise = null;
  }

  /**
   * Initialize all services. Thread-safe with mutex-like behavior.
   */
  async initialize(cwd, timeoutMs = TIMEOUTS.INIT_TIMEOUT_MS, options = {}) {
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

    try {
      this._findWorkspaceRoot(cwd);
      this._initCache();
      this._initProjectContext(options);
      await this._initFileIndex(options);
      this._initDiagnostics();
      await this._initDepGraph(options);
      this._registerCallbacks();

      this.initialized = true;
      this.indexBuildTime = Date.now();
      if (!this.quiet) {
        console.error(`[Container] Ready: ${this.fileIndex.getStats().files} files indexed`);
      }
      
      resolveReady(true);
      return true;
    } catch (err) {
      this.initError = err;
      console.error('[Container] Initialization failed:', err);
      rejectReady(err);
      return false;
    } finally {
      this.initializing = false;
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
    this.cache = new WorkspaceCache(this.workspaceRoot);
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
    this.depGraph = new DependencyGraph(this.workspaceRoot, this.cache, {
      excludeDirs: this.fileIndex?.baseExcludeDirs || [],
      cliExcludeDirs: this.fileIndex?.cliExcludeDirs || [],
      projectContext: this.projectContext,
      quiet: this.quiet,
    });
    await this.depGraph.build();
  }

  _registerCallbacks() {
    // Phase 2: 注册文件变更回调 → 触发后台诊断
    this.fileIndex.onFileChanged = (filePath) => {
      this.diagnostics?.scheduleCheck(filePath);
    };

    // Phase 3: 注册批量变更回调 → 触发 dep-graph 增量更新
    this.fileIndex.onPendingProcessed = async (files) => {
      try {
        await this.depGraph?.updateFiles?.(files);
      } catch (e) {
        console.error(`[Container] DepGraph incremental update failed:`, e.message);
      }
    };
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
        await this.cache.save();
      } catch (e) {
        if (process.env.DEBUG) console.error('[Container] cache.save failed:', e.message);
      }
    }
    this.diagnostics = null;
    this.depGraph = null;
    this.projectContext = null;
    this.initialized = false;
    this.initError = new Error('Container shut down');
    this._readyPromise = null;
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
    return {
      indexAgeMs: ageMs,
      isStale: ageMs > thresholdMs,
      thresholdMs,
    };
  }
}

// Global singleton
let globalContainer = null;

function getContainer() {
  if (!globalContainer) {
    globalContainer = new ServiceContainer();
  }
  return globalContainer;
}

module.exports = {
  ServiceContainer,
  getContainer,
};
