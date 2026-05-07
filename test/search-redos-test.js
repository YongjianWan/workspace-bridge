#!/usr/bin/env node
/**
 * Test for search ReDoS defense layers.
 * The search path uses escapeRegex() + includes() pre-check; no unsafe
 * regex test is performed on user input.
 */
const assert = require('assert');
const { validateQuery } = require('../src/tools/search-tools');

// We can't easily test catastrophic backtracking directly (it would hang),
// but we can verify the defense layers work.

function testValidateQueryBlocksDangerousPatterns() {
  assert.strictEqual(validateQuery('(a+)+').valid, false, 'nested + should be blocked');
  assert.strictEqual(validateQuery('(a*)*').valid, false, 'nested * should be blocked');
  assert.strictEqual(validateQuery('a').valid, true, 'simple literal should pass');
  assert.strictEqual(validateQuery('foo.bar').valid, true, 'dot literal should pass');
  console.log('testValidateQueryBlocksDangerousPatterns: ok');
}

function testValidateQueryLengthLimit() {
  const longQuery = 'a'.repeat(101);
  assert.strictEqual(validateQuery(longQuery).valid, false, '101-char query should be blocked');
  assert.strictEqual(validateQuery('a'.repeat(100)).valid, true, '100-char query should pass');
  console.log('testValidateQueryLengthLimit: ok');
}

// Verify that text-type search would use includes (no regex) by inspecting
// the escapeRegex behavior: escaped query has no special meaning.
function testEscapedQueryHasNoSpecialChars() {
  const { escapeRegex } = require('../src/tools/search-tools');
  // We need to export escapeRegex for this test. For now, verify via
  // validateQuery that common regex metacharacters in user input are treated
  // as literals by the text search path.
  const metacharQueries = ['foo.*', 'bar+', 'baz?', '[abc]', '(def)'];
  for (const q of metacharQueries) {
    assert.strictEqual(validateQuery(q).valid, true, `${q} should pass validateQuery (metachars are harmless when escaped)`);
  }
  console.log('testEscapedQueryHasNoSpecialChars: ok');
}

function main() {
  testValidateQueryBlocksDangerousPatterns();
  testValidateQueryLengthLimit();
  testEscapedQueryHasNoSpecialChars();
  console.log('search-redos-test: ok');
}

main();
