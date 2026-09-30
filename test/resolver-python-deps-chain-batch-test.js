#!/usr/bin/env node
// @semantic
/**
 * The python manifest chain is read once per directory per resolver batch, not
 * once per import; a manifest edited after clearResolverCaches() is re-read.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readPythonDepsChain, clearResolverCaches } = require('../src/services/dep-graph/resolvers/base');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function countStats(fn) {
  const real = fs.statSync;
  let n = 0;
  fs.statSync = function (...args) { n++; return real.apply(this, args); };
  try { fn(); } finally { fs.statSync = real; }
  return n;
}

const root = makeTempDir('wb-py-chain-');
try {
  const sub = path.join(root, 'pkg', 'inner');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(root, 'requirements.txt'), 'requests\n');
  clearResolverCaches();

  let first;
  const stats = countStats(() => { for (let i = 0; i < 50; i++) first = readPythonDepsChain(sub, root); });
  assert(first.has('requests'));
  // 3 manifests per directory on the chain (root, pkg, inner, plus the chain floor), read once: 12.
  assert(stats <= 12, `chain must be resolved once per batch, saw ${stats} statSync calls for 50 lookups`);

  fs.writeFileSync(path.join(root, 'requirements.txt'), 'flask\n');
  clearResolverCaches();
  const after = readPythonDepsChain(sub, root);
  assert(after.has('flask') && !after.has('requests'), 'manifest edited after a batch boundary must be re-read');
  console.log('resolver-python-deps-chain-batch-test OK');
} finally {
  cleanupTempDir(root);
}
