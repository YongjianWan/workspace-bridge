#!/usr/bin/env node
// @contract — ignore.findings 过滤、ignore.frameworks 过滤、WB_* 环境变量、markFalsePositive

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseCliArgs } = require('../src/cli/validate-args');
const { GraphAnalyzer } = require('../src/services/dep-graph/analyzer');
const { DependencyGraph } = require('../src/services/dep-graph');
const { ProjectContext } = require('../src/utils/project-context');
const { runCliInProcessRaw } = require('./test-helpers');

/* -------------------------------------------------------------------------- */
// Test 1: ignore.findings 过滤 dead-exports
/* -------------------------------------------------------------------------- */
function testIgnoreFindingsDeadExports() {
  const dg = DependencyGraph.fromSchema('/mock', {
    'src/a.js': { imports: [], exports: ['foo'], originalPath: 'src/a.js' },
    'src/b.js': { imports: [], exports: ['bar'], originalPath: 'src/b.js' },
  });
  dg.projectContext = {
    config: {
      ignore: {
        findings: ['dead-export:src/a.js'],
      },
    },
    summarizeFiles: () => ({}),
  };
  const analyzer = new GraphAnalyzer(dg);
  const result = analyzer.findDeadExports({ skipCache: true });
  assert.ok(Array.isArray(result));
  const ids = result.map((r) => r.id);
  assert.ok(!ids.includes('dead-export:src/a.js'), 'Expected dead-export:src/a.js to be filtered out');
  assert.ok(ids.includes('dead-export:src/b.js'), 'Expected dead-export:src/b.js to remain');
}

/* -------------------------------------------------------------------------- */
// Test 2: ignore.findings 过滤 unresolved
/* -------------------------------------------------------------------------- */
function testIgnoreFindingsUnresolved() {
  const dg = DependencyGraph.fromSchema('/mock', {
    'src/a.js': { imports: ['/mock/missing.js'], exports: [], originalPath: 'src/a.js' },
    'src/b.js': { imports: ['/mock/another-missing.js'], exports: [], originalPath: 'src/b.js' },
  });
  // Imports are normalized via normalizeFilePath; compute expected display IDs cross-platform.
  const missingDisplay = dg._displayPath(dg.normalizeFilePath('/mock/missing.js'));
  const anotherMissingDisplay = dg._displayPath(dg.normalizeFilePath('/mock/another-missing.js'));
  dg.projectContext = {
    config: {
      ignore: {
        findings: [`unresolved:src/a.js:${missingDisplay}`],
      },
    },
  };
  const analyzer = new GraphAnalyzer(dg);
  const result = analyzer.findUnresolvedImports({ skipCache: true });
  assert.ok(Array.isArray(result));
  const ids = result.map((r) => r.id);
  assert.ok(!ids.includes(`unresolved:src/a.js:${missingDisplay}`), `Expected unresolved:src/a.js:${missingDisplay} to be filtered out`);
  assert.ok(ids.includes(`unresolved:src/b.js:${anotherMissingDisplay}`), `Expected unresolved:src/b.js:${anotherMissingDisplay} to remain`);
}

/* -------------------------------------------------------------------------- */
// Test 3: --mark-false-positive 端到端
/* -------------------------------------------------------------------------- */
async function testMarkFalsePositiveEndToEnd() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-mfp-'));
  try {
    const configPath = path.join(tmpDir, '.workspace-bridge.json');
    fs.writeFileSync(configPath, JSON.stringify({ ignore: { findings: [] } }, null, 2), 'utf8');

    // Mark a false positive
    const markResult = await runCliInProcessRaw(['--cwd', tmpDir, '--mark-false-positive', 'dead-export:fake.js']);
    assert.strictEqual(markResult.status, 0, `markFalsePositive failed: ${markResult.stderr}`);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(config.ignore.findings.includes('dead-export:fake.js'), 'Expected finding ID to be written to config');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/* -------------------------------------------------------------------------- */
// Test 4: WB_COMPACT=1
/* -------------------------------------------------------------------------- */
function testWBCompactEnv() {
  const original = process.env.WB_COMPACT;
  try {
    process.env.WB_COMPACT = '1';
    const parsed = parseCliArgs(['node', 'cli.js', '--cwd', '.']);
    assert.strictEqual(parsed.compact, true, 'Expected compact to be true from WB_COMPACT=1');
    assert.strictEqual(parsed._sources.compact, 'env', 'Expected compact source to be env');
  } finally {
    if (original !== undefined) process.env.WB_COMPACT = original;
    else delete process.env.WB_COMPACT;
  }
}

/* -------------------------------------------------------------------------- */
// Test 5: WB_FAIL_ON_FINDINGS=1
/* -------------------------------------------------------------------------- */
function testWBFailOnFindingsEnv() {
  const original = process.env.WB_FAIL_ON_FINDINGS;
  try {
    process.env.WB_FAIL_ON_FINDINGS = '1';
    const parsed = parseCliArgs(['node', 'cli.js', '--cwd', '.']);
    assert.strictEqual(parsed.failOnFindings, true, 'Expected failOnFindings to be true from WB_FAIL_ON_FINDINGS=1');
    assert.strictEqual(parsed._sources.failOnFindings, 'env', 'Expected failOnFindings source to be env');
  } finally {
    if (original !== undefined) process.env.WB_FAIL_ON_FINDINGS = original;
    else delete process.env.WB_FAIL_ON_FINDINGS;
  }
}

/* -------------------------------------------------------------------------- */
// Test 6: CLI 参数优先级高于环境变量
/* -------------------------------------------------------------------------- */
function testCliOverridesEnv() {
  const originals = {
    WB_FORMAT: process.env.WB_FORMAT,
    WB_QUIET: process.env.WB_QUIET,
    WB_JSON: process.env.WB_JSON,
    WB_CWD: process.env.WB_CWD,
  };
  try {
    process.env.WB_FORMAT = 'markdown';
    process.env.WB_QUIET = '0';
    process.env.WB_JSON = '0';
    process.env.WB_CWD = '/tmp/from-env';

    const parsed = parseCliArgs(['node', 'cli.js', '--cwd', '/tmp/from-cli', '--format', 'ai', '--quiet', '--json']);

    assert.strictEqual(parsed.format, 'ai', 'CLI --format should override WB_FORMAT');
    assert.strictEqual(parsed._sources.format, 'cli', 'format source should be cli');
    assert.strictEqual(parsed.quiet, true, 'CLI --quiet should override WB_QUIET=0');
    assert.strictEqual(parsed._sources.quiet, 'cli', 'quiet source should be cli');
    assert.strictEqual(parsed.json, true, 'CLI --json should override WB_JSON=0');
    assert.strictEqual(parsed._sources.json, 'cli', 'json source should be cli');
    assert.ok(parsed.cwd.includes('/tmp/from-cli'), 'CLI --cwd should override WB_CWD');
    assert.strictEqual(parsed._sources.cwd, 'cli', 'cwd source should be cli');
  } finally {
    for (const [key, val] of Object.entries(originals)) {
      if (val !== undefined) process.env[key] = val;
      else delete process.env[key];
    }
  }
}

/* -------------------------------------------------------------------------- */
// Test 7: ignore.frameworks 过滤
/* -------------------------------------------------------------------------- */
function testIgnoreFrameworks() {
  const dg = DependencyGraph.fromSchema('/mock', {
    'src/routes/express.js': {
      imports: [],
      exports: ['router'],
      originalPath: 'src/routes/express.js',
      frameworkHint: { framework: 'express', reason: 'routes-folder' },
    },
    'src/lib/utils.js': {
      imports: [],
      exports: ['helper'],
      originalPath: 'src/lib/utils.js',
    },
  });
  dg.projectContext = {
    config: {
      ignore: {
        frameworks: ['express'],
      },
    },
  };
  const expressKey = dg.normalizeFilePath('/mock/src/routes/express.js');
  const utilsKey = dg.normalizeFilePath('/mock/src/lib/utils.js');
  assert.strictEqual(dg.shouldExcludeCli(expressKey), true, 'Expected express file to be excluded');
  assert.strictEqual(dg.shouldExcludeCli(utilsKey), false, 'Expected non-express file to not be excluded');
}

/* -------------------------------------------------------------------------- */
// Test 7: --all alone should show full command list
/* -------------------------------------------------------------------------- */
async function testAllHelpTrigger() {
  const result = await runCliInProcessRaw(['--all']);
  assert.strictEqual(result.status, 0, `--all should exit 0, got stderr: ${result.stderr}`);
  const stdout = result.stdout || '';
  assert.ok(stdout.includes('L1'), `Expected full command list to include L1 section, got: ${stdout.slice(0, 200)}`);
}

/* -------------------------------------------------------------------------- */
// Test 8: WB_JSON causes parse errors to be emitted as JSON
/* -------------------------------------------------------------------------- */
async function testJsonErrorFromEnv() {
  const original = process.env.WB_JSON;
  try {
    process.env.WB_JSON = '1';
    const result = await runCliInProcessRaw(['--severity', 'invalid-value']);
    assert.strictEqual(result.status, 1, `Expected validation error status 1, got ${result.status}`);
    assert.strictEqual(result.stderr, '', `Expected no stderr when WB_JSON requests JSON errors, got: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.ok, false, 'Expected JSON error response');
    assert.ok(parsed.error && parsed.error.includes('severity'), `Expected severity error, got: ${parsed.error}`);
    assert.strictEqual(parsed.schemaVersion, '1.2.0', 'Expected schema version in JSON error');
  } finally {
    if (original !== undefined) process.env.WB_JSON = original;
    else delete process.env.WB_JSON;
  }
}

/* -------------------------------------------------------------------------- */
// Test 9: 配置来源报告细化
/* -------------------------------------------------------------------------- */
async function testConfigOriginReport() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-origin-'));
  try {
    const configPath = path.join(tmpDir, '.workspace-bridge.json');
    fs.writeFileSync(configPath, JSON.stringify({ ignore: { paths: ['dist'] } }, null, 2), 'utf8');

    const result = await runCliInProcessRaw(['--cwd', tmpDir, '--strict-cwd', '--json', 'audit-overview']);
    const status = result.status ?? (result.signal ? 1 : 0);
    assert.strictEqual(status, 0, `CLI failed: status=${result.status} signal=${result.signal} stderr=${result.stderr}`);
    const stderr = result.stderr || '';
    assert.ok(stderr.includes('ignore from file'), `Expected stderr to contain 'ignore from file', got: ${stderr}`);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/* -------------------------------------------------------------------------- */
// Test 8: ignore.findings 动态过滤缓存的 aggregate
/* -------------------------------------------------------------------------- */
function testIgnoreFindingsDynamicCache() {
  const dg = DependencyGraph.fromSchema('/mock', {
    'src/a.js': { imports: [], exports: ['foo'], originalPath: 'src/a.js' },
    'src/b.js': { imports: [], exports: ['bar'], originalPath: 'src/b.js' },
  });
  dg.projectContext = {
    config: {
      ignore: {
        findings: ['dead-export:src/a.js'],
      },
    },
    summarizeFiles: () => ({}),
  };
  const analyzer = new GraphAnalyzer(dg);
  // Precomputing should cache the RAW (unfiltered) findings
  analyzer.precomputeAggregates();

  // 1. Initial query: should filter out 'src/a.js'
  const res1 = analyzer.findDeadExports();
  const ids1 = res1.map((r) => r.id);
  assert.ok(!ids1.includes('dead-export:src/a.js'), 'Expected src/a.js to be filtered initially');
  assert.ok(ids1.includes('dead-export:src/b.js'), 'Expected src/b.js to remain initially');

  // 2. Change ignore.findings dynamically (without clearing cache/updating graph version)
  dg.projectContext.config.ignore.findings = ['dead-export:src/b.js'];
  const res2 = analyzer.findDeadExports();
  const ids2 = res2.map((r) => r.id);
  assert.ok(ids2.includes('dead-export:src/a.js'), 'Expected src/a.js to be returned after config change');
  assert.ok(!ids2.includes('dead-export:src/b.js'), 'Expected src/b.js to be filtered after config change');
}

/* -------------------------------------------------------------------------- */
// Runner
/* -------------------------------------------------------------------------- */
const tests = [
  testIgnoreFindingsDeadExports,
  testIgnoreFindingsUnresolved,
  testMarkFalsePositiveEndToEnd,
  testWBCompactEnv,
  testWBFailOnFindingsEnv,
  testCliOverridesEnv,
  testIgnoreFrameworks,
  testAllHelpTrigger,
  testJsonErrorFromEnv,
  testConfigOriginReport,
  testIgnoreFindingsDynamicCache,
];

async function main() {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
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
