# workspace-bridge Roadmap

> **目标：让 AI 写代码更方便。**
>
> 不是给人类阅读的报告，是给 AI 消费的策展输出。人看摘要，AI 看结构，两者都拿到立即能行动的信息。
>
> 历史版本见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 已知限制（当前待处理）

| 问题 | 状态 | 影响 | 缓解措施 |
|------|------|------|----------|
| 混合仓库误判 | ⏳ 需配置 | prototypes/reference 被视为主线 | 使用 `.workspace-bridge.json` 标注目录角色 |
| mixed repo 技术栈启发式 | ⏳ 持续改进 | Node/Python 共存时命令可能不够精确 | 持续打磨 `stack-detector` |
| 文档与代码状态同步 | ⏳ 需人工 | ROADMAP/SESSION/CHANGELOG 可能不同步 | 自审后手动对齐 |
| 多模块 Maven 模块边界未显式标注 | ⏳ 观察 | 模块间耦合强度丢失 | 评估是否输出模块级聚合视图 |

> 历史修复记录见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 设计原则

见 [AGENTS.md §开发原则](./AGENTS.md#开发原则）。

---

## 成功标准（9 条）

| # | 成功标准 | 完成度 | 缺口 |
|---|----------|:------:|------|
| 1 | 混合仓库结果稳定 | 80% | 无配置时 reference/prototype 仍污染结果 |
| 2 | TS/Python/前端项目可信主线结论 | 90% | React hooks 隐式依赖、Java 多模块 AST 深度 |
| 3 | 从"哪里有问题"推进到"怎么改、测什么" | 95% | 极端框架（Nuxt layers）的 fileSpecificAdvice 精度 |
| 4 | symbol-level impact 可用 | 90% | 仅 C/C++ regex 无 functionRecords |
| 5 | 大仓库性能可接受 | 97% | 双边冗余内存（路径整数化评估中）、chunked 解析（实测 OOM 时触发）|
| 6 | 可选外部工具后端（Semgrep）| 100% | — |
| 7 | 全栈语言覆盖（9 种）| 100% | — |
| 8 | 全栈 AST 覆盖（9/9 语言）| **100%** | — |
| 9 | 闭环验证（P8）| **100%** | onGitStaged 触发、失败信息注入 AI 上下文 |

---

## 下一步方向（观察期）

> 路线 A–J 全部完成。当前进入**观察期**，无新的核心功能承诺。
>
> 剩余问题是**工程结构瓶颈**与**产品体验缺口**（见 TECH_DEBT.md）。

### 综合路线：大仓库内存与性能 + 路径体系一致性

| 阶段 | 内容 | 状态 | 收益 | 风险 | 工作量 |
|------|------|------|------|------|--------|
| ~~P77~~ | ~~`findUnresolvedImports` Windows 路径格式不一致~~ | ✅ 已完成 | — | — | — |
| **阶段 1 修正** | 路径整数化（`graph`/`reverseGraph` 存整数 ID） | ⏳ 待评估 | 100k 边内存从 ~16–24MB → ~2–3MB | 中（动存储格式） | ~150 行 |
| **阶段 2** | Chunked 解析内存预算（~20MB/块） | ⏳ 实测触发 | 10k+ 文件项目首次索引不 OOM | 中 | ~80 行 |
| **阶段 4** | 增量缓存写入（JSON patch / SQLite） | ⏸ 暂缓 | 改动 1 个文件不写 50MB | 高（架构重） | — |

**决策逻辑**

1. **阶段 1**：P77 完成后路径处理范式统一，再做整数化时根因更清晰；整数化是后续 chunked 解析的内存预算前提。
2. **阶段 2 实测触发**：当前无 10k+ 文件 OOM 实测反馈，预防性投入性价比低；若阶段 1 后仍有 OOM 报告，立即触发。
3. **阶段 4 暂缓**：`cache.save()` 只在 shutdown/手动调用时触发，不是运行时瓶颈；SQLite 替代是架构重决策，观察期不做。

---

### L3 品味问题（4 项活跃）

按 [TECH_DEBT.md](./docs/TECH_DEBT.md) 记录：

| 位置 | 问题 | 优先级 |
|------|------|--------|
| `git-tools.js` | `getChangedFiles()` 手动字符级解析 | 低 |
| `overview-tools.js` | `renderOverviewDashboard` 中 HTML/CSS 裸数字 | 低 |
| `js.js` | `parseJavaScriptAST` ~265 行、`parseJavaScript` regex ~147 行 | 低 |
| `path.js` | `hasPathSegment` 语义陷阱：只取 segment 最后一级 | 低 |

---

### 性能瓶颈（大项目 >10k 文件，未修复项）

| 级别 | 位置 | 问题 | 量化影响 | 建议修复 |
|:---|:---|:---|:---|:---|
| P1 | `dep-graph.js:127-128` | `graph` + `reverseGraph` 双边冗余 | 100k 条边 → **16–24MB** 纯冗余 | 评估是否可改为单图 + 按需反向遍历 |
| P1 | `cache.js:112,157` | 缓存加载/保存双重内存峰值 | 50MB 缓存文件 → 峰值 **100MB+** | 接受现状（工程量大收益小），或评估 streaming JSON parser |
| P2 | `project-map.js:226-320` | edges Map 内存爆炸 | 100k edges → **30–50MB** | compact 模式提前聚合，跳过 rawEdges 实例化 |
| P2 | `cache.js` | 无增量写，每次 `save()` 全量序列化 | 改动 1 个文件也写 50MB | 评估增量 JSON patch 或 SQLite 替代 |

> 已修复项（P74 流式扫描 / P75 缓存 I/O / Python 子进程限流 / git log 限流）见 [CHANGELOG.md](./CHANGELOG.md)。

---

### 用户体验缺口

| 维度 | 问题 | 当前表现 | 理想表现 |
|------|------|----------|----------|
| 配置 | ⏳ 待评估 | `.workspace-bridge.json` schema 校验可更严格 | 未知字段/类型错误警告（非阻塞） |
| 进度 | ⏳ 待评估 | 超大仓库（>10k 文件）索引进度粒度不足 | 按百分比或按模块打印进度 |

---

## 长期方向（非承诺，见路线 I-2 深度评估）

| 方向 | 价值 | 成本 | 触发条件 |
|------|------|------|----------|
| 符号级调用解析（Call-Resolution DAG） | 高 | 很高 | 需要回答"谁调用了 `UserService.validate()` 的第几个重载" |
| 字段读写追踪（ACCESSES 边） | 高 | 高 | AST 级字段访问提取 + 接收者类型推断 |
| CI Schema Parity 测试 | 中 | 低 | 下一次 schema 变更前 |

> 路线 I-2 GitNexus 深度对比的 9 项发现中，数值 confidence / yieldToEventLoop / confidenceSource 标签 / git-aware staleness / import 策略链抽象 5 项已吸收并完成。详见 [CHANGELOG.md](./CHANGELOG.md)。
