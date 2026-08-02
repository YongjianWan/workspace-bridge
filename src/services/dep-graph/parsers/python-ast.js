/**
 * Python parser — tree-sitter WASM in-process path (L3-9).
 *
 * Drop-in replacement for the spawned scripts/python_ast_parser.py: emits the
 * same raw JSON shape, and python.js normalizes both through
 * normalizePythonAstResult(). Semantics mirrored from the CPython ast version:
 *  - imports walk the WHOLE tree in BFS order (ast.walk equivalent);
 *  - `from .`/`..` levels become dot prefixes;
 *  - exports/exportRecords/functionRecords only from module-level defs,
 *    underscore-prefixed names excluded;
 *  - __all__ overrides the exports list and re-judges functionRecords.isExported;
 *  - fingerprint: if-elif chains count once, BoolOp adds len(values)-1, etc.;
 *  - syntax-broken source returns an EMPTY result (not regex fallback) —
 *    tree-sitter is error-tolerant, so rootNode.hasError gates this.
 * Known exception vs CPython: `# type:` comments are invisible to tree-sitter,
 * so hasParameterTypeHints only sees real annotations (documented in CHANGELOG).
 *
 * Returns null when the WASM toolchain itself is unavailable (caller falls
 * back to regex), mirroring the spawn path's env-failure contract.
 */

const {
  getParserModule,
  loadLanguage,
  getNodeText,
  getLineStart,
} = require('./tree-sitter');

// CPython skips nested FunctionDef/AsyncFunctionDef/ClassDef subtrees in the
// fingerprint walk; decorated_definition wraps those, and without it here the
// decorator EXPRESSIONS of nested defs (e.g. an IfExp in decorator arguments)
// would leak into the outer function's branch count.
const NESTED_DEFINITION_TYPES = new Set([
  'function_definition',
  'class_definition',
  'decorated_definition',
]);

function emptyAstResult(error) {
  const result = { imports: [], exports: [], importRecords: [], exportRecords: [], functionRecords: [] };
  if (error) result.error = error;
  return result;
}

function fieldChildren(node, fieldName) {
  const out = [];
  for (let i = 0; i < node.childCount; i++) {
    if (node.fieldNameForChild(i) === fieldName) out.push(node.child(i));
  }
  return out;
}

// --- imports ----------------------------------------------------------------

function extractImportStatement(node, imports, importRecords) {
  // import a, import a.b, import a as b — per-alias record, symbols unknown.
  for (const child of node.children) {
    let target = null;
    if (child.type === 'dotted_name') target = child;
    else if (child.type === 'aliased_import') target = child.childForFieldName('name');
    if (!target) continue;
    const moduleName = getNodeText(target);
    imports.push(moduleName);
    importRecords.push({ source: moduleName, imported: [], usesAllExports: true });
  }
}

function extractImportFromStatement(node, imports, importRecords) {
  const moduleNode = node.childForFieldName('module_name');
  let module = '';
  if (moduleNode) {
    if (moduleNode.type === 'relative_import') {
      // (relative_import (import_prefix) (dotted_name)?) — prefix text is the dots.
      const prefix = moduleNode.children.find((c) => c.type === 'import_prefix');
      const dotted = moduleNode.children.find((c) => c.type === 'dotted_name');
      module = (prefix ? getNodeText(prefix) : '') + (dotted ? getNodeText(dotted) : '');
    } else {
      module = getNodeText(moduleNode);
    }
  }

  const imported = [];
  let usesAllExports = false;
  for (const nameNode of fieldChildren(node, 'name')) {
    if (nameNode.type === 'aliased_import') {
      const orig = nameNode.childForFieldName('name');
      if (orig) imported.push(getNodeText(orig));
    } else {
      imported.push(getNodeText(nameNode));
    }
  }
  if (node.children.some((c) => c.type === 'wildcard_import')) {
    usesAllExports = true;
  }

  imports.push(module);
  importRecords.push({ source: module, imported, usesAllExports });
}

/** `from __future__ import x` is its own node type, not import_from_statement. */
function extractFutureImportStatement(node, imports, importRecords) {
  const imported = fieldChildren(node, 'name').map((n) => getNodeText(n));
  imports.push('__future__');
  importRecords.push({ source: '__future__', imported, usesAllExports: false });
}

/**
 * ast.walk equivalent: BFS over CPython's node hierarchy. Two structural
 * mismatches vs tree-sitter must be bridged:
 *  - ast has no block/decorator-wrapper/else/finally nodes — those are
 *    transparent, their children hang on the nearest real ancestor's level.
 *  - ast models `elif` as a NESTED If in orelse, so `else:` branch statements
 *    are children of the LAST elif, one level deeper than tree-sitter's
 *    flattened elif_clause siblings would suggest. elseBranchChildren defers
 *    else-children onto the last elif to reproduce that level.
 * Sorting by (depth, position) is NOT equivalent either: same-level order in
 * BFS follows parent discovery order, not global source position.
 */
const TRANSPARENT_ANCESTOR_TYPES = new Set([
  'block',
  'decorated_definition',
  'else_clause',
  'finally_clause',
]);

const elseBranchChildren = new WeakMap();

function effectiveChildren(node) {
  const out = [];
  const elifs = [];
  let deferredElse = null;
  for (const child of node.children) {
    if (node.type === 'if_statement' && child.type === 'elif_clause') {
      elifs.push(child); // nested in ast: only the first hangs on this level
    } else if (node.type === 'if_statement' && child.type === 'else_clause' && elifs.length > 0) {
      deferredElse = child;
    } else if (TRANSPARENT_ANCESTOR_TYPES.has(child.type)) {
      out.push(...effectiveChildren(child));
    } else {
      out.push(child);
    }
  }
  if (elifs.length > 0) {
    out.push(elifs[0]);
    for (let k = 0; k + 1 < elifs.length; k++) {
      elseBranchChildren.set(elifs[k], [elifs[k + 1]]);
    }
    if (deferredElse) {
      elseBranchChildren.set(elifs[elifs.length - 1], deferredElse.children);
    }
  }
  const extra = elseBranchChildren.get(node);
  if (extra) {
    for (const child of extra) {
      if (TRANSPARENT_ANCESTOR_TYPES.has(child.type)) {
        out.push(...effectiveChildren(child));
      } else {
        out.push(child);
      }
    }
  }
  return out;
}

function collectImports(rootNode, imports, importRecords) {
  const found = [];
  const queue = [rootNode];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (
      node.type === 'import_statement' ||
      node.type === 'import_from_statement' ||
      node.type === 'future_import_statement'
    ) {
      found.push(node);
    }
    for (const child of effectiveChildren(node)) queue.push(child);
  }

  for (const node of found) {
    if (node.type === 'import_statement') {
      extractImportStatement(node, imports, importRecords);
    } else if (node.type === 'import_from_statement') {
      extractImportFromStatement(node, imports, importRecords);
    } else {
      extractFutureImportStatement(node, imports, importRecords);
    }
  }
}

// --- module-level exports ---------------------------------------------------

function getDefName(node) {
  const nameNode = node.childForFieldName('name');
  return nameNode ? getNodeText(nameNode) : null;
}

/**
 * CPython end_lineno is the end of the LAST STATEMENT; tree-sitter blocks also
 * swallow trailing comments. Take the max end row over every non-comment node
 * in the subtree — that is exactly the last statement's final token.
 */
function getDefLineEnd(defNode) {
  // CPython end_lineno is the end of the last STATEMENT; tree-sitter container
  // spans (block, class/function bodies) extend over trailing comments, so the
  // container's own endPosition is too late. Effective end = max over
  // non-comment children's effective ends; own end only when no such child.
  function effectiveEndRow(node) {
    let max = -1;
    for (const child of node.children) {
      if (child.type === 'comment') continue;
      const row = effectiveEndRow(child);
      if (row > max) max = row;
    }
    return max === -1 ? node.endPosition.row : max;
  }
  return effectiveEndRow(defNode) + 1;
}

function extractAllExports(valueNode) {
  // CPython extract_all_exports returns [] (not None) for a non-literal value
  // — `__all__ = ['x'] + other.__all__` still OVERRIDES exports with empty.
  if (!valueNode || (valueNode.type !== 'list' && valueNode.type !== 'tuple')) return [];
  const names = [];
  for (const child of valueNode.children) {
    if (child.type !== 'string') continue;
    const content = child.children.find((c) => c.type === 'string_content');
    names.push(content ? getNodeText(content) : getNodeText(child).replace(/^['"]|['"]$/g, ''));
  }
  return names;
}

/**
 * __all__ assignment at module level. CPython iterates tree.body and each
 * assignment overwrites — the LAST one wins (null only when never assigned).
 * Chained `a = __all__ = [...]` unwraps right-assoc.
 */
function findAllAssignment(moduleNode) {
  let allNames = null;
  for (const stmt of moduleNode.children) {
    if (stmt.type !== 'expression_statement') continue;
    let assign = stmt.children.find((c) => c.type === 'assignment');
    while (assign) {
      const left = assign.childForFieldName('left');
      const right = assign.childForFieldName('right');
      if (left && left.type === 'identifier' && getNodeText(left) === '__all__') {
        allNames = extractAllExports(right);
      }
      assign = right && right.type === 'assignment' ? right : null;
    }
  }
  return allNames;
}

// --- decorators / return type / params --------------------------------------

function extractDecoratorName(exprNode) {
  if (!exprNode) return null;
  if (exprNode.type === 'identifier' || exprNode.type === 'attribute') {
    return getNodeText(exprNode) || null;
  }
  if (exprNode.type === 'call') {
    return extractDecoratorName(exprNode.childForFieldName('function'));
  }
  return null;
}

function extractDecorators(decoratedNode, funcNode) {
  const source = decoratedNode || funcNode;
  const decorators = [];
  for (const child of source.children) {
    if (child.type !== 'decorator') continue;
    const expr = child.children.find((c) => c.isNamed);
    const name = extractDecoratorName(expr);
    if (name) decorators.push(name);
  }
  return decorators;
}

// --- returnType: ast.unparse approximation ----------------------------------

/** Skip a normalized string literal starting at s[i] (quote char), return index after close. */
function skipStringLiteral(s, i) {
  const quote = s[i];
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === '\\') { j += 2; continue; }
    if (s[j] === quote) return j + 1;
    j++;
  }
  return s.length;
}

/** True when s starts with '(' whose match is the final ')'. */
function wrapsWhole(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") { i = skipStringLiteral(s, i) - 1; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (depth === 0 && i < s.length - 1) return false;
  }
  return depth === 0;
}

/** Top-level (depth 0, outside strings) comma — tuple annotations keep parens. */
function hasTopLevelComma(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") { i = skipStringLiteral(s, i) - 1; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
}

/**
 * Token-level approximation of ast.unparse for annotation expressions (the
 * spawn version reprints the annotation instead of copying source text):
 * whitespace around [, ], comma and |; string-literal quote normalization;
 * redundant outer parens stripped (tuple parens kept). String contents are
 * never touched. Corners this does NOT reach (lambda/walrus/conditional
 * annotations, weird-but-legal spacing inside nested calls) are documented in
 * CHANGELOG — PEP8/black-formatted corpora already satisfy unparse output
 * verbatim (437 reference files: zero hits before this normalizer existed).
 */
function normalizeTypeText(text) {
  const tokens = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) tokens.push({ isString: false, text: buf });
    buf = '';
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      flush();
      const triple = text.startsWith(ch.repeat(3), i);
      const endMark = triple ? ch.repeat(3) : ch;
      let j = i + endMark.length;
      let inner = '';
      while (j < text.length && !text.startsWith(endMark, j)) {
        if (text[j] === '\\') { inner += text[j] + (text[j + 1] || ''); j += 2; continue; }
        inner += text[j];
        j++;
      }
      tokens.push({ isString: true, text: inner });
      i = j + endMark.length;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();

  const normalized = tokens
    .map((t) => {
      if (t.isString) {
        return t.text.includes("'") && !t.text.includes('"') ? `"${t.text}"` : `'${t.text}'`;
      }
      return t.text
        .replace(/\s+/g, ' ')
        .replace(/\[\s+/g, '[')
        .replace(/\s+\]/g, ']')
        .replace(/\s*,\s*/g, ', ')
        .replace(/,\s*([)\]])/g, '$1')
        .replace(/\s*\|\s*/g, ' | ');
    })
    .join('')
    .trim();

  let out = normalized;
  while (out.length > 2 && out.startsWith('(') && out.endsWith(')') && wrapsWhole(out)) {
    const inner = out.slice(1, -1).trim();
    if (hasTopLevelComma(inner)) break;
    out = inner;
  }
  return out;
}

function extractReturnType(funcNode) {
  const typeNode = funcNode.childForFieldName('return_type');
  if (!typeNode) return null;
  const text = normalizeTypeText(getNodeText(typeNode).trim());
  return text || null;
}

/**
 * CPython parity: len(args.args) + len(kwonlyargs) + vararg + kwarg.
 * args.args excludes positional-only params — those sit BEFORE the `/`
 * separator, so named params count only at index > separator (or everywhere
 * when there is none).
 */
const COUNTED_PARAMETER_TYPES = new Set([
  'identifier',
  'default_parameter',
  'typed_parameter',
  'typed_default_parameter',
]);

function countParameters(paramsNode) {
  if (!paramsNode) return 0;
  const children = paramsNode.children;
  const sepIndex = children.findIndex((c) => c.type === 'positional_separator');
  let count = 0;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'list_splat_pattern' || child.type === 'dictionary_splat_pattern') {
      count++;
    } else if (COUNTED_PARAMETER_TYPES.has(child.type) && (sepIndex === -1 || i > sepIndex)) {
      count++;
    }
  }
  return count;
}

function hasParameterTypeHints(paramsNode) {
  if (!paramsNode) return false;
  const stack = [paramsNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.type === 'typed_parameter' || node.type === 'typed_default_parameter') return true;
    for (const child of node.children) stack.push(child);
  }
  return false;
}

// --- fingerprint --------------------------------------------------------------

/**
 * CPython cannot tell `elif` apart from `else:` holding a single `if` — both
 * are an If inside orelse, and the spawn version chains through BOTH. Mirror
 * that: after the flattened elif run, an else whose block holds exactly one
 * if_statement continues the chain (and the nested if is marked seen so the
 * walker does not count it again, ast's seen_ifs equivalent).
 */
function countIfElseArms(ifNode, seenIfs) {
  let ifNodeCount = 1;
  let hasElse = false;
  let curr = ifNode;

  while (true) {
    ifNodeCount += curr.children.filter((c) => c.type === 'elif_clause').length;
    const elseClause = curr.children.find((c) => c.type === 'else_clause');
    if (!elseClause) break;
    const block = elseClause.children.find((c) => c.type === 'block');
    const stmts = block ? block.children.filter((c) => c.type !== 'comment') : [];
    if (stmts.length === 1 && stmts[0].type === 'if_statement') {
      seenIfs.add(stmts[0]);
      ifNodeCount += 1;
      curr = stmts[0];
      continue;
    }
    hasElse = true;
    break;
  }

  return [ifNodeCount, ifNodeCount + (hasElse ? 1 : 0)];
}

function computeFunctionFingerprint(funcNode) {
  let branchCount = 0;
  let returnCount = 0;
  let maxSwitchArms = 0;
  let maxIfElseArms = 0;
  let hasTryCatch = false;
  const seenIfs = new Set();

  const body = funcNode.childForFieldName('body');
  const paramsNode = funcNode.childForFieldName('parameters');

  if (body) {
    const stack = [...body.children];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;

      if (NESTED_DEFINITION_TYPES.has(node.type)) continue;

      switch (node.type) {
        case 'match_statement': {
          const cases = [];
          const matchBody = node.childForFieldName('body');
          if (matchBody) {
            for (const child of matchBody.children) {
              if (child.type === 'case_clause') cases.push(child);
            }
          }
          maxSwitchArms = Math.max(maxSwitchArms, cases.length);
          break;
        }
        case 'if_statement': {
          if (!seenIfs.has(node)) {
            const [ifNodeCount, arms] = countIfElseArms(node, seenIfs);
            branchCount += ifNodeCount;
            maxIfElseArms = Math.max(maxIfElseArms, arms);
          }
          break;
        }
        case 'for_statement':
          // ast.AsyncFor is NOT a subclass of ast.For — the spawn version
          // does not count async-for as a branch.
          if (!node.children.some((c) => c.type === 'async')) {
            branchCount += 1;
          }
          break;
        case 'while_statement':
        case 'conditional_expression':
          branchCount += 1;
          break;
        case 'except_clause':
          branchCount += 1;
          hasTryCatch = true;
          break;
        case 'try_statement':
          hasTryCatch = true;
          break;
        case 'case_clause':
          branchCount += 1;
          break;
        case 'boolean_operator': {
          // len(values) - 1 in CPython == operator token count here.
          const ops = node.children.filter((c) => c.type === 'and' || c.type === 'or').length;
          branchCount += ops;
          break;
        }
        case 'return_statement':
          returnCount += 1;
          break;
      }

      for (const child of node.children) stack.push(child);
    }
  }

  return {
    paramCount: countParameters(paramsNode),
    isAsync: funcNode.children.some((c) => c.type === 'async'),
    isGenerator: false,
    hasTryCatch,
    branchCount,
    returnCount,
    maxArms: Math.max(maxSwitchArms, maxIfElseArms),
    callCallees: [],
  };
}

// --- main --------------------------------------------------------------------

async function parsePythonAst(content) {
  let parser;
  let language;
  try {
    const mod = await getParserModule();
    if (!mod) return null;
    language = await loadLanguage('python');
    if (!language) return null;
    parser = new mod.Parser();
    parser.setLanguage(language);
  } catch {
    return null;
  }

  let tree;
  try {
    tree = parser.parse(content);
  } catch {
    try { if (parser) parser.delete(); } catch {}
    return null;
  }

  try {
    const rootNode = tree.rootNode;

    // CPython ast.parse raises SyntaxError -> spawn version returns an empty
    // result. tree-sitter is error-tolerant; hasError is the equivalent gate.
    if (rootNode.hasError) {
      return emptyAstResult('Syntax error');
    }

    const imports = [];
    const importRecords = [];
    const exports = [];
    const exportRecords = [];
    const functionRecords = [];

    // Module-level pass: defs + __all__ (tree.body equivalent — no nesting).
    let allExportNames = findAllAssignment(rootNode);

    for (const stmt of rootNode.children) {
      let defNode = stmt;
      let decoratedNode = null;
      if (stmt.type === 'decorated_definition') {
        decoratedNode = stmt;
        defNode = stmt.childForFieldName('definition') || stmt.children[stmt.childCount - 1];
      }
      if (!defNode) continue;

      if (defNode.type === 'class_definition') {
        const name = getDefName(defNode);
        if (!name || name.startsWith('_')) continue;
        exports.push(name);
        exportRecords.push({
          name,
          kind: 'class',
          lineStart: getLineStart(defNode),
          lineEnd: getDefLineEnd(defNode),
        });
        continue;
      }

      if (defNode.type === 'function_definition') {
        const name = getDefName(defNode);
        if (!name || name.startsWith('_')) continue;
        const fingerprint = computeFunctionFingerprint(defNode);
        const base = {
          name,
          kind: 'function',
          lineStart: getLineStart(defNode),
          lineEnd: getDefLineEnd(defNode),
        };
        exports.push(name);
        exportRecords.push({ ...base, fingerprint });
        functionRecords.push({
          ...base,
          fingerprint,
          decorators: extractDecorators(decoratedNode, defNode),
          returnType: extractReturnType(defNode),
          hasParameterTypeHints: hasParameterTypeHints(defNode.childForFieldName('parameters')),
          isExported: true,
          branchCount: fingerprint.branchCount,
          maxArms: fingerprint.maxArms,
        });
      }
    }

    // Imports: whole-tree BFS (ast.walk equivalent).
    collectImports(rootNode, imports, importRecords);

    // __all__ overrides the exports list and re-judges isExported.
    let finalExports = exports;
    if (allExportNames !== null) {
      finalExports = allExportNames;
      const allSet = new Set(allExportNames);
      for (const record of functionRecords) {
        record.isExported = allSet.has(record.name);
      }
    }

    const uniqueImports = [...new Set(imports)];
    const uniqueExports = [...new Set(finalExports)];
    const seenSources = new Set();
    const uniqueImportRecords = importRecords.filter((record) => {
      if (seenSources.has(record.source)) return false;
      seenSources.add(record.source);
      return true;
    });

    return {
      imports: uniqueImports,
      exports: uniqueExports,
      importRecords: uniqueImportRecords,
      exportRecords,
      functionRecords,
    };
  } catch {
    return null;
  } finally {
    try { if (tree) tree.delete(); } catch {}
    try { if (parser) parser.delete(); } catch {}
  }
}

module.exports = { parsePythonAst };
