const {
  getParserModule,
  loadLanguage,
  getNodeText,
  getLineStart,
  getLineEnd,
  stripQuotes,
} = require('./tree-sitter');
const { uniqueNames, createExportRecord, createImportRecord } = require('./shared');
const { parseCpp: parseCppRegex } = require('./cpp');

// ---------------------------------------------------------------------------
// Tree-sitter Queries
// ---------------------------------------------------------------------------

const C_QUERY = `
(preproc_include path: (_) @import.source)

(function_definition
  declarator: (function_declarator
    declarator: (identifier) @def.func))

(function_definition
  declarator: (pointer_declarator
    declarator: (function_declarator
      declarator: (identifier) @def.func)))

(function_definition
  declarator: (pointer_declarator
    declarator: (pointer_declarator
      declarator: (function_declarator
        declarator: (identifier) @def.func))))

(struct_specifier name: (type_identifier) @def.struct)
(enum_specifier name: (type_identifier) @def.enum)
(type_definition declarator: (type_identifier) @def.type)

(preproc_function_def name: (identifier) @def.macro)
(preproc_def name: (identifier) @def.macro)
`;

const CPP_QUERY = `
(preproc_include path: (_) @import.source)

(function_definition
  declarator: (function_declarator
    declarator: (identifier) @def.func))

(function_definition
  declarator: (function_declarator
    declarator: (qualified_identifier name: (identifier) @def.method)))

(function_definition
  declarator: (pointer_declarator
    declarator: (function_declarator
      declarator: (identifier) @def.func)))

(function_definition
  declarator: (pointer_declarator
    declarator: (pointer_declarator
      declarator: (function_declarator
        declarator: (identifier) @def.func))))

(function_definition
  declarator: (pointer_declarator
    declarator: (function_declarator
      declarator: (qualified_identifier name: (identifier) @def.method))))

(function_definition
  declarator: (pointer_declarator
    declarator: (pointer_declarator
      declarator: (function_declarator
        declarator: (qualified_identifier name: (identifier) @def.method)))))

(function_definition
  declarator: (reference_declarator
    (function_declarator
      declarator: (identifier) @def.func)))

(function_definition
  declarator: (reference_declarator
    (function_declarator
      declarator: (qualified_identifier name: (identifier) @def.method))))

(class_specifier name: (type_identifier) @def.class)
(struct_specifier name: (type_identifier) @def.struct)
(enum_specifier name: (type_identifier) @def.enum)
(namespace_definition name: (namespace_identifier) @def.namespace)
(type_definition declarator: (type_identifier) @def.type)

(preproc_function_def name: (identifier) @def.macro)
(preproc_def name: (identifier) @def.macro)

(template_declaration
  (class_specifier name: (type_identifier) @def.class))

(template_declaration
  (function_definition
    declarator: (function_declarator
      declarator: (identifier) @def.func)))
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCFile(filePath) {
  if (!filePath) return false;
  return filePath.endsWith('.c');
}

function findAncestor(node, types) {
  let current = node.parent;
  while (current) {
    if (types.includes(current.type)) return current;
    current = current.parent;
  }
  return null;
}

function hasStaticKeyword(node) {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c?.type === 'storage_class_specifier' && c.text === 'static') return true;
  }
  return false;
}

function isFunctionDeclarator(node) {
  if (!node) return false;
  return (
    node.type === 'function_declarator' ||
    node.type === 'pointer_declarator' ||
    node.type === 'reference_declarator'
  );
}

function getReturnType(funcNode) {
  if (!funcNode) return null;
  let declaratorIdx = -1;
  for (let i = 0; i < funcNode.childCount; i++) {
    if (isFunctionDeclarator(funcNode.child(i))) {
      declaratorIdx = i;
      break;
    }
  }
  if (declaratorIdx <= 0) return null;

  const parts = [];
  for (let i = 0; i < declaratorIdx; i++) {
    const c = funcNode.child(i);
    if (!c) continue;
    if (c.type === 'storage_class_specifier') continue;
    if (c.type === 'comment') continue;
    if (c.type === 'attribute_declaration' || c.type === 'attribute_specifier') continue;
    const text = getNodeText(c).trim();
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function getDecorators(funcNode) {
  if (!funcNode) return [];
  const decorators = [];
  for (let i = 0; i < funcNode.childCount; i++) {
    const c = funcNode.child(i);
    if (!c) continue;
    if (c.type === 'attribute_declaration') {
      const text = getNodeText(c).trim();
      if (text) decorators.push(text);
    } else if (c.type === 'attribute') {
      const text = getNodeText(c).trim();
      if (text) decorators.push(text);
    }
  }
  return decorators;
}

// ---------------------------------------------------------------------------
// Branch complexity metrics
// ---------------------------------------------------------------------------

function isLogicalBinaryOp(node) {
  for (let i = 0; i < node.childCount; i++) {
    const childType = node.child(i).type;
    if (childType === '&&' || childType === '||') return true;
  }
  return false;
}

function countSwitchArms(switchNode) {
  let arms = 0;
  for (let i = 0; i < switchNode.childCount; i++) {
    const child = switchNode.child(i);
    if (child.type !== 'compound_statement') continue;
    for (let j = 0; j < child.childCount; j++) {
      if (child.child(j).type === 'case_statement') arms += 1;
    }
  }
  return arms;
}

function countIfElseArms(ifNode) {
  let arms = 1;
  let current = ifNode;
  while (true) {
    let elseClause = null;
    for (let i = 0; i < current.childCount; i++) {
      if (current.child(i).type === 'else_clause') {
        elseClause = current.child(i);
        break;
      }
    }
    if (!elseClause) break;

    let nestedIf = null;
    for (let i = 0; i < elseClause.childCount; i++) {
      if (elseClause.child(i).type === 'if_statement') {
        nestedIf = elseClause.child(i);
        break;
      }
    }
    if (nestedIf) {
      arms += 1;
      current = nestedIf;
    } else {
      arms += 1;
      break;
    }
  }
  return arms;
}

function computeBranchMetrics(funcNode) {
  if (!funcNode) return { branchCount: 0, maxArms: 0 };
  let branchCount = 0;
  let maxArms = 0;
  const stack = [];
  for (let i = 0; i < funcNode.childCount; i++) {
    stack.push(funcNode.child(i));
  }

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    // Do not leak branches from nested functions or lambdas into the parent.
    if (node.type === 'function_definition' || node.type === 'lambda_expression') {
      continue;
    }

    if (node.type === 'if_statement') {
      branchCount += 1;
      maxArms = Math.max(maxArms, countIfElseArms(node));
    } else if (node.type === 'switch_statement') {
      branchCount += 1;
      maxArms = Math.max(maxArms, countSwitchArms(node));
    } else if (node.type === 'conditional_expression') {
      branchCount += 1;
    } else if (node.type === 'try_statement') {
      branchCount += 1;
    } else if (
      node.type === 'for_statement' ||
      node.type === 'range_for_statement' ||
      node.type === 'while_statement' ||
      node.type === 'do_statement'
    ) {
      branchCount += 1;
    } else if (node.type === 'binary_expression' && isLogicalBinaryOp(node)) {
      branchCount += 1;
    }

    for (let i = 0; i < node.childCount; i++) {
      stack.push(node.child(i));
    }
  }

  return { branchCount, maxArms };
}

// ---------------------------------------------------------------------------
// AST Parser
// ---------------------------------------------------------------------------

async function parseCppAst(content, filePath) {
  let parser;
  let language;
  try {
    const mod = await getParserModule();
    if (!mod) return parseCppRegex(content);
    language = await loadLanguage('cpp');
    if (!language) return parseCppRegex(content);
    parser = new mod.Parser();
    parser.setLanguage(language);
  } catch {
    return parseCppRegex(content);
  }

  let tree;
  try {
    tree = parser.parse(content);
  } catch {
    return parseCppRegex(content);
  }

  const isC = isCFile(filePath || '');
  const queryStr = isC ? C_QUERY : CPP_QUERY;

  let query;
  try {
    const mod = await getParserModule();
    query = new mod.Query(language, queryStr);
  } catch {
    return parseCppRegex(content);
  }

  const imports = [];
  const importRecords = [];
  const exportRecords = [];
  const functionRecords = [];
  const seenExports = new Set();

  try {
    const matches = query.matches(tree.rootNode);
    for (const match of matches) {
      for (const capture of match.captures) {
        const name = getNodeText(capture.node);
        const tag = capture.name;

        if (tag === 'import.source') {
          const source = stripQuotes(name);
          if (source) {
            imports.push(source);
            const rec = createImportRecord(source, { usesAllExports: true });
            rec.isLocal = name.startsWith('"');
            importRecords.push(rec);
          }
          continue;
        }

        if (!tag.startsWith('def.')) continue;

        let kind = 'symbol';
        if (tag === 'def.func' || tag === 'def.method') kind = 'function';
        else if (tag === 'def.struct') kind = 'struct';
        else if (tag === 'def.class') kind = 'class';
        else if (tag === 'def.enum') kind = 'enum';
        else if (tag === 'def.type') kind = 'typedef';
        else if (tag === 'def.macro') kind = 'macro';
        else if (tag === 'def.namespace') kind = 'namespace';

        const funcNode = (tag === 'def.func' || tag === 'def.method')
          ? findAncestor(capture.node, ['function_definition'])
          : null;

        let lineStart;
        let lineEnd;
        if (funcNode) {
          lineStart = getLineStart(funcNode);
          lineEnd = getLineEnd(funcNode);
        } else {
          lineStart = getLineStart(capture.node);
          lineEnd = getLineEnd(capture.node);
        }

        // C: static function = internal linkage, skip export
        if (isC && tag === 'def.func' && funcNode && hasStaticKeyword(funcNode)) continue;

        const dedupKey = `${name}|${kind}|${lineStart ?? ''}|${lineEnd ?? ''}`;
        if (seenExports.has(dedupKey)) continue;
        seenExports.add(dedupKey);

        exportRecords.push(createExportRecord(name, { kind, lineStart, lineEnd }));
        if (tag === 'def.func' || tag === 'def.method') {
          const { branchCount, maxArms } = computeBranchMetrics(funcNode);
          functionRecords.push({
            name,
            kind: 'function',
            lineStart,
            lineEnd,
            isExported: true,
            returnType: getReturnType(funcNode),
            decorators: getDecorators(funcNode),
            branchCount,
            maxArms,
          });
        }
      }
    }
  } catch {
    return parseCppRegex(content);
  } finally {
    try { if (tree) tree.delete(); } catch {}
    try { query.delete(); } catch {}
    try { parser.delete(); } catch {}
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    functionRecords,
    parseMode: 'ast',
  };
}

module.exports = { parseCppAst };
