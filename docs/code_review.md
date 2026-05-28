# Workspace-Bridge 代码审核（第二轮，不客气版）

> 第一轮太客气了。这次往深了挖。
>
> **状态更新（2026-05-28）**：#1 Command Injection、#2 状态机 setter 后门、#3 `_precomputeOverview` 直接操作 analyzer 内部、#4 `_scanContentCache` REPL 内存泄漏、#5 `saveIncremental` metadata-only dirty 不一致、#6 BFS O(n)、#7 双重 `_finishUpdating()`、#8 baseline 解析 × 4、#10 View 暴露内部方法 已修复并验证。详情见 [CHANGELOG.md](../CHANGELOG.md) [Unreleased] §第二轮/第三轮深度代码审查修复。本文档仅保留尚未处理的问题。

---

## 🟡 设计问题（不是 bug，但不舒服）

### 9. `findCircularDependencies` 用的不是 Tarjan，而是暴力 DFS

[analyzer.js:L404-L463](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/dep-graph/analyzer.js#L404-L463)

当前实现对图中每个节点都启动一次 DFS，时间复杂度 O(V × (V+E))。Tarjan 或 Kosaraju 能做到 O(V+E)。

对于 140 文件的项目无所谓。对于 10k 文件的项目，如果有密集的依赖关系，差距会很明显。

但也要承认：当前实现的 cache 策略（`_invalidateCycles` 的细粒度 invalidation、`_cycleFiles` set 检查）非常好，避免了 watch 模式下的重复计算。所以实际痛点可能比理论分析小。

> **当前建议**：不推荐现在改。

---

## 📊 修复优先级

| # | 严重性 | 问题 | 工作量 | 状态 |
|---|--------|------|--------|------|
| 9 | **TASTE** | Cycle detection 算法 | — | 不推荐现在改 |

---

## 不变的结论

核心架构是好的。分层清晰，状态管理显式，cache 设计成熟。上面列的大部分问题是"有后果的粗心"而非"架构缺陷"。command injection 是唯一需要马上修的。
