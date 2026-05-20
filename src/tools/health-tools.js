/**
 * Health check and auto-fix tools for workspace-bridge - SECURE VERSION
 * All commands use argument arrays to prevent injection
 */
const path = require('path');
const { findWorkspaceRoot, detectWorkspace, pathExists, resolvePythonCommand } = require('../utils/path');
const { runCommandSecure, runNpx, runPythonModule, trimOutput } = require('../utils/command');
const { detectNodePackageManager, detectTestRunner, detectStack } = require('../utils/stack-detector');
const { LIMITS, TIMEOUTS } = require('../config/constants');
const { checkParserAvailability } = require('../utils/environment-probe');

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
  // P101: Django projects can run tests via `manage.py test` without any config file
  if (frameworks.length === 0 && pathExists(path.join(root, 'manage.py'))) {
    frameworks.push('django-test');
  }
  return { found: frameworks.length > 0, frameworks };
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

  const parserAvailability = workspace.hasPackageJson ? checkParserAvailability() : { available: true, usedFallbackPath: true };

  const coverageDirs = ['coverage', '.nyc_output', 'htmlcov', '.coverage'];
  const existingCoverageDir = coverageDirs.find(d => pathExists(path.join(root, d)));

  let coverageScript = null;
  if (workspace.hasPackageJson && workspace.packageJson) {
    const scripts = workspace.packageJson.scripts || {};
    coverageScript = scripts['test:coverage'] || scripts['coverage'] || null;
  }

  // Stack-aware scoring: all relevant checks count equally
  const isNodeProject = workspace.hasPackageJson;
  const isJavaProject = workspace.hasJava;
  const isPythonProject = workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy;
  const isGoProject = workspace.hasGo;
  const isRustProject = workspace.hasRust;

  const relevantChecks = ['readme', 'license', 'gitignore', 'envExample', 'editorconfig'];
  if (isNodeProject || isPythonProject || isGoProject || isRustProject || isJavaProject) {
    relevantChecks.push('testConfig');
  }
  relevantChecks.push('ci', 'dockerConfig');

  const passed = relevantChecks.filter((key) => checks[key]?.found).length;
  const total = relevantChecks.length;

  const stack = detectStack(root);
  const fixSuggestions = buildFixSuggestions(stack);
  const fixes = Object.entries(checks)
    .filter(([key, value]) => !value.found && fixSuggestions[key])
    .map(([key]) => ({ check: key, ...fixSuggestions[key] }));

  if (!parserAvailability.available && !parserAvailability.usedFallbackPath) {
    fixes.push({
      check: 'parserAvailability',
      action: 'Install @babel/parser for accurate JS/TS dependency analysis (npm install @babel/parser)',
      severity: 'high',
    });
  }

  return {
    ok: true,
    workspaceRoot: root,
    healthScore: `${passed}/${total}`,
    healthScoreNumeric: {
      passed,
      total,
      ratio: total > 0 ? passed / total : 0,
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

module.exports = {
  projectHealth,
  detectTestConfig,
  checkParserAvailability,
};
