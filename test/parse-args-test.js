#!/usr/bin/env node
// @contract

const assert = require('assert');
const { parseArgs } = require('../src/utils/parse-args');

function testBooleanFlag() {
  const result = parseArgs(['node', 'script', '--json'], { '--json': true });
  assert.strictEqual(result['--json'], true);
  assert.deepStrictEqual(result._, []);
}

function testTransform() {
  const result = parseArgs(['node', 'script', '--max-depth', '5'], {
    '--max-depth': { key: 'maxDepth', transform: (v) => Number.parseInt(v, 10) },
  });
  assert.strictEqual(result.maxDepth, 5);
}

function testUnknownArgumentThrows() {
  assert.throws(() => {
    parseArgs(['node', 'script', '--unknown'], {});
  }, /Unknown argument/);
}

function testPositionalArgs() {
  const result = parseArgs(['node', 'script', 'impact', 'src/foo.js'], {});
  assert.deepStrictEqual(result._, ['impact', 'src/foo.js']);
}

function testMissingValue() {
  // When a handler expects a value but none is provided, args[++i] becomes undefined
  const result = parseArgs(['node', 'script', '--max-depth'], {
    '--max-depth': { key: 'maxDepth', transform: (v) => Number.parseInt(v, 10) },
  });
  assert.strictEqual(Number.isNaN(result.maxDepth), true);
}

function main() {
  testBooleanFlag();
  testTransform();
  testUnknownArgumentThrows();
  testPositionalArgs();
  testMissingValue();
}

main();
