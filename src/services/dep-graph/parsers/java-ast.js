/**
 * Java parser — tree-sitter WASM in-process path (L3-9 Java half).
 *
 * Drop-in replacement for the spawned scripts/java_ast_parser.py (javalang):
 * emits the same raw JSON shape, judged field-by-field by
 * scripts/parser-parity-java.js. Semantics mirrored from the javalang version:
 *  - package from the package declaration;
 *  - imports keep javalang's `path` shape: static non-wildcard moves the last
 *    segment into `imported`, wildcard appends `.*` to the source;
 *  - exports come from a WHOLE-TREE pre-order walk (javalang's `for path, node
 *    in tree`), so nested / local classes are found too, but anonymous class
 *    bodies are not declarations and yield nothing;
 *  - class/record: name + direct public methods + direct public fields;
 *    interface: name + ALL direct methods; enum / annotation: name only;
 *  - lineStart == lineEnd == the line of the method's RETURN TYPE token (that
 *    is where javalang puts MethodDeclaration.position — not the annotations,
 *    not the modifiers);
 *  - returnType is the leftmost segment of the declared type with generics and
 *    array dimensions dropped (`java.util.List<String>` -> "java"), because
 *    javalang nests qualified names as ReferenceType.sub_type and the spawn
 *    version read only the outermost `.name`;
 *  - fingerprint: every `if` counts once (chained else-ifs included), switch
 *    counts one per javalang SwitchStatementCase — consecutive labels with no
 *    statements between them are ONE case, which tree-sitter splits into
 *    several switch_block_statement_groups.
 *
 * ONE INTENTIONAL DIVERGENCE from the oracle: javalang has no
 * `AnnotationTypeDeclaration` class (it is `AnnotationDeclaration`), so that
 * branch of java_ast_parser.py was dead and `@interface Foo` produced no
 * export at all — while the regex fallback in java.js has always emitted it.
 * This parser emits it (kind 'annotation'), which is why the parity harness
 * counts annotation-declaration diffs separately instead of failing on them.
 *
 * What this buys over javalang 0.13.0 (last release 2020): record(16),
 * sealed(17), text block(15), switch expression(14) and instanceof pattern(16)
 * are parsed instead of failing the whole file into regex mode. Those shapes
 * have no oracle to compare against; they are locked by
 * test/java-tree-sitter-modern-syntax-test.js.
 *
 * Returns null when the WASM toolchain is unavailable OR the source is
 * syntactically broken — both cases make java.js fall back to regex, matching
 * the spawn path's contract (javalang raised -> exit 1 -> null).
 */

const {
  getParserModule,
  loadLanguage,
  getNodeText,
} = require('./tree-sitter');

// javalang's fingerprint walk returns early on these class names. Its list also
// has 'AnonymousClassDeclaration', which javalang never produces — anonymous
// bodies hang off ClassCreator and ARE walked, so tree-sitter's `class_body`
// under object_creation_expression must stay walkable here too.
const NESTED_TYPE_DECLARATIONS = new Set([
  'class_declaration',
  'interface_declaration',
  'enum_declaration',
  'annotation_type_declaration',
  'record_declaration',
]);

const TYPE_DECLARATION_KINDS = new Map([
  ['class_declaration', 'class'],
  ['record_declaration', 'record'],
  ['interface_declaration', 'interface'],
  ['enum_declaration', 'enum'],
  ['annotation_type_declaration', 'annotation'],
]);

function hasModifier(node, keyword) {
  const modifiers = node.children.find((c) => c.type === 'modifiers');
  if (!modifiers) return false;
  return modifiers.children.some((c) => c.type === keyword);
}

// --- package / imports -------------------------------------------------------

function extractPackage(rootNode) {
  const decl = rootNode.children.find((c) => c.type === 'package_declaration');
  if (!decl) return null;
  const name = decl.children.find(
    (c) => c.type === 'scoped_identifier' || c.type === 'identifier'
  );
  return name ? getNodeText(name) : null;
}

function extractImports(rootNode, imports, importRecords) {
  for (const decl of rootNode.children) {
    if (decl.type !== 'import_declaration') continue;
    const isStatic = decl.children.some((c) => c.type === 'static');
    const isWildcard = decl.children.some((c) => c.type === 'asterisk');
    const pathNode = decl.children.find(
      (c) => c.type === 'scoped_identifier' || c.type === 'identifier'
    );
    if (!pathNode) continue;

    let source = getNodeText(pathNode);
    let imported = [];
    if (isStatic && !isWildcard) {
      const parts = source.split('.');
      if (parts.length > 1) {
        imported = [parts[parts.length - 1]];
        source = parts.slice(0, -1).join('.');
      }
    }
    if (isWildcard) source += '.*';

    imports.push(source);
    importRecords.push({
      source,
      imported: isWildcard ? [] : isStatic ? imported : [source.split('.').pop()],
      usesAllExports: isWildcard,
      isStatic,
    });
  }
}

// --- method metadata ---------------------------------------------------------

function getMethodName(methodNode) {
  const nameNode = methodNode.childForFieldName('name');
  return nameNode ? getNodeText(nameNode) : null;
}

/**
 * javalang sets MethodDeclaration.position at the return-type token: for
 * `@Override\npublic\nList<String> f()` it reports the `List` line, not the
 * annotation line and not the `public` line. Both lineStart and lineEnd get
 * that single number (the spawn version never computed a real end line).
 */
function getMethodLine(methodNode) {
  const typeNode = methodNode.childForFieldName('type');
  const anchor = typeNode || methodNode;
  return anchor.startPosition.row + 1;
}

/** Leftmost segment of a declared type, generics and array dimensions dropped. */
function baseTypeName(typeNode) {
  if (!typeNode) return null;
  switch (typeNode.type) {
    case 'void_type':
      return null;
    case 'array_type':
      return baseTypeName(typeNode.childForFieldName('element'));
    case 'generic_type':
      return baseTypeName(typeNode.children.find((c) => c.isNamed && c.type !== 'type_arguments'));
    case 'scoped_type_identifier':
      return baseTypeName(typeNode.children.find((c) => c.isNamed));
    case 'annotated_type':
      return baseTypeName(typeNode.children.filter((c) => c.isNamed).pop());
    default: {
      const text = getNodeText(typeNode).trim();
      return text || null;
    }
  }
}

function extractReturnType(methodNode) {
  return baseTypeName(methodNode.childForFieldName('type'));
}

/** Annotation names without the leading '@', qualified names kept whole. */
function extractDecorators(methodNode) {
  const modifiers = methodNode.children.find((c) => c.type === 'modifiers');
  if (!modifiers) return [];
  const decorators = [];
  for (const child of modifiers.children) {
    if (child.type !== 'marker_annotation' && child.type !== 'annotation') continue;
    const nameNode = child.childForFieldName('name');
    if (nameNode) decorators.push(getNodeText(nameNode));
  }
  return decorators;
}

function countParameters(methodNode) {
  const params = methodNode.childForFieldName('parameters');
  if (!params) return 0;
  return params.children.filter(
    (c) => c.type === 'formal_parameter' || c.type === 'spread_parameter'
  ).length;
}

// --- fingerprint -------------------------------------------------------------

/**
 * javalang collapses a run of labels with no statements between them into ONE
 * SwitchStatementCase (`case 1: case 2: break;` is a single case with two
 * values), while tree-sitter emits one switch_block_statement_group per label
 * run element. Replay javalang: a group carrying statements closes a case; a
 * trailing statement-less run still counts as one.
 * Arrow-form `switch_rule` (Java 14+) is one case each — no oracle for it.
 */
function countSwitchCases(switchBlockNode) {
  let cases = 0;
  let pendingLabels = false;
  for (const child of switchBlockNode.children) {
    if (child.type === 'switch_rule') {
      cases += 1;
      continue;
    }
    if (child.type !== 'switch_block_statement_group') continue;
    const hasStatements = child.children.some((c) => c.isNamed && c.type !== 'switch_label');
    if (hasStatements) {
      cases += 1;
      pendingLabels = false;
    } else {
      pendingLabels = true;
    }
  }
  return cases + (pendingLabels ? 1 : 0);
}

/**
 * javalang walks `else_statement` while it is another IfStatement, marking each
 * link seen so the outer walk does not recompute arms — but branch_count still
 * ticks once per IfStatement node. Arms = number of ifs in the chain, plus one
 * when the chain ends on a non-if else.
 */
function countIfElseArms(ifNode, seenIfs) {
  let arms = 1;
  let curr = ifNode;
  while (true) {
    const alternative = curr.childForFieldName('alternative');
    if (!alternative || alternative.type !== 'if_statement') break;
    seenIfs.add(alternative);
    arms += 1;
    curr = alternative;
  }
  const tail = curr.childForFieldName('alternative');
  if (tail) arms += 1;
  return arms;
}

const LOOP_TYPES = new Set([
  'for_statement',
  'enhanced_for_statement',
  'while_statement',
  'do_statement',
]);

function computeJavaFingerprint(methodNode) {
  const paramCount = countParameters(methodNode);
  const body = methodNode.childForFieldName('body');
  const empty = {
    paramCount,
    isAsync: false,
    isGenerator: false,
    hasTryCatch: false,
    branchCount: 0,
    returnCount: 0,
    maxArms: 0,
    callCallees: [],
  };
  if (!body) return empty;

  let branchCount = 0;
  let returnCount = 0;
  let maxSwitchArms = 0;
  let maxIfElseArms = 0;
  let hasTryCatch = false;
  const seenIfs = new Set();

  const stack = [...body.children];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (NESTED_TYPE_DECLARATIONS.has(node.type)) continue;

    switch (node.type) {
      case 'if_statement':
        if (!seenIfs.has(node)) {
          maxIfElseArms = Math.max(maxIfElseArms, countIfElseArms(node, seenIfs));
        }
        branchCount += 1;
        break;
      case 'switch_block': {
        const cases = countSwitchCases(node);
        branchCount += cases;
        maxSwitchArms = Math.max(maxSwitchArms, cases);
        break;
      }
      case 'ternary_expression':
        branchCount += 1;
        break;
      case 'catch_clause':
        branchCount += 1;
        hasTryCatch = true;
        break;
      case 'binary_expression': {
        const operator = node.childForFieldName('operator');
        const op = operator ? getNodeText(operator) : '';
        if (op === '&&' || op === '||') branchCount += 1;
        break;
      }
      case 'return_statement':
        returnCount += 1;
        break;
      default:
        if (LOOP_TYPES.has(node.type)) branchCount += 1;
        break;
    }

    for (const child of node.children) stack.push(child);
  }

  return {
    paramCount,
    isAsync: false,
    isGenerator: false,
    hasTryCatch,
    branchCount,
    returnCount,
    maxArms: Math.max(maxSwitchArms, maxIfElseArms),
    callCallees: [],
  };
}

// --- declarations ------------------------------------------------------------

function getTypeBody(declNode) {
  return declNode.children.find(
    (c) => c.type === 'class_body' || c.type === 'interface_body' || c.type === 'enum_body'
  );
}

function makeMethodRecords(methodNode, exports, exportRecords, functionRecords) {
  const name = getMethodName(methodNode);
  if (!name) return;
  const fingerprint = computeJavaFingerprint(methodNode);
  const line = getMethodLine(methodNode);
  exports.push(name);
  exportRecords.push({ name, kind: 'function', fingerprint });
  functionRecords.push({
    name,
    kind: 'function',
    lineStart: line,
    lineEnd: line,
    fingerprint,
    decorators: extractDecorators(methodNode),
    isExported: true,
    returnType: extractReturnType(methodNode),
    hasParameterTypeHints: true,
    branchCount: fingerprint.branchCount,
    maxArms: fingerprint.maxArms,
  });
}

function collectTypeMembers(declNode, exports, exportRecords, functionRecords) {
  const kind = TYPE_DECLARATION_KINDS.get(declNode.type);
  const nameNode = declNode.childForFieldName('name');
  if (!nameNode) return;
  exports.push(getNodeText(nameNode));
  exportRecords.push({ name: getNodeText(nameNode), kind });

  // enum / annotation declarations contribute their name only (javalang parity).
  // Honesty note: mutating this line alone does NOT turn the parity harness red
  // — enum methods sit one level deeper (enum_body_declarations) and
  // annotation_type_body is not in getTypeBody's list, so the guard is
  // currently redundant with those two shapes. It stays because it is the
  // contract, and testJavaEnumAndAnnotationBodies locks the observable result.
  if (kind === 'enum' || kind === 'annotation') return;

  const body = getTypeBody(declNode);
  if (!body) return;

  const isInterface = kind === 'interface';
  for (const member of body.children) {
    if (member.type === 'method_declaration') {
      // Interface members are implicitly public — javalang skips the check there.
      if (!isInterface && !hasModifier(member, 'public')) continue;
      makeMethodRecords(member, exports, exportRecords, functionRecords);
      continue;
    }
    // javalang only reads fields off class bodies, never interface bodies.
    if (!isInterface && member.type === 'field_declaration' && hasModifier(member, 'public')) {
      for (const declarator of member.children) {
        if (declarator.type !== 'variable_declarator') continue;
        const fieldName = declarator.childForFieldName('name');
        if (!fieldName) continue;
        exports.push(getNodeText(fieldName));
        exportRecords.push({ name: getNodeText(fieldName), kind: 'variable' });
      }
    }
  }
}

// --- main --------------------------------------------------------------------

// root is unused by the tree-sitter path (in-process WASM, no per-file process
// to hand a workspace root to); kept for the parser-registry signature.
async function parseJavaAst(content, _root) {
  let parser;
  let language;
  try {
    const mod = await getParserModule();
    if (!mod) return null;
    language = await loadLanguage('java');
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

    // javalang raises on broken source and the spawn wrapper exits 1, so java.js
    // sees null and falls back to regex. hasError is the equivalent gate.
    if (rootNode.hasError) return null;

    const imports = [];
    const importRecords = [];
    const exports = [];
    const exportRecords = [];
    const functionRecords = [];

    extractImports(rootNode, imports, importRecords);

    // Whole-tree pre-order walk — javalang's `for path, node in tree`.
    const stack = [rootNode];
    while (stack.length > 0) {
      const node = stack.pop();
      if (TYPE_DECLARATION_KINDS.has(node.type)) {
        collectTypeMembers(node, exports, exportRecords, functionRecords);
      }
      for (let i = node.childCount - 1; i >= 0; i--) stack.push(node.child(i));
    }

    return {
      imports,
      exports: [...new Set(exports)],
      exportRecords,
      importRecords,
      functionRecords,
      package: extractPackage(rootNode),
    };
  } catch {
    return null;
  } finally {
    try { if (tree) tree.delete(); } catch {}
    try { if (parser) parser.delete(); } catch {}
  }
}

module.exports = { parseJavaAst };
