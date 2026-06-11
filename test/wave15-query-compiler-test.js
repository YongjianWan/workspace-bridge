// @contract — Query compiler compilation, caching, execution, and fallback
const assert = require('assert');
const {
  compileQuery,
  runQuery,
  clearQueryCache,
  getQueryCacheSize,
} = require('../src/services/dep-graph/query-compiler');
const { getParserModule, loadLanguage } = require('../src/services/dep-graph/parsers/tree-sitter');

async function testCompileValidQuery() {
  clearQueryCache();
  const compiled = await compileQuery('go', '(import_spec path: (interpreted_string_literal) @import.source)');
  assert(compiled, 'should compile a valid Go query');
  assert(compiled.query, 'compiled result should have query property');
  assert.strictEqual(typeof compiled.cacheKey, 'string', 'cacheKey should be a string');
}

async function testCompileInvalidQuery() {
  clearQueryCache();
  const compiled = await compileQuery('go', '(totally_invalid_node_name)');
  assert.strictEqual(compiled, null, 'should return null for invalid query syntax');
}

async function testCacheHit() {
  clearQueryCache();
  const q1 = '(import_spec path: (interpreted_string_literal) @import.source)';
  const first = await compileQuery('go', q1);
  assert(first, 'first compilation should succeed');
  assert.strictEqual(getQueryCacheSize(), 1, 'cache should contain 1 entry');

  const second = await compileQuery('go', q1);
  assert(second, 'second compilation should succeed');
  assert.strictEqual(getQueryCacheSize(), 1, 'cache should still contain 1 entry (hit)');
  assert.strictEqual(first.cacheKey, second.cacheKey, 'same query should produce same cacheKey');
}

async function testRunQueryOnGoTree() {
  clearQueryCache();
  const mod = await getParserModule();
  if (!mod) {
    console.log('SKIP: tree-sitter module not available');
    return;
  }

  const lang = await loadLanguage('go');
  if (!lang) {
    console.log('SKIP: Go language not available');
    return;
  }

  const parser = new mod.Parser();
  parser.setLanguage(lang);
  const tree = parser.parse('package main\nimport "fmt"');

  const compiled = await compileQuery('go', '(import_spec path: (interpreted_string_literal) @import.source)');
  assert(compiled, 'query should compile');

  const results = runQuery(tree, compiled);
  assert(Array.isArray(results), 'runQuery should return an array');
  assert(results.length >= 1, 'should match at least 1 import');
  assert(results[0]['import.source'], 'first match should have import.source capture');
  assert.strictEqual(results[0]['import.source'].text, '"fmt"', 'capture text should be "fmt"');

  tree.delete();
  parser.delete();
}

async function testRunQueryOnTypeScriptTree() {
  clearQueryCache();
  const mod = await getParserModule();
  if (!mod) {
    console.log('SKIP: tree-sitter module not available');
    return;
  }

  const lang = await loadLanguage('typescript');
  if (!lang) {
    console.log('SKIP: TypeScript language not available');
    return;
  }

  const parser = new mod.Parser();
  parser.setLanguage(lang);
  const tree = parser.parse('const x = 1;');

  const compiled = await compileQuery('typescript', '(variable_declarator name: (identifier) @name)');
  assert(compiled, 'TypeScript query should compile');

  const results = runQuery(tree, compiled);
  assert(Array.isArray(results), 'runQuery should return an array');
  assert.strictEqual(results.length, 1, 'should match exactly 1 variable declarator');
  assert(results[0].name, 'match should have name capture');
  assert.strictEqual(results[0].name.text, 'x', 'capture text should be x');

  tree.delete();
  parser.delete();
}

async function testRunQueryReturnsNullOnInvalidTree() {
  clearQueryCache();
  const compiled = await compileQuery('go', '(import_spec path: (interpreted_string_literal) @import.source)');
  assert(compiled, 'query should compile');

  const results = runQuery(null, compiled);
  assert.strictEqual(results, null, 'runQuery with null tree should return null');
}

async function testClearQueryCache() {
  clearQueryCache();
  await compileQuery('go', '(import_spec path: (interpreted_string_literal) @import.source)');
  assert.strictEqual(getQueryCacheSize(), 1, 'cache should have 1 entry');
  clearQueryCache();
  assert.strictEqual(getQueryCacheSize(), 0, 'cache should be empty after clear');
}

async function main() {
  await testCompileValidQuery();
  await testCompileInvalidQuery();
  await testCacheHit();
  await testRunQueryOnGoTree();
  await testRunQueryOnTypeScriptTree();
  await testRunQueryReturnsNullOnInvalidTree();
  await testClearQueryCache();
  console.log('PASS: wave15-query-compiler-test');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
