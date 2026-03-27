/**
 * ServiceContainer - Lifecycle management for all stateful services
 * Provides initialization gate with ensureReady()
 */
const { WorkspaceCache } = require('./cache');
const { FileIndex } = require('./file-index');
const { DiagnosticsEngine } = require('./diagnostics-engine');
const { EditorState } = require('./editor-state');
const { DependencyGraph } = require('./dep-graph');

class ServiceContainer {
  constructor() {
    this.initialized = false;
    this.initializing = false;
    this.initError = null;
    this.workspaceRoot = null;
    
    // Services
    this.cache = null;
    this.fileIndex = null;
    this.diagnostics = null;
    this.editorState = null;
    this.depGraph = null;
  }

  /**
   * Initialize all services. Thread-safe with mutex-like behavior.
   */
  async initialize(cwd) {
    // Mutex: if already initializing, wait
    if (this.initializing) {
      while (this.initializing) {
        await sleep(50);
      }
      return this.initialized;
    }

    // If already initialized, skip
    if (this.initialized) {
      return true;
    }

    this.initializing = true;

    try {
      const { findWorkspaceRoot } = require('../utils/path');
      this.workspaceRoot = findWorkspaceRoot(cwd);
      
      console.error(`[Container] Initializing for ${this.workspaceRoot}`);

      // Initialize cache (memory + disk)
      this.cache = new WorkspaceCache(this.workspaceRoot);
      await this.cache.load();

      // Initialize file index
      this.fileIndex = new FileIndex(this.workspaceRoot, this.cache);
      await this.fileIndex.build();

      // Initialize diagnostics engine
      this.diagnostics = new DiagnosticsEngine(this.workspaceRoot, this.cache);

      // Initialize editor state reader
      this.editorState = new EditorState(this.workspaceRoot);

      // Initialize dependency graph
      this.depGraph = new DependencyGraph(this.workspaceRoot, this.cache);
      await this.depGraph.build();

      this.initialized = true;
      console.error(`[Container] Ready: ${this.fileIndex.getStats().files} files indexed`);
      
      return true;
    } catch (err) {
      this.initError = err;
      console.error('[Container] Initialization failed:', err);
      return false;
    } finally {
      this.initializing = false;
    }
  }

  /**
   * Gate: ensures initialization is complete before proceeding
   */
  async ensureReady(timeoutMs = 30000) {
    if (this.initialized) return;
    if (this.initError) throw this.initError;
    
    // Wait for initialization with timeout
    const startTime = Date.now();
    while (!this.initialized && !this.initError) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Initialization timeout after ${timeoutMs}ms`);
      }
      await sleep(50);
    }
    
    if (this.initError) throw this.initError;
  }

  /**
   * Shutdown: persist cache and cleanup
   */
  async shutdown() {
    // Wait for pending updates before stopping
    if (this.fileIndex) {
      await this.fileIndex.processPending?.();
      this.fileIndex.stopWatching();
    }
    if (this.cache) {
      await this.cache.save();
    }
    this.diagnostics = null;
    this.editorState = null;
    this.depGraph = null;
    this.initialized = false;
  }

  getStats() {
    return {
      initialized: this.initialized,
      workspaceRoot: this.workspaceRoot,
      fileIndex: this.fileIndex?.getStats(),
    };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
