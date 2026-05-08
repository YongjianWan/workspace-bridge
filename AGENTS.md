# workspace-bridge - Agent Guide

> CLI-first 工作区分析引擎，给本地 AI coding agent 补"跨文件视角"和"变更验证建议"。
>
> 当前方向：只保留本地 CLI + skill，不再维护 MCP 协议层。
>
> **本文档是项目状态的单一事实源。** 功能状态、版本能力、下一步方向以本文档为准。

---

## 实战基地

> `C:\Users\sdses\Desktop\神思\code` 是 workspace-bridge 的实战基地，内含四个仓库，用于功能验证与实战演练。

## 项目概述

workspace-bridge 的核心价值很直接：

- **让 AI 写代码更方便**
- 跨文件结构化分析
- 变更影响范围
- 测试建议
- Git 历史风险提示

**终极定位：AI 的基础设施，不是人的报告工具。**

人类开发者有 Read/Grep/Bash，AI agent 也有。但两者都缺的是**聚合判断**——把跨文件关系、变更风险、测试映射一次性算好、策展好、喂到上下文里。

workspace-bridge 不做"给 AI 一把铲子让它自己挖"（那是 GitNexus 的方向），而是"直接筛出金子递给 AI"。

所以 compact 模式是核心壁垒，全栈语言覆盖是必要能力，策展哲学是设计一切功能的北极星。

---

## 工程品味（TASTE）

> 以下铁律直接指导代码层面的决策。
>
> **优先级：好品味 > 形式指标。** 11 条规则分三层，agent 只需记住 L1 铁律（3 条），L2 标准（4 条）和 L3 指南（4 条）作为辅助判断。新增规则前必须先问："这条是否已被 L1/L2/L3 覆盖？"

### L1 铁律（违反 = 直接产生 bug 或资源泄漏）

1. **Never break userspace** — 向后兼容性神圣不可侵犯，任何导致现有程序崩溃的改动都是 bug
2. **异常安全** — `shutdown/close/cleanup` 必须逐步骤独立 try-catch；cache load 必须防御旧格式/损坏格式；SIGINT/SIGTERM 必须注册 handler
3. **数据一致性** — 禁止把 cache 引用直接塞进可变结构；删除实体时必须清理所有关联缓存槽位；同一业务语义必须在单一模块实现

### L2 标准（违反 = 技术债务，短期内可接受但必须偿还）

4. **边界消除 > if** — 让边界情况消失，不是用 if 堆出来；重构 if-else 链为配置表时先判断互斥性
5. **删除 > 添加** — 无当前用途的抽象 → 删；死代码 → 删；冗余特殊处理 → 删
6. **裸数字归零** — 新数字进 `constants.js`；新 regex 提到循环外；新阈值写注释说明 rationale
7. **重复即债务** — 同文件相似度 > 70% 的代码必须提取为纯函数

### L3 指南（违反 = 品味问题，建议遵守）

> **好品味的核心是内聚、边界清晰、命名准确，不是行数。** 500 行或 1000 行都不重要——重要的是一个文件是否只干一件事，修改时是否只需理解一个概念。

8. **函数 < 30 行** — 只做一件事
9. **文件内聚优先** — 超线考虑拆分，但不要为了拆而拆；`dep-graph.js` 700+ 行仍保持不拆分，因为它的职责单一
10. **命名 < 3 词** — 口语化，避免教科书式命名
11. **注释写"为什么"** — 不写"做什么"（代码自己会说），写"为什么这么设计"和"边界假设"

### TDD 铁律

- 没有失败的测试，就不写生产代码
- 修改测试后，先运行确认它 **FAILS（red）**，再写实现

### 验证门禁（收工前必做）

1. 确定：什么命令能证明这个结论？
2. 运行：执行完整命令（重新运行，完整执行）
3. 阅读：完整输出，检查退出码，统计失败数
4. 验证：输出是否支持这个结论？
   - 否 → 用证据说明实际状态
   - 是 → 带证据陈述结论
5. 只有这时 → 才能宣称完成

**跳过任何一步 = 说谎，不是验证。**

### 调试流程（Systematic Debugging）

遇到工具失败或报错时，按此顺序执行，不许跳步：

1. **Root Cause**：仔细阅读错误信息 → 稳定复现 → 检查近期变更（git diff） → 追踪数据流
2. **Pattern**：找正常工作的示例，对比差异
3. **Hypothesis**：提出单一假设，最小化验证
4. **Fix**：写失败测试 → 修复根因 → 验证 → 收工

**铁律**：不做根因调查，不许提修复方案。三次修不好 → 质疑架构。

---

## 开发原则

1. **CLI-only** — 不引入 MCP/协议层
2. **先减少误报，再加功能** — 结果可信优先
3. **先识别主线，再做判断** — 混合仓库先过滤
4. **输出必须指导动作** — 不是报告，是行动计划
5. **保守判断** — `dead-exports`、`historyRisk`、测试映射这些东西，一旦不确定就降级，不要自信胡说。

---

## 当前能力

### 关键服务

> 命令列表与使用场景见 `node cli.js --help` 和 [SKILL.md](./skills/workspace-audit/SKILL.md)。
>
> **已支持语言（9 种）**：JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue SFC、Svelte — 全栈 AST 覆盖达成。

- `ServiceContainer` — 生命周期管理和初始化门控
- `FileIndex` — 索引文件、维护缓存
- `DependencyGraph` — 依赖图、影响面、死导出、受影响测试
- `DiagnosticsEngine` — 后台诊断缓存
- `ProjectContext` — 主线/非主线语义识别
- `stack-detector` — 技术栈检测和验证命令生成

- `ServiceContainer` — 生命周期管理和初始化门控
- `FileIndex` — 索引文件、维护缓存
- `DependencyGraph` — 依赖图、影响面、死导出、受影响测试
- `DiagnosticsEngine` — 后台诊断缓存
- `ProjectContext` — 主线/非主线语义识别
- `stack-detector` — 技术栈检测和验证命令生成

---

## 项目骨架（自分析结果）

> <!-- generated: 2026-05-05 — 数据由 `node cli.js audit-* --cwd .` 自分析得出，每次结构大幅变化后需重新运行并更新本段。-->
>
> 供开发者快速建立心理模型。

**规模**
- 156 文件，74 主线 + 82 非主线（test/docs）
- 角色：entry=1, library=60, test=80, script=12
- 入口：`cli.js`（CLI 入口）

**架构分层（按依赖方向，从上到下）**

| 层级 | 代表文件 | 职责 |
|------|----------|------|
| L0 基础设施 | `path.js`(20↑), `constants.js`(17↑), `sanitize.js` | 路径工具、常量、脱敏 |
| L1 存储/索引 | `cache.js`, `file-index.js` | SQLite 缓存、文件索引构建 |
| L2 核心引擎 | `dep-graph.js`(9↑) | `DependencyGraph` 类，AST 解析+依赖图+影响计算 |
| L2.5 子引擎 | `parsers/*`, `resolvers.js`, `symbol-impact.js`, `function-impact.js` | 多语言 parser、import 解析、符号级影响 |
| L3 服务组装 | `container.js` | `ServiceContainer` 组装所有服务 |
| L4 工具编排 | `dep-tools.js`, `git-tools.js`, `health-tools.js`, `overview-tools.js` | 对外暴露的分析工具函数 |
| L5 CLI/格式化 | `cli.js`, `formatters/` | 命令分发、JSON 输出聚合 |
| L6 外围 | `scripts/`, `test/`, `benchmark/` | 辅助脚本、全覆盖测试、性能基准 |

**高耦合核心模块与改动风险**

| 文件 | 上游依赖数 | 影响文件数 | 影响测试数 | 备注 |
|------|-----------|-----------|-----------|------|
| 文件 | 影响文件数 | 影响测试数 | 备注 |
|------|-----------|-----------|------|
| `src/utils/path.js` | 57 | 36 | 最底层基础设施，任何路径逻辑变动波及面最大 |
| `src/config/constants.js` | 62 | 38 | 全局常量 |
| `src/services/cache.js` | 28 | 21 | 缓存层，被 file-index / container / diagnostics 等依赖 |
| `src/services/dep-graph.js` | 20 | 15 | 导出 `DependencyGraph` 类，核心引擎 |
| `src/utils/stack-detectors/detect.js` | 13 | 10 | 技术栈检测 |
| `src/config/risk-thresholds.js` | 18 | 9 | 风险评分阈值，被 git-tools / overview-tools / composite-risk 引用 |
| `src/utils/command.js` | 24 | 14 | 验证命令生成 |
| `src/services/dep-graph/parsers/shared.js` | 35 | 25 | parser 共享逻辑 |
| `src/services/container.js` | 8 | 5 | ServiceContainer 生命周期管理 |
| `src/utils/parse-args.js` | 6 | 2 | CLI 参数解析，被 cli.js / repl.js / watch.js 引用 |
| `src/adapters/semgrep.js` | 5 | 2 | Semgrep 安全扫描适配 |

**健康快照**
- 健康度：5/5
- 循环依赖：0
- 死导出：0
- 未解析 import：0
- 孤儿文件：0
- 热区文件：5

**模块边界**
- 0 循环依赖，模块边界干净
- parser 子系统可独立使用（`parsers/index.js` 为第二入口）
- 测试覆盖度极高（71 test vs 53 library），核心改动均有测试兜底
- archive/reference/generated 目录自动排除，混合仓库结果更干净

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
- 修复一个条目后，TECH_DEBT.md 中只保留标题 + 一行 `✅ 已修复` 说明，删除"产品影响"/"修复过程"等冗长段落。
- SESSION.md 中，旧轮次的内容压缩为一句话引用 CHANGELOG，不保留文件列表/改动细节。
- 任何 agent 发现文档膨胀（已修复条目超过 3 行描述）→ 立即清理。

---

## 注意事项

- `dead-exports` 对常见 JS/TS 语法已有基础符号级判断，但不是完整 AST 编译器。
- `audit-diff` 是当前主战场，改动最好优先补它的测试。
- 混合仓库必须用 `.workspace-bridge.json` 标注目录角色，否则孤儿检测严重误报。
- 已知限制与陷阱见 [ROADMAP.md §已知限制](./ROADMAP.md#已知限制当前待处理），已修复历史见 [CHANGELOG.md](./CHANGELOG.md)。
- 技术债状态见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（仅活跃条目）。

---

## 外部工具策略（架构决策）

| 维度 | 策略 | 理由 |
|------|------|------|
| 依赖图 | **自研** | 多语言统一是核心壁垒，pydeps/madge 都是单语言 |
| 增量分析 | **自研** | git diff 驱动 <200ms 是护城河 |
| 风格/质量 | **自研 + Semgrep 可选** | 你管格式（紧凑标签行），Semgrep 管规则库；`npm install` 之外的可选依赖 |
| 精确影响/污点追踪 | **不引入** | 承认打不过，不做重复投入 |
| tree-sitter | **引入（WASM 方案）** | `web-tree-sitter@0.25.3` + `tree-sitter-wasms@0.1.13`；纯 WASM 无 native binding 编译风险；为 Go/Rust/Kotlin/C/C++ 提供统一 AST 能力；失败自动 fallback regex |

---

## Reference 与架构取舍

### Kimi Agent AI认知脚手架

`Kimi_Agent_AI认知脚手架`（外部参考，已移除本地副本）是一套**完整的四层强制脚手架系统**。workspace-bridge 明确不采用这套架构，因为：

| 维度 | Reference | workspace-bridge |
|------|-----------|------------------|
| 架构重量 | 4层完整系统 | 轻量 CLI 工具 |
| 技术栈 | Tree-sitter + RAG + Embedding | @babel/parser + Python ast + javalang + **web-tree-sitter WASM** |
| 强制程度 | 强制审查，不可绕过 | 可选调用，建议性质 |
| 适用场景 | 大型团队规范 | 个人/小团队快速分析 |

**结论：reference 是思想参考，不是代码复用目标。**

### GitNexus

`reference/gitnexus-extract/GitNexus-main/` 是 [GitNexus](https://github.com/abhigyanpatwari/GitNexus)（PolyForm Noncommercial 许可）的本地副本，作为**架构模式参考**，不直接复用代码。

| 维度 | GitNexus | workspace-bridge | 可借鉴程度 |
|------|---------|------------------|-----------|
| 架构重量 | 完整产品（CLI + MCP + Web UI + 持久化图 DB） | 轻量 CLI-only | — |
| 解析器 | Tree-sitter 原生绑定（14 种语言） | babel/ast + javalang + web-tree-sitter WASM（9 种，**全部 AST**） | **高** — 语言注册表配置模式 |
| 图存储 | LadybugDB/KuzuDB 持久化 + Cypher | 内存 Map（每次重建） | **中** — 图 schema 与双索引设计 |
| MCP 层 | 16 tools + resources URI | 无 | **高** — tool schema 与递进工具链 |
| 搜索 | BM25 + 向量 + RRF 混合检索 | 无 | 低 — 与轻量定位冲突 |
| 框架感知 | routes/tools/orm extractors（AST visitor） | 无 | **高** — 框架模式检测的插件化思路 |
| Ingestion | 12 phase DAG | 单阶段 build | **中** — phase 分离指导增量更新设计 |

**值得学习的具体模式：**

1. **语言注册表** — `gitnexus/src/core/ingestion/languages/*.ts`：每种语言一个配置文件，统一实现 `parse(file) -> {ast, symbols, edges}` 接口。未来 workspace-bridge 从硬编码 if-else 链迁移到注册表时可直接参考。
2. **知识图双索引** — `gitnexus/src/core/graph/graph.ts`：`relationshipMap`（按 id）+ `relationshipsByType`（按 type 分桶）+ `edgeIdsByNode`（反向邻接索引）。确保按类型遍历和节点级删除都是 O(touching-edges) 而非 O(total-edges)。
3. **MCP 递进工具链** — `gitnexus/src/mcp/tools.ts`：`list_repos` → `query` → `context` → `impact` 的递进设计，每个 tool 的 description 明确标注 WHEN TO USE / AFTER THIS。未来若重新引入 MCP 层，这是工具命名和描述的黄金标准。
4. **框架感知 Extractor** — `gitnexus/src/core/ingestion/routes.ts`、`orm.ts`：AST visitor 检测 Next.js App Router、Expo、Prisma 等框架模式，生成框架特定的边（HANDLES_ROUTE、QUERIES）。workspace-bridge 当前通过 `isKnownEntryFile()` 的硬编码 regex 做框架识别，未来可演进为配置表驱动的 extractor 注册表。

## Agent 认知边界（决策检查表）

> 以下规则供后续 AI agent 直接按条件执行，无需二次翻译。

### 规则 1：任务类型 → 是否需要深入代码

```
IF 任务属于 [调文案, 改缩进, 换颜色, 改 CLI 参数默认值, 修已有 formatter 字符串模板, 修已有 parser 的 regex]
THEN 现有骨架够用，直接改对应文件即可

IF 任务属于 [改 dep-graph.js 核心算法, 新增语言 parser, 改 ServiceContainer 生命周期, 新增 CLI 命令, 改评分阈值]
THEN 必须先定向深入下方列出的目标文件，不能凭骨架直接动手
```

### 规则 2：定向深入时必须读取的文件

| 任务目标 | 必须先读的文件 | 为什么 |
|----------|---------------|--------|
| 改影响计算 / BFS / DFS | `src/services/dep-graph.js` + `src/services/dep-graph/symbol-impact.js` | 接口签名和 raw data 消费逻辑 |
| 新增语言 parser | `src/services/dep-graph/parsers/registry.js` + `shared.js` + 任意现有 parser | 写 parser → 在 registry.js 注册一行 → 补测试；只需改 1 个文件 |
| 重构语言注册表 | `src/services/dep-graph/parsers/registry-core.js` + `registry.js` | `defineLanguage()` 统一接口，条件/扩展名/pattern 集中配置 |
| 改验证命令生成 | `src/utils/stack-detector.js` + `src/cli/formatters/validation-advice.js` | 技术栈检测 + 命令聚合两条链路 |
| 改容器初始化 | `src/services/container.js` | 初始化顺序：cache → projectContext → fileIndex → diagnostics → depGraph |
| 新增 CLI 命令 | `cli.js` case 分支 + `src/cli/formatters/` + `src/tools/` 对应工具 | 必须同时改路由、formatter、测试 |
| 补测试 | 先读 `test/functionality-test.js`（spawnSync 风格）和 `test/phase01-quality-test.js`（assert 风格） | 测试没有统一 runner，用裸 `assert` + `spawnSync` |
| 提取类方法到新模块 | `grep` 搜索 `this.methodName` 和 `obj.methodName` 的所有调用方 | 类方法可能被外部通过实例引用，直接删除会破坏接口；安全做法：类方法委托给新模块的纯函数 |

### 规则 3：Record Schema（parser 必须返回的结构）

```js
{
  imports: string[],
  exports: string[],
  importRecords: [{ source, resolved, imported, usesAllExports }],
  exportRecords: [{ name, kind, lineStart, lineEnd, fingerprint }],
  functionRecords: [{ name, kind, lineStart, lineEnd, fingerprint }],
  parseMode: 'ast' | 'regex',
}
```

### 规则 4：高危文件修改前必须跑的影响检查

```
IF 修改以下文件之一：
  - src/utils/path.js
  - src/services/dep-graph.js
  - src/services/dep-graph/parsers/shared.js
  - src/services/dep-graph/resolvers.js
THEN 修改前必须跑：
  node cli.js impact --cwd . --file <改动文件> --json --quiet
  node cli.js affected-tests --cwd . --file <改动文件> --json --quiet
THEN 基于输出评估测试覆盖是否足够
```

### 规则 5：收工前 5 检查（30 秒）

1. **运行全量测试** — `node test/runner.js` 必须通过
2. **裸数字检查** — diff 中新增数字是否已关联 `src/config/constants.js`
3. **异常安全检查** — 新增的 shutdown/cleanup/signal handler 是否异常安全
4. **语义同步检查** — 同一业务判断是否在多处内联实现
5. **参数解析检查** — 新 CLI 入口是否用了 `src/utils/parse-args.js`

### 规则 6：平台兼容性假设检查

```
IF 代码中出现 platform === 'win32' 或 platform === 'darwin'
THEN 问自己：这个特性是否可以运行时探测而不是白名单？
  - fs.watch recursive → 创建临时 watcher 探测
  - 命令解析 → 不能假设扩展名（.cmd vs .exe）
  - 路径相等 → 必须经过 normalizePathKey
```

### 规则 7：重复代码检测

```
IF 同一个文件中出现了两段结构相似度 > 70% 的代码
THEN 优先提取为纯函数

常见陷阱：
  - detectX() 和 hasX() 的遍历逻辑几乎相同
  - getXCommands() 和 generateCommands() 中的 X 语言逻辑完全重复
  - 嵌套三元运算符链在同一个文件中重复出现
```

**历史债务状态：** 详见 `docs/TECH_DEBT.md` 与 `SESSION.md §新会话指令`。
- P0（正确性/资源管理）— ✅ 已清零
- P1（结构/可维护性）— ✅ 已清零（含 stack-detector.js 拆分、file-index.js 降行、6 项重复代码消除）
- P2（标准债务）— ✅ **已清零**（2026-05-05）。历史内容：`parsers/js.js` 重复/混杂、`dep-graph.js` 重复/硬编码/过长函数、`overview-tools.js` 裸数字归零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased] §重构。
- P2 唯一暂不处理：`composite-risk.js` 的 `buildCompositeRisk`，等新增第 6 种评分维度时统一重构。
> 注：`stack-detector.js`（835→14）和 `file-index.js`（523→420）拆分已完成；`dep-graph.js`（~704 行）保持不物理拆分，已验证内聚优先决策正确。

---

## 成功标准

见 [ROADMAP.md §成功标准](./ROADMAP.md#成功标准）。

---

继续保持 workspace-bridge 的克制哲学：CLI-only，够用就行，拒绝过度工程。

---

*使用说明见 [README.md](./README.md)；命令契约见 [skills/workspace-audit/SKILL.md](./skills/workspace-audit/SKILL.md)；**本轮会话上下文与已完成事项见 [SESSION.md](./SESSION.md)**；未竟事项见 [ROADMAP.md](./ROADMAP.md)；历史版本见 [CHANGELOG.md](./CHANGELOG.md)；历史技术方案见 [ROADMAP.md](./ROADMAP.md) 和 [CHANGELOG.md](./CHANGELOG.md)。*
*Last updated: 2026-05-07（新增：实战基地路径 `C:\Users\sdses\Desktop\神思\code`）*
