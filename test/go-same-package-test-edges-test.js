#!/usr/bin/env node
// @semantic — a Go `_test.go` file in the same package has no import of the code it exercises, so
// the graph links it to the source files whose declared names it uses (and only those).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { DependencyGraph } = require('../src/services/dep-graph');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const root = makeTempDir('wb-go-same-pkg-');
  const cache = new WorkspaceCache(root, { cacheDir: path.join(root, '.cache') });
  try {
    const write = (name, text) => {
      const full = path.join(root, name);
      fs.writeFileSync(full, text);
      return full;
    };
    write('go.mod', 'module example.com/p\n\ngo 1.21\n');
    const files = [
      write('alpha.go', 'package p\n\nfunc Alpha() int { return 1 }\n'),
      write('beta.go', 'package p\n\nfunc Beta() int { return 2 }\n\nvar helperTable = map[string]int{}\n'),
      write('tiny.go', 'package p\n\nfunc Run() {}\n'),
      write('alpha_test.go', 'package p\n\nimport "testing"\n\nfunc TestAlpha(t *testing.T) { _ = Alpha() }\n'),
      write('table_test.go', 'package p\n\nimport "testing"\n\nfunc TestTable(t *testing.T) { _ = helperTable }\n'),
      write('unrelated_test.go', 'package p\n\nimport "testing"\n\nfunc TestNothing(t *testing.T) { Run() }\n'),
      write('external_test.go', 'package p_test\n\nimport "testing"\n\nfunc TestExternal(t *testing.T) { _ = Beta }\n'),
    ];
    const graph = new DependencyGraph(root, cache, { quiet: true });
    await graph.build(files);

    const dependentsOf = (name) => graph.getDependents(files.find((f) => f.endsWith(name))).map((f) => path.basename(f)).sort();
    assert.deepStrictEqual(dependentsOf('alpha.go').filter((f) => f.endsWith('_test.go')), ['alpha_test.go'], 'a test that calls Alpha is linked to alpha.go only');
    assert.deepStrictEqual(dependentsOf('beta.go').filter((f) => f.endsWith('_test.go')), ['table_test.go'], 'an unexported declaration (helperTable) links its test; the external-package test does not');
    assert.deepStrictEqual(dependentsOf('tiny.go').filter((f) => f.endsWith('_test.go')), [], 'declared names under the length floor never link a test');

    const record = graph.graph.get([...graph.graph.keys()].find((k) => k.endsWith('alpha_test.go')))
      .importRecords.find((r) => r.patternId === 'go-same-package-test');
    assert.ok(record, 'the edge is an implicit record');
    assert.strictEqual(record.usesAllExports, false, 'a test mention must not mark the file\'s exports as used');

    // The edge follows the files: once the test stops using Alpha, the link is gone.
    write('alpha_test.go', 'package p\n\nimport "testing"\n\nfunc TestAlpha(t *testing.T) {}\n');
    await graph.updateFiles([files.find((f) => f.endsWith('alpha_test.go'))]);
    assert.deepStrictEqual(dependentsOf('alpha.go').filter((f) => f.endsWith('_test.go')), [], 'no stale edge after the test changed');
    console.log('go-same-package-test-edges-test: OK');
  } finally {
    cache.close();
    cleanupTempDir(root);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
