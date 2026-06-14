#!/usr/bin/env node
// @contract
/**
 * GraphDB warning suppression safety test
 *
 * Verifies that suppressing the node:sqlite ExperimentalWarning does not
 * leave a permanent global monkey-patch on process.emitWarning.
 */
const assert = require('assert');
const path = require('path');
const { GraphDB } = require('../src/services/graph-db');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testEmitWarningIsNotPermanentlyReplaced() {
  const originalEmitWarning = process.emitWarning;
  const tmpDir = makeTempDir('wb-graphdb-warning-');
  const dbPath = path.join(tmpDir, 'cache.db');
  const db = new GraphDB(dbPath);

  db._ensureOpen();
  assert.strictEqual(
    process.emitWarning,
    originalEmitWarning,
    'process.emitWarning must not be permanently replaced after _ensureOpen()'
  );

  db.close();
  assert.strictEqual(
    process.emitWarning,
    originalEmitWarning,
    'process.emitWarning must remain the original after close()'
  );

  cleanupTempDir(tmpDir);
}

function main() {
  testEmitWarningIsNotPermanentlyReplaced();
  console.log('graph-db-warning-suppression-test: PASS');
}

main();
