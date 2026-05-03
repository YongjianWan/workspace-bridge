# workspace-bridge Roadmap

> 目标：把 `workspace-bridge` 从"可用的审计 CLI"推进成"能补足 AI 项目视角短板的工程脚手架"。
> 
> 历史版本见 [CHANGELOG.md](./CHANGELOG.md)；历史技术方案见 [docs/plans/](./docs/plans/)。

---

## 已知限制（当前待处理）

| 问题 | 状态 | 影响 | 缓解措施 |
|------|------|------|----------|
| 混合仓库误判 | ⏳ 需配置 | prototypes/reference 被视为主线 | 使用 `.workspace-bridge.json` 标注目录角色 |
| mixed repo 技术栈启发式 | ⏳ 持续改进 | Node/Python 共存时命令可能不够精确 | 持续打磨 `stack-detector` |
| 文档与代码状态同步 | ⏳ 需人工 | ROADMAP/SESSION/CHANGELOG 可能不同步 | 自审后手动对齐 |

> 已修复历史见 [CHANGELOG.md](./CHANGELOG.md)。

---

## Phase 0-1：基础止血（已完成）

P0T1–P0T5 全部交付。详见 [CHANGELOG.md](./CHANGELOG.md) 0.8.2–0.9.0。

---

## 收敛里程碑：从 0.8.0 到 0.8.2+

> 以下内容来自 `docs/plans/2026-05-05-two-week-convergence.md`，已融入主文档。

### Phase 0：基础止血（已完成）
P0T1–P0T5 全部交付。

### W1：可信度与命令正确性（已完成）
| 任务 | 状态 |
|------|------|
| W1T1 Java dead-export 保守策略 | ✅ |
| W1T2 Gradle Checkstyle 命令 | ✅ |
| W1T3 回归测试补全 | ⚠️ 部分 |
| W1T4 文档诚实化 | ✅ |

### W2：自审可用性与工程收口（已完成）
| 任务 | 状态 |
|------|------|
| W2T1 官方自审脚本 | ✅ |
| W2T2 命令建议质量收口 | ✅ |
| W2T3 JSON 消费链路稳定 | ✅ |
| W2T4 发布前总回归 | ✅ |

---

## 从 0.8 到 1.0 的关键判断

> 骨架很好，但还在"证明我能造轮子"的阶段。变成产品需要"承认自己不是全能"的觉悟。

### 外部工具集成策略

见 [AGENTS.md §外部工具策略](./AGENTS.md#外部工具策略架构决策）。

### 技术栈评估

- **JS/TS AST**：`@babel/parser` 是对的，保持
- **Python AST**：当前用标准库 `ast`，建议评估 **tree-sitter**（更快、语言覆盖更广、native binding 和 `better-sqlite3` 不冲突）
- **Java AST**：`javalang` 够用，暂不替换

### 多语言扩展 ADR（已完成）

以下决策来自 `docs/plans/2026-04-28-java-and-polyglot-support.md`，已落地：

| 决策 | 内容 | 理由 |
|------|------|------|
| ADR-1：Java AST 解析器 | 选 `javalang`（Python），不用 tree-sitter | 与现有 Python AST 子进程模式一致；不污染 package.json |
| ADR-2：Kotlin/Go/Rust | 只做 regex 级（L2），不做 AST | 真实场景待验证；regex 已满足 80% audit-overview 需求 |
| ADR-3：语言插件注册表 | 本次不做，保留硬编码链 | 当前 6 种语言维护成本可接受；注册表重构 >3 天，与收敛目标冲突 |

---

## 未竟事项（按价值排序）

### P1：提升分析可信度
- [x] Java/Go/Rust 语言级使用点解析
- [x] Go/Rust 包级解析器
- [x] Java 方法级 dead-export 误报消除

### P1.5：全局项目地图（audit-map）— ✅ 完成
- [x] `audit-map` 命令（tree + edges + issueOverlay）

### P2：提升命令可执行性
- [x] Rust workspace 子 crate 支持（`cargo test -p`）
- [x] mixed repo 命令精度提升（`classifyChangeType` 单一数据源 + `codeTargets` 过滤）
- [x] CLI 命令完整性补全（`stats` / `dependents` / `dependencies`）
- [ ] **CLI 瘦身（1.0 breaking change）** — 详见下方「1.0 发布准备」
- [x] Gradle 任务发现
- [x] Go module path 聚合（嵌套 `go.mod`）
- [x] Rust 模块级测试过滤

### P3：提升输出可解释性
- [x] CJS 符号解析补全
- [x] 内部函数改动→测试映射
- [x] 影响路径解释字段（`via` / `importedSymbols` / `reason`）
- [x] 变更影响解释链（`impactExplanations`）
- [x] 耦合拆分建议去模板化
- [x] 统一能力矩阵输出（`languageSupport`）

### P4：技术债
- [x] 超标文件拆分（`parsers/` 目录、`formatters/` 目录）
- [ ] Kotlin AST 级支持
- [x] 大仓库性能专项优化（>10k 文件）— 详见 P5，Step 2 + Step 3 已完成
- [ ] 插件化解析器注册表

### P5：大项目体验优化（REPL + 缓存 + Watcher）

> 问题：小项目全量 JSON 输出可用，大项目（10k+ 文件）时 `audit-map`/`audit-overview` 的 edges 数组爆炸，`audit-diff` 输出数千行 JSON，且每次 CLI 调用都重建 dep-graph。
>
> 基础设施现状：`file-index.js` 已有 `fs.watch` + `pendingUpdates` debounce 骨架（`startWatching()`/`processPending()`），但只更新 fileMetadata，未接到 dep-graph；`cache.js` ~~只存了 `{mtime, size, hash}`~~ 已扩展 `parseResults` Map（v0.9.13）。

#### Step 1：REPL / 精确查询模式（✅ 已完成 v0.9.13）

- **改动**：`cli.js` 新增 `repl` case；新增 `src/cli/repl.js`（readline 循环 + 命令解析 + 精简输出）
- **收益**：大项目不用每次等全量 JSON，只返回请求字段；dep-graph 常驻内存，单次查询 <100ms
- **验收**：启动后输入 `impact src/utils/path.js`，<100ms 返回精简结果

#### Step 2：缓存解析结果（✅ 已完成 v0.9.13）

- **改动**：`cache.js` `CACHE_VERSION` 升级到 3，新增 `parseResults` Map；`dep-graph.js` `build()` 按 mtime 分离缓存命中与需解析文件；`file-index.js` 同步清理 stale parseResults。
- **实测**：当前仓库（82 文件）冷启动 dep-graph 289ms → 热启动 3ms（100% cached），约 **96 倍**加速。

#### Step 3：激活 Watcher（✅ 已完成 v0.9.13）

- **改动**：`file-index.js` `processPending()` 末尾新增 `onPendingProcessed` 批量回调；`container.js` 注册 `fileIndex.onPendingProcessed → depGraph.updateFiles`；`dep-graph.js` 新增 `updateFiles()` 增量更新方法。
- **实测**：新增 1 个文件后 `audit-summary`，`[DepGraph] Built in 10ms: 83 files (99% cached)`。

---

## 已归档里程碑

### 1.0 发布（已完成 2026-05-02）

- CLI 瘦身（23 → 8）取消，仅删除 `deps` 命令
- `package.json` 升至 `1.0.0`
- Release Notes + CHANGELOG 归档

---

## 设计原则

见 [AGENTS.md §开发原则](./AGENTS.md#开发原则）。

---

## 成功标准

1. 对混合仓库结果稳定（不误报）
2. TS/Python/前端项目都能给出可信主线结论
3. 能从"哪里可能有问题"推进到"该怎么改、改完测什么"
4. symbol-level impact 可用
5. 大仓库性能可接受（<30s 索引，首次全量 <5min）
6. **可选外部工具后端**（Semgrep adapter 可插拔）

---

---

## 已归档计划

以下历史技术方案已完成并融入本文档，原始文件保留供追溯：

- `docs/plans/2026-04-28-java-and-polyglot-support.md` — Java AST 级支持与多语言扩展（已融入"技术栈评估 / ADR"）
- `docs/plans/2026-05-05-two-week-convergence.md` — 两周收敛计划（已融入"收敛里程碑"）

---

*Last updated: 2026-05-02（v0.9.14 耦合假阳性收敛 + entry 排除 + CLI 错误处理加固 + REPL 健壮性修复）*
