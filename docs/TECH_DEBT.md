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

> **当前活跃债务总览**：L1 Blocker **0** | L2 债务 **0** | 架构债务 **4** | L3 品味问题 **1** | 合计 **5 项**

## 架构债务（不阻塞功能，但阻塞演进速度）

#### 弱断言分布 — 占总断言数 ~2.3%

**数据**：


| 弱断言模式                                      | 数量      | 风险等级 | 说明                                                          |
| ------------------------------------------ | ------- | ---- | ----------------------------------------------------------- |
| `typeof x === 'string'/'number'/'boolean'` | ~10     | 低    | 带消息参数的 schema 契约检查，维持现状（改为值验证会导致 schema 变更时测试大面积失效）         |
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

1. 弱断言清理继续推进（~10 处 `typeof` 型 schema 契约检查维持现状）。

---

#### slow 层测试过重

**数据**：slow 层 54 个测试需 ~250s，其中 `e2e-gitnexus-test.js` 单个测试占 ~23s（全层时间的 ~9%）。

**根因**：GitNexus 项目规模 1329 文件，CLI 冷启动 + 全量建图 + 加载 WASM。

**影响**：slow 层总时间 ~250s。预热缓存已部署，e2e-gitnexus 已使用 `SHARED_CACHE_DIR`，占比从 24% 降至 9%。

**方案**：

1. runner 预热缓存机制已部署，slow 层测试启动时复制预热缓存，跳过冷启动建图。
2. 剩余空间：`formatter-e2e-test.js`（~45s）和 `cli-integration-test.js`（~22s）是新的头部测试，可考虑进一步拆分或改为非 spawn 测试。

---

#### Builder/Analyzer/Query 状态机（架构债 — 部分完成）

**剩余**：
- 明确状态机（`idle -> initializing -> ready -> updating -> ready`）尚未实现，当前仅靠 `_updating` 布尔锁做重入防护。
- Query 理论上只读快照，但缺少运行时跨状态调用拦截。


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

- `src/tools/overview-curator.js`：`test/overview-curator-test.js` 覆盖全部导出。

**L5 格式化层（10 个 formatter，6 个间接覆盖）**


| 模块                                            | 状态      | 说明                                                                                                | 建议测试文件                         |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- | ------------------------------ |
|                          |
| `src/cli/formatters/repo-summary.js`          | ⚠️ 间接覆盖 | `formatter-direct-test.js` 导入了 `buildRepoSummary` 但覆盖浅                                            | 扩展 `formatter-direct-test.js`  |
| `src/cli/formatters/human-formatters.js`      | ⚠️ 间接覆盖 | `formatter-direct-test.js` 覆盖了部分分支                                                                | 扩展 `formatter-direct-test.js`  |
| `src/cli/formatters/validation-advice.js`     | ⚠️ 间接覆盖 | 被 `audit-file-validation-advice-test.js` 间接覆盖                                                     | 扩展 `formatter-direct-test.js`  |
|                                                             | —                              |


---

### 有测试但可继续深化的模块


| 模块                      | 测试文件                                                                   | 覆盖状态                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
|                                                          |
| `workspace-snapshot.js` | `dep-tools-test.js` `overview-tools-test.js` `project-map-test.js`（试点） | ⚠️ 仅验证了 backward-compat（`snapshot.graph` 替代手工 mock），`getConfidence`/`knownBlindSpots`/`getSelfAwarenessSummary`/`basedOn` 零断言覆盖 |


### Flaky 根因


| 测试文件           | 根因                           | 建议修复                                                            |
| -------------- | ---------------------------- | --------------------------------------------------------------- |
| `repl-test.js` | runner.js 串行执行时偶发失败；单独运行稳定通过 | 已记录于 SESSION.md §已知陷阱；若遇失败先重跑确认，再单独 `node test/repl-test.js` 验证 |


