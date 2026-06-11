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
| mixed repo 技术栈启发式         | ⏳ 持续改进          | Node/Python 共存时命令可能不够精确                                                             | 持续打磨 `stack-detector`                                                                                                                                               |
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

| 目标                                            | 改动文件                                                               | 预期收益                                                                                                                                                             | 边界                                     |
| ----------------------------------------------- | ------------------------------------------------- | -------------------------------- | ---------------------------------------- |
| ~~安全白名单分派表 + Assert Defense~~ ✅ | `security-tools.js`                                                  | 已交付。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。 | 不改变现有 CLI 接口，纯规则后处理        |
| **端到端请求路径（路由提取）**            | `framework-patterns.js` / `dep-graph.js` / `human-formatters.js` | `impact` 输出增加 `affectedRoutes`：改 handler 前知道影响哪些 API（Express/Spring/FastAPI 等 9 语言）。Wave 9-2 已交付 regex 版；待升级为 **Graph-first + tree-sitter query**（参考 GitNexus `HANDLES_ROUTE` 边 + `HttpLanguagePlugin` 契约）                                                            | 只提取路由声明，不追踪请求体内参数绑定   |
| **测试间隙穿透（Dispatcher Regex）**      | `affected-tests` 逻辑扩展                                            | 无 import 边但测试文件 body 提及源文件 stem，或 `call_tool_by_name("xxx")` 字符串分发匹配到的测试，也纳入 affected-tests                                           | 需避免与已有 import 边重复计数           |
| **Bus Factor / 知识分布**                 | `overview-tools.js`                                                  | `audit-overview` 新增 `knowledgeRisk` 维度：逐文件 `git blame` + mailmap 去重，标识"只有一个人懂的文件"                                                        | 依赖 git 历史完整，新仓库无意义          |
| **回归测试档案**                          | `test/` 新增 `fp_regression_*.js`                                  | 死代码/安全/未解析 import 的已知误报场景归档，防止修复后复发                                                                                                         | 档案需随规则调整同步维护                 |
| ~~路径参数安全清洗~~ ✅                   | `cli.js` / `path.js`                                               | 已交付。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。 | 与现有 `sanitize.js` 职责对齐          |
| ~~Prompt 注入防御（符号名过滤）~~ ✅      | `formatters/` / `cli.js`                                           | 已交付。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。 | 极低成本，安全风险                       |
| ~~**parser 错误恢复（per-file try/catch）**~~ ✅ | `src/services/dep-graph/builder.js` / `src/services/dep-graph/analyzer.js` | 已交付。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。 | 参考 GitNexus Query 错误恢复             |
| **cli.js 抽出可测试入口**                 | `cli.js` / `src/cli/commands/`                                     | 将命令处理逻辑从 `process.argv` 解析中解耦，暴露 `runCommand(config, command)` 纯函数入口，支持单元测试直接调用而无需 spawn                                      | 参考 qartez `cli_runner::run`          |

**决策逻辑**：投入可控（每项 ~5–80 行），收益明确（减少误报、提升稳定性或可测试性）。不碰 call graph / 数据流。

---

### 阶段 2.5：CLI 减负与认知负担（短期）

| # | 目标                                     | 改动文件                            | 预期收益                                                        | 工作量 | 状态      |
| - | ---------------------------------------- | ----------------------------------- | --------------------------------------------------------------- | ------ | --------- |
| 1 | **默认 `--help` 只展示核心命令** | `cli.js` help 文本生成            | AI 消费者从 20 选 1 → 5 选 1；L2-L4 命令仍需可用，但不默认暴露 | ~10 行 | ✅ 已完成 |
| 2 | **SKILL.md 按层级重组**            | `skills/workspace-audit/SKILL.md` | 从 264 行缩至 ~80 行；只保留"何时用/何时不用/标准工作流"        | ~30 行 | ⏳ 待评估 |
| 3 | **PhaseTimer 多阶段计时**          | `container.js` / `cli.js`       | 大型仓库分析时知道卡在解析/建图/查询哪一阶段                    | ~15 行 | ✅ 已完成 |
| 4 | **CLI 错误分类 + 可操作建议**      | `cli.js` catch 块                 | 错误不再是 raw stack，而是"错误类型 + 下一步命令"               | ~20 行 | ✅ 已完成 |

**原则**：不删除命令、不合并命令、不改接口。只改暴露策略（默认折叠低频命令）和可观测性（计时/进度/错误提示）。

---

### 阶段 3.5：聚合结果持久化 + 细粒度查询 CLI（AI 按需投喂）

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

## ADR: 持久化图存储（SQLite）

> 状态：**已交付**  
> 决策：SQLite 作为核心图存储，不引入图数据库  
> 交付内容：`saveIncremental()` 增量写入、`updateFiles()` 增量更新内存图、`fileIndex` 监听 + 批量回调、预计算 aggregates 落盘。  
> 详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 决策

**用 SQLite 作为核心图存储和预计算存储，不引入图数据库。**

### 为什么不是图数据库？

| 维度 | SQLite (better-sqlite3) | KuzuDB 等嵌入式图库 |
|------|------------------------|---------------------|
| 依赖大小 | 已有，0 新增 | ~50MB+ native binding |
| Windows 编译 | 无风险 | node-gyp / prebuild 风险 |
| 查询语言 | SQL（递归 CTE 已验证 1ms 级） | Cypher（需要学习成本） |
| 增量更新 | WAL + INSERT OR REPLACE 已验证 | 增量更新文档稀缺 |
| 表格查询 | 绝对主场 | 需要把简单 SELECT 包装成 Cypher |
| 调试 | `sqlite3 cache.db` 直接查 | 需要专用工具 |

workspace-bridge 当前是**文件级**图（节点 = 文件），即使在 1329 文件的 GitNexus 项目上，节点数也仅千级。SQLite `WITH RECURSIVE` 处理这个规模绰绰有余。若未来进入符号级 call graph（十万级节点），再考虑迁移，数据迁出只需 `SELECT * FROM edges`。

> **不为未来可能的需求付现在确定的成本。**

---

## 目标架构

```
[文件系统 Watcher] → [增量分析器] → [SQLite 知识库]
                                          ↑
                              AI 直接查库 / CLI 薄查询层
```

- **Watcher**：写入端。文件保存 → 增量解析 → 增量更新边 → 预计算影响半径/测试映射 → 写入 SQLite。
- **CLI**：读取端。优先查预计算表，fallback 到内存图重建。

---

## Schema 设计

> **实现状态总览**：14 张设计表中 **12 张已实现**，2 张不做（`findings` / `precomputed_tests`）。
>
> 实际 DDL 见 [graph-db.js](./src/services/graph-db.js) `SCHEMA` 常量。

### 核心图结构

```sql
-- ✅ 已实现（作为 file_metadata 表，已扩展 type/role/lang 列）
-- 文件节点（从 file_metadata 扩展，统一节点视角）
CREATE TABLE IF NOT EXISTS nodes (
  file TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'source',   -- 'source' | 'test' | 'config' | 'generated' | 'entry'
  role TEXT,                             -- 项目上下文推断的角色
  lang TEXT,                             -- 'js' | 'ts' | 'java' | ...
  mtime INTEGER,
  hash TEXT,
  parse_mode TEXT,                       -- 'ast' | 'regex' | 'none'
  line_count INTEGER
);

-- ✅ 已实现
-- 依赖边（imports + implicit framework edges）
CREATE TABLE IF NOT EXISTS edges (
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  edge_type TEXT NOT NULL DEFAULT 'import',  -- 'import' | 'implicit-framework' | 'package'
  confidence REAL NOT NULL DEFAULT 1.0,      -- 0.0-1.0，用于 heuristic edges
  PRIMARY KEY (source, target, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edge_type);
```

### 预计算维度

```sql
-- ✅ 已实现（schema 与设计略有差异，实际列为 file/direct_deps/transitive_deps/direct_dependents/transitive_dependents/affected_tests/impact_radius/version）
-- 文件级影响半径（预计算 BFS 结果）
CREATE TABLE IF NOT EXISTS precomputed_impact (...);

-- ❌ 不做（affected_tests 已作为 TEXT 列嵌在 precomputed_impact 中，独立表纯粹是范式化，不解决新问题）
-- 测试映射（预计算 affected-tests）
CREATE TABLE IF NOT EXISTS precomputed_tests (...);

-- ✅ 已实现
-- 聚合摘要（precomputeAggregates 结果）
CREATE TABLE IF NOT EXISTS precomputed_aggregates (
  key TEXT PRIMARY KEY,  -- 'deadExports' | 'unresolved' | 'cycles' | 'stats' | 'hotspots' | 'stability' | 'analysis_snapshot'
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL,
  computed_at INTEGER NOT NULL DEFAULT 0
);

-- ✅ 已实现
-- 多维指标（PageRank、co-change、风险分、热点分）
CREATE TABLE IF NOT EXISTS metrics (
  file TEXT NOT NULL,
  dimension TEXT NOT NULL,  -- 'pagerank' | 'cochange_score' | 'risk_score' | 'hotspot_score'
  value REAL NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (file, dimension)
);

-- ❌ 不做（安全扫描本身很快，持久化需要额外 staleness 管理，收益 < 成本）
-- 安全发现（security-tools 结果）
CREATE TABLE IF NOT EXISTS findings (...);

-- ✅ 已实现
-- 测试映射（source → test 的直接关系，用于 O(1) 查询）
CREATE TABLE IF NOT EXISTS test_map (
  source TEXT NOT NULL,
  test_file TEXT NOT NULL,
  signal TEXT NOT NULL DEFAULT 'import',  -- 'import' | 'heuristic' | 'mention'
  distance INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (source, test_file)
);
CREATE INDEX IF NOT EXISTS idx_test_map_source ON test_map(source);

-- ✅ 已实现
-- HTTP 路由映射（框架感知）
CREATE TABLE IF NOT EXISTS routes (
  file TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  framework TEXT NOT NULL,
  handler TEXT,             -- 函数名
  PRIMARY KEY (file, method, path)
);
CREATE INDEX IF NOT EXISTS idx_routes_path ON routes(path);
```

### 向后兼容

- 所有新增表使用 `CREATE TABLE IF NOT EXISTS`
- 旧版 CLI 读不到新表 → 正常 fallback 到 depGraph 内存重建
- `nodes` 表不新建独立表，改为在现有 `file_metadata` 上 ALTER TABLE 扩展 `type`/`role`/`lang` 三列
- 已实现的基础表（`file_metadata`/`parse_results`/`symbol_index`/`diagnostics`/`cache_metadata`）通过 `CACHE_TABLE_SCHEMA` 注册表驱动 load/save/saveIncremental

---

## 实施路线

### Phase 1：热缓存守护者（Hot Cache Keeper）— ✅ 已完成

**状态**：已交付。`saveIncremental()` 增量写入 + `cache.save()` 兜底全部就位。

| 改动 | 文件 | 说明 |
|------|------|------|
| `updateFiles()` 后触发 save | `src/services/dep-graph/builder.js` | 在 `finally` 块中 `await cache.save()`，把增量 parseResults 落盘 |
| Watcher 静默化 | `src/cli/watch.js` | 删除 `formatWatchOutput` 终端打印，保留 JSON Lines；默认 `--quiet` |
| 自动 save 兜底 | `src/services/file-index.js` | `processPending()` 完成后，若 dirty=true 自动触发 `cache.save()` |

**收益**：AST 解析时间降为 0；改动量 ~20 行；风险极低。

### Phase 2：Graph 边持久化 — ✅ 已完成

**状态**：已交付。`edges` 表 + `saveEdges()`/`loadEdges()` + `loadGraph()` 从 SQLite 恢复。

| 改动 | 文件 | 说明 |
|------|------|------|
| Schema 扩展 | `src/services/graph-db.js` | 新增 `nodes`、`edges` 表 DDL；`saveEdges()` / `loadEdges()` |
| 写入端 | `src/services/dep-graph/builder.js` | `build()` 完成后序列化 edges；`updateFiles()` 增量更新 edges |
| 消费端 | `src/services/dep-graph.js` | 新增 `loadGraph()`：从 SQLite 加载 edges 恢复 graph + reverseGraph |
| 集成 | `src/services/container.js` | `_initDepGraph()` 优先 `loadGraph()`，缺失时 fallback 到 `build()` |

**收益**：跳过 O(n) reverseGraph 重建；为 Phase 3 铺好 schema 基础。

### Phase 3：预计算持久化 — ✅ 已完成

**目标**：BFS/DFS 查询结果预计算后存入 SQLite，CLI 命令优先 SELECT。

**已完成**：
- `precomputed_impact` 表（含 impactRadius）：`savePrecomputedImpact()` / `loadPrecomputedImpact()`
- `precomputed_aggregates` 表：`savePrecomputedAggregates()` / `loadPrecomputedAggregates()` + `analysis_snapshot` 缓存
- `routes` 表：`saveRoutes()` / `loadRoutes()` / `loadRoutesForFiles()`
- `query-hotspots` / `query-knowledge-risk` / `query-stability` CLI 命令
- `metrics` 表（per-file PageRank / hotspot_score / risk_score / cochange_score 持久化与还原）
- `test_map` 表（source → test 的 O(1) 映射持久化与恢复）
- `file_metadata` 列扩展（type/role/lang 列定义与索引更新）

**不做**：`findings` 表（安全扫描太快没必要缓存）、`precomputed_tests` 独立表（已嵌入 precomputed_impact）

**收益**：`impact --file foo.js` 从"7 秒"降到"1ms（预计算命中时）"；AI 消费者高频查询大幅加速。

### Phase 4：CLI 彻底薄化（可选/远期）

**目标**：CLI 命令不再初始化 depGraph，只查 SQLite。

| 前提 | 说明 |
|------|------|
| watch 进程成为"必须" | 或首次运行时自动后台启动 watcher |
| 所有预计算数据可用 | SQLite 中 impact/tests/aggregates 完整且 fresh |

**改动**：`container.initialize()` 检测到热 SQLite 时跳过 `_initDepGraph()`；CLI 直接通过 `cache` 查询。

---

## 并发与一致性

- **写入**：watch 进程独占写入（`saveIncremental` 单事务）
- **读取**：CLI 命令只读（`node:sqlite` `DatabaseSync` 支持多进程并发读）
- **Staleness**：预计算表带 `version`（hash/mtime 指纹）和 `computed_at`，CLI 查库时校验，stale 则 fallback 重建
- **无需 IPC/文件锁**：SQLite WAL 模式天然支持一写多读

---

## 测试策略

| 层级 | 测试内容 |
|------|---------|
| 单元 | `GraphDB.saveEdges()` / `loadEdges()` 正确性；增量更新后 edges 一致性 |
| 集成 | Watcher 修改文件 → SQLite edges 更新 → CLI `loadGraph()` 读取 → 结果与内存重建一致 |
| 回归 | 大项目（GitNexus 1329 文件）冷启动时间对比；预计算命中率统计 |
| 并发 | 多个 CLI 实例同时读 + watch 进程写，无 SQLite 锁错误 |

---

## 风险与回退

| 风险 | 缓解 |
|------|------|
| SQLite schema 膨胀 | 旧表保留，新表 `IF NOT EXISTS`；旧版 CLI 完全兼容 |
| 预计算 stale | 带 version 指纹校验，stale 时 fallback 到现有内存重建逻辑 |
| Watcher 崩溃丢失更新 | `file-index.js` 自动 save 兜底；进程重启后从 SQLite 恢复 |
| 大项目 edges 表过大 | 千级节点 × 平均 10 条边 = 万级 rows，SQLite 无压力 |

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

### L3 品味与架构债务（1 项活跃）

按 [TECH_DEBT.md](./docs/TECH_DEBT.md) 记录：

| 位置 | 问题 | 优先级 |
| ---- | ---- | ------ |
| `cli.js` / `formatters` | `--json` 嵌套深；`determineExitCode()` 脏耦合 switch-case 链条 | 中 |

> 已修复项（历史见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]）：`inferFileRole` 状态化 + 规则盲区消除（`project-context.js`）、`shouldExclude` 跨层热切判定解耦（`file-index.js`）、COMMAND_GUIDES 内聚归位（`cli.js`）、Resolver FIFO → LRU（`resolvers.js`）、`js.js` 解析器拆分（将 `parseJavaScriptAST` 移至 `ast-parser.js`）。

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
| 错误     | ⏳ 待评估 | 异常抛出 raw stack trace，AI 被迫自己解析错误根因                   | 错误分类 + 可操作建议：如"路径不存在 → 检查 --cwd 是否正确"                   |
| 路径安全 | ⏳ 待评估 | `--file`/`--cwd` 等路径参数未做注入清洗                         | 拒绝 `../` 逃逸和绝对路径注入，与 `sanitize.js` 职责对齐                   |

---

## 长期方向（非承诺，见路线 I-2 深度评估）

| 方向                                             | 价值 | 成本 | 判断                        | 触发条件 / 现状                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ---- | ---- | --------------------------- | ------------------------- |
| 符号级调用解析（Call-Resolution DAG）            | 高   | 很高 | **当前不做**          | 需要新增 call graph 子系统；即使做了，Spring DI / Vue 模板 / MyBatis XML 等运行时绑定问题仍解不了                                                                                                                                                                                                     |
| 字段读写追踪（ACCESSES 边）                      | 高   | 高   | **当前不做**          | 同污点追踪，需要跨文件数据流分析，与"结构分析 ≠ 语义分析"原则冲突                                                                                                                                                                                                                                                   |
| CI Schema Parity 测试                            | 中   | 低   | 观察                        | 下一次 schema 变更前                                                                                                                                                                                                               |
| **安全白名单分派表 + Assert Defense**      | 高   | 低   | **接受**              | `security-tools.js` 每条规则独立 `is_match_allowlisted()`；测试内防御性匹配（`expect(error)`）抑制误报。参考 qartez 集中式白名单分派表                                                                                                                                                                                                                                                            |
| **端到端请求路径（路由提取）**             | 高   | 低   | **⏳ 暂缓**           | 越界语义分析风险：路由注册（`app.get('/users/:id', handler)`）是运行时语义，不是静态 import 边。若未来评估通过，只能做成可选适配器，不可成为默认依赖。参考 GitNexus `HANDLES_ROUTE` 边 + CRG entry point 检测                                                                                                                                                                             |
| **测试间隙穿透（Dispatcher Regex）**       | 中   | 低   | **接受**              | `affected-tests` 引入 qartez Dispatcher Regex + FTS Stem Mention 回退：无 import 边但测试文件 body 提及源文件 stem 时也纳入                                                                                                                                                     |
| **Bus Factor / 知识分布**                  | 中   | 低   | **接受**              | `audit-overview` 新增 `knowledgeRisk`：逐文件 `git blame` + mailmap 去重，标识"只有一个人懂的文件"。参考 qartez `src/git/knowledge.rs`                                                                                                                                                                                                                                               |
| **回归测试档案（fp_regression_*.js）**     | 中   | 低   | **接受**              | 死代码/安全/未解析 import 的已知误报场景归档，防止修复后复发。参考 qartez 回归测试模式                                                                                                                                                                                   |
| **路径参数安全清洗**                       | 中   | 低   | **接受**              | `--file`/`--cwd` 等路径参数在进入 graph 前统一清洗，拒绝 `../` 逃逸。参考 qartez `_sanitize_name` Prompt 注入防御。**追加**：CGC 因 Windows 反斜杠导致 `STARTS_WITH` 查询静默失败的教训（`Path.resolve()` → `as_posix()` 强制正斜杠）。workspace-bridge `path.js` 需审计存储路径一致性                                                                                                                                                                                                                                                                    |
| **自适应架构边界（`audit-boundaries`）** | 中高 | 中   | **接受**              | 读取 `.workspace-bridge.json` 可选 `boundaries[]` 字段，用 minimatch 遍历 edges 做违规检测；无配置时用目录层级聚类自动生成建议规则。参考 qartez `BoundaryRule` + CRG Leiden 聚类（edge weight 调参 + cohesion 计算 + 跨社区耦合 >10 条边警告）                                                                                                                                                                                               |
| **符号解析置信飞轮**                       | 中高 | 中   | **接受**              | Pre-scan 粗定位（全局 `symbol → [file]` 映射）→ Query 精确捕获 → CRG Tier 置信标注。输出每条边附 `confidence` + `tier`。参考 CGC Pre-scan + GitNexus Query 分层协议 + CRG Confidence Tier                                                                                                                                                                     |
| **增量更新终极协议（四层叠加）**           | 高   | 中   | **接受**              | L1 git diff → L2 SHA-256 过滤 → L3 Neighbor-aware 重解析 → L4 WAL Cadence。按层渐进。参考 CRG SHA-256 增量 + CGC Neighbor-aware + qartez WAL Cadence                                                                                                                                                                                                      |
| **复杂度趋势分析**                         | 中   | 中   | **接受**              | `git revwalk` 遍历 commit，tree-sitter 重新解析记录各符号 CC 和行数，输出 `GROWING/SHRINKING/STABLE`。参考 qartez `src/git/trend.rs`                                                                                                                                                                                                                   |
| **代码异味检测（Flat Dispatcher）**        | 中   | 中   | **接受**              | 扫描 `switch(action.type)` / `if-elif` 链，识别平铺 match（`arms ≥ 6` 且 `cc ≤ arms + 5`）和 Dominant 分支（`arms ≥ 12` 且 `arms ≥ cc × 0.4`）。参考 qartez `src/server/tools/smells.rs`                                                                                                                                                               |
| **SQLite pragma 调优**                     | 中   | 极低 | **接受 / 已交付**     | WAL + mmap + temp_store 调优，提升缓存写入和查询性能。P0 已交付。参考 qartez SQLite 配置                                                                                                                                                                                                                                                                                 |
| **Pre-scan 全局符号映射**                  | 中高 | 中   | **接受**              | 正式解析前轻量 query 提取所有文件顶层定义名，构建 `imports_map = {symbol_name: [file_path]}`。参考 CGC Pre-scan                                                                                                                                                  |
| **规则引擎层次 A（配置化）**               | 中   | 低   | **接受**              | 将 `security-tools.js` 硬编码规则提取为外部 YAML/JSON，无需数据库。通过 `--config <file>` 参数接入，不新增 `rules` 子命令                                                                                                                                                     |
| **规则引擎层次 B（AST 轻量规则）**         | 中高 | 中   | **接受**              | 基于现有 `functionRecords` 做方法级条件检查（如"batch* 方法无 @Transactional"），不跨文件                                                                                                                                                                |
| **AI 预消化输出（`--format ai`）**       | 高   | 低   | **接受 / 已交付**     | `--format ai` 已覆盖全部高频命令（`audit-summary` + `dead-exports`/`impact`/`affected-tests`/`cycles`/`unresolved`/`audit-security`/`audit-diff`），统一输出 `severity`/`counts`/`topRisks`/`actions`/`confidence`/`depth`/`tokenBudget`。skill 精简待深化。                                                                                                                                                                                     |
| **AI 摘要输出（纯模板）**                  | 高   | 低   | **接受**              | `--format summary` / `--format markdown` 用模板将 JSON 策展为 20 行关键结论或 Markdown 审查意见，不引入 LLM 调用                                                                                                                                                                                                                                                       |
| **增量分析扩展**                           | 高   | 低   | **接受**              | `--since <commit>` commit range、`--staged` 暂存区、`--files a,b,c` 指定文件列表、`--with-impact` 变更+依赖方自动展开                                                                                                           
| **跨调用缓存（ParseCache）**               | 高   | 中   | **接受**              | 当前每次运行重新解析所有文件。对"先 impact 再 affected-tests 再 audit-summary"连续查询场景，引入按 `mtime_ns` 失效的 AST + ident + calls 缓存。参考 qartez 四层 ParseCache（`source` → `tree` → `calls` → `idents`，lazy population）+ workspace fingerprint 冷启动跳过                                                                                                                                                                                       |
| **统一 risk scoring（5 维度）**            | 高   | 低   | **接受**              | `audit-diff` 引入跨文件变更风险排序：flow_participation + community_crossing + test_coverage + caller_count + security_sensitive。替代各命令自行判断。参考 CRG Risk Score：max(flow×0.25, community×0.15, coverage×0.30, security+0.20, callers/20×0.10)，top 10 review priorities。surprise scoring（跨社区+0.3、跨语言+0.2）增强 architecture advice                                                                                                                                                                                   |
| **诚实截断机制（Honest Truncation）**      | 中   | 极低 | **接受**              | `impact` / `affected-tests` 在大型单体项目中输出可能爆炸。给结果数组包装 `truncated` 布尔字段，超限后诚实告知"已截断，仅展示前 N 个"。参考 qartez `DependentList`                                                                                                                                                                                         |
| **per-tool benchmark + 回归检查**          | 中   | 低   | **接受**              | 扩展 `benchmark/` 目录，为每个 CLI 命令建立"有工具 vs 无工具"对照实验，检测性能回归。参考 qartez `benchmark/report.rs`（LLM-judge 评分 5 轴：correctness/completeness/usability/groundedness/conciseness + token 节省率 91.8%）                                                                                                                                      |
| **Parser golden snapshot 测试**            | 中   | 低   | **接受**              | 为各语言 parser 的 tricky 文件建立预期 AST 输出快照（`fixtures/goldens/`），`--update-goldens` 刷新。防止 parser 规则调整导致隐性误报。参考 CGC `fixtures/goldens/` + `test_parser_goldens.py`                                                                                                                               |
| **跨平台路径回归测试**                     | 中   | 极低 | **接受**              | 模拟 Windows 反斜杠路径输入，断言存储/查询格式一致（正斜杠或统一 abstraction）。参考 CGC `test_writer_path_normalization.py`（361 行回归防护）                                                                                                                  |
| **项目根自动发现（Monorepo）**             | 中   | 中   | **接受**              | 当前主要靠 `--cwd`，对 monorepo 支持不够智能。评估自动检测 `package.json` / `pom.xml` / `go.mod` 层级，支持 `--service <subpath>` 过滤。参考 qartez Workspace 扩展                                                                                                                                                                                        |
| **环境变量层 + 配置来源报告**              | 低   | 低   | **接受**              | 当前配置仅来自 `.workspace-bridge.json` 和 CLI 参数。增加 `WB_*` 环境变量层和启动时"来源报告"（config from: env > cli > file）。参考 qartez 配置系统                                                                                                                                                                                        |
| **JSON 输出 token 削减**                   | 中   | 低   | **接受**              | 大型文件 `--json` 输出过于庞大（`audit-file` 返回完整源代码）。引入 `elide_file_source()`：函数体 → 签名 + `{⋯}`，超限自动截断。参考 qartez token 削减                                                                                                                                                                                                                    |
| **async 未捕获异常处理（Fatal Handler）**  | 高   | 极低 | **接受 / 已交付**     | CLI async 路径未捕获异常可能导致静默退出。安装 `unhandledRejection` / `uncaughtException` handler，保留真实 stderr 后退出。参考 GitNexus `installFatalHandlers`                                                                                                                                                                                                 |
| **GraphBuilder / GraphAnalyzer 职责边界**  | 中   | 低   | **接受**              | 当前 `dep-graph.js` 内部已认知拆分，但对外接口未显式区分"节点构建期"和"边链接期"。参考 CGC 两阶段模型，职责边界文档化并提取为生命周期 hook                                                                                                                                                                                                                        |
| **语言注册表统一契约**                     | 中   | 低   | **接受**              | 当前 `parsers/` 缺乏统一契约。引入 `{ language, extensions, parse, extractImports, extractExports, isBuiltIn }` 配置表，统一 parserAvailability / import 解析 / 导出检测。参考 GitNexus `satisfies Record<SupportedLanguages, LanguageProvider>` 编译时穷举表 + `LanguageProvider`/`ScopeResolver` 双契约拆分                                                                                                                                                         |
| **框架检测 query 化（compilePatterns）**   | 中   | 中   | **接受**              | 当前 `framework-patterns.js` 使用硬编码 regex（TECH_DEBT.md L3 品味问题）。引入 `compilePatterns(treeSitterQuery) + runCompiledPatterns()`，新增框架只需一个 query 文件。参考 GitNexus `HttpLanguagePlugin` 契约（`scanFile` + `scanProject` + `prepareRepo`）+ graph-first 路由提取策略（优先复用 ingestion 已产生的符号级边，fallback 才走 source-scan）                                                                                          |
| **持久化图存储（SQLite）**                 | 高   | 中   | **✅ 已完成**          | 核心引擎迁移完成：`<br>`- `loadGraph()` 支持 `skipChangeCheck`，edges 加载成为默认路径`<br>`- `container.js` `_initDepGraph()` 实现混合路径：edges 加载 + 新增/删除/变更文件增量更新（`updateFiles`）+ delta>50% 时 fallback 到 `build()``<br>`- `file-index.js` 新增 `changedFiles` 追踪，精确标识 cache miss 文件`<br>`- 预计算 aggregates / impact 在 warm start 时从 SQLite 恢复`<br>`- 效果（278 文件）：Cold start ~960ms → Warm start（无变更）≈0ms → Warm start（1 文件变更）≈36ms`<br>`- 测试：`test/persisted-graph-test.js` 覆盖 edges 往返、新增/变更/删除增量、预计算恢复 |
| **分层输出过滤**                           | 中   | 低   | **接受**              | `--severity P0/P1` 按严重程度过滤、`--category security/performance` 按类别过滤（需规则打标签）                                                                                                                                                                                                                                                                     |
| **审查追踪（轻量）**                       | 中   | 低   | **接受**              | `--save <file>` 保存审计结果、`--check-regression` 对比上次审计检查 P0/P1 是否修复、`--baseline <commit>` 按变更文件标注问题为 `new`/`legacy`                                                                                                                                                                                                                   |
| **默认输出模式校准**                       | 中   | 低   | **接受 / 已交付**     | 默认输出已改为 `--format markdown`（~5 行，cli.js 第 474 行）。`--format human` 显式恢复人工输出已支持。                                                                                                                                               |
| **命令分层暴露**                           | 高   | 低   | **接受 / 已交付**     | `--help` 已按 L1/L2/L3/L4 四层分组；L4 命令标记为 debug 层级；`health` 标注 deprecated；`runCommand` 已拆分注册表。默认 `--help` 只展示 Tier 1（~5 个命令），其余折叠到 `--help --all`。SKILL.md 精简待深化。                                                                                                                                                      |
| **大项目自动截断/自适应**                  | 中   | 低   | **接受**              | 500+ 文件自动启用 `--compact`，或自动抑制低价值字段（architectureAdvice 等）。加 `--no-compact` 显式覆盖                                                                                                                                                                                                                                               |
| **噪音抑制增强**                           | 中   | 低   | **接受**              | `.workspace-bridge.json` 扩展 `ignore` 配置（框架感知排除）、`--mark-false-positive <id>` 记录误报（轻量，不引入机器学习）                                                                                                                 |
| **`--cache-dir` 参数**                   | 高   | 低   | **接受 / 已交付**     | `--cache-dir` 已支持，cli.js parseCliArgs 已注册。默认缓存放 `os.tmpdir()/workspace-bridge/<hash>/cache.db`（SQLite），项目间隔离。                                                                                                                                                                                                                     |
| **大项目截断（手动）**                     | 低   | 低   | **接受**              | `--max-files <n>` 只分析前 N 个变更/影响最大的文件，控制输出体积                                                                                                          
> 路线 I-2 GitNexus 深度对比 of 9 项发现中，数值 confidence / yieldToEventLoop / confidenceSource 标签 / git-aware staleness / import 策略链抽象 5 项已吸收并完成。详见 [CHANGELOG.md](./CHANGELOG.md)。
>
> 历史评估更新见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 活跃重构项

> 三层重构（数据层 / 编排层 / 输出层）的详细 Wave 计划、优先级与验收标准见 [SESSION.md](./SESSION.md) §下一步方向。
> 本文档不重复维护具体条目；以下仅为高层备忘。

- D6 消除 parseResults/graph 冗余（⏳ 长期）
- ~~O6 生命周期状态机~~ ✅ **已完成**（DependencyGraph 状态机 + Query 门控）
- U3 overview-tools 拆分（⏳ 中等）
- U7 audit-assembler 拆分（⏳ 中等）
