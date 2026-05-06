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

        let lineStart;
        let lineEnd;
        if (tag === 'def.func' || tag === 'def.method') {
          const funcNode = findAncestor(capture.node, ['function_definition']);
          if (funcNode) {
            lineStart = getLineStart(funcNode);
            lineEnd = getLineEnd(funcNode);
          }
        }
        if (!lineStart) {
          lineStart = getLineStart(capture.node);
          lineEnd = getLineEnd(capture.node);
        }

        // C: static function = internal linkage, skip export
        if (isC && tag === 'def.func') {
          const funcNode = findAncestor(capture.node, ['function_definition']);
          if (funcNode && hasStaticKeyword(funcNode)) continue;
        }

        const dedupKey = `${name}|${kind}|${lineStart ?? ''}|${lineEnd ?? ''}`;
        if (seenExports.has(dedupKey)) continue;
        seenExports.add(dedupKey);

        exportRecords.push(createExportRecord(name, { kind, lineStart, lineEnd }));
        if (tag === 'def.func' || tag === 'def.method') {
          functionRecords.push({ name, kind: 'function', lineStart, lineEnd });
        }
      }
    }
  } catch {
    return parseCppRegex(content);
  } finally {
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
