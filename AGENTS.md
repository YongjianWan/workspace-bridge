# workspace-bridge - Agent Guide

> CLI-first 工作区分析引擎，给本地 AI coding agent 补"跨文件视角"和"变更验证建议"。
>
> 当前方向：只保留本地 CLI + skill，不再维护 MCP 协议层。
>
> **本文档是项目状态的单一事实源。** 功能状态、版本能力、下一步方向以本文档为准。

**文档速查**：
| 你想知道 | 看这里 |
|----------|--------|
| 项目是什么、怎么用 | [README.md](./README.md) |
| 当前活跃债务 | [docs/TECH_DEBT.md](./docs/TECH_DEBT.md) |
| 本轮做了什么、下一步 | [SESSION.md](./SESSION.md) |
| 长期路线、成功标准 | [ROADMAP.md](./ROADMAP.md) |
| 历史变更 | [CHANGELOG.md](./CHANGELOG.md) |
| 代码审计 skill 用法 | [skills/workspace-audit/SKILL.md](./skills/workspace-audit/SKILL.md) |

> **🔴 新会话启动红线：不默认读取 CHANGELOG.md**
>
> 确定现状只需 **AGENTS.md + SESSION.md + TECH_DEBT.md + 1 条基线验证命令**（`node cli.js audit-summary --cwd . --json --quiet`）。
> CHANGELOG 是历史存档，不是当前状态。读它不能替代读 SESSION.md 的基线确认。
> 只有三种场景允许打开 CHANGELOG：追查回归 / 修老 bug / 写 CHANGELOG 条目。

---

## 项目概述

**定位**：AI 的代码脚手架（Code Scaffolding for AI），不是人的报告工具。
- CLI 是"策展引擎"——预组装、去噪、按优先级排序
- skill 是"驾驶手册"——50 行足够
- **当前债务**：L1/产品债务已清零；L2 债务已清零；L3 债务与品味 8 项（见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)）

> 历史演进见 [CHANGELOG.md](./CHANGELOG.md) 与 [ROADMAP.md](./ROADMAP.md)。

## 工程品味（TASTE）

> 以下铁律直接指导代码层面的决策。
>
> **优先级：好品味 > 形式指标。** 8 条规则分两层：L1 铁律（3 条，必须遵守），L2 标准（5 条，技术债务信号）。新增规则前必须先问："这条是否已被 L1/L2 覆盖？"

### L1 铁律（违反 = 直接产生 bug 或资源泄漏）

> **适用范围**：任何涉及代码逻辑、数据结构、生命周期或接口契约的改动。
> 纯表层改动（调文案、改缩进、换颜色、改 CLI 默认值、修 formatter 字符串模板）不适用。

1. **Never break userspace** — 向后兼容性神圣不可侵犯，任何导致现有程序崩溃的改动都是 bug
   > **例外**：当 userspace 只有项目所有者本人且所有者明确要求重构时，兼容义务让位于演进效率。此时应通过 deprecation 警告 + 别名过渡期（1 个版本）平滑迁移，而非永久冻结接口。
2. **异常安全** — `shutdown/close/cleanup` 必须逐步骤独立 try-catch；cache load 必须防御旧格式/损坏格式；SIGINT/SIGTERM 必须注册 handler
   > **触发条件**：改动涉及资源生命周期、cache 读写、进程信号处理时适用。
3. **数据一致性** — 禁止把 cache 引用直接塞进可变结构；删除实体时必须清理所有关联缓存槽位；同一业务语义必须在单一模块实现
   > **触发条件**：改动涉及 cache/graph/状态增删改时适用。

### L2 标准（违反 = 技术债务，短期内可接受但必须偿还）

> **适用范围**：修改 L2 核心引擎（dep-graph.js、cache.js、graph-db.js、resolvers.js、parsers/shared.js、container.js）或 L4 编排层时强制适用。
> 表层改动、新增独立工具脚本、补测试不受约束。

4. **边界消除 > if** — 让边界情况消失，不是用 if 堆出来；重构 if-else 链为配置表时先判断互斥性
   > **触发条件**：新增/重构控制流、新增功能分支时适用。
5. **删除 > 添加** — 无当前用途的抽象 → 删；死代码 → 删；冗余特殊处理 → 删
   > **触发条件**：清理代码、重构模块时适用。不要为"可能未来有用"而保留代码。
6. **裸数字归零** — 新数字进 `constants.js`；新 regex 提到循环外；新阈值写注释说明 rationale
   > **触发条件**：新增任何字面量数字、regex、阈值时适用。
7. **重复即债务** — 同文件内明显重复的逻辑必须提取为纯函数。
   跨文件重复：目标层级已有合适宿主模块则提取，否则标记为债务，不强行新建模块。
   > **触发条件**：发现复制粘贴代码、提取公共逻辑时适用。
8. **内聚优先** — 文件只做一件事，命名口语化（避免教科书式），注释写"为什么"不写"做什么"。行数不重要——`dep-graph.js` ~1685 行仍保持不物理拆分，因为内部已通过 `GraphBuilder` / `GraphAnalyzer` / `GraphQuery` 实现认知拆分。判断标准：修改时是否只需理解一个概念。
   > **触发条件**：新增模块、拆分文件、调整目录结构时适用。

### 验证与调试

**TDD 原则**：没有失败的测试，就不写生产代码；测试必须验证业务语义（`typeof result === 'object'` 或 `code === 0` 但不验证行为 = 沉默的测试）。
- **测试升级规则**：低信号测试只保留 1 个版本，下一轮必须补语义断言或合并掉，防止再堆积。
- **轻量分层标记**：所有测试文件头部必须显式标注 `// @contract`（契约校验/CLI参数/Schema边界）或 `// @semantic`（算法/流程/业务逻辑断言），让新会话一眼识别测试分层与性质。

**收工前验证（4 步，不许跳）**
1. 确定：什么命令能证明这个结论？
2. 运行：执行完整命令，重新运行，完整执行
3. 阅读：完整输出，检查退出码，统计失败数
4. 验证：输出是否支持这个结论？否 → 进入调试流程；是 → 宣称完成

**调试流程（遇到失败时执行）**
1. **Root Cause**：仔细阅读错误信息 → 稳定复现 → git diff 近期变更 → 追踪数据流 → 找正常工作的示例对比差异
2. **Hypothesis**：提出单一假设，最小化验证
3. **Fix**：写失败测试 → 修复根因 → 回到收工前验证

**铁律**：跳过任何一步 = 说谎。不做根因调查，不许提修复方案。三次修不好 → 质疑架构。

---

## 开发原则

1. **CLI-only** — 不引入 MCP/协议层
2. **先减少误报，再加功能** — 结果可信优先
3. **先识别主线，再做判断** — 混合仓库先过滤
4. **输出必须指导动作** — 不是报告，是行动计划
5. **保守判断** — `dead-exports`、`historyRisk`、测试映射这些东西，一旦不确定就降级，不要自信胡说。
6. **结构分析 ≠ 语义分析** — workspace-bridge 回答"谁依赖谁、改了什么"，不回答"有没有 XSS、N+1 查询、事务缺失"。后者是大模型的语义判断能力圈，工具越界只会增加误报和依赖重量。拒绝把 workspace-bridge 变成 SonarQube 替代品。
7. **暴露冲突，不要折中** — 当发现架构冲突、职责不清、接口矛盾时，不允许用"两边都照顾一点"的妥协方案掩盖问题。折中只会在未来产生更复杂的 if-else 和隐性耦合。正确做法：暴露冲突，明确选择一方（哪怕暂时不舒服），或重构以彻底消除冲突。这条与 L2-4 "边界消除 > if" 互补：if 是代码层面的掩盖，折中是架构层面的掩盖。

---

## 当前能力

**已支持语言（9 种）**：JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue SFC、Svelte — 全栈 AST 覆盖。

**核心服务**：`ServiceContainer` / `FileIndex` / `DependencyGraph` / `DiagnosticsEngine` / `ProjectContext` / `stack-detector`

**关键特性**：`--severity` 过滤 / `--with-impact` / `--staged` / `--files` / `--save` / `--check-regression` / `warnings[]` / exit code 语义（0=成功，1=业务失败，2=崩溃）

> 命令列表见 `node cli.js --help` 和 [SKILL.md](./skills/workspace-audit/SKILL.md)。

---

## 项目骨架（运行 `node cli.js audit-summary --cwd .` 获取最新数据）

> 本段不存储具体数字，数字会过期。以下结构是稳定的。

**架构分层（按依赖方向，从上到下）**

| 层级 | 代表文件 | 职责 |
|------|----------|------|
| L0 基础设施 | `path.js`, `constants.js`, `sanitize.js` | 路径工具、常量、shell 参数与符号名过滤 |
| L1 存储/索引 | `cache.js`, `graph-db.js`, `file-index.js` | SQLite 缓存与持久化图存储（项目隔离：按 workspaceRoot md5 hash 分目录）、文件索引构建 |
| L2 核心引擎 | `dep-graph.js` | `DependencyGraph` facade + `GraphBuilder` / `GraphAnalyzer` / `GraphQuery` |
| L2.5 子引擎 | `parsers/*`, `resolvers.js`, `symbol-impact.js`, `function-impact.js`, `framework-patterns.js`, `implicit-imports.js` | 多语言 parser、import 解析、符号级影响、框架模式检测（9 语言 × 20+ 框架） |
| L3 服务组装 | `container.js` | `ServiceContainer` 组装所有服务 |
| L4 工具编排 | `audit-assembler.js`, `dep-tools.js`, `git-tools.js`, `health-tools.js`, `overview-tools.js`, `security-tools.js`, `workspace-tools.js` | 对外暴露的分析工具函数与 Curation/拼装层（`health-tools.js` 数据与 `audit-summary.health` 重合，已标记冗余） |
| L5 CLI/格式化 | `cli.js`, `formatters/` | 命令分发、JSON 输出聚合 |
| L6 外围 | `scripts/`, `test/`, `benchmark/` | 辅助脚本、全覆盖测试、性能基准 |

**高危改动文件**：`path.js` / `constants.js` / `dep-graph.js` / `cache.js`+`graph-db.js` / `parsers/shared.js` / `resolvers.js` — 改前必须跑 impact + affected-tests。

---

## 文档管理规则

> 历史信息只进 CHANGELOG，活跃状态只在当前文档。

| 文档 | 职责 | 不存什么 |
|------|------|----------|
| `CHANGELOG.md` | **唯一历史存档**。已修复 bug、新增功能、重构变更 | — |
| `TECH_DEBT.md` | **当前活跃债务**。只列还在的 L1/L2/P 条目 | 已修复条目的详细背景、修复过程、历史版本 |
| `SESSION.md` | **当前会话上下文**。本轮做了什么、下一步方向 | 上一轮详细记录（只保留指向 CHANGELOG 的引用） |
| `AGENTS.md` | **项目状态单一事实源**。功能状态、版本能力、下一步方向 | 历史变更细节 |

**清理铁律**：
- 任何活跃文档只存当前状态。修复即删，历史只进 CHANGELOG。
- 任何代码变更完成后，必须立即在 CHANGELOG.md顶层位置 `[Unreleased]` 追加条目。
- 标"已修复"前必须跑命令验证。无法验证则标"⚠️ 待验证"，不得标"✅ 已修复"。

---

## 注意事项

- `dead-exports` 对常见 JS/TS 语法已有基础符号级判断，但不是完整 AST 编译器。
- `audit-diff` 是当前主战场，改动最好优先补它的测试。
- 混合仓库必须用 `.workspace-bridge.json` 标注目录角色，否则孤儿检测严重误报。
- 已知限制与陷阱见 [ROADMAP.md §已知限制](./ROADMAP.md#已知限制当前待处理），已修复历史见 [CHANGELOG.md](./CHANGELOG.md)。
- 技术债状态见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（仅活跃条目）。

### 改前必查推荐用法

workspace-bridge 不是代码审查主力（发现不了逻辑 bug），但以下三个场景 ROI 最高：

**场景 1：新会话快速摸底**
```bash
node cli.js audit-overview --cwd . --json --quiet
```
→ 10 秒知道项目规模、热点文件、有没有循环依赖、未解析 import。

**场景 2：改前影响评估**
```bash
node cli.js impact --cwd . --file <target-file> --json --quiet
node cli.js affected-tests --cwd . --file <target-file> --json --quiet
```
→ 改一个文件之前，知道会波及多少模块、哪些测试需要跑。

**场景 3：定期清理死代码**
```bash
node cli.js dead-exports --cwd . --json --quiet
```
→ 按月清理一次 0 引用符号，但只删确认是死代码的（Java 常量仓库、Spring DI 类误报率极高）。

**不应做的事**：
- 把它当代码审查主力（逻辑问题靠人工/AI 语义审查）
- 按 architectureAdvice 拆分模块（单体项目已自动抑制激进建议）
- 盯着死导出数字做 KPI（误报太多）

### 输出格式注意事项

- **默认输出是 human-readable**，`--json` 只是可选开关。`cli.js` 不加 `--json` 时输出紧凑的终端友好格式。
- `workspace-info` 的 `parserAvailability.usedFallbackPath: true` 出现在非 Node.js 项目（Java/Python/Go）是正常的，表示 tree-sitter WASM 走了无 `package.json` 的初始化路径，**不表示文件被跳过解析**。

---

## Agent 认知边界（决策检查表）

> 以下规则供后续 AI agent 直接按条件执行，无需二次翻译。

### 规则 1：改前先判断

```
IF 任务属于 [调文案, 改缩进, 换颜色, 改 CLI 参数默认值, 修已有 formatter 字符串模板, 修已有 parser 的 regex]
THEN 现有骨架够用，直接改对应文件即可

IF 任务属于 [改 dep-graph.js 核心算法, 新增语言 parser, 改 ServiceContainer 生命周期, 新增 CLI 命令, 改评分阈值]
THEN 必须先读对应文件，不能凭骨架直接动手：
  - 影响计算/BFS/DFS → `dep-graph.js` + `symbol-impact.js`
  - 新增 parser → `parsers/registry.js` + `shared.js` + 任意现有 parser
  - import 解析 → `resolvers.js`
  - 验证命令生成 → `stack-detectors/detect.js` + `commands.js` + `validation-advice.js`
  - 容器初始化 → `container.js`
  - 新增 CLI 命令 → `cli.js` + `formatters/` + `tools/`
  - 新增/修改编排与输出 Curation → `src/tools/audit-assembler.js` + `src/cli/formatters/human-formatters.js`
  - 补测试 → `test/functionality-test.js` + `test/phase01-quality-test.js`
  - 提取类方法 → `grep` 搜索 `this.methodName` 的所有调用方
```

### 规则 2：高危文件改前跑 impact

```
IF 修改 path.js / constants.js / dep-graph.js / cache.js / graph-db.js / parsers/shared.js / resolvers.js
THEN 修改前必须跑：
  node cli.js impact --cwd . --file <改动文件> --json --quiet
  node cli.js affected-tests --cwd . --file <改动文件> --json --quiet

THEN 拿到结果后必须执行：
  1. 阅读完整输出，记录 impactedFiles.length 和 affectedTests.length
  2. 如果 impactedFiles 包含 dep-graph.js / cache.js / graph-db.js / container.js：
      → 核心基础设施被波及，改动必须保守，优先向后兼容（保留旧接口 + 新增，不删不改现有行为）
  3. 收工前必须跑 `npm run test:fast` 并 97/97 PASS，确认无回归
```

> 其余检查（裸数字、异常安全、语义同步、重复代码）已由 L1/L2 覆盖，无需单列。

**历史债务状态：** 活跃问题见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)，已修复历史见 [CHANGELOG.md](./CHANGELOG.md)。

继续保持 workspace-bridge 的克制哲学：CLI-only，够用就行，拒绝过度工程。

---

*使用说明见 [README.md](./README.md)；命令契约见 [skills/workspace-audit/SKILL.md](./skills/workspace-audit/SKILL.md)；**本轮会话上下文与已完成事项见 [SESSION.md](./SESSION.md)**；未竟事项见 [ROADMAP.md](./ROADMAP.md)；历史版本见 [CHANGELOG.md](./CHANGELOG.md)；历史技术方案见 [ROADMAP.md](./ROADMAP.md) 和 [CHANGELOG.md](./CHANGELOG.md)。*
*Last updated: 2026-05-23（Wave 3 Builder/Analyzer 解耦 + 后处理 Affected-only 增量化 + JS 解析器模块化 + BFS 优化 + WorkspaceSnapshot L4 迁移 + E2E 物理防线已完成；L3 债务与品味 6 项；99/99 fast 测试通过；schemaVersion: 1.2.0）*


