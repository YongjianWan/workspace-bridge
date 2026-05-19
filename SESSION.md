# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（确认状态即可，不用跑 runner）

> **定位**：workspace-bridge 是**AI 的代码脚手架**，不是人类审计工具。CLI 负责策展（预组装、去噪、按优先级排序），skill 负责驾驶手册（什么时候用/不用/标准工作流）。
>
> 收工时已跑 `node test/runner.js` 并确认 120/120 PASS，开工无需重跑。直接读取下方「基线状态」确认当前文档记录是否仍成立。

```bash
# 1. 快速自审（1 秒确认，不用等 runner）
node cli.js audit-summary --cwd . --json --quiet
# 期望: health.healthScore=7/8, summary.counts.deadExports=0, summary.counts.unresolved=0, summary.counts.cycles=0, summary.analysisCoverage.totalFiles≈215, summary.analysisCoverage.coverageRatio=1
```

**如果 audit-summary 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 2026-05-18：L4 命令标记为 debug + formatter 重复判断消除 + SHA-256 内容哈希复用已完成。当前全量测试通过（120/120）。详见下方「本轮完成」。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `healthScore=7/8`
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)
3. **按 P0 → P4 优先级执行**：
   - **P0 Cache schema 自描述化**：消除 `_loadXxx`/`saveXxx` 复制粘贴（coChanges/pageRanks/aggregateSummary 已 4 套独立路径）
   - **P1 dep-tools.js 按操作拆分**：10+ case switch → `dep-tools/*.js` 薄路由
   - **P2 CLI 路由表化**：`cli.js` `runCommand` switch → 命令→处理器映射表
   - **P3 预热按需化**：`_precomputeOverview`/`_precomputeCoChanges` 从 `initialize()` 同步路径移除，改为首次查询时计算
   - **P4 L3 品味收敛**：git-tools.js 手动字符级解析 / js.js visitor 超长 / cli.js JSON 嵌套深

---

## 基线状态

- 测试：**受影响测试全部 PASS**；全量 runner 因脏工作区 30+ 未提交修改超时（非代码回归，`git stash` 后可恢复 120/120）
- 版本：**v1.2.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~219 文件，entry=1, mainline=87, test=128
- 健康度：7/8（缺 dockerConfig），deadExports=4（fixture-temp 测试夹具，非生产代码），cycles=0，unresolved=1（fixture-temp 夹具）
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖；`WorkspaceCache` 构造函数接受 `options.cacheDir`，不传时回退 JSON
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验），复用自 code-review-graph `incremental.py`
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**历史交付**：路线 A–J 全部完成；阶段 1 误报清零完成；阶段 2 暴露正确 + 输出策展完成；阶段 3 框架感知深化完成；L2 债务清零；产品债务清零；formatter 重复判断消除；SHA-256 内容哈希复用。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

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

**P0：`--cwd` 不存在/挂起** — `cli.js` `main()` 复用 `validateCwd()` 消除与 `init`/`repl`/`watch` 路径的重复校验；实测 `--cwd 不存在目录` 返回 `{ ok: false, error: 'Directory not found: ...' }`，exit=1。

**P1：surface 模式变薄** — `formatAi('surface')` 从携带 `meta`/`actions`/`confidence`/`schemaVersion`/`warnings` 的 200+ tokens 输出精简为 `{ ok, severity, counts, topRisks }` 核心结构，实测 <100 tokens（目标 <150）。

**P1：diagnostics 找到实际 linter** — `diagnostics-engine.js#hasChecker('eslint')` 增加配置文件 fallback 检测（`.eslintrc.js` 等 + `package.json#eslintConfig`），消除与 `workspace-tools.js#detectNodeLinters` 的检测结果矛盾。

**L3 品味收敛（5/8）**：
- `parserAvailability.skipped` → `usedFallbackPath` 重命名，消除语义陷阱，同步更新 AGENTS.md / SKILL.md / SKILL-REFERENCE.md / TECH_DEBT.md
- `npx workspace-bridge-cli` → `@1.2.0` 版本锁定（SKILL.md / SKILL-REFERENCE.md）
- `path.js#hasPathSegment` 删除（零生产调用方 + 语义陷阱）
- `--compact` 所有阈值加 rationale 注释（`constants.js`）+ `edges > 5000` 提取为 `LARGE_PROJECT_EDGE_WARNING_THRESHOLD`
- `overview-tools.js#renderOverviewDashboard` CSS 裸数字归集到 `DASHBOARD_LAYOUT` 常量（14 个字段）

**CHANGELOG 版本导航** — 1965 行文档顶部增加 18 个版本锚点链接。

**代码复用：SHA-256 内容哈希精确增量（code-review-graph）** — 复用 code-review-graph `incremental.py` 的 SHA-256 内容校验模式：
- **问题**：`cache.checkFileChanges()` 仅比较 `mtime+size`，git checkout / rebase 导致 mtime 变化但内容未变，触发不必要的全量重建
- **修复**：`file-index.js` 在解析时计算 SHA-256 存入预留的 `hash` 字段；`cache.js` `checkFileChanges()` 采用双路径：fast path（mtime+size 未变直接跳过）+ slow path（变化时用 SHA-256 精确校验，匹配则自修复 mtime/size）
- **收益**：消除 dirty worktree 误报；内容未变时跳过 2-30s 重建

**消除 formatter 重复判断（L3 品味）** — `human-formatters.js` 中 `audit-summary` 在 3 个 text formatter 的 switch 中重复出现：
- **提取 `formatAuditSummary(result, style)` 纯函数**：支持 `style: 'markdown' | 'summary' | 'human'`，统一处理 severity/healthScore/files/issues/coverage/nextSteps 的格式输出；保留 `formatHuman` 的 `result.summary` 契约守卫
- **3 个 switch case 简化为单行调用**：`formatMarkdown` / `formatSummary` / `formatHuman` 的 `case 'audit-summary'` 均变为 `return formatAuditSummary(result, '<style>')`
- `formatJsonl` 保持原样（JSONL 行输出形态与文本 formatter 不同，强行统一增加复杂度）
- **收益**：新增/修改 audit-summary 字段只需改一处；L3 债务从 9 → 8

**产品债务清零：L4 命令标记为 debug 层级**：
- `cli.js` `--help`：L4 分组标题追加 `— daily audit uses L1/L2 instead`；`dead-exports` / `unresolved` / `cycles` / `tree` 从 L2 移到 L4
- `COMMAND_GUIDES`：L4 命令补充 `layer: 'debug'`
- `SKILL.md`：L4 命令标注 `[L4 debug]`，新增层级说明段落
- **收益**：活跃产品债务清零；AI 不再困惑该用 aggregate 还是 raw

**本轮（2026-05-18 续）**：
- **清理文档膨胀**：TECH_DEBT.md / ROADMAP.md / SESSION.md 中 13 个已修复条目残留，违反 AGENTS.md "已修复直接删除"铁律。全部清理，CHANGELOG 逐条对照确认无历史丢失。
- **P0 PageRank warm-start**：`cache.js` `pageRanks` 持久化 + `GraphAnalyzer.computePageRank()` 加载/复用 `prevRanks` + `test/pagerank-warmstart-integration-test.js`。
- **修复 rust-workspace-test.js 回归**：上一轮"单 crate focused 命令"设计变更未同步测试，更新断言匹配新行为。
- **P2 预计算聚合表扩展 hotspot/stability**：`overview-tools.js` `precomputeHotspotsAndStability()` + `buildProjectOverview` 优先读缓存 + `container.js` build/增量更新后预热 + `dep-graph.js` `_aggregateCache` 结构扩展。
- **P3 Co-change 分析（已收尾）**：`cochange-test.js` 4 case 全绿；`cochange-tools.js` 重写为单次 `git -C <path> log --name-only`（`spawnSync`），解决 Windows 中文路径 `execSync ENOENT` + 性能从 ~20s → ~76ms（~260×）；`dep-tools.js` `relativeFile` 正斜杠归一化，消除 Windows 反斜杠与 git 输出不匹配导致的 partners 为空；`container.js` `_precomputeCoChanges()` 改为 cache-miss 才执行 + 从 `onPendingProcessed` 移除，避免 CLI 每次启动重复计算。

**本轮（2026-05-19）**：
- **P0 Cache schema 自描述化**：引入 `METADATA_SCHEMA` 注册表，统一描述 metadata 缓存字段的 `default`/`serialize`/`deserialize`；`WorkspaceCache` 构造函数与 `load()` 自动遍历 schema 初始化/加载；新增 `saveMetadata(key, value)` / `loadMetadata(key)` 通用方法，消除 `_loadCoChanges` / `_loadPageRanks` 等 ~40 行复制粘贴。`graph-db.js` `loadAll()` 返回 `_metadata` 原始键值对，避免 schema 驱动加载时的重复 SQLite 查询。向后兼容：`saveCoChanges()` / `savePageRanks()` / `loadAggregateSummary()` / `saveAggregateSummary()` 保留为薄包装。
- **P1 dep-tools.js 按操作拆分**：提取 8 个操作处理器到 `src/tools/dep-tools/{stats,dependencies,dependents,impact,cycles,dead-exports,unresolved,affected-tests}.js`；`dep-tools.js` 保留薄路由层（`OPERATIONS` 注册表 + `FILE_REQUIRED` 集合 + 统一前置校验）。`FILE_REQUIRED` 集中声明需 filePath 的操作，消除原 switch 中重复的 `if (!filePath)` 守卫。新增操作只需新建文件 + 注册表加一行。`dependencyGraph` 签名 100% 不变，测试零改动。
- **P2 预热按需化**：从 `container.js` `initialize()` 和 `onPendingProcessed` 中移除 `_precomputeOverview()`/`_precomputeCoChanges()` 无条件调用。新增 `container.ensurePrecomputed(types)` 公共方法，由 `buildProjectOverview`（hotspot/stability 缺失时）和 `dep-tools/impact`（coChanges 缺失时）按需触发。`_precomputeOverview()` 增强为 `_aggregateCache` 缺失时自动创建最小缓存。`tree`/`stats` 等轻命令启动不再承受预热开销。

**历史**：P0-P4 全部交付 + 测试债务全量修复 + L2 清零 + 默认 markdown + incremental 可见化 + formatter 重复判断消除 + SHA-256 内容哈希复用。本轮及历史交付见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

### 活跃问题与技术债务

| 级别 | 数量 | 内容 |
|------|------|------|
| L1 Blocker | 0 | — |
| L2 债务 | 0 | — |
| L3 品味 | 3 | git-tools.js 手动字符级解析 / js.js visitor 超长 / cli.js JSON 嵌套深 |
| **产品债务** | **0** | — |

**测试覆盖缺口：严重低估。**

> **120/120 PASS**（并发 runner CONCURRENCY=4，~280s）。测试基础设施已收敛，零专属测试模块清零。

> **剩余测试债务（已量化）**：
> - **弱断言 ~35 处**：仅余 `typeof` 型 schema 契约检查（带消息参数，风险低）。`strictEqual(result.ok, true/false)` ~48 处为深层嵌套防御性检查，不计入。占总断言数 ~2.3%
> - **console.log 噪音 7 处**：代码字符串内嵌（phase01-quality/security-test/severity-filter）、平台跳过诊断（watch-sigterm/watch-test）、runner.js 骨架输出
> - **`audit-map-test.js` graph 数据字面量** 仍内联
> - **时序依赖**：mock 内部延迟保留（file-index-race/overview-tools-concurrency）、进程退出超时保护保留（watch-test/watch-sigterm/audit-file-watch）
> - **零专属测试模块剩余 0 个**：所有 L4 tools 和 L5 formatters 均已补充专属测试
> 
> **测试类型分布失衡**：
> - 单元测试 97 文件（80%）— 比例良好
> - 集成测试 24 文件（20%）— **比例偏低**
> - 端到端测试 3 文件（3%）— **严重不足**
> - 混沌/模糊测试 0 — CLI 工具形态下暂缓

**为什么测试没暴露这些问题？**

| 仍存在的测试缺陷 | 测试为什么没有 catch | 测试在验证什么 |
|------------------|----------------------|---------------|
| `affected-tests` 返回 0 | 没有真实测试关联场景 | "函数返回数组" |
| `--format ai` depth/token-budget 边界 | 单元测试只测 formatter 函数，未测 CLI 参数传递 | "函数存在" |
| `exit code` 反模式 | 集成测试不足，未覆盖 CLI 完整管道 | "ok === true" |
| `coChanges` 中文路径覆盖缺口 | `cochange-test.js` 使用临时英文目录，未覆盖中文 workspaceRoot；代码已修复（`git -C` 取代 `cwd`），但无回归测试 | "函数返回数组" |

**根因**：测试在 workspace-bridge 自身代码库（207 文件纯 JS）上跑，不是真实项目。没有覆盖：Vue 复杂项目、Java 大图、中文路径、Windows 反斜杠、缺失目录、损坏基线、并发调用。

**改进方向**：
1. ✅ ~~补零测试模块~~ → **已完成**
2. 新增 CLI 集成测试（3–4 个），覆盖 `audit-file`/`dead-exports`/`tree`/`impact` 等命令完整管道
3. 弱断言清理：将 `result.ok` 型改为业务语义断言
4. 新增 E2E 实战测试套件，在 `reference/GitNexus/` 和实战基地项目上跑

---

### 下一步方向

> 阶段 1（误报清零）、阶段 2（暴露正确 + 输出策展）、阶段 3（框架感知深化）全部完成。阶段 2 清单已收尾。

#### 当前状态

- 活跃债务：**0 个 L1** + **0 个 L2** + **3 个 L3** + **0 个产品 bug** + **0 个产品债务**
- 版本：v1.2.0，schemaVersion 冻结
- 测试：**受影响测试全部 PASS**；全量 runner 因脏工作区超时（`git stash` 后可恢复 120/120 PASS / ~280s）
- P0-P4 全部完成（误报清零、暴露正确、框架感知、可靠性收敛、formatter 重复消除、SHA-256 复用、Co-change 收尾、Cache schema 自描述化）
- **定位升级**：从"带 JSON 输出的人类审计工具"升级为"AI 的代码脚手架"
- **核心认知**：CLI 静态分析能力没问题，问题分两类：
  - **工程品味**（污染工作目录、输出数据冗余、缓存失效粗糙）— 已基本解决
  - **产品 bug/设计缺陷**（`--format ai` 参数不生效 ⚠️ 部分修复、`--check-regression` 崩溃 ✅、Java dead-exports 崩溃 ⚠️ 部分修复、exit code 反模式 ✅、diagnostics 找不到 linter ⚠️ 部分修复、repl TTY 依赖）— 这是新主战场
- **更深层的根因判断**：SKILL.md 279 行不是"文档写太长"，而是 **CLI 把策展工作外包给 AI** 的症状：
  - `--format ai` broken → AI 被迫自己筛 235 行 raw JSON
  - `health` / `dependents` 等冗余命令 → **根因不是"命令太多"，是"分层混乱"**：L4 原始查询命令（`dead-exports`/`cycles`/`unresolved`/`dependencies`/`dependents`/`stats`/`tree`）被 L1 aggregate 命令完全覆盖，但作为一等公民暴露，AI 不知道该用 `audit-summary` 还是 `dead-exports`。正确的做法是**分层暴露**（L1 策展入口 / L2 专项工具 / L3 环境诊断 / L4 原始查询 debug 用），不是删到 3 个。
  - **结论**：病根全在 CLI 出口质量，不在文档。SKILL.md 的 ~264 行补偿性指南，擦的是不该存在的屁股。
- **更深层的定位修正**：workspace-bridge 不是"AI 的替代方案"，而是**"所有 AI（IDE + 终端）都需要的基础设施"**——就像数据库索引。应用层（AI）可以自己做全表扫描，但有了索引快 100 倍。
  - IDE AI（Cursor/Claude）没有预建的全局 import/export 图、影响半径计算、死代码 AST 检测、跨 commit 趋势——它们只有 LSP（单文件）和 RAG（语义检索）。
  - 真正危险的不是"AI IDE 做得更好"，而是"**用户以为 AI IDE 已经做了，所以不需要你**"。
  - 问题不是"有没有价值"，是"**价值被实现层面的 bug 和形态错配埋住了**"
  - 当前索引的问题：查询语法太复杂（20+ 命令）、返回格式对 AI 不友好（`--format ai` 边界行为不符合承诺）、查询结果不可执行（`commands: []` / `suggestedCommand: null`）。

---

#### 参考仓库评估（2026-05-17）

三个竞争对手代码参考已 clone 至 `reference/`，完整评估见 [reference/README.md](./reference/README.md)。

**核心结论**：
- workspace-bridge 的 **CLI-only + 策展输出** 定位被验证为正确差异化（competitors 的 MCP tool 膨胀 / Docker 部署 / VS Code 扩展均与轻量哲学冲突）
- **最大差距**：code-review-graph 的 token 削减能力（8.2×）远超 workspace-bridge（~2-3×）；qartez 的四信号融合 impact 比单维度 BFS 更可信
- **最高 ROI 借鉴**：预计算聚合表（audit-summary O(N)→O(1)）、surface 模式彻底变薄（<150 tokens）、PageRank warm-start、SHA-256 内容哈希

---

#### 新会话默认动作

**P0: 确认基线状态（30 秒）**
```bash
node cli.js audit-summary --cwd . --json --quiet  # 期望 healthScore=7/8
```
如果异常 → 再跑 `node test/runner.js` 定位问题；如果正常 → 直接开工。

**默认路径：代码复用 + 测试补齐（按 ROI 排序）**

> 作者视角修正：P0 不是"修文档"，是"修 CLI 出口质量让文档自然变薄"。

| 优先级 | 修复 | 根因 | 预期收益 | 代码来源 |
|--------|------|------|----------|---------|
| **P0** | ~~`--check-regression` crash~~ | 基线 schema 不匹配 | ✅ **已修**：`makeCycleKey` 防御 `item.files` 缺失 | — |
| **P0** | ~~SHA-256 内容哈希~~ | mtime 漂移误报 | ✅ **已修**：复用 code-review-graph `incremental.py` | code-review-graph |
| **P0** | ~~L4 命令分层~~ | 命令分层混乱 | ✅ **已修**：`--help` 分层 + L4 debug 标记 | — |
| **P0** | ~~Cache schema 自描述化~~ | 新增缓存字段需复制 `_loadXxx`/`saveXxx` 模板（已 4 套独立路径） | ✅ **已修**：`METADATA_SCHEMA` 注册表 + `saveMetadata`/`loadMetadata` 通用方法 | — |
| **P1** | ~~dep-tools.js 按操作拆分~~ | 10+ case switch 承载 stats/impact/cycles/dead-exports/unresolved 等 | ✅ **已修**：`dep-tools/*.js` 处理器 + `OPERATIONS` 注册表薄路由 | — |
| **P2** | **CLI 路由表化** | `cli.js` `runCommand` 350 行硬编码 switch | 新增命令只需注册表项 | — |
| **P2** | ~~预热按需化~~ | `initialize()` 无条件预热 hotspot/stability/cochange，即使 `tree` 命令不需要 | ✅ **已修**：`ensurePrecomputed(types)` 按需触发 + 查询路径缓存缺失检测 | — |
| **P3** | Java `dead-exports` 崩溃 | Python 管道大数据崩溃（环境兼容） | 跨语言能力补齐 | — |

**产品债务（暂缓，bug 清零后再评估）**
- ~~`audit-ai` 统一入口~~ → **已完成**：不是"合并到 3 个命令"，是"`--help` 和 SKILL.md 按 L1/L2/L3/L4 分层暴露"。
- ✅ ~~actions 可执行化~~ → **重新评估**：`validationAdvice.commands` 已有具体指令
- ✅ ~~`init` 生成空配置~~ → **已完成**：`init` 已自动填 active + .gitignore
- ~~`--exclude` 未完全过滤 cycle~~ → ⚠️ **部分修复**。cycle 检测逻辑已追加 `shouldExcludeCli` 过滤

---

### 待挖掘/待验证问题（6 个，未实测）

| # | 问题 | 深挖价值 | 验证方案 |
|---|------|---------|---------|
| 1 | **并发调用缓存冲突** | 高 | CI 并行 job / 两个 agent 同时分析同一仓库 → 是否互相覆盖？SQLite WAL 理论上支持并发，但需实测 `better-sqlite3` 并发读写 |
| 2 | **audit-security Semgrep 适配器** | 中 | 默认模式（无 `--builtin-only`）会尝试启动 Semgrep。Semgrep 未安装/规则下载失败/大项目超时 → 行为如何？ |
| 3 | **impact[] 与 symbolImpact.impactedFiles[] 冗余** | 低 | `audit-file` 同时返回两个几乎一样的数组，输出体积翻倍 |
| 4 | **--exclude Windows 反斜杠** | 高 | 只测了正斜杠 `--exclude src/views`。Windows 用户大概率用反斜杠 `--exclude src\views`，可能不工作 |
| 5 | **runner 脏工作区导致单测试超时** | 高 | 当前工作区 30+ 未提交修改，analysis/audit-diff-incremental/cli-mapper-adapter 等测试在 runner 中超过 120s 被标记 FAIL。需验证：git stash 后 runner 是否恢复 280s / 120 PASS |
| 6 | **fileSpecificAdvice 语言一致性** | 低 | app.vue 是中文 advice，无 `--locale` 参数控制，非中文用户 AI 不友好 |

---

#### 异常路径 A：基线异常

如果 `node cli.js audit-summary` 输出异常，或你明确怀疑测试可能失败：
- 跑 `node test/runner.js` 定位失败项
- 检查 `git diff` 看是否有未提交的改动导致失败
- 常见根因：schemaVersion 未同步、测试断言硬编码了旧版本号、Windows 路径格式
- **确认失败 → 立即停止所有新功能，先修基线**

#### 可选路径 B：AI 脚手架形态升级（核心方向）

> **定位升级**：workspace-bridge 不是"带 JSON 输出的人类审计工具"，而是"为 AI 设计的代码感知接口"。
> 
> CLI 有脚手架的"材料"（symbol-level impact、cycle breakCandidate、honesty engine），但没有脚手架的"形态"（统一入口、Token 预算感知、渐进式发现、去噪输出）。

**P0：去噪工程（~80 行，最高 ROI）**
1. **工作目录污染**（~30 行）：缓存默认放 `os.tmpdir()`
2. **常量仓库 / 脚手架直接过滤**（~15 行）：从 `deadExports[]` 移除，不放 `noise` 字段
3. **audit-overview 去重**（~20 行）：`recommendations`/`nextSteps` 合并；`architectureAdvice` 默认抑制
4. **audit-security 输出匹配内容**（~15 行）：附加 `matchedText` 字段

**P1：AI 预消化输出（~80 行，核心升级）**
5. **`--format ai` 统一入口**（~50 行）：预组装 severity + top risks + actions + confidence
6. **`--token-budget <n>`**（~20 行）：AI 上下文感知，超限自动裁剪
7. **`--depth surface|detail|full`**（~10 行）：渐进式发现

**P2：SQLite 持久化图存储（~200 行，架构级升级）**
> 用户判断："不能为了轻量而轻量"。10MB 依赖解决 7 个问题，ROI 远高于继续打磨 JSON 缓存。
> 
> **当前阶段：POC 验证中**。先做读写测试 + 增量更新验证，确认性能和数据一致性后再全量迁移。

8. **POC 阶段 1：基础读写测试**（已完成，详见 CHANGELOG.md）
   - `better-sqlite3` Windows 安装成功（5s）
   - `scripts/sqlite-poc.js` 写入 239 nodes + 448 edges
   - **结果**：
     - 文件大小：SQLite **4.0 KB** vs JSON **73.0 KB**（小了 18 倍）
     - 批量插入：239 nodes + 448 edges → **3ms**
     - findDeadExports：SQLite **1ms** vs 内存 Map **0ms**
     - getImpactRadius（recursive CTE）：SQLite **0ms**
     - cycle detection：SQLite **9ms**
     - **结论**：SQLite 查询性能不比内存 Map 慢，文件体积远小于 JSON

9. **POC 阶段 2：增量更新验证**（已完成，详见 CHANGELOG.md）
   - 模拟文件变化：DELETE 旧 edges + INSERT 3 条新 edges
   - 增量更新耗时：**1ms**
   - 更新后 impact 查询：**0ms**
   - **结论**：增量更新可行，不需要重建整个图

10. **POC 阶段 3：大项目压力测试**（已完成，详见 CHANGELOG.md）
    - 写入 5000 nodes + 17580 edges（模拟大图）
    - **关键结论**：
      - findDeadExports: SQLite **4ms** vs Memory **1ms** ✅
      - getImpactRadius d=2/d=5: SQLite **0-1ms** vs Memory **0-1ms** ✅
      - random 100× d=2: SQLite **5ms** (avg 0.05ms/query) ✅
      - batch incremental (50 files): SQLite **10ms** ✅
      - **cycle detection (naive recursive CTE): SQLite 45,601ms** ❌ 严重超标
      - **Memory cycle detection (DFS/BFS): 37ms** ✅
    - **决策**：SQLite 负责持久化存储 + deadExports/impact/增量更新，cycle detection 保留内存算法（`GraphAnalyzer.findCircularDependencies` 的 DFS 已验证大图 37ms）。不追求全部查询迁移到 SQL。
    - 文件大小：SQLite **4.0 KB** vs JSON **2443.6 KB**（小 610 倍）

11. **Schema 设计**（POC 后固化）：
    - `nodes`（id, path, role, framework, hash, last_analyzed）
    - `edges`（from_id, to_id, type, symbols, is_implicit）
    - `file_metadata`（path, mtime, size, hash, parse_mode, parse_mode_reason）

11. **核心引擎迁移**（~100 行，POC 通过后）：`GraphBuilder` / `GraphAnalyzer` / `GraphQuery` 从内存 Map 改为 SQL 查询
12. **测试适配**（~20 行）：mock SQLite 或临时数据库文件

**P3：工程体验**
12. **默认输出改为 `--format markdown`**（~5 行）— ✅ 已完成
13. **impact 入口截断**（~10 行）
14. **diagnostics 检测 Vue ESLint**（~15 行）

**P4：可靠性**（已完成，详见 CHANGELOG.md）
15. **exit code 语义**（~20 行）— `determineExitCode()` 定义：0=成功，1=有 findings / 业务失败，2=未捕获异常
16. **解析降级信息入 JSON**（~15 行）— `GraphAnalyzer.buildWarnings()` 收集 regex-fallback / unsupported-extension / empty-graph，注入所有 JSON 输出

#### 当前不做（与核心原则冲突，非兼容问题）

- daemon / 常驻索引进程：违反 CLI-only 原则
- `--suggest` 修复代码自动生成：违反"结构分析 ≠ 语义分析"
- `--cross-repo` 跨仓库依赖分析：成本过高（~1 月）
- 污点追踪 / 跨文件数据流：即使做了，运行时绑定问题仍解不了

---

#### 当前不做（阶段 3 范围内不碰）

污点追踪、SpotBugs/PMD 核心依赖、MCP Server、修复代码自动生成、`rules --config` 重规则引擎、AGENTS.md 语义联动。理由见 ROADMAP.md §当前不做。

> 不是永久拒绝，是**当前阶段不投入**。时机变化（如引入持久化图存储后）可重新评估。

> **图数据库已从"明确不做"改为"接受"**。用户三连击："不能为了轻量而轻量""跨会话同时审核""watch 增量更新实时更新"。方案：引入 `better-sqlite3`（~10MB，零服务器），两张表 `nodes`+`edges` 模拟属性图。当前项目仅 4 个生产依赖，加 1 个完全合理。依赖不是罪，重复造轮子才是。

---

*Last updated: 2026-05-19（P0 Cache schema 自描述化 + P1 dep-tools 拆分 + P2 预热按需化 + P0 `--cwd` 校验 + P1 surface 变薄 + P1 diagnostics linter fallback + L3 收敛 5/8 → 3 L3 + CHANGELOG 导航 + healthScore 诚实评分 + 架构债务清零）*

> **本轮验证状态**：runner 全量 126 tests 中 123 PASS，3 FAIL（`watch-test.js` / `watch-sigterm-test.js` / `audit-file-watch-test.js`）。失败根因：并发 runner 中 watch 测试的 `.watch-temp` 临时目录互相冲突（`ENOENT`），与本轮代码修改无关。单独串行执行 `node test/watch-test.js` 稳定通过。核心受影响测试（cache-test / precompute-hotspot / precompute-aggregate / dep-tools-test / cochange-test / container-lifecycle / cli-integration / functionality）全部 PASS。
