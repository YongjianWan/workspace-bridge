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
# 期望: summary.hotspots.length>0, summary.knowledgeRisk.high.length>=0, summary.orphans.length>=0, summary.deadExports.count>=0, summary.unresolved.count=0, summary.cycles.count>=0, summary.analysisCoverage.totalFiles≈308, summary.analysisCoverage.coverageRatio=1
```

**如果 audit-overview 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 历史变更见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `audit-overview` 输出正常（hotspots / knowledgeRisk / deadExports / unresolved / cycles）
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 3 活跃债务 + 0 项 P2 Dogfood 活跃缺陷）

---

## 基线状态

- 测试：**受影响测试全部 PASS**；`npm run test:fast` **84/84 PASS**（~20s）。全量 runner **161/161 PASS**（~5min）。开发迭代首选 `npm run test:fast`（~20s）或 `npm run test:smoke`（~54s）。当前 fast 层 84 个测试，slow 层 70 个，serial 层 7 个。
- 版本：**v2.0.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~308 文件（entry=1, mainline=139, test=169）
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

---

## 本轮上下文：文档规范与历史归档（活跃）

> **背景**：在经历了 Wave 1-6 大规模 Dogfood 修复波次以及性能、状态机 O6 重构后，主线任务已全部圆满交付。
> 根据项目文档规范，“历史只在 changelog 里面有，活跃文档只存当前状态”。

### 本轮已交付

- **Wave 7：Dogfood P2 缺陷集中歼灭（2026-05-28）**：#22 参数验证错误分类重定向（`_utils.js` + `cli.js`）、#35 `--check-regression` 缺失 baseline fail-fast（`audit-assembler.js` + `overview-tools.js`）、#37 REPL `--eval` 分号多命令支持（`repl.js`）、#30 内置安全规则语言过滤与测试目录排除（`security-tools.js`）。详见 CHANGELOG [Unreleased] §Wave 7。
- **第二轮深度代码审查修复（2026-05-28）**：基于 `docs/code_review.md` 修复 5 项问题并补充测试。
  - **安全**：`regression-tools.js` 3 处 `execSync` 字符串拼接全部替换为 `execFileSync` 参数数组，根治 Command Injection（`--baseline` 参数注入风险）。
  - **状态机**：`container.js` 删除 `initialized`/`initializing` setter，消除绕过 `VALID_TRANSITIONS` 的后门。
  - **性能**：`shared.js` `bfsTraverse` 热路径 `queue.shift()` O(n) 改为指针 `head++`，复杂度降一个数量级。
  - **死代码**：`builder.js` 删除 O6 重构残留的第二次 `_finishUpdating()` 调用。
  - **封装**：`workspace-snapshot.js` 删除 `DependencyGraphView` 对 `_scanSymbolUsageInImporters` 的内部方法暴露。
  - **文档**：`code_review.md` 已清理已修复条目，`TECH_DEBT.md` 同步追加 4 项新活跃债务。
- **第三轮深度代码审查修复 + 测试.harness 回归修复（2026-05-28）**：
  - **Analyzer 封装**：`analyzer.js` 暴露 `restoreAggregateCache` / `setOverviewData` / `getAggregateCache` / `clearScanCaches` 正规接口；`container.js` 全部替换为 API 调用，消除直接戳 `_aggregateCache` 的内部操作。
  - **REPL 内存泄漏封堵**：`findDeadExports()` 返回前 `clearScanCaches()`，消除 watch 模式下 500 文件 × 100KB 的泄漏上限。
  - **metadata-only dirty 修复**：`graph-db.js` + `cache.js` 将 metadata 非空纳入 `hasWork`，确保 version/timestamp 更新能触发写入事务。
  - **Baseline 解析统一**：删除 `audit-assembler.js` 与 `overview-tools.js` 中各自 fallback 路径，统一由 `regressionTools.resolveBaseline()` 驱动。
  - **回归测试 exit code 对齐**：移除 `resolveBaseline` 的 try-catch 遮蔽，让 `Baseline file not found` 作为 `path_error` 传播，返回 exit code `2`，修复 `test/regression-test.js` 硬失败。
  - **spawnSync maxBuffer 修复**：`test/test-helpers.js` 默认 `maxBuffer` 提升至 5MB，修复 `audit-diff` 大量输出导致 `status === null` 的 `validation-advice-schema-test.js` 失败。
- **Wave 7 代码重构与债务偿还（2026-05-28）**：提取 `regression-tools.js` 公共函数 `resolveBaseline` 消除 `audit-assembler.js` ↔ `overview-tools.js` 跨文件重复代码（L2-7）；`security-tools.js` `isTestPath` 硬编码列表提取为 `TEST_PATH_PATTERNS` 常量（L2-6）。
- **文档规范化卫生清理（2026-05-28）**：
  - 深度清理 `docs/TECH_DEBT.md`，彻底移除已修复的 29 项 Dogfood 缺陷详情与草案，物理精简为仅包含 8 项活跃的 P2 级体验缺陷，历史已修复信息全部交由 [CHANGELOG.md](./CHANGELOG.md) [Unreleased] 追溯。
  - 深度清理 `SESSION.md`，删除已完成的 Wave 1-6 长表与验收标准等冗余细节，保持会话指南的紧凑性与行动导向。
  - 回归跑通基线命令，确认系统完好。
- **致命回归修复与 Dogfood 陷阱归档（2026-05-28）**：
  - 修复上一轮 commit 中 `GraphAnalyzer` API 承诺与实现不一致（`getAggregateCache` / `clearScanCaches` 缺失），导致 CLI 启动崩溃的致命回归。
  - 复现验证并归档 5 个已修复的 Dogfood 陷阱：空文件 severity 误报（Pitfall 4）、`--format ai` 丢失 validationAdvice（Structural 5）、validationAdvice schema 不一致（Structural 1）、REPL `--eval --json` 文本包裹（Structural 3）、stats Markdown `[object Object]` 输出。
  - 同步清理 `TECH_DEBT.md` 中上述已修复陷阱的活跃记录，更新 Redundant/Broken Tier 状态。

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
| 活跃债务与品味     | 3           | 弱断言分布 ~11 处 / "默认宿主"DG_STATES 暂留 facade / `--json` 嵌套深 |
| **产品债务** | **0** | —                                                                  |

**测试状态**：`npm run test:fast` **84/84 PASS**（~20s）。全量 runner **161/161 PASS**（~5min）。当前 fast 层 84 个测试，slow 层 70 个，serial 层 7 个。

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
- 零公共 API 变更；`test:fast` 84/84 PASS；runner 已跑 124 测试，0 FAIL。

### 路线 A-2：dep-graph.js 协调职责上移 — **部分完成（~60%）**

> **诚实评估**：已提取的职责属实，但 facade 中仍有 ~175 行协调逻辑未动，orchestrator.js 成为新的"职责收容所"（330 行，混入工厂/持久化/状态机/编排）。

**已完成**：
- 新建 `src/services/orchestrator.js`，提取 `registerGraphBuiltHandler` / `savePrecomputed` / `restorePrecomputed` / `bootstrapFromSchema` / `initializeDepGraph` / `GraphStateMachine`。
- `container.js` `_initDepGraph` 从 ~65 行决策树压缩为 1 行。
- dep-graph.js 从 ~654 行 → ~502 行。

**仍残留**：
- `loadGraph()` ~99 行：混合 staleness guard、metadata 验证、graph 重建、orphan 处理、bus emit、状态机切换、预计算恢复。
- `isKnownEntryFile()` ~55 行 + `getFrameworkHint()` ~21 行：文件 I/O + 框架语义推断，且两者内容扫描逻辑完全重复。
- 构造函数 `graph:updated` 监听器 3 行：缓存失效协调未收拢。

**引入的新债务**：
- facade ↔ orchestrator 循环依赖（dep-graph.js 静态 require orchestrator.js，orchestrator.js 运行时 require dep-graph.js）。运行时 require 打破死锁，但双向耦合仍在。
- `savePrecomputed` 中存在 4 个几乎相同的重复 `if` 块。

- DG_STATES 生命周期 helper 暂留 facade 的预判部分失效：facade → orchestrator 的静态依赖已经存在，双向耦合不是"潜在风险"而是"既成事实"。
- `test:fast` 85/85 PASS。

### 下一步方向

- **路线 A-3（观察中）**：graph-db.js schema 演化 — `loadAll()` 手工拼接。SESSION.md 记录显示此债务可能已在之前的波次中部分解决（`CACHE_TABLE_SCHEMA` 注册表已引入），需验证 `loadAll()` 是否仍存手工拼接。
- **暂缓**：符号级 Call DAG、测试间隙穿透、Worker Pool 并行解析（ROI 不足）。

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

*Last updated: 2026-06-02（Wave 1-8 全部完成；37/37 Dogfood 已修复；代码审查 100% 修复完毕；路线 B CLI 可测试化 + 路线 A-1 container 管道拆分 + **路线 A-2 orchestrator 提取全部完成**（阶段 1 EntryDetector + 阶段 2 GraphLoader + 阶段 3 打破循环依赖）；活跃债务 3 项，0 个 P2 级活跃 Bug；86/86 fast PASS）*

> **本轮验证状态**：基线命令 `node cli.js audit-overview --cwd . --json --quiet` 100% 成功执行，无 unresolved import，自身库全量覆盖率 1.00。
> **本轮完成**：
> 1. 修复 `_aggregateCache` 封装泄漏（4处直读+8处`_aggregateVersion`改为getter）。
> 2. 统一 `affectedTests` `terminator` 字段语义。
> 3. 封装 `graph-db.js` `emitWarning` monkey-patch（引用计数）。
> 4. 统一 `repl.js` 退出码判断（`determineReplExitCode`）。
> 5. 限制 `debug.js` graph 分支计算量（上限+截断标记）。
> 6. 产出 `docs/code_review.md`。
> 7. 架构审查结论归档至 `TECH_DEBT.md`（新增 5 项架构债务）。
> 8. **新增 `affected-routes` 命令**：端到端请求路径追踪。给定文件反向追溯从入口到目标的完整调用链，排除 test-like 入口，支持 `--max-depth` 限制，上限 50 条自动去重。补测试 `test/affected-routes-test.js`。全量测试 84/84 PASS。
