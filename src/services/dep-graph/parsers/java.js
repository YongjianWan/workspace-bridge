const { uniqueNames, createExportRecord, createImportRecord } = require('./shared');
const { spawnPythonASTParser } = require('./spawn-ast');

async function parseJavaAST(content) {
  return spawnPythonASTParser('java_ast_parser.py', content);
}

function getLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

function parseJavaWithRegex(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];
  const functionRecords = [];

  const packageRegex = /^\s*package\s+([a-zA-Z_][\w.]*)\s*;/m;
  const packageMatch = packageRegex.exec(content);
  const packageName = packageMatch ? packageMatch[1] : null;

  const importRegex = /^\s*import\s+(static\s+)?([a-zA-Z_][\w.]*(?:\.\*)?)\s*;/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const source = match[2];
    const isWildcard = source.endsWith('.*');
    const imported = isWildcard ? [] : [source.split('.').pop()];
    imports.push(source);
    importRecords.push(createImportRecord(source, { imported, usesAllExports: isWildcard }));
  }

  const exportRegex = /\bpublic\s+(?:abstract\s+|final\s+)?(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/g;
  while ((match = exportRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'class' }));
  }

  // Limit line length to bound regex execution; the pattern below has
  // polynomial backtracking risk on very long lines due to nested quantifiers.
  const MAX_LINE_LEN = 512;
  const methodRegex = /\bpublic\s+(?:[\w<>\[]]+\s+)+(\w+)\s*\(/g;
  while ((match = methodRegex.exec(content)) !== null) {
    if (match[0].length > MAX_LINE_LEN) continue;
    functionRecords.push({
      name: match[1],
      kind: 'function',
      lineStart: getLineNumber(content, match.index),
      lineEnd: getLineNumber(content, match.index),
    });
  }

  const exports = uniqueNames(exportRecords.map((record) => record.name));
  return {
    imports: uniqueNames(imports),
    exports,
    importRecords,
    exportRecords,
    functionRecords,
    package: packageName,
    parseMode: 'regex',
  };
}

async function parseJava(content) {
  const astResult = await parseJavaAST(content);
  if (astResult) {
    return {
      imports: uniqueNames(astResult.imports),
      exports: uniqueNames(astResult.exports),
      importRecords: (astResult.importRecords || []).map((record) =>
        createImportRecord(record.source, {
          imported: record.imported,
          usesAllExports: record.usesAllExports,
          isStatic: record.isStatic,
        })
      ),
      exportRecords: uniqueNames(astResult.exports).map((name) =>
        createExportRecord(name, { kind: 'symbol' })
      ),
      functionRecords: (astResult.functionRecords || []).map((record) => ({
        name: record.name,
        kind: record.kind || 'function',
        lineStart: record.lineStart,
        lineEnd: record.lineEnd,
      })),
      package: astResult.package || null,
      parseMode: 'ast',
    };
  }
  const regexResult = parseJavaWithRegex(content);
  return { ...regexResult, parseMode: 'regex' };
}

module.exports = { parseJava };
