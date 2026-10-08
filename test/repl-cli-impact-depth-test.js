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
const { runCliRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');
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
    // 链：a 引用 b 引用 c 引用 d 引用 e 引用 f。impact f.js 应沿引用者方向列出 e..a，共 5 个。
    fs.writeFileSync(path.join(root, 'f.js'), 'module.exports = 1;\n');
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
      ['a.js@5', 'b.js@4', 'c.js@3', 'd.js@2', 'e.js@1'],
      '默认深度应为 5：链上 5 个引用者全部列出且 level 为 1..5'
    );
    assert.strictEqual(DEFAULTS.AFFECTED_TEST_DEPTH, 5, '口径 v1 锚点：impact 默认深度 5（ROADMAP 5.2）');
  } finally {
    await container.shutdown();
    cleanupTempDir(root);
  }
}

main().then(() => {
  console.log('repl-cli-impact-depth-test.js: all passed');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
