/**
 * DiagnosticsEngine - Real-time lint with file watching cleanup
 * Supports Python (ruff/pyright) and JS/TS (eslint/tsc)
 */
const fs = require('fs');
const path = require('path');
const { runCommandAsync } = require('../utils/command');
const { parseDiagnosticsFromText, uniqueDiagnostics } = require('../utils/diagnostics');

class DiagnosticsEngine {
  constructor(workspaceRoot, cache) {
    this.root = workspaceRoot;
    this.cache = cache;
    this.checkers = new Map(); // file -> {mtime, promise}
    this.running = new Set(); // files currently being checked
  }

  /**
   * Check if we have a specific linter available
   */
  async hasChecker(name) {
    const checkers = {
      'ruff': 'ruff --version',
      'pyright': 'pyright --version',
      'eslint': 'eslint --version',
      'tsc': 'tsc --version',
    };
    
    if (!checkers[name]) return false;
    
    const { runCommand } = require('../utils/command');
    const result = runCommand(checkers[name], this.root, 5000);
    return result.ok;
  }

  /**
   * Run diagnostics on a single file
   */
  async checkFile(filePath) {
    const ext = path.extname(filePath);
    const stat = fs.statSync(filePath);
    
    // Check cache
    const cached = this.cache.getDiagnostics(filePath);
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.diagnostics;
    }

    // Prevent concurrent checks
    if (this.running.has(filePath)) {
      return []; // Return empty, will be updated when check completes
    }

    this.running.add(filePath);

    try {
      let diagnostics = [];

      if (ext === '.py') {
        diagnostics = await this.checkPython(filePath);
      } else if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        diagnostics = await this.checkJavaScript(filePath);
      }

      // Cache result
      this.cache.setDiagnostics(filePath, {
        mtime: stat.mtimeMs,
        diagnostics,
      });

      return diagnostics;
    } finally {
      this.running.delete(filePath);
    }
  }

  async checkPython(filePath) {
    const diagnostics = [];
    const relativePath = path.relative(this.root, filePath);

    // Try ruff first (fast)
    if (await this.hasChecker('ruff')) {
      const result = await runCommandAsync(
        `python -m ruff check "${relativePath}" --output-format=text`,
        this.root,
        10000
      );
      
      if (result.stdout || result.stderr) {
        const parsed = parseDiagnosticsFromText(
          result.stdout + result.stderr,
          this.root,
          'ruff'
        );
        diagnostics.push(...parsed);
      }
    }

    // Try pyright (type checking)
    if (await this.hasChecker('pyright')) {
      const result = await runCommandAsync(
        `python -m pyright "${relativePath}" --outputjson`,
        this.root,
        15000
      );
      
      try {
        const json = JSON.parse(result.stdout);
        if (json.generalDiagnostics) {
          for (const d of json.generalDiagnostics) {
            if (d.file === filePath || d.file === relativePath) {
              diagnostics.push({
                file: filePath,
                line: d.range?.start?.line || 1,
                column: d.range?.start?.character || 1,
                severity: d.severity === 'error' ? 'error' : 'warning',
                source: 'pyright',
                code: d.rule,
                message: d.message,
              });
            }
          }
        }
      } catch (e) {
        // Parse error, ignore
      }
    }

    return uniqueDiagnostics(diagnostics);
  }

  async checkJavaScript(filePath) {
    const diagnostics = [];
    const relativePath = path.relative(this.root, filePath);

    // Try eslint
    if (await this.hasChecker('eslint')) {
      const result = await runCommandAsync(
        `npx eslint "${relativePath}" --format=unix`,
        this.root,
        10000
      );
      
      if (result.stdout || result.stderr) {
        const parsed = parseDiagnosticsFromText(
          result.stdout + result.stderr,
          this.root,
          'eslint'
        );
        diagnostics.push(...parsed);
      }
    }

    // Try tsc for TypeScript files
    if (filePath.endsWith('.ts') && await this.hasChecker('tsc')) {
      const result = await runCommandAsync(
        `npx tsc --noEmit --skipLibCheck "${relativePath}"`,
        this.root,
        15000
      );
      
      if (result.stdout || result.stderr) {
        const parsed = parseDiagnosticsFromText(
          result.stdout + result.stderr,
          this.root,
          'tsc'
        );
        diagnostics.push(...parsed);
      }
    }

    return uniqueDiagnostics(diagnostics);
  }

  /**
   * Handle file deletion - cleanup cache
   */
  handleFileDeleted(filePath) {
    this.cache.clearDiagnostics(filePath);
  }

  /**
   * Get all cached diagnostics
   */
  getAllDiagnostics() {
    const all = [];
    // Cache stores {mtime, diagnostics} objects
    for (const [file, data] of this.cache.diagnostics || []) {
      if (data && data.diagnostics) {
        all.push(...data.diagnostics);
      }
    }
    return all;
  }

  /**
   * Quick check - return cached results without re-running
   */
  getCached(filePath) {
    const cached = this.cache.getDiagnostics(filePath);
    return cached?.diagnostics || [];
  }
}

module.exports = {
  DiagnosticsEngine,
};
