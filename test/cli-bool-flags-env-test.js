#!/usr/bin/env node
// @contract — boolean flags --builtin-only, --watch, --strict-cwd must resolve through resolveOption()

const assert = require('assert');
const { parseCliArgs } = require('../src/cli/validate-args');

function withEnv(name, value, fn) {
  const original = process.env[name];
  try {
    if (value !== undefined) process.env[name] = value;
    else delete process.env[name];
    fn();
  } finally {
    if (original !== undefined) process.env[name] = original;
    else delete process.env[name];
  }
}

function testBuiltinOnlyFromEnv() {
  withEnv('WB_BUILTIN_ONLY', '1', () => {
    const parsed = parseCliArgs(['node', 'cli.js']);
    assert.strictEqual(parsed.builtinOnly, true, 'WB_BUILTIN_ONLY=1 should set builtinOnly');
    assert.strictEqual(parsed._sources.builtinOnly, 'env', 'builtinOnly source should be env');
  });
  withEnv('WB_BUILTIN_ONLY', 'true', () => {
    const parsed = parseCliArgs(['node', 'cli.js']);
    assert.strictEqual(parsed.builtinOnly, true, 'WB_BUILTIN_ONLY=true should set builtinOnly');
  });
}

function testWatchFromEnv() {
  withEnv('WB_WATCH', '1', () => {
    const parsed = parseCliArgs(['node', 'cli.js']);
    assert.strictEqual(parsed.watch, true, 'WB_WATCH=1 should set watch');
    assert.strictEqual(parsed._sources.watch, 'env', 'watch source should be env');
  });
}

function testStrictCwdFromEnv() {
  withEnv('WB_STRICT_CWD', '1', () => {
    const parsed = parseCliArgs(['node', 'cli.js']);
    assert.strictEqual(parsed.strictCwd, true, 'WB_STRICT_CWD=1 should set strictCwd');
    assert.strictEqual(parsed._sources.strictCwd, 'env', 'strictCwd source should be env');
  });
}

function testCliOverridesEnv() {
  withEnv('WB_BUILTIN_ONLY', '0', () => {
    const parsed = parseCliArgs(['node', 'cli.js', '--builtin-only']);
    assert.strictEqual(parsed.builtinOnly, true, 'CLI --builtin-only should override WB_BUILTIN_ONLY=0');
    assert.strictEqual(parsed._sources.builtinOnly, 'cli', 'builtinOnly source should be cli');
  });
  withEnv('WB_WATCH', '0', () => {
    const parsed = parseCliArgs(['node', 'cli.js', '--watch']);
    assert.strictEqual(parsed.watch, true, 'CLI --watch should override WB_WATCH=0');
    assert.strictEqual(parsed._sources.watch, 'cli', 'watch source should be cli');
  });
  withEnv('WB_STRICT_CWD', '0', () => {
    const parsed = parseCliArgs(['node', 'cli.js', '--strict-cwd']);
    assert.strictEqual(parsed.strictCwd, true, 'CLI --strict-cwd should override WB_STRICT_CWD=0');
    assert.strictEqual(parsed._sources.strictCwd, 'cli', 'strictCwd source should be cli');
  });
}

function testEnvFalseValues() {
  withEnv('WB_BUILTIN_ONLY', 'false', () => {
    const parsed = parseCliArgs(['node', 'cli.js']);
    assert.strictEqual(parsed.builtinOnly, false, 'WB_BUILTIN_ONLY=false should not set builtinOnly');
    assert.strictEqual(parsed._sources.builtinOnly, 'env', 'builtinOnly source should still be env');
  });
  withEnv('WB_WATCH', '0', () => {
    const parsed = parseCliArgs(['node', 'cli.js']);
    assert.strictEqual(parsed.watch, false, 'WB_WATCH=0 should not set watch');
    assert.strictEqual(parsed._sources.watch, 'env', 'watch source should still be env');
  });
}

function testTruthyBooleanEnvValues() {
  for (const value of ['TRUE', 'YES', 'ON', '1']) {
    withEnv('WB_QUIET', value, () => {
      const parsed = parseCliArgs(['node', 'cli.js']);
      assert.strictEqual(parsed.quiet, true, `WB_QUIET=${value} should be truthy`);
      assert.strictEqual(parsed._sources.quiet, 'env', `WB_QUIET=${value} source should be env`);
    });
    withEnv('WB_JSON', value, () => {
      const parsed = parseCliArgs(['node', 'cli.js']);
      assert.strictEqual(parsed.json, true, `WB_JSON=${value} should be truthy`);
      assert.strictEqual(parsed._sources.json, 'env', `WB_JSON=${value} source should be env`);
    });
  }
}

function testUppercaseEnumValues() {
  const parsedSeverity = parseCliArgs(['node', 'cli.js', '--severity', 'HIGH']);
  assert.strictEqual(parsedSeverity.severity, 'high', '--severity HIGH should normalize to lowercase');
  assert.strictEqual(parsedSeverity._sources.severity, 'cli', 'severity source should be cli');

  withEnv('WB_SEVERITY', 'MEDIUM', () => {
    const parsed = parseCliArgs(['node', 'cli.js']);
    assert.strictEqual(parsed.severity, 'medium', 'WB_SEVERITY=MEDIUM should normalize to lowercase');
    assert.strictEqual(parsed._sources.severity, 'env', 'severity source should be env');
  });

  const parsedMode = parseCliArgs(['node', 'cli.js', '--mode', 'QUICK']);
  assert.strictEqual(parsedMode.mode, 'quick', '--mode QUICK should normalize to lowercase');

  withEnv('WB_MODE', 'FULL', () => {
    const parsed = parseCliArgs(['node', 'cli.js']);
    assert.strictEqual(parsedMode.mode, 'quick', 'WB_MODE=FULL should normalize to lowercase');
  });

  const parsedFormat = parseCliArgs(['node', 'cli.js', '--format', 'JSON']);
  assert.strictEqual(parsedFormat.format, null, '--format JSON normalizes to json and is then represented by json flag');
  assert.strictEqual(parsedFormat.json, true, '--format JSON should imply json=true');
  assert.strictEqual(parsedFormat._sources.format, 'cli', 'format source should be cli');
}

function testCwdSourceTracking() {
  const originals = {
    WB_CWD: process.env.WB_CWD,
  };
  try {
    delete process.env.WB_CWD;
    const parsedDefault = parseCliArgs(['node', 'cli.js']);
    assert.strictEqual(parsedDefault._sources.cwd, 'default', 'cwd source should be default when no --cwd or WB_CWD');

    const parsedCli = parseCliArgs(['node', 'cli.js', '--cwd', '.']);
    assert.strictEqual(parsedCli._sources.cwd, 'cli', 'cwd source should be cli when --cwd provided');

    process.env.WB_CWD = '.';
    const parsedEnv = parseCliArgs(['node', 'cli.js']);
    assert.strictEqual(parsedEnv._sources.cwd, 'env', 'cwd source should be env when WB_CWD provided');
  } finally {
    if (originals.WB_CWD !== undefined) process.env.WB_CWD = originals.WB_CWD;
    else delete process.env.WB_CWD;
  }
}

function main() {
  const tests = [
    testBuiltinOnlyFromEnv,
    testWatchFromEnv,
    testStrictCwdFromEnv,
    testCliOverridesEnv,
    testEnvFalseValues,
    testTruthyBooleanEnvValues,
    testUppercaseEnumValues,
    testCwdSourceTracking,
  ];
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      passed++;
      console.log(`  PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${t.name}: ${err.message}`);
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  if (failed > 0) process.exit(1);
}

main();
