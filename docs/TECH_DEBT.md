# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

无。

---

## L2 债务（阻塞演进或导致结果不可信）

#### `incremental-diff.js` / `human-formatters.js` 契约守卫缺失 — 写测试时发现

**数据**：`collectRelatedFiles` 假设 `getImpactRadius` 返回对象数组（`{ file }`），`formatHuman` 假设 `buildRepoSummary` 返回的 `summary` 含 `honesty` 字段。两者均无格式校验或类型守卫。

**根因**：内部 API 契约靠"人脑同步"，没有 schema 校验或断言。`getImpactRadius` 若改为字符串数组（历史版本曾如此），`entry.file` 变为 `undefined`，impact 文件静默丢失；`buildRepoSummary` 若删除 `honesty` 字段，`formatHuman` 的 `result.summary.honesty?.disclaimer` 永远为假，`note` 行永久消失。

**影响**：不直接产生当前 bug（实现与假设暂时一致），但任何一方的重构都可能引发**静默数据丢失**，测试无法 catch（因为测试也复制了相同假设）。

**方案**：
1. 在 `collectRelatedFiles` 入口处加 `Array.isArray(impact) && impact.every(e => typeof e === 'object')` 断言（dev 模式），或统一用 `depGraph` 公共方法替代直接遍历返回值
2. `buildRepoSummary` 与 `formatHuman` 之间建立最小 schema 契约（如 `const REQUIRED_SUMMARY_FIELDS = ['severity', 'counts', 'honesty', 'nextSteps']`），`formatHuman` 前置校验

---


## 架构债务（不阻塞功能，但阻塞演进速度）

#### CLI 设计缺陷迫使 skill 膨胀（根本问题）

**数据**：SKILL.md 已从 395 行精简至 ~264 行，仍厚于理想状态（50 行）。命令分层混乱：20+ 命令中 L4 原始查询（`dead-exports`/`cycles`/`unresolved`/`dependencies`/`dependents`/`stats`/`tree`）被 L1 aggregate 命令（`audit-summary`/`audit-file`）完全覆盖，但作为一等公民暴露；`health` 与 `audit-summary.health` **数据完全重合**；`dependents` 是 `impact` 的子集。AI 不知道该用 aggregate 还是 raw。

**根因**：**不是"文档写太长"，是 CLI 把策展工作外包给 AI**。具体：
- `--format ai` broken → AI 被迫自己筛 235 行 raw JSON
- `health` / `dependents` 等命令分层混乱 → L4 原始查询与 L1 aggregate 混在同一层级暴露，AI 被迫学"什么时候用哪个"，文档被迫当说明书
- exit code 反模式 → AI 拿到 exit=1 第一反应"命令挂了"，文档被迫解释"exit code 语义"

**影响**：SKILL.md ~264 行里 ~200 行是"怎么绕过 CLI 缺陷"的补偿性指南。擦的是不该存在的屁股。

**更深层的定位修正**：workspace-bridge 不是"AI 的替代方案"，而是**"所有 AI（IDE + 终端）都需要的基础设施"**——就像数据库索引。IDE AI（Cursor/Claude）没有预建的全局 import/export 图、影响半径计算、死代码 AST 检测——它们只有 LSP（单文件）和 RAG（语义检索）。真正危险的不是"AI IDE 做得更好"，而是"**用户以为 AI IDE 已经做了，所以不需要你**"。

**方案**：病根全在 CLI 出口质量。优先级：
1. 修 `--check-regression` crash → "跨时间基线"核心价值可用
2. 修 exit code → CI / AI agent 稳定调用
3. 修 `--format ai`（depth/token-budget 生效）→ AI 直接消费策展结论
4. **分层暴露**：`--help` 按 L1/L2/L3/L4 分组输出；`health` 改为 `audit-summary --health-only` 别名 + deprecation；L4 命令（`dead-exports`/`cycles` 等）保留但标记为 debug 层级
7. 届时 SKILL.md 可缩至 ~80 行：L1 命令表 + L2 场景指南 + 版本锁定

#### cli.js 厚门面（部分缓解）

**数据**：~974 行（`formatHuman` 等 formatter 逻辑已提取至 `human-formatters.js` ~720 行），剩余 `runCommand` ~350 行 switch 覆盖 20+ 命令。

**影响**：新增命令仍需改 `runCommand` 路由和 `human-formatters.js`，但 formatter 逻辑不再耦合在 cli.js 中。

**方案**：`runCommand` 可进一步拆分为 `src/cli/commands/` 目录下的独立处理器文件，每个命令一个模块。当前已足够，暂缓。

---

## 测试代码债务（117 文件 / ~470 函数）

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
| 单元测试（直接 `require src/`） | 97 | 83% | 比例良好 |
| 集成测试（`spawn`/`runCli`） | 24 | 20% | **比例偏低** |
| 混沌/模糊测试 | 0 | 0% | **严重缺失**（CLI 工具暂缓） |
| 并发/竞争测试 | 5 个文件 | 4% | 存在（race、concurrency） |
| 端到端测试 | 3 个文件 | 3% | **严重不足**（仅 functionality/formatter-e2e/integration-core） |

**根因**：80% 单元测试 + 弱断言已从 ~76 处降至 ~44 处（~3.0%）。当前主要缺口是 CLI 管道回归保护不足，不是"函数返回了结构正确的对象"。

**影响**：CLI 入口的选项解析、路由分发、错误边界、格式化器选择等关键路径缺乏回归保护。

**方案**：
1. 新增 3–4 个 CLI 集成测试，覆盖 `audit-file`、`dead-exports`、`tree`、`impact` 等目前仅靠单元测试的命令
2. 弱断言清理与集成测试补齐并行进行

---

#### 测试代码重复率过高（mock depGraph）— 违反 L2-7

**数据**：
- **99 处内联 mock `depGraph`** 构造 — **部分收敛**：`audit-map-test.js` 公共方法已提取为 `BASE_MOCK_METHODS`，文件从 592 行降至 544 行；graph 数据字面量仍内联

**根因**：没有提取测试 fixture 工厂函数。

**影响**：修改 `depGraph` mock 接口需改多处（方法已提取，数据字面量仍分散）。

**方案**：
1. `audit-map-test.js` graph 数据字面量进一步提取为配置表驱动的工厂调用

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

#### 模块级副作用与硬编码魔数

**数据**：
- `audit-diff-incremental-test.js:20`：硬编码 `timeout: 60000`
- `java-parsers-test.js:10`：硬编码 `timeout: 15000`
- `runner.js`：硬编码 `TIMEOUT_MS = 120000`
- `analysis-test.js`：硬编码 fixture 路径 `fixture-temp/test-module.js`

**根因**：测试代码未遵循 L2-6"裸数字归零"和 L1-2"异常安全"原则。

**影响**：
- 超时阈值无 rationale，不同文件各自拍脑袋定
- 硬编码 fixture 路径可能与真实文件冲突

**方案**：
1. 所有超时阈值提取到 `test/test-constants.js`
2. fixture 路径使用 `path.join(os.tmpdir(), 'wb-test-' + random)` 隔离

## L3 品味问题（建议修，非债务）

| 位置                  | 问题                                                              | 优先级 |
| --------------------- | ----------------------------------------------------------------- | ------ |
| `git-tools.js`      | `getChangedFiles()` 手动字符级解析；`--since` 已新增，字符级解析债务仍在 | 低     |
| `overview-tools.js` | `renderOverviewDashboard` 中 HTML/CSS 裸数字                    | 低     |
| `js.js`             | `parseJavaScriptAST` ~476 行、`parseJavaScript` regex ~41 行 | 低     |
| `path.js`           | `hasPathSegment` 语义陷阱：只取 segment 最后一级                | 低     |
| `workspace-tools.js` / `SKILL.md` | `parserAvailability.skipped: true` 命名语义陷阱：`skipped` 暗示"文件被跳过"，实际为"tree-sitter WASM 无 package.json 初始化路径"，AGENTS.md 和 SKILL.md 都要专门解释 | 低     |
| `cli.js` / `formatters` | `--json` 嵌套深、体积大，`--compact` 后仍有 400 行，管道场景不友好；默认 human-readable 输出缺乏实战打磨。**根因是 CLI 不输出预消化报告，迫使 skill 变厚补偿** | 中     |
| `cli.js` / `constants.js` | `--compact` 500 文件阈值无 rationale，拍脑袋定。239 文件项目 `audit-map --compact` 已输出 29KB；应按**输出 Token 数**或 `--budget-tokens` 决定压缩策略 | 中     |
| `SKILL.md` / `package.json` | npx 版本未锁定，`npx workspace-bridge-cli` 可能自动升级到不兼容版本，schema 变更后 AI 解析直接崩 | 中     |
| `human-formatters.js` | 同一命令在 4-5 个 formatter 函数中重复判断：`audit-summary` 出现在 formatHuman/formatSummary/formatMarkdown/formatAi/formatJsonl 的 switch 中各一次 | 中     |

---

## 文件级雷区地图

| 文件                                        | 行数 | 风险         | 状态                                                      |
| ------------------------------------------- | ---- | ------------ | --------------------------------------------------------- |
| `src/services/dep-graph.js`               | ~1582 | **高** | 核心引擎类，AGENTS.md 已确认"内聚优先、不物理拆分"        |
| `src/tools/overview-tools.js`             | ~868 | 中           | 裸数字已归零（JS侧），HTML/CSS 裸数字仍在；L2-5 schema 不一致源 |
| `cli.js`                                  | ~974 | 中           | `formatHuman` 已提取至 `human-formatters.js`，剩余 `runCommand` 路由；L2-8/L2-9 参数路由源 |
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

**L4 工具层（12 个工具，5 个零专属测试，本轮补充 2 个）**

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

**L5 格式化层（9 个 formatter，1 个零测试 + 5 个间接覆盖不完整，本轮补充 2 个）**

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
