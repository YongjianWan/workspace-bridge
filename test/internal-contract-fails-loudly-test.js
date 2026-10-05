#!/usr/bin/env node
// @fast
// @semantic
/**
 * The dependency graph is an internal object: a missing method is a programming error and must
 * throw where it happens, not be absorbed into an empty result that an agent would trust.
 */
const assert = require('assert');
const { buildStability } = require('../src/tools/overview-assembler');
const dependencies = require('../src/tools/dep-tools/dependencies');
const dependents = require('../src/tools/dep-tools/dependents');

const classify = { classifyFile: () => ({ fileRole: 'library', isMainline: true }) };
const noMethods = {};
// A graph that has everything except `_displayPath`.
const partial = {
  findCircularDependencies: () => [],
  getDependents: () => [],
  getDependencies: () => [],
  isTestLikeFile: () => false,
};

assert.throws(() => buildStability('/r', noMethods, ['/r/a.js'], classify), TypeError, 'graph without findCircularDependencies');
assert.throws(() => buildStability('/r', partial, ['/r/a.js'], classify), TypeError, 'graph without _displayPath');

const missingDisplay = { snapshot: { graph: { getDependencies: () => [], getDependents: () => [] } } };
assert.throws(() => dependencies({ file: 'a.js' }, missingDisplay, '/r/a.js'), TypeError);
assert.throws(() => dependents({ file: 'a.js' }, missingDisplay, '/r/a.js'), TypeError);

// A complete graph still works, with an empty result.
const complete = { ...partial, _displayPath: (p) => p };
assert.deepStrictEqual(buildStability('/r', complete, [], classify), []);
const ok = dependencies({ file: 'a.js' }, { snapshot: { graph: complete } }, '/r/a.js');
assert.strictEqual(ok.dependenciesCount, 0);
