# 系统性代码审查报告

> **审查日期**：2026-06-01  
> **基线版本**：当前 trunk（自 Wave 1-7 完成后）  
> **审查方法**：全历史提交变化回溯 + 当前代码状态静态分析  
> **结论性质**：架构边界维护问题，而非单一 bug。

---

## 审查背景

本次审查源于对 42+ commit 历史的技术债务回溯。核心发现：**封装边界在热修中被系统性 bypass**，而非新代码质量问题。具体表现为私有属性 `_aggregateCache` 的直读触手从 3 个入口持续向外蔓延，以及接口契约在分散维护中出现语义分叉。

---

## 问题详述（按严重度降序）

### P0 — `_aggregateCache` 封装没有被尊重

**状态**：✅ 已修复（2026-06-01）

**问题描述**：

`GraphAnalyzer` 早在历史 commit 中已提供 `getAggregateCache()` / `restoreAggregateCache()` / `setOverviewData()` / `clearScanCaches()` 等封装接口，但以下 3 个外部 consumer 始终直接访问私有属性：

| 文件 | 行号 | 直读内容 |
|------|------|----------|
| `src/services/container.js` | 482 | `this._depGraph?.analyzer?._aggregateCache` |
| `src/services/dep-graph.js` | 560-561 | `analyzer._aggregateCache` + `analyzer._aggregateVersion` |
| `src/tools/overview-assembler.js` | 427, 434 | `depGraph.analyzer?._aggregateCache` + `depGraph.analyzer?._aggregateVersion` |

**根本原因**：中间的热修改只修了 `container.js` 的部分引用，其余三处被遗漏。封装被溃穿到底层。

**修复动作**：
- 新增 `GraphAnalyzer.getAggregateVersion()` getter。
- 上述 4 处 `_aggregateCache` 直读 + 8 处 `_aggregateVersion` 直读全部替换为 getter 调用。
- 修复后，`_aggregateCache` 与 `_aggregateVersion` 的外部直读归零。

**防御措施**：
- 建议后续在 CI 中增加基于 `grep` 的静态检查，禁止新增 `_aggregateCache` / `_aggregateVersion` 直读：
  ```bash
  grep -rn "_aggregateCache\|_aggregateVersion" src/ --include="*.js" | grep -v "analyzer.js"
  ```
  非零输出即阻断构建。

---

### P1 — `affectedTests` heuristic / mention `terminator` 字段不对称

**状态**：✅ 已修复（2026-06-01）

**问题描述**：

- `_findAffectedTestsByMention` 返回的对象含 `terminator: true`。
- `_findAffectedTestsByHeuristic` 返回的对象**不含** `terminator` 字段。

两者语义相同（都是非图遍历发现的终点），但字段不对称。若下游 consumer 依赖 `terminator` 做过滤或排序，heuristic 匹配的结果会被错误处理。

**修复动作**：`_findAffectedTestsByHeuristic` 的 push 对象补 `terminator: true`。

---

### P1 — `process.emitWarning` 全局 monkey-patch

**状态**：✅ 已修复（2026-06-01）

**问题描述**：

`src/services/graph-db.js` 在模块顶层维护 `_originalEmitWarning`，并在 `_ensureOpen()` 中全局替换 `process.emitWarning`。作用域污染不变，多实例场景下后打开的实例会覆盖先打开实例的恢复逻辑。

**修复动作**：
- 引入 `_suppressCount` 引用计数。
- `_ensureOpen()` 中 `suppressCount++`，首次才真正 patch。
- `close()` 中 `suppressCount--`，归零时恢复原始 `emitWarning`。

---

### P1 — REPL 退出码契约被分叉

**状态**：✅ 已修复（2026-06-01）

**问题描述**：

`src/cli/repl.js` 在 5 处分散判断 `isUnknown ? 2 : 1`，没有统一到单一出口。外部 AI agent 脚本如果靠退出码分支，已处于 1/2 双轨并行状态。

**修复动作**：
- 新增 `determineReplExitCode(error, output)` 统一函数。
- 替换所有分散判断（L353 TTY 检查保持独立，其余全部纳入）。

---

### P2 — `debug.js` graph 分支 O(n×m) 副作用泄漏

**状态**：✅ 已修复（2026-06-01）

**问题描述**：

`src/cli/commands/debug.js` 的 `what === 'graph'` 分支对 `getAllFilePaths?.() || []` 做全量遍历，对每个文件调用 `getDependencies?.(file)`，复杂度 O(files × avg_edges)。无超时保护，无 size 上限；文件数一大直接 hang。

**修复动作**：
- 加 `MAX_DEBUG_GRAPH_FILES = 5000` 文件数上限。
- 加 `MAX_DEBUG_GRAPH_EDGES = 50000` 边数上限，超限截断并标记 `truncated: true`。

---

### P2 — `path.js` `temp-change-for-test` 污染

**状态**：❌ **当前 trunk 不存在**（已自行消失或被历史清理）

**问题描述**：

审查回溯时发现历史存在 `// temp-change-for-test-no-impact` 注释残留。但在当前 trunk 的 `src/utils/path.js` 中已搜索不到该字符串。仅在 `test/with-impact-test.js` 的测试辅助代码中存在（属于测试本身，非生产代码污染）。

**结论**：无需代码改动，本条目仅作记录。

---

## 修复验证

修复后必须执行：

```bash
# 1. 影响检查（确认核心文件修改无意外波及）
node cli.js impact --cwd . --file src/services/dep-graph/analyzer.js --json --quiet
node cli.js affected-tests --cwd . --file src/services/dep-graph/analyzer.js --json --quiet

# 2. 全量快速测试
npm run test:fast
# 期望：83/83 PASS
```

---

## 综合评价

> 与其说这是个代码审查的问题，不如说这是个**"架构边界维护问题"**。

代码品味铁律 L1/L2 写了很完整，但 42 commit 里 `_aggregateCache` 触手从 3 个入口一直在向外爬，封装被碰穿成筛子——这是经典的**"接口边界在热修中被 bypass"**。

对"删除 > 添加、封装 > 暴露"的品味没问题，但真正的修炼场并不在"新代码怎么写"，而在**"热修时是否愿意多花 2 分钟把过渡接口补上"**。

本次修复一次性根治了 `_aggregateCache` 的封装泄漏，并补上了三个并行的契约分叉问题（terminator、exit code、emitWarning）。后续应在 CI 中增加静态检查，防止历史重演。
