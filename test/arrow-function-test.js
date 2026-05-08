const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseJavaScript } = require('../src/services/dep-graph/parsers');

function testArrowFunctionRecords() {
  const tmpFile = path.join(require('os').tmpdir(), 'wb-arrow-test.js');
  fs.writeFileSync(tmpFile, `
const arrowFn = () => { return 1; };
function regularFn() { return 2; }
const obj = { method: () => { return 3; } };
`);

  const content = fs.readFileSync(tmpFile, 'utf8');
  const result = parseJavaScript(content, tmpFile);
  const names = result.functionRecords.map(r => r.name).sort();
  assert(names.includes('arrowFn'), `Expected arrowFn in functionRecords, got: ${names.join(', ')}`);
  assert(names.includes('regularFn'), `Expected regularFn in functionRecords, got: ${names.join(', ')}`);
  // Object method via Property is not yet supported; ensure it doesn't crash
  console.log('testArrowFunctionRecords passed:', names);
  fs.unlinkSync(tmpFile);
}

function testDestructuredRequireImports() {
  const tmpFile = path.join(require('os').tmpdir(), 'wb-destructured-require.js');
  fs.writeFileSync(tmpFile, `
const { foo, bar } = require('./utils');
const baz = require('./single');
const { qux, ...rest } = require('./spread');
`);

  const content = fs.readFileSync(tmpFile, 'utf8');
  const result = parseJavaScript(content, tmpFile);

  const utilsRecord = result.importRecords.find((r) => r.source === './utils');
  assert(utilsRecord, 'should find ./utils import record');
  assert.deepStrictEqual(utilsRecord.imported.sort(), ['bar', 'foo'], `Expected [bar, foo], got: ${JSON.stringify(utilsRecord.imported)}`);
  assert.strictEqual(utilsRecord.usesAllExports, false, 'destructured require should not useAllExports');

  const singleRecord = result.importRecords.find((r) => r.source === './single');
  assert(singleRecord, 'should find ./single import record');
  assert.deepStrictEqual(singleRecord.imported, [], 'non-destructured require should have empty imported');
  assert.strictEqual(singleRecord.usesAllExports, true, 'non-destructured require should useAllExports');

  const spreadRecord = result.importRecords.find((r) => r.source === './spread');
  assert(spreadRecord, 'should find ./spread import record');
  assert(spreadRecord.imported.includes('qux'), 'should include qux');
  assert.strictEqual(spreadRecord.usesAllExports, true, 'rest element should set usesAllExports true');

  console.log('testDestructuredRequireImports passed');
  fs.unlinkSync(tmpFile);
}

testArrowFunctionRecords();
testDestructuredRequireImports();
