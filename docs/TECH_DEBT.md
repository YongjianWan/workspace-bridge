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
| Python (AST/regex) | `test/parser-schema-contract-test.js` | ✅ |
| Kotlin / Go / Rust (polyglot) | `test/parser-schema-contract-test.js` | ✅ |

---

*注：本文档只记录当前活跃债务。已清零历史见 [CHANGELOG.md](../CHANGELOG.md) [Unreleased] §重构。*

---

## 活跃缺陷

> **2026-05-05 更新：D1–D20 全部修复，详见 CHANGELOG.md [Unreleased] §修复。**
>
> 以下历史记录供追溯。

### 🔴 高（崩溃/数据丢失/资源泄漏）— 已修复

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| D1 | `file-index.js:333-345` | `fs.watch` watcher 未注册 `'error'` 事件处理器 | `watcher.on('error', ...)` |
| D2 | `parsers/spawn-ast.js:69-78` | `python.stdin` 无错误监听器，write/end 无 try-catch | `python.stdin.on('error', ...)` + try-catch |
| D3 | `cli/repl.js:271-335` | 只注册 `rl.on('SIGINT')`，未注册 `process.on('SIGINT')` | `process.on('SIGINT', handler)` + finally 移除 |
| D4 | `dep-graph.js:208-214` | `isKnownEntryFile()` 读整个文件无大小限制 | 读前 `fs.statSync`，超 64KB 跳过 |
| D5 | `dep-graph.js:399-438` | `updateFiles` async 无重入锁 | `_updating` 锁 + try-finally |
| D6 | `container.js:138-152` | `shutdown()` 后 `initError` 阻止重新初始化 | `initialize()` 开头清空 `initError` |

### 🟡 中（边界条件/误报/竞态/性能）— 已修复

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| D7 | `diagnostics-engine.js:275` | TypeScript 诊断漏了 `.tsx` | 扩展为 `['.ts','.tsx','.mts','.cts']` |
| D8 | `parsers/cpp.js:19` | `funcRe` 多项式回溯风险 | `MAX_LINE_LEN = 512`，超长匹配跳过 |
| D9 | `parsers/java.js:33` | `methodRegex` 同构回溯风险 | `MAX_LINE_LEN = 512`，超长匹配跳过 |
| D10 | `file-index.js:413-416` | `stopWatching` 无逐条 try-catch | 逐条 `try { watcher.close(); } catch (_) {}` |
| D11 | `dep-graph.js:545` | `getStats()` 每次调用都触发 O(V·E) DFS | `_cycleCount` 延迟计算，graph 变更时重置 |
| D12 | `file-index.js:262-272` | `pruneDeletedCacheEntries` 同步遍历 | 异步批量检查（batchSize=100）+ `setImmediate` yield |
| D13 | `cache.js:155-170` | `save()` 只捕获 `RangeError` | 捕获所有序列化错误，两次降级后返回 false |
| D14 | `parsers/js.js:524-532` | `moduleExportsRegex` 不支持嵌套对象 | 注释文档化限制（regex 不处理嵌套对象） |

### 🟢 低（代码异味/防御性缺口）— 已修复

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| D15 | `search-tools.js:33-35,107-109` | 两个完全相同的 `escapeRegex` 函数 | 删除第二个，统一引用第一个 |
| D16 | `parsers/js.js:24-28,50-54` | `stripQuotedStrings` 对模板字面量 `${expr}` 内反引号清理不彻底 | 改用模板字符串安全的贪婪匹配 |
| D17 | `dep-graph.js:73-84` | `bfsTraverse` 每次节点执行 `[...path, node]` O(depth) 拷贝 | 当前 depth≤5 影响有限；保持现状 |
| D18 | `dep-graph.js:504-538` | `findCircularDependencies` 递归 DFS 无最大深度限制 | `MAX_CYCLE_DEPTH` 兜底 + try-finally 正确 pop |
| D19 | `file-index.js:351-367` | `processPending` 串行 `await handleFileChange` | 小并发（CONCURRENCY=5）+ `Promise.race` |
| D20 | `utils/path.js:22` | Windows 路径 `toLowerCase()` 在土耳其语 locale 下 `I→ı` 不匹配 | 改用 `toLocaleLowerCase('en-US')` |

---

## 测试覆盖缺口（详细版）

> **2026-05-05 更新：测试覆盖大幅补全，新增 10 个测试文件。**
> 64 个测试文件 vs 48 个 library 文件，核心模块零测试缺口已关闭。

### 已补齐的测试（本轮新增）

| 测试文件 | 覆盖模块 | 验证要点 |
|----------|----------|----------|
| `test/parse-args-test.js` | `utils/parse-args.js` | boolean flag、transform、未知参数抛出、位置参数、缺失值 |
| `test/diagnostics-parser-test.js` | `utils/diagnostics.js` | normalizeSeverity、ruff/pyright/eslint 输出解析、去重、汇总 |
| `test/test-detector-test.js` | `utils/test-detector.js` | isTestLikeFile 规则、heuristic signature、language family、stem 归一化 |
| `test/diagnostics-engine-test.js` | `services/diagnostics-engine.js` | scheduleCheck debounce、clearScheduledChecks、isSafePath、handleFileDeleted、并发限制重调度 |
| `test/container-lifecycle-test.js` | `services/container.js` | initialize 创建服务、shutdown 设置 initError、shutdown 后重新初始化、ensureReady 超时/正常通过 |
| `test/cache-corruption-test.js` | `services/cache.js` | 损坏 JSON 忽略、版本不匹配忽略、TTL 过期忽略、normalize 防御非数组输入、持久失败返回 false |
| `test/dep-graph-error-test.js` | `services/dep-graph.js` | updateFiles([])、删除文件清理、缺失文件容错、重入锁、getStats 懒计算 cycles |
| `test/path-utils-test.js` | `utils/path.js` | normalizePathKey 大小写、matchesPathFragment、isPathInsideRoot、resolveWorkspaceFilePath、Turkish locale 安全 |
| `test/cli-args-validation-test.js` | `cli.js` | 未知命令、--help、--version、缺失必填参数、--quiet 抑制信息输出 |
| `test/resolvers-test.js` | `services/dep-graph/resolvers.js` | JS/TS 相对路径、Python 相对路径、Java import、Go module、Rust crate、null importPath |

### 仍无直接测试的模块（低优先级）

| 文件 | 风险等级 | 说明 |
|------|---------|------|
| `utils/orphan-detector.js` | 🟡 中 | 被 overview-tools 和 project-map 间接覆盖 |
| `services/file-index/symbol-extractors.js` | 🟡 中 | 被 file-index 集成测试间接覆盖 |
| `services/dep-graph/function-similarity.js` | 🟢 低 | 边缘功能 |
| `services/dep-graph/parsers/shared.js` | 🟡 中 | 被 parser 测试间接覆盖 |
| `services/dep-graph/parsers/spawn-ast.js` | 🟡 中 | 被 java-parsers-test.js / go-ast-parser-test.js 间接覆盖 |
| `services/dep-graph/parsers/polyglot.js` | 🟡 中 | 被 parser-schema-contract-test.js 间接覆盖 |
| `cli/formatters/*.js` | 🟡 中 | 被 functionality-test.js / audit-diff-test.js 间接覆盖 |

### 有测试但可继续深化的模块

| 模块 | 测试文件 | 仍缺覆盖 |
|------|---------|----------|
| `file-index.js` | 间接测试 | watcher 完整链路、readdir 权限拒绝、AbortController 超时 |
| `watch.js` | `watch-test.js` | compact 模式真实输出、SIGINT/SIGTERM 异常隔离 |
| `repl.js` | `repl-test.js` | 真实容器初始化、热点 threshold 边界 |
| `cli.js` | `functionality-test.js` | mapper 异常、adapter 异常、所有 human 格式化分支 |

### Flaky 根因

| 测试文件 | 根因 | 建议修复 |
|----------|------|----------|
| `watch-test.js` | 固定 `delay(2500)` 假设 + fs.watch 平台时序差异 | 轮询检查预期输出，而非固定 delay；使用独立临时目录 |
| `functionality-test.js` | 修改 repo root 的 tracked 文件（README.md）+ 无原子恢复 | 用 `fs.copyFileSync` 在副本上操作 |
| `java-parsers-test.js` / `go-ast-parser-test.js` | 外部进程 `timeout: 5000` 冷启动可能超时 | 提升至 15000ms 或根据 `CI` 环境变量动态调整 |

