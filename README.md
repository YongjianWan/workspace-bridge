# workspace-bridge

一个用于 AI 编程助手的工作区分析引擎，当前只保留本地 CLI + skill 工作流。

## 功能特性

- **🔍 智能代码索引** - 自动索引 Python/JavaScript/TypeScript 符号，支持模糊搜索
- **🌲 Git 集成** - 查看 diff、blame、提交历史，无需离开编辑器
- **⚡ 实时诊断** - 集成 ruff、pyright、eslint、tsc，提供即时反馈
- **🔗 依赖分析** - 分析 import 关系，计算变更影响范围
- **💾 智能缓存** - 文件变更感知 + 磁盘持久化，热启动 <200ms
- **🛡️ 安全加固** - 参数化命令执行，路径遍历防护
- **📦 技术栈自动检测** - 自动识别项目技术栈并生成具体验证命令
- **🎯 JS/TS AST 解析** - 使用 @babel/parser 提升代码分析精度
- **🧠 融合风险判断** - `compositeRisk` 融合结构影响 + 测试映射 + Git 历史风险
- **📌 可执行风险动作** - `audit-diff` 输出 `topRiskAction` / `topRiskCommand`

## 快速开始

### 安装

```bash
# 克隆仓库
git clone <repository-url>
cd workspace-bridge

# 安装依赖
npm install

# 本地 CLI
node cli.js workspace-info --cwd .
node cli.js health --cwd . --json
node cli.js dead-exports --cwd . --json

# （可选）安装 Python 诊断工具
pip install ruff pyright

# （可选）安装 Node 诊断工具
npm install -g eslint typescript
```

### 验证安装

```bash
# 直接走 CLI
node cli.js health --cwd . --json
```

## CLI 命令

`workspace-bridge-cli` 复用同一套分析核心，但更适合本地 agent + skill 工作流。

| 命令                      | 描述                                             |
| ------------------------- | ------------------------------------------------ |
| `workspace-info`        | 检测工作区根目录和技术栈                         |
| `diagnostics`           | 运行 quick/full 诊断                             |
| `audit-summary`         | 聚合 health + dead exports + unresolved + cycles |
| `audit-file --file`     | 聚合 impact + affected tests                     |
| `audit-diff`            | 聚合当前 git 变更文件 + impact + affected tests  |
| `audit-overview`        | 项目全景视图（热区、稳定性、孤儿检测）           |
| `health`                | 汇总项目健康度                                   |
| `deps`                  | 检查过时依赖                                     |
| `dead-exports`          | 查找死导出候选                                   |
| `unresolved`            | 查找未解析 import                                |
| `cycles`                | 查找循环依赖                                     |
| `impact --file`         | 分析文件影响半径                                 |
| `affected-tests --file` | 分析受影响测试                                   |

示例：

```bash
node cli.js audit-summary --cwd C:\repo --json --quiet
node cli.js audit-summary --cwd C:\repo --exclude prototypes/reference,archive --json --quiet
node cli.js audit-file --cwd C:\repo --file src\app.ts --json --quiet
node cli.js audit-diff --cwd C:\repo --json --quiet
node cli.js audit-overview --cwd C:\repo --json --quiet
node cli.js audit-overview --cwd C:\repo --quiet
node cli.js dead-exports --cwd C:\repo --json
node cli.js impact --cwd C:\repo --file src\app.ts --json
```

聚合命令返回结构化摘要：

- `summary.severity`: `low` / `medium` / `high`
- `summary.counts`: 聚合计数
- `summary.nextSteps`: 下一步建议

默认建议：

1. 先跑 `audit-summary`
2. 如果任务聚焦某个文件，再跑 `audit-file --file ...`
3. 如果任务是基于当前改动做验证，跑 `audit-diff`
4. 只有需要更细信息时才调用原始子命令

对于研究型工作区或多项目仓库，优先使用 `--exclude` 去掉 `reference`、`archive` 之类的目录，否则聚合结果会被非主线代码污染。

也可以在仓库根目录放一个 `.workspace-bridge.json`，把目录角色固化下来，减少每次都传 `--exclude` 的麻烦：

```json
{
  "directories": {
    "reference": ["prototypes/reference", "docs/examples"],
    "archive": ["archive"],
    "generated": ["dist", "coverage"]
  }
}
```

`audit-summary` 会返回：

- `scope.counts.mainlineFiles`
- `scope.counts.nonMainlineFiles`
- `scope.directoryRoles`
- `scope.entryFiles`

这样在 mixed repo 里至少能先看清“主线代码”和“非主线代码”各有多少，再决定要不要信后面的死代码和影响面结果。

`audit-overview` 会返回机器可读聚合：

- `aggregates.hotspotsByRisk`
- `aggregates.stabilityCounts`

`audit-diff` 返回结构化验证计划：

- `validationAdvice.changeType`: 改动类型 (docs/config/tests/scripts/code)
- `validationAdvice.stack`: 检测到的技术栈概况（`python-first` / `node-first` / `mixed`）
- `validationAdvice.commands`: 各阶段可执行命令 (smoke/focused/full)
- `validationAdvice.topRiskActions`: Top 风险文件的可执行动作（含证据与建议命令）
- `validationAdvice.phases`: 分阶段验证建议，包含有序 steps
- `summary.topCompositeRisks`: Top 风险文件摘要（分数/级别/首要原因）

示例输出（结构示意）：

```json
{
  "validationAdvice": {
    "changeType": "code",
    "stack": {
      "profile": "mixed",
      "packageManager": "npm",
      "node": {
        "enabled": true,
        "packageManager": "npm",
        "testRunner": "vitest",
        "linters": ["eslint"],
        "typeChecker": "tsc"
      },
      "python": {
        "enabled": true,
        "packageManager": "pip",
        "testRunner": "pytest",
        "linters": ["ruff"],
        "typeChecker": "pyright",
        "framework": "fastapi"
      },
      "java": {
        "enabled": true,
        "buildTool": "maven",
        "testRunner": "surefire"
      }
    },
    "commands": {
      "smoke": [{ "name": "lint", "cmd": "npx eslint cli.js" }],
      "focused": [{ "name": "run-direct-tests", "cmd": "npm run test:functionality" }],
      "full": [{ "name": "run-all-tests", "cmd": "npm run test" }]
    },
    "phases": [
      { "phase": "smoke", "targets": ["cli.js"] },
      { "phase": "focused", "steps": [{ "name": "run-direct-tests", "targets": ["test/audit-diff-test.js"] }] },
      { "phase": "full", "targets": ["cli.js", "test/audit-diff-test.js"] }
    ]
  }
}
```

此外还返回：

- 当前 git 变更文件列表
- 每个文件的主线/非主线角色
- 每个文件的 impact / affected tests
- 每个文件的 `historyRisk`（提交频率、作者数、最近改动、回滚痕迹）
- 每个文件的 `compositeRisk`（结构 + 测试 + 历史融合评分）
- 每个文件的 `symbolImpact.symbolToDependents`（导出符号到依赖文件映射）
- 聚合后的风险级别

这玩意的目标不是替代 `git diff`，而是把"我这次改了什么，最好先测什么"直接吐给 agent。

真实项目验证后，当前结果最可信的场景包括：

- React/Vite 项目：前端资源导入不会再误报 unresolved
- Django/Python 项目：相对导入可正确解析
- TypeScript ESM 项目：源码中的 `.js` 导入可回映射到 `.ts/.tsx`
- 研究型工作区：可通过 `--exclude` 排除 reference/archive 污染

当前已特别处理的常见噪音来源：

- 前端静态资源导入，如 `.json`、`.css`
- Python 相对导入，如 `from .models import ...`
- TypeScript ESM 源码导入 `.js`，会回映射到 `.ts/.tsx`
- 动态导入 `import('...')`

当前 `dead-exports` 的精度边界：

- 无 importer 的文件：按整文件高置信度报告
- 常见 JS/TS named import/default import/destructured require：按符号级判断，未使用导出会以中置信度报告
- `export *`、namespace import、动态装配、复杂 runtime 间接引用：保守降级，不瞎报

这玩意现在的目标是“明显减少误报”，不是假装自己已经是完整 AST 编译器。

## 架构

```
workspace-bridge CLI
└── ServiceContainer
    ├── WorkspaceCache
    ├── FileIndex
    ├── DiagnosticsEngine
    ├── EditorState
    └── DependencyGraph
        └── ProjectContext / stack-detector / overview-tools
```

### 核心组件

#### ServiceContainer

- 管理所有服务的生命周期
- 提供 `ensureReady()` 门控，确保初始化完成
- 初始化互斥锁防止并发初始化

#### FileIndex

- 统一文件索引（替代原有的 SymbolIndex + ContextEngine）
- 增量更新：文件变更时只重新索引变更文件
- 支持 Python/JS/TS 符号提取

#### DiagnosticsEngine

- 自动检测可用诊断工具
- 缓存诊断结果，避免重复运行
- 文件删除时自动清理缓存
- Windows 下 `npm/npx` 命令兼容（`npm.cmd` + `cmd.exe` shim）
- quick 模式最小兜底检查（避免 `checksRun=0` 空结果）

#### DependencyGraph

- 解析 import/require 语句
- **JS/TS 使用 @babel/parser AST 解析**（精确识别导入导出）
- 构建依赖关系图和影响半径分析
- 检测循环依赖

## 缓存策略

| 数据类型                | 存储位置                               | 失效策略               |
| ----------------------- | -------------------------------------- | ---------------------- |
| Workspace Root          | 内存                                   | 进程生命周期           |
| 文件元数据 (mtime/size) | 内存 Map                               | fs.watch 事件          |
| 符号索引                | 内存 +`.workspace-bridge-cache.json` | 文件变更时增量更新     |
| 诊断结果                | 内存 Map                               | 文件变更时重跑 lint    |
| 依赖图                  | 内存 Map                               | 文件变更时重建受影响边 |

缓存文件 5 分钟 TTL，冷启动 2-4s，热启动 ~200ms。

### 技术栈检测

自动检测项目技术栈并生成具体验证命令：

| 检测项         | 识别文件                                       |
| -------------- | ---------------------------------------------- |
| profile        | package.json + requirements.txt / pyproject.toml / manage.py |
| packageManager | pnpm-lock.yaml / yarn.lock / package-lock.json / Python markers |
| testRunner     | jest.config.* / vitest.config.* / pytest.ini   |
| linters        | .eslintrc.* / .prettierrc.* / pyproject.toml   |
| typeChecker    | tsconfig.json / pyright                        |
| javaBuildTool  | pom.xml / build.gradle / build.gradle.kts      |

检测到的技术栈会用于生成 `audit-diff` 中的具体验证命令。

## 安全说明

### 已修复的安全问题

| 问题     | 修复措施                                              |
| -------- | ----------------------------------------------------- |
| 命令注入 | 所有外部命令使用 `spawn` + 参数数组，禁止字符串拼接 |
| 路径遍历 | 强制校验路径在工作区内 (`validateWorkspacePath`)    |
| 参数污染 | Git 日期/作者参数白名单校验                           |

### 安全边界

- ✅ 所有用户输入路径经过校验
- ✅ 所有命令执行使用参数化接口
- ✅ 输出长度限制（防止内存耗尽）
- ⚠️ 诊断工具（ruff/eslint）仍访问文件系统，需确保工作区可信

## 开发指南

### 项目结构

```
workspace-bridge/
├── cli.js                 # 本地 CLI 入口（推荐给 skill 调用）
├── skills/
│   └── workspace-audit/   # CLI 使用说明
├── src/
│   ├── services/          # 核心服务
│   │   ├── container.js   # 服务容器
│   │   ├── cache.js       # 缓存管理
│   │   ├── file-index.js  # 文件索引
│   │   ├── diagnostics-engine.js
│   │   ├── dep-graph.js
│   │   ├── dep-graph/      # dep-graph 子模块
│   │   │   ├── parsers.js
│   │   │   ├── resolvers.js
│   │   │   └── symbol-impact.js
│   │   └── editor-state.js
│   ├── tools/             # 工具实现
│   │   ├── git-tools.js
│   │   ├── overview-tools.js
│   │   ├── search-tools.js
│   │   ├── workspace-tools.js
│   │   └── health-tools.js
│   ├── scripts/
│   │   └── python_ast_parser.py
│   └── utils/             # 工具函数
│       ├── command.js     # 安全命令执行
│       ├── path.js        # 路径处理
│       ├── diagnostics.js # 诊断解析
│       ├── project-context.js
│       ├── stack-detector.js
│       └── sanitize.js    # 输入消毒
```

### 调试

```bash
# 查看详细日志
DEBUG=1 node cli.js audit-summary --cwd . --json
```

### 性能基准（500+ 文件）

```bash
npm run benchmark:perf
```

- 生成 500+ 文件的 synthetic tree（含 `src/test/api/docs/examples/prototypes`）
- 分别测 `audit-summary` / `audit-diff` 的 cold/hot/incremental
- 输出 `benchmark/results/latest.json`
- 默认门槛：`cold.audit-summary` 和 `cold.audit-diff` 都要 `<= 30000ms`

更多参数见 [benchmark/README.md](benchmark/README.md)。

## 已知限制

1. **VS Code 集成仅限 Windows** - EditorState 目前只读取 Windows 的 `%APPDATA%/Code/User/workspaceStorage`
2. **大仓库性能** - 虽然索引已改为异步并发，但超大仓库首次扫描仍可能较慢
3. **初始化忙等待** - `ensureReady()` 轮询等待，无上界超时
4. **混合仓库误判** - 未配置 `.workspace-bridge.json` 时，复杂 mixed repo 仍可能需要 `--exclude`
5. **技术栈检测局限** - mixed repo 现在能分层输出 Node / Python 命令，但仍是启发式生成
6. **光标位置** - 无法获取 VS Code 的光标位置和选中文本（需扩展支持）

### 边界测试发现的已知问题

| 问题                            | 触发条件                      | 影响                                       | 状态      |
| ------------------------------- | ----------------------------- | ------------------------------------------ | --------- |
| **mixed repo 命令启发式** | Node/Python 共存 / 自定义脚本 | `validationAdvice.commands` 可能不够精确 | 🟡 Medium |
| **非 ASCII 路径回归风险** | 中文/Unicode 模块路径         | 当前最小用例正常，但需持续回归验证         | 🟢 Watch  |
| **缓存不一致**            | 并发访问或快速重启            | 可能读到过期缓存                           | 🟡 Medium |
| **超长路径**              | >260 字符（Windows MAX_PATH） | 文件无法创建或读取                         | 🟢 Low    |

**说明**：

- `impact` / `affected-tests` 当前主线版本已可工作，不再属于已知阻塞问题
- 真正还需要继续补的是 mixed repo 命令精度和非 ASCII 路径的持续回归测试

## 生产使用建议

### 适用场景

| 项目规模               | 推荐度      | 注意事项                                     |
| ---------------------- | ----------- | -------------------------------------------- |
| 小型（<100文件）       | ✅ 推荐     | 直接使用                                     |
| 中型（100-500文件）    | ✅ 可用     | 使用 `--exclude` 过滤参考目录              |
| 大型（>500文件）       | ⚠️ 谨慎   | 首次索引较慢，建议定期清理缓存               |
| 混合仓库（含参考代码） | ⚠️ 需配置 | 创建 `.workspace-bridge.json` 标注目录角色 |

### 推荐配置

混合仓库示例 `.workspace-bridge.json`：

```json
{
  "directories": {
    "reference": ["prototypes", "reference", "examples"],
    "archive": ["archive", "legacy"],
    "generated": ["dist", "build", ".next"]
  }
}
```

### 已知误报处理

**孤儿文件误报** - 以下情况会产生假孤儿：

- 入口文件（如 `manage.py`、`vite.config.ts`）未被识别
- 框架管理的文件（Django admin.py、signals.py 等）
- 参考/示例目录中的文件

处理：检查 `orphans.samples.modules`，如为假阳性可忽略

## 路线图

- [X] CLI-first 聚合审计：`audit-summary` / `audit-file` / `audit-diff` / `audit-overview`
- [X] 主线/非主线语义识别：`.workspace-bridge.json` + 目录角色
- [X] `dead-exports` 基础符号级判断（JS/TS 常见 import/export 语法）
- [X] Git 风险层（文件级 historyRisk）
- [ ] 更深的 AST / symbol-level impact
- [ ] mixed repo 技术栈检测与验证命令继续打磨

## 许可证

MIT
