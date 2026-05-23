// @semantic
const assert = require('assert');
const { buildFileSummary } = require('../src/cli/formatters/file-summary');

function testHighSeverityWithImpactAndTests() {
  const impact = { impactCount: 10 };
  const affectedTests = { affectedTestsCount: 5 };
  const result = buildFileSummary(impact, affectedTests);
  assert.strictEqual(result.severity, 'high', '10 impact + 5 tests should be high');
  assert.strictEqual(result.counts.impact, 10);
  assert.strictEqual(result.counts.affectedTests, 5);
  assert(result.nextSteps.some((s) => s.includes('dependents')), 'should mention dependents review');
  assert(result.nextSteps.some((s) => s.includes('tests')), 'should mention running tests');
}

function testMediumSeverityWithImpactOnly() {
  const impact = { impactCount: 3 };
  const affectedTests = { affectedTestsCount: 0 };
  const result = buildFileSummary(impact, affectedTests);
  assert.strictEqual(result.severity, 'medium', '3 impact should be medium');
  assert(result.nextSteps.some((s) => s.includes('dependents')));
  assert(!result.nextSteps.some((s) => s.includes('tests')), 'should not mention tests when none');
}

function testLowSeverityNoImpact() {
  const impact = { impactCount: 0 };
  const affectedTests = { affectedTestsCount: 0 };
  const result = buildFileSummary(impact, affectedTests);
  assert.strictEqual(result.severity, 'low', 'no impact should be low');
  assert(result.nextSteps.some((s) => s.includes('No dependent')), 'should mention no dependents');
}

function testSeverityContextAndNote() {
  const result = buildFileSummary({ impactCount: 1 }, { affectedTestsCount: 0 });
  assert.strictEqual(result.severityContext, 'impact-radius');
  assert(result.severityNote.includes('blast radius'));
}

function testMissingFieldsDefaultsToZero() {
  const result = buildFileSummary({}, {});
  assert.strictEqual(result.counts.impact, 0);
  assert.strictEqual(result.counts.affectedTests, 0);
  assert.strictEqual(result.severity, 'low');
}

function testTransitionThresholds() {
  // Just below high (9 impact, 4 tests) -> should be medium
  const result1 = buildFileSummary({ impactCount: 9 }, { affectedTestsCount: 4 });
  assert.strictEqual(result1.severity, 'medium');

  // Exact high boundaries
  const result2 = buildFileSummary({ impactCount: 10 }, { affectedTestsCount: 0 });
  assert.strictEqual(result2.severity, 'high');

  const result3 = buildFileSummary({ impactCount: 0 }, { affectedTestsCount: 5 });
  assert.strictEqual(result3.severity, 'high');
}

function main() {
  testHighSeverityWithImpactAndTests();
  testMediumSeverityWithImpactOnly();
  testLowSeverityNoImpact();
  testSeverityContextAndNote();
  testMissingFieldsDefaultsToZero();
  testTransitionThresholds();
}

main();

