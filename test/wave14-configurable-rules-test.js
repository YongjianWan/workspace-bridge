#!/usr/bin/env node
// @slow

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCli, makeTempDir, cleanupTempDir } = require('./test-helpers');

function testDefaultSecurityRules() {
  const tempDir = makeTempDir('wb-test-default-rules-');
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tempDir, 'app.js'), 'eval("x");', 'utf8');

  // Should find eval warning using default rules
  const scan = runCli(['audit-security', '--builtin-only', '--cwd', tempDir, '--json', '--quiet']);
  assert.strictEqual(scan.ok, true);
  assert(scan.findings.some(f => f.ruleId === 'js-eval'), 'Should find js-eval using default rules');

  cleanupTempDir(tempDir);
}

function testCustomSecurityRules() {
  const tempDir = makeTempDir('wb-test-custom-rules-');
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tempDir, 'app.js'), 'const password = "my-secret-password-123";', 'utf8');

  // 1. Create a custom JSON rules file
  const customRules = {
    rules: [
      {
        lang: 'javascript',
        ext: '\\.(js|jsx)$',
        rules: [
          {
            id: 'my-custom-rule',
            pattern: 'password\\s*=\\s*[\'"][^\'"]+[\'"]',
            severity: 'high',
            message: 'Do not assign password directly'
          }
        ]
      }
    ],
    allowlist: [
      {
        id: 'test-filter',
        ruleIdContains: ['my-custom-rule'],
        pattern: 'dummy'
      }
    ]
  };
  fs.writeFileSync(path.join(tempDir, 'custom-rules.json'), JSON.stringify(customRules, null, 2), 'utf8');

  // 2. Scan using the custom config file
  const scan = runCli(['audit-security', '--builtin-only', '--config', 'custom-rules.json', '--cwd', tempDir, '--json', '--quiet']);
  assert.strictEqual(scan.ok, true);
  assert.strictEqual(scan.findings.length, 1, 'Should find exactly 1 custom rule violation');
  assert.strictEqual(scan.findings[0].ruleId, 'my-custom-rule');

  // 3. Scan with allowlist filter active
  fs.writeFileSync(path.join(tempDir, 'app.js'), 'const password = "dummy-password-123";', 'utf8');
  const scanFiltered = runCli(['audit-security', '--builtin-only', '--config', 'custom-rules.json', '--cwd', tempDir, '--json', '--quiet']);
  assert.strictEqual(scanFiltered.ok, true);
  assert.strictEqual(scanFiltered.findings.length, 0, 'Violation should be filtered out by allowlist pattern "dummy"');

  cleanupTempDir(tempDir);
}

function main() {
  testDefaultSecurityRules();
  testCustomSecurityRules();
  console.log('All Configurable Rules tests passed.');
}

main();
