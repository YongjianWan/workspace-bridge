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

function walkAST(node, callback, parent = null) {
  if (!node || typeof node !== 'object') return;
  callback(node, parent);
  for (const key of Object.keys(node)) {
    if (AST_SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) walkAST(c, callback, node);
    } else if (child && typeof child === 'object') {
      walkAST(child, callback, node);
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

function pushFunctionRecord(records, name, node) {
  const fingerprint = buildFunctionFingerprint(node);
  records.push(createExportRecord(name, {
    kind: 'function',
    lineStart: node.loc?.start?.line,
    lineEnd: node.loc?.end?.line,
    fingerprint,
  }));
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
