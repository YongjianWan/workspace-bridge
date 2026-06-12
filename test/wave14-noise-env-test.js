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
const { runCliRaw } = require('./test-helpers');

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
  dg.projectContext = {
    config: {
      ignore: {
        findings: ['unresolved:src/a.js:/mock/missing.js'],
      },
    },
  };
  const analyzer = new GraphAnalyzer(dg);
  const result = analyzer.findUnresolvedImports({ skipCache: true });
  assert.ok(Array.isArray(result));
  const ids = result.map((r) => r.id);
  assert.ok(!ids.includes('unresolved:src/a.js:/mock/missing.js'), 'Expected unresolved:src/a.js:/mock/missing.js to be filtered out');
  assert.ok(ids.includes('unresolved:src/b.js:/mock/another-missing.js'), 'Expected unresolved:src/b.js:/mock/another-missing.js to remain');
}

/* -------------------------------------------------------------------------- */
// Test 3: --mark-false-positive 端到端
/* -------------------------------------------------------------------------- */
function testMarkFalsePositiveEndToEnd() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-mfp-'));
  try {
    const configPath = path.join(tmpDir, '.workspace-bridge.json');
    fs.writeFileSync(configPath, JSON.stringify({ ignore: { findings: [] } }, null, 2), 'utf8');

    // Mark a false positive
    const markResult = runCliRaw(['--cwd', tmpDir, '--mark-false-positive', 'dead-export:fake.js']);
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
// Test 6: ignore.frameworks 过滤
/* -------------------------------------------------------------------------- */
function testIgnoreFrameworks() {
  // Build graph manually to bypass fromSchema/normalizeFilePath mismatch on Windows
  const dg = DependencyGraph.fromSchema('/mock', {});
  const expressKey = dg.normalizeFilePath('/mock/src/routes/express.js');
  dg.graph.set(expressKey, {
    originalPath: 'src/routes/express.js',
    imports: [],
    exports: ['router'],
    importRecords: [],
    exportRecords: [],
    functionRecords: [],
    parseMode: 'ast',
    confidence: 'medium',
    package: null,
    frameworkHint: { framework: 'express', reason: 'routes-folder' },
  });
  const utilsKey = dg.normalizeFilePath('/mock/src/lib/utils.js');
  dg.graph.set(utilsKey, {
    originalPath: 'src/lib/utils.js',
    imports: [],
    exports: ['helper'],
    importRecords: [],
    exportRecords: [],
    functionRecords: [],
    parseMode: 'ast',
    confidence: 'medium',
    package: null,
  });
  dg.buildReverseGraph();
  dg.projectContext = {
    config: {
      ignore: {
        frameworks: ['express'],
      },
    },
  };
  assert.strictEqual(dg.shouldExcludeCli(expressKey), true, 'Expected express file to be excluded');
  assert.strictEqual(dg.shouldExcludeCli(utilsKey), false, 'Expected non-express file to not be excluded');
}

/* -------------------------------------------------------------------------- */
// Test 7: 配置来源报告细化
/* -------------------------------------------------------------------------- */
function testConfigOriginReport() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-origin-'));
  try {
    const configPath = path.join(tmpDir, '.workspace-bridge.json');
    fs.writeFileSync(configPath, JSON.stringify({ ignore: { paths: ['dist'] } }, null, 2), 'utf8');

    const result = runCliRaw(['--cwd', tmpDir, '--strict-cwd', '--json', 'audit-overview']);
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
  testIgnoreFrameworks,
  testConfigOriginReport,
  testIgnoreFindingsDynamicCache,
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
