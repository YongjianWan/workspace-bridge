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

## 活跃缺陷（2026-05-05 深度扫描新增）

> 以下问题来自 6 维度并行子代理深度扫描，按严重性分级。修复后迁移至 CHANGELOG.md。

### 🔴 高（崩溃/数据丢失/资源泄漏）

| # | 位置 | 问题 | 根因 | 建议修复 |
|---|------|------|------|----------|
| D1 | `file-index.js:333-345` | `fs.watch` watcher 未注册 `'error'` 事件处理器 | 目录被删/权限变更时未处理异常直接抛为未处理异常，进程崩溃 | `watcher.on('error', (e) => { if (DEBUG) console.error(...); })` |
| D2 | `parsers/spawn-ast.js:69-78` | `python.stdin` 无错误监听器，write/end 无 try-catch | Python 子进程崩溃时 stdin EPIPE 未捕获 | `python.stdin.on('error', ...)` + write/end try-catch |
| D3 | `cli/repl.js:271-335` | 只注册 `rl.on('SIGINT')`，未注册 `process.on('SIGINT')` | 快速连按 Ctrl+C 跳过 finally 中 `container.shutdown()`，缓存未持久化 | 参照 `watch.js` 加 `process.on('SIGINT', shutdown)` |
| D4 | `dep-graph.js:208-214` | `isKnownEntryFile()` 读整个文件无大小限制 | 多 GB 日志/二进制文件误标为 `.py`/`.js` 时 OOM | 读前 `fs.statSync` 检查，超 64KB 跳过 |
| D5 | `dep-graph.js:399-438` | `updateFiles` async 无重入锁 | debounce 可能触发两个 `updateFiles` 交错执行，reverseGraph 残留幽灵边 | `DependencyGraph` 加 `_updating` 锁，排队处理 |
| D6 | `container.js:138-152` | `shutdown()` 后 `initError` 阻止重新初始化 | `ensureReady()` 在 `initialize()` 前拦截，容器无法重启 | `initialize()` 开头清空 `initError` |

### 🟡 中（边界条件/误报/竞态/性能）

| # | 位置 | 问题 | 根因 | 建议修复 |
|---|------|------|------|----------|
| D7 | `diagnostics-engine.js:275` | TypeScript 诊断漏了 `.tsx` | 只检查 `.endsWith('.ts')` | 扩展为 `['.ts','.tsx','.mts','.cts']` |
| D8 | `parsers/cpp.js:19` | `funcRe` 多项式回溯风险 | `(?:[\w:*&<>]+\s+)+` quantified quantifier | 限制单行长度或拆分 token 匹配 |
| D9 | `parsers/java.js:33` | `methodRegex` 同构回溯风险 | 与 cpp.js 同构正则 | 同上 |
| D10 | `file-index.js:413-416` | `stopWatching` 无逐条 try-catch | 单个 watcher 损坏时循环中断，后续泄漏 | `for (...) { try { watcher.close(); } catch (_) {} }` |
| D11 | `dep-graph.js:545` | `getStats()` 每次调用都触发 O(V·E) DFS | `findCircularDependencies()` 无缓存/memoization | 为 cycles 添加延迟计算或缓存 |
| D12 | `file-index.js:262-272` | `pruneDeletedCacheEntries` 同步遍历 | 成千上万缓存条目时阻塞事件循环 | 改为异步批量检查或移至后台 |
| D13 | `cache.js:155-170` | `save()` 只捕获 `RangeError`，其他错误直接 re-throw | `JSON.stringify` 循环引用/BigInt 导致 shutdown 失败 | 改为两次降级尝试，两次都失败才返回 false |
| D14 | `parsers/js.js:524-532` | `moduleExportsRegex` `[^}]*` 不支持嵌套对象 | `module.exports = { foo: { bar: 1 } }` 误判 | 文档化限制，或改用栈计数 |

### 🟢 低（代码异味/防御性缺口）

| # | 位置 | 问题 | 建议修复 |
|---|------|------|----------|
| D15 | `search-tools.js:33-35,107-109` | 两个完全相同的 `escapeRegex` 函数 | 删除第二个，统一引用第一个 |
| D16 | `parsers/js.js:24-28,50-54` | `stripQuotedStrings` 对模板字面量 `${expr}` 内反引号清理不彻底 | 文档化限制，或改用保守整行丢弃 |
| D17 | `dep-graph.js:73-84` | `bfsTraverse` 每次节点执行 `[...path, node]` O(depth) 拷贝 | 当前 depth≤5 影响有限；未来支持大深度时改用链表 |
| D18 | `dep-graph.js:504-538` | `findCircularDependencies` 递归 DFS 无最大深度限制 | 超深依赖链可能栈溢出；加 `MAX_CYCLE_DEPTH` 兜底 |
| D19 | `file-index.js:351-367` | `processPending` 串行 `await handleFileChange` | 批量保存时 debounce 意义被削弱；考虑小并发（如 5）|
| D20 | `utils/path.js:22` | Windows 路径 `toLowerCase()` 在土耳其语 locale 下 `I→ı` 不匹配 | 改用 `toLocaleLowerCase('en-US')` |

---

## 测试覆盖缺口（详细版）

> 2026-05-05 更新：54 个测试文件 vs 56 个主代码文件，表面健康但分布极不均匀。

### 完全没有测试的模块

| 文件 | 函数/类 | 风险等级 |
|------|---------|---------|
| `utils/parse-args.js` | `parseArgs` | 🔴 高（CLI 参数解析入口）|
| `utils/diagnostics.js` | `parseDiagnosticsFromText`, `normalizeSeverity`, `summarizeDiagnostics` | 🔴 高（诊断解析核心）|
| `utils/orphan-detector.js` | `findOrphanFiles` | 🟡 中（被 overview-tools 和 project-map 使用）|
| `utils/test-detector.js` | `isTestLikeFile`, `buildHeuristicSignature` | 🟡 中（测试映射 heuristic 核心）|
| `services/diagnostics-engine.js` | `DiagnosticsEngine` 全类 | 🔴 高（完全零测试）|
| `services/container.js` | `initialize`, `shutdown`, `ensureReady`, `_registerCallbacks` | 🔴 高（生命周期门控）|
| `services/file-index/symbol-extractors.js` | `extractSymbols` | 🟡 中 |
| `services/dep-graph/resolvers.js` | `resolveImport` | 🔴 高（import 解析核心）|
| `services/dep-graph/function-similarity.js` | 全文件 | 🟢 低 |
| `services/dep-graph/parsers/shared.js` | `createImportRecord` 等 | 🟡 中 |
| `services/dep-graph/parsers/spawn-ast.js` | 全文件 | 🟡 中 |
| `services/dep-graph/parsers/polyglot.js` | 全文件 | 🟡 中 |
| `cli/formatters/*.js` | 全部 7 个 formatter | 🟡 中（仅间接测试）|

### 有测试但仅覆盖 Happy Path

| 模块 | 测试文件 | 已覆盖 | 未覆盖（错误路径）|
|------|---------|--------|------------------|
| `cache.js` | `cache-test.js` | save/load roundtrip, parseResult CRUD | 损坏 JSON、旧版本迁移、TTL 过期、normalize 防御非法输入 |
| `dep-graph.js` | `dep-graph-incremental-test.js` | updateFiles 3 个 happy path | `updateFiles([])`、解析失败、`_processFilesWithLimit` reject、shebang/`__main__` 分支 |
| `file-index.js` | 间接测试 | build()、pruneDeletedCacheEntries | watcher 完整链路、readdir 权限拒绝、stat 失败、AbortController 超时 |
| `watch.js` | `watch-test.js` | 启动 + 文件创建触发 | compact 模式真实输出、SIGINT/SIGTERM、onFileChanged 异常隔离 |
| `repl.js` | `repl-test.js` | 命令路由、缺少参数 | 真实容器初始化、SIGINT、depGraph 为 null、热点 threshold 边界 |
| `cli.js` | `functionality-test.js` | 大部分命令 happy path | `--version`/`--help`、非法参数、mapper 异常、adapter 异常、所有 human 格式化分支 |

### Mock 过度需补充真实行为测试

| 测试文件 | Mock 对象 | 问题 | 建议 |
|----------|-----------|------|------|
| `repl-test.js` | 整个 `depGraph`（`makeMockDepGraph`）| 测的是路由和字符串拼接 | **repl-integration-test.js**：真实 ServiceContainer + 临时仓库 |
| `semgrep-scan-test.js` | `runCommandSecure` | 无真实 semgrep 可用时测试 | 加 `SEMGREP_TEST=1` 环境开关做真实扫描 |
| `diagnostics-cache-test.js` | 整个 `container` | 测的是数据结构访问 | **diagnostics-engine-test.js**：真实 DiagnosticsEngine |
| `function-impact-test.js` | `depGraph.normalizeFilePath`, `isTestLikeFile` | 测的是 BFS 调用次数 | 真实仓库修改函数，验证返回正确测试文件 |

### Flaky 根因

| 测试文件 | 根因 | 建议修复 |
|----------|------|----------|
| `watch-test.js` | 固定 `delay(2500)` 假设 + fs.watch 平台时序差异 | 轮询检查预期输出，而非固定 delay；使用独立临时目录 |
| `functionality-test.js` | 修改 repo root 的 tracked 文件（README.md）+ 无原子恢复 | 用 `fs.copyFileSync` 在副本上操作 |
| `java-parsers-test.js` / `go-ast-parser-test.js` | 外部进程 `timeout: 5000` 冷启动可能超时 | 提升至 15000ms 或根据 `CI` 环境变量动态调整 |

### 建议新增测试文件（按优先级）

1. `test/cache-corruption-test.js` — 损坏 JSON、旧版本、TTL、normalize 防御
2. `test/dep-graph-error-test.js` — `updateFiles([])`、解析失败、空 reverseGraph
3. `test/file-index-watcher-test.js` — 模拟 fs.watch 回调完整链路
4. `test/diagnostics-engine-test.js` — `scheduleCheck` debounce、并发限制、异常安全
5. `test/parse-args-test.js` — 未知参数、boolean flag、缺失值
6. `test/path-utils-test.js` — Windows 大小写、嵌套 workspace、边界
7. `test/project-context-test.js` — `classifyFile` 所有 ROLE_RULES 分支
8. `test/test-detector-test.js` — `isTestLikeFile` 15 条规则逐一验证
9. `test/diagnostics-parser-test.js` — 真实 ruff/pyright/eslint/tsc 输出样例解析
10. `test/container-lifecycle-test.js` — 并发 initialize、超时、shutdown 异常安全
11. `test/cli-args-validation-test.js` — 非法参数、未知命令、help/version
12. `test/resolvers-test.js` — 9 语言 import 语法解析和路径解析

