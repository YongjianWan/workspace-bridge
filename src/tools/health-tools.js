/**
 * Health check and auto-fix tools for workspace-bridge - SECURE VERSION
 * All commands use argument arrays to prevent injection
 */
const path = require('path');
const { findWorkspaceRoot, detectWorkspace, pathExists, resolvePythonCommand } = require('../utils/path');
const { runCommandSecure, runNpx, runPythonModule, trimOutput } = require('../utils/command');
const { detectNodePackageManager, detectTestRunner, detectStack } = require('../utils/stack-detector');
const { LIMITS, TIMEOUTS } = require('../config/constants');

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

function hasWorkflowFiles(dir) {
  try {
    const files = require('fs').readdirSync(dir);
    return files.some((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch {
    return false;
  }
}

function detectCiConfig(root) {
  const ciConfigs = [
    { name: 'GitHub Actions', path: '.github/workflows', check: (p) => hasWorkflowFiles(p) },
    { name: 'GitLab CI', path: '.gitlab-ci.yml' },
    { name: 'CircleCI', path: '.circleci/config.yml' },
    { name: 'Travis CI', path: '.travis.yml' },
    { name: 'Jenkins', path: 'Jenkinsfile' },
    { name: 'Azure Pipelines', path: 'azure-pipelines.yml' },
    { name: 'Bitbucket Pipelines', path: 'bitbucket-pipelines.yml' },
  ];

  const found = [];
  for (const ci of ciConfigs) {
    const fullPath = path.join(root, ci.path);
    const detected = ci.check ? ci.check(fullPath) : pathExists(fullPath);
    if (detected) {
      found.push({ name: ci.name, path: ci.path });
    }
  }
  return { found: found.length > 0, configs: found };
}

function detectTestConfig(root) {
  const frameworks = [];
  const runner = detectTestRunner(root);
  if (runner?.type === 'node') {
    frameworks.push(runner.name === 'custom' ? 'custom-node-scripts' : runner.name);
  }
  if (runner?.type === 'python') {
    frameworks.push(runner.name);
  }
  return { found: frameworks.length > 0, frameworks };
}

function checkParserAvailability() {
  try {
    require('@babel/parser');
    return { available: true };
  } catch {
    return {
      available: false,
      warning: '@babel/parser not available — JS/TS analysis will use regex fallback with reduced accuracy',
    };
  }
}

function buildFixSuggestions(stack) {
  const profile = stack?.profile || 'unknown';
  const isNode = stack?.node?.enabled;
  const isJava = stack?.java?.enabled;
  const isPython = stack?.python?.enabled;
  const isGo = stack?.go?.enabled;
  const isRust = stack?.rust?.enabled;
  const isCpp = stack?.cpp?.enabled;

  let testAction = 'Set up a test runner (e.g., Jest, pytest, cargo test)';
  if (isJava) {
    testAction = 'Set up Java tests (e.g., mvn test, gradle test)';
  } else if (isPython) {
    testAction = 'Set up a Python test runner (e.g., pytest)';
  } else if (isGo) {
    testAction = 'Go testing is built-in with go test; ensure module structure supports your test files';
  } else if (isRust) {
    testAction = 'Rust testing is built-in with cargo test; ensure workspace members are configured';
  } else if (isCpp) {
    testAction = 'Set up a C++ test runner (e.g., CTest, Google Test)';
  } else if (isNode || profile === 'mixed') {
    const runner = stack?.node?.testRunner;
    if (runner && runner !== 'custom') {
      testAction = `Complete ${runner} setup (runner detected but test script or config may be missing)`;
    } else {
      testAction = 'Set up a test runner (e.g., Vitest for Vite projects, Jest for plain Node)';
    }
  }

  return {
    readme: { action: 'Create README.md with project description and usage instructions', severity: 'medium' },
    license: { action: 'Add a LICENSE file (e.g., MIT, Apache-2.0)', severity: 'low' },
    gitignore: { action: 'Create .gitignore to exclude build artifacts and dependencies', severity: 'high' },
    editorconfig: { action: 'Add .editorconfig for consistent coding style across editors', severity: 'low' },
    envExample: { action: 'Create .env.example documenting required environment variables', severity: 'medium' },
    dockerConfig: { action: 'Add Dockerfile or docker-compose.yml for containerized deployment', severity: 'low' },
    ci: { action: 'Add CI configuration (e.g., .github/workflows/ci.yml)', severity: 'medium' },
    testConfig: { action: testAction, severity: 'high' },
  };
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
    envExample: checkHealthFile(root, ['.env.example', '.env.sample', '.env.template', '.env.development', '.env.production']),
    dockerConfig: checkHealthFile(root, ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml']),
    ci: detectCiConfig(root),
    testConfig: detectTestConfig(root),
  };

  // P37: sizeBytes is output noise — it has no diagnostic value for health checks
  for (const key of Object.keys(checks)) {
    if (checks[key] && typeof checks[key] === 'object' && 'sizeBytes' in checks[key]) {
      delete checks[key].sizeBytes;
    }
  }

  const parserAvailability = workspace.hasPackageJson ? checkParserAvailability() : { available: true, skipped: true };

  const coverageDirs = ['coverage', '.nyc_output', 'htmlcov', '.coverage'];
  const existingCoverageDir = coverageDirs.find(d => pathExists(path.join(root, d)));

  let coverageScript = null;
  if (workspace.hasPackageJson && workspace.packageJson) {
    const scripts = workspace.packageJson.scripts || {};
    coverageScript = scripts['test:coverage'] || scripts['coverage'] || null;
  }

  // Stack-aware scoring: core checks vary by tech stack
  const isNodeProject = workspace.hasPackageJson;
  const isJavaProject = workspace.hasJava;
  const isPythonProject = workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy;
  const isGoProject = workspace.hasGo;
  const isRustProject = workspace.hasRust;

  const coreChecks = ['readme', 'license', 'gitignore'];
  if (isNodeProject || isPythonProject || isGoProject || isRustProject) {
    coreChecks.push('testConfig');
  }
  // For Java projects, test config is less standardized (mvn test / gradle test);
  // we still recommend it but don't penalize as heavily.
  if (isJavaProject && !isNodeProject && !isPythonProject && !isGoProject && !isRustProject) {
    // Java projects get a 3-point base; CI and testConfig are bonus
  }

  const corePassed = coreChecks.filter((key) => checks[key]?.found).length;
  const coreTotal = coreChecks.length;

  const bonusChecks = ['ci', 'dockerConfig', 'envExample', 'editorconfig'];
  const bonusPassed = bonusChecks.filter((key) => checks[key]?.found).length;
  const bonusTotal = bonusChecks.length;

  // Health score = core + up to 1 bonus point (capped at coreTotal + 1 for display parity)
  const displayTotal = Math.max(5, coreTotal + 1);
  const displayPassed = corePassed + (bonusPassed > 0 ? 1 : 0);

  const stack = detectStack(root);
  const fixSuggestions = buildFixSuggestions(stack);
  const fixes = Object.entries(checks)
    .filter(([key, value]) => !value.found && fixSuggestions[key])
    .map(([key]) => ({ check: key, ...fixSuggestions[key] }));

  if (!parserAvailability.available && !parserAvailability.skipped) {
    fixes.push({
      check: 'parserAvailability',
      action: 'Install @babel/parser for accurate JS/TS dependency analysis (npm install @babel/parser)',
      severity: 'high',
    });
  }

  return {
    ok: true,
    workspaceRoot: root,
    healthScore: `${displayPassed}/${displayTotal}`,
    healthScoreNumeric: {
      passed: displayPassed,
      total: displayTotal,
      ratio: displayTotal > 0 ? displayPassed / displayTotal : 0,
    },
    packageManager: detectNodePackageManager(root),
    checks,
    fixes,
    parserAvailability,
    stack: {
      isNode: isNodeProject,
      isJava: isJavaProject,
      isPython: isPythonProject,
      isGo: isGoProject,
      isRust: isRustProject,
    },
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
    const result = await runNpx('eslint', eslintArgs.slice(1), root, TIMEOUTS.HEALTH_COMMAND_TIMEOUT_MS);
    
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
      stdout: trimOutput(dryRun ? '' : result.stdout, LIMITS.LINTER_OUTPUT_MAX_CHARS),
      stderr: trimOutput(result.stderr, LIMITS.LINTER_OUTPUT_MAX_CHARS),
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
      const result = await runNpx('prettier', prettierArgs.slice(1), root, TIMEOUTS.HEALTH_COMMAND_TIMEOUT_MS);
      
      const filesToFormat = dryRun ? (result.stdout || '').split('\n').filter(Boolean) : null;
      results.push({
        fixer: 'prettier',
        dryRun,
        ok: dryRun ? true : result.ok,
        exitCode: result.exitCode,
        changedFiles: filesToFormat ? filesToFormat.length : null,
        filesToFormat,
        stdout: trimOutput(dryRun ? '' : result.stdout, LIMITS.LINTER_OUTPUT_MAX_CHARS),
        stderr: trimOutput(result.stderr, LIMITS.LINTER_OUTPUT_MAX_CHARS),
      });
    } else {
      results.push({ fixer: 'prettier', ok: true, skipped: true, reason: 'No Prettier config found' });
    }
  }

  if (shouldRun('black') && (workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy)) {
    const python = getPython();
    const blackVersion = await runPythonModule(python, 'black', ['--version'], root, TIMEOUTS.HEALTH_SHORT_TIMEOUT_MS);
    
    if (blackVersion.ok) {
      const blackArgs = dryRun 
        ? ['black', '--check', '--diff', '.']
        : ['black', '.'];
      const result = await runPythonModule(python, blackArgs[0], blackArgs.slice(1), root, TIMEOUTS.HEALTH_COMMAND_TIMEOUT_MS);
      
      results.push({
        fixer: 'black',
        dryRun,
        ok: dryRun ? true : result.ok,
        exitCode: result.exitCode,
        stdout: trimOutput(result.stdout, LIMITS.LINTER_OUTPUT_MAX_CHARS),
        stderr: trimOutput(result.stderr, LIMITS.LINTER_OUTPUT_MAX_CHARS),
      });
    } else {
      results.push({ fixer: 'black', ok: true, skipped: true, reason: 'black not installed' });
    }
  }

  if (shouldRun('ruff') && (workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy)) {
    const python = getPython();
    const ruffVersion = await runPythonModule(python, 'ruff', ['--version'], root, TIMEOUTS.HEALTH_SHORT_TIMEOUT_MS);
    
    if (ruffVersion.ok) {
      const ruffArgs = dryRun 
        ? ['ruff', 'check', '--diff', '.']
        : ['ruff', 'check', '--fix', '.'];
      const result = await runPythonModule(python, ruffArgs[0], ruffArgs.slice(1), root, TIMEOUTS.HEALTH_COMMAND_TIMEOUT_MS);
      
      results.push({
        fixer: 'ruff',
        dryRun,
        ok: result.ok || result.exitCode === 1,
        exitCode: result.exitCode,
        stdout: trimOutput(result.stdout, LIMITS.LINTER_OUTPUT_MAX_CHARS),
        stderr: trimOutput(result.stderr, LIMITS.LINTER_OUTPUT_MAX_CHARS),
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
    const registryResult = await runCommandSecure('npm', ['config', 'get', 'registry'], root, TIMEOUTS.HEALTH_QUICK_TIMEOUT_MS);
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
      const result = await runCommandSecure('npm', ['audit', '--json'], root, TIMEOUTS.HEALTH_COMMAND_TIMEOUT_MS);
      let summary = null;
      try {
        const parsed = JSON.parse(result.stdout);
        summary = parsed?.metadata?.vulnerabilities;
      } catch { /* not JSON */ }

      results.push({
        tool: 'npm-audit',
        ok: summary ? (summary.critical + summary.high) === 0 : result.ok,
        summary,
        raw: summary ? null : trimOutput(result.stdout + result.stderr, LIMITS.LINTER_OUTPUT_MAX_CHARS),
      });
    }
  }

  if (workspace.hasRequirements || workspace.hasPyproject) {
    const python = resolvePythonCommand(root);

    // Try pip-audit first
    const pipAuditVersion = await runPythonModule(python, 'pip_audit', ['--version'], root, TIMEOUTS.HEALTH_SHORT_TIMEOUT_MS);
    if (pipAuditVersion.ok) {
      const result = await runPythonModule(python, 'pip_audit', ['--format=json'], root, TIMEOUTS.HEALTH_AUDIT_TIMEOUT_MS);
      
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
          raw: vulns === null ? trimOutput(result.stdout + result.stderr, LIMITS.LINTER_OUTPUT_MAX_CHARS) : null,
        });
      }
    } else {
      // Fallback to safety
      const safetyVersion = await runPythonModule(python, 'safety', ['--version'], root, TIMEOUTS.HEALTH_SHORT_TIMEOUT_MS);
      if (safetyVersion.ok) {
        const result = await runPythonModule(python, 'safety', ['check'], root, TIMEOUTS.HEALTH_AUDIT_TIMEOUT_MS);
        
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
            raw: trimOutput(result.stdout + result.stderr, LIMITS.LINTER_OUTPUT_MAX_CHARS),
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
    const result = await runCommandSecure('npm', ['outdated', '--json'], root, TIMEOUTS.HEALTH_COMMAND_TIMEOUT_MS);
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
    const result = await runPythonModule(python, 'pip', ['list', '--outdated', '--format=json'], root, TIMEOUTS.HEALTH_SHORT_TIMEOUT_MS);
    
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
  checkParserAvailability,
};
