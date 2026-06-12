#!/usr/bin/env node
// @contract — Python parser functionRecords field parity

const assert = require('assert');
const { parsePython } = require('../src/services/dep-graph/parsers/python');

async function testPublicFunctionFields() {
  const source = `
from typing import Optional

@deprecated
def compute(x: int) -> Optional[str]:
    if x > 0:
        return "positive"
    return None
`;
  const parsed = await parsePython(source, 'test.py');
  if (!parsed) {
    console.log('Python parser skipped (not available)');
    return;
  }
  assertTopLevelSchema(parsed);
  const compute = parsed.functionRecords.find((f) => f.name === 'compute');
  assert(compute, 'should find compute function');
  assert.strictEqual(compute.isExported, true, 'compute should be exported');
  assert.strictEqual(compute.returnType, 'Optional[str]', `returnType should be Optional[str], got ${compute.returnType}`);
  assert.deepStrictEqual(compute.decorators, ['deprecated'], `decorators should be [deprecated], got ${JSON.stringify(compute.decorators)}`);
  assert(compute.fingerprint, 'should preserve fingerprint');
  assert.strictEqual(compute.fingerprint.maxArms, 1, 'single if should produce 1 arm');
}

async function testAllOverrideMarksUnlistedAsNotExported() {
  const source = `
__all__ = ['listed']

def listed():
    pass

def unlisted():
    pass
`;
  const parsed = await parsePython(source, 'test.py');
  if (!parsed) {
    console.log('Python parser skipped (not available)');
    return;
  }
  const listed = parsed.functionRecords.find((f) => f.name === 'listed');
  const unlisted = parsed.functionRecords.find((f) => f.name === 'unlisted');
  assert(listed, 'should find listed function');
  assert(unlisted, 'should find unlisted function');
  assert.strictEqual(listed.isExported, true, 'listed should be exported');
  assert.strictEqual(unlisted.isExported, false, 'unlisted should not be exported when omitted from __all__');
}

async function testDecoratedFunctionDottedDecorator() {
  const source = `
@app.route('/')
def handler():
    pass
`;
  const parsed = await parsePython(source, 'test.py');
  if (!parsed) {
    console.log('Python parser skipped (not available)');
    return;
  }
  const handler = parsed.functionRecords.find((f) => f.name === 'handler');
  assert(handler, 'should find handler function');
  assert.deepStrictEqual(handler.decorators, ['app.route'], `decorators should preserve dotted path, got ${JSON.stringify(handler.decorators)}`);
  assert.strictEqual(handler.returnType, null, 'handler should have no return type');
}

function assertTopLevelSchema(result) {
  const expected = ['exportRecords', 'exports', 'functionRecords', 'importRecords', 'imports', 'parseMode'];
  for (const key of expected) {
    assert(key in result, `missing top-level key ${key}`);
  }
}

async function main() {
  const tests = [
    testPublicFunctionFields,
    testAllOverrideMarksUnlistedAsNotExported,
    testDecoratedFunctionDottedDecorator,
  ];

  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      passed++;
      console.log(`  PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${t.name}: ${err.message}`);
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
