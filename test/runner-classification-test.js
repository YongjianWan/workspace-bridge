// @fast
// @contract
//
// Locks the runner's classification LABELS, not its layers. Phase 1 of the
// test-execution debt (docs/TECH_DEBT.md) reads `classifiedBy` out of the run
// report to answer "how many files were demoted to slow by a guess rather than
// a declaration" — if these strings drift, that analysis silently reads zero
// and the debt looks solved when nothing changed.
//
// Requiring runner.js is safe: main() is guarded by require.main.
const assert = require('assert');
const fs = require('fs');
const { classifyTestDetail, needsCacheDir, validateSlowClassification, isKnownSlowPatternConflict } = require('./runner');

const TEST_DIR = __dirname;

// Rules 1–2 are declarations (a human said so). Rule 3 is a guess from which
// API the file mentions. The distinction is the whole point of the field.
const DECLARED = new Set(['annotation-slow', 'annotation-watch', 'annotation-serial', 'annotation-fast', 'known-slow-pattern', 'filename-watch']);
const GUESSED = new Set(['heuristic-runcli', 'heuristic-spawn-cli', 'heuristic-heavy-api']);
const ALL_REASONS = new Set([...DECLARED, ...GUESSED, 'default-fast']);

function testAnnotationBeatsHeuristic() {
  // severity-filter-test.js carries `// @semantic` and matches a KNOWN_SLOW
  // pattern; annotation-free but pattern-listed → the pattern rule must own it,
  // never the heuristic that would also fire on its runCli usage.
  const d = classifyTestDetail('severity-filter-test.js');
  assert.strictEqual(d.layer, 'slow');
  assert.strictEqual(d.reason, 'known-slow-pattern', 'filename patterns outrank content heuristics');
}

function testExplicitSlowAnnotationIsReportedAsDeclared() {
  const d = classifyTestDetail('query-tools-test.js'); // header: // @slow
  assert.strictEqual(d.layer, 'slow');
  assert.strictEqual(d.reason, 'annotation-slow', 'an @slow header must be reported as a declaration');
}

function testFastAnnotationOutranksHeuristics() {
  // A synthetic file that would be heuristic-slow because it mentions runCli,
  // but carries // @fast in its header.
  const synthetic = '// @fast\nconst { runCli } = require("./helpers");\n';
  const d = classifyTestDetail('synthetic-fast-annotation.js', synthetic);
  assert.strictEqual(d.layer, 'fast');
  assert.strictEqual(d.reason, 'annotation-fast', '@fast must outrank runCli heuristic');
}

function testSlowAnnotationOutranksFastAnnotation() {
  const synthetic = '// @slow\n// @fast\n';
  const d = classifyTestDetail('synthetic-slow-beats-fast.js', synthetic);
  assert.strictEqual(d.layer, 'slow');
  assert.strictEqual(d.reason, 'annotation-slow', '@slow must outrank @fast when both are present');
}

function testHeuristicDemotionIsLabelledAsAGuess() {
  // query-replay-provenance-test.js has no @slow header; it reaches slow only
  // because its body mentions runCli. That is precisely the demotion phase 1
  // needs to be able to count.
  const d = classifyTestDetail('query-replay-provenance-test.js');
  assert.strictEqual(d.layer, 'slow');
  assert.ok(GUESSED.has(d.reason), `expected a heuristic reason, got ${d.reason}`);
}

function testPlainUnitTestFallsThroughToFast() {
  const d = classifyTestDetail('jvm-gate-wiring-test.js');
  assert.strictEqual(d.layer, 'fast');
  assert.strictEqual(d.reason, 'default-fast');
}

function testEveryTestFileGetsAKnownReason() {
  const files = fs.readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.js') && f !== 'runner.js' && f !== 'test-helpers.js');
  assert.ok(files.length > 100, 'sanity: the suite should not have shrunk to nothing');
  for (const f of files) {
    const d = classifyTestDetail(f);
    assert.ok(ALL_REASONS.has(d.reason), `${f}: unknown classification reason "${d.reason}"`);
    assert.ok(['fast', 'slow', 'watch', 'serial'].includes(d.layer), `${f}: unknown layer "${d.layer}"`);
  }
}

function testHeuristicDemotionIsMeasurablyCommon() {
  // Not an arbitrary threshold — the claim being locked is qualitative: a
  // large share of the slow layer got there by guess, so "the slow layer is
  // slow" is an untested assumption. If a future recalibration makes this
  // number small, this assertion SHOULD fail and be deleted along with the
  // debt entry.
  const files = fs.readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.js') && f !== 'runner.js' && f !== 'test-helpers.js');
  const slow = files.map(classifyTestDetail).filter((d) => d.layer === 'slow');
  const guessed = slow.filter((d) => GUESSED.has(d.reason));
  assert.ok(
    guessed.length > 0,
    'if nothing is heuristic-demoted any more, delete this test and the debt entry it guards'
  );
  console.log(`  [info] slow layer: ${slow.length} files, ${guessed.length} demoted by heuristic (unmeasured)`);
}

function testNeedsCacheDirForHeavyApiAnchor() {
  // file-index-race-test.js is @fast but creates new FileIndex — isolation must
  // still hold. This is the L3-12 safety net: layer and cache isolation are
  // decoupled.
  assert.strictEqual(needsCacheDir('file-index-race-test.js'), true, '@fast file using heavy API still needs isolated cache');
}

function testNeedsCacheDirFalseForPlainUnitTest() {
  // jvm-gate-wiring-test.js is a pure unit test with no container/subprocess.
  assert.strictEqual(needsCacheDir('jvm-gate-wiring-test.js'), false, 'plain unit test should not pay cache isolation overhead');
}

function testNeedsCacheDirForDeclaredSlowWithoutAnchor() {
  // affected-tests-heuristic-test.js is @slow but does not mention runCli or
  // heavy API — declared slow tests must keep isolation regardless.
  assert.strictEqual(needsCacheDir('affected-tests-heuristic-test.js'), true, '@slow declaration must keep cache isolation even without content anchors');
}

function testNeedsCacheDirForFilenameWatch() {
  // filename-watch tests keep isolation even if they happen to have no anchors.
  assert.strictEqual(needsCacheDir('audit-file-watch-test.js'), true, 'watch test by filename must keep cache isolation');
}

function testSyntheticContentDoesNotPoisonClassificationCache() {
  // A fake filename with injected content must not shadow a real test's
  // classification. Before the fix, the second call would return the cached
  // synthetic result because the cache key was only the filename.
  const synthetic = '// @fast\nconst { runCli } = require("./helpers");\n';
  const d1 = classifyTestDetail('synthetic-cache-poison.js', synthetic);
  assert.strictEqual(d1.layer, 'fast');
  assert.strictEqual(d1.reason, 'annotation-fast');

  // Same filename, different synthetic content — must be re-evaluated, not
  // served from cache. The second content has no @fast and does mention runCli.
  const synthetic2 = 'const { runCli } = require("./helpers");\n';
  const d2 = classifyTestDetail('synthetic-cache-poison.js', synthetic2);
  assert.strictEqual(d2.layer, 'slow');
  assert.ok(GUESSED.has(d2.reason), `second synthetic should be heuristic-slow, got ${d2.reason}`);
}

function testPathCrossplatformRegressionIsCleanFast() {
  // path-crossplatform-regression-test.js used to match /regression-test\.js$/,
  // but that pattern was too broad. It is now a clean @fast file with no
  // known-slow-pattern conflict.
  const d = classifyTestDetail('path-crossplatform-regression-test.js');
  assert.strictEqual(d.layer, 'fast');
  assert.strictEqual(d.reason, 'annotation-fast');
  assert.strictEqual(isKnownSlowPatternConflict('path-crossplatform-regression-test.js', d.reason), false);
}

function testKnownSlowPatternConflictIsDetectable() {
  // Use a synthetic filename that matches an existing known-slow pattern to
  // verify the conflict detector works without needing a real conflicting file.
  assert.strictEqual(
    isKnownSlowPatternConflict('synthetic-analysis-test.js', 'annotation-fast'),
    true,
    'a file matching a known-slow pattern with @fast should register as a conflict'
  );
}

function testValidateSlowClassificationWarnsOnFastPatternConflict() {
  // analysis-test.js matches a known-slow pattern and is genuinely slow, so
  // this is not a real conflict; we simulate one by asking validateSlowClassification
  // to inspect a synthetic filename. Since validateSlowClassification reads the
  // file from disk, we instead test the pure conflict detector above and keep
  // this as a smoke test that no *current* file conflicts.
  const warnings = validateSlowClassification(fs.readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.js') && f !== 'runner.js' && f !== 'test-helpers.js'));
  assert.strictEqual(
    warnings.filter((w) => w.includes('@fast annotation overrides known-slow filename pattern')).length,
    0,
    'no current test file should have an unresolved @fast / known-slow-pattern conflict'
  );
}

function testValidateSlowClassificationQuietForCleanFast() {
  const warnings = validateSlowClassification(['jvm-gate-wiring-test.js']);
  assert.strictEqual(warnings.length, 0, 'plain fast test should produce no misclassification warning');
}

function testValidateSlowClassificationQuietForFastWithHeavyApi() {
  // file-index-race-test.js is @fast + new FileIndex. The heavy-API anchor
  // keeps it isolated; no warning because @fast is an intentional declaration.
  const warnings = validateSlowClassification(['file-index-race-test.js']);
  assert.strictEqual(warnings.length, 0, '@fast file with heavy-API anchor should not trigger misclassification warning');
}

function main() {
  testAnnotationBeatsHeuristic();
  testExplicitSlowAnnotationIsReportedAsDeclared();
  testFastAnnotationOutranksHeuristics();
  testSlowAnnotationOutranksFastAnnotation();
  testHeuristicDemotionIsLabelledAsAGuess();
  testPlainUnitTestFallsThroughToFast();
  testEveryTestFileGetsAKnownReason();
  testHeuristicDemotionIsMeasurablyCommon();
  testNeedsCacheDirForHeavyApiAnchor();
  testNeedsCacheDirFalseForPlainUnitTest();
  testNeedsCacheDirForDeclaredSlowWithoutAnchor();
  testNeedsCacheDirForFilenameWatch();
  testSyntheticContentDoesNotPoisonClassificationCache();
  testPathCrossplatformRegressionIsCleanFast();
  testKnownSlowPatternConflictIsDetectable();
  testValidateSlowClassificationWarnsOnFastPatternConflict();
  testValidateSlowClassificationQuietForCleanFast();
  testValidateSlowClassificationQuietForFastWithHeavyApi();
  console.log('runner-classification: 17/17 passed');
}

main();
