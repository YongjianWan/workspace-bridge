/**
 * DiagnosticsEngine - Real-time lint with file watching cleanup
 * Supports Python (ruff/pyright) and JS/TS (eslint/tsc)
 * SECURE VERSION - All commands use argument arrays
 */
const fs = require('fs');
const path = require('path');
const { runPythonModule, runNpx, runCommandSecure, resolvePythonCommand } = require('../utils/command');
const { parseDiagnosticsFromText, uniqueDiagnostics } = require('../utils/diagnostics');
const { TIMEOUTS, DEFAULTS } = require('../config/constants');
const { detectEslintConfig } = require('../utils/environment-probe');

// 配置常量 - 集中管理可调优参数
const CONFIG = {
  DEBOUNCE_MS: DEFAULTS.DIAGNOSTICS_DEBOUNCE_MS,
  MAX_CONCURRENT_CHECKS: 5,       // 最大并发检查数
  MAX_SCHEDULED_CHECKS: 20,       // 4x MAX_CONCURRENT_CHECKS, bounds timer queue under bulk changes
  CONCURRENT_RETRY_DELAY_MS: 500, // 并发限制重试延迟 (legacy, kept for reference)
  CHECKER_TIMEOUT_MS: TIMEOUTS.DIAGNOSTICS_SHORT_MS,   // checker 可用性检查超时
  RUFF_TIMEOUT_MS: TIMEOUTS.DIAGNOSTICS_SHORT_MS,      // ruff 检查超时
  PYRIGHT_TIMEOUT_MS: TIMEOUTS.DIAGNOSTICS_MEDIUM_MS,  // pyright 检查超时
  ESLINT_TIMEOUT_MS: TIMEOUTS.DIAGNOSTICS_SHORT_MS,    // eslint 检查超时
  TSC_TIMEOUT_MS: TIMEOUTS.DIAGNOSTICS_MEDIUM_MS,      // tsc 检查超时
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
        if (!result) {
          result = detectEslintConfig(this.root);
        }
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
    const python = resolvePythonCommand(this.root);
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

      const relative = path.relative(checkRoot, checkResolved);
      if (!relative) return true;
      return !relative.startsWith('..') && !path.isAbsolute(relative);
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
    const cachedEntry = this.cache.getDiagnosticsEntry(filePath);
    if (cachedEntry && cachedEntry.mtime === stat.mtimeMs) {
      return cachedEntry.diagnostics;
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
      const python = resolvePythonCommand(this.root);
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
      const python = resolvePythonCommand(this.root);
      const result = await runPythonModule(
        python,
        'pyright',
        [relativePath, '--outputjson'],
        this.root,
        this.config.PYRIGHT_TIMEOUT_MS
      );
      
      try {
        const { stripBOM } = require('../utils/sanitize');
        const json = JSON.parse(stripBOM(result.stdout));
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
    const TS_EXTS = ['.ts', '.tsx', '.mts', '.cts'];
    if (TS_EXTS.some((ext) => filePath.endsWith(ext)) && await this.hasChecker('tsc')) {
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
    const entry = this.cache.getDiagnosticsEntry(filePath);
    return entry?.diagnostics || [];
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

    // Guard: prevent unbounded timer growth under heavy load.
    if (this.scheduledChecks.size >= this.config.MAX_SCHEDULED_CHECKS) {
      const firstKey = this.scheduledChecks.keys().next().value;
      clearTimeout(this.scheduledChecks.get(firstKey));
      this.scheduledChecks.delete(firstKey);
      this.checkQueue.delete(firstKey);
    }

    // 加入队列
    this.checkQueue.add(filePath);

    // 设置新的 debounce 定时器
    const timeoutId = setTimeout(() => {
      this.scheduledChecks.delete(filePath);
      // If the file was already drained by _drainCheckQueue, skip it to
      // avoid duplicate checks.
      if (this.checkQueue.has(filePath)) {
        this._runBackgroundCheck(filePath);
      }
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

    // 并发控制：如果正在运行的检查数超过限制，重新入队等待
    if (this.runningChecks.size >= this.config.MAX_CONCURRENT_CHECKS) {
      this.checkQueue.add(filePath);
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
      this._drainCheckQueue();
    }
  }

  /**
   * Drain the check queue when a running check completes.
   * Avoids creating unbounded retry timers.
   */
  _drainCheckQueue() {
    while (
      this.runningChecks.size < this.config.MAX_CONCURRENT_CHECKS &&
      this.checkQueue.size > 0
    ) {
      const nextFile = this.checkQueue.values().next().value;
      this.checkQueue.delete(nextFile);
      // _runBackgroundCheck is async but the concurrency gate is evaluated
      // synchronously, so fire-and-forget is safe here.
      this._runBackgroundCheck(nextFile);
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
