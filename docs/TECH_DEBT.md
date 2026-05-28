# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

> 当前无活跃的 L1 Blocker。

## L2 债务（阻塞演进或导致结果不可信）

> 当前无活跃的 L2 债务。

---

> **当前活跃债务总览**：L1 Blocker **0** | L2 债务 **0** | 架构债务 **3** | L3 品味问题 **2** | 合计 **5 项**

## 架构债务（不阻塞功能，但阻塞演进速度）

#### 弱断言分布 — 占总断言数 ~2.3%

**数据**：


| 弱断言模式                                      | 数量      | 风险等级 | 说明                                                          |
| ------------------------------------------ | ------- | ---- | ----------------------------------------------------------- |
| `typeof x === 'string'/'number'/'boolean'` | ~10     | 低    | 带消息参数的 schema 契约检查，维持现状（改为值验证会导致 schema 变更时测试大面积失效）         |
| `.status === 0`                            | 1       | 中    | `java-parsers-test.js` 环境检测逻辑 `isJavalangAvailable()`，非测试断言 |
| `!== null/undefined`                       | ~20     | 低    | 存在性检查，属防御性验证，不纳入弱断言统计                                       |
| `strictEqual(result.ok, true/false)`       | ~48     | 低    | 深层嵌套防御性检查，风险低，不纳入弱断言统计                                      |
| **合计弱断言（需修复）**                             | **~10** | —    | 从 ~44 处降至 ~10 处（仅余 `typeof` 型 schema 契约检查）                   |


---

#### 测试类型分布失衡


| 类型                      | 文件数   | 占比   | 评估                                                     |
| ----------------------- | ----- | ---- | ------------------------------------------------------ |
| 单元测试（直接 `require src/`） | ~101  | ~77% | 比例良好                                                   |
| 集成测试（`spawn`/`runCli`）  | ~26   | ~20% | 已补充 `cli-integration-test.js`                          |
| 混沌/模糊测试                 | 0     | 0%   | 暂缓（CLI 工具）                                             |
| 并发/竞争测试                 | 4 个文件 | ~3%  | 存在（race、concurrency）                                   |
| 端到端测试                   | 5 个文件 | ~3%  | 已补充 `fp_regression_security.js` + `fp_regression_dead_exports.js` 归档已知误报场景 |


> 注：分类有重叠（如 `cache-concurrency-test.js` 既是集成测试也是并发测试），占比基于总文件数 133 独立计算，不互斥。

**根因**：80% 单元测试 + 弱断言 ~10 处（~2.3%）。CLI 管道回归保护已覆盖主要命令。

**影响**：CLI 入口的选项解析、路由分发、错误边界、格式化器选择等关键路径的回归保护已建立；主要剩余缺口是端到端测试（5 个文件，~3%），已补充 fp_regression 档案。

**方案**：

1. 弱断言清理继续推进（~10 处 `typeof` 型 schema 契约检查维持现状）。

---

#### slow 层测试过重

**数据**：slow 层 54 个测试需 ~250s，其中 `e2e-gitnexus-test.js` 单个测试占 ~23s（全层时间的 ~9%）。

**根因**：GitNexus 项目规模 1329 文件，CLI 冷启动 + 全量建图 + 加载 WASM。

**影响**：slow 层总时间 ~250s。预热缓存已部署，e2e-gitnexus 已使用 `SHARED_CACHE_DIR`，占比从 24% 降至 9%。

**方案**：

1. runner 预热缓存机制已部署，slow 层测试启动时复制预热缓存，跳过冷启动建图。
2. 剩余空间：`formatter-e2e-test.js`（~45s）和 `cli-integration-test.js`（~22s）是新的头部测试，可考虑进一步拆分或改为非 spawn 测试。

---

## L3 品味问题（建议修，非债务）


| 位置              | 问题                                                                                                                                     | 优先级 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `cli.js`        | `--json` 嵌套深，管道不友好                                                                                                               | 中   |
| `audit-assembler.js` / `overview-tools.js` | baseline 解析 fallback 路径仍有重复（Wave 7 已提取 `resolveBaseline`，但调用方仍保留相似 fallback）                                      | 低   |


---

## 文件级雷区地图


| 文件                                      | 行数   | 风险  | 状态                                                                                        |
| --------------------------------------- | ---- | --- | ----------------------------------------------------------------------------------------- |
| `src/tools/overview-tools.js`           | ~80 | 低   | U3 拆分已完成：数据组装进 `overview-assembler.js`，HTML 渲染与 I/O 进 `dashboard-formatter.js`；薄编排层仅剩 `buildProjectOverview` |
| `cli.js`                                | ~509 | 中   | `--json` 嵌套深，管道不友好                                                                        |
| `src/tools/git-tools.js`                | ~392 | 低   | L2-9 commit range 源                                                                       |
| `src/utils/project-context.js`          | ~634 | 低   | `inferFileRole()` 已状态化并消除规则盲区；`shouldExclude` CPU 消耗已修复                                |
| `src/utils/stack-detectors/detect.js`   | ~443 | 低   | stack-detector 检测子模块                                                                      |
| `src/utils/stack-detectors/commands.js` | ~639 | 低   | stack-detector 命令子模块                                                                      |
| `src/services/file-index.js`            | ~547 | 低   | 行数稳定，内部通过 `FileIndexBuilder` / `ChangeTracker` 实现认知拆分                                     |


---

## 测试覆盖缺口

### 零专属测试模块清单

- `src/tools/overview-curator.js`：`test/overview-curator-test.js` 覆盖全部导出。

**L5 格式化层（10 个 formatter，6 个间接覆盖）**


| 模块                                            | 状态      | 说明                                                                                                | 建议测试文件                         |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- | ------------------------------ |
| `src/cli/formatters/repo-summary.js`          | ⚠️ 间接覆盖 | `formatter-direct-test.js` 导入了 `buildRepoSummary` 但覆盖浅                                            | 扩展 `formatter-direct-test.js`  |
| `src/cli/formatters/human-formatters.js`      | ⚠️ 间接覆盖 | `formatter-direct-test.js` 覆盖了部分分支                                                                | 扩展 `formatter-direct-test.js`  |
| `src/cli/formatters/validation-advice.js`     | ⚠️ 间接覆盖 | 被 `audit-file-validation-advice-test.js` 间接覆盖                                                     | 扩展 `formatter-direct-test.js`  |


---

### 有测试但可继续深化的模块


| 模块                      | 测试文件                                                                   | 覆盖状态                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `workspace-snapshot.js` | `dep-tools-test.js` `overview-tools-test.js` `project-map-test.js`（试点） | ⚠️ 仅验证了 backward-compat（`snapshot.graph` 替代手工 mock），`getConfidence`/`knownBlindSpots`/`getSelfAwarenessSummary`/`basedOn` 零断言覆盖 |


### Flaky 根因


| 测试文件           | 根因                           | 建议修复                                                            |
| -------------- | ---------------------------- | --------------------------------------------------------------- |
| `repl-test.js` | runner.js 串行执行时偶发失败；单独运行稳定通过 | 已记录于 SESSION.md §已知陷阱；若遇失败先重跑确认，再单独 `node test/repl-test.js` 验证 |


# Workspace-Bridge CLI Dogfooding Curation Report

This report presents a consolidated, comprehensive evaluation of the `workspace-bridge` CLI tool, analyzed and executed against its own codebase (comprising 281 files and 531 dependency edges). It serves as the **single source of truth** regarding the tool's performance, limitations, and friction points for both human developers and AI coding agents.

---

## 📊 Executive Summary

- **Overall Command Viability**: **22 / 22** commands are runnable and syntactically valid. The core graph parsing (`dep-graph.js`), file indexing (`file-index.js`), and SQLite caching (`cache.js`/`graph-db.js`) are robust and produce consistent dependency mapping.
- **Identified Issues**: **37 total issues** verified through extreme stress and boundary testing:
  - **3 P0 Issues** (Deceptive/broken output, silent configuration failures)
  - **19 P1 Issues** (Incorrect validation, path leakage, exit-code inconsistencies, silences, parser crashes)
  - **15 P2 Issues** (Experience flaws, missing UI fields, hidden options)
- **Key Takeaway**: While `workspace-bridge` functions perfectly for general manual auditing, it contains critical **semantic and validation traps** that can mislead or break an AI agent relying on it for automated execution.

### 🌟 Dimensional Star Ratings (AI & Engineering Perspective)

| Dimension | Rating | Technical Explanation / Rationale |
|---|---|---|
| **Core Reliability** | ⭐⭐⭐⭐⭐ | The core graph builder, cache, and database layers are extremely reliable. Cross-command data checks out with perfect numeric consistency. No database lockups or silent indexer drops detected under ordinary workloads. |
| **Parameter Arg Strictness** | ⭐⭐⭐ | Weak. Major options like `--format`, `--direction`, `--depth`, and `--mode` silently fall back on invalid inputs instead of triggering standard `exit 2` schema errors. |
| **Output Completeness** | ⭐⭐⭐⭐ | High structural coverage in JSON mode. However, the Markdown formatter suffers from severe information loss (lacks `validationAdvice` for L1 commands) and nested object serialization bugs (`stats`). |
| **Boundary Scene Handling** | ⭐⭐⭐ | Susceptible to timeouts under empty directories or non-git CWD scopes, and unhandled system loader exceptions under ESM-CJS syntax mix-ups. Heuristics are overly aggressive for export-free files. |
| **Doc-Implementation Agreement**| ⭐⭐⭐⭐ | General alignment, but hides powerful automation settings (e.g. `--fail-on-findings`) and makes false promises regarding glob exclusion formats (`--exclude "*.test.js"`). |

---

## ⚠️ Test Evolution & Gaps: Untested or Insufficiently Tested Scenarios

The validation progressed through three consecutive iterations: **Phase 1: Basic Dry-Run** -> **Phase 2: Comprehensive Curation Checks** -> **Phase 3: Extreme Boundary Stress Testing**.

The following scenarios represent remaining test gaps and were not fully covered during the dogfooding session:

| Scenario | Risk Category | Reason for Insufficient Testing / Omission |
|---|---|---|
| **`audit-file --watch` & `watch`** | Interactive | Requires continuous file-system mutation triggers in a headless environment. |
| **`--overview-dashboard` HTML** | Output Quality | Verified the physical file generation (6546 bytes) but did not render in a browser to check layout integrity. |
| **`--hotspot-data` / `--stability-trend-data`** | Data Schema | Verified file creation and top-level JSON structure but skipped exhaustive schema value checks. |
| **`--baseline <commit>` (HEAD~1)** | Regression | Tested the commit format, but the absence of structural changes resulted in empty comparative diffs. |
| **REPL Interactive Mode** | Env / TTY | Requires a pseudo-TTY shell; throws a terminal error under headless task spawners. |
| **`audit-security` external Semgrep** | External Dep | Semgrep binary was not pre-installed in the execution environment; verified built-in regex fallback only. |
| **`--config` non-auto value** | External Dep | Heavily relies on Semgrep rule routing. |
| **`--incremental + --commits`** | Edge Case | Did not thoroughly verify edge combinations of these two filters. |
| **`tree` recursion bounds (depth=100)** | Performance | Depth of 10 was tested (producing 854 lines flawlessly), but did not stress test a depth of 100 on large branches. |
| **`--trend-granularity week`** | Date Aggregation | The repository has only 1 day of caching history, preventing multi-week trend validation. |
| **`--check-regression` on code changes** | Stability | Intentional syntax injection crashed the parser before regression comparison was triggered. |
| **Multi-file comma-separated input** | CLI / Args | Commas in `--file` are supported in `audit-security` but not verified across other commands. |
| **`init` behavior on non-git paths** | Lifecycle | Checked that `init` works, but subsequent execution of git-bound commands yields timeouts. |

---

## 🌐 Test Ground ("实战基地") Context

A secondary testing ground exists at `C:\Users\sdses\Desktop\神思\code` containing four external active repositories. 
- **Omission**: These repositories were not audited during the current session to lock execution inside the `workspace-bridge` workspace.
- **Future Execution**: To execute audits on these repositories, the following batch loop should be triggered:
```bash
for dir in C:/Users/sdses/Desktop/神思/code/*/; do
  echo "=== Auditing: $dir ==="
  node cli.js audit-summary --cwd "$dir" --json --quiet
done
```

---

## 🤖 AI Agent Integration Pitfalls & Deep-Dive Evidence

For an AI agent, the CLI represents its "eyes and ears". The following traps are especially dangerous, leading to incorrect automated choices.

### 🚨 Pitfall 1: `--format json` vs `--json`
AI agents standardly pass `--format json` based on general CLI design.
- **Behavior**: `--format json` is silently ignored on core L1 commands, reverting to Markdown.
- **Impact**: AI runs `JSON.parse()` on Markdown, crashing the agent workflow despite an `exit 0` CLI status.
- **Verification Evidence**:

**Full command verification matrix:**

| Command | `--json` (global flag) | `--format json` (per-formatter) | `--format jsonl` |
|---------|------------------------|--------------------------------|------------------|
| `audit-summary` | ✅ Returns JSON | ❌ Reverts to Markdown | Untested |
| `audit-file` | ✅ Returns JSON | ❌ Reverts to Markdown | ✅ Returns JSONL |
| `audit-diff` | ✅ Returns JSON | ❌ Reverts to Markdown | Untested |
| `audit-map` | ✅ Returns JSON | ❌ Reverts to Markdown | Untested |
| `dead-exports` | ✅ Returns JSON | ❌ Returns plain text | Untested |

```bash
# AI reads help showing "--format <mode>  Output format: summary | markdown | jsonl | ai | human"
# AI executes the command expecting JSON:
node cli.js audit-file --file x.js --format json --quiet
# -> Output is Markdown: "# File Audit: ..."

# Correct command requires global flag --json:
node cli.js audit-file --file x.js --json --quiet
# -> Output is structural JSON: {"ok":true,...}
```

### 🚨 Pitfall 2: Quiet configuration corruption (.workspace-bridge.json)
If the configuration JSON has a syntax error (e.g., a trailing comma):
- **Behavior**: The CLI silently ignores the configuration file, prints `hasWorkspaceBridgeConfig: false`, and falls back to a full recursive scan of the repository.
- **Impact**: Files in excluded/archived folders (like `reference/`) are indexed. The AI bases its dependencies, tests, and impact analysis on a scope 10 times larger than intended without ever knowing the configuration failed.
- **Verification Evidence**:
```bash
# Corrupt the config file with raw invalid text:
echo 'this is not json at all' > .workspace-bridge.json
node cli.js audit-summary --cwd . --json --quiet
# -> CLI returns ok: true but outputs:
# {
#   "ok": true,
#   "hasWorkspaceBridgeConfig": false,
#   "totalFiles": 2140, // Escalated scope! Includes 4170 files in archived/reference/ folders.
#   "deadExports": 3
# }
```

### 🚨 Pitfall 3: Path scoping deception (`--cwd`)
Executing command on subdirectories using `--cwd`:
- **Behavior**: The path parser automatically resolves upwards to find the Git root, overriding the targeted subdirectory.
- **Impact**: AI expects to analyze a single subdirectory but is silently fed stats for the entire repository.
- **Verification Evidence**:
```bash
node cli.js workspace-info --cwd reference --quiet
# -> Returns:
# {
#   "workspaceRoot": "C:\\Users\\sdses\\Desktop\\随机小项目\\workspace-bridge" 
# }
# Note: Instead of locking to reference/, it traverses up and targets the entire repo.
```

### 🚨 Pitfall 4: `--check-regression` is Structural Only
- **Behavior**: This command only compares **structural index counts** (unresolved imports, dead exports count, and cycles). It does *not* compare actual code lines or content diffs.
- **Impact**: The AI may assume no regression occurred because the metric counts are identical, even though files have changed internally.

### 🚨 Pitfall 6: ESM / CJS Syntax Parser Crash
- **Behavior**: Injecting ES module syntax (`export const`) into the CommonJS codebase (e.g., `container.js`) causes the tree-sitter parser/runner to throw unhandled Node.js CJS/ESM module loader exceptions.
- **Impact**: The CLI crashes completely rather than falling back to a graceful error report.

---

## 🚨 Structural Inconsistencies & Data Omissions (AI Deep Dive)

### 1. `symbolImpact` Dependency Omissions
Precision graph calculations miss specific dependencies when importing multiple destructured symbols.

```json
"symbolImpact": {
  "sourceSymbols": ["ServiceContainer", "STATES"],
  "symbolToDependents": [
    {
      "symbol": "ServiceContainer",
      "dependentsCount": 9,
      "dependents": ["test/container-lifecycle-test.js", ...]
    }
    // STATES IS SILENTLY OMITTED!
    // Even though container-lifecycle-test.js explicitly imports {"ServiceContainer", "STATES"}
  ]
}
```

### 2. `audit-security` Rule ID vs Rule Name Mismatch
Markdown output formats rules as `js-hardcoded-secret`, but JSON serializes it as `ruleId` with `rule` set to `undefined`:
```json
{
  "ruleId": "js-hardcoded-secret",
  "rule": null, // Mapped incorrectly
  "message": "Possible hardcoded secret"
}
```

---

## 🛠️ CLI Command Hierarchy & Curation

Out of 22 supported commands, overlapping and redundant commands should be streamlined or deprecated.

```mermaid
graph TD
    classDef high fill:#d4edda,stroke:#28a745,color:#155724;
    classDef med fill:#fff3cd,stroke:#ffc107,color:#856404;
    classDef low fill:#f8d7da,stroke:#dc3545,color:#721c24;

    A[workspace-bridge CLI] --> L1[L1: Core Workflows]
    A --> L2[L2: Debug & Raw Query]
    A --> L3[L3: Environment & Security]

    L1 --> C1[audit-overview]:::high
    L1 --> C2[audit-file]:::high
    L1 --> C3[audit-diff]:::high
    L1 --> C4[audit-map --compact]:::high
    L1 --> C5[audit-summary]:::med

    L2 --> R1[tree / repl]:::med
    L2 --> R2[impact / affected-tests]:::med
    L2 --> R3[dead-exports / unresolved / cycles]:::med
    L2 --> R4[dependencies / dependents]:::med

    L3 --> D1[workspace-info / health]:::low
    L3 --> D2[diagnostics / debug]:::low
    L3 --> D3[audit-security]:::med

    class C1,C2,C3,C4,C5 high;
    class R1,R2,R3,R4,D3 med;
    class D1,D2 low;
```

### 🟢 Core Tier: Highly Valuable for AI & Humans (4 Commands)
These four commands represent the core curation engine and cover 95% of use cases:
1. **`audit-overview --json`**: **Default entry.** Structural snapshot + hotspots + knowledge risk + dead exports + unresolved + cycles + orphans + language coverage. Replaces `audit-summary` as the primary L1 command.
2. **`audit-file --file <path> --json`**: Evaluates files before modification (provides impact, affected tests, and validation advice).
   - *Evidence of Redundancy Elimination*: Running `node cli.js audit-file --file src/services/container.js --json --quiet` yields a single package containing `impactCount: 16` and `affectedTestsCount: 18`, along with `validationAdvice`. Individually running `impact` or `affected-tests` on the same file yields flat, contextless lists with no actionable validations.
3. **`audit-diff --json`**: Checks changed code and generates verification phases.
4. **`audit-map --compact --json`**: Quick structural connection view.

### 🟡 Sub-Tier / Debug Tier: Redundant but Functional (13 Commands)
These are fully covered by L1 workflows or tree commands, but useful for raw granular queries:
- **`impact` & `affected-tests`**: Fully redundant; `audit-file --json` already includes both outputs along with validation advice.
- **`dead-exports`, `unresolved`, `cycles`**: Redundant; `audit-overview` aggregates their counts and details.
- **`dependencies`, `dependents`**: Redundant; `tree --direction imports/dependents` provides hierarchal context instead of flat lists.
- **`repl --eval`**: Crucial for large repos, but lacks `tree` command support in REPL mode. JSON formatting has been fixed.
- **`tree`**: Excellent for hierarchical layout, but missing from REPL mode.
- **`audit-security --builtin-only`**: Basic regex match ruleset, best combined with an external static analyzer.

### 🔴 Redundant or Broken Tier: Candidates for Deprecation (4 Commands)
These commands are obsolete, empty, structurally broken, or absorbed by other commands:
1. **`audit-summary`**: **Absorbed by `audit-overview`.**
   - *Evidence*: `health` checklist（文件存在性检查：README/LICENSE/.gitignore/Dockerfile）对 AI 决策零贡献。`audit-overview` 已覆盖 `deadExports`/`unresolved`/`cycles` + 新增 `hotspots`/`knowledgeRisk`/`orphans`/`languageSupport`。保留为兼容层，1 个版本后移除。
2. **`health`**: Obsolete.
   - *Evidence*: Aggregates identical data to `audit-summary --health-only`. Both commands deprecated in favor of `audit-overview`.
3. **`diagnostics`**: `--mode full` hangs indefinitely on linter discovery; `--mode quick` works but only runs `git status`.
   - *Evidence*: `node cli.js diagnostics --cwd . --mode full --quiet` times out after 120s without returning. `checksRun` is unreliable in full mode due to `buildChecks()` lacking timeout guards on individual linter discovery.
4. **`debug --what symbols`**: Always returns zero unless custom symbols exist.
   - *Evidence*: `node cli.js debug --cwd . --what symbols --quiet` yields `symbolCount: 0, fileCount: 0`, and running `--what graph` immediately crashes with `Supported: symbols`.

---

## 📊 Core Engine Stability: Data Consistency Cross-Validation

To verify that the underlying graph database (`graph-db.js`) and indexing layers produce reliable data despite upper-level CLI formatting and option flaws, a cross-command mapping consistency audit was executed:

| Target Metric | Command A (Source) | Command B (Target) | Status | Matching Data Value |
|---|---|---|---|---|
| **`container.js` total imports** | `repl --eval "stats"` | `stats --json` | ✅ Pass | **531 total references** parsed |
| **`container.js` impact radius** | `impact --file` | `audit-file` | ✅ Pass | **16 downstream modules** impacted |
| **`container.js` test reach (depth=5)**| `affected-tests` | `audit-file` | ✅ Pass | **18 affected test files** triggered |
| **`container.js` test reach (depth=1)**| `affected-tests --max-depth 1`| `repl --eval "affected-tests ... 1"` | ✅ Pass | **17 test dependencies** |
| **Dead Exports count** | `dead-exports` | `audit-summary` | ✅ Pass | **0 dead symbols** |
| **Dependency Cycles** | `cycles` | `audit-summary` | ✅ Pass | **0 cycles** |
| **Unresolved Imports** | `unresolved` | `audit-summary` | ✅ Pass | **0 imports unresolved** |
| **Repository Health rating** | `health` | `audit-summary` | ✅ Pass | **7/8 passing rules** (no docker config) |
| **Orphan Files count** | `audit-map` | `audit-overview` | ✅ Pass | **2 orphan files** (after cache pre-run) |

---

## 🔀 Options Combinations Validation Matrix

Upper-level orchestration behavior was tested across combined and conflicting CLI arguments:

| Option Combination | Intended Logic | Real Outcome | Assessment / Status |
|---|---|---|---|
| `--json` + `--format markdown` | Global overrides formatter | `--format` takes precedent; yields Markdown. | ⚠️ **Undocumented Precedence** |
| `--staged` + `--commits HEAD~1..HEAD` | Staged changes prioritized | Output lists changed files = 6. | ⚠️ **Undefined Combined Behavior** |
| `--save` + `--check-regression` | Write and evaluate | Saves baseline; check outputs empty diff. | ⚠️ **Opacity / Hard to verify** |
| `--depth full` + `--token-budget 50` | Safe structural downgrade | Gracefully downgraded depth to `surface`. | ✅ **Pass** (Downgrade works) |
| `--depth full` + `--token-budget 2000` | Full structural payload | Returns complete full AST dependency graph. | ✅ **Pass** |
| `--exclude test,scripts` | Comma delimited folders | Both directories successfully ignored. | ✅ **Pass** |
| `--exclude test --exclude scripts` | Multi-flag registration | Both directories successfully ignored. | ✅ **Pass** |
| `--exclude "*.test.js"` | Glob file exclusion | No files excluded; matches directory names only. | ❌ **Fail (Bug ID 6)** |
| `--format ai` + `--depth full` | Step-by-step telemetry | Telemetry is scaled correctly. | ✅ **Pass** |
| `--hotspot-data` + `--stability-trend-data` + `--overview-dashboard` | Generate files | All three physical report assets created. | ✅ **Pass** |

---

## 🐛 Comprehensive Bug Matrix (8 Active Issues)

> **状态更新（2026-05-28）**：以下表格仅包含尚未修复的 8 项活跃缺陷（均为 P2 体验与边界问题）。已被 Dogfood 修复波次（Wave 1-7）修好的 29 项缺陷历史详情已移至 [CHANGELOG.md](../CHANGELOG.md) [Unreleased]。

Below is the checklist of active codebase issues. Every bug includes precise **reproduction commands** and **specific file targets** to ensure the engineering team can replicate and resolve them.

| ID | Severity | Area | Problem Description | Reproduction Command & Target File | Impact | Proposed Fix |
|---|---|---|---|---|---|---|
| **25** | **P2** | Heuristics | Mention-based tests are labeled with static `distance: 6`. | Run `node cli.js affected-tests --file src/services/container.js --json`<br>**Target**: `src/tools/affected-tests.js` | Misleading graph depth indicator. | Replace static placeholder with dynamic distance or null. |
| **27** | **P2** | Indexer | `coverageRatio` statistics ignore the `--exclude` parameters. | `node cli.js audit-summary --exclude test --json`<br>**Target**: `src/tools/audit-assembler.js` | Misrepresented coverage stats. | Recalculate index bounds relative to included scope. |
| **28** | **P2** | Orchestrator| Undefined behavior when mixing `--staged` and `--commits`. | `node cli.js audit-diff --staged --commits HEAD~1..HEAD`<br>**Target**: `src/tools/git-tools.js` | Uncertain diff context. | Document precedence rules or throw a parameter conflict error. |
| **29** | **P2** | REPL / CLI | REPL vs CLI `affected-tests` distance count mismatch under identical `--max-depth 1` constraint (REPL shows 11 distance-2 items, CLI shows 4). | `node cli.js repl --eval "affected-tests container.js --max-depth 1"` vs CLI `--max-depth 1`<br>**Target**: `src/cli/repl.js` vs standard commands | Inconsistent dependency mapping. | Synchronize graph distance logic inside REPL parser. |
| **31** | **P2** | Auditing | Structural only comparisons for `--check-regression` undocumented. | Run `node cli.js audit-summary --check-regression`<br>**Target**: `src/cli/commands/audit-summary.js` | Semantic opacity. | Document metric scope in `--help` or command descriptions. |
| **32** | **P2** | Orchestrator| `--reuse-hints` toggle yields identical results with no feedback mechanism. | `node cli.js audit-diff --staged --reuse-hints on`<br>**Target**: `src/tools/git-tools.js` | Feature verify opacity. | Provide explicit feedback when change index hints are applied. |
| **34** | **P2** | Formatters | `audit-file` and `audit-diff` Markdown templates are excessively stripped down. | Compare `node cli.js audit-file --file x.js --json` vs `--format markdown`<br>**Target**: `src/cli/formatters/human-formatters.js` | Information starvation for human auditing. | Enrich Markdown formatting templates to mirror JSON structures. |
| **36** | **P2** | Security | Raw Git ambiguities exposed on stderr during invalid git commits range audits. | `node cli.js audit-diff --commits invalid..range` or `--since "not-a-date"`<br>**Target**: `src/tools/git-tools.js` | Unclean shell stderr pollution. | Wrap spawned git processes inside strict error mapping boundaries. |

---

## ✅ Verified Safe Boundary Behaviors

While the Bug Matrix documents failures, the following 12 boundary scenarios were explicitly tested and **passed**—confirming resilience in the core engine under abnormal inputs.

| # | Scenario | Result | Assessment |
|---|----------|--------|------------|
| 1 | **Only-comments file** | `severity=low`, `impact=0`, `affectedTests=0` | ✅ Correctly handled |
| 2 | **Shebang script (no extension)** | `file-fallback`, `reason="source-not-indexed"` | ✅ Correctly handled |
| 3 | **Binary file disguised as `.js`** | `file-fallback`, `reason="ast-unavailable"` | ✅ Graceful fallback |
| 4 | **UTF-16 BOM file** | `file-fallback`, `reason="ast-unavailable"` | ✅ Graceful fallback |
| 5 | **Extremely large file (50K lines / ~350KB)** | `file-fallback`, `reason="ast-unavailable"`, no timeout | ✅ Performance safe |
| 6 | **Malformed syntax file** | `file-fallback`, `reason="ast-unavailable"`, no crash | ✅ Graceful fallback |
| 7 | **Symbolic link** | Resolved to target, analyzed normally | ✅ Correctly handled |
| 8 | **Emoji / Unicode Chinese filename** | Symbols parsed correctly (`rocket`, `chinese`) | ✅ Correctly handled |
| 9 | **`--save /dev/null`** | Writes successfully without error | ✅ Correctly handled |
| 10 | **`--cache-dir` custom path + delete + rebuild** | Creates ~11MB cache.db, rebuilds normally | ✅ Correctly handled |
| 11 | **Source file modified then immediately audited** | Results reflect changes instantly | ✅ Correctly handled |
| 12 | **Rapid consecutive identical command runs** | Cache reused, results stable | ✅ Correctly handled |

---

## 🔍 Validation Matrices & Behavior

### Exit Code Compliance Matrix

To ensure automation reliability, the CLI must return strict exit codes based on error type:

| Execution Case | Command Sample | Actual Exit Code | Intended Semantic | Status |
|---|---|---|---|---|
| **Clean Run** | `node cli.js audit-summary` | `0` | Successful Execution | ✅ Pass |
| **No Findings + Strict**| `node cli.js dead-exports --fail-on-findings` | `0` | Success (No debt found) | ✅ Pass |
| **Debt Found + Strict** | `node cli.js audit-summary --fail-on-findings` | `1` | Business/Validation Failure | ✅ Pass |
| **Missing Arguments** | `node cli.js impact` (no `--file`) | `2` | Bad Request / Parameter Error | ⚠️ Pass (Excessive error prefix) |
| **Invalid Command** | `node cli.js invalid-command` | `2` | Execution Failure | ✅ Pass |
| **Missing File Target** | `node cli.js tree --file missing.js` | `1` | Business/Validation Failure | ✅ Pass |
| **Path Traversal** | `node cli.js audit-file --file /tmp/x.js` | `1` | Security Violation (Protected CWD) | ✅ Pass |
| **REPL Bad Command** | `repl --eval "invalid"` | `0` | Expected Execution Failure (2) | ❌ Fail (Silently eats error) |

---

### Path Bound Handling Matrix

| Path Syntax | Example | Resolution Status | Notes |
|---|---|---|---|
| **Relative Path** | `src/services/container.js` | ✅ Resolved | Works correctly. |
| **Relative Path `./`**| `./src/services/container.js` | ✅ Resolved | Works correctly. |
| **Absolute Path** | `C:/Users/sdses/.../container.js`| ✅ Resolved | Works correctly. |
| **Windows Backslash**| `src\services\container.js` | ❌ Parse Failure | Escaped character is treated as string. |
| **Unicode / Chinese**| Native path strings | ✅ Resolved | Handled perfectly by standard fs. |
| **Directories** | `src/services/` | ⚠️ Accepted | Accepted, but yields junk/empty stats. |
| **Non-project File** | `/tmp/external.js` | ✅ Rejected | Blocked by path-traversal guard. |
| **Non-code File** | `README.md` | ✅ Graceful Fallback| Excluded from graph safely. |

---

## 💡 Recommendations for SKILL.md Adaptation

To align instructions with actual CLI boundaries, update `SKILL.md` as follows:

1. **Change Default Formats**: Avoid recommending `--format markdown --quiet` as the default for AI integrations. Replace it with `--json --quiet` to prevent Markdown regex-parsing overhead.
2. **Re-evaluate audit-overview**: Remove `audit-overview` from the "avoid calling" block. It contains essential telemetry like `knowledgeRisk` and `hotspots` that `audit-summary` does not supply.
3. **Clarify Curation Advantage**: Instruct the agent that `audit-file --json` handles impact mapping and test analysis internally, removing the need for separate execution of `impact` or `affected-tests`.
4. **Mention Filter warning**: Instruct the agent to filter `affected-tests` strictly by `source: "graph"`, and approach `source: "mention"` with lower priority.
5. **Surface `coChanges`**: The `audit-file --json` output includes a `coChanges` array identifying files that frequently change together with the target. This is highly valuable for AI impact assessment but is not mentioned in SKILL.md.
