#!/usr/bin/env node
// @semantic
// P0-9: a Go file that only declares types must still receive edges from its
// users. glow's ui/config.go (type-only) was judged orphan while main.go used
// ui.Config.
//
// Root cause: GraphBuilder._filterNonValueImports Rule 3 prunes any edge whose
// target exports ONLY interface/type/annotation symbols — a rule meant for
// TS-style type-only modules. Go package imports are value-level bindings: a
// `type Config struct` is instantiated at runtime, so type/const/var
// references are first-class edge justifications and Rule 3 must not fire for
// .go files.
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
  return (graph.getDependents(key) || [])
    .map((f) => path.basename(f))
    .sort();
}

async function testTypeOnlyFileReceivesEdges() {
  const root = makeTempDir('wb-p09-go-');
  try {
    write(root, 'go.mod', 'module example.com/app\n\ngo 1.22\n');
    write(root, 'ui/config.go', 'package ui\n\ntype Config struct{ A int }\n');
    write(root, 'ui/ui.go', 'package ui\n\nfunc NewProgram(c Config) int { return c.A }\n');
    write(root, 'main.go',
      'package main\n\nimport "example.com/app/ui"\n\nfunc main() {\n\tvar c ui.Config\n\t_ = ui.NewProgram(c)\n}\n');

    const graph = await buildGraph(root);

    assert.deepStrictEqual(
      dependents(graph, root, 'ui/config.go'),
      ['main.go', 'ui.go'],
      'type-only file must receive edges from its package-importer and its same-package user'
    );
    assert.ok(
      dependents(graph, root, 'ui/ui.go').includes('main.go'),
      'main.go uses ui.NewProgram — the package import must bind every package file'
    );

    // Orphan detection consumes the same edges: a package-imported type-only
    // file must not be classified as an orphan.
    const orphans = graph.findOrphanFiles();
    assert.ok(
      !(orphans.all || []).some((f) => f.replace(/\\/g, '/').endsWith('ui/config.go')),
      `ui/config.go must not be an orphan, got ${JSON.stringify(orphans.all)}`
    );
  } finally {
    cleanupTempDir(root);
  }
}

async function main() {
  await testTypeOnlyFileReceivesEdges();
  console.log('p0-9-go-type-only-edges-test: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
