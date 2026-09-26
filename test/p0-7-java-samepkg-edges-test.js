#!/usr/bin/env node
// @semantic
// P0-7: Java/Kotlin same-package tier3 edges must be justified by an actual
// simple-name type reference.
//
// Before the fix, expandJavaPackageImports unconditionally linked EVERY file
// in a package to every other file (confidence 0.3, but dependents/impact/
// affected-tests consume the edge regardless) — spring-petclinic's PetValidator
// (referenced by 1 class) reported 17 dependents. The gate: an edge is added
// only when the importing file's content actually mentions one of the target's
// type names (Java/Kotlin make same-package types visible without an import
// statement, so a real reference is a plain simple-name mention).
// Wildcard imports (tier1) stay unconditional — an explicit `import pkg.*`
// really does pull the whole package.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { WorkspaceCache } = require('../src/services/cache');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

async function buildGraph(root) {
  const cache = new WorkspaceCache(root);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const stats = fs.statSync(full);
        cache.setFileMetadata(full, { mtime: stats.mtimeMs, size: stats.size });
      }
    }
  };
  walk(root);
  const graph = new DependencyGraph(root, cache, { quiet: true });
  await graph.build();
  return graph;
}

function dependents(graph, root, rel) {
  const key = graph.normalizeFilePath(path.join(root, rel));
  // Graph keys are lowercased on Windows (normalizePathKey), original case on
  // POSIX — compare case-insensitively so the test is platform-stable.
  return (graph.getDependents(key) || [])
    .map((f) => path.basename(f).toLocaleLowerCase('en-US'))
    .sort();
}

async function testJavaSamePackageEdgesAreReferenceGated() {
  const root = makeTempDir('wb-p07-java-');
  try {
    write(root, 'src/a/svc/Service.java',
      'package a.svc;\npublic class Service { public int run() { return Helper.h(); } }\n');
    write(root, 'src/a/svc/Helper.java',
      'package a.svc;\npublic class Helper { public static int h() { return 1; } }\n');
    write(root, 'src/a/svc/Unrelated.java',
      'package a.svc;\npublic class Unrelated { public int z() { return 0; } }\n');
    // Mention-only reference (Spring DI shape): no import statement, the type
    // name simply appears in the source — must still produce the edge.
    write(root, 'src/a/svc/Controller.java',
      'package a.svc;\npublic class Controller { private Validator v = new Validator(); }\n');
    write(root, 'src/a/svc/Validator.java',
      'package a.svc;\npublic class Validator { public boolean ok() { return true; } }\n');

    const graph = await buildGraph(root);

    assert.deepStrictEqual(
      dependents(graph, root, 'src/a/svc/Helper.java'),
      ['service.java'],
      'only the referencing file may depend on Helper (no clique from Unrelated/Controller/Validator)'
    );
    assert.deepStrictEqual(
      dependents(graph, root, 'src/a/svc/Validator.java'),
      ['controller.java'],
      'mention-only same-package reference must keep its edge'
    );
    assert.deepStrictEqual(
      dependents(graph, root, 'src/a/svc/Unrelated.java'),
      [],
      'a package-mate referenced by nobody must have zero dependents'
    );
    assert.deepStrictEqual(
      dependents(graph, root, 'src/a/svc/Service.java'),
      [],
      'Service is referenced by nobody'
    );
  } finally {
    cleanupTempDir(root);
  }
}

async function testKotlinSamePackageEdgesAreReferenceGated() {
  const root = makeTempDir('wb-p07-kotlin-');
  try {
    write(root, 'src/a/svc/Service.kt', 'package a.svc\n\nclass Service { fun run(h: Helper) = 1 }\n');
    write(root, 'src/a/svc/Helper.kt', 'package a.svc\n\nclass Helper\n');
    write(root, 'src/a/svc/Unrelated.kt', 'package a.svc\n\nclass Unrelated\n');

    const graph = await buildGraph(root);

    assert.deepStrictEqual(
      dependents(graph, root, 'src/a/svc/Helper.kt'),
      ['service.kt'],
      'Kotlin same-package edge must exist where the type is referenced'
    );
    assert.deepStrictEqual(
      dependents(graph, root, 'src/a/svc/Unrelated.kt'),
      [],
      'Kotlin shares the Java clique bug — an unreferenced class must have no dependents'
    );
  } finally {
    cleanupTempDir(root);
  }
}

async function main() {
  await testJavaSamePackageEdgesAreReferenceGated();
  await testKotlinSamePackageEdgesAreReferenceGated();
  console.log('p0-7-java-samepkg-edges-test: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
