#!/usr/bin/env node
// @contract
const assert = require('assert');
const { DATA_QUALITY, REMEDIATION } = require('../src/config/data-quality');

function testDataQualityThreeStateContract() {
  assert.deepStrictEqual(
    Object.values(DATA_QUALITY).sort(),
    ['certain', 'degraded', 'unavailable'],
    'DATA_QUALITY must expose exactly the three-state contract'
  );
}

function testRemediationKeys() {
  const expectedKeys = [
    'SHALLOW_CLONE',
    'SPARSE_CHECKOUT',
    'SUBMODULE_BOUNDARY',
    'LFS_POINTER',
    'MONOREPO_ROOT',
  ];
  for (const key of expectedKeys) {
    assert(
      Object.prototype.hasOwnProperty.call(REMEDIATION, key),
      `REMEDIATION must contain ${key}`
    );
    assert.strictEqual(typeof REMEDIATION[key], 'string', `${key} remediation must be a string`);
    assert(REMEDIATION[key].length > 0, `${key} remediation must not be empty`);
  }
}

function main() {
  testDataQualityThreeStateContract();
  testRemediationKeys();
}

main();
