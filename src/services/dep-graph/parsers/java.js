const { uniqueNames, createExportRecord, createImportRecord } = require('./shared');
const { spawnPythonASTParser } = require('./spawn-ast');

async function parseJavaAST(content) {
  return spawnPythonASTParser('java_ast_parser.py', content);
}

function getLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

function findMatchingBrace(content, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractJavaDecorators(annotationBlock) {
  if (!annotationBlock) return [];
  const decorators = [];
  const annotationRegex = /^\s*@([A-Za-z_][\w.]*)/gm;
  let match;
  while ((match = annotationRegex.exec(annotationBlock)) !== null) {
    decorators.push(match[1].split('.').pop());
  }
  return decorators;
}

function countMatches(content, regex) {
  let count = 0;
  regex.lastIndex = 0;
  while (regex.exec(content) !== null) count++;
  return count;
}

function computeJavaRegexFingerprint(signature, body) {
  const paramText = signature.slice(signature.indexOf('(') + 1, signature.lastIndexOf(')')).trim();
  const paramCount = paramText ? paramText.split(',').filter(Boolean).length : 0;
  const elseIfCount = countMatches(body, /\belse\s+if\s*\(/g);
  const ifCount = countMatches(body, /\bif\s*\(/g);
  const switchArmCounts = [...body.matchAll(/\bcase\b|\bdefault\s*:/g)].length;
  const returnCount = countMatches(body, /\breturn\b/g);
  const loopCount = countMatches(body, /\b(?:for|while)\s*\(/g) + countMatches(body, /\bdo\s*\{/g);
  const catchCount = countMatches(body, /\bcatch\s*\(/g);
  const ternaryCount = countMatches(body, /\?/g);
  const logicalCount = countMatches(body, /&&|\|\|/g);
  const hasFinalElse = /\belse\s*\{/.test(body.replace(/\belse\s+if\s*\([^)]*\)\s*\{/g, ''));
  const maxIfElseArms = ifCount > 0 ? Math.max(1, elseIfCount + 1 + (hasFinalElse ? 1 : 0)) : 0;

  return {
    paramCount,
    isAsync: false,
    isGenerator: false,
    hasTryCatch: catchCount > 0 || /\btry\s*\{/.test(body),
    branchCount: ifCount + switchArmCounts + loopCount + catchCount + ternaryCount + logicalCount,
    returnCount,
    maxArms: Math.max(maxIfElseArms, switchArmCounts),
    callCallees: [],
  };
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

  const exportRegex = /\bpublic\s+(?:abstract\s+|final\s+)?(class|interface|enum|record|@interface)\s+([A-Za-z_]\w*)/g;
  while ((match = exportRegex.exec(content)) !== null) {
    let kind = 'class';
    if (match[1] === 'interface') kind = 'interface';
    else if (match[1] === '@interface') kind = 'annotation';
    else if (match[1] === 'enum') kind = 'enum';
    exportRecords.push(createExportRecord(match[2], { kind }));
  }

  // Limit line length to bound regex execution; the pattern below has
  // polynomial backtracking risk on very long lines due to nested quantifiers.
  const MAX_LINE_LEN = 512;
  const methodRegex = /((?:^\s*@[\w.]+(?:\([^)]*\))?\s*\r?\n)*)^\s*public\s+(?:[\w<>\[\],.?]+\s+)+(\w+)\s*\([^)]*\)\s*(?:throws\s+[^{;]+)?\{/gm;
  while ((match = methodRegex.exec(content)) !== null) {
    if (match[0].length > MAX_LINE_LEN) continue;
    const openBrace = content.indexOf('{', match.index + match[0].length - 1);
    const closeBrace = openBrace === -1 ? -1 : findMatchingBrace(content, openBrace);
    const body = closeBrace === -1 ? '' : content.slice(openBrace + 1, closeBrace);
    const fingerprint = computeJavaRegexFingerprint(match[0], body);
    functionRecords.push({
      name: match[2],
      kind: 'function',
      lineStart: getLineNumber(content, match.index),
      lineEnd: getLineNumber(content, match.index),
      decorators: extractJavaDecorators(match[1]),
      fingerprint,
      branchCount: fingerprint.branchCount,
      maxArms: fingerprint.maxArms,
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
      exportRecords: (astResult.exportRecords || []).map((record) =>
        createExportRecord(record.name, { kind: record.kind || 'symbol' })
      ),
      functionRecords: (astResult.functionRecords || []).map((record) => ({
        name: record.name,
        kind: record.kind || 'function',
        lineStart: record.lineStart,
        lineEnd: record.lineEnd,
        fingerprint: record.fingerprint || null,
        decorators: record.decorators || [],
        branchCount: record.branchCount ?? record.fingerprint?.branchCount ?? 0,
        maxArms: record.maxArms ?? record.fingerprint?.maxArms ?? 0,
      })),
      package: astResult.package || null,
      parseMode: 'ast',
    };
  }
  const regexResult = parseJavaWithRegex(content);
  return { ...regexResult, parseMode: 'regex' };
}

module.exports = { parseJava };
