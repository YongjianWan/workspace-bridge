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
# 期望: summary.hotspots.length>0, summary.knowledgeRisk.high.length>=0, summary.orphans.length>=0, summary.deadExports.count>=0, summary.unresolved.count=0, summary.cycles.count>=0, summary.analysisCoverage.totalFiles≈402, summary.analysisCoverage.coverageRatio=1
```

**如果 audit-overview 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 历史变更见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `audit-overview` 输出正常（hotspots / knowledgeRisk / deadExports / unresolved / cycles）
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 0 架构债务 + 1 L3 + 0 项 P2 Dogfood 活跃缺陷）

---

## 基线状态

- 测试：**所有测试全部 PASS**；`npm run test:fast` **123/123 PASS**（~30s），`npm run test:smoke` **126/126 PASS**（~60s）。开发迭代首选 `npm run test:fast`；41 个测试文件已从 spawn 迁移到 in-process runner。
- CI：**GitHub Actions `Test` workflow 在 Node 22/24 矩阵上全部通过**（`test:fast` + `test:smoke`）；新增独立 `coverage` job 跑 `npm run test:coverage:check`（门槛：lines/statements ≥72%，functions ≥70%，branches ≥68%）。
- 版本：**v2.0.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~402 文件（entry=1, mainline=182, test=218）
- 结构性指标：deadExports=1（`shadow-candidates.js` 的 `SHADOW_EXTS` 静态分析误报，已标记为 `dynamic-registry-export` 低置信误报，不参与 severity），cycles=1，unresolved=0；overview 维度：hotspots>0，knowledgeRisk 默认 `disabledReason: 'history-not-enabled'`，`--with-history` 启用
- 架构债务：当前活跃 0 项，详见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（已无活跃条目）。
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验）
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**历史交付**：路线 A–J 全部完成；阶段 1/2/3 全部完成；Wave 1-15 全部完成；L2 债务清零；产品债务清零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 历史变更详情

所有本轮已修复的问题与详细根因分析均已归档于 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

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
直说我的判断。

## 项目处在什么阶段

workspace-bridge 过去几轮做了大量的**内省循环**：写功能 → code review → 修 review 发现 → 更新文档 → 再 review。这个循环已经把 P0-P2 清零了，测试 123/123 全绿，9 语言 AST 全覆盖。

但问题是：**你已经在研磨精度递减的抛光工作了。** §3.5 聚合持久化、SKILL.md 精简、弱断言清理——这些都是 5%-to-5.5% 的改进，不是 0-to-1。

## 两条路线

### 路线 A：继续打磨（安全、低风险、递减回报）

按 ROADMAP §3.5 走：
1. `analysis_snapshots` 落盘 + `--fields` 白名单（~100 行）
2. 热缓存压到 <2s（需要 profile 瓶颈在哪）
3. SKILL.md 从 264 行砍到 80 行
4. 文档数字漂移修复
5. `.npmignore` 排除 CHANGELOG

**2-3 个会话搞完。然后呢？** 又回到找下一个打磨点的循环。

### 路线 B：换个姿势——真实项目实战验证（有风险、高信息密度）

你有实战基地（`C:\Users\sdses\Desktop\神思\code` 四个仓库）。但从文档看，实战主要是"跑 CLI 看输出对不对"，不是"让 AI agent 真正用 workspace-bridge 的输出来改代码，看它在哪里卡住"。

**真正的产品验证是**：
1. 拿一个真实任务（不是 workspace-bridge 自己）
2. 让 AI agent（你自己）只通过 workspace-bridge 的 CLI 输出来理解项目结构
3. 基于输出做代码修改
4. 记录哪里输出有用、哪里废话、哪里缺了关键信息

这会产生**比 code review 高 10 倍价值的反馈**——因为你不是在检查"代码有没有 bug"，而是在回答"这个工具作为 AI 的眼睛，看得够不够清楚"。

## 我的建议

**先做 30 分钟路线 A 的无脑活**（文档数字修复 + `.npmignore`），然后切路线 B。

原因很简单：workspace-bridge 定位是"AI 的代码脚手架"，但你一直在用**人类工程师视角**审计它。code_review.md 是人写的 review，TECH_DEBT.md 是人的品味标准，§3.5 是人设计的 query API。

缺的是：**从 AI 消费者视角回答——当我拿到 `audit-file --json` 的输出，我能不能在 5 秒内决定改这个文件要跑哪些测试、会波及哪些路由、有没有环路风险？**

如果答案是"能"——那 §3.5 不急。
如果答案是"不能，因为 X"——那 X 才是真正的下一步。
路线 C：Stage 4 — 符号级调用图（大工程）
ROADMAP 写的长期目标。把文件级依赖图升级到符号级 Call DAG。意味着：

impact --file foo.js --symbol handleLogin 能精确告诉你只有 3 个调用者受影响，不是整个文件的 47 个 dependents
affected-tests 从"这个文件被测试 import 了"变成"这个函数被测试调用了"
dead-exports 从启发式猜测变成确定性判断
成本极高（ROADMAP 自己写了"当前不做"）。需要跨文件 receiver-bound 调用解析、重载消解、继承链追踪。Spring DI / Vue 模板 / 动态 require 仍然解不了。

但—— 你已经有 functionRecords、symbolRegistry、symbol-impact.js。基础设施在那里。问题是从"文件 A import 了文件 B 的 foo"到"文件 A 的 bar() 调用了文件 B 的 foo()"这一步的工程量。

值得做的前提：你认为文件级粒度已经不够用了，AI 在实际修改代码时需要函数级精度。

路线 D：从工具变产品 — guard 命令深化
你刚交付了 guard 命令。这可能是 workspace-bridge 最有产品直觉的功能——在 AI 改代码之前拦截它，告诉它"你要改的这个文件会波及 47 个模块，你确定？"

深化方向：

pre-commit hook 集成：guard --staged --max-transitive 50 失败则阻止提交
AI agent 自动调用：改任何文件前自动跑 guard，超阈值自动拆分修改计划
blast radius 可视化：输出依赖扇出的 ASCII 树或 mermaid 图
这是把 workspace-bridge 从"分析工具"变成"AI 安全护栏"的方向。卖点从"告诉你项目结构"变成"阻止 AI 搞砸事情"。

路线 E：减法 — 砍功能、砍文档、砍复杂度
反直觉的方向。项目积累了：

4679 行 CHANGELOG
760 行 code_review.md
525 行 ROADMAP
234 行 SESSION.md
129 行 TECH_DEBT.md
30+ CLI 命令
9 语言 × 20+ 框架检测
文档和流程正在变成产品本身的负担。 每个新会话的 agent 要读完 AGENTS.md + SESSION.md + TECH_DEBT.md 才能开工。这些文档的维护成本已经不低于代码维护。

减法方向：

砍掉 L2 层命令（query-hotspots/query-stability 用的人是谁？）
把 ROADMAP 的已完成项全部移进 CHANGELOG，ROADMAP 只留未来
SESSION.md 从 234 行砍到 50 行
code_review.md 归档，别再维护
从 30 个命令砍到 10 个核心命令
路线 F：换赛道 — 把 workspace-bridge 变成 SKILL 本身
现在的架构：CLI 是引擎，SKILL.md 是 264 行驾驶手册。AI agent 读 SKILL → 调 CLI → 解析输出 → 做决策。

但如果把 workspace-bridge 的能力直接编码进 skill 的决策逻辑呢？不是"告诉 AI 有哪些命令"，而是"skill 自己判断什么时候该跑什么分析，然后直接把结论注入 AI 的上下文"。

类似于从"给你一把锤子"变成"我帮你钉钉子"。

总结：6 条路线的性质
路线	性质	风险	回报
A：继续打磨	维护	零	递减
B：实战验证	产品发现	低	高信息密度
C：符号级调用图	技术攻坚	高	质变（如果成功）
D：guard 深化	产品聚焦	中	明确卖点
E：减法	认知减负	低	可持续性
F：SKILL 自动化	形态转换	中	改变使用方式
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

## 下一步候选方向与多语言框架检测矩阵

### 候选方向状态（更新于 2026-06-13）

*   **方向 1：Java / Kotlin 框架检测 Query 化**
    *   **状态**：✅ 已于 2026-06-13 交付。
    *   **内容**：新建了 `java-spring.js`、`java-spring-boot.js`、`kt-spring.js`、`kt-ktor.js` 动态 Query 模块，并完成注册与测试。

*   **方向 2：Graph-first 路由提取升级**
    *   **状态**：✅ 已于 2026-06-17 交付。
    *   **内容**：实现了通过 SQLite 递归 CTE 直接进行图查询获取 affectedRoutes，避免了全量 BFS 或 disk source-scan 开销；补全了 cache.js 中的 saveRoutes 等持久化方法与测试。

*   **方向 3：CLI 可测试化入口**
    *   **状态**：✅ 已交付（`cli.js` 已导出 `runCliInProcess()`）。
    *   **遗留**：大量测试仍使用 child process spawn，迁移率低；文档中曾仍列为待开发，已修正。

*   **方向 4：策展可信度（Wave C）**
    *   **状态**：✅ 已于 2026-06-14 交付。
    *   **已完成**：动态 registry 模块已纳入 orphan 可达性（#11）；`SHADOW_EXTS` 等已知误报已排除 severity（#12）；个人仓库 knowledge risk 已关闭/降级（#14）；默认 overview 已不再跑逐文件 blame（#10）；REPL `top` 等架构指标默认排除 test→source 边（#13）。

*   **方向 5：Agent 产品形态（Wave D）**
    *   **状态**：🔄 部分交付，中优先级。
    *   **已完成**：`--quiet` 下 SQLite warning 泄漏已修复（#9）；`workspace-info` 已改为真正轻量命令（#15），实测 `<1s`；默认 `audit-overview` 已跳过逐文件 blame（#10），热缓存从 ~56s 降至 ~16s。
    *   **待完成**：继续将详细维度下沉到 `query-*`，把默认基线压到热缓存 <2s、JSON <8KB。

---

### 多语言框架检测与路由提取支持矩阵

| 语言 | 框架 | 框架检测方式 | 已有 route-extraction query？ |
| :--- | :--- | :--- | :--- |
| JS/TS | NestJS | regex (`AST_PATTERNS`) | ✅ `js-nestjs.js` |
| | Vue / Vue-router | ✅ AST-Query (`js-vue.js`) | ❌ |
| | Nuxt | 路径推断 + route query | ✅ `js-nuxt.js` |
| | SvelteKit | 路径推断 + route query | ✅ `js-sveltekit.js` |
| Python | Django / FastAPI / Flask / Celery | ✅ AST-Query (`py-django.js` / `py-fastapi.js` / `py-flask.js` / `py-celery.js`) | ✅ Django / FastAPI (`py-django.js` / `py-fastapi.js`); ❌ Flask / Celery |
| Java | Spring / Spring Boot | ✅ AST-Query (`java-spring.js` / `java-spring-boot.js`) | ✅ `java-spring.js` |
| | Quartz | regex | ❌ |
| | MyBatis | regex | ❌ |
| Kotlin | Spring-Kotlin | ✅ AST-Query (`kt-spring.js`) | ❌（复用 Java route） |
| | Ktor | ✅ AST-Query (`kt-ktor.js`) | ❌ |
| Go | Gin | ✅ AST-Query (`go-gin.js`) | ✅ `go-gin.js` |
| | Echo | ✅ AST-Query (`go-echo.js`) | ❌ |
| | Fiber | ✅ AST-Query (`go-fiber.js`) | ✅ `go-fiber.js` |
| Rust | Actix-web | ✅ AST-Query (`rs-actix.js`) | ✅ `rs-actix.js` |
| | Axum | ✅ AST-Query (`rs-axum.js`) | ✅ `rs-axum.js` |
| | Rocket | ✅ AST-Query (`rs-rocket.js`) | ❌ |
| C/C++ | 无特定框架标签 | 纯路径推断 | ❌ |
| Svelte | Svelte / SvelteKit | ✅ AST-Query (`js-svelte.js`) | ✅ `js-sveltekit.js` |
| Vue | Vue 组件 / Vue-router | ✅ AST-Query (`js-vue.js`) | ❌ |

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
- 每波收工前必须 `npm run test:fast` 123/123 PASS + 全量 runner 126/126 PASS
- 每次修复后在 CHANGELOG.md [Unreleased] 追加条目（单条不超过 3 行）

---

## 实战基地

> `C:\Users\sdses\Desktop\神思\code` 是 workspace-bridge 的实战基地，内含四个仓库，用于功能验证与实战演练。

---

*Last updated: 2026-06-17（Phase 3.5 聚合结果持久化与细粒度查询 CLI；npm run test:fast 123/123 PASS，npm run test:smoke 126/126 PASS；schemaVersion: 1.2.0；version: 2.0.0）*
