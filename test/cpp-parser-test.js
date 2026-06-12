#!/usr/bin/env node
// @slow
const assert = require('assert');
const { parseCpp } = require('../src/services/dep-graph/parsers');

async function testIncludes() {
  const source = `
#include <stdio.h>
#include <vector>
#include "local.h"
#include "utils/helper.h"
`;
  const result = await parseCpp(source, 'test.c');
  assert.strictEqual(result.parseMode, 'ast');
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
  const result = await parseCpp(source, 'test.c');
  assert(result.exports.includes('main'));
  assert(result.exports.includes('helper'));

  const mainExport = result.exportRecords.find((r) => r.name === 'main');
  assert.strictEqual(mainExport.kind, 'function');
  assert(Number.isFinite(mainExport.lineStart), 'Should have lineStart');

  const mainFunc = result.functionRecords.find((r) => r.name === 'main');
  assert(mainFunc);
  assert.strictEqual(mainFunc.kind, 'function');
  assert.strictEqual(mainFunc.isExported, true, 'main should be exported');
  assert.strictEqual(mainFunc.returnType, 'int', 'main should have return type int');
  assert(Array.isArray(mainFunc.decorators), 'decorators should be an array');

  const helperFunc = result.functionRecords.find((r) => r.name === 'helper');
  assert(helperFunc);
  assert.strictEqual(helperFunc.returnType, 'void', 'helper should have return type void');
  assert.deepStrictEqual(helperFunc.decorators, []);
}

async function testMacros() {
  const source = `
#define MAX_SIZE 100
#define DEBUG
`;
  const result = await parseCpp(source, 'test.c');
  assert(result.exports.includes('MAX_SIZE'));
  assert(result.exports.includes('DEBUG'));

  const maxExport = result.exportRecords.find((r) => r.name === 'MAX_SIZE');
  assert.strictEqual(maxExport.kind, 'macro');
}

async function testPointerReturnFunction() {
  const source = `
int* foo() {
  return nullptr;
}

int** bar() {
  return nullptr;
}
`;
  const result = await parseCpp(source, 'test.cpp');
  assert(result.exports.includes('foo'), 'Should export pointer-return function foo');
  assert(result.exports.includes('bar'), 'Should export double-pointer-return function bar');
  const fooFunc = result.functionRecords.find((r) => r.name === 'foo');
  assert(fooFunc, 'foo should be in functionRecords');
  assert.strictEqual(fooFunc.returnType, 'int');
}

async function testReferenceReturnFunction() {
  const source = `
int& baz() {
  static int x = 0;
  return x;
}
`;
  const result = await parseCpp(source, 'test.cpp');
  assert(result.exports.includes('baz'), 'Should export reference-return function baz');
  const bazFunc = result.functionRecords.find((r) => r.name === 'baz');
  assert(bazFunc, 'baz should be in functionRecords');
  assert.strictEqual(bazFunc.returnType, 'int');
}

async function testCppMethod() {
  const source = `
class MyClass {
public:
  void method();
};

void MyClass::method() {
  return;
}
`;
  const result = await parseCpp(source, 'test.cpp');
  assert(result.exports.includes('method'), 'Should export out-of-class method definition');
  const methodFunc = result.functionRecords.find((r) => r.name === 'method');
  assert(methodFunc, 'method should be in functionRecords');
  assert.strictEqual(methodFunc.returnType, 'void');
  assert.deepStrictEqual(methodFunc.decorators, []);
}

async function testCppAttributes() {
  const source = `
[[nodiscard]] int foo() { return 0; }
[[deprecated]] void bar() {}
`;
  const result = await parseCpp(source, 'test.cpp');
  const fooFunc = result.functionRecords.find((r) => r.name === 'foo');
  assert(fooFunc, 'foo should be in functionRecords');
  assert.strictEqual(fooFunc.returnType, 'int');
  assert(fooFunc.decorators.some((d) => d.includes('nodiscard')));

  const barFunc = result.functionRecords.find((r) => r.name === 'bar');
  assert(barFunc, 'bar should be in functionRecords');
  assert.strictEqual(barFunc.returnType, 'void');
  assert(barFunc.decorators.some((d) => d.includes('deprecated')));
}

async function testStaticFilteringC() {
  const source = `
static void hidden() {
}

void visible() {
}
`;
  const result = await parseCpp(source, 'test.c');
  assert(!result.exports.includes('hidden'), 'static C function should be filtered');
  assert(result.exports.includes('visible'), 'non-static C function should be exported');
}

async function testStructClassEnumTypedef() {
  const cSource = `
struct Point { int x; };
enum Color { RED };
typedef int MyInt;
`;
  const cResult = await parseCpp(cSource, 'test.c');
  assert(cResult.exports.includes('Point'));
  assert(cResult.exports.includes('Color'));
  assert(cResult.exports.includes('MyInt'));
  assert(cResult.exportRecords.some((r) => r.name === 'Point' && r.kind === 'struct'));
  assert(cResult.exportRecords.some((r) => r.name === 'Color' && r.kind === 'enum'));
  assert(cResult.exportRecords.some((r) => r.name === 'MyInt' && r.kind === 'typedef'));

  const cppSource = `
class Box {};
namespace ns {}
`;
  const cppResult = await parseCpp(cppSource, 'test.cpp');
  assert(cppResult.exports.includes('Box'));
  assert(cppResult.exports.includes('ns'));
  assert(cppResult.exportRecords.some((r) => r.name === 'Box' && r.kind === 'class'));
  assert(cppResult.exportRecords.some((r) => r.name === 'ns' && r.kind === 'namespace'));
}

async function testTemplate() {
  const source = `
template<typename T>
class Vector {};

template<typename T>
T max(T a, T b) {
  return a > b ? a : b;
}
`;
  const result = await parseCpp(source, 'test.cpp');
  assert(result.exports.includes('Vector'), 'Should export template class');
  assert(result.exports.includes('max'), 'Should export template function');
  assert(result.exportRecords.some((r) => r.name === 'Vector' && r.kind === 'class'));
  assert(result.exportRecords.some((r) => r.name === 'max' && r.kind === 'function'));
}

async function testEmpty() {
  const result = await parseCpp('', 'test.c');
  assert.deepStrictEqual(result.imports, []);
  assert.deepStrictEqual(result.exports, []);
  assert.deepStrictEqual(result.importRecords, []);
  assert.deepStrictEqual(result.exportRecords, []);
  assert.deepStrictEqual(result.functionRecords, []);
  assert.strictEqual(result.parseMode, 'ast');
}

(async () => {
  await testIncludes();
  await testFunctions();
  await testMacros();
  await testPointerReturnFunction();
  await testReferenceReturnFunction();
  await testCppMethod();
  await testCppAttributes();
  await testStaticFilteringC();
  await testStructClassEnumTypedef();
  await testTemplate();
  await testEmpty();
})();
