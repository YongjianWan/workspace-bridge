/**
 * Go same-package test association.
 *
 * A `_test.go` file in package P sees every identifier of P without importing anything, so the
 * graph has no edge from it to the code it exercises. The edge is added when the test text uses
 * an identifier the source file declares: linking every test of the package to every file would
 * keep recall but bury the real match among unrelated tests.
 */

const { LIMITS } = require('../../config/constants');

const PACKAGE_CLAUSE_RE = /^package\s+(\w+)/m;
const FUNC_DECL_RE = /^func\s+(?:\([^)]*\)\s*)?(\w+)/gm;
const TYPE_DECL_RE = /^(?:type|var|const)\s+(\w+)/gm;
const GROUP_DECL_RE = /^(?:var|const)\s*\(([\s\S]*?)^\)/gm;
const GROUP_MEMBER_RE = /^\s*(\w+)\b/gm;
const IDENTIFIER_RE = /[A-Za-z_]\w*/g;

/** The package clause name, or null when the file has none. */
function goPackageName(text) {
  const match = PACKAGE_CLAUSE_RE.exec(text);
  return match ? match[1] : null;
}

/** Top-level names a Go file declares: funcs, methods, types, vars and consts, exported or not. */
function goDeclaredNames(text) {
  const names = new Set();
  for (const match of text.matchAll(FUNC_DECL_RE)) names.add(match[1]);
  for (const match of text.matchAll(TYPE_DECL_RE)) names.add(match[1]);
  for (const group of text.matchAll(GROUP_DECL_RE)) {
    for (const member of group[1].matchAll(GROUP_MEMBER_RE)) names.add(member[1]);
  }
  names.delete('init');
  return new Set([...names].filter((name) => name.length >= LIMITS.GO_SAME_PACKAGE_MIN_IDENTIFIER_LENGTH));
}

/** Every identifier-shaped token in the text. */
function goIdentifiers(text) {
  return new Set(text.match(IDENTIFIER_RE));
}

module.exports = { goPackageName, goDeclaredNames, goIdentifiers };
