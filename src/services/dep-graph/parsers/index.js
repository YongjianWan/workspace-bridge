const { createImportRecord } = require('./shared');
const { parsePython } = require('./python');
const { parseJavaScript } = require('./js');
const { parseJava } = require('./java');
const { parseGo } = require('./go-ast');
const { parseRust } = require('./rust-ast');
const { parseKotlin } = require('./kotlin-ast');
const { parseVue } = require('./vue');
const { parseVueAst } = require('./vue-ast');
const { parseCppAst } = require('./cpp-ast');
const { parseSvelte } = require('./svelte');
const { parseMybatisXml, isMybatisMapperXmlPath } = require('./mybatis-xml');
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
  parseVueAst,
  parseCpp: parseCppAst,
  parseSvelte,
  parseMybatisXml,
  isMybatisMapperXmlPath,
  registry,
  defineLanguage,
  LanguageRegistry,
};
