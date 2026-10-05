#!/usr/bin/env node
// @fast
// @semantic
/**
 * Inside a resolution batch cachedExistsSync answers "does this path exist" from one directory listing per directory
 * instead of one stat per probe, and must give the same answers as fs.existsSync.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { cachedExistsSync, clearResolverCaches, beginResolverBatch } = require('../src/services/dep-graph/resolvers/base');

const root = makeTempDir('wb-exists-listing-');
try {
  fs.mkdirSync(path.join(root, 'pkg', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pkg', '__init__.py'), '');
  fs.writeFileSync(path.join(root, 'pkg', 'mod.py'), '');
  fs.writeFileSync(path.join(root, 'plain.txt'), '');
  beginResolverBatch(root);

  const probes = [
    path.join(root, 'pkg', 'mod.py'),
    path.join(root, 'pkg', 'missing.py'),
    path.join(root, 'pkg', 'sub'),
    path.join(root, 'pkg', 'sub', '__init__.py'),
    path.join(root, 'nodir', 'x.py'),
    path.join(root, 'plain.txt', 'child.py'),
    path.join(root, 'pkg', 'MOD.PY'),
    root,
    path.parse(root).root,
  ];
  for (const probe of probes) {
    assert.strictEqual(cachedExistsSync(probe), fs.existsSync(probe), `${probe} must match fs.existsSync`);
  }

  // Misses in a listed directory cost no stat calls.
  beginResolverBatch(root);
  assert.strictEqual(cachedExistsSync(path.join(root, 'pkg', 'warmup.py')), false);
  const realStat = fs.statSync;
  let statCalls = 0;
  fs.statSync = (...args) => {
    statCalls += 1;
    return realStat.apply(fs, args);
  };
  try {
    for (let i = 0; i < 200; i++) {
      assert.strictEqual(cachedExistsSync(path.join(root, 'pkg', `absent${i}.py`)), false);
    }
  } finally {
    fs.statSync = realStat;
  }
  assert.strictEqual(statCalls, 0, 'misses inside an already listed directory must not stat');

  // A file created later is seen after the resolver caches are cleared, as before.
  const late = path.join(root, 'pkg', 'late.py');
  assert.strictEqual(cachedExistsSync(late), false);
  fs.writeFileSync(late, '');
  beginResolverBatch(root);
  assert.strictEqual(cachedExistsSync(late), true);

  // Outside a batch (and outside the batch root) nothing is listed: every probe sees the file
  // system as it is now.
  clearResolverCaches();
  const realReaddir = fs.readdirSync;
  let listings = 0;
  fs.readdirSync = (...args) => {
    listings += 1;
    return realReaddir.apply(fs, args);
  };
  try {
    assert.strictEqual(cachedExistsSync(path.join(root, 'pkg', 'mod.py')), true);
    assert.strictEqual(cachedExistsSync(path.join(root, 'pkg', 'nothing.py')), false);
    beginResolverBatch(path.join(root, 'pkg', 'sub'));
    assert.strictEqual(cachedExistsSync(path.join(root, 'pkg', 'mod.py')), true, 'outside the batch root');
  } finally {
    fs.readdirSync = realReaddir;
  }
  assert.strictEqual(listings, 0, 'no directory listing outside a batch or its root');
} finally {
  cleanupTempDir(root);
}
