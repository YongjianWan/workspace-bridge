#!/usr/bin/env node
// @contract

const assert = require('assert');

function capturePrintUsage(showAll) {
  const { printUsage } = require('../cli');
  let output = '';
  const originalLog = console.log;
  console.log = (...args) => {
    output += args.join(' ') + '\n';
  };
  try {
    printUsage(showAll);
  } finally {
    console.log = originalLog;
  }
  return output;
}

function testHelpOptionsAreShared() {
  const { COMMON_OPTIONS } = require('../cli');
  assert(Array.isArray(COMMON_OPTIONS), 'cli.js should export COMMON_OPTIONS');
  assert(COMMON_OPTIONS.length > 0, 'COMMON_OPTIONS should not be empty');
  assert(COMMON_OPTIONS.some((line) => line.includes('--cwd')), 'COMMON_OPTIONS should include --cwd');

  const short = capturePrintUsage(false);
  const long = capturePrintUsage(true);

  // Both help surfaces must render every option from the single shared source.
  for (const line of COMMON_OPTIONS) {
    const flag = line.trim().split(/\s+/)[0];
    assert(short.includes(flag), `short help should include ${flag}`);
    assert(long.includes(flag), `long help should include ${flag}`);
  }

  // Sanity: the two command lists should still differ (short is a curated subset).
  assert(short.includes('Curated Commands'), 'short help should use curated command list');
  assert(long.includes('L1 策展入口'), 'long help should use full command list');
}

function main() {
  testHelpOptionsAreShared();
  console.log('cli-help-dry-test.js: all passed');
}

main();
