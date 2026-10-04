#!/usr/bin/env node
// @semantic — Ledger contract: reason codes, warning shape, replace/clear semantics.
const assert = require('assert');
const { Ledger, REASON_CODES } = require('../src/services/ledger');

function testWarningsCarryCodeSeverityAndFields() {
  const ledger = new Ledger();
  ledger.record('depth-truncated', { files: 3, message: 'm' });
  assert.deepStrictEqual(ledger.warnings(), [{ type: 'depth-truncated', severity: REASON_CODES['depth-truncated'].severity, files: 3, message: 'm' }]);
}

function testUnknownCodeThrows() {
  assert.throws(() => new Ledger().record('depth-trunctated', {}), /Unknown ledger reason code/);
}

function testReplaceRecomputesInsteadOfAppending() {
  const ledger = new Ledger();
  ledger.record('file-too-large', { files: 2 });
  ledger.replace('file-too-large', [{ files: 1 }]);
  assert.deepStrictEqual(ledger.warnings().map((w) => w.files), [1]);
  ledger.replace('file-too-large', []);
  assert.strictEqual(ledger.has('file-too-large'), false, 'a state that no longer holds leaves no warning');
}

function testClearWithMatchKeepsOtherStages() {
  const ledger = new Ledger();
  ledger.record('analysis-stage-failed', { stage: 'graph:built', message: 'a' });
  ledger.record('analysis-stage-failed', { stage: 'graph:updated', message: 'b' });
  ledger.clear('analysis-stage-failed', { stage: 'graph:built' });
  assert.deepStrictEqual(ledger.warnings().map((w) => w.stage), ['graph:updated']);
}

(() => {
  testWarningsCarryCodeSeverityAndFields();
  testUnknownCodeThrows();
  testReplaceRecomputesInsteadOfAppending();
  testClearWithMatchKeepsOtherStages();
  console.log('ledger-test: OK');
})();
