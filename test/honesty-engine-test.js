/**
 * Honesty engine tests — false-positive classification for dead exports and unresolved imports.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  classifyUnresolved,
  classifyDeadExports,
  buildClassificationSummary,
  buildDisclaimer,
  isAliasImport,
} = require('../src/tools/honesty-engine');
const { SCAFFOLD_FINGERPRINTS } = require('../src/tools/scaffold-detector');

// ── Helpers ───────────────────────────────────────────────────────────────

function makeTempDir() {
  const tmp = path.join(__dirname, `honesty-test-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function mockDepGraph(stats) {
  return {
    getStats: () => stats || { files: 100, totalImports: 500 },
  };
}

// ── classifyUnresolved ────────────────────────────────────────────────────

function testClassifyUnresolved_aliasWithoutTsconfig() {
  const root = makeTempDir();
  try {
    const unresolved = [
      { file: '/a.js', import: '@/components/Foo', resolvedTo: '/components/Foo' },
      { file: '/b.js', import: '~/utils/bar', resolvedTo: '/utils/bar' },
    ];
    const classifications = classifyUnresolved(unresolved, root);
    assert.strictEqual(classifications.length, 2);
    assert.strictEqual(classifications[0].reason, 'alias-unresolved');
    assert.strictEqual(classifications[1].reason, 'alias-unresolved');
  } finally {
    cleanup(root);
  }
}

function testClassifyUnresolved_aliasWithTsconfigPaths() {
  const root = makeTempDir();
  try {
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } })
    );
    const unresolved = [
      { file: '/a.js', import: '@/components/Foo', resolvedTo: '/components/Foo' },
    ];
    const classifications = classifyUnresolved(unresolved, root);
    // With tsconfig paths present, @/ is not automatically blamed
    assert.ok(classifications[0].reason !== 'alias-unresolved', 'should not blame alias when tsconfig paths exist');
  } finally {
    cleanup(root);
  }
}

function testClassifyUnresolved_missingExtension() {
  const root = makeTempDir();
  try {
    const dirPath = path.join(root, 'components');
    fs.mkdirSync(dirPath, { recursive: true });
    const unresolved = [
      { file: '/a.js', import: './components', resolvedTo: dirPath },
    ];
    const classifications = classifyUnresolved(unresolved, root);
    assert.strictEqual(classifications[0].reason, 'missing-extension');
  } finally {
    cleanup(root);
  }
}

// ── classifyDeadExports ───────────────────────────────────────────────────

function testClassifyDeadExports_likelyDead() {
  const depGraph = mockDepGraph({ files: 100, totalImports: 500 });
  const deadExports = [
    { file: '/src/utils/helper.js', exports: ['foo'], confidence: 'high', importerCount: 0 },
  ];
  const classifications = classifyDeadExports(deadExports, depGraph);
  assert.strictEqual(classifications[0].reason, 'likely-dead');
}

function testClassifyDeadExports_graphUnreliable() {
  const depGraph = mockDepGraph({ files: 10, totalImports: 0 });
  const deadExports = [
    { file: '/src/utils/helper.js', exports: ['foo'], confidence: 'high', importerCount: 0 },
  ];
  const classifications = classifyDeadExports(deadExports, depGraph);
  assert.strictEqual(classifications[0].reason, 'graph-unreliable');
}

function testClassifyDeadExports_frameworkImplicit() {
  const depGraph = mockDepGraph({ files: 100, totalImports: 500 });
  const deadExports = [
    { file: '/project/src/views/Home.vue', exports: ['default'], confidence: 'medium', importerCount: 0 },
    { file: '/project/src/components/Icon.vue', exports: ['default'], confidence: 'medium', importerCount: 0 },
  ];
  const classifications = classifyDeadExports(deadExports, depGraph);
  assert.strictEqual(classifications[0].reason, 'vue-page-implicit');
  assert.strictEqual(classifications[1].reason, 'vue-component-implicit');
}

function testClassifyDeadExports_uncertain() {
  const depGraph = mockDepGraph({ files: 100, totalImports: 500 });
  const deadExports = [
    { file: '/src/utils/helper.js', exports: ['foo'], confidence: 'medium', importerCount: 3 },
  ];
  const classifications = classifyDeadExports(deadExports, depGraph);
  assert.strictEqual(classifications[0].reason, 'uncertain');
}

function testClassifyDeadExports_scaffoldRuoYi() {
  const depGraph = mockDepGraph({ files: 100, totalImports: 500 });
  const deadExports = [
    // exactBasename match
    { file: '/project/AbstractQuartzJob.java', exports: ['foo'], confidence: 'medium', importerCount: 3 },
    { file: '/project/SysUser.java', exports: ['foo'], confidence: 'medium', importerCount: 3 },
    // pathPattern match: StrFormatter under ruoyi path (basename does NOT hit constants-warehouse)
    { file: '/project/com/ruoyi/common/utils/StrFormatter.java', exports: ['foo'], confidence: 'medium', importerCount: 3 },
  ];
  const classifications = classifyDeadExports(deadExports, depGraph);
  assert.strictEqual(classifications[0].reason, 'scaffold-ruoyi');
  assert.strictEqual(classifications[1].reason, 'scaffold-ruoyi');
  assert.strictEqual(classifications[2].reason, 'scaffold-ruoyi');
}

function testClassifyDeadExports_scaffoldVueAdmin() {
  const depGraph = mockDepGraph({ files: 100, totalImports: 500 });
  const deadExports = [
    // exactBasename match
    { file: '/project/src/ruoyi.js', exports: ['foo'], confidence: 'medium', importerCount: 3 },
    { file: '/project/src/validate.js', exports: ['foo'], confidence: 'medium', importerCount: 3 },
  ];
  const classifications = classifyDeadExports(deadExports, depGraph);
  assert.strictEqual(classifications[0].reason, 'scaffold-vue-admin');
  assert.strictEqual(classifications[1].reason, 'scaffold-vue-admin');
}

function testClassifyDeadExports_scaffoldNotMatched() {
  const depGraph = mockDepGraph({ files: 100, totalImports: 500 });
  const deadExports = [
    // UserService outside ruoyi path — generic business code, not scaffold
    { file: '/project/src/utils/UserService.java', exports: ['foo'], confidence: 'medium', importerCount: 3 },
    // Generic Vue page — not scaffold, not framework-implicit
    { file: '/project/src/pages/Home.vue', exports: ['default'], confidence: 'medium', importerCount: 0 },
  ];
  const classifications = classifyDeadExports(deadExports, depGraph);
  assert.strictEqual(classifications[0].reason, 'uncertain');
  assert.strictEqual(classifications[1].reason, 'likely-dead');
}

function testBuildClassificationSummary_scaffoldCountedAsFalsePositive() {
  const classifications = [
    { item: {}, reason: 'scaffold-ruoyi' },
    { item: {}, reason: 'scaffold-ruoyi' },
    { item: {}, reason: 'uncertain' },
  ];
  const summary = buildClassificationSummary(classifications);
  assert.strictEqual(summary.total, 3);
  assert.strictEqual(summary.falsePositiveCount, 2);
  assert.strictEqual(summary.primaryReason, 'scaffold-ruoyi');
}

// ── buildClassificationSummary ────────────────────────────────────────────

function testBuildClassificationSummary() {
  const classifications = [
    { item: {}, reason: 'alias-unresolved' },
    { item: {}, reason: 'alias-unresolved' },
    { item: {}, reason: 'missing-extension' },
  ];
  const summary = buildClassificationSummary(classifications);
  assert.strictEqual(summary.total, 3);
  assert.strictEqual(summary.falsePositiveCount, 3);
  assert.strictEqual(summary.primaryReason, 'alias-unresolved');
  assert.strictEqual(summary.reasons.length, 2);
}

// ── buildDisclaimer ───────────────────────────────────────────────────────

function testBuildDisclaimer_highRatio() {
  const summary = { total: 24, falsePositiveCount: 23, primaryReason: 'alias-unresolved', reasons: [] };
  const text = buildDisclaimer('unresolved imports', summary);
  assert.ok(text.includes('23 of 24'));
  assert.ok(text.includes('alias-unresolved'));
}

function testBuildDisclaimer_none() {
  const summary = { total: 5, falsePositiveCount: 0, primaryReason: 'unknown', reasons: [] };
  const text = buildDisclaimer('dead exports', summary);
  assert.ok(text.includes('all appear genuine'));
}

// ── isAliasImport ─────────────────────────────────────────────────────────

function testIsAliasImport() {
  assert.strictEqual(isAliasImport('@/foo'), true);
  assert.strictEqual(isAliasImport('~/bar'), true);
  assert.strictEqual(isAliasImport('./baz'), false);
  assert.strictEqual(isAliasImport('lodash'), false);
}

// ── Runner ────────────────────────────────────────────────────────────────

const tests = [
  testClassifyUnresolved_aliasWithoutTsconfig,
  testClassifyUnresolved_aliasWithTsconfigPaths,
  testClassifyUnresolved_missingExtension,
  testClassifyDeadExports_likelyDead,
  testClassifyDeadExports_graphUnreliable,
  testClassifyDeadExports_frameworkImplicit,
  testClassifyDeadExports_uncertain,
  testClassifyDeadExports_scaffoldRuoYi,
  testClassifyDeadExports_scaffoldVueAdmin,
  testClassifyDeadExports_scaffoldNotMatched,
  testBuildClassificationSummary_scaffoldCountedAsFalsePositive,
  testBuildClassificationSummary,
  testBuildDisclaimer_highRatio,
  testBuildDisclaimer_none,
  testIsAliasImport,
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    test();
    console.log(`→ ${test.name} ... PASS`);
    passed++;
  } catch (e) {
    console.error(`→ ${test.name} ... FAIL`);
    console.error(`  ${e.message}`);
    failed++;
  }
}

console.log(`\nRan ${tests.length} tests`);
console.log(`${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
