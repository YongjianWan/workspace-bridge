# workspace-bridge v0.6.0 — 跨文件静态分析引擎

> 从"工具集合"到"客户端做不到的分析能力"

## 核心认知

workspace-bridge 存在的价值 = 客户端（Claude Code/Kimi Code）自身做不到的事。

客户端已有：Read、Grep、Glob、Bash。单文件读取、文本搜索、Git 命令都不需要 MCP 重复提供。

客户端做不到：
- 跨文件结构化分析（依赖图、死代码检测、影响半径）
- 后台持续运行的诊断缓存（文件一改，诊断自动更新，查询时 0ms 返回）

v0.6.0 只做这两件事。

---

## 现状（v0.5.0）

### 架构

```
server.js
└── ServiceContainer
    ├── WorkspaceCache       # 内存 + 磁盘缓存，工作正常
    ├── FileIndex            # 符号索引 + fs.watch，质量好
    ├── DependencyGraph      # import 关系图，基础可用
    ├── DiagnosticsEngine    # ruff/pyright/eslint/tsc，按需运行
    └── EditorState          # 读 state.vscdb，实际不可用
```

### 工具（11 个）

| 工具 | 客户端能替代 | 保留原因 |
|------|-------------|---------|
| dependency_graph | 不能 | **核心价值** |
| diagnostics_live | 部分能 | 改造后有独立价值（后台缓存） |
| project_health | 部分能 | 聚合多项检查，留着不碍事 |
| lookup_symbol | 能（Grep） | 已有，维护成本为零 |
| search_code | 能（Grep） | 已有，维护成本为零 |
| workspace_info | 能（Read） | 已有，维护成本为零 |
| run_diagnostics | 能（Bash） | 已有，维护成本为零 |
| git_diff_summary | 能（Bash） | 已有，维护成本为零 |
| git_blame | 能（Bash） | 已有，维护成本为零 |
| git_history | 能（Bash） | 已有，维护成本为零 |
| check_dependencies | 能（Bash） | 已有，维护成本为零 |

决策：**不删任何现有工具**（维护成本为零），新开发只投入核心价值方向。

### 已知 Bug

| Bug | 位置 | 影响 |
|-----|------|------|
| EditorState 读 SQLite 失败 | editor-state.js:213 | diagnostics_live 无 file 参数时返回错误 |
| shutdown 只挂 SIGINT | server.js:66 | MCP 客户端关进程时磁盘缓存不会写入 |
| DependencyGraph.build() 同步 IO | dep-graph.js:40 | 大仓库阻塞事件循环 |
| getUnusedExports 字符串 includes | dep-graph.js:261 | 误报率高，不可用 |

---

## v0.6.0 改动计划

### Phase 1：修 Bug（预计 1-2 小时）

不加功能，只修已知问题。

**1.1 shutdown 信号补全**

```
文件：server.js
改动：加 SIGTERM + stdin close 处理
```

server.js 当前只挂了 SIGINT。MCP 客户端关闭时通常关 stdin pipe 或发 SIGTERM。加上：

- `process.on('SIGTERM', shutdown)`
- `process.stdin.on('end', shutdown)`
- shutdown 函数去重（防止多次调用）

验证：`kill -TERM <pid>` 后检查 `.workspace-bridge-cache.json` 是否写入。

**1.2 DependencyGraph 改异步**

```
文件：dep-graph.js
改动：analyzeFile 里的 fs.readFileSync → fs.promises.readFile
```

当前 `build()` 对每个文件调 `fs.readFileSync`，2000 个文件 = 2000 次同步 IO。改为 `fs.promises.readFile` + 复用 FileIndex 的并发限制模式。

验证：大目录下启动时事件循环不被阻塞（可用 `--prof` 观察）。

**1.3 EditorState 降级处理**

```
文件：editor-state.js
改动：readSQLite 承认失败，不假装成功
```

当前 `readSQLite()` 尝试 JSON.parse 二进制文件，失败后静默返回空对象。改为：

- 检测文件头 magic bytes（SQLite: `SQLite format 3\000`）
- 如果是 SQLite 二进制且没有 better-sqlite3，直接返回 `null` + 日志说明原因
- diagnostics_live 对应调整：file 参数变为 required，不再依赖 EditorState

不装 better-sqlite3，不修 SQLite 读取。承认这个功能当前不可用。

验证：diagnostics_live 不传 file 时返回明确的 `error: "file parameter is required"` 而不是静默空结果。

---

### Phase 2：后台诊断缓存（预计 2-3 小时）

让 diagnostics_live 从"按需跑 linter"变成"实时查缓存"。

**核心改动**

```
文件变更 (fs.watch)
  → FileIndex.handleFileChange（已有）
    → 新增：DiagnosticsEngine.scheduleCheck(filePath)
      → 后台跑 linter，结果存缓存
        → diagnostics_live 查询时直接返回缓存
```

**2.1 DiagnosticsEngine 加后台调度**

```
文件：diagnostics-engine.js
新增方法：scheduleCheck(filePath)
```

- 文件变更时调用，加入队列
- debounce 1 秒（同一文件短时间内多次变更只跑一次）
- 后台异步执行，不阻塞主线程
- 结果写入 cache

**2.2 FileIndex 触发诊断**

```
文件：file-index.js
改动：handleFileChange 末尾加一行
```

```javascript
// file-index.js handleFileChange 末尾
if (this.onFileChanged) this.onFileChanged(filePath);
```

container.js 初始化时注册回调：

```javascript
this.fileIndex.onFileChanged = (filePath) => {
  this.diagnostics.scheduleCheck(filePath);
};
```

**2.3 diagnostics_live 工具改造**

```
文件：tool-registry.js（diagnostics_live handler）
改动：默认返回缓存，不再按需跑 linter
```

- 有缓存 → 直接返回（0ms）
- 无缓存 → 返回 `{ diagnostics: [], note: "file not yet analyzed, check will run in background" }`
- 不再同步等待 linter 执行

验证：
1. 改一个 .py 文件，等 2 秒
2. 调 diagnostics_live，应返回 ruff/pyright 结果且 source 为 "cache"
3. 响应时间 < 50ms

---

### Phase 3：跨文件静态分析查询（预计 2-3 小时）

在现有 dependency_graph 工具上扩展 operation 参数，不新建工具。

**3.1 dead_exports 查询**

```
文件：dep-graph.js
新增方法：findDeadExports()
```

修复现有 `getUnusedExports` 的逻辑：

当前问题：用 `imports.some(imp => imp.includes(exp))` 做判断，字符串 includes 误报率极高。

修复方案：
- 对每个文件的 exports，检查 reverseGraph 中是否有入边指向该文件
- 如果没有任何文件 import 这个文件 → 该文件所有 export 都是死代码
- 如果有 import 但只 import 了部分符号 → 需要解析 import 语句的具体符号名（`import { a, b } from './x'`）

JS/TS 的 named import 可以精确匹配。Python 的 `from x import *` 无法判断，标记为 "unknown"。

```javascript
// 输入
dependency_graph({ operation: "dead_exports" })

// 输出
{
  ok: true,
  deadExports: [
    { file: "src/utils.js", exports: ["oldHelper", "deprecatedFn"], confidence: "high" },
    { file: "src/lib.py", exports: ["parse_v1"], confidence: "medium" }
  ]
}
```

**3.2 unresolved 查询**

```
文件：dep-graph.js
新增方法：findUnresolvedImports()
```

遍历图，找所有 `resolveImport` 返回了路径但文件不存在的 import。

```javascript
// 输入
dependency_graph({ operation: "unresolved" })

// 输出
{
  ok: true,
  unresolved: [
    { file: "src/api.js", import: "./old-module", resolvedTo: null },
    { file: "src/utils.py", import: "deprecated_lib", resolvedTo: null }
  ]
}
```

**3.3 affected_tests 查询**

```
文件：dep-graph.js
新增方法：findAffectedTests(filePath)
```

从指定文件出发，沿 reverseGraph BFS，找所有文件名匹配测试模式的文件：
- `*.test.*`, `*.spec.*`, `test_*`, `*_test.*`
- `tests/` 或 `test/` 目录下的文件

```javascript
// 输入
dependency_graph({ operation: "affected_tests", file: "src/utils.js" })

// 输出
{
  ok: true,
  source: "src/utils.js",
  affectedTests: [
    { file: "tests/test_utils.py", distance: 1 },
    { file: "tests/test_api.py", distance: 2, via: ["src/api.js"] }
  ]
}
```

**3.4 tool-registry 扩展**

```
文件：tool-registry.js（dependency_graph handler）
改动：switch 加三个 case
```

dependency_graph 的 operation enum 从：
`['dependencies', 'dependents', 'impact', 'cycles', 'stats']`

扩展为：
`['dependencies', 'dependents', 'impact', 'cycles', 'stats', 'dead_exports', 'unresolved', 'affected_tests']`

验证：
1. 在 meeting 工作区跑 `dead_exports`，确认返回的函数确实没被引用
2. 跑 `unresolved`，确认返回的 import 确实指向不存在的文件
3. 跑 `affected_tests`，确认返回的测试文件确实 import 了目标文件

---

## 不做的事

| 功能 | 原因 |
|------|------|
| read_file 工具 | 客户端自己能读 |
| write_file 工具 | 客户端自己能写 |
| 函数级依赖分析 | 需要 AST（tree-sitter/babel），技术栈切换，ROI 不够 |
| Mermaid 可视化输出 | 客户端是 LLM，要 JSON 不要图 |
| VS Code 扩展 | 三层架构复杂度太高，不值得 |
| better-sqlite3 依赖 | 只为读 state.vscdb，价值不够 |
| 工具合并（11→7） | 合并后参数复杂度上升，不合并维护成本为零 |
| 架构边界检查 | 需要用户预定义规则，场景太窄 |

---

## 文件改动清单

### Phase 1

| 文件 | 操作 | 改动量 |
|------|------|--------|
| server.js | 改 | +15 行（SIGTERM + stdin close + shutdown 去重） |
| dep-graph.js | 改 | ~20 行（readFileSync → readFile + async） |
| editor-state.js | 改 | ~15 行（SQLite 检测 + 明确失败） |
| tool-registry.js | 改 | ~5 行（diagnostics_live file 参数 required） |

### Phase 2

| 文件 | 操作 | 改动量 |
|------|------|--------|
| diagnostics-engine.js | 改 | +40 行（scheduleCheck + 队列 + debounce） |
| file-index.js | 改 | +3 行（onFileChanged 回调） |
| container.js | 改 | +5 行（注册回调） |
| tool-registry.js | 改 | ~10 行（diagnostics_live 返回逻辑） |

### Phase 3

| 文件 | 操作 | 改动量 |
|------|------|--------|
| dep-graph.js | 改 | +80 行（findDeadExports + findUnresolvedImports + findAffectedTests） |
| tool-registry.js | 改 | +30 行（三个新 case） |

总计：~225 行新增/修改，0 个新文件。

---

## 验证方式

每个 Phase 完成后跑自动化测试：

```bash
# 现有测试
npm test                         # 安全测试
node test/mcp-test.js            # MCP 协议测试
node test/functionality-test.js  # 功能测试

# Phase 1 验证
# 手动：kill -TERM 后检查缓存文件是否写入
# 手动：diagnostics_live 不传 file 应返回明确错误

# Phase 2 验证
# 改一个 .py 文件 → 等 2 秒 → diagnostics_live 应返回缓存结果

# Phase 3 验证
# dependency_graph operation=dead_exports → 返回未引用的 export
# dependency_graph operation=unresolved → 返回无法解析的 import
# dependency_graph operation=affected_tests file=xxx → 返回受影响的测试文件
```

建议 Phase 3 后补一个 `test/analysis-test.js` 覆盖三个新查询。

---

## 版本规划

| 版本 | 内容 | 工具数 |
|------|------|--------|
| v0.5.0 | 当前版本 | 11 |
| v0.6.0 | Phase 1-3 全部完成 | 11（工具数不变，dependency_graph 能力增强） |
| v0.7.0+ | 视使用频率决定 | 如果两周内 dependency_graph 查询 < 5 次，暂停投入 |
