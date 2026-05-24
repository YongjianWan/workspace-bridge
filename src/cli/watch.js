/**
 * workspace-bridge watch
 * File watcher that prints impact radius on every save.
 * Reuses REPL container initialization (watch: true), drops readline,
 * and registers a callback on file changes.
 *
 * P8-1: Closed-loop validation mode (--run-tests).
 *   file save → impact → affected-tests → spawn executable commands →
 *   JSON Lines output with pass/fail + failure details.
 */
const path = require('path');
const { spawn } = require('child_process');
const { ServiceContainer } = require('../services/container');
const { DEFAULTS, TIMEOUTS, LIMITS } = require('../config/constants');
const WATCH_COMMAND_TIMEOUT_MS = TIMEOUTS.WATCH_COMMAND_TIMEOUT_MS;
const WATCH_MAX_STDOUT_BYTES = LIMITS.WATCH_MAX_STDOUT_BYTES;
const { detectStack } = require('../utils/stack-detectors/detect');
const { generateCommands } = require('../utils/stack-detectors/commands');
const { buildFileSummary } = require('./formatters/file-summary');
const { buildFileValidationAdvice } = require('./formatters/validation-advice');
const { normalizePathKey } = require('../utils/path');

function formatWatchOutput(workspaceRoot, filePath, impact, depGraph, compact) {
  const relativeFile = path.relative(workspaceRoot, filePath);
  const count = impact.length;

  if (!compact || count <= 10) {
    const list = impact.map((e) => path.relative(workspaceRoot, e.file)).join(', ');
    return `${relativeFile} changed  ${count} dependents affected: [${list}]`;
  }

  // Compact curation: show entries + tests explicitly, aggregate the rest.
  const entrySet = depGraph.entryFiles || new Set();
  const entries = [];
  const tests = [];
  let otherCount = 0;

  for (const item of impact) {
    if (entrySet.has(item.file)) {
      entries.push(path.relative(workspaceRoot, item.file));
    } else if (depGraph.isTestLikeFile?.(item.file)) {
      tests.push(path.relative(workspaceRoot, item.file));
    } else {
      otherCount++;
    }
  }

  const parts = [`${count} dependents`];
  if (entries.length > 0) parts.push(`entries: [${entries.join(', ')}]`);
  if (tests.length > 0) parts.push(`tests: [${tests.join(', ')}]`);
  if (otherCount > 0) parts.push(`+${otherCount} more`);

  return `${relativeFile} changed  ${parts.join(', ')}`;
}

function emitWatchEvent(event) {
  // JSON Lines: one machine-readable object per line, flushed immediately.
  console.log(JSON.stringify(event));
}

function buildWatchValidationCommands(filePath, depGraph, workspaceRoot) {
  const affectedTests = depGraph.findAffectedTests(filePath, DEFAULTS.WATCH_IMPACT_DEPTH);
  if (affectedTests.length === 0) {
    return { commands: [], affectedTests: [] };
  }

  const stack = detectStack(workspaceRoot);
  const relativeFile = path.relative(workspaceRoot, filePath);
  const steps = [{
    name: 'run-direct-tests',
    targets: affectedTests.map((t) => t.file),
  }];

  const commandSet = generateCommands(stack, 'code', [relativeFile], steps);

  // Only run focused commands in watch mode; smoke/full are too heavy for on-save.
  const focused = commandSet.focused || [];
  return { commands: focused, affectedTests };
}

function executeWatchCommand(entry, workspaceRoot, timeoutMs = WATCH_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const exec = entry.executable || {};
    const command = exec.command || entry.cmd;
    if (!command) {
      resolve({
        name: entry.name,
        ok: false,
        exitCode: null,
        error: 'No executable command',
        stdout: '',
        stderr: '',
        durationMs: 0,
      });
      return;
    }

    const args = exec.args || [];
    const cwd = exec.cwd ? path.resolve(workspaceRoot, exec.cwd) : workspaceRoot;
    const useShell = !!exec.shell;
    const startTime = Date.now();

    const child = spawn(command, args, {
      cwd,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    child.stdout.on('data', (data) => {
      if (stdoutTruncated) return;
      const chunk = data.toString();
      if (stdout.length + chunk.length > WATCH_MAX_STDOUT_BYTES) {
        stdout += chunk.slice(0, WATCH_MAX_STDOUT_BYTES - stdout.length);
        stdoutTruncated = true;
      } else {
        stdout += chunk;
      }
    });

    child.stderr.on('data', (data) => {
      if (stderrTruncated) return;
      const chunk = data.toString();
      if (stderr.length + chunk.length > WATCH_MAX_STDOUT_BYTES) {
        stderr += chunk.slice(0, WATCH_MAX_STDOUT_BYTES - stderr.length);
        stderrTruncated = true;
      } else {
        stderr += chunk;
      }
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill();
    }, timeoutMs);

    child.on('exit', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const expected = typeof exec.expectedExitCode === 'number' ? exec.expectedExitCode : 0;
      resolve({
        name: entry.name,
        ok: !killed && code === expected,
        exitCode: code,
        killed,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        truncated: stdoutTruncated || stderrTruncated || undefined,
        durationMs,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        name: entry.name,
        ok: false,
        exitCode: null,
        error: err.message,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        truncated: stdoutTruncated || stderrTruncated || undefined,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

async function runWatchValidation(filePath, depGraph, workspaceRoot) {
  const startTime = Date.now();
  const { commands, affectedTests } = buildWatchValidationCommands(filePath, depGraph, workspaceRoot);

  emitWatchEvent({
    event: 'validationStart',
    file: path.relative(workspaceRoot, filePath),
    affectedTestsCount: affectedTests.length,
    commandCount: commands.length,
    timestamp: Date.now(),
  });

  if (commands.length === 0) {
    emitWatchEvent({
      event: 'validationComplete',
      file: path.relative(workspaceRoot, filePath),
      passed: true,
      reason: 'No affected tests detected',
      durationMs: Date.now() - startTime,
    });
    return;
  }

  for (const cmd of commands) {
    emitWatchEvent({
      event: 'commandStart',
      name: cmd.name,
      command: cmd.cmd,
      executable: cmd.executable || null,
    });

    const result = await executeWatchCommand(cmd, workspaceRoot);

    emitWatchEvent({
      event: 'commandResult',
      name: cmd.name,
      passed: result.ok,
      exitCode: result.exitCode,
      killed: result.killed || undefined,
      durationMs: result.durationMs,
      error: result.error || undefined,
      // Only include stdout/stderr on failure to keep JSON Lines compact.
      stdout: result.ok ? undefined : result.stdout,
      stderr: result.ok ? undefined : result.stderr,
      truncated: result.truncated,
    });

    if (!result.ok) {
      emitWatchEvent({
        event: 'validationComplete',
        file: path.relative(workspaceRoot, filePath),
        passed: false,
        failedCommand: cmd.name,
        durationMs: Date.now() - startTime,
      });
      return;
    }
  }

  emitWatchEvent({
    event: 'validationComplete',
    file: path.relative(workspaceRoot, filePath),
    passed: true,
    durationMs: Date.now() - startTime,
  });
}

function registerWatchCallback(bus, depGraph, workspaceRoot, compact, runTests) {
  bus.on('file:changed', (filePath) => {
    const startTime = Date.now();
    const impact = depGraph.getImpactRadius(filePath, DEFAULTS.WATCH_IMPACT_DEPTH);
    console.log(formatWatchOutput(workspaceRoot, filePath, impact, depGraph, compact));
    if (process.env.DEBUG) {
      console.error(`[watch] computed in ${Date.now() - startTime}ms`);
    }

    if (runTests) {
      // Fire validation asynchronously; do not block the watcher callback.
      runWatchValidation(filePath, depGraph, workspaceRoot).catch((err) => {
        emitWatchEvent({
          event: 'validationError',
          file: path.relative(workspaceRoot, filePath),
          error: err.message,
        });
      });
    }
  });
}

function setupGracefulShutdown(container) {
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await container.shutdown();
    } catch (e) {
      console.error('Shutdown error:', e.message);
    }
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function startWatch(options) {
  const container = new ServiceContainer();
  setupGracefulShutdown(container);

  try {
    const initialized = await container.initialize(options.cwd, TIMEOUTS.INIT_TIMEOUT_MS, {
      watch: true,
      excludeDirs: options.exclude || [],
    });
    if (!initialized) {
      throw container.initError || new Error('Failed to initialize workspace container');
    }

    console.error(`workspace-bridge watch — ${container.workspaceRoot}`);
    console.error('Watching for file changes. Press Ctrl+C to stop.');
    if (options.runTests) {
      console.error('Auto-run mode: affected tests will be executed on every save.\n');
    } else {
      console.error('\n');
    }

    registerWatchCallback(
      container.fileIndex.bus,
      container.snapshot.graph,
      container.workspaceRoot,
      options.compact,
      options.runTests,
    );

    await new Promise(() => {});
  } catch (err) {
    console.error('Watch failed:', err.message);
    process.exitCode = 1;
  }
}

async function buildAuditFileWatchResult(filePath, depGraph, workspaceRoot) {
  const impact = depGraph.getImpactRadius(filePath, DEFAULTS.WATCH_IMPACT_DEPTH);
  const affectedTests = depGraph.findAffectedTests(filePath, DEFAULTS.WATCH_IMPACT_DEPTH);
  const frameworkPattern = depGraph.getFrameworkHint(filePath);
  const validationAdvice = buildFileValidationAdvice(filePath, workspaceRoot);
  return {
    file: path.relative(workspaceRoot, filePath),
    resolvedPath: filePath,
    summary: buildFileSummary(
      { impactCount: impact.length, ok: true },
      { affectedTestsCount: affectedTests.length, ok: true },
    ),
    frameworkPattern,
    validationAdvice,
    impact: {
      ok: true,
      impactCount: impact.length,
      impact,
    },
    affectedTests: {
      ok: true,
      affectedTestsCount: affectedTests.length,
      affectedTests,
    },
  };
}

function registerAuditFileWatchCallback(bus, depGraph, workspaceRoot, compact, targetFile) {
  const targetNormalized = targetFile ? normalizePathKey(targetFile) : null;
  bus.on('file:changed', async (filePath) => {
    if (targetNormalized && normalizePathKey(filePath) !== targetNormalized) {
      return;
    }
    const startTime = Date.now();
    emitWatchEvent({
      event: 'auditFileStart',
      file: path.relative(workspaceRoot, filePath),
      timestamp: startTime,
    });

    try {
      const result = await buildAuditFileWatchResult(filePath, depGraph, workspaceRoot);
      emitWatchEvent({
        event: 'auditFileResult',
        ...result,
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      emitWatchEvent({
        event: 'auditFileError',
        file: path.relative(workspaceRoot, filePath),
        error: err?.message || String(err),
        durationMs: Date.now() - startTime,
      });
    }

    emitWatchEvent({
      event: 'auditFileComplete',
      file: path.relative(workspaceRoot, filePath),
      timestamp: Date.now(),
    });
  });
}

async function startAuditFileWatch(options) {
  const container = new ServiceContainer();
  setupGracefulShutdown(container);

  try {
    const initialized = await container.initialize(options.cwd, TIMEOUTS.INIT_TIMEOUT_MS, {
      watch: true,
      excludeDirs: options.exclude || [],
    });
    if (!initialized) {
      throw container.initError || new Error('Failed to initialize workspace container');
    }

    const targetFile = options.targetFile
      ? path.resolve(container.workspaceRoot, options.targetFile)
      : null;
    if (targetFile && !require('fs').existsSync(targetFile)) {
      throw new Error(`File not found: ${options.targetFile}`);
    }

    console.error(`workspace-bridge audit-file --watch — ${container.workspaceRoot}`);
    if (targetFile) {
      console.error(`Watching: ${path.relative(container.workspaceRoot, targetFile)}`);
    } else {
      console.error('Watching all files.');
    }
    console.error('Press Ctrl+C to stop.\n');

    registerAuditFileWatchCallback(
      container.fileIndex.bus,
      container.snapshot.graph,
      container.workspaceRoot,
      options.compact,
      targetFile,
    );

    await new Promise(() => {});
  } catch (err) {
    console.error('audit-file watch failed:', err.message);
    process.exitCode = 1;
  }
}

module.exports = {
  startWatch,
  startAuditFileWatch,
  formatWatchOutput,
};
