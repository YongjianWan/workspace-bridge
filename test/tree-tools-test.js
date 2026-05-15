#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildTree } = require('../src/tools/tree-tools');

function createMockDepGraph(dependencies, dependents) {
  return {
    getDependencies: (file) => dependencies[file] || [],
    getDependents: (file) => dependents[file] || [],
    hasFile: (file) => dependencies[file] !== undefined || dependents[file] !== undefined,
    normalizeFilePath: (f) => f,
  };
}

function testBuildTreeImportsOnly() {
  const deps = {
    'a.js': ['b.js', 'c.js'],
    'b.js': ['d.js'],
    'c.js': [],
    'd.js': [],
  };
  const dg = createMockDepGraph(deps, {});
  const tree = buildTree('a.js', dg, { maxDepth: 3, direction: 'imports' });

  assert.strictEqual(tree.file, 'a.js');
  assert.strictEqual(tree.imports.length, 2);
  assert.strictEqual(tree.imports[0].file, 'b.js');
  assert.strictEqual(tree.imports[0].imports.length, 1);
  assert.strictEqual(tree.imports[0].imports[0].file, 'd.js');
  assert.strictEqual(tree.imports[1].file, 'c.js');
  assert.strictEqual(tree.dependents, undefined);
}

function testBuildTreeDependentsOnly() {
  const dents = {
    'a.js': ['b.js', 'c.js'],
    'b.js': ['d.js'],
    'c.js': [],
    'd.js': [],
  };
  const dg = createMockDepGraph({}, dents);
  const tree = buildTree('a.js', dg, { maxDepth: 3, direction: 'dependents' });

  assert.strictEqual(tree.file, 'a.js');
  assert.strictEqual(tree.dependents.length, 2);
  assert.strictEqual(tree.dependents[0].file, 'b.js');
  assert.strictEqual(tree.dependents[0].dependents.length, 1);
  assert.strictEqual(tree.dependents[0].dependents[0].file, 'd.js');
  assert.strictEqual(tree.imports, undefined);
}

function testBuildTreeRespectsMaxDepth() {
  const deps = {
    'a.js': ['b.js'],
    'b.js': ['c.js'],
    'c.js': ['d.js'],
  };
  const dg = createMockDepGraph(deps, {});
  const tree = buildTree('a.js', dg, { maxDepth: 2, direction: 'imports' });

  assert.strictEqual(tree.imports[0].file, 'b.js');
  assert.strictEqual(tree.imports[0].imports[0].file, 'c.js');
  // maxDepth=2: c.js (depth=2) shows d.js as a leaf but does not expand further
  assert.strictEqual(tree.imports[0].imports[0].imports[0].file, 'd.js');
  assert.strictEqual(tree.imports[0].imports[0].imports[0].imports, undefined, 'depth=3 should not expand further');
}

function testBuildTreeBothDirections() {
  const deps = {
    'a.js': ['b.js'],
    'b.js': ['c.js'],
  };
  const dents = {
    'a.js': ['x.js'],
    'x.js': ['y.js'],
  };
  const dg = createMockDepGraph(deps, dents);
  const tree = buildTree('a.js', dg, { maxDepth: 2, direction: 'both' });

  assert.ok(tree.imports, 'should have imports');
  assert.ok(tree.dependents, 'should have dependents');
}

function testBuildTreeMarksExternal() {
  const deps = {
    'a.js': ['external-lib'],
  };
  const dg = createMockDepGraph(deps, {});
  const tree = buildTree('a.js', dg, { maxDepth: 2, direction: 'imports' });

  assert.strictEqual(tree.imports[0].external, true);
  assert.strictEqual(tree.imports[0].file, 'external-lib');
}

function main() {
  testBuildTreeImportsOnly();
  testBuildTreeDependentsOnly();
  testBuildTreeRespectsMaxDepth();
  testBuildTreeBothDirections();
  testBuildTreeMarksExternal();
  console.log('tree-tools-test: all passed');
}

main();
