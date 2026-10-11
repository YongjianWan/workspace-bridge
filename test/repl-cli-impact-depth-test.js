#!/usr/bin/env node
// @fast
// @semantic
/**
 * S6：REPL 的 impact 与 CLI 的 impact 默认输出必须一致。
 * 同一命令名在两个入口有不同默认深度是静默漂移：REPL 曾取 WATCH_IMPACT_DEPTH(3)、
 * CLI 取 AFFECTED_TEST_DEPTH(5)。本测试在 6 文件链式夹具上对照两边的默认输出，
 * 并锚定口径 v1 的默认深度 5（ROADMAP 5.2，以 node cli.js impact 为准）。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliRaw, makeTempDir, cleanupTempDir, createMockDepGraph } = require('./test-helpers');
const { dependencyGraph } = require('../src/tools/dep-tools');
const { executeCommand } = require('../src/cli/repl');
const { ServiceContainer } = require('../src/services/container');
const { DEFAULTS } = require('../src/config/defaults');

const shape = (list) => list.map((e) => `${path.basename(e.file)}@${e.level}`).sort();

function cliImpact(root) {
  const result = runCliRaw(['impact', '--cwd', root, '--file', 'f.js', '--json', '--quiet']);
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).impact;
}

async function replImpact(container) {
  const out = await executeCommand(container, 'impact f.js', { structured: true });
  assert(out && Array.isArray(out.impact), `REPL impact 应返回结构化列表，得到：${JSON.stringify(out)}`);
  return out.impact;
}

async function main() {
  const root = makeTempDir('wb-repl-cli-depth-');
  const container = new ServiceContainer();
  try {
    // 链：a 引用 b 引用 c 引用 d 引用 e 引用 f；f 另引用 g。impact f.js 应沿引用者方向列出 e..a，
    // 另含 f 自己引用的 g（默认方向 all 的 dependencies 侧，T1.3 翻默认后）。
    fs.writeFileSync(path.join(root, 'f.js'), "require('./e');\nrequire('./g');\n");
    fs.writeFileSync(path.join(root, 'g.js'), 'module.exports = 2;\n');
    for (const [name, req] of [['e.js', 'f'], ['d.js', 'e'], ['c.js', 'd'], ['b.js', 'c'], ['a.js', 'b']]) {
      fs.writeFileSync(path.join(root, name), `require('./${req}');\n`);
    }
    await container.initialize(root, 30000, { watch: false });

    const viaCli = cliImpact(root);
    const viaRepl = await replImpact(container);

    assert.deepStrictEqual(
      shape(viaRepl),
      shape(viaCli),
      `REPL 与 CLI 的 impact 默认输出必须一致：repl=${JSON.stringify(shape(viaRepl))} cli=${JSON.stringify(shape(viaCli))}`
    );
    assert.deepStrictEqual(
      shape(viaCli),
      ['a.js@5', 'b.js@4', 'c.js@3', 'd.js@2', 'e.js@1', 'g.js@1'],
      '默认深度应为 5、默认方向 all：链上 5 个引用者全部列出且 level 为 1..5，f 引用的 g 在列'
    );
    assert.strictEqual(DEFAULTS.AFFECTED_TEST_DEPTH, 5, '口径 v1 锚点：impact 默认深度 5（ROADMAP 5.2）');
    assert.strictEqual(DEFAULTS.IMPACT_DEFAULT_DIRECTION, 'all', 'T1.3：impact 默认方向 all（ROADMAP T1.2 行流程，扩展已设默认）');
  } finally {
    await container.shutdown();
    cleanupTempDir(root);
  }
}

async function testTruncationParity() {
  const input = '/repo/input.js';
  const deps = Array.from({ length: DEFAULTS.IMPACT_RELEVANCE_LIMIT + 5 }, (_, i) => `/repo/f${i}.js`);
  const schema = { [input]: { imports: deps, importRecords: deps.map((resolved) => ({ resolved, imported: [] })) } };
  for (const file of deps) schema[file] = { imports: [] };
  const graph = createMockDepGraph({ root: '/repo', schema });
  const container = { workspaceRoot: '/repo', snapshot: { graph }, ensureReady: async () => {} };
  for (const limit of [undefined, 3, deps.length]) {
    const cli = await dependencyGraph({ operation: 'impact', file: 'input.js', maxDepth: DEFAULTS.AFFECTED_TEST_DEPTH, maxFiles: limit }, container);
    const command = `impact input.js${limit == null ? '' : ` --max-files ${limit}`}`;
    const repl = await executeCommand(container, command, { structured: true });
    assert.deepStrictEqual(repl.impact, cli.impact, 'REPL must preserve the same ordered prefix as CLI');
    assert.strictEqual(repl.impactCount, deps.length, 'count must include rows omitted by truncation');
    assert.strictEqual(repl.truncated, cli.truncated, 'REPL must expose truncation');
    const text = await executeCommand(container, command);
    assert(text.includes(`impactCount: ${deps.length}`), 'text count must describe the full result');
    assert.strictEqual(text.split('\n').filter((line) => line.startsWith('  level-')).length, cli.impact.length, 'text output must use the same bound');
    if (cli.truncated) assert(text.includes(`${deps.length - cli.impact.length} more`), 'text must expose omitted rows');
  }
  for (const limit of ['0', '-1', 'invalid']) {
    const result = await executeCommand(container, `impact input.js --max-files ${limit}`, { structured: true });
    assert.strictEqual(result.ok, false, 'invalid bounds must fail explicitly');
    assert.strictEqual(result.errorType, 'validation_error');
  }
}

main().then(testTruncationParity).then(() => {
  console.log('repl-cli-impact-depth-test.js: all passed');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
