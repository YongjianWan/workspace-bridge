const {
  babelParser,
  getWarnedMissingParser,
  setWarnedMissingParser,
  VUE_COMPILER_MACROS,
  uniqueNames,
} = require('./js/shared');

const { parseJavaScriptAST } = require('./js/ast-parser');
const {
  sanitizeForRegex,
  extractImportsWithRegex,
  extractExportsWithRegex,
  extractFunctionRecordsWithRegex,
} = require('./js/regex-fallback');

function parseJavaScript(content, filePath = '') {
  if (babelParser) {
    const astResult = parseJavaScriptAST(content, filePath);
    if (astResult) {
      return astResult;
    }
  }

  if (!getWarnedMissingParser() && !babelParser) {
    setWarnedMissingParser(true);
    console.warn('[workspace-bridge] @babel/parser not available. JS/TS files will use regex parsing with reduced accuracy. Run npm install to enable full AST analysis.');
  }

  const sanitized = sanitizeForRegex(content);
  const { imports, importRecords } = extractImportsWithRegex(sanitized);
  let { exportRecords, reExportImportRecords } = extractExportsWithRegex(sanitized);
  const functionRecords = extractFunctionRecordsWithRegex(sanitized);

  const isVueFile = filePath.toLowerCase().endsWith('.vue') || /<!\s*script\s+setup\b/i.test(content);
  if (isVueFile) {
    exportRecords = exportRecords.filter((r) => !VUE_COMPILER_MACROS.has(r.name));
  }

  for (const record of reExportImportRecords) {
    importRecords.push(record);
    if (!imports.includes(record.source)) {
      imports.push(record.source);
    }
  }

  const exports = uniqueNames(exportRecords.filter((record) => !record.unknown).map((record) => record.name));
  return {
    imports: uniqueNames(imports),
    exports,
    importRecords,
    exportRecords,
    functionRecords,
    parseMode: 'regex',
  };
}

module.exports = { parseJavaScript, parseJavaScriptAST };
