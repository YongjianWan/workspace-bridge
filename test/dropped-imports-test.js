// @semantic
// L2-13: resolve failures must not vanish silently.
//
// resolveFileOnly() drops every import record whose specifier resolves to
// null. Before T5 there was no count, no warning, no record — L1-4 hid an
// entire language behind that drop. This locks the contract:
//   1. A dropped *local-looking* import is counted and surfaces as a warning.
//   2. A gate-known external (node builtin, stdlib, declared dep) is NOT
//      counted — its producing no edge is expected, counting it would cry
//      wolf on every 'import os'.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function writeFixture(root) {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
  const src = path.join(root, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'b.js'), 'module.exports = { helper: () => 1 };\n');
  fs.writeFileSync(
    path.join(src, 'a.js'),
    "const { helper } = require('./b');\n" +
      // Bare, undeclared, not a builtin: nothing claims it, nothing resolves
      // it → dropped, and the drop must be counted (the L1-4 shape).
      "const gone = require('my-local-helper');\n" +
      // Gate-known external → no edge by design, must NOT be counted.
      "const p = require('path');\n" +
      'module.exports = { run: () => helper() + (gone ? 1 : 0) + (p ? 1 : 0) };\n'
  );
}

async function main() {
  const root = makeTempDir('wb-dropped-imports-');
  writeFixture(root);
  const cacheDir = path.join(root, '.cache');

  const container = new ServiceContainer({ quiet: true, cacheDir });
  await container.initialize(root, 60000, { watch: false });
  const dg = container._depGraph;

  const dropped = typeof dg.getDroppedImports === 'function'
    ? dg.getDroppedImports()
    : { count: 0, files: 0, samples: [] };

  assert.strictEqual(dropped.count, 1, `exactly one dropped import should be counted, got ${dropped.count}`);
  assert.deepStrictEqual(
    dropped.samples.map((s) => s.specifier),
    ['my-local-helper'],
    'the counted drop must be the unclaimed bare specifier, not the node builtin'
  );
  assert.strictEqual(dropped.files, 1, 'one file has drops');

  const warnings = dg.buildWarnings();
  const warning = warnings.find((w) => w.type === 'unresolved-dropped');
  assert.ok(warning, 'buildWarnings must include an unresolved-dropped entry');
  // 1 of 2 graph files has drops = 50% > 10% threshold → medium.
  assert.strictEqual(warning.severity, 'medium', 'severity follows the >10%-of-files rule');
  assert.ok(warning.message.includes('my-local-helper'), 'warning message names a sample specifier');

  await container.shutdown();
  cleanupTempDir(root);
  console.log('dropped-imports-test: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
