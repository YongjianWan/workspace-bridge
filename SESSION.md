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
> 收工时已跑 `npm run test:fast` 并确认 fast 层全绿，开工无需重跑。全量 runner 状态见下方「基线状态」。直接读取下方「基线状态」确认当前文档记录是否仍成立。
>
> 开发迭代推荐 `npm run test:fast`（~16s，116 个 fast 层测试），比全量 runner（~5min）快 18×。

```bash
# 1. 快速自审（1 秒确认，不用等 runner，不读 CHANGELOG）
node cli.js audit-overview --cwd . --json --quiet
# 期望: summary.hotspots.length>0, summary.knowledgeRisk.high.length>=0, summary.orphans.length>=0, summary.deadExports.count>=0, summary.unresolved.count=0, summary.cycles.count>=0, summary.analysisCoverage.totalFiles≈315, summary.analysisCoverage.coverageRatio=1
```

**如果 audit-overview 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 历史变更见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `audit-overview` 输出正常（hotspots / knowledgeRisk / deadExports / unresolved / cycles）
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 4 架构债务 + 1 L3 + 0 项 P2 Dogfood 活跃缺陷）

---

## 基线状态

- 测试：**所有测试全部 PASS**；`npm run test:fast` **116/116 PASS**（~28s），`npm run test:smoke` **119/119 PASS**（~60s）。开发迭代首选 `npm run test:fast`；41 个测试文件已从 spawn 迁移到 in-process runner。
- CI：**GitHub Actions `Test` workflow 在 Node 22/24 矩阵上全部通过**（`test:fast` + `test:smoke`）；新增独立 `coverage` job 跑 `npm run test:coverage:check`（门槛：lines/statements ≥72%，functions ≥70%，branches ≥68%）。
- 版本：**v2.0.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~383 文件（entry=1, mainline=173, test=210）
- 结构性指标：deadExports=1（`shadow-candidates.js` 的 `SHADOW_EXTS` 静态分析误报，已标记为 `dynamic-registry-export` 低置信误报，不参与 severity），cycles=1，unresolved=0；overview 维度：hotspots>0，knowledgeRisk 默认 `disabledReason: 'history-not-enabled'`，`--with-history` 启用
- 架构债务：当前活跃 4 项，详见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。概要：① 框架检测 Query 语言等价性偏斜（Go/Rust/C/C++/Vue/Svelte 仍依赖 regex）；② 缓存默认目录位于 `os.tmpdir()` 导致易失；③ 缺少用户级配置目录；④ 缺少跨进程并发控制。
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验）
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**历史交付**：路线 A–J 全部完成；阶段 1/2/3 全部完成；Wave 1-15 全部完成；L2 债务清零；产品债务清零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 本轮发现与修复清单（2026-06-13）

> 以下混合了本轮审计发现与代码审查中发现的问题。状态按当前工作区真实结果标注；历史修复细节见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

### 已修复

| # | 问题 | 根因/位置 | 修复方式 | 验证 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 换行符污染 | 无 `.gitattributes`，`core.autocrlf=true`，80 个文件 working tree 为 CRLF | 新增 `.gitattributes` 强制 LF；`dos2unix` 规范化 | git status 无 EOL 噪声 |
| 2 | CI 使用 Node 20 | `.github/workflows/perf-guardrail.yml` | 升级到 Node 24 | workflow 文件 |
| 3 | 无常规测试 CI | 只有 perf + release workflows | 新增 `.github/workflows/test.yml` Node 22/24 矩阵 | workflow 文件 |
| 4 | Release 无测试门禁 | `release.yml` 直接 `npm pack` → `npm publish` | 增加 test:fast、test:smoke、tarball smoke test | workflow 文件 |
| 5 | `query-*` 快照 stale | `query-tools.js` 只比 gitHead + ±5 文件数 | 改为精确文件数 + `cache.checkFileChanges()` SHA-256 校验 | `test/query-staleness-test.js` |
| 6 | CLI 参数被 env 覆盖 | `validate-args.js` `resolveOption()` 先 env 后 cli | 改为 CLI > env > default | `test/wave14-noise-env-test.js` |
| 7 | `schemaVersion` 多处硬编码 | 6 个文件写死 `"1.2.0"` | 统一使用 `SCHEMA_VERSION` 常量 | grep 确认无残留 |
| 8 | `audit-assembler ↔ incremental-diff` 循环依赖 | `incremental-diff.js` 反向 require `filterByCategory` | 新增 `src/tools/category-filter.js` 共享模块 | `test/category-filter-cycle-test.js` |
| 9 | `--quiet` 仍泄漏 SQLite `ExperimentalWarning` | `node:sqlite` 在 `graph-db.js` 模块顶层加载，monkey-patch 来不及覆盖 | 延迟 require 到 `_ensureOpen()` 并在 suppress 后加载 | `test/graph-db-quiet-warning-test.js` |
| 15 | `workspace-info` 不是真正的轻量预检 | 仍初始化完整 ServiceContainer | `cli.js` 走轻量路径；`workspace-tools.js` 新增 `lightweightFileScan()` 快速统计文件数/语言分布 | `test/workspace-info-lightweight-test.js` |
| 17 | 部分布尔旗标仍读 raw | `--builtin-only`、`--watch`、`--strict-cwd` 未走 `resolveOption()` | 改为通过 `resolveOption()` 解析，支持 `WB_*` 环境变量 | `test/cli-bool-flags-env-test.js` |
| 18 | `category-filter.js` 的 `validateCategories` 未使用 | 新增但无调用方 | `validate-args.js` 的 `--category` 校验复用 `validateCategories()` | `test/category-filter-validate-used-test.js` |
| 16 | `process.emitWarning` 全局 monkey-patch | `graph-db.js` 替换全局 warning API | 改为 scoped `_withSqliteWarningSuppressed()` 包装器，`finally` 恢复原始函数 | `test/graph-db-warning-suppression-test.js` |
| 19 | `query-*` 未覆盖 config 变化 | `query-tools.js` snapshot 未存 config hash | `precomputed_aggregates` 新增 `config_hash` 列；保存/读取时比对 `.workspace-bridge.json` 配置摘要 | `test/query-staleness-test.js` |
| 11 | 动态 query registry 模块被误判为孤儿 | `orphan-detector.js` 未共享运行时 registry 可达性 | `framework-patterns.js` 导出 `getRegisteredQueryFiles()`；`dep-graph.js` 将 registry 可达路径传入 `findOrphanFiles()`；`orphan-detector.js` 新增 `registeredFiles` 参数跳过 registry 文件 | `test/orphan-registered-query-test.js` |
| 12 | `SHADOW_EXTS` 误报仍参与 severity | `shadow-candidates.js` 的 `SHADOW_EXTS` 被 `findDeadExports()` 判定为死导出并以 medium 置信度计入 severity | `analyzer.js` 对 `SHADOW_EXTS` 标记 `dynamic-registry-export` 低置信误报；`honesty-engine.js` 导出 `DEAD_EXPORT_FALSE_POSITIVE_REASONS`；severity 计算层（overview-curator、overview-assembler、repo-summary、commands/index.js）排除已知误报 | `test/dead-export-confidence-test.js`、`test/overview-curator-test.js`、`test/formatter-direct-test.js` |
| 10 | `audit-summary` / `audit-overview` 默认仍跑逐文件 blame | `overview-assembler.js` 无条件调用 `buildKnowledgeRisk()` 与 `buildHotspots(..., historyProvider)` | `validate-args.js` 新增 `--with-history`（高优先级修复）；`overview-tools.js` / `overview-assembler.js` 默认不再请求 blame，仅显式 provider 或 `--with-history` 启用；`query-knowledge-risk` 显式请求历史 | `test/overview-history-optional-test.js`；`npm run test:fast` **116/116 PASS** |
| 14 | Knowledge risk 对个人仓库失真 | `getFileKnowledgeRisk()` 逐文件 blame 将单作者仓库所有文件判 high risk；未提交行被计为 `Not Committed Yet` 作者 | `git-tools.js` 新增 `getRepoEffectiveAuthorCount()` 与 `isUncommittedAuthor()`；`overview-assembler.js` 在启用历史时检测 effective author count，<= 2 返回 `disabledReason: 'too-few-authors'`；human-formatters 展示禁用原因 | `test/knowledge-risk-test.js`、`test/overview-history-optional-test.js`；`npm run test:fast` **116/116 PASS** |
| 23 | CI Test workflow 在 Ubuntu 上失败 | path-utils 测试断言与 POSIX 行为不符；`java.js` regex fallback 的 `methodRegex` 字符类错误导致 AST 不可用时 functionRecords 为空；CI 未安装 javalang；`affected-tests-heuristic` Windows 路径测试在 POSIX 运行 | 修复 path-utils 测试断言；修正 `methodRegex` 字符类为 `[\w<>[]]`；`.github/workflows/test.yml` 安装 javalang；Windows 路径测试在 POSIX 跳过 | GitHub Actions `Test` workflow Node 22/24 全部通过；`npm run test:fast` **116/116 PASS**，`npm run test:smoke` **119/119 PASS** |
| 13 | 测试边污染生产架构指标 | REPL `top` 未过滤测试依赖；`audit-overview` 的 hotspot/coupling/coreModules 已使用 `{ architectureOnly: true }` 但仍需对齐所有交互入口 | `repl.js` 的 `top` 命令跳过测试文件并使用 `getDependents(..., { architectureOnly: true })` 计算生产依赖 | `test/repl-edge-test.js`；`npm run test:fast` **116/116 PASS** |
| 22 | Coverage 无最低门槛 | 有 `test:coverage` 但 CI 不跑 | 新增 `.c8rc.json` 设置全局门槛（lines/statements 72%，functions 70%，branches 68%）；`package.json` 新增 `test:coverage:check`；`.github/workflows/test.yml` 新增独立 `coverage` job | `npm run test:coverage:check` exit 0；`npm run test:fast` **116/116 PASS**；`npm run test:smoke` **119/119 PASS** |
| 21 | 大量 CLI spawn 测试未迁移 | ~44 文件仍 spawn；`runCliInProcess()` 导出但迁移率低 | `test/test-helpers.js` 新增 `runCliInProcess`/`runCliInProcessText`/`runCliInProcessRaw`；`cli.js` 修复 `--help` 输出；迁移 41 个测试文件；保留 REPL/watch/audit-file --watch/cache-concurrency/依赖进程级 config 隔离的测试 | `npm run test:fast` **116/116 PASS**；`npm run test:smoke` **119/119 PASS** |

### 仍待处理

| # | 问题 | 根因/位置 | 优先级 | 备注 |
| 20 | 测试分层标记未落地 | 202 个测试仅 68 个带 `@contract/@semantic` | 低 | AGENTS 规定未执行 |

---

## 已知陷阱（新 agent 必看）

| 陷阱 | 位置 | 如何避免 |
| :--- | :--- | :--- |
| `DEFAULT_EXCLUDE_DIRS` 全局污染 | `src/services/file-index.js` | 任何新增排除项必须是通用目录名（如 `node_modules`），不能是项目特定名称 |
| orphan 检测不同步 | `project-map.js` vs `overview-tools.js` | 两处 orphan 逻辑必须保持同步（scripts/bin/benchmark 跳过） |
| compact 模式只改 project-map.js | `cli.js` 也需要同步 | human-readable 输出和 `countTreeFiles()` 必须兼容 skeleton 模式（`totalFileCount`） |
| Windows PowerShell 管道 BOM | 所有 `node cli.js ... \| node -e` 命令 | PowerShell 管道传 JSON 会带 BOM，导致 `JSON.parse` 必 crash。当前 workaround：用文件中转（`> file`）再读取 |
| cache.save() 已改为 async | `src/services/cache.js` | 调用方必须 `await`（container.js、测试均已适配） |
| repl-test.js flaky | `test/repl-test.js` | runner.js 串行执行时偶发失败，单独 `node test/repl-test.js` 稳定通过；若遇到，先重跑确认 |
| audit-file-watch-test.js flaky | `test/audit-file-watch-test.js` | runner.js 串行执行时 watcher 事件偶发丢失，单独 `node test/audit-file-watch-test.js` 稳定通过 |
| `framework-patterns.js` 新增框架时 | `src/services/dep-graph/framework-patterns.js` | 路径检测逻辑按语言分块，新增语言需同时更新 `isEntry` 标记和测试 |
| `buildFileValidationAdvice` 导出链 | `validation-advice.js` → `index.js` → `cli.js` | 新增 formatter 函数必须在 `src/cli/formatters/index.js` 中显式导出，否则 cli.js 解构为 `undefined` |
| `--quiet` 不再 monkey-patch `console.error` | `cli.js` / `container.js` | `quiet` 通过 `ServiceContainer` 传递；错误日志仍用 `console.error` |
| `findDeadExports()` edges/files 降级 | `src/services/dep-graph.js` | 单文件项目（files=1）不受降级影响；多文件项目 edges/files < 0.1 时 confidence 降为 low |
| `.workspace-bridge-cache.json.bak` 泄漏到 git status | `src/tools/git-tools.js` | `getChangedFiles()` 已排除 `.bak` 备份文件，防止 audit-diff 误报 |
| `resolvers.js` 策略链新增策略 | `src/services/dep-graph/resolvers.js` | 新增语言需在 `registerResolverConfig()` 中加一行，策略函数签名 `(importPath, fromFile, ctx) => string\|null` |
| `checkFileChanges()` 双路径 | `src/services/cache.js` | fast path（mtime+size）+ slow path（SHA-256）。修改 staleness 逻辑时必须保持双路径行为 |
| 动态 require 导致死导出误报 | `src/services/dep-graph/framework-patterns.js` | `dead-exports` 无法静态分析 `ROUTE_QUERY_REGISTRY` 动态 require，可忽略或加白 |
| C/C++ `#include` resolver 语义限制 | `src/services/dep-graph/parsers/registry.js` | C/C++ 对系统头、`-I` 搜索路径支持较弱，`unresolved` 可能偏高 |
| Vue/Svelte 路由提取设计选择 | `src/services/dep-graph/framework-patterns.js` | Nuxt/SvelteKit 路由 query 只处理 `.ts` server handler；SFC 本身不提取路由 |

---

## 本轮上下文：参考仓库探索与架构借鉴（活跃）

> **背景**：为验证蓝图的技术可行性和避免闭门造车，对参考仓库进行了主动同步与架构对标。

### 参考仓库状态

| 仓库 | 旧 HEAD | 新 HEAD | 变更规模 | 关键更新 |
| :--- | :--- | :--- | :--- | :--- |
| **CodeGraphContext** | `5b1a1f6` | `fb093bb` | 39 文件 | E2E Bug 报告扩充、writer 路径规范化测试、watcher 轮询观察器测试 |
| **GitNexus** | `b9a17f55` | `1716bf7c` | 1629 文件 | 多语言 scope resolution 大重构、PR Swarm Review、devcontainer、i18n、CLI `uninstall`、graph-assisted 路由提取 |
| **code-review-graph** | `0c9a5ff` | `0c9a5ff` | — | 已是最新。Python MCP server，tree-sitter + SQLite，Leiden 聚类，5 维度 risk scoring |
| **qartez-mcp** | `ac6fec2` | `ac6fec2` | — | 已是最新。Rust MCP server + CLI 双模式，37 语言 tree-sitter，workspace fingerprint 增量，6 层启发式 scope resolution |

### GitNexus 架构探索摘要（7 个维度）

| 维度 | GitNexus 核心做法 | 对 workspace-bridge 的借鉴价值 |
| :--- | :--- | :--- |
| **1. 语言插件管道** | `LanguageProvider` + `ScopeResolver` 双契约；`satisfies Record<SupportedLanguages, LanguageProvider>` 编译时穷举表；统一捕获标签 | **高** → Wave 13-1 语言注册表统一契约可直接引用此模式，替代当前约定俗成的 parser 返回结构 |
| **2. Scope Resolution** | 通用编排器 + 语言钩子；SCC 有序跨文件返回类型传播；MRO-aware dispatch | **中** → workspace-bridge 定位"结构分析 ≠ 语义分析"，不追求完整 call graph，但 **3-tier import resolution** 和 **confidence-tiered edges** 可直接强化 Wave 10 的置信飞轮 |
| **3. Call Graph** | 跨文件、receiver-bound、arity/type-aware overload 消解 | **低（当前不做）** → 超出项目定位 |
| **4. 路由提取** | **Graph-first** 策略：优先复用 ingestion 时已产生的 `HANDLES_ROUTE` edges（符号级），fallback 才走 tree-sitter source-scan | **高** → 对应下一步**方向 2**。实施路径：将路由提取从 `savePrecomputed` 的同步 source-scan 前移到 `builder.js` parse phase，AST-based 提取并关联 handler 符号 |
| **5. PR Swarm Review** | CLI-neutral canonical spec + 薄 wrapper；7 persona 分 lane 执行；model-tier routing；Synthesis Critic 硬 gate | **中** → Wave 12 输出精炼可借鉴其结构化 finding 格式 |
| **6. 增量更新** | **Shadow-candidate 枚举**；**1-hop boundary expansion**；chunk-level parse cache | **高** → Wave 15-4 增量更新已引入 shadow-candidates + 1-hop boundary expansion，解决了跨文件边元数据 stale 问题 |
| **7. 图存储** | LadybugDB（KuzuDB 派生）；edge evidence traces | **中** → SQLite 足够；但 **edge evidence traces** 可作为 Wave 11-4 统一 risk scoring 的输入 |

### CodeGraphContext 架构探索摘要

| 维度 | CGC 核心做法 | 对 workspace-bridge 的借鉴价值 |
| :--- | :--- | :--- |
| **1. 整体管道** | Discovery → Pre-scan（全局 `imports_map`）→ Parse → Write Pass 1 → Write Pass 2 | **中** → 两阶段写入（nodes first, edges second）与 Wave 10 的 Parse-and-Link 一致 |
| **2. 多数据库后端** | Neo4j/FalkorDB/KuzuDB/LadybugDB/Nornic 五后端 | **低** → SQLite 关系模型对 CLI 更务实 |
| **3. SCIP 混合索引** | 可选 SCIP + Tree-sitter overlay | **中** → "SCIP 验证/覆盖 heuristic edges"的模式可作为未来 **strict mode** 的设计参考 |
| **4. Watcher 增量更新** | `watchdog` 轮询/事件驱动；2s debounce；**O(k) 邻居重链接** | **高** → CGC 的 "query neighbors before delete" 是 watch 模式的最佳实践 |
| **5. Bundle 系统** | `.cgc` ZIP 预索引图快照 | **低** → 我们的 SQLite cache 已是等价物 |
| **6. 路径规范化** | `Path(p).resolve().as_posix()` 强制正斜杠 | **高** → **stark warning**。已审计并修复 `path.js` 跨平台路径回归，防范 Windows 反斜杠查询静默失败 |
| **7. API/MCP 层** | FastAPI + MCP SSE server | **低** → 明确排除，保持 CLI-only |
| **8. 测试策略** | Golden tests；E2E parity tests | **高** → 计划引入 parser golden snapshot 测试和路径回归测试 |

### code-review-graph 架构探索摘要

| 维度 | CRG 核心做法 | 对 workspace-bridge 的借鉴价值 |
| :--- | :--- | :--- |
| **1. 整体定位** | Python MCP server，tree-sitter + SQLite | **中** → 验证了 "tree-sitter + SQLite + impact radius" 方向的市场价值 |
| **2. 核心图模型** | 节点 = `File`/`Class`/`Function`，边 = `CALLS`/`IMPORTS_FROM`等；递归 CTE 查找 | **高** → SQLite recursive CTE 做 BFS，可评估迁移以减少 JS-side BFS 内存占用 |
| **3. Leiden 聚类** | igraph 依赖， co-change cohesion 计算 | **中** → 可直接用于增强 `audit-boundaries` 目录划分 |
| **4. Risk Scoring** | 5 维度加法模型（flow + community + test + security + caller），max 聚合 | **高** → 直接对应 Wave 11-4 "统一 risk scoring（5 维度）" |

### qartez-mcp 架构探索摘要

| 维度 | qartez 核心做法 | 对 workspace-bridge 的借鉴价值 |
| :--- | :--- | :--- |
| **1. 整体架构** | Rust MCP server + CLI 双模式，SQLite WAL+mmap | **中** → `OutputFormat` 枚举设计更干净 |
| **2. 解析与图构建** | shape hash；`owner_type`/`parent_idx` 捕获 | **高** → 强化 `functionRecords`/`exportRecords` 以改善方法重载消解（method disambiguation） |
| **3. Scope Resolution** | 6 层启发式逻辑；`via_method_syntax` 规避泛型迭代器 | **高** → `via_method_syntax` 防止类似 `map`/`filter` 的迭代器方法在 JS 中产生大量跨文件 false edges |
| **4. Workspace/Monorepo** | 自动解析包管理器配置文件中的 workspace 定义 | **中** → 对应 Wave 14-4 自动发现 |
| **5. ParseCache 与增量** | Workspace fingerprint 级别的冷启动跳过 | **高** → 替代逐文件 mtime 检查，实现 cold-start 秒级跳过 |

### 借鉴优先级与 Wave 映射

| 优先级 | 借鉴点 | 对应 Wave | 预计改动文件 | 设计参考 |
| :--- | :--- | :--- | :--- | :--- |
| **P0** | 1-hop 边界扩展增量更新 | 15-4 | `builder.js` | ✅ 已交付 (GitNexus 模式) |
| **P0** | 框架检测 query 化 | 15-2 | `framework-patterns.js` | ✅ 已交付 (Java/Kotlin/Python/JS) |
| **P1** | 语言注册表显式契约 | 13-1 | `parsers/registry.js` | ✅ 已交付 (GitNexus 模式) |
| **P1** | Edge evidence traces | 强化 Wave 10 | `builder.js`, `graph-db.js` | ⏳ 规划中 |
| **P2** | Graph-first 路由提取 | 修复 L3 | `builder.js`, `persistence.js` | **方向 2（待开发）** |
| **P3** | Parser golden snapshot 测试 | 补测试 | `test/` | ⏳ 规划中 |

---

## 本轮已交付（活跃上下文摘要）

> 以下只保留最近一轮的关键交付，便于新会话快速接上状态。完整历史见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

- **Wave A 工程稳定化**：新增 `.gitattributes` 并规范化 80 个 CRLF 文件；修复 CI Node 版本不匹配；新增常规测试 CI；为 release 流程增加 test + tarball smoke gate。
- **Wave B 数据一致性**：修复 `query-*` 快照 staleness（增加 SHA-256 内容校验 + 精确文件数匹配）；修复 CLI 参数优先级（CLI > env）；统一 `schemaVersion` 来源；新增 `src/tools/category-filter.js` 打破 `audit-assembler ↔ incremental-diff` 循环依赖。
- **Wave 15-2 框架检测 AST-Query 化收官**：Java/Kotlin（Spring、Spring Boot、Ktor）与 Python（Django、FastAPI、Flask、Celery）全部完成 AST-Query 提取；`framework-patterns.js` 为已 query 化语言增加 `preFilterRe`，避免 `@bp.route`、`@worker.task` 等非常规写法被 cheap pre-filter 跳过。
- **方向 5 轻量预检修复**：`workspace-info` 改为真正轻量命令，`cli.js` 跳过完整 `ServiceContainer` 初始化，直接复用 `workspaceInfo()` 与新增 `lightweightFileScan()` 进行快速文件数/语言分布统计；实测 `<1s`，与 skill 宣称 `<2s` 对齐。
- **方向 4 策展可信度（#10/#14）**：`audit-overview` / `audit-summary` 默认不再跑逐文件 blame/history，新增 `--with-history` 显式开关；`buildKnowledgeRisk()` 对 effective author count <= 2 的个人/单作者仓库返回 `disabledReason` 并跳过昂贵 blame；`git blame` 过滤 `Not Committed Yet` 等伪作者；`query-knowledge-risk` 自动启用历史计算。
- **架构债务状态**：从参考仓库对比报告（code-review-graph / qartez-mcp / CodeGraphContext）中提炼出 3 项新增架构债务并入 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)：缓存默认目录在项目外易失、缺少用户级配置目录、缺少跨进程并发控制。原有框架检测 Query 语言等价性偏斜仍在（Java/Kotlin/Python/JS/TS 已完成；Go/Rust/C/C++/Vue/Svelte 仍依赖 regex）。
- **测试状态**：`npm run test:fast` **116/116 PASS**，`npm run test:smoke` **119/119 PASS**。

---

## 下一步候选方向与多语言框架检测矩阵

### 候选方向状态（更新于 2026-06-13）

*   **方向 1：Java / Kotlin 框架检测 Query 化**
    *   **状态**：✅ 已于 2026-06-13 交付。
    *   **内容**：新建了 `java-spring.js`、`java-spring-boot.js`、`kt-spring.js`、`kt-ktor.js` 动态 Query 模块，并完成注册与测试。

*   **方向 2：Graph-first 路由提取升级**
    *   **状态**：⏳ 待开发。
    *   **理由**：ROADMAP 中标记为 P2 高价值，能让 `impact` 输出的 `affectedRoutes[]` 走图查询，而不是重新进行高开销的 source-scan。
    *   **交付物**：在 `builder.js` 的 parse phase 把 `extractRoutes` 结果写成 `HANDLES_ROUTE` 边或节点属性，重构 `impact` 使其通过图查询获取 affectedRoutes。

*   **方向 3：CLI 可测试化入口**
    *   **状态**：✅ 已交付（`cli.js` 已导出 `runCliInProcess()`）。
    *   **遗留**：大量测试仍使用 child process spawn，迁移率低；文档中曾仍列为待开发，已修正。

*   **方向 4：策展可信度（Wave C）**
    *   **状态**：🔄 部分交付，高优先级。
    *   **已完成**：动态 registry 模块已纳入 orphan 可达性（#11）；`SHADOW_EXTS` 等已知误报已排除 severity（#12）；个人仓库 knowledge risk 已关闭/降级（#14）；默认 overview 已不再跑逐文件 blame（#10）。
    *   **待完成**：架构指标默认排除 test→source 边（#13）。

*   **方向 5：Agent 产品形态（Wave D）**
    *   **状态**：🔄 部分交付，中优先级。
    *   **已完成**：`--quiet` 下 SQLite warning 泄漏已修复（#9）；`workspace-info` 已改为真正轻量命令（#15），实测 `<1s`；默认 `audit-overview` 已跳过逐文件 blame（#10），热缓存从 ~56s 降至 ~16s。
    *   **待完成**：继续将详细维度下沉到 `query-*`，把默认基线压到热缓存 <2s、JSON <8KB。

---

### 多语言框架检测与路由提取支持矩阵

| 语言 | 框架 | 框架检测方式 | 已有 route-extraction query？ |
| :--- | :--- | :--- | :--- |
| JS/TS | NestJS | regex (`AST_PATTERNS`) | ✅ `js-nestjs.js` |
| | Vue / Vue-router | regex + 路径推断 | ❌ |
| | Nuxt | 路径推断 + route query | ✅ `js-nuxt.js` |
| | SvelteKit | 路径推断 + route query | ✅ `js-sveltekit.js` |
| Java | Spring / Spring Boot | ✅ AST-Query (`java-spring.js` / `java-spring-boot.js`) | ✅ `java-spring.js` |
| | Quartz | regex | ❌ |
| | MyBatis | regex | ❌ |
| Kotlin | Spring-Kotlin | ✅ AST-Query (`kt-spring.js`) | ❌（复用 Java route） |
| | Ktor | ✅ AST-Query (`kt-ktor.js`) | ❌ |
| Go | Gin | regex | ✅ `go-gin.js` |
| | Echo | regex | ❌ |
| | Fiber | regex | ✅ `go-fiber.js` |
| Rust | Actix-web | regex | ✅ `rs-actix.js` |
| | Axum | regex | ✅ `rs-axum.js` |
| | Rocket | regex | ❌ |
| C/C++ | 无特定框架标签 | 纯路径推断 | ❌ |
| Svelte | Svelte / SvelteKit | 纯路径推断 | ✅ `js-sveltekit.js` |
| Vue | Vue 组件 / Vue-router | 路径推断 + regex macro | ❌ |

---

## 修复流程（严谨版，新 Agent 必遵守）

```
1. 读问题 → 2. 读复现命令 → 3. 本地复现 → 4. 读目标文件 → 5. 写失败测试 →
6. 修复根因 → 7. 跑 test:fast → 8. 跑全量 runner → 9. 更新 CHANGELOG.md → 10. 标记 dogfood 问题为已修复
```

**铁律**：
- **没有失败测试，不许写修复代码**（TDD）
- **改高危文件前必须跑 impact + affected-tests**（`path.js` / `constants.js` / `dep-graph.js` / `cache.js` / `graph-db.js` / `parsers/shared.js` / `resolvers.js`）
- **每波只修该波的问题**，不能跨波次混修
- **每波收工前必须 `npm run test:fast` 116/116 PASS + 全量 runner 119/119 PASS**
- **每次修复后在 CHANGELOG.md [Unreleased] 追加条目**（单条不超过 3 行）

---

## 实战基地

> `C:\Users\sdses\Desktop\神思\code` 是 workspace-bridge 的实战基地，内含四个仓库，用于功能验证与实战演练。

---

*Last updated: 2026-06-14（修复 CI 跨平台失败 #23；新增 CI coverage gate #22；迁移 41 个测试文件到 in-process runner #21；npm run test:fast 116/116 PASS，npm run test:smoke 119/119 PASS，npm run test:coverage:check 通过；schemaVersion: 1.2.0；version: 2.0.0）*
