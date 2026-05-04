const FUNCTION_FINGERPRINT_MAX_CALLEES = 20;

// AST keys to skip during generic traversal (avoid infinite loops / noise).
const AST_SKIP_KEYS = new Set(['type', 'loc', 'start', 'end']);

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
      if (AST_SKIP_KEYS.has(key)) continue;
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
    callCallees: Array.from(callCallees).sort().slice(0, FUNCTION_FINGERPRINT_MAX_CALLEES),
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

module.exports = {
  uniqueNames,
  exportKindFromDeclarationType,
  createExportRecord,
  isFunctionLikeNode,
  getCallName,
  buildFunctionFingerprint,
  normalizeImportedName,
  parseNamedBindings,
  createImportRecord,
};
