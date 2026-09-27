// @semantic
// 回归：workspace 包内通过包名自引用（zod 形态 —— pnpm workspace symlink +
// package.json exports 带源码条件、构建产物缺席）必须解析到 src/ 源文件，
// 否则测试→源码的边缺失，affected-tests 召回崩（eval zod 真值 0.15）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { resolveImport, clearResolverCaches } = require('../src/services/dep-graph/resolvers');

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

const root = makeTempDir('wb-workspace-exports-');
try {
  // 构建产物（./index.js、./v4/index.js）刻意不落盘：fresh clone 没跑 pnpm build。
  write(root, 'packages/zod/src/index.ts', 'export * from "./v4/index.js";');
  write(root, 'packages/zod/src/v4/index.ts', 'export * from "./classic/index.js";');
  write(root, 'packages/zod/src/v4/classic/index.ts', 'export * from "./checks.js";');
  write(root, 'packages/zod/src/v4/classic/checks.ts', 'export const checks = 1;');
  write(root, 'packages/zod/src/v4/locales/en.ts', 'export {}');
  write(root, 'packages/zod/package.json', JSON.stringify({
    name: 'zod',
    module: './index.js',
    exports: {
      '.': { '@zod/source': './src/index.ts', import: './index.js', require: './index.cjs' },
      './v4': { '@zod/source': './src/v4/index.ts', types: './v4/index.d.cts', import: './v4/index.js' },
      './v4/locales/*': { '@zod/source': './src/v4/locales/*' },
      './blocked': null,
    },
  }));
  const importingFile = write(root, 'packages/zod/src/v4/classic/tests/base.test.ts', 'import * as z from "zod/v4";');
  write(root, 'package.json', JSON.stringify({ private: true, workspaces: ['packages/*'] }));

  const v4Entry = path.join(root, 'packages/zod/src/v4/index.ts');
  const rootEntry = path.join(root, 'packages/zod/src/index.ts');
  const locale = path.join(root, 'packages/zod/src/v4/locales/en.ts');

  // 1. 子路径走 exports 的源码条件，而不是缺席的构建产物
  assert.strictEqual(resolveImport(importingFile, 'zod/v4', '.ts', root), v4Entry);
  // 2. 裸包名走 exports "."
  assert.strictEqual(resolveImport(importingFile, 'zod', '.ts', root), rootEntry);
  // 3. exports 通配模式 + 无扩展名目标 → 源码扩展探测
  assert.strictEqual(resolveImport(importingFile, 'zod/v4/locales/en', '.ts', root), locale);
  // 4. 构建产物已存在时仍优先源码（静态分析要的是开发者改的文件）
  write(root, 'packages/zod/v4/index.js', 'export * from "./src/v4/index.js";');
  clearResolverCaches();
  assert.strictEqual(resolveImport(importingFile, 'zod/v4', '.ts', root), v4Entry);
  // 5. exports 显式 null 的子路径：无候选、legacy 无命中 → null
  assert.strictEqual(resolveImport(importingFile, 'zod/blocked', '.ts', root), null);
  // 6. 非 workspace 包名照旧不解析
  assert.strictEqual(resolveImport(importingFile, 'not-zod', '.ts', root), null);

  console.log('workspace-package-exports-test: PASS');
} finally {
  cleanupTempDir(root);
}
