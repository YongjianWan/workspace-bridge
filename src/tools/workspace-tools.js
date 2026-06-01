/**
 * Workspace tools for workspace-bridge - SECURE VERSION
 * All commands use argument arrays to prevent injection
 */
const path = require('path');
const { findWorkspaceRoot, detectWorkspace, toRelativePosix, pathExists } = require('../utils/path');
const { runCommandSecure, runNpx, runPythonModule, trimOutput, resolvePythonCommand } = require('../utils/command');
const { TIMEOUTS, PROBE } = require('../config/constants');
const { parseDiagnosticsFromText, uniqueDiagnostics, summarizeDiagnostics } = require('../utils/diagnostics');
const { checkParserAvailability } = require('../utils/environment-probe');
const { detectEslintConfig, detectPrettierConfig, detectTscConfig } = require('../utils/environment-probe');

/**
 * Detect available Node.js linters/formatters based on config files and package.json.
 * Used by both workspaceInfo (availableChecks) and buildChecks (noLintersDetected).
 */
function detectNodeLinters(workspace, root) {
  const linters = { eslint: false, prettier: false, tsc: false };
  if (!workspace.hasPackageJson || !workspace.packageJson) {
    return linters;
  }

  const pj = workspace.packageJson;

  linters.eslint = detectEslintConfig(root);
  linters.prettier = detectPrettierConfig(root);
  linters.tsc = detectTscConfig(root);

  return linters;
}

/**
 * Build diagnostic checks using secure command execution
 */
async function buildChecks(workspace, mode) {
  const checks = [];
  const root = workspace.root;
  let noLintersDetected = false;
  let hasLinter = false;
  const nodeLinters = detectNodeLinters(workspace, root);

  if (workspace.hasPackageJson) {
    const scripts = workspace.packageJson?.scripts || {};
    let hasNodeCheck = false;

    if (scripts.typecheck) {
      checks.push({
        name: 'node:typecheck',
        cmd: 'npm',
        args: ['run', '-s', 'typecheck'],
        timeout: TIMEOUTS.DIAGNOSTICS_LONG_MS,
      });
      hasNodeCheck = true;
      hasLinter = true;
    } else if (workspace.hasTsconfig) {
      checks.push({
        name: 'node:tsc',
        cmd: 'npx',
        args: ['tsc', '--noEmit'],
        timeout: TIMEOUTS.DIAGNOSTICS_CHECK_MS,
      });
      hasNodeCheck = true;
      hasLinter = true;
    }
    if (scripts.lint) {
      checks.push({
        name: 'node:lint',
        cmd: 'npm',
        args: ['run', '-s', 'lint'],
        timeout: TIMEOUTS.DIAGNOSTICS_CHECK_MS,
      });
      hasNodeCheck = true;
      hasLinter = true;
    }
    if (mode === 'full' && scripts.build) {
      checks.push({
        name: 'node:build',
        cmd: 'npm',
        args: ['run', '-s', 'build'],
        timeout: TIMEOUTS.DIAGNOSTICS_LONG_MS,  // Wave 5 #13
      });
    }
    if (mode === 'full' && scripts.test) {
      checks.push({
        name: 'node:test',
        cmd: 'npm',
        args: ['run', '-s', 'test', '--', '--runInBand'],
        timeout: TIMEOUTS.DIAGNOSTICS_LONG_MS,  // Wave 5 #13
      });
      hasNodeCheck = true;
    }

    // Auto-detect eslint if no lint script but config exists
    if (!scripts.lint && nodeLinters.eslint) {
      checks.push({
        name: 'node:eslint',
        cmd: 'npx',
        args: ['eslint', '.'],
        timeout: TIMEOUTS.DIAGNOSTICS_CHECK_MS,
      });
      hasNodeCheck = true;
      hasLinter = true;
    }

    }

  if (workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy) {
    const python = resolvePythonCommand(root);
    let hasFocusedPythonCheck = false;

    if (workspace.hasManagePy) {
      checks.push({
        name: 'django:check',
        cmd: python,
        args: ['manage.py', 'check'],
        timeout: TIMEOUTS.DIAGNOSTICS_MEDIUM_MS,
      });
      hasFocusedPythonCheck = true;
      hasLinter = true;
    }

    // Check for ruff availability
    const ruffResult = await runPythonModule(python, 'ruff', ['--version'], root, TIMEOUTS.DIAGNOSTICS_SHORT_MS);
    if (ruffResult.ok) {
      checks.push({
        name: 'python:ruff',
        cmd: python,
        args: ['-m', 'ruff', 'check', '.'],
        timeout: TIMEOUTS.DIAGNOSTICS_CHECK_MS,
      });
      hasFocusedPythonCheck = true;
      hasLinter = true;
    }

    // Check for pyright availability
    const pyrightResult = await runPythonModule(python, 'pyright', ['--version'], root, TIMEOUTS.DIAGNOSTICS_SHORT_MS);
    if (pyrightResult.ok) {
      checks.push({
        name: 'python:pyright',
        cmd: python,
        args: ['-m', 'pyright', '.'],
        timeout: TIMEOUTS.DIAGNOSTICS_LONG_MS,
      });
      hasFocusedPythonCheck = true;
      hasLinter = true;
    }

    if (!hasFocusedPythonCheck || mode === 'full') {
      checks.push({
        name: 'python:compileall',
        cmd: python,
        args: ['-m', 'compileall', '-q', '.'],
        timeout: TIMEOUTS.DIAGNOSTICS_MEDIUM_MS,
      });
    }

    if (mode === 'full') {
      const pytestResult = await runPythonModule(python, 'pytest', ['--version'], root, TIMEOUTS.DIAGNOSTICS_MEDIUM_MS);
      if (pytestResult.ok) {
        checks.push({
          name: 'python:pytest',
          cmd: python,
          args: ['-m', 'pytest', '-q'],
          timeout: TIMEOUTS.DIAGNOSTICS_LONG_MS,  // Wave 5 #13
        });
      }
    }
  }

  if (checks.length === 0 && workspace.hasGit) {
    checks.push({
      name: 'workspace:git-status',
      cmd: 'git',
      args: ['status', '--short'],
      timeout: TIMEOUTS.DIAGNOSTICS_SHORT_MS,
    });
  }

  // No-linters detection: true only when no actual linter or type-checker was found.
  if (!hasLinter) {
    noLintersDetected = true;
  }

  return { checks, noLintersDetected };
}

function workspaceInfo(args, container) {
  const target = args?.cwd || process.cwd();
  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const workspace = detectWorkspace(root);

  // Try to use depGraph data if container is ready; otherwise fall back to basic detection
  const depGraph = container?.snapshot?.graph || container?.depGraph;
  const allOriginalPaths = depGraph
    ? (depGraph.getAllFileValues?.() || []).map((v) => v.originalPath).filter(Boolean)
    : [];

  // P92: unify entryFiles with audit-summary (projectContext.summarizeFiles)
  let entryFiles = [];
  if (container?.projectContext && allOriginalPaths.length > 0) {
    const summary = container.projectContext.summarizeFiles(
      allOriginalPaths,
      (file) => depGraph?.getDependents(file).length > 0
    );
    entryFiles = summary.entryFiles;
  } else if (depGraph) {
    entryFiles = Array.from(depGraph.entryFiles || []).map((f) => toRelativePosix(root, depGraph._displayPath?.(f) || f));
  }

  // Language distribution from graph
  const langCounts = {};
  for (const file of allOriginalPaths) {
    const ext = path.extname(file).toLowerCase();
    const lang =
      ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx' || ext === '.mjs' || ext === '.cjs' ? 'javascript'
      : ext === '.py' ? 'python'
      : ext === '.java' ? 'java'
      : ext === '.kt' ? 'kotlin'
      : ext === '.go' ? 'go'
      : ext === '.rs' ? 'rust'
      : ext === '.vue' ? 'vue'
      : ext === '.svelte' ? 'svelte'
      : ext === '.c' || ext === '.cpp' || ext === '.cc' || ext === '.h' || ext === '.hpp' ? 'c-cpp'
      : 'other';
    langCounts[lang] = (langCounts[lang] || 0) + 1;
  }

  const nodeLinters = detectNodeLinters(workspace, root);
  const availableChecks = [];
  if (workspace.hasPackageJson) {
    availableChecks.push('npm scripts');
    if (nodeLinters.eslint) availableChecks.push('eslint');
    if (nodeLinters.prettier) availableChecks.push('prettier');
    if (nodeLinters.tsc) availableChecks.push('tsc');
  }
  if (workspace.hasJava) availableChecks.push('mvn/gradle');
  if (workspace.hasManagePy) availableChecks.push('django-check');
  if (workspace.hasRequirements || workspace.hasPyproject) availableChecks.push('pytest', 'ruff');
  if (workspace.hasGo) availableChecks.push('go test', 'go vet');
  if (workspace.hasRust) availableChecks.push('cargo test', 'cargo clippy');

  const parserAvailability = workspace.hasPackageJson
    ? checkParserAvailability()
    : { available: true, usedFallbackPath: true };

  const cacheStats = container?.cache?.getStats?.() || {};
  return {
    ok: true,
    cwd: require('../utils/path').normalizePath(target),
    workspaceRoot: workspace.root,
    fileCount: allOriginalPaths.length,
    totalLines: cacheStats.totalLines || 0,
    detected: {
      git: workspace.hasGit,
      node: workspace.hasPackageJson,
      python: workspace.hasPythonFiles || workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy,
      django: workspace.hasManagePy,
      typescript: workspace.hasTsconfig || Boolean(workspace.packageJson?.devDependencies?.typescript) || Boolean(workspace.packageJson?.dependencies?.typescript),
      java: workspace.hasJava,
      go: workspace.hasGo,
      rust: workspace.hasRust,
    },
    languages: langCounts,
    entryFiles,
    availableChecks,
    parserAvailability,
    stack: {
      isNode: workspace.hasPackageJson,
      isJava: workspace.hasJava,
      isPython: workspace.hasPythonFiles || workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy,
      isGo: workspace.hasGo,
      isRust: workspace.hasRust,
    },
  };
}

async function runDiagnostics(args, container) {
  const target = args?.cwd || process.cwd();
  const mode = args?.mode === 'full' ? 'full' : 'quick';
  const timeoutMs = Number.isFinite(args?.timeoutMs) ? args.timeoutMs : TIMEOUTS.DIAGNOSTICS_TOTAL_MS;
  const maxDiagnostics = Number.isFinite(args?.maxDiagnostics) ? Math.max(1, Math.floor(args.maxDiagnostics)) : 300;

  // Use container cache only in quick mode; full mode should always run checks.
  if (container?.cache && mode !== 'full') {
    const cached = container.cache.getWorkspaceInfo();
    if (cached) {
      const hasEntries = typeof container.cache.hasDiagnosticEntries === 'function'
        ? container.cache.hasDiagnosticEntries()
        : (container.cache.getAllDiagnostics?.() || []).length > 0;
      if (hasEntries) {
        const allDiagnostics = container.cache.getAllDiagnostics?.() || [];
        return {
          ok: true,
          workspaceRoot: container.workspaceRoot,
          mode: 'cached',
          checksRun: 0,
          failedChecks: [],
          diagnosticsSummary: summarizeDiagnostics(allDiagnostics),
          diagnostics: allDiagnostics,
          results: [],
          cached: true,
          noLintersDetected: false,
        };
      }
    }
  }

  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const workspace = detectWorkspace(root);
  // Wave 5 #13: guard against buildChecks() hanging on linter discovery
  const buildChecksTimeoutMs = 15000; // 15s cap for linter discovery
  const buildChecksResult = await Promise.race([
    buildChecks(workspace, mode),
    new Promise((_, reject) => setTimeout(() => reject(new Error('buildChecks timeout')), buildChecksTimeoutMs))
  ]);
  const { checks, noLintersDetected } = buildChecksResult;

  const KILL_GRACE_MS = 10000;
  const checkResults = await Promise.allSettled(
    checks.map(async (check) => {
      const checkTimeout = check.timeout || timeoutMs;
      let result;

      const runPromise = (async () => {
        // Execute based on command type
        if (check.cmd === 'npm') {
          result = await runCommandSecure('npm', check.args, workspace.root, checkTimeout);
        } else if (check.cmd === 'npx') {
          result = await runNpx(check.args[0], check.args.slice(1), workspace.root, checkTimeout);
        } else if (check.cmd === 'python' || check.cmd === 'python3') {
          // Python module execution
          result = await runCommandSecure(check.cmd, check.args, workspace.root, checkTimeout);
        } else {
          // Generic command execution
          result = await runCommandSecure(check.cmd, check.args, workspace.root, checkTimeout);
        }

        const parsed = uniqueDiagnostics([
          ...parseDiagnosticsFromText(result.stderr, workspace.root, check.name),
          ...parseDiagnosticsFromText(result.stdout, workspace.root, check.name),
        ]);

        return {
          entry: {
            name: check.name,
            ok: result.ok,
            exitCode: result.exitCode,
            command: `${check.cmd} ${check.args.join(' ')}`,
            diagnosticsCount: parsed.length,
            diagnostics: parsed,
            stdout: trimOutput(result.stdout),
            stderr: trimOutput(result.stderr),
          },
          parsed,
        };
      })();

      // Windows safeguard: if cmd.exe child processes survive SIGTERM,
      // force-reject after a grace period so Promise.allSettled doesn't hang forever.
      let graceTimer;
      const gracePromise = new Promise((_, reject) => {
        graceTimer = setTimeout(
          () => reject(new Error(`check grace timeout after ${checkTimeout + KILL_GRACE_MS}ms`)),
          checkTimeout + KILL_GRACE_MS,
        );
      });

      runPromise.catch(() => {}).finally(() => clearTimeout(graceTimer));
      return Promise.race([runPromise, gracePromise]);
    })
  );

  // Handle both fulfilled and rejected promises
  const fulfilled = checkResults.filter(r => r.status === 'fulfilled').map(r => r.value);
  const rejected = checkResults.filter(r => r.status === 'rejected');

  rejected.forEach(r => {
    console.error('[run_diagnostics] Check failed:', r.reason);
  });

  const allDiagnostics = fulfilled.flatMap(r => r.parsed);
  const diagnostics = uniqueDiagnostics(allDiagnostics).slice(0, maxDiagnostics);

  // Include rejected checks in results so consumers see timeouts/failures (not silent 0 checksRun)
  const results = checkResults.map((r, i) => {
    if (r.status === 'fulfilled') {
      return r.value.entry;
    }
    const check = checks[i];
    return {
      name: check?.name || 'unknown',
      ok: false,
      exitCode: null,
      command: check ? `${check.cmd} ${check.args.join(' ')}` : 'unknown',
      diagnosticsCount: 0,
      diagnostics: [],
      stdout: '',
      stderr: r.reason?.message || String(r.reason),
      error: r.reason?.message || String(r.reason),
    };
  });

  const diagnosticsSummary = noLintersDetected
    ? { total: null, error: null, warning: null, information: null, hint: null, noLintersDetected: true }
    : summarizeDiagnostics(diagnostics);

  return {
    ok: true,
    workspaceRoot: workspace.root,
    mode,
    checksRun: results.length,
    failedChecks: results.filter(item => !item.ok).map(item => item.name),
    diagnosticsSummary,
    diagnostics,
    results,
    noLintersDetected,
  };
}

module.exports = {
  workspaceInfo,
  runDiagnostics,
  buildChecks,
  detectNodeLinters,
};
