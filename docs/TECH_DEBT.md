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

#### 全量后处理风暴击穿增量更新性能红利（性能与架构债）

**数据**：

- 在 `src/services/dep-graph/builder.js` 中，后处理阶段（`expandJavaPackageImports` 与 `applyFrameworkImplicitImports`）的机制极其粗暴：只要有任何文件重析（`reParsed > 0`），就会强行对 `this.dg.graph` 中的**所有文件**进行一次全量大遍历，并在后处理中对所有 JS/TS 文件进行正则重新读盘扫视。

**影响**：

- 这直接一巴掌拍死了增量更新的性能红利。即便在 watch/REPL 模式下我们仅仅修改了 1 个文件，仅仅因为这 1 个文件重析，Builder 就必须拉着全项目成千上万个文件重新走一遍高成本的后处理磁盘读写和包索引计算，导致 O(1) 的脏文件局部重建退化成了 O(N) 的全量大后处理。

**方案**：

- 纠正后处理的生命周期归属。将隐式/框架后处理依赖的计算下沉到单个文件的 `analyzeFile` 阶段，并将隐式依赖数据作为 `parseResult` 的一部分随常规依赖一同缓存在 SQLite 数据库中。
- 包依赖的拓扑展开应当基于内存中的包全局映射关系进行“局部受波及点按需展开（Affected-only）”，彻底废除大图全量扫盘。

---

#### 弱断言分布 — 占总断言数 ~2.3%

**数据**（本轮修复后）：


| 弱断言模式                                      | 数量      | 风险等级 | 说明                                                          |
| ------------------------------------------ | ------- | ---- | ----------------------------------------------------------- |
| `typeof x === 'string'/'number'/'boolean'` | ~35     | 低    | 带消息参数的 schema 契约检查，维持现状（改为值验证会导致 schema 变更时测试大面积失效）         |
| `.status === 0`                            | 1       | 中    | `java-parsers-test.js` 环境检测逻辑 `isJavalangAvailable()`，非测试断言 |
| `!== null/undefined`                       | ~20     | 低    | 存在性检查，属防御性验证，不纳入弱断言统计                                       |
| `strictEqual(result.ok, true/false)`       | ~48     | 低    | 深层嵌套防御性检查，风险低，不纳入弱断言统计                                      |
| **合计弱断言（需修复）**                             | **~35** | —    | 从 ~44 处降至 ~35 处（仅余 `typeof` 型 schema 契约检查）                  |


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
| 端到端测试                   | 3 个文件 | ~2%  | **严重不足**（functionality/formatter-e2e/integration-core） |


> 注：分类有重叠（如 `cache-concurrency-test.js` 既是集成测试也是并发测试），占比基于总文件数 131 独立计算，不互斥。

**根因**：80% 单元测试 + 弱断言已从 ~~76 处降至 ~35 处（~~2.3%）。CLI 管道回归保护已有 `cli-integration-test.js` 覆盖 `audit-file`/`dead-exports`/`tree`/`impact`/`affected-tests`/`dependencies`/`dependents`/`cycles`，但 `analysis-test.js` 曾长期失败而未被发现（dead-exports 部分错误地以自身仓库为 `--cwd`，而自身仓库 deadExports=0）。

**影响**：CLI 入口的选项解析、路由分发、错误边界、格式化器选择等关键路径的回归保护已建立；主要剩余缺口是端到端测试（仅 3 个文件，2%）。

**方案**：

1. 弱断言清理继续推进（~35 处 `typeof` 型 schema 契约检查维持现状）。

---

#### 测试代码重复率过高（mock depGraph）— 违反 L2-7

**数据**：

- **99 处内联 mock `depGraph`** 构造 — **部分收敛**：`audit-map-test.js` 公共方法已提取为 `BASE_MOCK_METHODS`，文件从 592 行降至 ~564 行；graph 数据字面量仍内联
- **新增发现**：`overview-tools-test.js` 的 mock depGraph 只有 6 个文件，但断言了复杂的 overview 行为。当 `buildProjectOverview` 添加小项目抑制逻辑时，测试立刻失败——mock 数据无法代表真实项目规模，说明 mock 测试与真实行为之间存在脱节。

**根因**：没有提取测试 fixture 工厂函数；mock 数据规模与真实项目差异过大。

**影响**：修改 `depGraph` mock 接口需改多处；新增基于项目规模的业务逻辑时，mock 测试容易误报或漏报。

**方案**：

1. `audit-map-test.js` graph 数据字面量进一步提取为配置表驱动的工厂调用
2. 基于规模的断言改为条件断言（如 `overview-tools-test.js` 本轮已做的调整），或提供多种规模的 fixture

---

#### slow 层测试过重

**数据**：slow 层 27 个测试需 ~100s，其中 `e2e-gitnexus-test.js` 单个测试占 ~34s（全层时间的 ~24%）。

**根因**：GitNexus 项目规模 1329 文件，runner 为每个测试文件创建独立空缓存目录，导致 CLI 冷启动 + 全量建图 + 加载 WASM。

**影响**：slow 层总时间 ~129s，e2e-gitnexus 仍是最重单测试，占比为 24%。

**方案**：

1. 评估 runner 是否可为 e2e-gitnexus 提供预热缓存（复用默认缓存目录而非独立空目录），或拆分为独立 CI job 本地跳过。

---

#### 参数解析的双重转换与冗余校验（L3级品味债）

**数据**：

- 在 `cli.js` 参数解析中，诸如 `maxDepth` 等参数会被执行 `parseInt()` 和 `isNaN` 检查。
- 然而在 L4 工具层或下沉的具体算法实现中，由于缺乏对输入类型的信任，再次对相同参数执行了重复的转换及默认值硬编码补全。

**影响**：

- 冗余校验堆砌，违背了“边界消除 > if”及“裸数字归零”原则。
- 应当使参数校验在 CLI 边界处（边界层）一次性清洗 and 类型化完毕，核心业务层完全信任已类型化的配置，轻装上阵，消除重复 of if 防御分支。

---

#### 模板字符串“按行切分”及解构导出提取瘫痪 (L3级 JavaScript 正则 fallback 模式功能债)

**数据**：

- 在 `src/services/dep-graph/parsers/js.js` 中，当 `@babel/parser` 不可用时会退化至 `parseJavaScript` 的正则表达式 fallback 模式：
  - 在 `sanitizeForRegex` 阶段，其通过 `.split('\n')` 将整个文件拆分为行数组，并分别在每行内单独执行 `stripQuotedStrings(line, '`')`。
  - 在 `extractExportsWithRegex` 阶段，针对 `export const { a, b } = obj` 这类解构导出，其使用 `declarationExportRegex = /export\s+(?:async\s+)?(function|class|const|let|var)\s+(\w+)/g` 进行捕获，只去提取紧随声明关键字后的下一个单词 `\w+`。

**影响**：

- **多行模板误报**：如果一个文件中含有跨越多行的模板字符串 `，`split('\n') `会无情地将这个闭合的模板字符串斩断成无数截。处于中间或两端的单`  根本无法闭合，导致 `stripQuotedStrings` 完美罢工。多行模板字符串内部写的任何类似 require/import/export 的伪代码，都会被系统高高兴兴地捕获为真实的模块依赖，造成极高误报。
- **解构导出瘫痪**：由于 `declarationExportRegex` 只提取 `\w+`，在解构导出（如 `export const { foo }`）下，它匹配到了 `{` 便直接被正则抛弃，导致解构导出的符号在 fallback 模式下 100% 丢失漏报。
- **调用链失效**：在 fallback 模式下，`functionRecords` 被粗暴地直接丢回空数组 `[]`，让整个引擎引以为豪的 call-chain 调用链影响分析直接在此文件下变相瘫痪。

**方案**：

- 废弃 `sanitizeForRegex` 中愚蠢的 `split('\n')` 按行过滤。直接对整块 text 内容执行基于单状态机或更高级的非行切割式全局正则替换。
- 扩展 `declarationExportRegex` 兼容解构导出匹配，或者在 fallback 模式检测到解构导出时优雅地抛出 accuracy-downgrade 警告而非自信假装没发生。

---



#### WorkspaceSnapshot 零消费者（架构债）

**数据**：`DependencyGraphView` 目前只被测试用到，`container.snapshot` 零外部消费者。

**方案**：P1 阶段统一让 L4 工具消费 `container.snapshot`，然后 `container.depGraph` 标记 deprecated，消除双线并行。

---

## L3 品味问题（建议修，非债务）


| 位置              | 问题                                                                                                                                     | 优先级 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `js.js`         | `parseJavaScriptAST` ~476 行、`parseJavaScript` regex ~41 行                                                                              | 低   |
| `cli.js`        | `--json` 嵌套深，管道不友好                                                                                                               | 中   |
| `file-index.js` | `this.excludeDirs` 被拼命计算与去重，却**没有任何一处代码消费**，属死代码气味                                                                                     | 低   |


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

- `src/tools/overview-curator.js`：⚠️ 零专属测试，被 `overview-tools-test.js` 间接覆盖，无独立断言。

**L5 格式化层（10 个 formatter，6 个间接覆盖）**


| 模块                                            | 状态      | 说明                                                                                                | 建议测试文件                         |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- | ------------------------------ |
| `src/cli/formatters/project-map.js`           | ✅ 已补充   | `test/project-map-test.js` 覆盖 buildProjectMap full/compact、buildDirectoryTree、countTreeFiles、空图边界 | —                              |
| `src/cli/formatters/composite-risk.js`        | ⚠️ 间接覆盖 | 仅被 CLI E2E 路过                                                                                     | 可并入 `formatter-direct-test.js` |
| `src/cli/formatters/audit-diff-summary.js`    | ⚠️ 间接覆盖 | 仅被 CLI E2E 路过                                                                                     | 可并入 `formatter-direct-test.js` |
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


