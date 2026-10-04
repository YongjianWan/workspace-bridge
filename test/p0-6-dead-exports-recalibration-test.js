// @semantic
// P0-6（外部审查）：dead-exports 的 5 类“工具链消费、静态分析不可见”形态
// 不得给出 confidence high；普通文件里的真死导出必须维持 high（防“全部降档”的假修复）。
//
// 五条规则（判定语义固定，不扩不缩）：
//   1. config-file     — 发现文件 basename 是 *.config.{js,jsx,ts,tsx,mjs,cjs,mts,cts}
//                        → 整条降档（配置导出由同名工具按约定读取，不走 import 图）
//   2. engine-entry    — libFuzzer 引擎入口契约符号（LLVMFuzzerTestOneInput 等）
//                        → 不进死导出报告（运行期由引擎按名调用，约定存活）
//   3. C 配对公开头    — .c/.cc/.cpp/.cxx 且图内存在同 stem 的 .h/.hpp
//                        → 整条降档（API 在配套公开头里声明，消费方在工作区之外）
//   4. auto-import dirs— 图内配置文件实际声明的 dirs 字符串数组覆盖的目录
//                        → 整条降档（构建工具自动注入，源码里无 import 语句）
//   5. glob-loaded     — 图内文件的 import.meta.glob 字面量模式匹配到的发现文件
//                        → 整条降档（运行期动态装载，静态 import 图不可见）
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const FIXTURE = [
  ['package.json', '{"name":"wb-p06-fixture","version":"1.0.0","private":true}\n'],
  // 规则4证据：配置里实际声明的 dirs（unplugin-auto-import 形态，vitesse 同构）
  ['vite.config.ts', [
    "import AutoImport from 'unplugin-auto-import/vite'",
    '',
    'export default AutoImport({',
    "  dirs: ['src/composables', 'src/stores'],",
    '})',
    '',
  ].join('\n')],
  // 规则1：同名工具按文件名约定读取的配置导出
  ['cypress.config.ts', 'export default { e2e: {} }\n'],
  ['uno.config.ts', 'export default { theme: {} }\n'],
  // 规则5证据：src/main.ts 的 import.meta.glob 字面量（vitesse src/main.ts 同形）
  ['src/main.ts', [
    "import { createApp } from './app'",
    "import { router } from './router'",
    '',
    "const modules = import.meta.glob<{ install: unknown }>('./modules/*.ts', { eager: true })",
    'void modules',
    '',
  ].join('\n')],
  ['src/app.ts', [
    "import { router } from './router'",
    '',
    'export function createApp() {',
    '  return router',
    '}',
    '',
  ].join('\n')],
  ['src/router.ts', 'export const router = { path: "/" }\n'],
  ['src/modules/nprogress.ts', 'export function install() {}\n'],
  ['src/composables/dark.ts', [
    'export const isDark = { value: false }',
    'export function toggleDark() {',
    '  isDark.value = !isDark.value',
    '}',
    '',
  ].join('\n')],
  ['src/stores/user.ts', 'export function useUserStore() {\n  return {}\n}\n'],
  // 回归守卫：普通目录里的真死导出必须仍是 high
  ['lib/utils.ts', 'export function orphanHelper() {\n  return 42\n}\n'],
  // 规则2：libFuzzer 引擎入口契约（运行期由引擎按名调用）
  ['fuzz/target.c', [
    '#include <stddef.h>',
    '',
    'int LLVMFuzzerTestOneInput(const unsigned char *data, size_t size) {',
    '  (void)data;',
    '  (void)size;',
    '  return 0;',
    '}',
    '',
  ].join('\n')],
  // 规则3：.c 与配对公开头同 stem，且两个文件都必须在图里
  ['native/pair.c', '#include "pair.h"\n\nint pair_sum(int a, int b) { return a + b; }\n'],
  ['native/pair.h', 'int pair_sum(int a, int b);\n'],
];

function writeFixture(root) {
  for (const [rel, body] of FIXTURE) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

async function runAssertions(root) {
  const container = new ServiceContainer({ quiet: true, cacheDir: path.join(root, '.cache') });
  await container.initialize(root, 60000, { watch: false });
  try {
    const dg = container._depGraph;
    const dead = dg.findDeadExports({ skipCache: true, raw: true });
    const posix = (p) => String(p).replace(/\\/g, '/');
    const find = (suffix) => dead.find((d) => posix(d.file).endsWith(suffix));

    // 规则1 config-file：降档但保留发现（透明度原则）
    for (const name of ['cypress.config.ts', 'uno.config.ts']) {
      const item = find(name);
      assert.ok(item, `${name} 应保留在死导出报告里（降档不删除）`);
      assert.strictEqual(item.confidence, 'low', `${name} 的配置导出不得是 high`);
      assert.strictEqual(item.confidenceValue, 0.5, `${name} confidenceValue 应为 LOW_VALUE`);
      assert.strictEqual(item.confidenceSource, 'config-file-convention', `${name} confidenceSource`);
      assert.strictEqual(item.falsePositiveReason, 'config-file-convention', `${name} falsePositiveReason`);
      assert.ok(item.confidenceReason, `${name} confidenceReason 必须解释静态分析为何看不见`);
    }

    // 规则2 engine-entry：契约符号不进报告
    assert.ok(
      dead.every((d) => !(d.exports || []).includes('LLVMFuzzerTestOneInput')),
      'LLVMFuzzerTestOneInput 不得出现在任何死导出发现里'
    );
    assert.ok(!find('fuzz/target.c'), 'target.c 仅导出引擎入口符号 → 整条不得进报告');

    // 规则3 C 配对公开头
    assert.ok(
      dg.graph.has(dg.normalizeFilePath(path.join(root, 'native', 'pair.h'))),
      '配对公开头必须在图内（规则3前提）'
    );
    const cItem = find('native/pair.c');
    assert.ok(cItem, 'C 发现应保留（降档不删除）');
    assert.strictEqual(cItem.confidence, 'low', '配对公开头的 .c 发现不得是 high');
    assert.strictEqual(cItem.confidenceValue, 0.5);
    assert.strictEqual(cItem.confidenceSource, 'c-paired-header');
    assert.strictEqual(cItem.falsePositiveReason, 'c-paired-header');

    // 规则4 auto-import dirs：只认配置里实际声明的 dirs
    for (const suffix of ['src/stores/user.ts', 'src/composables/dark.ts']) {
      const item = find(suffix);
      assert.ok(item, `${suffix} 应保留在报告里`);
      assert.strictEqual(item.confidence, 'low', `${suffix} 被声明的 auto-import 目录覆盖，不得是 high`);
      assert.strictEqual(item.confidenceValue, 0.5);
      assert.strictEqual(item.confidenceSource, 'auto-import-dirs');
      assert.strictEqual(item.falsePositiveReason, 'auto-import-dirs');
    }

    // 规则5 glob-loaded
    const globItem = find('src/modules/nprogress.ts');
    assert.ok(!globItem, 'glob 装载的模块有真实依赖边，不应报告为死导出');

    // 回归守卫：未命中任何规则的普通真死导出必须仍是 high
    const plain = find('lib/utils.ts');
    assert.ok(plain, '普通目录的真死导出必须仍被报告');
    assert.strictEqual(plain.confidence, 'high', '普通死导出不得被连坐降档（假修复防护）');
    assert.strictEqual(plain.confidenceSource, 'ast-no-importer');
    assert.ok(!plain.falsePositiveReason, '普通死导出不得被标 falsePositiveReason');
  } finally {
    await container.shutdown();
  }
}

async function main() {
  const root = makeTempDir('wb-p06-recal-');
  try {
    writeFixture(root);
    await runAssertions(root);
    console.log('p0-6-dead-exports-recalibration-test: all passed');
  } finally {
    cleanupTempDir(root);
  }
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
