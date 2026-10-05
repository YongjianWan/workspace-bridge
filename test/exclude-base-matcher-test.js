#!/usr/bin/env node
// @fast
// @semantic
/**
 * shouldExcludeBase must agree with matchesPathFragment for every directory pattern spelling,
 * and must keep reacting when the pattern list is replaced by a new array (config reload).
 */
const assert = require('assert');
const { shouldExcludeBase } = require('../src/utils/exclude-patterns');
const { matchesPathFragment, normalizePathKey } = require('../src/utils/path');

const BS = String.fromCharCode(92);
const dirs = ['node_modules', './dist/', 'build' + BS, 'Test/Fixtures', 'vendor//', ''];
const paths = [
  '/repo/node_modules/x/index.js',
  '/repo/src/dist/a.js',
  '/repo/build/out.js',
  '/repo/test/fixtures/a.js',
  '/repo/Test/Fixtures/B.js',
  '/repo/vendor/lib.js',
  '/repo/src/main.js',
  '/repo/src/node_modules_like/a.js',
  '/repo/src/mybuild/a.js',
  '/repo/notdist',
  '/repo/dist',
  'C:' + BS + 'repo' + BS + 'node_modules' + BS + 'a.js',
];

for (const file of paths) {
  const key = normalizePathKey(file);
  const expected = dirs.some((dir) => matchesPathFragment(key, dir));
  assert.strictEqual(shouldExcludeBase(file, dirs), expected, `${file}: shouldExcludeBase disagrees with matchesPathFragment`);
}

// A new array with the same length must not reuse the old compiled patterns.
assert.strictEqual(shouldExcludeBase('/repo/alpha/x.js', ['alpha']), true);
assert.strictEqual(shouldExcludeBase('/repo/alpha/x.js', ['beta']), false);
const grown = ['alpha'];
assert.strictEqual(shouldExcludeBase('/repo/beta/x.js', grown), false);
grown.push('beta');
assert.strictEqual(shouldExcludeBase('/repo/beta/x.js', grown), true, 'in-place growth is picked up');

assert.strictEqual(shouldExcludeBase('/repo/a/cache.db', []), true, 'cache database files are always excluded');
assert.strictEqual(shouldExcludeBase('/repo/a/x.js', null), false);
