#!/usr/bin/env node
// @fast
// @semantic
/**
 * CACHE_VERSION carries a fingerprint of the engine sources: editing a parser or resolver
 * invalidates old caches without anyone bumping a number.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { CACHE_VERSION, CACHE_SCHEMA_REVISION, FINGERPRINT_SPAN, computeEngineFingerprint } = require('../src/config/versions');

assert.strictEqual(Math.floor(CACHE_VERSION / FINGERPRINT_SPAN), CACHE_SCHEMA_REVISION, 'the manual revision stays readable inside CACHE_VERSION');
assert.strictEqual(computeEngineFingerprint(), computeEngineFingerprint(), 'the fingerprint is stable for unchanged sources');

const dir = makeTempDir('wb-fingerprint-');
try {
  fs.mkdirSync(path.join(dir, 'parsers'));
  const parser = path.join(dir, 'parsers', 'x.js');
  fs.writeFileSync(parser, 'module.exports = 1;\nconst a = 2;\n');
  const before = computeEngineFingerprint(dir);

  fs.writeFileSync(parser, 'module.exports = 1;\r\nconst a = 2;\r\n');
  assert.strictEqual(computeEngineFingerprint(dir), before, 'line endings do not change the fingerprint');

  fs.writeFileSync(parser, 'module.exports = 1;\nconst a = 3;\n');
  assert.notStrictEqual(computeEngineFingerprint(dir), before, 'editing a parser changes the fingerprint');

  fs.writeFileSync(parser, 'module.exports = 1;\nconst a = 2;\n');
  fs.writeFileSync(path.join(dir, 'parsers', 'y.scm'), '(query)\n');
  assert.notStrictEqual(computeEngineFingerprint(dir), before, 'adding a query file changes the fingerprint');

  assert.notStrictEqual(computeEngineFingerprint(path.join(dir, 'missing')), computeEngineFingerprint(path.join(dir, 'missing')), 'unreadable sources are never trusted');
} finally {
  cleanupTempDir(dir);
}
