#!/usr/bin/env node
// @fast
// @semantic
/**
 * audit-diff --with-impact must honour --max-depth. A chain d -> c -> b -> a:
 * changing a reaches b and c at the default depth 2, and d only with --max-depth 3.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

function impactOf(root, extraArgs) {
  const result = runCliRaw(['audit-diff', '--cwd', root, '--files', 'a.js', '--with-impact', '--json', '--quiet', ...extraArgs]);
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).impactFiles.map((f) => path.basename(f)).sort();
}

const root = makeTempDir('wb-impact-depth-');
try {
  fs.writeFileSync(path.join(root, 'a.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'b.js'), "require('./a');\n");
  fs.writeFileSync(path.join(root, 'c.js'), "require('./b');\n");
  fs.writeFileSync(path.join(root, 'd.js'), "require('./c');\n");

  assert.deepStrictEqual(impactOf(root, []), ['b.js', 'c.js'], 'default depth 2 stops before d.js');
  assert.deepStrictEqual(impactOf(root, ['--max-depth', '3']), ['b.js', 'c.js', 'd.js'], '--max-depth 3 must reach d.js');
  assert.deepStrictEqual(impactOf(root, ['--max-depth', '1']), ['b.js'], '--max-depth 1 must stop at b.js');
} finally {
  cleanupTempDir(root);
}
