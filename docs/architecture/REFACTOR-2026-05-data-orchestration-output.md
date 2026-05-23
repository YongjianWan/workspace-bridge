# 重构方向：数据层、编排层、输出层三层齐改

> 来源：代码审计 22 项问题 + "知识库"架构构想
> 日期：2026-05-20
> 更新：2026-05-22
> 状态：Wave 1（低垂果实）/ O1-O3 / U1 / D1-D3 / D5 / D7-D8 / O4 / U8 / U9 已完成，历史见 [CHANGELOG.md](../../CHANGELOG.md)。本文档只保留剩余待实施项。

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
| D6 | **消除 parseResults/graph 冗余** | `cache.js` + `dep-graph.js` | 长期：让 `nodes` + `edges` 成为唯一事实源，`parse_results` 表逐步 deprecated |

### 验收标准

- 大项目（GitNexus 1329 文件）CLI 冷启动时，`buildReverseGraph` 时间为 0ms（edges 从 SQLite 加载）
- watch 进程修改文件后，SQLite `edges` 表在 100ms 内更新完成
- `impact --file foo.js` 在预计算命中时 < 10ms（当前 ~7s）

---

## 第二层：编排层——从"属性回调"到"事件总线"

### 现状诊断

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
| ~~O4~~ | ~~**Builder → Analyzer 解耦**~~ | ~~`builder.js` + `analyzer.js`~~ | ✅ **已完成**。Builder 通过 `emitAsync('graph:built')` 触发；facade 监听并协调 precompute + persistence |
| O6 | **生命周期状态机**           | `container.js`                 | 显式状态：`idle → initializing → ready → shutting-down → idle`，非法转换 throw                      |
| ~~O7~~ | ~~**Resolver 缓存**~~            | ~~`resolvers.js`~~                 | ✅ **已完成**。`_resolverCache` 按 `ext` 缓存 resolver 实例；`_buildContext` 闭包改直接引用 |

### 验收标准

- watch 模式下，`diagnostics.scheduleCheck` 和 `watch.js` 的 `formatWatchOutput` 同时工作，互不覆盖
- `processPending()` 抛异常不会导致 watch 进程崩溃
- `resolveImport` 在 500 文件项目上的分配次数从 5000 降到 1

---

## 第三层：输出层——从"硬编码 switch"到"注册表"

### 现状诊断

当前输出层**仍有两处硬编码**：

1. `cli.js`：`determineExitCode()` 已从 25 行 switch 压至 4 行 O(1) 契约，U2 核心目标已达成。
2. `overview-tools.js`：`buildProjectOverview` 213 行上帝函数，混了图查询、git、分数计算、HTML、I/O
3. `cli.js`：`COMMAND_GUIDES` 和 `COMMANDS` 路由表硬编码

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
| ~~U2~~ | ~~**ExitCode 契约补完**~~    | ~~`cli.js`~~                                                 | ✅ **已完成**。10 个命令补全 `hasFindings` |
| U3 | **overview-tools 拆分**  | 新建 `overview-assembler.js`、`dashboard-formatter.js` | `buildProjectOverview` 拆成：数据组装（纯函数）+ HTML 渲染（纯函数）+ 文件 I/O（副作用）                                                            |
| ~~U7~~ | ~~**audit-assembler 拆分**~~ | ~~`audit-assembler.js`~~                                     | ✅ **已完成**。`assembleDiff` 80 行回调拆分为：`buildDiffEntry`（纯函数）、`buildChangeMetrics`（纯函数）、`buildDiffResult`（纯函数）                       |
| ~~U8~~ | ~~**commands/ 去壳**~~       | ~~`commands/`~~                                              | ✅ **已完成**。17 个纯透传命令内联到 `commands/index.js` 注册表 |
| ~~U9~~ | ~~**constants.js 拆分**~~    | ~~`config/`~~                                                | ✅ **已完成**。拆为 9 个子文件；`constants.js` 改为 29 行兼容聚合层 |

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
    ├── ~~O4（Builder/Analyzer 解耦）——已完成~~
    └── O6（状态机）——长期稳定性

Layer 3: 输出层（与数据层无强依赖，可独立推进）
    ├── ~~U2（ExitCode 契约补完）——已完成~~
    ├── U3（overview-tools 拆分）——最大工作量
    ├── ~~U7（audit-assembler 拆分）——已完成~~
    ├── ~~U8（commands/ 去壳）——已完成~~
    └── ~~U9（constants.js 拆分）——已完成~~
```

### 推荐实施顺序（剩余待实施）

**中等工作量**：
- ~~O4（Builder/Analyzer 解耦）——已完成~~
- ~~U7（audit-assembler 拆分）——已完成~~

**高工作量、长期**：
- D6（消除 parseResults/graph 冗余）——`nodes` + `edges` 成为唯一事实源
- U3（overview-tools 拆分）——712 行上帝函数 → <200 行
- O6（生命周期状态机）——`idle → initializing → ready → shutting-down`

---

## 与现有文档的衔接

| 文档                            | 关系                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `ROADMAP.md`                  | 长期路线与期望成功标准（含 SQLite 知识库架构决策背景）    |
| `TECH_DEBT.md`                | 活跃债务清单，按 L1/L2/L3 分级                            |
| `SESSION.md`                  | 下一步任务与波次计划，本文档的精简执行视图                |
| `ROADMAP.md`                  | 长期路线与期望成功标准                                    |
| `AGENTS.md`                   | 不违反"CLI-only"原则；EventBus 不是协议层，是内部编排机制 |

---

## 一句话

> **数据层重做让知识有地方存，编排层加事件让知识能流动，输出层改注册表让知识能消费。** 三层做完，workspace-bridge 从"每次重建的分析工具"变成"持续积累的知识库"。
