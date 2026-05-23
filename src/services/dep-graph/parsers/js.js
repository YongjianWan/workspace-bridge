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

// #29: declaration-kind map replaces nested ternary
const DECL_KIND_MAP = {
  function: 'function',
  class: 'class',
  const: 'variable',
  let: 'variable',
  var: 'variable',
};

// #31: AST walker skip keys extracted from hardcoded string list
const AST_SKIP_KEYS = new Set(['type', 'loc', 'start', 'end']);

// Vue <script setup> compiler macros — injected by the Vue compiler at build time.
// Explicit re-exports of these names in .vue files are false positives because
// consuming components use the compiler-injected globals, not imports.
const VUE_COMPILER_MACROS = new Set([
  'defineProps',
  'defineEmits',
  'defineExpose',
  'defineOptions',
  'defineSlots',
  'defineModel',
]);

/**
 * Global state-machine sanitizer that removes comments and string literals
 * without splitting by newlines. This prevents multi-line template literals
 * from being chopped in half, which previously exposed their inner content
 * to import/export regexes and caused false-positive dependencies.
 */
function sanitizeForRegex(content) {
  let result = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    // Block comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < content.length - 1 && !(content[i] === '*' && content[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }

    // Line comment
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < content.length && content[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Double-quoted string
    if (ch === '"') {
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
      continue;
    }

    // Single-quoted string
    if (ch === "'") {
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
      continue;
    }

    // Template literal (may span multiple lines)
    if (ch === '`') {
      result += '``';
      i++;
      while (i < content.length) {
        if (content[i] === '\\') {
          i = Math.min(i + 2, content.length);
        } else if (content[i] === '$' && content[i + 1] === '{') {
          // Skip ${...} interpolations, tracking brace depth for nested braces
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
      continue;
    }

    result += ch;
    i++;
  }
  return result;
}

// #12: generic AST walker extracted from two ~100% duplicate inline loops
function walkAST(node, callback, parent = null) {
  if (!node || typeof node !== 'object') return;
  callback(node, parent);
  for (const key of Object.keys(node)) {
    if (AST_SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) walkAST(c, callback, node);
    } else if (child && typeof child === 'object') {
      walkAST(child, callback, node);
    }
  }
}

// #13: property-name extraction duplicated in two CJS branches
function getPropertyName(prop) {
  if (prop.key?.type === 'Identifier') return prop.key.name;
  if (prop.key?.type === 'StringLiteral') return prop.key.value;
  return null;
}

// #14: export-record creation from a value node (CJS module.exports / exports.foo)
function buildExportRecordFromValue(name, valueNode, fallbackLines) {
  const kind = isFunctionLikeNode(valueNode) ? 'function' : 'symbol';
  const fingerprint = kind === 'function' ? buildFunctionFingerprint(valueNode) : null;
  return createExportRecord(name, {
    kind,
    lineStart: valueNode.loc?.start?.line || fallbackLines.lineStart,
    lineEnd: valueNode.loc?.end?.line || fallbackLines.lineEnd,
    fingerprint,
  });
}

// #15: function-record push duplicated for FunctionDeclaration/Expression vs ArrowFunctionExpression
function pushFunctionRecord(records, name, node) {
  const fingerprint = buildFunctionFingerprint(node);
  records.push(createExportRecord(name, {
    kind: 'function',
    lineStart: node.loc?.start?.line,
    lineEnd: node.loc?.end?.line,
    fingerprint,
  }));
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

    // #11: visitors mapping table replaces 220-line visitNode monolith
    const isVueFile = filePath.toLowerCase().endsWith('.vue') || /<\s*script\s+setup\b/i.test(content);

    const importExportVisitors = {
      ImportDeclaration(node) {
        if (!node.source?.value) return;
        if (node.importKind === 'type') return;
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
            if (spec.importKind === 'type') continue;
            const name = spec.imported?.name || spec.imported?.value;
            if (name && name !== 'type') {
              imported.push(name);
            }
          }
        }

        importRecords.push(createImportRecord(source, { imported, usesAllExports }));
      },

      ExportAllDeclaration(node) {
        if (!node.source?.value) return;
        if (node.exportKind === 'type') return;
        exportRecords.push(createExportRecord('*', {
          unknown: true,
          kind: 'symbol',
          lineStart: node.loc?.start?.line,
          lineEnd: node.loc?.end?.line,
        }));
        imports.push(node.source.value);
        importRecords.push(createImportRecord(node.source.value, { usesAllExports: true, reExportAll: true }));
      },

      ExportNamedDeclaration(node) {
        if (node.exportKind === 'type') return;
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
              if (isVueFile && VUE_COMPILER_MACROS.has(name)) continue;
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
          if (decl.id?.name && !(isVueFile && VUE_COMPILER_MACROS.has(decl.id.name))) {
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
              if (d.id?.name && !(isVueFile && VUE_COMPILER_MACROS.has(d.id.name))) {
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
      },

      ExportDefaultDeclaration(node) {
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
      },

      CallExpression(node, parent) {
        // require('./foo')
        if (
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments?.[0]?.value
        ) {
          const source = node.arguments[0].value;
          imports.push(source);
          let imported = [];
          let usesAllExports = true;
          // Destructured require: const { foo, bar } = require('./foo')
          if (
            parent?.type === 'VariableDeclarator' &&
            parent.id?.type === 'ObjectPattern' &&
            parent.id.properties
          ) {
            usesAllExports = false;
            for (const prop of parent.id.properties) {
              if (prop.type === 'ObjectProperty' && prop.key) {
                const name = prop.key.name || prop.key.value;
                if (name) imported.push(name);
              } else if (prop.type === 'RestElement' && prop.argument?.name) {
                imported.push(prop.argument.name);
                usesAllExports = true;
              }
            }
          }
          importRecords.push(createImportRecord(source, { imported, usesAllExports }));
          return;
        }
        // import('./foo') — Babel parses this as CallExpression with callee.type === 'Import'
        if (
          node.callee?.type === 'Import' &&
          node.arguments?.[0]?.value
        ) {
          const source = node.arguments[0].value;
          imports.push(source);
          importRecords.push(createImportRecord(source, { usesAllExports: true }));
        }
      },

      NewExpression(node) {
        // new URL('./worker.js', import.meta.url) — worker threads / asset resolution
        if (
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'URL' &&
          node.arguments?.[0]?.type === 'StringLiteral' &&
          /\.(js|ts|mjs|cjs)$/i.test(node.arguments[0].value) &&
          node.arguments?.[1]?.type === 'MemberExpression' &&
          node.arguments[1].object?.type === 'MetaProperty' &&
          node.arguments[1].object.meta?.name === 'import' &&
          node.arguments[1].object.property?.name === 'meta' &&
          node.arguments[1].property?.name === 'url'
        ) {
          const source = node.arguments[0].value;
          imports.push(source);
          importRecords.push(createImportRecord(source, { usesAllExports: true }));
        }
      },

      AssignmentExpression(node) {
        const left = node.left;
        if (left?.type !== 'MemberExpression') return;
        const objectName = left.object?.type === 'Identifier' ? left.object.name : null;
        const propertyName = left.property?.type === 'Identifier'
          ? left.property.name
          : left.property?.type === 'StringLiteral'
            ? left.property.value
            : null;

        // module.exports = { ... }
        if (objectName === 'module' && propertyName === 'exports' && node.right?.type === 'ObjectExpression') {
          const fallbackLines = { lineStart: node.loc?.start?.line, lineEnd: node.loc?.end?.line };
          for (const prop of node.right.properties || []) {
            if (prop.type === 'ObjectProperty' || prop.type === 'Property') {
              const name = getPropertyName(prop);
              if (name) {
                exportRecords.push(buildExportRecordFromValue(name, prop.value, fallbackLines));
              }
            } else if (prop.type === 'ObjectMethod') {
              const name = getPropertyName(prop);
              if (name) {
                const fingerprint = buildFunctionFingerprint(prop);
                exportRecords.push(createExportRecord(name, {
                  kind: 'function',
                  lineStart: prop.loc?.start?.line || fallbackLines.lineStart,
                  lineEnd: prop.loc?.end?.line || fallbackLines.lineEnd,
                  fingerprint,
                }));
              }
            }
          }
        }

        // exports.foo = ...
        if (objectName === 'exports' && propertyName && propertyName !== 'exports') {
          exportRecords.push(buildExportRecordFromValue(propertyName, node.right, {
            lineStart: node.loc?.start?.line,
            lineEnd: node.loc?.end?.line,
          }));
        }
      },
    };

    walkAST(ast, (node, parent) => {
      const handler = importExportVisitors[node.type];
      if (handler) handler(node, parent);
    });

    const exports = uniqueNames(exportRecords.filter((r) => !r.unknown).map((r) => r.name));

    // Collect all top-level function definitions (including internal) for call-chain tracing
    const functionRecords = [];
    const functionVisitors = {
      FunctionDeclaration(node) {
        if (node.id?.name) pushFunctionRecord(functionRecords, node.id.name, node);
      },
      FunctionExpression(node) {
        if (node.id?.name) pushFunctionRecord(functionRecords, node.id.name, node);
      },
      ArrowFunctionExpression(node, parent) {
        let name = null;
        if (parent?.type === 'VariableDeclarator' && parent.id?.name) {
          name = parent.id.name;
        }
        if (name) pushFunctionRecord(functionRecords, name, node);
      },
    };

    walkAST(ast, (node, parent) => {
      const handler = functionVisitors[node.type];
      if (handler) handler(node, parent);
    });

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

function extractImportsWithRegex(sanitized) {
  const imports = [];
  const importRecords = [];

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

  // Destructured exports: export const { a, b } = obj
  // Also handles rename syntax: export const { a: renamed } = obj
  // Multi-line destructuring is supported by using [\s\S]*? instead of [^}]*
  const destructuredExportRegex = /export\s+(const|let|var)\s*\{([\s\S]*?)\}/g;
  while ((match = destructuredExportRegex.exec(sanitized)) !== null) {
    const names = match[2]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const withoutType = part.replace(/^type\s+/, '').trim();
        // Destructuring rename: { original: localName } → exported name is localName
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

  // CJS: module.exports = { foo, bar: 1, baz: () => {} }
  // LIMITATION: this regex cannot handle nested objects (e.g. { foo: { bar: 1 } }).
  // Full nested-object parsing requires an AST; regex fallback is intentionally shallow.
  const moduleExportsRegex = /module\.exports\s*=\s*\{([^}]*)}/g;
  while ((match = moduleExportsRegex.exec(sanitized)) !== null) {
    const inner = match[1];
    const propRegex = /([A-Za-z_$][\w$]*)\s*(?::|,|$)/g;
    let propMatch;
    while ((propMatch = propRegex.exec(inner)) !== null) {
      exportRecords.push(createExportRecord(propMatch[1], { kind: 'symbol' }));
    }
  }

  // CJS: exports.foo = ...  and  module.exports.foo = ...
  const exportsAssignRegex = /(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((match = exportsAssignRegex.exec(sanitized)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'symbol' }));
  }

  return { exportRecords, reExportImportRecords };
}

function extractFunctionRecordsWithRegex(sanitized) {
  const functionRecords = [];

  // Precompute line offsets to avoid O(N^2) slice + split on large files
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
    return low + 1; // 1-indexed
  }

  // function declarations (including exported / async)
  const functionDeclRegex = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = functionDeclRegex.exec(sanitized)) !== null) {
    const lineStart = getLineNumber(match.index);
    functionRecords.push({
      name: match[1],
      kind: 'function',
      lineStart,
      lineEnd: lineStart,
    });
  }

  // arrow functions: const foo = () => {}
  const arrowFunctionRegex = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  while ((match = arrowFunctionRegex.exec(sanitized)) !== null) {
    const lineStart = getLineNumber(match.index);
    functionRecords.push({
      name: match[1],
      kind: 'function',
      lineStart,
      lineEnd: lineStart,
    });
  }

  // function expressions: const foo = function() {}
  const functionExprRegex = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*(?:[A-Za-z_$][\w$]*)?\s*\(/g;
  while ((match = functionExprRegex.exec(sanitized)) !== null) {
    const lineStart = getLineNumber(match.index);
    functionRecords.push({
      name: match[1],
      kind: 'function',
      lineStart,
      lineEnd: lineStart,
    });
  }

  return functionRecords;
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
