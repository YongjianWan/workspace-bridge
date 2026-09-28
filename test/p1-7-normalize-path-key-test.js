#!/usr/bin/env node
// @semantic
const assert = require('assert');
const path = require('path');
const { normalizePathKey } = require('../src/utils/path');

const relative = 'src/p1-7-path-test.js';
const first = normalizePathKey(relative);
const firstCwd = normalizePathKey();
const originalCwd = process.cwd();
try {
  process.chdir(path.join(originalCwd, 'test'));
  const second = normalizePathKey(relative);
  assert.notStrictEqual(second, first, 'relative paths must follow the current working directory');
  assert.strictEqual(second, normalizePathKey(path.resolve(relative)));
  assert.notStrictEqual(normalizePathKey(), firstCwd, 'empty input must follow the current working directory');
} finally {
  process.chdir(originalCwd);
}

console.log('p1-7-normalize-path-key-test: PASS');
