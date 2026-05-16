const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliRaw } = require('./test-helpers');

const cwd = path.resolve(__dirname, '..');
const targetFile = path.join(cwd, 'src', 'utils', 'path.js');

function run(args) {
  return runCliRaw([...args, '--json', '--quiet'], { cwd });
}

function testWithImpact() {
  const original = fs.readFileSync(targetFile, 'utf8');
  try {
    fs.writeFileSync(targetFile, original + '\n// temp-change-for-test\n');
    const result = run(['audit-diff', '--with-impact']);
    assert.strictEqual(result.status, 0, `Exit code should be 0, got ${result.status}. stderr: ${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert(Array.isArray(data.impactFiles), 'impactFiles should be an array');
    assert(data.impactFiles.length > 0, 'impactFiles should contain dependents of src/utils/path.js');
    assert(data.changedFiles.length > 0, 'changedFiles should include modified file');
  } finally {
    fs.writeFileSync(targetFile, original);
  }
}

function testWithoutImpact() {
  const original = fs.readFileSync(targetFile, 'utf8');
  try {
    fs.writeFileSync(targetFile, original + '\n// temp-change-for-test-no-impact\n');
    const result = run(['audit-diff']);
    assert.strictEqual(result.status, 0, `Exit code should be 0, got ${result.status}. stderr: ${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.strictEqual(data.impactFiles, undefined, 'impactFiles should not exist without --with-impact');
  } finally {
    fs.writeFileSync(targetFile, original);
  }
}

function main() {
  testWithImpact();
  testWithoutImpact();
  console.log('with-impact-test.js: all passed');
}

main();
