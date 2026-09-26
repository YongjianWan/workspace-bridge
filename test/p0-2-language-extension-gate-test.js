#!/usr/bin/env node
// @semantic
/**
 * P0-2: language enablement is by extension, never by root manifest.
 *
 * The registry's per-language `condition` gates made ONE matching language
 * switch every other language off: a repo with a single .py file and no root
 * package.json indexed zero JS/TS files, while stackProfile still said
 * node-first and coverageRatio reported 1 (external review §4 P0-2).
 * Manifests feed stack-profile detection (detectWorkspace consumers), not
 * indexing — a language whose files exist in the tree gets indexed whatever
 * manifests are (or are not) present, including manifests that live only in
 * subdirectories (frontend/backend split).
 *
 * Locked semantics:
 * 1. registry.getFilePatterns() returns every registered pattern whatever
 *    the workspace's manifest/presence flags happen to be.
 * 2. FileIndex indexes .ts files in a manifest-less repo that contains .py
 *    (the LANG-GATE repro shape).
 * 3. .java files are indexed alongside .py when no pom/gradle exists —
 *    the review's "Python + Java without root pom" half.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { detectWorkspace } = require('../src/utils/path');
const { registry } = require('../src/services/dep-graph/parsers/registry');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

async function indexedFiles(root) {
  const cache = new WorkspaceCache(root);
  const index = new FileIndex(root, cache);
  await index.build(30000, { watch: false });
  return Array.from(cache.fileMetadata.keys());
}

function testPatternsNeverGatedByManifests() {
  const root = makeTempDir('wb-langgate-');
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'scripts', 'tool.py'), 'print(1)\n');

    const workspace = detectWorkspace(root);
    // Precondition: exactly the partial-match state that used to gate —
    // python's presence flag true, every manifest flag false.
    assert.strictEqual(workspace.hasPackageJson, false, 'fixture must have no root package.json');
    assert.strictEqual(workspace.hasPythonFiles, true, 'fixture must carry a .py file');

    const patterns = registry.getFilePatterns(workspace);
    for (const ext of ['.py', '.ts', '.js', '.java', '.go', '.rs']) {
      assert.ok(
        patterns.includes(`**/*${ext}`),
        `getFilePatterns must include **/*${ext} regardless of manifest flags, got ${JSON.stringify(patterns)}`
      );
    }
  } finally {
    cleanupTempDir(root);
  }
}

async function testTsWithoutPackageJsonIndexed() {
  const root = makeTempDir('wb-langgate-ts-');
  try {
    fs.mkdirSync(path.join(root, 'web'));
    fs.writeFileSync(path.join(root, 'web', 'x.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(root, 'web', 'main.ts'), 'import { x } from "./x";\n');
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'scripts', 'tool.py'), 'print(1)\n');

    const files = await indexedFiles(root);
    assert.strictEqual(
      files.length, 3,
      `expected 3 indexed files (2 .ts + 1 .py), got ${files.length}: ${files.join(', ')}`
    );
    assert.ok(files.some((f) => f.endsWith('main.ts')), 'main.ts must be indexed without a root package.json');
    assert.ok(files.some((f) => f.endsWith('x.ts')), 'x.ts must be indexed without a root package.json');
  } finally {
    cleanupTempDir(root);
  }
}

async function testJavaNotDroppedWhenPythonMatches() {
  const root = makeTempDir('wb-langgate-pyjava-');
  try {
    fs.writeFileSync(path.join(root, 'app.py'), 'print(1)\n');
    fs.mkdirSync(path.join(root, 'com', 'example'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'com', 'example', 'Service.java'),
      'package com.example;\npublic class Service {}\n'
    );

    const workspace = detectWorkspace(root);
    assert.strictEqual(workspace.hasJava, false, 'fixture must have no pom/gradle');
    assert.strictEqual(workspace.hasPythonFiles, true, 'fixture must carry a .py file');

    const files = await indexedFiles(root);
    assert.ok(files.some((f) => f.endsWith('.py')), 'app.py must be indexed');
    assert.ok(
      files.some((f) => f.endsWith('.java')),
      'Service.java must not be dropped just because python matched first'
    );
  } finally {
    cleanupTempDir(root);
  }
}

async function main() {
  testPatternsNeverGatedByManifests();
  await testTsWithoutPackageJsonIndexed();
  await testJavaNotDroppedWhenPythonMatches();
  console.log('p0-2 language extension gate: all assertions passed');
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
