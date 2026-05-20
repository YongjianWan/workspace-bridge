const fs = require('fs');
const path = require('path');
const { pathExists } = require('./path');
const { PROBE } = require('../config/constants');

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

module.exports = {
  detectEslintConfig,
  detectPrettierConfig,
  detectTscConfig,
  checkParserAvailability,
};
