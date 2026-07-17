// @contract
// Locks the parameter contract: audit-file 的 affected-tests 遍历深度只由 --max-depth
// 控制；--depth 仅用于 --format ai 输出深度与文本截断，不得静默改变分析结果（L1-4）。
const assert = require('assert');
const path = require('path');
const { assembleFile } = require('../src/tools/audit-assembler');
const { DEFAULTS } = require('../src/config/defaults');

const TEST_FILE = 'src/tools/audit-assembler.js';

function makeMockContainer(workspaceRoot, captured) {
  return {
    workspaceRoot,
    ensureReady: async () => {},
    snapshot: {
      graph: {
        getImpactRadius: () => [{ file: path.join(workspaceRoot, 'a.js'), level: 1 }],
        getSymbolImpact: () => ({ mode: 'file-fallback', impactedFiles: [] }),
        findAffectedHttpRoutes: () => [],
        findAffectedTests: (filePath, maxDepth) => {
          captured.maxDepth = maxDepth;
          return [{ file: path.join(workspaceRoot, 't1.js'), distance: 1 }];
        },
        _displayPath: (p) => p,
        getFrameworkHint: () => null,
      },
    },
    cache: { coChanges: null },
    gitEnvironment: { dataQuality: 'certain' },
  };
}

async function capturedDepthFor(parsed) {
  const workspaceRoot = process.cwd();
  const captured = {};
  const result = await assembleFile({ file: TEST_FILE, cwd: workspaceRoot, ...parsed }, makeMockContainer(workspaceRoot, captured));
  assert.strictEqual(result.ok, true);
  return captured.maxDepth;
}

async function testDepthSurfaceDoesNotShrinkTraversal() {
  const depth = await capturedDepthFor({ depth: 'surface' });
  assert.notStrictEqual(depth, 1, '--depth surface must not shrink affected-tests traversal to 1 hop');
  assert.strictEqual(depth, DEFAULTS.AFFECTED_TEST_DEPTH, '--depth surface should leave traversal at the default depth');
}

async function testDepthDetailDoesNotChangeTraversal() {
  const depth = await capturedDepthFor({ depth: 'detail' });
  assert.strictEqual(depth, DEFAULTS.AFFECTED_TEST_DEPTH, '--depth detail must not change affected-tests traversal depth');
}

async function testDefaultTraversalDepth() {
  const depth = await capturedDepthFor({});
  assert.strictEqual(depth, DEFAULTS.AFFECTED_TEST_DEPTH, 'default traversal depth should match the standalone affected-tests command');
}

async function testMaxDepthExplicitlyControlsTraversal() {
  const depth = await capturedDepthFor({ maxDepth: 2, depth: 'surface' });
  assert.strictEqual(depth, 2, '--max-depth should control traversal even when --depth is present');
}

async function main() {
  await testDepthSurfaceDoesNotShrinkTraversal();
  await testDepthDetailDoesNotChangeTraversal();
  await testDefaultTraversalDepth();
  await testMaxDepthExplicitlyControlsTraversal();
  console.log('audit-file-depth-decoupling-test: all passed');
}

main();
