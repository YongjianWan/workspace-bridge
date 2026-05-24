# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

> 当前无活跃的 L1 Blocker。

## L2 债务（阻塞演进或导致结果不可信）

> 当前无活跃的 L2 债务。
>
>

---

## 架构债务（不阻塞功能，但阻塞演进速度）

#### 弱断言分布 — 占总断言数 ~2.3%

**数据**（本轮修复后）：


| 弱断言模式                                      | 数量      | 风险等级 | 说明                                                          |
| ------------------------------------------ | ------- | ---- | ----------------------------------------------------------- |
| `typeof x === 'string'/'number'/'boolean'` | ~10     | 低    | 带消息参数的 schema 契约检查，维持现状（改为值验证会导致 schema 变更时测试大面积失效）         |
| `.status === 0`                            | 1       | 中    | `java-parsers-test.js` 环境检测逻辑 `isJavalangAvailable()`，非测试断言 |
| `!== null/undefined`                       | ~20     | 低    | 存在性检查，属防御性验证，不纳入弱断言统计                                       |
| `strictEqual(result.ok, true/false)`       | ~48     | 低    | 深层嵌套防御性检查，风险低，不纳入弱断言统计                                      |
| **合计弱断言（需修复）**                             | **~10** | —    | 从 ~44 处降至 ~10 处（仅余 `typeof` 型 schema 契约检查）                   |


**本轮增强**：

- `js-ast-dynamic-import-test.js` / `js-ast-new-url-test.js` / `js-regex-cjs-test.js`：`assert(result.x === y)` → `assert.strictEqual(result.x, y)`
- `language-support-matrix-test.js`：`assert(!matrix.java)` → `assert.strictEqual(matrix.java, undefined)`
- `regression-test.js`：`assert.ok(result.status === 1)` → `assert.strictEqual(result.status, 1)`
- `tree-tools-test.js`：`assert.ok(tree.imports)` → `assert.ok(Array.isArray(tree.imports))`
- `parser-schema-contract-test.js`：`typeof === 'object'` 补 `!== null` 防御
- `honesty-engine-test.js`：3 处无消息 `assert.ok(text.includes(...))` 补消息参数

---

#### 测试类型分布失衡


| 类型                      | 文件数   | 占比   | 评估                                                     |
| ----------------------- | ----- | ---- | ------------------------------------------------------ |
| 单元测试（直接 `require src/`） | ~101  | ~77% | 比例良好                                                   |
| 集成测试（`spawn`/`runCli`）  | ~26   | ~20% | 已补充 `cli-integration-test.js`                          |
| 混沌/模糊测试                 | 0     | 0%   | 暂缓（CLI 工具）                                             |
| 并发/竞争测试                 | 4 个文件 | ~3%  | 存在（race、concurrency）                                   |
| 端到端测试                   | 3 个文件 | ~2%  | **缺口仍在**，但 CLI 核心主线已有 spawn 级护体；暂不追加 PowerShell/WASM 专项 E2E |


> 注：分类有重叠（如 `cache-concurrency-test.js` 既是集成测试也是并发测试），占比基于总文件数 131 独立计算，不互斥。

**根因**：80% 单元测试 + 弱断言已从 ~~76 处降至 ~10 处（~~2.3%）。CLI 管道回归保护已有 `cli-integration-test.js` 覆盖 `audit-file`/`dead-exports`/`tree`/`impact`/`affected-tests`/`dependencies`/`dependents`/`cycles`，但 `analysis-test.js` 曾长期失败而未被发现（dead-exports 部分错误地以自身仓库为 `--cwd`，而自身仓库 deadExports=0）。

**影响**：CLI 入口的选项解析、路由分发、错误边界、格式化器选择等关键路径的回归保护已建立；主要剩余缺口是端到端测试（仅 3 个文件，2%）。

**方案**：

1. 弱断言清理继续推进（~10 处 `typeof` 型 schema 契约检查维持现状）。

---

#### 测试代码重复率过高（mock depGraph）— 违反 L2-7

**数据**：

- **内联 mock `depGraph`** 构造 — **大部分收敛**：`audit-map-test.js` 已完成试点迁移（`BASE_MOCK_METHODS` 删除，全面改用 `createMockDepGraph`）；剩余 7 个文件中的 ~23 处 `new DependencyGraph` + 手动赋值待分批迁移
- `test/test-helpers.js` 已建立 `createMockDepGraph` + `GraphFixtures` 工厂基础设施
- **生产侧根因已解**：`DependencyGraph.fromSchema()` 静态工厂 + 构造函数 DI（`packageJson`/`entryFiles` 可选注入）已落地；`createMockDepGraph({ mode: 'instance' })` 已桥接为生产工厂消费者，彻底消灭属性篡改反模式

**根因**：没有提取测试 fixture 工厂函数；mock 数据规模与真实项目差异过大。

**影响**：修改 `depGraph` mock 接口需改多处；新增基于项目规模的业务逻辑时，mock 测试容易误报或漏报。

**方案**：

1. ✅ 基础设施完成；剩余文件按「每轮 2~3 个」渐进迁移
2. 基于规模的断言改为条件断言（如 `overview-tools-test.js` 本轮已做的调整），或提供多种规模的 fixture

---

#### slow 层测试过重

**数据**：slow 层 36 个测试需 ~100s，其中 `e2e-gitnexus-test.js` 单个测试占 ~34s（全层时间的 ~24%）。

**根因**：GitNexus 项目规模 1329 文件，runner 为每个测试文件创建独立空缓存目录，导致 CLI 冷启动 + 全量建图 + 加载 WASM。

**影响**：slow 层总时间 ~129s，e2e-gitnexus 仍是最重单测试，占比为 24%。

**方案**：

1. 评估 runner 是否可为 e2e-gitnexus 提供预热缓存（复用默认缓存目录而非独立空目录），或拆分为独立 CI job 本地跳过。

---

#### Builder/Analyzer/Query 状态机（架构债 — 部分完成）

**已完成**：
- Builder 与 Analyzer 缓存已彻底解耦：`_cachedCycles`、`_cycleCount`、`_scanContentCache`、`_scanPatternCache` 全部下沉到 `GraphAnalyzer` 内部，Builder 不再直接篡改 Analyzer 字段。
- Builder 只通过 `graph:updated` / `graph:built` 事件与 Analyzer 通信；Analyzer 只响应事件并自主维护缓存。
- Wave 4（2026-05-24）：CLI/REPL 边界层所有 `container.depGraph` 穿透已收敛到 `DependencyGraphView` facade（`container.snapshot.graph`），数据层与编排层边界进一步清晰化。

**剩余**：
- 明确状态机（`idle -> initializing -> ready -> updating -> ready`）尚未实现，当前仅靠 `_updating` 布尔锁做重入防护。
- Query 理论上只读快照，但缺少运行时跨状态调用拦截。

---

#### ✅ createMockDepGraph stub 模式重复 20+ 方法（测试债）— 已修复

**根因**：测试中缺少统一的 stub 适配层，导致 `createMockDepGraph` 在 stub 模式下手工复制大量方法签名。

**修复**（2026-05-24）：
- 新增 `_createStubDepGraph` 共享工厂，使用 `Proxy` 自动拦截所有 `DependencyGraphView` 方法调用，仅 23 个有语义默认值的方法进入 `semanticDefaults` Map。
- `createMockDepGraph({ mode: 'stub' })` 和 `makeMockSnapshot` 的 `defaultStubs` 统一调用 `_createStubDepGraph`，消灭两处重复代码。
- 未知方法自动安全兜底（`() => []`），未来 `DependencyGraphView` 新增方法无需手工更新 stub。

**验证**：`npm run test:fast` **99/99 PASS**。

---

#### audit-diff 与 audit-summary JSON schema 不同步（L3级品味债）

**根因**：两个输出由不同 assembler/formatter 维护，缺少共享 schema contract 与一致性测试。

**影响**：

- 消费端需要写两套适配逻辑，增加用户负担。
- 合约回归难以被单测捕获（字段名/结构漂移）。

**方案**：

1. 抽出共享 schema contract（最小核心字段集合）。
2. 增加跨命令 schema 一致性测试（至少校验核心字段集合）。

## L3 品味问题（建议修，非债务）


| 位置              | 问题                                                                                                                                     | 优先级 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `cli.js`        | `--json` 嵌套深，管道不友好                                                                                                               | 中   |


---

## 文件级雷区地图


| 文件                                      | 行数   | 风险  | 状态                                                                                        |
| --------------------------------------- | ---- | --- | ----------------------------------------------------------------------------------------- |
| `src/tools/overview-tools.js`           | ~80 | 低   | U3 拆分已完成：数据组装进 `overview-assembler.js`，HTML 渲染与 I/O 进 `dashboard-formatter.js`；薄编排层仅剩 `buildProjectOverview` |
| `cli.js`                                | ~509 | 中   | `--json` 嵌套深，管道不友好                                                                        |
| `src/tools/git-tools.js`                | ~392 | 低   | L2-9 commit range 源                                                                       |
| `src/utils/project-context.js`          | ~634 | 低   | `inferFileRole()` 已状态化并消除规则盲区；`shouldExclude` CPU 消耗已修复                                |
| `src/utils/stack-detectors/detect.js`   | ~443 | 低   | stack-detector 检测子模块                                                                      |
| `src/utils/stack-detectors/commands.js` | ~639 | 低   | stack-detector 命令子模块                                                                      |
| `src/services/file-index.js`            | ~547 | 低   | 行数稳定，内部通过 `FileIndexBuilder` / `ChangeTracker` 实现认知拆分                                     |


---

## 测试覆盖缺口

### 零专属测试模块清单

- ✅ `src/tools/overview-curator.js`：已补充 `test/overview-curator-test.js`，覆盖 `buildOverviewSummary` / `buildCycleRefactorSuggestions` / `buildCouplingSplitSuggestions` / `calculateCoupling` 全部导出。

**L5 格式化层（10 个 formatter，6 个间接覆盖）**


| 模块                                            | 状态      | 说明                                                                                                | 建议测试文件                         |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- | ------------------------------ |
| `src/cli/formatters/project-map.js`           | ✅ 已补充   | `test/project-map-test.js` 覆盖 buildProjectMap full/compact、buildDirectoryTree、countTreeFiles、空图边界 | —                              |
| `src/cli/formatters/composite-risk.js`        | ✅ 已补充   | `formatter-direct-test.js` 新增 7 组 `buildCompositeRisk` 测试                                         | —                              |
| `src/cli/formatters/audit-diff-summary.js`    | ✅ 已补充   | `formatter-direct-test.js` 新增 `buildAuditDiffSummary` + `classifyChangeType` 测试                    | —                              |
| `src/cli/formatters/repo-summary.js`          | ⚠️ 间接覆盖 | `formatter-direct-test.js` 导入了 `buildRepoSummary` 但覆盖浅                                            | 扩展 `formatter-direct-test.js`  |
| `src/cli/formatters/human-formatters.js`      | ⚠️ 间接覆盖 | `formatter-direct-test.js` 覆盖了部分分支                                                                | 扩展 `formatter-direct-test.js`  |
| `src/cli/formatters/validation-advice.js`     | ⚠️ 间接覆盖 | 被 `audit-file-validation-advice-test.js` 间接覆盖                                                     | 扩展 `formatter-direct-test.js`  |
| `src/cli/formatters/recommendation-engine.js` | ✅ 有测试   | `test/recommendation-engine-test.js`                                                              | —                              |


---

### 有测试但可继续深化的模块


| 模块                      | 测试文件                                                                   | 覆盖状态                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `file-index.js`         | `file-index-race-test.js`                                              | ✅ race / exclude / rename / boundary（EACCES/AbortController）                                                                    |
| `watch.js`              | `watch-test.js`                                                        | ✅ 文件变化 / SIGINT / SIGTERM / --run-tests / compact 格式                                                                            |
| `repl.js`               | `repl-test.js`                                                         | ✅ executeCommand 全分支 / shutdown 守卫 / 热点 threshold 边界                                                                            |
| `cli.js`                | `functionality-test.js`                                                | ✅ mapper 异常 / adapter 异常 / 所有 human 格式化分支                                                                                       |
| `workspace-snapshot.js` | `dep-tools-test.js` `overview-tools-test.js` `project-map-test.js`（试点） | ⚠️ 仅验证了 backward-compat（`snapshot.graph` 替代手工 mock），`getConfidence`/`knownBlindSpots`/`getSelfAwarenessSummary`/`basedOn` 零断言覆盖 |


### Flaky 根因


| 测试文件           | 根因                           | 建议修复                                                            |
| -------------- | ---------------------------- | --------------------------------------------------------------- |
| `repl-test.js` | runner.js 串行执行时偶发失败；单独运行稳定通过 | 已记录于 SESSION.md §已知陷阱；若遇失败先重跑确认，再单独 `node test/repl-test.js` 验证 |


