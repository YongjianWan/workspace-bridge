#!/usr/bin/env node
const assert = require('assert');
const { normalizePathKey } = require('../src/utils/path');
const { DependencyGraph } = require('../src/services/dep-graph');

function n(p) {
  return normalizePathKey(p);
}

function makeGraph() {
  const depGraph = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const fooPath = n('/repo/src/main/java/com/example/Foo.java');
  const consumerPath = n('/repo/src/main/java/com/example/Consumer.java');
  const regexPath = n('/repo/src/main/java/com/example/RegexOnly.java');

  depGraph.graph = new Map([
    [fooPath, {
      imports: [],
      exports: ['Foo', 'bar', 'baz'],
      importRecords: [],
      exportRecords: [{ name: 'Foo' }, { name: 'bar' }, { name: 'baz' }],
      parseMode: 'ast',
      confidence: 'high',
    }],
    [consumerPath, {
      imports: [fooPath],
      exports: ['Consumer'],
      importRecords: [{
        source: 'com.example.Foo',
        imported: ['Foo'],
        usesAllExports: false,
        resolved: fooPath,
      }],
      exportRecords: [{ name: 'Consumer' }],
      parseMode: 'ast',
      confidence: 'high',
    }],
    [regexPath, {
      imports: [],
      exports: ['RegexOnly'],
      importRecords: [],
      exportRecords: [{ name: 'RegexOnly' }],
      parseMode: 'regex',
      confidence: 'medium',
    }],
  ]);
  depGraph.reverseGraph = new Map([
    [fooPath, [consumerPath]],
  ]);
  return depGraph;
}

function main() {
  const depGraph = makeGraph();

  const dead = depGraph.findDeadExports();

  // Foo.java has an importer (Consumer.java), so it should NOT be reported as dead exports
  // even though methods 'bar' and 'baz' are not explicitly imported.
  const fooPath = n('/repo/src/main/java/com/example/Foo.java');
  const regexPath = n('/repo/src/main/java/com/example/RegexOnly.java');

  const fooDead = dead.find((d) => d.file === fooPath);
  assert(!fooDead, 'Java AST file with importers should not produce symbol-level dead exports');

  // RegexOnly.java has no importer, so it should be reported as dead
  const regexDead = dead.find((d) => d.file === regexPath);
  assert(regexDead, 'Java regex file with no importers should be reported as dead');
  assert.strictEqual(regexDead.confidence, 'high');

  console.log('java-dead-export-test: ok');
}

main();
