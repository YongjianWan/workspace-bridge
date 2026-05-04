#!/usr/bin/env node
const assert = require('assert');
const { parseCpp } = require('../src/services/dep-graph/parsers/cpp');

async function testIncludes() {
  const source = `
#include <stdio.h>
#include <vector>
#include "local.h"
#include "utils/helper.h"
`;
  const result = parseCpp(source);
  assert.strictEqual(result.parseMode, 'regex');
  assert(result.imports.includes('stdio.h'));
  assert(result.imports.includes('vector'));
  assert(result.imports.includes('local.h'));
  assert(result.imports.includes('utils/helper.h'));

  const localRec = result.importRecords.find((r) => r.source === 'local.h');
  assert(localRec, 'Should have local.h import record');
  assert.strictEqual(localRec.usesAllExports, true);
  assert.strictEqual(localRec.isLocal, true);

  const systemRec = result.importRecords.find((r) => r.source === 'stdio.h');
  assert(systemRec, 'Should have stdio.h import record');
  assert.strictEqual(systemRec.isLocal, false);
}

async function testFunctions() {
  const source = `
int main() {
  return 0;
}

void helper(int x) {
}
`;
  const result = parseCpp(source);
  assert(result.exports.includes('main'));
  assert(result.exports.includes('helper'));

  const mainExport = result.exportRecords.find((r) => r.name === 'main');
  assert.strictEqual(mainExport.kind, 'function');

  const mainFunc = result.functionRecords.find((r) => r.name === 'main');
  assert(mainFunc);
  assert.strictEqual(mainFunc.kind, 'function');
}

async function testMacros() {
  const source = `
#define MAX_SIZE 100
#define DEBUG
`;
  const result = parseCpp(source);
  assert(result.exports.includes('MAX_SIZE'));
  assert(result.exports.includes('DEBUG'));

  const maxExport = result.exportRecords.find((r) => r.name === 'MAX_SIZE');
  assert.strictEqual(maxExport.kind, 'macro');
}

async function testClassMemberNegative() {
  const source = `
class MyClass {
};

void MyClass::method() {
  return;
}
`;
  const result = parseCpp(source);
  assert(!result.exports.includes('method'), 'Class member method should not be exported');
  assert(
    !result.functionRecords.some((r) => r.name === 'method'),
    'Class member method should not be in functionRecords'
  );
}

async function testEmpty() {
  const result = parseCpp('');
  assert.deepStrictEqual(result.imports, []);
  assert.deepStrictEqual(result.exports, []);
  assert.deepStrictEqual(result.importRecords, []);
  assert.deepStrictEqual(result.exportRecords, []);
  assert.deepStrictEqual(result.functionRecords, []);
  assert.strictEqual(result.parseMode, 'regex');
}

(async () => {
  await testIncludes();
  await testFunctions();
  await testMacros();
  await testClassMemberNegative();
  await testEmpty();
  console.log('cpp-parser-test: OK');
})();
