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
> 开发迭代推荐 `npm run test:fast`（~20s，83 个 fast 层测试），比全量 runner（~5min）快 15×。

```bash
# 1. 快速自审（1 秒确认，不用等 runner，不读 CHANGELOG）
node cli.js audit-overview --cwd . --json --quiet
# 期望: summary.hotspots.length>0, summary.knowledgeRisk.high.length>=0, summary.orphans.length>=0, summary.deadExports.count=0, summary.unresolved.count=0, summary.cycles.count=0, summary.analysisCoverage.totalFiles≈290, summary.analysisCoverage.coverageRatio=1
```

**如果 audit-overview 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 历史变更见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `audit-overview` 输出正常（hotspots / knowledgeRisk / deadExports / unresolved / cycles）
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 5 活跃债务）

---

## 基线状态

- 测试：**受影响测试全部 PASS**；`npm run test:fast` **83/83 PASS**（~20s）。全量 runner **153/153 PASS**（~5min）。开发迭代首选 `npm run test:fast`（~20s）或 `npm run test:smoke`（~54s）。当前 fast 层 83 个测试，slow 层 65 个，serial 层 7 个。
- 版本：**v1.2.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~290 文件（entry=1, mainline=137, test=157），commands/ 去壳后减少 17 个透传文件
- 结构性指标：deadExports=0，cycles=0，unresolved=0；overview 维度：hotspots>0，knowledgeRisk 按实际分布
- 注意：`healthScore=7/8` 是文件存在性检查（README/LICENSE/.gitignore/Dockerfile），**不反映代码质量**，已废弃
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
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

## 本轮上下文：Dogfood 修复波次（当前主线）

> **背景**：产品定位已确定为 **"AI 代码脚手架"**（不是人类审计工具）。Dogfooding 报告（[docs/dogfood_curated.md](./docs/dogfood_curated.md)）在自身代码库上验证出 **37 个问题**（3 P0 + 19 P1 + 15 P2）。
>
> **根因判断**：37 个问题中 ~20 个是"接口契约混乱"（schema 不一致、formatter 行为分叉、参数验证不严格），不是引擎缺陷。核心引擎（dep-graph.js / cache.js / graph-db.js / builder.js）零问题，非常健康。
>
> **修复原则**：先统一接口契约（schema/参数/formatter），再逐个修功能缺陷。契约不统一，逐个修只会越修越裂。

### 本轮已交付

- **audit-summary → audit-overview 兼容层收敛**：`audit-summary` 直接复用 `COMMANDS['audit-overview']`，去掉独立的 `buildProjectOverview` + 窄版 `hasFindings`。保留 `health` 字段注入作为 deprecated 兼容层。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。
- **容器生命周期单状态源收敛**：`ServiceContainer` 删除三布尔标志，收敛为 `this.state` 枚举。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。
- **Java dead-exports 大图崩溃根治**：`spawn-ast.js` 改用临时文件中转。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。
- **Bus Factor / 知识分布（knowledgeRisk）**：`audit-overview` 新增逐文件 git blame。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 活跃问题与技术债务

### Dogfood 问题清单（37 项）

> 完整复现命令和修复目标见 [docs/dogfood_curated.md](./docs/dogfood_curated.md)。
>
> **AI 脚手架视角重新分级**：P0 = AI 工作流直接崩溃；P1 = AI 做出错误决策；P2 = 体验摩擦。

| 原分级 | AI 视角 | 数量 | 典型问题 |
|--------|---------|------|----------|
| P0 | **P0** | 3 | `--format json` 对 L1 核心命令无效（AI 的 JSON.parse 崩溃）；`.workspace-bridge.json` 语法错误静默忽略（AI 在错误范围分析）；`stats --markdown` 输出 `[object Object]` |
| P1 | **P0** | 5 | `--format ai` 丢失 `validationAdvice`/`impact[]`/`affectedTests[]`；`validationAdvice` schema 在 `audit-file` vs `audit-diff` 中不一致；无效参数静默忽略（`--format invalid` → exit 0） |
| P1 | **P1** | 10 | 空文件触发 `severity: high` + 34 mention tests；`--cwd` 自动逃逸到 git root；REPL `--json` 把对象包成字符串；`symbolImpact` 漏掉解构导入符号 |
| P1 | **P2** | 4 | Markdown 模板缺失；help 隐藏参数；等 |
| P2 | **P1** | 3 | `--token-budget` 降级静默发生；orphan count 波动；`--check-regression` 无明确结论 |
| P2 | **P2** | 12 | 体验摩擦 |

**重新分级后**：P0 = **8** 项，P1 = **13** 项，P2 = **16** 项。

### 传统技术债务

| 级别               | 数量        | 内容                                                                                                                                     |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| L1 Blocker         | 0           | —                                                                                                                                       |
| L2 债务            | 0           | —                                                                                                                                       |
| 活跃债务与品味     | 5           | 弱断言 / 测试类型失衡 / slow 层过重 / Builder 状态机 / `--json` 嵌套深 |
| **产品债务** | **0** | —                                                                                                                                       |

**测试状态**：`npm run test:fast` **83/83 PASS**（~20s）。全量 runner **153/153 PASS**（~5min）。

---

## 下一步方向：Dogfood 修复波次（波次化执行）

> **约束**：每波修完后必须 `npm run test:fast` 83/83 PASS + 全量 runner 153/153 PASS。禁止跨波次混修。
>
> **核心认知**：底层引擎已收敛，当前是 **"最后一公里接口契约统一"**。

### Wave 1：接口契约统一（P0 地基，3-4 天）

> **目标**：统一 schema + 严格参数验证 + `--format json` 对齐。契约不统一，后续修复全白搭。

| # | 问题 | 目标文件 | 修复要点 |
|---|------|---------|----------|
| W1-1 | `--format json` 对 L1 命令无效 | `cli.js` / `parse-args.js` | `--format json` 映射到 `--json` 全局标志；不能静默回退 Markdown |
| W1-2 | `.workspace-bridge.json` 语法错误静默忽略 | `src/services/file-index.js` | 解析失败时 throw 硬错误（exit 1），不能 fallback 到全量扫描 |
| W1-3 | 无效参数静默忽略 | `src/cli/parse-args.js` | `--format invalid` / `--direction invalid` 等 → `exit 2`，不能 exit 0 |
| W1-4 | `validationAdvice` schema 不一致 | `src/cli/formatters/validation-advice.js` | `audit-file` 和 `audit-diff` 输出统一 schema：`{changeType, commands{smoke,focused,full}, phases[], suggestedCommand, fileSpecificAdvice[]}` |
| W1-5 | `audit-security` ruleId vs rule 命名分叉 | `src/tools/security-tools.js` + formatters | JSON 和 Markdown 统一字段名：只保留 `ruleId`，删除歧义的 `rule` |
| W1-6 | `--format ai` 丢失关键决策字段 | `src/cli/formatters/human-formatters.js` `buildFormattedOutput` | `audit-file --format ai` 必须包含 `validationAdvice` + `impact.impact[]` + `affectedTests.affectedTests[]` |
| W1-7 | REPL `--json` 文本包装 | `src/cli/repl.js` | `--json` 时 `result` 字段必须是结构化对象，不能是字符串拼接 |

**验收标准**：
1. 跑 `node cli.js audit-file --file src/services/container.js --format json --quiet` → 输出 JSON（不是 Markdown）
2. 跑 `node cli.js audit-file --file src/services/container.js --format ai --json --quiet` → 包含 `validationAdvice.commands` 和 `impact.impact[]`
3. 跑 `node cli.js audit-summary --format invalid --quiet` → `exit 2`
4. 跑 `echo 'invalid' > .workspace-bridge.json && node cli.js audit-summary --json` → `exit 1` 且提示 config 错误
5. `npm run test:fast` 83/83 PASS

### Wave 2：参数与边界修复（P1 决策质量，2026-05-26）

> **状态**：✅ 已完成（test:fast 82/82 PASS；全量 runner 153/153 PASS）

| # | 问题 | 目标文件 | 修复要点 | 状态 |
|---|------|---------|----------|------|
| W2-1 | `--cwd` 自动逃逸到 git root | `cli.js` / `src/services/container.js` | 新增 `--strict-cwd` 标志，传入时锁定 `cwd` 为 workspaceRoot，不再向上遍历 | ✅ |
| W2-2 | `--exclude` glob 模式不工作 | `src/utils/exclude-patterns.js` | `shouldExcludeCli` 对含 `*`/`?` 的模式测试路径每一后缀片段，支持 `src/**` 等路径 glob | ✅ |
| W2-3 | `audit-file --file` 接受目录路径 | `src/cli/commands/index.js` + `audit-file.js` | `makeFileCommand` 与 `auditFileCmd` 均增加 `isDirectory()` 校验，目录 → `ok: false` | ✅ |
| W2-4 | 空文件 `severity: high` + 34 mention tests | `src/services/dep-graph/analyzer.js` | `_findAffectedTestsByMention` 遇到 0 字节文件直接跳过，避免 mention 雪崩 | ✅ |
| W2-5 | `--check-regression` 无明确结论 | `src/tools/regression-tools.js` | `checkRegression` 与 `checkRegressionAgainstCommit` 均计算并注入 `status: 'clean' \| 'degraded'` | ✅ |
| W2-6 | `--token-budget` 降级静默发生 | `src/cli/formatters/human-formatters.js` | `formatAi` 在 tokenBudget 触发降级时注入 `downgraded: true` | ✅ |
| W2-7 | `symbolImpact` 漏掉解构导入符号 | `src/services/resolvers.js` | 多符号解构导入时，每个符号都要进入 `symbolToDependents` | ✅（复现已正常，无需修复） |

### Wave 3：Formatter 与体验（P2 打磨，2026-05-26）

> **状态**：✅ 已完成（test:fast 83/83 PASS）

| # | 问题 | 目标文件 | 修复要点 | 状态 |
|---|------|---------|----------|------|
| W3-1 | `stats --markdown` 输出 `[object Object]` | `src/cli/formatters/human-formatters.js` | 提取 `formatStatsValue` 递归序列化嵌套对象 | ✅ |
| W3-2 | Markdown 缺少 `validationAdvice` | `src/cli/formatters/human-formatters.js` | `audit-file` + `audit-diff` markdown 补全 Validation Advice 渲染 | ✅ |
| W3-3 | orphan count 波动 | `src/utils/orphan-detector.js` | `entryFiles?.has?.(file)` 可选链修复，防止 `undefined` 时崩溃；清理 `empty_test_file.js` | ✅ |
| W3-4 | `--fail-on-findings` 隐藏在 help 中 | `cli.js` | 精简版 & 完整版 help 均暴露 `--fail-on-findings` | ✅ |
| W3-5 | REPL 缺少 `tree` 命令 / `exit` 报错 | `src/cli/repl.js` | 注册 `tree <file>`、`exit`、`quit`；help 同步追加 `tree` | ✅ |
| W3-6 | `--format ai` vs `--json` 优先级未文档化 | `cli.js` help 文本 | `--json` 标注 overridden by `--format`，`--format` 标注 precedence | ✅ |

### Wave 4：SKILL.md 重写（1 天）

> 基于 dogfood 结论重写 AI 工作流推荐。

| # | 变更 | 来源 |
|---|------|------|
| S1 | 默认推荐 `--json --quiet`，不再推荐 `--format markdown` | dogfood #2 |
| S2 | `audit-overview` 作为默认入口，移出"避免调用"列表 | dogfood 核心推荐 |
| S3 | `audit-file --json` 替代单独的 `impact` + `affected-tests` | dogfood 冗余消除 |
| S4 | 指导 AI 过滤 `source: "graph"`，对 `source: "mention"` 降低优先级 | dogfood #4 |
| S5 | 暴露 `coChanges[]` 的使用方法 | dogfood 遗漏高价值字段 |

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
- **每波收工前必须 `npm run test:fast` 83/83 PASS + 全量 runner 153/153 PASS**
- **每次修复后在 CHANGELOG.md [Unreleased] 追加条目**（单条不超过 3 行）

---

## 实战基地

> `C:\Users\sdses\Desktop\神思\code` 是 workspace-bridge 的实战基地，内含四个仓库，用于功能验证与实战演练。

---

*Last updated: 2026-05-26（性能攻坚三枪已交付；文档止血 + SKILL.md + 阶段3.5 已交付；fix/docs-sync-perf-lever 已合并 main；83/83 fast 测试全绿；活跃债务 5 项）*

> **本轮验证状态**：`npm run test:fast` **83/83 PASS**（~20s）；基线 `node cli.js audit-summary --cwd . --json --quiet` 通过（`healthScore=5/5`，`deadExports=0`，`unresolved=0`，`cycles=0`，`coverageRatio=0.99`，`totalFiles=295`）；CLI smoke 零 deprecation warning。
> **本轮完成**：
> - `fix/docs-sync-perf-lever` 4 commits 合并到 main（文档止血 → UV_THREADPOOL_SIZE=16 → SKILL.md 重写 → 阶段3.5 query-hotspots/query-knowledge-risk/query-stability）
> - `overview-tools.js` + `audit-assembler.js` W2-5 `regression.status` 嵌套结构修复
> - **性能攻坚三枪**：
>   1. `formatter-e2e-test.js` 单进程 runner（`cli.js` 提取 `runCliInProcess` + `test-helpers.js` 共享 `ServiceContainer`）
>   2. `file-index.js` `queue.shift()`→`pop()` + `processFile`→`indexFile` stat 去重
>   3. `analyzer.js` `precomputeImpact` 新增 `impactRadius` 结构化缓存 + `query.js` `getImpactRadius` 优先走缓存
> **实战基地量化**：3 个后端项目（Python 542 文件 / Java 395 文件 / Java 565 文件）`unresolved` 全部为 0 → SymbolRegistry 接入 resolver 的 immediate payoff 为 0，接入优先级降低，暂缓实施。
