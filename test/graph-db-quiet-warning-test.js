#!/usr/bin/env node
// @contract
// @slow
/**
 * GraphDB quiet warning test
 * Verifies that opening a GraphDB database does not leak the
 * node:sqlite ExperimentalWarning to stderr, even before --quiet
 * option parsing takes place.
 */
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

function testGraphDbDoesNotLeakSqliteWarning() {
  const graphDbPath = path.resolve(__dirname, '../src/services/graph-db');
  const script = `
    const path = require('path');
    const fs = require('fs');
    const os = require('os');
    const { GraphDB } = require(${JSON.stringify(graphDbPath)});

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-warning-test-'));
    const dbPath = path.join(tmpDir, 'cache.db');
    const db = new GraphDB(dbPath);
    db._ensureOpen();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  `;

  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  const stderr = result.stderr || '';

  assert.strictEqual(result.status, 0, `child process should exit 0, got status ${result.status}\nstderr: ${stderr}`);
  assert(
    !stderr.includes('ExperimentalWarning'),
    `stderr should not contain ExperimentalWarning, got:\n${stderr}`
  );
  assert(
    !stderr.toLowerCase().includes('sqlite'),
    `stderr should not mention sqlite, got:\n${stderr}`
  );
}

function main() {
  testGraphDbDoesNotLeakSqliteWarning();
  console.log('graph-db-quiet-warning-test: PASS');
}

main();
