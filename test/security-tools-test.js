const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { auditSecurity, groupBySeverity, dedupeWithinTool } = require('../src/tools/security-tools');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testGroupBySeverity() {
  const findings = [
    { severity: 'high' },
    { severity: 'high' },
    { severity: 'medium' },
    { severity: 'low' },
    { severity: 'unknown' },
    { severity: 'invalid' },
  ];
  const result = groupBySeverity(findings);
  assert.strictEqual(result.high, 2, 'should count 2 high');
  assert.strictEqual(result.medium, 1, 'should count 1 medium');
  assert.strictEqual(result.low, 1, 'should count 1 low');
  assert.strictEqual(result.unknown, 2, 'should count 2 unknown (includes invalid)');
}

function testDedupeWithinTool() {
  const findings = [
    { tool: 'builtin', ruleId: 'r1', file: 'a.js', lineStart: 1, message: 'm1' },
    { tool: 'builtin', ruleId: 'r1', file: 'a.js', lineStart: 1, message: 'm1 dup' },
    { tool: 'builtin', ruleId: 'r2', file: 'a.js', lineStart: 1, message: 'm2' },
    { tool: 'semgrep', ruleId: 'r1', file: 'a.js', lineStart: 1, message: 'm3' },
  ];
  const result = dedupeWithinTool(findings);
  assert.strictEqual(result.length, 3, 'should dedupe exact match within same tool, keep cross-tool');
  assert(result.some((f) => f.tool === 'semgrep'), 'should keep cross-tool duplicate');
}

async function testAuditSecurityBuiltinOnly() {
  const tmpDir = makeTempDir('wb-security-');
  fs.writeFileSync(path.join(tmpDir, 'test.js'), "eval('1+1');\n", 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'safe.js'), "const x = 1;\n", 'utf8');

  const result = await auditSecurity({ cwd: tmpDir, targets: [], builtinOnly: true }, null);
  assert.strictEqual(result.ok, true, 'should return ok');
  assert(result.adapters.includes('builtin'), 'should use builtin adapter');
  assert(result.findings.length >= 1, 'should find eval in test.js');
  assert(result.findings.some((f) => f.ruleId === 'js-eval'), 'should detect js-eval');
  assert(result.summary.total >= 1, 'summary total should match findings');
  assert(result.summary.bySeverity.high >= 1, 'should have at least 1 high severity');

  cleanupTempDir(tmpDir);
}

async function testAuditSecurityIgnoresComment() {
  const tmpDir = makeTempDir('wb-security-');
  fs.writeFileSync(path.join(tmpDir, 'ignored.js'), "eval('1+1'); // security-scan-ignore\n", 'utf8');

  const result = await auditSecurity({ cwd: tmpDir, targets: [], builtinOnly: true }, null);
  assert.strictEqual(result.findings.length, 0, 'should ignore lines with security-scan-ignore comment');

  cleanupTempDir(tmpDir);
}

async function testAuditSecurityPython() {
  const tmpDir = makeTempDir('wb-security-');
  fs.writeFileSync(path.join(tmpDir, 'test.py'), "import os\nos.system('ls')\n", 'utf8');

  const result = await auditSecurity({ cwd: tmpDir, targets: [], builtinOnly: true }, null);
  assert(result.findings.some((f) => f.ruleId === 'py-os-system'), 'should detect py-os-system');

  cleanupTempDir(tmpDir);
}

async function testAuditSecurityAssertDefense() {
  const tmpDir = makeTempDir('wb-security-');
  fs.writeFileSync(path.join(tmpDir, 'defense.js'), "expect(() => eval('x')).toThrow();\n", 'utf8');

  const result = await auditSecurity({ cwd: tmpDir, targets: [], builtinOnly: true }, null);
  assert.strictEqual(result.findings.length, 0, 'should suppress eval in assert-defense test code');

  cleanupTempDir(tmpDir);
}

async function testAuditSecurityAssertDefenseVariants() {
  const tmpDir = makeTempDir('wb-security-');
  const variants = [
    "assert.throws(() => eval('x'));\n",
    "assert.rejects(async () => exec('x'));\n",
    "expect(() => new Function('x')).to.throw();\n",
    "await expect(promise).rejects.toThrow();\n",
    "obj.unwrap_err();\n",
  ];
  for (let i = 0; i < variants.length; i++) {
    fs.writeFileSync(path.join(tmpDir, `defense${i}.js`), variants[i], 'utf8');
  }

  const result = await auditSecurity({ cwd: tmpDir, targets: [], builtinOnly: true }, null);
  assert.strictEqual(result.findings.length, 0, 'should suppress all assert-defense variants');

  cleanupTempDir(tmpDir);
}

async function testAuditSecurityTestFilePlaceholderSecret() {
  const tmpDir = makeTempDir('wb-security-');
  const testDir = path.join(tmpDir, 'test');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, 'auth.js'), "const password = 'test_dummy123';\n", 'utf8');

  const result = await auditSecurity({ cwd: tmpDir, targets: [], builtinOnly: true }, null);
  assert.strictEqual(result.findings.length, 0, 'should suppress placeholder secret in test files');

  cleanupTempDir(tmpDir);
}

async function main() {
  testGroupBySeverity();
  testDedupeWithinTool();
  await testAuditSecurityBuiltinOnly();
  await testAuditSecurityIgnoresComment();
  await testAuditSecurityPython();
  await testAuditSecurityAssertDefense();
  await testAuditSecurityAssertDefenseVariants();
  await testAuditSecurityTestFilePlaceholderSecret();
}

main().catch((e) => { console.error(e); process.exit(1); });
