/**
 * Workspace tools for workspace-bridge
 */
const path = require('path');
const { findWorkspaceRoot, detectWorkspace, resolvePythonCommand } = require('../utils/path');
const { runCommand, runCommandAsync } = require('../utils/command');
const { parseDiagnosticsFromText, uniqueDiagnostics, summarizeDiagnostics } = require('../utils/diagnostics');

function buildChecks(workspace, mode) {
  const checks = [];
  const root = workspace.root;

  if (workspace.hasPackageJson && workspace.packageJson?.scripts) {
    const scripts = workspace.packageJson.scripts;
    if (scripts.typecheck) {
      checks.push({ name: 'node:typecheck', command: 'npm run -s typecheck' });
    } else if (workspace.hasTsconfig) {
      checks.push({ name: 'node:tsc', command: 'npx tsc --noEmit' });
    }
    if (scripts.lint) checks.push({ name: 'node:lint', command: 'npm run -s lint' });
    if (mode === 'full' && scripts.build) checks.push({ name: 'node:build', command: 'npm run -s build' });
    if (mode === 'full' && scripts.test) checks.push({ name: 'node:test', command: 'npm run -s test -- --runInBand' });
  }

  if (workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy) {
    const python = resolvePythonCommand(root);
    let hasFocusedPythonCheck = false;

    if (workspace.hasManagePy) {
      checks.push({ name: 'django:check', command: `${python} manage.py check` });
      hasFocusedPythonCheck = true;
    }

    const ruffVersion = runCommand(`${python} -m ruff --version`, root, 10000);
    if (ruffVersion.ok) {
      checks.push({ name: 'python:ruff', command: `${python} -m ruff check .`, timeout: 30000 });
      hasFocusedPythonCheck = true;
    }

    const pyrightVersion = runCommand(`${python} -m pyright --version`, root, 10000);
    if (pyrightVersion.ok) {
      checks.push({ name: 'python:pyright', command: `${python} -m pyright .`, timeout: 60000 });
      hasFocusedPythonCheck = true;
    }

    if (!hasFocusedPythonCheck || mode === 'full') {
      checks.push({ name: 'python:compileall', command: `${python} -m compileall -q .` });
    }

    if (mode === 'full') {
      const pytestVersion = runCommand(`${python} -m pytest --version`, root, 15000);
      if (pytestVersion.ok) {
        checks.push({ name: 'python:pytest', command: `${python} -m pytest -q` });
      }
    }
  }

  return checks;
}

function workspaceInfo(args) {
  const target = args?.cwd || process.cwd();
  const workspace = detectWorkspace(findWorkspaceRoot(target));
  const checks = buildChecks(workspace, 'quick');

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
    availableChecks: checks.map(item => ({ name: item.name, command: item.command })),
  };
}

async function runDiagnostics(args) {
  const target = args?.cwd || process.cwd();
  const mode = args?.mode === 'full' ? 'full' : 'quick';
  const timeoutMs = Number.isFinite(args?.timeoutMs) ? args.timeoutMs : 120000;
  const maxDiagnostics = Number.isFinite(args?.maxDiagnostics) ? Math.max(1, Math.floor(args.maxDiagnostics)) : 300;

  const workspace = detectWorkspace(findWorkspaceRoot(target));
  const checks = buildChecks(workspace, mode);

  const checkResults = await Promise.allSettled(
    checks.map(async (check) => {
      // Use check-specific timeout or fall back to global timeout
      const checkTimeout = check.timeout || timeoutMs;
      const result = await runCommandAsync(check.command, workspace.root, checkTimeout);
      const parsed = uniqueDiagnostics([
        ...parseDiagnosticsFromText(result.stderr, workspace.root, check.name),
        ...parseDiagnosticsFromText(result.stdout, workspace.root, check.name),
      ]);
      return {
        entry: {
          name: check.name,
          ok: result.ok,
          exitCode: result.exitCode,
          command: result.command,
          diagnosticsCount: parsed.length,
          diagnostics: parsed,
          stdout: require('../utils/command').trimOutput(result.stdout),
          stderr: require('../utils/command').trimOutput(result.stderr),
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
