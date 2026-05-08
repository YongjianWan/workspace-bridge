/**
 * Language registry — single source of truth for all 9 supported languages.
 *
 * Adding a new language now requires changing exactly this file:
 *   1. import the parser function
 *   2. add one registry.register(defineLanguage({ ... })) call
 *
 * Design reference: GitNexus language registration pattern (AGENTS.md §Reference).
 */

const { defineLanguage, LanguageRegistry } = require('./registry-core');
const { parsePython } = require('./python');
const { parseJavaScript } = require('./js');
const { parseJava } = require('./java');
const { parseGo } = require('./go-ast');
const { parseRust } = require('./rust-ast');
const { parseKotlin } = require('./kotlin-ast');
const { parseVue } = require('./vue');
const { parseCppAst } = require('./cpp-ast');
const { parseSvelte } = require('./svelte');

const registry = new LanguageRegistry();

registry.register(defineLanguage({
  name: 'javascript',
  exts: ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.mts', '.cts'],
  parser: parseJavaScript,
  async: false,
  needsFilePath: true,
  filePatterns: ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx', '**/*.mjs', '**/*.cjs', '**/*.mts', '**/*.cts'],
  condition: (workspace) => workspace.hasPackageJson,
}));

registry.register(defineLanguage({
  name: 'python',
  exts: ['.py'],
  parser: parsePython,
  async: true,
  filePatterns: ['**/*.py'],
  condition: (workspace) => workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy,
}));

registry.register(defineLanguage({
  name: 'java',
  exts: ['.java'],
  parser: parseJava,
  async: true,
  filePatterns: ['**/*.java'],
  condition: (workspace) => workspace.hasJava,
}));

registry.register(defineLanguage({
  name: 'kotlin',
  exts: ['.kt'],
  parser: parseKotlin,
  async: true,
  filePatterns: ['**/*.kt'],
  condition: (workspace) => workspace.hasJava,
}));

registry.register(defineLanguage({
  name: 'go',
  exts: ['.go'],
  parser: parseGo,
  async: true,
  filePatterns: ['**/*.go'],
  condition: (workspace) => workspace.hasGo,
}));

registry.register(defineLanguage({
  name: 'rust',
  exts: ['.rs'],
  parser: parseRust,
  async: true,
  filePatterns: ['**/*.rs'],
  condition: (workspace) => workspace.hasRust,
}));

registry.register(defineLanguage({
  name: 'vue',
  exts: ['.vue'],
  parser: parseVue,
  async: false,
  needsFilePath: true,
  filePatterns: ['**/*.vue'],
  condition: (workspace) => workspace.hasPackageJson,
}));

registry.register(defineLanguage({
  name: 'cpp',
  exts: ['.c', '.cpp', '.cc', '.h', '.hpp'],
  parser: parseCppAst,
  async: true,
  needsFilePath: true,
  filePatterns: ['**/*.c', '**/*.cpp', '**/*.cc', '**/*.h', '**/*.hpp'],
  condition: (workspace) => workspace.hasCpp,
}));

registry.register(defineLanguage({
  name: 'svelte',
  exts: ['.svelte'],
  parser: parseSvelte,
  async: false,
  needsFilePath: true,
  filePatterns: ['**/*.svelte'],
  condition: (workspace) => workspace.hasPackageJson,
}));

module.exports = { registry, defineLanguage, LanguageRegistry };
