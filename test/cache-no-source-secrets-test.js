#!/usr/bin/env node
// @fast
// @semantic
/**
 * The cache must not keep string-literal contents of the analysed source. A symbol signature is
 * the declaration line as written, so `const pw = "..."` would otherwise put the value on disk.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir, runCli } = require('./test-helpers');
const { maskStringLiterals } = require('../src/utils/sanitize');

const SECRET = 'FAKESECRET_INLINEPASS_zz991';

assert.strictEqual(maskStringLiterals('const pw = "abc";'), 'const pw = "…";');
assert.strictEqual(maskStringLiterals("const a = 'it' + `x${y}z`;"), "const a = '…' + `…`;");
assert.strictEqual(maskStringLiterals('const q = "a\\"b";'), 'const q = "…";', 'escaped quotes stay inside the literal');
assert.strictEqual(maskStringLiterals('export function f(a, b) {'), 'export function f(a, b) {', 'declarations without literals are unchanged');

const root = makeTempDir('wb-cache-secrets-');
try {
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), `module.exports = 1;\nconst pw = "${SECRET}";\nexport function keep(a) { return a; }\n`);
  const cacheDir = path.join(root, '.cache-out');
  runCli(['audit-overview', '--cwd', root, '--cache-dir', cacheDir, '--json', '--quiet']);

  const files = fs.readdirSync(cacheDir, { recursive: true }).map((f) => path.join(cacheDir, f)).filter((f) => fs.statSync(f).isFile());
  assert(files.length > 0, 'the run must have written a cache');
  for (const f of files) {
    assert(!fs.readFileSync(f).includes(SECRET), `secret literal found in cache file ${path.basename(f)}`);
  }
} finally {
  cleanupTempDir(root);
}
