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
> 收工时已跑 `node test/runner.js` 并确认 133/133 PASS，开工无需重跑。直接读取下方「基线状态」确认当前文档记录是否仍成立。
>
> 开发迭代推荐 `npm run test:fast`（~37s，96 个 fast 层测试），比全量 runner（~4min）快 6×。

```bash
# 1. 快速自审（1 秒确认，不用等 runner，不读 CHANGELOG）
node cli.js audit-summary --cwd . --json --quiet
# 期望: health.healthScore=7/8, summary.counts.deadExports=0, summary.counts.unresolved=0, summary.counts.cycles=0, summary.analysisCoverage.totalFiles≈261, summary.analysisCoverage.coverageRatio=1
```

**如果 audit-summary 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 历史变更见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `healthScore=7/8`
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)
3. **查看活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 6 L3）

---

## 基线状态

- 测试：**受影响测试全部 PASS**；全量 runner 133/133 PASS（~4min，分阶段：fast ~37s / slow ~100s / watch 串行）。开发迭代用 `npm run test:fast`（~37s）或 `npm run test:smoke`（~31s）
- 版本：**v1.2.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~247 文件（entry=1, mainline=123, test=138），commands/ 去壳后减少 17 个透传文件
- 健康度：7/8（缺 dockerConfig），deadExports=0，cycles=0，unresolved=0
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust Regular Expressions、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验）
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**历史交付**：路线 A–J 全部完成；阶段 1/2/3 全部完成；L2 债务清零；产品债务清零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

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
| `engines: >=16.0.0` 与实际依赖冲突                   | `package.json`                                       | `better-sqlite3@12` 需要 Node 18+；`structuredClone` 需 Node 17+。声称支持 16 但实际装不上。已标记需修，见下方待挖掘 #13                              |

---

## 本轮上下文

> 活跃问题与技术债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。历史已修复条目不重复记录。

### 本轮做了什么

**前轮（上一轮）**：

- **Bug 与架构修复**：完成了 L1 Blocker 异步/shutdown 竞态修复、幽灵更新内存校验消除、SQLite 写入元数据丢失和测试分类警告等。详见 CHANGELOG.md [Unreleased]。
- **L2 性能债（增量写入）**：重构了 `src/services/graph-db.js` 与 `src/services/cache.js`，实现 `saveIncremental(dirtyData)` 增量存表逻辑。
- **L4 Facade 编排层提取**：新建并抽取 Curation 与过滤核心中转层 `src/tools/audit-assembler.js`。
- **P1 AI 预消化输出机制**：开发了 `--format ai`、`--token-budget <n>` 和 `--depth` 特性。
- **P0 低垂果实 5/5 完成**：SQLite pragma 调优、PhaseTimer 多阶段计时、CLI 错误分类 + 可操作建议、安全白名单分派表 + Assert Defense、测试间隙穿透。
- **Dogfood 驱动新增（2 项）**：`audit-diff --commits <range>` + Dead export `duplicateOf` hint。
- **REFACTOR Wave 1 低垂果实全部完成**：D4/O5/U4/U5/U6。
- **U2（ExitCode 契约）核心目标已达成**。
- **D5（按需 post-process）**。
- **O1-O3（EventBus + 修复 watch/diagnostics 覆盖冲突）**。
- **D1-D3（Wave 2 架构核心：edges 表 + loadGraph 快速恢复）**。
- **D7-D8（预计算表持久化）**：冷启动 2.7s → 温启动 1.45s。
- **Wave 1（SymbolRegistry 全局符号表）** + Resolver 接入。
- **U1（Formatter 注册表）**：989 → 775 行（-22%）。
- **O7（Resolver 缓存）**。
- **U9（constants.js 拆分）**。

**本轮**：

- **U8（commands/ 去壳）**：17 个纯透传命令从独立文件内联到 `commands/index.js` 注册表，新增 `makeFileCommand` 工厂统一封装 `requireFile` + `resolveWorkspaceFilePath` + `hasFindings` boilerplate；删除 17 个壳文件（-312 行）。保留 repl/watch/init/debug/audit-file 为独立模块。`cli.js` 从注册表动态读取 `SELF_MANAGED_COMMANDS`，消除硬编码 Set。
- **路径参数安全清洗**：`cli.js` 新增 `sanitizeCliPaths(parsed)`，在 `main()` 中对 `--file` / `--files` 统一调用 `resolveWorkspaceFilePath()` 校验，拒绝 `../` 逃逸和绝对路径注入（exit code 1）。修复 `resolveWorkspaceFilePath()` 在 Windows 上对 POSIX 绝对路径的误判。
- **安全白名单分派表 + Assert Defense 扩展**：`security-tools.js` 将内联 `isMatchAllowlisted()` 提取为模块顶层 `ALLOWLIST_DISPATCH` 配置表（`assert-defense`、`test-placeholder-secrets` 两条独立策略）；扩展 Assert Defense 正则覆盖 Chai `to.throw` / Node.js `assert.rejects` / Jest async `rejects.toThrow` / Rust `.unwrap_err()` 等变体。
- **Prompt 注入防御**：`sanitize.js` 新增 `sanitizeForAiOutput(text, maxLength = 256)`（截断 + 清洗控制字符）；`security-tools.js` 的 `matchedText` 和 `human-formatters.js` 中所有 `exports` 展示前统一清洗。修复 `Array.prototype.map` 传参经典陷阱（`.map(sanitizeForAiOutput)` → `.map((e) => sanitizeForAiOutput(e))`）。

---

## 活跃问题与技术债务

| 级别               | 数量        | 内容                                                                                                                                     |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| L1 Blocker         | 0           | —                                                                                                                                       |
| L2 债务            | 0           | —                                                                                                                                       |
| L3 债务与品味      | 6           | js.js visitor超长 / cli.js JSON嵌套深 / ProjectContext规则盲区 / shouldExclude过度正则 / fallback正则缺陷 / resolvers.js缓存淘汰与高频GC |
| **产品债务** | **0** | —                                                                                                                                       |

**测试覆盖缺口**

> **133/133 PASS**（fast 93 + slow 36 + watch 4）。测试基础设施已收敛。

> **剩余测试债务（已量化）**：
>
> - **弱断言 ~35 处**：仅余 `typeof` 型 schema 契约检查（带消息参数，风险低）。占总断言数 ~2.3%
> - **console.log 噪音 7 处**：代码字符串内嵌、平台跳过诊断、runner.js 骨架输出
> - **`audit-map-test.js` graph 数据字面量** 仍内联
> - **时序依赖**：mock 内部延迟保留、进程退出超时保护保留
> - `src/tools/overview-curator.js` 零专属测试（被 `overview-tools-test.js` 间接覆盖）
> - **CLI 集成测试补齐**：详见 CHANGELOG
>
> **测试类型分布失衡**：单元测试 ~76%（良好），集成测试 ~20%（已补充 `cli-integration-test.js`），端到端 ~2%（严重不足），混沌/模糊 0（暂缓）。

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

- 活跃债务：**0 个 L1** + **0 个 L2** + **6 个 L3** + **0 个产品 bug** + **0 个产品债务**
- 版本：v1.2.0，schemaVersion 冻结
- 测试：**133/133 PASS**；全量 runner ~4min。开发迭代首选 `npm run test:fast`（~37s）
- **定位**：AI 的代码脚手架
- **核心认知**：底层引擎能力足够，CLI 出口质量（`--format ai`）已交付。P0–P4 / Wave 1 / Wave 2（D1-D3/D5/D7-D8）/ O1-O3 / U1 全部完成，历史见 CHANGELOG。下一阶段主线是**解析精度结构性升级**（Wave 2/3）与**输出层/编排层剩余债务**，必须波次化执行。

### P0 低垂果实（现在做，零风险高 ROI）

> 当前无待执行的 P0 低垂果实。

### P1 解析精度升级

> **约束**：波次化执行，每波之间保持 133/133 PASS。禁止一次性做多层心脏移植。
> Wave 1（SymbolRegistry）已完成，历史见 CHANGELOG。

| 波次     | 范围                                         | 侵入性 | 验证标准                                       | 状态   |
| -------- | -------------------------------------------- | ------ | ---------------------------------------------- | ------ |
| **Wave 2** | Resolver 策略链物理拆分（LanguageProvider）    | 中     | 所有语言解析测试全绿，benchmark 无回归         | ⏳ 待实施 |
| **Wave 3** | Builder/Analyzer 解耦 + 后处理 Affected-only | 高     | 增量更新 benchmark 证明 O(k)，watch 模式无泄漏 | ⏳ 待实施 |

### 数据层剩余项

> **来源**：[REFACTOR：数据层、编排层、输出层三层齐改](./docs/architecture/REFACTOR-2026-05-data-orchestration-output.md)
> D1-D3 / D5 / D7-D8 已完成，历史见 CHANGELOG。

| #  | 行动                         | 文件                      | 状态    | 说明                             |
| -- | ---------------------------- | ------------------------- | ------- | -------------------------------- |
| D6 | 消除 parseResults/graph 冗余 | `cache.js` `dep-graph.js` | ⏳ 长期 | `nodes` + `edges` 成为唯一事实源 |

### P2 高 ROI 用户可见功能（评估中）

| # | 目标                            | 状态      | 说明                                                                       |
| - | ------------------------------- | --------- | -------------------------------------------------------------------------- |
| 1 | **Bus Factor / 知识分布** | ⏳ 待评估 | `audit-overview` 新增 `knowledgeRisk`：逐文件 git blame + mailmap 去重 |
| 2 | **回归测试档案**          | ⏳ 待评估 | `fp_regression_*.js` 归档已知误报场景，防止修复后复发                    |
| 3 | **路径参数安全清洗**      | ⏳ 待评估 | `--file`/`--cwd` 统一清洗，拒绝 `../` 逃逸                           |

### P3 输出层渐进改善（Dogfood 后续，按节奏推进）

> 来源：本轮 dogfood 实际痛点，ROI 已排序。前三项为"建议做但按节奏来"的渐进改善；第四项已评估为越界，仅作记录。

| # | 目标 | 状态 | 说明 |
|---|------|------|------|
| 1 | **`audit-map` 目录级聚合 compact** | ⏳ 待评估 | edges 按目录聚合（如 `src/services/ → src/tools/ (15 edges)`），或异常-only 模式（只输出 fan-out > N、跨层依赖、孤立子图）。现有 `--compact` 仅压缩 tree 展示，未对 edges 做目录级聚合。 |
| 2 | **Fan-out / Fan-in 指标进 `audit-overview`** | ⏳ 待评估 | hotspot `reason` 只输出"耦合 N 个模块"总数，不区分 fan-in（被多少模块 import）vs fan-out（import 多少模块）。风险性质完全不同：高 fan-out = "这个文件知道太多"，高 fan-in = "改这个文件影响太大"。数据已有（`imports.length` / `reverseGraph`），只需拆分展示。 |
| 3 | **`--format ai` 风险分层输出** | ⏳ 待评估 | 当前 `--json` 太详细（几百行），`--format ai` 太压缩（丢了 `confidenceReason`）。按风险分层：高风险展开详情（file / reason / confidence / `duplicateOf`），低风险一行带过。与 `audit-diff` auto-compact 逻辑同思路。 |
| 4 | **Duplication detection 通用化** | ❌ 暂缓 | 已评估为超出结构分析边界。`severityMeetsFilter` 案例能被抓到是巧合（同时满足"死导出"+"SymbolRegistry 同名"两个独立条件）。专门做 AST 级代码重复检测会变成 SonarQube，违反"结构分析 ≠ 语义分析"原则。 |

### 待挖掘/待验证问题（本轮新增）

| # | 问题                               | 深挖价值 | 验证方案                                                                                                                                                                              |
| - | ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6 | **CLI 命令分层认知负担**     | 高       | 虽然 L4 已标记为 debug，但 `--help` 仍展示 20+ 命令，AI 消费者仍需在 20 个命令中做选择。验证：统计 SKILL.md 中 "WHEN TO USE" 的篇幅占比，若 >50% 花在命令选择上，说明分层暴露仍不足 |
| 7 | **Windows 兼容性补丁式累积** | 中       | 路径兼容不是通过统一抽象解决的，而是通过散落在 parser/resolver/git-tools/cli 各处的 `toPosixPath` 调用。验证：搜索 `toPosixPath` 调用点数量，若 >10 处，说明需要统一路径适配层    |
| 8 | **`isKnownEntryFile` 同步磁盘 I/O** | 中       | `dep-graph.js` 中 `isKnownEntryFile()` 做 `fs.statSync` + `fs.openSync` + `fs.readSync`。findDeadExports 遍历每个文件都调，1329 文件项目会有几百次同步磁盘读。应从 D6 下独立为单独性能项          |
| 9 | **`this.dg.graph` 穿透（38 处）** | 高       | L4 工具层直接操作 L2 `DependencyGraph.graph` 内部 Map，绕过 facade API。导致数据层与编排层边界模糊，任何 graph 结构变更都会波及大量调用点。应收敛为 facade 方法或 snapshot 消费      |
| 10 | **预计算失效粒度太粗** | 中       | `graph:updated` 触发时清空整个 `_cachedCycles`。只改了一个文件不一定影响 cycles。当前"任何变更清全部缓存"对 watch 模式增量性能不友好。需验证：局部文件变更时，cycles 是否真的需要全量重算 |
| 11 | **SESSION.md 与 TECH_DEBT.md 信息重复且不一致** | 低       | TECH_DEBT.md 第 88 行起有一整段"重构方向"与 SESSION.md Wave 2/3 计划大量重叠但粒度不同。两份文档事实源不统一，违反 AGENTS.md "活跃状态只在当前文档"原则。应收敛：技术债进 TECH_DEBT，路线图进 SESSION |
| 12 | **TECH_DEBT.md 存已完成项** | 低       | 第 21-35 行"SymbolRegistry fallback 已上线"标了 ✅ 但没删。按清理铁律"修复即删，历史只进 CHANGELOG"，应移走                                            |
| 13 | **`package.json engines` 偏低** | 低       | `engines.node: ">=16.0.0"` 但实际 `better-sqlite3@12` 需 Node 18+，`structuredClone` 需 Node 17+。应升至 `>=18.0.0`                                 |

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

*Last updated: 2026-05-21（U8 commands/ 去壳已完成；路径参数安全清洗已完成；安全白名单分派表 + Assert Defense 扩展已完成；Prompt 注入防御已完成；96/96 fast 测试全绿）*

> **本轮验证状态**：`npm run test:fast` **96/96 PASS**；基线 `node cli.js audit-summary --cwd . --json --quiet` 通过（`healthScore=7/8`，`deadExports=0`，`unresolved=0`，`cycles=0`，`coverageRatio=1.00`，`totalFiles=261`）。
> **实战基地量化**：3 个后端项目（Python 542 文件 / Java 395 文件 / Java 565 文件）`unresolved` 全部为 0 → SymbolRegistry 接入 resolver 的 immediate payoff 为 0，接入优先级降低，暂缓实施。
