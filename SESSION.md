# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（必须执行）

```bash
# 1. 验证测试基线
node test/runner.js          # 期望: 51/51 PASS

# 2. 验证自审基线
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExportCount=0, unresolvedCount=0, cycleCount=0, totalFiles≈113

# 3. 验证大项目 compact 可用性
node cli.js audit-map --cwd reference/GitNexus/gitnexus --compact --json --quiet
# 期望: 输出行数 < 1000, summary.severity 存在, highlightedFiles 按问题严重程度排序
```

**如果任何一步失败 → 先修基线，再做其他事。**

---

## 基线状态

- 测试：**51/51 PASS**（新增 `js-regex-cjs-test.js`）
- 版本：**v1.0.4**（待打 tag）
- 分支：`main`，已 push origin
- 自身项目规模：113 文件，entry=4, library=45, test=52, script=12
- 健康度：5/5，0 死导出，0 循环，0 未解析
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）

---

## 本轮完成（2026-05-05）

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

---

## 新会话指令（给下一轮 AI）

> **状态更新（2026-05-05）**：L1/L2 债务全部清零。当前基线 51/51 PASS，healthScore=5/5。

### 前置检查

1. 跑 `node test/runner.js` 确认基线绿色（当前 51/51 PASS；若 `repl-test.js` 偶发失败，单独重跑该文件确认）。
2. 跑 `node cli.js audit-summary --cwd . --json --quiet` 确认 healthScore=5/5。

### 下一步方向（按 ROADMAP 价值排序）

- **下一轮首选**：`test/parser-schema-contract-test.js` — 统一测试调用全部 9 个 parser，断言返回对象包含且仅包含 `{imports, exports, importRecords, exportRecords, functionRecords, parseMode}`。当前 Python/Kotlin/Go/Rust/JS-regex 都缺少专项覆盖，这是新增语言时的第一道安全门
- P4 剩余：Kotlin AST 级支持（当前 regex）
- P5 已完成：REPL `issues` / `top` 已实现（ROADMAP.md 已同步）
- L3 品味问题（时间允许时逐步推进）

### 新增第 N 种语言的 SOP（已验证，未来复用）

1. **写 parser 函数** — 返回 Record Schema：`{ imports, exports, importRecords, exportRecords, functionRecords, parseMode }`
2. **在 `PARSER_REGISTRY` 加一行** — `{ exts: ['.xxx'], parser: parseXxx }`
3. **补测试** — `test/xxx-parser-test.js`
4. **更新 file-index** — `getFilePatterns()` 加入对应扩展名
5. **跑全量测试** — `node test/runner.js`

---

*Last updated: 2026-05-05（本轮：L2 债务全部清零。js.js CJS regex fallback 修复 + container.js/file-index.js 裸数字归零 + constants.js 扩展 + TECH_DEBT.md 精简同步。）*
