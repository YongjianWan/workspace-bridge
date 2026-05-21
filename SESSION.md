# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（确认状态即可，不用跑 runner）

> **定位**：workspace-bridge 是**AI 的代码脚手架**，不是人类审计工具。CLI 负责策展（预组装、去噪、按优先级排序），skill 负责驾驶手册（什么时候用/不用/标准工作流）。
>
> **🔴 开工前不读 CHANGELOG.md**。确定现状只需读本文档 + AGENTS.md + TECH_DEBT.md + 下方 1 条基线命令。CHANGELOG 是历史存档，读它不能替代读活跃文档。
>
> 收工时已跑 `node test/runner.js` 并确认 133/133 PASS，开工无需重跑。直接读取下方「基线状态」确认当前文档记录是否仍成立。
>
> 开发迭代推荐 `npm run test:fast`（~37s，93 个 fast 层测试），比全量 runner（~4min）快 6×。

```bash
# 1. 快速自审（1 秒确认，不用等 runner，不读 CHANGELOG）
node cli.js audit-summary --cwd . --json --quiet
# 期望: health.healthScore=7/8, summary.counts.deadExports=1, summary.counts.unresolved=0, summary.counts.cycles=0, summary.analysisCoverage.totalFiles≈263, summary.analysisCoverage.coverageRatio=1
```

**如果 audit-summary 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 历史变更见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `healthScore=7/8`
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)
3. **查看活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 6 L3）

---

## 基线状态

- 测试：**受影响测试全部 PASS**；全量 runner 133/133 PASS（~4min，分阶段：fast ~37s / slow ~100s / watch 串行）。开发迭代用 `npm run test:fast`（~37s）或 `npm run test:smoke`（~31s）
- 版本：**v1.2.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~264 文件，entry=1, mainline=129, test=135
- 健康度：7/8（缺 dockerConfig），deadExports=1（`severityMeetsFilter` 在 `src/cli/commands/_utils.js` 中零引用，待清理），cycles=0，unresolved=0
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust Regular Expressions、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验）
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**历史交付**：路线 A–J 全部完成；阶段 1/2/3 全部完成；L2 债务清零；产品债务清零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 已知陷阱（新 agent 必看）

| 陷阱 | 位置 | 如何避免 |
|------|------|----------|
| `DEFAULT_EXCLUDE_DIRS` 全局污染 | `src/services/file-index.js` | 任何新增排除项必须是通用目录名（如 `node_modules`），不能是项目特定名称 |
| orphan 检测不同步 | `project-map.js` vs `overview-tools.js` | 两处 orphan 逻辑必须保持同步（scripts/bin/benchmark 跳过） |
| compact 模式只改 project-map.js | `cli.js` 也需要同步 | human-readable 输出和 `countTreeFiles()` 必须兼容 skeleton 模式（`totalFileCount`） |
| Windows PowerShell 管道 BOM | 所有 `node cli.js ... \| node -e` 命令 | PowerShell 管道传 JSON 会带 BOM，用文件中转（`> file`）再读取 |
| cache.save() 已改为 async | `src/services/cache.js` | 调用方必须 `await`（container.js、测试均已适配） |
| repl-test.js flaky | `test/repl-test.js` | runner.js 串行执行时偶发失败，单独 `node test/repl-test.js` 稳定通过；若遇到，先重跑确认 |
| `framework-patterns.js` 新增框架时 | `src/services/dep-graph/framework-patterns.js` | 路径检测逻辑按语言分块，新增语言需同时更新 `isEntry` 标记和测试 |
| `buildFileValidationAdvice` 导出链 | `validation-advice.js` → `index.js` → `cli.js` | 新增 formatter 函数必须在 `src/cli/formatters/index.js` 中显式导出，否则 cli.js 解构为 `undefined` |
| `--quiet` 不再 monkey-patch `console.error` | `cli.js` / `container.js` | `quiet` 通过 `ServiceContainer` → `FileIndex` / `DependencyGraph` 传递；信息性日志条件输出，错误日志仍用 `console.error` |
| `findDeadExports()` edges/files 降级 | `src/services/dep-graph.js` | 单文件项目（files=1）不受降级影响；多文件项目 edges/files < 0.1 时 confidence 降为 low |
| `.workspace-bridge-cache.json.bak` 泄漏到 git status | `src/tools/git-tools.js` | `getChangedFiles()` 已排除 `.bak` 备份文件，防止 audit-diff 误报 |
| `resolvers.js` 策略链新增策略 | `src/services/dep-graph/resolvers.js` | 新增语言需在 `registerResolverConfig()` 中加一行，策略函数签名 `(importPath, fromFile, ctx) => string\|null` |
| `checkFileChanges()` 双路径 | `src/services/cache.js` | fast path（mtime+size）+ slow path（SHA-256）。修改 staleness 逻辑时必须保持双路径行为 |

---

## 本轮上下文

> 活跃问题与技术债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。历史已修复条目不重复记录。

### 本轮做了什么

**前轮（上一轮）**：
- **Bug 与架构修复**：完成了 L1 Blocker 异步/shutdown 竞态修复、幽灵更新内存校验消除、SQLite 写入元数据丢失和测试分类警告等。详见 CHANGELOG.md [Unreleased]。
- **L2 性能债（增量写入）**：重构了 `src/services/graph-db.js` 与 `src/services/cache.js`，实现 `saveIncremental(dirtyData)` 增量存表逻辑。
- **L4 Facade 编排层提取**：新建并抽取 Curation 与过滤核心中转层 `src/tools/audit-assembler.js`。
- **P1 AI 预消化输出机制**：开发了 `--format ai`、`--token-budget <n>` 和 `--depth` 特性。
- **P0 低垂果实 5/5 完成**：SQLite pragma 调优、PhaseTimer 多阶段计时、CLI 错误分类 + 可操作建议、安全白名单分派表 + Assert Defense、测试间隙穿透。

**本轮**：
- **REFACTOR Wave 1 低垂果实全部完成**：
  - **D4**：`builder.js` `updateFiles()` finally 块 `await cache.save()`，watch 增量不落盘修复。
  - **O5**：`file-index.js` `processPending()` `.catch()` 异常捕获，消除 unhandled rejection。
  - **U4**：`overview-tools.js` 硬编码 `200` → `DEFAULTS.SMALL_PROJECT_MAX_MAINLINE`。
  - **U5**：新建 `src/utils/exclude-patterns.js`，提取 `shouldExcludeCli` 共享纯函数，消除 `dep-graph.js` / `file-index.js` 50 行复制粘贴。
  - **U6**：`path.js` 新增 `normalizeFilePath`，统一 `cache.js` / `dep-graph.js` 两处实现。
- **U2（ExitCode 契约）核心目标已达成**：`determineExitCode` 已从 25 行 switch 压到 4 行 O(1) 契约，剩余 13 个命令补 `hasFindings` 为非阻塞性后续工作。
- **D5（按需 post-process）**：`builder.js` 中 `updateFiles()` 按 re-parsed 文件扩展名过滤 `postProcessPhases`。改 `.js` 不跑 Java package 逻辑，改 `.java` 不跑 JS 框架隐式 import 逻辑，O(N)→O(k)。
- **O1-O3（EventBus + 修复 watch/diagnostics 覆盖冲突）**：
  - 新建 `src/utils/event-bus.js`，支持多监听器 + 错误隔离 + `emitAsync`。
  - `file-index.js` 单属性回调改为 EventBus 事件发射。
  - `watch.js` 不再覆盖 `fileIndex.onFileChanged`，watch 输出与 diagnostics 检查同时工作。
- **D1-D3（Wave 2 架构核心：edges 表 + loadGraph 快速恢复）**：
  - **D1** `graph-db.js`：新增 `edges` 表 schema + `saveEdges()` / `loadEdges()` API；`test/graph-db-test.js` 补 round-trip + 空表测试。
  - **D2** `cache.js` + `builder.js`：`WorkspaceCache` 新增 edges 代理；`GraphBuilder` 在 `build()` / `updateFiles()` 末尾持久化 edges（含 post-process 后的 implicit edges）。
  - **D3** `dep-graph.js` + `container.js`：新增 `loadGraph()`，三层 staleness 校验后从 SQLite edges + parseResults 恢复 graph + reverseGraph；`container.js` `_initDepGraph()` 优先 loadGraph，fallback 到 build。修复 Windows originalPath 大小写回归（`integration-core-test.js`）。
- **D7-D8（预计算表持久化）**：
  - **D7** `graph-db.js` + `cache.js`：新增 `precomputed_aggregates` 和 `precomputed_impact` 表及读写 API；`WorkspaceCache` 薄代理。
  - **D8** `analyzer.js` + `builder.js` + `dep-graph.js`：`GraphAnalyzer` 新增 `precomputeImpact()` 和 `_impactCache`；`injectPrecomputedAggregates()` / `injectPrecomputedImpact()` 从 SQLite 恢复；`build()` / `updateFiles()` 末尾自动持久化；`loadGraph()` 恢复时注入预计算数据。
  - 验证：全量 runner **133/133 PASS**；`test/precomputed-roundtrip-test.js` 5/5 PASS；冷启动 2.7s → 温启动 1.45s。
- **Wave 1（SymbolRegistry 全局符号表）**：
  - 新建 `src/services/dep-graph/symbol-registry.js`：从 AST `exportRecords` 构建纯内存全局符号表，支持 `lookup` / `lookupUnique` / `getRegistryStats`。
  - `builder.js` 在 `build()` / `updateFiles()` 末尾调用 `_buildSymbolRegistry()` 构建符号表。
  - `dep-graph.js` facade 暴露 `symbolRegistry` getter。
  - CLI 新增 `debug --what symbols` 命令，输出符号统计和重复符号 TOP 50（自身项目：293 符号 / 92 文件 / 40 重复）。
  - **Resolver 接入完成**：`resolvers.js` 新增 `trySymbolTable` fallback 策略，挂到所有语言策略链末尾；`resolveImport` 扩展可选第 5 参数 `symbolRegistry`；`builder.js` 调用点传入 `this.symbolRegistry`。
  - 验证：`test/symbol-registry-test.js` 7/7 PASS；`test/resolver-symbol-table-test.js` 7/7 PASS；fast 层 96/96 PASS。

---

## 活跃问题与技术债务

| 级别 | 数量 | 内容 |
|------|------|------|
| L1 Blocker | 0 | — |
| L2 债务 | 0 | — |
| L3 债务与品味 | 6 | js.js visitor超长 / cli.js JSON嵌套深 / ProjectContext规则盲区 / shouldExclude过度正则 / fallback正则缺陷 / resolvers.js缓存淘汰与高频GC |
| **产品债务** | **0** | — |

**测试覆盖缺口**

> **133/133 PASS**（fast 93 + slow 36 + watch 4）。测试基础设施已收敛。

> **剩余测试债务（已量化）**：
> - **弱断言 ~35 处**：仅余 `typeof` 型 schema 契约检查（带消息参数，风险低）。占总断言数 ~2.3%
> - **console.log 噪音 7 处**：代码字符串内嵌、平台跳过诊断、runner.js 骨架输出
> - **`audit-map-test.js` graph 数据字面量** 仍内联
> - **时序依赖**：mock 内部延迟保留、进程退出超时保护保留
> - `src/tools/overview-curator.js` 零专属测试（被 `overview-tools-test.js` 间接覆盖）
> - **CLI 集成测试补齐**：详见 CHANGELOG
>
> **测试类型分布失衡**：单元测试 ~76%（良好），集成测试 ~20%（已补充 `cli-integration-test.js`），端到端 ~2%（严重不足），混沌/模糊 0（暂缓）。

---

## 下一步方向

> 阶段 1（误报清零）、阶段 2（暴露正确 + 输出策展）、阶段 3（框架感知深化）全部完成。
> 当前进入 **"低垂果实 + 波次化架构升级"** 双轨阶段。
>
> **根因判断**：resolvers.js 启发式字符串匹配 + 零全局符号表，是 import 解析脆弱、dead-exports 误报、增量性能击穿、Builder 越权操控 Analyzer 的共同根因。修复路线：Pre-scan 全局符号映射 → 语言 Provider 注册表统一契约 → Resolver 策略链物理拆分 → Builder/Analyzer 生命周期事件解耦 → 后处理 Affected-only 增量化。
>
> 相关架构背景参考（独立文档，与本节 Wave 定义非同一套）：
> - [ADR：workspace-bridge 从分析工具到代码知识库](./docs/architecture/ADR-graph-knowledge-base.md) — SQLite 作为核心图存储的决策与四阶段实施路线
> - [REFACTOR：数据层、编排层、输出层三层齐改](./docs/architecture/REFACTOR-2026-05-data-orchestration-output.md) — 22 项代码审计问题的三层重构方案（D1-D8 / O1-O7 / U1-U9）

### 当前状态

- 活跃债务：**0 个 L1** + **0 个 L2** + **6 个 L3** + **0 个产品 bug** + **0 个产品债务**
- 版本：v1.2.0，schemaVersion 冻结
- 测试：**133/133 PASS**；全量 runner ~4min。开发迭代首选 `npm run test:fast`（~37s）
- P0–P4 全部完成；**Wave 1（低垂果实）完成；Wave 2（D1-D3 edges 表）完成**
- **定位**：AI 的代码脚手架
- **核心认知**：底层引擎能力足够，CLI 出口质量（`--format ai`）已交付。下一阶段主线是**解析精度结构性升级**，但必须波次化执行。

### P0 低垂果实（现在做，零风险高 ROI）

> 当前无待执行的 P0 低垂果实。

### P1 解析精度升级 Wave 1（本轮）

> **约束**：波次化执行，每波之间保持 133/133 PASS。禁止一次性做多层心脏移植。

| 波次 | 范围 | 侵入性 | 验证标准 | 状态 |
|------|------|--------|----------|------|
| **Wave 1** | Pre-scan 全局符号表（新增模块，不改现有解析链） | 低 | 新增测试全绿，现有测试不受影响，符号表数据可通过 debug 命令导出验证 | ⏳ 待实施 |
| **Wave 2** | Resolver 策略链物理拆分（基于 Wave 1 数据结构） | 中 | 所有语言解析测试全绿，benchmark 无回归 | ⏳ 待实施 |
| **Wave 3** | Builder/Analyzer 解耦 + 后处理 Affected-only | 高 | 增量更新 benchmark 证明 O(k)，watch 模式无泄漏 | ⏳ 待实施 |

### 数据层 Wave 2（D1-D8，已实施 D1-D3）

> **来源**：[REFACTOR：数据层、编排层、输出层三层齐改](./docs/architecture/REFACTOR-2026-05-data-orchestration-output.md)

| # | 行动 | 文件 | 状态 | 说明 |
|---|------|------|------|------|
| D1 | 新增 `edges` 表 | `graph-db.js` | ✅ 已完成 | `nodes` 表 deferred（`file_metadata` 已覆盖节点元数据） |
| D2 | 增量写入 edges | `graph-db.js` `cache.js` `builder.js` | ✅ 已完成 | `build()` / `updateFiles()` 末尾自动保存 |
| D3 | 加载 edges 恢复内存图 | `dep-graph.js` `container.js` | ✅ 已完成 | `loadGraph()` 三层校验 + fallback 到 `build()` |
| D5 | 按需 post-process | `builder.js` | ✅ 已完成 | 按 re-parsed 扩展名过滤 phase |
| D6 | 消除 parseResults/graph 冗余 | `cache.js` `dep-graph.js` | ⏳ 长期 | `nodes` + `edges` 成为唯一事实源 |
| D7 | 预计算表 | `graph-db.js` | ⏳ 待实施 | `precomputed_impact` / `precomputed_tests` / `precomputed_aggregates` |
| D8 | 写入预计算 | `builder.js` | ⏳ 待实施 | `updateFiles()` 后重新预计算并写入 SQLite |

### P2 高 ROI 用户可见功能（评估中）

| # | 目标 | 状态 | 说明 |
|---|------|------|------|
| 1 | **Bus Factor / 知识分布** | ⏳ 待评估 | `audit-overview` 新增 `knowledgeRisk`：逐文件 git blame + mailmap 去重 |
| 2 | **回归测试档案** | ⏳ 待评估 | `fp_regression_*.js` 归档已知误报场景，防止修复后复发 |
| 3 | **路径参数安全清洗** | ⏳ 待评估 | `--file`/`--cwd` 统一清洗，拒绝 `../` 逃逸 |

### 待挖掘/待验证问题（本轮新增）

| # | 问题 | 深挖价值 | 验证方案 |
|---|------|---------|---------|
| 6 | **CLI 命令分层认知负担** | 高 | 虽然 L4 已标记为 debug，但 `--help` 仍展示 20+ 命令，AI 消费者仍需在 20 个命令中做选择。验证：统计 SKILL.md 中 "WHEN TO USE" 的篇幅占比，若 >50% 花在命令选择上，说明分层暴露仍不足 |
| 7 | **Windows 兼容性补丁式累积** | 中 | 路径兼容不是通过统一抽象解决的，而是通过散落在 parser/resolver/git-tools/cli 各处的 `toPosixPath` 调用。验证：搜索 `toPosixPath` 调用点数量，若 >10 处，说明需要统一路径适配层 |
| 8 | ~~framework-patterns 与 framework-usage-patterns 职责边界~~ | 低 | ✅ **已修复**。`detectFrameworkFromPath` + `ENTRY_WEIGHT` 提取至 `project-context.js`；`framework-usage-patterns.js` 重命名为 `implicit-imports.js`；`framework-patterns.js` 现仅保留 AST_PATTERNS + `detectFrameworkFromContent` |
| 9 | ~~CLI `--help` 认知负担~~ | 中 | ✅ **已修复**。默认 `--help` 只展示 L1 核心命令（5 个），`--help --all` 展示完整列表；AI 消费者从 20 选 1 → 5 选 1 |

### 当前不做

- daemon / 常驻索引进程：违反 CLI-only 原则
- `--suggest` 修复代码自动生成：违反"结构分析 ≠ 语义分析"
- `--cross-repo` 跨仓库依赖分析：成本过高
- 污点追踪 / 跨文件数据流：运行时绑定问题仍解不了
- **`affectedRoutes` 端到端路由提取**：越界语义分析。路由注册（`app.get('/users/:id', handler)`）是运行时语义，不是静态 import 边。若未来要做，只能做成可选适配器，不可成为默认依赖

---

## 实战基地

> `C:\Users\sdses\Desktop\神思\code` 是 workspace-bridge 的实战基地，内含四个仓库，用于功能验证与实战演练。

---

*Last updated: 2026-05-21（REFACTOR Wave 2 D1-D3 edges 表 + loadGraph 快速恢复已完成；133/133 PASS）*

> **本轮验证状态**：`npm run test:fast` 93/93 PASS；基线 `node cli.js audit-summary --cwd . --json --quiet` 通过（`healthScore=7/8`，`deadExports=1`，`unresolved=0`，`cycles=0`，`coverageRatio=1.00`，`totalFiles=268`）。
> **实战基地量化**：3 个后端项目（Python 542 文件 / Java 395 文件 / Java 565 文件）`unresolved` 全部为 0 → SymbolRegistry 接入 resolver 的 immediate payoff 为 0，接入优先级降低，暂缓实施。
