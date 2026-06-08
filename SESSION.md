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
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 0 L3 + 1 架构债务 + 0 项 P2 Dogfood 活跃缺陷）

---

## 基线状态

- 测试：**受影响测试全部 PASS**；`npm run test:fast` **86/86 PASS**（~7.5s）。全量 runner **161/161 PASS**（~5min）。开发迭代首选 `npm run test:fast`（~7.5s）或 `npm run test:smoke`（~54s）。当前 fast 层 86 个测试，slow 层 70 个，serial 层 7 个。
- 版本：**v2.0.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~315 文件（entry=1, mainline=144, test=171）
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
> **本轮验证状态**：基线命令 `node cli.js audit-overview --cwd . --json --quiet` 100% 成功执行，无 unresolved import，自身库全量覆盖率 1.00。
> **本轮完成**：
> 11. **Stage 3.5 CLI query-* E2E/集成测试补全**：新增 `test/cli-integration-query-test.js`。通过注入 mock 数据与 `audit-summary` 进行 cache 预热，验证了 hotspots/knowledge-risk/stability 相应的命令行参数（`--risk`, `--level`, `--assessment`, `--limit`, `--cwd`）和 5 种输出格式格式化器。同时将该测试文件注册到 `runner.js` 中的 slow layer，确保测试运行的高内聚与进程级缓存隔离。
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
| 活跃债务           | 1           | 测试类型分布失衡 |
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

### 路线 A-2：dep-graph.js 协调职责上移 — **已完成（100%）**

- **已完成**：
  - 新建 `src/services/orchestrator.js`，提取 `registerGraphBuiltHandler` / `savePrecomputed` / `restorePrecomputed` / `bootstrapFromSchema` / `initializeDepGraph` / `GraphStateMachine`。
  - `container.js` `_initDepGraph` 从 ~65 行决策树压缩为 1 行。
  - **阶段 1：提取 EntryDetector**：`isKnownEntryFile()` + `getFrameworkHint()` + `_entryFileCache` + `graph:updated` 监听已提取到 `src/services/dep-graph/entry-detector.js`，消除了两者间的内容扫描重复代码。
  - **阶段 2：提取 GraphLoader**：`loadGraph()` ~99 行已提取到 `src/services/dep-graph/loader.js`，dep-graph.js 保留 thin wrapper。
  - **阶段 3：打破循环依赖**：`DG_STATES` + `GraphStateMachine` 下沉到 `src/services/dep-graph/state-machine.js`；`registerGraphBuiltHandler` + `savePrecomputed` + `restorePrecomputed` 收容到 `src/services/dep-graph/persistence.js`。dep-graph.js 不再静态依赖 orchestrator.js；`bootstrapFromSchema` 通过显式 `DependencyGraphClass` 参数消除反向运行时 require。
  - `dep-graph.js` 行数从 ~654 行降为 **323 行**。
  - `test:fast` **86/86 PASS**。

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

*Last updated: 2026-06-08（Wave 1-8 全部完成；37/37 Dogfood 已修复；代码审查 100% 修复完毕；路线 B CLI 可测试化 + 路线 A-1 container 管道拆分 + 路线 A-2 orchestrator 提取全部完成；**阶段 3.5 聚合结果持久化与细粒度查询 CLI 已交付**；活跃债务 1 项，0 个 P2 级活跃 Bug；87/87 fast/slow tests verified PASS）*


