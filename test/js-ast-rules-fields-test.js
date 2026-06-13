const assert = require('assert');
const { parseJavaScript } = require('../src/services/dep-graph/parsers/js.js');
const { checkFileRules } = require('../src/services/dep-graph/ast-rules');

function testExportedFunctionWithoutReturnType() {
  const content = `export function compute() { return 1; }`;
  const result = parseJavaScript(content, 'compute.ts');
  assert.strictEqual(result.parseMode, 'ast', `Expected AST parse mode, got ${result.parseMode}`);

  const fn = result.functionRecords.find((r) => r.name === 'compute');
  assert(fn, 'should have compute functionRecord');
  assert.strictEqual(fn.kind, 'function');
  assert.strictEqual(fn.isExported, true, 'exported function should have isExported=true');
  assert.strictEqual(fn.returnType, null, 'function without return type should have returnType=null');
  assert.deepStrictEqual(fn.decorators, [], 'function without decorators should have decorators=[]');

  const findings = checkFileRules('compute.ts', {
    originalPath: 'compute.ts',
    functionRecords: result.functionRecords,
  });
  assert.strictEqual(findings.length, 1, 'exported function without return type should trigger rule');
  assert.ok(findings[0].id.includes('exported-function-no-return-type'), findings[0].id);
  assert.strictEqual(findings[0].symbol, 'compute');
}

function testExportedFunctionWithReturnType() {
  const content = `export function compute(): number { return 1; }`;
  const result = parseJavaScript(content, 'compute.ts');

  const fn = result.functionRecords.find((r) => r.name === 'compute');
  assert(fn, 'should have compute functionRecord');
  assert.strictEqual(fn.isExported, true);
  assert.strictEqual(fn.returnType, 'number', `Expected returnType 'number', got ${fn.returnType}`);

  const findings = checkFileRules('compute.ts', {
    originalPath: 'compute.ts',
    functionRecords: result.functionRecords,
  });
  assert.strictEqual(findings.length, 0, 'exported function with return type should not trigger rule');
}

function testExportedFunctionWithParameterTypeOnly() {
  const content = `export function compute(x: number) { return x; }`;
  const result = parseJavaScript(content, 'compute.ts');

  const fn = result.functionRecords.find((r) => r.name === 'compute');
  assert(fn, 'should have compute functionRecord');
  assert.strictEqual(fn.isExported, true);
  assert.strictEqual(fn.returnType, null);
  assert.strictEqual(fn.hasParameterTypeHints, true, 'parameter type annotations should be tracked');

  const findings = checkFileRules('compute.ts', {
    originalPath: 'compute.ts',
    functionRecords: result.functionRecords,
  });
  assert.strictEqual(findings.length, 1, 'exported function with parameter type hints should trigger rule');
  assert.ok(findings[0].id.includes('exported-function-no-return-type'), findings[0].id);
  assert.strictEqual(findings[0].symbol, 'compute');
}

function testNonExportedFunction() {
  const content = `function internal() {}`;
  const result = parseJavaScript(content, 'internal.ts');

  const fn = result.functionRecords.find((r) => r.name === 'internal');
  assert(fn, 'should have internal functionRecord');
  assert.strictEqual(fn.isExported, false, 'non-exported function should have isExported=false');
  assert.strictEqual(fn.returnType, null);
  assert.deepStrictEqual(fn.decorators, []);

  const findings = checkFileRules('internal.ts', {
    originalPath: 'internal.ts',
    functionRecords: result.functionRecords,
  });
  assert.strictEqual(findings.length, 0, 'non-exported function should not trigger rule');
}

function testExportedArrowFunction() {
  const content = `
    const localArrow = (): string => 'hi';
    export const exportedArrow = () => {};
  `;
  const result = parseJavaScript(content, 'arrows.ts');

  const local = result.functionRecords.find((r) => r.name === 'localArrow');
  assert(local, 'should have localArrow functionRecord');
  assert.strictEqual(local.isExported, false);
  assert.strictEqual(local.returnType, 'string');

  const exported = result.functionRecords.find((r) => r.name === 'exportedArrow');
  assert(exported, 'should have exportedArrow functionRecord');
  assert.strictEqual(exported.isExported, true);
  assert.strictEqual(exported.returnType, null);

  const findings = checkFileRules('arrows.ts', {
    originalPath: 'arrows.ts',
    functionRecords: result.functionRecords,
  });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].symbol, 'exportedArrow');
}

function testUnionAndQualifiedReturnTypes() {
  const content = `
    export function union(): string | number { return 1; }
    export function qualified(): ns.Type { return null as any; }
  `;
  const result = parseJavaScript(content, 'types.ts');

  const union = result.functionRecords.find((r) => r.name === 'union');
  assert(union, 'should have union functionRecord');
  assert.strictEqual(union.returnType, 'string | number');

  const qualified = result.functionRecords.find((r) => r.name === 'qualified');
  assert(qualified, 'should have qualified functionRecord');
  assert.strictEqual(qualified.returnType, 'ns.Type');
}

function testExistingFieldsPreserved() {
  const content = `export function compute(): number { return 1; }`;
  const result = parseJavaScript(content, 'compute.ts');

  for (const record of result.functionRecords) {
    assert.strictEqual(typeof record.name, 'string', 'name should be string');
    assert.strictEqual(record.kind, 'function', 'kind should be function');
    assert(Number.isFinite(record.lineStart), 'lineStart should be finite');
    assert(Number.isFinite(record.lineEnd), 'lineEnd should be finite');
    assert(record.fingerprint && typeof record.fingerprint === 'object', 'fingerprint should be object');
    assert(typeof record.fingerprint.paramCount === 'number', 'fingerprint.paramCount should be number');
  }
}

testExportedFunctionWithoutReturnType();
testExportedFunctionWithReturnType();
testExportedFunctionWithParameterTypeOnly();
testNonExportedFunction();
testExportedArrowFunction();
testUnionAndQualifiedReturnTypes();
testExistingFieldsPreserved();
console.log('js-ast-rules-fields-test: all passed');
