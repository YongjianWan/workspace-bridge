const { createImportRecord } = require('./shared');
const { parsePython } = require('./python');
const { parseJavaScript } = require('./js');
const { parseJava } = require('./java');
const { parseKotlin, parseGo, parseRust } = require('./polyglot');

module.exports = {
  createImportRecord,
  parsePython,
  parseJavaScript,
  parseJava,
  parseKotlin,
  parseGo,
  parseRust,
};
