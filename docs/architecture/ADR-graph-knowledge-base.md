# ADR: workspace-bridge 从分析工具到代码知识库

> 状态：草案（Draft）  
> 日期：2026-05-20  
> 决策：SQLite 作为核心图存储，不引入图数据库  
> 影响：全架构层（SQLite schema、Watcher、CLI、audit-assembler）

---

## 背景

workspace-bridge 当前的核心流程是"每次 CLI 命令冷启动 → 读 SQLite parseResults → 内存重建依赖图 → BFS/DFS 查询 → 返回 → 扔掉"。即使 parseResults 100% cache hit，仍需 O(n) 重建 reverseGraph 和预计算 aggregates。

本轮（2026-05-20）已实现：
- `saveIncremental()` 增量写入（避免全量清表重写）
- `updateFiles()` 增量更新内存图（文件变更时只 re-parse 变更文件）
- `fileIndex` 文件监听 + `onPendingProcessed` 批量回调

**缺失的最后一块拼图**：内存中的图结构和预计算结果没有持久化。Watcher 更新后不落盘，CLI 每次仍重建。

---

## 决策

**用 SQLite 作为核心图存储和预计算存储，不引入图数据库。**

### 为什么不是图数据库？

| 维度 | SQLite (better-sqlite3) | KuzuDB 等嵌入式图库 |
|------|------------------------|---------------------|
| 依赖大小 | 已有，0 新增 | ~50MB+ native binding |
| Windows 编译 | 无风险 | node-gyp / prebuild 风险 |
| 查询语言 | SQL（递归 CTE 已验证 1ms 级） | Cypher（需要学习成本） |
| 增量更新 | WAL + INSERT OR REPLACE 已验证 | 增量更新文档稀缺 |
| 表格查询 | 绝对主场 | 需要把简单 SELECT 包装成 Cypher |
| 调试 | `sqlite3 cache.db` 直接查 | 需要专用工具 |

workspace-bridge 当前是**文件级**图（节点 = 文件），即使在 1329 文件的 GitNexus 项目上，节点数也仅千级。SQLite `WITH RECURSIVE` 处理这个规模绰绰有余。若未来进入符号级 call graph（十万级节点），再考虑迁移，数据迁出只需 `SELECT * FROM edges`。

> **不为未来可能的需求付现在确定的成本。**

---

## 目标架构

```
[文件系统 Watcher] → [增量分析器] → [SQLite 知识库]
                                          ↑
                              AI 直接查库 / CLI 薄查询层
```

- **Watcher**：写入端。文件保存 → 增量解析 → 增量更新边 → 预计算影响半径/测试映射 → 写入 SQLite。
- **CLI**：读取端。优先查预计算表，fallback 到内存图重建。

---

## Schema 设计

### 核心图结构

```sql
-- 文件节点（从 file_metadata 扩展，统一节点视角）
CREATE TABLE IF NOT EXISTS nodes (
  file TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'source',   -- 'source' | 'test' | 'config' | 'generated' | 'entry'
  role TEXT,                             -- 项目上下文推断的角色
  lang TEXT,                             -- 'js' | 'ts' | 'java' | ...
  mtime INTEGER,
  hash TEXT,
  parse_mode TEXT,                       -- 'ast' | 'regex' | 'none'
  line_count INTEGER
);

-- 依赖边（imports + implicit framework edges）
CREATE TABLE IF NOT EXISTS edges (
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  edge_type TEXT NOT NULL DEFAULT 'import',  -- 'import' | 'implicit-framework' | 'package'
  confidence REAL NOT NULL DEFAULT 1.0,      -- 0.0-1.0，用于 heuristic edges
  PRIMARY KEY (source, target, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edge_type);
```

### 预计算维度

```sql
-- 文件级影响半径（预计算 BFS 结果）
CREATE TABLE IF NOT EXISTS precomputed_impact (
  source TEXT PRIMARY KEY,
  depth INTEGER NOT NULL DEFAULT 3,
  impact_count INTEGER NOT NULL,
  impact_json TEXT NOT NULL,  -- JSON array of {file, level, via}
  computed_at INTEGER NOT NULL,
  version TEXT NOT NULL       -- hash/mtime 指纹，用于 staleness 校验
);

-- 测试映射（预计算 affected-tests）
CREATE TABLE IF NOT EXISTS precomputed_tests (
  source TEXT PRIMARY KEY,
  affected_tests_count INTEGER NOT NULL,
  affected_tests_json TEXT NOT NULL,  -- JSON array of {file, distance}
  computed_at INTEGER NOT NULL,
  version TEXT NOT NULL
);

-- 聚合摘要（precomputeAggregates 结果）
CREATE TABLE IF NOT EXISTS precomputed_aggregates (
  key TEXT PRIMARY KEY,  -- 'deadExports' | 'unresolved' | 'cycles' | 'stats' | 'hotspots' | 'stability'
  value_json TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  file_count INTEGER NOT NULL  -- 用于 staleness 校验
);

-- 多维指标（PageRank、co-change、风险分、热点分）
CREATE TABLE IF NOT EXISTS metrics (
  file TEXT NOT NULL,
  dimension TEXT NOT NULL,  -- 'pagerank' | 'cochange_score' | 'risk_score' | 'hotspot_score'
  value REAL NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (file, dimension)
);

-- 安全发现（security-tools 结果）
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL,   -- 'high' | 'medium' | 'low'
  data_json TEXT NOT NULL,
  detected_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_findings_file ON findings(file);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);

-- 测试映射（source → test 的直接关系，用于 O(1) 查询）
CREATE TABLE IF NOT EXISTS test_map (
  source TEXT NOT NULL,
  test_file TEXT NOT NULL,
  signal TEXT NOT NULL DEFAULT 'import',  -- 'import' | 'symbol' | 'framework'
  distance INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (source, test_file)
);
CREATE INDEX IF NOT EXISTS idx_test_map_source ON test_map(source);

-- HTTP 路由映射（框架感知）
CREATE TABLE IF NOT EXISTS routes (
  file TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  framework TEXT NOT NULL,
  handler TEXT,             -- 函数名
  PRIMARY KEY (file, method, path)
);
CREATE INDEX IF NOT EXISTS idx_routes_path ON routes(path);
```

### 向后兼容

- 所有新增表使用 `CREATE TABLE IF NOT EXISTS`
- 旧版 CLI 读不到新表 → 正常 fallback 到 depGraph 内存重建
- 现有 `file_metadata`、`parse_results`、`symbol_index`、`diagnostics` 表保留，逐步向 `nodes` + `edges` 迁移

---

## 实施路线

### Phase 1：热缓存守护者（Hot Cache Keeper）

**目标**：Watcher 进程成为"写入端"，CLI 启动时 parseResults 100% cache hit。

| 改动 | 文件 | 说明 |
|------|------|------|
| `updateFiles()` 后触发 save | `src/services/dep-graph/builder.js` | 在 `finally` 块中 `await cache.save()`，把增量 parseResults 落盘 |
| Watcher 静默化 | `src/cli/watch.js` | 删除 `formatWatchOutput` 终端打印，保留 JSON Lines；默认 `--quiet` |
| 自动 save 兜底 | `src/services/file-index.js` | `processPending()` 完成后，若 dirty=true 自动触发 `cache.save()` |

**收益**：AST 解析时间降为 0；改动量 ~20 行；风险极低。

### Phase 2：Graph 边持久化

**目标**：把 `graph` / `reverseGraph` 写入 `edges` 表，CLI 启动时跳过 `buildReverseGraph()`。

| 改动 | 文件 | 说明 |
|------|------|------|
| Schema 扩展 | `src/services/graph-db.js` | 新增 `nodes`、`edges` 表 DDL；`saveEdges()` / `loadEdges()` |
| 写入端 | `src/services/dep-graph/builder.js` | `build()` 完成后序列化 edges；`updateFiles()` 增量更新 edges |
| 消费端 | `src/services/dep-graph.js` | 新增 `loadGraph()`：从 SQLite 加载 edges 恢复 graph + reverseGraph |
| 集成 | `src/services/container.js` | `_initDepGraph()` 优先 `loadGraph()`，缺失时 fallback 到 `build()` |

**收益**：跳过 O(n) reverseGraph 重建；为 Phase 3 铺好 schema 基础。

### Phase 3：预计算持久化

**目标**：BFS/DFS 查询结果预计算后存入 SQLite，CLI 命令优先 SELECT。

| 改动 | 文件 | 说明 |
|------|------|------|
| Schema 扩展 | `src/services/graph-db.js` | 新增 `precomputed_impact`、`precomputed_tests`、`precomputed_aggregates`、`metrics`、`findings`、`test_map` |
| Watcher 写入 | `src/services/dep-graph/builder.js` | `updateFiles()` 完成后，对变更文件重新预计算 impact/tests，写入 SQLite；重新计算 aggregates |
| CLI 薄查询层 | `src/cli/commands/*.js`、`src/tools/audit-assembler.js` | 优先查预计算表，缺失时 fallback 到 depGraph 实时计算 |

**收益**：`impact --file foo.js` 从"7 秒"降到"1ms（预计算命中时）"；AI 消费者高频查询大幅加速。

### Phase 4：CLI 彻底薄化（可选/远期）

**目标**：CLI 命令不再初始化 depGraph，只查 SQLite。

| 前提 | 说明 |
|------|------|
| watch 进程成为"必须" | 或首次运行时自动后台启动 watcher |
| 所有预计算数据可用 | SQLite 中 impact/tests/aggregates 完整且 fresh |

**改动**：`container.initialize()` 检测到热 SQLite 时跳过 `_initDepGraph()`；CLI 直接通过 `cache` 查询。

---

## 并发与一致性

- **写入**：watch 进程独占写入（`saveIncremental` 单事务）
- **读取**：CLI 命令只读（`better-sqlite3` 支持多进程并发读）
- **Staleness**：预计算表带 `version`（hash/mtime 指纹）和 `computed_at`，CLI 查库时校验，stale 则 fallback 重建
- **无需 IPC/文件锁**：SQLite WAL 模式天然支持一写多读

---

## 测试策略

| 层级 | 测试内容 |
|------|---------|
| 单元 | `GraphDB.saveEdges()` / `loadEdges()` 正确性；增量更新后 edges 一致性 |
| 集成 | Watcher 修改文件 → SQLite edges 更新 → CLI `loadGraph()` 读取 → 结果与内存重建一致 |
| 回归 | 大项目（GitNexus 1329 文件）冷启动时间对比；预计算命中率统计 |
| 并发 | 多个 CLI 实例同时读 + watch 进程写，无 SQLite 锁错误 |

---

## 风险与回退

| 风险 | 缓解 |
|------|------|
| SQLite schema 膨胀 | 旧表保留，新表 `IF NOT EXISTS`；旧版 CLI 完全兼容 |
| 预计算 stale | 带 version 指纹校验，stale 时 fallback 到现有内存重建逻辑 |
| Watcher 崩溃丢失更新 | `file-index.js` 自动 save 兜底；进程重启后从 SQLite 恢复 |
| 大项目 edges 表过大 | 千级节点 × 平均 10 条边 = 万级 rows，SQLite 无压力 |

---

## 与现有规划的关系

- **ROADMAP.md P1（AI 预消化输出）**：预计算持久化是 `--depth`、`--token-budget` 的基础设施——薄查询层才能快速响应分级裁剪
- **AGENTS.md "CLI-only"**：不违反。Watcher 仍是 CLI 命令（`workspace-bridge watch`），无协议层/网络端口
- **本轮已完成的增量写入**：`saveIncremental()` 是 Phase 1-2 的写入基础设施，直接复用
