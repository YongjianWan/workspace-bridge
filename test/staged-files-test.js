const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliRaw, assertOk, makeTempDir, cleanupTempDir } = require('./test-helpers');

const cwd = path.resolve(__dirname, '..');
const targetFile = path.join(cwd, 'src', 'utils', 'path.js');

function run(args) {
  return runCliRaw([...args, '--json', '--quiet'], { cwd });
}

function testStagedFlagParsing() {
  // --staged should be accepted without error
  const result = run(['audit-diff', '--staged']);
  // In a clean working tree this may return 0 with empty changedFiles
  assertOk(result, 'audit-diff --staged should succeed');
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.ok, true, 'ok should be true');
  assert(Array.isArray(data.changedFiles), 'changedFiles should be an array');
}

function testFilesFlagAuditDiff() {
  const files = 'src/utils/path.js,src/utils/constants.js';
  const result = run(['audit-diff', '--files', files]);
  assertOk(result, 'audit-diff --files should succeed');
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.ok, true, 'ok should be true');
  assert.strictEqual(data.changedFiles.length, 2, 'should return exactly 2 files');
  const fileNames = data.changedFiles.map((e) => e.file || e);
  assert(fileNames.some((f) => f.includes('path.js')), 'should include path.js');
  assert(fileNames.some((f) => f.includes('constants.js')), 'should include constants.js');
}

function testFilesFlagAuditSecurity() {
  const tempDir = makeTempDir('wb-staged-sec-');
  const tmpFile = path.join(tempDir, 'test-staged-sec-temp.js');
  try {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}'); // Dummy package.json
    fs.writeFileSync(tmpFile, `eval('1');\n`);
    const result = runCliRaw(['audit-security', '--cwd', tempDir, '--builtin-only', '--files', tmpFile, '--json', '--quiet'], { cwd: tempDir });
    assertOk(result, 'audit-security --files should succeed');
    const data = JSON.parse(result.stdout);
    assert.strictEqual(data.ok, true, 'ok should be true');
    assert(data.findings.length > 0, 'should find security issues in specified file');
    assert(data.findings.every((f) => f.file.includes('test-staged-sec-temp.js')), 'all findings should be from the specified file');
  } finally {
    cleanupTempDir(tempDir);
  }
}

function testStagedAndFilesMutualExclusion() {
  // When --files is provided, --staged should be ignored (files takes precedence)
  const files = 'src/utils/path.js';
  const result = run(['audit-diff', '--staged', '--files', files]);
  assertOk(result, 'audit-diff --staged --files should succeed');
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.changedFiles.length, 1, 'should return exactly 1 file from --files');
}

function testInvalidFilesNonExistentAuditDiff() {
  // Non-existent files should still be included in the output (graceful handling)
  const result = run(['audit-diff', '--files', 'nonexistent-file-12345.js']);
  assertOk(result, 'audit-diff with non-existent file should succeed');
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.changedFiles.length, 1, 'should return the non-existent file entry');
  assert.strictEqual(data.changedFiles[0].graphKnown, false, 'non-existent file should have graphKnown=false');
}

function main() {
  testStagedFlagParsing();
  testFilesFlagAuditDiff();
  testFilesFlagAuditSecurity();
  testStagedAndFilesMutualExclusion();
  testInvalidFilesNonExistentAuditDiff();
}

main();
