const assert = require('assert');
const { parseJavaScript } = require('../src/services/dep-graph/parsers/js.js');

function testCJSRegexFallback() {
  const content = `
const foo = 1;
module.exports = { foo, bar: 2, baz: () => {} };
exports.qux = function quxFn() {};
module.exports.nested = 42;
// Force regex fallback by placing invalid syntax after valid exports
invalid syntax here to force regex fallback
`;

  const result = parseJavaScript(content, 'test.js');
  const names = result.exports;

  assert.strictEqual(result.parseMode, 'regex', `Expected parseMode 'regex', got: ${result.parseMode}`);
  assert.ok(names.includes('foo'), `Expected 'foo' in exports, got: ${names.join(', ')}`);
  assert.ok(names.includes('bar'), `Expected 'bar' in exports, got: ${names.join(', ')}`);
  assert.ok(names.includes('baz'), `Expected 'baz' in exports, got: ${names.join(', ')}`);
  assert.ok(names.includes('qux'), `Expected 'qux' in exports, got: ${names.join(', ')}`);
  assert.ok(names.includes('nested'), `Expected 'nested' in exports, got: ${names.join(', ')}`);
}

testCJSRegexFallback();
