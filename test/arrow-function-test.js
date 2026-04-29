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

testArrowFunctionRecords();
