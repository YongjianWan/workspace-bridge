# 参考仓库评估

> 竞争对手与代码参考的单一事实源。评估日期：2026-05-17。

---

## 已 Clone 仓库

| 仓库 | 语言 | 形态 | 核心能力 | 与 workspace-bridge 关系 |
|------|------|------|---------|------------------------|
| [qartez-mcp](https://github.com/kuberstar/qartez-mcp) | Rust | MCP Server (41 tools) + CLI | PageRank + blast radius + co-change + 复杂度四信号融合；symbol-level impact；modification guard；ONNX 语义搜索 | 直接竞争 |
| [code-review-graph](https://github.com/tirth8205/code-review-graph) | Python | MCP Server (28 tools) + CLI | 24 语言；SQLite 递归 CTE impact；8.2× token 削减；平台自动检测 + 规则注入 | 直接竞争 |
| [CodeGraphContext](https://github.com/CodeGraphContext/CodeGraphContext) | Python | MCP Server + CLI + FastAPI + Web | 20+ 语言；Property graph (17 labels + 7 edges)；多后端图数据库 (KuzuDB/FalkorDB/Neo4j)；VS Code 扩展 | 架构参考，定位不同 |
| [GitNexus](https://github.com/...) | — | 思想参考 | 语言注册表、知识图双索引、MCP 递进工具链、框架感知 Extractor | 思想来源（已存在） |

---

## 竞争格局验证

**workspace-bridge 的核心判断被验证为正确**：

- **本地即时分析**是唯一错位竞争点（SonarQube 需 CI，qartez/CRG/CGC 需常驻进程）
- **CLI-only + 轻量**是差异化护城河（qartez 41 个 MCP tools = 认知负担，CGC Docker = 部署负担）
- **策展输出 > 原始查询**是正确的（ competitors 的 tool 膨胀已被公认为反模式）

**差距**：
- code-review-graph **token 削减能力远超 workspace-bridge**（8.2× vs ~2-3×）
- qartez **四信号融合 impact** 比 workspace-bridge 单维度 BFS 更可信
- 三 competitors 均有 **符号级分析**（function/class），workspace-bridge 只有文件级

---

## 可借鉴技术（按 ROI）

### P0: code-review-graph 的 token 削减策略

| 策略 | CRG 做法 | w-b 现状 | 行动 |
|------|---------|---------|------|
| 超紧凑入口 | `get_minimal_context` ~100 tokens | `--depth surface` 仍数百 tokens | surface 模式彻底变薄 |
| 预计算聚合 | build 时计算 risk/community 摘要表 | 每次 audit-summary 重新计算 | build 时存储聚合表 |
| 内容哈希增量 | SHA-256 跳过未变更文件 | mtime+size | 精确跳过 |
| SQLite CTE impact | 递归 CTE 查影响半径 | 内存 Map BFS | 大图更友好 |
| 工具过滤 | `--tools` allow-list 28→5 | 20+ 命令全部暴露 | 命令分层过滤 |

### P1: qartez-mcp 的算法

| 技术 | 价值 | 成本 |
|------|------|------|
| PageRank warm-start | 增量时 1-3 次迭代 vs 20 次 | 低 |
| Co-change 分析 | git 历史文件共变对 → 强化 impact | 中 |
| 符号级 impact | 函数/类级影响半径 | 高 |
| WAL cadence throttling | PASSIVE per batch + TRUNCATE per 60s | 低 |

### P2: CodeGraphContext 的架构模式

| 模式 | 价值 | 适合 w-b？ |
|------|------|-----------|
| Property graph schema | 细粒度查询 | 中（万级文件才显现收益） |
| Neighbor-aware re-linking | 增量更新 O(k) vs O(n) | 高（直接用于 audit-diff） |
| Two-pass separation | nodes → edges 消除 race | 中 |
| 多后端抽象 | 可移植性 | 低（与轻量 CLI 冲突） |

---

## 需警惕的陷阱

1. **MCP tool 膨胀** — 41/28 tools 是认知负担。w-b 的策展输出策略正确。
2. **ONNX / 语义搜索** — 重型模型依赖与轻量 CLI 定位冲突。AGENTS.md 已明确拒绝。
3. **常驻进程 / watcher** — qartez 的 watcher 设计精良，但违反 CLI-only 原则。git-diff 驱动 (<200ms) 已足够。
4. **完整 PageRank 每批重算** — 即使 warm-start 也有开销。w-b 的按需计算更 lean。

---

## 推荐行动

| 优先级 | 行动 | 来源 | 预期收益 |
|--------|------|------|---------|
| P0 | surface 模式彻底变薄：`<150 tokens` | code-review-graph | AI 直接消费 |
| P0 | 预计算聚合表：build 时存储 hotspot/stability 摘要 | code-review-graph | audit-summary O(N)→O(1) |
| P1 | PageRank warm-start | qartez-mcp | hotspot 排序更可信 |
| P1 | Co-change 分析 | qartez-mcp | impact 有数据支撑 |
| P2 | SHA-256 内容哈希 | code-review-graph | 消除 dirty worktree 误报 |
| P2 | Neighbor-aware 增量 | CodeGraphContext | 增量 <50ms |
