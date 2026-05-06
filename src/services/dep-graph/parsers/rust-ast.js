const {
  getParserModule,
  loadLanguage,
  getNodeText,
  getLineStart,
  getLineEnd,
} = require('./tree-sitter');
const { uniqueNames, createExportRecord, createImportRecord } = require('./shared');
const { parseRust: parseRustRegex } = require('./polyglot');

const RUST_QUERY = `
(use_declaration
  argument: [
    (scoped_identifier) @import.source
    (identifier) @import.source
    (scoped_use_list) @import.use_list
    (use_list) @import.use_list
    (use_as_clause) @import.use_as
  ])
(function_item
  (visibility_modifier)
  name: (identifier) @def.func)
(struct_item
  (visibility_modifier)
  name: (type_identifier) @def.struct)
(enum_item
  (visibility_modifier)
  name: (type_identifier) @def.enum)
(trait_item
  (visibility_modifier)
  name: (type_identifier) @def.trait)
(type_item
  (visibility_modifier)
  name: (type_identifier) @def.type)
(mod_item
  (visibility_modifier)
  name: (identifier) @def.mod)
(const_item
  (visibility_modifier)
  name: (identifier) @def.const)
(static_item
  (visibility_modifier)
  name: (identifier) @def.static)
(use_declaration
  (visibility_modifier)
  argument: [
    (scoped_identifier) @reexport.source
    (identifier) @reexport.source
    (scoped_use_list) @reexport.use_list
    (use_list) @reexport.use_list
    (use_as_clause) @reexport.use_as
  ])
`;

function getUseListPrefix(node) {
  for (const child of node.children) {
    if (child.type === 'scoped_identifier' || child.type === 'identifier') {
      return getNodeText(child);
    }
  }
  return '';
}

function getUseListItems(node) {
  for (const child of node.children) {
    if (child.type === 'use_list') {
      return child.children;
    }
  }
  return [];
}

function extractUsePaths(node) {
  const paths = [];
  if (node.type === 'scoped_use_list') {
    const prefix = getUseListPrefix(node);
    const items = getUseListItems(node);
    for (const item of items) {
      if (item.type === 'identifier') {
        paths.push(`${prefix}::${getNodeText(item)}`);
      } else if (item.type === 'self') {
        paths.push(prefix);
      } else if (item.type === 'use_as_clause') {
        const original = item.children.find((c) => c.type === 'identifier' || c.type === 'self');
        if (original) {
          if (original.type === 'self') {
            paths.push(prefix);
          } else {
            paths.push(`${prefix}::${getNodeText(original)}`);
          }
        }
      }
    }
  } else if (node.type === 'use_list') {
    for (const item of node.children) {
      if (item.type === 'identifier') {
        paths.push(getNodeText(item));
      } else if (item.type === 'use_as_clause') {
        const original = item.children.find((c) => c.type === 'identifier');
        if (original) paths.push(getNodeText(original));
      }
    }
  }
  return paths;
}

function extractReexportNames(node) {
  const names = [];
  if (node.type === 'scoped_identifier') {
    names.push(getNodeText(node).split('::').pop());
  } else if (node.type === 'identifier') {
    names.push(getNodeText(node));
  } else if (node.type === 'scoped_use_list') {
    const prefix = getUseListPrefix(node);
    const items = getUseListItems(node);
    for (const item of items) {
      if (item.type === 'identifier') {
        names.push(getNodeText(item));
      } else if (item.type === 'self') {
        names.push(prefix.split('::').pop() || prefix);
      } else if (item.type === 'use_as_clause') {
        const alias = item.children.find((c) => c.type === 'identifier' && c !== item.children.find((x) => x.type === 'identifier' || x.type === 'self'));
        // The alias is the last identifier child in use_as_clause
        const idents = item.children.filter((c) => c.type === 'identifier');
        if (idents.length > 0) {
          names.push(getNodeText(idents[idents.length - 1]));
        }
      }
    }
  } else if (node.type === 'use_list') {
    for (const item of node.children) {
      if (item.type === 'identifier') {
        names.push(getNodeText(item));
      } else if (item.type === 'use_as_clause') {
        const idents = item.children.filter((c) => c.type === 'identifier');
        if (idents.length > 0) {
          names.push(getNodeText(idents[idents.length - 1]));
        }
      }
    }
  }
  return names;
}

async function parseRust(content) {
  let parser;
  let language;
  try {
    const mod = await getParserModule();
    if (!mod) return parseRustRegex(content);
    language = await loadLanguage('rust');
    if (!language) return parseRustRegex(content);
    parser = new mod.Parser();
    parser.setLanguage(language);
  } catch {
    return parseRustRegex(content);
  }

  let tree;
  try {
    tree = parser.parse(content);
  } catch {
    return parseRustRegex(content);
  }

  let query;
  try {
    const mod = await getParserModule();
    query = new mod.Query(language, RUST_QUERY);
  } catch {
    return parseRustRegex(content);
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
          imports.push(name);
          importRecords.push(createImportRecord(name, { usesAllExports: false }));
          continue;
        }

        if (tag === 'import.use_list') {
          const paths = extractUsePaths(capture.node);
          for (const p of paths) {
            imports.push(p);
            importRecords.push(createImportRecord(p, { usesAllExports: false }));
          }
          continue;
        }

        if (tag === 'import.use_as') {
          const original = capture.node.children.find(
            (c) => c.type === 'scoped_identifier' || c.type === 'identifier'
          );
          if (original) {
            const path = getNodeText(original);
            imports.push(path);
            importRecords.push(createImportRecord(path, { usesAllExports: false }));
          }
          continue;
        }

        if (tag === 'reexport.source') {
          const names = extractReexportNames(capture.node);
          for (const n of names) {
            exportRecords.push(createExportRecord(n, { kind: 'reexport' }));
          }
          continue;
        }

        if (tag === 'reexport.use_list') {
          const names = extractReexportNames(capture.node);
          for (const n of names) {
            exportRecords.push(createExportRecord(n, { kind: 'reexport' }));
          }
          continue;
        }

        if (tag === 'reexport.use_as') {
          const idents = capture.node.children.filter((c) => c.type === 'identifier');
          if (idents.length > 0) {
            const alias = getNodeText(idents[idents.length - 1]);
            exportRecords.push(createExportRecord(alias, { kind: 'reexport' }));
          }
          continue;
        }

        const lineStart = getLineStart(capture.node);
        const lineEnd = getLineEnd(capture.node);
        const base = { lineStart, lineEnd };

        if (tag === 'def.func') {
          exportRecords.push(createExportRecord(name, { kind: 'function', ...base }));
          functionRecords.push({ name, kind: 'function', ...base });
        } else if (tag === 'def.struct') {
          exportRecords.push(createExportRecord(name, { kind: 'struct', ...base }));
        } else if (tag === 'def.enum') {
          exportRecords.push(createExportRecord(name, { kind: 'enum', ...base }));
        } else if (tag === 'def.trait') {
          exportRecords.push(createExportRecord(name, { kind: 'trait', ...base }));
        } else if (tag === 'def.type') {
          exportRecords.push(createExportRecord(name, { kind: 'type', ...base }));
        } else if (tag === 'def.mod') {
          exportRecords.push(createExportRecord(name, { kind: 'module', ...base }));
        } else if (tag === 'def.const') {
          exportRecords.push(createExportRecord(name, { kind: 'const', ...base }));
        } else if (tag === 'def.static') {
          exportRecords.push(createExportRecord(name, { kind: 'static', ...base }));
        }
      }
    }
  } catch {
    return parseRustRegex(content);
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

module.exports = { parseRust };
