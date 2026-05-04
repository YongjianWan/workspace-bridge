const { createImportRecord } = require('./shared');
const { parsePython } = require('./python');
const { parseJavaScript } = require('./js');
const { parseJava } = require('./java');
const { parseKotlin, parseGo, parseRust } = require('./polyglot');
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
