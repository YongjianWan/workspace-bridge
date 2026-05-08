#!/usr/bin/env node
const assert = require('assert');
const { DependencyGraph } = require('../src/services/dep-graph');
const { normalizePathKey } = require('../src/utils/path');

function n(p) {
  return normalizePathKey(p);
}

function testNoImporterReliableGraph() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');

  dg.graph = new Map([
    [file, { imports: [], exports: ['foo'], importRecords: [], exportRecords: [{ name: 'foo' }], parseMode: 'ast', confidence: 'high' }],
  ]);
  dg.reverseGraph = new Map([[file, []]]);

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should report dead export');
  assert.strictEqual(item.confidence, 'high');
  assert.ok(item.confidenceReason.includes('No files import'), `reason should explain no importers: ${item.confidenceReason}`);
  console.log('testNoImporterReliableGraph: ok');
}

function testNoImporterUnreliableGraph() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');

  // Many files, very few edges → graph unreliable
  dg.graph = new Map([
    [file, { imports: [], exports: ['foo'], importRecords: [], exportRecords: [{ name: 'foo' }], parseMode: 'ast', confidence: 'high' }],
    [n('/repo/a.js'), { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast', confidence: 'high' }],
    [n('/repo/b.js'), { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast', confidence: 'high' }],
  ]);
  dg.reverseGraph = new Map([[file, []], [n('/repo/a.js'), []], [n('/repo/b.js'), []]]);

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should report dead export');
  assert.strictEqual(item.confidence, 'low');
  assert.ok(item.confidenceReason.includes('sparse'), `reason should mention sparse graph: ${item.confidenceReason}`);
  console.log('testNoImporterUnreliableGraph: ok');
}

function testFewImportersAst() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');
  const importer = n('/repo/app.js');

  dg.graph = new Map([
    [file, { imports: [], exports: ['foo', 'bar'], importRecords: [], exportRecords: [{ name: 'foo' }, { name: 'bar' }], parseMode: 'ast', confidence: 'high' }],
    [importer, { imports: [file], exports: [], importRecords: [{ source: './lib', imported: ['foo'], resolved: file }], exportRecords: [], parseMode: 'ast', confidence: 'high' }],
  ]);
  dg.reverseGraph = new Map([[file, [importer]], [importer, []]]);

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should report dead export');
  assert.strictEqual(item.confidence, 'medium');
  assert.ok(item.confidenceReason.includes('AST-level'), `reason should mention AST: ${item.confidenceReason}`);
  console.log('testFewImportersAst: ok');
}

function testManyImportersAst() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');

  dg.graph = new Map([
    [file, { imports: [], exports: ['foo'], importRecords: [], exportRecords: [{ name: 'foo' }], parseMode: 'ast', confidence: 'high' }],
    [n('/repo/a.js'), { imports: [file], exports: [], importRecords: [{ source: './lib', imported: ['bar'], resolved: file }], exportRecords: [], parseMode: 'ast', confidence: 'high' }],
    [n('/repo/b.js'), { imports: [file], exports: [], importRecords: [{ source: './lib', imported: ['baz'], resolved: file }], exportRecords: [], parseMode: 'ast', confidence: 'high' }],
    [n('/repo/c.js'), { imports: [file], exports: [], importRecords: [{ source: './lib', imported: ['qux'], resolved: file }], exportRecords: [], parseMode: 'ast', confidence: 'high' }],
  ]);
  dg.reverseGraph = new Map([
    [file, [n('/repo/a.js'), n('/repo/b.js'), n('/repo/c.js')]],
    [n('/repo/a.js'), []],
    [n('/repo/b.js'), []],
    [n('/repo/c.js'), []],
  ]);

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should report dead export');
  // AST findings are NOT downgraded by importerCount. A file may have many
  // importers (because other exports are widely used) while a specific export
  // is genuinely unused. AST-level symbol tracking is the authoritative signal.
  assert.strictEqual(item.confidence, 'medium');
  assert.ok(item.confidenceReason.includes('AST-level'), `reason should mention AST: ${item.confidenceReason}`);
  console.log('testManyImportersAst: ok');
}

function testRegexMode() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.rs');
  const importer = n('/repo/main.rs');

  dg.graph = new Map([
    [file, { imports: [], exports: ['foo', 'bar'], importRecords: [], exportRecords: [{ name: 'foo' }, { name: 'bar' }], parseMode: 'regex', confidence: 'medium' }],
    [importer, { imports: [file], exports: [], importRecords: [{ source: './lib', imported: ['foo'], resolved: file }], exportRecords: [], parseMode: 'regex', confidence: 'medium' }],
  ]);
  dg.reverseGraph = new Map([[file, [importer]], [importer, []]]);

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should report dead export');
  assert.deepStrictEqual(item.exports, ['bar']);
  assert.strictEqual(item.confidence, 'low');
  assert.ok(item.confidenceReason.includes('Regex-based'), `reason should mention regex: ${item.confidenceReason}`);
  console.log('testRegexMode: ok');
}

function main() {
  testNoImporterReliableGraph();
  testNoImporterUnreliableGraph();
  testFewImportersAst();
  testManyImportersAst();
  testRegexMode();
  console.log('dead-export-confidence-test: all passed');
}

main();
