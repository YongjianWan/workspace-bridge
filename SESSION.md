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
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 0 架构债务 + 1 L3 + 0 项 P2 Dogfood 活跃缺陷）

---

## 基线状态

- 测试：**所有测试全部 PASS**；`npm run test:fast` **109/109 PASS**（~10s），`npm run test:smoke` **112/112 PASS**（~60s）。开发迭代首选 `npm run test:fast`。
- 版本：**v2.0.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~366 文件（entry=1, mainline=164, test=202）
- 结构性指标：deadExports=1（`shadow-candidates.js` 的 `SHADOW_EXTS` 静态分析误报），cycles=1，unresolved=0；overview 维度：hotspots>0，knowledgeRisk 按实际分布
- 架构债务清零：Java/Kotlin 框架检测已全部 AST-Query 化；`bootstrapFromSchema` 路径规范化不一致已修复
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验）
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**历史交付**：路线 A–J 全部完成；阶段 1/2/3 全部完成；Wave 1-15 全部完成；L2 债务清零；产品债务清零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

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
    *   **状态**：⏳ 待开发。
    *   **理由**：解耦命令处理逻辑，暴露 `runCommand(config, command)` 纯函数入口，支持直接单元测试而无需进程 spawn。
    *   **交付物**：新建 `src/cli/run-command.js`，重构 `cli.js`，为 2-3 个高频命令编写无 spawn 单元测试。

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
- **每波收工前必须 `npm run test:fast` 85/85 PASS + 全量 runner 159/159 PASS**
- **每次修复后在 CHANGELOG.md [Unreleased] 追加条目**（单条不超过 3 行）

---

## 实战基地

> `C:\Users\sdses\Desktop\神思\code` 是 workspace-bridge 的实战基地，内含四个仓库，用于功能验证与实战演练。

---

*Last updated: 2026-06-13（Wave 15-2 补全 Java/Kotlin 框架检测 AST-Query 化与测试；npm run test:fast 109/109 PASS；schemaVersion: 1.2.0；version: 2.0.0）*
