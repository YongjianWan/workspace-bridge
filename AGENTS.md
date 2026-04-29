# workspace-bridge - Agent Guide

> CLI-first 工作区分析引擎，给本地 AI coding agent 补"跨文件视角"和"变更验证建议"。
>
> 当前方向：只保留本地 CLI + skill，不再维护 MCP 协议层。
>
> **本文档是项目状态的单一事实源。** 功能状态、版本能力、下一步方向以本文档为准。

---

## 项目概述

workspace-bridge 的核心价值很直接：

- 跨文件结构化分析
- 变更影响范围
- 测试建议
- Git 历史风险提示

不要把它做成 another shell wrapper。客户端自己已经有 Read/Grep/Bash，workspace-bridge 该做的是这些工具做不到的聚合判断。

---

## 当前能力

### 核心命令

- `audit-summary`
  - 聚合 `health + dead-exports + unresolved + cycles`
  - 适合第一次看仓库
- `audit-file --file`
  - 聚合单文件的 `impact + affected-tests`
  - 适合改某一个文件前后看影响
- `audit-diff`
  - 聚合当前 git worktree 改动
  - 输出 changed files、impact、affected tests、historyRisk、验证建议
- `audit-overview`
  - 输出项目热区、稳定性、孤儿文件、核心模块
  - 适合第一次接手一个仓库时快速看骨架

### 关键服务

- `ServiceContainer` — 生命周期管理和初始化门控
- `FileIndex` — 索引文件、维护缓存
- `DependencyGraph` — 依赖图、影响面、死导出、受影响测试
- `DiagnosticsEngine` — 后台诊断缓存
- `ProjectContext` — 主线/非主线语义识别
- `stack-detector` — 技术栈检测和验证命令生成

---

## 开发原则

1. **CLI-only** — 不引入 MCP/协议层
2. **先减少误报，再加功能** — 结果可信优先
3. **先识别主线，再做判断** — 混合仓库先过滤
4. **输出必须指导动作** — 不是报告，是行动计划
5. **保守判断** — `dead-exports`、`historyRisk`、测试映射这些东西，一旦不确定就降级，不要自信胡说。
6. **工程克制** — 函数 < 30 行，拒绝过度抽象

---

## 工程品味（TASTE）

> 以下铁律直接指导代码层面的决策。

### Linus 哲学四原则

- **好品味**：消除边界情况永远优于增加条件判断。重写问题让特殊情况消失成正常情况。
- **Never break userspace**：向后兼容性神圣不可侵犯，任何导致现有程序崩溃的改动都是 bug。
- **实用主义**：解决实际问题，拒绝过度工程化。代码为现实服务，不是为论文服务。
- **简洁执念**：函数短小精悍只做一件事。**缩进层数本身不重要**——如果需要那么多层，说明问题本身就这么复杂，关键是理解它。尽量拆，但不要为了形式牺牲正确性。

### 代码风格铁律

| 铁律 | 执行标准 |
|------|----------|
| 边界消除 > if | 让边界情况消失，而不是用 if 堆出来 |
| 命名 < 3 词 | 口语化，避免教科书式命名 |
| 函数 < 30 行 | 只做一件事 |
| 文件 < 500 行 | 超过 500 行必须拆分，否则 AI 无法完整读取上下文 |
| 注释写"为什么" | 不写"做什么"（代码自己会说），写"为什么这么设计"和"边界假设" |
| 错误暴露不吞 | 让错误暴露出来，别到处 try-catch；只在真正可能出错的地方加防御 |
| 删除 > 添加 | 无当前用途的抽象 → 删 |
| 内部互相信任 | 不到处检查参数 |

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

## 当前重点

现在最值钱的开发方向（按优先级）：

1. **修复基础可信度（Phase 0）** — ✅ 已完成：临时文件过滤、文件角色分类、自定义测试脚本识别、内部函数→测试映射、CJS 符号解析。
2. **做更好的 test mapping** — ✅ P0T5 已完成：diff 场景下内部函数改动通过调用链追溯映射到导出函数，再映射 dependents。
3. **做 symbol-level impact** — ✅ CJS `module.exports = { fn }` 已支持，P1 使用点扫描已消除 Java/Go/Rust 符号级 dead-export 系统性误报。
4. **全局项目地图（P1.5）** — ✅ `audit-map` 已输出 tree + edges + issueOverlay，给 AI 全局视野。
5. **把历史风险和结构影响融合得更像工程判断** — 变更类型判断（docs/config/tests/code）必须先准，否则验证建议会错配。
6. **继续打磨 mixed repo 的技术栈检测**

不优先的东西：

- 重新引入 MCP
- 花很大力气做协议/适配层
- 为了形式重写已经稳定的服务层
- Kotlin/Go/Rust AST 深度（L2 regex 已满足 80% 需求，真实场景待验证）

---

### 最近完成

#### 技术栈检测与具体命令建议
- `audit-diff` 现在会返回 `validationAdvice.stack` 和 `validationAdvice.commands`
- 自动检测 packageManager、testRunner、linters、typeChecker
- 生成可直接粘贴执行的验证命令（smoke/focused/full 各阶段）
- 区分 docs/config/tests/scripts/code 五种类型的验证模板

#### JS/TS AST 解析
- 集成 @babel/parser 进行精确的 JS/TS 代码解析
- 正确识别 type import、re-export、动态导入
- 忽略注释和字符串中的伪 import（相比 regex 大幅降低误报）
- 失败自动回退到 regex 解析

#### Python AST 支持 (P4)
- 创建 `scripts/python_ast_parser.py`，使用 Python 标准库 `ast` 模块
- 支持 `import/from...import/__all__` 解析
- Node 子进程通信，失败自动回退 regex

#### Java AST 支持 (P4-A)
- 创建 `scripts/java_ast_parser.py`，使用 `javalang` 进行 AST 级解析
- 提取类名、public 方法、public 字段、接口方法，精确度从 regex 提升到 AST
- Node 子进程通信，javalang 不可用时自动回退 regex，用户无感知
- 多模块 Maven/Gradle 项目 source root 自动发现
- 修复 static import 带前缀导致 resolver 失败、接口方法未提取等 bug

#### Kotlin/Go/Rust L2 支持 (P4-B)
- 文件索引扩展：`.kt/.go/.rs` 纳入索引和符号提取
- Regex 级解析器：`parseKotlin/Go/Rust()` 提取 import/export
- 技术栈检测：自动识别 Go (go.mod) / Rust (Cargo.toml)
- 验证命令生成：`go build/test`、`cargo check/test`
- 路径解析：Go 同目录相对 import 支持

#### P0T5: 内部函数改动→测试映射
- `parsers.js` 新增 `functionRecords`：收集所有 `FunctionDeclaration`/`FunctionExpression` 的 line range 与 `callCallees`
- `function-impact.js` `getChangedFunctionImpact()` 增加 DFS 调用链追溯：内部函数 → 导出调用者 → `changedFunctions`
- `cli.js` 识别 `internal-function-call-chain` mode，触发 `functionLevelAffectedTests` 生成
- 验收达成：改 `resolvers.js` 中 `readGoMod` 时，`functionLevelAffectedTests` 包含 `test/gors-resolver-test.js`

#### P1.5: `audit-map` 全局项目地图
- `src/cli/audit-formatters.js` `buildProjectMap()` 聚合 tree + edges + issueOverlay
- `cli.js` 新增 `audit-map` 命令
- Tree：目录聚合树（`directory`/`file` 节点），标注 role（entry/library/test/config/script）
- Edges：65 条 import/export 关系序列化，含 re-export 边与 symbols
- IssueOverlay：3 deadExports（带 confidence）/ 0 unresolved / 0 cycles / 9 orphans / 4 hotspots
- 验收：`node cli.js audit-map --cwd . --json --quiet` 输出结构化全局地图

#### P3: CJS 符号解析补全
- `parsers.js` 识别 `module.exports = { fn }` 和 `exports.fn = ...` 结构
- `symbol-impact.js` `buildFunctionToDependents` 同时参考 `functionRecords`，CJS 文件的 symbol-level impact 可用

#### P1: 语言级使用点解析
- `dep-graph.js` 新增 `_scanSymbolUsageInImporters()`：轻量 regex 扫描 importer 文件中的方法调用（`\bSymbol\s*\(`）和字段访问（`\.Symbol\b`）
- 补充 importRecords 未 capture 的使用：Java 实例调用 `foo.bar()`、Go `pkg.Func()`、JS 默认导入属性访问等
- 消除符号级 dead-export 系统性误报，Java AST 文件不再需要保守跳过
- 验收：`java-dead-export-test.js` 验证 `f.bar()` 被识别后 `bar` 不再被报为 dead-export

#### M5: 项目全景视图
- 新增 `audit-overview` 命令
- 热区图：基于 Git 历史和依赖耦合度识别高风险文件
- 稳定性评分：综合测试覆盖、改动频率、循环依赖
- 孤儿检测：发现可能未使用的文件
- 核心模块识别：基于依赖中心性找出关键文件

---

## 注意事项

- `EditorState` 还在，但价值一般，后续可能继续降权甚至删掉。
- `dead-exports` 现在对常见 JS/TS 语法已有基础符号级判断，但不是完整 AST 编译器。
- `audit-diff` 是当前主战场，改动最好优先补它的测试。
- **临时文件过滤（P0T1）** — `git-tools.js` `getChangedFiles()` 已过滤 `.tmp-*` 和 `cache.tmp-*`，但工作区中残留的临时文件仍建议清理。
- **自定义测试脚本识别（P0T3）** — `stack-detector.js` 已扫描 `package.json` 中 `test` / `test:*` 前缀脚本（排除 `pretest`/`posttest`），`health.testConfig` 和 focused 命令已可用。
- **文件角色分类（P0T2）** — `project-context.js` 已新增 `docs` 角色（`.md/.txt/.rst` + LICENSE/CHANGELOG/CONTRIBUTING），`audit-diff` 中文档改动输出 `changeType: docs`。
- **entry 与 orphan 冲突（P0T2）** — `dep-graph.js` `_collectEntryFiles()` 已路径规范化，`cli.js` 等入口文件不再同时出现在 `orphans.modules` 中。
- 混合仓库必须用 `.workspace-bridge.json` 标注目录角色，否则孤儿检测严重误报。
- 已知完整限制列表见 [ROADMAP.md](./ROADMAP.md)。

---

## Reference 与架构取舍

`reference/Kimi_Agent_AI认知脚手架/` 是一套**完整的四层强制脚手架系统**。workspace-bridge 明确不采用这套架构，因为：

| 维度 | Reference | workspace-bridge |
|------|-----------|------------------|
| 架构重量 | 4层完整系统 | 轻量 CLI 工具 |
| 技术栈 | Tree-sitter + RAG + Embedding | @babel/parser + 轻量 AST |
| 强制程度 | 强制审查，不可绕过 | 可选调用，建议性质 |
| 适用场景 | 大型团队规范 | 个人/小团队快速分析 |

**结论：reference 是思想参考，不是代码复用目标。**

## 成功标准

1. 对混合仓库结果稳定（不误报）
2. TS/Python/前端项目都能给出可信主线结论
3. 能从"哪里可能有问题"推进到"该怎么改、改完测什么"
4. symbol-level impact 可用
5. 大仓库性能可接受（<30s 索引）

---

继续保持 workspace-bridge 的克制哲学：CLI-only，够用就行，拒绝过度工程。

---

*使用说明见 [README.md](./README.md)；命令契约见 [skills/workspace-audit/SKILL.md](./skills/workspace-audit/SKILL.md)；未竟事项见 [ROADMAP.md](./ROADMAP.md)；历史版本见 [CHANGELOG.md](./CHANGELOG.md)；历史技术方案见 [docs/plans/](./docs/plans/)。*
*Last updated: 2026-04-29*
