# 架构与数据流

这份文档讲 workspace-bridge 的代码是怎么串起来的：一条命令进来，经过哪些模块，每一步产出什么，模块之间靠什么契约衔接。读者是要改核心模块（文件索引、缓存、建图、分析、输出）的开发者或 AI agent。

这里只写结构，不写状态。功能现状、测试基线和开发规则以 [AGENTS.md](../AGENTS.md) 为准，开放问题见 [TECH_DEBT.md](./TECH_DEBT.md)，路线见 [ROADMAP.md](../ROADMAP.md)。文中引用的函数名和文件名就是事实来源。和代码对不上时以代码为准，并顺手把这份文档改对。

## 术语

| 词 | 含义 |
|---|---|
| 解析（parse） | 把单个文件变成结构化记录：它 import 了哪些字符串、导出了什么、有哪些函数。结果取决于文件内容和文件自身的路径（部分语言要靠路径推包名），与其他文件无关；缓存按路径存放、按内容哈希校验 |
| 定位（resolve） | 把 import 字符串（如 `./util`、`com.foo.Bar`）对应到工作区里的具体文件。结果取决于整个文件集合，新增一个文件就可能改变别的文件的定位结果 |
| 图 | `DependencyGraph.graph`，一个 Map。键是图键，值叫"节点"，即这个文件的解析与定位结果，主要字段：`imports`（定位成功的目标图键列表）、`importRecords`（每条 import 的明细，含原字符串 `source`、目标 `resolved`、定位方式 `resolutionMethod`、层级 `tier`（`tier1` 为直接定位，`tier2` 为按符号名猜测等间接定位）和数值置信度 `confidence`（0 到 1））、`exports`/`exportRecords`、`functionRecords`、`parseMode`（`ast`/`regex`/`none`）及其原因 `parseModeReason`、`package`、`frameworkHint` |
| 边 | 节点 A 的 `imports` 里有 B，就是一条 A→B 的边 |
| 反向图 | `DependencyGraph.reverseGraph`，文件 → 依赖它的文件列表，由正向边推出 |
| 图键 | `normalizePathKey()`（`src/utils/path.js`）的输出：绝对路径、正斜杠，Windows 上再转小写。图、缓存和路径比较都用它 |
| 显示路径 | 文件在磁盘上的原始写法，存在节点的 `originalPath` 里，输出时用 `_displayPath()` 取回 |
| 目录角色 | `.workspace-bridge.json` 和内置规则给目录的分类：`active`（主线）、`reference`、`archive`、`generated`。见 `ProjectContext.classifyFile()`（`src/utils/project-context.js`），主线即 `isMainline` |
| 台账（Ledger） | `src/services/ledger.js`，一次运行中记录"丢了什么、没做成什么"的对象。CLI、缓存、文件索引和图共用同一个实例，输出时经 `buildWarnings()` 变成 `warnings[]`（第 7 节） |
| 原因码 | 台账记录的类型，登记在同一文件的 `REASON_CODES` 里，如 `file-too-large`、`depth-truncated`。每个原因码带默认严重度，取值为 `high`、`medium`、`low` 三档 |
| 降级信号 | 告诉消费者结果不完全可信的字段：`warnings[]`、`dataQuality: 'degraded'`、各条发现（如死导出）上的 `confidence`（取 `high`/`medium`/`low`，与 importRecords 的数值置信度是两回事） |
| 三种"快照" | 本文区分三样东西：**工作区视图** `container.snapshot`（内存中的只读对象，第 2 节）；**分析快照** `analysis_snapshots` 表里存的完整命令结果（第 6 节）；**字段快照** `test/fixtures/json-contract.json` 锁定的 JSON 字段结构（第 7 节） |
| 常量对象 | `TIMEOUTS`、`DEFAULTS`、`LIMITS` 等分别定义在 `src/config/` 下的同名小写文件里，统一由 `src/config/constants.js` 导出；建图内部的 `CONFIG` 在 `src/services/dep-graph/shared.js` |

## 总览

一条普通命令（以 `audit-overview` 为例）的路径如下：

```
cli.js main()
  └─ runCliInProcess()                 参数校验、建台账、算缓存目录
       ├─ new ServiceContainer()
       ├─ container.initialize()       按阶段顺序启动（第 2 节）
       │    ├─ workspaceRoot           确定工作区根目录
       │    ├─ cache                   WorkspaceCache.load()，读 SQLite
       │    ├─ projectContext          读 .workspace-bridge.json，确定目录角色
       │    ├─ fileIndex               FileIndex.build()：发现文件、算内容哈希
       │    ├─ diagnostics             创建 DiagnosticsEngine（外部 lint 等，按需运行）
       │    ├─ depGraph                initializeDepGraph() → GraphBuilder.build()
       │    │                              └─ 'graph:built' → GraphAnalyzer.precomputeAggregates()
       │    ├─ snapshot                组装工作区视图 container.snapshot
       │    ├─ callbacks               注册增量更新回调（只在 watch/REPL 下真正起作用）
       │    └─ gitHead                 记录当前 HEAD，供新鲜度判断使用
       ├─ COMMANDS[command]()          src/cli/commands → src/tools/*，产出结果对象
       ├─ 写 staleness → cache.save() → 合并图警告、设 dataQuality
       ├─ formatCliResult()            字段过滤、仓库文本消毒、按 --format 序列化
       └─ container.shutdown()
```

每次命令都会把图完整重建一次。未改动文件的解析结果从缓存取，定位每次都重新做，所以暖启动省下的主要是解析时间。

## 1. 入口：cli.js

`main()` 先用 `parseCliArgs()`（`src/cli/validate-args.js`）解析参数。参数解析失败时走 `parseFailureResponse()`：原始参数里带 `--json` 或 `--format json` 时输出错误信封（判断见 `error-envelope.js` 的 `wantsJson()`）（第 6 节），否则打印错误消息和用法。错误的 `code` 为 `VALIDATION_ERROR` 时退出码 1，其他为 2。

`watch`、`init`、`repl`，以及带 `--watch` 的 `audit-file`，属于 `SELF_MANAGED_COMMANDS`：它们自己管理容器和退出码，`main()` 直接调用它们的 handler。其余命令都进 `runCliInProcess()`。测试也直接调用这个函数，不起子进程。`runCliInProcess()` 依次做这些事：

1. `checkCwd()` 和 `sanitizeCliPaths()` 校验路径，不合法就返回 `path_error` 信封，退出码 1。
2. 新建一个 `Ledger`，再用 `computeDefaultCacheDir()` 算缓存目录。缓存目录由三部分拼成：系统缓存根（Windows 用 `%LOCALAPPDATA%`，其他系统用 `XDG_CACHE_HOME` 或 `~/.cache`），加上 `workspace-bridge/`，再加上工作区图键的 md5 前 8 位。这个目录不可写时退到系统临时目录，并在台账里记一条 `cache-directory-fallback`。这个台账对象之后会传给容器，所以对于建容器的命令，这一步出的问题也会出现在最终的 `warnings[]` 里。
3. `workspace-info` 命令走轻量路径：不建容器，直接调用 `workspaceInfo()`。它不读台账，所以上一步记下的警告不会出现在它的输出里。
4. 其他命令都新建容器并调用 `initialize()`，超时上限是 `TIMEOUTS.INIT_TIMEOUT_MS`。初始化失败时，把容器上记录的 `container.initError` 抛出来，由 `buildErrorResponse()` 转成错误信封。
5. 执行命令（第 6 节），然后收尾（第 7 节）。

进程收到 SIGINT 或 SIGTERM 时，`installSignalCleanup()`（`src/cli/signal-cleanup.js`）先调用 `container.shutdown()`，再以 128+信号号退出。

## 2. 容器流水线：container.js

`initialize()` 用一个状态机防止重复初始化。状态有 `IDLE`、`INITIALIZING`、`READY`、`SHUTTING_DOWN`、`ERROR`，合法的转移关系见 `VALID_TRANSITIONS`。并发调用 `initialize()` 的调用方会共用同一个 `_readyPromise`。

`_runPipeline()` 是一串按顺序写死的 `_runStage(name, fn)` 调用。每个阶段都会：

- 把耗时记进 `_phaseTimes`；
- 每运行满 `TIMEOUTS.INIT_HEARTBEAT_MS` 就向 stderr 写一行 `still running`，`--quiet` 下也照写，因为一个长时间没有输出的进程和卡死的进程从外面看不出区别；
- 出错时在错误消息里加上阶段名再抛出；
- 在每一步前后检查中止信号。超时（`initialize()` 里的计时器）和 `shutdown()` 都会让后续阶段停下。

全部阶段跑完后，如果总耗时超过同一个阈值 `INIT_HEARTBEAT_MS`，`_noteSlowRun()` 会在台账里记一条 `slow-run`。

命令代码读数据时应当走工作区视图 `container.snapshot`，它是 `src/models/workspace-snapshot.js` 里的 `WorkspaceSnapshot`。其中 `snapshot.graph` 是同一文件里的 `DependencyGraphView`，只把图的查询方法转发出来，不暴露写方法。`container.depGraph` 已经标为 deprecated，访问它会打印警告。

## 3. 文件发现：FileIndex.build()

`src/services/file-index.js` 负责回答两个问题：这次分析覆盖哪些文件，以及每个文件的内容是什么。

1. **确定排除规则。** 发现阶段用 `shouldExclude()` 判断是否跳过，跳过的文件根本不会被索引。命中条件有三类：`DEFAULT_EXCLUDE_DIRS` 里的通用目录名（如 `node_modules`）及配置文件里的排除项（`_applyWorkspaceExcludeDirs()`）；配置里的忽略路径；目录角色为 `archive` 或 `generated`。命令行 `--exclude` 不在其中：它接受目录名、路径片段或 `*.ext` 形式的简单 glob，存进 `cliExcludeDirs`，命中的文件照样会被索引，只在输出时被过滤掉（见第 5 节第 2 步）。
2. **一次遍历收集文件。** `findFilesAsync()` 只遍历目录树一次，同时收集两类文件：扩展名有解析器认领的，进入索引；扩展名属于 `KNOWN_SOURCE_EXTENSIONS`（`src/config/source-extensions.js`）、但没有解析器的，记为候选。遍历深度上限是 `DEFAULTS.FILE_INDEX_MAX_DEPTH`，可以用配置项 `maxIndexDepth` 调整。被截断的目录记 `depth-truncated`。
3. **限时。** 整个发现过程受 `AbortSignal.timeout` 约束。超时记 `index-timeout`，这时文件集合不完整。
4. **按 gitignore 过滤。** `filterGitIgnored()`（`src/utils/gitignore.js`）用 `git check-ignore` 批量过滤。git 不可用时保留全部文件，并记 `gitignore-unavailable`。
5. **登记无人认领的源文件。** 第 2 步的候选同样经过 gitignore 过滤，剩下的存进 `unsupportedSourceFiles`，并记 `unsupported-source-files`。这批文件算进覆盖率的分母。
6. **读内容、算哈希。** `processFile()` 读每个文件，算 SHA-256（`hashFileContent()`），写进 `cache.setFileMetadata()`。判断文件有没有变只看内容哈希，mtime 和 size 仅作为元数据保存。
7. **清理已删除的文件。** `pruneDeletedCacheEntries()` 删掉磁盘上已经不存在的文件的缓存条目。
8. **交出原始路径。** 原始路径列表存进 `_indexedFiles`，交给建图使用，这样节点能保留文件在磁盘上的大小写。

容器启动 FileIndex 时传入 `watch` 选项：一次性 CLI 命令传 `false`，不启动文件监听。

## 4. 缓存：WorkspaceCache 与 GraphDb

`src/services/cache.js` 是内存层，`src/services/graph-db.js` 是 SQLite 层。SQLite 里有六张表：

| 表 | 存什么 |
|---|---|
| `cache_metadata` | 缓存版本号、时间戳、工作区信息（含 gitHead）、序列化元数据（如 co-change，即 git 历史里经常一起修改的文件对） |
| `file_metadata` | 每个文件的内容哈希、mtime、size、行数、原始路径、角色 |
| `parse_results` | 每个文件的解析结果，用内容哈希校验 |
| `symbol_index` | 全局符号表 |
| `diagnostics` | 外部诊断工具的结果 |
| `analysis_snapshots` | 完整命令结果的快照（第 6 节） |

关键契约：

- **`parse_results` 只存解析结果，不存定位结果。** 定位依赖整个文件集合，内容哈希反映不出这种变化。见 `GraphBuilder._toParseRecord()` 及其注释。
- **版本闸门。** `CACHE_VERSION` 定义在 `src/config/versions.js`，算法是 `CACHE_SCHEMA_REVISION × 2^31 + 引擎指纹`。引擎指纹是 31 位整数，由 `src/services/dep-graph/` 下所有 `.js`、`.scm`、`.json` 文件的内容，加上 `web-tree-sitter`、`tree-sitter-wasms`、`@babel/parser` 三个 npm 包的版本号一起算出来。这个目录里的代码一改，旧缓存自动作废。这个目录以外的代码不在这个指纹范围内，例如 `src/utils/path.js` 的图键规则、`graph-db.js` 的表结构；改这些代码时，只要会影响缓存内容，就必须手动把 `CACHE_SCHEMA_REVISION` 加 1。分析快照另有一个版本 `SNAPSHOT_VERSION`，算法相同，指纹范围是 `src/` 下除 `cli/` 以外的全部源码（工具层决定快照里有什么，`cli/` 只在快照重放之后做格式化），所以改工具层代码时快照自动作废，解析结果缓存不受影响。`GraphDb` 读取时发现版本对不上，就当作没有缓存；`analysis_snapshots` 的每一行还会单独校验 `cache_version` 是否等于 `SNAPSHOT_VERSION`。
- **增量写。** `file_metadata`、`parse_results`、`symbol_index`、`diagnostics` 四类数据在内存里各有一个 dirty tracker，`save()` 只写有变化的行。`load()` 之后如果整体替换了内存里的 Map，必须同步重置 tracker（`_resetTrackers()`）。
- **损坏隔离。** 加载时如果发现库文件损坏，就把它连同 SQLite 的 WAL 预写日志文件一起改名为 `.corrupt-<时间戳>`，记一条 `cache-load-failed`，然后按冷启动重建。

## 5. 建图：GraphBuilder.build()

`DependencyGraph`（`src/services/dep-graph.js`）是一个门面：写入交给 `GraphBuilder`（`dep-graph/builder.js`），分析交给 `GraphAnalyzer`（`dep-graph/analyzer.js`），查询交给 `GraphQuery`（`dep-graph/query.js`），它自己只负责持有这几个对象，以及一个事件总线 `dg.bus`。

`build()` 每次都从空图开始，按以下顺序执行：

1. **清场。** 清空图，调用 `beginResolverBatch(root)` 开始一个新的定位批次：它先用 `clearResolverCaches()` 清空 resolver 的文件系统缓存，再记录本批次的工作区根目录。然后发出 `graph:updated { fullRebuild: true }`，让分析器丢掉所有派生缓存。
2. **选文件。** 输入是第 3 节索引到的文件，再去掉 `DependencyGraph.shouldExclude()` 命中的文件，判断依据是 FileIndex 传过来的 `baseExcludeDirs`，即默认排除目录加配置文件里的排除目录。此时图里有三类文件：主线文件、`reference` 角色的文件、被 `--exclude` 命中的文件。后两类留在图里，是因为它们的 import 能防止主线代码被误报为死代码；报告发现时，再由 `DependencyGraph.shouldExcludeCli()` 把它们过滤掉。这个函数名里有 Cli，但除了 `--exclude`，它也过滤非主线角色的文件，以及配置里 `ignore.frameworks` 列出的框架的文件。最后按图键去重、排序，保证每次结果一致。
3. **解析。** 用 `parseFileOnly()` 并发解析，并发数是 `CONFIG.DEFAULT_CONCURRENCY`。缓存命中要同时满足两个条件：缓存里的哈希等于当前元数据里的哈希；条目不是 `regex-fallback` 降级产物。降级条目永远不命中，这样工具链恢复后会自动重新解析、升级成 AST 结果。超过 `LIMITS.PARSER_MAX_FILE_BYTES` 的文件不解析，记为 `file-too-large`。解码失败或含 NUL 字节的文件记为 `unsupported-source-encoding`。
4. **准备定位所需的事实。** `_buildSymbolRegistry()` 建全局符号表。`_refreshResolveFacts()` 算出两样东西：工作区包集合（图中所有节点声明的 `package`，用来判断 Java/Kotlin 的 import 属不属于本仓库），以及 Python 模块索引（文件名到文件的映射）。`resolveFileOnly()` 在这两样没准备好时会直接抛错，因为缺了它们，第三方 import 会被悄悄当成本地 import 处理。
5. **定位。** 对每个文件调用 `resolveFileOnly()`，把 `importRecords` 的 `source` 定位成图键，写进 `resolved` 和 `imports`。定位失败的记录照样保留在节点上，只是不产生边，这样消费方能统计出丢了多少。
6. **后处理阶段。** 由 `runPostProcessPhases()` 执行，目前有两个：Java/Kotlin 同包展开和 Go 同包展开。这两种语言里，同一个包内的文件不用 import 就能互相引用，后处理根据实际引用的名字补上这些边。每个阶段必须幂等，因为增量更新会在已经含有它输出的图上再跑一遍。
7. **收尾。** `_normalizeImportEdges()` 对边去重并统一格式，`buildReverseGraph()` 构建反向图。然后再重建一次符号表，防止后处理阶段改过导出记录、留下过期的符号表。
8. **通知。** 发出 `graph:built`。门面监听这个事件，调用 `analyzer.precomputeAggregates()`。

### 解析器

语言注册表在 `src/services/dep-graph/parsers/registry.js`，每种语言对应一条 `defineLanguage({...})`。字段的定义和默认值在同目录的 `registry-core.js`，主要有：`extensions`、`parse`，以及 `parse` 需要哪些参数（`needsFilePath`、`needsWorkspaceRoot`、`async`）；`isBuiltIn(specifier)`，用来判断一个 import 是不是标准库；`resolveStrategies`，定位策略链；`symbolTableFallback`。

`parse` 的返回字段就是 `_toParseRecord()` 存下的那些。其中 `parseModeReason` 由解析器自己声明，有三种取值：`ast-success`；`regex-native`，表示正则本来就是这种语言的设计路径，例如没有 `<script>` 块的 Svelte；`regex-fallback`，表示 AST 失败后退回了正则。builder 不替解析器猜这个值。

Java、Python、Go、Rust、Kotlin、C/C++、Vue 的 AST 走进程内的 tree-sitter WASM（`parsers/tree-sitter.js`）。JS/TS 走 `@babel/parser`，失败时退回正则。

### 定位策略链

`resolveImport()`（`src/services/dep-graph/resolvers.js`）按文件扩展名取一条策略链，依次执行，第一个返回非 null 的策略胜出。所以策略顺序本身就是契约，调整顺序需要冲突测试来保护。策略函数的签名是 `(importPath, fromFile, ctx) => string | null`，各语言的实现在 `resolvers/` 目录下。`ctx` 的字段见 `_buildContext()`。

策略链由注册表里的 `resolveStrategies` 生成。如果语言没有声明 `symbolTableFallback: false`，链尾会追加 `trySymbolTable`：按符号名去全局符号表里猜文件，猜中的记录 `tier` 为 `tier2`，置信度低于正常定位的 `tier1`。目前 JS 系（`.js/.ts/.jsx/.tsx` 等）和 Python 关掉了这一步，因为实测它们靠符号表猜出的边没有一条是对的。`trySymbolTable` 在猜之前，会先用 `EXTERNAL_DEPENDENCY_CHECKS` 判断这个 import 是否属于第三方（依据清单文件、标准库名单、工作区包集合），是第三方就不猜。

resolver 自带文件系统缓存。每次 build 或 update 开始时，`beginResolverBatch()` 会调用 `clearResolverCaches()` 把它们清空。新增同类缓存必须挂到这个函数里，否则 watch 和 REPL 会一直读到旧数据。

## 6. 分析与命令

### GraphAnalyzer

`precomputeAggregates()` 在每次 `graph:built` 时都会重新计算死导出、未定位 import、循环和统计。不能沿用旧值，否则 `audit-overview` 和单独的 `dead-exports` 等命令对同一张图会给出不同的数。

分析器的派生缓存挂在 `graph:updated` 事件上失效，包括文件内容、循环，以及判断死导出误报用的旁证（自动导入目录、`import.meta.glob` 模式）。全量重建时全部清空，增量更新时只清和改动文件相关的部分。

`_readSource()` 是入口检测、glob 扫描和符号使用扫描共用的读文件入口。总量没超过 `LIMITS.SCAN_CONTENT_CACHE_MAX_CHARS` 时，一个文件在一次分析里只读一次；超过以后，新读到的文件不再进缓存，下次用到时重新读。

`EventBus`（`src/utils/event-bus.js`）会隔离监听器抛出的异常：异常不向上抛，而是记进 `bus.errors`。分析器的 `_syncStateLedger()` 会把这些记录转成 `analysis-stage-failed` 警告。所以预计算失败时，命令照样会跑完，但输出里一定带着这条警告。

### 命令层

命令注册表是 `src/cli/commands/index.js` 里的 `COMMANDS`，文件类命令用 `makeFileCommand()` 统一校验 `--file`。业务逻辑放在 `src/tools/` 下：

- `overview-tools.js` 的 `buildProjectOverview()`，经 `overview-assembler.js` 和 `overview-curator.js`，产出 `audit-overview` 的结果；
- `audit-assembler.js` 负责编排 `audit-diff`、`audit-file`、`audit-security`；
- `dep-tools/` 下一个原子命令对应一个文件，如 impact、affected-tests、cycles；
- `git-tools.js` 和 `cochange-tools.js` 负责基于 git 历史的信号。

**分析快照。** 图每次都会重建，但 `audit-overview` 在图之上还要做大量汇总计算，快照省的就是这部分。`buildProjectOverview()` 先读 `analysis_snapshots` 表里的 `overview` 行，只有 `isSnapshotFresh(..., { strict: true })`（`src/tools/snapshot-freshness.js`）成立时才重放。成立的条件是 gitHead、文件数、配置哈希、内容签名四项都和当前一致；内容签名由所有已索引文件的路径和内容哈希算出。重放的结果带一个 `replayedFrom` 字段，覆盖率（`analysisCoverage`）和丢弃的 import（`droppedImports`）这类"本次是否实测"的字段，则从当前的图重新计算。带 `--category`、`--severity`、`--max-files`、`--compact` 参数的运行，快照既不读也不写，因为过滤后的子集一旦存进去，后面的全量请求就会读到残缺的数据。

`query-hotspots`、`query-knowledge-risk`、`query-stability` 用宽松档（`strict: false`）读同一份快照，只比较前三项，不比较内容签名，以换取速度。内容是否已经变化，通过结果里的 `contentMatch` 字段和对应的警告告诉消费者。

分析快照的新鲜度，和第 7 节的 `staleness` 不是一回事。`staleness` 描述的是这次内存里的索引距离构建过了多久，以及构建之后 HEAD 或文件有没有变化。

### 失败结果

工具层的失败一律用 `failure(type, message)`（`src/utils/failure.js`）返回，结构是 `{ ok: false, errorType, error, suggestion }`。`errorType` 只能取 `ERROR_TYPES` 里的值，传错了会直接抛异常。如果出错的地方不知道该怎么报告、需要交给上层的 catch 决定，就用 `typedError()` 抛一个带类型的 Error。CLI 层的错误信封由 `src/cli/error-envelope.js` 的 `buildCliError()` 生成，结构相同，另外多了 `command` 和 `schemaVersion` 两个字段。REPL 的失败结果也用这个结构。

## 7. 收尾与输出

命令返回后，`runCliInProcess()` 依次执行：

1. 写入 `result.staleness`（`container.getStaleness()`）。
2. `await container.cache.save()`。
3. 调用 `container.snapshot.graph.buildWarnings()`。它是工作区视图转发到 `GraphAnalyzer.buildWarnings()` 的方法，先用 `_syncStateLedger()` 按当前的图重新计算图相关的台账条目，再把整本台账转成警告数组，所以缓存、文件索引等阶段记下的条目也会从这里出来。返回的数组**追加**到 `result.warnings` 后面，不能覆盖，因为命令可能已经写了自己的警告。追加后按整条警告对象的 JSON 去重。只要有一条 severity 是 high 或 medium，就把 `dataQuality` 设为 `'degraded'`。
4. 调用 `formatCliResult()`（`src/cli/route-formatter.js`）：
   - 处理 `--fields` 过滤。`ESSENTIAL_FIELDS` 里的字段永远保留；请求了不存在的字段时，记一条 `unknown-fields` 警告。
   - 调用 `sanitizeRepositoryText()`（`src/cli/untrusted-text.js`），把来自仓库的路径、名字等字符串截短，并去掉控制字符和零宽字符。同时在结果里加一个 `untrusted` 标记，提醒 agent 不要把仓库里的文本当成指令执行。
   - 按 `--format` 分发输出。`ai`、`summary`、`human`、`jsonl` 以及默认的 `markdown`，由 `src/cli/formatters/human-formatters.js` 里的同名函数生成。`json`（等同于 `--json`）在本函数内处理：先用 `elideDeep()` 按数组长度上限截断，被截掉的部分列进 `elided[]`，并置 `truncated: true`；输出超过 `LIMITS.JSON_SIZE_HINT_BYTES` 时，再加一个 `sizeHint`，告诉消费者怎么缩小输出。
5. 用 `determineExitCode()` 决定退出码。正常结束是 0。以下情况是 1：结果 `ok: false`；`--check-regression` 和基线比较后失败；`guard` 的改动影响面超过阈值；带 `--fail-on-findings` 且有发现。未知命令和未预期的异常是 2，具体数值见 `src/config/exit-codes.js`。
6. 在 `finally` 里调用 `container.shutdown()`。关闭的每一步都单独 try-catch，最后关闭 SQLite。

JSON 输出的字段契约由 `test/fixtures/json-contract.json` 锁定：已有字段不能删、不能改类型。新增字段时运行 `UPDATE_GOLDENS=1 node test/json-contract-snapshot-test.js` 显式更新快照。`schemaVersion` 定义在 `src/config/versions.js`。

## 8. 增量路径：watch 与 REPL

只有长时间运行的进程（`watch`、`repl`）会开启文件监听，事件按下面的链条传递：

```
fs.watch 事件 → FileIndex.handleFileChange()      目录事件直接忽略
             → processPending()                   重算哈希，写元数据
             → FileIndex 的 bus 发出 'pending:processed'(文件列表)
             → container._pendingUpdateQueue      排队，不会丢批次
             → _drainPendingUpdates()             等上一批 updateFiles 结束
             → GraphBuilder.updateFiles(batch)
             → 'graph:updated' { changedFiles }   分析器按改动范围失效缓存
             → 'graph:built'                      重新预计算聚合结果
             → container._assembleSnapshot()      刷新工作区视图
```

`updateFiles()` 处理三种情况：

- **改动的文件**：重新解析并定位，它们的一跳依赖方也重新定位。
- **删除的文件**：从图、反向图和其他节点的 `imports` 里摘掉，同时删除缓存元数据。
- **新增的文件**：除了它本身，还要重新定位两类文件：一类是 glob import 可能覆盖到它的文件，另一类是原本指向某个"同名候选路径"、现在可能被它截胡的文件（`shadow-candidates.js`）。

还有一类文件不在上面的范围内：原先定位失败、新文件出现后本该指向它的 import。这类情况是否会被重新定位，目前没有核实。增量结果和冷启动结果是否一致，以 `test/warm-cold-parity-test.js` 等一致性测试为准。

清除解析缓存只能通过 `_invalidateParseCache()`，它会同时清掉内存层和 SQLite 层。不要在别处单独清理某一层。

## 9. 横切契约速查

- **警告只有一个来源。** 运行中发现的问题一律用 `ledger.record(code, fields)` 记录；在拿不到台账的工具层独立结果里，用 `warningOf(code, fields)` 生成。新增原因码前，先在 `REASON_CODES` 里登记，拼错的原因码会直接抛异常。不要往结果里塞自由文本格式的警告。
- **每次重算的状态用 replace。** 每次分析都会重新计算的警告（比如解析失败的文件数），用 `ledger.replace(code, entries)` 整体替换，否则在 watch 模式下会越积越多。
- **覆盖率不能假装完整。** 覆盖率字段是 `analysisCoverage.coverageRatio`。索引超时或深度截断时它是 `null`，不能写成 100%。分母包括第 3 节里发现了但没有解析器认领的文件（`unsupportedSourceFiles`）。
- **路径。** 内部比较和存储一律用图键，输出时转回显示路径。不要在 `path.js` 之外自己对路径做 `toLowerCase` 或手工拼接。
- **内部方法缺失要当场报错。** 对图、缓存这类必然存在的对象，调用方法时不要加 `?.()` 兜底，缺方法就让它直接抛 `TypeError`。否则这个缺失会被当成"没有发现"，悄悄通过。只有真正可选的对象才用 `?.`。

## 10. 常见扩展怎么接

| 要做的事 | 接入点 |
|---|---|
| 新增一门语言 | ① 在 `parsers/registry.js` 加一条 `defineLanguage`。解析器可以参考结构相近的现有实现，比如 `go-ast.js`。如果走 tree-sitter，需要 `tree-sitter-wasms` 里有这门语言的 grammar，加载方式参照 `parsers/tree-sitter.js` 的现有调用。② 在 `resolvers/` 下写定位策略，填进 `resolveStrategies`。③ 能根据清单文件判断第三方依赖的，在 `resolvers.js` 的 `EXTERNAL_DEPENDENCY_CHECKS` 加一行。④ 没有实测数据证明符号表猜测有效时，设 `symbolTableFallback: false`。⑤ 语言专属的分支还散在框架识别、孤儿检测、测试文件识别等模块里，用 `grep` 搜一门现有语言的名字和扩展名（如 `'kotlin'`、`.kt`）找出这些位置。⑥ 测试参照 `test/language-parity-edges-test.js`，在夹具上验证边能建出来，并且该扩展名不再出现在 `unsupported-source-files` 里。⑦ 缓存：只改了 `src/services/dep-graph/` 目录内的文件时，缓存会自动失效；改到这个目录以外的文件时，按第 4 节的规则判断是否需要给修订号加 1 |
| 新增一种 import 定位方式 | 写一个 `(importPath, fromFile, ctx) => string \| null` 函数放进对应语言的 `resolveStrategies`，确定它在链里的位置，并补冲突测试 |
| 新增一个图级后处理 | `builder.registerPostProcessPhase({ id, fn, triggers })`。`triggers` 是扩展名数组，增量更新时只有重新解析的文件里有这些扩展名才会运行这个阶段；不填就每次都跑。必须幂等 |
| 新增一个降级警告 | 先在 `REASON_CODES` 登记，再在产生问题的地方调用 `ledger.record()` |
| 新增一个 CLI 命令 | handler 注册到 `COMMANDS`，逻辑放在 `src/tools/`；需要文本输出的，在 `src/cli/formatters/` 实现并在它的 `index.js` 里导出；有 JSON 输出的，把字段快照加进 `json-contract.json` |
| 改缓存表结构或图键规则 | 改 `graph-db.js` 的 `SCHEMA` 和迁移逻辑，或者改 `path.js`，同时把 `CACHE_SCHEMA_REVISION` 加 1 |

改高危文件前要先跑 impact 和 affected-tests，规则见 [AGENTS.md](../AGENTS.md)「Agent 认知边界」。
