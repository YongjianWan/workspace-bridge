#!/usr/bin/env node
// @contract
/**
 * Tests for buildSafeEnv: child processes must receive a minimal environment
 * whitelist rather than the full parent process.env, to avoid leaking secrets
 * (tokens, DB URLs, etc.) to spawned Python/shell helpers.
 */
const assert = require('assert');
const { buildSafeEnv } = require('../src/utils/command');

function testSafeEnvWhitelist() {
  // Simulate a parent environment with sensitive variables
  const originalEnv = process.env;
  const sensitiveKeys = [
    'AWS_SECRET_ACCESS_KEY',
    'DATABASE_URL',
    'NPM_TOKEN',
    'GITHUB_TOKEN',
    'PRIVATE_KEY',
    'WB_TEST_SENSITIVE_SECRET',
  ];

  // Set sensitive values on process.env so buildSafeEnv must ignore them
  for (const key of sensitiveKeys) {
    process.env[key] = 'should-not-leak';
  }

  try {
    const env = buildSafeEnv();

    // Required variables must be present
    assert.ok(env.PATH, 'PATH must be preserved');
    assert.strictEqual(env.PYTHONIOENCODING, 'utf-8', 'PYTHONIOENCODING must be set to utf-8');

    // Sensitive variables must NOT leak
    for (const key of sensitiveKeys) {
      assert.strictEqual(env[key], undefined, `${key} should not be passed to child process`);
    }
  } finally {
    for (const key of sensitiveKeys) {
      delete process.env[key];
    }
  }
}

function testSafeEnvAllowsOverrides() {
  process.env.WB_ALLOWED_OVERRIDE = 'parent-value';
  try {
    const env = buildSafeEnv({ WB_ALLOWED_OVERRIDE: 'override-value' });
    assert.strictEqual(env.WB_ALLOWED_OVERRIDE, 'override-value', 'explicit extraEnv should be included');
  } finally {
    delete process.env.WB_ALLOWED_OVERRIDE;
  }
}

function main() {
  testSafeEnvWhitelist();
  console.log('  PASS testSafeEnvWhitelist');
  testSafeEnvAllowsOverrides();
  console.log('  PASS testSafeEnvAllowsOverrides');
  console.log('test/safe-env-test.js ... PASS');
}

main();
