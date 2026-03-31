# workspace-bridge

一个用于 AI 编程助手的工作区分析引擎，当前同时支持 MCP server 和本地 CLI 两种入口。

## 功能特性

- **🔍 智能代码索引** - 自动索引 Python/JavaScript/TypeScript 符号，支持模糊搜索
- **🌲 Git 集成** - 查看 diff、blame、提交历史，无需离开编辑器
- **⚡ 实时诊断** - 集成 ruff、pyright、eslint、tsc，提供即时反馈
- **🔗 依赖分析** - 分析 import 关系，计算变更影响范围
- **💾 智能缓存** - 文件变更感知 + 磁盘持久化，热启动 <200ms
- **🛡️ 安全加固** - 参数化命令执行，路径遍历防护

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

### 配置 MCP 客户端

如果需要跨客户端标准接入，继续使用 MCP。

在 Kimi Code 或其他 MCP 客户端配置文件中添加：

```json
{
  "mcpServers": {
    "workspace-bridge": {
      "command": "node",
      "args": ["C:\\Users\\sdses\\.kimi\\mcp-runtime\\workspace-bridge\\server.js"],
      "env": {
        "WORKSPACE_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

### 验证安装

```bash
# 启动服务器并测试
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | node server.js

# 或直接走 CLI
node cli.js health --cwd . --json
```

## CLI 命令

`workspace-bridge-cli` 复用同一套分析核心，但更适合本地 agent + skill 工作流。

| 命令 | 描述 |
|------|------|
| `workspace-info` | 检测工作区根目录和技术栈 |
| `diagnostics` | 运行 quick/full 诊断 |
| `audit-summary` | 聚合 health + dead exports + unresolved + cycles |
| `audit-file --file` | 聚合 impact + affected tests |
| `health` | 汇总项目健康度 |
| `deps` | 检查过时依赖 |
| `dead-exports` | 查找死导出候选 |
| `unresolved` | 查找未解析 import |
| `cycles` | 查找循环依赖 |
| `impact --file` | 分析文件影响半径 |
| `affected-tests --file` | 分析受影响测试 |

示例：

```bash
node cli.js audit-summary --cwd C:\repo --json --quiet
node cli.js audit-summary --cwd C:\repo --exclude prototypes/reference,archive --json --quiet
node cli.js audit-file --cwd C:\repo --file src\app.ts --json --quiet
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
3. 只有需要更细信息时才调用原始子命令

对于研究型工作区或多项目仓库，优先使用 `--exclude` 去掉 `reference`、`archive` 之类的目录，否则聚合结果会被非主线代码污染。

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

## 工具清单

### 核心工作区工具

| 工具名 | 描述 |
|--------|------|
| `workspace_info` | 检测工作区类型（Node/Python/Git）和可用诊断检查 |
| `run_diagnostics` | 运行项目诊断（ruff/pyright/eslint/tsc），支持 quick/full 模式 |
| `diagnostics_live` | 获取缓存的诊断结果，无需重新运行 lint |

### Git 工具

| 工具名 | 描述 |
|--------|------|
| `git_diff_summary` | 查看 staged/unstaged 变更摘要和 patch |
| `git_blame` | 查看文件 blame 信息，支持行号范围 |
| `git_history` | 查看提交历史，支持按文件/作者/日期过滤 |
| `git_branch_info` | 查看分支信息和 working tree 状态 |
| `git_stash` | 查看 stash 列表和详情 |
| `git_log_graph` | 查看图形化提交历史 |

### 搜索工具

| 工具名 | 描述 |
|--------|------|
| `search_code` | 搜索代码文本/符号/文件名 |
| `lookup_symbol` | 快速符号查找（使用索引缓存）|

### 分析工具

| 工具名 | 描述 |
|--------|------|
| `dependency_graph` | 分析 import 依赖关系，计算变更影响半径 |
| `project_health` | 检查项目健康度（README/LICENSE/CI/测试配置）|
| `check_dependencies` | 检查过时依赖（npm/pip）|

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Client (Kimi Code)                   │
└─────────────────────────────┬───────────────────────────────┘
                              │ JSON-RPC 2.0 (stdio)
┌─────────────────────────────▼───────────────────────────────┐
│                     workspace-bridge                         │
│  ┌─────────────┐  ┌─────────────────────────────────────┐  │
│  │  MCPServer  │  │         ServiceContainer            │  │
│  │  (协议层)    │◄─┤  ┌─────────┐ ┌─────────────────┐  │  │
│  └─────────────┘  │  │Workspace│ │   FileIndex     │  │  │
│        ▲          │  │  Cache  │ │ (符号索引+监听)  │  │  │
│        │          │  └────┬────┘ └─────────────────┘  │  │
│   14 个工具处理器  │       │    ┌─────────────────┐     │  │
│  (Git/搜索/诊断)  │       └───►│ DiagnosticsEngine│     │  │
│                   │            │   (ruff/eslint)  │     │  │
│                   │            └─────────────────┘     │  │
│                   │  ┌─────────────────────────────────┐ │  │
│                   │  │ EditorState (VS Code 状态读取)   │ │  │
│                   │  │ DependencyGraph (import 分析)    │ │  │
│                   │  └─────────────────────────────────┘ │  │
│                   └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
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

#### DependencyGraph
- 解析 import/require 语句
- 构建依赖关系图和影响半径分析
- 检测循环依赖

## 缓存策略

| 数据类型 | 存储位置 | 失效策略 |
|----------|----------|----------|
| Workspace Root | 内存 | 进程生命周期 |
| 文件元数据 (mtime/size) | 内存 Map | fs.watch 事件 |
| 符号索引 | 内存 + `.workspace-bridge-cache.json` | 文件变更时增量更新 |
| 诊断结果 | 内存 Map | 文件变更时重跑 lint |
| 依赖图 | 内存 Map | 文件变更时重建受影响边 |

缓存文件 5 分钟 TTL，冷启动 2-4s，热启动 ~200ms。

## 安全说明

### 已修复的安全问题

| 问题 | 修复措施 |
|------|----------|
| 命令注入 | 所有外部命令使用 `spawn` + 参数数组，禁止字符串拼接 |
| 路径遍历 | 强制校验路径在工作区内 (`validateWorkspacePath`) |
| 参数污染 | Git 日期/作者参数白名单校验 |

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
├── server.js              # 入口：初始化 + 生命周期管理
├── skills/
│   └── workspace-audit/   # CLI 使用说明
├── src/
│   ├── mcp-server.js      # MCP 协议处理
│   ├── tool-registry.js   # 工具注册表
│   ├── services/          # 核心服务
│   │   ├── container.js   # 服务容器
│   │   ├── cache.js       # 缓存管理
│   │   ├── file-index.js  # 文件索引
│   │   ├── diagnostics-engine.js
│   │   ├── dep-graph.js
│   │   └── editor-state.js
│   ├── tools/             # 工具实现
│   │   ├── git-tools.js
│   │   ├── search-tools.js
│   │   ├── workspace-tools.js
│   │   └── health-tools.js
│   └── utils/             # 工具函数
│       ├── command.js     # 安全命令执行
│       ├── path.js        # 路径处理
│       ├── diagnostics.js # 诊断解析
│       └── sanitize.js    # 输入消毒
```

### 添加新工具

```javascript
// src/tool-registry.js
{
  name: 'my_tool',
  description: '工具描述',
  inputSchema: {
    type: 'object',
    properties: {
      param: { type: 'string' }
    }
  },
  handler: async (args, container) => {
    await container.ensureReady();
    // 实现逻辑
    return { ok: true, result };
  }
}
```

### 调试

```bash
# 查看详细日志
DEBUG=1 node server.js

# 测试单个工具
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"workspace_info"}}' | node server.js
```

## 已知限制

1. **VS Code 集成仅限 Windows** - EditorState 目前只读取 Windows 的 `%APPDATA%/Code/User/workspaceStorage`
2. **大仓库性能** - 文件索引使用同步递归，10k+ 文件可能阻塞
3. **初始化忙等待** - `ensureReady()` 轮询等待，无上界超时
4. **光标位置** - 无法获取 VS Code 的光标位置和选中文本（需扩展支持）

## 路线图

- [ ] 跨平台支持（macOS/Linux）
- [ ] 异步文件索引（支持大仓库）
- [ ] 工具调用权限控制
- [ ] 增量依赖图更新
- [ ] VS Code 扩展（获取光标位置）

## 许可证

MIT
