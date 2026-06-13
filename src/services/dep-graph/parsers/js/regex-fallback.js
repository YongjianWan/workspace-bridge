const {
  DECL_KIND_MAP,
  createExportRecord,
  createImportRecord,
  normalizeImportedName,
  parseNamedBindings,
} = require('./shared');

function sanitizeForRegex(content) {
  let result = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < content.length - 1 && !(content[i] === '*' && content[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < content.length && content[i] !== '\n') {
        i++;
      }
      continue;
    }

    if (ch === '"') {
      const isImport = /\bfrom\s*$/i.test(result) ||
                       /\brequire\s*\(\s*$/i.test(result) ||
                       /\bimport\s*\(\s*$/i.test(result) ||
                       /\bimport\s*$/i.test(result);
      if (isImport) {
        result += '"';
        i++;
        while (i < content.length) {
          if (content[i] === '\\') {
            result += content.slice(i, i + 2);
            i = Math.min(i + 2, content.length);
          } else if (content[i] === '"') {
            result += '"';
            i++;
            break;
          } else {
            result += content[i];
            i++;
          }
        }
      } else {
        result += '""';
        i++;
        while (i < content.length) {
          if (content[i] === '\\') {
            i = Math.min(i + 2, content.length);
          } else if (content[i] === '"') {
            i++;
            break;
          } else {
            i++;
          }
        }
      }
      continue;
    }

    if (ch === "'") {
      const isImport = /\bfrom\s*$/i.test(result) ||
                       /\brequire\s*\(\s*$/i.test(result) ||
                       /\bimport\s*\(\s*$/i.test(result) ||
                       /\bimport\s*$/i.test(result);
      if (isImport) {
        result += "'";
        i++;
        while (i < content.length) {
          if (content[i] === '\\') {
            result += content.slice(i, i + 2);
            i = Math.min(i + 2, content.length);
          } else if (content[i] === "'") {
            result += "'";
            i++;
            break;
          } else {
            result += content[i];
            i++;
          }
        }
      } else {
        result += "''";
        i++;
        while (i < content.length) {
          if (content[i] === '\\') {
            i = Math.min(i + 2, content.length);
          } else if (content[i] === "'") {
            i++;
            break;
          } else {
            i++;
          }
        }
      }
      continue;
    }

    if (ch === '`') {
      const isImport = /\bfrom\s*$/i.test(result) ||
                       /\brequire\s*\(\s*$/i.test(result) ||
                       /\bimport\s*\(\s*$/i.test(result) ||
                       /\bimport\s*$/i.test(result);
      if (isImport) {
        result += '`';
        i++;
        while (i < content.length) {
          if (content[i] === '\\') {
            result += content.slice(i, i + 2);
            i = Math.min(i + 2, content.length);
          } else if (content[i] === '$' && content[i + 1] === '{') {
            result += '${';
            let depth = 1;
            i += 2;
            while (i < content.length && depth > 0) {
              if (content[i] === '{') {
                depth++;
                result += '{';
              } else if (content[i] === '}') {
                depth--;
                result += '}';
              } else {
                result += content[i];
              }
              i++;
            }
          } else if (content[i] === '`') {
            result += '`';
            i++;
            break;
          } else {
            result += content[i];
            i++;
          }
        }
      } else {
        result += '``';
        i++;
        while (i < content.length) {
          if (content[i] === '\\') {
            i = Math.min(i + 2, content.length);
          } else if (content[i] === '$' && content[i + 1] === '{') {
            let depth = 1;
            i += 2;
            while (i < content.length && depth > 0) {
              if (content[i] === '{') depth++;
              else if (content[i] === '}') depth--;
              i++;
            }
          } else if (content[i] === '`') {
            i++;
            break;
          } else {
            i++;
          }
        }
      }
      continue;
    }

    result += ch;
    i++;
  }
  return result;
}

function extractImportsWithRegex(sanitized) {
  const imports = [];
  const importRecords = [];

  const importFromRegex = /import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importFromRegex.exec(sanitized)) !== null) {
    const clause = match[1].trim();
    const source = match[2];
    imports.push(source);

    if (clause.startsWith('* as ')) {
      importRecords.push(createImportRecord(source, { usesAllExports: true }));
      continue;
    }

    const imported = [];
    let usesAllExports = false;
    const namedMatch = clause.match(/\{([^}]*)\}/);
    if (namedMatch) {
      imported.push(...parseNamedBindings(namedMatch[1]));
    }

    const withoutNamed = clause.replace(/\{[^}]*\}/, '').split(',').map((part) => part.trim()).filter(Boolean);
    for (const part of withoutNamed) {
      if (!part) continue;
      if (part.startsWith('* as ')) {
        usesAllExports = true;
      } else {
        imported.push('default');
      }
    }

    importRecords.push(createImportRecord(source, { imported, usesAllExports }));
  }

  const sideEffectImportRegex = /import\s+['"]([^'"]+)['"]/g;
  while ((match = sideEffectImportRegex.exec(sanitized)) !== null) {
    const source = match[1];
    imports.push(source);
    importRecords.push(createImportRecord(source, { usesAllExports: true }));
  }

  const destructuredRequireRegex = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = destructuredRequireRegex.exec(sanitized)) !== null) {
    const imported = parseNamedBindings(match[1]);
    const source = match[2];
    imports.push(source);
    importRecords.push(createImportRecord(source, { imported }));
  }

  const requireRegex = /(?:const|let|var)\s+[\w$]+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(sanitized)) !== null) {
    const source = match[1] || match[2];
    imports.push(source);
    importRecords.push(createImportRecord(source, { usesAllExports: true }));
  }

  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(sanitized)) !== null) {
    const source = match[1];
    imports.push(source);
    importRecords.push(createImportRecord(source, { usesAllExports: true }));
  }

  return { imports, importRecords };
}

function extractExportsWithRegex(sanitized) {
  const exportRecords = [];
  const reExportImportRecords = [];

  const namedReExportRegex = /export\s*\{([^}]*)\}\s*from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = namedReExportRegex.exec(sanitized)) !== null) {
    const source = match[2];
    const reExported = match[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const withoutType = part.replace(/^type\s+/, '').trim();
        const segments = withoutType.split(/\s+as\s+/i);
        return {
          imported: normalizeImportedName(segments[0]),
          exported: normalizeImportedName(segments[1] || segments[0]),
        };
      })
      .filter((pair) => pair.imported && pair.exported);
    for (const pair of reExported) {
      exportRecords.push(createExportRecord(pair.exported, { kind: 'symbol' }));
    }
    reExportImportRecords.push(createImportRecord(source, {
      imported: reExported.map((pair) => pair.imported),
      reExported,
      usesAllExports: reExported.length === 0,
    }));
  }

  const exportAllRegex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = exportAllRegex.exec(sanitized)) !== null) {
    exportRecords.push(createExportRecord('*', { unknown: true, kind: 'symbol' }));
    reExportImportRecords.push(createImportRecord(match[1], { usesAllExports: true, reExportAll: true }));
  }

  const namedExportRegex = /export\s*\{([^}]*)\}(?!\s*from)/g;
  while ((match = namedExportRegex.exec(sanitized)) !== null) {
    const exportedNames = match[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const withoutType = part.replace(/^type\s+/, '').trim();
        const segments = withoutType.split(/\s+as\s+/i);
        return normalizeImportedName(segments[1] || segments[0]);
      })
      .filter(Boolean);
    for (const name of exportedNames) {
      exportRecords.push(createExportRecord(name, { kind: 'symbol' }));
    }
  }

  const declarationExportRegex = /export\s+(?:async\s+)?(function|class|const|let|var)\s+(\w+)/g;
  while ((match = declarationExportRegex.exec(sanitized)) !== null) {
    const declType = match[1];
    const name = match[2];
    const kind = DECL_KIND_MAP[declType] || 'variable';
    exportRecords.push(createExportRecord(name, { kind }));
  }

  const destructuredExportRegex = /export\s+(const|let|var)\s*\{([\s\S]*?)\}/g;
  while ((match = destructuredExportRegex.exec(sanitized)) !== null) {
    const names = match[2]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const withoutType = part.replace(/^type\s+/, '').trim();
        const colonSegments = withoutType.split(':').map((s) => s.trim());
        const rawName = colonSegments[colonSegments.length - 1];
        return normalizeImportedName(rawName);
      })
      .filter(Boolean);
    for (const name of names) {
      exportRecords.push(createExportRecord(name, { kind: 'variable' }));
    }
  }

  const defaultNamedRegex = /export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/g;
  while ((match = defaultNamedRegex.exec(sanitized)) !== null) {
    exportRecords.push(createExportRecord('default', { kind: 'function-default' }));
    if (match[1]) {
      exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
    }
  }
  if (/export\s+default\s+(?!async\s+function\s+\w+|function\s+\w+|class\s+\w+)/.test(sanitized)) {
    exportRecords.push(createExportRecord('default', { kind: 'symbol' }));
  }

  const moduleExportsRegex = /module\.exports\s*=\s*\{([^}]*)}/g;
  while ((match = moduleExportsRegex.exec(sanitized)) !== null) {
    const inner = match[1];
    const propRegex = /([A-Za-z_$][\w$]*)\s*(?::|,|$)/g;
    let propMatch;
    while ((propMatch = propRegex.exec(inner)) !== null) {
      exportRecords.push(createExportRecord(propMatch[1], { kind: 'symbol' }));
    }
  }

  const exportsAssignRegex = /(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((match = exportsAssignRegex.exec(sanitized)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'symbol' }));
  }

  return { exportRecords, reExportImportRecords };
}

function extractFunctionRecordsWithRegex(sanitized) {
  const functionRecords = [];

  const lineOffsets = [];
  for (let i = 0; i < sanitized.length; i++) {
    if (sanitized[i] === '\n') {
      lineOffsets.push(i);
    }
  }

  function getLineNumber(index) {
    let low = 0;
    let high = lineOffsets.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lineOffsets[mid] < index) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return low + 1;
  }

  function extractReturnType(afterParams) {
    // Best-effort TS return-type annotation. afterParams starts inside '()',
    // so skip to the closing ')' then look for ': Type' before '{' or '=>'.
    const closeIdx = afterParams.indexOf(')');
    if (closeIdx < 0) return null;
    const rtMatch = afterParams.slice(closeIdx + 1).match(/^\s*:\s*([A-Za-z_$][\w$<>\[\]|\s&.,]*?)\s*(?=[{=>])/);
    return rtMatch ? rtMatch[1].trim() : null;
  }

  const functionDeclRegex = /((?:export\s+)?(?:async\s+)?function)\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = functionDeclRegex.exec(sanitized)) !== null) {
    const lineStart = getLineNumber(match.index);
    const isExported = /^export\b/.test(match[1]);
    const afterParams = sanitized.slice(match.index + match[0].length);
    const record = {
      name: match[2],
      kind: 'function',
      lineStart,
      lineEnd: lineStart,
      decorators: [],
      branchCount: 0,
      maxArms: 0,
    };
    if (isExported) record.isExported = true;
    const returnType = extractReturnType(afterParams);
    if (returnType) record.returnType = returnType;
    functionRecords.push(record);
  }

  const arrowFunctionRegex = /((?:export\s+)?(?:const|let|var))\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*([^{=>]+))?\s*=>/g;
  while ((match = arrowFunctionRegex.exec(sanitized)) !== null) {
    const lineStart = getLineNumber(match.index);
    const isExported = /\bexport\b/.test(match[1]);
    const record = {
      name: match[2],
      kind: 'function',
      lineStart,
      lineEnd: lineStart,
      decorators: [],
      branchCount: 0,
      maxArms: 0,
    };
    if (isExported) record.isExported = true;
    const returnType = match[3] ? match[3].trim() : null;
    if (returnType) record.returnType = returnType;
    functionRecords.push(record);
  }

  const functionExprRegex = /((?:export\s+)?(?:const|let|var))\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*(?:[A-Za-z_$][\w$]*)?\s*\(/g;
  while ((match = functionExprRegex.exec(sanitized)) !== null) {
    const lineStart = getLineNumber(match.index);
    const isExported = /\bexport\b/.test(match[1]);
    const afterParams = sanitized.slice(match.index + match[0].length);
    const record = {
      name: match[2],
      kind: 'function',
      lineStart,
      lineEnd: lineStart,
      decorators: [],
      branchCount: 0,
      maxArms: 0,
    };
    if (isExported) record.isExported = true;
    const returnType = extractReturnType(afterParams);
    if (returnType) record.returnType = returnType;
    functionRecords.push(record);
  }

  return functionRecords;
}

module.exports = {
  sanitizeForRegex,
  extractImportsWithRegex,
  extractExportsWithRegex,
  extractFunctionRecordsWithRegex,
};
