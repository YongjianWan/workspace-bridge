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
> 收工时已跑 `node test/runner.js` 并确认 131/131 PASS，开工无需重跑。直接读取下方「基线状态」确认当前文档记录是否仍成立。
>
> 开发迭代推荐 `npm run test:fast`（~14s，101 个纯单元测试），比全量 runner（~4min）快 15×。

```bash
# 1. 快速自审（1 秒确认，不用等 runner，不读 CHANGELOG）
node cli.js audit-summary --cwd . --json --quiet
# 期望: health.healthScore=7/8, summary.counts.deadExports=1, summary.counts.unresolved=0, summary.counts.cycles=0, summary.analysisCoverage.totalFiles≈261, summary.analysisCoverage.coverageRatio=1
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

- 测试：**受影响测试全部 PASS**；全量 runner 131/131 PASS（~4min，分阶段：fast ~14s / slow ~100s / watch 串行）。开发迭代用 `npm run test:fast`（~14s）或 `npm run test:smoke`（~31s）
- 版本：**v1.2.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~261 文件，entry=1, mainline=127, test=134
- 健康度：7/8（缺 dockerConfig），deadExports=1（`severityMeetsFilter` 在 `src/cli/commands/_utils.js` 中零引用，待清理），cycles=0，unresolved=0
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust Regular Expressions、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验）
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**历史交付**：路线 A–J 全部完成；阶段 1/2/3 全部完成；L2 债务清零；产品债务清零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

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

**前轮**：
- **Bug 与架构修复**：完成了 L1 Blocker 异步/shutdown 竞态修复、幽灵更新内存校验消除、SQLite 写入元数据丢失和测试分类警告等。详见 CHANGELOG.md [Unreleased]。

**本轮**：
- **L2 性能债（增量写入）**：重构了 `src/services/graph-db.js` 与 `src/services/cache.js`，实现 `saveIncremental(dirtyData)` 增量存表逻辑，支持 `INSERT OR REPLACE` 和 `DELETE` 局部更新，冷启动/高速写入无需清表，消除了 Write Storm。
- **L4 Facade 编排层提取**：新建并抽取 Curation 与过滤核心中转层 `src/tools/audit-assembler.js`，将原本散落在 `audit-summary`, `audit-diff`, `audit-file`, `audit-security` 中的校验、筛选、格式化聚合逻辑彻底下沉，简化了 CLI 接口实现。
- **P1 AI 预消化输出机制**：开发了专属于 Agent 消费的 `--format ai`、`--token-budget <n>` 和 `--depth` 特性，对 `audit-file` 提供了精细支持与多级树/影响路径智能剪裁；重构退出码检测为基于 O(1) 契约的 `result.hasFindings` 计算。
- **端到端 Facade 测试与生命周期资源泄漏修复**：新增 `test/audit-assembler-test.js` 并显式标记 `// @slow` 以适配 Windows 测试 runner，在此期间修复了容器初始化未优雅 shutdown 导致的资源句柄遗留与进程挂起。
- **架构方向共识确认**：经宏观判断复盘，确定解析精度结构性升级（Pre-scan + Provider 注册表 + Resolver 策略链重构）为中长期主线，但必须以 Wave 1/2/3 波次化执行，禁止在 131/131 全绿地基上一次性做多层心脏移植。`affectedRoutes`（端到端路由提取）因越界语义分析风险降级为"暂缓/观察"。
- **P0 低垂果实 5/5 完成**：SQLite pragma 调优、PhaseTimer 多阶段计时、CLI 错误分类 + 可操作建议、安全白名单分派表 + Assert Defense、测试间隙穿透（Dispatcher Regex）已全部交付并通过测试。SKILL.md 经评估后决定保持现状（当前 269 行内容对 AI 消费者 ROI 足够，强行压缩会丢失 AI 读取优先级和安全审查清单等高价值信息）。

---

## 活跃问题与技术债务

| 级别 | 数量 | 内容 |
|------|------|------|
| L1 Blocker | 0 | — |
| L2 债务 | 0 | — |
| L3 债务与品味 | 6 | js.js visitor超长 / cli.js JSON嵌套深 / ProjectContext规则盲区 / shouldExclude过度正则 / fallback正则缺陷 / resolvers.js缓存淘汰与高频GC |
| **产品债务** | **0** | — |

**测试覆盖缺口**

> **131/131 PASS**（fast 100 + slow 27 + watch 4）。测试基础设施已收敛，零专属测试模块清零。

> **剩余测试债务（已量化）**：
> - **弱断言 ~35 处**：仅余 `typeof` 型 schema 契约检查（带消息参数，风险低）。占总断言数 ~2.3%
> - **console.log 噪音 7 处**：代码字符串内嵌、平台跳过诊断、runner.js 骨架输出
> - **`audit-map-test.js` graph 数据字面量** 仍内联
> - **时序依赖**：mock 内部延迟保留、进程退出超时保护保留
> - **零专属测试模块剩余 0 个**
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
> - [ADR：workspace-bridge 从分析工具到代码知识库](./docs/architecture/ADR-graph-knowledge-base.md) — SQLite 作为核心图存储的决策与四阶段实施路线
> - [REFACTOR：数据层、编排层、输出层三层齐改](./docs/architecture/REFACTOR-2026-05-data-orchestration-output.md) — 22 项代码审计问题的三层重构方案（D1-D8 / O1-O7 / U1-U9）

### 当前状态

- 活跃债务：**0 个 L1** + **0 个 L2** + **6 个 L3** + **0 个产品 bug** + **0 个产品债务**
- 版本：v1.2.0，schemaVersion 冻结
- 测试：**131/131 PASS**；全量 runner ~4min。开发迭代首选 `npm run test:fast`（~14s）
- P0–P4 全部完成
- **定位**：AI 的代码脚手架
- **核心认知**：底层引擎能力足够，CLI 出口质量（`--format ai`）已交付。下一阶段主线是**解析精度结构性升级**，但必须波次化执行。

### P0 低垂果实（现在做，零风险高 ROI）

| # | 目标 | 文件 | 工作量 | 预期收益 | 状态 |
|---|------|------|--------|----------|------|
| 1 | **SQLite pragma 调优** | `cache.js` / `graph-db.js` | ~5 行 | WAL + mmap + temp_store，提升写入和查询性能 | ✅ 已完成 |
| 2 | **PhaseTimer 多阶段计时** | `container.js` / `cli.js` | ~15 行 | 大仓库分析时知道卡在 parse / resolve / query 哪一阶段 | ✅ 已完成 |
| 3 | **CLI 错误分类 + 可操作建议** | `cli.js` catch 块 | ~20 行 | 错误不再是 raw stack，而是"错误类型 + 下一步命令" | ✅ 已完成 |
| 4 | **安全白名单分派表 + Assert Defense** | `security-tools.js` | ~30 行 | 每条规则独立 `is_match_allowlisted()`；防御性测试误报抑制 | ✅ 已完成 |
| 5 | **测试间隙穿透（Dispatcher Regex）** | `affected-tests` 逻辑 | ~40 行 | 无 import 边但测试 body 提及源文件 stem 时也纳入 affected-tests | ✅ 已完成 |
| 6 | **SKILL.md 精简** | `skills/workspace-audit/SKILL.md` | — | 经评估保持现状：当前 AI 读取优先级 + 安全审查清单 + 可忽略字段对 AI 消费者 ROI 足够，无需为行数目标自残 | ✅ 保持现状 |

### P1 解析精度升级 Wave 1（本轮）

> **约束**：波次化执行，每波之间保持 131/131 PASS。禁止一次性做多层心脏移植。

| 波次 | 范围 | 侵入性 | 验证标准 |
|------|------|--------|----------|
| **Wave 1** | Pre-scan 全局符号表（新增模块，不改现有解析链） | 低 | 新增测试全绿，现有测试不受影响，符号表数据可通过 debug 命令导出验证 |
| **Wave 2** | Resolver 策略链物理拆分（基于 Wave 1 数据结构） | 中 | 所有语言解析测试全绿，benchmark 无回归 |
| **Wave 3** | Builder/Analyzer 解耦 + 后处理 Affected-only | 高 | 增量更新 benchmark 证明 O(k)，watch 模式无泄漏 |

### P2 高 ROI 用户可见功能（评估中）

| # | 目标 | 状态 | 说明 |
|---|------|------|------|
| 1 | **Bus Factor / 知识分布** | ⏳ 待评估 | `audit-overview` 新增 `knowledgeRisk`：逐文件 git blame + mailmap 去重 |
| 2 | **回归测试档案** | ⏳ 待评估 | `fp_regression_*.js` 归档已知误报场景，防止修复后复发 |
| 3 | **路径参数安全清洗** | ⏳ 待评估 | `--file`/`--cwd` 统一清洗，拒绝 `../` 逃逸 |

### 待挖掘/待验证问题（本轮新增）

| # | 问题 | 深挖价值 | 验证方案 |
|---|------|---------|---------|
| 6 | **CLI 命令分层认知负担** | 高 | 虽然 L4 已标记为 debug，但 `--help` 仍展示 20+ 命令，AI 消费者仍需在 20 个命令中做选择。验证：统计 SKILL.md 中 "WHEN TO USE" 的篇幅占比，若 >50% 花在命令选择上，说明分层暴露仍不足 |
| 7 | **Windows 兼容性补丁式累积** | 中 | 路径兼容不是通过统一抽象解决的，而是通过散落在 parser/resolver/git-tools/cli 各处的 `toPosixPath` 调用。验证：搜索 `toPosixPath` 调用点数量，若 >10 处，说明需要统一路径适配层 |
| 8 | ~~framework-patterns 与 framework-usage-patterns 职责边界~~ | 低 | ✅ **已修复**。`detectFrameworkFromPath` + `ENTRY_WEIGHT` 提取至 `project-context.js`；`framework-usage-patterns.js` 重命名为 `implicit-imports.js`；`framework-patterns.js` 现仅保留 AST_PATTERNS + `detectFrameworkFromContent` |
| 9 | ~~CLI `--help` 认知负担~~ | 中 | ✅ **已修复**。默认 `--help` 只展示 L1 核心命令（5 个），`--help --all` 展示完整列表；AI 消费者从 20 选 1 → 5 选 1 |

### 当前不做

- daemon / 常驻索引进程：违反 CLI-only 原则
- `--suggest` 修复代码自动生成：违反"结构分析 ≠ 语义分析"
- `--cross-repo` 跨仓库依赖分析：成本过高
- 污点追踪 / 跨文件数据流：运行时绑定问题仍解不了
- **`affectedRoutes` 端到端路由提取**：越界语义分析。路由注册（`app.get('/users/:id', handler)`）是运行时语义，不是静态 import 边。若未来要做，只能做成可选适配器，不可成为默认依赖

---

*Last updated: 2026-05-20（架构方向共识确认：低垂果实优先 + Wave 1/2/3 波次化升级）*

> **本轮验证状态**：`npm run test:fast` 93/93 PASS；`node test/runner.js --layer slow` 35/35 PASS；基线 `node cli.js audit-summary --cwd . --json --quiet` 通过（`healthScore=7/8`，`deadExports=1`，`unresolved=0`，`cycles=0`，`coverageRatio=1.00`）。
