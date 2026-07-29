// @semantic
// L2-20: tree-sitter loader races.
//
// loadLanguage checked the cache synchronously but only populated it after an
// async WASM load, so N concurrent first-time callers all saw a miss and each
// ran its own Language.load. In the builder that race window produced
// "Incompatible language version 0" Language objects (measured: 19 of 36 cobra
// files silently degraded to regex, 2026-07-28) — and even when not corrupted,
// N duplicate loads for one grammar is pure waste. The fix is promise-caching:
// the cache must hold the in-flight promise, so concurrent callers share one
// underlying load. These tests assert the mechanism deterministically: all 16
// callers pass the cache check before any load can settle, so without
// promise-caching they MUST observe 16 distinct objects.
const assert = require('assert');

function freshLoader() {
  delete require.cache[require.resolve('../src/services/dep-graph/parsers/tree-sitter.js')];
  return require('../src/services/dep-graph/parsers/tree-sitter.js');
}

async function testConcurrentLoadLanguageSharesOneLoad() {
  const { getParserModule, loadLanguage } = freshLoader();
  const langs = await Promise.all(Array.from({ length: 16 }, () => loadLanguage('go')));
  assert(langs.every(Boolean), 'all concurrent loads must succeed');

  const distinct = new Set(langs);
  assert.strictEqual(
    distinct.size,
    1,
    `16 concurrent first-time loads must share ONE Language object, got ${distinct.size} distinct`
  );

  // The shared object must be a working language (the version-0 corruption
  // shape from the builder measurement).
  const mod = await getParserModule();
  const parser = new mod.Parser();
  try {
    parser.setLanguage(langs[0]);
    const tree = parser.parse('package main\n');
    assert(tree && tree.rootNode, 'shared language must parse');
    tree.delete();
  } finally {
    parser.delete();
  }
}

async function testConcurrentMixedLanguagesLoadOnceEach() {
  const { loadLanguage } = freshLoader();
  const names = ['go', 'rust', 'kotlin', 'cpp'];
  const langs = await Promise.all([
    ...names.map((n) => loadLanguage(n)),
    ...names.map((n) => loadLanguage(n)),
    ...names.map((n) => loadLanguage(n)),
  ]);
  const byName = new Map(names.map((n, i) => [n, [langs[i], langs[i + 4], langs[i + 8]]]));
  for (const [name, triple] of byName) {
    assert(triple.every(Boolean), `${name} loads must succeed`);
    assert.strictEqual(
      new Set(triple).size,
      1,
      `${name}: 3 concurrent first-time loads must share ONE Language object`
    );
  }
}

async function main() {
  await testConcurrentLoadLanguageSharesOneLoad();
  await testConcurrentMixedLanguagesLoadOnceEach();
  console.log('tree-sitter-loader-race-test: all passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
