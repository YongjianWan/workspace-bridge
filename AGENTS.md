# workspace-bridge - Agent Guide

> CLI-first 工作区分析引擎，给本地 AI coding agent 补"跨文件视角"和"变更验证建议"。
>
> 当前方向：只保留本地 CLI + skill，不再维护 MCP 协议层。

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

- `ServiceContainer`
  - 生命周期管理和初始化门控
- `FileIndex`
  - 索引文件、维护缓存
- `DependencyGraph`
  - 依赖图、影响面、死导出、受影响测试
- `DiagnosticsEngine`
  - 后台诊断缓存
- `ProjectContext`
  - 主线/非主线语义识别
- `stack-detector`
  - 技术栈检测和验证命令生成

---

## 项目结构

```text
workspace-bridge/
├── cli.js
├── skills/
│   └── workspace-audit/
├── src/
│   ├── services/
│   │   ├── cache.js
│   │   ├── container.js
│   │   ├── dep-graph.js
│   │   ├── diagnostics-engine.js
│   │   ├── editor-state.js
│   │   └── file-index.js
│   ├── tools/
│   │   ├── dep-tools.js
│   │   ├── git-tools.js
│   │   ├── health-tools.js
│   │   ├── overview-tools.js
│   │   ├── search-tools.js
│   │   └── workspace-tools.js
├── scripts/
│   └── python_ast_parser.py
│   └── utils/
│       ├── command.js
│       ├── diagnostics.js
│       ├── logger.js
│       ├── path.js
│       ├── project-context.js
│       ├── stack-detector.js      # 技术栈检测与命令生成
│       └── sanitize.js
└── test/
    ├── analysis-test.js
    ├── audit-diff-test.js
    ├── functionality-test.js
    ├── role-detection-test.js
    └── security-test.js
```

---

## 运行和测试

### 常用命令

```bash
npm install
node cli.js audit-summary --cwd . --json --quiet
node cli.js audit-file --cwd . --file src/services/container.js --json --quiet
node cli.js audit-diff --cwd . --json --quiet
```

### 测试

```bash
npm test
npm run test:functionality
npm run test:analysis
npm run test:audit-diff
npm run test:roles
npm run test:all
```

---

## 开发原则

1. CLI-only
   新能力只进 CLI，不要重新引入协议层。

2. 先减少误报，再加功能
   结果不可信，功能越多越吵。

3. 输出必须指导动作
   最终目标不是"报告更多"，而是"告诉 agent 下一步该测什么、先看什么"。

4. 保守判断
   `dead-exports`、`historyRisk`、测试映射这些东西，一旦不确定就降级，不要自信胡说。

---

## 当前重点

现在最值钱的开发方向：

- 做更好的 test mapping
- 做 symbol-level impact
- 把历史风险和结构影响融合得更像工程判断
- 继续打磨 mixed repo 的技术栈检测

不优先的东西：

- 重新引入 MCP
- 花很大力气做协议/适配层
- 为了形式重写已经稳定的服务层

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
- 提取类名、public 方法、public 字段，精确度从 regex 提升到 AST
- Node 子进程通信，javalang 不可用时自动回退 regex，用户无感知
- 多模块 Maven/Gradle 项目 source root 自动发现

#### Kotlin/Go/Rust L2 支持 (P4-B)
- 文件索引扩展：`.kt/.go/.rs` 纳入索引和符号提取
- Regex 级解析器：`parseKotlin/Go/Rust()` 提取 import/export
- 技术栈检测：自动识别 Go (go.mod) / Rust (Cargo.toml)
- 验证命令生成：`go build/test`、`cargo check/test`
- 路径解析：Go 同目录相对 import 支持

#### M5: 项目全景视图
- 新增 `audit-overview` 命令
- 热区图：基于 Git 历史和依赖耦合度识别高风险文件
- 稳定性评分：综合测试覆盖、改动频率、循环依赖
- 孤儿检测：发现可能未使用的文件
- 核心模块识别：基于依赖中心性找出关键文件

---

## 真实项目验证结果

| 项目 | 类型 | 规模 | 关键发现 |
|------|------|------|----------|
| kimi-agent-evolution | 混合 | 384文件 | 128 dead exports，prototypes/ 需 exclude |
| my-factory-system | Django | 50文件 | 2 核心模块 (models.py)，38 孤儿模块待审查 |
| pm-growth-graph | 前端 | 12文件 | 小型项目，热区检测准确 |

**教训**：混合仓库必须用 `.workspace-bridge.json` 标注目录角色，否则孤儿检测严重误报。

---

## 注意事项

- `EditorState` 还在，但价值一般，后续可能继续降权甚至删掉。
- `dead-exports` 现在对常见 JS/TS 语法已有基础符号级判断，但不是完整 AST 编译器。
- `audit-diff` 是当前主战场，改动最好优先补它的测试。

---

## Reference 与架构取舍

`reference/Kimi_Agent_AI认知脚手架/` 是一套**完整的四层强制脚手架系统**，包含：
- Layer 1: 全局符号地图（全局索引 + RAG）
- Layer 2: 复用审查闸（AST 相似度 > 0.85 强制复用）
- Layer 3: 影响预测引擎（PageRank + 风险分级）
- Layer 4: 强制 CLI 入口（不可绕过）

### 为什么没采用

**与 workspace-bridge 的定位冲突**：
| 维度 | Reference | workspace-bridge |
|------|-----------|------------------|
| 架构重量 | 4层完整系统 | 轻量 CLI 工具 |
| 技术栈 | Tree-sitter + RAG + Embedding | @babel/parser + 轻量 AST |
| 强制程度 | 强制审查，不可绕过 | 可选调用，建议性质 |
| 适用场景 | 大型团队规范 | 个人/小团队快速分析 |

**工程克制**：
- reference 的嵌入向量、RAG 检索、强制证明文档 → **过度工程**
- workspace-bridge 当前 AST 解析 + 依赖图分析 → **够用就好**

### 可能的借鉴点

**值得吸收的**（保持克制地借鉴）：
1. **AST 相似度算法** - 用于检测相似函数（非强制，仅提示）
2. **PageRank 中心性** - 用于核心模块识别（已部分实现）
3. **CHANGE_PROOF.md 模板** - 用于 `audit-diff` 报告增强

**明确不做的**：
- 嵌入向量相似度（太重）
- 强制复用闸（违背 CLI 工具定位）
- 四层完整架构（过度设计）

### 结论

**reference 是思想参考，不是代码复用目标。**

继续保持 workspace-bridge 的克制哲学：
- CLI-only，不做强制脚手架
- 够用就行，拒绝过度工程
- 代码简短，函数 < 30 行

*Last updated: 2026-04-01*
