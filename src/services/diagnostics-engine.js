/**
 * DiagnosticsEngine - Real-time lint with file watching cleanup
 * Supports Python (ruff/pyright) and JS/TS (eslint/tsc)
 * SECURE VERSION - All commands use argument arrays
 */
const fs = require('fs');
const path = require('path');
const { runPythonModule, runNpx, runCommandSecure } = require('../utils/command');
const { parseDiagnosticsFromText, uniqueDiagnostics } = require('../utils/diagnostics');

// 配置常量 - 集中管理可调优参数
const CONFIG = {
  DEBOUNCE_MS: 1000,              // 文件变更 debounce 时间
  MAX_CONCURRENT_CHECKS: 5,       // 最大并发检查数
  CONCURRENT_RETRY_DELAY_MS: 500, // 并发限制重试延迟
  CHECKER_TIMEOUT_MS: 5000,       // checker 可用性检查超时
  RUFF_TIMEOUT_MS: 10000,         // ruff 检查超时
  PYRIGHT_TIMEOUT_MS: 15000,      // pyright 检查超时
  ESLINT_TIMEOUT_MS: 10000,       // eslint 检查超时
  TSC_TIMEOUT_MS: 15000,          // tsc 检查超时
};

class DiagnosticsEngine {
  constructor(workspaceRoot, cache) {
    this.root = workspaceRoot;
    this.cache = cache;
    this.checkers = new Map(); // file -> {mtime, promise}
    this.running = new Set(); // files currently being checked
    this.checkerCache = new Map(); // checker name -> boolean (availability)
    
    // Phase 2: 后台诊断调度
    this.scheduledChecks = new Map(); // filePath -> timeoutId (debounce)
    this.checkQueue = new Set(); // 待检查文件队列
    this.runningChecks = new Set(); // 正在运行的检查
    this.config = CONFIG; // 配置引用
  }

  /**
   * Check if we have a specific linter available (with caching)
   */
  async hasChecker(name) {
    // Return cached result if available
    if (this.checkerCache.has(name)) {
      return this.checkerCache.get(name);
    }

    let result = false;

    switch (name) {
      case 'ruff':
        result = await this.checkPythonModule('ruff', '--version');
        break;
      case 'pyright':
        result = await this.checkPythonModule('pyright', '--version');
        break;
      case 'eslint':
        result = await this.checkNodeModule('eslint', '--version');
        break;
      case 'tsc':
        result = await this.checkNodeModule('typescript', '--version');
        break;
      default:
        result = false;
    }

    this.checkerCache.set(name, result);
    return result;
  }

  /**
   * Check if a Python module is available
   */
  async checkPythonModule(module, arg) {
    const python = this.resolvePython();
    const result = await runPythonModule(python, module, [arg], this.root, this.config.CHECKER_TIMEOUT_MS);
    return result.ok;
  }

  /**
   * Check if a Node module is available
   */
  async checkNodeModule(pkg, arg) {
    // Try npx first
    const result = await runNpx(pkg, [arg], this.root, this.config.CHECKER_TIMEOUT_MS);
    return result.ok;
  }

  /**
   * Resolve Python executable
   */
  resolvePython() {
    const candidates = [
      path.join(this.root, '.venv', 'Scripts', 'python.exe'),
      path.join(this.root, 'venv', 'Scripts', 'python.exe'),
      path.join(this.root, '.venv', 'bin', 'python'),
      path.join(this.root, 'venv', 'bin', 'python'),
      'python3',
      'python',
    ];

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch (e) {
        // Continue to next candidate
      }
    }
    return 'python';
  }

  /**
   * Check if a file path is safe to process (within workspace)
   */
  isSafePath(filePath) {
    try {
      const resolved = path.resolve(filePath);
      const rootResolved = path.resolve(this.root);
      
      // On Windows, do case-insensitive comparison
      const isWindows = process.platform === 'win32';
      const checkResolved = isWindows ? resolved.toLowerCase() : resolved;
      const checkRoot = isWindows ? rootResolved.toLowerCase() : rootResolved;
      
      return checkResolved.startsWith(checkRoot);
    } catch (e) {
      return false;
    }
  }

  /**
   * Run diagnostics on a single file
   */
  async checkFile(filePath) {
    // Security: validate file is within workspace
    if (!this.isSafePath(filePath)) {
      console.error(`[Diagnostics] Rejected path outside workspace: ${filePath}`);
      return [];
    }

    const ext = path.extname(filePath);
    
    // Check file exists
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (e) {
      console.error(`[Diagnostics] Cannot stat file: ${filePath}`);
      return [];
    }
    
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
      const python = this.resolvePython();
      const result = await runPythonModule(
        python,
        'ruff',
        ['check', relativePath, '--output-format=text'],
        this.root,
        this.config.RUFF_TIMEOUT_MS
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
      const python = this.resolvePython();
      const result = await runPythonModule(
        python,
        'pyright',
        [relativePath, '--outputjson'],
        this.root,
        this.config.PYRIGHT_TIMEOUT_MS
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
        console.error('[Diagnostics] Failed to parse pyright output:', e.message);
      }
    }

    return uniqueDiagnostics(diagnostics);
  }

  async checkJavaScript(filePath) {
    const diagnostics = [];
    const relativePath = path.relative(this.root, filePath);

    // Try eslint
    if (await this.hasChecker('eslint')) {
      const result = await runNpx(
        'eslint',
        [relativePath, '--format=unix'],
        this.root,
        this.config.ESLINT_TIMEOUT_MS
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
      const result = await runNpx(
        'tsc',
        ['--noEmit', '--skipLibCheck', relativePath],
        this.root,
        this.config.TSC_TIMEOUT_MS
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
    // Iterate over Map entries: [filePath, {mtime, diagnostics}]
    for (const [file, data] of this.cache.diagnostics.entries()) {
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

  /**
   * Phase 2: 调度文件检查（debounce）
   * 文件变更时调用，后台异步执行
   * @param {string} filePath - 要检查的文件路径
   */
  scheduleCheck(filePath) {
    // 清除已有调度
    if (this.scheduledChecks.has(filePath)) {
      clearTimeout(this.scheduledChecks.get(filePath));
    }
    
    // 加入队列
    this.checkQueue.add(filePath);
    
    // 设置新的 debounce 定时器
    const timeoutId = setTimeout(() => {
      this.scheduledChecks.delete(filePath);
      this._runBackgroundCheck(filePath);
    }, this.config.DEBOUNCE_MS);
    
    this.scheduledChecks.set(filePath, timeoutId);
  }

  /**
   * Phase 2: 后台执行检查（带并发控制）
   * @param {string} filePath - 要检查的文件路径
   * @private
   */
  async _runBackgroundCheck(filePath) {
    this.checkQueue.delete(filePath);
    
    // 并发控制：如果正在运行的检查数超过限制，延迟执行
    if (this.runningChecks.size >= this.config.MAX_CONCURRENT_CHECKS) {
      // 重新加入队列，稍后重试
      setTimeout(() => {
        this.scheduleCheck(filePath);
      }, this.config.CONCURRENT_RETRY_DELAY_MS);
      return;
    }
    
    this.runningChecks.add(filePath);
    
    try {
      // 安全校验：只处理工作区内文件
      if (!this.isSafePath(filePath)) {
        return;
      }
      
      // 检查文件是否存在
      try {
        fs.statSync(filePath);
      } catch (e) {
        // 文件已删除，清理缓存
        this.handleFileDeleted(filePath);
        return;
      }
      
      // 后台执行检查
      await this.checkFile(filePath);
    } catch (e) {
      // 后台检查失败不应影响主流程，仅记录日志
      console.error(`[Diagnostics] Background check failed for ${filePath}:`, e.message);
    } finally {
      this.runningChecks.delete(filePath);
    }
  }

  /**
   * Phase 2: 关闭时清理所有待调度检查
   */
  clearScheduledChecks() {
    for (const timeoutId of this.scheduledChecks.values()) {
      clearTimeout(timeoutId);
    }
    this.scheduledChecks.clear();
    this.checkQueue.clear();
    this.runningChecks.clear();
  }
}

module.exports = {
  DiagnosticsEngine,
};
