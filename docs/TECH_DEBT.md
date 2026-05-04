# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。
> 最后审查：2026-05-05（本轮深度清零后更新）

---

## L1 Blocker（违反铁律，必须修）

> **2026-05-05 更新：L1 Blocker 全部清零。**

| # | 问题 | 修复方式 | 状态 |
|---|------|----------|------|
| B1 | 路径校验语义完全重复 | `resolveFilePath`/`validateWorkspacePath` 已在历史重构中消除 | ✅ |
| B2 | 并发窗口 symbolIndex 幽灵残留 | `file-index.js` `_removeCacheEntry()` 已统一清理四槽位 | ✅ |
| B3 | python.js 缺失 Record Schema | AST + regex 均返回完整 `exportRecords` + `functionRecords` | ✅ |
| B4 | 孤儿检测白名单硬编码重复 | 提取 `src/utils/orphan-detector.js` `findOrphanFiles` | ✅ |
| B5 | `runCommandSecure` / `spawn-ast.js` 截断未 kill 子进程 | 截断时 `child.kill('SIGTERM')` / `python.kill('SIGTERM')` | ✅ |
| B6 | `ensureReady()` shutdown 死锁边缘 | `shutdown()` 置 `initError`，`ensureReady()` 循环条件正确退出 | ✅ |
| B7 | `save()` 大项目 RangeError 风险 | `cache.js` `save()` 在 `RangeError` 时降级重试 | ✅ |

---

## L2 债务（技术债务，计划修）

> **2026-05-05 更新：L2 债务全部清零。** 以下为历史记录供追溯。

### 1. 裸数字归零 — ✅ 已清零

`constants.js` 已扩展 `TIMEOUTS` / `LIMITS` / `DEFAULTS` / `SCORING` / `HIGHLIGHT_SCORES` 五大常量对象。
`git-tools.js`、`health-tools.js`、`audit-diff-summary.js`、`file-index.js`、`container.js`、`cli.js`、`repl.js`、`project-map.js`、`overview-tools.js` 等全部替换完成。

### 2. 重复代码 — ✅ 已清零

| 位置 | 重复内容 | 提取目标 | 状态 |
|------|----------|----------|------|
| `function-impact.js` | 同文件 >70% 相似过滤链 | `findFunctionsOverlappingRanges` 纯函数 | ✅ |
| `java.js` + `python.js` | spawn 逻辑 95% 重复 | `spawnPythonASTParser` 纯函数（`spawn-ast.js`） | ✅ |
| `commands.js` | 5 个 getXCommands 重复前置检查 | `buildStackCommands` 基座 | ✅ |
| `dep-graph.js` | `getImpactRadius` + `findAffectedTests` BFS 结构高度相似 | 通用 `bfsTraverse` 工具函数 | ✅ |
| `js.js` + `shared.js` | walker 核心逻辑重复 | `js.js` 已提取 `walkAST`，`shared.js` 无 walker | ✅ |

### 3. Record Schema 不一致 — ✅ 已清零

| Parser | 缺失字段 | 状态 |
|--------|----------|------|
| `python.js` AST | `exportRecords`, `functionRecords` | ✅ |
| `python.js` regex | `exportRecords`, `functionRecords` | ✅ |
| `java.js` AST | `functionRecords` | ✅ |
| `java.js` regex | `functionRecords` | ✅ |
| `polyglot.js` (Kotlin/Go/Rust) | `functionRecords` | ✅ |

### 4. Parser 功能盲区 — ✅ 已清零

| 位置 | 盲区 | 状态 |
|------|------|------|
| `js.js` regex fallback | 完全丢失 `module.exports = {...}` 和 `exports.foo = ...` | ✅ 本轮修复 |
| `polyglot.js` parseGo | `blockImport` 正则用 `/m` 缺 `/g` | ✅ |
| `polyglot.js` parseRust | `useRegex` 无法匹配 `use std::io::{self, Read};` | ✅ |
| `polyglot.js` parseRust | 缺失 `pub enum`、`pub trait`、`pub type`、`pub mod`、`pub const`、`pub static`、`pub use` | ✅ |
| `polyglot.js` parseKotlin | `funRegex` 未排除 private/internal/protected | ✅ |
| `python.js` regex | 不支持多行 import / 行续符 | ✅ |
| `scripts/python_ast_parser.py` | `ast.walk()` 将嵌套函数当模块级导出 | ✅ 已改用 `tree.body` |

### 5. 其他 — ✅ 已清零

| 位置 | 问题 | 状态 |
|------|------|------|
| `resolvers.js` | 硬编码扩展名 10+ 个 | ✅ 已提取常量 |
| `resolvers.js` | `src/main/java` 等目录名硬编码重复 4 次 | ✅ 已提取常量 |
| `resolvers.js` | `_javaSourceRootsCache` / `_goModCache` 用 `let` 从未重新赋值 | ✅ 已改 `const` |
| `file-index.js` | `DEFAULT_EXCLUDE_DIRS` 仍含项目特定目录 `'gitnexus-extract'` | ✅ 已移除 |
| `file-index.js` | `getFilePatterns()` 未覆盖 `.mjs`/`.cjs`/`.mts`/`.cts` | ✅ 已加入 |
| `file-index.js` | `getFilePatterns()` fallback 无 `**/*.go` / `**/*.rs` | ✅ 已加入 |
| `file-index.js` | `startWatching()` 用 `process.cwd()` 而非 `this.root` | ✅ 实际已用 `this.root` |
| `file-index.js` | `handleFileChange()` 只比较 `mtimeMs` | ✅ 已改为 `mtimeMs || size` 双检 |
| `dep-graph.js` | `isKnownEntryFile()` 每次调用重建 15 个 RegExp | ✅ 已提升为模块级常量 |
| `dep-graph.js` | `findCircularDependencies()` 参数 `path` 遮蔽顶层 `path` | ✅ 参数已改为 `pathStack` |
| `function-impact.js` | `getFunctionReuseHints` 直接访问 `depGraph.graph` | ✅ 实际使用 `getFileInfo()` 封装接口 |
| `command.js` | `runCommand`（execSync 遗留）仍被导出，无调用方 | ✅ 已移除 |
| `sanitize.js` | 白名单过度严格，中文路径/文件名被完全抹除 | ✅ 已改用 Unicode 正则 |
| `audit-diff-summary.js` | `classifyChangeType` 扩展名硬编码数组分散风险 | ✅ 已提取 `DOCS_EXTENSIONS` / `CONFIG_EXTENSIONS` |
| `audit-diff-summary.js` | `compactChangedFile` 裁剪阈值裸数字 | ✅ 已用 `DEFAULTS.COMPACT_*` |
| `composite-risk.js` | 评分操作缺少 rationale 注释 | ✅ 已补全 |

---

## L3 品味问题（建议修，非债务）

以下问题属于代码风格/长度建议，不影响功能正确性，按价值排序记录：

| 位置 | 问题 | 说明 |
|------|------|------|
| `validation-advice.js` | `buildValidationAdvice` 274 行，承担 5 项独立子工作 | 拆为 5-6 个纯函数 |
| `project-context.js` | `inferFileRole()` ~95 行，大量硬编码 Set/regex | 提取为配置表 |
| `container.js` | `initialize()` ~85 行，6 个服务初始化 + 2 条回调 | 拆为私有方法 |
| `function-impact.js` | `getChangedFunctionImpact()` ~140 行 | 内聚性受损 |
| `symbol-impact.js` | `getSymbolImpact()` ~130 行 | 超 30 行阈值 |
| `git-tools.js` | `getChangedFiles()` 手动字符级解析 | 641 行文件中已知债务，当前不优先 |
| `overview-tools.js` | `renderOverviewDashboard` 中 HTML/CSS 裸数字 | `padding:14px`、`font-size:26px` 等 |
| `js.js` | `parseJavaScriptAST` ~265 行、`parseJavaScript` regex ~147 行 | 函数过长 |
| `path.js` | `hasPathSegment` 语义陷阱：只取 segment 最后一级 | 函数名与实际行为不符 |
| `project-context.js` | `shouldAnalyzeFile` 与 `shouldIndexFile` 命名易混淆 | 语义分别是 "active only" vs "not generated" |

---

## 文件级雷区地图

| 文件 | 行数 | 风险 | 状态 |
|------|------|------|------|
| `src/services/dep-graph.js` | ~760 | **高** | 核心引擎类，AGENTS.md 已确认"内聚优先、不物理拆分" |
| `src/tools/overview-tools.js` | ~749 | 中 | 裸数字已归零，已按功能域拆分 |
| `src/tools/git-tools.js` | ~640 | 中 | `getChangedFiles()` 手动字符级解析是已知债务 |
| `cli.js` | ~600 | 中 | 命令分发中心，分支短 |
| `src/cli/formatters/validation-advice.js` | ~274 | 中 | 单函数 274 行，承担 5 项子工作 |
| `src/utils/project-context.js` | ~300 | 低 | `inferFileRole()` ~95 行膨胀 |
| `src/utils/stack-detectors/detect.js` | ~396 | 低 | 已从 stack-detector.js 拆分 |
| `src/utils/stack-detectors/commands.js` | ~433 | 低 | 已从 stack-detector.js 拆分 |
| `src/services/file-index.js` | ~450 | 低 | 已从 ~523 行降下 |

---

## 测试覆盖缺口

> **2026-05-05 更新**：新增 `test/js-regex-cjs-test.js`，JS regex fallback 已有基础覆盖。

| Parser / 模块 | 测试文件 | 状态 |
|---------------|----------|------|
| JS AST + functionRecords | `test/arrow-function-test.js` | ✅ |
| Java AST + regex fallback | `test/java-parsers-test.js` | ✅ |
| JS regex fallback (CJS exports) | `test/js-regex-cjs-test.js` | ✅ 新增 |
| Python (AST/regex) | 无专项测试 | ❌ 建议写 `parser-schema-contract-test.js` |
| Kotlin / Go / Rust (polyglot) | 无专项测试 | ❌ 建议写 `parser-schema-contract-test.js` |

---

*注：本文档只记录当前活跃债务。已清零历史见 [CHANGELOG.md](../CHANGELOG.md) [Unreleased] §重构。*
