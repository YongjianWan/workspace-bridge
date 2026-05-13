#!/usr/bin/env node
/**
 * Lightweight test runner for workspace-bridge.
 * Replaces the &&-chained test:all so that every test runs even if one fails.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TEST_DIR = __dirname;
const TIMEOUT_MS = 120000;

const files = fs.readdirSync(TEST_DIR)
  .filter((f) => f.endsWith('.js') && f !== 'runner.js')
 .sort();

let passed = 0;
let failed = 0;
const failures = [];
const start = Date.now();

for (const file of files) {
  const filePath = path.join(TEST_DIR, file);
  process.stdout.write(`\u2192 ${file} ... `);

  const testStart = Date.now();
  const result = spawnSync('node', [filePath], {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  const testElapsed = Date.now() - testStart;

  if (result.status === 0 && !result.signal) {
    passed += 1;
    const elapsedLabel = testElapsed > 10000 ? `PASS (${testElapsed}ms) SLOW` : `PASS (${testElapsed}ms)`;
    console.log(elapsedLabel);
  } else {
    failed += 1;
    console.log('FAIL');
    failures.push({
      file,
      status: result.status,
      signal: result.signal,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    });
    // Print failure output immediately so the user sees it before the next test.
    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }
  }
}

const elapsed = Date.now() - start;
const separator = '-'.repeat(60);

console.log(`\n${separator}`);
console.log(`Ran ${files.length} tests in ${elapsed}ms`);
console.log(`${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log(`\nFailed tests:`);
  for (const f of failures) {
    const reason = f.signal ? `signal ${f.signal}` : `exit ${f.status}`;
    console.log(`  - ${f.file} (${reason})`);
  }
  process.exit(1);
}

console.log('\nAll tests passed.');
