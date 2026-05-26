#!/usr/bin/env node
// @contract

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

function testInvalidConfigJsonExits1() {
  const tempRoot = makeTempDir('wb-config-');
  try {
    fs.writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'cfg', version: '1.0.0' }), 'utf8');
    fs.writeFileSync(path.join(tempRoot, '.workspace-bridge.json'), 'this is not json', 'utf8');

    const result = runCliRaw(['audit-summary', '--cwd', tempRoot, '--json', '--quiet']);
    assert.strictEqual(result.status, 1, 'invalid config should exit 1');
    const stdout = result.stdout || '';
    assert(stdout.trim().startsWith('{'), 'should output JSON to stdout');
    const data = JSON.parse(stdout);
    assert.strictEqual(data.ok, false, 'JSON should have ok: false');
    assert(data.error && data.error.includes('Invalid JSON'), 'error should mention Invalid JSON');
    assert.strictEqual(data.schemaVersion, '1.2.0', 'should include schemaVersion');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function main() {
  testInvalidConfigJsonExits1();
  console.log('cli-config-error-test.js: all passed');
}

main();
