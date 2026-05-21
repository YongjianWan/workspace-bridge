#!/usr/bin/env node
const assert = require('assert');
const { DependencyGraph } = require('../src/services/dep-graph');
const { SymbolRegistry } = require('../src/services/dep-graph/symbol-registry');
const { normalizePathKey } = require('../src/utils/path');
const { buildMockDepGraph } = require('./test-helpers');

function n(p) {
  return normalizePathKey(p);
}

function testNoImporterReliableGraph() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');

  dg.graph = buildMockDepGraph({
    [file]: { imports: [], exports: ['foo'], importRecords: [], exportRecords: [{ name: 'foo' }], parseMode: 'ast', confidence: 'high' },
  });
  dg.reverseGraph = new Map([[file, []]]);

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should report dead export');
  assert.strictEqual(item.confidence, 'high');
  assert.strictEqual(item.confidenceValue, 0.95, 'high confidence should have numeric value 0.95');
  assert.strictEqual(item.confidenceSource, 'ast-no-importer', 'source should indicate AST analysis');
  assert.ok(item.confidenceReason.includes('No files import'), `reason should explain no importers: ${item.confidenceReason}`);
}

function testNoImporterUnreliableGraph() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');

  // Many files, very few edges → graph unreliable
  dg.graph = buildMockDepGraph({
    [file]: { imports: [], exports: ['foo'], importRecords: [], exportRecords: [{ name: 'foo' }], parseMode: 'ast', confidence: 'high' },
    [n('/repo/a.js')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast', confidence: 'high' },
    [n('/repo/b.js')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast', confidence: 'high' },
  });
  dg.reverseGraph = new Map([[file, []], [n('/repo/a.js'), []], [n('/repo/b.js'), []]]);

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should report dead export');
  assert.strictEqual(item.confidence, 'low');
  assert.strictEqual(item.confidenceValue, 0.5, 'low confidence should have numeric value 0.5');
  assert.strictEqual(item.confidenceSource, 'graph-sparse', 'source should indicate sparse graph');
  assert.ok(item.confidenceReason.includes('sparse'), `reason should mention sparse graph: ${item.confidenceReason}`);
}

function testFewImportersAst() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');
  const importer = n('/repo/app.js');

  dg.graph = buildMockDepGraph({
    [file]: { imports: [], exports: ['foo', 'bar'], importRecords: [], exportRecords: [{ name: 'foo' }, { name: 'bar' }], parseMode: 'ast', confidence: 'high' },
    [importer]: { imports: [file], exports: [], importRecords: [{ source: './lib', imported: ['foo'], resolved: file }], exportRecords: [], parseMode: 'ast', confidence: 'high' },
  });
  dg.reverseGraph = new Map([[file, [importer]], [importer, []]]);

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should report dead export');
  assert.strictEqual(item.confidence, 'medium');
  assert.strictEqual(item.confidenceValue, 0.9, 'medium confidence should have numeric value 0.9');
  assert.strictEqual(item.confidenceSource, 'ast-unused-exports', 'source should indicate AST unused exports');
  assert.ok(item.confidenceReason.includes('AST-level'), `reason should mention AST: ${item.confidenceReason}`);
}

function testManyImportersAst() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');

  dg.graph = buildMockDepGraph({
    [file]: { imports: [], exports: ['foo'], importRecords: [], exportRecords: [{ name: 'foo' }], parseMode: 'ast', confidence: 'high' },
    [n('/repo/a.js')]: { imports: [file], exports: [], importRecords: [{ source: './lib', imported: ['bar'], resolved: file }], exportRecords: [], parseMode: 'ast', confidence: 'high' },
    [n('/repo/b.js')]: { imports: [file], exports: [], importRecords: [{ source: './lib', imported: ['baz'], resolved: file }], exportRecords: [], parseMode: 'ast', confidence: 'high' },
    [n('/repo/c.js')]: { imports: [file], exports: [], importRecords: [{ source: './lib', imported: ['qux'], resolved: file }], exportRecords: [], parseMode: 'ast', confidence: 'high' },
  });
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
  assert.strictEqual(item.confidenceValue, 0.9, 'medium confidence should have numeric value 0.9');
  assert.strictEqual(item.confidenceSource, 'ast-unused-exports');
  // P87: importerCount >= 3 gets differentiated reason instead of templated AST message.
  assert.ok(item.confidenceReason.includes('3 importers'), `reason should mention importer count: ${item.confidenceReason}`);
}

function testVeryManyImportersAst() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');

  const importers = [];
  const schema = {
    [file]: { imports: [], exports: ['foo'], importRecords: [], exportRecords: [{ name: 'foo' }], parseMode: 'ast', confidence: 'high' },
  };
  const reverseEntries = [];
  for (let i = 0; i < 12; i++) {
    const imp = n(`/repo/app${i}.js`);
    importers.push(imp);
    schema[imp] = { imports: [file], exports: [], importRecords: [{ source: './lib', imported: [`sym${i}`], resolved: file }], exportRecords: [], parseMode: 'ast', confidence: 'high' };
    reverseEntries.push([imp, []]);
  }
  reverseEntries.unshift([file, importers]);

  dg.graph = buildMockDepGraph(schema);
  dg.reverseGraph = new Map(reverseEntries);

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should report dead export');
  assert.strictEqual(item.confidence, 'medium');
  assert.strictEqual(item.confidenceValue, 0.9);
  assert.strictEqual(item.confidenceSource, 'ast-unused-exports');
  // P87: importerCount >= 10 gets high-count differentiated reason.
  assert.ok(item.confidenceReason.includes('12 importers'), `reason should mention importer count: ${item.confidenceReason}`);
  assert.ok(item.confidenceReason.includes('specific exports'), `reason should mention specific exports: ${item.confidenceReason}`);
}

function testRegexMode() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.rs');
  const importer = n('/repo/main.rs');

  dg.graph = buildMockDepGraph({
    [file]: { imports: [], exports: ['foo', 'bar'], importRecords: [], exportRecords: [{ name: 'foo' }, { name: 'bar' }], parseMode: 'regex', confidence: 'medium' },
    [importer]: { imports: [file], exports: [], importRecords: [{ source: './lib', imported: ['foo'], resolved: file }], exportRecords: [], parseMode: 'regex', confidence: 'medium' },
  });
  dg.reverseGraph = new Map([[file, [importer]], [importer, []]]);

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should report dead export');
  assert.deepStrictEqual(item.exports, ['bar']);
  assert.strictEqual(item.confidence, 'low');
  assert.strictEqual(item.confidenceValue, 0.5);
  assert.strictEqual(item.confidenceSource, 'regex-fallback');
  assert.ok(item.confidenceReason.includes('Regex-based'), `reason should mention regex: ${item.confidenceReason}`);
}

function testDtsFilesAreSkipped() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/types.d.ts');
  dg.graph = buildMockDepGraph({
    [file]: { imports: [], exports: ['MyInterface'], importRecords: [], exportRecords: [{ name: 'MyInterface' }], parseMode: 'ast' },
  });
  dg.reverseGraph = new Map([[file, []]]);
  const dead = dg.findDeadExports();
  assert.strictEqual(dead.length, 0, '.d.ts files should be skipped entirely');
}

function testConstructorIsFiltered() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');
  dg.graph = buildMockDepGraph({
    [file]: { imports: [], exports: ['constructor', 'foo'], importRecords: [], exportRecords: [{ name: 'constructor' }, { name: 'foo' }], parseMode: 'ast' },
  });
  dg.reverseGraph = new Map([[file, []]]);
  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should still report the file');
  assert(!item.exports.includes('constructor'), 'constructor should be filtered from dead exports');
  assert(item.exports.includes('foo'), 'foo should remain as dead export');
}

function testDunderMethodsAreFiltered() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.py');
  dg.graph = buildMockDepGraph({
    [file]: { imports: [], exports: ['__init__', '__str__', 'foo'], importRecords: [], exportRecords: [{ name: '__init__' }, { name: '__str__' }, { name: 'foo' }], parseMode: 'ast' },
  });
  dg.reverseGraph = new Map([[file, []]]);
  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should still report the file');
  assert(!item.exports.includes('__init__'), '__init__ should be filtered');
  assert(!item.exports.includes('__str__'), '__str__ should be filtered');
  assert(item.exports.includes('foo'), 'foo should remain');
}

function testMockLikeNamesAreFiltered() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');
  dg.graph = buildMockDepGraph({
    [file]: { imports: [], exports: ['mockUserService', 'stubDatabase', 'spyLogin', 'fakeAuth', 'realService'], importRecords: [], exportRecords: [{ name: 'mockUserService' }, { name: 'stubDatabase' }, { name: 'spyLogin' }, { name: 'fakeAuth' }, { name: 'realService' }], parseMode: 'ast' },
  });
  dg.reverseGraph = new Map([[file, []]]);
  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should still report the file');
  assert(!item.exports.includes('mockUserService'), 'mockUserService should be filtered');
  assert(!item.exports.includes('stubDatabase'), 'stubDatabase should be filtered');
  assert(!item.exports.includes('spyLogin'), 'spyLogin should be filtered');
  assert(!item.exports.includes('fakeAuth'), 'fakeAuth should be filtered');
  assert(item.exports.includes('realService'), 'realService should remain');
}

function testDuplicateOfHint() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');
  const dupFile = n('/repo/other.js');

  dg.graph = buildMockDepGraph({
    [file]: { imports: [], exports: ['foo'], importRecords: [], exportRecords: [{ name: 'foo' }], parseMode: 'ast', confidence: 'high' },
    [dupFile]: { imports: [], exports: ['foo'], importRecords: [], exportRecords: [{ name: 'foo', lineStart: 28 }], parseMode: 'ast', confidence: 'high' },
  });
  dg.reverseGraph = new Map([[file, []], [dupFile, []]]);

  dg.builder = { symbolRegistry: new SymbolRegistry() };
  dg.builder.symbolRegistry.register(file, [{ name: 'foo' }]);
  dg.builder.symbolRegistry.register(dupFile, [{ name: 'foo', lineStart: 28 }]);

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should report dead export');
  assert(item.duplicateOf, 'should have duplicateOf hint when symbol exists elsewhere');
  assert.strictEqual(item.duplicateOf.foo, `${dupFile}:28`, 'duplicateOf should point to other file with line number');
}

function testDuplicateOfAbsentWhenUnique() {
  const dg = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const file = n('/repo/lib.js');

  dg.graph = buildMockDepGraph({
    [file]: { imports: [], exports: ['foo'], importRecords: [], exportRecords: [{ name: 'foo' }], parseMode: 'ast', confidence: 'high' },
  });
  dg.reverseGraph = new Map([[file, []]]);

  dg.builder = { symbolRegistry: new SymbolRegistry() };
  dg.builder.symbolRegistry.register(file, [{ name: 'foo' }]);

  const dead = dg.findDeadExports();
  const item = dead.find((d) => d.file === file);
  assert(item, 'should report dead export');
  assert.strictEqual(item.duplicateOf, undefined, 'should NOT have duplicateOf when symbol is unique');
}

function main() {
  testNoImporterReliableGraph();
  testNoImporterUnreliableGraph();
  testFewImportersAst();
  testManyImportersAst();
  testVeryManyImportersAst();
  testRegexMode();
  testDtsFilesAreSkipped();
  testConstructorIsFiltered();
  testDunderMethodsAreFiltered();
  testMockLikeNamesAreFiltered();
  testDuplicateOfHint();
  testDuplicateOfAbsentWhenUnique();
}

main();
