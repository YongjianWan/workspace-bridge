#!/usr/bin/env node
// @contract
// Regression: GraphBuilder.resolveFileOnly normalizes extension case before
// routing to the language-specific resolver. Previously a file named App.JAVA
// would miss the Java resolver config and fall back to the default strategies,
// failing to resolve sibling Java imports on case-insensitive filesystems.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { GraphBuilder } = require('../src/services/dep-graph/builder');
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

testUppercaseJavaExtensionResolves();
