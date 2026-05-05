# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（必须执行）

```bash
# 1. 验证测试基线
node test/runner.js          # 期望: 54/54 PASS

# 2. 验证自审基线
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExportCount=0, unresolvedCount=0, cycleCount=0, totalFiles≈118

# 3. 验证大项目 compact 可用性
node cli.js audit-map --cwd reference/GitNexus/gitnexus --compact --json --quiet
# 期望: 输出行数 < 1000, summary.severity 存在, highlightedFiles 按问题严重程度排序
```

**如果任何一步失败 → 先修基线，再做其他事。**

---

## 基线状态

- 测试：**54/54 PASS**（新增 `cache-consistency-test.js`）
- 版本：**v1.0.5**
- 分支：`main`，已 push origin
- 自身项目规模：122 文件（含 fixture-temp 副作用），entry=4, library=47, test=55, script=12
- 健康度：5/5，0 死导出，0 循环，0 未解析
- cache 一致性：✅ 已修复（删除文件后无 ghost 数据）
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）

---

## 本轮完成（2026-05-05 第三轮）

### 修复缓存一致性 Bug（删除文件后 ghost 数据残留）
- **根因定位**：`dep-graph.js` `build()` 不清空 `this.graph`；`updateFiles()` 删除检查被 cache-hit 跳过；`pruneDeletedCacheEntries` 未覆盖 `parseResults` 孤儿条目。
- **代码修复**：
  - `src/services/dep-graph.js`：`build()` 增加 `this.graph.clear()`；`updateFiles()` 删除检查前置并同步清理全部 cache 槽位
  - `src/services/file-index.js`：`pruneDeletedCacheEntries()` 同时扫描 `fileMetadata` + `parseResults`
- **新增测试**：`test/cache-consistency-test.js`，6 个场景（graph 重建清空、parseResults 清理、孤儿 parseResult 防御、updateFiles 全槽位清理、deadExports 排除已删文件、unresolved 行为正确）
- **回归验证**：全量测试 **54/54 PASS**

### 补 `test/parser-schema-contract-test.js`（上轮）
- 统一契约测试覆盖全部 9 个 parser，断言 Record Schema 严格包含 6 项顶层字段

### 深度分析 GitNexus 参考项目，确定 P4-AST 技术方案（上轮）

**可行性验证**
- `npm install web-tree-sitter tree-sitter-wasms` 成功
- `web-tree-sitter@0.25.3` + `tree-sitter-wasms@0.1.13` 四语言（Go/Rust/Kotlin/C++）wasm 加载 + Query API 全部通过
- `web-tree-sitter@0.26.8` 与 `tree-sitter-wasms@0.1.13` ABI 不兼容，已锁定 `0.25.3`

**从 GitNexus 提取的 5 个高价值模式**
1. **parser-loader.ts** — `GrammarSource` 配置表（load / unavailableNote / optional / severity）+ `loadCache` + `logged` Set
2. **language provider** — `defineLanguage()` 统一封装所有 extractor，零 if-else 链
3. **tree-sitter-queries.ts** — Query 声明式捕获比手写 visitor 代码量 -70%，query 文本可直接复用
4. **export-detection.ts** — `(node, name) => boolean` 纯函数，Go/Rust/Kotlin/C++ export 判断逻辑可直接移植
5. **c-cpp.ts** — `cCppExtractFunctionName` 解包 pointer/reference/qualified/parenthesized 嵌套链（~130 行），C/C++ AST 最复杂点

**文档同步**
- `ROADMAP.md` — P4-AST 完整方案（技术选型对比、风险清单、放弃条件、阶段性交付、GitNexus 血泪史引用）
- `AGENTS.md` — 外部工具策略表（tree-sitter 从"不引入"改为"引入 WASM 方案"）、技术栈对比更新
- `TECH_DEBT.md` — 测试覆盖缺口更新为 ✅

---

## 上轮完成（2026-05-05 第一轮）

### L2 债务全部清零（14 项残余一次性清理）

**js.js — 1 项**
- regex fallback 完全丢失 `module.exports = {...}` 和 `exports.foo = ...`
- `extractExportsWithRegex` 新增 CJS module.exports / exports 检测正则
- 新增 `test/js-regex-cjs-test.js` 强制 regex fallback 验证 CJS exports 提取

**container.js — 3 项裸数字**
- `initialize(cwd, timeoutMs = 60000)` → `TIMEOUTS.INIT_TIMEOUT_MS`
- `ensureReady(timeoutMs = 30000)` → `TIMEOUTS.CONTAINER_ENSURE_READY_TIMEOUT_MS`
- `build(300000)` → `DEFAULTS.FILE_INDEX_BUILD_TIMEOUT_MS`
- `getStaleness(thresholdMs = 5 * 60 * 1000)` → `DEFAULTS.STALENESS_THRESHOLD_MS`

**file-index.js — 1 项裸数字**
- `i % 100 === 0` 进度报告批次 → `DEFAULTS.FILE_INDEX_PROGRESS_BATCH`

**constants.js — 扩展**
- 新增 `STALENESS_THRESHOLD_MS: 5 * 60 * 1000`
- 新增 `FILE_INDEX_PROGRESS_BATCH: 100`

**TECH_DEBT.md — 文档同步**
- L1 Blocker B1–B7 全部 ✅
- L2 裸数字、重复代码、Record Schema、Parser 盲区、其他杂项全部 ✅
- 文档从 159 行精简至 ~140 行，只保留 L3 建议与文件级雷区地图

---

## 上轮完成（2026-05-04）

### P6 语言扩展：6 → 9 种（全栈覆盖达成）

- **Vue SFC parser** `src/services/dep-graph/parsers/vue.js`
- **C/C++ parser** `src/services/dep-graph/parsers/cpp.js`
- **Svelte parser** `src/services/dep-graph/parsers/svelte.js`
- **注册表集成** `dep-graph.js` `parsers/index.js` — `PARSER_REGISTRY` 新增 3 行
- **file-index 覆盖** — `getFilePatterns()` 加入 `.vue` `.svelte` 和 C/C++ 扩展名
- **新增 3 个 parser 测试文件**：`test/vue-parser-test.js`、`test/cpp-parser-test.js`、`test/svelte-parser-test.js`
- **ROADMAP P6 标记更新**：C/C++、Vue SFC、Svelte 全部 ✅ 已完成

### L2/L3 债务全部清零（18 项）

**parsers/js.js — 6 项**
- `visitNode` 拆为 `importExportVisitors` / `functionVisitors` 映射表
- 提取 `walkAST(node, callback, parent)` 消除两处 >90% 重复 walker
- 提取 `getPropertyName(prop)`、`buildExportRecordFromValue(...)`、`pushFunctionRecord(...)`
- `QUOTE_PATTERNS` + `DECL_KIND_MAP` 配置表替代三元嵌套

**dep-graph.js — 10 项**
- `PARSER_REGISTRY` 配置表消除 6 分支 if-else 链
- `_addReverseEdges` + `_removeOldReverseEdges` 消除反向边构建重复
- `FRAMEWORK_MANAGED_PATTERNS`、`KNOWN_CONFIG_NAMES`、`PYTHON_MAIN_PATTERN` 提模块级
- `_scanSymbolUsageInImporters` 局部 `Map<symbol, RegExp>` 缓存
- `findAffectedTests` 拆为 `_findAffectedTestsByGraph` + `_findAffectedTestsByHeuristic`
- `findDeadExports` 提取 `_collectUsedExports`
- `updateFiles` 拆为私有方法

**overview-tools.js — 2 项**
- `SCORING` 常量对象进 `constants.js`，~20 处裸数字全替换
- `getHistoryRisk` `limit: 25` → `DEFAULTS.HISTORY_LIMIT`

### 文档同步
- `TECH_DEBT.md` — 已清零债务全部迁出，只保留当前活跃项
- `CHANGELOG.md` — 本轮 15 项重构追加到 [Unreleased] §重构

---

## 已知陷阱（新 agent 必看）

| 陷阱 | 位置 | 如何避免 |
|------|------|----------|
| `DEFAULT_EXCLUDE_DIRS` 全局污染 | `src/services/file-index.js` | 任何新增排除项必须是通用目录名（如 `node_modules`），不能是项目特定名称 |
| orphan 检测不同步 | `project-map.js` vs `overview-tools.js` | 两处 orphan 逻辑必须保持同步（scripts/bin/benchmark 跳过） |
| compact 模式只改 project-map.js | `cli.js` 也需要同步 | human-readable 输出和 `countTreeFiles()` 必须兼容 skeleton 模式（`totalFileCount`） |
| Windows PowerShell 管道 BOM | 所有 `node cli.js ... \| node -e` 命令 | PowerShell 管道传 JSON 会带 BOM，用 `cmd /c "... > file"` 再读文件 |
| cache.save() 已改为 async | `src/services/cache.js` | 调用方必须 `await`（container.js、测试均已适配） |
| repl-test.js flaky | `test/repl-test.js` | runner.js 串行执行时偶发失败，单独 `node test/repl-test.js` 稳定通过；若遇到，先重跑确认 |
| ~~缓存不一致（删除文件后 ghost 数据）~~ ✅ **已修复 v1.0.5** | `file-index.js` + `dep-graph.js` | `dep-graph.build()` 已增加 `graph.clear()`；`updateFiles()` 删除检查已前置；`pruneDeletedCacheEntries` 已覆盖 `parseResults`。见 SESSION.md §已修复 Bug |

---

## 新会话指令（给下一轮 AI）

> **状态更新（2026-05-05）**：L1/L2 债务全部清零，P4-AST Go AST 已完成，文档治理完成，54/54 PASS，healthScore=5/5。**缓存一致性 Bug 已修复**。

### 前置检查

1. 跑 `node test/runner.js` 确认基线绿色（当前 54/54 PASS；若 `repl-test.js` 偶发失败，单独重跑该文件确认）。
2. 跑 `node cli.js audit-summary --cwd . --json --quiet` 确认 healthScore=5/5。注意：测试运行后会生成 `fixture-temp/` 临时目录，此时 totalFiles 会临时增加至 122，清理后恢复为 118。

### 下一步方向（按价值排序）

**首选：从 GitNexus 提取高 ROI 模式**
> GitNexus 深度分析已完成，筛选出 4 个对 workspace-bridge 有价值的模式。评估结论已归档至 [ROADMAP.md §GitNexus 高价值模式提取](./ROADMAP.md#gitnexus-高价值模式提取待排期）。

**短期最优先执行（单轮可完成）**：
1. **模式 C：框架感知 Extractor**（Route + ORM）— 新建 `src/services/dep-graph/framework-patterns.js`，`audit-diff`/`audit-file` 输出 `frameworkPatterns` 字段
2. **模式 F：AST Cache**（LRU + WASM dispose）— 在 `tree-sitter.js` 中加 `lru-cache`，防 `watch`/`repl` 长期运行泄漏
3. **模式 D：递进工具链文案**（WHEN TO USE / AFTER THIS）— 改 `cli.js` help string

**中期排期**：
- **模式 A：语言注册表重构** — 等 P4-AST 全部完成后做，避免中途重构增加回归成本
- **Worker Pool / Graph DB / Pipeline DAG** — 与 workspace-bridge 轻量定位冲突，不建议提取

**次选：继续 P4-AST 编码（Rust AST）**
- Go AST 已完成 ✅，基础设施（`tree-sitter.js` + `go-ast.js`）已验证跑通
- 如果用户明确说"直接开干"，则转向写 `rust-ast.js`：参考 `go-ast.js` 结构，定义 `RUST_QUERY`，返回标准 Record Schema，`parseMode: 'ast'`，失败 fallback 到 `polyglot.js` 的 regex
- 编码前必须先读 `ROADMAP.md §P4-AST` 的风险清单和放弃条件

**已修复 Bug**：
1. **缓存一致性：删除文件后 ghost 数据残留** ✅
   - **根因**：`dep-graph.js` `build()` 未清空 `this.graph`，长期运行进程（watch/repl）或 cache 加载异常时，已删除文件的节点残留；`updateFiles()` 删除检查被 cache-hit fast path 掩盖；`pruneDeletedCacheEntries` 未覆盖 `parseResults` 孤儿条目。
   - **修复**：
     - `dep-graph.js` `build()` 开头增加 `this.graph.clear()`
     - `updateFiles()` 将 `fs.existsSync` 删除检查移至 cache-hit 之前，并同步清理 `fileMetadata` / `parseResults` / `diagnostics`
     - `file-index.js` `pruneDeletedCacheEntries()` 同时扫描 `fileMetadata.keys()` 和 `parseResults.keys()`，防御历史 cache 不一致
   - **验证**：新增 `test/cache-consistency-test.js`，6 个场景全部通过；全量测试 54/54 PASS

**暂缓**：
- ~~`test/parser-schema-contract-test.js` — 已完成 ✅~~
- ~~Go AST — 已完成 ✅~~
- P5 已完成：REPL `issues` / `top` 已实现（ROADMAP.md 已同步）
- L3 品味问题（时间允许时逐步推进）

### 新增第 N 种语言的 SOP（已验证，未来复用）

1. **写 parser 函数** — 返回 Record Schema：`{ imports, exports, importRecords, exportRecords, functionRecords, parseMode }`
2. **在 `PARSER_REGISTRY` 加一行** — `{ exts: ['.xxx'], parser: parseXxx }`
3. **补测试** — `test/xxx-parser-test.js`
4. **更新 file-index** — `getFilePatterns()` 加入对应扩展名
5. **跑全量测试** — `node test/runner.js`

---

*Last updated: 2026-05-05（本轮：修复缓存一致性 bug + 新增 cache-consistency-test.js + SESSION.md 同步。）*
