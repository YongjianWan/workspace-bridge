const assert = require('assert');
const { parseJavaScript } = require('../src/services/dep-graph/parsers/js.js');

// Force regex fallback by placing invalid syntax after valid exports
const INVALID_SUFFIX = '\ninvalid syntax here to force regex fallback\n';

function testMultilineTemplateLiteralSanitization() {
  const content = `
const x = \`hello
import fakeModule from './fake'
world\`;
export const realExport = 1;
` + INVALID_SUFFIX;

  const result = parseJavaScript(content, 'test.js');
  assert.strictEqual(result.parseMode, 'regex', `Expected parseMode 'regex', got: ${result.parseMode}`);
  assert.ok(
    !result.imports.includes('./fake'),
    `Multi-line template content should NOT be parsed as import, got: ${result.imports.join(', ')}`
  );
  assert.ok(
    result.exports.includes('realExport'),
    `Expected 'realExport' in exports, got: ${result.exports.join(', ')}`
  );
}

function testDestructuredExports() {
  const content = `
export const { alpha, beta } = obj;
export let { gamma, delta: renamed } = anotherObj;
export var { epsilon } = { epsilon: 1 };
export function normalFn() {}
` + INVALID_SUFFIX;

  const result = parseJavaScript(content, 'test.js');
  assert.strictEqual(result.parseMode, 'regex');
  assert.ok(result.exports.includes('alpha'), `Expected 'alpha' in exports, got: ${result.exports.join(', ')}`);
  assert.ok(result.exports.includes('beta'), `Expected 'beta' in exports, got: ${result.exports.join(', ')}`);
  assert.ok(result.exports.includes('gamma'), `Expected 'gamma' in exports, got: ${result.exports.join(', ')}`);
  assert.ok(result.exports.includes('renamed'), `Expected 'renamed' in exports, got: ${result.exports.join(', ')}`);
  assert.ok(result.exports.includes('epsilon'), `Expected 'epsilon' in exports, got: ${result.exports.join(', ')}`);
  assert.ok(result.exports.includes('normalFn'), `Expected 'normalFn' in exports, got: ${result.exports.join(', ')}`);
}

function testFunctionRecordsInRegexFallback() {
  const content = `
export function foo() {}
async function bar() {}
const baz = () => {};
let qux = async () => {};
var quux = function() {};
const corge = async function grault() {};
` + INVALID_SUFFIX;

  const result = parseJavaScript(content, 'test.js');
  assert.strictEqual(result.parseMode, 'regex');
  assert.ok(Array.isArray(result.functionRecords) && result.functionRecords.length > 0,
    `Expected non-empty functionRecords in regex fallback, got: ${JSON.stringify(result.functionRecords)}`);

  const names = result.functionRecords.map((r) => r.name);
  assert.ok(names.includes('foo'), `Expected 'foo' in functionRecords, got: ${names.join(', ')}`);
  assert.ok(names.includes('bar'), `Expected 'bar' in functionRecords, got: ${names.join(', ')}`);
  assert.ok(names.includes('baz'), `Expected 'baz' in functionRecords, got: ${names.join(', ')}`);
  assert.ok(names.includes('qux'), `Expected 'qux' in functionRecords, got: ${names.join(', ')}`);
  assert.ok(names.includes('quux'), `Expected 'quux' in functionRecords, got: ${names.join(', ')}`);
  assert.ok(names.includes('corge'), `Expected 'corge' in functionRecords, got: ${names.join(', ')}`);

  for (const record of result.functionRecords) {
    assert.strictEqual(record.kind, 'function', `Expected kind 'function', got: ${record.kind}`);
    assert.ok(Number.isFinite(record.lineStart), `Expected finite lineStart for ${record.name}`);
    assert.ok(Number.isFinite(record.lineEnd), `Expected finite lineEnd for ${record.name}`);
  }
}

function testTemplateLiteralWithInterpolation() {
  const content = `
const msg = \`Hello \${name}, welcome to \${place}\`;
export const greeting = msg;
` + INVALID_SUFFIX;

  const result = parseJavaScript(content, 'test.js');
  assert.strictEqual(result.parseMode, 'regex');
  assert.ok(result.exports.includes('greeting'), `Expected 'greeting' in exports, got: ${result.exports.join(', ')}`);
}

function main() {
  testMultilineTemplateLiteralSanitization();
  testDestructuredExports();
  testFunctionRecordsInRegexFallback();
  testTemplateLiteralWithInterpolation();
  console.log('js-regex-fallback-test: all passed');
}

main();
