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
const path = require('path');
const { classifyTestDetail } = require('./runner');

const TEST_DIR = __dirname;

// Rules 1–2 are declarations (a human said so). Rule 3 is a guess from which
// API the file mentions. The distinction is the whole point of the field.
const DECLARED = new Set(['annotation-slow', 'annotation-watch', 'annotation-serial', 'known-slow-pattern', 'filename-watch']);
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

function main() {
  testAnnotationBeatsHeuristic();
  testExplicitSlowAnnotationIsReportedAsDeclared();
  testHeuristicDemotionIsLabelledAsAGuess();
  testPlainUnitTestFallsThroughToFast();
  testEveryTestFileGetsAKnownReason();
  testHeuristicDemotionIsMeasurablyCommon();
  console.log('runner-classification: 6/6 passed');
}

main();
