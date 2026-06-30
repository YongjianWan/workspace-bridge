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
> 开发迭代推荐 `npm run test:fast`（~18s，126 个 fast 层测试），比全量 runner（~5min）快 16×。

```bash
# 1. 快速自审（1 秒确认，不用等 runner，不读 CHANGELOG）
node cli.js audit-overview --cwd . --json --quiet
# 期望: summary.hotspots.length>0, summary.knowledgeRisk.high.length>=0, summary.orphans.length>=0, summary.deadExports.count>=0, summary.unresolved.count=0, summary.cycles.count>=0, summary.analysisCoverage.totalFiles≈413, summary.analysisCoverage.coverageRatio=1
```

**如果 audit-overview 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 历史变更见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `audit-overview` 输出正常（hotspots / knowledgeRisk / deadExports / unresolved / cycles）
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 0 架构债务 + 1 L3 + 0 项 P2 Dogfood 活跃缺陷）

---

## 基线状态

- 测试：**所有测试全部 PASS**；`npm run test:fast` **126/126 PASS**（~18s），`npm run test:smoke` **129/129 PASS**（~60s）。开发迭代首选 `npm run test:fast`；41 个测试文件已从 spawn 迁移到 in-process runner。
- CI：**GitHub Actions `Test` workflow 在 Node 22/24 矩阵上全部通过**（`test:fast` + `test:smoke`）；新增独立 `coverage` job 跑 `npm run test:coverage:check`（门槛：lines/statements ≥72%，functions ≥70%，branches ≥68%）。
- 版本：**v2.0.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~413 文件（entry=1, mainline=189, test=225）
- 结构性指标：deadExports=1（`shadow-candidates.js` 的 `SHADOW_EXTS` 静态分析误报，已标记为 `dynamic-registry-export` 低置信误报，不参与 severity），cycles=0，unresolved=0，orphans≈2（`.workspace-bridge.json` 作为 config 文件正常，以及 Windows 大小写不敏感路径 `agents.md`/`AGENTS.md` 被重复识别）；overview 维度：hotspots>0，knowledgeRisk 默认 `disabledReason: 'history-not-enabled'`，`--with-history` 启用
- 架构债务：当前活跃 0 项，详见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（已无活跃条目）。
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验）
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**历史交付**：路线 A–J 全部完成；阶段 1/2/3 全部完成；Wave 1-15 全部完成；L2 债务清零；产品债务清零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

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

### Route B 实战验证（本轮新增）

> **目标**：验证 workspace-bridge 的输出是否足以让 AI agent 在真实项目中做修改决策。
> 详见完整报告：`scratch/gitnexus-validation-report.md`

**验证对象**：`reference/GitNexus`（TypeScript，1290 文件）  
**聚焦文件**：`gitnexus/src/core/ingestion/scope-resolution/scope/walkers.ts`（30 直接依赖，最近 #2038 大重构涉及）

**关键发现**：

| 维度 | 结果 | 评估 |
| :--- | :--- | :--- |
| 依赖图准确性 | `impact` = 63 文件，`affected-tests` = 27 个测试，symbol-level 导入细节准确 | ✅ 高价值 |
| 循环依赖风险 | `cycles = 0` | ✅ 无风险 |
| 解析完整性 | `coverageRatio = 1.00` | ✅ 可信 |
| 验证命令建议 | `audit-file` 的 `validationAdvice.commands.focused/full` 为空，仅建议 `git diff --check` | ❌ 最后一英里断裂 |
| 启发式误报 | `csharp-hooks.test.ts` 因注释中提到 `lookupBindingsAt` 被 `mention:stem` 算入 affected tests | ⚠️ 低置信度噪音 |
| 路由噪音 | `affectedRoutes` 包含测试文件中的 Express 路由，未区分 `src/` vs `test/` | ⚠️ 相关性低 |

**验证结果**：
- ✅ `audit-file` 现在会生成 `node-direct-tests` / `python-direct-tests` 等 focused 命令（复用 `generateCommands` 的 `run-direct-tests` step）。
- ✅ `pickSuggestedCommand` 优先推荐 `direct-tests`，AI 拿到输出后可直接执行。
- ⚠️ GitNexus 根目录未检测到 vitest（子包在 `gitnexus/`），命令回退为 `npm run test`；这是 stack-detector 的 monorepo 边界问题，非本次修复范围。

**验证结果**：
- ✅ `affected-tests` `mention` 启发式现在在匹配前会按语言族去除注释（C-family / Python / Ruby），`csharp-hooks.test.ts` 这种仅注释引用的情况不再被误报。
- ⚠️ 旧缓存可能仍保留修复前的 mention 结果；新缓存或 `--cache-dir` 刷新后生效。

**验证结果**：
- ✅ `impact.affectedRoutes` 现在为每条路由附加 `source: 'src' | 'test'`，AI 消费者可直接过滤掉测试夹具路由。
- 实现路径：`src/services/dep-graph/query.js` 在 SQLite CTE 快速路径和内存 BFS 回退路径统一通过 `isTestLikeFile()` 计算 `source`。

**Route B 扩展验证：qartez-mcp（Rust，223 文件）**

**聚焦文件**：`src/guard.rs`（35 直接依赖，14 个 affected tests）

| 维度 | 结果 | 评估 |
| :--- | :--- | :--- |
| 依赖图准确性 | `impact` = 35 文件，`affected-tests` = 14 个测试，symbol-level 准确 | ✅ 高价值 |
| 验证命令建议 | `audit-file` 生成 `cargo test server::tools::test_gaps`，但 13 个 `tests/*.rs` 集成测试丢失 | ❌ 最后一英里断裂 |
| 死导出 | `deadExports = 113`，大量 `pub` 项为库公共 API 误报 | ⚠️ 已知限制 |
| 解析完整性 | `coverageRatio = 0.91`，19 个 Rust 测试文件 regex fallback | ⚠️ 可接受 |

**验证结果**：
- ✅ Rust focused/direct 命令现在拆分单元模块与集成测试：`cargo test <module>` 与 `cargo test --test <stem>`，14 个 affected tests 全部可执行。

**验证结果**：
- ✅ Rust 库公共 API 死导出误报已修复。`src/lib.rs` 通过 `pub mod` 链式公开的模块中，`pub` 未使用项会被标记为 `rust-public-api` 并降级为 `low` confidence，不再驱动仓库级 severity。
- 在 `reference/qartez-mcp` 上：113 个死导出候选中 75 个被正确识别为公共 API 误报并降级。

**Route B 扩展验证：ai_zcypg_backend（Java Spring Boot，395 文件）**

**聚焦文件**：`aizcypg-biz/src/main/java/com/aizcypg/biz/controller/PolicyMissingController.java`  
**真实任务**：实现 `checkMissing` 方法 TODO（`/policy/policies/{policyId}/missing-check` 缺漏检查逻辑）  
**完整报告**：`scratch/route-b-report-ai-zcypg-backend.md`

| 维度 | 结果 | 评估 |
| :--- | :--- | :--- |
| 解析完整性 | `coverageRatio = 1.00`（395/395） | ✅ 可信 |
| 框架识别 | `spring-controller-file` / `isEntry=true` | ✅ 高价值 |
| 依赖图准确性 | `impact` = 13 文件，但全为同包 Controller 可见性误报；全项目搜索无真实 `PolicyMissingController` 引用 | ❌ **核心误报** |
| 路由噪音 | `affectedRoutes` 包含 30+ 条路由，大量来自被误报的 Controller | ⚠️ 噪音高 |
| 验证命令 | `mvn -q -Dtest=*Test test`，但项目无 `src/test/java` | ❌ 不匹配实际 |
| symbolImpact | 10 个符号全部 `dependentsCount=0` | ⚠️ Java Spring DI/反射无法静态解析 |

**Route B 第二轮验证：ai_zcypg_backend / PolicyChatController.java**

**聚焦文件**：`aizcypg-biz/src/main/java/com/aizcypg/biz/controller/PolicyChatController.java`  
**真实任务**：实现 `callAiForAnswer` 方法 TODO（对接 Dify 聊天 API）  
**完整报告**：`scratch/route-b-report-ai-zcypg-backend-02.md`

| 维度 | 结果 | 评估 |
| :--- | :--- | :--- |
| 上一轮修复持续性 | 13 个 impact 全部 `implicit-same-package` | ✅ 修复稳定 |
| 验证命令 | 修复前：`mvn -q -Dtest=*Test test`；修复后：`mvn -q -DskipTests compile` / `package` | ✅ **本轮修复** |
| 路由噪音 | `affectedRoutes` 30+ 条，大量来自其他 Controller | ❌ 仍是主要噪音源 |
| symbolImpact | 全 0，无说明 | ⚠️ 待处理 |
| 多模块命令 | 未按子模块带 `-pl` | ⚠️ 待处理 |

**剩余缺口**（按 ROI）：
- Route B 在 GitNexus / qartez-mcp 上发现的 5 个消费体验缺口已全部修复。
- Route B 在 ai_zcypg_backend 上发现的 **Java 同包可见性误报** 与 **无测试项目验证命令降级** 缺口已修复。
- 仍待处理：affectedRoutes 分组/过滤、Java Spring symbolImpact 说明、多模块 Maven 命令感知。

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

## 修复流程

详见 [AGENTS.md §验证与调试](./AGENTS.md#验证与调试） 与 §Agent 认知边界。

---

## 实战基地

> `C:\Users\sdses\Desktop\神思\code` 是 workspace-bridge 的实战基地，内含四个仓库，用于功能验证与实战演练。

---

*Last updated: 2026-06-30（完成 Route B 两轮实战验证：在 ai_zcypg_backend 上修复 Java 同包可见性误报与无测试项目验证命令降级；新增 `scratch/route-b-report-ai-zcypg-backend.md` 与 `-02.md`；L1/L2/架构/L3 债务保持全零；npm run test:fast 126/126 PASS；schemaVersion: 1.2.0；version: 2.0.0）*
