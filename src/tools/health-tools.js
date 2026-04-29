/**
 * Health check and auto-fix tools for workspace-bridge - SECURE VERSION
 * All commands use argument arrays to prevent injection
 */
const path = require('path');
const { findWorkspaceRoot, detectWorkspace, pathExists, resolvePythonCommand } = require('../utils/path');
const { runCommandSecure, runNpx, runPythonModule, trimOutput } = require('../utils/command');

function checkHealthFile(root, candidates) {
  for (const name of candidates) {
    const filePath = path.join(root, name);
    if (pathExists(filePath)) {
      try {
        const stat = require('fs').statSync(filePath);
        return { found: true, file: name, sizeBytes: stat.size };
      } catch (e) {
        return { found: true, file: name };
      }
    }
  }
  return { found: false, candidates };
}

function detectCiConfig(root) {
  const ciConfigs = [
    { name: 'GitHub Actions', path: '.github/workflows' },
    { name: 'GitLab CI', path: '.gitlab-ci.yml' },
    { name: 'CircleCI', path: '.circleci/config.yml' },
    { name: 'Travis CI', path: '.travis.yml' },
    { name: 'Jenkins', path: 'Jenkinsfile' },
    { name: 'Azure Pipelines', path: 'azure-pipelines.yml' },
    { name: 'Bitbucket Pipelines', path: 'bitbucket-pipelines.yml' },
  ];

  const found = [];
  for (const ci of ciConfigs) {
    if (pathExists(path.join(root, ci.path))) {
      found.push({ name: ci.name, path: ci.path });
    }
  }
  return { found: found.length > 0, configs: found };
}

function detectTestConfig(root, workspace) {
  const frameworks = [];
  if (pathExists(path.join(root, 'jest.config.js')) || pathExists(path.join(root, 'jest.config.ts'))) frameworks.push('jest');
  if (pathExists(path.join(root, 'vitest.config.ts')) || pathExists(path.join(root, 'vitest.config.js'))) frameworks.push('vitest');
  if (pathExists(path.join(root, 'pytest.ini')) || pathExists(path.join(root, 'setup.cfg'))) frameworks.push('pytest');
  if (workspace.hasPyproject) frameworks.push('pytest-pyproject');
  if (pathExists(path.join(root, '.mocharc.js')) || pathExists(path.join(root, '.mocharc.yml'))) frameworks.push('mocha');
  if (workspace.hasPackageJson && workspace.packageJson?.scripts?.test) {
    frameworks.push('custom-node-scripts');
  }
  return { found: frameworks.length > 0, frameworks };
}

function detectPackageManager(root) {
  if (pathExists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (pathExists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (pathExists(path.join(root, 'bun.lockb')) || pathExists(path.join(root, 'bun.lock'))) return 'bun';
  if (pathExists(path.join(root, 'package-lock.json'))) return 'npm';
  return null;
}

function projectHealth(args, container) {
  const target = args?.cwd || process.cwd();
  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const workspace = detectWorkspace(root);

  const checks = {
    readme: checkHealthFile(root, ['README.md', 'README.rst', 'README.txt', 'readme.md']),
    license: checkHealthFile(root, ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING']),
    gitignore: checkHealthFile(root, ['.gitignore']),
    editorconfig: checkHealthFile(root, ['.editorconfig']),
    envExample: checkHealthFile(root, ['.env.example', '.env.sample', '.env.template']),
    dockerConfig: checkHealthFile(root, ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml']),
    ci: detectCiConfig(root),
    testConfig: detectTestConfig(root, workspace),
  };

  const coverageDirs = ['coverage', '.nyc_output', 'htmlcov', '.coverage'];
  const existingCoverageDir = coverageDirs.find(d => pathExists(path.join(root, d)));

  let coverageScript = null;
  if (workspace.hasPackageJson && workspace.packageJson) {
    const scripts = workspace.packageJson.scripts || {};
    coverageScript = scripts['test:coverage'] || scripts['coverage'] || null;
  }

  const passedCount = [
    checks.readme.found,
    checks.license.found,
    checks.gitignore.found,
    checks.ci.found,
    checks.testConfig.found,
  ].filter(Boolean).length;

  return {
    ok: true,
    workspaceRoot: root,
    healthScore: `${passedCount}/5`,
    packageManager: detectPackageManager(root),
    checks,
    testCoverage: {
      hasCoverageScript: Boolean(coverageScript),
      coverageScript,
      hasCoverageReport: Boolean(existingCoverageDir),
      coverageDir: existingCoverageDir || null,
    },
  };
}

async function runAutoFix(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  const workspace = detectWorkspace(root);
  const fixers = args?.fixers || null;
  const dryRun = args?.dryRun === true;

  const shouldRun = (name) => !fixers || fixers.includes(name);
  const results = [];

  // Helper to resolve Python executable
  const getPython = () => resolvePythonCommand(root);

  if (shouldRun('eslint') && workspace.hasPackageJson) {
    const eslintArgs = dryRun 
      ? ['eslint', '--fix-dry-run', '--format=json', '.']
      : ['eslint', '--fix', '.'];
    const result = await runNpx('eslint', eslintArgs.slice(1), root, 60000);
    
    let changedFiles = null;
    if (dryRun) {
      try {
        changedFiles = JSON.parse(result.stdout).filter(f => f.output).length;
      } catch (e) {
        // JSON parse failed, likely empty or invalid output
        if (process.env.DEBUG) {
          console.error(`[health-tools] JSON parse failed for eslint dry-run: ${e.message}`);
        }
      }
    }
    results.push({
      fixer: 'eslint',
      dryRun,
      ok: result.ok || result.exitCode === 1,
      exitCode: result.exitCode,
      changedFiles,
      stdout: trimOutput(dryRun ? '' : result.stdout, 3000),
      stderr: trimOutput(result.stderr, 3000),
    });
  }

  if (shouldRun('prettier') && workspace.hasPackageJson) {
    const hasPrettierConfig = [
      '.prettierrc', '.prettierrc.js', '.prettierrc.json',
      '.prettierrc.yaml', '.prettierrc.yml', 'prettier.config.js', 'prettier.config.ts',
    ].some(f => pathExists(path.join(root, f)));

    if (hasPrettierConfig) {
      const prettierArgs = dryRun 
        ? ['prettier', '--list-different', '.']
        : ['prettier', '--write', '.'];
      const result = await runNpx('prettier', prettierArgs.slice(1), root, 60000);
      
      const filesToFormat = dryRun ? (result.stdout || '').split('\n').filter(Boolean) : null;
      results.push({
        fixer: 'prettier',
        dryRun,
        ok: dryRun ? true : result.ok,
        exitCode: result.exitCode,
        changedFiles: filesToFormat ? filesToFormat.length : null,
        filesToFormat,
        stdout: trimOutput(dryRun ? '' : result.stdout, 3000),
        stderr: trimOutput(result.stderr, 3000),
      });
    } else {
      results.push({ fixer: 'prettier', ok: true, skipped: true, reason: 'No Prettier config found' });
    }
  }

  if (shouldRun('black') && (workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy)) {
    const python = getPython();
    const blackVersion = await runPythonModule(python, 'black', ['--version'], root, 15000);
    
    if (blackVersion.ok) {
      const blackArgs = dryRun 
        ? ['black', '--check', '--diff', '.']
        : ['black', '.'];
      const result = await runPythonModule(python, blackArgs[0], blackArgs.slice(1), root, 60000);
      
      results.push({
        fixer: 'black',
        dryRun,
        ok: dryRun ? true : result.ok,
        exitCode: result.exitCode,
        stdout: trimOutput(result.stdout, 3000),
        stderr: trimOutput(result.stderr, 3000),
      });
    } else {
      results.push({ fixer: 'black', ok: true, skipped: true, reason: 'black not installed' });
    }
  }

  if (shouldRun('ruff') && (workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy)) {
    const python = getPython();
    const ruffVersion = await runPythonModule(python, 'ruff', ['--version'], root, 15000);
    
    if (ruffVersion.ok) {
      const ruffArgs = dryRun 
        ? ['ruff', 'check', '--diff', '.']
        : ['ruff', 'check', '--fix', '.'];
      const result = await runPythonModule(python, ruffArgs[0], ruffArgs.slice(1), root, 60000);
      
      results.push({
        fixer: 'ruff',
        dryRun,
        ok: result.ok || result.exitCode === 1,
        exitCode: result.exitCode,
        stdout: trimOutput(result.stdout, 3000),
        stderr: trimOutput(result.stderr, 3000),
      });
    } else {
      results.push({ fixer: 'ruff', ok: true, skipped: true, reason: 'ruff not installed' });
    }
  }

  return {
    ok: results.filter(r => !r.skipped).every(r => r.ok),
    workspaceRoot: root,
    dryRun,
    fixersRun: results.map(r => r.fixer),
    results,
  };
}

async function checkSecurity(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  const workspace = detectWorkspace(root);
  const results = [];

  if (workspace.hasPackageJson) {
    // Check registry
    const registryResult = await runCommandSecure('npm', ['config', 'get', 'registry'], root, 5000);
    const registry = (registryResult.stdout || '').trim();
    const AUDIT_SUPPORTED = ['registry.npmjs.org', 'registry.yarnpkg.com', 'npm.pkg.github.com'];
    const registrySupportsAudit = !registry || AUDIT_SUPPORTED.some(r => registry.includes(r));

    if (!registrySupportsAudit) {
      results.push({
        tool: 'npm-audit',
        ok: true,
        skipped: true,
        reason: `Registry "${registry}" does not support audit.`,
      });
    } else {
      const result = await runCommandSecure('npm', ['audit', '--json'], root, 60000);
      let summary = null;
      try {
        const parsed = JSON.parse(result.stdout);
        summary = parsed?.metadata?.vulnerabilities;
      } catch { /* not JSON */ }

      results.push({
        tool: 'npm-audit',
        ok: summary ? (summary.critical + summary.high) === 0 : result.ok,
        summary,
        raw: summary ? null : trimOutput(result.stdout + result.stderr, 3000),
      });
    }
  }

  if (workspace.hasRequirements || workspace.hasPyproject) {
    const python = resolvePythonCommand(root);

    // Try pip-audit first
    const pipAuditVersion = await runPythonModule(python, 'pip_audit', ['--version'], root, 15000);
    if (pipAuditVersion.ok) {
      const result = await runPythonModule(python, 'pip_audit', ['--format=json'], root, 45000);
      
      if (!result.ok && result.stderr?.includes('timed out')) {
        results.push({
          tool: 'pip-audit',
          skipped: true,
          reason: 'network timeout (vulnerability check took too long)',
        });
      } else {
        let vulns = null;
        try {
          const parsed = JSON.parse(result.stdout);
          vulns = Array.isArray(parsed) ? parsed.length : null;
        } catch { /* not JSON */ }
        results.push({
          tool: 'pip-audit',
          ok: result.ok,
          summary: vulns !== null ? { vulnerabilities: vulns } : null,
          raw: vulns === null ? trimOutput(result.stdout + result.stderr, 3000) : null,
        });
      }
    } else {
      // Fallback to safety
      const safetyVersion = await runPythonModule(python, 'safety', ['--version'], root, 15000);
      if (safetyVersion.ok) {
        const result = await runPythonModule(python, 'safety', ['check'], root, 45000);
        
        if (!result.ok && result.stderr?.includes('timed out')) {
          results.push({
            tool: 'safety',
            skipped: true,
            reason: 'network timeout (vulnerability check took too long)',
          });
        } else {
          results.push({
            tool: 'safety',
            ok: result.ok,
            summary: null,
            raw: trimOutput(result.stdout + result.stderr, 3000),
          });
        }
      }
    }
  }

  return {
    ok: results.every(r => r.ok),
    workspaceRoot: root,
    toolsRun: results.map(r => r.tool),
    results,
  };
}

async function checkDependencies(args, container) {
  const target = args?.cwd || process.cwd();
  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const workspace = detectWorkspace(root);
  const results = [];

  if (workspace.hasPackageJson) {
    const result = await runCommandSecure('npm', ['outdated', '--json'], root, 60000);
    let outdated = {};
    try {
      outdated = JSON.parse(result.stdout || '{}');
    } catch { /* not JSON, may be empty when nothing outdated */ }

    const packages = Object.entries(outdated).map(([name, info]) => ({
      name,
      current: info.current,
      wanted: info.wanted,
      latest: info.latest,
      type: info.type,
    }));
    results.push({ tool: 'npm-outdated', outdatedCount: packages.length, packages });
  }

  if (workspace.hasRequirements || workspace.hasPyproject) {
    const python = resolvePythonCommand(root);
    const result = await runPythonModule(python, 'pip', ['list', '--outdated', '--format=json'], root, 15000);
    
    if (!result.ok && result.stderr?.includes('timed out')) {
      results.push({
        tool: 'pip-outdated',
        skipped: true,
        reason: 'network timeout (PyPI check took too long)',
      });
    } else {
      let packages = [];
      try {
        packages = JSON.parse(result.stdout || '[]');
      } catch (e) {
        if (process.env.DEBUG) {
          console.error(`[health-tools] JSON parse failed for pip outdated: ${e.message}`);
        }
      }
      results.push({
        tool: 'pip-outdated',
        outdatedCount: packages.length,
        packages: packages.map(p => ({ name: p.name, current: p.version, latest: p.latest_version })),
      });
    }
  }

  return { ok: true, workspaceRoot: root, results };
}

module.exports = {
  projectHealth,
  runAutoFix,
  checkSecurity,
  checkDependencies,
  detectTestConfig,
};
