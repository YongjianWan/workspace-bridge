const { uniqueNames, createExportRecord, createImportRecord } = require('./shared');

function parseCpp(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];
  const functionRecords = [];
  let match;

  const includeRe = /^\s*#include\s+["<]([^">]+)[">]/gm;
  while ((match = includeRe.exec(content)) !== null) {
    const source = match[1];
    imports.push(source);
    const rec = createImportRecord(source, { usesAllExports: true });
    rec.isLocal = match[0].includes('"');
    importRecords.push(rec);
  }

  // Limit line length to bound regex execution; the pattern below has
  // polynomial backtracking risk on very long lines due to nested quantifiers.
  const MAX_LINE_LEN = 512;
  const funcRe = /^\s*(?:[\w:*&<>]+\s+)+(\w+)\s*\([^)]*\)\s*\{/gm;
  while ((match = funcRe.exec(content)) !== null) {
    if (match[0].length > MAX_LINE_LEN) continue;
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
    functionRecords.push({ name: match[1], kind: 'function' });
  }

  const macroRe = /^\s*#define\s+(\w+)/gm;
  while ((match = macroRe.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'macro' }));
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    functionRecords,
    parseMode: 'regex',
  };
}

module.exports = { parseCpp };
