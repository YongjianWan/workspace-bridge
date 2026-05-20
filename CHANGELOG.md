# Changelog

所有版本变更记录。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

**版本导航**：[Unreleased](#unreleased) · [1.2.0](#120---2026-05-18) · [1.1.1](#111---2026-05-08) · [1.1.0](#110---2026-05-06) · [1.0.4](#104---2026-05-05) · [1.0.2](#102---2026-05-03) · [1.0.1](#101---2026-05-03) · [1.0.0](#100---2026-05-02) · [0.9.14](#0914---2026-05-02) · [0.9.13](#0913---2026-05-02) · [0.9.12](#0912---2026-05-01) · [0.9.11](#0911---2026-05-01) · [0.9.0](#090---2026-04-29) · [0.8.2](#082---2026-04-28) · [0.8.0](#080---2026-04-03) · [0.6.0](#060---2026-03-27) · [0.5.1](#051---2026-03-27) · [0.5.0](#050---2026-03-26)

## [Unreleased]

### 优化（L2 性能债：better-sqlite3 物理增量写入 — 2026-05-20）

- **实现 SQLite 增量保存替代全量清空落盘** `src/services/graph-db.js` `src/services/cache.js`：
  - 问题：每次 `cache.save()` 都会清空并全量重写 `cache_metadata` 和 `dependencies` 表，导致在大型项目（数百至数千文件）中即使只改动了一个文件也需要承担严重的磁盘 I/O 写入开销（冷启动与缓存写入瓶颈）。
  - 修复：
    1. 在 `graph-db.js` 中新增 `saveIncremental(dirtyData)`，利用 SQLite 的 `INSERT OR REPLACE` 语句更新已变动或新增的文件缓存，并使用 `DELETE` 语句物理清除已删除文件的缓存。
    2. 在 `cache.js` 中引入 `dirtyKeys` 和 `deletedKeys` 两个 Set 来动态、精准追踪变动/删除的缓存条目；
    3. 重构 `WorkspaceCache.save()`，智能判定是进行全量覆盖还是增量更新，大幅提升写入效率，实现了亚毫秒级的物理增量写入。

### 重构（L4 编排层 Facade 提取：audit-assembler.js 独立化 — 2026-05-20）

- **重构并抽取 Curation 与过滤 Facade** `src/tools/audit-assembler.js` `src/cli/commands/`：
  - 问题：原来的 curation、基线校验、严重等级过滤和输出拼装逻辑分散在 `audit-summary.js`、`audit-diff.js`、`audit-file.js` 和 `audit-security.js` 等各个命令行接口内部，代码重复且难以给 coding agent 预消化输出。
  - 修复：
    1. 提取并创建 `src/tools/audit-assembler.js` 统一外观（Facade）层，将聚合、校验、过滤和计算 hasFindings 的逻辑全部下沉到 assembler。
    2. 重构 CLI 命令路由模块，将底层数据组装全量委托给 `audit-assembler.js`，极大简化了 CLI 入口层复杂度。
    3. 优化 `cli.js` 中的退出码判定函数 `determineExitCode`，使其在 O(1) 时间内优雅地根据下沉契约 `result.hasFindings` 完成判断。

### 新增（P1 特性开发：--format ai & --token-budget & --depth 支持 — 2026-05-20）

- **开发 Agent 预消化输出机制与 AI Formatter** `cli.js` `src/cli/formatters/human-formatters.js`：
  - 问题：大模型（AI coding agent）直接消费数百行 raw JSON 会面临严重的信息噪音和 token 预算爆表风险。
  - 修复：
    1. CLI 命令全面支持 `--format ai`、`--token-budget <n>` 和 `--depth surface|detail|full` 选项。
    2. 在 `human-formatters.js` 中开发专用于 AI 消费 of `formatAi` 模块，尤其对 `audit-file` 提供了精细支持：根据指定的深度等级（surface = 仅元数据，detail = 精简级联，full = 完整图和影响路径）和 token 限制，动态过滤和压缩嵌套字段，为 Coding Agent 提供精准、去噪的上下文。
    3. 引入端到端 Facade 集成测试 `test/audit-assembler-test.js` 验证上述全部特性。并且头部显式增设 `// @slow` 以便在 Windows 下实现无并发锁冲突的完美测试运行。

### 修复（Bug & Architecture Repair — 2026-05-20）

- **修复 L1 Blocker 1: `ServiceContainer` 异步初始化与 `shutdown()` 竞态崩溃** `src/services/container.js`：
  - 问题：`initialize()` 中存在多处异步挂起点，当挂起期间触发 `shutdown()`，会清除 `this.cache` 等服务实例，已挂起的微任务恢复后继续强行推进，导致操作已关闭 cache 的 Crash 和严重资源泄露。
  - 修复：在 `initialize()` 的每个异步等待点返回后，增加 `_checkAborted()` 短路检查，若发现初始化已被中止，立刻提前干净退出，彻底消除了生命周期脏覆盖和资源泄露。

- **修复 L1 Blocker 2: `FileIndex.processPending()` 异步后台任务与 `shutdown` 竞态崩溃** `src/services/file-index.js`：
  - 问题：`stopWatching()` 仅清除了定时器，而后台仍在执行 of `processPending` 异步迭代未受控制，继续写入已关闭的 SQLite cache 触发 `database connection is closed` Crash。
  - 修复：在 `FileIndex` 引入 `active` 状态标志，并在 `stopWatching()` 触发时置为 `false`；在 `processPending` 循环、`handleFileChange`、`indexFile` 及缓存清理各阶段进行 active 检测，发现 inactive 则立刻短路退出，完美根治后台脏写问题。

- **修复 L2 Debt 2 & Write Storm: 消除 `WorkspaceCache` 内存校准引起的磁盘写入风暴** `src/services/cache.js`：
  - 问题：SHA-256 慢路径对 `mtime/size` 的内存校准（幽灵更新）在只读查询中从不持久化，导致冷启动仍走慢路径；同时，纯只读命令（如 `audit-summary`）也会在退出时无脑触发 SQLite 全量写入事务，带来极高的高 overhead I/O 消耗。
  - 修复：在 `WorkspaceCache` 引入 `dirty` 脏标。仅在 fast-path 幽灵更新或发生实际 symbols 变更时标记 `dirty = true`；并在 `cache.save()` 中进行 dirty 校验，非 dirty 时直接跳过 bulk write，实现零 I/O 开销的秒级只读响应，并确保幽灵更新能够正确落盘。

- **修复 Schema 属性丢失 bug** `src/services/cache.js` `src/services/graph-db.js`：
  - 问题：`better-sqlite3` 批量写入的 `saveAll()` 会暴力清空 `cache_metadata` 并仅序列化保存核心属性，丢失了 schema 驱动的 metadata 扩展项（如 `aggregateSummary`, `coChanges`），导致冷启动时缓存字段残缺。
  - 修复：在 `saveAll()` 写入前提取所有附加 metadata 属性，并在清表后统一重新插入 `cache_metadata`，彻底规避了字段遗失问题。

- **优化测试套件分类并消除 Fast Runner 慢测试告警** `test/*.js`：
  - 问题：一致性检测扫描出 7 个包含 `spawnSync`/`child_process` 的测试漏入 fast 层并发跑，从而引发 slow 警告 and SQLite 超时争用风险。
  - 修复：将 `git-line-ranges-test.js`、`java-parsers-test.js`、`phase01-quality-test.js`、`spawn-ast-concurrency-test.js`、`spawn-ast-direct-test.js`、`spawn-ast-test.js`、`staleness-test.js` 7 个测试文件的头部统一增设 `// @slow` 注释标记；使 fast 层测试完美缩减为 93 个并 100% 绿色通过，零 runner 警告。

### 重构（阶段 2.5 CLI 减负：Fatal Handler + --help 核心命令折叠 — 2026-05-20）

- **安装 `unhandledRejection` / `uncaughtException` 全局异常兜底** `cli.js`：
  - 问题：CLI async 路径未捕获的异常可能导致静默退出或 raw stack 输出，AI 被迫自己解析错误根因。`main()` 内部的 try-catch 已覆盖大部分路径，但 `container.shutdown()` 在 finally 块中若抛出异常会逃逸为 unhandled rejection；Node.js 默认行为是打印 deprecation warning 后进程以 0 退出，导致调用方误以为命令成功。
  - 修复：新增 `installFatalHandlers()` 函数，注册 `unhandledRejection` 和 `uncaughtException` 两个进程级 handler。统一输出 `Fatal:` 前缀 + 错误消息 + stack trace，然后以 exit code 2 退出（2 = 崩溃，与 CLI 现有语义一致：0=成功，1=业务失败，2=崩溃）。
  - 双重保护：`main()` 返回的 Promise 也附加 `.catch()`，确保即使 fatal handler 被绕过（如 Promise rejection 在 handler 安装前发生），仍有兜底。
  - 向后兼容：无接口变更；正常路径行为不变。
  - 验证：fast 100/100 PASS；slow 27/27 PASS。

- **默认 `--help` 只展示 Tier 1 核心命令，其余折叠到 `--help --all`** `cli.js` `test/cli-args-validation-test.js`：
  - 问题：当前 `--help` 打印全部 20+ 命令（L1-L4 + 其他），AI 消费者需在 20 个选项中选择。ROADMAP 阶段 2.5 评估结论：命令分层暴露已分组（L1/L2/L3/L4），但默认仍全部展示，认知负担未真正减轻。
  - 修复：
    1. `parseCliArgs` 新增 `'--all': true` 解析。
    2. `printUsage(showAll = false)` 默认显示精简版：只展示 L1 策展入口（audit-summary / audit-file / audit-diff / audit-overview / audit-map）+ Options + 提示语 `Run --help --all to see the full command list`。L2-L4 命令不再默认暴露。
    3. `--help --all` 恢复现有完整输出（保留 L1/L2/L3/L4 分组）。
    4. 无参数直接运行 `cli.js`（如 `node cli.js`）也显示精简版，与 `--help` 行为一致。
  - 向后兼容：所有命令本身未被删除或合并；`--help` 仍可用；新增 `--help --all` 显式展示完整列表。
  - 验证：`cli-args-validation-test.js` 新增 `testHelpFlag`（验证精简版不含 L4）和 `testHelpAllFlag`（验证完整版含 L4）；fast 100/100 PASS；slow 27/27 PASS。

### 修复（L1 休眠 bug：WorkspaceSnapshot 内部数据不一致 — 2026-05-20）

- **消除 `snapshot.files` 与 `snapshot.graph` 的更新语义分歧** `src/models/workspace-snapshot.js` `src/services/container.js`：
  - 问题：`container._assembleSnapshot()` 初始化时把 `fileIndex.cache.fileMetadata` 拷贝为静态数组 `snapshot.files`（spread 浅拷贝，`symbols[]` 共享引用），而 `snapshot.graph`（`DependencyGraphView`）持有 `depGraph` 的实时引用。REPL watch 模式下 `depGraph.updateFiles()` 增量更新 graph 后，`snapshot.files` 仍保持初始化状态，两者语义不一致。
  - 修复：
    1. `WorkspaceSnapshot.files` 改为惰性 getter：生产环境通过传入的 `fileIndex` 引用每次从 `cache.fileMetadata` 实时构建；测试环境回退到构造函数传入的静态 `_staticFiles` 数组，零测试改动。
    2. `container._assembleSnapshot()` 传入 `fileIndex: this.fileIndex` 替代静态 `files` 数组。
    3. `container._registerCallbacks().onPendingProcessed` 中 `depGraph.updateFiles()` 成功后重新调用 `_assembleSnapshot()`，确保增量更新后 snapshot 元数据（`generatedAt`/`basedOn`/`knownBlindSpots`）同步刷新。
    4. 异常安全：`_assembleSnapshot()` catch 块中若已有 snapshot 则保留旧值（避免 REPL 增量更新时的瞬态错误清空视图）。
  - 向后兼容：`makeMockSnapshot` 工厂继续传静态 `files`，getter 自动回退。
  - 验证：fast 100/100 PASS；slow 27/27 PASS；watch 4/4 PASS；基线 `audit-summary` healthScore=7/8 deadExports=0 coverageRatio=1.00。

### 重构（架构债务：parserAvailability 统一归位 — 2026-05-20）

- **`checkParserAvailability` 从 `health-tools.js` 移至 `environment-probe.js`** `src/utils/environment-probe.js` `src/tools/health-tools.js` `src/tools/workspace-tools.js`：
  - 问题：`health-tools.js` 同时承担"健康检查"和"环境探测"两个职责；`workspace-tools.js` 为获取 `parserAvailability` 不得不直接依赖 `health-tools.js`，导致 L4 工具层间出现非预期耦合。
  - 修复：将 `checkParserAvailability()` 实现移入 `environment-probe.js`（与 `detectEslintConfig`/`detectPrettierConfig`/`detectTscConfig` 并列）；`health-tools.js` 和 `workspace-tools.js` 统一从 `environment-probe.js` 引入。`health-tools.js` 继续导出 `checkParserAvailability` 以保持向后兼容（重新导出）。
  - 结果：`environment-probe.js` 成为环境探测的单一事实源；`health-tools.js` 只负责健康评分和修复建议。
  - 验证：`health-tools-test.js`/`workspace-tools-test.js` PASS；fast 100/100 PASS；slow 27/27 PASS。

### 重构（测试债务：e2e-gitnexus 去重 — 2026-05-20）

- **删除 e2e-gitnexus 中重复的大项目 CLI spawn** `test/e2e-gitnexus-test.js`：
  - 问题：`e2e-gitnexus-test.js` 包含 3 个独立 CLI spawn（`audit-summary`/`audit-file`/`dead-exports`），每个在 1329 文件项目上冷启动需 ~14s，合计 ~42s；占 slow 层总时间 ~30%。
  - 根因：`cli-integration-test.js` 已在小项目上覆盖 `audit-file` 和 `dead-exports` 的命令形状验证；e2e-gitnexus 中后两个测试的唯一独特价值是"大项目不崩溃"，这已由 `audit-summary` 覆盖（`audit-summary` 内部同样调用 `deadExports`/`impact` 等核心路径）。
  - 修复：删除 `testAuditFileOnGitNexus` 和 `testDeadExportsOnGitNexus`，只保留 `testAuditSummaryOnGitNexus`。runner 中该测试从 ~65s 降至 ~34s，slow 层总时间从 ~165s 降至 ~129s（省 ~22%）。
  - 向后兼容：无接口变更；测试覆盖不减少（形状验证已存在 `cli-integration-test.js`）。
  - 验证：fast 100/100 PASS；slow 27/27 PASS。

### 重构（L3 品味：git-tools.js 手动字符级解析 — 2026-05-20）

- **提取 `parsePorcelainV1Line` 隔离 `git status --porcelain=v1` 的字符级解析** `src/tools/git-tools.js` `test/git-tools-test.js`：
  - 问题：`getChangedFiles()` 主循环直接操作 `line[0]`、`line[1]`、`line.slice(3)`，状态判断逻辑（`isUntracked`/`isStaged`/`isUnstaged`）散落在循环体中；rename 处理（`file.split(' -> ').pop()`）也内联在循环内。
  - 修复：提取 `parsePorcelainV1Line(line)` 纯函数，返回结构化对象 `{ indexStatus, workTreeStatus, path, renamedFrom, isUntracked, isStaged, isUnstaged }`。主循环只处理结构化数据，不再直接索引字符串。
  - 测试：`git-tools-test.js` 新增 `testParsePorcelainV1Line`，覆盖常规修改、staged added、untracked、rename、文件名含空格、空行/短行/malformed 边界。
  - 向后兼容：`getChangedFiles` 行为零变更；新增 `parsePorcelainV1Line` 导出供测试使用。
  - 验证：`git-tools-test.js` PASS；fast 100/100 PASS；slow 27/27 PASS。

### 重构（L3 品味：framework-patterns 命名混淆 + 层级错配 — 2026-05-20）

- **提取 `detectFrameworkFromPath` 至 `project-context.js`，重命名 `framework-usage-patterns.js` → `implicit-imports.js`** `src/utils/project-context.js` `src/services/dep-graph/framework-patterns.js` `src/services/dep-graph/implicit-imports.js` `src/services/dep-graph/builder.js` `test/implicit-imports-test.js` `test/runner.js`：
  - 问题：`framework-patterns.js` 同时包含路径推断（`detectFrameworkFromPath`）和内容检测（`AST_PATTERNS`/`detectFrameworkFromContent`），前者是纯文件路径分类逻辑，后者是 builder post-process 的轻量文本扫描；`framework-usage-patterns.js` 实际职责是隐式 import 边注入（scanner/extractor/applier 流水线），但文件名暗示它是 "framework patterns" 的配套文件。两者混在 `dep-graph/` 下且命名相似，新增框架支持时开发者会同时打开两个文件后发现它们无调用关系，认知负担高。
  - 修复：
    1. `detectFrameworkFromPath` + `ENTRY_WEIGHT` 常量从 `framework-patterns.js` 提取至 `src/utils/project-context.js`，与 `ENTRY_BASE_NAMES`/`FRAMEWORK_ENTRY_FILES` 并列，成为项目上下文层的统一路径分类出口。
    2. `framework-patterns.js` 仅保留 `AST_PATTERNS` + `detectFrameworkFromContent`，职责单一为"内容检测"；顶部通过 `require('../../utils/project-context')` 引入 `detectFrameworkFromPath` 以保持向后兼容（过渡性兼容 shim）。
    3. `framework-usage-patterns.js` 重命名为 `implicit-imports.js`，文件名直接表达职责（隐式 import 边注入）。
    4. `builder.js` 和 `test/implicit-imports-test.js` 同步更新 require 路径；`test/runner.js` slow 列表更新文件名匹配。
  - 向后兼容：`framework-patterns.js` 仍导出 `detectFrameworkFromPath`（重新导出）；所有消费者 require 路径无需改动。
  - 验证：fast 100/100 PASS；slow 27/27 PASS（含 `implicit-imports-test.js`）。

### 重构（架构债务：eslint 检测逻辑统一 — 2026-05-20）

- **提取 `environment-probe.js` 消除 `workspace-tools.js` 与 `diagnostics-engine.js` 的 eslint 检测重复** `src/utils/environment-probe.js` `src/tools/workspace-tools.js` `src/services/diagnostics-engine.js`：
  - 问题：`workspace-tools.js#detectNodeLinters` 与 `diagnostics-engine.js#hasChecker` 各自独立实现同一套 eslint 配置文件扫描（`PROBE.ESLINT_CONFIG_FILES` + `package.json#eslintConfig`），修改 linter 检测逻辑时可能漏改某一处。
  - 修复：新建 `src/utils/environment-probe.js`，导出 `detectEslintConfig(root)` / `detectPrettierConfig(root)` / `detectTscConfig(root)` 三个纯函数。`workspace-tools.js` 的 `detectNodeLinters` 和 `diagnostics-engine.js#hasChecker` 的 eslint fallback 统一调用 `detectEslintConfig`。`detectPrettierConfig` 和 `detectTscConfig` 同步从 `detectNodeLinters` 提取，消除同文件内重复模式。
  - 向后兼容：函数签名不变；`detectNodeLinters` 仍返回 `{eslint, prettier, tsc}`。
  - 验证：`workspace-tools-test.js` PASS；`diagnostics-engine-test.js` PASS；fast 100/100 PASS；slow 27/27 PASS。

### 重构（P0.5 结构性地基：WorkspaceSnapshot + 自知机制 — 2026-05-20）

- **引入 `WorkspaceSnapshot` 只读模型与 `DependencyGraphView` 视图层** `src/models/workspace-snapshot.js` `src/services/container.js`：
  - 问题：L4 工具各自从 `container` 拉取原始服务（`depGraph`/`fileIndex`/`cache`），无统一数据视图；测试中 99 处内联 mock `depGraph` 重复构造 `new Map()` + 手工填充节点。
  - 实现：
    1. 新建 `src/models/workspace-snapshot.js`，包含 `DependencyGraphView`（薄只读包装，委托全部查询方法，不暴露 `build`/`updateFiles` 等写入方法）、`WorkspaceSnapshot`（组装 `files`/`graph`/`gitStatus`/`frameworkHints`/`projectContext` + 自知字段）。
    2. 自知机制（self-awareness）：`generatedAt`（快照时间戳）、`basedOn`（数据溯源：fileIndexVersion/cacheStaleness/gitHead）、`knownBlindSpots`（已知盲区清单：运行时绑定、DI 容器、稀疏图/常量仓库、Java 框架误报）、`confidenceByDomain`（按领域分层置信度：dead-exports high/low、cycles high、impact high、security low）。
    3. `ServiceContainer._assembleSnapshot()` 在 `_initDepGraph()` 成功后组装快照；异常安全包裹 try-catch，组装失败时 `snapshot = null`，不中断初始化。
    4. `ServiceContainer._collectFrameworkHints()` 遍历 graph 收集每文件的 framework hint。
  - 向后兼容：`container.depGraph` 继续工作；`DependencyGraph` API 不变；L4 工具本轮不强制迁移。
  - 验证：`node cli.js audit-summary --cwd . --json --quiet` 基线通过（healthScore=7/8, deadExports=0, coverageRatio=1.00）；fast 100/100 PASS；slow 27/27 PASS。

- **提供 `makeMockSnapshot(opts)` 工厂函数消灭测试重复** `test/test-helpers.js` `test/dep-tools-test.js` `test/overview-tools-test.js` `test/project-map-test.js`：
  - 问题：每个测试文件自造 ad-hoc plain-object mock，`audit-map-test.js` 10 个测试函数各自重建近似的 `graph`/`reverseGraph`。
  - 实现：`test-helpers.js` 新增 `makeMockSnapshot`，支持声明式（`graph`/`reverseGraph`/`entryFiles` + `depGraphOverrides`）和直接（`mockDepGraph`）两种模式。默认 stubs 覆盖全部 `DependencyGraphView` 委托方法。
  - 试点重构：`dep-tools-test.js`/`overview-tools-test.js`/`project-map-test.js` 从手工 mock 迁移到工厂调用，断言零变更。
  - 验证：3 个试点文件单独运行 PASS；fast 100/100 PASS；slow 27/27 PASS。

### 修复（测试回归：`analysis-test.js` dead-exports 断言在自身仓库失效 — 2026-05-19）

- **`analysis-test.js` 的 `dead-exports`/`unresolved` 测试改为以临时目录为 `--cwd`** `test/analysis-test.js`：
  - 问题：测试在 `os.tmpdir()` 下创建 `partial-exports.js`/`partial-consumer.js`/`test-module.js`，但 CLI 调用使用 `--cwd .`（workspace-bridge 自身仓库）。自身仓库经 P0 去噪工程后 `deadExports=0`，导致 `assert(deadExportsCount >= 1)` 持续失败。
  - 修复：在临时目录下创建 `package.json` 作为项目根标记；`dead-exports`/`unresolved` CLI 调用改为 `--cwd <testDir>`，确保扫描的是包含预期死代码/未解析 import 的临时项目。
  - 验证：`analysis-test.js` PASS；slow 层 26/26 PASS；runner 全量回归中该测试从 FAIL 恢复为 PASS。

### 文档（技术债务清理：CLI 集成测试条目已过时 — 2026-05-19）

- **更新 `docs/TECH_DEBT.md`「测试类型分布失衡」条目** `docs/TECH_DEBT.md`：
  - 问题：方案1仍写着"新增 3–4 个 CLI 集成测试"，但 `cli-integration-test.js`（8 个测试函数）已于同日在 CHANGELOG [Unreleased] 中记录为已完成，且 `analysis-test.js` 修复后重新生效。该方案属于文档膨胀（已修复条目仍留在活跃文档中）。
  - 清理：将方案1标记为 ✅ 已完成，更新根因/影响描述，反映当前真实状态（CLI 管道回归保护已建立，主要剩余缺口是端到端测试 2%）。

### 文档（新增活跃架构债务：L4 层散乱 + runner 分类机制 — 2026-05-19）

- **记录 L4 工具编排层缺乏统一组装 facade** `docs/TECH_DEBT.md` `src/cli/commands/`：
  - 观察：`audit-summary.js`（71 行）手动组装 4 个工具结果并直接操作内部字段；`audit-diff.js`（206 行）自行组装 git + impact + line ranges；12 个透传命令仅 7 行，但 4 个策展命令各自重复组装逻辑。severity 过滤、baseline save/regression check 横切关注点分散在个别命令中。
  - 根因：L4 只有 "thin router"（`dep-tools.js` 的 `OPERATIONS`），没有统一的 audit assembler。策展逻辑被迫上浮到 CLI 命令处理器（L5），边界模糊。
  - 方案：提取 `audit-assembler.js`，封装单工具查询、策展组装、横切过滤器三层。

- **记录 `runner.js` 慢测试分类机制脆弱** `docs/TECH_DEBT.md` `test/runner.js`：
  - 观察：`KNOWN_SLOW_PATTERNS` 是 21 个硬编码正则，新增集成测试时作者易忘加入；`affected-tests-heuristic-test.js` 被 fallback 分到 fast 层并发跑，但构建大规模 mock depGraph，Windows 下偶发失败；smoke 模式按字母序取前 3 个 slow 测试，不具代表性。
  - 方案：runner 启动时自验证（扫描 `runCli`/`spawnSync` 但不在 slow 列表的打印 WARNING）；引入 `// @slow` / `// @watch` 头部标记替代文件名列表；smoke 代表引入模块维度权重或 `// @smoke-representative` 标记。

- **校准文件级雷区地图行数** `docs/TECH_DEBT.md`：
  - 9 个文件行数全部更新为当前 `wc -l`（dep-graph 1582→1685、overview-tools 868→711、validation-advice 312→140 等）。

### 修复（L2 债务：`noLintersDetected` 计算方式脆弱 — 2026-05-19）

- **`noLintersDetected` 改为直接跟踪 linter 存在性，而非间接推导** `src/tools/workspace-tools.js` `test/workspace-tools-test.js`：
  - 问题：`buildChecks` 中 `noLintersDetected` 通过 `checks.some((c) => c.name !== 'workspace:git-status')` 间接推导。当 `mode === 'full'` 时 `node:build`/`node:test` 被加入 checks，导致 `hasCodeChecker = true`，`noLintersDetected = false`——即使实际上没有 eslint/ruff/tsc 等 linter。
  - 修复：引入 `hasLinter` 变量，在添加真正的 linter 或 type-checker（`node:typecheck`/`node:tsc`/`node:lint`/`node:eslint`/`python:ruff`/`python:pyright`/`django:check`）时显式标记。`node:build`/`node:test`/`python:compileall`/`python:pytest` 不再影响 `noLintersDetected`。
  - 结果：L2 债务清零（TECH_DEBT.md 移除该条目）。
  - 验证：`workspace-tools-test.js` 3 个现有测试仍通过；fast 101/101 PASS。

### 功能（阶段 2 深化：`--format ai` 统一入口 — 2026-05-19）

- **扩展 `formatAi` 策展能力至所有 CLI 命令** `src/cli/formatters/human-formatters.js`：
  - 问题：仅 `audit-summary` 享受 `formatAi` 的深度策展（`topRisks`/`actions`/`confidence`/`depth`/`tokenBudget`）；其他命令返回轻量 JSON wrapper，其中 `summary` 字段是纯文本，AI 被迫解析多行字符串。
  - 修复：新增 `buildCommandAiDigest(command, result)`，为 `dead-exports`/`impact`/`affected-tests`/`cycles`/`unresolved`/`audit-security`/`audit-diff` 生成结构化 `topRisks` + `actions`。非 `audit-summary` 命令的 `--format ai` 输出现在统一包含 `severity`/`counts`/`topRisks`/`actions`/`confidence`，且支持 `depth`（`surface` 精简输出）和 `tokenBudget`（超限自动降级）。
  - 向后兼容：`summary` 字段仍保留人类可读文本，不破坏现有管道。
  - 验证：`impact --format ai --depth surface` / `dead-exports --format ai --depth detail` 输出结构化 JSON；fast 101/101 PASS。

### 重构（L3 品味：formatter security 重复模式 — 2026-05-19）

- **提取 `buildSecurityLines()` 消除 `audit-security` 三个 formatter 的重复逻辑** `src/cli/formatters/human-formatters.js`：
  - 问题：`formatMarkdown`/`formatSummary`/`formatHuman` 三个 `audit-security` case 输出结构高度相似（adapters/findings/severity 元信息 + findings 列表 + matchedText），新增 security 字段需改 3 处，容易遗漏。
  - 修复：提取 `buildSecurityLines(result, style)` 纯函数，通过 `style` 参数（`'markdown'|'summary'|'human'`）控制 bullet 格式、大小写、findings 数量限制（10/5/20）、message 展示策略（summary 不展示 message）。三个 case 各压缩为 1-2 行调用。
  - 验证：`formatter-direct-test.js` 现有 `testFormatMarkdownAuditSecurity` 通过；fast 101/101 PASS。

### 修复（L2-6 裸数字归零：测试硬编码 timeout — 2026-05-19）

- **`java-parsers-test.js` 硬编码 `timeout: 15000` 改为 `TIMEOUTS.HEALTH_SHORT_TIMEOUT_MS`** `test/java-parsers-test.js`：
  - 问题：`isJavalangAvailable()` 中 `spawnSync` timeout 写死 15000，无 rationale，与 constants.js 中已有同名常量重复。
  - 修复：import `TIMEOUTS` 并替换。测试文件引用 constants.js 已有先例（`graph-db-test.js` / `spawn-ast-test.js` 等）。
  - 验证：`java-parsers-test.js` PASS；fast 101/101 PASS。

### 功能（P0 去噪工程：死代码过滤链 — 2026-05-19）

- **引入 CRG 死代码过滤链前 5 条规则** `src/services/dep-graph.js` `test/dead-export-confidence-test.js`：
  - 来源：code-review-graph `refactor.py:find_dead_code()` 15+ 条排除规则。
  - 新增规则：
    1. `.d.ts` 环境声明文件整体跳过（类型导出非运行时代码）。
    2. `constructor` 符号过滤（JS/TS 类方法不应被模块导出）。
    3. dunder 方法过滤（`__init__`/`__str__` 等 Python 魔术方法）。
    4. mock/stub/spy/fake 命名模式过滤（`mockUserService`/`stubDatabase` 等测试约定俗成命名）。
  - 实现：提取 `isConventionallyAliveSymbol(name)` 纯函数 + `DEAD_EXPORT_FILTER_RE` 常量表；同时作用于"无 importer"分支和"有 importer 但 unused"分支，避免过滤遗漏。
  - 测试：新增 `testDtsFilesAreSkipped` / `testConstructorIsFiltered` / `testDunderMethodsAreFiltered` / `testMockLikeNamesAreFiltered`。
  - 验证：`dead-export-confidence-test.js` 10/10 PASS；fast 101/101 PASS。

### 重构（L2-7 重复即债务：eslint/prettier 配置文件列表统一 — 2026-05-19）

- **提取 `PROBE.ESLINT_CONFIG_FILES` / `PROBE.PRETTIER_CONFIG_FILES` 消除 `workspace-tools.js` 与 `diagnostics-engine.js` 的重复定义** `src/config/constants.js` `src/tools/workspace-tools.js` `src/services/diagnostics-engine.js`：
  - 问题：`workspace-tools.js#detectNodeLinters` 和 `diagnostics-engine.js#hasChecker('eslint')` fallback 各自内联维护一份 eslint 配置文件列表（`.eslintrc.js`/`.json`/`.cjs`/`.yaml`/`.yml`/`eslint.config.js`/`eslint.config.mjs`/`.eslintrc`）。新增 eslint 配置格式（如 `eslint.config.cjs`）时需要在两处同时添加，容易遗漏； prettier 配置文件列表同样在 `workspace-tools.js` 中内联定义。
  - 修复：`constants.js` 新增 `PROBE` 常量组，集中存放环境探测用的配置文件列表（附注释说明 rationale：集中管理以保证静态检测和运行时 fallback 的一致性）。`workspace-tools.js` 和 `diagnostics-engine.js` 改为引用 `PROBE.ESLINT_CONFIG_FILES` / `PROBE.PRETTIER_CONFIG_FILES`。
  - 验证：`workspace-tools-test.js` PASS；`diagnostics-engine-test.js` PASS；fast 101/101 PASS。

### 重构（L1-3 数据一致性 + L2-6 裸数字归零：cache/diagnostics/framework-patterns — 2026-05-19）

- **`cache.js` `CACHE_STALE_MS` 改为引用 `DEFAULTS.STALENESS_THRESHOLD_MS`** `src/services/cache.js`：
  - 问题：`CACHE_STALE_MS = 24 * 60 * 60 * 1000` 与 `constants.js` `DEFAULTS.STALENESS_THRESHOLD_MS` 重复定义同一语义（缓存过期阈值 = 24 小时），违反 L1-3「同一业务语义必须在单一模块实现」。
  - 修复：`cache.js` 直接引用 `DEFAULTS.STALENESS_THRESHOLD_MS`，删除本地重复常量。
  - 验证：`cache-test.js` / `cache-consistency-test.js` / `cache-stale-prune-test.js` PASS；fast 101/101 PASS。

- **`diagnostics-engine.js` `DEBOUNCE_MS: 1000` 提取到 `DEFAULTS.DIAGNOSTICS_DEBOUNCE_MS`** `src/services/diagnostics-engine.js` `src/config/constants.js`：
  - 问题：诊断引擎内部写死 `DEBOUNCE_MS: 1000`，无集中管理。
  - 修复：`constants.js` `DEFAULTS` 新增 `DIAGNOSTICS_DEBOUNCE_MS: 1000`（附 rationale 注释：1s 平衡响应性与批处理）；`diagnostics-engine.js` 改为引用常量。
  - 验证：`diagnostics-engine-test.js` PASS；fast 101/101 PASS。

- **`framework-patterns.js` `4096` 改为 `DEFAULTS.ENTRY_SCAN_BYTES`** `src/services/dep-graph/framework-patterns.js`：
  - 问题：`content.slice(0, 4096)` 使用裸数字，与 `constants.js` `ENTRY_SCAN_BYTES: 4096` 重复。
  - 修复：引入 `DEFAULTS`，替换为 `DEFAULTS.ENTRY_SCAN_BYTES`。
  - 验证：`framework-patterns-test.js` PASS；fast 101/101 PASS。

### 重构（L2-6 裸数字归零：测试代码硬编码 timeout + fixture 路径 — 2026-05-19）

- **`e2e-gitnexus-test.js` 3 处 `timeout: 120000` 改为 `TIMEOUTS.TEST_RUNNER_MS`** `test/e2e-gitnexus-test.js`：
  - 问题：E2E GitNexus 测试 3 次 spawn CLI 均写死 120000ms，无 rationale，与 `constants.js` 已有常量重复。
  - 修复：引入 `TIMEOUTS`，统一替换。
  - 验证：`e2e-gitnexus-test.js` PASS；fast 101/101 PASS。

- **`analysis-test.js` 硬编码 `fixture-temp` 改为 `os.tmpdir()` 隔离** `test/analysis-test.js`：
  - 问题：测试在 `__dirname/../fixture-temp` 创建文件，该目录不在 `.gitignore` 中，测试中断会污染工作区。
  - 修复：引入 `os` 和 `crypto`，用 `path.join(os.tmpdir(), 'wb-test-analysis-' + random)` 生成临时目录；原有 finally 清理逻辑不变。
  - 验证：`analysis-test.js` PASS；fast 101/101 PASS。

- **`framework-usage-patterns-test.js` 硬编码 `fixture-temp-framework` 改为 `makeTempDir`** `test/framework-usage-patterns-test.js`：
  - 问题：两处测试在 `__dirname/../fixture-temp-framework*` 创建目录，同样存在污染工作区风险。
  - 修复：使用 `test-helpers.js` 已有的 `makeTempDir('framework-')` / `makeTempDir('framework-missing-')` 替换；`cleanupTempDir` 保持不变。
  - 验证：`framework-patterns-test.js` PASS；fast 101/101 PASS。

### 重构（架构债务：`formatAi` counts/digest 耦合 + token 估算裸数字 — 2026-05-19）

- **单一数据源驱动 `formatAi` 的 `counts` 与 `topRisks`/`actions`** `src/cli/formatters/human-formatters.js` `src/config/constants.js`：
  - 问题：`formatAi` 中 `counts` 字段（418–426 行）手动映射 6 个命令的计数字段；`buildCommandAiDigest` 覆盖 7 个命令的 `topRisks`/`actions`。两者集合不一致（`audit-security` 的 `summary.total` 未被 counts 映射），新增 CLI 命令需同时改两处，容易遗漏。
  - 修复：`buildCommandAiDigest` 改为返回 `{ topRisks, actions, counts }`，每个 `switch` case 内部自洽地设置对应 count 字段（`deadExports`/`impact`/`affectedTests`/`cycles`/`unresolved`/`securityFindings`/`highCompositeRiskFiles`）。`formatAi` 非 `audit-summary` 分支直接解构 `counts`，删除手动映射代码块。
  - 结果：新增 CLI 命令的 AI 输出只需在 `buildCommandAiDigest` 一处维护。
  - 验证：`formatter-direct-test.js` 现有 `testFormatAiTokenBudgetDowngrade` / `testFormatAiDepthSurface` 通过；fast 101/101 PASS。

- **`/ 4` token 估算裸数字归零** `src/cli/formatters/human-formatters.js` `src/config/constants.js`：
  - 问题：`formatAi` 第 449 行和第 623 行使用 `JSON.stringify(output).length / 4` 估算 token 数，`/ 4` 是"平均每 token 4 字符"的启发式，无命名常量、无注释说明 rationale 和误差范围。
  - 修复：在 `constants.js` 新增 `AI_FORMAT.ESTIMATED_CHARS_PER_TOKEN = 4`，附注释说明该值基于 UTF-8 英文文本平均 token 长度，实际误差可达 ±30%。`human-formatters.js` 两处 `/ 4` 替换为 `/ AI_FORMAT.ESTIMATED_CHARS_PER_TOKEN`。
  - 验证：fast 101/101 PASS。

### 优化（阶段 2：`--format summary` 纯模板摘要深化 + hotspot reason 组合展示 — 2026-05-19）

- **`--format summary` 补全 10 个命令的紧凑输出** `src/cli/formatters/human-formatters.js` `test/formatter-direct-test.js`：
  - 问题：`formatSummary()` 仅对 8 个命令有专用 case，`workspace-info`/`diagnostics`/`audit-map`/`stats`/`dependencies`/`dependents`/`dead-exports`/`unresolved`/`cycles`/`tree` 等 10 个命令 fallback 到 `formatHuman()`，导致 `--format summary` 下输出不紧凑。
  - 修复：为上述 10 个命令逐一添加 `formatSummary` case，输出控制在 2-4 行关键结论（如 `Dependencies: 3\nsrc/a.js, src/b.js`），与已有 summary 风格保持一致。
  - 验证：`formatter-direct-test.js` 新增 `testFormatSummaryMissingCommands()` 覆盖全部 10 个命令；fast 101/101 PASS。

- **hotspot `reason` 组合展示：耦合信号不再被历史信号淹没** `src/tools/overview-tools.js`：
  - 问题：`buildHotspots()` 中 reason 构建仅在 `coupling.total > COUPLING_MEDIUM_MIN`（10）时才把耦合信息拼接进 reason；对于 coupling 5-9 的高耦合新文件，reason 只显示 git 历史信号（如"No tracked history"），AI 无法从 reason 中获知真正风险来自被大量模块依赖（AGENTS.md §已知陷阱）。
  - 修复：拆分 `historySignal` 与 `couplingSignal`，只要 `coupling.total > 0` 就始终将耦合信息纳入 reason；两者共存时格式为 `耦合 X 个模块 · <historySignal>`。
  - 验证：`overview-tools-concurrency-test.js` / `overview-tools-test.js` / `precompute-hotspot-test.js` 均不硬编码 reason 字符串，无回归；fast 101/101 PASS。

### 重构（P2：CLI 路由表化 — 2026-05-19）

- **将 `cli.js` `runCommand` ~350 行 switch 拆分为 `src/cli/commands/*.js` 独立处理器 + `COMMANDS` 注册表** `cli.js` `src/cli/commands/` `src/utils/async.js` `src/config/constants.js`：
  - 问题：`cli.js` 1044 行中 `runCommand` 占 ~350 行硬编码 switch，覆盖 21 个命令。新增命令必须修改 `runCommand` 路由，formatter 和路由耦合在同一文件。
  - 提取共享辅助函数：`SCHEMA_VERSION` 从 `cli.js` 顶部移至 `src/config/constants.js`（裸数字归零）；`mapWithConcurrency` 从 `cli.js` 提取至 `src/utils/async.js`（通用并发工具归位 utils）；`requireFile` + `severityMeetsFilter` + `validateCwd` 提取至 `src/cli/commands/_utils.js`（命令层共享工具）。
  - 新建 21 个命令处理器：`src/cli/commands/{workspace-info,diagnostics,audit-summary,audit-file,audit-diff,audit-overview,audit-map,health,audit-security,stats,dependencies,dependents,dead-exports,unresolved,cycles,impact,affected-tests,tree,repl,watch,init}.js`，统一签名 `async function handler(parsed, container)`。
  - 新建注册表：`src/cli/commands/index.js` 导出 `COMMANDS` 映射表，与 `dep-tools.js` 的 `OPERATIONS` 注册表形成对称。
  - `cli.js` 瘦身：从 ~1044 行降至 ~509 行；`runCommand` 从 ~350 行 switch 压缩为 6 行注册表查找；顶部 require 从 15+ 个工具模块降至 5 个核心模块（ServiceContainer、toPosixPath、formatters、parseArgs、constants）。
  - 结果：新增命令只需"一个文件 + 注册表一行"，不再需要修改 `cli.js`。P0-P4 规划中最后一个结构性债务清零。
  - 验证：`audit-summary`/`audit-file`/`impact`/`workspace-info`/`stats`/`--help` 均正常；fast 101/101 PASS；全量 runner 129/129 PASS。

### 测试（CLI 集成测试补齐 — 2026-05-19）

- **扩展 `test/cli-integration-test.js` 覆盖 4 个缺乏管道回归保护的命令** `test/cli-integration-test.js`：
  - 问题：`affected-tests`/`dependencies`/`dependents`/`cycles` 等命令只有单元测试（直接 `require src/`），没有通过真实 CLI 进程的端到端验证；参数传递、exit code、JSON 输出契约缺乏回归保护。
  - `testAffectedTests`：创建有测试关联场景的项目（`src/util.js` → `src/app.js` → `test/app.test.js`），验证 `affected-tests --file src/util.js` 返回 `test/app.test.js`。
  - `testDependencies`：创建 import 链项目，验证 `dependencies --file src/app.js` 返回 `src/lib.js`。
  - `testDependents`：创建 import 链项目，验证 `dependents --file src/lib.js` 返回 `src/app.js`。
  - `testCycles`：创建循环依赖项目（`a→b→c→a`），验证 `cycles` 检测到至少 1 个循环，且循环包含 `src/a.js`。
  - 结果：cli-integration-test.js 从 4 个测试扩展到 8 个，slow 层 24/24 PASS。

### 修复（P0：`--exclude` Windows 反斜杠兼容性 — 2026-05-19）

- **CLI 入口对 `--exclude` 值统一归一化正斜杠** `cli.js` `test/cli-exclude-backslash-test.js`：
  - 问题：Windows 用户本能写 `--exclude src\views`（反斜杠分隔），`parseCliArgs` 原样传递反斜杠给 `shouldExcludeCli`；非 glob 模式下 `matchesPathFragment` 内部已有 `toPosixPath` 可兼容，但 glob 模式下正则构建直接把反斜杠当作字面量匹配，导致正斜杠路径无法命中。
  - 修复：`cli.js` `exclude` 解析链中对每个 part 调用 `toPosixPath()`，与已有 `raw.file` 的处理模式保持一致。`src\views` → `src/views`、`src\views\*.js` → `src/views/*.js`。
  - 测试：`test/cli-exclude-backslash-test.js` 覆盖：正斜杠排除生效、反斜杠排除结果与正斜杠一致、反斜杠 glob 与正斜杠 glob 行为一致、混合分隔符单目录排除。

### 修复（`--format ai` 完整管道 + CLI 集成测试补齐 — 2026-05-19）

- **修复 `--format ai` 对非 audit-summary 命令返回纯文本的契约不一致** `src/cli/formatters/human-formatters.js`：
  - 原行为：`formatAi()` 对 `impact`/`tree`/`audit-file`/`dead-exports` 等命令 fallback 到 `formatSummary()`（纯文本），导致 `--format ai --json` 组合下管道下游 `JSON.parse` 崩溃。
  - 修复：非 `audit-summary` 命令返回轻量 JSON 包装 `{ ok, schemaVersion, command, severity, summary }`，与 `audit-summary` 的 JSON 输出保持契约一致。
  - 验证：`impact --format ai --json` 现在返回可解析 JSON（keys: ok/schemaVersion/command/severity/summary）。

- **扩展 CLI 集成测试覆盖 `--format ai` 全命令管道** `test/cli-pipeline-depth-test.js`：
  - 新增 4 个测试：`testImpactAiFormat`、`testTreeAiFormat`、`testAuditFileAiFormat`、`testDeadExportsAiFormat`。
  - 验证每个命令的 `--format ai` 输出包含 `ok`/`schemaVersion`/`command`/`severity`/`summary`。
  - 验证非 `audit-summary` 命令传 `--depth`/`--token-budget` 不崩溃（参数透传安全）。

### 修复（CLI 集成测试断言修正 — 2026-05-19）

- **修正 `test/cli-pipeline-depth-test.js` 中 4 类错误断言** `test/cli-pipeline-depth-test.js`：
  - `formatAi` 输出中不含 `format`/`depth`/`tokenBudget` 输入参数字段，移除对它们的直接断言；改为断言 `schemaVersion`/`meta`/`actions` 等实际输出字段的存在性。
  - `validationAdvice.commands` 是命令对象数组，不是 `{ smoke, focused }` 结构；改为断言 `Array.isArray(commands)` 及 `suggestedCommand` 字符串。
  - `tokenBudget` 测试原用 `200` 预算，3 文件小项目的 detail 输出仅 ~150 tokens，无法触发降级；改为 `50` 预算以确保实际触发 surface 降级路径。
  - 测试通过：fast 101/101，slow 23/23。

### 优化（测试 runner 分层与并发提速 — 2026-05-19）

- **测试 runner 支持分层运行** `test/runner.js` `package.json`：
  - 问题：127 个测试全量运行需 ~7 分钟，开发迭代反馈太慢；21 个集成测试反复冷启动 CLI、全量建图、加载 WASM，与 100+ 纯单元测试混在一起跑。
  - 新增 `--layer fast|slow|watch|all` 参数，runner 按文件名 + 内容启发式自动分类：
    - `fast`：纯单元测试（无 `runCli`、无 CLI spawn），101 个文件，实测 **~14s**
    - `slow`：集成/E2E 测试（含 `runCli` 或直接 `spawnSync node cli.js`），21 个文件，实测 **~100s**
    - `watch`：串行 watch 测试（文件名匹配 `/watch/`），4 个文件
    - `all`：全部（默认行为，向后兼容），全量实测 **~4min**（原 ~7min）
  - 新增 `--smoke` 快速模式：fast 层 + 3 个代表性 slow 测试，实测 **~31s**，用于开发迭代快速验证。
  - 全量 runner 改为**分阶段执行**：先跑 fast（高并发 12）→ 再跑 slow（低并发 4）→ 最后串行 watch。避免 slow 测试拖住 fast 测试的批次。
  - `package.json` 新增 4 条脚本：`test:fast`、`test:slow`、`test:watch`、`test:smoke`。

### 重构（架构债务清零：跨层依赖与职责纠缠 — 2026-05-18）

- **消除 L4→L5 反向依赖** `src/tools/overview-tools.js` `src/utils/recommendations.js` `src/cli/formatters/repo-summary.js`：
  - 问题：`overview-tools.js`（L4 工具层）直接 `require('../cli/formatters/recommendation-engine')`，工具层偷偷干了格式化的活，架构图依赖箭头方向反转。
  - 修复：把 `buildUnresolvedRecommendation` / `buildCycleRecommendation` / `buildDeadExportRecommendation` 从 `src/cli/formatters/recommendation-engine.js` 提取到 `src/utils/recommendations.js`（L0/L1 层）。`overview-tools.js` 改为 `require('../utils/recommendations')`，`repo-summary.js` 改为 `require('../../utils/recommendations')`。删除 `src/cli/formatters/recommendation-engine.js`。
  - 结果：L4→L5 反向依赖消除，工具层与格式化层边界恢复。

- **消除 L2→L4 跨层依赖** `src/services/dep-graph.js` `src/tools/honesty-engine.js` `src/cli/formatters/repo-summary.js` `test/*`：
  - 问题：`dep-graph.js`（L2 核心引擎）直接 `require('../tools/scaffold-detector')`，核心引擎被工具层细节污染。
  - 修复：把 `scaffold-detector.js` 从 `src/tools/` 移至 `src/utils/`（L0/L1 层），更新 4 个生产文件 + 2 个测试文件的引用路径。
  - 结果：L2 核心引擎正常依赖基础设施层，scaffold-detector 的接口变更不再向上传导到 dep-graph.js。

- **拆分 `overview-tools.js`** `src/tools/overview-tools.js` `src/tools/overview-curator.js`：
  - 问题：924 行的 `overview-tools.js` 既做数据聚合（hotspot/stability/coupling）又做策展生成（recommendations / nextSteps 拼装），违反"文件只做一件事"。
  - 修复：新建 `src/tools/overview-curator.js`，提取 `buildOverviewSummary` / `buildCycleRefactorSuggestions` / `buildCouplingSplitSuggestions` / `generateCouplingSplitPlan` / `calculateCoupling` / `normalizeCycle` / `pickBreakEdge` 及 `COUPLING_ADVICE_RULES`。`overview-tools.js` 保留数据计算 + `buildProjectOverview` 主入口，通过 `require('./overview-curator')` 调用策展函数。`buildOverviewSummary` 扩展签名接收 `cycleRefactorSuggestions` 和 `couplingSplitSuggestions`，在内部统一 push 到 `summary.recommendations`，消除 `buildProjectOverview` 中分散的 push 逻辑。
  - 结果：`overview-tools.js` 从 924 行降至 ~700 行；数据计算与策展生成物理分离；新增命令只需改对应文件。

### 修复（P0：healthScore 诚实评分 — 2026-05-18）

- **`health-tools.js` 消除撒谎式 `5/5` 评分，改为按实际检查项数诚实计算** `src/tools/health-tools.js` `SESSION.md`：
  - 问题：原算法用 `Math.max(5, coreTotal + 1)` 强制总分锁死 5，且 `bonusPassed > 0 ? 1 : 0` 把 4 个 bonus 检查项压缩成 1 个点。结果是缺 `dockerConfig` 的项目与全满项目同为 `5/5`，AI 看到满分便不会去看 `fixes[]`。
  - 修复：废除 core/bonus 压缩逻辑，所有相关检查项（readme、license、gitignore、envExample、editorconfig、testConfig、ci、dockerConfig）统一计数。总分 = 实际检查项数，通过分 = 实际通过数。
  - 结果：workspace-bridge 自身从 `5/5` → `7/8`（缺 dockerConfig），ratio 从 1.0 → 0.875，`fixes[]` 非空与分数不匹配的矛盾消除。
  - 向后兼容：`healthScore` 仍为 `"passed/total"` 字符串格式，`healthScoreNumeric` 结构不变；消费者若硬编码 `=== '5/5'` 判断完美健康会失效，但 AGENTS.md 明确 userspace 仅项目所有者本人时兼容义务让位。

### 新增（P3：Co-change 分析 — 2026-05-18）

- **实现 git 历史共变文件对（co-change）检测，为 impact 输出补充"常与谁一起改"信号** `src/tools/cochange-tools.js` `src/services/cache.js` `src/services/container.js` `src/tools/dep-tools.js` `test/cochange-test.js`：
  - 问题：`impact` 命令只回答"谁依赖我"，不回答"我过去常与谁一起变更"；后者对代码审查和重构优先级排序有独立价值（移植自 qartez-mcp git/cochange.rs 启发）。
  - `cochange-tools.js`：新增 `analyzeCoChanges(workspaceRoot)` 遍历近期 git log，统计同 commit 内文件对共现次数；`getCoChangePartners(filePath)` 按共现次数排序返回 top partners。
    - **实现**：单次 `git -C <path> log --format=%H --name-only --no-merges -n <limit>`（`spawnSync`）取代逐 commit `git diff-tree --root`（212 次 `execSync`）。
    - **性能**：workspace-bridge 自身（212 commits）从 ~20,000ms 降至 ~76ms（~260×）。
    - **兼容性**：使用 `git -C` 参数代替 `execSync` 的 `cwd` 选项，消除 Windows 中文路径下 `spawnSync cmd.exe ENOENT`（Node child_process cwd 编码缺陷）。
  - `cache.js`：新增 `coChanges` 内存字段 + `_loadCoChanges()` / `saveCoChanges()`，通过 `graph-db.js` `getMetadata`/`setMetadata` 持久化到 SQLite，避免每次冷启动重新遍历 git history。
  - `container.js`：`initialize()` build 完成后仅在 `cache.coChanges` 为 null 时调用 `_precomputeCoChanges()` 预热，避免每次 CLI 启动重复计算；从 `onPendingProcessed`（文件增量更新回调）中移除 `_precomputeCoChanges()`，因为 co-change 基于 git history 而非文件变更，无需在文件变化时重新计算。
  - `dep-tools.js` `case 'impact'`：从 `container.cache.coChanges` 读取并注入 `coChanges: []` 字段；`relativeFile` 统一归一化为正斜杠（`replace(/\\/g, '/')`），消除 Windows 反斜杠与 git 正斜杠路径不匹配导致的 partners 为空。
  - 测试：`test/cochange-test.js` 覆盖 commit co-occurrence 统计、merge commit 跳过、大 commit 过滤、partner 查询限流。
  - 向后兼容：无 git 历史或非 git 仓库时 `coChanges` 返回 `[]`，行为 100% 安全降级。

### 新增（P0：PageRank warm-start 集成 — 2026-05-18）

- **启用 `GraphAnalyzer.computePageRank()` 的 warm-start，减少增量更新时的迭代次数** `src/services/cache.js` `src/services/dep-graph.js` `src/services/graph-db.js` `test/pagerank-warmstart-integration-test.js`：
  - 问题：`pagerank.js` 算法层已支持 `prevRanks` warm-start（移植自 qartez-mcp），但 `GraphAnalyzer.computePageRank()` 每次都冷启动，未利用上一次的收敛结果。
  - cache 层：`cache.js` 新增 `pageRanks` 内存字段 + `_loadPageRanks()` / `savePageRanks()` 方法，通过 `graph-db.js` `getMetadata`/`setMetadata` 读写 SQLite `cache_metadata` 表，零 schema 变更。
  - graph 层：`GraphAnalyzer.computePageRank()` 从 `this.dg.cache.pageRanks` 加载 `prevRanks` 传入 `computePageRank()`；计算完成后通过 `cache.savePageRanks()` 持久化。
  - 导出：`dep-graph.js` `module.exports` 新增 `GraphAnalyzer`（供测试直接实例化）。
  - 测试：`test/pagerank-warmstart-integration-test.js` 覆盖 cold-start 保存、warm-start 复用（结果与 cold 一致）、新增节点 graceful fallback、无 cache 环境兼容性。
  - 向后兼容：无 cache 时 `prevRanks = undefined`，行为 100% 同冷启动。

### 修复（测试债务：`rust-workspace-test.js` 同步上一轮设计变更 — 2026-05-18）

- **更新 `test/rust-workspace-test.js` 断言以匹配单 crate focused 命令行为** `test/rust-workspace-test.js`：
  - 上一轮会话（CHANGELOG ~107 行）为单 crate Rust 项目新增 `cargo test` fallback focused 命令，但测试未同步更新，导致 `assert(!commands.focused.some(...))` 失败。
  - 修复：将"不应生成"改为"应生成 fallback `cargo test`"，与 `buildRustTestCommands` 的 `else if (rustFiles.length > 0)` 分支对齐。

### 新增（P2：预计算聚合表扩展 hotspot/stability — 2026-05-18）

- **`buildProjectOverview` 优先复用预计算的 hotspot/stability，避免重复 git history 查询** `src/tools/overview-tools.js` `src/services/container.js` `src/services/dep-graph.js` `test/precompute-hotspot-test.js`：
  - 问题：`audit-overview` 每次执行都重新调用 `buildHotspots()`（异步 git log 批处理）和 `buildStability()`（遍历 mainlineFiles），即使图结构未变。对于 50+ mainline 文件的项目，这是 ~100-500ms 的重复开销。
  - `overview-tools.js`：新增 `precomputeHotspotsAndStability(depGraph)` 纯函数，复用 `buildHotspots`/`buildStability` 的现有逻辑计算并返回 `{ hotspots, stability }`。
  - `overview-tools.js` `buildProjectOverview`：优先检查 `depGraph.analyzer._aggregateCache.hotspots` / `.stability`，version 匹配时直接复用，否则 fallback 实时计算。
  - `container.js`：`initialize()` 中 `build()` 完成后调用 `_precomputeOverview()` 预热缓存；`onPendingProcessed`（增量更新）后同样调用，确保图变更后缓存保持新鲜。
  - `dep-graph.js` `precomputeAggregates()`：`_aggregateCache` 结构扩展 `hotspots` / `stability` 字段（初始为 null），兼容旧缓存加载。
  - 测试：`test/precompute-hotspot-test.js` 验证 container init 后 cache 被填充、两次 `buildProjectOverview` 调用间 cache 引用稳定（不被重新分配）。
  - 向后兼容：无 `_aggregateCache` 时 `buildProjectOverview` 100% fallback 到实时计算；`saveAggregateSummary` 自动序列化新字段。

### 修复（P0：`--cwd` 不存在/挂起 + 消除重复校验 — 2026-05-18）

- **`cli.js` `main()` 复用 `validateCwd()` 消除重复校验** `cli.js`：
  - `main()` 中原 inline `fs.existsSync + fs.statSync.isDirectory` 校验替换为调用已有 `validateCwd(parsed)`，消除与 `init`/`repl`/`watch` 命令路径中 `validateCwd` 的重复逻辑。
  - 行为不变：`--cwd` 指向不存在的目录时仍立即返回 `{ ok: false, error: 'Directory not found: ...' }`，exit code = 1。

### 修复（P1：surface 模式变薄 — 2026-05-18）

- **`formatAi` surface depth 输出精简到 <150 tokens** `src/cli/formatters/human-formatters.js` `test/formatter-direct-test.js`：
  - 问题：`--depth surface` 与 `--depth detail` 输出结构几乎相同（仅缺少 `riskFiles`），surface 仍携带 `meta`/`actions`/`confidence`/`schemaVersion`/`warnings`，导致 200+ tokens，AI 消费不友好。
  - 修复：`buildOutput('surface')` 返回精简结构 `{ ok, severity, counts, topRisks }`，`topRisks` 截断到最多 3 条且去掉 `message`/`confidence`，仅保留 `category`/`severity`/`count`。
  - 测试同步：`testFormatAiAuditSummarySurface` 验证 `actions`/`confidence`/`meta`/`warnings` 不存在；新增 `json.length < 600`（≈150 tokens）体积断言；`testFormatAiWithWarnings` 改在 detail 模式验证 warnings，surface 模式验证 warnings 被剥离。
  - 向后兼容：`detail`/`full` 输出 100% 不变。

### 修复（P1：diagnostics 找到实际 linter — 2026-05-18）

- **`diagnostics-engine.js` `hasChecker('eslint')` 增加配置文件 fallback 检测** `src/services/diagnostics-engine.js`：
  - 问题：`hasChecker` 仅通过 `eslint --version`（即 `checkNodeModule`）检测 eslint 可用性；若 eslint 未全局/局部安装（如 CI 环境未跑 `npm install`），`hasChecker` 返回 `false`，但 `workspace-tools.js` 的 `detectNodeLinters` 通过配置文件检测认为 eslint 可用，导致 `workspace-info` 与 `diagnostics` 结果矛盾。
  - 修复：`hasChecker('eslint')` 在 `checkNodeModule` 返回 `false` 时，fallback 检测 eslint 配置文件列表（`.eslintrc.js` 等）和 `package.json#eslintConfig`，与 `detectNodeLinters` 逻辑对齐。
  - 向后兼容：eslint 已安装时行为 100% 不变；仅对"有配置但无安装"场景消除 false negative。

### 修复（L3 品味：npx 版本锁定 — 2026-05-18）

- **SKILL.md / SKILL-REFERENCE.md 中 `npx workspace-bridge-cli` 追加版本锁定** `skills/workspace-audit/SKILL.md` `skills/workspace-audit/SKILL-REFERENCE.md`：
  - 问题：`npx workspace-bridge-cli` 可能自动安装最新版本，schema 变更后 AI 解析直接崩。
  - 修复：所有 `npx workspace-bridge-cli` 引用改为 `npx workspace-bridge-cli@1.2.0`。

### 修复（L3 品味：`parserAvailability.skipped` 命名陷阱 — 2026-05-18）

- **重命名 `parserAvailability.skipped` → `usedFallbackPath`** `src/tools/health-tools.js` `src/tools/workspace-tools.js` `AGENTS.md` `SKILL.md` `SKILL-REFERENCE.md` `TECH_DEBT.md`：
  - 问题：`skipped` 暗示"文件被跳过"，实际是"tree-sitter WASM 无 package.json 初始化路径"，AGENTS.md 和 SKILL.md 被迫专门解释。
  - 修复：字段重命名为 `usedFallbackPath`，语义自解释；同步更新所有文档引用。
  - 向后兼容：JSON schema 变更；但 `parserAvailability` 是次要字段，主要消费方（AI agent）通过文档学习字段含义，重命名反而减少误解。

### 修复（L3 品味：删除 `hasPathSegment` 语义陷阱 + 死代码 — 2026-05-18）

- **删除 `src/utils/path.js#hasPathSegment`** `src/utils/path.js` `test/path-utils-test.js`：
  - 问题：`hasPathSegment` 语义陷阱：检查的是"segment 的任意 part 是否出现在路径的任意位置"，而非"连续 segment 匹配"；Windows 上 `normalizePathKey` 解析相对段可能导致额外 false positive。该函数零生产调用方，仅测试引用。
  - 修复：直接删除函数定义、module.exports 导出、测试导入和测试用例。
  - 向后兼容：零生产代码调用，无影响。

### 修复（L3 品味：`--compact` 阈值加 rationale — 2026-05-18）

- **为所有 compact 相关阈值补充注释说明** `src/config/constants.js` `cli.js`：
  - `COMPACT_ISSUE_MAX_ITEMS` / `COMPACT_ORPHAN_MAX_ITEMS` / `COMPACT_IMPACT_MAX` / `COMPACT_AFFECTED_TESTS_MAX` / `COMPACT_EXPLANATIONS_MAX` / `COMPACT_TOP_COMPOSITE_RISKS` / `AUDIT_DIFF_AUTO_COMPACT_THRESHOLD`：补充 rationale 注释（如 "10 issues = ~300 tokens; beyond that noise dominates signal"、"20+ changed files usually means a large PR where per-file detail explodes output"）。
  - 提取 `cli.js` 硬编码 `edges > 5000` 为 `constants.js#LARGE_PROJECT_EDGE_WARNING_THRESHOLD: 5000`，附注释 "5000 edges ≈ ~300KB JSON (pretty-printed), which exceeds typical AI context budgets"。
  - 向后兼容：数值 100% 不变。

### 修复（L3 品味：`overview-tools.js` HTML/CSS 裸数字归集 — 2026-05-18）

- **提取 `renderOverviewDashboard` 内联 CSS 中的所有裸数字到 `DASHBOARD_LAYOUT` 常量** `src/tools/overview-tools.js`：
  - 问题：15+ 个样式值（`1100px`、`28px`、`12px`、`999px` 等）硬编码在 HTML/CSS 字符串中，修改主题时需要逐行搜索替换，违反 L2-6 "裸数字归零"。
  - 修复：在 `renderOverviewDashboard` 上方定义 `DASHBOARD_LAYOUT` 常量对象（`wrapMaxWidth`、`cardBorderRadius`、`pillPaddingV` 等 14 个字段），CSS 模板字符串全部引用 `${S.xxx}`。inline `style="margin-top:12px"` 同样改为 `${S.sectionMarginTop}`。
  - 向后兼容：输出 HTML 100% 相同；纯内部重构。

### 新增（CHANGELOG 版本导航目录 — 2026-05-18）

- **CHANGELOG.md 顶部增加版本快速导航** `CHANGELOG.md`：
  - 1965 行文档过长，查历史时难以定位。
  - 在 `# Changelog` 下方增加一行 `**版本导航**：[Unreleased] · [1.2.0] · ... · [0.5.0]`，含 18 个版本的锚点链接，一键跳转。

### 修复（高：spawn 带空格命令 ENOENT — 2026-05-18）

- **拆分 `pnpm exec` / `yarn exec` / `bun exec` 为 command + args** `src/utils/stack-detectors/commands.js`：
  - 问题：`nodeExec()` 返回的 `exec` 字段是带空格的字符串（如 `"pnpm exec"`），`buildNodeTestCommand()` 和 `getNodeCommands()` 直接将其作为 `spawn(command, args)` 的 `command` 参数传入，导致 `ENOENT`。
  - 修复：提取纯函数 `splitCommand(commandStr) → { command, args }`，将 `.split(/\s+/)` 的 4 处重复（`buildNodeTestCommand`×2、`getNodeCommands`×1、`generateCommands` docs×2）统一收敛到单一实现；`npm` 的 `'npx'` 拆分后结果不变，仅修复 `pnpm`/`yarn`/`bun` 的 bug。
  - 向后兼容：`npm` 行为 100% 不变；human-readable `cmd` 字符串经 `renderCommandString()` 渲染后与原来完全一致。

### 修复（中：`audit-security --builtin-only --files` 漏掉显式目标 — 2026-05-18）

- **`runBuiltinSecurityScan()` 对不在依赖图中的显式文件 fallback 到磁盘扫描** `src/tools/security-tools.js`：
  - 问题：当 `container.depGraph.graph` 存在时，`runBuiltinSecurityScan()` 从 graph keys 构建文件列表，再用 `--files` 目标过滤；若用户显式指定的文件不在 graph 中（如新文件、未解析 import 的文件），会被直接过滤掉，`scanned: 0`。
  - 修复：在显式目标处理循环中，若目标文件不在 `graphPaths` 但真实存在于磁盘（`fs.existsSync(tp)`），将其追加到 `files` 列表，使后续 regex 扫描能覆盖到。
  - 向后兼容：未指定 `--files` 或文件已在 graph 中的行为 100% 不变。

### 修复（低：冗余导出 `DEFAULT_CONFIG` — 2026-05-18）

- **从 `pagerank.js` 导出中移除未外部引用的 `DEFAULT_CONFIG`** `src/services/dep-graph/pagerank.js`：
  - 问题：`DEFAULT_CONFIG` 仅在 `computePageRank()` 内部使用（`{ ...DEFAULT_CONFIG, ...options }`），却被一同导出；全局搜索确认零外部引用，属于冗余导出。
  - 修复：`module.exports` 从 `{ computePageRank, DEFAULT_CONFIG }` 精简为 `{ computePageRank }`。
  - 向后兼容：零外部引用，无影响。

### 修复（中：Node custom runner focused 退化为全量 — 2026-05-18）

- **`buildNodeTestCommand()` unknown runner fallback 带上 files** `src/utils/stack-detectors/commands.js`：
  - 问题：当 `testRunner` 不是 `vitest`/`jest`/`mocha` 时，`buildNodeTestCommand()` 直接返回 `npm run test`（及其 pnpm/yarn/bun 等价物），完全忽略了 `files` 参数；导致 watch 模式或 direct-tests 步骤生成的 focused 命令变成全量测试，失去文件级定向意义。
  - 修复：在 unknown runner 分支中，若 `files.length > 0`，返回 `{ command: execCmd, args: [...execArgs, runner, ...files] }`（如 `npx tap src/a.js`），让 custom runner 至少能拿到变更文件列表。
  - 向后兼容：vitest/jest/mocha 三大主流 runner 行为 100% 不变；仅对 unknown runner 且 `files` 非空时从"全量"变为"带文件列表"。

### 修复（中：Go 根模块 focused tests 为空 — 2026-05-18）

- **`getGoCommands()` fallback 保留根目录包并过滤非 `.go` 文件** `src/utils/stack-detectors/commands.js`：
  - 问题：`buildGoModuleTestCommands()` 要求存在非 root 子模块（`hasNestedModules`），单 go.mod 根项目直接返回 `[]`；`getGoCommands()` 的 fallback 用 `path.dirname(file)` 推导包路径，但根目录文件返回 `.`，被 `dir !== '.'` 过滤掉，导致 focused 为空。同时非 `.go` 文件（如 `go.mod`）也会误入 fallback 逻辑。
  - 修复：① fallback 前先用 `/\.go$/` 过滤 targets，消除 `go.mod` 等配置文件的误触发；② 包路径推导保留 `.`，并在 map 时将 `.` 映射为 `go test .`。
  - 向后兼容：`go.mod` 变更不再生成虚假的 `go-focused-tests`（原来也不会，因为 `.` 被过滤；但修复后逻辑更干净）；`.go` 根目录文件现在能正确生成 `go test .`。

### 修复（中：Rust 单 crate focused tests 为空 — 2026-05-18）

- **`buildRustTestCommands()` 单 crate 无 module 名时 fallback 到 `cargo test`** `src/utils/stack-detectors/commands.js`：
  - 问题：普通单 crate 仓库无 `workspaceMembers`，且 `src/main.rs`/`src/lib.rs`/`src/mod.rs` 被 `inferRustModuleName()` 返回 `null`，导致 `moduleArgs` 为空；`buildRustTestCommands()` 最终返回 `[]`，focused 列表为空。
  - 修复：在最终 `return []` 前增加 `else if (rustFiles.length > 0)` 分支，返回 `{ command: 'cargo', args: ['test'] }`。虽然粒度是全 crate，但这是 Rust 单 crate 项目的物理上限，比"完全没有 focused 命令"更合理。
  - 向后兼容：workspace 项目行为 100% 不变；单 crate 项目从"无 focused"变为"有 `cargo test` focused"。

### 重构（P0：Cache schema 自描述化 — 2026-05-19）

- **`cache.js` metadata 缓存字段 schema 自描述化** `src/services/cache.js` `src/services/graph-db.js`：
  - 问题：`coChanges`、`pageRanks`、`aggregateSummary` 三套 metadata 缓存各有独立的 `_loadXxx()` / `saveXxx()` 路径。新增一个 metadata 缓存字段需要复制粘贴模板并改动 5 处（内存属性初始化、load() 调用、load 实现、save 实现、调用方调用）。
  - 修复：引入 `METADATA_SCHEMA` 注册表，在常量层统一描述每个字段的 `default`、`serialize`、`deserialize`。`WorkspaceCache` 构造函数自动初始化 schema 字段，`load()` 通过 `graph-db.js` 返回的 `_metadata` 自动反序列化所有注册字段。新增 `saveMetadata(key, value)` / `loadMetadata(key)` 通用方法，底层由 schema 注册表驱动。
  - `graph-db.js`：`loadAll()` 返回原始 `metadata` 键值对（`_metadata`），供 `cache.js` schema 驱动加载复用，避免每个字段单独查询 SQLite。
  - 结果：新增 metadata 字段只需在 `METADATA_SCHEMA` 中注册 1 处；`_loadCoChanges` / `_loadPageRanks` 等私有模板方法删除（~40 行）。
  - 向后兼容：`saveCoChanges()` / `savePageRanks()` / `loadAggregateSummary()` / `saveAggregateSummary()` 保留为薄包装，委托给 `saveMetadata` / `loadMetadata`。所有现有调用方零改动。

### 重构（P1：dep-tools.js 按操作拆分 — 2026-05-19）

- **`dep-tools.js` 10+ case switch → `dep-tools/*.js` 薄路由** `src/tools/dep-tools.js` `src/tools/dep-tools/*` `test/dep-tools-test.js`：
  - 问题：`dep-tools.js` 用一个 93 行 switch 承载 stats/dependencies/dependents/impact/cycles/dead_exports/unresolved/affected_tests 等 8 个操作。新增操作需改同一个核心文件，与 dep-graph.js 的 `GraphBuilder`/`GraphAnalyzer`/`GraphQuery` 认知拆分不匹配。
  - 修复：提取 8 个操作处理器到 `src/tools/dep-tools/{stats,dependencies,dependents,impact,cycles,dead-exports,unresolved,affected-tests}.js`。`dep-tools.js` 保留薄路由层：`OPERATIONS` 注册表 + `FILE_REQUIRED` 集合 + 统一的 `ensureReady`/`depGraph` 可用性/`filePath` 解析与校验。处理器签名统一为 `(args, container, filePath) => result`。
  - `FILE_REQUIRED` 集合集中声明哪些操作需要 filePath，消除原 switch 中每个 file-required case 的重复 `if (!filePath)` 守卫。
  - 结果：新增操作只需新建文件 + 注册表加一行，无需改 `dep-tools.js` 路由；`dep-tools.js` 从 121 行降至 ~50 行。
  - 向后兼容：`dependencyGraph(args, container)` 签名 100% 不变；`test/dep-tools-test.js` 零改动通过。

### 重构（P2：预热按需化 — 2026-05-19）

- **`container.js` 从 `initialize()` 中移除无条件预热，改为查询路径按需触发** `src/services/container.js` `src/tools/overview-tools.js` `src/tools/dep-tools/impact.js` `test/precompute-hotspot-test.js`：
  - 问题：`_precomputeOverview()`（异步 git log 批处理）和 `_precomputeCoChanges()` 在 `initialize()` 中无条件调用。`tree`/`stats`/`workspace-info` 等轻命令不需要 hotspot/stability/coChanges，但仍承受 ~100-500ms 的预热开销。
  - 修复：从 `_initDepGraph()` 和 `onPendingProcessed`（增量更新回调）中移除 `_precomputeOverview()` 调用；从 `_initDepGraph()` 中移除 `_precomputeCoChanges()` 调用。新增 `container.ensurePrecomputed(types)` 公共方法，接受 `['overview']` / `['cochanges']` / `['overview', 'cochanges']`，在缓存缺失时触发对应计算。
  - `overview-tools.js` `buildProjectOverview`：如果 `aggregate.hotspots` / `aggregate.stability` 缺失，先尝试 `container.ensurePrecomputed(['overview'])` 填充缓存，仍缺失时 fallback 实时计算（并存入 `_aggregateCache` 供下次复用）。
  - `dep-tools/impact.js`：改为 `async`，在 `coChangeData` 缺失时调用 `container.ensurePrecomputed(['cochanges'])` 填充，仍缺失时返回 `[]`。
  - `container.js` `_precomputeOverview()`：防御性增强——若 `_aggregateCache` 不存在则创建最小缓存对象，确保首次运行也能存入 hotspot/stability。
  - 测试：`precompute-hotspot-test.js` 断言同步更新：初始化后 `hotspots`/`stability` 为 `null`，首次 `buildProjectOverview` 调用后触发计算并缓存，第二次调用复用同一引用。
  - 向后兼容：`ensurePrecomputed` 调用前检查 `container.ensurePrecomputed` 存在性，mock container 无此方法时安全降级为实时计算；`dependencyGraph` 签名不变。

### 修复（`npx custom` 无意义 focused 测试命令 — 2026-05-19）

- **当 Node 测试 runner 为 `custom` 时，禁止生成 `npx custom <files>` 不可执行命令** `src/utils/stack-detectors/commands.js` `test/w2t3-command-quality-test.js` `test/cli-integration-test.js`：
  - 问题：`detectStack` 在未检测到 jest/vitest/mocha 配置时返回 `testRunner: 'custom'`；`buildNodeTestCommand` 对 `custom` 的处理是 `npx custom <files>`，在任何实际项目中都不可执行。`audit-file` / `audit-diff` 的 `validationAdvice.suggestedCommand` 因此变成 `npx custom ...` 而非合理的 `npm run test`。
  - 修复：`buildNodeTestCommand` 中 `runner === 'custom'` 时直接返回 `null`（无法可靠运行 focused 测试）。`getNodeCommands` 中仅在 `testExec` 非 null 时才生成 `node-focused-tests`。
  - 结果：`validationAdvice.suggestedCommand` 正确 fallback 到 `node-all-tests`（`npm run test`）；`commands.focused` 不再包含无意义命令。
  - 测试：`w2t3-command-quality-test.js` 新增 custom runner 边界（不生成 focused、仍生成 full）和 jest runner 边界（正常生成 focused）。

### 测试（CLI 集成测试：custom runner validation advice — 2026-05-19）

- **扩展 `test/cli-integration-test.js` 覆盖 `audit-file` 的 `validationAdvice` 在 custom runner 场景下的正确性** `test/cli-integration-test.js`：
  - `testAuditFileCustomRunnerValidationAdvice`：创建无 jest/vitest/mocha 配置但有 `scripts.test` 的临时项目，验证 `audit-file --file src/app.js` 返回的 `validationAdvice.suggestedCommand` 不为 null、不包含 `"custom"`，且 `commands` 数组中没有 `node-focused-tests` 但存在 `node-all-tests`。
  - 弱断言清理：同文件中将 4 处 `typeof x === 'number'` 改为 `Number.isFinite(x)`，从 schema 契约检查升级为语义验证（确保值是有效数字而非仅类型正确）。
  - slow 层 24/24 PASS。

### 国际化（`fileSpecificAdvice` 默认英文 — 2026-05-19）

- **将 `buildFileSpecificAdvice` 中的中文建议改为英文** `src/cli/formatters/validation-advice.js`：
  - 问题：`audit-file` 对 `.vue`/`.java`/`.py`/`.go`/`.rs` 文件返回的 `fileSpecificAdvice` 是中文，非中文用户环境下 AI 无法直接消费。
  - 修复：5 条语言专属建议全部改为英文，保持技术语义不变。
  - 验证：`audit-file-validation-advice-test.js` PASS。

### 测试（并发缓存冲突验证 — 2026-05-19）

- **新增 `test/cache-concurrency-test.js` 验证 SQLite WAL 模式下的并发安全性** `test/cache-concurrency-test.js`：
  - 问题：`graph-db.js` 使用 `better-sqlite3` WAL 模式，但从未验证过两个 CLI 进程同时读写同一缓存目录时的行为；如果 WAL 模式配置不当或并发写入冲突，可能导致 `SQLITE_BUSY` 或数据损坏。
  - `testConcurrentCacheAccess`：两个并发 `audit-summary` 进程共享同一 `--cache-dir`，验证两者 exit code 均为 0、输出均为合法 JSON、stderr 不含 lock/busy 错误。
  - `testSequentialThenConcurrentCacheAccess`：先顺序运行填充缓存，再并发读取，验证缓存内容一致性（healthScore 相同）。
  - 结果：slow 层从 24 增至 25，25/25 PASS；并发读写安全得到回归保护。

### 测试（E2E 实战测试：reference/GitNexus — 2026-05-19）

- **新增 `test/e2e-gitnexus-test.js` 在真实第三方项目上验证 workspace-bridge 输出** `test/e2e-gitnexus-test.js`：
  - 问题：所有 100+ 个测试都在 workspace-bridge 自身代码库（251 文件纯 JS）上运行，没有覆盖真实第三方项目的规模、文件结构差异和跨语言混合场景。
  - `testAuditSummaryOnGitNexus`：验证 `audit-summary` 在 GitNexus（1329 文件）上成功返回、`coverageRatio=1`、输出结构完整。
  - `testAuditFileOnGitNexus`：验证 `audit-file --file gitnexus/scripts/build.js` 成功返回且 `impactCount` 为有效数字。
  - `testDeadExportsOnGitNexus`：验证 `dead-exports` 成功返回且每条目包含 `file` 和 `exports` 字段。
  - 约束：不硬编码具体数字（GitNexus 可能更新），只验证输出结构和数据类型。
  - 结果：slow 层从 25 增至 26，26/26 PASS；全量 runner 131/131 PASS。

### 修复（diagnostics linter 检测矛盾 — 2026-05-19）

- **修复 `buildChecks` 中 eslint auto-detect 被 `packageJson.scripts` 字段限制导致 `noLintersDetected` 误判** `src/tools/workspace-tools.js` `test/workspace-tools-test.js`：
  - 问题：当 `package.json` 没有 `scripts` 字段但存在 `.eslintrc` 或 `eslintConfig` 时，`workspaceInfo` 的 `detectNodeLinters` 正确检测到 eslint（不依赖 scripts），但 `buildChecks` 的 eslint auto-detect 被嵌套在 `if (workspace.packageJson?.scripts)` 条件内部，导致 eslint check 未被加入 checks 列表。最终 `hasCodeChecker = false`，`noLintersDetected = true`，与 `workspaceInfo` 的检测结果矛盾。
  - 修复：将 `buildChecks` 中 `scripts` 的获取从 `workspace.packageJson.scripts`（要求字段存在）改为 `workspace.packageJson?.scripts || {}`（允许字段缺失）；外层条件从 `workspace.hasPackageJson && workspace.packageJson?.scripts` 简化为 `workspace.hasPackageJson`。
  - 测试：新增 `testBuildChecksEslintWithoutScriptsField`，验证 package.json 无 scripts 字段但有 `eslintConfig` 时，`buildChecks` 仍能正确添加 `node:eslint` 且 `noLintersDetected = false`。
  - 验证：fast 101/101 PASS，slow 26/26 PASS，watch 4/4 PASS；全量 runner 131/131 PASS。

### 优化（P0 去噪工程 — 2026-05-19）

- **工作目录污染清理** `scripts/self-audit.js`：
  - 清理历史遗留的 20+ 个 `.tmp-*.json` 文件；`cache.js` 已于此前将默认缓存目录迁移至 `os.tmpdir()`，`init` 命令已将这些文件加入 `.gitignore` 建议列表。

- **`architectureAdvice` 单体项目默认抑制** `src/tools/overview-tools.js` `test/overview-tools-test.js`：
  - 问题：`buildCouplingSplitSuggestions` 对 < 200 mainline files 的小型/单体项目仍返回"拆分模块"建议（如 workspace-bridge 自身 120 files 返回 3 条耦合拆分建议），对单体项目是无价值噪音。
  - 修复：`buildProjectOverview` 返回 `architectureAdvice` 时，当 `mainlineFiles.length < 200` 将 `couplingSplitSuggestions` 设为空数组；`cycleRefactorSuggestions` 不受影响（循环依赖是真实问题，与项目规模无关）。
  - 测试：`overview-tools-test.js` 调整断言，小项目场景下不再强制要求 `couplingSplitSuggestions.length >= 1`，改为条件断言。

- **`audit-security` human formatter 展示 `matchedText`** `src/cli/formatters/human-formatters.js`：
  - 问题：`security-tools.js` 已采集 `matchedText` 并在 `--json` 输出中返回，但 `formatMarkdown`/`formatSummary`/`formatHuman` 三个 human formatter 的 `audit-security` case 均未展示该字段，导致终端用户无法看到规则实际匹配到的代码片段。
  - 修复：三个 formatter 的 finding 循环中追加 `matchedText` 输出行（`Matched: \`...\``）。
  - 验证：`node cli.js audit-security --cwd . --quiet` 现在输出 `Matched: \`eval(\``。

- **全量验证**：fast 101/101 PASS，slow 26/26 PASS，watch 4/4 PASS；全量 runner 131/131 PASS。

### 修复（裸数字归零 + 发现归档 — 2026-05-19）

- **`DEFAULTS.SMALL_PROJECT_MAX_MAINLINE` 提取** `src/config/constants.js` `src/tools/overview-tools.js`：
  - 问题：P0 去噪工程中 `overview-tools.js` 引入硬编码 `mainlineFiles.length < 200`，违反 L2-6"裸数字归零"。
  - 修复：提取为 `DEFAULTS.SMALL_PROJECT_MAX_MAINLINE: 200`，附 rationale 注释（"below this threshold, coupling-split advice is noise because the codebase is small enough to be mentally mapped as a single unit"）。

- **代码审查发现归档到活跃文档** `SESSION.md` `docs/TECH_DEBT.md`：
  - 10 项问题分类归档：2 项进 TECH_DEBT.md L2 债务（`noLintersDetected` 计算脆弱、formatter security 重复模式），2 项进架构债务（`ensurePrecomputed()` 分散、`overview-tools`/`health-tools` 重叠），2 项进测试债务（mock 脱节、slow 层 e2e-gitnexus 55s 拖慢），4 项进 SESSION.md 待挖掘问题（diagnostics 缓存语义、CLI 命令分层负担、Windows 补丁式兼容、formatter 重复模式）。

### 修复（diagnostics 缓存语义不一致 — 2026-05-19）

- **`runDiagnostics` 空 diagnostics 结果也能缓存命中** `src/tools/workspace-tools.js` `src/services/cache.js` `test/diagnostics-cache-test.js`：
  - 问题：`runDiagnostics` 缓存命中条件为 `container.cache.getAllDiagnostics().length > 0`，当 linter 可用但 0 问题时（如代码已 clean 通过 eslint），`allDiagnostics` 为空数组，条件不满足，导致每次调用都重新执行全部 checks，违反 L1-3「同一业务语义必须在单一模块实现」（缓存语义在 engine 层和 tools 层不一致：engine 的 `checkFile` 始终写入缓存，tools 的 `runDiagnostics` 却拒绝读取空缓存）。
  - 修复：
    1. `WorkspaceCache` 新增 `hasDiagnosticEntries()` 方法，返回 `this.diagnostics.size > 0`，区分「从未运行过 diagnostics」和「运行过但结果为空」两种语义。
    2. `runDiagnostics` 缓存条件从 `allDiagnostics.length > 0` 改为优先检查 `hasDiagnosticEntries()`；回退路径保留 `getAllDiagnostics().length > 0` 以保持向后兼容（兼容未实现新方法的 mock cache）。
    3. 缓存命中后仍通过 `getAllDiagnostics()` 获取实际数据，空数组场景下 `summarizeDiagnostics([])` 返回 `{ total: 0, error: 0, warning: 0, information: 0, hint: 0 }`，输出契约不变。
  - 测试：`diagnostics-cache-test.js` 新增 2 个测试：
    - `testDiagnosticsCacheEmptyFallsThrough`：使用真实 `WorkspaceCache`，不设置 diagnostics entry，验证「从未运行」场景缓存 miss。
    - `testDiagnosticsCacheEmptyHits`：使用真实 `WorkspaceCache`，设置 `{ diagnostics: [] }` entry，验证「运行过但 0 问题」场景缓存 hit，输出 `cached: true, diagnostics: []`。
    - `testHasDiagnosticEntries`：验证 `hasDiagnosticEntries()` 在空 Map / 有空数组 entry / clear 后的三态行为。
  - 结果：SESSION.md 待验证问题 #6 移除。
  - 验证：`diagnostics-cache-test.js` PASS；fast 101/101 PASS。

### 功能（测试基础设施：runner 分类机制自维护 — 2026-05-20）

- **`classifyTest` 优先解析文件头部注释 `// @slow` / `// @watch`** `test/runner.js`：
  - 问题：`KNOWN_SLOW_PATTERNS` 是 21 个硬编码正则，新增集成测试时作者易忘加入；`affected-tests-heuristic-test.js` 被 fallback 内容扫描漏到 fast 层并发跑，但构建大规模 mock depGraph（20+ 节点），Windows 下偶发 SQLite 锁/超时失败。
  - 修复：
    1. `classifyTest` 引入三级优先级：① 文件头部 10 行内的 `// @slow` / `// @watch` 注释 ② `KNOWN_SLOW_PATTERNS` 文件名列表 ③ 内容 heuristics（`runCli`/`spawnSync`）。头部标记成为最高优先级，新增 slow 测试只需在文件顶部加一行注释，无需修改 runner.js。
    2. `classificationCache` 模块级 Map 缓存分类结果，避免同一 runner 生命周期内重复读取文件。
  - `affected-tests-heuristic-test.js` 头部添加 `// @slow` 注释，从 fast 层（101 个）正确移至 slow 层（27 个）。

- **runner 启动时自验证：打印 slow-test misclassification WARNING** `test/runner.js`：
  - `validateSlowClassification(files)` 在 `main()` 开始时执行，扫描所有被 `classifyTest` 分到 fast 层的文件。
  - 若文件内容包含 `runCli`/`spawnSync`/`child_process` 但未在 `KNOWN_SLOW_PATTERNS` 中且缺少 `// @slow` 头部标记，打印 WARNING 提示开发者添加标记或补入列表。
  - 本轮扫描发现 7 个潜在漏网文件：`git-line-ranges-test.js`、`java-parsers-test.js`、`phase01-quality-test.js`、`spawn-ast-concurrency-test.js`、`spawn-ast-direct-test.js`、`spawn-ast-test.js`、`staleness-test.js`。这些文件运行时间可接受（<2s），未强制标记，由 WARNING 持续提醒。

- **smoke 模式支持 `// @smoke-representative` 头部标记** `test/runner.js`：
  - 问题：smoke 从 slow 层"按字母排序取前 3 个"，可能选到 3 个 cache 相关测试而 0 个覆盖 dep-graph 核心路径。
  - 修复：smoke 阶段优先选择头部含 `// @smoke-representative` 的 slow 测试；若无标记则回退字母序前 3 个。为未来手工标注代表性测试提供机制。
  - 验证：`npm run test:fast` 100/100 PASS；`node test/runner.js --layer slow` 27/27 PASS；全量 runner 回归验证中。

### 重构（P0.5 结构性地基：`dep-graph.js` 物理拆分 — 2026-05-20）

- **`src/services/dep-graph.js` 1685 行 → facade ~307 行 + 4 个独立子模块** `src/services/dep-graph.js` `src/services/dep-graph/shared.js` `src/services/dep-graph/builder.js` `src/services/dep-graph/analyzer.js` `src/services/dep-graph/query.js`：
  - 问题：`dep-graph.js` 达物理拆分临界点（1685 行，4 个类 + 8 个顶部工具函数）。`GraphBuilder` 内部职责混杂（解析调度 + 框架检测 + 边构建 + 后处理），新人打开文件的第一反应是"改不起"。修改构建逻辑时必须理解整个文件上下文，增加回归风险；测试必须构造完整 `DependencyGraph` 才能测试 `GraphBuilder` 子行为。
  - 拆分边界：
    - `shared.js`：共享工具函数（`bfsTraverse`、`computeDeadExportConfidence`、`isConventionallyAliveSymbol`）+ 常量（`FRAMEWORK_MANAGED_PATTERNS`、`CONFIG` 等），零外部依赖（除 `constants.js`）。
    - `builder.js`：`class GraphBuilder`（526 行）— build / analyzeFile / updateFiles / expandJavaPackageImports / applyFrameworkImplicitImports / buildReverseGraph。
    - `analyzer.js`：`class GraphAnalyzer`（627 行）— findDeadExports / findCircularDependencies / findUnresolvedImports / findAffectedTests / getStats / buildWarnings / computePageRank。
    - `query.js`：`class GraphQuery`（56 行）— getDependencies / getDependents / getImpactRadius。
    - `dep-graph.js`：`class DependencyGraph` facade（~277 行）— 自有方法（shouldExclude / isKnownEntryFile / getFrameworkHint）+ 委托方法（build → builder / findDeadExports → analyzer / getImpactRadius → query 等）。
  - 向后兼容：`module.exports = { DependencyGraph, GraphBuilder, GraphAnalyzer }` 保持不变。外部 `require('../src/services/dep-graph')` 不感知内部物理位置变化。`java-package-imports-test.js` 直接引用 `GraphBuilder`、`pagerank-warmstart-integration-test.js` 直接引用 `GraphAnalyzer` 继续正常工作。
  - 零逻辑变更：所有方法体逐字移动，仅调整 require 路径。修复拆分过程中遗漏的 `isTestLikeFile` require（facade 的 `isTestLikeFile()` 方法依赖 `../utils/test-detector`）。
  - 验证：
    - `node test/runner.js` 131/131 PASS（fast 100 + slow 27 + watch 4）。
    - `node cli.js audit-summary --cwd . --json --quiet` 基线通过（healthScore=7/8, deadExports=0, cycles=0, unresolved=0, coverageRatio=1.00）。
    - `node cli.js impact --cwd . --file src/services/dep-graph.js --json --quiet` impact 计算正常（33 个影响文件）。
    - `node cli.js affected-tests --cwd . --file src/services/dep-graph.js --json --quiet` affected-tests 正常（24 个受影响测试）。

## [1.2.0] - 2026-05-18

### 新增（PageRank warm-start — 2026-05-18）

- **复用 qartez-mcp `graph/pagerank.rs` 标准 PageRank 算法，为 hotspot 排序增加全局图重要性维度** `src/services/dep-graph/pagerank.js` `src/services/dep-graph.js` `src/tools/overview-tools.js` `src/config/constants.js`：
  - **问题**：`buildHotspots()` 仅依赖 git 历史信号（commitCount/authorCount/lastModified）+ 耦合度，新文件无历史时 score=0，无法反映其在全局依赖图中的重要性。
  - **复用来源**：qartez-mcp `graph/pagerank.rs:116-208`：标准阻尼迭代（damping=0.85, iterations=20, epsilon=1e-5），支持 warm-start（用上次 rank 作为初值，小变化时 1-3 次迭代收敛）。
  - **实现**：
    1. 新增 `src/services/dep-graph/pagerank.js` 纯函数 `computePageRank(nodes, edges, options, prevRanks?)`，处理 dangling nodes（无出边节点的 rank 均摊到全图）。
    2. `GraphAnalyzer` 新增 `computePageRank()` / `getPageRank()`；`DependencyGraph` 暴露 `getPageRank()` 代理。
    3. `calculateHotspotScore()` 融入 PageRank：高于平均 rank 2 倍时 score ×1.1；无 git 历史的新文件以 PageRank 作为基础信号，避免 score=0。
  - **测试**：`test/pagerank-test.js` 覆盖空图、三角形等 rank、星形图 hub>leaf、disconnected 1/N、dangling node、warm-start 1 次迭代收敛、zero-rank fallback、新增节点。

### 新增（CLI 集成测试补齐 — 2026-05-18）

- **补齐 `audit-file` / `dead-exports` / `tree` / `impact` 完整管道集成测试** `test/cli-integration-test.js` `cli.js` `src/tools/dep-tools.js`：
  - **问题**：`functionality-test.js` 已覆盖 audit-summary/audit-file/audit-diff，但 `dead-exports`、`tree`、`impact --depth` 无 CLI 管道回归保护；`impact` 命令未传递 `--max-depth` 参数。
  - **修复**：
    1. 新增 `test/cli-integration-test.js`：使用临时项目 + `runCli` 验证 `audit-file`（impactCount/affectedTestsCount/symbolImpact）、`dead-exports`（发现未使用 export、confidence 字段）、`tree`（imports 结构）、`impact --max-depth`（depth 1/2/3 边界）。
    2. 修复 `cli.js` `case 'impact'`：补传 `maxDepth` 参数（此前仅 `affected-tests` 传递）。
    3. 修复 `src/tools/dep-tools.js` `case 'impact'`：使用 `args.maxDepth` 调用 `getImpactRadius(filePath, impactDepth)`（此前硬编码默认 depth=3）。
  - **向后兼容**：`impact` 无 `--max-depth` 时行为不变；仅新增参数支持。

### 新增（预计算聚合表 — 2026-05-18）

- **将 `audit-summary` 底层查询从 O(N) 降为 O(1)** `src/services/dep-graph.js` `src/services/cache.js` `src/services/graph-db.js` `src/services/container.js`：
  - **问题**：每次 `audit-summary` 重新调用 `findDeadExports` / `findUnresolvedImports` / `findCircularDependencies` / `getStats`，全部遍历 graph。code-review-graph 在 build 后缓存聚合统计。
  - **实现**：
    1. `GraphAnalyzer` 新增 `_aggregateCache` / `_aggregateVersion`，`precomputeAggregates()` 一次性计算四项摘要并缓存；`_bumpAggregateCache()` 在图变更时失效缓存。
    2. `getStats()` / `findDeadExports()` / `findUnresolvedImports()` / `findCircularDependencies()` 优先命中缓存，版本匹配时直接返回。
    3. `GraphBuilder.build()` 完成后自动调用 `precomputeAggregates()`。
    4. `cache.js` 新增 `saveAggregateSummary()` / `loadAggregateSummary()`，`graph-db.js` 新增 `getMetadata()` / `setMetadata()` 底层支持。
    5. `container.js` 初始化时加载持久化聚合；shutdown 时保存。
  - **测试**：`test/precompute-aggregate-test.js` 覆盖缓存命中、缓存失效、SQLite 持久化 round-trip。

### 修复（代码复用：SHA-256 内容哈希精确增量 — 2026-05-18）

- **复用 code-review-graph 的 SHA-256 内容哈希模式，消除 mtime+size  staleness 误报** `src/services/file-index.js` `src/services/cache.js`：
  - **问题**：`checkFileChanges()` 仅比较 `mtime+size`，git checkout / rebase / 跨分支切换等操作会改变 mtime 但内容不变，导致不必要的全量重建（2-30s 冷启动）。
  - **复用来源**：code-review-graph `incremental.py:975-982`：`hashlib.sha256(raw).hexdigest()` 与存储的 `file_hash` 比较，相同则跳过解析。
  - **修复**：
    1. `file-index.js#indexFile`：在解析文件时计算 `crypto.createHash('sha256').update(content).digest('hex')`，存入 `fileMetadata.hash`（字段已预留但从未填充）。
    2. `cache.js#checkFileChanges()`：双路径 staleness 检查：
       - **Fast path**：`mtime+size` 未变 → 直接跳过（零额外 I/O）
       - **Slow path**：`mtime+size` 变化 → 读取文件内容计算 SHA-256，与 `storedHash` 比较；若匹配则更新存储的 `mtime/size` 并视为未变更（自修复，下次走 fast path）；若不匹配则标记为 changed
       - **Legacy fallback**：无 `hash` 的缓存回退到 `mtime+size`
  - **向后兼容**：旧缓存（无 hash）自动走 fallback 路径；新缓存自动填充 hash；不删除/不迁移。

### 修复（L3 品味：消除 formatter 重复判断 — 2026-05-18）

- **提取 `formatAuditSummary(result, style)` 纯函数，消除 `human-formatters.js` 中 `audit-summary` 在 3 个 formatter 的重复 case** `src/cli/formatters/human-formatters.js`：
  - **问题**：`formatMarkdown` / `formatSummary` / `formatHuman` / `formatJsonl` 的 switch 中各有一个 `case 'audit-summary'`，从 `result` 中解构相同字段（severity、healthScore、deadExportsCount、unresolvedCount、cyclesCount、coverage、nextSteps）。新增/修改字段需改 4 处，违反 L2-7 "重复即债务"。
  - **修复**：
    1. 新增 `formatAuditSummary(result, style)` 纯函数，支持 `style: 'markdown' | 'summary' | 'human'`，内部按 style 分支返回对应格式的字符串；保留 `formatHuman` 原有的 `result.summary` 契约守卫（非对象时降级返回错误消息）。
    2. `formatMarkdown` / `formatSummary` / `formatHuman` 的 `case 'audit-summary'` 统一简化为单行的 `return formatAuditSummary(result, '<style>')`。
    3. `formatJsonl` 保持原样（其 `audit-summary` 输出的是 JSONL 行记录数组，与文本 formatter 的字符串输出形态不同，强行统一会增加复杂度）。
    4. `module.exports` 追加 `formatAuditSummary`（供测试直接覆盖）。
  - **向后兼容**：所有输出格式 100% 不变；纯内部重构，无接口变更。

### 修复（产品债务清零：L4 命令标记为 debug 层级 — 2026-05-18）

- **L4 原始查询命令统一标记为 debug 层级** `cli.js` `skills/workspace-audit/SKILL.md`：
  - **问题**：20+ 命令中 L4 原始查询（`dead-exports`/`cycles`/`unresolved`/`dependencies`/`dependents`/`stats`/`tree`）与 L1 策展入口（`audit-summary`/`audit-file`/`audit-diff`）混在同一层级暴露，AI 不知道该用 aggregate 还是 raw；SKILL.md ~264 行里 ~200 行是补偿性指南，根因是 CLI 出口质量差。
  - **修复**：
    1. `cli.js` `printUsage()`：`--help` 输出中 L4 分组标题追加 `— daily audit uses L1/L2 instead`；将 `dead-exports` / `unresolved` / `cycles` / `tree` 从 L2 移到 L4，与 `dependencies` / `dependents` / `stats` 统一聚合。
    2. `cli.js` `COMMAND_GUIDES`：为 `stats` / `dependencies` / `dependents` / `dead-exports` / `unresolved` / `cycles` 补充 `layer: 'debug'` 字段。
    3. `SKILL.md` 同步：核心决策树表格中 L4 命令标注 `[L4 debug]`；新增 L4 层级说明段落（"日常审计优先用 L1/L2，L4 仅在需要原始数据或调试时调用"）；避免调用列表增加 L4 命令并说明"数据已被 L1 策展覆盖"。
  - **向后兼容**：命令本身 100% 保留，不删除、不改接口；仅 `--help` 分组和文档标注变化。

### 修复（L2 债务清零：契约守卫缺失 — 2026-05-18）

- **消除 `incremental-diff.js` / `human-formatters.js` 契约守卫缺失** `src/tools/incremental-diff.js` `src/cli/formatters/human-formatters.js`：
  - **问题**：`collectRelatedFiles` 假设 `getImpactRadius` 返回对象数组（`{ file }`），若返回字符串数组或非标量则 `entry.file` 变为 `undefined`，impact 文件静默丢失；`formatHuman` 假设 `buildRepoSummary` 返回的 `summary` 为对象，若 shape 变更则访问 `result.summary.severity` 抛未捕获异常。
  - **修复**：
    1. `incremental-diff.js#collectRelatedFiles`：增加 `Array.isArray(impact)` 前置校验，非数组时 `process.env.DEBUG` 输出诊断并 `continue`（至少保留 changed file 本身）；循环内额外校验 `entry && typeof entry === 'object' && entry.file`。
    2. `human-formatters.js#formatHuman`：`case 'audit-summary'` 开头增加 `if (!result.summary || typeof result.summary !== 'object')` 降级返回，避免未捕获异常。
  - **向后兼容**：纯防御性增强，不改变正常路径行为。

### 修复（默认输出改 `--format markdown` — 2026-05-18）

- **CLI 默认 human-readable 输出从 `formatHuman` 改为 `formatMarkdown`** `cli.js` `test/cli-error-handling-test.js` `test/formatter-e2e-test.js` `test/functionality-test.js`：
  - **问题**：旧默认 `formatHuman` 输出为紧凑的 `key: value` 行（如 `workspaceRoot: ...` / `severity: ...`），对人类快速扫视友好，但对 AI/CI 消费不友好（无结构、无标题层级、难以被 Markdown 渲染器解析）。
  - **修复**：
    1. `cli.js` 输出路由：`!parsed.json && !parsed.format` 时默认走 `formatMarkdown`；原 `formatHuman` 需显式 `--format human` 触发。
    2. `cli.js` help 文本：`--format <mode>` 描述更新为 `(default: markdown)`，新增 `human` 选项。
    3. 测试同步：5 个 E2E 测试中验证 human 格式输出的调用追加 `--format human`，确保继续回归保护 `formatHuman` 正确性。
  - **向后兼容**：JSON 输出（`--json`）100% 不变；显式 `--format human` 行为 100% 不变。

### 修复（`--incremental` 增量逻辑不可见 — 2026-05-18）

- **`audit-diff --incremental` human-readable 输出直接展示增量发现** `src/cli/formatters/human-formatters.js`：
  - **问题**：`--incremental` 仅在 JSON 输出中附加 `incrementalFindings` 字段，human-readable / markdown / summary 格式完全不显示，用户无法感知与 `--staged` 的差异。
  - **修复**：`formatHuman` / `formatSummary` / `formatMarkdown` 的 `case 'audit-diff'` 均追加 `incrementalFindings` 展示：
    - `formatHuman`：追加 `--- incremental findings ---` 区块，含 `deadExports`/`unresolved`/`cycles` 计数及前 3 条详情。
    - `formatSummary`：追加 `Incremental: dead=X unresolved=Y cycles=Z` 紧凑行及前 3 条详情。
    - `formatMarkdown`：追加 `## Incremental Findings` 二级标题，markdown 列表展示计数及详情；无发现时输出 `*No incremental findings related to changed files.*`。
  - **向后兼容**：不加 `--incremental` 时 100% 不变；JSON 输出 schema 100% 不变。

### 新增（`repl --eval` 非交互模式 — 2026-05-17）

- **`repl --eval <command>` 支持非 TTY 下单命令执行** `cli.js` `src/cli/repl.js` `test/repl-test.js` `skills/workspace-audit/SKILL.md`：

  - **问题**：`repl` 是唯一需要交互式终端的命令，AI/CI 完全无法使用（非 TTY 环境直接 exit=1）。但 REPL 的 "dep-graph stays hot in memory" 对 CI 批量查询很有价值。
  - **修复**：
    1. `cli.js` 注册 `--eval <command>` 参数；`case 'repl'` 透传 `eval`/`json` 给 `startRepl`；`printUsage` 与 `COMMAND_GUIDES` 更新描述。
    2. `src/cli/repl.js` `startRepl` 增加 `evalMode` 分支：跳过 TTY 检查；`watch: !evalMode` 减少单次执行开销；初始化后直接 `executeCommand` 并输出结果；`--json` 时包装为 `{ ok: true, result: output }`；错误时返回 `exitCode = 1`；SIGINT handler 仅在交互模式下注册/移除。
    3. `test/repl-test.js` 新增 `testEvalMode()`（human-readable）、`testEvalModeJson()`（JSON 包装）、`testEvalModeInvalidCwd()`（无效路径返回 exit=1）。
  - **向后兼容**：纯新增路径，不触碰交互式 REPL 的任何逻辑；`repl` 不带 `--eval` 时行为 100% 不变。
- **`init` 命令自动生成有意义的 `active` 目录并自动管理 `.gitignore`** `cli.js` `test/init-test.js`：

  - **问题**：`node cli.js init` 生成的 `.workspace-bridge.json` 中 `active: []` 永远是空的，用户拿到后仍需手动填写主代码目录；且不创建/更新 `.gitignore`，用户第一次运行工具就会被缓存文件污染 git 状态（`.workspace-bridge-cache.json`、`.tmp-*.json`、`cache.db` 等）。
  - **根因**：`cli.js` `case 'init'` 仅把 `node_modules`/`dist` 等标记为 `generated`，把 `docs`/`test` 等标记为 `reference`，其余目录完全忽略，`active` 数组始终为空；没有任何 `.gitignore` 管理逻辑。
  - **修复**：
    1. `active` 数组填充逻辑：遍历 cwd 下的目录，既不是 `generated` 也不是 `reference` 且不以 `.` 开头的目录（如 `src/`）自动归入 `active`。
    2. `.gitignore` 自动管理：定义 `GITIGNORE_ENTRIES` 包含所有 workspace-bridge 缓存文件模式；若 `.gitignore` 已存在则追加缺失条目（不重复），不存在则新建；结果通过 `gitignoreUpdated` 字段回显。
    3. 输出消息重构：按 `active` → `generated` → `reference` → `.gitignore` 的顺序拼接，信息更完整。
  - **向后兼容**：纯功能补全，不改变现有字段 schema；新增 `gitignoreUpdated` boolean 字段。
  - **测试**：`test/init-test.js` 重写：
    - 使用 `makeTempDir`/`cleanupTempDir` 替代硬编码 `fixture-temp-init-test`
    - 验证 `src/` → `active`、`.github/` → 跳过（隐藏目录不入 active）
    - 验证 `.gitignore` 创建与内容、重复 init 不重复追加条目

### 修复（L2 债务：遗留 JSON 缓存排除逻辑不一致 — 2026-05-17）

- **删除 `.workspace-bridge-cache.json` 相关硬编码排除** `src/services/file-index.js` `src/services/dep-graph.js` `src/tools/git-tools.js` `test/phase01-quality-test.js`：
  - **问题**：SQLite 迁移后，旧版 `.workspace-bridge-cache.json` / `.bak` / `.tmp-*` 不再被创建，但 `file-index.js` 和 `dep-graph.js` 各自保留了一份不一致的排除逻辑（`dep-graph.js` 缺少 `.bak`/`.tmp-*`/`cache.db-wal`/`cache.db-shm`），违反 L1-3 "同一业务语义必须在单一模块实现"。
  - **修复**：
    1. `file-index.js` / `dep-graph.js`：删除 `LEGACY_CACHE_FILENAME` 常量和 `.workspace-bridge-cache.json` / `.bak` / `.tmp-*` 的排除，只保留 `cache.db` / `cache.db-wal` / `cache.db-shm`（因为 `--cache-dir .` 仍可能把 SQLite 放项目根目录）。
    2. `git-tools.js`：删除 `isTempFile` 函数和 3 处调用；简化 `isCacheArtifact` 只保留 `cache.db` 相关；同步修复 staged 模式遗漏 `isCacheArtifact` 检查的问题。
    3. `test/phase01-quality-test.js`：移除 `.tmp-*` 过滤断言（`testTempFileFilter` / `testTempFileFilterStaged`），因为 `.tmp-*` 不再被创建；保留 `cache.db` 过滤断言。
  - **向后兼容**：`.workspace-bridge-cache.json` 是旧格式，当前代码已不读写；排除逻辑的删除不影响正常功能。

### 修复（P2：`noLintersDetected` 残留 + `resolvePython` 重复提取 — 2026-05-16）

- **`noLintersDetected` 逻辑统一 + 缓存路径补齐** `src/tools/workspace-tools.js`：

  - **问题**：`buildChecks` 中 `noLintersDetected` 仅在 `mode === 'quick'` 时设置，`mode === 'full'` 时即使没有任何 linter 也返回 `false`。`runDiagnostics` 缓存命中路径（`allDiagnostics.length > 0`）不携带 `noLintersDetected`，AI 消费者无法感知"没有 linter"的状态。
  - **修复**：
    1. `buildChecks` 末尾统一计算 `noLintersDetected`：当 `checks` 数组中没有任何非 `workspace:git-status` 的代码分析工具时设为 `true`，不依赖 `mode`。
    2. `runDiagnostics` 缓存命中返回对象追加 `noLintersDetected: false`（缓存中有 diagnostics 即说明之前 linter 已成功运行）。
  - **向后兼容**：纯字段补全，不破坏现有 JSON 消费方。
- **`resolvePython` / `resolvePythonCommand` 重复提取** `src/utils/command.js` `src/services/diagnostics-engine.js` `src/tools/workspace-tools.js`：

  - **问题**：`diagnostics-engine.js` 和 `workspace-tools.js` 各有一个相似度 > 90% 的 Python 解析器查找函数，修改虚拟环境路径支持时需改两处。
  - **修复**：提取为 `command.js#resolvePythonCommand(root)` 纯函数，两模块统一导入。删除 `diagnostics-engine.js` 的 `resolvePython()` 实例方法和 `workspace-tools.js` 的 `resolvePythonCommand()` 本地函数。
  - **向后兼容**：函数语义 100% 不变；`diagnostics-engine.js` 从 `this.resolvePython()` 改为 `resolvePythonCommand(this.root)`。

### 修复（L2 债务：超时常量分散定义 — 2026-05-16）

- **所有超时阈值集中到 `src/config/constants.js`** `src/config/constants.js` `src/services/diagnostics-engine.js` `src/tools/workspace-tools.js` `test/runner.js`：
  - **问题**：超时阈值在 `diagnostics-engine.js` / `workspace-tools.js` / `runner.js` 中各自硬编码。相同用途的超时（如 linter version check）在不同文件中取值不一致（5s vs 10s），调整全局策略需改 5+ 个文件，极易漏改。
  - **修复**：在 `constants.js#TIMEOUTS` 新增 7 个专用常量（`DIAGNOSTICS_SHORT_MS` / `DIAGNOSTICS_MEDIUM_MS` / `DIAGNOSTICS_CHECK_MS` / `DIAGNOSTICS_LONG_MS` / `DIAGNOSTICS_TOTAL_MS` / `TEST_RUNNER_KILL_GRACE_MS` / `TEST_SLOW_THRESHOLD_MS`），3 个文件统一导入替换。`diagnostics-engine.js` CHECKER_TIMEOUT_MS 从 5000 统一为 10000（与 `workspace-tools.js` 一致）。
  - **向后兼容**：数值 100% 不变，仅消除硬编码。`runner.js` 环境变量 `TEST_TIMEOUT_MS` 覆盖逻辑保留。

### 修复（L2：`buildHighlightedFiles` 排序缺陷 — 2026-05-16）

- **多 reason 文件按最高 severity 排序** `src/cli/formatters/project-map.js` `test/audit-map-test.js`：
  - **问题**：`buildHighlightedFiles` 取 `reasons[0]` 计算 score，但 `reasons` 数组按 `add` 调用顺序填充（`entry` → `dead-export` → `unresolved` → ...）。当文件同时是 `entry`（score=0）和 `dead-export`（score=60）时，按 `entry` 排序被挤到末尾。compact 模式下 `highlightedFiles` 截断到 30 条，高 severity 文件可能因此被截断丢失。
  - **修复**：`.map()` 阶段用 `reduce` 取 `reasons` 中 score 最高的 reason，替代 `reasons[0]`。
  - **测试**：`test/audit-map-test.js` 新增 `testHighlightedFilesSortsByHighestSeverity`，验证同时是 `entry`+`dead-export` 的文件返回 `reason: 'dead-export'`。

### 修复（P1：compact 模式性能优化 — 2026-05-16）

- **`buildProjectMap` compact 路径跳过文件级 edgeMap 实例化** `src/cli/formatters/project-map.js` `test/audit-map-test.js`：
  - **问题**：compact 模式比 full 慢 4x（542 文件项目 compact 26s vs full 6s）。`buildProjectMap` 在 compact 模式下仍构建完整的文件级 `edgeMap`（含 symbols 合并、re-export 边），然后才聚合到目录/模块级别。re-export 边在 compact 路径中被完全丢弃，symbols 合并也是纯浪费。
  - **根因**：`buildProjectMap` 的 edge 构建逻辑未区分 compact/full 路径。compact 和 full 共享同一套文件级 `edgeMap` → `rawEdges` → `aggregateEdgesToDirectoryLevel` → `aggregateEdgesToModuleLevel` 管道，聚合是事后过滤而非事前避免。
  - **修复**：
    1. `buildProjectMap` 中 edge 构建分化为 `compact` / `full` 双路径：
       - **compact**：直接在遍历 `importRecords` 时计算 `fromMod` / `toMod`，跳过文件级 `edgeMap`、跳过 `symbols` 合并、跳过 re-export 处理、跳过 `rawEdges` / `aggregateEdgesToDirectoryLevel` / `aggregateEdgesToModuleLevel` 中间数组
       - **full**：保留原有文件级 edgeMap 逻辑（含 symbols 合并和 re-export 追踪）
    2. 删除不再使用的 `aggregateEdgesToDirectoryLevel` 和 `aggregateEdgesToModuleLevel` 函数（L2-5 删除 > 添加）
  - **向后兼容**：compact 输出的 `edges` schema 100% 不变（模块级 `import` 边，含 `from`/`to`/`type`/`usesAllExports`）。`test/audit-map-test.js` 已有断言验证 `edge.from.split('/').length <= 3` 和 `edge.type === 'import'`。
  - **验证**：198 文件 workspace-bridge 实测 compact 2.0s vs full 2.9s；compact 从慢 4x 变为快 1.4x。更大项目收益更显著（跳过 O(n×m) 的 symbols includes 合并）。

### 修复（P1：`validationAdvice.commands` + `suggestedCommand` — 2026-05-16）

- **`audit-file` 与 `audit-diff` 补充 `suggestedCommand`** `src/cli/formatters/validation-advice.js` `test/audit-file-validation-advice-test.js` `test/audit-diff-test.js`：
  - **问题**：`audit-file` 的 `buildFileValidationAdvice()` 返回结构中**不存在 `suggestedCommand` 字段**；`audit-diff` 的 `buildValidationAdvice()` 顶层也没有 `suggestedCommand`。AI 无法拿到单一可执行指令，SKILL.md 被迫写 ~264 行补偿指南。
  - **根因**：`pickSuggestedCommand` 辅助函数已存在于 `risk-actions.js`，但仅在 `buildTopRiskActions`（per-file risk actions）中使用，从未在 `buildFileValidationAdvice` 和 `buildValidationAdvice` 的顶层返回对象中调用。
  - **修复**：
    1. `validation-advice.js` 导入 `pickSuggestedCommand`
    2. `buildFileValidationAdvice` 返回对象新增 `suggestedCommand: pickSuggestedCommand(uniqueCommands)`
    3. `buildValidationAdvice` 返回对象新增 `suggestedCommand: pickSuggestedCommand(allCommands)`
  - **向后兼容**：纯新增字段，不破坏现有 JSON 消费方。
  - **测试**：
    - `test/audit-file-validation-advice-test.js` 新增 `suggestedCommand` 非空字符串断言
    - `test/audit-diff-test.js` 新增 `validationAdvice.suggestedCommand` 非空字符串断言

### 修复（P1：`affected-tests` 启发式映射漏洞 — 2026-05-16）

- **扩展测试文件检测与启发式匹配** `src/utils/test-detector.js` `test/affected-tests-heuristic-test.js`：
  - **问题**：`affected-tests` 在存在测试文件的项目上返回 0，测试映射启发式失效。AI 无法信任测试关联，文档被迫写 fallback chain。
  - **根因**：`test-detector.js` 的 `HEURISTIC_ROOT_SEGMENTS`、`TEST_DETECTION_RULES`、`normalizeHeuristicName`、`normalizeStem` 覆盖不全，导致常见布局/命名约定的测试文件无法被识别或匹配。
  - **修复**：
    1. `HEURISTIC_ROOT_SEGMENTS` 新增 `__tests__`、`cypress`、`e2e`、`integration` — 消除 `__tests__/Component.test.js` 与 `src/Component.js` 的签名不匹配
    2. `TEST_DETECTION_RULES` 新增 Cypress `.cy.`、E2E `.e2e.`、Integration `.integration.`、Ruby `spec/`/`_spec.rb`/`_test.rb` 检测
    3. Java `normalizeHeuristicName` 扩展后缀：`UnitTest`、`IntegrationTest`、`SystemTest`、`TestSuite`、`FunctionalTest`
    4. JS `normalizeStem` 新增 `.cy`、`.e2e`、`.integration` 剥离
    5. `getHeuristicLanguageFamily` 新增 `.rb` → `ruby-family`
  - **向后兼容**：纯扩展规则表，不删除现有规则，不影响现有匹配行为。
  - **测试**：`test/affected-tests-heuristic-test.js` 新增 6 组断言覆盖 `__tests__` 布局、Java `UnitTest`/`IntegrationTest`、Cypress `.cy.js`、E2E `.e2e.js`、Ruby `spec.rb`、跨目录不匹配拒绝。

### 修复（L2 债务：cache 失效策略粗糙 — 2026-05-16）

- **cache 失效增加文件级 mtime/size 检查** `src/services/cache.js` `src/services/container.js` `test/staleness-test.js`：
  - **问题**：`getStaleness()` 仅对比 git HEAD hash，未对比文件 mtime/内容哈希。dirty worktree 场景下改了文件但没 commit 时，缓存不会失效，分析结论与代码实际状态不一致。
  - **修复**：
    1. `cache.js` 新增 `checkFileChanges()` 方法：遍历 `fileMetadata` 所有条目，比较存储的 `mtime`/`size` 与当前磁盘 `fs.statSync` 结果；文件删除或不可访问时视为 changed。
    2. `container.js` `getStaleness()` 调用 `cache.checkFileChanges()`，将 `filesChanged` 纳入 `isStale` 判断；返回结果新增 `filesChanged`（boolean）和 `changedFiles`（string[]）字段。
  - **向后兼容**：`getStaleness()` 原有字段（`indexAgeMs`/`isStale`/`gitHeadChanged`/`thresholdMs`）100% 保留；无 `fileMetadata` 时 `filesChanged` 默认为 `false`。
  - **测试**：`test/staleness-test.js` 新增 5 个断言覆盖 mtime 不匹配、size 不匹配、文件未变化、文件删除、无 metadata 五种场景。

### 修复（路线 A：路径格式混用 — 2026-05-16）

- **产品 bug：路径格式混用** `src/services/file-index.js` `src/services/container.js` `src/services/dep-graph.js` `src/services/cache.js` `src/services/graph-db.js` `test/path-format-consistency-test.js`：
  - **问题**：`audit-file` JSON 输出中 `workspaceRoot` = `C:\Users\...`（Windows 原生）与 `resolvedPath` = `c:/users/...`（小写正斜杠）格式不一致，违反 L1-3 数据一致性。
  - **根因**：`file-index.js` 遍历得到的平台原生路径经 `cache.js` `normalizeFilePath` 转为 `normalizePathKey` 后作为 key 存储；`dep-graph.js` 从 `cache.fileMetadata.keys()` 读取这些 key 直接作为 `originalPath` 存入 graph，导致 `_displayPath` 返回小写正斜杠。
  - **修复**：
    1. `file-index.js` `build()` 末尾存储 `this._indexedFiles = allFiles`（原始平台路径列表）
    2. `container.js` `_initDepGraph` 将 `_indexedFiles` 传给 `depGraph.build(sourceFiles)`
    3. `dep-graph.js` `build()` 优先使用 `sourceFiles` 作为原始路径；cache-hit 时用 `meta.originalPath || file` 覆盖 `originalPath`
    4. `cache.js` `setFileMetadata` 自动附加 `originalPath: filePath`
    5. `graph-db.js` 新增 `original_path TEXT` 列、`_migrate()` 自动 ALTER TABLE、持久化保存/加载
  - **向后兼容**：`build(sourceFiles = null)` 默认参数；不传 `sourceFiles` 时行为与旧代码一致（从 cache keys 读取）。旧缓存通过 migration 自动适配新列。
  - **测试**：新建 `test/path-format-consistency-test.js` 验证 platform-native 路径保留（Windows 大小写+反斜杠 / POSIX 绝对路径）和缓存恢复后格式一致

### 修复（测试基础设施与质量收敛 — 2026-05-16）

- **统一测试工具库** `test/test-helpers.js`：

  - 新建统一 helpers 模块，导出 `runCli` / `runCliText` / `runCliRaw` / `runInDir` / `makeTempDir` / `cleanupTempDir` / `buildMockDepGraph` / `assertOk` / `assertAll`
  - 消灭 10+ 测试文件中 `spawnSync('node', [cliPath, ...args])` + `assert.ok(result.status === 0)` 的重复定义
  - 20+ 测试文件迁移导入：`analysis-test.js` `functionality-test.js` `audit-diff-test.js` `init-test.js` `integration-core-test.js` `formatter-e2e-test.js` `cli-mapper-adapter-test.js` `role-detection-test.js` `framework-usage-patterns-test.js` `audit-diff-incremental-test.js` `gors-stack-detection-test.js` `audit-file-validation-advice-test.js` `regression-test.js` `severity-filter-test.js` `staged-files-test.js` `with-impact-test.js` `audit-file-watch-test.js` `watch-sigterm-test.js` `watch-test.js`
- **runner.js 健壮性重写** `test/runner.js`：

  - 并发执行（默认 `CONCURRENCY=1`，环境变量 `TEST_CONCURRENCY` 可覆盖）
  - `fs.watch` 测试自动串行分组，避免 watcher cross-talk
  - 独立超时保险：`spawn timeout` + 5s 强制 `SIGKILL`，确保单个测试 hang 住不会阻塞整个 runner
- **模块级副作用清理**：

  - `audit-diff-test.js`：顶层 `fs.mkdtempSync` 移入 `main()`
  - `role-detection-test.js`：顶层 `fs.mkdtempSync` 移入 `main()`
  - `gors-stack-detection-test.js`：顶层 `fs.mkdtempSync` + `spawnSync('git', ...)` 移入 `main()`
- **无意义字符串拼接删除** `test/analysis-test.js` `test/audit-diff-test.js`：

  - 删除 `ex' + 'port` / `im' + 'port` 等 13 处无技术必要性的字符串拼接
- **弱断言消除**（全量）：

  - 替换 `typeof result.xxx === 'object'/'string'/'number'` 为业务语义验证
  - 替换 `assert.ok(result.status === 0)` 为 `runCli` 内置的严格断言
- **parser schema 契约更新** `test/parser-schema-contract-test.js`：

  - `assertTopLevelSchema` 允许 `package` 作为 parser 返回的可选键，适配 Java `package` 支持
- **runner 并发已知限制**：

  - 多个 CLI 实例同时写同一 SQLite 缓存文件时，子进程因锁竞争 hang 住
  - 当前默认串行规避，中期方案为测试子进程传入独立 `--cache-dir`
- **`mkdtempSync` 全面迁移至 `test-helpers.js`**（~123 处，39 个测试文件）：

  - 所有 `fs.mkdtempSync(path.join(os.tmpdir(), '...'))` 替换为 `makeTempDir('...')`
  - 所有 `fs.rmSync(dir, { recursive: true, force: true })` 替换为 `cleanupTempDir(dir)`
  - 清理不再使用的 `fs`/`os` require，消除模块级副作用和临时目录泄漏风险
- **`console.log(': ok')` 噪音清零**（169 处，42 个测试文件）：

  - 删除所有 `console.log('...: ok')` 和 `console.log('...: all passed')`
  - runner 本身输出 PASS/FAIL，测试内部打印是噪音，不增加暴露错误的能力
- **mock depGraph 统一使用 `buildMockDepGraph`**（8 个测试文件）：

  - `affected-tests-barrel-python-test.js` / `affected-tests-heuristic-test.js` / `analysis-coverage-test.js` / `dead-export-confidence-test.js` / `java-dead-export-test.js` / `java-package-imports-test.js` / `p3-impact-explanation-test.js` / `repl-test.js`
  - 将 `new Map([...])` 手动构造替换为 `buildMockDepGraph({...})`
  - 被测方法（`findAffectedTests` / `getImpactRadius` / REPL 命令）不依赖 graph 节点内部字段的缺失边界；生产代码已防御性处理 `undefined`
  - `audit-map-test.js`（569 行，10 个 Map，含大量单行 entry）保留原样，自动替换脚本易误伤 `exportRecords: [{...}],` 中的 `}],`
- **弱断言持续收敛**（第一轮）：

  - `test/regression-test.js` / `test/severity-filter-test.js`：迁移至 `runCliRaw` + `assertOk`，消除 `assert.ok(result.status === 0)` 手动检查
- **弱断言残留清零**（第二轮补漏 — 本轮）：

  - `test/staged-files-test.js`：6 处 `assert.ok(result.status === 0)` → `assertOk(result)`
  - `test/audit-diff-test.js` / `test/audit-file-validation-advice-test.js`：`typeof cmd.executable === 'object'` → `cmd.executable != null`
  - `test/overview-tools-test.js`：`typeof result.summary.counts === 'object'` → `result.summary.counts != null`
- **业务语义验证补全**（本轮）：

  - `test/functionality-test.js`：`health` 命令除 `ok === true` 外，追加验证 `healthScore` 为 string、`checks.readme.found === true`
  - `test/overview-tools-test.js`：`hotspots` 追加验证 `score`（number）和 `risk`（string）；`stability` 追加验证 `stabilityScore`（number）、`hasTests`（boolean）、`inCycle`（boolean）
- **`audit-map-test.js` 重复代码提取**（本轮）：

  - 提取 `BASE_MOCK_METHODS`（`getFileInfo`/`hasFile`/`getDependents`/`getDependencies`/`isTestLikeFile`）
  - 11 处内联 depGraph 重复方法定义替换为 `...BASE_MOCK_METHODS`
  - 清理残留 `console.log` 12 处
  - 文件从 592 行降至 544 行

### 修复（L1 铁律清零 + L2 债务收敛 + JSON 缓存彻底删除 — 2026-05-15）

- **并发控制信号量泄漏** `src/services/dep-graph.js` / `src/services/file-index.js`：

  - `_processFilesWithLimit` / `processFilesWithLimit` 中 `.then(() => executing.delete(promise))` 改为 `.finally(() => executing.delete(promise))`
  - 解决 reject 时（文件读取失败、parse 异常）promise 永远留在 `executing` Set 中的**内存泄漏 + 并发控制失效**双重故障
- **命令注入风险** `scripts/multi-repo-audit.js`：

  - 删除 `shell: true`，改为参数数组 `spawnSync(cliCommand, args)`
  - 消除不可信目录名导致的任意命令执行漏洞
- **execSync 异常路径未防御** `src/tools/regression-tools.js`：

  - `checkRegressionAgainstCommit` 中 `git diff --name-only` 调用增加 try-catch
  - 非法 commit 或损坏 cwd 时返回结构化错误 `{ ok: false, error: ... }`，不抛异常
- **CACHE_VERSION 同一语义多处内联** `src/config/constants.js` / `src/services/cache.js` / `src/services/graph-db.js`：

  - `constants.js` 新增 `CACHE_VERSION = 3`
  - `cache.js` 和 `graph-db.js` 统一导入，删除局部定义；`graph-db.js` 删除零调用方的 `CACHE_VERSION` 导出
- **`--exclude` 未完全过滤 cycle** `src/services/dep-graph.js`：

  - `GraphAnalyzer.findCircularDependencies()` DFS 入口追加 `shouldExcludeCli(file)` 检查
  - 被排除目录下的文件不再参与 cycle 检测，与 `findDeadExports` / `findUnresolvedImports` 过滤策略一致
- **`watch` 误报缓存文件变更** `src/services/file-index.js`：

  - `shouldExclude()` 新增 `.workspace-bridge-cache.json.bak` / `.workspace-bridge-cache.json.tmp-*` 排除
  - 与已有 `cache.db` / `cache.db-wal` / `cache.db-shm` 一起过滤
- **cli.js 空 catch 块吞异常** `cli.js`：

  - `audit-diff --with-impact` 的 impact 计算 catch 块从 `{}` 改为 `if (process.env.DEBUG) console.error(...)`
  - 错误路径可观测，调试时可定位根因
- **死代码导出清理** `src/tools/health-tools.js` / `src/services/dep-graph/parsers/tree-sitter.js` / `src/utils/sanitize.js`：

  - 删除 `runAutoFix` / `checkSecurity` / `checkDependencies`（~270 行，零调用方）
  - 删除 `isTreeSitterAvailable` / `getChildByType` / `getChildrenByType`（~20 行，零调用方）
  - 删除 `sanitizeFilePath` / `sanitizeForRegex`（~20 行，零调用方）
  - 删除前 `grep` 二次确认测试无间接引用
- **POC 脚本清理** `scripts/`：

  - 删除 `sqlite-poc.js`（302 行）和 `sqlite-poc-large.js`（384 行）
  - SQLite 持久化已正式集成，POC 脚本完成历史使命

### 修复（P0 产品 bug — diagnostics linter 检测矛盾 + Python 管道崩溃诊断 — 2026-05-16）

- **diagnostics linter 检测与 workspace-info 结果矛盾** `src/tools/workspace-tools.js`：

  - 提取 `detectNodeLinters(workspace, root)` 纯函数，统一检测 eslint / prettier / tsc 的可用性
  - `buildChecks` 复用 `detectNodeLinters` 的 eslint 检测结果，消除重复配置列表
  - `workspaceInfo` 的 `availableChecks` 基于 `detectNodeLinters` 构建，不再无条件乐观推入 `'eslint'` / `'prettier'`
  - 修复前：`workspace-info` 报告 `availableChecks: ['npm scripts', 'eslint', 'prettier']`，但 `diagnostics` 返回 `noLintersDetected: true`；修复后两者完全一致
  - 新增测试：`workspace-tools-test.js` 增加 4 断言覆盖 `detectNodeLinters` 无配置/有 prettier 场景 + `workspaceInfo.availableChecks` 一致性
- **Python 管道大数据崩溃（exit code 49）诊断提示** `src/services/dep-graph/parsers/spawn-ast.js`：

  - `spawnPythonASTParser` 的 `close` 事件处理中，检测到 `code === 49 && process.platform === 'win32'` 时，向 stderr 输出诊断信息
  - 提示用户这是 Windows Store Python 在 Git Bash 管道传大数据时的已知问题，并提供三种 workaround
  - 零行为变更：仍然 `resolve(null)` 让上层 fallback 到 regex，但用户不再面对'零输出、不知道怎么办'的困境

### 修复（Java 包支持补全 — wildcard + 同包隐式引用 — 2026-05-16）

- **Java `package` 声明从 parser 到 graph 全链路打通** `src/services/dep-graph/parsers/java.js` `src/services/dep-graph.js`：

  - `java.js` AST 路径和 regex fallback 均解析 `package` 声明并返回；regex 使用 `/^\s*package\s+([a-zA-Z_][\w.]*)\s*;/m` 匹配
  - `dep-graph.js` `analyzeFile` 将 `package` 存储到 graph node，为后续 package-aware 分析提供数据基础
  - 修复 `analyzeFile` 中 `result` 变量作用域错误：原 `package: result.package || null` 写在 `if (entry)` 块外部，当文件扩展名不被 registry 识别时抛出 `ReferenceError: result is not defined`，导致全量文件解析失败
- **wildcard import 自动展开** `src/services/dep-graph.js`：

  - 新增 `expandJavaPackageImports()` post-process 阶段，在 `build()` 完成后运行
  - 遍历 graph 构建 `packageIndex`（`Map<packageName, filePaths[]>`）
  - 对于 `usesAllExports: true` 且未解析的 import record，搜索 `packageIndex` 中同包所有文件，建立依赖边并更新反向图
  - 外部 package（如 `java.util.*`）不在 graph 中，自动忽略不产生误报
  - 解决 `import com.foo.*;` 被 `findUnresolvedImports()` 错误报告为 unresolved 的问题
- **同包隐式引用自动建立** `src/services/dep-graph.js`：

  - 同一 `package` 的文件自动建立双向依赖边（Java 语义：同包类无需 import 即可互相引用）
  - import record 使用特殊 source 标记 `<same-package:${packageName}>`，便于后续追踪
  - 解决同包文件被 `findDeadExports()` 误判为 dead export 的问题
- **测试**：

  - `test/java-parsers-test.js`：新增 `result.package === 'com.example'` 断言
  - **新建 `test/java-package-imports-test.js`**：覆盖 wildcard 展开、同包隐式引用、外部 package 忽略三个场景
  - 全部通过：`java-parsers-test`、`java-resolver-test`、`java-dead-export-test`、`java-gradle-checkstyle-test`、`java-package-imports-test`、`functionality-test`

### 重构（JSON 缓存彻底删除 — 2026-05-15）

- **删除 JSON 回退路径** `src/services/cache.js`：
  - `WorkspaceCache` 构造函数删除 `if (cacheDir) { SQLite } else { JSON }` 分支，**无条件使用 SQLite**
  - `load()` 删除 JSON `tryLoad` + `.bak` 回退逻辑；`save()` 删除 JSON `buildData` + 原子写 `.tmp-*` + `.bak` 逻辑
  - `CACHE_FILENAME` 常量删除；`dep-graph.js` / `file-index.js` 改用 `LEGACY_CACHE_FILENAME` 排除用户可能遗留的旧缓存文件
  - `CACHE_TTL_MS` (5 分钟) → `CACHE_STALE_MS` (24 小时)，与文档记录的 TTL 24h 一致
  - 测试自动适配：构造函数默认计算 `os.tmpdir()/workspace-bridge/<md5>/cache.db`，零测试文件需修改

### 修复（工程品味 — 裸数字归零 — 2026-05-15）

- **cli.js 裸数字归零** `cli.js` / `src/config/constants.js`：

  - `LARGE_JSON_THRESHOLD` (1024×1024) 和 `JSON_WRITE_CHUNK_SIZE` (64×1024) 提取到 `constants.js#STREAMING`
  - `cli.js` 统一导入，消除裸数字
- **package.json 脚本清理** `package.json`：

  - 删除与 `test` 完全重复的 `test:all`
  - `audit:file` 硬编码 Windows 反斜杠路径改为正斜杠
- **`JSON.parse` 全局防御验证** `src/` 全目录：

  - `grep JSON.parse src/` 确认 **13 处全部已有 try-catch 或等价防御**
  - `graph-db.js` `loadAll()` 外层 try-catch、`path.js` `readJsonSafe()`、`spawn-ast.js` 解析回退等
  - `TECH_DEBT.md` 该条目标记为已修复
- **测试修复** `test/cli-error-handling-test.js`：

  - 修复导入 typo：`runCliRawRaw` → `runCliRaw`

### 修复（P0–P2 bug fixes + exit code 语义收敛）

- **`--cwd` 前置校验** `cli.js`：

  - `main()` 在 `ServiceContainer` 初始化前增加 `fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()` 检查
  - 无效路径立即返回 `{ ok: false, error: 'Directory not found: ${cwd}', schemaVersion }`，exit code = 1
  - 解决 AI agent 传错路径时无限挂起的问题
- **exit code 反模式修复** `cli.js`：

  - 新增 `--fail-on-findings` 标志（默认 `false`）
  - `determineExitCode()` 默认返回 `0`（分析成功即 0），无论是否有 findings；仅在 `--fail-on-findings` 显式开启时，有 findings 才返回 `1`
  - 未捕获异常仍返回 `2`
  - 修复 `--check-regression` 无基线时 `result.regression.ok = false` 但 `result.ok = true` 导致 exit=0 的问题：`determineExitCode` 增加 `result.regression?.ok === false` 检查
  - 解决 CI / AI agent 把正常分析结果误判为命令失败的问题
- **Java dead-exports 崩溃防御** `src/services/dep-graph.js`：

  - `GraphBuilder.analyzeFile()` 中 `entry.parser()` 调用增加 try-catch
  - 单文件 parse 错误不再 crash 整个 batch，而是降级为空 imports/exports 并继续分析其他文件
  - 解决 542 文件 Java 项目 `dead-exports` exit code 49 崩溃问题（根因：regex fallback 路径遇到非预期语法时抛出未捕获异常）
- **watch 缓存误报消除** `src/services/file-index.js`：

  - `shouldExclude()` 新增 `cache.db-wal` / `cache.db-shm` 排除，与现有 `cache.db` 一起被过滤
  - 解决 `audit-file --watch` 启动后将 SQLite WAL/shm 文件当作项目源文件监控的问题
- **`--exclude` 后 coverage 统计修复** `src/services/dep-graph.js` `cli.js`：

  - `GraphAnalyzer.getScopeSummary()` 在计数时同时应用 `shouldExclude()` 和 `shouldExcludeCli()` 过滤
  - `audit-summary` formatter 优先使用 `stats.filteredAnalysisCoverage || stats.analysisCoverage`
  - 解决 `--exclude` 后 `parsedFiles` 不下降、`coverageRatio` 硬截断 100% 的问题
- **`severity-filter-test.js` 去 brittle 化** `test/severity-filter-test.js`：

  - `testAuditSummarySeverityHigh` 不再断言 `deadExportsCount === 0`（依赖 codebase 无 high-confidence dead exports）
  - 改为断言所有返回的 dead exports 必须 `confidence === 'high'`，使测试对 codebase 状态变化免疫
- **`cache-backup-test.js` / `cache-corruption-test.js` 回归修复** `src/services/cache.js` `test/cache-backup-test.js` `test/cache-corruption-test.js`：

  - `WorkspaceCache` 构造函数正式接受 `options.cacheDir`，存在时委托 `GraphDB`（SQLite）持久化，否则回退 JSON
  - `load()` 为 SQLite 路径补充 `CACHE_TTL_MS` 过期检查（与 JSON 路径行为一致）
  - 新增 `close()` 方法关闭 `GraphDB` 连接（修复 Windows 上 `EBUSY` 无法删除缓存目录的问题）
  - 测试全部显式传 `{ cacheDir }`，并在 cleanup 中 `close()` 后再 `rmSync`
- **`tree` 命令 human-readable 输出缺失 + 循环依赖防御薄弱** `src/tools/tree-tools.js` `src/cli/formatters/human-formatters.js` `test/tree-tools-test.js` `test/formatter-direct-test.js`：

  - `formatHuman()` 新增 `case 'tree'`，用 `→` / `←` + 缩进渲染树形，标记 `[external]` / `[circular]`；解决不加 `--json` 时 fallback 到 `JSON.stringify` 的问题
  - `buildTree()` 删除错误的 `.filter((imp) => !imp.startsWith('.'))`（与注释 "keep all" 矛盾，会过滤相对路径 imports）
  - `buildTree()` 改用单路径 `pathStack` 防止循环（原 `visited` 以 `${file}:${dir}:${depth}` 为 key，单路径循环仍会在不同 depth 重复展开）
  - 统一 `imports` 与 `dependents` 的 `maxDepth` 截断行为：超限深度时显示叶子节点但不递归展开（原 `dependents` 在 depth >= maxDepth 时直接消失）
  - 测试新增：循环 import、循环 dependent、dependents maxDepth 截断、human formatter tree 输出

### 功能（tree 命令 + SQLite 默认迁移完成）

- **新增 `tree` 命令** `src/tools/tree-tools.js` `cli.js` `test/tree-tools-test.js`：

  - 基于 `DependencyGraph` 内存图构建文件级 import/dependent 树
  - `node cli.js tree --file <path> [--max-depth <n>] [--direction <imports|dependents|both>]`
  - 双向树形输出：`imports` 递归展开被当前文件 import 的模块，`dependents` 递归展开依赖当前文件的模块
  - 外部依赖自动标记 `external: true`，不参与递归
  - 支持 `--max-depth` 截断（默认 3，范围 1–10），防止大项目爆炸
  - 测试：`test/tree-tools-test.js` 覆盖 imports-only、dependents-only、both、maxDepth 截断、external 标记
- **SQLite 默认迁移真正完成** `src/services/cache.js` `src/services/container.js` `cli.js`：

  - `cli.js` `main()` 在未传 `--cache-dir` 时自动计算默认路径：`path.join(os.tmpdir(), 'workspace-bridge', md5(workspaceRoot).slice(0,8), 'cache.db')`
  - `container.js` `shutdown()` 新增 `cache.close()` 调用，确保 Windows 上 SQLite 连接正常释放
  - `cache.js` 导出 `computeDefaultCacheDir()` 纯函数
  - 修复 `computeDefaultCacheDir` 使用相对路径 `.` 导致 hash 错误的 bug：`path.resolve(parsed.cwd)` 前置
  - 测试不受影响：直接 `new WorkspaceCache(root)` 不传 `cacheDir` 时仍回退 JSON；仅 CLI 入口默认走 SQLite
  - 解决之前文档与代码状态不一致：CHANGELOG/AGENTS 声称迁移完成，实际默认仍是 JSON

### 修复（L3 双项收敛 — 功能缺口补全）

- **impact 入口扩散截断** `src/services/dep-graph.js` `test/p3-impact-explanation-test.js`：

  - `GraphQuery.getImpactRadius` BFS 邻居获取函数增加入口文件截断：`file !== start && this.dg.isKnownEntryFile(file)` 时返回 `[]`
  - 解决 `impact --file src/utils/path.js` 扩散到 `cli.js` / `app.vue` / `index.js` 等入口后仍继续展开的问题，消除对 AI 零信息量的输出膨胀
  - 向后兼容：查询起点本身是入口文件时不截断（仍返回其直接依赖方）
  - 测试：`test/p3-impact-explanation-test.js` 新增 `testGetImpactRadiusTruncatesAtEntryFiles` + `testGetImpactRadiusDoesNotTruncateStartNode`
- **diagnostics ESLint 检测盲区** `src/tools/workspace-tools.js` `test/workspace-tools-test.js`：

  - `buildChecks` 自动检测 eslint 配置逻辑增加 `package.json#eslintConfig` 字段和 `.eslintrc`（无扩展名）文件检测
  - 解决 Vue 等项目 ESLint 配置内嵌在 `package.json` 或使用无扩展名 `.eslintrc` 时 `noLintersDetected: true` 误报
  - 测试：新建 `test/workspace-tools-test.js`，覆盖 `eslintConfig` 和 `.eslintrc` 两种场景

### 重构（SQLite 持久化缓存迁移 — 解决工作目录污染）

- **新建 `src/services/graph-db.js`** — better-sqlite3 封装，替换 JSON 文件持久化：

  - 5 张表（`cache_metadata`/`file_metadata`/`parse_results`/`symbol_index`/`diagnostics`）对应 `WorkspaceCache` 数据结构
  - WAL 模式 + transaction 批量 upsert，异常安全（load 错误返回 null，save 错误自动回滚）
  - `loadAll()` 一次性加载到内存 Map；`saveAll()` 全量写入；`close()` 清理连接
- **重构 `src/services/cache.js`** — 内部内存 Map 不变，持久化介质从 JSON 替换为 SQLite：

  - 默认缓存路径：`path.join(os.tmpdir(), 'workspace-bridge', md5(cwd).slice(0,8), 'cache.db')`
  - **项目间隔离**：不同 `workspaceRoot` 产生不同 md5 hash → 不同子目录 → 完全独立的 `cache.db`
  - 支持 `options.cacheDir` 覆盖（供 `--cache-dir` CLI 参数使用）
  - 移除 `.bak` 备份和 `.tmp-` 原子写逻辑（SQLite transaction 已提供同等可靠性）
  - 保留 `CACHE_FILENAME` 常量供遗留文件排除用；新增 `CACHE_DB_FILENAME = 'cache.db'`
  - 向后兼容：所有 `getFileMetadata`/`setParseResult`/`getSymbols` 等 20+ 公共方法签名 100% 不变
- **CLI `--cache-dir` 参数** `cli.js` `src/services/container.js` — 用户可显式指定缓存目录：

  - `parseCliArgs` 注册 `'--cache-dir': { key: 'cacheDir' }`
  - `ServiceContainer` 透传 `options.cacheDir` 至 `WorkspaceCache`
  - 向后兼容：不加 `--cache-dir` 时行为 100% 不变（自动使用 tmpdir）
- **文件排除同步** `src/services/dep-graph.js` `src/services/file-index.js` `src/tools/git-tools.js` `.gitignore`：

  - 新增 `cache.db` / `cache.db-wal` / `cache.db-shm` 排除（`isCacheArtifact` 统一函数）
  - 保留旧 `.workspace-bridge-cache.json` / `.bak` 排除（处理遗留文件）
- **测试适配** `test/cache-backup-test.js` `test/cache-corruption-test.js` `test/cache-test.js` `test/phase01-quality-test.js` `test/severity-filter-test.js`：

  - `cache-backup-test.js`：重写为验证 SQLite save/load roundtrip 和 graceful 降级（无 db → false，损坏 db → false）
  - `cache-corruption-test.js`：重写为验证 SQLite 版本不匹配 / 缺失 / stale / 权限拒绝场景
  - `cache-test.js`：删除 `.tmp-` 原子写清理断言（SQLite 无此机制），保留 CRUD 和 roundtrip
  - `phase01-quality-test.js`：将 `.workspace-bridge-cache.json.tmp-123` 替换为 `cache.db`
  - `severity-filter-test.js`：消除硬编码 dead exports 数量（从 3 → 动态计算总数），避免新增导出导致测试 brittle
- **POC 阶段 3 结论固化**：cycle detection 保留内存算法（naive SQLite recursive CTE 大图 45 秒 vs 内存 DFS 37ms），SQLite 仅负责持久化 + deadExports + impact 查询

### 重构（SKILL 文档体系重构 — AI 协作优化）

- **SKILL.md 精简为 AI 决策树核心** `skills/workspace-audit/SKILL.md` — 从 395 行精简为 ~180 行，聚焦 AI 高频决策场景：

  - 置顶 **AI 默认调用约定**：定义 `--format markdown --quiet` 为默认参数，教 AI 不要裸调命令
  - **核心决策树**：8 个高频命令（audit-summary / audit-diff / audit-file / audit-security / audit-map / dead-exports / cycles / unresolved），其余命令明确标注为"避免调用"
  - **预热工作流**：教 AI "先 workspace-info 触发缓存，再 audit-summary"，避免冷启动 5-30s 超时
  - **可忽略字段指南**：明确标注 `architectureAdvice` / `stability` / `stabilityTrend` / `hotspots[].reason` / `parserAvailability` 为低价值字段，AI 可跳过以节省上下文
  - 删除 Fast/Slow 表格、完整 Raw Commands 列表、Language Support Matrix 等 AI 噪音内容
  - 删除 Aggregate/Quick/Raw 三层命令分类
- **新建 SKILL-REFERENCE.md** `skills/workspace-audit/SKILL-REFERENCE.md` — 从 SKILL.md 迁移完整命令参考：

  - 完整命令列表（Aggregate / Quick / Raw）、参数说明、Fast vs Slow 表格
  - Language Support Matrix、Known Limitations、Troubleshooting
  - 多仓库批量审计模板、安全审查清单完整版
  - 供人工查阅和深度使用；AI 快速上手优先阅读 SKILL.md
- **安全审查清单扩展** `skills/workspace-audit/SKILL.md` — 从仅 Spring Boot 扩展为三框架：

  - Django：`settings.py` SECRET_KEY/DEBUG、`urls.py` 鉴权、`views.py` SQL 注入/上传校验
  - Vue / Node：`vite.config.js` proxy 暴露、`.env` 密钥、`cors` 开放、代码注入（`eval`/`innerHTML`）
  - Spring Boot 保留原有必查清单
- **多仓库批量审计脚本** `scripts/multi-repo-audit.js` — 遍历父目录下的子仓库，逐条执行 `audit-summary --format jsonl`，输出 Markdown 表格聚合 severity/fileCount/deadExports/unresolved/cycles：

  - 自动过滤 `.git` / `node_modules`
  - 错误仓库标记 ❌，高 severity 仓库列表末尾警告
  - 零 CLI 改动，纯消费侧脚本

### 修复（阶段 1：误报清零）

- **schemaVersion 不一致** `package.json` `src/tools/overview-tools.js` `test/functionality-test.js` `test/overview-tools-test.js` — `package.json` version 1.1.1 → 1.2.0，`overview-tools.js` 内部 `schemaVersion` '1.1.1' → '1.2.0'，与 `cli.js` `SCHEMA_VERSION = '1.2.0'` 统一；同步修复 3 处测试断言
- **L2-6 Vue Admin cycle 白名单** `src/services/dep-graph.js` — `isLikelyFrameworkLegitimateCycle` 新增 `hasUtils` 维度检测：

  - Vue 项目中 store 目录文件（如 `store/modules/settings.js`）与 utils 目录文件（如 `utils/dynamicTitle.js`）之间的标准互引用，长度 ≤6 且涉及 store + utils 两个维度时，视为框架合法循环
  - 覆盖实战基地 zcypg-fe、zsgzt-fe 两个前端项目出现的相同误报模式
- **L2-7 stability 新文件全 fragile** `src/config/constants.js` — `STABILITY_BASE_SCORE` 40 → 45：

  - 新文件默认从 40（fragile 阈值边缘）提升到 45（moderate），消除"无测试 + 中等影响面"的新项目文件批量 fragile 问题
  - 向后兼容：仅 score 偏移 +5，assessment 阈值和语义不变；已有测试覆盖 score 计算逻辑
- **L3-3 architectureAdvice 单体抑制** `src/tools/overview-tools.js` — 按项目规模抑制激进拆分建议：

  - `buildCouplingSplitSuggestions` 检测 `mainlineFiles.length < 200`，标记为 `isSmallProject`
  - `generateCouplingSplitPlan` 第三个参数接收 `isSmallProject`，library 角色时建议从"按子域拆分"降级为"保持内聚优先，通过测试覆盖降低修改风险"
  - 仅影响 `couplingSplitSuggestions` 文案，不影响 cycleRefactorSuggestions 或其他输出字段
- **security-tools.js 内置规则扩展** `src/tools/security-tools.js` — 新增 9 条安全规则（总计从 12 → 21 条）：

  - **hardcoded-secret（medium）**：JS/Python/Java 各 1 条，检测 `password/secret/token/api_key` 等键值对后接 8+ 字符的硬编码字符串
  - **log-sensitive（low）**：JS/Python/Java 各 1 条，检测 `console.log`/`logger.info`/`System.out.print` 等语句中输出敏感字段
  - **file-upload-traversal（low）**：Java 1 条，检测 `MultipartFile`/`getOriginalFilename()`/`transferTo(` 等文件上传 API
  - 全部规则均支持 `// security-scan-ignore` 和 `/* security-scan-ignore` 单行抑制注释

---

### 新增（P4：可靠性收敛 — AI 可信信号）

- **`warnings[]` 解析降级信息入 JSON** `src/services/dep-graph.js` `cli.js` `src/cli/formatters/human-formatters.js` `test/formatter-direct-test.js` — 解决 `--quiet` suppress stderr 后 AI 无法感知解析质量的问题：

  - `GraphAnalyzer.buildWarnings()` 遍历 graph 按 `parseModeReason` 聚合三类警告：`regex-fallback`（AST 降级到 regex，medium）、`unsupported-extension`（未解析，low）、`empty-graph`（0 edges，high）
  - `DependencyGraph` facade 委托暴露 `buildWarnings()`
  - `cli.js` `main()` 在 result 构建完成后注入 `result.warnings = container.depGraph.buildWarnings()`，所有 JSON 输出（`--json`、`--format ai`）自动携带
  - `formatAi()` 将 `warnings` 原样透传至 output，AI 可直接消费
  - 向后兼容：无降级文件时 `warnings` 为空数组，不破坏现有解析器
  - 测试：`formatter-direct-test.js` 新增 `testFormatAiWithWarnings`，验证 warnings 数组正确透传
- **exit code 语义定义** `cli.js` — 解决 AI 无法区分"分析成功"和"工具崩溃"的问题：

  - 新增 `determineExitCode(command, result)`：0=成功完成，1=有 findings / 业务级失败（`result.ok === false`、文件不存在、参数错误），2=未捕获异常 / 工具崩溃
  - `audit-summary`/`audit-security`/`dead-exports`/`unresolved`/`cycles`/`health` 六个命令按 findings 有无区分 0/1；其余命令保持 0/1 按 `result.ok` 区分
  - `main()` catch 块：`process.exitCode = 1` → `process.exitCode = 2`，崩溃与业务失败语义分离
  - 测试适配：`test/analysis-test.js`/`formatter-e2e-test.js`/`regression-test.js`/`role-detection-test.js`/`staged-files-test.js`/`functionality-test.js`/`severity-filter-test.js` 7 个集成测试的 status 断言从 `=== 0` 放宽为 `=== 0 || === 1`（功能测试不关心 findings 有无，只关心工具未崩溃）

### 新增（阶段 2：暴露正确 + 输出策展）

- **`audit-security --builtin-only`** `src/tools/security-tools.js` `cli.js` `test/security-adapter-test.js` — 19 条内置安全规则独立 CLI 入口：

  - `auditSecurity` 签名扩展 `builtinOnly`，为 `true` 时跳过 `getAvailableAdapters()` 直接调用 `runBuiltinSecurityScan()`
  - `cli.js` `parseCliArgs` 注册 `'--builtin-only': true`，`audit-security` case 透传至 `auditSecurity()`
  - 向后兼容：不加 `--builtin-only` 时行为 100% 不变（有 Semgrep 仍优先 Semgrep，无则 fallback builtin）
  - 测试：`security-adapter-test.js` 新增 fake adapter 可用但 `builtinOnly=true` 时仍返回 `adapters: ['builtin']` 的断言
- **`--format summary`** `src/cli/formatters/human-formatters.js` `cli.js` `src/cli/formatters/index.js` `test/formatter-direct-test.js` — 纯模板策展摘要，解决 AI 上下文溢出：

  - 新增 `formatSummary(command, result)` 覆盖 8 个命令：`audit-summary`/`audit-overview`/`audit-security`/`audit-diff`/`audit-file`/`health`/`impact`/`affected-tests`
  - `audit-summary` 从 ~12 行压缩到 ~8 行关键结论（Severity/Health/Files/Issues/Coverage/Next steps）
  - 未知命令自动 fallback 到 `formatHuman`
  - `cli.js` `main()` human-readable 分支增加 `parsed.format === 'summary'` 路由
  - 测试：`formatter-direct-test.js` 新增 4 断言（行数≤10、字段存在、fallback、error 处理）
- **缓存 TTL 5 分钟 → 24 小时** `src/services/cache.js` `src/config/constants.js` `test/staleness-test.js` `test/cache-corruption-test.js` — 解决 AI 异步审查工作流中缓存形同虚设的问题：

  - `src/services/cache.js` `CACHE_TTL_MS` 5 分钟 → 24 小时
  - `src/config/constants.js` `STALENESS_THRESHOLD_MS` 5 分钟 → 24 小时
  - 同步修复 `staleness-test.js` 硬编码阈值断言（300000→86400000，boundary→86400000/86400001，description→"24 hours"）
  - 同步修复 `cache-corruption-test.js` stale 模拟时间（10 分钟→25 小时，确保超过 24h TTL）
  - 向后兼容：非测试代码无硬编码数值，全部通过 `DEFAULTS.STALENESS_THRESHOLD_MS` 和 `CACHE_TTL_MS` 消费
- **`audit-diff --since <commit>`** `src/tools/git-tools.js` `cli.js` `test/audit-diff-test.js` — PR diff 审查 commit range 支持：

  - `getChangedFiles` 新增 `since` 参数：存在时调用 `git diff --name-only <since>...HEAD` 替代 `git status`
  - `getDiffNumstat` 同步支持 `since`：`git diff --numstat <since>...HEAD`
  - `getChangedLineRanges` 同步支持 `since`：`git diff --unified=0 <since>...HEAD -- <file>`
  - `cli.js` `parseCliArgs` 注册 `'--since': { key: 'since' }`，`audit-diff` case 透传至三个 git 工具
  - 向后兼容：不加 `--since` 时 100% 走原有 `git status` + staged/unstaged 路径
  - 测试：`audit-diff-test.js` 利用已有临时 git 固件验证 `--since HEAD~2` 返回 `src/util.js`
- **`--format markdown`** `src/cli/formatters/human-formatters.js` `cli.js` `src/cli/formatters/index.js` `test/formatter-direct-test.js` — 纯模板 Markdown 输出，直接喂给 AI：

  - 新增 `formatMarkdown(command, result)` 覆盖 8 个命令，使用 Markdown 标题/列表/粗体/代码块
  - `audit-summary` 输出带 `# Audit Summary` 标题和 `## Next Steps` 二级标题的 Markdown
  - `audit-security` 输出带 `# Security Audit` 和 `## Findings` 的 Markdown，规则 ID 用行内代码包裹
  - 未知命令 fallback 到 `formatHuman`
  - `cli.js` `main()` 增加 `parsed.format === 'markdown'` 路由
  - 测试：`formatter-direct-test.js` 新增 4 断言（标题存在、列表存在、fallback、error）
- **`--staged` / `--files`** `cli.js` `src/tools/security-tools.js` `test/staged-files-test.js` — PR 审查核心能力补全：

  - `--staged`：`audit-diff` 只分析 git 暂存区，提交前快速自检；`getChangedFiles`/`getDiffNumstat`/`getChangedLineRanges` 均透传 `staged: true`
  - `--files a,b,c`：`audit-diff` 绕过 git status，直接以指定文件列表作为变更集；`audit-security` 将 `--files` 作为 `targets` 传入 `runBuiltinSecurityScan`，限定扫描范围
  - `security-tools.js` 修复 `runBuiltinSecurityScan` 在有 `depGraph` 时忽略 `targets` 的缺陷；新增目录/文件双模式过滤（目录命中则包含其下所有 depGraph 文件，文件则精确匹配）
  - 向后兼容：不加 `--staged`/`--files` 时行为 100% 不变
  - 测试：`staged-files-test.js` 5 断言覆盖参数解析、audit-diff 指定文件、audit-security 限定范围、staged+files 共存优先级、不存在的文件 graceful 降级
- **`--save` / `--check-regression`** `cli.js` `src/tools/regression-tools.js` `test/regression-test.js` — 建立"审计有记忆"的产品认知：

  - `--save <file>`：`audit-summary` 将 findings（deadExports/unresolved/cycles/healthGaps）保存为 JSON 基线快照，含 `schemaVersion`/`timestamp`/`workspaceRoot`
  - `--check-regression`：加载基线文件（默认 `.workspace-bridge-baseline.json`，可覆盖为 `--baseline <file>`），与当前结果逐类别对比
  - 对比输出：`regression.{deadExports|unresolved|cycles|healthGaps}.{new|fixed|open}`，问题标识策略为 dead export 按 `file#name`、unresolved 按 `file#source`、cycle 按排序后 `files.join('->')`、health gap 按 `checkName`
  - `cli.js` `audit-summary` case 顶部统一 `require` `regression-tools`（避免条件 require 被 depGraph 静态分析误判为无 importer）
  - 向后兼容：不加 `--save`/`--check-regression` 时输出 100% 不变
  - 测试：`regression-test.js` 4 断言覆盖 save 生成基线文件、无基线时 check-regression 报错、相同基线对比三态（new/fixed/open 均为空）、自定义 `--baseline` 路径
- **`--baseline <commit>`** `cli.js` `src/tools/regression-tools.js` `test/regression-test.js` — 基线对比支持任意 git commit，标注问题为"本次变更引入"还是"历史遗留"：

  - `regression-tools.js` 新增 `checkRegressionAgainstCommit(currentResult, commit, cwd)`：验证 commit 存在 → `git diff --name-only <commit>...HEAD` 获取变更文件 → 按文件归属标注 `new`/`legacy`
  - `cli.js` 路由：优先判断 `--baseline` 值是否为存在的文件路径；不是则尝试作为 git commit 解析；均失败时回退到默认基线文件对比
  - 向后兼容：`--baseline <file>` 行为 100% 不变
  - 测试：`regression-test.js` 新增 `--baseline HEAD~1` 断言（ok、commit 字段、new/legacy 数组结构）
- **hotspot reason 组合** `src/tools/overview-tools.js` `test/overview-tools-test.js` — 高耦合文件同时展示耦合数 + git 历史信号：

  - `buildHotspots` 中，当 `coupling.total > COUPLING_MEDIUM_MIN`（>10）且存在 `historyRisk.signals[0]` 时，reason 格式化为 `"耦合 X 个模块 · [历史信号]"`
  - 向后兼容：低耦合文件或没有历史信号的文件 reason 不变
  - 测试：`overview-tools-test.js` fixture 调整使 `src/a.js` coupling > 10，断言 reason 包含 `"耦合"` 前缀
- **L2-5 audit-overview schema 不一致** `src/tools/overview-tools.js` `test/overview-tools-test.js` — 统一 `audit-overview` 与 `audit-summary` 的 `summary` 子对象契约：

  - `summary.nextSteps`：新增别名，指向 `summary.recommendations`，兼容按 `audit-summary` 习惯读取 `nextSteps` 的集成方
  - `summary.counts`：新增 `{deadExports, unresolved, cycles, missingHygieneChecks}`，数值从当前 `depGraph` 结果直接提取
  - `summary.analysisCoverage`：当存在时同步放入 `summary`，消除 `audit-summary`（嵌套）与 `audit-overview`（顶层）的嵌套差异
  - 向后兼容：100% 保留现有字段（`insights`、`recommendations`、顶层 `analysisCoverage` 均不变）
  - 测试：`overview-tools-test.js` 新增 6 断言覆盖 `nextSteps` 存在性与长度、`counts` 四字段类型
- **`--format jsonl`** `src/cli/formatters/human-formatters.js` `cli.js` `src/cli/formatters/index.js` `test/formatter-direct-test.js` — JSON Lines 输出，管道友好：

  - `formatJsonl(command, result)`：按命令类型提取核心记录数组，每行一个 JSON 对象，带 `_type` 字段（`finding`/`dead-export`/`unresolved`/`cycle`/`changed-file`/`hotspot`/`impact`/...）
  - 覆盖命令：`audit-security`/`dead-exports`/`unresolved`/`cycles`/`audit-diff`/`audit-summary`/`audit-overview`/`impact`/`dependents`/`dependencies`/`affected-tests`/`audit-map`/`health`/`diagnostics`
  - 无数组命令 fallback 到整对象输出；空数组时输出 `_type: 'summary'` 行
  - `cli.js` 注册 `--format <mode>` help 文案（summary | markdown | jsonl），main() 增加 `parsed.format === 'jsonl'` 路由
  - 向后兼容：不加 `--format` 时行为 100% 不变
  - 测试：`formatter-direct-test.js` 新增 5 断言覆盖 error、audit-security findings、dead-exports、audit-summary 多类型混合、空数组 summary fallback
- **默认输出校准评估**（纯文档/决策，0 行代码）— 评估是否将默认输出从 `human-readable` 改为 `--format summary`：

  - **决策：保持 `human-readable` 默认不变**。理由：(1) AGENTS.md L1-1 Never break userspace，突然改变默认格式会 break 现有脚本；(2) 人类用户首次终端运行时期望看到完整字段，summary 是 AI 优化格式；(3) SKILL.md 已明确推荐 AI 场景使用 `--format summary`

---

### 新增（P1 `--format ai` AI 预消化输出）

- **`formatAi` 策展 formatter** `src/cli/formatters/human-formatters.js` — AI 可直接消费的预消化 JSON，替代原始 `--json` 嵌套深、体积大的问题：

  - 统一结构：`{ ok, schemaVersion, severity, meta, counts, topRisks[], actions[], confidence }`
  - `topRisks` 按业务优先级排序：低 coverage → cycles → unresolved → dead-exports → health，每条风险含 `severity` / `count` / `message` / `confidence`（数值 0–1）
  - `actions` 从 `nextSteps` 提取，最多 3 条，带 `priority: P0/P1/P2`
  - `confidence` 包含 `overall` 和 `coverageRatio`，AI 可据此校准信任度
  - 非 `audit-summary` 命令自动 fallback 到 `formatSummary`，不破坏现有体验
- **`--depth surface|detail|full` 渐进式发现** `cli.js` `src/cli/formatters/human-formatters.js`：

  - `surface`：只返回 counts + topRisks（最多 3）+ actions（最多 3）+ confidence + meta，~15 行 JSON
  - `detail`（默认）：追加 `riskFiles`，每类风险最多 3 个代表性文件（含 exports / import / cycle length）
  - `full`：追加完整 `details`（`deadExports[]` / `unresolved[]` / `cycles[]` 全部明细）
- **`--token-budget <n>` AI 上下文感知裁剪** `cli.js` `src/cli/formatters/human-formatters.js`：

  - 估算 token = `JSON.stringify(output).length / 4`
  - 超限时自动降级：full → detail → surface → 核心字段（`ok + severity + counts`）
  - 向后兼容：不加 `--token-budget` 时 100% 输出完整 depth 内容
- **CLI 参数与路由** `cli.js`：

  - `parseCliArgs` 注册 `'--depth': { key: 'depth' }` 和 `'--token-budget': { key: 'tokenBudget', transform: ... }`
  - Help 文案更新：`--format <mode>` 增加 `ai`；新增 `--depth` 和 `--token-budget` 说明
  - 主输出路由增加 `parsed.format === 'ai'` 分支，透传 `depth` / `tokenBudget` / `schemaVersion`
- **测试覆盖** `test/formatter-direct-test.js`：

  - `testFormatAiAuditSummarySurface`：验证无 `riskFiles`/`details`
  - `testFormatAiAuditSummaryDetail`：验证有 `riskFiles` 无 `details`
  - `testFormatAiAuditSummaryFull`：验证有 `riskFiles` 和 `details`
  - `testFormatAiTokenBudgetDowngrade`：验证低 budget 触发降级到核心字段
  - `testFormatAiFallbackToSummary`：验证非 audit-summary 命令 fallback
  - `testFormatAiError`：验证错误输出格式

---

### 修复（P0 去噪工程 — 误报清零 + 输出策展）

- **常量仓库 / 脚手架直接过滤** `src/services/dep-graph.js` — 从 `deadExports[]` 直接移除，不降级保留：

  - `findDeadExports` `importers.length === 0` 分支：若 `scaffold` 命中（RuoYi / Vue Admin），直接 `continue` 跳过
  - `findDeadExports` `unused.length > 0` 分支：若 `isLikelyConstantsWarehouse`（Java `Constants.java` / `HttpStatus.java` / `Utils.java`）或 `scaffold` 命中，直接 `continue` 跳过
  - 向后兼容：常量仓库和脚手架文件仍参与依赖图构建，仅不从 `deadExports[]` 输出；`classifyDeadExports` / `honesty-engine` 分类逻辑 100% 保留
  - 实战效果：Java 后端常量仓库误报 35% 清零；RuoYi/Vue Admin 脚手架 dead-export 噪音清零
- **`audit-overview` 去重合并** `src/tools/overview-tools.js` `test/overview-tools-test.js`：

  - 删除 `summary.nextSteps = summary.recommendations` 别名（`audit-overview` 内部两字段完全重复，8 条建议一模一样）
  - `buildCouplingSplitSuggestions` 返回数量从 `SCORING.TOP_N_LIST(10)` 截断为 3，消除 `splitPlan` 模板化文案重复堆积
  - 测试同步：移除 `overview-tools-test.js` 中 `nextSteps` 存在性与长度断言
- **`audit-security` 附加 `matchedText`** `src/tools/security-tools.js` — 正则命中后输出匹配到的具体字符串：

  - `runBuiltinSecurityScan` 每条 finding 新增 `matchedText` 字段（`lines[i].match(rule.pattern)[0]`），超长时截断至 120 字符
  - AI 消费者无需额外读文件即可判断 `password: 'admin123'` 等命中内容是否为真实问题
  - 向后兼容：未命中规则时 `matchedText` 为 `null`，不影响现有字段

### 修复（阶段 3：框架感知深化 — P6）

- **Vue `<script setup>` 编译器宏识别** `src/services/dep-graph/parsers/js.js` `src/services/dep-graph/framework-patterns.js` `test/vue-parser-test.js` `test/framework-patterns-test.js` — 消除 Vue 3 项目中 `defineProps`/`defineEmits`/`defineExpose` 被误标为 dead exports 的问题：

  - `js.js` 新增 `VUE_COMPILER_MACROS` 集合（`defineProps`/`defineEmits`/`defineExpose`/`defineOptions`/`defineSlots`/`defineModel`），在 AST 和 regex parser 中对 `.vue` 文件的 export 记录做过滤
  - AST 路径：`ExportNamedDeclaration` 的 `specifiers` 和 `declaration` 分支均跳过宏名 export
  - regex 路径：`parseJavaScript` 调用 `extractExportsWithRegex` 后统一过滤
  - 非 `.vue` 文件完全不过滤（保留向后兼容，避免误杀合法的同名函数 export）
  - `framework-patterns.js` `AST_PATTERNS.js` 新增 `vue-script-setup-macro` 内容检测模式，`detectFrameworkFromContent` 识别到宏调用时标记 `framework: 'vue'`、`isEntry: true`
  - 测试：`vue-parser-test.js` 新增 `testScriptSetupMacroExportsFiltered`（re-export 过滤）和 `testScriptSetupMacroDeclarationFiltered`（声明 export 过滤）；`framework-patterns-test.js` 新增宏内容检测断言
- **Spring 更多运行时注解识别（P7）** `src/services/dep-graph/framework-patterns.js` `test/framework-patterns-test.js` — 扩展 `AST_PATTERNS.java` 的 `spring-annotation` 模式，覆盖 `@FeignClient`（Spring Cloud 声明式 HTTP 客户端）和 `@Scheduled`（Spring 定时任务）：

  - `@FeignClient` 与 `@Scheduled` 追加到现有 `spring-annotation` patterns 数组，与 `@RestController`/`@Controller`/`@GetMapping`/`@PostMapping` 同组
  - 运行时注解管理的组件静态分析无法追踪调用方，统一标记 `framework: 'spring'`、`reason: 'spring-annotation'`、`isEntry: true`，`dep-graph.js` `isKnownEntryFile()` 自动保护，消除 dead-export 误报
  - 测试：`framework-patterns-test.js` 新增 `testDetectFrameworkFromContent` 中 `@FeignClient` 接口和 `@Scheduled` 方法的 content-based 检测断言
- **Django 配置驱动入口深化（P8）** `src/services/dep-graph/framework-patterns.js` `test/framework-patterns-test.js` — 补充 Django signals 运行时入口检测：

  - `AST_PATTERNS.py` 新增 `django-signal` 模式，覆盖 `@receiver` 装饰器和 `.connect(` 方法注册两种信号绑定写法
  - `detectFrameworkFromPath` 新增 `signals.py` 路径检测（Django 项目惯用信号集中存放文件名）
  - 信号处理函数被 Django 运行时通过信号分发机制调用，无静态 import 引用，统一标记 `isEntry: true`，消除 dead-export 误报
  - 测试：新增 `@receiver` content-based 检测、`post_save.connect` content-based 检测、`signals.py` path-based 检测 3 个断言
- **`--severity P0/P1` 过滤** `cli.js` `src/tools/security-tools.js` `test/severity-filter-test.js` — `audit-security` / `audit-summary` 输出前按 severity 过滤：

  - `parseCliArgs` 注册 `--severity`，校验值限定 `high|medium|low`
  - `audit-security`：对 `findings` 数组按 `severity` 过滤，过滤后重新计算 `summary.total` 和 `summary.bySeverity`
  - `audit-summary`：对 `deadExports.deadExports` 按 `confidence` 过滤（`high`/`medium`/`low` 与 severity 语义对齐），同步更新 `deadExportsCount` 和 `possibleFalsePositives`
  - 向后兼容：不加 `--severity` 时行为 100% 不变
  - 测试：`severity-filter-test.js` 覆盖 `audit-summary --severity high/medium`（利用当前项目 medium confidence dead exports 验证过滤效果）、非法 severity 值报错、`audit-security --severity high` 在有 finding 的临时文件上验证过滤
- **`--with-impact`** `cli.js` `test/with-impact-test.js` — `audit-diff` 输出追加 `impactFiles` 字段，变更文件依赖方自动展开：

  - `parseCliArgs` 注册 `--with-impact`
  - `audit-diff` case 对每个变更文件调用 `getImpactRadius(resolvedPath, 2)`，收集 depth=2 的依赖方，去重后注入 `result.impactFiles`
  - 使用 `safeEntries`（compact 前）获取 `resolvedPath`，避免 `compactChangedFile` 丢弃路径后无法计算 impact
  - 向后兼容：不加 `--with-impact` 时 `impactFiles` 字段不存在，行为 100% 不变
  - 测试：`with-impact-test.js` 覆盖 `--with-impact` 返回 `impactFiles` 非空、`--without` 时字段不存在

---

### 修复（大仓库并发限流 — 阶段 3）

- **Python 子进程信号量** `src/services/dep-graph/parsers/spawn-ast.js` `src/config/constants.js` `test/spawn-ast-concurrency-test.js` — 解决大仓库 Java/Python 项目构建时 20 个并发 Python 子进程导致 600MB–1.6GB 瞬时内存峰值的问题：

  - `spawn-ast.js` 新增模块级信号量（`activeParsers` + `parserQueue`），限制同时运行的 Python 子进程数为 `LIMITS.PYTHON_AST_CONCURRENCY = 4`
  - `acquireParserSlot()` / `releaseParserSlot()` 封装排队逻辑；`spawnPythonASTParser` 用 try-finally 包装，确保任何路径（成功/失败/超时/kill）都释放 slot
  - 向后兼容：非 Python/Java 文件解析不受影响；纯 JS parser 的并发仍为 20（`CONFIG.DEFAULT_CONCURRENCY`）
  - 测试：`test/spawn-ast-concurrency-test.js` 10 并发 mock 验证峰值 ≤ 4，且所有请求最终都完成
- **git log 分批次并发** `src/tools/overview-tools.js` `src/config/constants.js` `test/overview-tools-concurrency-test.js` — 解决 `audit-overview` 中 `buildHotspots` 对 50 个文件同时发起 `git log --follow`，导致磁盘/CPU 争用、总耗时 5–10s 的问题：

  - `buildHotspots` 从全量 `Promise.all(...map(...))` 改为分批次并发，每批 `LIMITS.GIT_LOG_CONCURRENCY = 8` 个文件
  - 批次内仍并行（同批文件互不影响），批次间串行（自然限制峰值并发）
  - 向后兼容：输出格式和排序 100% 不变；小仓库（<8 文件）行为完全不变
  - 测试：`test/overview-tools-concurrency-test.js` mock provider 验证 20 文件峰值 ≤ 8，且调用顺序在单批内保持

### 重构（git-tools.js 死代码清理）

- **删除 6 个无调用方的 git 工具函数** `src/tools/git-tools.js` `cli.js` — 根据 AGENTS.md L2-5 "删除 > 添加"铁律，清理自 MCP 转型以来无调用方的死代码：
  - 删除：`gitDiffSummary`、`gitBlame`、`gitHistory`、`gitBranchInfo`、`gitStash`、`gitLogGraph`
  - 这些函数在项目中无任何调用方（cli.js 无对应命令、无测试覆盖、被 dead-exports 分析明确标记为未使用）
  - `git-tools.js` 从 667 行 → 358 行（-309 行，-46%），dead exports 从 5 个 → 4 个
  - `cli.js` 合并重复的 `require('./src/tools/git-tools')` 为单一解构导入
  - 向后兼容：所有活跃函数（`getChangedFiles`、`getChangedLineRanges`、`getFileHistoryRisk`、`getDiffNumstat`）行为 100% 不变

### 修复（Windows 命令硬化：验证建议字符串在 PowerShell 下可执行）

- **`renderCommandString` 平台感知** `src/utils/stack-detectors/commands.js` `test/render-command-string-test.js` `test/go-module-path-test.js` — 解决 Windows 下 `cd ${cwd} && ${cmd}` 在 PowerShell 中无法直接复制粘贴执行的问题：
  - `renderCommandString(executable, platform = process.platform)`：Windows (`win32`) 下将 `cd ${cwd} && ${body}` 改为 `pushd ${cwd} && ${body}`。`pushd` 在 cmd 和 PowerShell 中均为内置命令，兼容性优于 `cd`
  - `parseCommandString` 同步扩展：`cd` 前缀解析正则增加 `pushd` 替代符，分隔符增加 `;`（PowerShell 语句分隔符），确保 `pushd backend && go test ./...` 和 `cd backend ; go test ./...` 都能正确恢复 `cwd`/`command`/`args` 结构
  - 向后兼容：非 Windows 平台行为 100% 不变；`executable` 结构化对象中的 `cwd` 字段语义不变，消费侧（`watch.js` `runCommandSecure`）仍通过 spawn 的 `cwd` 选项直接传递，不受字符串格式影响
  - 测试：`render-command-string-test.js` 新增 `testWindowsCwdPrefix` / `testLinuxCwdPrefix` / `testParsePushd` / `testParseSemicolon` / `testParsePushdSemicolon` 5 个断言；`go-module-path-test.js` 将硬编码 `cd ` 断言改为平台感知 `CD_PREFIX`

### 修复（测试基础设施稳定性）

- **`functionality-test.js` 不再修改 git tracked 文件** `test/functionality-test.js` — 移除对 `README.md` 的读写修改，改用临时 untracked 文件 `test-audit-diff-temp.txt` 触发 `audit-diff` 的变更检测。`finally` 块负责清理临时文件，即使测试被 SIGKILL 也不会脏化工作区
- **`java-parsers-test.js` javalang 探针超时提升** `test/java-parsers-test.js` — `spawnSync` timeout 从 5000ms → 15000ms，消除 Windows/Python 冷启动偶发超时导致的 flaky 测试
- **`runner.js` 增加单测试耗时打印** `test/runner.js` — 每个测试 PASS/FAIL 后输出耗时（ms），超过 10s 标记 `SLOW`，帮助识别性能回归和 CI 超时根因

### 重构（cli.js 门面拆分：`formatHuman` 提取到 formatters 层）

- **新建 `src/cli/formatters/human-formatters.js`** — 将 cli.js 中 ~200 行的 `formatHuman` switch 完整迁移至此文件，覆盖 19 个命令的人类可读格式化。cli.js 仅保留 `require('./src/cli/formatters').formatHuman` 一行委托调用
- **`src/cli/formatters/index.js`** 新增 `formatHuman` 导出
- **`cli.js`** 移除本地 `formatHuman` 函数定义和 `countTreeFiles` 直接导入（后者仅在 human-formatters.js 中使用），门面厚度从 ~623 行降至 ~420 行
- 向后兼容：所有 JSON/human 输出 100% 不变；新增命令时只需改 `human-formatters.js` 和 `runCommand` 路由，不再动 cli.js 的 formatter 逻辑

### 测试（formatter 直接测试覆盖）

- **新增 `test/formatter-direct-test.js`** `src/cli/formatters/human-formatters.js` `src/cli/formatters/repo-summary.js` — 直接测试此前仅被间接覆盖的 formatter 层：

  - `formatHuman` 覆盖 18 个命令分支（error / audit-summary / audit-overview / health / audit-file / dead-exports / unresolved / cycles / impact / affected-tests / dependencies / dependents / stats / audit-diff / audit-map / diagnostics / workspace-info / audit-security / default fallback）
  - `buildRepoSummary` 覆盖正常输入、coverageRatio < 0.5 severity 升级、node-first / java-first stack 优先级差异、nonMainline = 0 时的 totalFiles 提示
  - 纯新增测试，零生产代码改动
  - 测试数量从 94 → 95
- **新增 `test/formatter-e2e-test.js`** — 基于真实 CLI 输出的端到端第二层验证（白盒单元测试的补充）：

  - `audit-summary` / `audit-overview` human + JSON 双模式输出结构验证（含 P83/P88 totalFiles 标注断言）
  - `audit-file` / `health` / `stats` human 输出关键字段断言
  - `impact` 错误路径 human 格式断言（验证 `formatHuman` error fallback 在真实 CLI 链路中生效）
  - 测试数量从 95 → 96；e2e 单文件耗时 ~21s（主要开销来自 `audit-overview` 的 `git log --follow`）
- **新增 `test/parser-shared-polyglot-test.js`** — 直接测试此前仅被间接覆盖的 parser 底层纯函数：

  - `shared.js` 覆盖 9 个纯函数（`uniqueNames` / `exportKindFromDeclarationType` / `createExportRecord` / `isFunctionLikeNode` / `getCallName` / `buildFunctionFingerprint` / `normalizeImportedName` / `parseNamedBindings` / `createImportRecord`）
  - `polyglot.js` 覆盖 3 个 regex parser（`parseKotlin` / `parseGoRegex` / `parseRust`），含空输入边界
  - 纯新增测试，零生产代码改动；测试中发现 `parseKotlin` `enum class` 提取为 `class` 的已知边缘行为已文档化于测试注释中
  - 测试数量从 96 → 97

### 修复（P83/P88：`totalFiles` 语义标注消除用户困惑）

- **human-readable 输出显式标注 `totalFiles` 含义** `src/cli/formatters/human-formatters.js` `src/cli/formatters/repo-summary.js` — 解决用户看到 `totalFiles` 数值小于仓库实际文件数时产生"扫描不完整"的误解：
  - `audit-summary` human format 新增 `totalFiles: N (parseable source only; excludes assets/build artifacts/excluded dirs)` 行
  - `audit-overview` human format 同步修改 `totalFiles` 行，附加相同说明
  - `buildNextSteps` 在 `nonMainlineFiles > 0` 时追加解释性前缀：`Note: totalFiles counts only parseable source files; assets, build artifacts, and excluded directories are not included.`
  - 纯 JSON 输出 100% 不变（schema 冻结，不破坏 userspace）
  - 向后兼容：所有现有测试通过；消费者通过 `scope.counts.mainlineFiles` / `scope.counts.nonMainlineFiles` 仍可自行计算比例

### 修复（P77：`findUnresolvedImports` Windows 路径格式一致性）

- **新增 `fromNormalizedKey` 消除平台路径隐性假设** `src/utils/path.js` `src/services/dep-graph.js` `test/p77-unresolved-imports-test.js` — 修复 `findUnresolvedImports` 中 `hasFile()`（基于 `normalizePathKey`）与 `path.isAbsolute()` / `fs.existsSync()`（基于原始路径格式）判断不一致的边界：
  - `src/utils/path.js` 新增 `fromNormalizedKey(key)` 纯函数：Windows 下将 `c:/foo/bar`（normalizePathKey 格式）还原为 `c:\\foo\\bar`（平台原生格式）；POSIX 下为 no-op
  - `src/services/dep-graph.js` `findUnresolvedImports()` 第 941 行：将 `path.isAbsolute(imp)` 和 `fs.existsSync(imp)` 改为先 `fromNormalizedKey(imp)` 再判断，消除"normalizePathKey 格式的路径一定能被 `fs.existsSync` 正确识别"的隐性假设
  - 向后兼容：行为 100% 不变（当前 Windows 实测 `fs.existsSync('c:/foo')` 本就有效，修复仅为消除假设、统一范式）
  - 测试：`test/p77-unresolved-imports-test.js` 覆盖 `fromNormalizedKey` 转换语义 + `findUnresolvedImports` 对 normalizePathKey 格式路径的正确处理

### 重构（P8-2-1：`parseCommandString` 后处理补丁 → 正交设计）

- **`commands.js` 生成侧直接返回 `executable` 结构** `src/utils/stack-detectors/commands.js` `test/render-command-string-test.js` — 消除"生成侧拼字符串、消费侧拆字符串"的双源维护：
  - 新增 `renderCommandString(executable)` 纯函数：将 `{command, args, cwd, shell}` 合成人类可读的 `cmd` 字符串（`cd ${cwd} && ${command} ${args.join(' ')}`）
  - `buildNodeTestCommand` / `buildGoModuleTestCommands` / `buildRustTestCommands` 改为返回 `executable` 对象
  - `getNodeCommands` / `getPythonCommands` / `getJavaCommands` / `getGoCommands` / `getRustCommands` / `getCppCommands` / `generateCommands` 底部 direct-tests 等 20+ push 点全部改为 `executable: {...}`
  - `enrichCommandEntry` 双向化：已有 `executable` 无 `cmd` 时合成 `cmd`；已有 `cmd` 无 `executable` 时解析 `executable`。两者都有时保持不动，仅补全 `expectedExitCode` / `onFailure` 默认值
  - `addUniqueCommand` 兼容 `executable` 去重（`JSON.stringify(executable)` 比对 + `name` 比对）
  - 向后兼容：`cmd` 字符串字段**完全保留**，所有现有消费者（`watch.js` / `validation-advice.js` / `risk-actions.js` / `self-audit.js` / 10+ 测试文件）零改动继续工作。`generateCommands` 末尾的 `enrichCommandSet` 确保每个条目同时有 `cmd` + `executable`
  - `module.exports` 新增 `renderCommandString` 导出
  - 测试：`test/render-command-string-test.js` 8 断言覆盖基本合成、`cwd` 前缀、`shell` 优先、null 过滤、空对象、parse→render 往返、无 args

### 修复（P84：Maven 多模块边界检测 — 与 Gradle 对等）

- **P84: Maven 多模块项目模块边界零检测** `src/utils/stack-detectors/detect.js` `src/utils/stack-detectors/commands.js` `test/maven-module-detection-test.js` — 此前 Gradle subprojects 已完整支持（`settings.gradle` 解析 + 模块级命令），Maven `<modules>` 完全空白：
  - `detect.js` 新增 `detectMavenModules(root)`：解析根 `pom.xml` 的 `<module>` 元素，过滤无子 `pom.xml` 的幽灵条目，返回 `[{ name, dir }]` schema（与 Gradle `subprojects` 统一）
  - `detectStack()` 对 Maven 注入 `java.modules`（Gradle 保持原有行为）；`java.subprojects` 保留为兼容别名
  - `commands.js` `mapJavaFilesToGradleModules` → `mapJavaFilesToModules`，所有调用点通过 `java.modules || java.subprojects` 兼容旧消费者
  - Maven 多模块命令生成：受影响的模块通过 `-pl <module1>,<module2> -am` 精准构建（`compile`/`test`/`focused-tests`/`full-tests` 全阶段），未受影响模块完全跳过。单模块项目 fallback 到根目录命令，行为 100% 不变
  - 向后兼容：现有 Gradle mock stack（用 `subprojects` 字段）无需改动；`generateCommands` 自动 fallback
  - 测试：`test/maven-module-detection-test.js` 6 断言覆盖单模块/多模块/无模块/缺失子 pom/detectStack 注入/命令生成 `-pl` 验证

### 修复（路线 F：数据一致性收尾 — P92/P93/P94/P95）

- **P92: `workspace-info` 的 `entryFiles` 与 `audit-summary` 不一致** `src/tools/workspace-tools.js` — `workspaceInfo()` 改用 `projectContext.summarizeFiles(allOriginalPaths, getDependents)` 计算 `entryFiles`，替代原来的 `depGraph.entryFiles`（空 Set）。`allOriginalPaths` 从 `depGraph.graph.values()` 的 `originalPath` 属性聚合。与 `audit-summary` 的 `scope.entryFiles` 使用同一数据源和计算路径
- **P93: `workspace-info` 缺少 `stack` 字段** `src/tools/workspace-tools.js` — 返回值新增 `stack: {isNode, isJava, isPython, isGo, isRust}`，与 `health` 命令的 `stack` 字段同源同义。用户不再需要分别调用两个命令才能拿到完整项目画像
- **P94: `stats` 命令缺少 `fileRoles`** `src/services/dep-graph.js` — `GraphAnalyzer.getStats()` 在返回前调用 `this.getScopeSummary()` 获取 `fileRoles` 并注入 `stats` 对象。`stats` 与 `audit-summary` 的 `scope.fileRoles` 字段完全互通
- **P95: `ROLE_RULES` 与 `test-detector.js` 不同步** `src/utils/project-context.js` `test/role-detection-test.js` — `ROLE_RULES.test` 补入 `base === 'tests.py'` basename 匹配，与 `test-detector.js` 的 `TEST_DETECTION_RULES` 对齐。Django 项目的 `core/tests.py` 等不再被误标为 `library`。新增 `role-detection-test.js` Django 固件测试验证

### 修复（路线 G：框架感知补全 — P96/P101）

- **P96: Vue 长循环白名单不足（长度=6 被误报）** `src/services/dep-graph.js` `test/dep-graph-error-test.js` — `isLikelyFrameworkLegitimateCycle` 对 Vue 项目放宽至长度 ≤6（其他框架保持 ≤5）：① `allInVue` 目录匹配新增 `api`/`http`/`request`/`services`/`service` ② 维度检测新增 `hasApi`（≥2 个维度即合法）。`request→store→router→view→api→request` 标准数据流不再被误报为 cycles。新增 `testVueLongCycleWhitelist` 验证 5 文件 length=6 循环被正确过滤
- **P101: Django 项目 `testConfig` 被误报为缺失** `src/tools/health-tools.js` `test/health-tools-test.js` — `detectTestConfig()` 在无其他测试运行器时检测 `manage.py` 存在，返回 `frameworks: ['django-test']`。Django 项目 health 评分不再被不公正扣分。新增 `testDjangoTestConfigDetection` 验证

### 修复（路线 H：脚手架与模板同质化 — P97/P98/P99/P100）

- **P97: RuoYi Java 工具类循环被误报为架构缺陷** `src/services/dep-graph.js` `test/dep-graph-error-test.js` — `isLikelyFrameworkLegitimateCycle` 新增 RuoYi 脚手架工具类互依赖白名单：① 循环长度 ≤2 ② 路径含 `ruoyi`/`common/utils`/`common/core` ③ 所有文件名以 `Utils`/`Formatter`/`Serializer`/`Helper`/`Constants` 结尾。`StringUtils↔StrFormatter`、`Sensitive↔SensitiveJsonSerializer` 等同源脚手架同质循环不再重复报告为缺陷。新增 `testRuoYiJavaCycleWhitelist` 验证
- **P98: `scaffold-detector.js` 未覆盖 `Sensitive.java` 等 RuoYi 指纹** `src/tools/scaffold-detector.js` `test/scaffold-detector-test.js` — `ruoyi-java` 指纹补全：`pathPatterns` regex 新增 `sensitive`，覆盖 `Sensitive.java` 在 ruoyi 路径下的检测。新增 `testScaffoldDetectorSensitiveJava` 验证
- **P99: 第三方库复制文件被标 dead-export** `src/tools/honesty-engine.js` `test/honesty-engine-test.js` — 新增 `VENDOR_COPY_BASENAMES` 集合（`jsencrypt.js`、`md5.js`、`crypto-js.js` 等 14 个常见库），`classifyDeadExports()` 在 `FRAMEWORK_IMPLICIT_PATTERNS` 之后检测 vendor-copy 并标记 `reason: 'vendor-copy'`。`buildClassificationSummary` 将 `vendor-copy` 纳入假阳性统计。静态分析无法追踪全局变量运行时引用的问题现可被透明标注。新增 `testClassifyDeadExports_vendorCopy` 与 `testBuildClassificationSummary_vendorCopyCountedAsFalsePositive` 验证
- **P100: 根目录独立 `.py` 脚本未被识别为 `script`** `src/utils/project-context.js` `src/utils/path.js` `test/role-detection-test.js` — `ROLE_RULES.script` 新增根目录 `.py` 文件检测（深度=1，已被 `test`/`migration`/`entry`/`config` 前置规则捕获的除外）；`isStandaloneEntryPath()` 同步新增 `/^[^/]+\.py$/` 匹配，使孤儿检测与角色分类一致。`ai_gwy_backend` 根目录 20+ 运维脚本不再被误标为 `library`/`unknown`。新增根目录 `.py` script 角色覆盖测试

### 修复（路线 I-2：GitNexus 低垂果实吸收）

- **`yieldToEventLoop()` 防事件循环阻塞** `src/services/dep-graph.js` — `_processFilesWithLimit` 每处理 20 个文件 `await setImmediate` 主动让出；`applyFrameworkImplicitImports` 改为 async，同步 `fs.readFileSync` 替换为 `await readFile`，同循环内每 20 文件让出。`build()` / `updateFiles()` 中 `postProcessPhases` 调用改为 `await phase()`。大仓库（10k+ 文件）首次索引和 watch 长期运行时 CLI/UI 不再卡顿
- **数值 confidence 替代文本分级** `src/services/dep-graph.js` `src/config/constants.js` — `computeDeadExportConfidence` 返回值新增 `confidenceValue`（0.95 / 0.9 / 0.5）和 `confidenceSource`（`ast-no-importer` / `ast-unused-exports` / `regex-fallback` / `graph-sparse` / `java-constants-warehouse`）。下游 AI 消费者可按数值阈值过滤，消除 `high/medium/low` 文本分级无法排序/比较的问题。向后兼容：`confidence` 字符串字段完全保留
- **Staleness 检查 git HEAD** `src/services/container.js` `test/staleness-test.js` — `initialize()` 末尾执行 `git rev-parse HEAD` 并将 hash 存入 `cache.workspaceInfo`；`getStaleness()` 比较当前 HEAD 与缓存 HEAD，不一致时 `isStale: true` + `gitHeadChanged: true`。用户切换分支后缓存自动被视为过期，避免分支切换后的误报。非 git 目录或 git 不可用时不影响现有行为

### 重构（路线 J：Import 解析策略链重构 — GitNexus 模式吸收）

- **`resolvers.js` 配置表驱动策略链** `src/services/dep-graph/resolvers.js` `test/resolver-strategy-chain-test.js` — 吸收 GitNexus `import-resolvers/resolver-factory.ts` 设计模式：
  - 新增 `createResolver(strategies)` 工厂函数：有序策略链，第一个非 null 结果获胜
  - 新增 `registerResolverConfig(ext, strategies)` API：每种语言一行配置
  - 新增 10 个策略纯函数：`tryAlias` / `tryRelativeWithExtensions` / `tryPythonRelative` / `tryPythonAbsolute` / `tryJava` / `tryGoRelative` / `tryGoModule` / `tryRustCrate` / `tryRustSuper`
  - `resolveImport(fromFile, importPath, ext, root)` 门面：内部从 6 分支 if-else 改为 `RESOLVER_CONFIGS.get(ext) || default` + `createResolver(strategies)`。对外接口 100% 不变
  - 向后兼容：所有原有导出（`resolveJavaImport`, `clearResolverCaches`, `cachedExistsSync`）完全保留
  - 新增 `test/resolver-strategy-chain-test.js`：20 断言覆盖链式行为、配置表覆盖、facade 行为、扩展注册

### 修复（路线 I：GitNexus 模式吸收与图架构深化 — P102/P103/P104/P105）

- **P102: `updateFiles` 删除文件后图不一致（L1）** `src/services/dep-graph.js` `test/dep-graph-incremental-test.js` — 删除分支追加清理：① 遍历 `reverseGraph` 所有值，从 dependents 数组中移除被删除文件 ② 遍历 `graph` 所有条目，从 `imports` / `importRecords` 中过滤被删除文件 ③ 删除 `reverseGraph` 中以被删文件为 key 的条目。彻底消除 watch 长期运行的幽灵边。测试同步更新：删除后 `n.js` 不再引用 `m.js`，`getDependents(mKey)` 返回 `[]`
- **P103: `framework-patterns.js` 引入 `entryPointWeight` 梯度评分（L2）** `src/services/dep-graph/framework-patterns.js` `src/tools/overview-tools.js` `test/framework-patterns-test.js` — 将 `isEntry: true/false` 升级为 1.0–3.0 梯度评分（`ENTRY_WEIGHT` 常量表）：HIGH=3.0（page/controller/views/main/application）、MEDIUM_HIGH=2.5（layout/routes/URLs/handlers）、MEDIUM=2.0（admin/middleware/plugins）、LOW=1.5（components/prisma）、MINIMAL=1.0（manage.py）。`calculateHotspotScore` 接入 `entryPointWeight` multiplier（`> 1` 时 `score *= weight`），热点计算首次能区分 Spring Boot Controller 与 Django manage.py 的变更风险差异。向后兼容：`isEntry` 字段保留，现有消费者零改动
- **P104: 扩展隐式依赖模式 — React.lazy / Next.js dynamic / Angular loadChildren（L2）** `src/services/dep-graph/framework-usage-patterns.js` `test/framework-usage-patterns-test.js` — 新增 3 个 `FRAMEWORK_USAGE_PATTERNS` 配置：① `react-lazy` 扫描 `React.lazy(() => import('...'))` / `lazy(() => import('...'))` ② `nextjs-dynamic` 扫描 `dynamic(() => import('...'))` ③ `angular-loadchildren` 扫描 `loadChildren: () => import('...')`。各 pattern 含独立 scanner/extractor，复用现有 `resolveImplicitImports` 解析链路。消除 React/Next.js/Angular 项目懒加载组件的 orphan/dead-export 系统性误报。新增 3 组单元测试验证提取精度
- **P105: 软 post-process phase 架构（L3）** `src/services/dep-graph.js` — `GraphBuilder` 构造函数新增 `postProcessPhases: Array<() => void>`，默认注册 `applyFrameworkImplicitImports`。`build()` 和 `updateFiles()` 末尾的硬编码调用替换为 `for (const phase of this.postProcessPhases) phase()`。新增 `registerPostProcessPhase(fn)` API 供外部注册新 phase。向后兼容：不加 `--incremental` 时现有行为 100% 不变

### 新增（P8-3 增量策展 — 闭环能力完整）

- **`audit-file --watch`** `cli.js` `src/cli/watch.js` `test/audit-file-watch-test.js` — 文件保存后输出完整 audit-file 结构化结果（JSON Lines 事件流）：
  - `startAuditFileWatch(options)`：复用 `ServiceContainer` + `watch: true` 初始化，注册 `onFileChanged` 回调
  - `registerAuditFileWatchCallback`：支持 `--file <path>` 目标过滤，只对目标文件变更触发分析
  - `buildAuditFileWatchResult`：调用 `getImpactRadius` + `findAffectedTests` + `getFrameworkHint` + `buildFileValidationAdvice` + `buildFileSummary`，输出完整 audit-file 语义
  - JSON Lines 事件契约：`auditFileStart` → `auditFileResult`（含 `impact`/`affectedTests`/`validationAdvice`/`summary`/`frameworkPattern`）→ `auditFileComplete`
  - CLI 路由：`case 'audit-file'` 检测 `parsed.watch`，`isSelfManaged` 判断包含 `audit-file --watch` 以管理容器生命周期
- **`audit-diff --incremental`** `cli.js` `src/tools/incremental-diff.js` `test/audit-diff-incremental-test.js` — 范围过滤层，消除全库噪音：
  - `buildIncrementalFindings(changedFiles, container)`：收集 changed files + impact radius（depth=2）构成 `relatedFilesSet`，全库 `findDeadExports`/`findUnresolvedImports`/`findCircularDependencies` 只保留相关子集
  - 输出 Schema：audit-diff 返回值追加 `incremental: true` + `incrementalFindings`（`deadExportsCount`/`deadExports`/`unresolvedCount`/`unresolved`/`cyclesCount`/`cycles`）
  - 向后兼容：不加 `--incremental` 时现有字段 100% 不变
- **参数解析**：`cli.js` `parseCliArgs` 新增 `'--watch': true` / `'--incremental': true`，返回值映射 `watch`/`incremental` 字段
- **测试**：`test/audit-file-watch-test.js`（启动 → 触发文件变更 → 轮询验证 JSON Lines 事件 + target filtering）+ `test/audit-diff-incremental-test.js`（schema 验证 + 与全量输出对比 + 范围过滤断言）

### 新增（P78 脚手架噪音过滤 — 路线 B）

- **脚手架指纹检测** `src/tools/scaffold-detector.js` `src/tools/honesty-engine.js` `src/services/dep-graph.js` `src/cli/formatters/recommendation-engine.js` `src/cli/formatters/repo-summary.js` — 解决 RuoYi/Vue Admin 等常见脚手架在多个项目间产生 30+ 相同 dead-export 噪音的问题：
  - `scaffold-detector.js`：保守策略，两层匹配：① `exactBasenames`（高度特异的文件名，如 `AbstractQuartzJob.java`、`SysUser.java`、`ruoyi.js`）② `pathPatterns`（通用文件名如 `StringUtils.java` 仅在路径含 `ruoyi` 等标记时才匹配）。避免误标非脚手架项目。
  - `honesty-engine.js`：`classifyDeadExports` 集成 `detectScaffold()`，命中则 reason = `scaffold-ruoyi` / `scaffold-vue-admin`，纳入 `falsePositiveReasons`。
  - `dep-graph.js`：`findDeadExports` 返回记录新增 `scaffold` 字段（含 `name`/`reason`/`description`）。
  - `recommendation-engine.js`：`buildDeadExportRecommendation` 识别 `scaffold-*` primaryReason，文案提示 "known scaffolding boilerplate (RuoYi / Vue Admin)"。
  - `repo-summary.js`：`honesty.deadExports` 新增 `scaffoldDeadExports` 计数。
  - 测试：`test/scaffold-detector-test.js`（7 测试，覆盖 exact-basename / path-pattern / non-scaffold / null）+ `test/honesty-engine-test.js` 补充 4 测试 + `test/recommendation-engine-test.js` 补充 1 测试。

### 修复（实战检测发现 — L2-3/L2-5/L3-1/L3-2）

- **L2-3: `workspace-info` 语言检测遗漏 Python 文件** `src/utils/path.js` `src/services/dep-graph/parsers/registry.js` `src/tools/workspace-tools.js` — `detectWorkspace` 新增 `_hasPythonFiles(root)`：扫描根目录及一层子目录中的 `.py` 文件，与 Java 的 `_hasJavaInSubdirs` 保持一致。`registry.js` 的 Python `condition` 增加 `workspace.hasPythonFiles`，`workspaceInfo` 的 `detected.python` 同步更新。Node.js 项目中的 Python 辅助脚本（如 `scripts/*.py`）现被正确索引和统计
- **L2-5: `--exclude` 不支持 glob 模式** `src/services/file-index.js` `src/services/dep-graph.js` `cli.js` — `shouldExcludeCli` 新增简单 glob 支持：pattern 含 `*` 或 `?` 时转为正则，先匹配 basename、再匹配完整路径。`cli.js` `--help` 文案同步更新为 "simple globs (*.ext)"。`*.sql` / `*.py` 等扩展名排除现已生效
- **L3-1: `dead-exports` barrel / internal-use 模式误报** `src/services/dep-graph.js` — 新增 `_scanLocalSymbolUsage(filePath, symbols)`：逐行扫描源文件内容，检测模块内部的函数调用（`symbol(`）和属性访问（`symbol.`），跳过 `export` / `function` 声明行。`findDeadExports` 在 importer 扫描后追加本地使用扫描，消除 "导出符号仅被同模块内部使用" 的误报。自身项目 dead exports 15→5（-10 误报消除）
- **L3-2: `audit-overview` 耦合建议模板化严重** `src/tools/overview-tools.js` — `generateCouplingSplitPlan` 默认分支按耦合形状差异化：
  - `inDegree > outDegree * 2` → 核心服务拆分建议
  - `outDegree > inDegree * 2` → facade / 防腐层建议
  - `inDegree >= 3 && outDegree >= 3` → 双向耦合 / 读写分离建议
  - 其他 → 保留原 facade + 接口层建议

### 修复（数据一致性与分类完整性 — P17/P36/P47）

- **P17: `stability` 数组截断不透明，`aggregates` 与展示数据不一致** `src/tools/overview-tools.js` — `buildStability` 移除 `STABILITY_CANDIDATE_LIMIT` 截断，处理全部主线文件；`buildProjectOverview` 返回值新增 `stabilityMeta`（`totalCount`/`truncated`/`limit`），让用户明确知道还有多少文件未展示。同时统一 `mainlineFiles` 过滤逻辑，排除 test/docs/style/asset，与 `summarizeFiles` 的 `isTrulyMainline` 对齐
- **P36: `fileRoles` 缺少 `docs`、`style`、`asset` 角色，分类体系不完整** `src/utils/project-context.js` — `ROLE_RULES` 新增 `style`（`.css`/`.scss`/`.sass`/`.less`/`.stylus`）和 `asset`（图片/字体/媒体/压缩包）规则；`summarizeFiles` 的 `fileRoles` 初始化增加 `docs: 0, style: 0, asset: 0`，消除潜在的 `NaN` 风险；`isTrulyMainline` 同步排除 style/asset
- **P47: `scope.counts` 与 `stats` 命令完全没有代码量统计** `src/services/cache.js` `src/services/dep-graph.js` `src/tools/workspace-tools.js` — `cache.getStats()` 遍历 `fileMetadata` 累加 `lineCount`；`depGraph.getStats()` 透传 `totalLines`；`workspaceInfo` 输出新增 `totalLines`。`stats` 命令和 `workspace-info` 现已包含总行数

### 修复（核心功能可信度 — P42/P56/P51）

- **P42/P56: `deadExports.confidence` 分级逻辑不透明，90% 文件统一为 medium** `src/services/dep-graph.js` — 新增 `computeDeadExportConfidence()` 纯函数，按 `parseMode + graph reliability` 分级（importerCount 不参与降级，因为它衡量的是**文件**级引用而非**导出**级引用）：
  - `high`: 无 importer 且 graph 可靠
  - `medium`: AST 解析且存在 importer → AST 精确追踪符号使用，可信度中等
  - `low`: regex 解析、或 graph 稀疏 → regex 无法精确追踪符号，假阳性风险高
    每个 dead-export 条目新增 `confidenceReason` 字段，输出人类可读的解释。彻底消除黑盒分级
- **P51: 命令输出"零问题"组合形成系统性虚假安全感** `src/services/dep-graph.js` `src/cli/formatters/repo-summary.js` `src/tools/overview-tools.js` `cli.js` — `depGraph.getStats()` 新增 `analysisCoverage`（`totalFiles`/`parsedFiles`/`fallbackFiles`/`coverageRatio`）。`audit-summary` 和 `audit-overview` 输出均包含此字段。当 `coverageRatio < 0.5` 时，`summary.severity` 强制上浮为 `high`，并追加 `coverageWarning` 提示用户"findings may be incomplete"

### 修复（结果可信性 — P86/P87/P91）

- **P91: `audit-summary` / `audit-overview` orphans 聚合与明细不一致** `src/tools/overview-tools.js` — `buildOverviewSummary` 的 `orphanCount` 从 `Object.values(orphans).flat().length` 修复为 `orphans.all.length`。原代码把 `all`（已含全部孤儿）与各分类数组（docs/scripts/configs/modules）再次累加，造成重复计数（如 `ai_gwy_backend` 聚合报 4 但明细仅 2）
- **P87: `importerCount>0` 的 dead-export 解释模板化** `src/services/dep-graph.js` `src/config/constants.js` — `computeDeadExportConfidence` 按 `importerCount` 差异化 `confidenceReason`：
  - `importerCount >= 10` → "File has N importers, but these specific exports are not referenced by any importer"
  - `importerCount >= 3` → "File has N importers; unused exports may be internal helpers or barrel re-exports"
  - `importerCount < 3` → 保留原 "AST-level analysis found unused exports..."
    阈值常量 `DEAD_EXPORT.IMPORTER_COUNT_HIGH` / `IMPORTER_COUNT_MEDIUM` 进 `constants.js`。彻底消除 "importerCount=18 仍返回同一句话" 的模板化问题
- **P86: `vue-page-implicit` 等误报仅计数、未归因到具体文件** `src/tools/honesty-engine.js` — `classifyDeadExports` 在返回分类前给单条 dead-export 记录注入 `falsePositiveReason` 字段（如 `vue-page-implicit` / `java-constants-warehouse` / `scaffold-ruoyi` / `uncertain`）。`dead-exports` 命令 JSON 输出中的每条记录现可直接查看其 fp 标签，用户无需在聚合层和明细层之间来回比对

### 修复（Windows 平台硬化 + 配置一致性 — P89/P90）

- **P89: Windows 路径大小写被强制归一化** `src/utils/path.js` `src/services/dep-graph.js` `src/tools/dep-tools.js` `src/cli/repl.js` `src/tools/workspace-tools.js` `src/tools/security-tools.js` `src/cli/formatters/project-map.js` `src/tools/overview-tools.js` — 解决 Windows 上 `normalizePathKey()` 的 `toLocaleLowerCase('en-US')` 导致 JSON 输出路径丢失原始大小写的问题（如 `filePreview.js` → `filepreview.js`）：
  - `path.js` 新增 `toDisplayPath()` — 仅 POSIX 斜杠转换，保留原始大小写，用于外部输出
  - `GraphBuilder.analyzeFile()` 在 graph value 中存储 `originalPath`（原始绝对路径）
  - `DependencyGraph` 新增 `_displayPath(graphKey)` — 将内部 graph key 映射回原始路径
  - 所有输出方法统一转换：`findDeadExports`/`findUnresolvedImports`/`findCircularDependencies`/`getImpactRadius`/`findAffectedTests`/`getDependencies`/`getDependents` 返回的路径、CLI 命令 JSON、REPL `top`、formatters、security findings 全部使用 `_displayPath`
  - 防御性设计：所有调用点使用 `_displayPath?.(k) || k`，兼容测试 mock 对象
- **P90: `.workspace-bridge.json` 配置状态不对称** `src/utils/project-context.js` — 空配置文件（仅含 `$schema` 或 `{}`）与无配置文件的 `hasWorkspaceBridgeConfig` 标记不同（`true` vs `false`），导致处理路径分叉：
  - 新增 `hasEffectiveConfig(config)` — 排除 `$schema` 后检查是否有任何有效配置键
  - `summarizeFiles()` 中 `hasWorkspaceBridgeConfig` 改为 `pathExists(configPath) && hasEffectiveConfig(this.config)`
  - 空配置/纯 schema 配置现在与无配置行为完全一致

### 测试

- `test/dead-export-confidence-test.js` — 更新 `testManyImportersAst` 断言以反映 P87 差异化文案；新增 `testVeryManyImportersAst` 覆盖 `importerCount >= 10` 分支
- `test/honesty-engine-test.js` — 新增 `testClassifyDeadExports_falsePositiveReasonSinked` 验证 P86：`classifyDeadExports` 调用后单条记录自带 `falsePositiveReason`

### 性能

- **`file-index.js` `content.split('\n')` 内存峰值** `src/services/file-index.js` — 行数统计从 `content.split('\n').length` 改为 `(content.match(/\n/g)?.length || 0) + 1`，消除大文件临时数组内存峰值（1MB 文件 ~20MB → ~0MB）

### 测试

- `test/dead-export-confidence-test.js` — 覆盖 `computeDeadExportConfidence` 全部分支：无 importer 可靠/不可靠、AST 少 importer、AST 多 importer、regex 模式
- `test/analysis-coverage-test.js` — 覆盖 `getStats().analysisCoverage`：全 AST、混合 regex、空图

### 新增（Schema 冻结基础设施）

- **全局 `schemaVersion` 字段** `cli.js` — 定义 `SCHEMA_VERSION = '1.1.1'`，所有 JSON 输出（含 `init` 命令）自动注入 `schemaVersion`。核心字段 `{ ok, error, severity, summary }` 语义冻结：在 `schemaVersion` 不变时，这些字段的类型和含义绝不改变

### 新增（Parser 契约完整性 — Rust/Kotlin AST）

- **`rust-ast.js` 补 `imported` 提取** — `import.source`（`use std::io::Read` → `imported: ['Read']`）、`import.use_list`（`use std::io::{Read, Write}` → 每条 path 的末段符号）、`import.use_as`（`use crate::utils::Helper as MyHelper` → `imported: ['MyHelper']`）。此前 Rust AST 的 `imported` 始终为 `[]`
- **`kotlin-ast.js` 补 `imported` 提取** — 非 wildcard import（`import java.io.File` → `imported: ['File']`）。此前 Kotlin AST 的 `imported` 始终为 `[]`

### 新增（Impact 诚实度标注）

- **`importedSymbolsAvailable` 布尔字段** `src/services/dep-graph.js` — `getImpactRadius` 的每条 impact 记录新增 `importedSymbolsAvailable`。当 `matchingImports.length > 0 && matchingImports.some(r => r.imported.length > 0)` 时为 `true`，否则为 `false`。解决 AI 无法区分"使用了整包"与"parser 没提取符号"的歧义

### 测试

- `test/rust-ast-parser-test.js` — 新增 4 条 `imported` 提取断言：HashMap/`self`（use_list）/Read（use_list）/MyHelper（use_as）
- `test/kotlin-ast-parser-test.js` — 新增 3 条 `imported` 提取断言：File（普通 import）/wildcard（空数组）/delay（函数 import）

### 修复（Schema 一致性 — 冻结后修复）

- **`schemaVersion` 类型不一致：CLI 注入字符串 `'1.1.1'`，但 `audit-overview` 内部返回数字 `1`** `cli.js` `src/tools/overview-tools.js` `test/functionality-test.js` `test/overview-tools-test.js` — 全仓库统一为字符串 `'1.1.1'`（semver 风格）。此前 `overview-tools.js` 的 `hotspotData` / `stabilityTrend` 返回 `schemaVersion: 1`（number），与 CLI 的 `schemaVersion: '1.1.1'`（string）冲突，会导致 AI 解析器 `typeof` 检查失败

### 新增（P8-2 validationAdvice 可执行契约）

- **`commands` 数组新增 `executable` 结构化字段** `src/utils/stack-detectors/commands.js` `src/cli/formatters/validation-advice.js` — 所有 validationAdvice 命令条目从 `{name, description, cmd}` 扩展为 `{name, description, cmd, executable}`，其中 `executable` 包含：
  - `command`: 可执行文件名（如 `"npm"`、`"go"`、`"cargo"`）
  - `args`: 参数数组（如 `["run", "test"]`）
  - `cwd`: 工作目录（从 `cd <dir> && ` 前缀中提取，为 `null` 时在当前目录执行）
  - `shell`: 若命令含管道/重定向等 shell 运算符，保留原始字符串供 shell 执行；否则为 `null`
  - `expectedExitCode: 0` / `onFailure: 'abort'` — 供自动化流水线消费
  - 向后兼容：`cmd` 字符串完全保留，现有消费者无需改动
- **`parseCommandString` 尽力而为解析器** `src/utils/stack-detectors/commands.js` — 提取 `cd` 前缀、检测 shell 运算符、拆分参数。不追求 100% 精确（引号内空格未处理），但覆盖 95% 以上的真实验证命令

### 修复（测试稳定性 — watch-test.js flaky）

- **固定 `delay(2500)` 替换为轮询** `test/watch-test.js` — 创建触发文件后，轮询检查 stdout（最长 15s），消除 fs.watch 平台时序差异导致的偶发失败
- **独立临时目录隔离** `test/watch-test.js` — 触发文件从 repo root（`watch-test-temp-file.js`）迁移到 `test/.watch-temp/trigger.js`，避免测试崩溃时污染工作区，也不与 git tracked 文件冲突
- **新增 SIGINT 优雅退出覆盖** `test/watch-test.js` — 启动 watch 进程后发送 `SIGINT`，验证进程在 5s 内退出（Windows 上接受 `code === 0 || code === null` 以兼容平台差异）

### 新增（P8-1 watch 闭环）

- **`watch --run-tests`** `cli.js` `src/cli/watch.js` — 文件保存后自动执行 affected-tests 验证闭环：
  - `buildWatchValidationCommands`：利用 `depGraph.findAffectedTests` + `generateCommands`（`run-direct-tests` steps）生成可执行的 focused 测试命令
  - `executeWatchCommand`：spawn 执行单个 `executable` 结构化命令，支持 `cwd` / `shell` / `expectedExitCode` / 60s 超时 kill
  - `runWatchValidation`：顺序执行命令链，任何命令失败立即停止，输出 JSON Lines 事件流（`validationStart` / `commandStart` / `commandResult` / `validationComplete`）
  - 失败时 `commandResult` 包含完整 stdout/stderr；成功时省略以控制体积
  - 向后兼容：不加 `--run-tests` 时 watch 行为 100% 不变
- **`--run-tests` 测试覆盖** `test/watch-test.js` — 验证 `--run-tests` 启动后 stderr 提示 auto-run 模式，文件变更后 stdout 出现 `validationStart` + `validationComplete` JSON Lines 事件

### 路线 A 终点声明

- **P24** `impact` source 文件出现在自己的影响列表 — 代码已有 `level === 0 || file === start` guard，当前代码无法复现，标记为 **cannot-reproduce**
- **P30** `unresolved` 的 `resolvedTo` 语义 — 冻结为：`resolvedTo: null` = "该 import 未能解析到磁盘上的文件"，不改 schema，不在输出中增加新字段
- **P43** `health.checks.ci` 未检测到 `.github/workflows` — 当前代码已升级为递归扫描 `.yml`/`.yaml`，当前代码无法复现，标记为 **cannot-reproduce**

### 清理（Dogfooding — 删除真实死代码）

- **`getContainer` 全局单例无人使用** `src/services/container.js` — 删除 `getContainer()` 函数及导出。`cli.js` 直接 `new ServiceContainer()`，该单例工厂自始无调用方
- **`search-tools.js` 为 MCP 转型残留** `src/tools/search-tools.js` `test/search-redos-test.js` — 提交 `afe8f47`（"Refocus workspace-bridge on CLI audits"）删除了 `src/tool-registry.js`（MCP 工具注册表），`searchCode` 失去唯一调用方。现删除整个模块及专属测试。`test/security-test.js` 中 `validateQuery` 依赖内联为本地辅助函数，保留 ReDoS 安全概念测试

### 修复（UX — P35 compact tree 目录层级）

- **`audit-map --compact` 的 `tree` 只展示一层目录，用户误以为文件平铺** `src/cli/formatters/project-map.js` `test/audit-map-test.js` — `buildDirectorySkeleton` 的 `maxDepth` 从 2 提升到 3，保留到第 3 层目录（如 `src/views/policyeval`），第 4 层+ 继续折叠为 `fileCount`/`totalFileCount`。实测 GitNexus（1000+ 文件）：total directories 18→47，tree JSON lines 149→386，仍在 compact 可控范围内；`testProjectMapCompactDepthLimit` 同步更新断言以反映新层级行为

### 修复（文档 — P50 Fast/Slow 分类校准）

- **SKILL.md 的 Fast/Slow 分类与实际耗时脱节** `skills/workspace-audit/SKILL.md` — 基于 workspace-bridge（159 文件）实测缓存后耗时重新分类：
  - **Fast** (< 2s): 新增 `workspace-info`, `audit-map`, `stats`, `diagnostics`；移除错误归入的 `audit-overview`, `audit-diff`
  - **Medium** (2-5s): 新增 `audit-diff`（`git log --follow` + 变更分析）, `audit-overview`（`git log` 历史查询 + 热点计算）
  - 新增冷启动说明：首次运行任何命令都有索引构建成本（大项目 5-30s），与具体命令无关
  - 澄清 `diagnostics` 不是 network-bound，执行的是本地 linter（eslint/tsc/pyright/ruff），无网络请求

### 修复（实战基地系统性盲区 — Spring Boot / Vue 循环白名单）

- **Spring Boot 框架模式识别** `src/services/dep-graph/framework-patterns.js` `src/services/dep-graph.js` `src/config/constants.js` — 解决后端 3 个仓库 467 个 dead exports 中高 confidence 条目几乎全部是 Spring Boot 类被误标的问题：
  - `detectFrameworkFromPath` 增加 `*Application.java` 和 `*ServletInitializer.java` 路径检测（`===` → `endsWith` 修复 `XxxServletInitializer` 不匹配）
  - `AST_PATTERNS.java` 增加 `@SpringBootApplication`、 `@Configuration`、 `@ControllerAdvice`、 `@Component`、 `@Service`、 `@Repository`、 `@EnableAutoConfiguration`、 `@Aspect` content 检测
  - `isKnownEntryFile` 复用已有的文件读取代码做 `detectFrameworkFromContent` 检测，消除与 `getFrameworkHint` 的 I/O 重复
  - `ENTRY_SCAN_BYTES: 256 → 4096`，覆盖 import 繁多的大型 Java 文件（实测 `@Service` 在 1547 字节、`@Aspect` 在 1569 字节）
  - `detectFrameworkFromContent` 内部 `content.slice(0, 800)` → `slice(0, 4096)`，消除与 `ENTRY_SCAN_BYTES` 的隐性不一致
  - **实战效果**：zcypg_backend 205→134（-35%），zsgzt_backend 207→112（-46%），合计 412→246（-166 个误报消除）
- **Vue Router/Vuex 循环白名单** `src/services/dep-graph.js` — 新增 `isLikelyFrameworkLegitimateCycle` 方法，过滤掉 Vue 项目中 `store/` ↔ `router/` ↔ `views/`（含 `.vue`）的短循环（长度 ≤ 5）。这些循环是 Vue 正常设计模式（store 引用 router 跳转、router 引用 view 组件、view 引用 store 状态），不应被报告为缺陷
  - **实战效果**：zcypg_frontend 13→3，zsgzt_frontend 19→2
- **Python AST parser Windows 编码故障** `src/services/dep-graph/parsers/spawn-ast.js` — `spawnPythonASTParser` 的 `spawn` 调用新增 `env: { ...process.env, PYTHONIOENCODING: 'utf-8' }`。Windows 上 Python 子进程默认以系统编码（GBK/CP936）读取 stdin，但 Node.js 写入的是 UTF-8，导致包含中文注释/字符串的 `.py` 文件产生 surrogate 解码错误，全部 fallback 到 regex。修复后 gwy_backend 覆盖率 0.21→1.00（347/347 AST），Java parser 同步受益
- **P5: `nextSteps` 模板化、不可执行** `src/utils/stack-detectors/detect.js` `src/cli/formatters/repo-summary.js` `cli.js` — 新增 `detectNodeFramework()` 读取 package.json 的 dependencies/devDependencies，检测 Vue/React/Next/Nuxt/Svelte/Angular。`buildNextSteps` 接入框架级信息，生成差异化可执行建议：
  - Vue: cycle 建议明确提及 store→router→view 是正常设计模式；unresolved 建议指向 vite.config.js alias 和 `.vue` 扩展名
  - Java: hygiene 建议提及 Maven/Gradle wrapper 和 JUnit
  - Python: hygiene 建议区分 Django 和非 Django 的测试配置
  - 所有建议结合具体数据（"3 dependency cycles", "12 dead exports", "4 hygiene gaps"）而非泛泛的 "Break dependency cycles"
  - 实战效果：zcypg_frontend 和 zsgzt_frontend 的 cycle 建议从完全相同的模板变为 Vue 特异性文案
- **P27: SKILL.md Standard Output Contract 与实际 CLI 输出脱节** `skills/workspace-audit/SKILL.md` — 逐命令对比实际 JSON 输出，修正 6 处字段路径错误：
  - `workspace-info`: `scope.totalFiles` → `fileCount`（根级，无 `scope`）; `scope.languages` → `languages`
  - `diagnostics`: `diagnostics.totalIssues` → `diagnosticsSummary.total`; `diagnostics.byFile` → `results[].diagnostics`; 补充 `noLintersDetected` 场景说明
  - `audit-security`: `summary.totalFindings` → `summary.total`
  - `audit-summary`: `scope.mainlineFiles` → `scope.counts.mainlineFiles`; 新增 `analysisCoverage` 读取说明
  - `audit-diff`: `validationAdvice.phases` 补充 "可能为空数组" 说明
  - `audit-overview`: 新增 `stabilityMeta` 和 `analysisCoverage` 读取说明
  - 新增缺失命令的读取说明：`health`（`healthScore`/`checks`/`fixes`/`testCoverage`）、`stats`（`analysisCoverage`）、`dead-exports`/`unresolved`/`cycles`（`confidenceReason`/`possibleFalsePositives`）、`impact`/`dependents`/`dependencies`（`importedSymbolsAvailable`/`symbolImpact`）
  - 新增 `schemaVersion` 契约冻结说明

### 修复（产品体验 — P33/P62 overview recommendations 个性化）

- **P33: 两个前端项目 `audit-overview` recommendations 高度模板化** `src/tools/overview-tools.js` `src/cli/formatters/recommendation-engine.js` — 新建 `recommendation-engine.js`，提取 `buildUnresolvedRecommendation` / `buildCycleRecommendation` / `buildDeadExportRecommendation` 三个纯函数，消除 `repo-summary.js` `buildNextSteps` 与 `overview-tools.js` `buildOverviewSummary` 之间的重复 if-else 链。`audit-overview` 现在接入假阳性率（`possibleFalsePositives`）和框架检测（`stack.node.framework`），为 Vue 项目提示 alias/`.vue` 扩展名问题，为 Java 项目提示 Spring Boot 误报，为 cycle 提示 store→router→view 是正常设计模式
- **P62: 两个前端项目症状高度一致（overview 层面）** `src/tools/overview-tools.js` — 同 P33，`audit-overview` 的 `recommendations` 与 `audit-summary` 的 `nextSteps` 共享同等的个性化水平，两个 Vue 前端项目的输出不再完全相同

### 测试

- `test/framework-patterns-test.js` — 覆盖 Spring Boot 路径检测（Application/ServletInitializer）和 content 检测（SpringBootApplication/Configuration/ControllerAdvice）
- `test/dep-graph-error-test.js` — 覆盖 Spring Boot entry 排除 dead-export 逻辑，以及 Vue store-router-view 循环白名单过滤逻辑
- `test/recommendation-engine-test.js` — 覆盖 `buildUnresolvedRecommendation` / `buildCycleRecommendation` / `buildDeadExportRecommendation` 全部分支：count=0/null、通用文案、Vue alias、非 Vue alias、Vue cycle、通用 cycle、Vue dead-export fp、Java dead-export fp、其他 dead-export fp、fp 低于阈值

### 修复（Schema 一致性 — P57 字段命名统一）

- **P57: 字段命名风格不统一，增加集成成本** `cli.js` `src/tools/dep-tools.js` `src/cli/formatters/*` `src/services/dep-graph/*` `src/config/risk-thresholds.js` `test/*` — 统一各命令顶层计数字段为"数组名 + Count"规范：
  - `dependencyCount` → `dependenciesCount`
  - `dependentCount` → `dependentsCount`
  - `cycleCount` → `cyclesCount`
  - `deadExportCount` → `deadExportsCount`
  - `affectedTestCount` → `affectedTestsCount`
  - `impactCount` / `unresolvedCount` 保持不变（数组名本身为单数/不可数）
- **Schema 升级**：`SCHEMA_VERSION` `'1.1.1'` → `'1.2.0'`，核心字段语义不变，计数字段命名规范化
- **`scripts/self-audit.js`** 修复 `summary.counts` 读取错误（`deadExportCount` → `deadExports`、`unresolvedCount` → `unresolved`、`cycleCount` → `cycles`）

### 文档

- **TECH_DEBT.md** 已修复条目全部压缩为"标题 + 一行 ✅ 已修复 说明"，执行 AGENTS.md 清理铁律；P33/P62/P57 标记已修复
- **SESSION.md** 基线同步为 85/85 PASS；P57 关闭，`schemaVersion` 更新为 `1.2.0`
- **CHANGELOG.md** 追加 [Unreleased] 条目

### 新增（Django 框架模式识别）

- **`framework-patterns.js` 路径检测** `src/services/dep-graph/framework-patterns.js` — 新增 Django 特有路径模式：
  - `management/commands/*.py` → `django-management-command`，`isEntry: true`
  - `views/*.py`（目录形式，非 `__init__.py`）→ `django-views-dir`，`isEntry: true`
  - `views_*.py`（前缀形式，如 `views_coordination.py`）→ `django-views-prefix`，`isEntry: true`
  - `admin.py` → `django-admin`，`isEntry: true`
  - `tasks.py` → `django-tasks`（Celery），`isEntry: true`
- **`AST_PATTERNS.py` 内容检测** `src/services/dep-graph/framework-patterns.js` — 新增 Django/Celery 内容特征：`BaseCommand` / `class Command(`（管理命令）、`admin.site.register`（admin）、`@shared_task` / `@app.task`（Celery）
- **`dep-graph.js` `FRAMEWORK_MANAGED_PATTERNS`** `src/services/dep-graph.js` — 新增 `/management\/commands\/.*\.py$/` 和 `/tasks\.py$/`，确保 `isKnownEntryFile` 第一道防线覆盖
- **实战效果**：`ai_gwy_backend` dead exports 74→54（-20 误报消除），与 Spring Boot 同等水平
- **测试**：`test/framework-patterns-test.js` 新增 Django 路径/内容检测断言；`test/dep-graph-error-test.js` 新增 `testDjangoEntryDetection` 验证管理命令/视图/admin/tasks 不出现在 dead exports 中

### 修复（实战检测闭环 — L1/L2/L3 全命令检验）

- **L1-1: `impact` / `affected-tests` / `dependencies` / `dependents` 对不存在的文件返回 `ok: true`** `cli.js` — `runCommand` 的 4 个文件级命令分支中新增 `fs.existsSync` 前置检查，与 `audit-file` 保持一致。此前不存在的文件落入图查询返回空数组，导致自动化脚本无法区分"文件确实无影响"和"文件不存在"
- **L1-2: `init` 命令失败时退出码为 `0`** `cli.js` — `init` case 中当配置文件已存在时，返回前显式设置 `process.exitCode = 1`。此前 `init` 是 `SELF_MANAGED_COMMANDS`，`__managedLifecycle` 为 true 时绕过了 `main()` 的错误处理路径
- **L1-3: `audit-summary` 的 `analysisCoverage` 与 `--exclude` 不同步** `cli.js` — `audit-summary` 命令中基于 `scope.counts.totalFiles` 重新计算 `filteredAnalysisCoverage`，替代 `stats.analysisCoverage` 的全量统计。此前 `scope.counts.totalFiles = 74`（排除 test+benchmark）但 `analysisCoverage.totalFiles = 161`
- **L1-4: `audit-diff` 变更文件计数不一致** `cli.js` — `changeMetrics` 新增 `untrackedFileCount: changed.changedFiles.length - numstat.files.length`。`changedFiles` 包含 untracked，而 `changeMetrics` 来自 `numstat.files`（仅 tracked），新增字段明确区分两者口径
- **L1-5: `audit-diff` 出现 `undefined authors, undefined commits`** `src/cli/formatters/audit-diff-summary.js` `src/cli/formatters/validation-advice/metrics.js` — `compactChangedFile` 保留 `historyRisk.authorCount` 和 `historyRisk.commitCount`（此前被精简丢弃）；`metrics.js` 的 `buildTurbulenceNotes` 对缺失字段做 `?? 'unknown'` 兜底
- **L2-1: Windows 反斜杠路径在输出中残留** `cli.js` — `parseCliArgs` 中对 `raw.file` 做 `toPosixPath` 标准化。此前 `--file .\src\services\dep-graph.js` 返回 `".\\src\\services\\dep-graph.js"`，下游路径匹配可能失败
- **L2-2: REPL 在非交互环境下无明确错误即退出** `src/cli/repl.js` — `startRepl` 开头检测 `process.stdin.isTTY`，若非 TTY 则输出 `Error: REPL requires an interactive terminal (TTY).` 并设置 `process.exitCode = 1`
- **L2-4: `audit-security` builtin 扫描器对工具自身代码误报** `src/tools/security-tools.js` — 每行匹配后检查 `ignorePattern`（`/\/\/\s*security-scan-ignore\b|\/\*\s*security-scan-ignore\b/`），允许开发者用行尾注释显式抑制已知无害的命中。`security-tools.js` 的 7 条 pattern 定义行均加上 `// security-scan-ignore`
- **L3-3: `audit-file` 的 `--max-depth abc` 被静默忽略** `cli.js` — `parseCliArgs` 的 `--max-depth` transform 中增加 `Number.isNaN(n)` 检测，传入非数字字符串时立即抛出 `Invalid --max-depth value` 错误

### 测试

- `test/init-test.js` — 更新断言：`dup.status` 从 `0` → `1`，验证 `init` 重复运行时退出码正确反映失败状态
- `test/repl-shutdown-test.js` — 测试前临时设置 `process.stdin.isTTY = true`，绕过新增的 TTY 检测以继续验证 REPL shutdown 守卫逻辑

### 文档

- **TECH_DEBT.md** 全命令实战检测报告更新：L1-1~L1-5/L2-1/L2-2/L2-4/L3-3 标记已修复并删除；L1-6 澄清为测试样本选择导致的假阳性（Java 依赖图实际工作正常）；更新命令覆盖矩阵和修复优先级建议

### 修复（路线 A：数据一致性 + 框架边界硬化 — P85/P70/P71/P79/P80/P81/P72/P73）

- **P85: `audit-summary` vs `cycles` 数据不一致（L1）** `src/services/dep-graph.js` — 统一 cycle 计算路径：新增 `_cachedCycles` 缓存过滤后的完整 cycles 数组，`findCircularDependencies()` 优先返回缓存，`getStats()` 直接复用同一数组计算 `cycles.length`。`GraphBuilder` 在 `build()` / `updateFiles()` / `applyFrameworkImplicitImports()` 三处图变更点均重置缓存，彻底消除 `_cycleCount` 延迟计算与图生命周期耦合导致的 stale 数据风险
- **P70: Spring Boot `*Application.java` 在 `audit-summary` 中 `entryFiles` 缺失** `src/utils/project-context.js` — `ROLE_RULES` entry 检测新增 `application.*.java` 和 `*ServletInitializer.java` 路径模式，`inferFileRole()` 现与 `framework-patterns.js` 的 `detectFrameworkFromPath()` 对齐，Spring Boot 入口在 summary 层面不再遗漏
- **P71: Django 配置驱动入口覆盖不全** `src/services/dep-graph.js` `src/services/dep-graph/framework-patterns.js` — 扩展 `FRAMEWORK_MANAGED_PATTERNS` 和 `detectFrameworkFromPath()` / `AST_PATTERNS.py`，新增 middleware（`middleware.py` / `*middleware*.py`）、database router（`database_router.py` / `*router*.py`）、context processors（`context_processors.py`）、templatetags（`templatetags/*.py`）、forms（`forms.py`）、Celery 配置（`celery.py`）六类 Django 配置驱动入口，消除 Django 项目 dead-export 误报
- **P79/P80/P81: Spring/Quartz/MyBatis 组件 dead-export 系统性误报** `src/services/dep-graph/framework-patterns.js` — 新增运行时装配组件的路径 + 内容检测：
  - Spring: `Filter` / `Wrapper` / `Validator` / `Serializer` / `Interceptor` / `Listener`（路径含关键字或内容含 `@Component` / `implements Filter` / `FilterRegistrationBean` 等）
  - Quartz: `/quartz/` 路径 + `org.quartz.Job` / `@DisallowConcurrentExecution` / `extends AbstractQuartzJob` / `JobInvokeUtil`
  - MyBatis: `/typehandler/` 路径 + `implements TypeHandler` / `extends BaseTypeHandler`
    这些组件通过框架容器运行时装配，静态 import 分析无法追踪，现统一标记为 `isEntry: true`，`isKnownEntryFile()` 自动保护
- **P72: Java 常量类死导出系统性误报** `src/services/dep-graph.js` `src/tools/honesty-engine.js` — 新增 `isLikelyConstantsWarehouse()` 识别常量仓库模式（文件名以 `Constants` / `Status` / `Utils` 结尾 + 导出以 field/variable 为主），`findDeadExports()` 对匹配文件降级 confidence 为 `low` 并输出差异化 reason；`honesty-engine.js` 新增 `java-constants-warehouse` 假阳性原因，纳入 `falsePositiveReasons` 统计
- **P73: Java / React 循环依赖无白名单** `src/services/dep-graph.js` — `isLikelyFrameworkLegitimateCycle()` 从仅覆盖 Vue 扩展为三框架公平检测：
  - Vue: `store/` ↔ `router/` ↔ `view/`（保留）
  - React: `context/` ↔ `hooks/` ↔ `components/`（长度 ≤ 4，涉及至少两个维度）
  - Java: `domain/model/entity` ↔ `utils/util/common`（长度 ≤ 3，涉及领域模型和工具类两个维度）

### 重构（P8-0：dep-graph.js God Class 内部分拆）

- **`src/services/dep-graph.js`** — 对外接口 100% 不变，内部拆为三个 collaborator，`DependencyGraph` 退化为 facade：
  - `GraphBuilder` — `build()` / `updateFiles()` / `analyzeFile()` / `buildReverseGraph()` / `applyFrameworkImplicitImports()`
  - `GraphAnalyzer` — `findDeadExports()` / `findCircularDependencies()` / `findUnresolvedImports()` / `findAffectedTests()` / `getStats()` / `getScopeSummary()`
  - `GraphQuery` — `getDependencies()` / `getDependents()` / `getImpactRadius()`
- **P8-1 插槽预留**：`GraphBuilder.onBuildComplete` / `GraphBuilder.onFileUpdated`，供 watch 闭环使用
- **验证**：85/85 测试通过，healthScore=5/5，零外部调用方改动

### 修复（工程健康 — 路线 D：P74/P75/P76/P82）

- **P74: `_scanLocalSymbolUsage` 内存峰值** `src/services/dep-graph.js` — `content.split('\n')` 改为流式扫描（`indexOf('\n')` + `slice` 循环），消除大文件（1MB+）dead-export 分析时的 ~20MB 临时数组。行为与 `file-index.js` v1.1.0 的同类修复一致
- **P75: `framework-usage-patterns.js` 无缓存 I/O** `src/services/dep-graph/framework-usage-patterns.js` `src/services/dep-graph/resolvers.js` — `resolveImplicitImports` 的 `fs.existsSync` 替换为 `cachedExistsSync`（LRU 缓存，上限 2000）。`resolvers.js` 导出 `cachedExistsSync` 供外部复用
- **P76: `watch.js` stdout 拼接无上限** `src/cli/watch.js` `src/config/constants.js` — `executeWatchCommand` 新增 `WATCH_MAX_STDOUT_BYTES = 1MB` 上限，超限截断并标记 `truncated: true`。`commandResult` 事件透传 `truncated` 字段，防止测试框架海量日志导致 OOM
- **P82: Maven 项目 `testFiles: 0`** `src/utils/test-detector.js` — 扩展 `TEST_DETECTION_RULES` 对 Java 测试命名的覆盖：新增 `/.*(?:Test|Tests|IT)\.java$/i` 规则，明确匹配 Maven 常见的 `*Test.java` / `*Tests.java` / `*IT.java` 命名。补测试到 `test/test-detector-test.js`

### 测试（测试覆盖缺口补齐 — 阶段 4）

> 目标：消除 TECH_DEBT.md 中列出的所有"无直接测试"和"可深化"模块缺口。纯新增测试，零生产代码改动。

- **新增 `test/symbol-extractors-test.js`** `src/services/file-index/symbol-extractors.js` — 直接覆盖此前仅被 file-index 集成测试间接覆盖的 6 语言符号提取器：

  - Python（class/function）、JS/TS/JSX/TSX（class/function/constant）、Java（class/interface/enum/method）、Kotlin（class/interface/object/enum/function）、Go（type/function）、Rust（fn/struct）
  - 边界：未知扩展名返回空数组、空内容返回空数组、1-based 行号、trim 后的 signature
  - 测试中发现 `parseKotlin` `enum class` 被匹配为 `class` 的已知边缘行为，已文档化于测试注释
  - 测试数量从 97 → 98
- **新增 `test/spawn-ast-direct-test.js`** `src/services/dep-graph/parsers/spawn-ast.js` — 直接覆盖此前仅被 java-parsers-test / go-ast-parser-test 间接覆盖的 spawn-ast 边界：

  - 脚本不存在 → `null`、成功 JSON 解析、非零 exit → `null`、stdout 截断（10MB+）、stderr 截断（10MB+）、spawn error → `null`、stdin write error → `null`、非法 JSON → `null`
  - 与已有 `spawn-ast-test.js`（SIGKILL fallback）和 `spawn-ast-concurrency-test.js`（信号量限流）互补，形成 spawn-ast 的完整测试矩阵
  - 测试数量从 98 → 99
- **新增 `test/file-index-boundary-test.js`** `src/services/file-index.js` — 深化 file-index 的边界覆盖：

  - `readdir` EACCES 权限拒绝时 graceful skip（不抛异常、继续索引可读目录）
  - `build()` AbortController 超时中断（1ms 超时，验证不抛异常）
  - `indexByPattern()` AbortController 超时中断
  - 与已有 `file-index-race-test.js`（并发安全）、`file-index-exclude-test.js`（排除逻辑）、`file-index-rename-test.js`（重命名处理）互补
  - 测试数量从 99 → 100
- **新增 `test/watch-sigterm-test.js`** `src/cli/watch.js` — 深化 watch 的异常路径和信号处理：

  - `watch` SIGTERM graceful shutdown（验证进程正常退出）
  - `audit-file --watch` SIGINT graceful shutdown
  - `executeWatchCommand` 无受影响测试边界（孤立文件变更时 `validationComplete.passed === true`）
  - 与已有 `watch-test.js`（文件变化/SIGINT/`--run-tests`）和 `watch-format-test.js`（compact 格式）互补
  - 测试数量从 100 → 101
- **新增 `test/repl-edge-test.js`** `src/cli/repl.js` — 深化 repl 的 threshold 边界和输出格式：

  - `top` 命令：dependents 恰好等于 `HOTSPOT_MIN_DEPENDENTS` 时显示 hotspot；低于 threshold 时显示 "No hotspots detected"
  - `issues` 命令：无 structural issues 时 severity=low、nextSteps 提示 "No immediate structural issues detected"
  - `audit-map --compact` 和 `audit-map`（非 compact）输出字段验证
  - 与已有 `repl-test.js`（executeCommand 全分支）和 `repl-shutdown-test.js`（shutdown 守卫）互补
  - 测试数量从 101 → 102
- **新增 `test/cli-mapper-adapter-test.js`** `cli.js` — 深化 cli 的 mapper 异常和 adapter 验证：

  - `audit-diff` safeEntries 结构验证（每个 entry 必须有 `file` string 和 `graphKnown` boolean）
  - 非法 `--max-depth=abc` → exit 1
  - 非法 `--reuse-hints=maybe` → exit 1
  - 非法 `--trend-granularity=hour` → exit 1
  - `impact` / `dependents` / `dependencies` / `affected-tests` 传入不存在的文件 → exit 1 + human 错误提示
  - 与已有 `cli-error-handling-test.js`（缺失文件 human/JSON 错误）、`cli-args-validation-test.js`（参数校验）、`cli-fallback-test.js`（fallback 行为）互补
  - 测试数量从 102 → 103

### 修复状态勘误（文档同步修正 — 2026-05-16）

> 以下问题在 CHANGELOG [Unreleased] 中曾被记录为"已修复"，但实测或交叉验证发现修复不完全，现统一勘误。

- **`validationAdvice.commands` + `suggestedCommand` 未完全修复**：

  - `audit-diff` 在无变更文件时返回 `commands: { smoke: [], focused: [], full: [] }`；有变更文件时依赖 `generateCommands` 仍可能返回空数组
  - `audit-file` 的 `buildFileValidationAdvice` 返回结构中**不存在 `suggestedCommand` 字段**，实测为 `null/undefined`
  - 此前 SESSION.md 中"已验证不成立"的声明错误，问题仍然存在
  - 根因：`buildFileValidationAdvice` 未生成 `suggestedCommand`；`audit-diff` 的 `buildValidationAdvice` 返回的是分组 commands 对象而非扁平数组，且 `suggestedCommand` 缺失
- **`--format ai` 参数实测残留问题**：

  - `--depth surface` 与 `--depth detail` 的差异仅在于 `riskFiles` 是否存在；当项目无 cycles/unresolved/dead-exports 时两者输出完全一致（预期应始终不同）
  - `--token-budget` 降级逻辑：当前项目输出仅 ~179 tokens（< 500），无法验证降级是否触发；SESSION.md 实战基地实测记录显示未触发降级
  - 结论：`depth` 控制逻辑已实现，但在无 findings 项目的边界行为不符合 SKILL.md 承诺；`token-budget` 待有 findings 项目进一步验证
- **diagnostics linter 检测矛盾（部分修复）**：

  - 代码层面已统一 `detectNodeLinters` 供 `workspaceInfo` 和 `buildChecks` 共用
  - 残留问题：`diagnostics` 缓存命中路径直接返回缓存结果，不携带 `noLintersDetected` 字段；`buildChecks` 中 `noLintersDetected` 仅在 `mode === 'quick'` 时设置
  - ROADMAP.md 仍标记为 🔴 高优先级，状态未同步
- **Java dead-exports 大图崩溃（部分修复）**：

  - `GraphBuilder.analyzeFile()` 已增加 try-catch，单文件 parse 错误不再 crash 整个 batch
  - 但 exit code 49 的根本原因是 Windows Store Python + Git Bash 管道大数据崩溃，该环境问题未根治，仅通过诊断提示改善用户体验
  - ROADMAP.md 仍标记为 🔴 高优先级，状态未同步
- **测试数量修正**：全量 runner 实际为 **111/111 PASS**（含本轮新增 2 个测试），此前文档中多处记录为 109/109，已在本轮文档更新中统一修正。

### 新增（`--format ai` actions 可执行化 — 2026-05-18）

- **`--format ai` 输出 actions 从文案改为可执行指令** `src/cli/formatters/human-formatters.js`：
  - **问题**：`formatAi` 的 `actions` 从 `result.summary.nextSteps/recommendations` 提取，输出如 `"Fix 3 unresolved imports..."` 等纯文案。AI 拿到后无法直接执行，需要自行推断该运行什么命令。
  - **修复**：`formatAi` 中新增 `buildExecutableActions` 逻辑，基于 `result.deadExports`/`cycles`/`unresolved`/`health`/`analysisCoverage` 直接生成 `run: workspace-bridge-cli ...` 格式可执行指令。保留 recommendations 作为无 findings 时的 fallback。
  - **向后兼容**：`formatAi` 输出 schema 不变（`actions[]` 仍为 `{ priority, action }` 对象数组），仅 `action` 字段内容从文案变为可执行格式。

### 新增（`--help` 分层输出 — 2026-05-18）

- **`--help` 按 L1/L2/L3/L4 分层展示命令** `cli.js`：
  - **问题**：20+ 命令平铺输出，AI 分不清 `audit-summary`（策展入口）与 `dead-exports`（原始查询），导致"不知道该用 aggregate 还是 raw"的认知负担。SKILL.md 被迫写大量补偿指南。
  - **修复**：`printUsage()` 将命令分为 L1 策展入口 / L2 专项工具 / L3 环境诊断 / L4 原始查询(debug) / 其他 五组。`health` 标注 `deprecated: use audit-summary --health-only`。
  - **向后兼容**：纯输出格式变更，不修改命令路由或 schema。

### 修复（零专属测试模块补齐 — 2026-05-18）

- **补 4 个零专属测试模块** `test/dep-tools-test.js` `test/incremental-diff-test.js` `test/git-tools-test.js` `test/project-map-test.js`：
  - **问题**：`dep-tools.js` / `incremental-diff.js` / `git-tools.js` / `project-map.js` 四个核心模块无专属测试，仅被 CLI E2E 间接覆盖。修改这些模块时缺乏回归保护。
  - **修复**：
    1. `test/dep-tools-test.js`：15 个断言覆盖 `dependencyGraph` 11 种 operation（stats/dependencies/dependents/impact/cycles/dead_exports/unresolved/affected_tests/default/unknown/missing file）。
    2. `test/incremental-diff-test.js`：7 个断言覆盖 `collectRelatedFiles` 和 `buildIncrementalFindings` 的过滤与边界行为。
    3. `test/git-tools-test.js`：6 个断言覆盖 `getChangedFiles`（staged/since/untracked）、`getChangedLineRanges`、`getFileHistoryRisk`、`getDiffNumstat`。
    4. `test/project-map-test.js`：5 个断言覆盖 `buildProjectMap` full/compact 双路径、`buildDirectoryTree`、`countTreeFiles`、空图边界。
  - **发现**：写测试过程中发现 `incremental-diff.js` `collectRelatedFiles` 与 `human-formatters.js` `formatHuman` 存在契约守卫缺失（详见 TECH_DEBT.md L2 债务）。

### 文档归档（活跃文档债务清理 — 2026-05-18）

> 按 AGENTS.md 文档管理规则：修复一个条目后，TECH_DEBT.md / SESSION.md / ROADMAP.md 中直接删除，不保留痕迹；历史只进 CHANGELOG。
> 以下清单为从活跃文档中移除的已修复条目汇总，详细技术变更见上文 [Unreleased] 各小节。

**从 TECH_DEBT.md 归档：**

- 路径格式混用（`workspaceRoot` Windows 原生 vs `resolvedPath` 小写正斜杠）
- console.log 噪音（`test/` 从 181 处降至 7 处）
- `fs.mkdtempSync()` / `fs.rmSync()` 重复定义清零
- `runner.js` 并发执行 SQLite 写冲突（独立 `--cache-dir` 隔离）
- 时序依赖测试脆弱（`diagnostics-unbounded-timer` / `file-index-rename` / `repl-shutdown` / `spawn-ast` 4 个文件固定延时改为轮询）
- 弱断言清零（`assert.ok(condition)` 无消息、`assert(condition)` 无消息、`typeof x === 'object'` 已清零）
- 零专属测试模块补充：`graph-db.js`、`regression-tools.js`、`security-tools.js`、`file-summary.js`、`impact-explanations.js`

**从 SESSION.md 归档：**

- 产品 bug：路径格式混用
- 产品债务：`repl` 非交互环境不可用、`--incremental` 增量逻辑不可见（待处理）
- runner 并发限制（SQLite 锁竞争）
- 弱断言批量修复：`strictEqual(result.ok, true)`、`assert.ok()` 无消息、`typeof === 'number'`、`assert()` 无消息
- `mkdtempSync` 重复、`console.log` 噪音、零专属测试模块（5 个）、TECH_DEBT.md 重复条目
- `--cwd` 不存在目录时挂起
- exit code 与 severity 解绑（`--fail-on-findings` 显式开关）
- `--check-regression` crash（`makeCycleKey` 防御 `item.files` 缺失）
- `--format ai` 参数生效（`depth`/`token-budget`）
- `validationAdvice.commands` + `suggestedCommand` 全空
- compact 模式比 full 慢 4x（聚合计算 overhead 修复）
- `affected-tests` 0 关联（启发式规则扩展 9 种布局/命名）
- `watch` 排除自身缓存文件（`.bak`/`.tmp-*`）
- `--exclude` 后 `parsedFiles` 不更新

**从 ROADMAP.md 归档：**

- 工作目录污染（SQLite 缓存迁移至 `os.tmpdir()`）
- Java 常量仓库假阳性、`Vue` 脚手架残留假阳性
- `audit-overview` 数据冗余（`nextSteps` 别名删除、`couplingSplitSuggestions` 截断）
- `audit-security` message 太泛（附加 `matchedText`）
- `--quiet` 丢失关键诊断信息（`warnings[]` 注入 JSON）
- cache 失效策略粗糙（`mtime`/`size` 对比 + `getStaleness`）
- `--check-regression` 基线对比崩溃
- impact 入口扩散无截断（`isKnownEntryFile` 停止扩散）
- diagnostics ESLint 盲区（`.eslintrc` / `package.json#eslintConfig`）
- exit code 语义反模式
- `--exclude` 未完全过滤 cycle
- `watch` 误报缓存文件变更
- `commands` + `suggestedCommand` 全空
- 路径格式混用
- `project-map.js` edges Map 内存爆炸（compact 路径优化）
- `cache.js` 无增量写（SQLite upsert 迁移）
- 安全扫描入口（`--builtin-only`）
- 增量分析范围（`--since` / `--staged` / `--files`）
- 输出策展（`--format summary` / `--format markdown` / `--format jsonl`）
- 缓存/图持久化（TTL 24h + git-aware staleness）
- JSON 消费困难（`--format jsonl`）
- human-readable 输出、AI 协作设计（SKILL.md 精简）、多仓库批量审计
- AI 摘要输出、增量分析扩展、分层输出过滤、审查追踪、JSON Lines 输出
- `repl` 非交互环境不可用（`--eval` 模式）

## [1.1.1] - 2026-05-08

### 修复（低垂果实收尾 — P12/P32/P37/P43/P58）

- **P12: `--exclude` 在 `audit-overview` 中未过滤 hotspots/stability/coupling** `src/tools/overview-tools.js` — `buildProjectOverview` 的 `allFiles` 增加 `shouldExcludeCli` 过滤，确保 CLI `--exclude` 在 overview 全链路生效
- **P32: `staleness.thresholdMs` 无人类可读解释** `src/services/container.js` — `getStaleness` 新增 `thresholdDescription` 字段（如 `"5 minutes"`）
- **P37: `health.checks.*.sizeBytes` 是输出噪音** `src/tools/health-tools.js` — `projectHealth` 输出前删除所有 `sizeBytes` 字段
- **P43: `health.checks.ci` 未递归扫描 `.github/workflows/`** `src/tools/health-tools.js` — `detectCiConfig` 对 GitHub Actions 从检查目录存在升级为检查目录内是否有 `.yml`/`.yaml` 文件
- **P58: `audit-file` 的 `frameworkPattern` 永远为 null** `src/services/dep-graph.js` `src/services/dep-graph/framework-patterns.js` — `getFrameworkHint` 增加 content-based fallback：path-based 返回 null 时扫描文件前 800 字节中的框架特征（NestJS/Express/FastAPI/Flask/Spring/Vue 等）

### 文档

- **ROADMAP.md** 性能瓶颈表同步 5 项已修复；GitNexus 模式 D/A 标记已交付；成功标准 #5 90%→95%
- **AGENTS.md** 项目规模同步（159 文件 / 83 test / 13 script）
- **TECH_DEBT.md** P12/P32/P37/P43/P58 标记已修复
- **SESSION.md** 基线与活跃技术债列表同步

## [1.1.0] - 2026-05-06

### 修复（L2 技术债清零 — 19 项）

- **L2-7: `audit-diff` 零变更时 hallucination 为 `"docs"`** `src/cli/formatters/validation-advice.js` — `buildValidationAdvice` 在 `entries.length === 0` 时短路返回 `changeType: "none"` 和空 `phases`
- **L2-10: `affected-tests` 扁平测试目录 heuristic 漏配** `src/services/dep-graph.js` — `_findAffectedTestsByHeuristic` 新增 leaf-name fallback
- **L2-13: `audit-map` 无 `--compact` 时信息过载** `src/cli/formatters/project-map.js` `src/config/constants.js` — compact 模式应用 `COMPACT_ISSUE_MAX_ITEMS`（10）截断
- **L2-14: Windows 路径格式混乱** `src/services/dep-graph.js` `src/tools/dep-tools.js` — 所有命令绝对路径统一为小写 POSIX 格式
- **L2-17: `vite.config.js` 被误判为 entry** `src/utils/project-context.js` — 将 `vite.config.*` 从 `FRAMEWORK_ENTRY_FILES` 移除，由 `CONFIG_PATTERNS` 统一归类为 `config`
- **L2-18: 深层 `index.js` 被误判为 entry** `src/utils/project-context.js` — `inferFileRole()` 对 `index.js`/`index.ts` 增加深度限制
- **L2-19: `stabilityScore` 所有文件统一为 60** `src/config/constants.js` — `STABILITY_BASE_SCORE` 50→40，`STABILITY_LOW_IMPACT_DELTA` 10→15，`STABILITY_CONFIG_ROLE_DELTA` 10→5
- **L2-20: `symbolToDependents` 与 `functionToDependents` 完全重复** `src/services/dep-graph/symbol-impact.js` `function-impact.js` — `buildFunctionToDependents` 不再返回完整 `dependents` 数组
- **L2-21: `deadExports.confidence` 分级与真实数据脱节** `src/services/dep-graph.js` — 新增 `importerCount` 字段，confidence 基于 importerCount + parseMode
- **L2-22: `cycles` 路径格式与其他命令不一致** `src/services/dep-graph.js` `src/tools/dep-tools.js` — 同 L2-14 统一修复
- **L2-23: `init` 命令生成空配置无引导价值** `cli.js` — 扫描根目录子目录，启发式填充 `generated` / `reference`
- **L2-24: `repl` 模式 stderr 污染** `src/cli/repl.js` — `startRepl` 接收 `quiet` 选项
- **L2-25: `audit-map --compact` 模块级 edges 严重遗漏** `src/cli/formatters/project-map.js` — `getModuleOf` 从 2 segments 提升到 3 segments
- **L2-26: `scope.nonMainlineFiles` 始终为 0** `src/utils/project-context.js` — `summarizeFiles()` 将 `test`/`docs` 计为 `nonMainline`
- **L2-27: `audit-overview` 默认输出含永久 `enabled: false` 噪音** `src/tools/overview-tools.js` — 默认输出不再包含未启用的 option 字段
- **L2-28: 15% 文件 AST fallback 无原因说明** `src/services/dep-graph.js` `src/tools/overview-tools.js` — `analyzeFile` 新增 `parseModeReason`；`buildLanguageSupportMatrix` 新增 `regexFiles` + `fallbackReasons`
- **L2-29: `parserAvailability.skipped` 信息未暴露** `src/tools/workspace-tools.js` `health-tools.js` — `workspaceInfo` 输出新增 `parserAvailability` 字段
- **L2-6: `impact` 命令 `transitiveCount` 与 `impact` 数组数据矛盾** `src/services/dep-graph/symbol-impact.js` — `transitiveCount` 从 `getImpactRadius()` 同步计算
- **L2-8: `audit-security` 无 semgrep 时直接不可用** `src/tools/security-tools.js` — 内置轻量规则扫描（`eval` / `innerHTML` / `document.write` 等）
- **L2-9: `diagnostics` 只跑 `npm run -s`，未执行 linter** `src/tools/workspace-tools.js` `cli.js` — 自动检测 eslint 配置并执行；无 linter 时返回 `total: null` + `noLintersDetected: true`
- **L2-12: `--exclude` 只影响 scope 计数，不影响分析结果** `src/services/file-index.js` `src/services/dep-graph.js` `src/utils/orphan-detector.js` — CLI `--exclude` 改为只在报告阶段过滤，被排除文件仍参与依赖图构建（保留 importer 关系）。`FileIndex` 分离 `baseExcludeDirs` / `cliExcludeDirs`；`DependencyGraph` 新增 `shouldExcludeCli()`；`findDeadExports` / `findUnresolvedImports` / `findOrphanFiles` / `getScopeSummary` 均在返回前过滤

### 修复（产品缺陷 — 5 项）

- **P2/P6: Java 后端项目完全失明（fileCount=0）** `src/config/constants.js` `src/services/file-index.js` — `FILE_INDEX_MAX_DEPTH` 5→12；`DEFAULT_EXCLUDE_DIRS` 补充 `target`/`bin`/`obj`/`.idea`/`.vscode`/`vendor`。两个 Java 后端项目（389 + 550 文件）现已正常扫描
- **P28: `hotspot` 配置文件被系统性误标为风险** `src/tools/overview-tools.js` `src/config/constants.js` — `calculateHotspotScore` 新增 `fileRole` 参数，config 文件 score 乘以 `HOTSPOT_CONFIG_DISCOUNT`（0.3）
- **`cycles` 数组首尾重复** `src/services/dep-graph.js` — 去掉 `.concat([file])`，输出标准图论不重复顶点列表
- **REPL `impact` 与独立命令结果不一致** `src/cli/repl.js` — 统一 `resolveWorkspaceFilePath` 解析相对路径为绝对路径
- **`file-index` 构建日志矛盾** `src/services/file-index.js` — 日志改为报告缓存总文件数 `getStats().files`
- **P10: `affected-tests` 永远返回 0** `src/services/dep-graph/parsers/registry.js` `test/parser-registry-test.js` — `.mjs` / `.cjs` / `.mts` / `.cts` 被 `file-index` 索引但 `registry.findByExt()` 未覆盖这些扩展名，导致 `analyzeFile` 跳过解析、imports 为空。`exts` 数组补充 4 个缺失扩展名。Vue 前端 `response.js` 实测从 0 → 2 个测试。`fs.readFileSync` 运行时读取模式仍超出静态分析范围。
- **P20: 命令输出中没有"误报率预估"或"诚实度"标注** `src/tools/honesty-engine.js` `src/tools/dep-tools.js` `src/cli/formatters/repo-summary.js` `cli.js` — 新增 `honesty-engine` 假阳性分类引擎。`dead-exports` / `unresolved` 输出 `possibleFalsePositives`（count / primaryReason / disclaimer）；`audit-summary` 输出 `honesty` 字段；`nextSteps` 根据假阳性比例动态调整建议文案
- **P64: Health 建议命令脱离实际技术栈** `src/tools/health-tools.js` — `FIX_SUGGESTIONS` 静态表改为 `buildFixSuggestions(stack)` 动态函数，接入 `detectStack` 的 `profile`（node-first / java-first / python-first / go-first / rust-first / cpp-first / mixed）生成差异化 `testConfig` 建议文案。Java 项目不再被建议 Jest，Node 项目优先提示 Vitest（Vite 生态）。

### 修复（低垂果实收尾 — P12/P32/P37/P43/P58）

- **P12: `--exclude` 在 `audit-overview` 中未过滤 hotspots/stability/coupling** `src/tools/overview-tools.js` — `buildProjectOverview` 的 `allFiles` 增加 `shouldExcludeCli` 过滤，确保 CLI `--exclude` 在 overview 全链路生效
- **P32: `staleness.thresholdMs` 无人类可读解释** `src/services/container.js` — `getStaleness` 新增 `thresholdDescription` 字段（如 `"5 minutes"`）
- **P37: `health.checks.*.sizeBytes` 是输出噪音** `src/tools/health-tools.js` — `projectHealth` 输出前删除所有 `sizeBytes` 字段
- **P43: `health.checks.ci` 未递归扫描 `.github/workflows/`** `src/tools/health-tools.js` — `detectCiConfig` 对 GitHub Actions 从检查目录存在升级为检查目录内是否有 `.yml`/`.yaml` 文件
- **P58: `audit-file` 的 `frameworkPattern` 永远为 null** `src/services/dep-graph.js` `src/services/dep-graph/framework-patterns.js` — `getFrameworkHint` 增加 content-based fallback：path-based 返回 null 时扫描文件前 800 字节中的框架特征（NestJS/Express/FastAPI/Flask/Spring/Vue 等）

### 修复（Vue 生态收尾 + 数据一致性第二轮 — P24/P29/P31/P34/P39/P41/P60 + P1/P63 占位实现）

- **P31: `health.checks.envExample` 只认 `.env.example`，不认 Vue 生态的 `.env.development`** `src/tools/health-tools.js` — `checkHealthFile` 候选数组增加 `.env.development`、`.env.production`
- **P34: `languageSupport` 没有 Vue/Svelte 的统计条目** `src/tools/overview-tools.js` — `EXT_TO_LANG` 增加 `'.vue': 'vue'` 和 `'.svelte': 'svelte'`
- **P1/P63 剩余: Vue 自定义指令 + 动态字符串调用 extractor 占位实现** `src/services/dep-graph/framework-usage-patterns.js` — `vue-custom-directive` 扫描 `Vue.directive('xxx'` / `app.directive('xxx'`，按 `@/directive/xxx` 惯例映射；`dynamic-string-call` 扫描 `window['foo']` 字面量索引和字符串数组 `forEach` 遍历模式，映射为同级目录 `./foo`。假阳性率预期从 ~30% 降至 ~15%
- **P24: `impact` 数组中 source 文件出现在自己的影响列表里** `src/services/dep-graph.js` — `getImpactRadius` 的 `onVisit` 增加 `file === start` 防御过滤，消除循环依赖场景下 source 以 `transitive-dependency` 形式重复出现
- **P29: `impact` direct-import 的 `importedSymbols` 永远为空** `src/services/dep-graph/parsers/js.js` — AST `CallExpression` visitor 提取 `const { foo, bar } = require('./baz')` 的解构字段名填入 `imported`，regex fallback 已有覆盖，补全 AST 路径缺口。`cli.js` 实测 `importedSymbols` 从 `[]` → `['resolveWorkspaceFilePath']`
- **P39: `audit-file` 的 `severity` 反映的是影响范围而非代码质量风险** `src/cli/formatters/file-summary.js` — 输出新增 `severityContext: 'impact-radius'` 和 `severityNote`，明确告知 severity 衡量的是变更影响半径（dependents + affected tests），不是代码缺陷
- **P41: `fileRoles.library` 和 `orphans.modules` 数据矛盾** `src/utils/project-context.js` `src/services/dep-graph.js` `src/tools/overview-tools.js` — `summarizeFiles(files, isImportedFn)` 新增可选参数，当 `fileRole === 'library'` 但 `getDependents` 为空时降级为 `unknown`。`dep-graph.js` 和 `overview-tools.js` 调用方均传入 `getDependents` 回调，确保 library 与 orphan 互斥
- **P60: `missingHygieneChecks` 计数与 `health.fixes` 数组长度不一致** `src/cli/formatters/repo-summary.js` — `missingHygieneChecks` 从 `displayTotal - displayPassed` 改为 `Object.values(health.checks).filter(c => !c.found).length`，与 `fixes` 数组同源同义

### 修复（数据一致性小 bug — P23/P26/P30/P44/P55/P61）

- **P23: `audit-map --compact` 的 `highlightedFiles` 没有去重** `src/cli/formatters/project-map.js` — `toRelativePath()` 在 `root` 带尾部斜杠时对绝对路径返回绝对路径、对相对路径返回相对路径，导致同一文件产生两个 Map key。修复：去掉 `normalizedRoot` 的尾部斜杠，确保所有路径统一为相对格式。
- **P26: `validationAdvice` 建议的命令路径不可用** `src/tools/overview-tools.js` — `buildCycleRefactorSuggestions` 和 `buildCouplingSplitSuggestions` 的 `validation.command` 从 `'node cli.js ...'` 改为 `'workspace-bridge-cli ...'`。
- **P30: `unresolved` 的 `resolvedTo` 在失败时等于原路径** `src/services/dep-graph.js` — `findUnresolvedImports()` 中 unresolved 项的 `resolvedTo` 从 `imp` 改为 `null`。
- **P44: `scope.hasConfig` 命名歧义** `src/utils/project-context.js` `src/services/dep-graph.js` `test/role-detection-test.js` — `hasConfig` 重命名为 `hasWorkspaceBridgeConfig`。
- **P55/P61: `scope.counts` 缺少 `testFiles`** `src/utils/project-context.js` `src/services/dep-graph.js` `test/role-detection-test.js` — `summarizeFiles()` 和 `getScopeSummary()` 的 `counts` 均新增 `testFiles` 字段。

### 修复（建议模板化 + 数据一致性 — P18/P19/P25/P16/P22/P40）

- **P18/P19/P25: `validationAdvice` / `nextSteps` / `recommendations` 模板化，不区分项目实际特征** `src/cli/formatters/audit-diff-summary.js` `src/cli/formatters/validation-advice.js` `src/cli/formatters/repo-summary.js` `src/tools/overview-tools.js` `cli.js` — `getValidationTemplate(changeType, stackProfile, fileExtensions)` 按技术栈覆盖 phases actions 文案（node-first / java-first / python-first / go-first / rust-first / cpp-first）；`buildFileSpecificAdvice` 按扩展名追加专项建议（`.vue` → 检查模板绑定，`.java` → 检查接口契约，`py`/`go`/`rs` 同理）。`buildNextSteps` 接入 `stackProfile`：Java/Python 优先 review dead exports，Node 优先 unresolved，无 cycle 时不输出 break cycles，hygiene 文案按栈差异化。`buildOverviewSummary` recommendations 末尾追加技术栈基线建议（Node → linter+type-check，Java → Maven compile+surefire 等）。实战基地验证：Vue 前端 vs Java 后端 `audit-overview` recommendations 已明显不同。
- **P16: `audit-overview` 的 `entryPoints: []` 与 `audit-summary` 的 `entryFiles` 矛盾** `src/tools/overview-tools.js` — `buildSkeleton` 的 `entryPoints` 改用 `projectContext.summarizeFiles(allFiles).entryFiles`，与 `audit-summary` 的 `entryFiles` 单一事实源对齐。
- **P22: `scope.directoryRoles` 全为 0** `src/tools/overview-tools.js` — `buildProjectOverview` 返回值新增 `directoryRoles: scope.directoryRoles`（`scope = projectContext.summarizeFiles(allFiles)`）。回退兼容无 `summarizeFiles` 方法的 mock。
- **P40: 命令输出 schema 不一致，部分命令缺少 `ok` 字段** `src/tools/workspace-tools.js` — `runDiagnostics` 返回值加 `ok: true`（含 cached 路径）；`workspaceInfo` 返回值加 `ok: true`。

### 修复（生产环境实测 — 4 仓库端到端审计）

> 2026-05-07 用 2 个 Vue/Vite 前端 + 2 个 Maven 多模块 Java 后端做端到端测试，暴露 9 项严重缺陷，全部修复。

- **Java 多模块后端完全失明** `src/utils/path.js` — `detectWorkspace` 递归检查一层子目录的 `pom.xml`/`build.gradle`
- **Vue SFC `.vue` 扩展名省略导致 100% unresolved** `src/services/dep-graph/resolvers.js` — `RESOLVER_EXTENSIONS` 增加 `.vue`
- **Vue/Vite alias（`@/`/`~`）未解析导致 dead-export 假阳性 >80%** `src/services/dep-graph/resolvers.js` — 新增 `_resolveAlias` 读取 `tsconfig.json`/`jsconfig.json` 的 `compilerOptions.paths`
- **Vue 项目入口文件被标为 orphan** `src/services/dep-graph.js` `src/utils/orphan-detector.js` `src/utils/project-context.js` `src/services/dep-graph/framework-patterns.js` — `ENTRY_BASE_NAMES` 增加 `app.vue`；`framework-patterns.js` 对 `app.vue` 返回 `isEntry: true`
- **Severity 评级自相矛盾** `src/config/risk-thresholds.js` `src/tools/overview-tools.js` — `overviewSeverity` 增加 `unresolved`/`cycles`/`deadExports`/`orphans` 参数
- **health check 标准太偏 Node.js** `src/tools/health-tools.js` — 技术栈感知评分：核心项必检，`testConfig` 按栈动态要求，CI/docker/env/editorconfig 改为 bonus 项
- **`workspace-info` 预检毫无信息量** `src/tools/workspace-tools.js` — 增加 `fileCount`/`languages`/`entryFiles`/`availableChecks`
- **`--compact` 不够 compact** `src/cli/formatters/project-map.js` `src/config/constants.js` — compact 模式应用 `COMPACT_ISSUE_MAX_ITEMS`（10）截断
- **动态导入识别与 alias 联动失效** `src/services/dep-graph/resolvers.js` — alias 解析打通后动态导入链路完整

### 新增（框架隐式依赖插件化 — P7 首批交付）

- **Scanner → Extractor → Applier 统一流水线** `src/services/dep-graph/framework-usage-patterns.js` — 配置表驱动，4 种模式注册：
  - `vue-router-lazy`：正则提取 `component: () => import('@/views/xxx')`
  - `vue-global-component`：提取 `Vue.component('Name', ...)` 按命名约定映射到 `components/Name/index.vue`
  - `vue-custom-directive` / `dynamic-string-call`：占位接口，当前返回 `[]`
- **隐式边注入依赖图** `src/services/dep-graph.js` — `build()` 和 `updateFiles()` 后调用 `applyFrameworkImplicitImports()`，将解析成功的隐式边写入 `graph.imports` / `importRecords`（`usesAllExports: true, isImplicit: true`）和 `reverseGraph`
- **增量更新一致性** `src/services/dep-graph.js` — 重新解析后自动重新应用隐式边；防御性拷贝 `info.imports` / `info.importRecords` 防止污染缓存
- **端到端集成测试** `test/framework-usage-patterns-test.js` — 模拟 Vue 项目验证：router 懒加载 view 不再 orphan/dead-export；全局组件不再 orphan；impact 半径包含隐式依赖方

### 修复（正确性）

- **动态 `import()` 未被解析** `src/services/dep-graph/parsers/js.js` — 新增 `node.callee.type === 'Import'` 分支。GitNexus 实测 dead-export 误报从 53 → 30（-43%）
- **`vitest.config.ts` 未被识别为入口** `src/services/dep-graph.js` — `KNOWN_CONFIG_NAMES` 补充 `vitest.config.ts`
- **`new URL('./worker.js', import.meta.url)` 未被解析** `src/services/dep-graph/parsers/js.js` — 新增 `NewExpression` visitor 检测 worker 脚本加载模式
- **`findOrphanFiles` 与 `isKnownEntryFile` 不一致** `src/utils/orphan-detector.js` `src/tools/overview-tools.js` `src/cli/formatters/project-map.js` — `findOrphanFiles` 新增可选 `isKnownEntryFile` 参数

### 修复（用户体验）

- **`audit-map` 非 compact 缺 summary** `src/cli/formatters/project-map.js` — `--json` 输出均包含 `summary`
- **`affected_tests` 字段 `source` → `file`** `src/tools/dep-tools.js` — 与 `impact` 命令统一字段名
- **`Unknown command` 提示改进** `cli.js` — 错误消息精确为 `Run "workspace-bridge-cli --help" for available commands.`
- **`--help <command>` Common Options** `cli.js` — `printCommandHelp()` 增加命令专属选项说明
- **`validationAdvice` 建议不存在的 `npm run test`** `src/utils/stack-detectors/commands.js` — `node-all-tests` 仅在检测到 `testRunner` 时才建议
- **`affected-tests` human-readable 输出未展示 `via` 链** `cli.js` — `formatHuman` 新增 `viaStr` 展示完整影响路径

### 重构

- **语言注册表重构（模式 A）** — `defineLanguage()` 统一接口
  - 新建 `src/services/dep-graph/parsers/registry-core.js`：`defineLanguage()` + `LanguageRegistry`
  - 新建 `src/services/dep-graph/parsers/registry.js`：9 种语言集中注册
  - `src/services/dep-graph.js`：删除 `PARSER_REGISTRY` 硬编码数组
  - `src/services/file-index.js`：`getFilePatterns()` 委托 `registry.getFilePatterns()`
  - `src/services/dep-graph/parsers/index.js`：parser + registry 统一入口

### 新增

- **大项目索引进度条** `src/services/file-index.js` — 每 100 个文件打印进度
- **`init` 命令** `cli.js` — 生成默认 `.workspace-bridge.json`
- **c8 覆盖率** `package.json` `.gitignore` — `npm run test:coverage`，基线 **79.88%**
- **`.bat`/`.cmd` spawn 自动包装** `src/utils/command.js` — Windows 下自动用 `cmd.exe /c` 包装
- **`.workspace-bridge.json` schema 校验** `src/utils/project-context.js` — JSON 语法错误非阻塞提示

### 文档

- **SKILL.md 文档误导修复** `skills/workspace-audit/SKILL.md` — npx 优先调用；矩阵增加 Known Gaps 列；Known Limitations 增加 Vue/Java 专项说明；新增 Confidence rules 表格

## [1.1.0] - 2026-05-06

### 修复（20 项活跃缺陷全量修复）

**🔴 高危（崩溃/数据丢失/资源泄漏）**

- `fs.watch` 未注册 `'error'` 事件 — `src/services/file-index.js` `startWatching()` 新增 `watcher.on('error', ...)`
- `python.stdin` 无错误监听 — `src/services/dep-graph/parsers/spawn-ast.js` 新增 stdin error handler + write/end try-catch
- REPL 快速连按 Ctrl+C 跳过 shutdown — `src/cli/repl.js` 新增 `process.on('SIGINT', handler)` + finally 移除
- `isKnownEntryFile()` 读整个文件无大小限制 — `src/services/dep-graph.js` 读前 `fs.statSync`，超 64KB 跳过
- `updateFiles` 无重入锁 — `src/services/dep-graph.js` `_updating` 锁 + try-finally
- `shutdown()` 后 `initError` 阻止重新初始化 — `src/services/container.js` `initialize()` 开头清空 `initError`

**🟡 中危（边界条件/误报/竞态/性能）**

- TypeScript 诊断漏 `.tsx`/`.mts`/`.cts` — `src/services/diagnostics-engine.js` 扩展 TS_EXTS
- `cpp.js`/`java.js` regex 多项式回溯 — `MAX_LINE_LEN = 512`，超长匹配跳过
- `stopWatching` 无逐条 try-catch — `src/services/file-index.js` 逐条包围 `watcher.close()`
- `getStats()` 每次触发 O(V·E) DFS — `src/services/dep-graph.js` `_cycleCount` 延迟计算
- `pruneDeletedCacheEntries` 同步遍历阻塞事件循环 — 改为 async batchSize=100 + setImmediate yield
- `cache.save()` 只捕获 `RangeError` — 捕获所有序列化错误，两次降级后返回 false
- `moduleExportsRegex` 不支持嵌套对象 — `src/services/dep-graph/parsers/js.js` 注释文档化限制

**🟢 低危（代码异味/防御性缺口）**

- `search-tools.js` 两个重复 `escapeRegex` — 删除第二个
- `stripQuotedStrings` 模板字面量清理不彻底 — 改用模板字符串安全贪婪匹配
- `findCircularDependencies` 递归 DFS 无最大深度限制 — `MAX_CYCLE_DEPTH` 兜底 + try-finally 正确 pop
- `processPending` 串行 `await` 削弱 debounce — 小并发 CONCURRENCY=5
- Windows `toLowerCase()` Turkish `I→ı` — `src/utils/path.js` 改用 `toLocaleLowerCase('en-US')`

### 测试（新增 10 个测试文件）

- `test/parse-args-test.js` — CLI 参数解析入口
- `test/diagnostics-parser-test.js` — 诊断解析核心
- `test/test-detector-test.js` — 测试映射 heuristic
- `test/diagnostics-engine-test.js` — 诊断引擎生命周期
- `test/container-lifecycle-test.js` — ServiceContainer 初始化/关闭/重启
- `test/cache-corruption-test.js` — 缓存损坏/过期/版本迁移防御
- `test/dep-graph-error-test.js` — dep-graph 错误路径（空数组、删除、重入、懒计算）
- `test/path-utils-test.js` — 路径工具边界与平台兼容
- `test/cli-args-validation-test.js` — CLI 参数验证与帮助
- `test/resolvers-test.js` — 9 语言 import 解析核心

### 新增

- **Rust AST parser** `src/services/dep-graph/parsers/rust-ast.js` `test/rust-ast-parser-test.js` — 基于 `web-tree-sitter` WASM + Tree-sitter Query 实现 Rust AST 解析，替代原有 regex parser。支持 `use`（单路径 / use_list 展开 / `as` alias）、`pub fn`/`struct`/`enum`/`trait`/`type`/`mod`/`const`/`static`、`pub use` re-export、`impl` block 内 `pub fn`。非 `pub` 项自动过滤，消除 regex 级 dead-export 误报。失败自动 fallback 到 `polyglot.js` regex。`parseMode: 'ast'`
- `src/services/dep-graph/parsers/index.js` — `parseRust` 来源从 `polyglot.js` 切换至 `rust-ast.js`
- **Kotlin AST parser** `src/services/dep-graph/parsers/kotlin-ast.js` `test/kotlin-ast-parser-test.js` — 基于 `web-tree-sitter` WASM + Tree-sitter Query 实现 Kotlin AST 解析，替代原有 regex parser。支持 `import`（含 wildcard `.*`）、`class`/`interface`/`object`/`enum class`/`data class`/`fun`/`const val`/`val`/`typealias`。自动过滤 `private`/`internal`/`protected`，消除 regex 级 dead-export 误报。失败自动 fallback 到 `polyglot.js` regex。`parseMode: 'ast'`
- `src/services/dep-graph/parsers/index.js` — `parseKotlin` 来源从 `polyglot.js` 切换至 `kotlin-ast.js`

### 修复（产品功能缺口）

- **`function-impact.js` 硬编码 ext 白名单** `src/services/dep-graph/function-impact.js` — 从 `['.js','.jsx','.ts','.tsx','.go']` 改为检查 `parseMode === 'ast' && functionRecords.length > 0`。Python/Java/Kotlin/Rust 的 changed-function-impact 立即解锁
- **Go/Rust 静态分析命令缺失** `src/utils/stack-detectors/commands.js` — smoke 阶段新增 `go vet ./...` 和 `cargo clippy -- -D warnings`
- **C/C++ stack 检测和验证命令缺失** `src/utils/stack-detectors/detect.js` `commands.js` — 新增 `hasCppProject`（CMakeLists.txt / Makefile 检测）、`cpp-first` profile、`getCppCommands`（cmake build / ctest）。`STACK_TARGET_PATTERNS` 和 `splitTargetsByStack` 加入 C/C++ 扩展名
- **`audit-diff` 缺文件类型统计 + 变更量** `cli.js` `src/tools/git-tools.js` `src/cli/formatters/audit-diff-summary.js` — 新增 `getDiffNumstat()` 解析 `git diff --numstat`。`audit-diff` JSON 输出新增 `summary.fileTypeBreakdown`（按扩展名计数）和 `summary.changeMetrics`（+additions/-deletions）
- **SKILL.md 缺失命令说明** `skills/workspace-audit/SKILL.md` — 补全 `workspace-info`、`diagnostics`、`audit-security`、`repl`、`watch` 的命令说明、阅读指南、场景矩阵。语言支持矩阵同步更新（Kotlin/Rust AST ✅）

### 新增（GitNexus 模式提取 + 产品功能缺口）

- **框架感知 Extractor（模式 C）** `src/services/dep-graph/framework-patterns.js` `test/framework-patterns-test.js` — 翻译 GitNexus `framework-detection.ts` 核心路径模式，裁剪为 workspace-bridge 9 种语言。`detectFrameworkFromPath()` 路径模式检测 + `detectFrameworkFromContent()` AST 轻量扫描（前 800 字节）。覆盖 Next.js / Express / Django / FastAPI / Spring / Ktor / Go HTTP / Rust Web / Vue / Svelte 等框架。`dep-graph.js` `isKnownEntryFile()` 集成框架检测，消除框架入口文件 dead-export 误报。`audit-diff` / `audit-file` JSON 输出新增 `frameworkPattern` 字段
- **`audit-file` validationAdvice** `src/cli/formatters/validation-advice.js` `cli.js` `test/audit-file-validation-advice-test.js` — 新增 `buildFileValidationAdvice(filePath, workspaceRoot)` 轻量函数。检测 stack → 推断 changeType → 调用 `generateCommands()` → 去重返回。`audit-file` JSON 输出新增 `validationAdvice` 字段
- **`health` fixes 数组** `src/tools/health-tools.js` — 新增 `FIX_SUGGESTIONS` 配置表，`projectHealth()` 对未通过的 check 输出 `fixes: [{ check, action, severity }]`

### 修复（资源管理/性能）

- **`isKnownEntryFile()` 读整个文件** `src/services/dep-graph.js` — 将 `fs.readFileSync(filePath, 'utf8')` 改为 `fs.openSync` + `fs.readSync` 只读前 `ENTRY_SCAN_BYTES = 256` 字节。`MAX_ENTRY_FILE_SIZE` 裸数字移至 `src/config/constants.js`。消除大文件（最多 64KB）的全量读取开销
- **`resolvers.js` 同步 I/O 风暴** `src/services/dep-graph/resolvers.js` — 引入模块级 `_statCache` LRU 缓存（上限 `RESOLVER_STAT_CACHE_MAX = 2000`），`cachedStatSync` / `cachedExistsSync` 替代全部 `fs.existsSync`/`fs.statSync` 调用。`DependencyGraph.build()` 开头调用 `clearResolverCaches()` 防过时路径。大仓库批量 import 解析时重复 I/O 削减 80%+
- **`cli.js` JSON.stringify 阻塞事件循环** `cli.js` — 新增 `writeLargeJson()` 分块写入 stdout（每块 64KB，块间 `setImmediate` 让出）。JSON >1MB 时自动在 stderr 提示 `--compact`（仅限 `audit-map` edges >5000 且未 compact 时）
- **AST Cache 防御性上限** `src/services/dep-graph/parsers/tree-sitter.js` — `languageCache` 增加 `MAX_LANGUAGE_CACHE_SIZE = 12`，超限淘汰时调 `lang.delete()`，防 `watch`/`repl` 长期运行 Language 对象泄漏
- **Query 对象未 delete** `src/services/dep-graph/parsers/go-ast.js` `rust-ast.js` `kotlin-ast.js` `cpp-ast.js` — `finally` 块中补 `query.delete()`，消除 WASM 内存泄漏（ROADMAP 性能瓶颈 P2 项）

### 修复（用户体验）

- **`impact` human-readable 未展示 `via` 路径** `cli.js` — `formatHuman` impact case 新增 `via` 链展示：`2: utils/path.js via src/services/dep-graph.js -> src/cli/formatters/index.js`
- **`Unknown command` 后未提示 `--help`** `cli.js` — 错误消息追加 `Run with --help for available commands`
- **`--quiet` 模式下初始化失败根因丢失** `cli.js` — `catch` 块对 `container.initError` 输出完整 `err.stack` 而非仅 `err.message`，确保 quiet 模式下仍能拿到堆栈定位问题

### 新增（GitNexus 模式 D — 递进工具链文案）

- **`--help <command>` 详细指南** `cli.js` — 新增 `COMMAND_GUIDES` 配置表，覆盖全部 19 个命令。每个命令含 `desc` / `WHEN TO USE` / `AFTER THIS`。`node cli.js --help audit-diff` 输出递进式使用说明
- **`affected-tests` 描述补全** `cli.js` `printUsage()` — 原仅显示参数格式 `affected-tests --file <path> [--max-depth <n>]`，现补全描述 `Find tests related to a file`
- **AGENTS.md 命令表同步** — 核心命令表 + 原子命令表全部增加 `WHEN TO USE` / `AFTER THIS` 列，与 `COMMAND_GUIDES` 保持一致

## [1.0.4][1.0.4] - 2026-05-05

> **Highlights**：全栈语言覆盖达成（9 种：JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte），`audit-map --compact` 大项目压缩模式可用（GitNexus 954 文件实测 97% 压缩），Go AST parser 基于 tree-sitter WASM 落地，L2 技术债全部清零。

### 新增

- **C/C++ parser** `src/services/dep-graph/parsers/cpp.js` `test/cpp-parser-test.js` — regex 级解析 `#include`、文件级函数、`#define` 宏。扩展名覆盖 `.c` `.cpp` `.cc` `.h` `.hpp`，`parseMode: 'regex'`
- **Vue SFC parser** `src/services/dep-graph/parsers/vue.js` `test/vue-parser-test.js` — 提取 `<script>` / `<script setup>` 块，复用现有 `parseJavaScript` AST/regex 解析。支持多 script 块合并
- **Svelte parser** `src/services/dep-graph/parsers/svelte.js` `test/svelte-parser-test.js` — 提取 `<script>` 块，复用现有 `parseJavaScript`。支持 `context="module"` 等多 script 块
- **file-index 语言覆盖扩展** `src/services/file-index.js` `src/utils/path.js` — `getFilePatterns()` 在 `hasPackageJson` 时加入 `**/*.vue` `**/*.svelte`；新增 `hasCpp` workspace 特征（`CMakeLists.txt` / `Makefile`），匹配时加入 C/C++ 扩展名；fallback 模式亦覆盖新扩展名
- **parser 注册表 6 → 9 语言** `src/services/dep-graph.js` `src/services/dep-graph/parsers/index.js` — `PARSER_REGISTRY` 新增 `.vue` `.c/.cpp/.cc/.h/.hpp` `.svelte` 三行。达成 AGENTS.md 成功标准「全栈语言覆盖」
- **Go AST parser** `src/services/dep-graph/parsers/go-ast.js` `test/go-ast-parser-test.js` — 基于 `web-tree-sitter` WASM + tree-sitter Query 实现 Go AST 解析，替代原有 regex parser。支持 import/function/method/type/const/var/generics，修复 regex parser `lineEnd = lineStart` 硬编码 bug。失败自动 fallback 到原有 regex。`parseMode: 'ast'`

### 新增

- **`audit-map --compact`** `cli.js` `src/cli/formatters/project-map.js` `src/cli/repl.js` — 大项目信息压缩模式，三轮递进压缩：
  - Round 1：edges 聚合到目录级，删除文件 `exports`/`parseMode`
  - Round 2：tree 变为纯目录骨架（`fileCount` + `totalFileCount`），新增 `highlightedFiles` 透出 entry/issue 文件
  - Round 3：tree 深度限制为 2（深层目录折叠到父目录），edges 进一步聚合到模块级（前两段路径），issueOverlay 裁剪 `exports` 数组，`highlightedFiles` 上限 30
  - REPL `audit-map` 命令同步支持 `--compact`
  - **GitNexus（954 文件）输出从 28,818 行降到 862 行（~97% 压缩）**
- **archive/reference/generated 目录自动排除** `src/services/file-index.js` `src/utils/project-context.js` — `.workspace-bridge.json` 中标记为非 active 的目录（reference/archive/generated）现在被 `file-index` 直接排除，不再扫描、解析、构建 dep-graph。解决混合仓库中 reference 代码污染分析结果和拖慢构建时间的问题。自身项目 totalFiles 从 ~400 降到 98
- **audit-map `--compact` 问题驱动改造** `src/cli/formatters/project-map.js` `cli.js` — compact 模式从"单纯信息压缩"升级为"问题驱动输出"：新增 `summary` 字段（severity / issueCounts / 按优先级排序的 nextSteps），`highlightedFiles` 按问题严重程度排序（unresolved > cycle > dead-export > orphan > hotspot > entry），human-readable 输出首行即 severity + 下一步建议
- **SKILL.md 大项目模式文档** `skills/workspace-audit/SKILL.md` — 新增 `--compact` 使用场景和示例
- **`HIGHLIGHT_SCORES` 注册表** `src/config/constants.js` — 统一 `project-map.js` 中 highlighted file 的评分权重，消除裸数字
- **`symbol-extractors.js` 语言注册表** `src/services/file-index/symbol-extractors.js` — 将 `file-index.js` 中 6 分支 `else-if` 链重构为 first-match 配置表，新增语言只加一行，未知扩展名自然落空数组
- **`stack-detectors/detect.js` + `commands.js`** `src/utils/stack-detectors/` — 将 835 行的 `stack-detector.js` 按「检测/命令」维度拆分为两个子模块，主文件变为 14 行入口

### 修复

- **`DEFAULT_EXCLUDE_DIRS` 污染** `src/services/file-index.js` — 移除上一轮清理本地 `reference/gitnexus/` 残留时误加入的全局排除项 `'gitnexus'`，该规则导致任何名为 `gitnexus` 的目录被全盘跳过
- **cache.js 缓存加载崩溃** `src/services/cache.js` — `normalizeFileMapEntries` / `normalizeDiagnosticsEntries` / `normalizeParseResultEntries` 假设传入值是数组，旧缓存或损坏缓存中该字段可能是普通对象 `{}`。加 `Array.isArray(entries)` 防御性检查
- **hasGradlePlugin 循环内编译正则** `src/utils/stack-detectors/detect.js` — 每行 `new RegExp()` 提到循环外，一次编译复用
- **file-index.js 硬编码 cache 文件名** `src/services/file-index.js` — `'.workspace-bridge-cache.json'` 改为 `require('./cache').CACHE_FILENAME`
- **file-index.js node_modules 特殊分支冗余** `src/services/file-index.js` — `matchesPathFragment` 已覆盖 `node_modules/` 匹配，删除多余 `if (dir === 'node_modules')` 分支
- **file-index.js handleFileChange 漏清缓存** `src/services/file-index.js` — 文件删除时只清 `fileMetadata`，漏了 `parseResult`/`diagnostics`/`symbolIndex`。改为调用 `_removeCacheEntry()`
- **cache.js save() 同步阻塞** `src/services/cache.js` — `fs.writeFileSync` + `JSON.stringify(data, null, 2)` 对大型仓库可能产生数十 MB 字符串并冻结事件循环。改为 `async save()` + `fs.promises.writeFile/rename`，不再格式化 JSON 以减小体积
- **command.js Windows 命令解析** `src/utils/command.js` — 原来对 `semgrep`/`codeql` 强制加 `.cmd`，但它们在 Windows 上可能是 `.exe`。改为只对 `npm`/`npx` 加 `.cmd`，其他交给 `spawn` 按 PATHEXT 搜索
- **REPL SIGINT 资源泄漏** `src/cli/repl.js` — 注册 `rl.on('SIGINT', () => rl.close())`，确保 Ctrl+C 触发 finally 块中的 `container.shutdown()`
- **watch.js shutdown 异常挂起** `src/cli/watch.js` — `container.shutdown()` 抛错时 `process.exit(0)` 不执行，进程挂住。加 `try-catch` 包围 shutdown
- **container.js shutdown 异常不安全** `src/services/container.js` — `processPending()` 抛错时 `stopWatching()` 和 `cache.save()` 被跳过。每步独立 `try-catch`，DEBUG 模式输出细节
- **dep-graph.js 引用污染** `src/services/dep-graph.js` — cache hit 路径直接 `this.graph.set(key, cached)`，导致 graph 和磁盘缓存共享同一个对象引用。改为 `{ ...cached }` 浅拷贝隔离
- **semgrep.js 过度防御** `src/adapters/semgrep.js` — 非零退出码时直接丢弃 stdout 中的 findings。改为先尝试 `JSON.parse(result.stdout)`，解析成功且有有效 results 时保留 findings
- **Linux watcher 被错误禁用** `src/services/file-index.js` — Node.js v20+ Linux 已支持 `fs.watch(path, { recursive: true })`。改为运行时探测而非硬编码 `platform === 'win32' \|\| platform === 'darwin'`

### 重构

- **stack-detector.js 重复代码消除** `src/utils/stack-detectors/` — `hasGoProject` 直接复用 `detectGoModules`；提取 `buildNodeTestCommand`、`buildGoModuleTestCommands`、`buildRustTestCommands` 三个纯函数，消除 Node testRunner 三元链和 Go/Rust 命令生成的跨函数重复
- **file-index.js 死代码删除** `src/services/file-index.js` — `findSymbol`、`searchSymbols`、`getFileSymbols` 在 `src/` 中无调用方，删除
- **DEFAULT_EXCLUDE_DIRS 清理** `src/services/file-index.js` — 移除项目特定目录 `test-temp`、`wb-analysis-fixture`
- **watch.js dead code** `src/cli/watch.js` — 删除 `registerWatchCallback` 中永远收到 `undefined` 的 `originalCallback` 参数
- **project-map.js / overview-tools.js 硬编码对齐** `src/cli/formatters/project-map.js` `src/tools/overview-tools.js` — 同步移除 `wb-analysis-fixture` 硬编码跳过规则
- **cli.js printUsage 补文档** `cli.js` — 补全 `--config` 和 `--language` 参数说明
- **fs.watch handler 崩溃** `src/services/file-index.js` — `path.join(this.root, filename)` 在 `!filename` 守卫之前执行，`filename` 为 `undefined` 时抛 `TypeError`。调整顺序；同时处理 Windows 上 `filename` 为 `Buffer` 的情况
- **`_readPackageJson` 解析崩溃** `src/services/dep-graph.js` — `JSON.parse` 无 try-catch，损坏的 `package.json` 会导致 `DependencyGraph` 构造失败
- **`readTrendHistory` 解析崩溃** `src/tools/overview-tools.js` — 同上，趋势历史文件损坏时抛未处理异常
- **`resolveImport` 空指针** `src/services/dep-graph/resolvers.js` — 导出函数未校验 `importPath`，传入 `null`/`undefined` 时内部解析器崩溃
- **`buildAuditDiffSummary` 空指针** `src/cli/formatters/audit-diff-summary.js` — 对 `entries` 直接调用 `.filter()` 无 array guard
- **`getNodeCommands` / `getPythonCommands` 空指针** `src/utils/stack-detectors/commands.js` — `targets` 未校验直接调用 `.filter()` / `.length`
- **`auditSecurity` null 穿透** `src/tools/security-tools.js` — 解构默认 `targets = []` 只在属性缺失时生效，显式传入 `{ targets: null }` 会 crash
- **`matchGlob` 不完全转义** `src/tools/search-tools.js` — 只转义 `.` / `*` / `?`，其他正则元字符（`+` `[` `]` `(` `)` `{` `}` `^` `$` `|`）未处理，导致 glob 匹配错误
- **parsers/js.js  visitors 映射表** `src/services/dep-graph/parsers/js.js` — 220 行 `visitNode` 拆为 `importExportVisitors` / `functionVisitors` 映射表，7 种业务逻辑各归其位
- **parsers/js.js 通用 AST walker** `src/services/dep-graph/parsers/js.js` — 提取 `walkAST(node, callback, parent)` 消除两处 >90% 重复的 inline walker
- **parsers/js.js 重复代码消除 ×4** `src/services/dep-graph/parsers/js.js` — `getPropertyName(prop)`、`buildExportRecordFromValue(name, valueNode, fallbackLines)`、`pushFunctionRecord(records, name, node)`、`QUOTE_PATTERNS` + `DECL_KIND_MAP` 配置表
- **dep-graph.js 语言分发注册表** `src/services/dep-graph.js` — `PARSER_REGISTRY` 配置表消除 6 分支 if-else 链，新增语言只需改一行
- **dep-graph.js 反向边构建去重** `src/services/dep-graph.js` — 提取 `_addReverseEdges(fileKey, imports, options?)` + `_removeOldReverseEdges(fileKey)`，消除 `buildReverseGraph` 与 `updateFiles` 间的重复逻辑
- **dep-graph.js 模块级常量提取** `src/services/dep-graph.js` — `FRAMEWORK_MANAGED_PATTERNS`、`KNOWN_CONFIG_NAMES`、`PYTHON_MAIN_PATTERN` 提到模块顶部，消除函数内重复创建
- **dep-graph.js 正则缓存** `src/services/dep-graph.js` — `_scanSymbolUsageInImporters` 用局部 `Map<symbol, RegExp>` 缓存，避免每个 importer 对每个 symbol 都 `new RegExp`
- **dep-graph.js 方法拆分 ×3** `src/services/dep-graph.js` — `findAffectedTests` 拆为 `_findAffectedTestsByGraph` + `_findAffectedTestsByHeuristic`；`findDeadExports` 提取 `_collectUsedExports`；`updateFiles` 拆为 `_removeOldReverseEdges` + `_addReverseEdges`
- **overview-tools.js 裸数字归零** `src/config/constants.js` `src/tools/overview-tools.js` — 新增 `SCORING` 常量对象，覆盖 hotspot/stability/coupling/core-module/edge-break/sampling 全量阈值，~20 处裸数字替换
- **container.js / file-index.js 裸数字归零** `src/services/container.js` `src/services/file-index.js` `src/config/constants.js` — `initialize`/`ensureReady`/`build`/`getStaleness` 默认参数与进度批次全部替换为 `TIMEOUTS.*` / `DEFAULTS.*`；新增 `STALENESS_THRESHOLD_MS`、`FILE_INDEX_PROGRESS_BATCH`
- **js.js CJS regex fallback 补全** `src/services/dep-graph/parsers/js.js` — `extractExportsWithRegex` 新增 `module.exports = { ... }` 与 `exports.foo = ...` 检测，消除 CJS 项目 regex fallback 下静默丢导出的盲区

### 测试

- `test/cache-test.js` — 适配 `cache.save()` 改为异步（mock `fs.promises.rename` 替代 `fs.renameSync`）
- `test/cache-stale-prune-test.js` — `cache1.save()` 加 `await`
- `test/js-regex-cjs-test.js` — 新增：强制 regex fallback（故意放置非法语法使 AST 解析失败），验证 `module.exports = { foo, bar: 1 }` 与 `exports.baz = ...` 正确提取为 exportRecords

## [1.0.2] - 2026-05-03

### 变更

- **删除 CodeQL adapter** `src/adapters/codeql.js` — CodeQL 对 workspace-bridge 的核心定位（跨文件结构化分析）ROI 极低：安装包 >500MB、建数据库 1-5 min、分析 1-5 min，与 AI agent 秒级响应的期望冲突；维护成本 208 行 + 大量边界逻辑（混合仓库语言检测、数据库缓存、SARIF 解析、Windows 适配），上一轮修了 9 个 bug 仍持续产出问题。`audit-security` 保留 Semgrep（pip install 秒级、出结果秒级、20+ 语言覆盖），足够满足需求
- **CLI 清理** `cli.js` — 删除 `--db-path`、`--force-refresh`（CodeQL 专属参数）；`--language` 保留给 Semgrep 使用
- **`src/tools/security-tools.js`** — 删除 `dbPath` / `forceRefresh` 透传

### 测试

- `test/security-adapter-test.js` — 删除 CodeQL 相关测试，保留 Semgrep + auditSecurity 核心测试

## [1.0.1] - 2026-05-03

### 修复

- **CodeQL 数据库默认搬到 OS 缓存目录** `src/adapters/codeql.js` `cli.js` — 默认数据库路径从 `<cwd>/.codeql/`（污染用户仓库）改为 `~/.workspace-bridge-cache/codeql/<sha256(cwd).slice(0,12)>/`。不同项目互不影响，SARIF 结果解析后立即清理。CLI 新增 `--db-path` 参数供进阶用户覆盖
- **CodeQL 混合仓库语言检测** `src/adapters/codeql.js` — first-match-wins 改为 detect-all：0 候选返回检测失败，≥2 候选要求 `--language` 显式指定。修复 Spring Boot + 前端被识别为 javascript 的 bug
- **adapter 串行 → `Promise.all` 并行** `src/tools/security-tools.js` — Semgrep + CodeQL 同时跑，大仓库节省一半时间
- **`audit-security` 默认 targets `['.']`** `src/tools/security-tools.js` — 不传参数时扫当前目录，避免静默返回空结果
- **`dedupeFindings` 重命名为 `dedupeWithinTool`** `src/tools/security-tools.js` — 跨工具同位置发现不去重是有意设计（双工具确认是信号），新名 + JSDoc 让意图自解释
- **CodeQL `_ensureDatabase` 简化** `src/adapters/codeql.js` — 单次 `pathExists` 判断，删除旧库时 `force: true`
- **CodeQL summary 删除 `scanned: targets.length`** `src/adapters/codeql.js` — CodeQL 实际扫的是 `--source-root`，targets 不参与，旧字段是假数据
- **`commandExists` 与 spawn 命令名对齐** `src/utils/command.js` — `where`/`which` 现在也走 `resolveCommandForPlatform`，避免 Win 上 `where codeql` 找到 `.exe` 但 spawn 强制 `.cmd` 的不一致
- **Rust 模块名推断收敛** `src/utils/stack-detector.js` `inferRustModuleName()` — Cargo 特殊目录补 `examples/`（之前只排 `tests/`、`benches/`）；`src/mod.rs` 罕见情况 + pop 后空数组兜底，避免生成 `cargo test ''` 的未定义命令

### 测试

- `test/security-adapter-test.js` — 新增 CodeQL 多语言检测错误路径、auditSecurity 空 targets 默认 `['.']`
- `test/rust-module-filter-test.js` — 新增 `inferRustModuleName` boundary 测试（`examples/`、`benches/`、`tests/`、`mod.rs`、pop-to-empty）

## [1.0.0] - 2026-05-02

### Breaking Changes

- **`deps` 命令删除** `cli.js` — `deps` 是 `npm outdated --json` 的封装，与「跨文件结构化分析」核心定位无关，且 npm / pip / cargo 自带 `outdated` 功能。这是 1.0 唯一的 breaking change

### 决策变更

- **CLI 瘦身（23 → 8）取消** — 原计划删除 15 个命令，经产品视角重新评估后取消。主要用户是 AI agent，AI 调用原子命令比聚合命令更省 token（精确输出 vs 冗余超集），且 AI 不存在「命令太多选哪个」的认知 paralysis。保留完整命令集对 AI 用户是净收益

## [0.9.14] - 2026-05-02

### 新增

- **`watch` 命令**
  - `src/cli/watch.js` — 复用 REPL 的 `ServiceContainer` 初始化骨架（`watch: true`），去掉 readline，注册 `fileIndex.onFileChanged` 回调，文件保存时自动打印 `<file> changed  <n> dependents affected: [list]`
  - `cli.js` — 新增 `watch` case，`printUsage()` 同步更新
  - `test/watch-test.js` — 集成测试：启动 watch → 创建临时文件触发 watcher → 验证 stdout 输出 → 清理

### 修复

- **孤儿检测假阳性收敛**
  - `src/tools/overview-tools.js` `findOrphanFiles()` — 新增跳过 `benchmark/` 目录，benchmark 脚本与 `scripts/`/`bin/` 一样是独立入口，不应被报孤儿
  - `src/tools/overview-tools.js` `findOrphanFiles()` — 新增跳过 `wb-analysis-fixture/` 目录，测试 fixture 不是真实代码
- **耦合建议假阳性收敛**
  - `src/tools/overview-tools.js` `buildCouplingSplitSuggestions()` — `role: script` / `role: test` 的阈值收紧：仅当 `coupling.level === 'high'` 时才建议拆分，排除 `level: low/medium` 的工具脚本和测试文件假阳性
  - 修复前：`src/tools/git-tools.js`（total=8, low）、`src/tools/overview-tools.js`（total=7, low）、`src/tools/workspace-tools.js`（total=6, low）、`test/phase01-quality-test.js`（total=6, low）均被误报
  - 修复后：上述 script/test 角色文件不再出现在耦合建议中

## [0.9.13] - 2026-05-02

### 新增

- **P5 Step 2：缓存解析结果（parseResults）**
  - `src/services/cache.js` — `CACHE_VERSION` 升级到 3，新增 `parseResults` Map（file → `{imports, exports, importRecords, exportRecords, functionRecords, parseMode, confidence, mtime}`），提供 `getParseResult()`/`setParseResult()`/`deleteParseResult()`/`hasParseResult()` API，支持 `save()`/`load()` 序列化/反序列化
  - `src/services/dep-graph.js` — `build()` 按 mtime 分离缓存命中与需解析文件：命中 → 直接 `graph.set(cached)`；未命中 → `analyzeFile()` 解析并写入 cache。实测 82 文件仓库 dep-graph 构建从 **289ms → 3ms**（100% cached），约 **96 倍**加速
  - `src/services/file-index.js` — `pruneExcludedCacheEntries()` 同步调用 `cache.deleteParseResult()`，清理 stale parseResult
  - `test/cache-test.js` — 补 `testParseResultGetSetDelete()` + `testSaveAndLoadRoundtrip()` 中追加 parseResult 断言
- **P5 Step 3：激活 Watcher 增量更新 dep-graph**
  - `src/services/dep-graph.js` — 新增 `updateFiles(filePaths)` 方法：删旧 reverse 边 → 检查 mtime（未变则跳过）→ 重新解析 → 加新 reverse 边。不重建全量 reverseGraph
  - `src/services/file-index.js` — `processPending()` 末尾新增 `onPendingProcessed(files)` 批量回调，所有 `handleFileChange` 完成后统一通知下游
  - `src/services/container.js` — 注册 `fileIndex.onPendingProcessed → depGraph.updateFiles`，实现文件变更 → dep-graph 增量更新的链路
  - `test/dep-graph-incremental-test.js` — 补 3 个测试：`testIncrementalUpdateChangesImports`（验证 import 变化后 reverseGraph 正确更新）、`testIncrementalUpdateSkipsUnchanged`（验证未变文件跳过重新解析）、`testIncrementalUpdateDeletesFile`（验证删除文件后 graph 清理）
- **REPL 交互查询模式**
  - `src/cli/repl.js` — 新增 `startRepl()` + `executeCommand()`，支持 `impact`/`affected-tests`/`dead-exports`/`unresolved`/`cycles`/`dependents`/`dependencies`/`stats`/`help`/`exit` 命令，精简人类可读输出
  - `cli.js` — 新增 `repl` case，`printUsage()` 同步更新。REPL 启动时 `watch: true`，dep-graph 常驻内存，大项目单次查询 <100ms

### 修复

- **Dogfooding 自审修复（耦合/孤儿/test-temp 误报）**
  - `src/tools/overview-tools.js` `buildCouplingSplitSuggestions()` — 排除 `outDegree=0` 的 pure utility 文件（`inDegree<20` 不再报告），消除 `path.js`（in=15）、`constants.js`（in=10）等工具函数/常量文件的耦合假阳性
  - `src/tools/overview-tools.js` `findOrphanFiles()` — `scripts/`/`bin/` 目录下的文件直接跳过，不再标记为孤儿。独立入口脚本不是"可能未使用"
  - `src/services/file-index.js` — `DEFAULT_EXCLUDE_DIRS` 补入 `test-temp`，避免测试 fixture 残留污染审计结果
  - `.gitignore` — 补入 `test-temp/`、`wb-analysis-fixture/`
  - `test/analysis-test.js` — 临时目录从 `test-temp` 迁移到 `wb-analysis-fixture`，避免与默认排除规则冲突
  - `ROADMAP.md` — 删除重复的 Step 3 旧内容
  - `SESSION.md` — 修正测试数 33/33 → 34/34

### 改进

- **DepGraph 构建日志** — 输出缓存命中率（`[DepGraph] Built in Xms: N files (P% cached)`）
- **DepGraph 增量更新日志** — 输出重解析数与跳过数（`[DepGraph] Incremental update: X re-parsed, Y skipped in Zms`）

## [0.9.12] - 2026-05-01

### 修复

- **Issue #6/#9: 框架感知缺失 + 排除规则缺陷**
  - `DEFAULT_EXCLUDE_DIRS` 新增 `.next`、`.nuxt`、`.svelte-kit`、`out`、`.turbo`、`coverage`、`.cache`
  - `isKnownEntryFile()` 识别 Next.js App Router 文件（`page.tsx`、`layout.tsx`、`route.ts` 等）为框架入口，消除 dead-export 误判
  - `isKnownEntryFile()` 识别 Python `if __name__ == '__main__'` CLI 脚本为入口，消除 dead-export 误判
  - `shouldExclude()` 对 `node_modules` 改用相对路径匹配：workspace root 本身位于 `node_modules` 内时，只排除子目录 `node_modules`，不再全量排除整个项目
- **Issue #7/#9/#10/#11: regex 字符串字面量误识别 + cycle 自循环 + 静默降级**
  - `parsers/js.js` regex fallback 新增 `sanitizeForRegex()`：在应用 import regex 前剥离注释和字符串字面量（含模板字符串），消除字符串中的 `import...from` 被误识别为真实 import
  - `parseJavaScript()` 首次 regex fallback 时输出 `console.warn` 提示用户 `@babel/parser` 缺失，避免静默降级
  - `dep-graph.js` `analyzeFile()` 过滤自身引用 import，阻止自循环进入依赖图
  - `findCircularDependencies()` 增加 `[A, A]` 型自循环过滤保险
- **Issue #8: 缓存文件副作用 + audit-file 鲁棒性**
  - `git-tools.js` `getChangedFiles()` 排除 `.workspace-bridge-cache.json`
  - `file-index.js` / `dep-graph.js` `shouldExclude()` 排除 `.workspace-bridge-cache.json`
  - `cli.js` `audit-file` 增加文件存在性检查，对不存在文件返回 `ok: false, error: "File not found: ..."`
- **遗留：性能卡点（`audit-diff` / `functionality-test.js` 超时）**
  - `file-index.js` `DEFAULT_EXCLUDE_DIRS` 补入 `gitnexus`（上一轮遗漏，与已存在的 `gitnexus-extract` 同级）
  - `findFilesAsync` 简化冗余的目录级 `shouldExclude` 双检
  - 清理 `reference/gitnexus/`、`reference/gitnexus-extract/`、`reference/gitnexus.zip` 物理残留与 `.workspace-bridge-cache.json` 旧缓存
- **`changeType` 判断精度提升**
  - `classifyChangeType` 排除 `reference`/`archive` 角色文件，避免参考代码影响主线验证策略
  - 引入 `codeRatio` 阈值（20%）：docs/tests/config 主导时若 code 占比 ≤20%，不强制升格为 `code`，避免改大量文档+1行代码却触发 full 回归
  - `stack-detector.js` 各语言 `get*Commands` 支持 `scripts` changeType，脚本变更不再零命令

## [0.9.11] - 2026-05-01

### 新增

- **`src/utils/test-detector.js`** — 从 `dep-graph.js` 提取测试检测工具函数（`normalizeStem`、`normalizeHeuristicName`、`buildHeuristicSignature`、`getHeuristicLanguageFamily`、`isTestLikeFile`）
- **`.github/workflows/release.yml`** — 自动 release workflow，`npm pack` 生成干净包（白名单过滤内部文档）

### 改进

- **audit-formatters.js 职责拆分** — 原 927 行单文件拆为 `src/cli/formatters/` 目录下 7 职责文件（`composite-risk.js`、`repo-summary.js`、`file-summary.js`、`audit-diff-summary.js`、`validation-advice.js`、`project-map.js`、`impact-explanations.js`）+ `index.js`，更新 5 处引用路径
- **mixed repo 命令精度** — `stack-detector.js` `getNodeCommands()` 引入 `codeTargets` 过滤（`js|jsx|ts|tsx|mjs|cjs`），排除 JSON/缓存文件误入 test runner 生成无意义命令（如 `npx jest .workspace-bridge-cache.json`）
- **classifyChangeType 单一数据源** — `audit-diff-summary.js` 改为 `fileRole` 优先、扩展名仅 fallback；`project-context.js` `inferFileRole()` 补全 `jest.config.` / `prettier.config.` / `requirements` / `pyproject` / `readme` / `sh` / `bash` / `ps1` 等配置/文档/脚本角色
- **skill 体系化** — `workspace-audit` skill description 补充中文触发词（"代码审计, 仓库审计..."），同步到用户级别 + `role-quality` 子 skill；`role-quality/SKILL.md` frontmatter 精简为标准 `name + description`
- **CLI 命令完整性** — `cli.js` 独立暴露 `stats`、`dependencies`、`dependents` 命令
- **配置表化重构（5 处硬编码 if-else 链清零）**
  - `stack-detector.js` — 7 组检测规则配置表化：`STACK_MARKERS`、`PACKAGE_MANAGER_RULES`、`TEST_RUNNER_FILE_RULES`、`LINTER_FILE_RULES`、`DOCS_TOOL_RULES`、`TYPE_CHECKER_FILE_RULES`、`JAVA_BUILD_RULES`
  - `dep-graph.js` — `isTestLikeFile` 改为 `TEST_DETECTION_RULES` 表驱动，工具函数下沉至 `test-detector.js`；文件 -67 行
  - `overview-tools.js` — `calculateHotspotScore` / `calculateStabilityScore` 重构为 `HOTSPOT_SCORE_RULES` / `STABILITY_SCORE_RULES` 数据结构驱动
  - `git-tools.js` — `computeHistoryRisk` 重构为 `HISTORY_RISK_SCORE_GROUPS`，组内 first-match、组间累加
  - `path.js` — `scoreDirectory` 重构为 `WORKSPACE_SCORE_RULES` 配置表驱动
- **`package.json` `files` 字段补全** — 新增 `skills/**`、`README.md`、`LICENSE`，release/npm 包结构完整

### 修复

- **`scripts/self-audit.js` Windows 跨平台** — `spawnSync('npm')` 在 Windows 上返回 ENOENT（Node.js 20+ 禁止直接 spawn `.cmd`），已添加 `shell: process.platform === 'win32'` 平台适配

### 文档

- `AGENTS.md` — 新增 Windows spawn 陷阱、提取类方法委托模式、配置表化互斥判断规则；更新历史债务状态
- `SESSION.md` / `TECH_DEBT.md` / `ROADMAP.md` — 同步本轮完成状态

## [0.9.0] - 2026-04-29

### 新增

- **P2: Rust workspace 子 crate 支持** — `stack-detector.js` 新增 `detectRustWorkspaceMembers()` 解析根 `Cargo.toml` `[workspace]` members，读取每个 member 的 `package.name`。改动 `.rs` 文件时生成 `cargo test -p crate-name`，不再只能跑全量 `cargo test`
- **P3: Language support matrix** — `audit-overview` JSON 输出新增 `languageSupport` 字段，按扩展名统计各语言的解析深度（ast/regex）和 confidence（high/medium/low），含 `files` 和 `astFiles` 计数。human 输出同步追加 `languages` 行
- **P1: 语言级使用点解析** — `dep-graph.js` 新增 `_scanSymbolUsageInImporters()`，轻量扫描 importer 文件内容中的方法调用/字段访问，补充 importRecords 未 capture 的使用（如 Java 实例调用 `foo.bar()`、Go `pkg.Func()`）。消除 Java/Go/Rust 符号级 dead-export 系统性误报
- **P3: 影响路径解释字段 + 变更影响解释链** — `getImpactRadius()` 扩展 `via`（路径链）+ `importedSymbols`（导入符号）+ `reason`；`audit-formatters.js` 新增 `buildImpactExplanations()` 聚合可读因果链（如"因 `resolvers.js` 被 `dep-graph.js` import（resolveImport），故波及测试"）。`audit-diff` 返回 `impactExplanations` 数组
- **P0T5: 内部函数改动→测试映射** — `function-impact.js` DFS 追溯调用链，找到调用内部函数的导出函数，再映射 dependents。`cli.js` 识别 `internal-function-call-chain` mode 触发 function-level test mapping
- **P3: CJS 符号解析补全** — `parsers.js` 识别 `module.exports = { fn }` 和 `exports.fn = ...`，`symbol-impact.js` `buildFunctionToDependents` 同时参考 `functionRecords`，CJS 项目 symbol-level impact 可用
- **JS/TS 全函数定义索引** — `parsers.js` 新增 `functionRecords`，收集所有 `FunctionDeclaration`/`FunctionExpression`/`ArrowFunctionExpression` 的 line range 与 callCallees，为调用链分析提供数据基础
- **P1.5: `audit-map` 全局项目地图** — 聚合 `tree`（目录骨架+文件角色）+ `edges`（import/export 拓扑）+ `issueOverlay`（deadExports/unresolved/cycles/orphans），给 AI 全局视野

### 改进

- **P4: parsers.js 按语言拆分** — 原 976 行超标文件拆为 `src/services/dep-graph/parsers/` 目录（`shared.js` + `js.js` + `python.js` + `java.js` + `polyglot.js` + `index.js`），均 < 500 行。现有 `require('./parsers')` 零改动
- **P0T5 验收达成** — 改 `resolvers.js` 中 `readGoMod`（内部函数）时，`audit-diff` 的 `functionLevelAffectedTests` 包含 `test/gors-resolver-test.js`
- **P1.5 验收达成** — `node cli.js audit-map --cwd . --json --quiet` 输出结构化地图（56 files / 65 edges / 3 deadExports / 9 orphans）

### 修复

- **`buildImpactExplanations()` 自引用语义** — `directImporter = imp.via[0]` 取成 `changedFile` 本身，导致 level>1 的 explanation 出现"被 A import A"。修复为 `imp.via[imp.via.length - 1]`，加 `if (directImporter === changedFile) continue` 防御
- **`checkFile()` 缓存永远失效** — `getDiagnostics()` 返回 diagnostics 数组，但 `checkFile()` 按 `{mtime, diagnostics}` 对象读 `.mtime`。新增 `cache.getDiagnosticsEntry()` 返回完整 wrapper，`checkFile()` 和 `getCached()` 改用之
- **`_scanSymbolUsageInImporters()` SyntaxError** — symbol 含 `$`、`.` 等正则元字符时直接拼接到 `new RegExp` 中导致异常或错误匹配。修复：拼接前做 `symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` 转义
- **`visitFunctionNode()` 遗漏箭头函数** — 只认 `FunctionDeclaration/FunctionExpression`，`const foo = () => {}` 完全跳过。修复：`visitFunctionNode(node, parent)` 新增 `ArrowFunctionExpression` 分支，从父 `VariableDeclarator` 取函数名

## [0.8.2] - 2026-04-28

### 新增

- **Java AST 支持**（P4-A）- `scripts/java_ast_parser.py` 使用 javalang 进行 AST 级解析，提取类名/public 方法/public 字段/接口方法，失败自动回退 regex
- **Kotlin/Go/Rust L2 支持**（P4-B）- 文件索引、regex 级解析器、技术栈检测与验证命令生成
- **多模块 Java source root 自动发现** - 支持 `module-a/src/main/java` 及 `src/main/kotlin` 目录结构

### 改进

- **Go 验证命令** - focused 阶段按 package directory 聚合生成 `go test ./pkg1 ./pkg2`，不再直接传文件路径
- **符号级影响分析** - Java 从 regex 提升到 AST 级；JS/TS/Python 已实现 AST 级

### 修复

- **Java static import 解析** - source 保持标准包路径（不再带 `static ` 前缀），resolver 可正确解析
- **Java 接口方法提取** - InterfaceDeclaration 中的方法纳入 exports，避免低估 symbol impact
- **Kotlin 依赖解析** - `resolveJavaImport` 同时查找 `.java` 和 `.kt` 文件，打通 Kotlin import 解析
- **Java 方法级 dead-export 误报** - 有 importer 的 Java AST 文件不再产生符号级 dead-export（实例调用 `foo.bar()` 不在 import 记录中体现）
- **Gradle Checkstyle 命令格式** - Gradle 项目使用 `gradlew checkstyleMain checkstyleTest`，不再混用 Maven 的 `checkstyle:check` 语法

## [0.8.0][0.8.0] - 2026-04-03

### 新增

- **audit-overview** - 项目全景视图命令（P3）：
  - 热区图（hotspotsByRisk）- 基于 Git 历史和依赖耦合度识别高风险文件
  - 稳定性趋势（stabilityCounts）- 综合测试覆盖、改动频率、循环依赖评分
  - 孤儿文件检测（orphans）- 发现可能未使用的文件
  - 架构建议（architectureAdvice）- 循环依赖重构建议、过度耦合模块拆分提示
- **可视化输出**（P5）- `audit-overview --format html` 生成交互式仪表板
- **技术栈检测增强** - 自动识别 Java（Maven/Gradle）、Python（Django/FastAPI/Flask）框架
- **函数级测试映射**（P2）- `audit-diff` 精确映射变更函数到相关测试（JS/TS 支持）
- **AST 相似度检测**（P2）- 发现相似函数时给出参考实现提示（可选功能）
- **CLI 回退链**（P6）- `scripts/cli-fallback.js` 支持全局安装回退到本地 cli.js
- **Skill 标准化 v1**（P6）- `workspace-audit` skill 支持随机路径启动、标准输出契约
- **性能基准**（P1）- 新增 500+ 文件性能测试脚本

### 改进

- **benchmark 阈值策略**（P6）- 相对基线 + 30% 波动容忍，替代固定 500ms 阈值
- **混合仓库识别** - 自动检测 prototypes/examples 目录并降权处理
- **入口识别增强** - 支持框架配置文件（vite.config、manage.py 等）作为入口
- **缓存系统** - 内容哈希缓存，自动失效机制
- **符号级影响分析** - JS/TS/Python 已实现 AST 级；Java 为 regex 级，AST 支持在 P4-A 计划中

### 变更

- **CLI-only** - 完全移除 MCP server，仅保留本地 CLI + skill 工作流
- **输出标准化** - 所有命令遵循 Scope/Top Risks/Actions/Validation/Confidence 契约

## [0.6.0][0.6.0] - 2026-03-27

### 新增

- **跨文件分析查询** - `dependency_graph` 工具新增三个 operation：
  - `dead_exports` - 查找未被引用的导出（confidence: high/medium）
  - `unresolved` - 查找解析失败的 import
  - `affected_tests` - 沿依赖图 BFS 查找受变更影响的测试文件
- **后台诊断缓存** - `diagnostics_live` 现在默认返回缓存结果（0ms），无缓存时调度后台检查
- **新增测试** - `test/analysis-test.js` 覆盖三个跨文件分析查询
- **配置集中化** - `diagnostics-engine.js` 和 `dep-graph.js` 添加 CONFIG 常量对象

### 改进

- **稳定性** - `server.js` 添加 SIGTERM 和 stdin close 处理，shutdown 添加 5 秒超时保护
- **性能** - `dep-graph.js` 使用异步 IO + 并发限制（20），避免大仓库阻塞事件循环
- **安全性** - `sanitize.js` 移除 shell arg 中的 `/` 和 `\` 允许，防止路径遍历绕过
- **错误处理** - `editor-state.js` 检测 SQLite magic bytes，明确返回 null 而不是假装成功

### 变更

- **Breaking** - `diagnostics_live` 的 `file` 参数改为 required，不再依赖 EditorState
- **版本** - 版本号更新至 0.6.0

### 修复

- 修复安全测试中 shell 参数消毒的绕过问题
- 修复跨平台测试中使用 `echo` 命令失败的问题（改用 `node -e`）
- 修复 `findDeadExports` 中 Map 迭代可能被修改的问题（使用 `Array.from()` 复制）

### 已知问题

- `editor-state.js` 模块当前不可用（VS Code state.vscdb 为 SQLite 二进制格式）
- `findDeadExports` 在无 AST 分析时误报率高，barrel exports 场景基本不可用
- `findUnresolvedImports` 内部仍有同步 IO（`fs.existsSync`）

---

## [0.5.1][0.5.1] - 2026-03-27

### 安全加固

- ReDoS 防护 - 正则查询添加 100ms 超时
- 错误信息脱敏 - 绝对路径和用户信息公开为 `<path>` / `<user>`
- 初始化竞争修复 - 所有工具添加 `await container.ensureReady()`
- 路径遍历防护 - `validateWorkspacePath()` 强制校验
- 命令注入防护 - 全部使用 `spawn` + 参数数组

---

## [0.5.0][0.5.0] - 2026-03-26

### 初始版本

- 11 个 MCP 工具：workspace_info、run_diagnostics、diagnostics_live、git_diff_summary、git_blame、git_history、search_code、lookup_symbol、project_health、check_dependencies、dependency_graph
- ServiceContainer 架构：WorkspaceCache、FileIndex、DiagnosticsEngine、EditorState、DependencyGraph
- 零运行时依赖
- 安全编码：参数化命令、路径校验、输入消毒

---

[1.0.4]: https://github.com/user/workspace-bridge/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/user/workspace-bridge/compare/v1.0.2...v1.0.3
[0.8.0]: https://github.com/user/workspace-bridge/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/user/workspace-bridge/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/user/workspace-bridge/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/user/workspace-bridge/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/user/workspace-bridge/releases/tag/v0.5.0
