#!/usr/bin/env node
// @semantic
const assert = require('assert');
const { createMockDepGraph } = require('./test-helpers');
const { getSymbolImpact } = require('../src/services/dep-graph/symbol-impact');

const SPRING_NOTE = 'Java Spring 依赖注入与反射调用无法静态解析，symbol-level dependents 可能不完整';

function testSpringSymbolImpactNote() {
  const file = '/repo/src/main/java/com/example/Controller.java';
  const depGraph = createMockDepGraph({
    root: '/repo',
    schema: {
      [file]: {
        imports: [],
        exports: ['Controller', 'handle'],
        exportRecords: [{ name: 'Controller' }, { name: 'handle' }],
        importRecords: [],
        parseMode: 'ast',
      },
    },
  });

  // Override framework hint to simulate Spring framework detection.
  depGraph.getFrameworkHint = () => 'spring';

  const result = getSymbolImpact(depGraph, file);
  assert.strictEqual(result.note, SPRING_NOTE, 'Spring files should carry a symbolImpact note about DI/reflection limits');
}

function testNonSpringHasNoNote() {
  const file = '/repo/src/main/java/com/example/Plain.java';
  const depGraph = createMockDepGraph({
    root: '/repo',
    schema: {
      [file]: {
        imports: [],
        exports: ['Plain'],
        exportRecords: [{ name: 'Plain' }],
        importRecords: [],
        parseMode: 'ast',
      },
    },
  });

  depGraph.getFrameworkHint = () => null;

  const result = getSymbolImpact(depGraph, file);
  assert.strictEqual(result.note, undefined, 'Non-Spring files should not carry the Spring note');
}

function testSpringBootAlsoGetsNote() {
  const file = '/repo/src/main/java/com/example/BootApp.java';
  const depGraph = createMockDepGraph({
    root: '/repo',
    schema: {
      [file]: {
        imports: [],
        exports: ['BootApp'],
        exportRecords: [{ name: 'BootApp' }],
        importRecords: [],
        parseMode: 'ast',
      },
    },
  });

  depGraph.getFrameworkHint = () => 'springboot';

  const result = getSymbolImpact(depGraph, file);
  assert.strictEqual(result.note, SPRING_NOTE, 'springboot framework hint should also trigger the note');
}

function main() {
  testSpringSymbolImpactNote();
  testNonSpringHasNoNote();
  testSpringBootAlsoGetsNote();
}

main();
