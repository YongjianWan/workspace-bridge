// @semantic
// @slow
// Regression archive for known security false-positive scenarios.
// If a previously-fixed FP recurs, this test fails.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcessRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

const tempDir = makeTempDir('wb-fp-sec-');

// ---_fixture setup-----------------------------------------------------------
fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
fs.mkdirSync(path.join(tempDir, 'test'), { recursive: true });
fs.mkdirSync(path.join(tempDir, 'spec'), { recursive: true });
fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'fp-sec', version: '1.0.0' }), 'utf8');

// 1) assert-defense: dangerous patterns inside test assertions must be suppressed
fs.writeFileSync(path.join(tempDir, 'test', 'defense.js'), `
expect(() => eval('x')).toThrow();
assert.throws(() => new Function('x'));
await expect(promise).rejects.toThrow();
obj.unwrap_err();
`, 'utf8');

// 2) test-placeholder-secrets: test/spec directories with placeholder values
fs.writeFileSync(path.join(tempDir, 'test', 'config.js'), `const password = 'test_dummy123';\n`, 'utf8');
fs.writeFileSync(path.join(tempDir, 'spec', 'helper.js'), `const apiKey = 'mock_key_12345678';\n`, 'utf8');
fs.writeFileSync(path.join(tempDir, 'test', 'fixture.py'), `password = 'fake_password_123'\n`, 'utf8');

// 3) real secret in src/ — must NOT be suppressed (detector must still work)
fs.writeFileSync(path.join(tempDir, 'src', 'app.js'), `const password = 'real_secret_12345678';\n`, 'utf8');

// ---helpers-----------------------------------------------------------------
async function runAuditSecurity(cwd) {
  return runCliInProcessRaw(['audit-security', '--cwd', cwd, '--builtin-only', '--json', '--quiet'], { cwd });
}

function parseJsonSafe(result) {
  let stdout = result.stdout;
  if (stdout && stdout.startsWith('\ufeff')) stdout = stdout.slice(1);
  return JSON.parse(stdout);
}

// ---tests-------------------------------------------------------------------
async function testAssertDefenseSuppressesDangerousPatterns() {
  const result = await runAuditSecurity(tempDir);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
  const data = parseJsonSafe(result);

  const defenseFindings = data.findings.filter(
    (f) => f.file && f.file.includes('test' + path.sep + 'defense.js')
  );
  assert.strictEqual(
    defenseFindings.length,
    0,
    `assert-defense should suppress all dangerous-pattern findings in test/defense.js, got: ${JSON.stringify(defenseFindings)}`
  );
}

async function testPlaceholderSecretsSuppressedInTestDirs() {
  const result = await runAuditSecurity(tempDir);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
  const data = parseJsonSafe(result);

  const testFindings = data.findings.filter(
    (f) => f.file && (f.file.includes('test' + path.sep) || f.file.includes('spec' + path.sep))
  );
  assert.strictEqual(
    testFindings.length,
    0,
    `test-placeholder-secrets should suppress hardcoded-secret in test/spec dirs, got: ${JSON.stringify(testFindings)}`
  );
}

async function testRealSecretStillDetectedInSrc() {
  const result = await runAuditSecurity(tempDir);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
  const data = parseJsonSafe(result);

  const srcFindings = data.findings.filter(
    (f) => f.file && f.file.includes('src' + path.sep + 'app.js')
  );
  assert.ok(
    srcFindings.length > 0,
    `real secret in src/app.js must still be detected, got 0 findings`
  );
  assert.ok(
    srcFindings.some((f) => f.ruleId && f.ruleId.includes('hardcoded-secret')),
    `src/app.js finding should be hardcoded-secret, got: ${JSON.stringify(srcFindings)}`
  );
}

async function testTotalFindingsConsistent() {
  const result = await runAuditSecurity(tempDir);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
  const data = parseJsonSafe(result);

  // Exactly 1 real finding (src/app.js) and zero FPs
  assert.strictEqual(
    data.summary.total,
    1,
    `expected exactly 1 finding (src/app.js real secret), got ${data.summary.total}: ${JSON.stringify(data.findings.map((f) => ({ file: f.file, ruleId: f.ruleId })))}`
  );
}

// ---main--------------------------------------------------------------------
async function main() {
  try {
    await testAssertDefenseSuppressesDangerousPatterns();
    await testPlaceholderSecretsSuppressedInTestDirs();
    await testRealSecretStillDetectedInSrc();
    await testTotalFindingsConsistent();
  } finally {
    cleanupTempDir(tempDir);
  }
}

main();
