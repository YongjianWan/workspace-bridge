const {
  getParserModule,
  loadLanguage,
  getNodeText,
  getLineStart,
  getLineEnd,
} = require('./tree-sitter');
const { uniqueNames, createExportRecord, createImportRecord } = require('./shared');
const { parseKotlin: parseKotlinRegex } = require('./polyglot');

const KOTLIN_QUERY = `
(import_header (identifier) @import.source)
(class_declaration (type_identifier) @def.class)
(object_declaration (type_identifier) @def.object)
(function_declaration (simple_identifier) @def.func)
(property_declaration (variable_declaration (simple_identifier) @def.prop))
(type_alias (type_identifier) @def.alias)
`;

function getVisibility(node) {
  const modifiers = node.children.find((c) => c.type === 'modifiers');
  if (!modifiers) return 'public';
  const visMod = modifiers.children.find((c) => c.type === 'visibility_modifier');
  return visMod ? getNodeText(visMod) : 'public';
}

function isExported(node) {
  const vis = getVisibility(node);
  return vis !== 'private' && vis !== 'internal' && vis !== 'protected';
}

function getClassKind(node) {
  const childTypes = new Set(node.children.map((c) => c.type));
  if (childTypes.has('interface')) return 'interface';
  if (childTypes.has('enum')) return 'enum';
  const modifiers = node.children.find((c) => c.type === 'modifiers');
  if (modifiers) {
    const classMod = modifiers.children.find((c) => c.type === 'class_modifier');
    if (classMod && getNodeText(classMod) === 'data') return 'data_class';
  }
  return 'class';
}

function getPropertyKind(node) {
  const modifiers = node.children.find((c) => c.type === 'modifiers');
  if (modifiers) {
    const propMod = modifiers.children.find((c) => c.type === 'property_modifier');
    if (propMod && getNodeText(propMod) === 'const') return 'const';
  }
  return 'property';
}

function hasWildcardImport(importHeaderNode) {
  return importHeaderNode.children.some((c) => c.type === 'wildcard_import');
}

async function parseKotlin(content) {
  let parser;
  let language;
  try {
    const mod = await getParserModule();
    if (!mod) return parseKotlinRegex(content);
    language = await loadLanguage('kotlin');
    if (!language) return parseKotlinRegex(content);
    parser = new mod.Parser();
    parser.setLanguage(language);
  } catch {
    return parseKotlinRegex(content);
  }

  let tree;
  try {
    tree = parser.parse(content);
  } catch {
    return parseKotlinRegex(content);
  }

  let query;
  try {
    const mod = await getParserModule();
    query = new mod.Query(language, KOTLIN_QUERY);
  } catch {
    return parseKotlinRegex(content);
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
          const parent = capture.node.parent;
          const isWildcard = parent ? hasWildcardImport(parent) : false;
          imports.push(name + (isWildcard ? '.*' : ''));
          const imported = isWildcard ? [] : [name.split('.').pop()];
          importRecords.push(createImportRecord(name, { usesAllExports: isWildcard, imported }));
          continue;
        }

        let parent = capture.node.parent;
        // For property captures, the captured node is simple_identifier inside variable_declaration
        // We need to go up one more level to reach property_declaration
        if (parent && parent.type === 'variable_declaration') {
          parent = parent.parent;
        }
        if (!parent || !isExported(parent)) continue;

        const lineStart = getLineStart(parent);
        const lineEnd = getLineEnd(parent);
        const base = { lineStart, lineEnd };

        if (tag === 'def.class') {
          exportRecords.push(createExportRecord(name, { kind: getClassKind(parent), ...base }));
        } else if (tag === 'def.object') {
          exportRecords.push(createExportRecord(name, { kind: 'object', ...base }));
        } else if (tag === 'def.func') {
          exportRecords.push(createExportRecord(name, { kind: 'function', ...base }));
          functionRecords.push({ name, kind: 'function', ...base });
        } else if (tag === 'def.prop') {
          exportRecords.push(createExportRecord(name, { kind: getPropertyKind(parent), ...base }));
        } else if (tag === 'def.alias') {
          exportRecords.push(createExportRecord(name, { kind: 'type', ...base }));
        }
      }
    }
  } catch {
    return parseKotlinRegex(content);
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

module.exports = { parseKotlin };
