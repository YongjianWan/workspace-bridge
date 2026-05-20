# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（确认状态即可，不用跑 runner）

> **定位**：workspace-bridge 是**AI 的代码脚手架**，不是人类审计工具。CLI 负责策展（预组装、去噪、按优先级排序），skill 负责驾驶手册（什么时候用/不用/标准工作流）。
>
> **🔴 开工前不读 CHANGELOG.md。** 确定现状只需读本文档 + AGENTS.md + TECH_DEBT.md + 下方 1 条基线命令。CHANGELOG 是历史存档，读它不能替代读活跃文档。
>
> 收工时已跑 `node test/runner.js` 并确认 131/131 PASS，开工无需重跑。直接读取下方「基线状态」确认当前文档记录是否仍成立。
>
> 开发迭代推荐 `npm run test:fast`（~14s，101 个纯单元测试），比全量 runner（~4min）快 15×。

```bash
# 1. 快速自审（1 秒确认，不用等 runner，不读 CHANGELOG）
node cli.js audit-summary --cwd . --json --quiet
# 期望: health.healthScore=7/8, summary.counts.deadExports=0, summary.counts.unresolved=0, summary.counts.cycles=0, summary.analysisCoverage.totalFiles≈253, summary.analysisCoverage.coverageRatio=1
```

**如果 audit-summary 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 历史变更见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `healthScore=7/8`
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)
3. **查看活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 3 L3）

---

## 基线状态

- 测试：**受影响测试全部 PASS**；全量 runner 131/131 PASS（~4min，分阶段：fast ~14s / slow ~100s / watch 串行）。开发迭代用 `npm run test:fast`（~14s）或 `npm run test:smoke`（~31s）
- 版本：**v1.2.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~253 文件，entry=1, mainline=120, test=133
- 健康度：7/8（缺 dockerConfig），deadExports=0，cycles=0，unresolved=0
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
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

**上一轮**：WorkspaceSnapshot + 自知机制、analysis-test.js 回归修复、runner 分类机制修复、dep-graph.js 物理拆分、TECH_DEBT.md 过时条目清理。详见 CHANGELOG.md [Unreleased] 2026-05-20 条目及之前。

**本轮**：

**CLI Fatal Handler + --help 核心命令折叠（阶段 2.5）** — `cli.js` `test/cli-args-validation-test.js`：
- `installFatalHandlers()`：全局 `unhandledRejection`/`uncaughtException` 兜底，输出 `Fatal:` 前缀 + 错误信息 + stack，exit code 2。`main().catch()` 双重保护。
- `printUsage(showAll = false)`：默认 `--help` 只展示 L1 策展入口（5 个核心命令）+ Options + `--help --all` 提示；`--help --all` 恢复完整 20+ 命令列表。
- 测试：`cli-args-validation-test.js` 新增 `testHelpFlag`/`testHelpAllFlag`，验证精简版不含 L4、完整版含 L4。
- 验证：fast 100/100 PASS；slow 27/27 PASS。

**WorkspaceSnapshot 数据一致性修复（L1 休眠 bug）** — `src/models/workspace-snapshot.js` `src/services/container.js`：
- 根因：`snapshot.files` 是初始化时静态数组拷贝，`snapshot.graph`（DependencyGraphView）是 depGraph 实时引用；REPL watch 模式下增量更新后两者不同步。
- 修复：`WorkspaceSnapshot.files` 改为惰性 getter，生产环境基于 `fileIndex` 引用实时构建；`container.js` 增量更新回调中重新组装 snapshot；异常安全（catch 保留已有 snapshot）。
- 向后兼容：测试中 `makeMockSnapshot` 的静态 `files` 数组继续工作，getter 自动回退。
- 验证：fast 100/100 PASS；slow 27/27 PASS；watch 4/4 PASS；基线通过。

**eslint 检测逻辑统一（架构债务）** — `src/utils/environment-probe.js` `src/tools/workspace-tools.js` `src/services/diagnostics-engine.js`：
- 根因：`workspace-tools.js#detectNodeLinters` 与 `diagnostics-engine.js#hasChecker` 各自独立实现同一套 eslint 配置文件扫描（`PROBE.ESLINT_CONFIG_FILES` + `package.json#eslintConfig`）。
- 修复：新建 `environment-probe.js`，导出 `detectEslintConfig`/`detectPrettierConfig`/`detectTscConfig` 纯函数；两消费者统一调用。
- 验证：`workspace-tools-test.js`/`diagnostics-engine-test.js` PASS；fast 100/100 PASS；slow 27/27 PASS。

**git-tools.js 字符级解析提取（L3 品味）** — `src/tools/git-tools.js` `test/git-tools-test.js`：
- 根因：`getChangedFiles()` 主循环直接索引 `line[0]`/`line[1]`/`line.slice(3)`，rename 处理与状态判断逻辑散落在循环体内。
- 修复：提取 `parsePorcelainV1Line(line)` 纯函数，返回结构化对象；主循环只消费结构化数据。
- 测试：`git-tools-test.js` 新增 10 个边界断言（修改/added/untracked/rename/空格文件名/malformed）。
- 验证：`git-tools-test.js` PASS；fast 100/100 PASS；slow 27/27 PASS。

**e2e-gitnexus 去重（测试债务）** — `test/e2e-gitnexus-test.js`：
- 根因：该文件含 3 个独立 CLI spawn（audit-summary/audit-file/dead-exports），在 1329 文件项目上各 ~14s，合计占 slow 层 ~55%。
- 修复：删除 `audit-file`/`dead-exports` 两个重复 spawn（`cli-integration-test.js` 已在小项目上覆盖形状验证），只保留 `audit-summary` 单一大项目验证。
- 结果：runner 中该测试从 ~65s 降至 ~34s；slow 层总时间从 ~165s 降至 ~129s（省 ~22%）。
- 验证：slow 27/27 PASS；fast 100/100 PASS。

**parserAvailability 统一归位（架构债务）** — `src/utils/environment-probe.js` `src/tools/health-tools.js` `src/tools/workspace-tools.js`：
- 根因：`health-tools.js` 同时承担"健康检查"和"环境探测"两个职责；`workspace-tools.js` 为获取 `parserAvailability` 直接依赖 `health-tools.js`，导致 L4 工具层间非预期耦合。
- 修复：`checkParserAvailability` 移入 `environment-probe.js`；`health-tools.js` 和 `workspace-tools.js` 统一从 `environment-probe.js` 引入。`health-tools.js` 保留重新导出以维持向后兼容。
- 结果：`environment-probe.js` 成为环境探测单一事实源。
- 验证：`health-tools-test.js`/`workspace-tools-test.js` PASS；fast 100/100 PASS；slow 27/27 PASS。

---

### 活跃问题与技术债务

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

### 下一步方向

> 阶段 1（误报清零）、阶段 2（暴露正确 + 输出策展）、阶段 3（框架感知深化）全部完成。

#### 当前状态

- 活跃债务：**0 个 L1** + **0 个 L2** + **6 个 L3** + **0 个产品 bug** + **0 个产品债务**
- 版本：v1.2.0，schemaVersion 冻结
- 测试：**131/131 PASS**；全量 runner ~4min。开发迭代首选 `npm run test:fast`（~14s）
- P0-P4 全部完成
- **定位**：AI 的代码脚手架
- **核心认知**：CLI 静态分析能力没问题，问题在 CLI 出口质量（`--format ai` 边界行为、token 预算感知、去噪输出）

#### P0 去噪工程（已完成）

| # | 项 | 状态 | 说明 |
|---|-----|------|------|
| 1 | 工作目录污染 | ✅ 已完成 | 缓存已在 `os.tmpdir()`，旧文件已清理 |
| 2 | 常量仓库/脚手架过滤 | ✅ 已完成 | `dep-graph.js` 已 `continue` 跳过，`honesty-engine.js` 已标记误报 |
| 3 | audit-overview 去重 | ✅ 已完成 | `nextSteps` 已移除，recommendations 已统一 |
| 4 | `architectureAdvice` 抑制 | ✅ 已完成 | `< 200 files` 时 `couplingSplitSuggestions` 为空 |
| 5 | `audit-security` matchedText | ✅ 已完成 | JSON 已包含，human formatter 已展示 |

#### 结构性地基（优先于 P1）

> 骨架评估结论（2026-05-20）：`dep-graph.js` 1685 行已到物理拆分临界点；L4 工具层缺少共享项目元数据抽象。这两个问题不解决，P1 AI 预消化输出的组装逻辑会建立在松散地基上。

| 优先级 | 修复 | 根因 | 预期收益 |
--------|------|------|----------|
| ~~**P0.5**~~ | ~~`dep-graph.js` 物理拆分~~ | ✅ **已完成**（详见 CHANGELOG.md [Unreleased] 2026-05-20 条目） | — |
| ~~**P0.5**~~ | ~~`WorkspaceSnapshot` 共享模型 + 自知机制~~ | ✅ **已完成**（详见 CHANGELOG.md [Unreleased] 2026-05-20 条目） | — |

#### 默认路径：P1 AI 预消化输出（核心升级）

| 优先级 | 修复 | 根因 | 预期收益 |
|--------|------|------|----------|
| **P1** | `--format ai` 统一入口 | 预组装 severity + top risks + actions + confidence | AI 不再被迫自己筛 235 行 raw JSON |
| **P1** | `--token-budget <n>` | AI 上下文感知，超限自动裁剪 | 上下文窗口友好 |
| **P1** | `--depth surface|detail|full` | 渐进式发现 | 大项目不爆 token |

#### 待挖掘/待验证问题（本轮新增）

| # | 问题 | 深挖价值 | 验证方案 |
|---|------|---------|---------|
| 6 | **CLI 命令分层认知负担** | 高 | 虽然 L4 已标记为 debug，但 `--help` 仍展示 20+ 命令，AI 消费者仍需在 20 个命令中做选择。验证：统计 SKILL.md 中 "WHEN TO USE" 的篇幅占比，若 >50% 花在命令选择上，说明分层暴露仍不足 |
| 7 | **Windows 兼容性补丁式累积** | 中 | 路径兼容不是通过统一抽象解决的，而是通过散落在 parser/resolver/git-tools/cli 各处的 `toPosixPath` 调用。验证：搜索 `toPosixPath` 调用点数量，若 >10 处，说明需要统一路径适配层 |
| 8 | ~~framework-patterns 与 framework-usage-patterns 职责边界~~ | 低 | ✅ **已修复**。`detectFrameworkFromPath` + `ENTRY_WEIGHT` 提取至 `project-context.js`；`framework-usage-patterns.js` 重命名为 `implicit-imports.js`；`framework-patterns.js` 现仅保留 AST_PATTERNS + `detectFrameworkFromContent` |
| 9 | ~~CLI `--help` 认知负担~~ | 中 | ✅ **已修复**。默认 `--help` 只展示 L1 核心命令（5 个），`--help --all` 展示完整列表；AI 消费者从 20 选 1 → 5 选 1 |

#### 当前不做

- daemon / 常驻索引进程：违反 CLI-only 原则
- `--suggest` 修复代码自动生成：违反"结构分析 ≠ 语义分析"
- `--cross-repo` 跨仓库依赖分析：成本过高
- 污点追踪 / 跨文件数据流：运行时绑定问题仍解不了

---

*Last updated: 2026-05-20（WorkspaceSnapshot 数据一致性修复 + environment-probe.js 完整统一 + git-tools.js porcelain 解析提取 + e2e-gitnexus 去重）*

> **本轮验证状态**：`npm run test:fast` 100/100 PASS；`node test/runner.js --layer slow` 27/27 PASS；`node test/runner.js --layer watch` 4/4 PASS；基线 `node cli.js audit-summary --cwd . --json --quiet` 通过（`healthScore=7/8`，`deadExports=0`，`unresolved=0`，`cycles=0`，`coverageRatio=1.00`）。
