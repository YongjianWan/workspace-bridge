# 重构方向：数据层、编排层、输出层三层齐改

> 来源：代码审计 22 项问题 + "知识库"架构构想  
> 日期：2026-05-20  
> 状态：方向确认，待排期实施

---

## 执行摘要

本轮审计发现 22 项问题，全部可归入三个层面：

| 层面 | 核心问题 | 数量 | 严重度 |
|------|---------|------|--------|
| **数据层** | SQLite 是 JSON 替身、三份冗余、watch 不落盘、后处理全图遍历 | 8 | 架构级 |
| **编排层** | 单回调覆盖、无事件系统、Builder 越权操作 Analyzer、生命周期竞态 | 7 | L1-L2 |
| **输出层** | 四重 switch、上帝函数、formatter 硬编码、裸数字、23 个空壳命令、线性意面 | 11 | L2-L3 |
| **代码卫生** | 延迟 require 无统一规则、无错误分类体系、registry condition 误导 | 3 | L3 |

**结论**：不是"加功能"，是"换骨架"。三层必须同步重构，任何一层单独做都会产生新的不匹配。

---

## 第一层：数据层——从"缓存"到"知识库"

### 现状诊断

当前数据流是**反向的**：

```
文件系统 → AST 解析 → 内存 Map → 顺便写 SQLite（全量清表重写）
```

问题：
1. **SQLite 是 JSON 序列化器，不是数据库**——`parse_results.imports` 是 `JSON.stringify` 后的 TEXT 列。没有 `edges` 表，没有 JOIN，没有 `WITH RECURSIVE` 图遍历。`loadAll()` = 全表 SELECT + 逐行 `JSON.parse`；`saveAll()` = 全表 DELETE + 逐行 `JSON.stringify` + INSERT。SQLite 被当作"多了 ACID 事务的 JSON 文件"使用。
2. **数据三份冗余**——`parse_results`(SQLite JSON 字符串) → `cache.parseResults`(Map) → `depGraph.graph`(Map)，同一语义物化三次。内存是主存储，SQLite 只是序列化格式。
3. **watch 增量更新不落盘**——`updateFiles()` 后内存图已更新，但 SQLite 仍是旧数据。watch 崩溃 = 丢失全部增量。shutdown 之前的新 parseResults、新 edges 全在内存里。
4. **后处理改 1 个文件触发全图遍历**——`expandJavaPackageImports` 和 `applyFrameworkImplicitImports` 在 `updateFiles` 末尾无条件全量运行。改一个 `.js` 文件也要遍历全图所有 Java 文件。
5. **BFS 热路径上有同步磁盘 I/O**——`dep-graph.js isKnownEntryFile()` 里做 `fs.statSync` + `fs.openSync` + `fs.readSync`。`getImpactRadius()` BFS 每访问一个节点就调一次，1329 文件项目 depth=3 时可能触发几百次同步磁盘 I/O。

### 目标架构

```
文件系统 Watcher → 增量解析 → 增量更新 edges → 预计算 → 写入 SQLite
                                          ↑
                              CLI 优先查库 / fallback 内存重建
```

### 具体行动项

| # | 行动 | 文件 | 说明 |
|---|------|------|------|
| D1 | **新增 `nodes` + `edges` 表** | `graph-db.js` | `nodes` 统一文件级元数据；`edges` 存储 import + implicit-framework + package 三类边 |
| D2 | **增量写入 edges** | `graph-db.js` | `saveIncremental()` 追加 edges 的 dirty/delete 追踪 |
| D3 | **加载 edges 恢复内存图** | `dep-graph.js` | 新增 `loadGraph()`：从 SQLite SELECT 恢复 graph + reverseGraph，跳过 `buildReverseGraph()` |
| D4 | **watch 自动 save** | `builder.js` | `updateFiles()` finally 块中 `await cache.save()`，让 watch 成为热缓存守护者 |
| D5 | **后处理按需触发** | `builder.js` | `updateFiles()` 中按文件扩展名过滤 postProcessPhases（改 .js 不跑 Java package 逻辑） |
| D6 | **消除 parseResults/graph 冗余** | `cache.js` + `dep-graph.js` | 长期：让 `nodes` + `edges` 成为唯一事实源，`parse_results` 表逐步 deprecated |
| D7 | **预计算表** | `graph-db.js` | 新增 `precomputed_impact`、`precomputed_tests`、`precomputed_aggregates`、`metrics`、`test_map` |
| D8 | **写入预计算** | `builder.js` | `updateFiles()` 完成后，对变更文件重新预计算 impact/tests，写入 SQLite |

### 验收标准

- 大项目（GitNexus 1329 文件）CLI 冷启动时，`buildReverseGraph` 时间为 0ms（edges 从 SQLite 加载）
- watch 进程修改文件后，SQLite `edges` 表在 100ms 内更新完成
- `impact --file foo.js` 在预计算命中时 < 10ms（当前 ~7s）

---

## 第二层：编排层——从"属性回调"到"事件总线"

### 现状诊断

当前编排是**单属性直接赋值**：

```js
this.fileIndex.onFileChanged = (filePath) => { ... };  // 只能挂一个回调
this.fileIndex.onPendingProcessed = async (files) => { ... };  // 同上
```

问题：
1. **单回调覆盖**——watch.js 的 `registerWatchCallback` 直接 `fileIndex.onFileChanged = ...` 覆盖了 container.js 注册的 `diagnostics.scheduleCheck`，watch 模式下 linter 诊断完全失效
2. **Builder 越权操作 Analyzer**——`builder.js` 直接调用 `this.dg.analyzer._bumpAggregateCache()`（私有方法），Builder 知道 Analyzer 的内部缓存版本机制
3. **生命周期竞态**——本轮已修 `initialize/shutdown` 竞态和 `processPending` 后台脏写，但根因是"常驻进程 + 单线程事件循环"模型缺乏明确的状态机
4. **debounce 不 catch async**——`setTimeout(() => this.processPending(), ...)` 没 await 没 catch，抛异常 = unhandled rejection

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

| # | 行动 | 文件 | 说明 |
|---|------|------|------|
| O1 | **引入轻量 EventBus** | 新建 `event-bus.js` | 不是 npm 包，是 30 行的 `on/emit/off`，支持多监听器 + 错误隔离（一个 listener 抛错不影响其他） |
| O2 | **替换单属性回调** | `file-index.js` | `onFileChanged` / `onPendingProcessed` 属性改成 EventBus 事件 |
| O3 | **修复 watch 覆盖 diagnostics** | `container.js` + `watch.js` | container 和 watch 都通过 EventBus 监听 `file:changed`，不再互相覆盖 |
| O4 | **Builder → Analyzer 解耦** | `builder.js` + `analyzer.js` | Builder 完成后 emit `graph:updated`；Analyzer 自己监听并失效缓存，禁止 Builder 直接调 Analyzer 私有方法 |
| O5 | **debounce 异常安全** | `file-index.js` | `setTimeout` 回调中 `this.processPending().catch(...)`，防止 unhandled rejection |
| O6 | **生命周期状态机** | `container.js` | 显式状态：`idle → initializing → ready → shutting-down → idle`，非法转换 throw |
| O7 | **Resolver 缓存** | `resolvers.js` | `_buildContext` + `createResolver` 按 `(ext, root)` 缓存，避免 5000 次重复分配 |

### 验收标准

- watch 模式下，`diagnostics.scheduleCheck` 和 `watch.js` 的 `formatWatchOutput` 同时工作，互不覆盖
- `processPending()` 抛异常不会导致 watch 进程崩溃
- `resolveImport` 在 500 文件项目上的分配次数从 5000 降到 1

---

## 第三层：输出层——从"硬编码 switch"到"注册表"

### 现状诊断

当前输出层是**四重硬编码**：

1. `cli.js`：`determineExitCode()` 25 行 switch-case 偷窥各命令私有 schema
2. `human-formatters.js`：`formatAi()` 中 audit-file 的 depth 处理是硬编码的 if-else
3. `overview-tools.js`：`buildProjectOverview` 213 行上帝函数，混了图查询、git、分数计算、HTML、I/O
4. `cli.js`：`COMMAND_GUIDES` 和 `COMMANDS` 路由表硬编码

问题：
1. **overview-tools 712 行**——hotspot、stability、trend、HTML dashboard、文件 I/O 全塞在一起
2. **硬编码 200**——overview-tools L667 直接写死 `200`，而同文件 L623 用了 `DEFAULTS.SMALL_PROJECT_MAX_MAINLINE`
3. **四重 switch 污染**——CLI 框架知道每个子命令的内部数据结构

### 目标架构

```
CLI 入口 → 命令注册表（command → handler + formatter + exitCode 契约）
              ↓
        audit-assembler（策展组装，统一 hasFindings 契约）
              ↓
        Formatter 注册表（command → aiFormatter + humanFormatter）
```

### 具体行动项

| # | 行动 | 文件 | 说明 |
|---|------|------|------|
| U1 | **Formatter 注册表** | `human-formatters.js` | `FORMATTERS = { 'audit-file': { ai: formatAiAuditFile, human: formatHumanAuditFile, markdown: ..., summary: ... } }`。消灭 `formatMarkdown`/`formatSummary`/`formatAi`/`formatHuman` 四个巨型 switch ——同一个命令的逻辑分散在 4 个函数里是面条式配置表 |
| U2 | **ExitCode 契约固化** | `cli.js` | 所有命令必须返回 `{ ok, hasFindings }`，`determineExitCode` 从 25 行 switch 压到 1 行 |
| U3 | **overview-tools 拆分** | 新建 `overview-assembler.js`、`dashboard-formatter.js` | `buildProjectOverview` 拆成：数据组装（纯函数）+ HTML 渲染（纯函数）+ 文件 I/O（副作用） |
| U4 | **裸数字归零** | `overview-tools.js` | L667 `200` → `DEFAULTS.SMALL_PROJECT_MAX_MAINLINE` |
| U5 | **shouldExcludeCli 提取** | 新建 `exclude-patterns.js` | dep-graph.js、file-index.js 等共用同一套 exclude 逻辑，消除复制粘贴 |
| U6 | **normalizeFilePath 统一** | `path.js` | cache.js 和 dep-graph.js 的 `normalizeFilePath` 合并为单一实现 |
| U7 | **audit-assembler 拆分** | `audit-assembler.js` | `assembleDiff` 80 行回调拆分为：`buildDiffEntry`（纯函数）、`buildChangeMetrics`（纯函数）、`buildDiffResult`（纯函数） |
| U8 | **commands/ 去壳** | `commands/` | 23 个文件里 80% 是 5 行透传壳。提取为 `COMMAND_REGISTRY` Map，命令名 → handler 直接映射。只在需要特殊逻辑（如 audit-file --watch）时才保留独立文件 |
| U9 | **constants.js 拆分** | `config/` | 按职责拆为 `timeouts.js`、`limits.js`、`scoring.js`、`dead-export.js`、`probe.js`。当前 269 行 8 个命名空间混在一个文件里 |

### 验收标准

- `determineExitCode` < 5 行
- `overview-tools.js` < 200 行（拆分后）
- 新增命令只需在注册表加一行，不改 `cli.js`

---

## 优先级与依赖关系

```
Layer 1: 数据层（必须先做，否则编排层和输出层建在沙地上）
    ├── D4（watch 自动 save）——立即收益，改动最小
    ├── D1-D3（edges 表 + loadGraph）——基础 schema
    ├── D5（按需 post-process）——性能收益
    └── D7-D8（预计算表）——最大查询加速

Layer 2: 编排层（数据层稳定后做，否则事件总线没有可靠的数据源）
    ├── O5（debounce catch）——真 bug，随时修
    ├── O1-O3（EventBus + 修复覆盖）——解除 watch 和 diagnostics 的冲突
    ├── O4（Builder/Analyzer 解耦）——内聚性
    └── O6（状态机）——长期稳定性

Layer 3: 输出层（可以独立做，与数据层无强依赖）
    ├── U2（ExitCode 契约）——已部分完成（本轮 audit-assembler）
    ├── U4-U6（裸数字、exclude、normalize）——顺手修
    ├── U1（Formatter 注册表）——消灭 switch
    └── U3（overview-tools 拆分）——最大工作量，放最后
```

### 推荐实施顺序

**Wave 1（1 周内，低 hanging fruit）**：
- D4（watch 自动 save）
- O5（debounce catch）
- U2（ExitCode 契约已部分完成）
- U4-U6（裸数字、exclude、normalize）

**Wave 2（2-3 周，架构核心）**：
- D1-D3（edges 表 + loadGraph）
- O1-O3（EventBus + 修复覆盖）
- D5（按需 post-process）

**Wave 3（3-4 周，性能质变）**：
- D7-D8（预计算表 + 写入）
- D6（消除冗余，长期）
- U1（Formatter 注册表）
- U3（overview-tools 拆分）

---

## 与现有文档的衔接

| 文档 | 关系 |
|------|------|
| `ADR-graph-knowledge-base.md` | Wave 2-3 的数据层详细设计，本文件引用之 |
| `TECH_DEBT.md` | 本文件中的 22 项问题应进 TECH_DEBT，按 Wave 分组 |
| `ROADMAP.md` | Wave 3 的预计算持久化是 P1 AI 预消化输出的基础设施 |
| `AGENTS.md` | 不违反"CLI-only"原则；EventBus 不是协议层，是内部编排机制 |

---

## 一句话

> **数据层重做让知识有地方存，编排层加事件让知识能流动，输出层改注册表让知识能消费。** 三层做完，workspace-bridge 从"每次重建的分析工具"变成"持续积累的知识库"。
