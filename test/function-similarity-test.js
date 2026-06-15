#!/usr/bin/env node
// @semantic

const assert = require('assert');
const { compareFunctionRecords } = require('../src/services/dep-graph/function-similarity');

function testExactNameMatch() {
  const a = { name: 'calculateTotal' };
  const b = { name: 'calculateTotal' };
  const result = compareFunctionRecords(a, b);
  assert.strictEqual(result.mode, 'name-only', 'no fingerprint → name-only');
  assert(result.score > 0.99, `exact name should score ~1, got ${result.score}`);
  assert.strictEqual(result.nameScore, 1);
}

function testNoFingerprintNameOnly() {
  const a = { name: 'fetchUserData' };
  const b = { name: 'fetchOrderData' };
  const result = compareFunctionRecords(a, b);
  assert.strictEqual(result.mode, 'name-only');
  assert(result.nameScore > 0 && result.nameScore < 1, 'partial name match should be between 0 and 1');
  assert.strictEqual(result.structureScore, null);
}

function testStructuralSimilarity() {
  const a = {
    name: 'processPayment',
    fingerprint: {
      paramCount: 3,
      isAsync: true,
      isGenerator: false,
      hasTryCatch: true,
      branchCount: 2,
      returnCount: 1,
      callCallees: ['validate', 'save', 'notify'],
    },
  };
  const b = {
    name: 'processRefund',
    fingerprint: {
      paramCount: 3,
      isAsync: true,
      isGenerator: false,
      hasTryCatch: true,
      branchCount: 2,
      returnCount: 1,
      callCallees: ['validate', 'save', 'notify'],
    },
  };
  const result = compareFunctionRecords(a, b);
  assert.strictEqual(result.mode, 'structure+name');
  assert(result.structureScore > 0.99, `identical structure should score ~1, got ${result.structureScore}`);
  assert(result.score >= 0.875, `high overall score expected, got ${result.score}`);
}

function testStructuralDifference() {
  const a = {
    name: 'getUser',
    fingerprint: {
      paramCount: 1,
      isAsync: false,
      isGenerator: false,
      hasTryCatch: false,
      branchCount: 0,
      returnCount: 1,
      callCallees: ['db.query'],
    },
  };
  const b = {
    name: 'createReport',
    fingerprint: {
      paramCount: 5,
      isAsync: true,
      isGenerator: false,
      hasTryCatch: true,
      branchCount: 4,
      returnCount: 2,
      callCallees: ['render', 'export', 'email'],
    },
  };
  const result = compareFunctionRecords(a, b);
  assert.strictEqual(result.mode, 'structure+name');
  assert(result.structureScore < 0.5, `very different structure should score low, got ${result.structureScore}`);
  assert(result.score < 0.6, `low overall score expected, got ${result.score}`);
}

function testPartialFingerprint() {
  const a = { name: 'foo' };
  const b = { name: 'foo', fingerprint: { paramCount: 2 } };
  const result = compareFunctionRecords(a, b);
  // a has no fingerprint, so structuralSimilarity returns null, falls back to name-only
  assert.strictEqual(result.mode, 'name-only');
  assert.strictEqual(result.structureScore, null);
}

function testEmptyRecords() {
  const result = compareFunctionRecords({}, {});
  assert.strictEqual(result.mode, 'name-only');
  assert.strictEqual(result.nameScore, 0);
  assert.strictEqual(result.score, 0);
}

function testNameTokenization() {
  // camelCase vs snake_case vs kebab-case
  const a = { name: 'getUserById' };
  const b = { name: 'get_user_by_id' };
  const result = compareFunctionRecords(a, b);
  assert(result.nameScore > 0.8, `same tokens different case style should match high, got ${result.nameScore}`);
}

function testCalleeOverlap() {
  const a = {
    name: 'handlerA',
    fingerprint: {
      paramCount: 2,
      isAsync: false,
      isGenerator: false,
      hasTryCatch: false,
      branchCount: 1,
      returnCount: 1,
      callCallees: ['log', 'db.save'],
    },
  };
  const b = {
    name: 'handlerB',
    fingerprint: {
      paramCount: 2,
      isAsync: false,
      isGenerator: false,
      hasTryCatch: false,
      branchCount: 1,
      returnCount: 1,
      callCallees: ['log', 'db.load'],
    },
  };
  const result = compareFunctionRecords(a, b);
  assert(result.structureScore > 0.5, `partial callee overlap should give moderate structure score, got ${result.structureScore}`);
}

function main() {
  testExactNameMatch();
  testNoFingerprintNameOnly();
  testStructuralSimilarity();
  testStructuralDifference();
  testPartialFingerprint();
  testEmptyRecords();
  testNameTokenization();
  testCalleeOverlap();
}

main();
