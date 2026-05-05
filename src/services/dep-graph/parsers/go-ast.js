const {
  getParserModule,
  loadLanguage,
  getNodeText,
  getLineStart,
  getLineEnd,
  stripQuotes,
} = require('./tree-sitter');
const { uniqueNames, createExportRecord, createImportRecord } = require('./shared');
const { parseGoRegex } = require('./polyglot');

const GO_QUERY = `
(import_spec path: (interpreted_string_literal) @import.source)
(function_declaration name: (identifier) @def.func)
(method_declaration name: (field_identifier) @def.method)
(type_spec name: (type_identifier) @def.type)
(const_spec name: (identifier) @def.const)
(var_spec name: (identifier) @def.var)
`;

function isExportedGoName(name) {
  if (!name) return false;
  const ch = name.charAt(0);
  return ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

function getParentByTypes(node, types) {
  let current = node.parent;
  while (current) {
    if (types.includes(current.type)) return current;
    current = current.parent;
  }
  return null;
}

async function parseGo(content) {
  let parser;
  let language;
  try {
    const mod = await getParserModule();
    if (!mod) return parseGoRegex(content);
    language = await loadLanguage('go');
    if (!language) return parseGoRegex(content);
    parser = new mod.Parser();
    parser.setLanguage(language);
  } catch {
    return parseGoRegex(content);
  }

  let tree;
  try {
    tree = parser.parse(content);
  } catch {
    return parseGoRegex(content);
  }

  let query;
  try {
    const mod = await getParserModule();
    query = new mod.Query(language, GO_QUERY);
  } catch {
    return parseGoRegex(content);
  }

  const imports = [];
  const importRecords = [];
  const exportRecords = [];
  const functionRecords = [];

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
            importRecords.push(createImportRecord(source, { usesAllExports: true }));
          }
          continue;
        }

        if (!isExportedGoName(name)) continue;

        if (tag === 'def.func') {
          const parent = getParentByTypes(capture.node, ['function_declaration']);
          exportRecords.push(createExportRecord(name, {
            kind: 'function',
            lineStart: getLineStart(parent) || getLineStart(capture.node),
            lineEnd: getLineEnd(parent) || getLineEnd(capture.node),
          }));
          functionRecords.push({
            name,
            kind: 'function',
            lineStart: getLineStart(parent) || getLineStart(capture.node),
            lineEnd: getLineEnd(parent) || getLineEnd(capture.node),
          });
        } else if (tag === 'def.method') {
          const parent = getParentByTypes(capture.node, ['method_declaration']);
          exportRecords.push(createExportRecord(name, {
            kind: 'function',
            lineStart: getLineStart(parent) || getLineStart(capture.node),
            lineEnd: getLineEnd(parent) || getLineEnd(capture.node),
          }));
          functionRecords.push({
            name,
            kind: 'function',
            lineStart: getLineStart(parent) || getLineStart(capture.node),
            lineEnd: getLineEnd(parent) || getLineEnd(capture.node),
          });
        } else if (tag === 'def.type') {
          const parent = getParentByTypes(capture.node, ['type_spec']);
          exportRecords.push(createExportRecord(name, {
            kind: 'type',
            lineStart: getLineStart(parent) || getLineStart(capture.node),
            lineEnd: getLineEnd(parent) || getLineEnd(capture.node),
          }));
        } else if (tag === 'def.const') {
          const parent = getParentByTypes(capture.node, ['const_spec']);
          exportRecords.push(createExportRecord(name, {
            kind: 'const',
            lineStart: getLineStart(parent) || getLineStart(capture.node),
            lineEnd: getLineEnd(parent) || getLineEnd(capture.node),
          }));
        } else if (tag === 'def.var') {
          const parent = getParentByTypes(capture.node, ['var_spec']);
          exportRecords.push(createExportRecord(name, {
            kind: 'variable',
            lineStart: getLineStart(parent) || getLineStart(capture.node),
            lineEnd: getLineEnd(parent) || getLineEnd(capture.node),
          }));
        }
      }
    }
  } catch {
    return parseGoRegex(content);
  } finally {
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

module.exports = { parseGo };
