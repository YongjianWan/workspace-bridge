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

**上一轮**：`noLintersDetected` 修复、`--format ai` 统一入口、security formatter 重复模式提取、java-parsers timeout 归零、死代码过滤链 5 条规则。详见 CHANGELOG.md [Unreleased] §修复/功能/重构（2026-05-19 前 5 条）。

**本轮**：

**架构债务：`formatAi` counts/digest 耦合 + `/ 4` 裸数字** — `human-formatters.js` `constants.js`：
- `buildCommandAiDigest` 返回 `{ topRisks, actions, counts }`，消除手动映射。
- `/ 4` → `AI_FORMAT.ESTIMATED_CHARS_PER_TOKEN`。

**待验证问题 #6：diagnostics 缓存语义不一致** — `workspace-tools.js` `cache.js` `diagnostics-cache-test.js`：
- 根因：`runDiagnostics` 缓存条件 `allDiagnostics.length > 0` 拒绝命中空结果缓存，导致 linter 可用但 0 问题时每次重新执行 checks。
- 修复：`WorkspaceCache.hasDiagnosticEntries()` 区分「从未运行」和「运行过但空」；`runDiagnostics` 优先检查该方法。
- 测试：新增 `testDiagnosticsCacheEmptyHits` / `testDiagnosticsCacheEmptyFallsThrough` / `testHasDiagnosticEntries`。

**L2-6：测试代码硬编码 timeout + fixture 路径** — `e2e-gitnexus-test.js` `analysis-test.js` `framework-usage-patterns-test.js`：
- `timeout: 120000` → `TIMEOUTS.TEST_RUNNER_MS`；`fixture-temp` → `os.tmpdir()`；`fixture-temp-framework*` → `makeTempDir()`。
- 结果：TECH_DEBT.md「模块级副作用与硬编码魔数」清零删除。

**L1-3 + L2-6：cache/diagnostics/framework-patterns** — `cache.js` `diagnostics-engine.js` `framework-patterns.js`：
- `CACHE_STALE_MS` → `DEFAULTS.STALENESS_THRESHOLD_MS`；`DEBOUNCE_MS: 1000` → `DEFAULTS.DIAGNOSTICS_DEBOUNCE_MS`；`slice(0, 4096)` → `DEFAULTS.ENTRY_SCAN_BYTES`。

**L2-7：eslint/prettier 配置文件列表统一** — `constants.js` `workspace-tools.js` `diagnostics-engine.js`：
- 提取 `PROBE.ESLINT_CONFIG_FILES` / `PROBE.PRETTIER_CONFIG_FILES`。
- 结果：overview/health 数据重叠条目部分缓解。

---

### 活跃问题与技术债务

| 级别 | 数量 | 内容 |
|------|------|------|
| L1 Blocker | 0 | — |
| L2 债务 | 0 | — |
| L3 品味 | 3 | git-tools.js 手动字符级解析 / js.js visitor 超长 / cli.js JSON 嵌套深 |
| **产品债务** | **0** | — |

**测试覆盖缺口**

> **131/131 PASS**（fast 101 + slow 26 + watch 4）。测试基础设施已收敛，零专属测试模块清零。

> **剩余测试债务（已量化）**：
> - **弱断言 ~35 处**：仅余 `typeof` 型 schema 契约检查（带消息参数，风险低）。占总断言数 ~2.3%
> - **console.log 噪音 7 处**：代码字符串内嵌、平台跳过诊断、runner.js 骨架输出
> - **`audit-map-test.js` graph 数据字面量** 仍内联
> - **时序依赖**：mock 内部延迟保留、进程退出超时保护保留
> - **零专属测试模块剩余 0 个**
> - **CLI 集成测试补齐**：详见 CHANGELOG
>
> **测试类型分布失衡**：单元测试 ~78%（良好），集成测试 ~19%（偏低），端到端 ~2%（严重不足），混沌/模糊 0（暂缓）。

---

### 下一步方向

> 阶段 1（误报清零）、阶段 2（暴露正确 + 输出策展）、阶段 3（框架感知深化）全部完成。

#### 当前状态

- 活跃债务：**0 个 L1** + **0 个 L2** + **3 个 L3** + **0 个产品 bug** + **0 个产品债务**
- 版本：v1.2.0，schemaVersion 冻结
- 测试：**131/131 PASS**；全量 runner ~4min。开发迭代首选 `npm run test:fast`（~14s）
- P0-P4 全部完成
- **定位**：AI 的代码脚手架
- **核心认知**：CLI 静态分析能力没问题，问题在 CLI 出口质量（`--format ai` 边界行为、token 预算感知、去噪输出）

#### P0 去噪工程剩余 1 项

| # | 项 | 状态 | 说明 |
|---|-----|------|------|
| 1 | 工作目录污染 | ✅ 已完成 | 缓存已在 `os.tmpdir()`，旧文件已清理 |
| 2 | 常量仓库/脚手架过滤 | ✅ 已完成 | `dep-graph.js` 已 `continue` 跳过，`honesty-engine.js` 已标记误报 |
| 3 | audit-overview 去重 | ✅ 已完成 | `nextSteps` 已移除，recommendations 已统一 |
| 4 | `architectureAdvice` 抑制 | ✅ 已完成 | `< 200 files` 时 `couplingSplitSuggestions` 为空 |
| 5 | `audit-security` matchedText | ✅ 已完成 | JSON 已包含，human formatter 已展示 |

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

#### 当前不做

- daemon / 常驻索引进程：违反 CLI-only 原则
- `--suggest` 修复代码自动生成：违反"结构分析 ≠ 语义分析"
- `--cross-repo` 跨仓库依赖分析：成本过高
- 污点追踪 / 跨文件数据流：运行时绑定问题仍解不了

---

*Last updated: 2026-05-19（L2 债务清零 + diagnostics 缓存语义修复 + 文档整理）*

> **本轮验证状态**：`npm run test:fast` 101/101 PASS；`diagnostics-cache-test.js` PASS；基线 `node cli.js audit-summary --cwd . --json --quiet` 通过（`healthScore=7/8`，`deadExports=0`，`unresolved=0`，`cycles=0`）。
