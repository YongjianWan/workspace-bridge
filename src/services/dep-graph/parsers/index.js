const { createImportRecord } = require('./shared');
const { parsePython } = require('./python');
const { parseJavaScript } = require('./js');
const { parseJava } = require('./java');
const { parseGoRegex } = require('./polyglot');
const { parseGo } = require('./go-ast');
const { parseRust } = require('./rust-ast');
const { parseKotlin } = require('./kotlin-ast');
const { parseVue } = require('./vue');
const { parseCppAst } = require('./cpp-ast');
const { parseSvelte } = require('./svelte');
const { registry, defineLanguage, LanguageRegistry } = require('./registry');

module.exports = {
  createImportRecord,
  parsePython,
  parseJavaScript,
  parseJava,
  parseKotlin,
  parseGo,
  parseRust,
  parseVue,
  parseCpp: parseCppAst,
  parseSvelte,
  registry,
  defineLanguage,
  LanguageRegistry,
};
