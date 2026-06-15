// @semantic
const assert = require('assert');
const { buildImpactExplanations } = require('../src/cli/formatters/impact-explanations');

function testDirectImportExplanation() {
  const entry = {
    file: 'src/utils/helper.js',
    impact: [
      { level: 1, file: 'src/app.js', importedSymbols: ['formatDate', 'parseId'] },
    ],
  };
  const result = buildImpactExplanations(entry);
  assert.strictEqual(result.length, 1, 'should produce one explanation');
  assert(result[0].includes('src/utils/helper.js'), 'should mention changed file');
  assert(result[0].includes('src/app.js'), 'should mention impacted file');
  assert(result[0].includes('formatDate'), 'should mention imported symbols');
}

function testTransitiveExplanation() {
  const entry = {
    file: 'src/core/api.js',
    impact: [
      { level: 2, file: 'src/pages/home.js', via: ['src/core/api.js', 'src/services/data.js'], importedSymbols: [] },
    ],
  };
  const result = buildImpactExplanations(entry);
  assert.strictEqual(result.length, 1, 'should produce one explanation for transitive');
  assert(result[0].includes('传递'), 'should mention transitive propagation');
}

function testSelfReferenceSkipped() {
  const entry = {
    file: 'src/app.js',
    impact: [
      { level: 2, file: 'src/app.js', via: ['src/app.js', 'src/app.js'], importedSymbols: [] },
    ],
  };
  const result = buildImpactExplanations(entry);
  assert.strictEqual(result.length, 0, 'should skip self-referencing chain');
}

function testNoImpactReturnsEmpty() {
  const entry = { file: 'src/app.js', impact: [] };
  const result = buildImpactExplanations(entry);
  assert.strictEqual(result.length, 0, 'should return empty for no impact');
}

function testMissingImpactField() {
  const entry = { file: 'src/app.js' };
  const result = buildImpactExplanations(entry);
  assert.strictEqual(result.length, 0, 'should return empty when impact is missing');
}

function main() {
  testDirectImportExplanation();
  testTransitiveExplanation();
  testSelfReferenceSkipped();
  testNoImpactReturnsEmpty();
  testMissingImpactField();
}

main();
