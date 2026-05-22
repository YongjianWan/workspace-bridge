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

#### ~~启发式字符串 Import 解析且缺乏全局符号表辅助（架构债）~~ ✅ 已缓解

**状态**：SymbolRegistry fallback 已上线。`resolvers.js` 新增 `trySymbolTable` 策略挂到所有语言策略链末尾，当启发式字符串匹配失败时，通过 `symbolRegistry.lookupUnique()` 按符号名回溯定义文件。

**数据**：

- `src/services/dep-graph/resolvers.js` 中 `resolveImport(fromFile, importPath, ext, root, symbolRegistry = null)` 扩展可选第 5 参数；`_buildContext` 将 `symbolRegistry` 传入 ctx；`trySymbolTable` 提取 importPath 最后一段作为符号名查询全局符号表。
- 向后兼容：不传 `symbolRegistry` 时 `trySymbolTable` 立即 return null，零行为变更。
- 典型收益场景：Java 类名与文件名不一致（如 `Utils.java` 中定义 `class Helper`）。

**剩余风险**：

- 多文件同名符号时 `lookupUnique` 保守返回 null（避免误报），此时仍无法解析。
- 实战基地 3 个项目 unresolved 仍为 0，说明当前代码库中暂无触发场景，fallback 处于"待命"状态。

---

#### 多语言策略链设计的“巨石化”与低内聚（架构与品味债）

**数据**：

- 尽管 `resolvers.js` 通过 `registerResolverConfig` 提供了策略链机制，但所有的语言解析策略（`tryPythonRelative`、`tryPythonAbsolute`、`tryJava`、`tryGoRelative`、`tryGoModule`、`tryRustCrate` 等）竟然统统被揉在同一个大文件 `resolvers.js`（560行）中实现。

**影响**：

- 这是极其妥协的“半吊子插件化”。真正的插件化架构应当让每种语言的 Provider 自行内聚管理 `parse()`、`resolve()` 及其专用 helper。目前这种巨石化设计导致每当新增支持一门新语言（如 Ruby/PHP），开发者必须跑到庞大核心模块 `resolvers.js` 内部去强行塞入私有策略函数，极易产生副作用，违背了开放封闭原则与 L2-8 内聚优先。

**方案**：

- 物理拆分，推行真正的 `LanguageProvider` 插件化架构。
- 将每种语言的 AST parser、依赖提取 regex 和 resolver 策略函数彻底封装到如 `src/services/languages/[lang]/*.js` 各自的内聚包中。
- `resolvers.js` 与 `registry.js` 仅作为核心 Facade 和动态注册中心，保持绝对的轻量与语言无关。

---

#### 全量后处理风暴击穿增量更新性能红利（性能与架构债）

**数据**：

- 在 `src/services/dep-graph/builder.js` 中，后处理阶段（`expandJavaPackageImports` 与 `applyFrameworkImplicitImports`）的机制极其粗暴：只要有任何文件重析（`reParsed > 0`），就会强行对 `this.dg.graph` 中的**所有文件**进行一次全量大遍历，并在后处理中对所有 JS/TS 文件进行正则重新读盘扫视。

**影响**：

- 这直接一巴掌拍死了增量更新的性能红利。即便在 watch/REPL 模式下我们仅仅修改了 1 个文件，仅仅因为这 1 个文件重析，Builder 就必须拉着全项目成千上万个文件重新走一遍高成本的后处理磁盘读写和包索引计算，导致 O(1) 的脏文件局部重建退化成了 O(N) 的全量大后处理。

**方案**：

- 纠正后处理的生命周期归属。将隐式/框架后处理依赖的计算下沉到单个文件的 `analyzeFile` 阶段，并将隐式依赖数据作为 `parseResult` 的一部分随常规依赖一同缓存在 SQLite 数据库中。
- 包依赖的拓扑展开应当基于内存中的包全局映射关系进行“局部受波及点按需展开（Affected-only）”，彻底废除大图全量扫盘。

---

#### Builder 越权越层操控 Analyzer 缓存（架构债）

**数据**：

- 负责图结构和物理组装的 `GraphBuilder` 强行越层认知了上层应用层分析器 `this.dg.analyzer`，并在 `build()` 和 `updateFiles()` 各处直接插手其缓存的清理与预热（如 `this.dg.analyzer._bumpAggregateCache()`，`this.dg.analyzer.precomputeAggregates()`）。

**影响**：

- 暴露出核心组件之间含糊的职责划分和强行反向依赖。`GraphBuilder` 不该对 `GraphAnalyzer` 具有任何静态或动态认知，更不应染指其缓存机制。这使得图构建逻辑与业务分析逻辑高度粘连，阻塞了引擎子组件的后续剥离与演进。

**方案**：

- 解耦 Builder 与 Analyzer。通过在 `DependencyGraph` (Facade) 层注册生命周期事件（如 `onGraphMutated`），由 Facade 去通知 `analyzer` 进行缓存失效，彻底使 `GraphBuilder` 保持为纯粹的数据建图引擎。

---
# 重构方向：数据层、编排层、输出层三层齐改

> 来源：代码审计 22 项问题 + "知识库"架构构想
> 日期：2026-05-20
> 状态：Wave 1（低垂果实）/ O1-O3 / U1 / D1-D3 / D5 / D7-D8 已完成，历史见 [CHANGELOG.md](../../CHANGELOG.md)。本文档只保留剩余待实施项。

---

## 执行摘要

本轮审计发现 22 项问题，全部可归入三个层面：

| 层面               | 核心问题                                                                 | 数量 | 严重度 |
| ------------------ | ------------------------------------------------------------------------ | ---- | ------ |
| **数据层**   | SQLite 是 JSON 替身、三份冗余、watch 不落盘、后处理全图遍历              | 8    | 架构级 |
| **编排层**   | 单回调覆盖、无事件系统、Builder 越权操作 Analyzer、生命周期竞态          | 7    | L1-L2  |
| **输出层**   | 四重 switch、上帝函数、formatter 硬编码、裸数字、23 个空壳命令、线性意面 | 11   | L2-L3  |
| **代码卫生** | 延迟 require 无统一规则、无错误分类体系、registry condition 误导         | 3    | L3     |

**结论**：不是"加功能"，是"换骨架"。三层必须同步重构，任何一层单独做都会产生新的不匹配。

---

## 第一层：数据层——从"缓存"到"知识库"

### 现状诊断

当前数据流已大幅改善（D1-D3 / D4 / D5 / D7-D8 已完成），但仍有残余问题：

1. **数据三份冗余**——`parse_results`(SQLite JSON) → `cache.parseResults`(Map) → `depGraph.graph`(Map) 仍同时存在。`edges` 表和预计算表已落地，但 `parse_results` 尚未 deprecated，新旧双轨并行。
2. **BFS 热路径上有同步磁盘 I/O**——`dep-graph.js isKnownEntryFile()` 里做 `fs.statSync` + `fs.openSync` + `fs.readSync`。`getImpactRadius()` BFS 每访问一个节点就调一次，1329 文件项目 depth=3 时可能触发几百次同步磁盘 I/O。

### 目标架构

```
文件系统 Watcher → 增量解析 → 增量更新 edges → 预计算 → 写入 SQLite
                                          ↑
                              CLI 优先查库 / fallback 内存重建
```

### 具体行动项

| #  | 行动                                   | 文件                            | 说明                                                                               |
| -- | -------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
|    |                                        |                                 |                                                                                    |
| D6 | **消除 parseResults/graph 冗余** | `cache.js` + `dep-graph.js` | 长期：让 `nodes` + `edges` 成为唯一事实源，`parse_results` 表逐步 deprecated |
|    |                                        |                                 |                                                                                    |

### 验收标准

- 大项目（GitNexus 1329 文件）CLI 冷启动时，`buildReverseGraph` 时间为 0ms（edges 从 SQLite 加载）
- watch 进程修改文件后，SQLite `edges` 表在 100ms 内更新完成
- `impact --file foo.js` 在预计算命中时 < 10ms（当前 ~7s）

---

## 第二层：编排层——从"属性回调"到"事件总线"

### 现状诊断

问题：

1. **Builder 越权操作 Analyzer**——`builder.js` 直接调用 `this.dg.analyzer._bumpAggregateCache()`（私有方法），Builder 知道 Analyzer 的内部缓存版本机制
2. **生命周期竞态**——前轮已修 `initialize/shutdown` 竞态和 `processPending` 后台脏写，但根因是"常驻进程 + 单线程事件循环"模型缺乏明确的状态机

### 目标架构

```
Container (状态机)
    ├── EventBus (文件变更 / 图更新 / 诊断调度)
    │       ├── FileIndexWatcher → "file:changed"
    │       ├── DepGraphBuilder → "graph:updated"
    │       └── DiagnosticsEngine → "diagnostics:scheduled"
    ├── ServiceContainer (生命周期管理)
    └── SQLite (唯一状态存储)
```

### 具体行动项

| #  | 行动                               | 文件                             | 说明                                                                                                      |
| -- | ---------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| O4 | **Builder → Analyzer 解耦** | `builder.js` + `analyzer.js` | Builder 完成后 emit `graph:updated`；Analyzer 自己监听并失效缓存，禁止 Builder 直接调 Analyzer 私有方法 |
| O6 | **生命周期状态机**           | `container.js`                 | 显式状态：`idle → initializing → ready → shutting-down → idle`，非法转换 throw                      |
| O7 | **Resolver 缓存**            | `resolvers.js`                 | ✅ 已完成。`_resolverCache` 按 `ext` 缓存 resolver 实例；`_buildContext` 闭包改直接引用，减少 context 对象分配 |

### 验收标准

- watch 模式下，`diagnostics.scheduleCheck` 和 `watch.js` 的 `formatWatchOutput` 同时工作，互不覆盖
- `processPending()` 抛异常不会导致 watch 进程崩溃
- `resolveImport` 在 500 文件项目上的分配次数从 5000 降到 1

---

## 第三层：输出层——从"硬编码 switch"到"注册表"

### 现状诊断

当前输出层**仍有两处硬编码**：

1. `cli.js`：`determineExitCode()` 已从 25 行 switch 压至 4 行 O(1) 契约，U2 核心目标已达成。剩余：13 个命令未返回 `hasFindings`（非阻塞后续工作）。
2. `overview-tools.js`：`buildProjectOverview` 213 行上帝函数，混了图查询、git、分数计算、HTML、I/O
3. `cli.js`：`COMMAND_GUIDES` 和 `COMMANDS` 路由表硬编码

问题：

1. **overview-tools 712 行**——hotspot、stability、trend、HTML dashboard、文件 I/O 全塞在一起
2. **命令指南硬编码外溢**——`COMMAND_GUIDES` 大配表违背 L2-8 内聚优先，应下沉到各 Command 模块

### 目标架构

```
CLI 入口 → 命令注册表（command → handler + formatter + exitCode 契约）
              ↓
        audit-assembler（策展组装，统一 hasFindings 契约）
              ↓
        Formatter 注册表（command → aiFormatter + humanFormatter）
```

### 具体行动项

| #  | 行动                           | 文件                                                       | 说明                                                                                                                                                  |
| -- | ------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
|    |                                |                                                            |                                                                                                                                                       |
| U2 | **ExitCode 契约补完**    | `cli.js`                                                 | ✅ 已完成。10 个命令补全 `hasFindings`（affected-tests / dependencies / dependents / impact / audit-map / audit-overview / diagnostics / stats / tree / workspace-info） |
| U3 | **overview-tools 拆分**  | 新建 `overview-assembler.js`、`dashboard-formatter.js` | `buildProjectOverview` 拆成：数据组装（纯函数）+ HTML 渲染（纯函数）+ 文件 I/O（副作用）                                                            |
| U7 | **audit-assembler 拆分** | `audit-assembler.js`                                     | `assembleDiff` 80 行回调拆分为：`buildDiffEntry`（纯函数）、`buildChangeMetrics`（纯函数）、`buildDiffResult`（纯函数）                       |
| U8 | **commands/ 去壳**       | `commands/`                                              | ✅ 已完成。17 个纯透传命令内联到 `commands/index.js` 注册表；新增 `makeFileCommand` 工厂；删除 17 个壳文件（-312 行）；`cli.js` 从注册表动态读取 `SELF_MANAGED_COMMANDS` |
| U9 | **constants.js 拆分**    | `config/`                                                | ✅ 已完成。拆为 `timeouts.js` / `limits.js` / `defaults.js` / `scoring.js` / `dead-export.js` / `probe.js` / `versions.js` / `streaming.js` / `ai-format.js`；`constants.js` 改为 29 行兼容聚合层 |

### 验收标准

- `determineExitCode` < 5 行
- `overview-tools.js` < 200 行（拆分后）
- 新增命令只需在注册表加一行，不改 `cli.js`

---

## 优先级与依赖关系

```
Layer 1: 数据层
    └── D6（消除 parseResults/graph 冗余）——长期，等 edges 成为唯一事实源

Layer 2: 编排层
    ├── O4（Builder/Analyzer 解耦）——内聚性
    └── O6（状态机）——长期稳定性

Layer 3: 输出层（与数据层无强依赖，可独立推进）
    ├── U2（ExitCode 契约补完）——13 个命令缺 `hasFindings`
    ├── U3（overview-tools 拆分）——最大工作量
    ├── U7（audit-assembler 拆分）
    ├── ~~U8（commands/ 去壳）——已完成~~
    └── U9（constants.js 拆分）——机械重构
```

### 推荐实施顺序（剩余待实施）

**中等工作量**：
- ~~U8（commands/ 去壳）——已完成~~
- O4（Builder/Analyzer 解耦）——EventBus 事件替代直接私有方法调用
- U7（audit-assembler 拆分）——`assembleDiff` 拆为纯函数

**高工作量、长期**：
- D6（消除 parseResults/graph 冗余）——`nodes` + `edges` 成为唯一事实源
- U3（overview-tools 拆分）——712 行上帝函数 → <200 行
- O6（生命周期状态机）——`idle → initializing → ready → shutting-down`

---

## 与现有文档的衔接

| 文档                            | 关系                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `ADR-graph-knowledge-base.md` | Wave 2-3 的数据层详细设计，本文件引用之                   |
| `TECH_DEBT.md`                | 本文件中的 22 项问题应进 TECH_DEBT，按 Wave 分组          |
| `ROADMAP.md`                  | Wave 3 的预计算持久化是 P1 AI 预消化输出的基础设施        |
| `AGENTS.md`                   | 不违反"CLI-only"原则；EventBus 不是协议层，是内部编排机制 |

---

## 一句话

> **数据层重做让知识有地方存，编排层加事件让知识能流动，输出层改注册表让知识能消费。** 三层做完，workspace-bridge 从"每次重建的分析工具"变成"持续积累的知识库"。


#### 弱断言分布 — 占总断言数 ~3.0%

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

#### 时序依赖测试脆弱 — 部分修复

**数据**：测试中存在固定延时，依赖事件循环/文件系统 watch 的时序：


| 文件                                   | 延时             | 场景                         | 状态           |
| ------------------------------------ | -------------- | -------------------------- | ------------ |
| `audit-file-watch-test.js`           | 100ms, 200ms   | 轮询间隔                       | ✅ 合理，保留      |
| `audit-file-watch-test.js`           | 3000ms ×2      | 进程退出安全网                    | ✅ 超时保护，保留    |
| `file-index-race-test.js`            | 20ms           | mock handleFileChange 内部延迟 | ✅ mock 模拟，保留 |
| `overview-tools-concurrency-test.js` | 5ms, 30ms      | mock provider 内部延迟         | ✅ mock 模拟，保留 |
| `watch-sigterm-test.js`              | 5000ms ×2      | 进程退出超时保护                   | ✅ 安全网，保留     |
| `watch-test.js`                      | 3000ms, 5000ms | 进程退出安全网                    | ✅ 超时保护，保留    |


**本轮修复**：4 个文件固定延时改为轮询：`diagnostics-unbounded-timer-test.js`（1200ms×2 → 轮询 checkCount/runningChecks）、`file-index-rename-test.js`（200ms → 轮询 prunedFiles）、`repl-shutdown-test.js`（30ms×2 → 轮询 sigintHandler/closeResolver）、`spawn-ast-test.js`（50ms+60ms → 轮询 killCalls）。

---

#### slow 层测试过重

**数据**：slow 层 27 个测试需 ~100s，其中 `e2e-gitnexus-test.js` 单个测试占 ~34s（全层时间的 ~24%）。

**根因**：GitNexus 项目规模 1329 文件，runner 为每个测试文件创建独立空缓存目录，导致 CLI 冷启动 + 全量建图 + 加载 WASM。

**影响**：slow 层总时间 ~129s，e2e-gitnexus 仍是最重单测试，占比为 24%。

**方案**：

1. 评估 runner 是否可为 e2e-gitnexus 提供预热缓存（复用默认缓存目录而非独立空目录），或拆分为独立 CI job 本地跳过。

---

#### `cli.js` 脑壳上硬编码的命令指南配置外溢（L3级架构与品味债）

**数据**：

- `cli.js` 中维护着高达 100 行的 `COMMAND_GUIDES` 大配表，强行静态指定了各 CLI 命令的 help 信息（when to use, after this 引导语）。
- 而 workspace-bridge 早就已经实现了将各个 Command Module 物理隔离拆分到 `src/cli/commands/` 下并用 `COMMANDS` 注册表挂载的架构。

**影响**：

- 这极大地破坏了“局部内聚”原则（违反 L2-8）。每当开发者增加或调整某个命令的配置说明，都必须在 `src/cli/commands/` 增加命令，同时跑到 `cli.js` 头部塞入冗长重复的配置，不仅增加了文件尺寸，还极其容易在添加新命令时遗漏 guide。

**方案**：

- 命令的 guide/help 元数据应彻底内聚归位到各自的具体 Command 导出文件中。
- `cli.js` 统一从 `COMMANDS` 注册表中动态读取并渲染各命令的 guide。

---

#### 参数解析的双重转换与冗余校验（L3级品味债）

**数据**：

- 在 `cli.js` 参数解析中，诸如 `maxDepth` 等参数会被执行 `parseInt()` 和 `isNaN` 检查。
- 然而在 L4 工具层或下沉的具体算法实现中，由于缺乏对输入类型的信任，再次对相同参数执行了重复的转换及默认值硬编码补全。

**影响**：

- 冗余校验堆砌，违背了“边界消除 > if”及“裸数字归零”原则。
- 应当使参数校验在 CLI 边界处（边界层）一次性清洗 and 类型化完毕，核心业务层完全信任已类型化的配置，轻装上阵，消除重复 of if 防御分支。

---

#### `ProjectContext.inferFileRole` 规则盲区及无状态硬编码匹配 (L3级架构与品味债)

**数据**：

- 在 `src/utils/project-context.js` 中，`inferFileRole` 采用了一组极为脆弱且局限的硬编码正则与字符串猜测链（如检测是否包含 `/test/`，或匹配特定的 `.css`、`.png` 等后缀）来判定文件角色。
- 此外，`inferFileRole` 作为一个纯粹的无状态静态函数被暴露出来，完全无法感知 `ProjectContext` 实例中从 CLI 或 `.workspace-bridge.json` 里传入的动态 `excludeDirs` 规则。

**影响**：

- **匹配规则盲区**：这对非主线（non-mainline）但包含大量代码的非标目录（如 `benchmark/`、`e2e/`、`fixtures/`、`mocks/` 等）根本没有任何感知，导致其默认退化归类为 `library` 并错误地认为其是 `isMainline = true`。这在庞大的中大型项目中引入了 10% 到 15% 的非主线文件分类偏离度，误导下游的依赖计算和代码审查建议。
- **状态不一致**：这导致在需要细粒度多路径排他的场景下，各模块（如 `FileIndex`）单独调用 `inferFileRole` 会产生前后矛盾的判定。

**方案**：

- 重构 `inferFileRole` 使其接受包含当前上下文配置的 dynamic context 实例。
- 扩展 `ROLE_RULES` 注入对 benchmark、e2e 等常规目录的识别；支持从 `.workspace-bridge.json` 中配置动态文件 Role 映射表，彻底消除硬编码规则盲区。

---

#### `FileIndex.shouldExclude` 高频循环中的跨层过度热切判定 (L3级性能债)

**数据**：

- 在 `src/services/file-index.js` 的 `shouldExclude` 核心过滤器中，为了检测文件是否应被排除，其不仅在 `this.baseExcludeDirs` 集合中做线性迭代，甚至在每次高频扫描中都越权嵌套调用了 `this.projectContext.isNotGeneratedFile(filePath)`。
- 而 `isNotGeneratedFile` 会反向完整触发 `classifyFile()`，其内部会无脑完整地跑一遍 `inferFileRole` 下包含数十个正则表达式的匹配链！

**影响**：

- **高频性能崩塌**：在冷启动（cold indexing）和深层扫描时，`shouldExclude` 是被几十万次调用过的极高频热点。这种设计导致引擎为了“看一眼它是不是 generated 目录”，被迫每次都极其昂贵地去跑“它是不是 typescript 测试文件/它是不是 svelte 资产”这种跟目录过滤毫无干系的全套正则匹配。
- **跨层耦合**：这在物理上击穿了职责边界（FileIndex 越层调用了高层语义分类的 ProjectContext），造成了冷启动时严重的 CPU 暴涨和 indexing 延迟，使轻量 CLI 的定位变得非常讽刺。

**方案**：

- 解耦 FileIndex 与 ProjectContext 细节。在 `shouldExclude` 阶段只做纯粹的扁平化目录排他判定（即基于 hash/Set 化的 excluded 目录集做 O(1) 或低成本的前缀匹配）。
- 将复杂的 File Role 判定延迟到文件真正需要被 indexing 甚至直到依赖组装阶段，消灭高频发现循环中的热切正则消耗。

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

#### `resolvers.js` FIFO 缓存粗暴淘汰 (L3级性能债)

**数据**：

- 在 `src/services/dep-graph/resolvers.js` 中，为了防止 stat 缓存无限增长，`_trimCache` 极其粗暴地用 FIFO 形式在 Map 头部截断元素。

**影响**：

- **缓存抖动**：FIFO 抹杀了热点高频缓存的价值。一旦大项目 cold indexing 进行 bulk 依赖解析，最早被 stat 缓存的根配置文件（如 `package.json`、`tsconfig.json`）由于是解析最初创建的，会被粗暴地无脑逐出，随后在下一批解析中又被迫频繁重新读取磁盘 `fs.statSync`，造成严重的缓存抖动和重复 I/O 损耗。

**方案**：

- 将 `_trimCache` 升级为具备高频访问保护的简单 LRU 或 LFU 淘汰算法，避免高频热点配置文件被误杀。

> **GC 压力部分已修复（O7）**：`_resolverCache` 按 `ext` 缓存 resolver 实例，`_buildContext` 闭包改直接引用。详见 CHANGELOG.md [Unreleased]。

---

#### WorkspaceSnapshot 零消费者（架构债）

**数据**：`DependencyGraphView` 目前只被测试用到，`container.snapshot` 零外部消费者。

**方案**：P1 阶段统一让 L4 工具消费 `container.snapshot`，然后 `container.depGraph` 标记 deprecated，消除双线并行。

---

## L3 品味问题（建议修，非债务）


| 位置              | 问题                                                                                                                                     | 优先级 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `js.js`         | `parseJavaScriptAST` ~476 行、`parseJavaScript` regex ~41 行                                                                              | 低   |
| `cli.js`        | 1. `--json` 嵌套深，管道不友好；2. 静态帮助指南 `COMMAND_GUIDES` 硬编码配置外溢，违背 L2-8 内聚优先。                                                                 | 中   |
| `file-index.js` | `this.excludeDirs` 被拼命计算与去重，却**没有任何一处代码消费**，属死代码气味                                                                                     | 低   |
| `file-index.js` | `shouldExclude` 高频核心循环中嵌套调用了无缓存的 `projectContext.isNotGeneratedFile()`，导致对每个扫描到的目录/文件都执行了全套正则匹配与角色判定规则链，大项目 cold index 阶段存在明显 CPU 消耗瓶颈 | 中   |


---

## 文件级雷区地图


| 文件                                      | 行数   | 风险  | 状态                                                                                        |
| --------------------------------------- | ---- | --- | ----------------------------------------------------------------------------------------- |
| `src/tools/overview-tools.js`           | ~711 | 中   | JS/CSS 裸数字已归零（`DASHBOARD_LAYOUT` 常量）；P0 去噪已添加小项目 `architectureAdvice` 抑制；L2-5 schema 不一致源 |
| `cli.js`                                | ~509 | 中   | 命令指南硬编码外溢。                                                                                |
| `src/tools/git-tools.js`                | ~392 | 低   | L2-9 commit range 源                                                                       |
| `src/utils/project-context.js`          | ~634 | 中   | `inferFileRole()` 存在规则盲区与无状态匹配，高频 `shouldExclude` 存在高 CPU 消耗                              |
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


