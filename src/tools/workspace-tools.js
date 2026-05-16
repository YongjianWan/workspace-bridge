/**
 * Workspace tools for workspace-bridge - SECURE VERSION
 * All commands use argument arrays to prevent injection
 */
const path = require('path');
const { findWorkspaceRoot, detectWorkspace, toRelativePosix, pathExists } = require('../utils/path');
const { runCommandSecure, runNpx, runPythonModule, trimOutput } = require('../utils/command');
const { parseDiagnosticsFromText, uniqueDiagnostics, summarizeDiagnostics } = require('../utils/diagnostics');
const { checkParserAvailability } = require('./health-tools');

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
 * Detect available Node.js linters/formatters based on config files and package.json.
 * Used by both workspaceInfo (availableChecks) and buildChecks (noLintersDetected).
 */
function detectNodeLinters(workspace, root) {
  const linters = { eslint: false, prettier: false, tsc: false };
  if (!workspace.hasPackageJson || !workspace.packageJson) {
    return linters;
  }

  const pj = workspace.packageJson;

  // ESLint: config file or inline eslintConfig
  const eslintConfigs = [
    '.eslintrc.js', '.eslintrc.json', '.eslintrc.cjs',
    '.eslintrc.yaml', '.eslintrc.yml',
    'eslint.config.js', 'eslint.config.mjs', '.eslintrc',
  ];
  linters.eslint = eslintConfigs.some((f) => pathExists(path.join(root, f)));
  if (!linters.eslint) {
    linters.eslint = Boolean(pj.eslintConfig);
  }

  // Prettier: config file or dependency/script
  const prettierConfigs = [
    '.prettierrc', '.prettierrc.json', '.prettierrc.js',
    '.prettierrc.cjs', '.prettierrc.yaml', '.prettierrc.yml',
    '.prettierrc.toml', 'prettier.config.js',
  ];
  linters.prettier = prettierConfigs.some((f) => pathExists(path.join(root, f)));
  if (!linters.prettier) {
    const deps = { ...pj.dependencies, ...pj.devDependencies };
    linters.prettier = Boolean(deps.prettier) || Boolean(pj.scripts?.format);
  }

  // TypeScript compiler
  linters.tsc = workspace.hasTsconfig || Boolean(pj.devDependencies?.typescript) || Boolean(pj.dependencies?.typescript);

  return linters;
}

/**
 * Build diagnostic checks using secure command execution
 */
async function buildChecks(workspace, mode) {
  const checks = [];
  const root = workspace.root;
  let noLintersDetected = false;
  const nodeLinters = detectNodeLinters(workspace, root);

  if (workspace.hasPackageJson && workspace.packageJson?.scripts) {
    const scripts = workspace.packageJson.scripts;
    let hasNodeCheck = false;

    if (scripts.typecheck) {
      checks.push({
        name: 'node:typecheck',
        cmd: 'npm',
        args: ['run', '-s', 'typecheck'],
      });
      hasNodeCheck = true;
    } else if (workspace.hasTsconfig) {
      checks.push({
        name: 'node:tsc',
        cmd: 'npx',
        args: ['tsc', '--noEmit'],
      });
      hasNodeCheck = true;
    }
    if (scripts.lint) {
      checks.push({
        name: 'node:lint',
        cmd: 'npm',
        args: ['run', '-s', 'lint'],
      });
      hasNodeCheck = true;
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
      hasNodeCheck = true;
    }

    // Auto-detect eslint if no lint script but config exists
    if (!scripts.lint && nodeLinters.eslint) {
      checks.push({
        name: 'node:eslint',
        cmd: 'npx',
        args: ['eslint', '.'],
        timeout: 30000,
      });
      hasNodeCheck = true;
    }

    if (mode === 'quick' && !hasNodeCheck) {
      noLintersDetected = true;
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

  return { checks, noLintersDetected };
}

function workspaceInfo(args, container) {
  const target = args?.cwd || process.cwd();
  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const workspace = detectWorkspace(root);

  // Try to use depGraph data if container is ready; otherwise fall back to basic detection
  const depGraph = container?.depGraph;
  const allOriginalPaths = depGraph
    ? Array.from(depGraph.graph?.values() || []).map((v) => v.originalPath).filter(Boolean)
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
    : { available: true, skipped: true };

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
  const timeoutMs = Number.isFinite(args?.timeoutMs) ? args.timeoutMs : 120000;
  const maxDiagnostics = Number.isFinite(args?.maxDiagnostics) ? Math.max(1, Math.floor(args.maxDiagnostics)) : 300;

  // Use container cache if available
  if (container?.cache) {
    const cached = container.cache.getWorkspaceInfo();
    if (cached) {
      const allDiagnostics = container.cache.getAllDiagnostics?.() || [];
      if (allDiagnostics.length > 0) {
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
        };
      }
    }
  }

  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const workspace = detectWorkspace(root);
  const { checks, noLintersDetected } = await buildChecks(workspace, mode);

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
