const path = require('path');
const {
  uniqueNames,
  exportKindFromDeclarationType,
  createExportRecord,
  isFunctionLikeNode,
  getCallName,
  buildFunctionFingerprint,
  normalizeImportedName,
  parseNamedBindings,
  createImportRecord,
} = require('./shared');

let babelParser = null;
try {
  babelParser = require('@babel/parser');
} catch {
  // babel parser not available, fallback to regex
}

let warnedMissingParser = false;

function stripBlockComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, '');
}

function stripLineComment(line) {
  return line.replace(/\/\/.*$/, '');
}

function stripQuotedStrings(line, quoteChar, replacement) {
  const pattern = quoteChar === '"'
    ? /"(?:[^"\\]|\\.)*"/g
    : quoteChar === "'"
    ? /'(?:[^'\\]|\\.)*'/g
    : /`(?:[^`\\]|\\.)*`/g;
  return line.replace(pattern, replacement);
}

function sanitizeForRegex(content) {
  const withoutBlockComments = stripBlockComments(content);
  return withoutBlockComments
    .split('\n')
    .map((line) => {
      let sanitized = stripLineComment(line);
      sanitized = stripQuotedStrings(sanitized, '"', '""');
      sanitized = stripQuotedStrings(sanitized, "'", "''");
      sanitized = stripQuotedStrings(sanitized, '`', '``');
      return sanitized;
    })
    .join('\n');
}

function parseJavaScriptAST(content, filePath = '') {
  if (!babelParser) {
    return null;
  }

  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  try {
    const ext = path.extname(filePath).toLowerCase();
    const isTS = ['.ts', '.tsx', '.mts', '.cts'].includes(ext);

    const ast = babelParser.parse(content, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      plugins: [
        'jsx',
        'dynamicImport',
        'exportDefaultFrom',
        'exportNamespaceFrom',
        'importMeta',
        ...(isTS ? ['typescript'] : []),
      ],
    });

    function visitNode(node) {
      if (!node || typeof node !== 'object') return;

      if (node.type === 'ImportDeclaration' && node.source?.value) {
        if (node.importKind === 'type') {
          return;
        }
        const source = node.source.value;
        imports.push(source);

        const imported = [];
        let usesAllExports = false;

        for (const spec of node.specifiers || []) {
          if (spec.type === 'ImportNamespaceSpecifier') {
            usesAllExports = true;
          } else if (spec.type === 'ImportDefaultSpecifier') {
            imported.push('default');
          } else if (spec.type === 'ImportSpecifier') {
            if (spec.importKind === 'type') {
              continue;
            }
            const name = spec.imported?.name || spec.imported?.value;
            if (name && name !== 'type') {
              imported.push(name);
            }
          }
        }

        importRecords.push(createImportRecord(source, { imported, usesAllExports }));
      }

      if (node.type === 'ExportAllDeclaration' && node.source?.value) {
        if (node.exportKind === 'type') {
          return;
        }
        exportRecords.push(createExportRecord('*', {
          unknown: true,
          kind: 'symbol',
          lineStart: node.loc?.start?.line,
          lineEnd: node.loc?.end?.line,
        }));
        imports.push(node.source.value);
        importRecords.push(createImportRecord(node.source.value, { usesAllExports: true, reExportAll: true }));
      }

      if (node.type === 'ExportNamedDeclaration') {
        if (node.exportKind === 'type') {
          return;
        }
        if (node.source?.value) {
          imports.push(node.source.value);
          const imported = [];
          const reExported = [];
          for (const spec of node.specifiers || []) {
            if (spec.type === 'ExportSpecifier') {
              if (spec.exportKind === 'type') continue;
              const importedName = spec.local?.name || spec.local?.value;
              const exportedName = spec.exported?.name || spec.exported?.value || importedName;
              const normalizedImported = normalizeImportedName(importedName);
              const normalizedExported = normalizeImportedName(exportedName);
              if (!normalizedImported || !normalizedExported) continue;
              imported.push(normalizedImported);
              reExported.push({ imported: normalizedImported, exported: normalizedExported });
            }
          }
          for (const { exported: name } of reExported) {
            exportRecords.push(createExportRecord(name, {
              kind: 'symbol',
              lineStart: node.loc?.start?.line,
              lineEnd: node.loc?.end?.line,
            }));
          }
          importRecords.push(createImportRecord(node.source.value, {
            imported,
            reExported,
            usesAllExports: imported.length === 0,
          }));
        } else {
          for (const spec of node.specifiers || []) {
            if (spec.type === 'ExportSpecifier') {
              if (spec.exportKind === 'type') continue;
              const name = spec.exported?.name || spec.exported?.value || spec.local?.name || spec.local?.value;
              if (name) {
                exportRecords.push(createExportRecord(name, {
                  kind: 'symbol',
                  lineStart: spec.loc?.start?.line || node.loc?.start?.line,
                  lineEnd: spec.loc?.end?.line || node.loc?.end?.line,
                }));
              }
            }
          }
        }

        if (node.declaration) {
          const decl = node.declaration;
          const kind = exportKindFromDeclarationType(decl.type);
          if (decl.id?.name) {
            const fingerprint = kind === 'function' ? buildFunctionFingerprint(decl) : null;
            exportRecords.push(createExportRecord(decl.id.name, {
              kind,
              lineStart: decl.loc?.start?.line || node.loc?.start?.line,
              lineEnd: decl.loc?.end?.line || node.loc?.end?.line,
              fingerprint,
            }));
          }
          if (decl.declarations) {
            for (const d of decl.declarations) {
              if (d.id?.name) {
                const variableKind = isFunctionLikeNode(d.init) ? 'function' : kind;
                const fingerprint = variableKind === 'function' ? buildFunctionFingerprint(d.init) : null;
                exportRecords.push(createExportRecord(d.id.name, {
                  kind: variableKind,
                  lineStart: d.loc?.start?.line || decl.loc?.start?.line || node.loc?.start?.line,
                  lineEnd: d.loc?.end?.line || decl.loc?.end?.line || node.loc?.end?.line,
                  fingerprint,
                }));
              }
            }
          }
        }
      }

      if (node.type === 'ExportDefaultDeclaration') {
        const declarationType = node.declaration?.type;
        const baseKind = exportKindFromDeclarationType(declarationType);
        const kind = baseKind === 'symbol' ? 'symbol' : `${baseKind}-default`;
        const fingerprint = String(kind).startsWith('function')
          ? buildFunctionFingerprint(node.declaration)
          : null;
        exportRecords.push(createExportRecord('default', {
          kind,
          lineStart: node.loc?.start?.line,
          lineEnd: node.loc?.end?.line,
          fingerprint,
        }));
      }

      if (node.type === 'ImportExpression' && node.source?.value) {
        imports.push(node.source.value);
        importRecords.push(createImportRecord(node.source.value, { usesAllExports: true }));
      }

      if (node.type === 'CallExpression' &&
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments?.[0]?.value) {
        const source = node.arguments[0].value;
        imports.push(source);
        importRecords.push(createImportRecord(source, { usesAllExports: true }));
      }

      // CJS: module.exports = { fn1, fn2 } or exports.fn = fn
      if (node.type === 'AssignmentExpression') {
        const left = node.left;
        if (left?.type === 'MemberExpression') {
          const objectName = left.object?.type === 'Identifier' ? left.object.name : null;
          const propertyName = left.property?.type === 'Identifier'
            ? left.property.name
            : left.property?.type === 'StringLiteral'
              ? left.property.value
              : null;

          // module.exports = { ... }
          if (objectName === 'module' && propertyName === 'exports' && node.right?.type === 'ObjectExpression') {
            for (const prop of node.right.properties || []) {
              if (prop.type === 'ObjectProperty' || prop.type === 'Property') {
                const name = prop.key?.type === 'Identifier' ? prop.key.name
                  : prop.key?.type === 'StringLiteral' ? prop.key.value
                  : null;
                if (name) {
                  const valueKind = isFunctionLikeNode(prop.value) ? 'function' : 'symbol';
                  const fingerprint = valueKind === 'function' ? buildFunctionFingerprint(prop.value) : null;
                  exportRecords.push(createExportRecord(name, {
                    kind: valueKind,
                    lineStart: prop.loc?.start?.line || node.loc?.start?.line,
                    lineEnd: prop.loc?.end?.line || node.loc?.end?.line,
                    fingerprint,
                  }));
                }
              } else if (prop.type === 'ObjectMethod') {
                const name = prop.key?.type === 'Identifier' ? prop.key.name
                  : prop.key?.type === 'StringLiteral' ? prop.key.value
                  : null;
                if (name) {
                  const fingerprint = buildFunctionFingerprint(prop);
                  exportRecords.push(createExportRecord(name, {
                    kind: 'function',
                    lineStart: prop.loc?.start?.line || node.loc?.start?.line,
                    lineEnd: prop.loc?.end?.line || node.loc?.end?.line,
                    fingerprint,
                  }));
                }
              }
            }
          }

          // exports.foo = ...
          if (objectName === 'exports' && propertyName && propertyName !== 'exports') {
            const valueKind = isFunctionLikeNode(node.right) ? 'function' : 'symbol';
            const fingerprint = valueKind === 'function' ? buildFunctionFingerprint(node.right) : null;
            exportRecords.push(createExportRecord(propertyName, {
              kind: valueKind,
              lineStart: node.loc?.start?.line,
              lineEnd: node.loc?.end?.line,
              fingerprint,
            }));
          }
        }
      }

      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          for (const c of child) visitNode(c);
        } else if (child && typeof child === 'object') {
          visitNode(child);
        }
      }
    }

    visitNode(ast);

    const exports = uniqueNames(exportRecords.filter((r) => !r.unknown).map((r) => r.name));

    // Collect all top-level function definitions (including internal) for call-chain tracing
    const functionRecords = [];
    function visitFunctionNode(node, parent) {
      if (!node || typeof node !== 'object') return;
      if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') && node.id?.name) {
        const fingerprint = buildFunctionFingerprint(node);
        functionRecords.push(createExportRecord(node.id.name, {
          kind: 'function',
          lineStart: node.loc?.start?.line,
          lineEnd: node.loc?.end?.line,
          fingerprint,
        }));
      } else if (node.type === 'ArrowFunctionExpression') {
        let name = null;
        if (parent?.type === 'VariableDeclarator' && parent.id?.name) {
          name = parent.id.name;
        }
        if (name) {
          const fingerprint = buildFunctionFingerprint(node);
          functionRecords.push(createExportRecord(name, {
            kind: 'function',
            lineStart: node.loc?.start?.line,
            lineEnd: node.loc?.end?.line,
            fingerprint,
          }));
        }
      }
      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          for (const c of child) visitFunctionNode(c, node);
        } else if (child && typeof child === 'object') {
          visitFunctionNode(child, node);
        }
      }
    }
    visitFunctionNode(ast);

    return {
      imports: uniqueNames(imports),
      exports,
      importRecords,
      exportRecords,
      functionRecords,
      parseMode: 'ast',
    };
  } catch (e) {
    if (process.env.DEBUG) {
      console.error(`[DepGraph] AST parse failed for ${filePath}:`, e.message);
    }
    // Include file path in error so callers can diagnose why AST mode was unavailable.
    return null;
  }
}

function parseJavaScript(content, filePath = '') {
  if (babelParser) {
    const astResult = parseJavaScriptAST(content, filePath);
    if (astResult) {
      return astResult;
    }
  }

  if (!warnedMissingParser && !babelParser) {
    warnedMissingParser = true;
    console.warn('[workspace-bridge] @babel/parser not available. JS/TS files will use regex parsing with reduced accuracy. Run npm install to enable full AST analysis.');
  }

  const sanitized = sanitizeForRegex(content);
  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  const importFromRegex = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
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

  const namedReExportRegex = /export\s*\{([^}]*)\}\s*from\s+['"]([^'"]+)['"]/g;
  while ((match = namedReExportRegex.exec(sanitized)) !== null) {
    const source = match[2];
    imports.push(source);
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
    importRecords.push(createImportRecord(source, {
      imported: reExported.map((pair) => pair.imported),
      reExported,
      usesAllExports: reExported.length === 0,
    }));
  }

  const exportAllRegex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = exportAllRegex.exec(sanitized)) !== null) {
    imports.push(match[1]);
    exportRecords.push(createExportRecord('*', { unknown: true, kind: 'symbol' }));
    importRecords.push(createImportRecord(match[1], { usesAllExports: true, reExportAll: true }));
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
    const kind = declType === 'function'
      ? 'function'
      : declType === 'class'
        ? 'class'
        : 'variable';
    exportRecords.push(createExportRecord(name, { kind }));
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

  const exports = uniqueNames(exportRecords.filter((record) => !record.unknown).map((record) => record.name));
  return {
    imports: uniqueNames(imports),
    exports,
    importRecords,
    exportRecords,
    functionRecords: [],
    parseMode: 'regex',
  };
}

module.exports = { parseJavaScript, parseJavaScriptAST };
