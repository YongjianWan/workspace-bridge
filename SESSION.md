# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（必须执行）

```bash
# 1. 验证测试基线
npm run test:all          # 期望: 47/47 PASS

# 2. 验证自审基线
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExportCount=0, unresolvedCount=0, cycleCount=0, totalFiles≈108

# 3. 验证大项目 compact 可用性
node cli.js audit-map --cwd reference/GitNexus/gitnexus --compact --json --quiet
# 期望: 输出行数 < 1000, summary.severity 存在, highlightedFiles 按问题严重程度排序
```

**如果任何一步失败 → 先修基线，再做其他事。**

---

## 基线状态

- 测试：**50/50 PASS**（新增 3 个 parser 测试；`repl-test.js` 偶发 flaky，单独重跑即过）
- 版本：**v1.0.4**（待打 tag）
- 分支：`main`，已 push origin
- 自身项目规模：111 文件，entry=4, library=44, test=51, script=12
- 健康度：5/5，0 死导出，0 循环，0 未解析
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）

---

## 本轮完成（2026-05-04）

### P6 语言扩展：6 → 9 种（全栈覆盖达成）

- **Vue SFC parser** `src/services/dep-graph/parsers/vue.js` — 提取 `<script>` / `<script setup>` 复用 `parseJavaScript`
- **C/C++ parser** `src/services/dep-graph/parsers/cpp.js` — regex 提取 `#include`、文件级函数、`#define` 宏
- **Svelte parser** `src/services/dep-graph/parsers/svelte.js` — 提取 `<script>` 块复用 `parseJavaScript`
- **注册表集成** `dep-graph.js` `parsers/index.js` — `PARSER_REGISTRY` 新增 3 行
- **file-index 覆盖** `file-index.js` `path.js` — `hasPackageJson` 时索引 `.vue` `.svelte`；新增 `hasCpp`（CMakeLists.txt/Makefile）索引 C/C++ 扩展名
- **新增 3 个 parser 测试文件**：`test/vue-parser-test.js`、`test/cpp-parser-test.js`、`test/svelte-parser-test.js`
- **ROADMAP P6 标记更新**：C/C++、Vue SFC、Svelte 全部 ✅ 已完成

## 上轮完成（2026-05-04）

> 历史交付（audit-map compact、archive 排除、REPL 扩展等）见 [CHANGELOG.md](../CHANGELOG.md) [Unreleased]。

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

> **状态更新（2026-05-04）**：L2 已全部清零，L3（#29–#32）亦已修完。47/47 PASS。已执行指令的详细方案（含过时行号）已归档于 [CHANGELOG.md](../CHANGELOG.md) [Unreleased] §重构，此处不再重复。

### 前置检查
1. 跑 `node test/runner.js` 确认基线绿色（当前 47/47 PASS；若 `repl-test.js` 偶发失败，单独重跑该文件确认）。
2. 跑 `node cli.js audit-summary --cwd . --json --quiet` 确认 healthScore=5/5。

## 新会话指令

> **状态**：P6 语言扩展已完成（6 → 9 语言）。当前基线 50/50 PASS（含 3 个新增 parser 测试），healthScore=5/5。

### 前置检查

1. 跑 `node test/runner.js` 确认基线绿色。
2. 跑 `node cli.js audit-summary --cwd . --json --quiet` 确认 healthScore=5/5。

### 下一步方向（按 ROADMAP 价值排序）

- P4 剩余：Kotlin AST 级支持（当前 regex）
- P5 剩余：REPL `issues` / `top` 命令待实现
- TECH_DEBT.md L1 Blocker（B1–B7）— 数据一致性、异常安全问题
- TECH_DEBT.md L2 债务 — 裸数字归零、重复代码、Record Schema 不一致等 14 项

### 新增第 N 种语言的 SOP（已验证，未来复用）

1. **写 parser 函数** — 返回 Record Schema：`{ imports, exports, importRecords, exportRecords, functionRecords, parseMode }`
2. **在 `PARSER_REGISTRY` 加一行** — `{ exts: ['.xxx'], parser: parseXxx }`
3. **补测试** — `test/xxx-parser-test.js`
4. **更新 file-index** — `getFilePatterns()` 加入对应扩展名
5. **跑全量测试** — `node test/runner.js`

---

*Last updated: 2026-05-04（本轮：P6 语言扩展完成，9 语言全栈覆盖达成。新增 vue/cpp/svelte parser + 测试 + 注册表集成 + file-index 扩展名覆盖。）*
