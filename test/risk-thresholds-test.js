const assert = require('assert');
const {
  scoreToLevel,
  fileImpactSeverity,
  repoSeverity,
  diffSeverity,
  overviewSeverity,
} = require('../src/config/risk-thresholds');

function testScoreToLevel() {
  assert.strictEqual(scoreToLevel(0), 'low', 'score 0 should be low');
  assert.strictEqual(scoreToLevel(2), 'low', 'score 2 should be low');
  assert.strictEqual(scoreToLevel(3), 'medium', 'score 3 should be medium');
  assert.strictEqual(scoreToLevel(5), 'medium', 'score 5 should be medium');
  assert.strictEqual(scoreToLevel(6), 'high', 'score 6 should be high');
  assert.strictEqual(scoreToLevel(10), 'high', 'score 10 should be high');
  assert.strictEqual(scoreToLevel(null), 'low', 'null score should fallback to low');
  assert.strictEqual(scoreToLevel(undefined), 'low', 'undefined score should fallback to low');

}

function testFileImpactSeverity() {
  // low
  assert.strictEqual(fileImpactSeverity(0, 0), 'low', 'no impact, no tests');
  assert.strictEqual(fileImpactSeverity(0, 1), 'medium', '1 affected test is medium');
  assert.strictEqual(fileImpactSeverity(1, 0), 'medium', '1 impact is medium');
  // medium boundary
  assert.strictEqual(fileImpactSeverity(5, 0), 'medium', '5 impact is medium');
  assert.strictEqual(fileImpactSeverity(0, 4), 'medium', '4 affected tests is medium');
  // high boundary
  assert.strictEqual(fileImpactSeverity(10, 0), 'high', '10 impact is high');
  assert.strictEqual(fileImpactSeverity(0, 5), 'high', '5 affected tests is high');
  assert.strictEqual(fileImpactSeverity(15, 10), 'high', 'both high');
  // fallback
  assert.strictEqual(fileImpactSeverity(null, null), 'low', 'null inputs fallback to low');

}

function testRepoSeverity() {
  // low
  assert.strictEqual(repoSeverity({}), 'low', 'empty repo is low');
  assert.strictEqual(repoSeverity({ deadExports: 0, missingHygieneChecks: 2 }), 'low', '2 hygiene gaps is low');
  // medium
  assert.strictEqual(repoSeverity({ deadExports: 1 }), 'medium', '1 dead export is medium');
  assert.strictEqual(repoSeverity({ missingHygieneChecks: 3 }), 'medium', '3 hygiene gaps is medium');
  // high
  assert.strictEqual(repoSeverity({ unresolved: 1 }), 'high', '1 unresolved is high');
  assert.strictEqual(repoSeverity({ cycles: 1 }), 'high', '1 cycle is high');
  assert.strictEqual(repoSeverity({ unresolved: 1, deadExports: 5 }), 'high', 'unresolved trumps medium');

}

function testDiffSeverity() {
  // low
  assert.strictEqual(diffSeverity({}), 'low', 'empty diff is low');
  // high via highRiskFileCount
  assert.strictEqual(diffSeverity({ highRiskFileCount: 1 }), 'high', '1 high-risk file is high');
  // high via affectedTestsCount
  assert.strictEqual(diffSeverity({ affectedTestsCount: 5 }), 'high', '5 affected tests is high');
  // high via highHistoryRiskFileCount
  assert.strictEqual(diffSeverity({ highHistoryRiskFileCount: 1 }), 'high', '1 high-history-risk file is high');
  // high via highCompositeRiskFileCount
  assert.strictEqual(diffSeverity({ highCompositeRiskFileCount: 1 }), 'high', '1 high-composite-risk file is high');
  // medium: needs mainlineChangedCount > 0 plus one trigger
  assert.strictEqual(
    diffSeverity({ mainlineChangedCount: 1, affectedTestsCount: 1 }),
    'medium',
    'mainline + 1 affected test is medium'
  );
  assert.strictEqual(
    diffSeverity({ mainlineChangedCount: 1, maxImpact: 1 }),
    'medium',
    'mainline + maxImpact 1 is medium'
  );
  assert.strictEqual(
    diffSeverity({ mainlineChangedCount: 1, maxHistoryRiskScore: 3 }),
    'medium',
    'mainline + history score 3 is medium'
  );
  assert.strictEqual(
    diffSeverity({ mainlineChangedCount: 1, maxCompositeRiskScore: 3 }),
    'medium',
    'mainline + composite score 3 is medium'
  );
  // no mainline = low even with other signals
  assert.strictEqual(
    diffSeverity({ affectedTestsCount: 1, maxImpact: 1 }),
    'low',
    'no mainline changes stays low'
  );

}

function testOverviewSeverity() {
  assert.strictEqual(overviewSeverity({}), 'low', 'empty overview is low');
  assert.strictEqual(overviewSeverity({ fragileModuleCount: 0 }), 'low', '0 fragile is low');
  assert.strictEqual(overviewSeverity({ fragileModuleCount: 1 }), 'medium', '1 fragile is medium');
  assert.strictEqual(overviewSeverity({ fragileModuleCount: 5 }), 'medium', '5 fragile is medium');

}

// Consistency guard: buildCompositeRisk must use the unified score->level mapping.
function testCrossModuleConsistency() {
  const { buildCompositeRisk } = require('../src/cli/formatters');

  const low = buildCompositeRisk({ impactCount: 0, affectedTestsCount: 0, historyRisk: { score: 0 } });
  assert.strictEqual(low.level, 'low', 'composite risk with zero inputs should be low');

  const medium = buildCompositeRisk({
    impactCount: 5,
    affectedTestsCount: 0,
    historyRisk: { score: 0 },
    symbolImpact: { mode: null },
  });
  assert.strictEqual(medium.level, 'medium', 'composite risk with impact 5 + 0 tests should be medium (3+2=5)');

  const high = buildCompositeRisk({
    impactCount: 10,
    affectedTestsCount: 0,
    historyRisk: { score: 0 },
    symbolImpact: { mode: null },
  });
  assert.strictEqual(high.level, 'high', 'composite risk with impact 10 + 0 tests should be high (3+3=6)');

  // Verify historyRisk score contributes +2 and the unified mapping is applied.
  const historyDriven = buildCompositeRisk({
    impactCount: 10,
    affectedTestsCount: 0,
    historyRisk: { score: 6 },
    symbolImpact: { mode: null },
  });
  assert.strictEqual(historyDriven.level, 'high', 'impact 10 (+4) + history 6 (+2) = 6 should be high');


}

testScoreToLevel();
testFileImpactSeverity();
testRepoSeverity();
testDiffSeverity();
testOverviewSeverity();
testCrossModuleConsistency();

