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
> 开发迭代推荐 `npm run test:fast`（~20s，84 个 fast 层测试），比全量 runner（~5min）快 15×。

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
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 1 L3 + 1 架构债务 + 0 项 P2 Dogfood 活跃缺陷）

---

## 基线状态

- 测试：**受影响测试全部 PASS**；`npm run test:fast` **95/95 PASS**（~10s），`npm run test:smoke` **98/98 PASS**（~32s）。全量 runner 本轮未跑完（`e2e-gitnexus-test.js` 在 reference/GitNexus 上超时/失败，与 Wave 12 改动无关），开发迭代首选 `npm run test:fast`。当前 fast 层 95 个测试，slow 层 71 个，serial 层 7 个.
- 版本：**v2.0.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~339 文件（entry=1, mainline=152, test=187）
- 结构性指标：deadExports=0，cycles=0，unresolved=0；overview 维度：hotspots>0，knowledgeRisk 按实际分布
- 注意：`healthScore=5/5` 是文件存在性检查（README/LICENSE/.gitignore/Dockerfile），**不反映代码质量**，已废弃
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验）
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**历史交付**：路线 A–J 全部完成；阶段 1/2/3 全部完成；Wave 1/2/3/4/5/6 已完成；L2 债务清零；产品债务清零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 已知陷阱（新 agent 必看）

| 陷阱                                                   | 位置                                                   | 如何避免                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_EXCLUDE_DIRS` 全局污染                      | `src/services/file-index.js`                         | 任何新增排除项必须是通用目录名（如 `node_modules`），不能是项目特定名称                                                           |
| orphan 检测不同步                                      | `project-map.js` vs `overview-tools.js`            | 两处 orphan 逻辑必须保持同步（scripts/bin/benchmark 跳过）                                                                          |
| compact 模式只改 project-map.js                        | `cli.js` 也需要同步                                  | human-readable 输出和 `countTreeFiles()` 必须兼容 skeleton 模式（`totalFileCount`）                                             |
| Windows PowerShell 管道 BOM                            | 所有 `node cli.js ... \| node -e` 命令                | PowerShell 管道传 JSON 会带 BOM，导致 `JSON.parse` 必 crash。**这是主要消费路径上的 broken pipe**，修法：JSON 输出时 strip BOM，或用 Buffer 写 stdout 绕过 PowerShell 编码。当前 workaround：用文件中转（`> file`）再读取                                              |
| cache.save() 已改为 async                              | `src/services/cache.js`                              | 调用方必须 `await`（container.js、测试均已适配）                                                                                  |
| repl-test.js flaky                                     | `test/repl-test.js`                                  | runner.js 串行执行时偶发失败，单独 `node test/repl-test.js` 稳定通过；若遇到，先重跑确认                                          |
| audit-file-watch-test.js flaky                         | `test/audit-file-watch-test.js`                      | runner.js 串行执行时 watcher 事件偶发丢失，单独 `node test/audit-file-watch-test.js` 稳定通过；根因与 repl-test.js 同类（串行调度时序竞争） |
| `framework-patterns.js` 新增框架时                   | `src/services/dep-graph/framework-patterns.js`       | 路径检测逻辑按语言分块，新增语言需同时更新 `isEntry` 标记和测试                                                                   |
| `buildFileValidationAdvice` 导出链                   | `validation-advice.js` → `index.js` → `cli.js` | 新增 formatter 函数必须在 `src/cli/formatters/index.js` 中显式导出，否则 cli.js 解构为 `undefined`                              |
| `--quiet` 不再 monkey-patch `console.error`        | `cli.js` / `container.js`                          | `quiet` 通过 `ServiceContainer` → `FileIndex` / `DependencyGraph` 传递；信息性日志条件输出，错误日志仍用 `console.error` |
| `findDeadExports()` edges/files 降级                 | `src/services/dep-graph.js`                          | 单文件项目（files=1）不受降级影响；多文件项目 edges/files < 0.1 时 confidence 降为 low                                              |
| `.workspace-bridge-cache.json.bak` 泄漏到 git status | `src/tools/git-tools.js`                             | `getChangedFiles()` 已排除 `.bak` 备份文件，防止 audit-diff 误报                                                                |
| `resolvers.js` 策略链新增策略                        | `src/services/dep-graph/resolvers.js`                | 新增语言需在 `registerResolverConfig()` 中加一行，策略函数签名 `(importPath, fromFile, ctx) => string\|null`                     |
| `checkFileChanges()` 双路径                          | `src/services/cache.js`                              | fast path（mtime+size）+ slow path（SHA-256）。修改 staleness 逻辑时必须保持双路径行为                                              |
| 动态 require 导致死导出误报                           | `src/services/dep-graph/framework-patterns.js`       | `dead-exports` 无法静态分析 `ROUTE_QUERY_REGISTRY` 动态 require，且 `java-spring.js` 无法命中 JS 启发式豁免，被判定为死导出。不影响运行，可忽略或加白 |
| `bootstrapFromSchema` key 规范化不匹配               | `src/services/orchestrator.js`                       | fromSchema 原样使用 schema 键值而未规范化路径。Windows Mock 测试中需手动建图或通过 normalize 适配，否则易发生键查找失败 |

---

## 本轮上下文：文档规范与历史归档（活跃）

> **背景**：在经历了 Wave 1-6 大规模 Dogfood 修复波次以及性能、状态机 O6 重构后，主线任务已全部圆满交付。
> 根据项目文档规范，“历史只在 changelog 里面有，活跃文档只存当前状态”。

### 本轮已交付
> **本轮验证状态**：基线命令 `node cli.js audit-overview --cwd . --json --quiet` 100% 成功执行，无 unresolved import，自身库全量覆盖率 1.00。
> **本轮完成**：
> 1. **Wave 12 输出精炼补全**：完成 12-3 分层输出过滤（`--category dead-exports/unresolved/cycles/health` 在 `audit-summary`/`audit-overview` 中过滤并置空未选类别，`--severity` 文档修正为 `high|medium|low`）；完成 12-4 大项目自动截断（基于项目总文件数 `DEFAULTS.LARGE_PROJECT_FILE_THRESHOLD: 500` 自动启用 `--compact`，`--no-compact`/`--compact`/`WB_COMPACT` 显式覆盖）；完成 12-5 大项目手动截断（`--max-files <n>` 限制 `audit-diff` 变更文件数及 `impact`/`affected-tests`/`affected-routes`/`dependencies`/`dependents`/`tree` 返回结果数）。新增 `test/wave12-large-project-compact-test.js`，扩充 `test/wave12-output-truncation-test.js` `--max-files` 命令层用例。`npm run test:fast` **95/95 PASS**，`npm run test:smoke` **98/98 PASS**。
---

## 本轮上下文：参考仓库探索与架构借鉴（活跃）

> **背景**：workspace-bridge 的 Wave 9–10 已交付，下一步 Wave 11–15 的方向已明确。为验证蓝图的技术可行性和避免闭门造车，对参考仓库进行了主动同步与架构对标。

### 参考仓库状态

| 仓库 | 旧 HEAD | 新 HEAD | 变更规模 | 关键更新 |
|------|---------|---------|----------|----------|
| **CodeGraphContext** | `5b1a1f6` | `fb093bb` | 39 文件 | E2E Bug 报告扩充、writer 路径规范化测试、watcher 轮询观察器测试 |
| **GitNexus** | `b9a17f55` | `1716bf7c` | 1629 文件 | 多语言 scope resolution 大重构（16 语言独立 `captures/query/scope-resolver` 管道）、PR Swarm Review（7  persona 多 agent 审查）、devcontainer、i18n、CLI `uninstall`、graph-assisted 路由提取 |
| **code-review-graph** | `0c9a5ff` | `0c9a5ff` | — | 已是最新。Python MCP server，tree-sitter + SQLite，Leiden 聚类，5 维度 risk scoring |
| **qartez-mcp** | `ac6fec2` | `ac6fec2` | — | 已是最新。Rust MCP server + CLI 双模式，37 语言 tree-sitter，workspace fingerprint 增量，6 层启发式 scope resolution |

### GitNexus 架构探索摘要（7 个维度）

| 维度 | GitNexus 核心做法 | 对 workspace-bridge 的借鉴价值 |
|------|-------------------|-------------------------------|
| **1. 语言插件管道** | `LanguageProvider` + `ScopeResolver` 双契约；`satisfies Record<SupportedLanguages, LanguageProvider>` 编译时穷举表；统一捕获标签（`@definition.class`、`@reference.call.member` 等） | **高** → Wave 13-1 语言注册表统一契约可直接引用此模式，替代当前约定俗成的 parser 返回结构 |
| **2. Scope Resolution** | 通用编排器 + 语言钩子；SCC 有序跨文件返回类型传播；MRO-aware dispatch；显式契约不变量（I1–I9） | **中** → workspace-bridge 定位"结构分析 ≠ 语义分析"，不追求完整 call graph，但**3-tier import resolution**（same-file → import-scoped → global）和 **confidence-tiered edges** 可直接强化 Wave 10 的置信飞轮 |
| **3. Call Graph** | 跨文件、receiver-bound、arity/type-aware overload 消解 | **低（当前不做）** → 超出项目定位，但 Worker-serialized `ParsedFile` 的并行解析模式可为 Wave 15-3 ParseCache 提供参考 |
| **4. 路由提取** | **Graph-first** 策略：优先复用 ingestion 时已产生的 `HANDLES_ROUTE` edges（符号级），fallback 才走 tree-sitter source-scan；`HttpLanguagePlugin` 契约（`scanFile` + `scanProject`） | **高** → 直接修复 TECH_DEBT.md L3 品味问题（`extractRoutes` regex + 固定 3200 字节扫描）。实施路径：将路由提取从 `savePrecomputed` 的同步 source-scan 前移到 `builder.js` parse phase，AST-based 提取并关联 handler 符号 |
| **5. PR Swarm Review** | CLI-neutral canonical spec + 薄 wrapper；7 persona 分 lane 执行；model-tier routing（Haiku 机械验证 / Sonnet 分析）；Synthesis Critic 硬 gate | **中** → Wave 12 输出精炼可借鉴其结构化 finding 格式（Risk / Evidence / Recommended fix / Blocks merge） |
| **6. 增量更新** | **Shadow-candidate 枚举**（`.ts` shadow `.tsx`、`foo.ts` shadow `foo/index.ts`）；**1-hop boundary expansion**（变更文件邻居自动纳入重写）；chunk-level parse cache | **高** → Wave 15-4 增量更新终极协议可直接引入 shadow-candidates + 1-hop boundary expansion，解决 `updateFiles()` 只处理直接变更文件导致的跨文件边元数据 stale 问题 |
| **7. 图存储** | LadybugDB（KuzuDB 派生）；edge evidence traces（`{ kind, weight, note }[]`）；in-memory 3-tier lookup index；atomic swap with sidecar awareness | **中** → workspace-bridge 已用 SQLite 足够；但 **edge evidence traces** 可作为 Wave 11-4 统一 risk scoring 的输入——给 edges 的 `confidence` 附加可审计的推理链（如 `kind: 'ambiguous-symbol', note: '3 candidates, picked nearest'`） |

### CodeGraphContext 架构探索摘要（8 个维度）

| 维度 | CGC 核心做法 | 对 workspace-bridge 的借鉴价值 |
|------|-------------|-------------------------------|
| **1. 整体管道** | Discovery → Pre-scan（全局 `imports_map`）→ Parse（tree-sitter）→ Write Pass 1（nodes）→ Write Pass 2（edges：inheritance/calls/language-specific）→ Optional（embeddings） | **中** → 两阶段写入（nodes first, edges second）与 workspace-bridge Wave 10 的 Parse-and-Link 方向一致，验证了阶段拆分的正确性；Pre-scan 全局符号映射对应 Wave 10-1/ROADMAP L475 |
| **2. 多数据库后端** | Neo4j/FalkorDB/KuzuDB/LadybugDB/Nornic 五后端；Kuzu 适配层是 ~400 行 regex 驱动的 Cypher 翻译器（处理 `SET n += $props` → 显式赋值、`uid` 注入、`UNWIND` fallback 等） | **低** → **反面教材**：强类型嵌入式图数据库需要 massive compatibility shim。workspace-bridge 的 SQLite 关系模型是更务实的 CLI 选择。但 `DatabaseManager` + `get_backend_type()` 单例模式可作为未来扩展的参考 |
| **3. SCIP 混合索引** | 可选 SCIP（编译器级精度）+ Tree-sitter overlay（补充 source text / CC / decorators）。SCIP 失败时自动 fallback 到 Tree-sitter | **中** → workspace-bridge 零配置定位不适合 SCIP 做主路径，但"SCIP 验证/覆盖 heuristic edges"的模式可作为未来 **strict mode** 的设计参考 |
| **4. Watcher 增量更新** | `watchdog` 轮询/事件驱动；2s debounce；**O(k) 邻居重链接**：① 变更前查询 DB 获取 caller/inheritor 邻居 → ② 更新 `imports_map` → ③ `DETACH DELETE` 变更文件 → ④ 删除邻居的 stale 出边 → ⑤ 重新解析变更文件+邻居 → ⑥ 从 DB 拉取 class lookup（避免全量重解析）→ ⑦ 重新 link | **高** → 如果 workspace-bridge 未来添加 watch 模式，CGC 的"query neighbors before delete"是最佳实践；`updateFiles()` 当前只处理直接变更文件，不处理邻居的 stale 边 |
| **5. Bundle 系统** | `.cgc` ZIP = 预索引图快照（nodes.jsonl + edges.jsonl + metadata.json + schema.json），支持 HuggingFace registry 分发 | **低** → CLI-only 工具不需要 bundle 分发；workspace-bridge 的 SQLite cache 就是等价物 |
| **6. 路径规范化** | `Path(p).resolve().as_posix()` 强制正斜杠；`_normalize_prefix` 确保 `STARTS WITH` 查询正确。新增 `test_writer_path_normalization.py`（361 行）作为回归防护 | **高** → **stark warning**：CGC 因 Windows 反斜杠导致 `STARTS WITH` 查询静默失败。workspace-bridge `path.js` 是高危改动文件，需审计存储路径是否统一为正斜杠（或已建立一致的 path abstraction） |
| **7. API/MCP 层** | FastAPI + MCP SSE server；`MCPServer` 单例编排器；handlers 是纯函数注入依赖 | **低（当前不做）** → AGENTS.md 明确 CLI-only。但 handler-injection 模式（纯函数 + 依赖注入）可作为未来 CLI 命令拆分的参考 |
| **8. 测试策略** | ① mock DB 的单元测试 ② **Golden tests**（`fixtures/goldens/` 存储 parser 预期输出，`--update-goldens` 刷新）③ **E2E parity tests**（4 后端索引后对比 node/edge 数量，±6 容差）④ Smoke tests ⑤ CLI 测试 | **高** → workspace-bridge 88 个 fast tests 中缺少 parser golden snapshot 测试和跨平台路径回归测试；CGC 的 `test_writer_path_normalization.py` 正是 `path.js` 应该补的测试类型 |

### code-review-graph 架构探索摘要（6 个维度）

| 维度 | CRG 核心做法 | 对 workspace-bridge 的借鉴价值 |
|------|-------------|-------------------------------|
| **1. 整体定位** | Python MCP server，tree-sitter + SQLite，目标：让 AI review 只读"blast radius"而非全仓库，宣称 38×–528× token 减少 | **中** → 验证了"tree-sitter + SQLite + impact radius"这个产品方向的市场价值。但 MCP-first 与 workspace-bridge CLI-only 定位不同 |
| **2. 核心图模型** | `GraphStore` (SQLite)：nodes = `File`/`Class`/`Function`/`Type`/`Test`，edges = `CALLS`/`IMPORTS_FROM`/`INHERITS`/`IMPLEMENTS`/`CONTAINS`/`TESTED_BY`/`DEPENDS_ON`/`REFERENCES`，带 `confidence` + `confidence_tier`。BFS 用 **SQLite recursive CTE**（NetworkX 为 fallback） | **高** → SQLite recursive CTE 做 BFS 是已验证的模式，workspace-bridge 当前做 JS-side BFS，可评估迁移到 SQL CTE 以减少内存占用（双边冗余内存问题） |
| **3. Leiden 聚类** | `igraph` 可选依赖，edge weight 调参（`CALLS=1.0` → `CONTAINS=0.3`），resolution 随图大小自适应（`max(0.05, 1.0/log10(n_nodes))`），无 igraph 时 fallback 到目录层级分组。计算 cohesion = internal / (internal + external)，跨社区耦合 >10 条边时警告 | **中** → workspace-bridge 尚无社区检测。Leiden 聚类 + cohesion 可直接增强 `audit-boundaries`（Wave 11-1）。目录 fallback 对零依赖场景很重要 |
| **4. Risk Scoring** | 5 维度加法模型（flow participation + cross-community callers + test coverage gap + security keyword + caller count），**max 聚合**后取 top 10 `review_priorities`。另有 hub/bridge/surprise scoring | **高** → 直接对应 Wave 11-4 "统一 risk scoring（5 维度）"。CRG 的公式是现成参考：max(flow×0.25, community×0.15, coverage×0.30, security+0.20, callers/20×0.10)。surprise scoring（跨社区+0.3、跨语言+0.2）可增强 architecture advice |
| **5. 测试策略** | 1:1 test-to-module 映射，`eval/` 目录有 YAML 配置 benchmark（token_efficiency、impact_accuracy、flow_completeness、search_quality 等），无 golden snapshot | **中** → eval/ 的 YAML 驱动 benchmark 比 workspace-bridge 的 ad-hoc `benchmark/` 更系统。precision/recall/F1 框架可直接用于验证 impact accuracy 和 mapping hit-rate |
| **6. AGENTS.md + skills** | AGENTS.md 极简（123 行）：Beads issue tracker + MCP tool 优先 mandate。`skills/` 分散 7 个轻量 skill，每个有 token 预算（"target ≤5 tool calls and ≤800 tokens"） | **中** → 验证 workspace-bridge 的 AGENTS.md 虽大但功能完整。建议：将 `skills/workspace-audit/SKILL.md` 按任务拆分为独立 skill（如 `impact-assessment`、`dead-code-cleanup`），每个带 token 预算 |

### qartez-mcp 架构探索摘要（9 个维度）

| 维度 | qartez 核心做法 | 对 workspace-bridge 的借鉴价值 |
|------|----------------|-------------------------------|
| **1. 整体架构** | Rust MCP server + CLI 双模式，SQLite（`rusqlite` + WAL + mmap 256MiB），四阶段索引管道（parse+insert → stale cleanup → import resolution → reference resolution）。后台 indexing + 前台 serving 并行 | **中** → CLI 和 MCP 共享 `call_tool_by_name` 统一分发，零代码重复。workspace-bridge CLI-only 不适用 MCP，但 `OutputFormat` 枚举（human/json/compact）比 `--json` 布尔值更干净 |
| **2. 解析与图构建** | 37 语言 tree-sitter，`LanguageSupport` trait（`extensions()`/`extract(source,tree)`），`ParseResult` 含 `symbols`/`imports`/`references`/`type_relations`。**shape hash**：结构指纹（标识符→`_`、字符串→`_S`、数字→`_N`）用于 clone 检测。**`owner_type`**/`parent_idx` 捕获 `impl Foo { fn bar() }` 上下文 | **高** → `owner_type` + `parent_idx` 可直接增强 workspace-bridge 的 `functionRecords`/`exportRecords`，改善 method disambiguation。`unused_excluded` 在 parse 时标记 macro-generated/trait-impl，比 post-hoc 过滤更干净 |
| **3. Scope Resolution** | **6 层启发式**：① qualifier matching → ② receiver-type hint → ③ same impl block → ④ same file → ⑤ imported files → ⑥ unique global match。`kind` 过滤（`Call`→function/method、`TypeRef`→type-like）。**`via_method_syntax`** 防止 `filter`/`map`/`collect` 等泛型迭代器方法产生跨文件 false edges | **高** → 直接改善 JS/TS resolver：`Array.prototype.map` 等泛型方法的跨文件 fan-out 是已知误报来源。kind 过滤和 same-file 优先可提升 `symbol-impact` 准确率 |
| **4. Workspace/Monorepo** | 自动检测 `.git`/`package.json`/`Cargo.toml`/`go.mod`/`pyproject.toml`，解析 `package.json` workspaces / `Cargo.toml` `[workspace] members` / `go.work`。多根 DB 用 root alias 前缀防止 `files.path` 碰撞 | **中** → workspace-bridge 当前靠 `.workspace-bridge.json` 手动标注。qartez 的 auto-detect 可作为 opt-in 增强（Wave 14-4 项目根自动发现） |
| **5. ParseCache 与增量** | **Workspace fingerprint**：crate version + canonical roots + `.qartezignore` 的 DefaultHasher digest，匹配则跳过全量重索引。Watcher 200ms debounce。PageRank 重算 rate-limit（30s）。**四层 ParseCache**：`source` → `tree` → `calls` → `idents`（lazy population） | **高** → workspace fingerprint 可替代 per-file mtime 检查，实现 cold-start 秒级跳过。四层 ParseCache 直接对应 Wave 15-3 "跨调用缓存"。PageRank rate-limiting 适用于 watcher 模式 |
| **6. 配置系统** | CLI args > `.qartez/workspace.toml` > 自动检测 > 环境变量（`QARTEZ_MAX_FILE_BYTES` 等）。无复杂层级 | **低** → workspace-bridge 的 `.workspace-bridge.json` 已足够丰富。qartez 的极简配置验证 workspace-bridge 不应当过度工程化 |
| **7. Benchmark** | LLM-judge（Claude Opus）评分 5 轴：correctness/completeness/usability/groundedness/conciseness。token 节省率 91.8%，质量分 MCP 8.3/10 vs non-MCP 4.3/10 | **中** → workspace-bridge 的 `benchmark/` 可引入 LLM-judge 维度，验证"curation engine"定位是否真实提升 AI 消费质量 |
| **8. 测试策略** | `fp_regression_*.rs` 按误报类别命名（`fp_regression_unused.rs`、`fp_regression_clones_smells.rs` 等）。显式 dropped 计数器（`dropped_no_candidate`/`dropped_ambiguous`）使启发式行为可测试 | **高** → workspace-bridge 已有 `fp_regression_*.js`（Wave 9-3），但可按 qartez 模式更系统地按类别命名。resolver 的 dropped 计数器可作为 telemetry 注入，量化 resolver 保守度 |
| **9. CLI 设计** | `clap` derive macro，`OutputFormat` 枚举（human/json/compact），TTY auto-detection，unified tool dispatch | **中** → `compact` 格式可作为 CI 场景的默认输出，减少日志噪音 |

### 借鉴优先级与 Wave 映射

| 优先级 | 借鉴点 | 对应 Wave | 预计改动文件 | 设计参考 |
|--------|--------|-----------|-------------|----------|
| **P0** | 1-hop 边界扩展增量更新 | 15-4 | `builder.js`, `incremental-diff.js` | GitNexus `computeEffectiveWriteSet` + `shadow-candidates.ts` |
| **P0** | 框架检测 query 化（替换 regex） | 15-2 | `framework-patterns.js` | GitNexus `HttpLanguagePlugin` + compiled tree-sitter queries |
| **P1** | 语言注册表显式契约 | 13-1 | `parsers/registry.js` | GitNexus `satisfies Record<SupportedLanguages, LanguageProvider>` |
| **P1** | Edge evidence traces | 强化 Wave 10 | `builder.js`, `graph-db.js` | GitNexus edge `evidence: Array<{kind, weight, note}>` |
| **P2** | Graph-first 路由提取 | 修复 L3 | `builder.js`, `persistence.js` | GitNexus `HANDLES_ROUTE` graph-assisted + source-scan fallback |
| **P3** | 结构化输出格式 | 12 | `formatters/`, `audit-assembler.js` | GitNexus PR Swarm finding 模板 |
| **P3** | Parser golden snapshot 测试 | 补测试 | `test/` 新增 golden fixtures | CGC `fixtures/goldens/` 模式 |
| **P3** | 跨平台路径回归测试 | 补测试 | `test/path-normalization-test.js` | CGC `test_writer_path_normalization.py` |
| **P3** | `compact` 输出格式 | 12 | `src/cli/formatters/` | qartez `OutputFormat` 枚举（human/json/compact）+ TTY auto-detection |
| **P3** | Skill 按任务拆分 + token 预算 | 文档 | `skills/workspace-audit/` | CRG `skills/` 分散 7 个轻量 skill 模式 |

### 不做（与定位冲突）

- **跨文件 Call Graph / MRO 解析**：超出"结构分析 ≠ 语义分析"定位
- **LadybugDB / KuzuDB / Neo4j 迁移**：CGC 的 Kuzu 适配层是 ~400 行 regex 驱动的 Cypher shim，强类型嵌入式图数据库需要巨大投入。SQLite 关系模型对 CLI 工具更务实
- **Worker Pool 并行解析**：`Promise.all` + 信号量已满足需求（AGENTS.md 持续观察）
- **PR Swarm 多 Agent 执行**：workspace-bridge 是 CLI 工具，不是 PR 平台
- **MCP Server / SSE 接口**：CGC/qartez 均为 MCP-first 架构，增加了 ~2000 行 setup wizard / IDE config / connection pooling。workspace-bridge CLI-only 定位明确排除
- **`.cgc` Bundle 分发系统**：CLI-only 工具不需要预索引图快照分发；SQLite cache 已是等价物
- **qartez dashboard / Web UI**：qartez 有 `qartez_dashboard` crate。workspace-bridge 不做 Web 层
- **SCIP 索引做主路径**：CGC 的 SCIP 需要外部二进制 + 构建配置，与 workspace-bridge 零配置定位冲突

---

## 活跃问题与技术债务

### Dogfood 活跃缺陷 (0 项)

> 完整复现命令和活跃缺陷详情见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md) §Comprehensive Bug Matrix。

目前所有高优先级的 P0/P1/P2 问题已全部清零。

### 传统技术债务

| 级别               | 数量        | 内容                                                                                                                                     |
| -------------- | ----------- | ---------------- |
| L1 Blocker         | 0           | —                                                                                                                                       |
| L2 债务            | 0           | —                                                                                                                                       |
| 活跃债务           | 1           | 弱断言分布 ~2.3% |
| **产品债务** | **0** | —                                                                  |

**测试状态**：`npm run test:fast` **95/95 PASS**（~10s），`npm run test:smoke` **98/98 PASS**（~32s）。全量 runner 本轮未跑完（`e2e-gitnexus-test.js` 在 reference/GitNexus 上超时/失败，与 Wave 12 改动无关）。当前 fast 层 95 个测试，slow 层 71 个，serial 层 7 个。

---

## 本轮上下文：架构债务清偿（2026-06-01）

> **Dogfood 修复波次状态**：Wave 1/2/3/4/5/6/7/8 全部完成，37 项问题全部清零。
>
> 基于 git 历史、代码结构、文档状态的三维交叉分析诊断报告，执行路线 A（架构债务清零）与路线 B（CLI 可测试化）。

### 路线 B：CLI 可测试化 — 已完成

- **新建 `src/cli/validate-args.js`**：提取 `parseCliArgs()`（参数解析+验证）、`sanitizeCliPaths()`（路径安全）、`classifyError()`（错误分类）。纯函数，支持直接单元测试。
- **新建 `src/cli/route-formatter.js`**：提取 `writeLargeJson()`（流式 JSON）、`determineExitCode()`（退出码语义）、`formatCliResult()`（格式化器路由）、`buildErrorResponse()`（错误响应组装）。纯函数，支持直接单元测试。
- **新建 `src/cli/bootstrap.js`**：提取 `UV_THREADPOOL_SIZE` 进程配置与 `installFatalHandlers()` 致命错误处理。必须在任何异步 I/O 之前 require。
- **`cli.js` 精简**：从 ~628 行 → ~260 行，仅保留 `main()` 命令分发、`runCliInProcess()` 进程内入口、帮助文本。所有导出 100% 向后兼容。

### 路线 A-1：container.js 初始化管道拆分 — 已完成

- **引入 `_runPipeline(cwd, options)`**：显式定义 10 个命名阶段：`workspaceRoot` → `cache` → `projectContext` → `fileIndex` → `diagnostics` → `depGraph` → `aggregate` → `snapshot` → `callbacks` → `gitHead`。
- **引入 `_runStage(name, fn)`**：自动计时、错误包装（`Stage 'X' failed: ...`），消灭 monolithic try-catch 导致的 regression 根因。
- 零公共 API 变更；`test:fast` 88/88 PASS；runner 已跑 124 测试，0 FAIL。

### 路线 A-2：dep-graph.js 协调职责上移 — **已完成（100%）**

- **已完成**：
  - 新建 `src/services/orchestrator.js`，提取 `registerGraphBuiltHandler` / `savePrecomputed` / `restorePrecomputed` / `bootstrapFromSchema` / `initializeDepGraph` / `GraphStateMachine`。
  - `container.js` `_initDepGraph` 从 ~65 行决策树压缩为 1 行。
  - **阶段 1：提取 EntryDetector**：`isKnownEntryFile()` + `getFrameworkHint()` + `_entryFileCache` + `graph:updated` 监听已提取到 `src/services/dep-graph/entry-detector.js`，消除了两者间的内容扫描重复代码。
  - **阶段 2：提取 GraphLoader**：`loadGraph()` ~99 行已提取到 `src/services/dep-graph/loader.js`，dep-graph.js 保留 thin wrapper。
  - **阶段 3：打破循环依赖**：`DG_STATES` + `GraphStateMachine` 下沉到 `src/services/dep-graph/state-machine.js`；`registerGraphBuiltHandler` + `savePrecomputed` + `restorePrecomputed` 收容到 `src/services/dep-graph/persistence.js`。dep-graph.js 不再静态依赖 orchestrator.js；`bootstrapFromSchema` 通过显式 `DependencyGraphClass` 参数消除反向运行时 require。
  - `dep-graph.js` 行数从 ~654 行降为 **323 行**。
  - `test:fast` **88/88 PASS**。

### 下一步方向（Stage 4 完整蓝图）

> **总方向**：从"结构感知工具"升级为"带置信度的符号级结构感知 + 轻量框架语义 + AI 友好输出"。
> 
> **不做的事**：完整 Call DAG（ROADMAP L461 "当前不做"）、字段读写追踪（L462 "当前不做"）、废弃正则回退（违反降级原则）、0 误报承诺（理论不可能）。
> 
> 路线 A-3（graph-db.js `loadAll()` 手工拼接）继续观察，`CACHE_TABLE_SCHEMA` 注册表已部分解决。

#### Wave 9：预计算深化 + 轻量路由提取

| # | 目标 | 改动文件 | 说明 | 状态 |
|---|------|----------|------|------|
| 9-1 | **precomputed impactRadius 完整持久化** | `graph-db.js` / `persistence.js` / `analyzer.js` | `impactRadius` 全链路 round-trip 落盘；warm start `getImpactRadius()` 走 O(1) fast path | ✅ 已交付 |
| 9-2 | **轻量路由提取** | `framework-patterns.js` / `graph-db.js` / `dep-tools/impact.js` / `persistence.js` | `extractRoutes()` 提取 6 语言静态路由声明；`routes` 表落盘；`impact` 输出 `affectedRoutes[]` | ✅ 已交付 |
| 9-3 | **回归测试档案** | `test/fp_regression_*.js` | 死代码/安全/未解析 import 的已知误报场景归档，防止修复后复发 | ✅ 已交付 |

**验收标准**：
- `impact --file handler.js --json` 输出包含 `affectedRoutes[]` ✅
- `impact --file foo.js` 预计算命中时走 fast path ✅
- 回归测试档案覆盖 ≥5 个历史误报场景

---

#### Wave 10：符号级智能

| # | 目标 | 改动文件 | 说明 | ROADMAP | 状态 |
|---|------|----------|------|---------|------|
| 10-1 | **Pre-scan 全局符号映射** | `parsers/` / 新建 `pre-scan.js` | 正式解析前轻量 tree-sitter query 提取所有文件顶层定义名，构建 `symbol → [file]` 映射 | L476 | ✅ 已交付 |
| 10-2 | **符号解析置信飞轮** | `resolvers.js` / `symbol-registry.js` / `edges` 表 | Pre-scan 粗定位 → Query 精确捕获 → Confidence Tier 标注。每条边附 `confidence` + `tier` + `resolutionMethod` | L471 | ✅ 已交付 |
| 10-3 | **测试间隙穿透（Dispatcher Regex）** | `affected-tests` 逻辑 / `dep-tools.js` | 无 import 边但测试文件 body 提及源文件 stem → 纳入 affected-tests（`source: "mention"`） | L466 | ✅ 已交付 |

**验收标准**：
- `edges` 表每条边有 `confidence` 字段（0.0-1.0）
- Pre-scan 对 9 语言均能提取顶层定义名
- `affected-tests` 捕获到 import 边遗漏的测试文件

---

#### Wave 11：分析深化

| # | 目标 | 说明 | ROADMAP |
|---|------|------|---------|
| 11-1 | **自适应架构边界（`audit-boundaries`）** | `.workspace-bridge.json` `boundaries[]` + minimatch 违规检测 | L470 |
| 11-2 | **代码异味检测（Flat Dispatcher）** | `switch/if-elif` 链 arms 数量检测 | L474 |
| 11-3 | **复杂度趋势分析** | `git revwalk` + tree-sitter 重解析，输出 `GROWING/SHRINKING/STABLE` | L473 |
| 11-4 | **统一 risk scoring（5 维度）** | `audit-diff` 引入 flow_participation + community_crossing + test_coverage + caller_count + security_sensitive | L483 |

---

#### Wave 12：输出精炼（低成本高收益）

| # | 目标 | 成本 | 说明 | ROADMAP | 状态 |
|---|------|------|------|---------|------|
| 12-1 | **诚实截断机制（Honest Truncation）** | 极低 | `impact` / `affected-tests` 结果数组包装 `truncated` 布尔字段，超限诚实告知 | L484 | ✅ 已交付 |
| 12-2 | **JSON 输出 token 削减** | 低 | `elideDeep()`：超大数组/字符串在 JSON 输出前自动截断 | L488 | ✅ 已交付 |
| 12-3 | **分层输出过滤** | 低 | `--severity high|medium|low` 按严重程度过滤、`--category dead-exports/unresolved/cycles/health` 按类别过滤 | L494 | ✅ 已交付 |
| 12-4 | **大项目自动截断/自适应** | 低 | 基于项目总文件数（默认 500，`LARGE_PROJECT_FILE_THRESHOLD`）自动启用 `--compact`，`--no-compact` / `--compact` / `WB_COMPACT` 显式覆盖 | L498 | ✅ 已交付 |
| 12-5 | **大项目手动截断** | 低 | `--max-files <n>` 限制 `audit-diff` 变更文件数，并在 `options` 中报告截断状态 | L501 | ✅ 已交付 |

---

#### Wave 13：工程契约与可观测性

| # | 目标 | 成本 | 说明 | ROADMAP | 状态 |
|---|------|------|------|---------|------|
| 13-1 | **语言注册表统一契约** | 低 | `{ language, extensions, parse, extractImports, extractExports, isBuiltIn }` 配置表 | L491 | ✅ 已交付 |
| 13-2 | **GraphBuilder / GraphAnalyzer 职责边界** | 低 | 对外接口显式区分"节点构建期"和"边链接期"，文档化 + 生命周期 hook | L490 | ✅ 已交付 |
| 13-3 | **per-tool benchmark + 回归检查** | 低 | 扩展 `benchmark/` 目录，为每个 CLI 命令建立对照实验 | L485 | ✅ 已交付 |
| 13-4 | **SKILL.md 按层级重组** | 低 | 按 L1/L2/L3 分层整理，精简到 AI 只需要看 L1（~5 条命令） | ROADMAP §2.5 | ✅ 已交付 |

---

#### Wave 14：配置与适配性

| # | 目标 | 成本 | 说明 | ROADMAP |
|---|------|------|------|---------|
| 14-1 | **规则引擎层次 A（配置化）** | 低 | `security-tools.js` 硬编码规则提取为外部 YAML/JSON，`--config <file>` 接入 | L477 | ✅ 已交付 |
| 15-2 | **框架检测 Query 化** | 中 | `framework-patterns.js` 正则收敛为 tree-sitter query 声明，`queries/` 目录配置 | L492 | ✅ 已交付（Express / NestJS / Spring Boot 3 框架路由提取 query 化完成；query 编译基础设施 + LRU 缓存已就绪；框架检测内容 query 基础设施预备，完整 query 化待后续波次） |
| 14-2 | **噪音抑制增强** | 低 | `.workspace-bridge.json` 扩展 `ignore` 配置 + `--mark-false-positive <id>` 记录误报 | L499 |
| 14-3 | **环境变量层 + 配置来源报告** | 低 | `WB_*` 环境变量层 + 启动时来源报告（config from: env > cli > file） | L487 |
| 14-4 | **项目根自动发现（Monorepo）** | 中 | 自动检测 `package.json`/`pom.xml`/`go.mod` 层级，支持 `--service <subpath>` 过滤 | L486 | ✅ 已交付

---

#### Wave 15：深度扩展

| # | 目标 | 成本 | 说明 | ROADMAP |
|---|------|------|------|---------|
| 15-1 | **规则引擎层次 B（AST 轻量规则）** | 中 | 基于 `functionRecords` 做方法级条件检查（如"batch* 方法无 @Transactional"），不跨文件 | L478 |
| 15-2 | **框架检测 query 化（compilePatterns）** | 中 | `compilePatterns(treeSitterQuery) + runCompiledPatterns()`，新框架只需一个 query 文件 | L492 |
| 15-3 | **跨调用缓存（ParseCache）** | 中 | 按 `mtime_ns` 失效的 AST + ident + calls 缓存，优化"先 impact 再 affected-tests 再 audit-summary"连续查询 | L482 |
| 15-4 | **增量更新终极协议（四层叠加）** | 中 | L1 git diff → L2 SHA-256 → L3 Neighbor-aware → L4 WAL Cadence，按层渐进 | L472 |

---

#### 持续观察（不排期）

- Phase 4 CLI 薄化（依赖 watcher 常驻，改变部署模型）
- Worker Pool 并行解析（`Promise.all` + 信号量已满足当前需求）
- 路线 A-3 graph-db.js `loadAll()` 手工拼接（`CACHE_TABLE_SCHEMA` 注册表已部分缓解）
- CI Schema Parity 测试（下一次 schema 变更前触发）

#### 已交付（不再排期）

安全白名单分派表 (L464) · SQLite pragma 调优 (L475) · AI 预消化输出 `--format ai` (L479) · AI 摘要输出 (L480) · 增量分析扩展 `--staged`/`--files`/`--since` (L481) · async Fatal Handler (L489) · 持久化图存储 (L493) · 默认输出模式校准 (L496) · 命令分层暴露 (L497) · `--cache-dir` (L500) · 路径参数安全清洗 (L469) · Bus Factor / 知识分布 `knowledgeRisk` (L467)

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
- **每波收工前必须 `npm run test:fast` 85/85 PASS + 全量 runner 159/159 PASS**
- **每次修复后在 CHANGELOG.md [Unreleased] 追加条目**（单条不超过 3 行）

---

## 实战基地

> `C:\Users\sdses\Desktop\神思\code` 是 workspace-bridge 的实战基地，内含四个仓库，用于功能验证与实战演练。

---

*Last updated: 2026-06-11（Wave 12 输出精炼补全：大项目自动 compact、category 过滤、max-files 截断；npm run test:fast 95/95 PASS；test:watch 4/4 PASS；schemaVersion: 1.2.0；version: 2.0.0）*


