const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { TIMEOUTS, LIMITS } = require('../../config/constants');

let babelParser = null;
try {
  babelParser = require('@babel/parser');
} catch {
  // babel parser not available, fallback to regex
}

function uniqueNames(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function exportKindFromDeclarationType(type) {
  if (type === 'FunctionDeclaration') return 'function';
  if (type === 'ClassDeclaration') return 'class';
  if (type === 'VariableDeclaration') return 'variable';
  return 'symbol';
}

function createExportRecord(name, options = {}) {
  const record = { name };
  if (options.kind) record.kind = options.kind;
  if (options.unknown) record.unknown = true;
  if (Number.isFinite(options.lineStart)) record.lineStart = options.lineStart;
  if (Number.isFinite(options.lineEnd)) record.lineEnd = options.lineEnd;
  if (options.fingerprint && typeof options.fingerprint === 'object') {
    record.fingerprint = options.fingerprint;
  }
  return record;
}

function isFunctionLikeNode(node) {
  if (!node || typeof node !== 'object') return false;
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

function getCallName(callee) {
  if (!callee || typeof callee !== 'object') return null;
  if (callee.type === 'Identifier') return callee.name || null;
  if (callee.type === 'MemberExpression') {
    const objectName = callee.object?.type === 'Identifier' ? callee.object.name : null;
    const propertyName = callee.property?.type === 'Identifier'
      ? callee.property.name
      : callee.property?.type === 'StringLiteral'
        ? callee.property.value
        : null;
    if (objectName && propertyName) return `${objectName}.${propertyName}`;
    if (propertyName) return propertyName;
  }
  return null;
}

function buildFunctionFingerprint(functionNode) {
  if (!isFunctionLikeNode(functionNode)) return null;
  const callCallees = new Set();
  let hasTryCatch = false;
  let branchCount = 0;
  let returnCount = 0;
  const stack = [functionNode.body];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;

    if (node.type === 'CallExpression') {
      const callName = getCallName(node.callee);
      if (callName) callCallees.add(callName);
    } else if (node.type === 'TryStatement') {
      hasTryCatch = true;
    } else if (
      node.type === 'IfStatement' ||
      node.type === 'SwitchCase' ||
      node.type === 'ConditionalExpression' ||
      node.type === 'LogicalExpression'
    ) {
      branchCount += 1;
    } else if (node.type === 'ReturnStatement') {
      returnCount += 1;
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) stack.push(c);
      } else if (child && typeof child === 'object') {
        stack.push(child);
      }
    }
  }

  return {
    paramCount: Array.isArray(functionNode.params) ? functionNode.params.length : 0,
    isAsync: Boolean(functionNode.async),
    isGenerator: Boolean(functionNode.generator),
    hasTryCatch,
    branchCount,
    returnCount,
    callCallees: Array.from(callCallees).sort().slice(0, 20),
  };
}

function normalizeImportedName(name) {
  if (!name) return null;
  const trimmed = String(name).trim();
  if (!trimmed || trimmed === 'type') return null;
  return trimmed.replace(/^type\s+/, '').trim() || null;
}

function parseNamedBindings(raw) {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const withoutType = part.replace(/^type\s+/, '').trim();
      const [imported] = withoutType.split(/\s+as\s+/i);
      return normalizeImportedName(imported);
    })
    .filter(Boolean);
}

function createImportRecord(source, options = {}) {
  const record = {
    source,
    imported: uniqueNames(options.imported || []),
    usesAllExports: Boolean(options.usesAllExports),
    reExported: (options.reExported || [])
      .map((pair) => ({
        imported: normalizeImportedName(pair?.imported),
        exported: normalizeImportedName(pair?.exported),
      }))
      .filter((pair) => pair.imported && pair.exported),
    reExportAll: Boolean(options.reExportAll),
  };
  if (options.isStatic) record.isStatic = true;
  return record;
}

async function parsePythonAST(content) {
  return new Promise((resolve) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(__dirname, '..', '..', '..', 'scripts', 'python_ast_parser.py');

    if (!fs.existsSync(scriptPath)) {
      resolve(null);
      return;
    }

    const python = spawn(pythonCmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: TIMEOUTS.PYTHON_AST_PARSE_MS,
    });

    let output = '';
    let errorOutput = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      python.kill('SIGTERM');
    }, TIMEOUTS.PYTHON_AST_PARSE_MS);

    python.stdout.on('data', (data) => {
      output += data.toString('utf8');
      if (output.length > LIMITS.COMMAND_OUTPUT_MAX_BYTES) {
        output = output.slice(0, LIMITS.COMMAND_OUTPUT_MAX_BYTES) + '\n...[truncated]';
        python.stdout.destroy();
      }
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString('utf8');
      if (errorOutput.length > LIMITS.COMMAND_OUTPUT_MAX_BYTES) {
        errorOutput = errorOutput.slice(0, LIMITS.COMMAND_OUTPUT_MAX_BYTES) + '\n...[truncated]';
        python.stderr.destroy();
      }
    });

    python.on('close', (code) => {
      clearTimeout(timer);
      if (killed || code !== 0) {
        if (process.env.DEBUG) {
          console.error(`[DepGraph] Python AST parse failed: exitCode=${code}, stderr=${errorOutput}`);
        }
        resolve(null);
        return;
      }
      try {
        const result = JSON.parse(output);
        resolve(result);
      } catch (e) {
        if (process.env.DEBUG) {
          console.error(`[DepGraph] Python AST JSON parse failed: ${e.message}`);
        }
        resolve(null);
      }
    });

    python.on('error', (err) => {
      clearTimeout(timer);
      if (process.env.DEBUG) {
        console.error(`[DepGraph] Python spawn failed: ${err.message}`);
      }
      resolve(null);
    });

    python.stdin.write(content, 'utf8');
    python.stdin.end();
  });
}

function parsePythonWithRegex(content) {
  const imports = [];
  const importRecords = [];
  const exports = [];

  const importRegex = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const module = match[1] || match[2];
    if (module) {
      imports.push(module);
      importRecords.push(createImportRecord(module, { usesAllExports: true }));
    }
  }

  const classRegex = /^class\s+(\w+)/gm;
  const funcRegex = /^(?:async\s+)?def\s+(\w+)/gm;

  while ((match = classRegex.exec(content)) !== null) {
    if (!match[1].startsWith('_')) exports.push(match[1]);
  }
  while ((match = funcRegex.exec(content)) !== null) {
    if (!match[1].startsWith('_')) exports.push(match[1]);
  }

  return { imports, exports, importRecords, parseMode: 'regex' };
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
      parseMode: 'ast',
    };
  }

  return parsePythonWithRegex(content);
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
    return {
      imports: uniqueNames(imports),
      exports,
      importRecords,
      exportRecords,
      parseMode: 'ast',
    };
  } catch (e) {
    if (process.env.DEBUG) {
      console.error(`[DepGraph] AST parse failed for ${filePath}:`, e.message);
    }
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

  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  const importFromRegex = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importFromRegex.exec(content)) !== null) {
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
  while ((match = sideEffectImportRegex.exec(content)) !== null) {
    const source = match[1];
    imports.push(source);
    importRecords.push(createImportRecord(source, { usesAllExports: true }));
  }

  const destructuredRequireRegex = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = destructuredRequireRegex.exec(content)) !== null) {
    const imported = parseNamedBindings(match[1]);
    const source = match[2];
    imports.push(source);
    importRecords.push(createImportRecord(source, { imported }));
  }

  const requireRegex = /(?:const|let|var)\s+[\w$]+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    const source = match[1] || match[2];
    imports.push(source);
    importRecords.push(createImportRecord(source, { usesAllExports: true }));
  }

  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    const source = match[1];
    imports.push(source);
    importRecords.push(createImportRecord(source, { usesAllExports: true }));
  }

  const namedReExportRegex = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  while ((match = namedReExportRegex.exec(content)) !== null) {
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
  while ((match = exportAllRegex.exec(content)) !== null) {
    imports.push(match[1]);
    exportRecords.push(createExportRecord('*', { unknown: true, kind: 'symbol' }));
    importRecords.push(createImportRecord(match[1], { usesAllExports: true, reExportAll: true }));
  }

  const namedExportRegex = /export\s*\{([^}]*)\}(?!\s*from)/g;
  while ((match = namedExportRegex.exec(content)) !== null) {
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
  while ((match = declarationExportRegex.exec(content)) !== null) {
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
  while ((match = defaultNamedRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord('default', { kind: 'function-default' }));
    if (match[1]) {
      exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
    }
  }
  if (/export\s+default\s+(?!async\s+function\s+\w+|function\s+\w+|class\s+\w+)/.test(content)) {
    exportRecords.push(createExportRecord('default', { kind: 'symbol' }));
  }

  const exports = uniqueNames(exportRecords.filter((record) => !record.unknown).map((record) => record.name));
  return {
    imports: uniqueNames(imports),
    exports,
    importRecords,
    exportRecords,
    parseMode: 'regex',
  };
}

async function parseJavaAST(content) {
  return new Promise((resolve) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(__dirname, '..', '..', '..', 'scripts', 'java_ast_parser.py');

    if (!fs.existsSync(scriptPath)) {
      resolve(null);
      return;
    }

    const python = spawn(pythonCmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: TIMEOUTS.PYTHON_AST_PARSE_MS,
    });

    let output = '';
    let errorOutput = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      python.kill('SIGTERM');
    }, TIMEOUTS.PYTHON_AST_PARSE_MS);

    python.stdout.on('data', (data) => {
      output += data.toString('utf8');
      if (output.length > LIMITS.COMMAND_OUTPUT_MAX_BYTES) {
        output = output.slice(0, LIMITS.COMMAND_OUTPUT_MAX_BYTES) + '\n...[truncated]';
        python.stdout.destroy();
      }
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString('utf8');
      if (errorOutput.length > LIMITS.COMMAND_OUTPUT_MAX_BYTES) {
        errorOutput = errorOutput.slice(0, LIMITS.COMMAND_OUTPUT_MAX_BYTES) + '\n...[truncated]';
        python.stderr.destroy();
      }
    });

    python.on('close', (code) => {
      clearTimeout(timer);
      if (killed || code !== 0) {
        if (process.env.DEBUG) {
          console.error(`[DepGraph] Java AST parse failed: exitCode=${code}, stderr=${errorOutput}`);
        }
        resolve(null);
        return;
      }
      try {
        const result = JSON.parse(output);
        resolve(result);
      } catch (e) {
        if (process.env.DEBUG) {
          console.error(`[DepGraph] Java AST JSON parse failed: ${e.message}`);
        }
        resolve(null);
      }
    });

    python.on('error', (err) => {
      clearTimeout(timer);
      if (process.env.DEBUG) {
        console.error(`[DepGraph] Java spawn failed: ${err.message}`);
      }
      resolve(null);
    });

    python.stdin.write(content, 'utf8');
    python.stdin.end();
  });
}

function parseJavaWithRegex(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];

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

  const exports = uniqueNames(exportRecords.map((record) => record.name));
  return {
    imports: uniqueNames(imports),
    exports,
    importRecords,
    exportRecords,
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
      parseMode: 'ast',
    };
  }
  const regexResult = parseJavaWithRegex(content);
  return { ...regexResult, parseMode: 'regex' };
}

function parseKotlin(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  const importRegex = /^\s*import\s+([\w.]+)(?:\.\*)?\s*(?:as\s+\w+)?/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const source = match[1] + (match[0].includes('.*') ? '.*' : '');
    const isWildcard = source.endsWith('.*');
    imports.push(source);
    importRecords.push(createImportRecord(source, {
      imported: isWildcard ? [] : [source.split('.').pop()],
      usesAllExports: isWildcard,
    }));
  }

  const exportRegex = /\b(?:public\s+)?(?:abstract\s+|open\s+|data\s+)?(?:class|interface|object|enum)\s+([A-Za-z_]\w*)/g;
  while ((match = exportRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'class' }));
  }

  const funRegex = /\bfun\s+([A-Za-z_]\w*)\s*\(/g;
  while ((match = funRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    parseMode: 'regex',
  };
}

function parseGo(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  const singleImport = /^\s*import\s+"([^"]+)"/gm;
  let match;
  while ((match = singleImport.exec(content)) !== null) {
    imports.push(match[1]);
    importRecords.push(createImportRecord(match[1], { usesAllExports: true }));
  }

  const blockImport = /^\s*import\s+\(([\s\S]*?)\)/m;
  const blockMatch = content.match(blockImport);
  if (blockMatch) {
    const inner = blockMatch[1];
    const innerRegex = /"([^"]+)"/g;
    while ((match = innerRegex.exec(inner)) !== null) {
      imports.push(match[1]);
      importRecords.push(createImportRecord(match[1], { usesAllExports: true }));
    }
  }

  const typeRegex = /\btype\s+([A-Z]\w*)/g;
  while ((match = typeRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'type' }));
  }
  const funcRegex = /\bfunc\s+(?:\([^)]*\)\s+)?([A-Z]\w*)\s*\(/g;
  while ((match = funcRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    parseMode: 'regex',
  };
}

function parseRust(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  const useRegex = /^\s*use\s+([\w:]+)\s*;/gm;
  let match;
  while ((match = useRegex.exec(content)) !== null) {
    imports.push(match[1]);
    importRecords.push(createImportRecord(match[1], { usesAllExports: match[1].endsWith('::*') }));
  }

  const fnRegex = /\bpub\s+(?:async\s+)?fn\s+(\w+)/g;
  while ((match = fnRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
  }
  const structRegex = /\bpub\s+struct\s+(\w+)/g;
  while ((match = structRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'struct' }));
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    parseMode: 'regex',
  };
}

module.exports = {
  createImportRecord,
  parsePython,
  parseJavaScript,
  parseJava,
  parseKotlin,
  parseGo,
  parseRust,
};
