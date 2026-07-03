const fs = require('fs');
const path = require('path');
const { pathExists } = require('./path');
const { PROBE } = require('../config/constants');

function readTextIfExists(filePath) {
  if (!pathExists(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Detect ESLint configuration presence purely from filesystem.
 * Used by workspace-tools (static lint discovery) and diagnostics-engine
 * (runtime checker fallback) to avoid duplicated logic.
 */
function detectEslintConfig(root) {
  if (PROBE.ESLINT_CONFIG_FILES.some((f) => pathExists(path.join(root, f)))) {
    return true;
  }
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return Boolean(pj.eslintConfig);
  } catch {
    return false;
  }
}

/**
 * Detect Prettier configuration presence from filesystem and package.json.
 */
function detectPrettierConfig(root) {
  if (PROBE.PRETTIER_CONFIG_FILES.some((f) => pathExists(path.join(root, f)))) {
    return true;
  }
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const deps = { ...pj.dependencies, ...pj.devDependencies };
    return Boolean(deps.prettier) || Boolean(pj.scripts?.format);
  } catch {
    return false;
  }
}

/**
 * Detect TypeScript compiler availability from tsconfig and package.json.
 */
function detectTscConfig(root) {
  if (pathExists(path.join(root, 'tsconfig.json'))) {
    return true;
  }
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return Boolean(pj.devDependencies?.typescript) || Boolean(pj.dependencies?.typescript);
  } catch {
    return false;
  }
}

/**
 * Check if the JS/TS AST parser (@babel/parser) is available.
 */
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

const PYTHON_REQUIREMENTS_FILES = [
  'requirements.txt',
  'requirements-dev.txt',
  'requirements/base.txt',
  'requirements/prod.txt',
];

function hasDeclaredDependency(root, packageName) {
  const pattern = new RegExp(`^\\s*${packageName}\\b`, 'm');
  for (const file of PYTHON_REQUIREMENTS_FILES) {
    if (pattern.test(readTextIfExists(path.join(root, file)))) return true;
  }
  const pyproject = readTextIfExists(path.join(root, 'pyproject.toml'));
  if (new RegExp(`\\b${packageName}\\b`).test(pyproject)) return true;
  return false;
}

/**
 * Probe Python/Django test environment prerequisites that workspace-bridge
 * cannot verify at runtime but that will determine whether suggested pytest
 * commands actually succeed.
 *
 * Detects:
 * - Django + pytest without pytest-django declared
 * - Django projects needing a reachable database
 *
 * Returns an array of note objects { type, message, remediation }.
 */
function probePythonTestEnvironment(root, pythonStack) {
  if (!pythonStack || !pythonStack.enabled) return [];
  if (pythonStack.framework !== 'django') return [];
  if (pythonStack.testRunner !== 'pytest') return [];

  const notes = [];
  if (!hasDeclaredDependency(root, 'pytest-django')) {
    notes.push({
      type: 'missing-dependency',
      message: 'Django project uses pytest but pytest-django is not declared in requirements or pyproject.toml',
      remediation: 'pip install pytest-django',
    });
  }

  notes.push({
    type: 'environment-prerequisite',
    message: 'Django tests require a database matching the DATABASES configuration in settings',
    remediation: 'Ensure the database configured in Django settings is accessible before running tests',
  });

  return notes;
}

module.exports = {
  detectEslintConfig,
  detectPrettierConfig,
  detectTscConfig,
  checkParserAvailability,
  probePythonTestEnvironment,
};
