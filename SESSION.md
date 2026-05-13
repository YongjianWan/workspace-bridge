# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（必须执行）

```bash
# 1. 验证测试基线
node test/runner.js          # 期望: 103/103 PASS（runner 300s 上限内 102 个，watch-test.js 单独运行）

# 2. 验证自审基线
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExportsCount=3, unresolvedCount=0, cyclesCount=0, totalFiles≈185, analysisCoverage.coverageRatio=1

# 3. 验证大项目 compact 可用性
node cli.js audit-map --cwd reference/GitNexus/gitnexus --compact --json --quiet
# 期望: 输出行数 < 1000, summary.severity 存在, highlightedFiles 按问题严重程度排序
```

**如果任何一步失败 → 先修基线，再做其他事。**

---

## 边界行为回归测试（可选，发版前执行）

```bash
# 不存在的文件 → 明确错误 + exit=1
node cli.js impact --file nonexistent.js --json --quiet
node cli.js affected-tests --file nonexistent.js --json --quiet

# init 重复运行 / 非 git 目录 audit-diff → exit=1
node cli.js init --json

# --exclude 过滤后 analysisCoverage 同步
node cli.js audit-summary --exclude test,benchmark --json --quiet

# Windows 反斜杠路径标准化
node cli.js audit-file --file .\src\services\dep-graph.js --json --quiet

# 非法参数值 → 明确报错
node cli.js audit-file --file src/services/dep-graph.js --max-depth abc --json --quiet

# REPL 非 TTY → exit=1
node cli.js repl
```

---

## 基线状态

- 测试：**103/103 PASS**（runner 内 102 个 + watch-test.js 单独运行）
- 版本：**v1.2.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：185 文件，entry=1, library=62, test=104, script=17, unknown=1
- 健康度：5/5，3 dead exports（脚本/工具函数公共 API 预留），0 循环，0 未解析
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**

**历史交付**：路线 A–J 全部完成；测试缺口全部补齐。详见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 已知陷阱（新 agent 必看）

| 陷阱 | 位置 | 如何避免 |
|------|------|----------|
| `DEFAULT_EXCLUDE_DIRS` 全局污染 | `src/services/file-index.js` | 任何新增排除项必须是通用目录名（如 `node_modules`），不能是项目特定名称 |
| orphan 检测不同步 | `project-map.js` vs `overview-tools.js` | 两处 orphan 逻辑必须保持同步（scripts/bin/benchmark 跳过） |
| compact 模式只改 project-map.js | `cli.js` 也需要同步 | human-readable 输出和 `countTreeFiles()` 必须兼容 skeleton 模式（`totalFileCount`） |
| Windows PowerShell 管道 BOM | 所有 `node cli.js ... \| node -e` 命令 | PowerShell 管道传 JSON 会带 BOM，用文件中转（`> file`）再读取 |
| cache.save() 已改为 async | `src/services/cache.js` | 调用方必须 `await`（container.js、测试均已适配） |
| repl-test.js flaky | `test/repl-test.js` | runner.js 串行执行时偶发失败，单独 `node test/repl-test.js` 稳定通过；若遇到，先重跑确认 |
| `framework-patterns.js` 新增框架时 | `src/services/dep-graph/framework-patterns.js` | 路径检测逻辑按语言分块，新增语言需同时更新 `isEntry` 标记和测试 |
| `buildFileValidationAdvice` 导出链 | `validation-advice.js` → `index.js` → `cli.js` | 新增 formatter 函数必须在 `src/cli/formatters/index.js` 中显式导出，否则 cli.js 解构为 `undefined` |
| `--quiet` 不再 monkey-patch `console.error` | `cli.js` / `container.js` | `quiet` 通过 `ServiceContainer` → `FileIndex` / `DependencyGraph` 传递；信息性日志条件输出，错误日志仍用 `console.error` |
| `findDeadExports()` edges/files 降级 | `src/services/dep-graph.js` | 单文件项目（files=1）不受降级影响；多文件项目 edges/files < 0.1 时 confidence 降为 low |
| `.workspace-bridge-cache.json.bak` 泄漏到 git status | `src/tools/git-tools.js` | `getChangedFiles()` 已排除 `.bak` 备份文件，防止 audit-diff 误报 |
| `resolvers.js` 策略链新增策略 | `src/services/dep-graph/resolvers.js` | 新增语言需在 `registerResolverConfig()` 中加一行，策略函数签名 `(importPath, fromFile, ctx) => string\|null` |

---

## 本轮上下文

> 活跃问题与技术债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。历史已修复条目不重复记录。

### 本轮做了什么

**测试缺口全部补齐** — 6 个新测试文件，103/103 PASS：

| 新测试文件 | 覆盖目标 | 断言数 |
|-----------|---------|--------|
| `test/symbol-extractors-test.js` | 6 语言符号提取器 + 空输入/未知扩展名/行号/签名 | 14+ |
| `test/spawn-ast-direct-test.js` | 成功 JSON / 脚本不存在 / stdout 截断 / stderr 截断 / spawn 错误 / stdin 错误 / 非法 JSON | 8 |
| `test/file-index-boundary-test.js` | readdir EACCES 跳过 / build AbortController 超时 / indexByPattern 超时 | 3 |
| `test/watch-sigterm-test.js` | watch SIGTERM / audit-file --watch SIGINT / executeWatchCommand 无受影响测试边界 | 3 |
| `test/repl-edge-test.js` | top 精确 threshold / top 低于 threshold / issues 无问题 / audit-map compact / audit-map 非 compact | 5 |
| `test/cli-mapper-adapter-test.js` | audit-diff safeEntries 结构 / 非法 max-depth / 非法 reuse-hints / 非法 trend-granularity / 缺失文件 human 错误 | 6 |

**此前已完成**：路线 I / I-2 / J / P84 / P8-2-1 / 大仓库并发限流（阶段 3）/ Windows 命令硬化 / 测试基础设施 / cli.js 门面拆分 / git-tools.js 死代码清理 / P77 / P83/P88 / formatter 双层次测试 / parser shared/polyglot 直接测试。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

### 活跃问题与技术债务

| 级别 | 数量 | 内容 |
|------|------|------|
| L1 Blocker | 0 | — |
| L2 债务 | 0 | P77/P83/P88 全部清空 |
| L3 品味 | 4 | git-tools.js 手动字符级解析 / overview-tools.js HTML 裸数字 / js.js visitor 超长 / path.js hasPathSegment 语义陷阱 |

**测试覆盖缺口：已清零。** 所有 TECH_DEBT.md 列出的缺口模块均已有直接测试或深化测试。

### 下一步方向

- 路线 A–J 及本轮所有补丁全部关闭，进入**观察期**
- 活跃债务仅余 L3 品味问题（见 TECH_DEBT.md）
- 可选：
  1. 收工保持观察
  2. 修 L3 品味问题 — js.js visitor 拆分 / git-tools.js 手动解析重构
  3. 探索新方向（见 ROADMAP.md 未来路线）

---

*Last updated: 2026-05-12（测试缺口全部补齐，103/103 PASS；活跃 L1/L2 债务清零；6 个新测试文件；totalFiles=185）*
