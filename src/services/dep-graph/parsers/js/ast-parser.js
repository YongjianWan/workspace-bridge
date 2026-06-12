const {
  path,
  babelParser,
  uniqueNames,
  exportKindFromDeclarationType,
  createExportRecord,
  isFunctionLikeNode,
  buildFunctionFingerprint,
  normalizeImportedName,
  createImportRecord,
  VUE_COMPILER_MACROS,
  walkAST,
  getPropertyName,
  buildExportRecordFromValue,
  pushFunctionRecord,
} = require('./shared');

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
        if (
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments?.[0]?.value
        ) {
          const source = node.arguments[0].value;
          imports.push(source);
          let imported = [];
          let usesAllExports = true;
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
        if (
          node.callee?.type === 'Import' &&
          node.arguments?.[0]?.value
        ) {
          const source = node.arguments[0].value;
          imports.push(source);
          importRecords.push(createImportRecord(source, { usesAllExports: true, isLazy: true }));
        }
      },

      NewExpression(node) {
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

    // Collect local names that are exported so function records can carry isExported.
    const exportedNames = new Set();
    const exportNameVisitors = {
      ExportNamedDeclaration(node) {
        if (node.exportKind === 'type') return;
        if (node.declaration) {
          const decl = node.declaration;
          if (decl.id?.name) exportedNames.add(decl.id.name);
          if (decl.declarations) {
            for (const d of decl.declarations) {
              if (d.id?.name) exportedNames.add(d.id.name);
            }
          }
        }
        for (const spec of node.specifiers || []) {
          if (spec.type === 'ExportSpecifier') {
            const localName = spec.local?.name || spec.local?.value;
            if (localName) exportedNames.add(localName);
          }
        }
      },
      ExportDefaultDeclaration(node) {
        const decl = node.declaration;
        if (decl?.id?.name) exportedNames.add(decl.id.name);
      },
    };

    walkAST(ast, (node) => {
      const handler = exportNameVisitors[node.type];
      if (handler) handler(node);
    });

    const functionRecords = [];
    const functionVisitors = {
      FunctionDeclaration(node) {
        if (node.id?.name) {
          pushFunctionRecord(functionRecords, node.id.name, node, {
            isExported: exportedNames.has(node.id.name),
          });
        }
      },
      FunctionExpression(node) {
        if (node.id?.name) {
          pushFunctionRecord(functionRecords, node.id.name, node, {
            isExported: exportedNames.has(node.id.name),
          });
        }
      },
      ArrowFunctionExpression(node, parent) {
        let name = null;
        if (parent?.type === 'VariableDeclarator' && parent.id?.name) {
          name = parent.id.name;
        }
        if (name) {
          pushFunctionRecord(functionRecords, name, node, {
            isExported: exportedNames.has(name),
          });
        }
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
    return null;
  }
}

module.exports = { parseJavaScriptAST };
