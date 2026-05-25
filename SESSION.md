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
> 开发迭代推荐 `npm run test:fast`（~5s，79 个 fast 层测试），比全量 runner（~4.5min）快 50×。

```bash
# 1. 快速自审（1 秒确认，不用等 runner，不读 CHANGELOG）
node cli.js audit-summary --cwd . --json --quiet
# 期望: health.healthScore=7/8, summary.counts.deadExports=0, summary.counts.unresolved=0, summary.counts.cycles=0, summary.analysisCoverage.totalFiles≈280, summary.analysisCoverage.coverageRatio=1
```

**如果 audit-summary 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 历史变更见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `healthScore=7/8`
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 5 活跃债务）

---

## 基线状态

- 测试：**受影响测试全部 PASS**；`npm run test:fast` **81/81 PASS**（~5s）。全量 runner **146/146 PASS**（~5min）。开发迭代首选 `npm run test:fast`（~5s）或 `npm run test:smoke`（~54s）。当前 fast 层 81 个测试，slow 层 58 个。
- 版本：**v1.2.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~280 文件（entry=1, mainline=133, test=147），commands/ 去壳后减少 17 个透传文件
- 健康度：7/8（缺 dockerConfig），deadExports=0，cycles=0，unresolved=0
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust Regular Expressions、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验）
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**历史交付**：路线 A–J 全部完成；阶段 1/2/3 全部完成；Wave 1/2/3/4/5 已完成；L2 债务清零；产品债务清零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

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
| `framework-patterns.js` 新增框架时                   | `src/services/dep-graph/framework-patterns.js`       | 路径检测逻辑按语言分块，新增语言需同时更新 `isEntry` 标记和测试                                                                   |
| `buildFileValidationAdvice` 导出链                   | `validation-advice.js` → `index.js` → `cli.js` | 新增 formatter 函数必须在 `src/cli/formatters/index.js` 中显式导出，否则 cli.js 解构为 `undefined`                              |
| `--quiet` 不再 monkey-patch `console.error`        | `cli.js` / `container.js`                          | `quiet` 通过 `ServiceContainer` → `FileIndex` / `DependencyGraph` 传递；信息性日志条件输出，错误日志仍用 `console.error` |
| `findDeadExports()` edges/files 降级                 | `src/services/dep-graph.js`                          | 单文件项目（files=1）不受降级影响；多文件项目 edges/files < 0.1 时 confidence 降为 low                                              |
| `.workspace-bridge-cache.json.bak` 泄漏到 git status | `src/tools/git-tools.js`                             | `getChangedFiles()` 已排除 `.bak` 备份文件，防止 audit-diff 误报                                                                |
| `resolvers.js` 策略链新增策略                        | `src/services/dep-graph/resolvers.js`                | 新增语言需在 `registerResolverConfig()` 中加一行，策略函数签名 `(importPath, fromFile, ctx) => string\|null`                     |
| `checkFileChanges()` 双路径                          | `src/services/cache.js`                              | fast path（mtime+size）+ slow path（SHA-256）。修改 staleness 逻辑时必须保持双路径行为                                              |

---

## 本轮上下文

> 活跃问题与技术债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。历史已修复条目不重复记录。

### 本轮做了什么

- **容器生命周期单状态源收敛**：`ServiceContainer` 删除 `initialized` / `initializing` / `_shuttingDown` 三布尔标志，收敛为 `this.state` 单一枚举（`IDLE/INITIALIZING/READY/SHUTTING_DOWN/ERROR`）。新增 `_transition(toState)` 统一守卫非法转换。`shutdown()` 末尾 `_transition(IDLE)` 移入 `finally` 块确保异常安全。`container.initialized` / `container.initializing` 保留 getter 桥接，外部零改动。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。
- **Java dead-exports 大图崩溃根治**：`spawn-ast.js` 改用临时文件中转替代 stdin 管道，Python 脚本（`java_ast_parser.py` / `python_ast_parser.py`）支持 `--file` 参数读取。彻底消除 542 文件 Java 项目 `dead-exports` exit code 49（Windows Store Python + Git Bash 管道大数据崩溃）。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。
- **Bus Factor / 知识分布（knowledgeRisk）**：`audit-overview` 新增逐文件 `git blame --porcelain` + `.mailmap` 去重，标识单作者文件（bus factor = 1）。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。


---

## 活跃问题与技术债务

| 级别               | 数量        | 内容                                                                                                                                     |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| L1 Blocker         | 0           | —                                                                                                                                       |
| L2 债务            | 0           | —                                                                                                                                       |
| 活跃债务与品味     | 5           | 弱断言 / 测试类型失衡 / slow 层过重 / Builder 状态机 / `--json` 嵌套深 |
| 状态机（Container）| ✅ 已收敛 | `initialized` / `initializing` / `_shuttingDown` 三标志已收敛为单一 `state` 枚举 + `_transition` 守卫 |
| **产品债务** | **0** | —                                                                                                                                       |

**测试覆盖缺口**

> **`npm run test:fast` 81/81 PASS**（~5s）。全量 runner **146/146 PASS**（~5min）。测试基础设施已收敛。

> **剩余测试债务（已量化）**：
>
> - **弱断言 ~10 处**：仅余 `typeof` 型 schema 契约检查（带消息参数，风险低）。占总断言数 ~2.3%
> - **console.log 噪音 7 处**：代码字符串内嵌、平台跳过诊断、runner.js 骨架输出
> - **`audit-map-test.js` graph 数据字面量** 仍内联
> - **时序依赖**：mock 内部延迟保留、进程退出超时保护保留
> - **CLI 集成测试补齐**：✅ 已完成物理 CLI 管道与 BOM 边界 E2E 覆盖。
>
> **测试类型分布失衡**：单元测试 ~74%（良好），集成与端到端测试 ~26%（已补充物理磁盘、进程 spawn 和 CLI 管道 E2E 覆盖，物理防线建立完毕），混沌/模糊 0（暂缓）。

---

## 下一步方向

> 阶段 1（误报清零）、阶段 2（暴露正确 + 输出策展）、阶段 3（框架感知深化）全部完成。
> 当前进入 **"低垂果实 + 波次化架构升级"** 双轨阶段。
>
> **根因判断**：resolvers.js 启发式字符串匹配 + 零全局符号表，是 import 解析脆弱、dead-exports 误报、增量性能击穿、Builder 越权操控 Analyzer 的共同根因。修复路线：Pre-scan 全局符号映射 → 语言 Provider 注册表统一契约 → Resolver 策略链物理拆分 → Builder/Analyzer 生命周期事件解耦 → 后处理 Affected-only 增量化。
>
> 相关架构背景参考（独立文档，与本节 Wave 定义非同一套）：
>
> - [REFACTOR：数据层、编排层、输出层三层齐改](./docs/architecture/REFACTOR-2026-05-data-orchestration-output.md) — 22 项代码审计问题的三层重构方案（D1-D8 / O1-O7 / U1-U9）

### 当前状态

- 活跃债务：**0 个 L1** + **0 个 L2** + **5 个活跃债务** + **0 个产品 bug** + **0 个产品债务**
- 版本：v1.2.0，schemaVersion 冻结
- 测试：**`npm run test:fast` 79/79 PASS**（~5s）。全量 runner **144/144 PASS**（~4.5min）。开发迭代首选 `npm run test:fast`（~5s）
- **定位**：AI 的代码脚手架
- **核心认知**：底层引擎能力足够，CLI 出口质量已交付。已完成工作见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。下一阶段主线是**解析精度结构性升级**与**输出层/编排层剩余债务**，必须波次化执行。

### P0 低垂果实（现在做，零风险高 ROI）

> 当前无待执行的 P0 低垂果实。

### P1 解析精度升级

> **约束**：波次化执行，每波之间保持 `npm run test:fast` 79/79 PASS，全量 runner 144/144 PASS。禁止一次性做多层心脏移植。
> Wave 1/2/3 已完成，历史见 CHANGELOG。

| 波次     | 范围                                         | 侵入性 | 验证标准                                       | 状态   |
| -------- | -------------------------------------------- | ------ | ---------------------------------------------- | ------ |


### 数据层剩余项

> **来源**：[REFACTOR：数据层、编排层、输出层三层齐改](./docs/architecture/REFACTOR-2026-05-data-orchestration-output.md)
> D1-D3 / D5 / D7-D8 已完成，历史见 CHANGELOG。

| #  | 行动                         | 文件                      | 状态    | 说明                             |
| -- | ---------------------------- | ------------------------- | ------- | -------------------------------- |
| D6 | 消除 parseResults/graph 冗余 | `cache.js` `dep-graph.js` | ⏳ 长期 | `nodes` + `edges` 成为唯一事实源 |

### P2 高 ROI 用户可见功能（评估中）

| # | 目标                            | 状态      | 说明                                                                       |
| 

### P3 输出层渐进改善（Dogfood 后续，按节奏推进）

> 来源：本轮 dogfood 实际痛点，ROI 已排序。前三项为"建议做但按节奏来"的渐进改善；第四项已评估为越界，仅作记录。

| # | 目标 | 状态 | 说明 |
|---|------|------|------|
| 4 | **Duplication detection 通用化** | ❌ 暂缓 | 已评估为超出结构分析边界。`severityMeetsFilter` 案例能被抓到是巧合（同时满足"死导出"+"SymbolRegistry 同名"两个独立条件）。专门做 AST 级代码重复检测会变成 SonarQube，违反"结构分析 ≠ 语义分析"原则。 |

### 待挖掘/待验证问题（本轮新增）


### 当前不做

- daemon / 常驻索引进程：违反 CLI-only 原则
- `--suggest` 修复代码自动生成：违反"结构分析 ≠ 语义分析"
- `--cross-repo` 跨仓库依赖分析：成本过高
- 污点追踪 / 跨文件数据流：运行时绑定问题仍解不了
- **`affectedRoutes` 端到端路由提取**：越界语义分析。路由注册（`app.get('/users/:id', handler)`）是运行时语义，不是静态 import 边。若未来要做，只能做成可选适配器，不可成为默认依赖

---

## 实战基地

> `C:\Users\sdses\Desktop\神思\code` 是 workspace-bridge 的实战基地，内含四个仓库，用于功能验证与实战演练。

---

*Last updated: 2026-05-25（exit code 49 已根治；knowledgeRisk 已交付；81/81 fast 测试全绿；146/146 全量 runner；活跃债务 5 项）*

> **本轮验证状态**：`npm run test:fast` **81/81 PASS**（~5s）；全量 runner **146/146 PASS**（~5min）；基线 `node cli.js audit-summary --cwd . --json --quiet` 通过（`healthScore=7/8`，`deadExports=0`，`unresolved=0`，`cycles=0`，`coverageRatio=1.00`，`totalFiles=280`）；CLI smoke（`impact` / `affected-tests` / `repl --eval` / `dead-exports`）零 deprecation warning；`dead-exports` CLI smoke 零 exit code 49。
> **实战基地量化**：3 个后端项目（Python 542 文件 / Java 395 文件 / Java 565 文件）`unresolved` 全部为 0 → SymbolRegistry 接入 resolver 的 immediate payoff 为 0，接入优先级降低，暂缓实施。
