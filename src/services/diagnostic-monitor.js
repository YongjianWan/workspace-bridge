/**
 * Real-time diagnostic monitor
 * Watches for file changes and runs incremental diagnostics
 */
const fs = require('fs');
const path = require('path');
const { runCommandAsync } = require('../utils/command');
const { parseDiagnosticsFromText, uniqueDiagnostics } = require('../utils/diagnostics');
const { detectWorkspace, resolvePythonCommand, findWorkspaceRoot } = require('../utils/path');

class DiagnosticMonitor {
  constructor() {
    this.cache = new Map(); // file -> diagnostics
    this.watchers = new Map();
    this.pendingUpdates = new Set();
    this.updateTimer = null;
    this.onDiagnosticsChanged = null; // callback
  }

  start(rootPath) {
    this.root = rootPath;
    this.workspace = detectWorkspace(rootPath);
    
    // Watch key directories
    const watchDirs = this.getWatchDirs();
    for (const dir of watchDirs) {
      if (fs.existsSync(dir)) {
        this.watchDirectory(dir);
      }
    }
  }

  getWatchDirs() {
    const dirs = [];
    if (this.workspace.hasPackageJson) {
      dirs.push(path.join(this.root, 'src'));
    }
    if (this.workspace.hasRequirements || this.workspace.hasPyproject) {
      dirs.push(path.join(this.root, 'ai_gwy_backend'));
    }
    // Filter to existing dirs only
    return dirs.filter(d => fs.existsSync(d));
  }

  watchDirectory(dir) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (filename.includes('node_modules') || filename.includes('__pycache__')) return;
        if (filename.endsWith('.js') || filename.endsWith('.ts') || filename.endsWith('.py')) {
          this.pendingUpdates.add(path.join(dir, filename));
          this.scheduleUpdate();
        }
      });
      this.watchers.set(dir, watcher);
    } catch (e) {
      console.error(`Failed to watch ${dir}:`, e.message);
    }
  }

  scheduleUpdate() {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => this.runIncrementalCheck(), 500);
  }

  async runIncrementalCheck() {
    const files = Array.from(this.pendingUpdates);
    this.pendingUpdates.clear();

    for (const file of files) {
      const diagnostics = await this.checkFile(file);
      this.cache.set(file, diagnostics);
    }

    if (this.onDiagnosticsChanged) {
      this.onDiagnosticsChanged(this.getAllDiagnostics());
    }
  }

  async checkFile(filePath) {
    const ext = path.extname(filePath);
    const diagnostics = [];

    if (ext === '.py') {
      const python = resolvePythonCommand(this.root);
      
      // Quick ruff check on single file
      const ruffResult = await runCommandAsync(
        `${python} -m ruff check "${filePath}" --output-format=text`,
        this.root, 5000
      );
      
      if (ruffResult.stdout || ruffResult.stderr) {
        diagnostics.push(...parseDiagnosticsFromText(
          ruffResult.stdout + ruffResult.stderr,
          this.root,
          'ruff'
        ));
      }
    }

    return diagnostics;
  }

  getAllDiagnostics() {
    const all = [];
    for (const [file, diags] of this.cache) {
      all.push(...diags.map(d => ({ ...d, file })));
    }
    return uniqueDiagnostics(all);
  }

  getErrorsForFile(filePath) {
    return this.cache.get(filePath) || [];
  }

  stop() {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

module.exports = { DiagnosticMonitor };
