/**
 * Workspace tools for workspace-bridge - SECURE VERSION
 * All commands use argument arrays to prevent injection
 */
const path = require('path');
const { findWorkspaceRoot, detectWorkspace } = require('../utils/path');
const { runCommandSecure, runNpx, runPythonModule, trimOutput } = require('../utils/command');
const { parseDiagnosticsFromText, uniqueDiagnostics, summarizeDiagnostics } = require('../utils/diagnostics');

/**
 * Resolve Python executable path
 */
function resolvePythonCommand(root) {
  const fs = require('fs');
  const candidates = [
    path.join(root, '.venv', 'Scripts', 'python.exe'),
    path.join(root, 'venv', 'Scripts', 'python.exe'),
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, 'venv', 'bin', 'python'),
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
 * Build diagnostic checks using secure command execution
 */
async function buildChecks(workspace, mode) {
  const checks = [];
  const root = workspace.root;

  if (workspace.hasPackageJson && workspace.packageJson?.scripts) {
    const scripts = workspace.packageJson.scripts;
    if (scripts.typecheck) {
      checks.push({ 
        name: 'node:typecheck', 
        cmd: 'npm',
        args: ['run', '-s', 'typecheck'],
      });
    } else if (workspace.hasTsconfig) {
      checks.push({ 
        name: 'node:tsc', 
        cmd: 'npx',
        args: ['tsc', '--noEmit'],
      });
    }
    if (scripts.lint) {
      checks.push({ 
        name: 'node:lint', 
        cmd: 'npm',
        args: ['run', '-s', 'lint'],
      });
    }
    if (mode === 'full' && scripts.build) {
      checks.push({ 
        name: 'node:build', 
        cmd: 'npm',
        args: ['run', '-s', 'build'],
      });
    }
    if (mode === 'full' && scripts.test) {
      checks.push({ 
        name: 'node:test', 
        cmd: 'npm',
        args: ['run', '-s', 'test', '--', '--runInBand'],
      });
    }

    if (mode === 'quick' && checks.length === 0) {
      checks.push({
        name: 'node:script-list',
        cmd: 'npm',
        args: ['run', '-s'],
        timeout: 15000,
      });
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
      });
      hasFocusedPythonCheck = true;
    }

    // Check for ruff availability
    const ruffResult = await runPythonModule(python, 'ruff', ['--version'], root, 10000);
    if (ruffResult.ok) {
      checks.push({ 
        name: 'python:ruff', 
        cmd: python,
        args: ['-m', 'ruff', 'check', '.'],
        timeout: 30000,
      });
      hasFocusedPythonCheck = true;
    }

    // Check for pyright availability
    const pyrightResult = await runPythonModule(python, 'pyright', ['--version'], root, 10000);
    if (pyrightResult.ok) {
      checks.push({ 
        name: 'python:pyright', 
        cmd: python,
        args: ['-m', 'pyright', '.'],
        timeout: 60000,
      });
      hasFocusedPythonCheck = true;
    }

    if (!hasFocusedPythonCheck || mode === 'full') {
      checks.push({ 
        name: 'python:compileall', 
        cmd: python,
        args: ['-m', 'compileall', '-q', '.'],
      });
    }

    if (mode === 'full') {
      const pytestResult = await runPythonModule(python, 'pytest', ['--version'], root, 15000);
      if (pytestResult.ok) {
        checks.push({ 
          name: 'python:pytest', 
          cmd: python,
          args: ['-m', 'pytest', '-q'],
        });
      }
    }
  }

  if (checks.length === 0 && workspace.hasGit) {
    checks.push({
      name: 'workspace:git-status',
      cmd: 'git',
      args: ['status', '--short'],
      timeout: 10000,
    });
  }

  return checks;
}

function workspaceInfo(args, container) {
  const target = args?.cwd || process.cwd();
  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const workspace = detectWorkspace(root);

  return {
    cwd: require('../utils/path').normalizePath(target),
    workspaceRoot: workspace.root,
    detected: {
      git: workspace.hasGit,
      node: workspace.hasPackageJson,
      python: workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy,
      django: workspace.hasManagePy,
      typescript: workspace.hasTsconfig,
    },
    // Note: async buildChecks is called separately when needed
    availableChecks: [], 
  };
}

async function runDiagnostics(args, container) {
  const target = args?.cwd || process.cwd();
  const mode = args?.mode === 'full' ? 'full' : 'quick';
  const timeoutMs = Number.isFinite(args?.timeoutMs) ? args.timeoutMs : 120000;
  const maxDiagnostics = Number.isFinite(args?.maxDiagnostics) ? Math.max(1, Math.floor(args.maxDiagnostics)) : 300;

  // Use container cache if available
  if (container?.cache) {
    const cached = container.cache.getWorkspaceInfo();
    if (cached) {
      const allDiagnostics = container.cache.getAllDiagnostics?.() || [];
      if (allDiagnostics.length > 0) {
        return {
          workspaceRoot: container.workspaceRoot,
          mode: 'cached',
          checksRun: 0,
          failedChecks: [],
          diagnosticsSummary: summarizeDiagnostics(allDiagnostics),
          diagnostics: allDiagnostics,
          results: [],
          cached: true,
        };
      }
    }
  }

  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const workspace = detectWorkspace(root);
  const checks = await buildChecks(workspace, mode);

  const checkResults = await Promise.allSettled(
    checks.map(async (check) => {
      const checkTimeout = check.timeout || timeoutMs;
      let result;

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
  const results = fulfilled.map(r => r.entry);

  return {
    workspaceRoot: workspace.root,
    mode,
    checksRun: results.length,
    failedChecks: results.filter(item => !item.ok).map(item => item.name),
    diagnosticsSummary: summarizeDiagnostics(diagnostics),
    diagnostics,
    results,
  };
}

module.exports = {
  workspaceInfo,
  runDiagnostics,
  buildChecks,
};
