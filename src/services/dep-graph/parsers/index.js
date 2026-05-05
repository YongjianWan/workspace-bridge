const { createImportRecord } = require('./shared');
const { parsePython } = require('./python');
const { parseJavaScript } = require('./js');
const { parseJava } = require('./java');
const { parseKotlin, parseGoRegex, parseRust } = require('./polyglot');
const { parseGo } = require('./go-ast');
const { parseVue } = require('./vue');
const { parseCpp } = require('./cpp');
const { parseSvelte } = require('./svelte');

module.exports = {
  createImportRecord,
  parsePython,
  parseJavaScript,
  parseJava,
  parseKotlin,
  parseGo,
  parseRust,
  parseVue,
  parseCpp,
  parseSvelte,
};
