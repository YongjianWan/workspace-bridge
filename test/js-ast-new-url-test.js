const assert = require('assert');
const { parseJavaScript } = require('../src/services/dep-graph/parsers/js.js');

function testNewURLWorker() {
  const content = `
const workerUrl = new URL('./parse-worker.js', import.meta.url);
const imgUrl = new URL('./logo.png', import.meta.url);
`;

  const result = parseJavaScript(content, 'src/core/ingestion/pipeline-phases/parse-impl.ts');
  assert.strictEqual(result.parseMode, 'ast', `Expected parseMode 'ast', got: ${result.parseMode}`);

  const jsImports = result.importRecords.filter((r) => r.source.endsWith('.js'));
  assert.strictEqual(jsImports.length, 1, `Expected 1 JS import from new URL, got: ${jsImports.length}`);
  assert.strictEqual(jsImports[0].source, './parse-worker.js', `Expected './parse-worker.js', got: ${jsImports[0].source}`);

  const pngImports = result.importRecords.filter((r) => r.source.endsWith('.png'));
  assert.strictEqual(pngImports.length, 0, `Expected 0 PNG imports, got: ${pngImports.length}`);
}

testNewURLWorker();
