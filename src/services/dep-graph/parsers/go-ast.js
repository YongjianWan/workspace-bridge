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

function extractGoReturnType(parent) {
  if (!parent) return undefined;
  const resultNode = parent.childForFieldName('result');
  if (!resultNode) return undefined;
  const text = getNodeText(resultNode).trim();
  return text || undefined;
}

function countGoIfArms(node) {
  let arms = 1;
  let current = node;
  while (true) {
    const elseIdx = current.children.findIndex((c) => c.type === 'else');
    if (elseIdx === -1 || elseIdx + 1 >= current.children.length) break;
    const alternate = current.children[elseIdx + 1];
    arms += 1;
    if (alternate.type === 'if_statement') {
      current = alternate;
    } else {
      break;
    }
  }
  return arms;
}

function countGoCaseArms(node) {
  return node.children.filter((c) =>
    c.type === 'expression_case' ||
    c.type === 'type_case' ||
    c.type === 'communication_case' ||
    c.type === 'default_case'
  ).length;
}

function hasGoLogicalOperator(node) {
  return node.children.some((c) => !c.isNamed && (c.type === '&&' || c.type === '||'));
}

function buildGoFunctionFingerprint(functionNode) {
  const body = functionNode.children.find((c) => c.type === 'block');
  if (!body) return { branchCount: 0, maxArms: 0 };

  let branchCount = 0;
  let maxArms = 0;
  const stack = [body];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    switch (node.type) {
      case 'if_statement':
        branchCount += 1;
        maxArms = Math.max(maxArms, countGoIfArms(node));
        break;
      case 'expression_switch_statement':
      case 'type_switch_statement':
      case 'select_statement':
        branchCount += 1;
        maxArms = Math.max(maxArms, countGoCaseArms(node));
        break;
      case 'for_statement':
        branchCount += 1;
        break;
      case 'binary_expression':
        if (hasGoLogicalOperator(node)) branchCount += 1;
        break;
      default:
        break;
    }

    for (const child of node.children) {
      stack.push(child);
    }
  }

  return { branchCount, maxArms };
}

function buildGoFunctionRecord(name, parent, captureNode) {
  const fingerprint = buildGoFunctionFingerprint(parent);
  return {
    name,
    kind: 'function',
    isExported: isExportedGoName(name),
    returnType: extractGoReturnType(parent),
    decorators: [],
    hasParameterTypeHints: true,
    lineStart: getLineStart(parent) || getLineStart(captureNode),
    lineEnd: getLineEnd(parent) || getLineEnd(captureNode),
    branchCount: fingerprint.branchCount,
    maxArms: fingerprint.maxArms,
  };
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
          functionRecords.push(buildGoFunctionRecord(name, parent, capture.node));
        } else if (tag === 'def.method') {
          const parent = getParentByTypes(capture.node, ['method_declaration']);
          exportRecords.push(createExportRecord(name, {
            kind: 'function',
            lineStart: getLineStart(parent) || getLineStart(capture.node),
            lineEnd: getLineEnd(parent) || getLineEnd(capture.node),
          }));
          functionRecords.push(buildGoFunctionRecord(name, parent, capture.node));
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

module.exports = { parseGo };
