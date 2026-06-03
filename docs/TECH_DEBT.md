# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

> 当前无活跃的 L1 Blocker。

## L2 债务（阻塞演进或导致结果不可信）

> 当前无活跃的 L2 债务。

---

> **当前活跃债务总览**：L1 Blocker **0** | L2 债务 **0** | 架构债务 **2** | L3 品味问题 **0** | 合计 **2 项**

## 架构债务（不阻塞功能，但阻塞演进速度）

#### 弱断言分布 — 占总断言数 ~2.3%

**数据**：


| 弱断言模式                                      | 数量      | 风险等级 | 说明                                                          |
| ------------------------------------------ | ------- | ---- | ----------------------------------------------------------- |
| `typeof x === 'string'/'number'/'boolean'` | ~10 → 0 已清理 | 低    | 核心 schema 字段（severity/impactCount/affectedTestsCount 等）已升级为语义验证；剩余边缘字段维持 `typeof` 防御性检查         |
| `.status === 0`                            | 1       | 中    | `java-parsers-test.js` 环境检测逻辑 `isJavalangAvailable()`，非测试断言 |
| `!== null/undefined`                       | ~20     | 低    | 存在性检查，属防御性验证，不纳入弱断言统计                                       |
| `strictEqual(result.ok, true/false)`       | ~48     | 低    | 深层嵌套防御性检查，风险低，不纳入弱断言统计                                      |
| **合计弱断言（需修复）**                             | **~10** | —    | 从 ~44 处降至 ~10 处（仅余 `typeof` 型 schema 契约检查）                   |


---

#### 测试类型分布失衡


| 类型                      | 文件数   | 占比   | 评估                                                     |
| ----------------------- | ----- | ---- | ------------------------------------------------------ |
| 单元测试（直接 `require src/`） | ~101  | ~77% | 比例良好                                                   |
| 集成测试（`spawn`/`runCli`）  | ~26   | ~20% | 已补充 `cli-integration-test.js`                          |
| 混沌/模糊测试                 | 0     | 0%   | 暂缓（CLI 工具）                                             |
| 并发/竞争测试                 | 4 个文件 | ~3%  | 存在（race、concurrency）                                   |
| 端到端测试                   | 5 个文件 | ~3%  | 已补充 `fp_regression_security.js` + `fp_regression_dead_exports.js` 归档已知误报场景 |


> 注：分类有重叠（如 `cache-concurrency-test.js` 既是集成测试也是并发测试），占比基于总文件数 133 独立计算，不互斥。

**根因**：80% 单元测试 + 弱断言 ~10 处（~2.3%）。CLI 管道回归保护已覆盖主要命令。

**影响**：CLI 入口的选项解析、路由分发、错误边界、格式化器选择等关键路径的回归保护已建立；主要剩余缺口是端到端测试（5 个文件，~3%），已补充 fp_regression 档案。

**方案**：

1. ✅ 弱断言清理已完成：10 处核心 `typeof` 检查已升级为枚举值 / `Number.isFinite()` / 非负范围验证。

---

#### slow 层测试过重

**数据**：slow 层 54 个测试需 ~250s，其中 `e2e-gitnexus-test.js` 单个测试占 ~23s（全层时间的 ~9%）。

**根因**：GitNexus 项目规模 1329 文件，CLI 冷启动 + 全量建图 + 加载 WASM。

**影响**：slow 层总时间 ~250s。预热缓存已部署，e2e-gitnexus 已使用 `SHARED_CACHE_DIR`，占比从 24% 降至 9%。

**方案**：

1. runner 预热缓存机制已部署，slow 层测试启动时复制预热缓存，跳过冷启动建图。
2. ✅ slow 层头部拆分已完成：`cli-integration-test.js` → `cli-integration-core-test.js` + `cli-integration-edge-test.js`；`formatter-e2e-test.js` → `formatter-e2e-summary-test.js` + `formatter-e2e-others-test.js`。runner.js `KNOWN_SLOW_PATTERNS` 已同步。

---

#### 【已归档】框架环路白名单语义识别缺失 (Heuristic Whitelisting) [已完成]

**数据**：`src/services/dep-graph/analyzer.js:isLikelyFrameworkLegitimateCycle`

**根因**：当前采用基于文件个数阈值 (`Vue <= 6`、`React <= 4`、`Java <= 3`) 以及路径正则关键字模糊匹配的 heuristic heuristics，强行在输出前抑制框架特定模式（如 Vue store-router-view，Java Annotation/Serializer 对）的循环依赖误报。这属于典型的“用数字魔法掩盖语义缺失”。

**影响**：属于脆弱的黑盒补丁。一旦框架层面的物理依赖拓扑结构深度增加（例如 Vue 单次调用链多引入 1 个文件，或者微服务框架更改包结构），白名单便直接失效；同时对自定义架构中的合法非编译时循环（如 TypeScript type-only imports）缺乏细粒度识别。

**方案 (Debt)**：
1. **中期目标**：在 `resolvers` 和 `parsers` 层引入语义及类型级别分析（AST Type Imports Classification）。 [已完成]
2. 在图构建或解析时，若发现 import 仅被用于类型系统（`import type` 且无 runtime 值引用），或者属于 Interface/Implementation 分离的多态引用，在建图时即抹除该物理边，从而在数据源头消除合法“非运行时”循环，替换掉顶层的长度数字魔法。 [已完成]

---

#### “默认宿主”效应 — 热点文件无限责任膨胀

**根因**：新需求没有明确的第二选择时，就塞进最像的现有文件。facade 拆出 builder/analyzer/query 后，协调职责没有向上移交到 container 或专门编排层。

| 文件 | 行数 | 变更次数 | 症状 | 根因 | 状态 |
|------|------|----------|------|------|------|
| `src/services/dep-graph.js` | ~502 | 60 | fromSchema 工厂 + bus 协调 precompute/persistence 已提取到 `orchestrator.js`；但 `loadGraph()` ~99 行、入口检测 `isKnownEntryFile()` ~55 行、`getFrameworkHint()` ~21 行、构造函数 `graph:updated` 监听仍未提取。orchestrator.js 成为新的无限责任宿主（330 行，混入工厂/持久化/状态机/编排）。 | facade 协调职责**部分**上移 | ⚠️ **部分完成**：`orchestrator.js` 已收容 `registerGraphBuiltHandler` / `savePrecomputed` / `restorePrecomputed` / `bootstrapFromSchema` / `initializeDepGraph`；但 facade 仍有 ~175 行协调逻辑，且引入了 facade ↔ orchestrator 循环依赖 |
| `src/services/container.js` initialize() | ~100/556 | 42 | git HEAD / aggregate fallback / phaseTimes / strictCwd 全混在一起 | 无 pipeline/hook 机制 | ✅ **已完成**：引入 `_runPipeline()` 10 阶段显式管道 + `_runStage()` 自动计时与错误包装 |
| `src/services/file-index.js` | ~592 | 39 | DEFAULT_EXCLUDE_DIRS 硬编码 23 个目录 | 排除语义未收敛到单一模块 | ✅ **已收敛**：`DEFAULT_EXCLUDE_DIRS` 已移至 `exclude-patterns.js`，`shouldExcludeBase()` 统一排除逻辑 |

**方案**：
1. ✅ `dep-graph.js`：`fromSchema` / `bus.on('graph:built')` 协调逻辑 / `loadGraph` 预计算恢复 / `_savePrecomputed` 已提取到 `src/services/orchestrator.js`。
2. ✅ `container.js`：`_initDepGraph` 决策树已提取到 `orchestrator.initializeDepGraph()`。
3. ✅ **阶段 1 已完成**（2026-06-02）：`isKnownEntryFile()` + `getFrameworkHint()` + `_entryFileCache` + `graph:updated` 监听已提取到 `src/services/dep-graph/entry-detector.js`，消除了两者间的内容扫描重复代码。facade 公开 API 零变化。
4. ✅ **阶段 2 已完成**（2026-06-02）：`loadGraph()` ~99 行已提取到 `src/services/dep-graph/loader.js`，dep-graph.js 保留 thin wrapper。冷热启动双路径验证通过。
5. ✅ **阶段 3 已完成**（2026-06-02）：facade ↔ orchestrator 循环依赖已打破。
  - `DG_STATES` + `GraphStateMachine` 下沉到 `src/services/dep-graph/state-machine.js`。
  - `registerGraphBuiltHandler` + `savePrecomputed` + `restorePrecomputed` 收容到 `src/services/dep-graph/persistence.js`。
  - dep-graph.js 不再静态依赖 orchestrator.js；`bootstrapFromSchema` 通过显式 `DependencyGraphClass` 参数消除反向运行时 require。
  - `node cli.js cycles --cwd .` 报告 **cyclesCount = 0**。

**下一步（A-2 已收尾，剩余为独立债务）**：
- `DG_STATES` 及生命周期 helper（`_resetState` / `_startBuilding` / `_finishBuilding` / `_startUpdating` / `_finishUpdating`）暂留 facade：builder.js constructor 接收 `depGraph` 实例并直接调用 `this.dg._resetState()` 等。若将状态机提取到 orchestrator.js，builder.js 需改依赖注入模式（接收 orchestrator 而非 depGraph），改动面大。当前风险收益比不支持进一步提取。


#### 【已归档】cli.js 入口膨胀 — 已完成

**数据**：`cli.js` 从 ~626 行精简至 ~260 行。

**状态**：✅ 已完成。
- `src/cli/validate-args.js`：提取 `parseCliArgs()` + `sanitizeCliPaths()` + `classifyError()`
- `src/cli/route-formatter.js`：提取 `writeLargeJson()` + `determineExitCode()` + `formatCliResult()` + `buildErrorResponse()`
- `src/cli/bootstrap.js`：提取 `UV_THREADPOOL_SIZE` + `installFatalHandlers()`
- `cli.js` 仅保留命令分发、帮助文本、`runCliInProcess()` 进程内入口、`main()` 顶层错误边界。导出与行为 100% 向后兼容。

---

## L3 品味问题（建议修，非债务）

> 当前无活跃的 L3 品味问题。

---

## 文件级雷区地图


| 文件                                      | 行数   | 风险  | 状态                                                                                        |
| --------------------------------------- | ---- | --- | ----------------------------------------------------------------------------------------- |
| `src/tools/overview-tools.js`           | ~80 | 低   | U3 拆分已完成：数据组装进 `overview-assembler.js`，HTML 渲染与 I/O 进 `dashboard-formatter.js`；薄编排层仅剩 `buildProjectOverview` |
| `cli.js`                                | ~260 | **低** | **入口拆分完成**：路由/验证/格式化/进程配置已分别提取到 `validate-args.js` / `route-formatter.js` / `bootstrap.js`；cli.js 仅保留命令分发与错误边界 | |
| `src/tools/git-tools.js`                | ~392 | 低   | L2-9 commit range 源                                                                       |
| `src/utils/project-context.js`          | ~634 | 低   | `inferFileRole()` 已状态化并消除规则盲区；`shouldExclude` CPU 消耗已修复                                |
| `src/utils/stack-detectors/detect.js`   | ~443 | 低   | stack-detector 检测子模块                                                                      |
| `src/utils/stack-detectors/commands.js` | ~639 | 低   | stack-detector 命令子模块                                                                      |
| `src/services/dep-graph.js`             | ~657 | **高** | **无限责任宿主**：facade 仍含 DG_STATES + fromSchema + bus 协调，60次变更 |
| `src/services/container.js`             | ~556 | **高** | **initialize() 上帝方法**：~100行混入 git/aggregate/phaseTimes/strictCwd，42次变更 |
| `src/services/graph-db.js`              | ~560 | 低   | loadAll/saveAll/saveIncremental 均已 TABLE_SCHEMA 注册表驱动；新增表只需注册一次 |


---

## 测试覆盖缺口

### 零专属测试模块清单

- `src/tools/overview-curator.js`：`test/overview-curator-test.js` 覆盖全部导出。

**L5 格式化层（10 个 formatter，6 个间接覆盖）**


| 模块                                            | 状态      | 说明                                                                                                | 建议测试文件                         |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- | ------------------------------ |
| `src/cli/formatters/repo-summary.js`          | ⚠️ 间接覆盖 | `formatter-direct-test.js` 导入了 `buildRepoSummary` 但覆盖浅                                            | 扩展 `formatter-direct-test.js`  |
| `src/cli/formatters/human-formatters.js`      | ⚠️ 间接覆盖 | `formatter-direct-test.js` 覆盖了部分分支                                                                | 扩展 `formatter-direct-test.js`  |
| `src/cli/formatters/validation-advice.js`     | ⚠️ 间接覆盖 | 被 `audit-file-validation-advice-test.js` 间接覆盖                                                     | 扩展 `formatter-direct-test.js`  |


---

### 有测试但可继续深化的模块


| 模块                      | 测试文件                                                                   | 覆盖状态                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `workspace-snapshot.js` | `dep-tools-test.js` `overview-tools-test.js` `project-map-test.js`（试点） | ⚠️ 仅验证了 backward-compat（`snapshot.graph` 替代手工 mock），`getConfidence`/`knownBlindSpots`/`getSelfAwarenessSummary`/`basedOn` 零断言覆盖 |


### Flaky 根因


| 测试文件           | 根因                           | 建议修复                                                            |
| -------------- | ---------------------------- | --------------------------------------------------------------- |
| `repl-test.js` | runner.js 串行执行时偶发失败；单独运行稳定通过 | 已记录于 SESSION.md §已知陷阱；若遇失败先重跑确认，再单独 `node test/repl-test.js` 验证 |



> CLI Dogfooding 历史缺陷已全部修复，并按"修复即删"铁律完成清理（历史详情归档于 [CHANGELOG.md](../CHANGELOG.md) [Unreleased]）。
> 仍在的已知限制与陷阱详见 [ROADMAP.md](../ROADMAP.md) §已知限制。
