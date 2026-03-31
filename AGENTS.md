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
│   │   ├── search-tools.js
│   │   └── workspace-tools.js
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

- 强化 `audit-diff` 的验证建议层
- 做更好的 test mapping
- 做 symbol-level impact
- 把历史风险和结构影响融合得更像工程判断

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

---

## 注意事项

- `EditorState` 还在，但价值一般，后续可能继续降权甚至删掉。
- `dead-exports` 现在对常见 JS/TS 语法已有基础符号级判断，但不是完整 AST 编译器。
- `audit-diff` 是当前主战场，改动最好优先补它的测试。

---

*Last updated: 2026-03-31*
