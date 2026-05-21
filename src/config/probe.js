/**
 * Config file lists for environment probing.
 * Centralized so that linter detection logic stays consistent across
 * workspace-tools.js (static) and diagnostics-engine.js (runtime fallback).
 */
const PROBE = {
  ESLINT_CONFIG_FILES: [
    '.eslintrc.js', '.eslintrc.json', '.eslintrc.cjs',
    '.eslintrc.yaml', '.eslintrc.yml',
    'eslint.config.js', 'eslint.config.mjs', '.eslintrc',
  ],
  PRETTIER_CONFIG_FILES: [
    '.prettierrc', '.prettierrc.json', '.prettierrc.js',
    '.prettierrc.cjs', '.prettierrc.yaml', '.prettierrc.yml',
    '.prettierrc.toml', 'prettier.config.js',
  ],
};

module.exports = PROBE;
