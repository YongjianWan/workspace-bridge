#!/usr/bin/env node
// @fast
// @semantic
/**
 * Focused node tests for a changed SOURCE file must ask the runner for the tests related to it.
 * `jest src/helper.js` treats the source path as a test-name pattern, matches nothing and exits 1
 * even though the mapped test passes (watch --run-tests then reports a failed validation).
 */
const assert = require('assert');
const { generateCommands } = require('../src/utils/stack-detectors/commands');

function focusedArgs(testRunner, targets) {
  const stack = { profile: 'node', node: { enabled: true, packageManager: 'npm', testRunner, linters: [] } };
  const cmd = generateCommands(stack, 'code', targets).focused.find((c) => c.name === 'node-focused-tests');
  assert(cmd, `${testRunner} must produce a focused command`);
  return cmd.executable.args;
}

const jest = focusedArgs('jest', ['src/helper.js']);
assert(jest.includes('--findRelatedTests'), `jest must use --findRelatedTests, got ${jest.join(' ')}`);
assert(jest.includes('--passWithNoTests'), 'no related test is not a failure');
assert(jest.indexOf('--findRelatedTests') < jest.indexOf('src/helper.js'), 'the source file follows the flag');

const vitest = focusedArgs('vitest', ['src/helper.js']);
assert.deepStrictEqual(vitest.slice(vitest.indexOf('vitest')), ['vitest', 'related', '--run', 'src/helper.js']);

// A changed test file is related to itself, so it still runs.
assert(focusedArgs('jest', ['src/helper.test.js']).includes('src/helper.test.js'));

// mocha has no related-tests mode: behaviour unchanged.
assert.deepStrictEqual(focusedArgs('mocha', ['src/helper.js']).slice(-2), ['mocha', 'src/helper.js']);
