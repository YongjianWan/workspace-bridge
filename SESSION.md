# workspace-bridge v0.7.0 开发指令

## 项目路径

```
C:\Users\sdses\.kimi\mcp-runtime\workspace-bridge\
```

## 上下文

workspace-bridge 是 MCP server，v0.6.0 → v0.7.0 升级完成。

**v0.7.0 目标**：加 HTTP/SSE 传输支持，让 Claude Code GUI 版（云端 VM 环境）能连接。✅ 已完成

---

## ✅ 已完成

### 改动文件

#### 1. `package.json`
- ✅ 添加依赖：`@modelcontextprotocol/sdk@^1.12.0`
- ✅ 添加依赖：`express@^4.18.2`
- ✅ 添加 script：`"start:http": "MCP_MODE=http node server.js"`
- ✅ 版本更新：`0.6.0` → `0.7.0`

#### 2. `server.js`
- ✅ 双模式支持：stdio（保留）+ HTTP（新增）
- ✅ HTTP 模式使用 `StreamableHTTPServerTransport`（无状态模式）
- ✅ 每个 HTTP 请求创建独立的 Server 实例
- ✅ 端口默认 3000，可通过 `PORT` 环境变量覆盖
- ✅ 启动模式由 `MCP_MODE` 环境变量控制
- ✅ 支持 `WORKSPACE_ROOT` 环境变量手动指定工作区根目录

#### 3. `src/utils/path.js`
- ✅ `findWorkspaceRoot()` 优先检查 `WORKSPACE_ROOT` 环境变量
- ✅ 支持通过 `options.workspaceRoot` 参数指定

#### 4. `src/services/container.js`
- ✅ 初始化时记录工作区根目录来源（环境变量或自动检测）

### 启动方式

```bash
# stdio 模式（默认，向后兼容）
npm start
# 或
MCP_MODE=stdio node server.js

# HTTP 模式
npm run start:http
# 或
MCP_MODE=http PORT=3000 node server.js

# 手动指定工作区根目录
WORKSPACE_ROOT=/path/to/project node server.js
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MCP_MODE` | 传输模式：`stdio` 或 `http` | `stdio`（无 `PORT` 时） |
| `PORT` | HTTP 端口 | `3000` |
| `WORKSPACE_ROOT` | 手动指定工作区根目录 | 自动检测 |
| `DEBUG` | 启用调试输出 | - |

### 验证结果

| 测试项 | 结果 |
|--------|------|
| stdio 模式 - initialize | ✅ |
| stdio 模式 - tools/list (11 tools) | ✅ |
| stdio 模式 - tools/call | ✅ |
| HTTP 模式 - health 端点 | ✅ |
| HTTP 模式 - initialize | ✅ |
| HTTP 模式 - tools/list (11 tools) | ✅ |
| HTTP 模式 - tools/call | ✅ |
| WORKSPACE_ROOT 环境变量 | ✅ |

### settings.json 配置

```json
{
  "workspace-bridge": {
    "url": "http://服务器IP:3000/mcp"
  }
}
```

### 技术细节

- HTTP 模式使用 SDK 的 `StreamableHTTPServerTransport`，支持 SSE 响应
- 无状态模式（stateless）：每个请求独立，不维护会话
- 工具注册逻辑复用 `tool-registry.js`，无需修改
- 错误消息脱敏逻辑统一，保护敏感路径信息
- 容器初始化仍采用后台初始化 + `ensureReady()` 模式
- 工作区根目录查找优先级：`WORKSPACE_ROOT` 环境变量 > 参数指定 > 自动检测

---

## 约束检查

- ✅ **不删现有 stdio 模式** - CLI 场景继续工作
- ✅ **不改 tool-registry.js 和 services/** - 仅适配器模式转换
- ✅ **HTTP 模式下工具调用仍然走 container.ensureReady()**
- ✅ **端口默认 3000，可通过 PORT 环境变量覆盖**
- ✅ **支持 WORKSPACE_ROOT 环境变量手动指定工作区**
