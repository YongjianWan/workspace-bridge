const { uniqueNames, createImportRecord } = require('./shared');
const { spawnPythonASTParser } = require('./spawn-ast');

async function parsePythonAST(content) {
  return spawnPythonASTParser('python_ast_parser.py', content);
}

function getLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

function parsePythonWithRegex(content) {
  const imports = [];
  const importRecords = [];
  const exports = [];
  const exportRecords = [];
  const functionRecords = [];

  const importSource = content
    .replace(/\\\n/g, '') // backslash continuation
    .replace(/from\s+(\S+)\s+import\s*\([^)]*\)/gs, (m) => m.replace(/\n/g, ' '));

  const importRegex = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
  let match;
  while ((match = importRegex.exec(importSource)) !== null) {
    const module = match[1] || match[2];
    if (module) {
      imports.push(module);
      importRecords.push(createImportRecord(module, { usesAllExports: true }));
    }
  }

  const classRegex = /^class\s+(\w+)/gm;
  const funcRegex = /^(?:async\s+)?def\s+(\w+)/gm;

  while ((match = classRegex.exec(content)) !== null) {
    if (!match[1].startsWith('_')) {
      exports.push(match[1]);
      exportRecords.push({
        name: match[1],
        kind: 'class',
        lineStart: getLineNumber(content, match.index),
      });
    }
  }
  while ((match = funcRegex.exec(content)) !== null) {
    if (!match[1].startsWith('_')) {
      exports.push(match[1]);
      exportRecords.push({
        name: match[1],
        kind: 'function',
        lineStart: getLineNumber(content, match.index),
      });
      functionRecords.push({
        name: match[1],
        kind: 'function',
        lineStart: getLineNumber(content, match.index),
        isExported: true,
        returnType: null,
        decorators: [],
        branchCount: 0,
        maxArms: 0,
      });
    }
  }

  return { imports, exports, importRecords, exportRecords, functionRecords, parseMode: 'regex' };
}

async function parsePython(content) {
  const astResult = await parsePythonAST(content);
  if (astResult) {
    return {
      imports: uniqueNames(astResult.imports),
      exports: uniqueNames(astResult.exports),
      importRecords: astResult.importRecords.map((record) =>
        createImportRecord(record.source, {
          imported: record.imported,
          usesAllExports: record.usesAllExports,
        })
      ),
      exportRecords: astResult.exportRecords || [],
      functionRecords: (astResult.functionRecords || []).map((record) => ({
        name: record.name,
        kind: record.kind || 'function',
        lineStart: record.lineStart,
        lineEnd: record.lineEnd,
        fingerprint: record.fingerprint || null,
        isExported: record.isExported !== undefined ? record.isExported : true,
        returnType: record.returnType || null,
        decorators: record.decorators || [],
        hasParameterTypeHints: record.hasParameterTypeHints === true,
        branchCount: record.branchCount !== undefined ? record.branchCount : 0,
        maxArms: record.maxArms !== undefined ? record.maxArms : 0,
      })),
      parseMode: 'ast',
    };
  }

  return parsePythonWithRegex(content);
}

module.exports = { parsePython };
