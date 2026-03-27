# workspace-bridge - Agent Guide

> MCP (Model Context Protocol) 服务器，为 AI 编程助手提供工作区感知、代码索引、Git 集成和实时诊断能力。
> 
> 当前版本: v0.6.0 (跨文件静态分析引擎)

---

## 项目概述

workspace-bridge 的核心价值定位：**只做客户端（Claude Code/Kimi Code）自身做不到的事**——跨文件静态分析 + 后台诊断缓存。

客户端已有 Read/Grep/Bash，不需要 MCP 重复提供单文件读取、文本搜索、Git 命令包装。此项目专注于：
- 跨文件结构化分析（依赖图、死代码检测、影响半径）
- 后台持续运行的诊断缓存（文件变更自动更新，查询时 0ms 返回）

### 架构图

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
│   11 个工具处理器  │       │    ┌─────────────────┐     │  │
│  (Git/搜索/诊断)  │       └───►│ DiagnosticsEngine│     │  │
│                   │            │   (ruff/eslint)  │     │  │
│                   │            └─────────────────┘     │  │
│                   │  ┌─────────────────────────────────┐ │  │
│                   │  │ DependencyGraph (import 分析)    │ │  │
│                   │  │  - dependencies/dependents      │ │  │
│                   │  │  - impact/cycles/stats          │ │  │
│                   │  │  - dead_exports/unresolved      │ │  │
│                   │  │  - affected_tests               │ │  │
│                   │  └─────────────────────────────────┘ │  │
│                   └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

- **运行时**: Node.js >= 16.0.0
- **语言**: 纯 JavaScript (ES2020+)
- **协议**: MCP (Model Context Protocol) via JSON-RPC 2.0 over stdio
- **外部依赖**: 零运行时依赖，仅使用 Node.js 内置模块

---

## 项目结构

```
workspace-bridge/
├── server.js                    # 入口文件：初始化 + 生命周期管理
├── package.json                 # 项目配置，无依赖
├── src/
│   ├── mcp-server.js            # MCP 协议处理层 (JSON-RPC)
│   ├── tool-registry.js         # 11 个工具的注册表
│   ├── services/                # 核心服务层
│   │   ├── container.js         # ServiceContainer：服务生命周期管理
│   │   ├── cache.js             # WorkspaceCache：内存 + 磁盘缓存
│   │   ├── file-index.js        # FileIndex：文件索引 + fs.watch
│   │   ├── diagnostics-engine.js # DiagnosticsEngine：ruff/pyright/eslint/tsc
│   │   ├── dep-graph.js         # DependencyGraph：依赖图分析（核心价值）
│   │   └── editor-state.js      # ⚠️ EditorState：当前不可用（待删除）
│   ├── tools/                   # 工具实现
│   │   ├── git-tools.js         # Git 相关工具（secure，参数化命令）
│   │   ├── search-tools.js      # 代码搜索工具（含 ReDoS 防护）
│   │   ├── workspace-tools.js   # 工作区诊断工具
│   │   ├── health-tools.js      # 项目健康度检查
│   │   └── dep-tools.js         # 依赖图工具
│   └── utils/                   # 工具函数
│       ├── command.js           # 安全命令执行（spawn + 参数数组）
│       ├── path.js              # 路径处理、工作区发现
│       ├── diagnostics.js       # 诊断输出解析
│       ├── sanitize.js          # 输入消毒（防注入）
│       └── logger.js            # 日志工具
└── test/                        # 测试套件
    ├── security-test.js         # 安全测试（路径遍历、注入防护）
    ├── mcp-test.js              # MCP 协议测试
    ├── functionality-test.js    # 功能可用性测试
    └── analysis-test.js         # 跨文件分析测试（v0.6.0 新增）
```

---

## 构建和运行

### 安装

```bash
# 无需安装依赖（零运行时依赖）
cd workspace-bridge

# （可选）安装 Python 诊断工具
pip install ruff pyright

# （可选）安装 Node 诊断工具
npm install -g eslint typescript
```

### 运行

```bash
# 正常启动
node server.js

# 调试模式（详细日志）
DEBUG=1 node server.js
# Windows: set DEBUG=1 && node server.js
```

### MCP 客户端配置

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

---

## 测试

### 运行所有测试

```bash
# 安全测试（路径遍历、注入防护验证）
npm test
# 或: node test/security-test.js

# MCP 协议测试
node test/mcp-test.js

# 功能可用性测试（验证 11 个工具）
node test/functionality-test.js

# 跨文件分析测试（验证 dead_exports/unresolved/affected_tests）
node test/analysis-test.js

# 运行全部测试
npm run test:all
```

### 测试说明

1. **security-test.js**: 验证安全边界
   - 路径遍历防护（`../../../etc/passwd` 应被拒绝）
   - 符号名消毒（`func;rm -rf /` 应被清理）
   - Shell 参数消毒
   - 命令执行安全（参数数组 vs 字符串拼接）

2. **mcp-test.js**: 验证 MCP 协议握手
   - `initialize` 请求/响应
   - `tools/list` 返回 11 个工具
   - `tools/call` 调用 workspace_info

3. **functionality-test.js**: 验证核心功能
   - workspace_info、dependency_graph、lookup_symbol
   - search_code、git_diff_summary、git_blame
   - project_health、check_dependencies、diagnostics_live

4. **analysis-test.js**: 验证跨文件分析（v0.6.0 新增）
   - `dead_exports` - 查找未使用的导出
   - `unresolved` - 查找解析失败的导入
   - `affected_tests` - 查找受变更影响的测试

---

## 11 个可用工具

### 核心工作区工具

| 工具名 | 描述 | 核心价值 |
|--------|------|----------|
| `workspace_info` | 检测工作区类型（Node/Python/Git） | 保留（维护成本为零） |
| `run_diagnostics` | 运行项目诊断 | 保留（维护成本为零） |
| `diagnostics_live` | 获取缓存的诊断结果（0ms 返回） | **v0.6.0 核心改进** |

### Git 工具（客户端可用 Bash 替代）

| 工具名 | 描述 | 状态 |
|--------|------|------|
| `git_diff_summary` | staged/unstaged 变更摘要 | 保留 |
| `git_blame` | 文件 blame 信息 | 保留 |
| `git_history` | 提交历史过滤 | 保留 |

### 搜索工具（客户端可用 Grep 替代）

| 工具名 | 描述 | 状态 |
|--------|------|------|
| `search_code` | 代码文本/符号/文件名搜索 | 保留 |
| `lookup_symbol` | 快速符号查找（使用索引缓存） | 保留 |

### 分析工具

| 工具名 | 描述 | 核心价值 | 注意事项 |
|--------|------|----------|----------|
| `dependency_graph` | 依赖分析、影响半径、循环依赖 | **唯一刚需** | 新增 `dead_exports`/`unresolved`/`affected_tests` |
| `project_health` | 项目健康度检查 | 保留 | - |
| `check_dependencies` | 检查过时依赖 | 保留 | - |

### dependency_graph 操作类型

```javascript
// 基础操作
{ operation: 'stats' }        // 返回依赖图统计信息
{ operation: 'dependencies', file: 'src/x.js' }  // 文件的直接依赖
{ operation: 'dependents', file: 'src/x.js' }    // 依赖此文件的文件
{ operation: 'impact', file: 'src/x.js' }        // 变更影响半径
{ operation: 'cycles' }       // 查找循环依赖

// v0.6.0 新增（跨文件分析）
{ operation: 'dead_exports' }  // 查找未使用的导出 ⚠️ 无 AST，误报率高
{ operation: 'unresolved' }    // 查找解析失败的导入
{ operation: 'affected_tests', file: 'src/x.js', maxDepth: 5 }  // 受影响的测试
```

---

## 已知问题与限制

### 1. activeEditor 不可靠

**状态**: VS Code 的 active editor 状态更新有延迟，MCP 层无法解决。

**影响**: `editor-state.js` 的 `getActiveFile()` 可能返回过期的文件路径。

**缓解**: 使用 `openEditors` 和 `recentFiles` 替代，或直接在 MCP 客户端传入 `file` 参数。

### 2. EditorState 依赖 better-sqlite3

**状态**: `src/services/editor-state.js` 需要 `better-sqlite3` 包才能读取 VS Code state.vscdb。

**安装**: `npm install better-sqlite3`（可选依赖，未安装时返回 null）

---

## 代码风格指南

### 核心原则

1. **安全第一**: 所有外部命令使用 `spawn` + 参数数组，禁止字符串拼接
2. **路径校验**: 所有用户输入路径必须经过 `validateWorkspacePath()` 校验
3. **错误脱敏**: 错误消息中绝对路径替换为 `<path>`，用户信息替换为 `<user>`
4. **异步优先**: 文件 IO 使用异步 API，大目录使用并发控制
5. **配置集中**: 可调参数使用 CONFIG 常量对象，放在文件顶部

### 命名约定

```javascript
// 类名: PascalCase
class ServiceContainer { }
class FileIndex { }

// 函数/方法: camelCase
async function ensureReady() { }
function validateWorkspacePath() { }

// 常量: UPPER_SNAKE_CASE
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CONCURRENCY = 50;

// 私有方法: 下划线前缀（约定）
async _processBatch(files) { }
```

### 安全编码模式

```javascript
// ✅ 正确：参数化命令执行
const result = await runCommandSecure('git', ['diff', '--stat'], cwd, 30000);

// ❌ 错误：字符串拼接
const result = await exec(`git diff --stat ${file}`); // 注入风险

// ✅ 正确：路径校验
const filePath = validateWorkspacePath(args.file, workspaceRoot);
if (!filePath) {
  return { ok: false, error: 'Invalid file path or path outside workspace' };
}

// ✅ 正确：输入消毒
const sanitized = sanitizeSymbolName(rawName);
if (!sanitized) return { ok: false, error: 'Invalid symbol name' };
```

### 注释风格

项目使用中文注释。关键逻辑必须有注释：

```javascript
/**
 * 计算变更影响半径：修改此文件会影响哪些文件
 * @param {string} filePath - 起始文件
 * @param {number} depth - 最大搜索深度（默认 3）
 * @returns {Array<{file: string, level: number}>} - 影响文件列表
 */
getImpactRadius(filePath, depth = 3) {
  // 沿 reverseGraph BFS 搜索
  // ...
}
```

---

## 缓存策略

| 数据类型 | 存储位置 | 失效策略 |
|----------|----------|----------|
| Workspace Root | 内存 | 进程生命周期 |
| 文件元数据 | 内存 Map | fs.watch 事件 |
| 符号索引 | 内存 + `.workspace-bridge-cache.json` | 文件变更时增量更新 |
| 诊断结果 | 内存 Map | 文件变更时后台重跑 lint |
| 依赖图 | 内存 Map | 文件变更时重建受影响边 |

缓存文件 5 分钟 TTL，冷启动 2-4s，热启动 ~200ms。

---

## 安全考虑

### 已修复的安全问题

| 问题 | 位置 | 修复措施 |
|------|------|----------|
| 命令注入 | 所有工具 | 使用 `spawn` + 参数数组，禁止字符串拼接 |
| 路径遍历 | git-tools.js | `validateWorkspacePath()` 强制校验 |
| ReDoS | search-tools.js | query 长度限制、危险模式检测、100ms 超时 |
| 信息泄露 | mcp-server.js | `sanitizeErrorMessage()` 脱敏处理 |
| 初始化竞争 | tool-registry.js | 所有工具添加 `await container.ensureReady()` |
| Shell 参数注入 | sanitize.js | `sanitizeShellArg()` 移除危险字符 |

### 安全边界

- ✅ 所有用户输入路径经过校验
- ✅ 所有命令执行使用参数化接口
- ✅ 输出长度限制（10MB 截断，防止内存耗尽）
- ✅ 正则超时保护（100ms）
- ⚠️ 诊断工具（ruff/eslint）仍访问文件系统，需确保工作区可信
- ⚠️ `isSafePath()` 使用 `startsWith` 检查，软链接场景下理论上存在绕过风险

### 禁止事项

1. **不要添加 shell 执行工具** - 客户端已有 Bash 工具
2. **不要添加文件写入工具** - 客户端已有 WriteFile 工具
3. **不要引入 better-sqlite3** - 只为读 state.vscdb，价值不够，增加攻击面
4. **不要做函数级 AST 分析** - 需要 tree-sitter/babel，技术栈切换，ROI 不够

---

## 开发路线图

### v0.6.0 (当前) - 跨文件静态分析引擎 ✅

**已完成:**
- Phase 1: 修复已知 Bug（shutdown 信号补全、异步 IO、EditorState 降级）
- Phase 2: 后台诊断缓存（文件变更 → 自动更新诊断，查询 0ms 返回）
- Phase 3: 跨文件分析查询（dead_exports、unresolved、affected_tests）

**测试状态:**
- ✅ security-test.js: 全部通过
- ✅ mcp-test.js: 通过
- ✅ functionality-test.js: 11/11 通过
- ✅ analysis-test.js: 5/5 通过

### v0.7.0 (计划中)

- [ ] 删除 EditorState 模块（当前不可用）
- [ ] 添加依赖图磁盘快照（启动加速）
- [ ] 优化 findDeadExports 算法或标记为实验功能
- [ ] 修复 findUnresolvedImports 同步 IO

### 不做的事

| 功能 | 原因 |
|------|------|
| read_file/write_file 工具 | 客户端自己能读写 |
| 函数级依赖分析 | 需要 AST，技术栈切换，ROI 不够 |
| Mermaid 可视化输出 | 客户端是 LLM，要 JSON 不要图 |
| VS Code 扩展 | 三层架构复杂度太高 |
| better-sqlite3 依赖 | 只为读 state.vscdb，价值不够 |

---

## 故障排除

### 启动问题

```bash
# 检查 Node 版本
node --version  # 需 >= 16.0.0

# 手动测试启动
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | node server.js
```

### 缓存问题

```bash
# 删除缓存强制重建
delete .workspace-bridge-cache.json

# 调试缓存加载
DEBUG=1 node server.js
```

### 诊断工具不可用

```bash
# Python 项目
pip install ruff pyright

# Node 项目
npm install -g eslint typescript
```

---

## 关键文件速查

| 文件 | 作用 | 修改频率 |
|------|------|----------|
| `server.js` | 入口，生命周期 | 低 |
| `src/tool-registry.js` | 工具定义 | 中（新增工具时） |
| `src/services/dep-graph.js` | **核心价值模块** | 高（v0.6.0 重点） |
| `src/services/file-index.js` | 文件索引 | 低（质量高，稳定） |
| `src/services/diagnostics-engine.js` | 诊断引擎 | 中（v0.6.0 后台缓存） |
| `src/utils/command.js` | 安全命令执行 | 低（安全关键） |
| `src/utils/sanitize.js` | 输入消毒 | 低（安全关键） |

---

## 使用建议

### 何时使用 dependency_graph

**推荐使用场景:**
- 重构前评估影响范围（`impact` 操作）
- 查找循环依赖（`cycles` 操作）
- 修改文件后确定需要运行的测试（`affected_tests` 操作）

**谨慎使用场景:**
- 清理死代码（`dead_exports` 操作）：误报率高，建议仅作参考

### 监控指标

如果两周内 `dependency_graph` 查询 < 5 次，考虑暂停投入（按 PLAN.md 约定）。

---

*Last updated: 2026-03-27 (v0.6.0)*
