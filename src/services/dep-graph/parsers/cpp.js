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

  // Best-effort function detection for the regex fallback.
  // Group 1: optional "static" storage class.
  // Group 2: return-type prefix (may include namespace/class qualifiers).
  // Group 3: function name.
  // Limit line length to bound regex execution; the pattern has polynomial
  // backtracking risk on very long lines due to nested quantifiers.
  const MAX_LINE_LEN = 512;
  const funcRe = /^\s*(?:(static)\s+)?([\w:*&<>\s]+?)\s+(\w+)\s*\([^)]*\)\s*\{/gm;
  while ((match = funcRe.exec(content)) !== null) {
    if (match[0].length > MAX_LINE_LEN) continue;

    const isStatic = Boolean(match[1]);
    let returnType = match[2].trim();
    const name = match[3];

    // Strip trailing class/namespace scope from method definitions,
    // e.g. "void Foo::" → "void".
    if (returnType.endsWith('::')) {
      returnType = returnType.replace(/(?:\w+\s*::\s*)+$/, '').trim();
    }

    // Constructor detection: qualified name like "Foo::Foo" as the prefix.
    const isConstructor = new RegExp(`\\b${name}::${name}\\s*\\(`).test(match[0]);
    if (isConstructor) {
      returnType = null;
    }

    if (!returnType) returnType = null;

    exportRecords.push(createExportRecord(name, {
      kind: isConstructor ? 'constructor' : 'function',
      isExported: !isStatic,
    }));
    functionRecords.push({
      name,
      kind: isConstructor ? 'constructor' : 'function',
      isExported: !isStatic,
      returnType,
      decorators: [],
      hasParameterTypeHints: true,
      branchCount: 0,
      maxArms: 0,
    });
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
