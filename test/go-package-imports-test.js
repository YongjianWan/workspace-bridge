#!/usr/bin/env node
// @semantic
// L2-21: Go package imports bind the PACKAGE (all non-test .go files), not the
// alphabetically first file; files in the same package (same dir) reference
// each other through implicit tier3 edges — the Java java-same-package shape.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DependencyGraph, GraphBuilder } = require('../src/services/dep-graph');
const { resolveImport } = require('../src/services/dep-graph/resolvers');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function makeGoSchemaFile(extra = {}) {
  return {
    imports: [],
    exports: [],
    importRecords: [],
    exportRecords: [],
    functionRecords: [],
    parseMode: 'ast',
    confidence: 'high',
    ...extra,
  };
}

// The resolver must mark a go-module package import with the package
// directory so the post-process phase can expand it to all package files.
function testGoModuleResolverMarksPackageDir() {
  const tmpDir = makeTempDir('wb-go-pkg-res-');
  fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/demo\n\ngo 1.22\n');
  fs.mkdirSync(path.join(tmpDir, 'pkg', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'pkg', 'foo', 'foo.go'), 'package foo\n');
  fs.writeFileSync(path.join(tmpDir, 'pkg', 'foo', 'bar.go'), 'package foo\n');
  fs.writeFileSync(path.join(tmpDir, 'pkg', 'foo', 'foo_test.go'), 'package foo\n');

  const outMeta = {};
  const resolved = resolveImport(path.join(tmpDir, 'main.go'), 'example.com/demo/pkg/foo', '.go', tmpDir, null, outMeta);
  assert(resolved && resolved.endsWith('.go'), `Expected go module resolve, got ${resolved}`);
  assert(!resolved.endsWith('_test.go'), `Anchor must be a non-test file, got ${resolved}`);
  assert.strictEqual(outMeta.method, 'go-module');
  assert.strictEqual(
    outMeta.goPackageDir,
    path.join(tmpDir, 'pkg', 'foo'),
    `go-module imports must carry the package dir for expansion, got ${outMeta.goPackageDir}`
  );

  cleanupTempDir(tmpDir);
}

// Files in the same package (same dir) see each other's symbols without an
// import statement: implicit tier3/confidence 0.3 edges, java-same-package shape.
function testGoSamePackageImplicitRefs() {
  const tmpDir = path.resolve('/tmp/wb-go-pkg-same');
  const fooPath = path.join(tmpDir, 'pkg', 'foo', 'foo.go');
  const barPath = path.join(tmpDir, 'pkg', 'foo', 'bar.go');

  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [fooPath]: { originalPath: fooPath, ...makeGoSchemaFile({ exports: ['Foo'] }) },
    [barPath]: { originalPath: barPath, ...makeGoSchemaFile({ exports: ['Bar'] }) },
  });

  const builder = new GraphBuilder(depGraph);
  builder.expandGoPackageImports();

  const fooKey = depGraph.normalizeFilePath(fooPath);
  const barKey = depGraph.normalizeFilePath(barPath);
  const dirKey = depGraph.normalizeFilePath(path.dirname(fooPath));

  const fooInfo = depGraph.graph.get(fooKey);
  const barInfo = depGraph.graph.get(barKey);
  assert(fooInfo.imports.includes(barKey), 'foo.go should implicitly import bar.go (same package)');
  assert(barInfo.imports.includes(fooKey), 'bar.go should implicitly import foo.go (same package)');

  const fooRecord = fooInfo.importRecords.find((r) => r.source === `<same-package:${dirKey}>`);
  assert(fooRecord, `foo.go should have a same-package import record (dir ${dirKey})`);
  assert.strictEqual(fooRecord.resolved, barKey);
  assert.strictEqual(fooRecord.tier, 'tier3', 'same-package refs should be low-confidence tier3');
  assert.strictEqual(fooRecord.confidence, 0.3, 'same-package refs should have reduced confidence');
  assert.strictEqual(fooRecord.resolutionMethod, 'go-same-package');

  // Reverse graph should be updated
  const barDependents = depGraph.reverseGraph.get(barKey);
  assert(barDependents.includes(fooKey), 'bar.go should be depended on by foo.go via same-package');
}

// A go-module import of a multi-file package must produce edges to EVERY
// non-test .go file of the package, not just the anchor file the resolver
// named. Test files are excluded.
function testGoModuleImportExpansionBindsAllPackageFiles() {
  const tmpDir = path.resolve('/tmp/wb-go-pkg-expand');
  const mainPath = path.join(tmpDir, 'main.go');
  const fooPath = path.join(tmpDir, 'pkg', 'foo', 'foo.go');
  const barPath = path.join(tmpDir, 'pkg', 'foo', 'bar.go');
  const testPath = path.join(tmpDir, 'pkg', 'foo', 'foo_test.go');

  const fooDir = path.join(tmpDir, 'pkg', 'foo');
  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [mainPath]: {
      originalPath: mainPath,
      ...makeGoSchemaFile({
        importRecords: [{
          source: 'example.com/demo/pkg/foo',
          imported: ['Foo'],
          resolved: null, // normalized below — set after fromSchema via key
          tier: 'tier1',
          resolutionMethod: 'go-module',
          confidence: 1.0,
          goPackageDir: fooDir,
        }],
      }),
    },
    [fooPath]: { originalPath: fooPath, ...makeGoSchemaFile({ exports: ['Foo'] }) },
    [barPath]: { originalPath: barPath, ...makeGoSchemaFile({ exports: ['Bar'] }) },
    [testPath]: { originalPath: testPath, ...makeGoSchemaFile() },
  });

  const mainKey = depGraph.normalizeFilePath(mainPath);
  const fooKey = depGraph.normalizeFilePath(fooPath);
  const barKey = depGraph.normalizeFilePath(barPath);
  const testKey = depGraph.normalizeFilePath(testPath);

  // Anchor: the record + edge the resolve phase would have persisted.
  const mainInfoPre = depGraph.graph.get(mainKey);
  mainInfoPre.importRecords[0].resolved = fooKey;
  mainInfoPre.imports.push(fooKey);

  const builder = new GraphBuilder(depGraph);
  builder.expandGoPackageImports();

  const mainInfo = depGraph.graph.get(mainKey);
  assert(mainInfo.imports.includes(fooKey), 'main.go should import foo.go (anchor)');
  assert(mainInfo.imports.includes(barKey), 'main.go should import bar.go (package expansion)');
  assert(!mainInfo.imports.includes(testKey), 'main.go must NOT import foo_test.go');

  const barRecord = mainInfo.importRecords.find((r) => r.resolved === barKey);
  assert(barRecord, 'main.go should have an import record for bar.go');
  assert.strictEqual(barRecord.tier, 'tier1', 'package-import expansion keeps explicit-import tier');
  assert.strictEqual(barRecord.confidence, 1.0);
  assert.strictEqual(barRecord.resolutionMethod, 'go-module');
  assert.strictEqual(barRecord.source, 'example.com/demo/pkg/foo');
}

// The phase replays on the warm path: strip-then-expand must make a second
// run a no-op, not a source of duplicate edges or records.
function testGoExpansionIdempotent() {
  const tmpDir = path.resolve('/tmp/wb-go-pkg-idem');
  const fooPath = path.join(tmpDir, 'pkg', 'foo', 'foo.go');
  const barPath = path.join(tmpDir, 'pkg', 'foo', 'bar.go');

  const depGraph = DependencyGraph.fromSchema(tmpDir, {
    [fooPath]: { originalPath: fooPath, ...makeGoSchemaFile() },
    [barPath]: { originalPath: barPath, ...makeGoSchemaFile() },
  });

  const builder = new GraphBuilder(depGraph);
  builder.expandGoPackageImports();

  const fooKey = depGraph.normalizeFilePath(fooPath);
  const snapshot = JSON.stringify(depGraph.graph.get(fooKey).importRecords);
  const importCount = depGraph.graph.get(fooKey).imports.length;

  builder.expandGoPackageImports();

  assert.strictEqual(depGraph.graph.get(fooKey).imports.length, importCount, 'second run must not duplicate imports');
  assert.strictEqual(
    JSON.stringify(depGraph.graph.get(fooKey).importRecords),
    snapshot,
    'second run must not duplicate or mutate records'
  );
}

function main() {
  testGoModuleResolverMarksPackageDir();
  testGoSamePackageImplicitRefs();
  testGoModuleImportExpansionBindsAllPackageFiles();
  testGoExpansionIdempotent();
  console.log('go-package-imports-test: all passed');
}

main();
