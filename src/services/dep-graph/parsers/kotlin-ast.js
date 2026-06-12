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

function getDecorators(node) {
  const decorators = [];
  const modifiers = node.children.find((c) => c.type === 'modifiers');
  if (!modifiers) return decorators;

  for (const child of modifiers.children) {
    if (child.type !== 'annotation') continue;
    // annotation -> @ (user_type | constructor_invocation)
    const invocation = child.children.find(
      (c) => c.type === 'user_type' || c.type === 'constructor_invocation'
    );
    if (!invocation) continue;
    const userType =
      invocation.type === 'user_type'
        ? invocation
        : invocation.children.find((c) => c.type === 'user_type');
    if (!userType) continue;
    const name = getNodeText(userType).trim();
    if (name) decorators.push(name);
  }

  return decorators;
}

function getReturnType(node) {
  const colonIdx = node.children.findIndex((c) => c.type === ':');
  if (colonIdx === -1 || colonIdx + 1 >= node.children.length) return null;
  const text = getNodeText(node.children[colonIdx + 1]).trim();
  return text || null;
}

const KOTLIN_FINGERPRINT_MAX_CALLEES = 20;

const KOTLIN_NESTED_DEFINITION_TYPES = new Set([
  'function_declaration',
  'anonymous_function',
  'lambda_literal',
  'class_declaration',
  'object_declaration',
]);

function getParameterCount(funcNode) {
  const params = funcNode.children.find((c) => c.type === 'function_value_parameters');
  if (!params) return 0;
  return params.children.filter((c) => c.type === 'parameter').length;
}

function isAsyncFunction(funcNode) {
  const modifiers = funcNode.children.find((c) => c.type === 'modifiers');
  if (!modifiers) return false;
  return modifiers.children.some((c) => {
    if (c.type !== 'function_modifier') return false;
    return getNodeText(c).trim() === 'suspend';
  });
}

function getCallName(node) {
  const callee = node.children.find((c) => c.type !== 'call_suffix');
  if (!callee) return null;
  const text = getNodeText(callee).trim();
  return text || null;
}

function countKotlinIfElseArms(node, seenIfs) {
  seenIfs.add(node);
  let ifNodeCount = 1;
  let curr = node;

  while (true) {
    const elseIdx = curr.children.findIndex((c) => c.type === 'else');
    if (elseIdx === -1 || elseIdx + 1 >= curr.children.length) break;
    const elseBody = curr.children[elseIdx + 1];
    if (!elseBody || elseBody.type !== 'control_structure_body') break;
    const nestedIf = elseBody.children.find((c) => c.type === 'if_expression');
    if (!nestedIf) break;
    seenIfs.add(nestedIf);
    ifNodeCount += 1;
    curr = nestedIf;
  }

  let hasElse = false;
  const elseIdx = curr.children.findIndex((c) => c.type === 'else');
  if (elseIdx !== -1 && elseIdx + 1 < curr.children.length) {
    const elseBody = curr.children[elseIdx + 1];
    if (elseBody && elseBody.type === 'control_structure_body') {
      const nestedIf = elseBody.children.find((c) => c.type === 'if_expression');
      if (!nestedIf) hasElse = true;
    }
  }

  return [ifNodeCount, ifNodeCount + (hasElse ? 1 : 0)];
}

function computeKotlinFunctionFingerprint(funcNode) {
  let branchCount = 0;
  let returnCount = 0;
  let maxSwitchArms = 0;
  let maxIfElseArms = 0;
  let hasTryCatch = false;
  const callCallees = new Set();
  const seenIfs = new Set();

  const body = funcNode.children.find((c) => c.type === 'function_body');
  if (!body) {
    return {
      paramCount: getParameterCount(funcNode),
      isAsync: isAsyncFunction(funcNode),
      isGenerator: false,
      hasTryCatch: false,
      branchCount: 0,
      returnCount: 0,
      maxArms: 0,
      callCallees: [],
    };
  }

  const stack = [body];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;

    if (KOTLIN_NESTED_DEFINITION_TYPES.has(node.type) && node !== funcNode) {
      continue;
    }

    const type = node.type;

    if (type === 'if_expression') {
      if (!seenIfs.has(node)) {
        const [ifNodeCount, arms] = countKotlinIfElseArms(node, seenIfs);
        branchCount += ifNodeCount;
        maxIfElseArms = Math.max(maxIfElseArms, arms);
      }
    } else if (type === 'when_entry') {
      branchCount += 1;
    } else if (type === 'when_expression') {
      const entries = node.children.filter((c) => c.type === 'when_entry');
      maxSwitchArms = Math.max(maxSwitchArms, entries.length);
    } else if (type === 'catch_block') {
      branchCount += 1;
      hasTryCatch = true;
    } else if (
      type === 'for_statement' ||
      type === 'while_statement' ||
      type === 'do_while_statement'
    ) {
      branchCount += 1;
    } else if (
      type === 'conjunction_expression' ||
      type === 'disjunction_expression' ||
      type === 'elvis_expression'
    ) {
      branchCount += 1;
    } else if (type === 'jump_expression') {
      const firstChild = node.children[0];
      if (firstChild && getNodeText(firstChild).trim() === 'return') {
        returnCount += 1;
      }
    } else if (type === 'call_expression') {
      const name = getCallName(node);
      if (name) callCallees.add(name);
    }

    for (const child of node.children) {
      stack.push(child);
    }
  }

  return {
    paramCount: getParameterCount(funcNode),
    isAsync: isAsyncFunction(funcNode),
    isGenerator: false,
    hasTryCatch,
    branchCount,
    returnCount,
    maxArms: Math.max(maxSwitchArms, maxIfElseArms),
    callCallees: Array.from(callCallees).sort().slice(0, KOTLIN_FINGERPRINT_MAX_CALLEES),
  };
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
          const fingerprint = computeKotlinFunctionFingerprint(parent);
          functionRecords.push({
            name,
            kind: 'function',
            isExported: isExported(parent),
            decorators: getDecorators(parent),
            returnType: getReturnType(parent),
            fingerprint,
            branchCount: fingerprint.branchCount,
            maxArms: fingerprint.maxArms,
            ...base,
          });
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

module.exports = { parseKotlin };
