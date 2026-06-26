# workspace-bridge Roadmap

> **目标：让 AI 写代码更方便。**
>
> 不是给人类阅读的报告，是给 AI 消费的策展输出。人看摘要，AI 看结构，两者都拿到立即能行动的信息。
>
> 历史版本见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 已知限制（当前待处理）

| 问题                            | 状态                 | 影响                                                                                           | 缓解措施                                                                                                                                                                  |
| ------------------------------- | -------------------- | ------------------------------------------- | ----------------------- |
| 混合仓库误判                    | ⏳ 需配置            | ~~prototypes/reference 被视为主线~~ inferFileRole 已扩展 benchmark/e2e/fixtures/mocks 识别，但仍需 `.workspace-bridge.json` 标注自定义目录角色 | 使用 `.workspace-bridge.json` 标注目录角色；非标目录识别持续扩展                                                                                                    |
| mixed repo 技术栈启发式         | ⏳ 持续改进          | Node/Python 共存时命令可能不够精确                                                             | 持续打磨 `stack-detector`|
| 文档与代码状态同步              | ⏳ 需人工            | ROADMAP/SESSION/CHANGELOG 可能不同步                                                           | 自审后手动对齐                                                                                                                                                            |
| 多模块 Maven 模块边界未显式标注 | ⏳ 观察              | 模块间耦合强度丢失                                                                             | 评估是否输出模块级聚合视图                                                                                                                                                |
| 大项目冷启动超时                | ⏳ 观察              | ~~395 文件实测 59s~~ 实测 239 文件 2s / 542 文件 7s（环境差异），但 7s 对 CI 仍不够友好       | 预热工作流 + 评估 `--cache-dir` + 大项目默认 `--compact`                                                                                  |
| 跨仓库静态分析                  | ⏳ 评估中            | 前后端 API 契约纯文本匹配可做（`@RequestMapping` vs `axios.get`），但 CLI 只能单 `--cwd` | 评估多 `--cwd` 或 `--cross-repo` 低复杂度方案                                                                                                                         |
| `--cwd` 子目录分析被 Git root 覆盖 | ⏳ 设计债 | 期望分析子目录，实际返回整个仓库 | 明确文档化 `--cwd` 的 Git root 向上解析行为 |
| `--check-regression` 仅比较结构计数 | ⏳ 已文档化 | 代码内容变更但结构计数不变时误判为无回归 | 已在 help 文本注明；内容级回归需人工审查 |
| ESM 语法注入导致解析器崩溃 | ⏳ 观察 | CJS 项目中注入 `export const` 导致未处理 loader 异常 | 避免在 CJS 文件中使用 ESM 语法 
| symbolImpact 多符号解构遗漏 | ⏳ 观察 | 同时导入多个解构符号时部分遗漏 | 关注 `sourceSymbols` 与 `symbolToDependents` 数量是否一致 |
| audit-security Rule ID 映射错位 | ⏳ 观察 | Markdown 输出 `js-hardcoded-secret`，JSON 中 `rule` 为 null | 按 `ruleId` 字段消费安全规则 |
| 动态 require 导致死导出误报 | ⏳ 已文档化 | 路由提取 query 模块（如 `java-spring.js`）被误报为死导出（无法静态追踪其动态 require，且作为 JS 文件无法命中 JS 启发式豁免） | 运行时无功能影响，属已知静态分析局限，可在 `.workspace-bridge.json` 中加白屏蔽或忽略 |
| Wave 11-15 功能多语言等价性偏斜 | ⏳ 架构债务（字段、shadow、AST 规则与部分框架路由已补齐） | `functionRecords` 字段（decorators/isExported/returnType）与 `branchCount`/`maxArms` 已覆盖 9 种语言；Shadow Candidates 已覆盖 JS/TS/Python/C/C++/Vue/Svelte；跨语言 AST 内置规则已覆盖 9 种语言；框架路由 Query 已覆盖 FastAPI/Django/Gin/Fiber/Actix-web/Axum/Nuxt/SvelteKit。剩余：框架检测 Query（Go/Rust/C/C++/Vue/Svelte 仍依赖 regex/cheap-signature）。 | 详见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md) §框架检测 Query 语言等价性偏斜；按语言优先级逐步补齐 |

> 近期已修复的限制见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]：配置 JSON 语法错误与 schema 校验、`--format json` 自动映射与 JSON 格式解析错误统一、`--builtin-only`、`--since <commit>`、TTL 24h、git-aware staleness、`--format jsonl`、SKILL 文档体系重构。
>
> 历史修复记录见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 设计原则

见 [AGENTS.md §开发原则](./AGENTS.md#开发原则）。

---

## 期望成功标准（9 条）

| # | 成功标准                             |     完成度     | 缺口                                                              |
| - | ------------------------------------ | :------------: | --------------------------------------------- |
| 1 | 混合仓库结果稳定                     |      80%      | 无配置时 reference/prototype 仍污染结果                           |
| 2 | TS/Python/前端项目可信主线结论       |      90%      | React hooks 隐式依赖、Java 多模块 AST 深度                        |
| 3 | 从"哪里有问题"推进到"怎么改、测什么" |      95%      | 极端框架（Nuxt layers）的 fileSpecificAdvice 精度                 |
| 4 | symbol-level impact 可用             |      90%      | 仅 C/C++ regex 无 functionRecords                                 |
| 5 | 大仓库性能可接受                     |      97%      | 双边冗余内存（路径整数化评估中）、chunked 解析（实测 OOM 时触发） |
| 6 | 可选外部工具后端（Semgrep）          |      100%      | —                                                                |
| 7 | 全栈语言覆盖（9 种）                 |      100%      | —                                                                |
| 8 | 全栈 AST 覆盖（9/9 语言）            | **100%** | —                                                                |
| 9 | 闭环验证（P8）                       | **100%** | onGitStaged 触发、失败信息注入 AI 上下文                          |

---

## 下一步方向：AI 脚手架形态升级

> 路线 A–J 全部完成。基于 ai_zcypg_frontend 实测审计 + 6 仓库误报率统计，核心认知升级：
>
> **workspace-bridge 不是"带 JSON 输出的人类审计工具"，而是"为 AI 设计的代码感知接口"。**
>
> 当前 CLI 有脚手架的"材料"（symbol-level impact、cycle breakCandidate、honesty engine），但没有脚手架的"形态"（统一入口、Token 预算感知、渐进式发现、去噪输出）。
>
> 升级原则：砍掉给人类看的分类/模板文案/重复字段，让 AI 直接消费策展后的结论。

### 阶段 1：误报清零（**已完成**）

**状态**：阶段 1 四项目标全部完成；P0 去噪工程 5/5 完成。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

### 阶段 2：AI 预消化输出（已完成）

**状态**：`--format ai` / `--format summary` / `tokenBudget` / `depth` 已全部覆盖高频命令。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

### 阶段 3：AI 脚手架形态完成 (已完成)

静态分析的硬边界（Vue 模板编译时、Spring DI 运行时、MyBatis XML 绑定）无法突破，但在边界内已全面交付（包含 AST/Resolver 级导入过滤、环路检测 Tarjan+Johnson 重构，100% 框架白名单验证通过）。

### 下一个长期目标：统一跨语言符号解析 → 完全基于 AST

- **说明**：将所有支持语言的符号定义提取、依赖与影响范围计算、未解析 import 等核心感知分析，彻底迁移到基于 AST 的纯符号级别（完全摆脱正则回退逻辑），在跨语言边界建立完全确定、高度强健的 symbol-level Call DAG，实现 0 误报的精准测试集过滤和架构环路判定。
- **状态**：⏳ 规划中 (Stage 4)

---

### 阶段 2.5：CLI 减负与认知负担（短期）

| # | 目标                                     | 改动文件                            | 预期收益                                                        | 工作量 | 状态      |
| - | ---------------------------------------- | ----------------------------------- | --------------------------------------------------------------- | ------ | --------- |
| 1 | **SKILL.md 按层级重组**            | `skills/workspace-audit/SKILL.md` | 从 264 行缩至 ~80 行；只保留"何时用/何时不用/标准工作流"        | ~30 行 | ⏳ 待评估 |

**原则**：不删除命令、不合并命令、不改接口。只改暴露策略（默认折叠低频命令）和可观测性（计时/进度/错误提示）。

---

### 阶段 3.5：聚合结果持久化 + 细粒度查询 CLI (已完成，2026-06-17)

> **根因判断**：`audit-overview` 每次运行都重新计算 `hotspots` / `knowledgeRisk` / `stability`（git blame + PageRank + 耦合度），大型项目重复开销十几秒；且 `--json` 输出 3000+ 行嵌套结构，AI 消费者被迫一次性吞下大量低信噪比数据。
>
> **目标**：workspace-bridge 从"每次生成完整报告"升级为"项目结构的本地数据库"——聚合分析结果落盘 SQLite，AI 通过细粒度 CLI 命令按需查询，上下文零浪费。

| 目标 | 改动文件 | 说明 | 边界 |
| ---- | -------- | ---- | ---- |
| **聚合结果表** | `src/services/graph-db.js` | 复用现有 SQLite，新增 `analysis_snapshots`（热点/知识风险/稳定性/语言支持/架构建议的完整 JSON blob + gitHead 指纹 + computed_at） | 单表 KV 结构，不过度范式化；stale 时整表重建 |
| **写入端** | `src/tools/overview-tools.js` | `buildProjectOverview()` 完成后，若 gitHead / fileCount 指纹匹配则跳过重算，直接 `SELECT value_json FROM analysis_snapshots`；否则计算后 `INSERT OR REPLACE` | 与现有 `precomputed_aggregates` 表并存，不冲突 |
| **查询 CLI：热点** | `src/cli/commands/index.js` + `src/tools/query-tools.js` | 新增 `query-hotspots --risk high\|medium\|low --limit N --json`；只返回 `hotspots[]` 切片，不携带 languageSupport / knowledgeRisk 等无关维度 | 底层优先读 `analysis_snapshots`，miss 时触发完整 `audit-overview` 计算并缓存 |
| **查询 CLI：知识风险** | `src/cli/commands/index.js` + `src/tools/query-tools.js` | 新增 `query-knowledge-risk --level high\|medium\|low --limit N --json`；返回 `{file, authorCount, busFactor}` 列表 | 同上 |
| **查询 CLI：稳定性** | `src/cli/commands/index.js` + `src/tools/query-tools.js` | 新增 `query-stability --assessment fragile\|moderate\|stable --limit N --json` | 同上 |
| **查询 CLI：通用 SQL** | `src/cli/commands/index.js` | 可选：新增 `query --sql "SELECT ... FROM analysis_snapshots ..."`，暴露 SQLite 只读查询能力 | 只读；不写；不加 SQL 解析器，直接透传 `better-sqlite3` |
| ** `--fields` 白名单** | `src/cli/commands/index.js` + `src/tools/overview-tools.js` | `audit-overview --fields hotspots,deadExports,cycles`：只序列化指定顶层字段，削减 JSON 体积 | 不破坏现有 schema；缺失字段返回空对象或省略 |
| **格式化器对齐** | `src/cli/formatters/human-formatters.js` | `query-*` 命令复用现有 formatter 注册表；human 模式输出紧凑列表（`file | score | risk`），不展开 `reason` 长文本 | — |

**向后兼容**：
- `audit-overview` / `audit-summary` 默认行为不变；聚合缓存是透明加速层
- `analysis_snapshots` 使用 `CREATE TABLE IF NOT EXISTS`；旧版 CLI 读不到新表 → 正常 fallback 到实时计算
- 新增 `query-*` 命令为 L2 层级（默认 `--help` 折叠，不挤占核心命令列表）

**收益量化**：
- 284 文件项目：`audit-overview` 重复运行从 ~2s → ~20ms（缓存命中）
- 1329 文件 GitNexus：从 ~15s → ~50ms
- AI 上下文：热点查询从 3000 行完整 JSON → 5-10 行切片

---

### 阶段 4：长期（观察中）

- **跨仓库 API 契约检查**：frontend `axios.get('/api/policy/xxx')` vs backend `@GetMapping('/api/policy/xxx')`，纯静态文本匹配，评估低复杂度实现方案
- **增量脚手架**：`watch --on-change "audit-file --file {changedFile}"`，AI 启动后持续监听，文件保存自动推送 impact
- **自适应架构边界（`audit-boundaries`）**：读取 `.workspace-bridge.json` 中可选 `boundaries[]` 字段，用 minimatch 匹配路径遍历 import edges 做违规检测；无配置时用目录层级聚类（2 层前缀）自动生成建议规则（参考 qartez `BoundaryRule` + CRG Leiden 聚类）
- **增量更新终极协议（四层叠加）**：L1 git diff → L2 SHA-256 过滤（排除内容未变的 dependent）→ L3 Neighbor-aware（只重解析 caller/inheritor；参考 GitNexus `computeEffectiveWriteSet` 1-hop 边界扩展 + `shadow-candidates.ts` 模块解析权抢占枚举）→ L4 WAL Cadence（SQLite 写入不阻塞 + WAL 截断）。按层渐进，不一次性全做
- **符号解析置信飞轮**：Pre-scan 粗定位（全局 `symbol → [file]` 映射）→ Tree-sitter Query 精确捕获 → CRG Tier 置信标注（same-file/imported+ FQN/unique short name/alphabetical-first）。输出每条边附 `confidence` + `tier` + `resolutionMethod` + `evidence`（参考 GitNexus edge evidence traces：`{ kind, weight, note }[]`，为 Wave 11-4 统一 risk scoring 提供可审计推理链）
- **复杂度趋势分析**：`git revwalk` 拓扑+时间排序遍历 commit，对每个 commit 检出文件内容，tree-sitter 重新解析，记录各符号 CC 和行数，输出 `GROWING/SHRINKING/STABLE`（阈值 ±10%）
- **代码异味检测（Flat Dispatcher）**：扫描 `switch(action.type)` / `if-elif` 链的 `arms` 数量和 `cc` 关系，识别平铺 match/switch（Path 1: `arms ≥ 6` 且 `cc ≤ arms + 5`）和 Dominant 分支（Path 2: `arms ≥ 12` 且 `arms ≥ cc × 0.4`）
- **SQLite pragma 调优**：WAL + mmap + temp_store 调优，提升缓存写入和查询性能
- **Pre-scan 全局符号映射**：正式解析前轻量 query 提取所有文件顶层定义名，构建 `imports_map = {symbol_name: [file_path]}`，提升 import 解析准确率
- **Worker Pool 并行解析**：大项目文件解析从单线程顺序改为 worker_threads 并行，评估共享内存/消息传递复杂度是否值得

---

### Phase 4：CLI 彻底薄化（可选/远期）

**目标**：CLI 命令不再初始化 depGraph，只查 SQLite。

| 前提 | 说明 |
|------|------|
| watch 进程成为"必须" | 或首次运行时自动后台启动 watcher |
| 所有预计算数据可用 | SQLite 中 impact/tests/aggregates 完整且 fresh |

**改动**：`container.initialize()` 检测到热 SQLite 时跳过 `_initDepGraph()`；CLI 直接通过 `cache` 查询。


---

## 与现有规划的关系

- **ROADMAP.md P1（AI 预消化输出）**：预计算持久化是 `--depth`、`--token-budget` 的基础设施——薄查询层才能快速响应分级裁剪
- **AGENTS.md "CLI-only"**：不违反。Watcher 仍是 CLI 命令（`workspace-bridge watch`），无协议层/网络端口
- **`saveIncremental()` 增量写入**：Phase 1-2 的写入基础设施，直接复用


### 当前不做（与核心原则冲突）

| 需求                                        | 当前不做理由                                                                                                                            | 如果硬做会怎样                                                                                   |
| ------------------------------------------- | --------------------------------------------------------- | ---------------------------- |
| **污点追踪 / 跨文件数据流**           | 需要新增 call graph 子系统。即使做了，Spring DI / Vue 模板 / MyBatis XML 等运行时绑定问题仍解不了                                       | 投入 ~1 个月，对实战基地几乎无收益                                                               |
| **接入 SpotBugs/PMD**                 | 需要 JVM 环境。外部工具策略已明确"可选适配器，不做核心依赖"                                                                             | 破坏轻量 CLI 定位                                                                                |
| **MCP Server / daemon 模式**          | 开发原则第 1 条：CLI-only。daemon = 常驻进程 = 协议层维护成本                                                                           | 与 CLI-only 方向直接冲突                                                                         |
| **修复代码自动生成（`--suggest`）** | 这是 AI 语义理解的能力圈，不是结构分析的产出。给出具体重构建议需要理解代码语义                                                          | 需要内置 LLM 调用，与轻量本地属性冲突                                                            |
| **`rules --config` 重规则引擎**     | 将 `security-tools.js` 硬编码规则提取为外部 YAML/JSON 属于"规则引擎层次 A"，但完整的 `rules --list/run/config` CLI 是重规则引擎产品 | 与"轻量 CLI"定位冲突。层次 A 可在不新增命令的前提下实现（如 `--config <file>` 覆盖内置规则集） |
| **AGENTS.md 语义联动**                | AGENTS 红线多为语义规则，需要数据流分析才能判断来源是否安全                                                                             | 与"结构分析 ≠ 语义分析"原则冲突                                                                 |
| **`--cross-repo` 跨仓库关联**       | 需要解析前后端接口契约（OpenAPI/REST）并对比字段变更                                                                                    | 属于跨项目语义关联，需要接口契约解析子系统，投入 ~1 个月                                         |
| **`--field` 数据库字段级追踪**      | 需要数据库 schema 解析 + 跨语言字段引用追踪                                                                                             | 属于数据流分析，与"结构分析 ≠ 语义分析"原则冲突                                                 |
| **`--method` 方法级追踪**           | 需要完整的 call graph 子系统（caller/callee 解析 + 重载消解 + 继承链追踪）                                                              | 属于符号级调用解析，工作量大但收益高。可在持久化图存储阶段评估                                   |
| **`--workers 4` 多线程**            | Node.js 单线程，worker_threads 引入共享内存/消息传递复杂度                                                                              | 当前 `Promise.all` + 信号量限流已满足需求，多线程收益有限                                      |
| **已知缺口自动追踪**                  | 需要理解 AGENTS.md 自然语言语义并映射到代码位置                                                                                         | 属于 NLP + 语义分析，与"结构分析 ≠ 语义分析"原则冲突                                            |

---

### 活跃债务（按 [TECH_DEBT.md](./docs/TECH_DEBT.md)）

| 类型 | 数量 | 内容 |
| ---- | ---- | ---- |
| L1 Blocker | 0 | — |
| L2 债务 | 0 | — |
| 架构债务 | 1 | **框架检测 Query 语言等价性偏斜**：JS/TS/Python/Java/Kotlin 已完成 AST-Query 化；Go/Rust/C/C++/Vue/Svelte 仍依赖 regex/cheap-signature。 |
| L3 品味问题 | 1 | **弱断言分布**：约 ~10 处 `typeof` 型 schema 契约检查待强化为语义断言（数据见 [TECH_DEBT.md](./docs/TECH_DEBT.md)）。 |

> 已修复项（历史见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]）：`inferFileRole` 状态化 + 规则盲区消除（`project-context.js`）、`shouldExclude` 跨层热切判定解耦（`file-index.js`）、COMMAND_GUIDES 内聚归位（`cli.js`）、Resolver FIFO → LRU（`resolvers.js`）、`js.js` 解析器拆分（将 `parseJavaScriptAST` 移至 `ast-parser.js`）、`bootstrapFromSchema` 路径规范化不一致。

---

### 性能瓶颈（大项目 >10k 文件，未修复项）

| 级别 | 位置                     | 问题                                  | 量化影响                              | 建议修复                                                 |
| :--- | :----------------------- | :------------------------------------ | :------------------------------------ | :---------------- |
| P1   | `dep-graph.js:127-128` | `graph` + `reverseGraph` 双边冗余 | 100k 条边 →**16–24MB** 纯冗余 | 评估是否可改为单图 + 按需反向遍历                        |
| P1   | `cache.js:112,157`     | 缓存加载/保存双重内存峰值             | 50MB 缓存文件 → 峰值**100MB+** | 接受现状（工程量大收益小），或评估 streaming JSON parser |

> 已修复项（P74 流式扫描 / P75 缓存 I/O / Python 子进程限流 / git log 限流）见 [CHANGELOG.md](./CHANGELOG.md)。

---

### 用户体验缺口

| 维度     | 问题      | 当前表现                                                            | 理想表现                                                                       |
| -------- | --------- | ----------------------- | ------------------ |
| 配置     | ⏳ 待评估 | `.workspace-bridge.json` schema 校验可更严格                      | 未知字段/类型错误警告（非阻塞）                                                |
| 进度     | ⏳ 待评估 | 超大仓库（>10k 文件）索引进度粒度不足；用户不知道是在工作还是卡住了 | 按百分比或按模块打印进度；或按 PhaseTimer 阶段输出"解析中…/建图中…/查询中…" |

---

## 长期方向（非承诺，见路线 I-2 深度评估）

| 方向                                             | 价值 | 成本 | 判断                        | 触发条件 / 现状 |
| -------------------------------------- | ---- | ---- | --------------------------- | ------------------------- |
| 符号级调用解析（Call-Resolution DAG）            | 高   | 很高 | **当前不做**          | 需要新增 call graph 子系统；即使做了，Spring DI / Vue 模板 / MyBatis XML 等运行时绑定问题仍解不了 |
| 字段读写追踪（ACCESSES 边）                      | 高   | 高   | **当前不做**          | 同污点追踪，需要跨文件数据流分析，与"结构分析 ≠ 语义分析"原则冲突 |
| CI Schema Parity 测试                            | 中   | 低   | 观察                        | 下一次 schema 变更前 |
| **安全白名单分派表 + Assert Defense**      | 高   | 低   | **接受**              | `security-tools.js` 每条规则独立 `is_match_allowlisted()`；测试内防御性匹配（`expect(error)`）抑制误报。参考 qartez 集中式白名单分派表 |
| **端到端请求路径（路由提取）**             | 高   | 低   | **⏳ 暂缓**           | 越界语义分析风险：路由注册（`app.get('/users/:id', handler)`）是运行时语义，不是静态 import 边。若未来评估通过，只能做成可选适配器，不可成为默认依赖。参考 GitNexus `HANDLES_ROUTE` 边 + CRG entry point 检测 |
| **per-tool benchmark + 回归检查**          | 中   | 低   | **接受**              | 扩展 `benchmark/` 目录，为每个 CLI 命令建立"有工具 vs 无工具"对照实验，检测性能回归。参考 qartez `benchmark/report.rs`（LLM-judge 评分 5 轴：correctness/completeness/usability/groundedness/conciseness + token 节省率 91.8%） |
| **Parser golden snapshot 测试**            | 中   | 低   | **接受**              | 为各语言 parser 的 tricky 文件建立预期 AST 输出快照（`fixtures/goldens/`），`--update-goldens` 刷新。防止 parser 规则调整导致隐性误报。参考 CGC `fixtures/goldens/` + `test_parser_goldens.py` |
| **跨平台路径回归测试**                     | 中   | 极低 | **接受**              | 模拟 Windows 反斜杠路径输入，断言存储/查询格式一致（正斜杠或统一 abstraction）。参考 CGC `test_writer_path_normalization.py`（361 行回归防护） |
| **预索引便携快照**                         | 中   | 中   | **接受**              | 导出 `.wbbundle`（ZIP = metadata.json + nodes.jsonl + edges.jsonl + stats.json），支持预索引分发、CI 缓存、跨机器加载。参考 CodeGraphContext `.cgc` bundle。 |
| **Modification Guard**                     | 中   | 中   | **接受**              | 在 AI 工具执行文件修改前检查影响半径，高影响（如 transitiveCount > 50）时要求确认或拆分变更。参考 qartez `src/bin/guard.rs`。 |

> 路线 I-2 GitNexus 深度对比 of 9 项发现中，数值 confidence / yieldToEventLoop / confidenceSource 标签 / git-aware staleness / import 策略链抽象 5 项已吸收并完成。详见 [CHANGELOG.md](./CHANGELOG.md)。
>
> 历史评估更新见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 活跃重构项

> 三层重构（数据层 / 编排层 / 输出层）的详细 Wave 计划、优先级与验收标准见 [SESSION.md](./SESSION.md) §下一步方向。
> 本文档不重复维护具体条目；以下仅为高层备忘。

- D6 消除 parseResults/graph 冗余（⏳ 长期）
- U3 overview-tools 拆分（⏳ 中等）
- U7 audit-assembler 拆分（⏳ 中等）
