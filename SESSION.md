# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（必须执行）

```bash
# 1. 验证测试基线
node test/runner.js          # 期望: 76/76 PASS

# 2. 验证自审基线
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExportCount=0, unresolvedCount=0, cycleCount=0, totalFiles≈140

# 3. 验证大项目 compact 可用性
node cli.js audit-map --cwd reference/GitNexus/gitnexus --compact --json --quiet
# 期望: 输出行数 < 1000, summary.severity 存在, highlightedFiles 按问题严重程度排序
```

**如果任何一步失败 → 先修基线，再做其他事。**

---

## 基线状态

- 测试：**76/76 PASS**
- 版本：**v1.1.0**（以 `package.json` 为准）
- 分支：`main`，已 push origin
- 自身项目规模：146 文件，entry=4, library=53, test=77, script=12
- 健康度：5/5，0 死导出，0 循环，0 未解析
- cache 一致性：✅ 已修复（删除文件后无 ghost 数据）
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**（C/C++ AST 已于 2026-05-06 交付）
- **上一轮已完成（2026-05-07 bug 修复专项）**：
  - 修复 #39 / #40 / #41 / #42 / #43 / #48 / #47（全部 P0 + P1 bug 清零）
  - 修复 #45 / #49 / #50 / #54
  - 关闭过时 issue #38（registry-core.js 已实际接入）

---

## 已知陷阱（新 agent 必看）

| 陷阱 | 位置 | 如何避免 |
|------|------|----------|
| `DEFAULT_EXCLUDE_DIRS` 全局污染 | `src/services/file-index.js` | 任何新增排除项必须是通用目录名（如 `node_modules`），不能是项目特定名称 |
| orphan 检测不同步 | `project-map.js` vs `overview-tools.js` | 两处 orphan 逻辑必须保持同步（scripts/bin/benchmark 跳过） |
| compact 模式只改 project-map.js | `cli.js` 也需要同步 | human-readable 输出和 `countTreeFiles()` 必须兼容 skeleton 模式（`totalFileCount`） |
| Windows PowerShell 管道 BOM | 所有 `node cli.js ... \| node -e` 命令 | PowerShell 管道传 JSON 会带 BOM，用 `cmd /c "... > file"` 再读文件 |
| cache.save() 已改为 async | `src/services/cache.js` | 调用方必须 `await`（container.js、测试均已适配） |
| repl-test.js flaky | `test/repl-test.js` | runner.js 串行执行时偶发失败，单独 `node test/repl-test.js` 稳定通过；若遇到，先重跑确认 |
| `framework-patterns.js` 新增框架时 | `src/services/dep-graph/framework-patterns.js` | 路径检测逻辑按语言分块，新增语言需同时更新 `isEntry` 标记和测试 |
| `buildFileValidationAdvice` 导出链 | `validation-advice.js` → `index.js` → `cli.js` | 新增 formatter 函数必须在 `src/cli/formatters/index.js` 中显式导出，否则 cli.js 解构为 `undefined` |
| `--quiet` 不再 monkey-patch `console.error` | `cli.js` / `container.js` | `quiet` 通过 `ServiceContainer` → `FileIndex` / `DependencyGraph` 传递；信息性日志条件输出，错误日志仍用 `console.error` |
| `findDeadExports()` edges/files 降级 | `src/services/dep-graph.js` | 单文件项目（files=1）不受降级影响；多文件项目 edges/files < 0.1 时 confidence 降为 low |
| `.workspace-bridge-cache.json.bak` 泄漏到 git status | `src/tools/git-tools.js` | `getChangedFiles()` 已排除 `.bak` 备份文件，防止 audit-diff 误报 |

---

## 历史已完成（2026-05-07 bug 修复专项）

**#39: `processPending()` race condition**
- `file-index.js` 原子替换 `Set`，防止批量变更时文件更新丢失

**#40: REPL double Ctrl+C 泄漏**
- `repl.js` `shuttingDown` guard + SIGINT handler 保持到 `shutdown()` 完成 + try-catch

**#41: Python zombie 进程（无 SIGKILL fallback）**
- `spawn-ast.js` 移除冗余 `spawn timeout`，新增 `python.unref()` + SIGKILL fallback（5s）

**#42: DiagnosticsEngine 无界 timer**
- `diagnostics-engine.js` 队列驱动 `_drainCheckQueue()` 替换无界 `setTimeout` 重试，加 `MAX_SCHEDULED_CHECKS` 上限

**#43: `fs.watch` rename 不区分删除**
- `file-index.js` `rename` 且 `!filename` 时触发 `pruneDeletedCacheEntries` + `onPendingProcessed`

**#48: cache 损坏时静默丢弃（无备份）**
- `cache.js` `save()` 先备份 `.bak`，`load()` 主缓存损坏时降级读取 `.bak`

**#47: `safeRegexTest()` placebo**
- `search-tools.js` 删除死代码 `safeRegexTest()`（未被调用且无法阻止 ReDoS）

**#45: `--max-depth` 参数验证**
- `cli.js` `parseCliArgs()` 拒绝 `≤0` 的值，抛出明确错误

**#49: `--quiet` 模式 monkey-patch 消除**
- 删除 `console.error = () => {}` 全局篡改
- `ServiceContainer` / `FileIndex` / `DependencyGraph` 构造函数新增 `quiet` 选项

**#50: parser 不可用时误导性结果**
- `dep-graph.js` `build()` 完成后若 `edges/files < 0.1` 输出 WARNING 到 stderr
- `findDeadExports()` 在该场景下将无 importer 文件的 confidence 从 `high` 降级为 `low`
- 单文件项目不受此降级影响

**#54: health 命令 parser 可用性检查**
- `health-tools.js` 新增 `checkParserAvailability()`
- Node 项目检测 `@babel/parser` 是否可用

**#38: 关闭过时 issue**
- `registry-core.js` 已实际接入，零引用问题已不存在

---

## 下一步方向（按优先级排序）

> 当前 open issues 还有 **11 个实际 bug** + **7 个 feature/评审**。建议按 **P0 → P1 → P2** 修 bug，不修 feature。

### P0（资源泄漏 / 竞态 / 数据不一致）

✅ **已全部清零**（#39 → #40 → #41 → #42 → #43）

| Issue | 文件 | 问题 | 状态 |
|-------|------|------|------|
| **#39** | `file-index.js` | `processPending()` `clear()` 非原子，批量变更时文件更新丢失 | ✅ 已修复 |
| **#40** | `repl.js` | double Ctrl+C 绕过 `container.shutdown()`，watcher/diagnostic 泄漏 | ✅ 已修复 |
| **#41** | `spawn-ast.js` | Python 子进程超时只发 SIGTERM，无 SIGKILL fallback → zombie | ✅ 已修复 |
| **#42** | `diagnostics-engine.js` | linter hang 时 `setTimeout` 重入无上限 → timer 队列爆炸 | ✅ 已修复 |
| **#43** | `file-index.js` | `fs.watch` rename 事件不区分删除，dep-graph 残留 phantom edges | ✅ 已修复 |
| **#44** | `container.js` | `getContainer()` 单例非线程安全 | **影响小** — CLI-only 无并发场景，可延后 |

### P1（安全 / 缓存 / 性能）

✅ **已全部清零**（#48 → #47）

| Issue | 文件 | 问题 | 状态 |
|-------|------|------|------|
| **#48** | `cache.js` | 缓存损坏时静默丢弃全部，无备份恢复 | ✅ 已修复 |
| **#47** | `search-tools.js` | `safeRegexTest()` 是 placebo，ReDoS 仍可挂起进程 | ✅ 已修复 |

### P2（性能 / 体验）— 下一步方向

| Issue | 文件 | 问题 | 预估工作量 |
|-------|------|------|-----------|
| **#51** | `dep-graph.js` | `_scanSymbolUsageInImporters()` O(N×M)，大项目性能悬崖 | ✅ 已修复 |
| **#52** | `dep-graph.js` | `_importCache` / `_deadExportCache` 无上限 → 长期 REPL OOM | ⏸ 跳过 — 当前代码中不存在这两个缓存 |
| **#53** | `container.js` | `ensureReady()` busy-loop 50ms sleep，initError 时浪费 CPU | ✅ 已修复 |

---

## 下一会话指令

### 前置检查（必须执行）

```bash
node test/runner.js          # 期望: 76/76 PASS
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExports=0, unresolved=0, cycles=0, totalFiles≈146
```

### 本轮已完成

- #51: `_scanSymbolUsageInImporters()` 内容级缓存 + 正则缓存实例化（`SCAN_SYMBOL_CONTENT_CACHE_MAX` 防御上限）
- #53: `ensureReady()` busy-loop → 共享 Promise（消除 50ms polling，`sleep()` 删除）
- `healthScoreNumeric`: `projectHealth` 新增结构化数字字段 `{ passed, total, ratio }`，AI 无需再解析字符串
- `validation-advice.js` 拆分：274 行按 5 项职责拆分为 `metrics.js` / `phases.js` / `summary.js` / `risk-actions.js` + 精简入口

### 下一步方向

P2 性能/体验债：#51 ✅ / #52 ⏸ / #53 ✅

1. #52 跳过原因：当前代码中不存在 `_importCache` / `_deadExportCache`；如需添加结果缓存，请单独创建 issue 并补测试
2. 如需继续修其他 open bug，请按 AGENTS.md 规则执行（每次 1 个，跑 `node test/runner.js`）
3. 如需做 feature，请从 ROADMAP.md 的「产品功能缺口」或「用户体验缺口」中选

---

*Last updated: 2026-05-07*
