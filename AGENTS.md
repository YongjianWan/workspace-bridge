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

## 工程品味（TASTE）

> 以下铁律直接指导代码层面的决策。
>
> **优先级：好品味 > 形式指标。** 500 行、30 行、3 个词是辅助判断的标尺，不是目标本身。如果为了凑行数而把逻辑拆碎、为了省行数而引入晦涩、为了拆文件而破坏内聚，都是坏品味。先问"边界情况能不能消失"，再问"够不够短"。

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
| 文件 < 500 行 | 超过 500 行**考虑**拆分（内聚优先；不要为了拆而拆） |
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

## 开发原则

1. **CLI-only** — 不引入 MCP/协议层
2. **先减少误报，再加功能** — 结果可信优先
3. **先识别主线，再做判断** — 混合仓库先过滤
4. **输出必须指导动作** — 不是报告，是行动计划
5. **保守判断** — `dead-exports`、`historyRisk`、测试映射这些东西，一旦不确定就降级，不要自信胡说。
6. **工程克制** — 函数 < 30 行，拒绝过度抽象

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

## 项目骨架（自分析结果）

> 以下数据由 `node cli.js audit-* --cwd .` 自分析得出，供开发者快速建立心理模型。

**规模**
- 70 文件，69 主代码 + 1 参考
- 角色：entry=2, library=27, test=30, script=11
- 入口：`cli.js`（CLI 入口）、`src/services/dep-graph/parsers/index.js`（parser 独立入口）

**架构分层（按依赖方向，从上到下）**

| 层级 | 代表文件 | 职责 |
|------|----------|------|
| L0 基础设施 | `path.js`(14↑), `constants.js`(4↑), `sanitize.js` | 路径工具、常量、脱敏 |
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
| `src/utils/path.js` | 14 | 32 | 17 | 最底层基础设施，任何路径逻辑变动波及面最大 |
| `src/services/dep-graph.js` | 9 | 11 | 8 | 导出 `DependencyGraph` 类，核心引擎 |
| `src/utils/command.js` | 5 | — | — | 验证命令生成 |
| `src/utils/stack-detector.js` | 5 | — | — | 技术栈检测 |
| `src/services/dep-graph/parsers/shared.js` | 5 | — | — | parser 共享逻辑 |
| `src/config/constants.js` | 4 | — | — | 全局常量 |

**健康快照**
- 健康度：5/5
- 循环依赖：0
- 死导出：0
- 孤儿文件：7 个（见 `audit-overview` 输出）

**模块边界**
- 0 循环依赖，模块边界干净
- parser 子系统可独立使用（`parsers/index.js` 为第二入口）
- 测试覆盖度极高（30 test vs 27 library），核心改动均有测试兜底

---



## 当前重点

现在最值钱的开发方向（按优先级）：

1. **把历史风险和结构影响融合得更像工程判断** — 变更类型判断（docs/config/tests/code）必须先准，否则验证建议会错配。
2. **大仓库性能专项优化** — >10k 文件索引速度（mixed repo 命令精度已达标：smoke/focused 按栈隔离，full 保留全栈回归）

不优先的东西：

- 重新引入 MCP
- 花很大力气做协议/适配层
- 为了形式重写已经稳定的服务层
- Kotlin/Go/Rust AST 深度（L2 regex 已满足 80% 需求，真实场景待验证）

---

### 最近完成

详见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 注意事项

- `dead-exports` 对常见 JS/TS 语法已有基础符号级判断，但不是完整 AST 编译器。
- `audit-diff` 是当前主战场，改动最好优先补它的测试。
- 混合仓库必须用 `.workspace-bridge.json` 标注目录角色，否则孤儿检测严重误报。
- **Windows `spawnSync('npm')` 陷阱** — Node.js 20+ 在 Windows 上禁止直接 spawn `.cmd`/`.bat` 文件，`spawnSync('npm')` 返回 ENOENT，`spawnSync('npm.cmd')` 返回 EINVAL。必须设置 `shell: process.platform === 'win32'` 或使用 `cmd /c`。
- 技术债状态、已知限制和详细问题清单见 `docs/TECH_DEBT.md` 与 [ROADMAP.md](./ROADMAP.md)。

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
| 新增语言 parser | `src/services/dep-graph/parsers/shared.js` + 任意现有 parser（js.py/java.py） | 必须返回兼容的 `{imports, exports, importRecords, exportRecords, functionRecords, parseMode}` |
| 改验证命令生成 | `src/utils/stack-detector.js` + `src/cli/formatters/validation-advice.js` | 技术栈检测 + 命令聚合两条链路 |
| 改容器初始化 | `src/services/container.js` | 初始化顺序：cache → projectContext → fileIndex → diagnostics → depGraph |
| 新增 CLI 命令 | `cli.js` case 分支 + `src/cli/formatters/` + `src/tools/` 对应工具 | 必须同时改路由、formatter、测试 |
| 补测试 | 先读 `test/functionality-test.js`（spawnSync 风格）和 `test/phase01-quality-test.js`（assert 风格） | 测试没有统一 runner，用裸 `assert` + `spawnSync` |
| 提取类方法到新模块 | `grep` 搜索 `this.methodName` 和 `obj.methodName` 的所有调用方 | 类方法可能被外部通过实例引用，直接删除会破坏接口；安全做法：类方法委托给新模块的纯函数 |

### 规则 3：Record Schema（parser 必须返回的结构）

```js
// 每个 parser 返回的对象必须包含以下字段
{
  imports: string[],           // import source 路径列表（去重）
  exports: string[],           // 导出符号名列表（去重）
  importRecords: [{            // 结构化 import（下游 resolver + symbol-impact 消费）
    source: string,            // import 来源路径（原始字符串）
    resolved: string,          // 解析后的绝对路径（resolver 填充）
    imported: string[],        // 具体导入的符号名
    usesAllExports: boolean,   // 是否 import * / namespace import
  }],
  exportRecords: [{           // 结构化 export（dead-export + symbol-impact 消费）
    name: string,
    kind: 'function' | 'class' | 'variable' | 'symbol',
    lineStart?: number,
    lineEnd?: number,
    fingerprint?: { callCallees: string[], hasTryCatch: boolean, branchCount: number, returnCount: number },
  }],
  functionRecords: [{         // 函数级调用链追踪（P0T5 + function-impact 消费）
    name: string,
    kind: 'function',
    lineStart: number,
    lineEnd: number,
    fingerprint: { callCallees: string[], ... },
  }],
  parseMode: 'ast' | 'regex',  // 下游据此决定是否做 symbol-level 分析
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

### 规则 5：防债检查表（入库前 30 秒）

> 技术债最便宜的还款时机是代码入库前。

**新增代码必须过这三条：**

1. **裸数字检查** — diff 中出现的新裸数字（非 `0`/`1`、非明显的时间戳/字节计算）必须关联到 `src/config/constants.js` `DEFAULTS`
2. **函数长度检查** — 新增函数超过 30 行必须在 commit/PR 中写一句"为什么拆不开"
3. **封装边界检查** — 禁止直接操作其他模块的内部 `Map`/`Set`（如 `.symbolIndex.delete()`），必须通过公共接口

**新增脚本必须过这一条：**

4. **参数解析统一** — 任何新 CLI 入口或脚本必须使用 `src/utils/parse-args.js`，禁止手写 `for (let i = 2; ...)` 循环

**重构代码必须过这一条：**

5. **配置表化前判断互斥性** — 把 `if-else if` 链重构为规则表时，必须区分：
   - 累加条件（独立 `if`）→ 独立规则，逐项匹配
   - 互斥条件（`if-else if`）→ `first-match` 模式，匹配一项即跳出
   - 混合场景（如 `computeHistoryRisk`）→ 分组：`组内 first-match，组间累加`

**历史债务状态：** 详见 `docs/TECH_DEBT.md`。当前 P0/P1/P2 核心债务已清零；P2 唯一剩余 `composite-risk.js` 的 `buildCompositeRisk`，等新增第 6 种评分维度时统一重构。

---

## 成功标准

1. 对混合仓库结果稳定（不误报）
2. TS/Python/前端项目都能给出可信主线结论
3. 能从"哪里可能有问题"推进到"该怎么改、改完测什么"
4. symbol-level impact 可用
5. 大仓库性能可接受（<30s 索引）

---

继续保持 workspace-bridge 的克制哲学：CLI-only，够用就行，拒绝过度工程。

---

*使用说明见 [README.md](./README.md)；命令契约见 [skills/workspace-audit/SKILL.md](./skills/workspace-audit/SKILL.md)；**本轮会话上下文与已完成事项见 [SESSION.md](./SESSION.md)**；未竟事项见 [ROADMAP.md](./ROADMAP.md)；历史版本见 [CHANGELOG.md](./CHANGELOG.md)；历史技术方案见 [docs/plans/](./docs/plans/)。*
*Last updated: 2026-05-01（TECH_DEBT 清零行动：6 项配置表化重构 + Windows spawn 修复后同步）*
