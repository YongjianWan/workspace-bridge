# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

无。

---

## L2 债务（阻塞演进或导致结果不可信）

无。

---

## 架构债务（不阻塞功能，但阻塞演进速度）

#### `overview-tools.js` 与 `health-tools.js` 数据重叠

**数据**：AGENTS.md 已标记；`health-tools.js` 的 `checkParserAvailability` 与 `audit-summary.health.parserAvailability` 重合；`workspace-tools.js#detectNodeLinters` 与 `diagnostics-engine.js#hasChecker` 分别独立实现 eslint 检测逻辑（eslint/prettier 配置文件列表已于本轮提取为 `PROBE.ESLINT_CONFIG_FILES` / `PROBE.PRETTIER_CONFIG_FILES`，但运行时检测 `hasChecker` 与静态检测 `detectNodeLinters` 的底层逻辑仍未统一）。

**根因**：health / overview / diagnostics 三个模块各自维护一份"环境检测"逻辑，没有统一的数据源。

**影响**：修改 linter 检测逻辑时可能漏改某一处，导致不同命令输出矛盾。

**方案**：提取统一的环境探测模块（`environment-probe.js`），由所有消费者共享同一份检测结果。

---

## 测试代码债务（131 文件）

#### 弱断言分布 — 占总断言数 ~3.0%

**数据**（本轮修复后）：

| 弱断言模式 | 数量 | 风险等级 | 说明 |
|-----------|------|---------|------|
| `typeof x === 'string'/'number'/'boolean'` | ~35 | 低 | 带消息参数的 schema 契约检查，维持现状（改为值验证会导致 schema 变更时测试大面积失效） |
| `.status === 0` | 1 | 中 | `java-parsers-test.js` 环境检测逻辑 `isJavalangAvailable()`，非测试断言 |
| `!== null/undefined` | ~20 | 低 | 存在性检查，属防御性验证，不纳入弱断言统计 |
| `strictEqual(result.ok, true/false)` | ~48 | 低 | 深层嵌套防御性检查，风险低，不纳入弱断言统计 |
| **合计弱断言（需修复）** | **~35** | — | 从 ~44 处降至 ~35 处（仅余 `typeof` 型 schema 契约检查） |

**本轮增强**：
- `js-ast-dynamic-import-test.js` / `js-ast-new-url-test.js` / `js-regex-cjs-test.js`：`assert(result.x === y)` → `assert.strictEqual(result.x, y)`
- `language-support-matrix-test.js`：`assert(!matrix.java)` → `assert.strictEqual(matrix.java, undefined)`
- `regression-test.js`：`assert.ok(result.status === 1)` → `assert.strictEqual(result.status, 1)`
- `tree-tools-test.js`：`assert.ok(tree.imports)` → `assert.ok(Array.isArray(tree.imports))`
- `parser-schema-contract-test.js`：`typeof === 'object'` 补 `!== null` 防御
- `honesty-engine-test.js`：3 处无消息 `assert.ok(text.includes(...))` 补消息参数

---

#### 测试类型分布失衡

| 类型 | 文件数 | 占比 | 评估 |
|------|--------|------|------|
| 单元测试（直接 `require src/`） | ~101 | 78% | 比例良好 |
| 集成测试（`spawn`/`runCli`） | 24 | 19% | **比例偏低** |
| 混沌/模糊测试 | 0 | 0% | **严重缺失**（CLI 工具暂缓） |
| 并发/竞争测试 | 5 个文件 | 4% | 存在（race、concurrency） |
| 端到端测试 | 3 个文件 | 2% | **严重不足**（仅 functionality/formatter-e2e/integration-core） |

**根因**：80% 单元测试 + 弱断言已从 ~76 处降至 ~35 处（~2.3%）。当前主要缺口是 CLI 管道回归保护不足，不是"函数返回了结构正确的对象"。

**影响**：CLI 入口的选项解析、路由分发、错误边界、格式化器选择等关键路径缺乏回归保护。

**方案**：
1. 新增 3–4 个 CLI 集成测试，覆盖 `audit-file`、`dead-exports`、`tree`、`impact` 等目前仅靠单元测试的命令
2. 弱断言清理与集成测试补齐并行进行
3. ✅ ~~runner 分层执行~~ → **已修**：`--layer fast/slow/watch` + 分阶段执行（fast ~14s / 全量 ~4min），开发迭代无需等待全量 7min

---

#### 测试代码重复率过高（mock depGraph）— 违反 L2-7

**数据**：
- **99 处内联 mock `depGraph`** 构造 — **部分收敛**：`audit-map-test.js` 公共方法已提取为 `BASE_MOCK_METHODS`，文件从 592 行降至 544 行；graph 数据字面量仍内联
- **新增发现**：`overview-tools-test.js` 的 mock depGraph 只有 6 个文件，但断言了复杂的 overview 行为。当 `buildProjectOverview` 添加小项目抑制逻辑时，测试立刻失败——mock 数据无法代表真实项目规模，说明 mock 测试与真实行为之间存在脱节。

**根因**：没有提取测试 fixture 工厂函数；mock 数据规模与真实项目差异过大。

**影响**：修改 `depGraph` mock 接口需改多处；新增基于项目规模的业务逻辑时，mock 测试容易误报或漏报。

**方案**：
1. `audit-map-test.js` graph 数据字面量进一步提取为配置表驱动的工厂调用
2. 基于规模的断言改为条件断言（如 `overview-tools-test.js` 本轮已做的调整），或提供多种规模的 fixture

---

#### 时序依赖测试脆弱 — 部分修复

**数据**：测试中存在固定延时，依赖事件循环/文件系统 watch 的时序：

| 文件 | 延时 | 场景 | 状态 |
|------|------|------|------|
| `audit-file-watch-test.js` | 100ms, 200ms | 轮询间隔 | ✅ 合理，保留 |
| `audit-file-watch-test.js` | 3000ms ×2 | 进程退出安全网 | ✅ 超时保护，保留 |
| `file-index-race-test.js` | 20ms | mock handleFileChange 内部延迟 | ✅ mock 模拟，保留 |
| `overview-tools-concurrency-test.js` | 5ms, 30ms | mock provider 内部延迟 | ✅ mock 模拟，保留 |
| `watch-sigterm-test.js` | 5000ms ×2 | 进程退出超时保护 | ✅ 安全网，保留 |
| `watch-test.js` | 3000ms, 5000ms | 进程退出安全网 | ✅ 超时保护，保留 |

**本轮修复**：4 个文件固定延时改为轮询：`diagnostics-unbounded-timer-test.js`（1200ms×2 → 轮询 checkCount/runningChecks）、`file-index-rename-test.js`（200ms → 轮询 prunedFiles）、`repl-shutdown-test.js`（30ms×2 → 轮询 sigintHandler/closeResolver）、`spawn-ast-test.js`（50ms+60ms → 轮询 killCalls）。

---

#### slow 层测试过重

**数据**：slow 层 26 个测试需 ~100s，其中 `e2e-gitnexus-test.js` 单个测试占 55s（全层时间的 55%）。

**根因**：GitNexus 项目规模 1329 文件，每次测试都冷启动 CLI + 全量建图 + 加载 WASM。

**影响**：slow 层的时间分布极不均匀，单个测试拖慢整个批次；开发迭代时即使只改一个功能，也需要等待全量 slow 层完成。

**方案**：
1. e2e-gitnexus 测试改为"缓存复用"模式（先预热缓存，测试只验证输出结构）
2. 或将 e2e-gitnexus 拆分为独立 CI job，本地 runner 默认跳过

## L3 品味问题（建议修，非债务）

| 位置                  | 问题                                                              | 优先级 |
| --------------------- | ----------------------------------------------------------------- | ------ |
| `git-tools.js`      | `getChangedFiles()` 手动字符级解析；`--since` 已新增，字符级解析债务仍在 | 低     |
| `js.js`             | `parseJavaScriptAST` ~476 行、`parseJavaScript` regex ~41 行 | 低     |
| `cli.js` / `formatters` | `--json` 嵌套深、体积大，`--compact` 后仍有 400 行，管道场景不友好；默认 human-readable 输出缺乏实战打磨 | 中     |

---

## 文件级雷区地图

| 文件                                        | 行数 | 风险         | 状态                                                      |
| ------------------------------------------- | ---- | ------------ | --------------------------------------------------------- |
| `src/services/dep-graph.js`               | ~1582 | **高** | 核心引擎类，AGENTS.md 已确认"内聚优先、不物理拆分"        |
| `src/tools/overview-tools.js`             | ~868 | 中           | JS/CSS 裸数字已归零（`DASHBOARD_LAYOUT` 常量）；P0 去噪已添加小项目 `architectureAdvice` 抑制；L2-5 schema 不一致源 |
| `cli.js`                                  | ~509 | 低           | `runCommand` 已拆分为 `src/cli/commands/*.js` + `COMMANDS` 注册表；仅保留参数解析、退出码语义、格式化输出调度 |
| `src/tools/git-tools.js`                  | ~358 | 低           | `getChangedFiles()` 手动字符级解析是已知债务；6 个死函数已清理（-309 行）；L2-9 commit range 源 |
| `src/tools/security-tools.js`             | ~170 | 低           | `--builtin-only` 已新增；L2-8 已关闭                        |
| `src/cli/formatters/validation-advice.js` | ~312 | 低           | 已拆为 6 个纯函数；文件变长是因为总代码量增加，内聚性提升 |
| `src/utils/project-context.js`            | ~297 | 低           | `inferFileRole()` 已降至 12 行，但 P95/P100 暴露规则缺口 |
| `src/utils/stack-detectors/detect.js`     | ~351 | 低           | stack-detector 检测子模块                                   |
| `src/utils/stack-detectors/commands.js`   | ~404 | 低           | stack-detector 命令子模块                                   |
| `src/services/file-index.js`              | ~544 | 低           | 已从 ~523 行降下                                          |

---

## 测试覆盖缺口

### 零专属测试模块清单

**L1 基础设施层**

| 模块 | 风险等级 | 说明 | 建议测试文件 |
|------|---------|------|-------------|

**L4 工具层（11 个工具，0 个零专属测试）**

| 模块 | 状态 | 说明 | 建议测试文件 |
|------|------|------|-------------|
| `src/tools/dep-tools.js` | ✅ 已补充 | `test/dep-tools-test.js` 覆盖 stats/dependencies/dependents/impact/cycles/dead_exports/unresolved/affected_tests/default/unknown 操作及边界 | — |
| `src/tools/git-tools.js` | ✅ 已补充 | `test/git-tools-test.js` 覆盖 getChangedFiles/staged/since/untracked、getChangedLineRanges、getFileHistoryRisk、getDiffNumstat | — |
| `src/tools/incremental-diff.js` | ✅ 已补充 | `test/incremental-diff-test.js` 覆盖 collectRelatedFiles 和 buildIncrementalFindings 过滤逻辑 | — |
| `src/tools/overview-tools.js` | ✅ 好 | `overview-tools-test.js` + `overview-tools-concurrency-test.js` | — |
| `src/tools/health-tools.js` | ✅ 好 | `health-tools-test.js` | — |
| `src/tools/workspace-tools.js` | ✅ 好 | `workspace-tools-test.js` | — |
| `src/tools/tree-tools.js` | ✅ 好 | `tree-tools-test.js` | — |
| `src/tools/honesty-engine.js` | ✅ 好 | `honesty-engine-test.js` | — |
| `src/tools/scaffold-detector.js` | ✅ 好 | `scaffold-detector-test.js` | — |

**L5 格式化层（10 个 formatter，0 个零测试）**

| 模块 | 状态 | 说明 | 建议测试文件 |
|------|------|------|-------------|
| `src/cli/formatters/project-map.js` | ✅ 已补充 | `test/project-map-test.js` 覆盖 buildProjectMap full/compact、buildDirectoryTree、countTreeFiles、空图边界 | — |
| `src/cli/formatters/composite-risk.js` | ⚠️ 间接覆盖 | 仅被 CLI E2E 路过 | 可并入 `formatter-direct-test.js` |
| `src/cli/formatters/audit-diff-summary.js` | ⚠️ 间接覆盖 | 仅被 CLI E2E 路过 | 可并入 `formatter-direct-test.js` |
| `src/cli/formatters/repo-summary.js` | ⚠️ 间接覆盖 | `formatter-direct-test.js` 导入了 `buildRepoSummary` 但覆盖浅 | 扩展 `formatter-direct-test.js` |
| `src/cli/formatters/human-formatters.js` | ⚠️ 间接覆盖 | `formatter-direct-test.js` 覆盖了部分分支 | 扩展 `formatter-direct-test.js` |
| `src/cli/formatters/validation-advice.js` | ⚠️ 间接覆盖 | 被 `audit-file-validation-advice-test.js` 间接覆盖 | 扩展 `formatter-direct-test.js` |
| `src/cli/formatters/recommendation-engine.js` | ✅ 有测试 | `test/recommendation-engine-test.js` | — |

---

### 有测试但可继续深化的模块

| 模块              | 测试文件                  | 覆盖状态                                                 |
| ----------------- | ------------------------- | -------------------------------------------------------- |
| `file-index.js` | `file-index-race-test.js` | ✅ race / exclude / rename / boundary（EACCES/AbortController） |
| `watch.js`      | `watch-test.js`         | ✅ 文件变化 / SIGINT / SIGTERM / --run-tests / compact 格式 |
| `repl.js`       | `repl-test.js`          | ✅ executeCommand 全分支 / shutdown 守卫 / 热点 threshold 边界 |
| `cli.js`        | `functionality-test.js` | ✅ mapper 异常 / adapter 异常 / 所有 human 格式化分支 |

### Flaky 根因

| 测试文件 | 根因 | 建议修复 |
| -------- | ---- | -------- |
