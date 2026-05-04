# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。
> 最后审查：2026-05-04（深度审核后更新）

---

## L1 Blocker（违反铁律，必须修）

> **2026-05-04 更新：L1 Blocker 全部清零。** 以下历史记录供追溯，当前活跃债务从 L2 开始。

### 数据一致性（L1#3）— ✅ 已清零

| # | 问题 | 修复方式 | 状态 |
|---|------|----------|------|
| B1 | 路径校验语义完全重复 | `resolveFilePath`/`validateWorkspacePath` 已在历史重构中消除 | ✅ |
| B2 | 并发窗口 symbolIndex 幽灵残留 | `file-index.js` `_removeCacheEntry()` 已统一清理 symbolIndex/parseResults/diagnostics/fileMetadata 四槽位 | ✅ |
| B3 | python.js 缺失 Record Schema | `python.js` AST + regex 均返回完整 `exportRecords` + `functionRecords`；`dep-graph.js` 历史补偿代码已移除 | ✅ |
| B4 | 孤儿检测白名单硬编码重复 | 提取 `src/utils/orphan-detector.js` `findOrphanFiles`，`project-map.js` + `overview-tools.js` 统一调用 | ✅ |

### 异常安全（L1#2）— ✅ 已清零

| # | 问题 | 修复方式 | 状态 |
|---|------|----------|------|
| B5 | `runCommandSecure` / `spawn-ast.js` 截断时未 kill 子进程 | `command.js` 截断时 `child.kill('SIGTERM')`；`spawn-ast.js` 截断时 `python.kill('SIGTERM')` | ✅ |
| B6 | `ensureReady()` shutdown 死锁边缘 | `shutdown()` 设置 `initError = new Error('Container shut down')`，`ensureReady()` 循环条件 `!this.initError` 正确退出 | ✅ |
| B7 | `save()` 大项目 RangeError 风险 | `cache.js` `save()` 在 `RangeError` 时降级为 `buildData(false)`（去掉 parseResults/symbolIndex/diagnostics），二次失败才抛错 | ✅ |

---

## L2 债务（技术债务，计划修）

### 1. 裸数字未归零（最大面积债务）

| 位置 | 裸数字 | 应进常量 | 备注 |
|------|--------|----------|------|
| `git-tools.js` | `trimOutput(..., 8000)` / `trimOutput(..., 12000)` | `GIT_OUTPUT_LIMITS.STAT_MAX` / `PATCH_MAX` | 重复出现 4 次 |
| `git-tools.js` | `entries.slice(0, 500)` | `GIT_OUTPUT_LIMITS.FILE_LIST_MAX` | |
| `git-tools.js` | `commits.slice(0, 10)` / `branches.slice(0, 10)` | `GIT_OUTPUT_LIMITS.COMMIT_MAX` | |
| `git-tools.js` | `runGit(..., 15000)` / `runGit(..., 30000)` | `TIMEOUTS.GIT_SHORT` / `GIT_LONG` | 分散 15+ 处 |
| `health-tools.js` | `trimOutput(..., 3000)` | `LINTER_OUTPUT_MAX` | 重复 8 次 |
| `cli.js` | `minScore: 0.5` / `maxPerFunction: 3` | `REUSE_HINTS.MIN_SCORE` / `MAX_PER_FUNCTION` | audit-diff reuseHints |
| `file-index.js` | `120000` (per-pattern timeout) | `FILE_INDEX_PATTERN_TIMEOUT_MS` | |
| `file-index.js` | `500` (debounce ms) | `WATCH_DEBOUNCE_MS` | 无 rationale 注释 |
| `file-index.js` | `300000` (build timeout) | `FILE_INDEX_BUILD_TIMEOUT_MS` | |
| `container.js` | `60000` / `30000` | `CONTAINER_INIT_TIMEOUT_MS` / `CONTAINER_ENSURE_READY_TIMEOUT_MS` | |
| `container.js` | `50` (sleep ms) | — | 辅助函数内联值，可接受 |
| `repl.js` | `slice(0, 3)` / `slice(0, 2)` | `REPL_ISSUES_LIMIT` | issues 命令裁剪 |
| `project-map.js` | `highlightedFiles.slice(0, 30)` | `PROJECT_MAP_HIGHLIGHT_MAX` | |
| `project-map.js` + `repl.js` | `dependents.length >= 5` | `HOTSPOT_MIN_DEPENDENTS` | 两处重复 |

### 2. 重复代码

| 位置 | 重复内容 | 提取目标 |
|------|----------|----------|
| `function-impact.js` 第57-67行 ↔ 第83-92行 | **同文件 >70% 相似过滤链**（四步 filter + map） | `findFunctionsOverlappingRanges(records, ranges)` 纯函数 |
| `java.js` + `python.js` | **spawn 逻辑 95% 重复**（子进程创建、timer、截断、close/error） | `spawnPythonASTParser(scriptName, content)` 纯函数 |
| `commands.js` | **5 个 getXCommands 同文件 >70% 重复**（前 4 行 100% 相同） | `buildStackCommands(stack, changeType, builderFn)` 基座 |
| `dep-graph.js` | `getImpactRadius()` + `findAffectedTests()` BFS 遍历结构高度相似 | 通用 BFS 工具函数 |
| `js.js` + `shared.js` | walker 核心逻辑 ~85% 重复 | 统一为单一 walker |

### 3. Record Schema 不一致

| Parser | 缺失字段 | 状态 |
|--------|----------|------|
| `python.js` AST | `exportRecords`, `functionRecords` | ✅ 已修复 |
| `python.js` regex | `exportRecords`, `functionRecords` | ✅ 已修复 |
| `java.js` AST | `functionRecords` | ❌ 缺失 |
| `java.js` regex | `functionRecords` | ❌ 缺失 |
| `polyglot.js` (Kotlin/Go/Rust) | `functionRecords` | ❌ 缺失 |

### 4. Parser 功能盲区

| 位置 | 盲区 | 影响 |
|------|------|------|
| `js.js` regex fallback | 完全丢失 `module.exports = {...}` 和 `exports.foo = ...` | CJS 项目静默丢导出 |
| `polyglot.js` parseGo | `blockImport` 正则用 `/m` 缺 `/g`，只匹配第一个 `import (...)` | 多 import 块文件漏依赖 |
| `polyglot.js` parseRust | `useRegex` 无法匹配 `use std::io::{self, Read};` | brace 语法大量 import 丢失 |
| `polyglot.js` parseRust | 缺失 `pub enum`、`pub trait`、`pub type`、`pub mod`、`pub const`、`pub static`、`pub use` | 导出种类严重不全 |
| `polyglot.js` parseKotlin | `funRegex` 未排除 private/internal/protected | dead-export 保守策略被击穿 |
| `python.js` regex | 不支持多行 import / 行续符 | `from module import (\n a,\n b\n)` 无法匹配 |
| `scripts/python_ast_parser.py` | `ast.walk()` 将嵌套函数当模块级导出 | dead-export 误报 |

### 5. 其他

| 位置 | 问题 | 铁律 |
|------|------|------|
| `resolvers.js` | 硬编码文件扩展名 10+ 个（`.ts`/`.tsx`/`.mts`/`.cts`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.json`/`.css`） | L2#6 |
| `resolvers.js` | `src/main/java` 等目录名硬编码重复 4 次 | L2#7 |
| `resolvers.js` | `_javaSourceRootsCache` / `_goModCache` 用 `let` 从未重新赋值 | L2#6 |
| `file-index.js` | `DEFAULT_EXCLUDE_DIRS` 仍含项目特定目录 `'gitnexus-extract'` | L2#5（删除 > 添加） |
| `file-index.js` | `getFilePatterns()` 未覆盖 `.mjs`/`.cjs`/`.mts`/`.cts` | ✅ 已修复（P6 中一并加入） |
| `file-index.js` | `getFilePatterns()` fallback 无 `**/*.go` / `**/*.rs` | ✅ 已修复（P6 中一并加入） |
| `file-index.js` | `startWatching()` 用 `process.cwd()` 而非 `this.root` 探测 recursive 支持 | L2#4 |
| `dep-graph.js` | `isKnownEntryFile()` 每次调用重建 15 个 RegExp | L2#7 |
| `dep-graph.js` | `findCircularDependencies()` 参数 `path` 遮蔽顶层 `const path = require('path')` | L2#4 |
| `function-impact.js` | `getFunctionReuseHints` 直接访问 `depGraph.graph` 内部 Map | L2#3（封装） |
| `command.js` | `runCommand`（execSync 遗留）仍被导出，无调用方 | L2#5 |
| `sanitize.js` | `sanitizeShellArg` 生产代码零调用 | L2#5 |
| `sanitize.js` | 白名单过度严格（`[a-zA-Z0-9_\-\.]`），中文路径/文件名被完全抹除 | L2#4 |
| `file-index.js` | `handleFileChange()` 只比较 `mtimeMs`，不比较 `size`；与 `processFile()` 的 `mtime && size` 双检不一致 | L2#4 |
| `file-index.js` | `shouldExclude()` `node_modules` 特殊分支与 `matchesPathFragment` 重复语义 | ✅ 已修复 |
| `audit-diff-summary.js` | `classifyChangeType` 扩展名硬编码数组分散风险（`['md', 'mdx', ...]`） | L2#6 |
| `audit-diff-summary.js` | `compactChangedFile` 裁剪阈值裸数字（`impact.slice(0, 5)` / `affectedTests.slice(0, 5)` / `impactExplanations.slice(0, 3)`） | L2#6 |

---

## L3 品味问题（建议修）

| 位置 | 问题 | 长度/说明 |
|------|------|-----------|
| `validation-advice.js` | `buildValidationAdvice` 274 行，承担 5 项独立子工作 | 拆为 5-6 个纯函数 |
| `project-context.js` | `inferFileRole()` ~95 行，大量硬编码 Set/regex | 提取为配置表 |
| `container.js` | `initialize()` ~85 行，6 个服务初始化 + 2 条回调 | 拆为私有方法 |
| `function-impact.js` | `getChangedFunctionImpact()` ~140 行 | 内聚性受损 |
| `symbol-impact.js` | `getSymbolImpact()` ~130 行 | 超 30 行阈值 |
| `dep-graph.js` | `findAffectedTests` ~80 行 | 超 30 行阈值 |
| `git-tools.js` | `getChangedFiles()` 手动字符级解析 | 641 行文件中已知债务，当前不优先 |
| `overview-tools.js` | `renderOverviewDashboard` 中 HTML/CSS 裸数字 | `padding:14px`、`font-size:26px` 等 |
| `js.js` | `parseJavaScriptAST` ~265 行、`parseJavaScript` regex ~147 行 | 函数过长 |
| `shared.js` | `buildFunctionFingerprint` 中 `callCallees.slice(0, 20)` 魔法数字 | 应进 constants.js |
| `path.js` | `hasPathSegment` 语义陷阱：只取 segment 最后一级 | 函数名与实际行为不符 |
| `js.js` | `walkAST` 硬编码跳过键 `'type'\|'loc'\|'start'\|'end'`，未提取 `AST_SKIP_KEYS` 常量 | 应常量化 |
| `project-context.js` | `shouldAnalyzeFile` 与 `shouldIndexFile` 命名只差一个词，语义分别是 "active only" vs "not generated"，易混淆 | 命名不清 |
| `composite-risk.js` | `score -= 1`、`score += Math.min(2, highImpactFunctions.length)` 等评分操作缺少"为什么"这样设计的 rationale 注释 | L3#11 |

---

## 文件级雷区地图

| 文件 | 行数 | 风险 | 状态 |
|------|------|------|------|
| `src/services/dep-graph.js` | ~760 | **高** | 核心引擎类，方法间共享内部状态；唯一剩余超大文件，AGENTS.md 已确认"内聚优先、不物理拆分" |
| `src/tools/overview-tools.js` | ~749 | 中 | 已按功能域拆分出多个纯函数 + SCORING 常量，裸数字大部分已归零，少量残留 |
| `src/tools/git-tools.js` | ~640 | 中 | `getChangedFiles()` 手动字符级解析是已知债务；裸数字多 |
| `cli.js` | ~600 | 中 | 命令分发中心；分支短，行数来自命令数量 |
| `src/cli/formatters/validation-advice.js` | ~274 | 中 | 单函数 274 行，承担 5 项子工作 |
| `src/utils/project-context.js` | ~300 | 低 | `inferFileRole()` ~95 行膨胀 |
| `src/utils/stack-detectors/detect.js` | ~396 | 低 | 已从 stack-detector.js 拆分，检测逻辑内聚 |
| `src/utils/stack-detectors/commands.js` | ~433 | 低 | 已从 stack-detector.js 拆分，命令生成内聚；getXCommands 重复待提取 |
| `src/services/file-index.js` | ~450 | 低 | 已从 ~523 行降下，extractSymbols 外移至注册表；并发窗口残留待修 |

---

## 测试覆盖缺口

| Parser / 模块 | 测试文件 | 状态 |
|---------------|----------|------|
| JS AST + functionRecords | `test/arrow-function-test.js` | ✅ |
| Java AST + regex fallback | `test/java-parsers-test.js` | ✅ |
| Python (AST/regex) | 无 | ❌ **零覆盖** |
| Kotlin / Go / Rust (polyglot) | 无 | ❌ **零覆盖** |
| JS regex fallback | 无 | ❌ **零覆盖** |

> **建议**：优先写 `test/parser-schema-contract-test.js`，直接调用全部 9 个 parser，断言返回对象包含且仅包含规范字段。

---

*注：本文档只记录当前活跃债务。已清零历史见 [CHANGELOG.md](../CHANGELOG.md) [Unreleased] §重构。修复时应优先写失败测试（red），再动实现（green）。*
