const path = require('path');
const {
  uniqueNames,
  exportKindFromDeclarationType,
  createExportRecord,
  isFunctionLikeNode,
  buildFunctionFingerprint,
  normalizeImportedName,
  parseNamedBindings,
  createImportRecord,
} = require('../shared');

let babelParser = null;
try {
  babelParser = require('@babel/parser');
} catch {
  // babel parser not available, fallback to regex
}

let warnedMissingParser = false;

const DECL_KIND_MAP = {
  function: 'function',
  class: 'class',
  const: 'variable',
  let: 'variable',
  var: 'variable',
};

const AST_SKIP_KEYS = new Set(['type', 'loc', 'start', 'end']);

const VUE_COMPILER_MACROS = new Set([
  'defineProps',
  'defineEmits',
  'defineExpose',
  'defineOptions',
  'defineSlots',
  'defineModel',
]);

function walkAST(node, callback, parent = null, ancestors = []) {
  if (!node || typeof node !== 'object') return;
  callback(node, parent, ancestors);
  const nextAncestors = [node, ...ancestors];
  for (const key of Object.keys(node)) {
    if (AST_SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) walkAST(c, callback, node, nextAncestors);
    } else if (child && typeof child === 'object') {
      walkAST(child, callback, node, nextAncestors);
    }
  }
}

function getPropertyName(prop) {
  if (prop.key?.type === 'Identifier') return prop.key.name;
  if (prop.key?.type === 'StringLiteral') return prop.key.value;
  return null;
}

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

function extractDecoratorNames(node) {
  if (!Array.isArray(node.decorators)) return [];
  return node.decorators
    .map((decorator) => {
      const expr = decorator?.expression;
      if (!expr) return null;
      if (expr.type === 'Identifier') return expr.name;
      if (expr.type === 'CallExpression') {
        const callee = expr.callee;
        if (callee?.type === 'Identifier') return callee.name;
        if (callee?.type === 'MemberExpression') {
          const parts = [];
          let current = callee;
          while (current?.type === 'MemberExpression') {
            if (current.property?.type === 'Identifier') parts.unshift(current.property.name);
            current = current.object;
          }
          if (current?.type === 'Identifier') parts.unshift(current.name);
          return parts.join('.') || null;
        }
      }
      if (expr.type === 'MemberExpression') {
        const parts = [];
        let current = expr;
        while (current?.type === 'MemberExpression') {
          if (current.property?.type === 'Identifier') parts.unshift(current.property.name);
          current = current.object;
        }
        if (current?.type === 'Identifier') parts.unshift(current.name);
        return parts.join('.') || null;
      }
      return null;
    })
    .filter(Boolean);
}

function extractReturnType(node) {
  if (!node.returnType) return null;
  const annotation = node.returnType.typeAnnotation;
  if (!annotation) return null;

  if (annotation.type === 'TSTypeReference') {
    if (annotation.typeName?.type === 'Identifier') return annotation.typeName.name;
    if (annotation.typeName?.type === 'TSQualifiedName') {
      const parts = [];
      let current = annotation.typeName;
      while (current?.type === 'TSQualifiedName') {
        if (current.right?.type === 'Identifier') parts.unshift(current.right.name);
        current = current.left;
      }
      if (current?.type === 'Identifier') parts.unshift(current.name);
      return parts.join('.') || annotation.type;
    }
  }
  if (annotation.type === 'TSStringKeyword') return 'string';
  if (annotation.type === 'TSNumberKeyword') return 'number';
  if (annotation.type === 'TSBooleanKeyword') return 'boolean';
  if (annotation.type === 'TSVoidKeyword') return 'void';
  if (annotation.type === 'TSAnyKeyword') return 'any';
  if (annotation.type === 'TSUnknownKeyword') return 'unknown';
  if (annotation.type === 'TSNeverKeyword') return 'never';
  if (annotation.type === 'TSUndefinedKeyword') return 'undefined';
  if (annotation.type === 'TSNullKeyword') return 'null';
  if (annotation.type === 'TSObjectKeyword') return 'object';
  if (annotation.type === 'TSSymbolKeyword') return 'symbol';
  if (annotation.type === 'TSThisType') return 'this';
  if (annotation.type === 'TSArrayType') return 'Array';
  if (annotation.type === 'TSFunctionType') return 'Function';
  if (annotation.type === 'TSParenthesizedType') return extractReturnType({ returnType: { typeAnnotation: annotation.typeAnnotation } });
  if (annotation.type === 'TSUnionType') {
    return annotation.types
      .map((t) => extractReturnType({ returnType: { typeAnnotation: t } }))
      .filter(Boolean)
      .join(' | ');
  }
  if (annotation.type === 'TSLiteralType' && annotation.literal) {
    return annotation.literal.value !== undefined ? String(annotation.literal.value) : annotation.literal.type;
  }
  return annotation.type || null;
}

function pushFunctionRecord(records, name, node, options = {}) {
  const fingerprint = buildFunctionFingerprint(node);
  const record = createExportRecord(name, {
    kind: 'function',
    lineStart: node.loc?.start?.line,
    lineEnd: node.loc?.end?.line,
    fingerprint,
  });
  record.isExported = Boolean(options.isExported);
  record.returnType = options.returnType !== undefined ? options.returnType : extractReturnType(node);
  record.decorators = Array.isArray(options.decorators) ? options.decorators : extractDecoratorNames(node);
  record.branchCount = fingerprint ? fingerprint.branchCount : 0;
  record.maxArms = fingerprint ? fingerprint.maxArms : 0;
  records.push(record);
}

module.exports = {
  path,
  uniqueNames,
  exportKindFromDeclarationType,
  createExportRecord,
  isFunctionLikeNode,
  buildFunctionFingerprint,
  normalizeImportedName,
  parseNamedBindings,
  createImportRecord,
  
  babelParser,
  getWarnedMissingParser: () => warnedMissingParser,
  setWarnedMissingParser: (val) => { warnedMissingParser = val; },
  
  DECL_KIND_MAP,
  AST_SKIP_KEYS,
  VUE_COMPILER_MACROS,
  
  walkAST,
  getPropertyName,
  buildExportRecordFromValue,
  pushFunctionRecord,
};
