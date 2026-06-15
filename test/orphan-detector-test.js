#!/usr/bin/env node
// @semantic

const assert = require('assert');
const path = require('path');
const { findOrphanFiles } = require('../src/utils/orphan-detector');

function mockGraph(testLike = [], dependents = {}) {
  return {
    isTestLikeFile: (f) => testLike.includes(f),
    getDependents: (f) => dependents[f] || [],
  };
}

function testEmptyInput() {
  const graph = mockGraph();
  const result = findOrphanFiles([], new Set(), graph, '/root');
  assert.deepStrictEqual(result.docs, []);
  assert.deepStrictEqual(result.scripts, []);
  assert.deepStrictEqual(result.configs, []);
  assert.deepStrictEqual(result.modules, []);
  assert.deepStrictEqual(result.all, []);
}

function testAllImported() {
  const files = ['/root/src/a.js', '/root/src/b.js'];
  const graph = mockGraph([], { '/root/src/a.js': ['/root/src/c.js'], '/root/src/b.js': ['/root/src/c.js'] });
  const result = findOrphanFiles(files, new Set(), graph, '/root');
  assert.deepStrictEqual(result.all, []);
}

function testEntryFilesSkipped() {
  const files = ['/root/cli.js', '/root/src/lib.js'];
  const graph = mockGraph([], { '/root/src/lib.js': ['/root/cli.js'] });
  const result = findOrphanFiles(files, new Set(['/root/cli.js']), graph, '/root');
  assert(!result.all.includes('cli.js'), 'entry file should not be orphan');
}

function testTestFilesSkipped() {
  const files = ['/root/test/foo.test.js', '/root/src/lib.js'];
  const graph = mockGraph(['/root/test/foo.test.js'], { '/root/src/lib.js': ['/root/test/foo.test.js'] });
  const result = findOrphanFiles(files, new Set(), graph, '/root');
  assert(!result.all.some((f) => f.includes('foo.test.js')), 'test file should not be orphan');
}

function testDocsOrphan() {
  const files = ['/root/README.md', '/root/CHANGELOG.md'];
  const graph = mockGraph();
  const result = findOrphanFiles(files, new Set(), graph, '/root');
  assert(result.docs.includes('README.md'));
  assert(result.docs.includes('CHANGELOG.md'));
  assert(result.all.includes('README.md'));
  assert(result.all.includes('CHANGELOG.md'));
}

function testConfigOrphan() {
  const files = ['/root/package.json', '/root/tsconfig.json'];
  const graph = mockGraph();
  const result = findOrphanFiles(files, new Set(), graph, '/root');
  assert(result.configs.includes('package.json'));
  assert(result.configs.includes('tsconfig.json'));
}

function testModuleOrphan() {
  const files = ['/root/src/orphan.js', '/root/src/orphan.ts', '/root/src/orphan.py'];
  const graph = mockGraph();
  const result = findOrphanFiles(files, new Set(), graph, '/root');
  assert(result.modules.includes('src/orphan.js'));
  assert(result.modules.includes('src/orphan.ts'));
  assert(result.modules.includes('src/orphan.py'));
}

function testStandaloneEntryPathSkipped() {
  const files = ['/root/scripts/build.js', '/root/bin/run.sh', '/root/benchmark/perf.js'];
  const graph = mockGraph();
  const result = findOrphanFiles(files, new Set(), graph, '/root');
  assert(!result.all.includes('scripts/build.js'), 'scripts path should be skipped');
  assert(!result.all.includes('bin/run.sh'), 'bin path should be skipped');
  assert(!result.all.includes('benchmark/perf.js'), 'benchmark path should be skipped');
}

function testOtherFileTypesTrackedInAllOnly() {
  const files = ['/root/styles/main.css', '/root/index.html'];
  const graph = mockGraph();
  const result = findOrphanFiles(files, new Set(), graph, '/root');
  assert(result.all.includes('styles/main.css'));
  assert(result.all.includes('index.html'));
  assert(!result.modules.includes('styles/main.css'));
  assert(!result.configs.includes('index.html'));
}

function testCustomToRelativeFn() {
  const files = ['/root/src/a.js'];
  const graph = mockGraph();
  const customRel = (root, file) => file.replace(root + '/', 'CUSTOM:');
  const result = findOrphanFiles(files, new Set(), graph, '/root', customRel);
  assert(result.all.includes('CUSTOM:src/a.js'));
}

function testEntryFilesArraySupport() {
  const files = ['/root/cli.js'];
  const graph = mockGraph();
  const result = findOrphanFiles(files, ['/root/cli.js'], graph, '/root');
  assert.deepStrictEqual(result.all, [], 'entryFiles as array should work');
}

function main() {
  testEmptyInput();
  testAllImported();
  testEntryFilesSkipped();
  testTestFilesSkipped();
  testDocsOrphan();
  testConfigOrphan();
  testModuleOrphan();
  testStandaloneEntryPathSkipped();
  testOtherFileTypesTrackedInAllOnly();
  testCustomToRelativeFn();
  testEntryFilesArraySupport();
}

main();
