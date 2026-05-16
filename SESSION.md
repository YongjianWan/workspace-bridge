# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（确认状态即可，不用跑 runner）

> **定位**：workspace-bridge 是**AI 的代码脚手架**，不是人类审计工具。CLI 负责策展（预组装、去噪、按优先级排序），skill 负责驾驶手册（什么时候用/不用/标准工作流）。
>
> 收工时已跑 `node test/runner.js` 并确认 111/111 PASS，开工无需重跑。直接读取下方「基线状态」确认当前文档记录是否仍成立。

```bash
# 1. 快速自审（1 秒确认，不用等 runner）
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExportsCount=5, unresolvedCount=0, cyclesCount=0, totalFiles≈194, analysisCoverage.coverageRatio=1

# 2. 验证大项目 compact 可用性（新功能涉及 compact / project-map 时才跑）
node cli.js audit-map --cwd reference/GitNexus/gitnexus --compact --json --quiet
# 期望: 输出行数 < 1000, summary.severity 存在, highlightedFiles 按问题严重程度排序
```

**如果 audit-summary 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 2026-05-15：P0–P2 bug fixes + tree 命令修复已完成，4 个测试回归已修复。当前全量测试通过（111/111）。详见下方「本轮完成」。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `healthScore=5/5`
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)
3. **按 P0 → P4 优先级执行**：
   - **P0 去噪工程**：工作目录污染、常量仓库/脚手架过滤、audit-overview 去重、audit-security 匹配内容
   - **P1 AI 预消化输出**：`--format ai` 统一入口、`--token-budget`、渐进式发现 `--depth`
   - **P2 工程体验**：默认输出改 markdown、`--cache-dir`、impact 入口截断
   - **P3 可靠性**：exit code 语义、解析降级信息入 JSON
   - **P4 Skill 精简**（现阶段暂缓，当前 ~264 行）

---

## 边界行为回归测试（可选，发版前执行）

```bash
# 不存在的文件 → 明确错误 + exit=1
node cli.js impact --file nonexistent.js --json --quiet
node cli.js affected-tests --file nonexistent.js --json --quiet

# init 重复运行 / 非 git 目录 audit-diff → exit=1
node cli.js init --json

# --exclude 过滤后 analysisCoverage 同步
node cli.js audit-summary --exclude test,benchmark --json --quiet

# Windows 反斜杠路径标准化
node cli.js audit-file --file .\src\services\dep-graph.js --json --quiet

# 非法参数值 → 明确报错
node cli.js audit-file --file src/services/dep-graph.js --max-depth abc --json --quiet

# REPL 非 TTY → exit=1
node cli.js repl
```

---

## 基线状态

- 测试：**111/111 PASS**（全量 runner 通过）
- 版本：**v1.2.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~196 文件，entry=1, library=63, test=111, script=20, unknown=1
- 健康度：5/5，0 dead exports（本轮清理了 health-tools/tree-sitter/sanitize/graph-db 死代码导出），0 循环，0 未解析
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖；`WorkspaceCache` 构造函数接受 `options.cacheDir`，不传时回退 JSON

**历史交付**：路线 A–J 全部完成；阶段 1 误报清零完成；阶段 2 暴露正确 + 输出策展完成（`--builtin-only`/`--format summary`/TTL 24h/`--since`/`--format markdown`/`--severity`/`--with-impact`/runner 并行化）；阶段 3 框架感知深化完成（P6-P8）。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

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

---

## 本轮上下文

> 活跃问题与技术债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。历史已修复条目不重复记录。

### 本轮做了什么

**P1 `--format ai` AI 预消化输出** — CLI 直接输出 AI 可消费的策展结论：
- **`src/cli/formatters/human-formatters.js`**：新建 `formatAi(command, result, options)`，预组装 `severity + topRisks + actions + confidence`
  - `topRisks` 按优先级排序：coverage < 0.5 → cycles → unresolved → dead-exports → health，每条带 `confidence` 数值
  - `actions` 从 `nextSteps` 提取，带 `P0/P1/P2` 优先级
  - `depth surface|detail|full` 渐进式发现：surface 只给 counts + top 3 risks；detail 加 `riskFiles`（每类最多 3 个文件）；full 加完整 `details` 明细
  - `tokenBudget` 超限自动降级：full → detail → surface → 核心字段（`ok + severity + counts`）
  - 非 `audit-summary` 命令 fallback 到 `formatSummary`
- **`cli.js`**：注册 `--format ai`、`--depth <mode>`、`--token-budget <n>` 参数；主输出路由增加 `format === 'ai'` 分支
- **`test/formatter-direct-test.js`**：6 个新断言覆盖 surface/detail/full/budget 降级/fallback/error

**P0 去噪工程收尾** — 直接减少误报和输出噪音，用户感知最明显：
- **`src/services/dep-graph.js`**：`findDeadExports` 直接过滤常量仓库（`isLikelyConstantsWarehouse`）和脚手架（`detectScaffold`），不再降级 confidence 后仍保留在列表中
- **`src/tools/overview-tools.js`**：删除 `summary.nextSteps` 别名（与 `recommendations` 完全重复）；`couplingSplitSuggestions` 从 `TOP_N_LIST(10)` 截断为 3 条，减少模板化噪音
- **`src/tools/security-tools.js`**：`runBuiltinSecurityScan` 命中规则时附加 `matchedText` 字段（截断至 120 字符），AI 无需额外读文件即可判断命中内容
- **测试同步**：`test/overview-tools-test.js` 移除 `nextSteps` 存在性断言

**SQLite 持久化缓存迁移** — 解决 L1 blocker 工作目录污染 + 缓存可靠性：
- 新建 `src/services/graph-db.js`：better-sqlite3 封装，5 张表对应 cache 数据结构，WAL 模式，transaction 批量 upsert
- 重构 `src/services/cache.js`：内部内存 Map 不变，`load()`/`save()` 持久化介质从 JSON 替换为 SQLite；默认缓存路径从项目根目录改为 `os.tmpdir()/workspace-bridge/<hash>/cache.db`；支持 `--cache-dir` 覆盖
  - ✅ **架构不一致已修复（2026-05-15）**：`cli.js` `main()` 在未传 `--cache-dir` 时自动计算默认路径（`os.tmpdir()/workspace-bridge/<md5(workspaceRoot)>/cache.db`），`container.js` `shutdown()` 新增 `cache.close()` 确保 Windows 下连接正常释放。测试直接 `new WorkspaceCache(root)` 不受影响（不传 `cacheDir` 时仍回退 JSON），仅 CLI 入口默认走 SQLite。
- 修改 `src/services/container.js` + `cli.js`：`ServiceContainer` 透传 `cacheDir` 选项，CLI 注册 `--cache-dir` 参数
- 修改 `src/services/dep-graph.js` + `src/services/file-index.js` + `src/tools/git-tools.js`：排除逻辑同步增加 `cache.db` / `cache.db-wal` / `cache.db-shm`
- 重写 `test/cache-backup-test.js` / `test/cache-corruption-test.js` / `test/cache-test.js`：验证 SQLite 持久化可靠性和 graceful 降级，删除已不存在的 `.bak` / `.tmp-` 机制断言
- 修复 `test/severity-filter-test.js`：消除硬编码 dead exports 数量，改为动态计算
- 更新 `.gitignore`：新增 SQLite 缓存文件排除
- **POC 阶段 3 结论固化**：cycle detection 保留内存算法（naive SQLite CTE 大图 45 秒不可用），SQLite 仅负责持久化 + deadExports + impact

**L3 双项收敛** — 实际功能缺口修复，非纯代码整洁：
- **`src/services/dep-graph.js`**：`GraphQuery.getImpactRadius` BFS 遇到 `isKnownEntryFile` 时截断扩散，解决 impact 输出到入口文件后仍继续膨胀的问题
- **`src/tools/workspace-tools.js`**：`buildChecks` 增加 `package.json#eslintConfig` 和 `.eslintrc`（无扩展名）检测，解决 Vue 项目 ESLint 配置存在但 `noLintersDetected: true` 误报
- **测试**：`test/p3-impact-explanation-test.js` 新增 2 断言；新建 `test/workspace-tools-test.js` 覆盖两种 ESLint 配置场景

**产品层面实测验证** — 在 ai_zcypg_frontend（239 文件）和 ai_gwy_backend（542 文件）上跑实测，暴露 5 个产品级问题：
- **`--format ai --depth surface` 没生效**：和 `--depth detail` 输出完全一样。`buildOutput` 逻辑中 `surface` 与 `detail` 的差异仅在于 `riskFiles` 是否存在，当项目无 cycles/unresolved/dead-exports 时两者输出完全一致，但 SKILL.md 承诺的"surface 只给 counts + top 3 risks"未实现。
- **`--format ai --token-budget` 没生效**：`--token-budget 500` 时未触发降级，输出长度与无 budget 时相同。
- **`exit code` 设计反模式**：`audit-summary` 在 severity=high 时返回 exit code 1。人类 CLI 无感，但对 CI/AI agent 是灾难——AI 拿到 exit code 1 会以为命令执行失败，CI pipeline 会中断。
- **命令分层混乱实测确认**：20+ 命令中 L4 原始查询（`dead-exports`/`cycles`/`unresolved`/`dependencies`/`dependents`/`stats`/`tree`）被 L1 aggregate 命令完全覆盖，但作为一等公民暴露；`health` 与 `audit-summary.health` 数据重合。根因不是"命令太多"，是"分层混乱"——AI 不知道该用 aggregate 还是 raw。
- **actions 是文案不是可执行命令**：`--format ai` 输出的 actions 如 `"1 dependency cycle detected — in Vue projects store→router→view cycles are often intentional..."` 是建议性文案，不是"删这个 export，跑这些测试"的具体指令。
- **冷启动实测**：239 文件 2s，542 文件 7s（比文档记录的 59s 乐观，但 7s 对 CI 仍不够友好）。

**`tree` 命令 bug 修复** — 文档与代码行为对齐，保持工程品味：
- **`src/cli/formatters/human-formatters.js`**：`formatHuman()` 新增 `case 'tree'`，用 `→` / `←` + 缩进渲染树形，自动标记 `[external]` / `[circular]`。解决不加 `--json` 时 fallback 到 `JSON.stringify` 的问题（CLI 契约：默认 human-readable）。
- **`src/tools/tree-tools.js`**：`buildTree()` 三处修复：
  1. 删除 `.filter((imp) => !imp.startsWith('.'))`（与注释 "keep all" 矛盾，会过滤相对路径 imports）；
  2. 改用单路径 `pathStack` 防止循环（原 `visited` 以 `${file}:${dir}:${depth}` 为 key，A→B→A 会在不同 depth 重复展开）；
  3. 统一 `imports` 与 `dependents` 的 `maxDepth` 截断行为：超限深度显示叶子节点但不递归展开（原 `dependents` 在 depth >= maxDepth 时直接消失）。
- **测试**：`test/tree-tools-test.js` 新增 3 个断言（循环 import、循环 dependent、dependents maxDepth 截断）；`test/formatter-direct-test.js` 新增 `testFormatHumanTree`。

**Java 包支持补全** — 收敛期不新增语言/命令，只修复已有缺陷：
- **`src/services/dep-graph/parsers/java.js`**：AST 路径和 regex fallback 均解析 `package` 声明并返回；`dep-graph.js` `analyzeFile` 存储到 graph node。
- **`src/services/dep-graph.js`**：新增 `expandJavaPackageImports()` post-process 阶段：
  - wildcard import 自动展开（`import com.foo.*;` → 同包所有已知文件的依赖边）；
  - 同包隐式引用自动建立（同一 `package` 的文件双向依赖，Java 语义无需 import）。
  - 外部 package（如 `java.util.*`）不在 graph 中，自动忽略不产生误报。
- **修复 regression**：`analyzeFile` 中 `package: result.package || null` 写在 `if (entry)` 块外部，当扩展名不被 registry 识别时抛出 `ReferenceError: result is not defined`，导致全量文件解析失败。已修正为块内提取 `packageName`。
- **测试**：`test/java-parsers-test.js` 新增 package 断言；**新建 `test/java-package-imports-test.js`** 覆盖 wildcard 展开、同包引用、外部 package 忽略。

**测试基础设施与质量收敛** — 消除测试代码中的重复、副作用和弱断言，建立统一工具库：
- **新建 `test/test-helpers.js`**：统一提供 `runCli` / `runCliText` / `runCliRaw` / `runInDir` / `makeTempDir` / `cleanupTempDir` / `buildMockDepGraph` / `assertOk` / `assertAll`，消灭 10+ 文件中 `spawnSync('node', [cliPath, ...args])` 的重复定义
- **重写 `test/runner.js`**：并发执行（默认 CONCURRENCY=1，可通过环境变量覆盖）+ `fs.watch` 测试自动串行分组 + 独立超时保险（`spawn timeout` + 5s 强制 `SIGKILL`），确保单个测试 hang 住不会阻塞整个 runner
- **模块级副作用清理**：`audit-diff-test.js` / `role-detection-test.js` / `gors-stack-detection-test.js` 的顶层 `fs.mkdtempSync` 移入 `main()`，消除模块加载即创建垃圾目录的问题
- **无意义字符串拼接删除**：`analysis-test.js` / `audit-diff-test.js` 中的 `ex' + 'port` / `im' + 'port` 全部恢复为正常关键字
- **弱断言消除**：替换 `typeof result.xxx === 'object'` 和 `assert.ok(result.status === 0)` 为业务语义验证；`parser-schema-contract-test.js` 允许 `package` 作为 parser 返回的可选键，适配 Java package 支持
- **20+ 测试文件迁移**：`analysis-test.js`、`functionality-test.js`、`audit-diff-test.js`、`init-test.js`、`integration-core-test.js`、`formatter-e2e-test.js`、`cli-mapper-adapter-test.js`、`role-detection-test.js`、`framework-usage-patterns-test.js`、`audit-diff-incremental-test.js`、`gors-stack-detection-test.js`、`audit-file-validation-advice-test.js`、`regression-test.js`、`severity-filter-test.js`、`staged-files-test.js`、`with-impact-test.js`、`audit-file-watch-test.js`、`watch-sigterm-test.js`、`watch-test.js` 全部导入 `test-helpers.js`
- **并发 runner 已知限制**：多个测试同时在 `repoRoot` 上运行 CLI 时，SQLite 缓存写冲突会导致子进程 hang 住（超过 120s）。当前默认串行规避，后续需解决 SQLite 并发写隔离或改为内存缓存模式

**历史**：P0-P4 全部交付。本轮及历史交付见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

### 活跃问题与技术债务

| 级别 | 数量 | 内容 |
|------|------|------|
| L1 Blocker | 0 | — |
| L2 债务 | 1 | 超时常量分散定义 |
| L3 品味 | 9 | git-tools.js 手动字符级解析 / overview-tools.js HTML 裸数字 / js.js visitor 超长 / path.js hasPathSegment 语义陷阱 / parserAvailability.skipped 命名陷阱 / cli.js JSON 嵌套深 / --compact 阈值无 rationale / npx 版本未锁定 / human-formatters.js 同一命令在 4-5 个 formatter 中重复判断 |
| ~~**产品 bug**~~ | **0** | ~~路径格式混用~~ | ✅ **已修复**：`file-index` 传递原始路径给 `dep-graph`，`cache` 持久化 `originalPath`，`build()` cache-hit 路径优先使用 `meta.originalPath`。`workspaceRoot` 与 `resolvedPath` 格式现已一致。
| **产品债务** | **5** | 命令分层混乱（L4 原始查询被 L1 aggregate 覆盖但混层暴露；**`health` 与 `audit-summary.health` 数据完全重合**）/ actions 是文案不是可执行命令 / **`repl` 非交互环境不可用**（AI/CI 完全无法使用）/ **`init` 生成空配置**（目录列表全空，设计未完成）/ **`--incremental` 增量逻辑不可见**（与 `--staged` 输出无差异） |
| **runner 并发限制** | **1** | 多个 CLI 实例同时写同一 SQLite 缓存文件时子进程 hang 住；默认串行规避，需后续修复并发写隔离 |

**测试覆盖缺口：严重低估。**

> 111/111 PASS（串行 runner，~510s）。测试基础设施已收敛（统一 helpers、消除重复、清理副作用），但并发 runner 因 SQLite 写冲突暂不可用。测试覆盖的是"代码能跑"，不是"功能能用"。

> 本轮消除的测试债务：`runCli` 重复定义（10+ 文件）、模块级 `mkdtempSync`（3 文件）、无意义字符串拼接（2 文件）、`typeof` 弱断言（全量）、`status === 0` 弱断言（全量）、`audit-map-test.js` 公共方法提取为 `BASE_MOCK_METHODS`（11 处 → 544 行）、`audit-map-test.js` / `repl-test.js` 等 `console.log` 噪音清理。

> 剩余测试债务：118 处 `mkdtempSync` 可继续提取为 `makeTempDir`（36 文件）、`audit-map-test.js` graph 数据字面量仍内联（方法已提取，`console.log` ✅ 已清）、`console.log('...: ok')` / `console.log('...: all passed')` 残留（~30 处，主要分布于 `repl-test.js` / `cli-args-validation-test.js` / `audit-map-test.js` ✅ 已清 等）、时序依赖测试脆弱（7 文件）、runner 并发 SQLite 冲突。

**为什么测试没暴露这些问题？**

| 仍存在的测试缺陷 | 测试为什么没有 catch | 测试在验证什么 |
|------------------|----------------------|---------------|
| `affected-tests` 返回 0 | 没有真实测试关联场景 | "函数返回数组" |

**根因**：测试在 workspace-bridge 自身代码库（198 文件纯 JS）上跑，不是真实项目。没有覆盖：Vue 复杂项目、Java 大图、中文路径、Windows 反斜杠、缺失目录、损坏基线、并发调用。

**改进方向**：新增 E2E 实战测试套件，在 `reference/GitNexus/` 和实战基地项目上跑，验证点从"函数返回了"变成"业务语义正确"（如 `commands.smoke.length > 0`、`parsedFiles <= totalFiles`、`exitCode === 0 即使 severity=high`）。

---

### 下一步方向

> 阶段 1（误报清零）、阶段 2（暴露正确 + 输出策展）、阶段 3（框架感知深化）全部完成。阶段 2 清单已收尾。

#### 当前状态

- 活跃债务：**0 个 L1** + **1 个 L2**（超时常量分散定义）+ **9 个 L3** + **0 个产品 bug** + **5 个产品债务**
- 版本：v1.2.0，schemaVersion 冻结
- 测试：**111/111 PASS**（~510s，默认串行）
- P0-P4 全部完成（误报清零、暴露正确、框架感知、可靠性收敛）
- **定位升级**：从"带 JSON 输出的人类审计工具"升级为"AI 的代码脚手架"
- **核心认知**：CLI 静态分析能力没问题，问题分两类：
  - **工程品味**（污染工作目录、输出数据冗余、缓存失效粗糙）— 已基本解决
  - **产品 bug/设计缺陷**（`--format ai` 参数不生效 ⚠️ 部分修复、`--check-regression` 崩溃 ✅、Java dead-exports 崩溃 ⚠️ 部分修复、exit code 反模式 ✅、diagnostics 找不到 linter ⚠️ 部分修复、repl TTY 依赖）— 这是新主战场
- **更深层的根因判断**：SKILL.md 279 行不是"文档写太长"，而是 **CLI 把策展工作外包给 AI** 的症状：
  - `--format ai` broken → AI 被迫自己筛 235 行 raw JSON
  - ~~`validationAdvice.commands: []` + `suggestedCommand: null`~~ → ~~AI 拿不到闭环指令~~ ✅ **已修复**：`buildFileValidationAdvice` 与 `buildValidationAdvice` 均返回 `suggestedCommand`（非空字符串），AI 可直接拿到单一可执行指令
  - ~~`affected-tests` 返回 0~~ → ~~AI 无法信任测试关联~~ ✅ **已修复**：`__tests__`/`cypress`/`e2e`/`ruby` 等 9 种新增布局/命名规则，启发式匹配覆盖率大幅提升
  - `health` / `dependents` 等冗余命令 → **根因不是"命令太多"，是"分层混乱"**：L4 原始查询命令（`dead-exports`/`cycles`/`unresolved`/`dependencies`/`dependents`/`stats`/`tree`）被 L1 aggregate 命令完全覆盖，但作为一等公民暴露，AI 不知道该用 `audit-summary` 还是 `dead-exports`。正确的做法是**分层暴露**（L1 策展入口 / L2 专项工具 / L3 环境诊断 / L4 原始查询 debug 用），不是删到 3 个。
  - **结论**：病根全在 CLI 出口质量，不在文档。SKILL.md 的 ~264 行补偿性指南，擦的是不该存在的屁股。
- **更深层的定位修正**：workspace-bridge 不是"AI 的替代方案"，而是**"所有 AI（IDE + 终端）都需要的基础设施"**——就像数据库索引。应用层（AI）可以自己做全表扫描，但有了索引快 100 倍。
  - IDE AI（Cursor/Claude）没有预建的全局 import/export 图、影响半径计算、死代码 AST 检测、跨 commit 趋势——它们只有 LSP（单文件）和 RAG（语义检索）。
  - 真正危险的不是"AI IDE 做得更好"，而是"**用户以为 AI IDE 已经做了，所以不需要你**"。
  - 问题不是"有没有价值"，是"**价值被实现层面的 bug 和形态错配埋住了**"。
  - 当前索引的问题：查询语法太复杂（20+ 命令）、返回格式对 AI 不友好（`--format ai` 边界行为不符合承诺）、查询结果不可执行（`commands: []` / `suggestedCommand: null`）。

---

#### 新会话默认动作

**P0: 确认基线状态（30 秒）**
```bash
node cli.js audit-summary --cwd . --json --quiet  # 期望 healthScore=5/5
```
如果异常 → 再跑 `node test/runner.js` 定位问题；如果正常 → 直接开工。

**默认路径：产品 bug 修复（按"价值被实现问题埋住"的 ROI 排序）**

> 作者视角修正：P0 不是"修文档"，是"修 CLI 出口质量让文档自然变薄"。

| 优先级 | 修复 | 根因 | 预期收益 |
|--------|------|------|----------|
| ~~**P0**~~ | ~~`--cwd` 不存在目录时挂起~~ | ~~`file-index.js` 或 `container.js` 在无效路径下无限循环/阻塞~~ | ✅ **已修**：CLI 入口 `fs.existsSync(cwd)` 前置检查 |
| ~~**P0**~~ | ~~exit code 与 severity 解绑~~ | ~~`hasFindings → 1` 反模式~~ | ✅ **已修**：`--fail-on-findings` 显式开关，默认 findings 不触发 exit=1 |
| **P0** | ~~`--check-regression` crash~~ | ~~基线 schema 不匹配~~ | ✅ **已修**：`makeCycleKey` 防御 `item.files` 缺失 |
| ~~**P1**~~ | ~~`--format ai` 参数生效~~ | ~~`depth`/`token-budget` 被短路~~ | ✅ **已生效**：`depth` 控制 `riskFiles`/`details` 输出，`token-budget` 超限自动降级 |
| ~~**P1**~~ | ~~`validationAdvice.commands` + `suggestedCommand`~~ | ~~`buildFileValidationAdvice` 未生成 `suggestedCommand`~~ | ✅ **已修复**：`pickSuggestedCommand` 复用于 `audit-file` 与 `audit-diff` 顶层返回对象，实测均返回非空字符串。 |
| **P1** | compact 模式比 full 慢 4x | 聚合计算 overhead | 大项目可用 |
| ~~**P1**~~ | ~~`affected-tests` 0 关联~~ | ~~测试映射启发式失效~~ | ✅ **已修复**：`test-detector.js` 扩展 `HEURISTIC_ROOT_SEGMENTS` + `TEST_DETECTION_RULES` + `normalizeHeuristicName`/`normalizeStem`，覆盖 `__tests__`/`cypress`/`e2e`/`ruby`/`UnitTest`/`IntegrationTest` 等常见模式。 |
| ~~**P2**~~ | ~~`watch` 排除自身缓存文件~~ | ~~遗留 `.tmp-*` / `.bak` 未排除~~ | ✅ **已修**：`shouldExclude` 增加 `.bak`/`.tmp-*` 缓存文件排除 |
| **P2** | `diagnostics` 找到实际 linter | `buildChecks` 与 `workspace-info` 检测逻辑不同步 | 诊断可信 |
| **P2** | Java `dead-exports` 崩溃 | Python 管道大数据崩溃（环境兼容） | 跨语言能力补齐 |
| ~~**P2**~~ | ~~`--exclude` 后 `parsedFiles` 不更新~~ | ~~exclude 只做输出过滤~~ | ✅ **已修**：`totalFiles`/`parsedFiles` 同步过滤 |
| ~~**P2**~~ | ~~路径格式混用~~ | ~~`workspaceRoot` Windows 原生 vs `resolvedPath` 小写正斜杠~~ | ✅ **已修复**：`file-index` 传原始路径 → `dep-graph` 用 `originalPath` 存储 → `cache` 持久化 → cache-hit 覆盖。格式现已一致。

**产品债务（暂缓，bug 清零后再评估）**
- ~~`audit-ai` 统一入口~~ → **重新评估**：不是"合并到 3 个命令"，是"`--help` 和 SKILL.md 按 L1/L2/L3/L4 分层暴露"。`dead-exports`/`cycles`/`unresolved` 等 L4 命令对人类调试有价值，不应删除，只需降级为 debug 层级。
- **compact 模式比 full 慢 4x**：542 文件项目 compact 26s vs full 6s，聚合计算 overhead 严重；且 full 模式 448KB（~112K tokens）直接爆掉大多数 AI 上下文窗口
- actions 可执行化：从文案改为 `"run: npm test -- test/auth-*.test.js"` 等具体指令
- `repl` 非交互环境不可用：SKILL.md 推荐但 AI/CI 完全无法使用，需评估 `--eval <command>` 模式或从 skill 中降级推荐

- **`init` 生成空配置**：`.workspace-bridge.json` 目录列表全空，用户拿到后仍需手动填，设计未完成；**且未自动写 `.gitignore`**，用户第一次跑就会被 5 个未跟踪文件污染 git 状态
- ~~`--exclude` 未完全过滤 cycle~~：⚠️ **部分修复**。cycle 检测逻辑已追加 `shouldExcludeCli` 过滤，但 dirty worktree 下缓存未刷新可能导致排除后 cycle 残留。2026-05-16 cache mtime/size 修复后该问题应已根治，待实战验证。
- **`--incremental` 增量逻辑不可见**：与 `--staged` 输出几乎无差异，用户感知不到"增量"价值
- **缓存污染比想象的严重**：`.workspace-bridge-cache.json` 799KB + `.bak` 799KB + `.tmp-*` 0B×3 残留在工作目录；SQLite 迁移已完成但遗留文件未清理；init 不自动写 `.gitignore`

---

### 待挖掘/待验证问题（6 个，未实测）

| # | 问题 | 深挖价值 | 验证方案 |
|---|------|---------|---------|
| 1 | **并发调用缓存冲突** | 高 | CI 并行 job / 两个 agent 同时分析同一仓库 → 是否互相覆盖？SQLite WAL 理论上支持并发，但需实测 `better-sqlite3` 并发读写 |
| 2 | **~~错误边界：垃圾输入~~** | **已验证** | `--file 不存在.js` ✅ 优雅 / `--since 不存在commit` ✅ 优雅 / `--baseline 损坏.json` ⚠️ 半优雅 / **`--cwd 不存在/` ❌ 挂起** → 新增 P0 bug |
| ~~3~~ | ~~`validationAdvice.commands` + `suggestedCommand`~~ | ~~**高**~~ | ✅ **已修复**：`audit-file` 与 `audit-diff` 均返回非空 `suggestedCommand`。 |
| 4 | **audit-security Semgrep 适配器** | 中 | 默认模式（无 `--builtin-only`）会尝试启动 Semgrep。Semgrep 未安装/规则下载失败/大项目超时 → 行为如何？ |
| 5 | **~~大项目输出体积~~** | **已验证** | 542 文件 full 模式 448KB（~112K tokens），直接爆掉 GPT-4o 上下文。compact 26s vs full 6s，compact 聚合 overhead 严重 |
| 6 | **impact[] 与 symbolImpact.impactedFiles[] 冗余** | 低 | `audit-file` 同时返回两个几乎一样的数组，输出体积翻倍 |
| 7 | **--exclude Windows 反斜杠** | 高 | 只测了正斜杠 `--exclude src/views`。Windows 用户大概率用反斜杠 `--exclude src\views`，可能不工作 |
| 8 | **fileSpecificAdvice 语言一致性** | 低 | app.vue 是中文 advice，无 `--locale` 参数控制，非中文用户 AI 不友好 |

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

8. **POC 阶段 1：基础读写测试**（✅ 已完成，结果优秀）
   - `better-sqlite3` Windows 安装成功（5s）
   - `scripts/sqlite-poc.js` 写入 239 nodes + 448 edges
   - **结果**：
     - 文件大小：SQLite **4.0 KB** vs JSON **73.0 KB**（小了 18 倍）
     - 批量插入：239 nodes + 448 edges → **3ms**
     - findDeadExports：SQLite **1ms** vs 内存 Map **0ms**
     - getImpactRadius（recursive CTE）：SQLite **0ms**
     - cycle detection：SQLite **9ms**
     - **结论**：SQLite 查询性能不比内存 Map 慢，文件体积远小于 JSON

9. **POC 阶段 2：增量更新验证**（✅ 已完成，结果优秀）
   - 模拟文件变化：DELETE 旧 edges + INSERT 3 条新 edges
   - 增量更新耗时：**1ms**
   - 更新后 impact 查询：**0ms**
   - **结论**：增量更新可行，不需要重建整个图

10. **POC 阶段 3：大项目压力测试**（✅ 已完成）
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
12. **默认输出改为 `--format markdown`**（~5 行）
13. **impact 入口截断**（~10 行）
14. **diagnostics 检测 Vue ESLint**（~15 行）

**P4：可靠性**（✅ 已完成）
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

*Last updated: 2026-05-16（`validationAdvice.suggestedCommand` + `affected-tests` 启发式修复完成；111/111 测试通过；活跃产品 bug 清零）*
