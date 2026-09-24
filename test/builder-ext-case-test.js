#!/usr/bin/env node
// @fast — pure in-process unit tests (tmp dirs only); the new FileIndex usage
// is a stubbed-cache classification check, not a container cold start.
// @contract
// Regression: GraphBuilder.resolveFileOnly normalizes extension case before
// routing to the language-specific resolver. Previously a file named App.JAVA
// would miss the Java resolver config and fall back to the default strategies,
// failing to resolve sibling Java imports on case-insensitive filesystems.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { GraphBuilder } = require('../src/services/dep-graph/builder');
const { buildPythonModuleIndex } = require('../src/services/dep-graph/resolvers/python');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testUppercaseJavaExtensionResolves() {
  const tmpDir = makeTempDir('wb-ext-case-');
  const pkgDir = path.join(tmpDir, 'src', 'com', 'example');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'Foo.java'), 'package com.example;');

  const dg = {
    root: tmpDir,
    graph: new Map(),
    normalizeFilePath: (p) => p,
    cache: { getFileMetadata: () => null },
    _droppedImports: null,
  };
  const builder = new GraphBuilder(dg);
  builder.workspacePackages = new Set(['com.example']);
  builder.pythonModuleIndex = buildPythonModuleIndex([]);

  const parsed = {
    filePath: path.join(pkgDir, 'App.JAVA'),
    graphKey: 'App.JAVA',
    content: 'package com.example; import com.example.Foo;',
    imports: [],
    exports: [],
    importRecords: [{ source: 'com.example.Foo', imported: ['Foo'], isLocal: false }],
    exportRecords: [],
    functionRecords: [],
    parseMode: 'ast',
    parseModeReason: 'ast',
    confidence: 'high',
    package: 'com.example',
    frameworkHint: null,
    routes: [],
  };

  builder.resolveFileOnly(parsed);
  const graphEntry = dg.graph.get(parsed.graphKey);
  const hit = graphEntry.importRecords.find((r) => r.source === 'com.example.Foo');
  assert(hit, 'import record should be preserved');
  assert(
    hit.resolved && hit.resolved.includes('Foo.java'),
    `Uppercase .JAVA should still resolve Java imports, got ${hit.resolved}`
  );
  assert.strictEqual(hit.resolutionMethod, 'java-package', 'should use Java resolver strategy');

  cleanupTempDir(tmpDir);
}

// Parse dispatch side: a .JAVA file must reach the Java parser at all.
// Previously parseFileOnly did a raw path.extname() registry lookup, so an
// uppercase extension missed every parser and the file entered the graph with
// parseMode 'none' — zero imports, zero exports, silently orphaned.
async function testUppercaseJavaExtensionParses() {
  const tmpDir = makeTempDir('wb-ext-case-parse-');
  const filePath = path.join(tmpDir, 'App.JAVA');
  const dg = {
    root: tmpDir,
    graph: new Map(),
    normalizeFilePath: (p) => p,
    cache: { getFileMetadata: () => null },
    _droppedImports: null,
  };
  const builder = new GraphBuilder(dg);
  const result = await builder.parseFileOnly(filePath, 'package com.example;\npublic class App {}\n');
  assert.notStrictEqual(
    result.parseMode,
    'none',
    'Uppercase .JAVA must reach a parser instead of falling through to parseMode none'
  );
  assert.strictEqual(result.package, 'com.example', 'Java package should be detected for .JAVA file');
  cleanupTempDir(tmpDir);
}

// File-index side: language classification must also survive uppercase
// extensions, otherwise fileMetadata.lang is null and every lang-keyed
// consumer (symbol extraction, stack detection) silently skips the file.
async function testUppercaseJavaExtensionClassified() {
  const { FileIndex } = require('../src/services/file-index');
  const tmpDir = makeTempDir('wb-ext-case-index-');
  const filePath = path.join(tmpDir, 'App.JAVA');
  fs.writeFileSync(filePath, 'package com.example;\npublic class App {}\n');
  let captured = null;
  const cacheStub = {
    setFileMetadata: (p, meta) => { captured = meta; },
    getSymbols: () => [],
    setSymbols: () => {},
  };
  const index = new FileIndex(tmpDir, cacheStub, { quiet: true });
  const ok = await index.indexFile(filePath);
  assert.strictEqual(ok, true, 'indexFile should succeed');
  assert.strictEqual(
    captured && captured.lang,
    'java',
    `Uppercase .JAVA should classify lang as java, got ${captured && captured.lang}`
  );
  cleanupTempDir(tmpDir);
}

(async () => {
  testUppercaseJavaExtensionResolves();
  await testUppercaseJavaExtensionParses();
  await testUppercaseJavaExtensionClassified();
})();
