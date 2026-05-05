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

> 已修复历史见 [CHANGELOG.md](./CHANGELOG.md)。

---

## Phase 0-1：基础止血（已完成）

P0T1–P0T5 全部交付。详见 [CHANGELOG.md](./CHANGELOG.md) 0.8.2–0.9.0。

---

## 收敛里程碑：从 0.8.0 到 0.8.2+

> 以下内容来自历史计划文档，已融入主文档。

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

- **JS/TS AST**：`@babel/parser` 保持
- **Python AST**：标准库 `ast` 保持；其他语言已引入 web-tree-sitter，Python 暂不改（零依赖优势 + 够用）
- **Java AST**：`javalang` 保持；子进程模式已验证稳定
- **Go/Rust/Kotlin/C/C++ AST**：`web-tree-sitter` WASM 统一方案（见 P4-AST）

### 多语言扩展 ADR（已完成）

以下决策来自历史计划文档，已落地：

| 决策 | 内容 | 理由 |
|------|------|------|
| ADR-1：Java AST 解析器 | 选 `javalang`（Python），不用 tree-sitter | 与现有 Python AST 子进程模式一致；不污染 package.json |
| ADR-2：Kotlin/Go/Rust/C/C++ | ~~只做 regex 级（L2），不做 AST~~ → **转向 tree-sitter WASM AST** | 用户授权引入依赖；`web-tree-sitter@0.25.3` + `tree-sitter-wasms@0.1.13` 已验证 Windows 可用；统一架构优于子进程碎片化 |
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
- [x] **CLI 瘦身（1.0）** — 已完成：仅删除 `deps` 命令，保留其余命令
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
- [x] 大仓库性能专项优化（>10k 文件）— 详见 P5，Step 2 + Step 3 已完成
- [x] 插件化解析器注册表 — **决策更新：提前重构**（原定为"超 10 种时"，现 6→9 种途中即做，降低风险）
- [ ] **P4-AST：全栈 AST 覆盖** — 当前 6/9 语言为 AST（JS/TS、Python、Java、Go、Vue[复用JS AST]、Svelte[复用JS AST]），3 语言为 regex（Rust、Kotlin、C/C++）
  - [x] Go AST（`tree-sitter-go`）— ✅ v1.0.4 已完成（`go-ast.js` + `tree-sitter.js` 基础设施已验证）
  - [ ] Rust AST（`tree-sitter-rust`）— **当前阶段**
  - [ ] Kotlin AST（`tree-sitter-kotlin`）— ⚠️ `tree-sitter-wasms@0.1.13` 不含 kotlin wasm，需先解决语言包来源
  - [ ] C/C++ AST（`tree-sitter-cpp`）— 最后做（复杂度最高）

  > **诚实的前提**：全 AST 是"理想目标"，不是"必须完成"。当前 regex 已满足 80% 的 audit-overview 需求。P4-AST 的价值在于**消除 dead-export 误报**和**提升 import 解析精度**，而不是追求语法分析的完整性。

  #### 技术选型：为什么选 WASM 而非 native binding

  GitNexus 用 `tree-sitter` native binding（`tree-sitter-go` 等 npm 包），结果陷入**版本兼容性地狱**：
  - `tree-sitter-c` 在 Windows 下 segfault（#1242）
  - 每个 grammar 的 prebuild `.node` 与 runtime ABI 必须严格匹配
  - GitNexus 被迫写 798 行的 Python 脚本 + Daily CI workflow 监控 15 个 grammar 的 peer-dep 兼容性
  - 当前 runtime 锁定在 `0.21.x`，升级 `0.25.x` 被大量 grammar 卡住

  **WASM 方案的本质**：用包体积（`tree-sitter-wasms` ~50MB）和解析速度换取**安装可靠性**。没有 `.node` 编译，没有 ABI 噩梦。

  #### 已验证的基线

  - `web-tree-sitter@0.25.3` + `tree-sitter-wasms@0.1.13`，Windows/Node 22 四语言 wasm 加载 + Query API 全部通过
  - `web-tree-sitter@0.26.8` 与 `tree-sitter-wasms@0.1.13` **ABI 不兼容**（wasm 加载崩溃），已锁定 `0.25.3`
  - dep-graph.js 已支持 `entry.async`，parser 接口改 async **不破坏调用方**

  #### 实现策略

  1. **Tree-sitter Query 为主**（比手写 visitor 代码量 -70%）
  2. **手写 visitor 为辅**（C/C++ function name 解包链、Rust visibility 判断等 Query 无法表达的局部逻辑）
  3. **失败自动 fallback regex**（wasm 加载失败 / query 编译失败 / 解析异常 → 静默降级到现有 regex，parseMode 标记为 `regex`）
  4. **语言对象 + Query 对象懒加载缓存**（首次加载后复用，不重复读 wasm 文件）

  #### 从 GitNexus 学到的 5 个具体模式

  | # | 模式 | 价值 | 可移植性 |
  |---|------|------|----------|
  | 1 | Tree-sitter Query 声明式提取 | 代码量 -70%，跨语言一致 | **极高** — query 文本可直接复用 |
  | 2 | Export Checker 纯函数 `(node, name) => boolean` | 隔离语言特定的 export 判断 | **极高** — Go/Rust/Kotlin/C++ 逻辑直接抄 |
  | 3 | C/C++ Function Name 解包链 | 处理 pointer/reference/qualified/parenthesized 嵌套 | **极高** — ~130 行逻辑直接参考 |
  | 4 | Parser Loader 优雅降级 | `GrammarSource` 配置表 + `loadCache` + `logged` Set | **中** — 思路可用，复杂度可简化 |
  | 5 | Language Provider 配置表封装 | `defineLanguage()` 统一封装，零 if-else | **中** — 借鉴哲学，不需要 10+ extractor 重型框架 |

  #### 风险清单（诚实版）

  | 风险 | 严重性 | 缓解措施 | 止损条件 |
  |------|--------|----------|----------|
  | `web-tree-sitter` 升级后 wasm 不兼容 | **高** | 锁定 `0.25.3`；升级时必须全量回归 4 语言 parser 测试 | 若未来版本无法找到兼容的 `tree-sitter-wasms`，回退到 regex |
  | `tree-sitter-wasms` 包体积 ~50MB | 中 | 作为 `dependencies` 正常安装；对 publish 无影响 | 若用户投诉安装体积，评估按需加载 wasm（CDN / 运行时下载）|
  | Query 无法表达复杂逻辑（如 Go 大写首字母判断） | 低 | Query 提取后接纯函数后处理 | 不止损，这是设计预期 |
  | 维护成本翻倍（9 语言 × AST + regex fallback） | 中 | 仅 4 语言新增 AST 路径；JS/TS/Python/Java 保持现状 | 若 AST 路径的 bug 数超过 regex 路径的 2 倍，删除 AST 回退 regex |
  | Tree-sitter grammar 版本漂移导致 query 失效 | 中 | Query 编译时捕获异常 → fallback regex | 同风险 1 |

  #### 放弃条件

  P4-AST 不是宗教。以下任一条件触发时，**立即停止新增语言 AST，已有 AST 保留但不继续投入**：
  1. 任一语言 AST 路径的 issue 数 > 3 且无法在 1 轮内修复
  2. `web-tree-sitter` 或 `tree-sitter-wasms` 出现无法绕过的 breaking change
  3. 发现 WASM 解析速度比 regex 慢 >10 倍（大文件场景）
  4. 用户明确反馈"零依赖"比"AST 精度"更重要

  #### 阶段性交付（非一次性）

  每完成一个语言就合并，立刻释放价值：
  1. **Go**（最简单：import/function/type 结构清晰，query 极简）
  2. **Rust**（pub 判断明确，impl block 需额外处理）
  3. **Kotlin**（interface vs class 区分、primary constructor property）
  4. **C/C++**（最复杂：pointer/reference/qualified 链，最后做）

  每阶段验收：`node test/runner.js` 53/53 PASS + `node cli.js audit-summary --cwd . --json --quiet` healthScore=5/5。

### P5：大项目体验优化（REPL + 缓存 + Watcher + Compact）

> 问题：小项目全量 JSON 输出可用，大项目（10k+ 文件）时 `audit-map`/`audit-overview` 的 edges 数组爆炸，`audit-diff` 输出数千行 JSON，且每次 CLI 调用都重建 dep-graph。
>
> **Compact 模式设计原则**：压缩不是截断，是**面向 AI 消费的策展（curation）**。
> - **问题优先**：先给 severity + nextSteps，让 AI 知道要不要继续看
> - **分层策展**：分 `critical` / `warn` / `info` 三级，AI 按层决策
> - **数量即信号**："N 个 dependents" 比列出 N 个名字更有信息量，除非 N 很小
> - **保留入口**：entry files 和 test files 永远显式命名，因为它们是动作入口
> - **可下探**：compact 不删数据，细节移到"按需查询"路径（如 `impact --file`）
>
> **当前状态**：`audit-map --compact` ✅ / `audit-diff --compact` ✅ / `watch --compact` ✅ / REPL `issues` ✅ / `top` ✅ 全部完成。
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
- **实测**：新增 1 个文件后 `audit-summary`，`[DepGraph] Built in 10ms: 83 文件 (99% cached)`。

---

## P6：语言扩展（全栈支持）

> 个人全栈开发场景驱动：C/C++ 后端/嵌入式 + Vue/Svelte 前端需要纳入依赖图。

| 语言 | 策略 | 状态 |
|------|------|------|
| **C / C++** | ~~regex~~ → **tree-sitter AST**（过渡中） | ✅ v1.0.4 regex 已完成，AST 进行中 |
| **Vue SFC** | 提取 `<script>` 复用 JS/TS AST parser | ✅ 已完成 v1.0.4 |
| **Svelte** | 提取 `<script>` 复用 JS/TS AST parser | ✅ 已完成 v1.0.4 |
| **HTML / CSS** | 不纳入（无 import 语义）| ❌ 跳过 |

> **策略演进**：v1.0 前坚持 regex 以维持零依赖；v1.0+ 用户授权引入依赖，转向 `web-tree-sitter` WASM 统一 AST 方案（见 P4-AST）。
> ~~解析器注册表在超 10 种语言时统一重构~~ → 已提前重构（见 SESSION.md），当前 9 种全部接入注册表。

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
7. **全栈语言覆盖**（JS/TS/Python/Java/Kotlin/Go/Rust/C/C++/Vue/Svelte）
8. **全栈 AST 覆盖**（除 Rust/Kotlin/C/C++ 外已全部 AST）

---

## 已归档计划

以下历史技术方案已完成并融入本文档，原始文件保留供追溯：

- 历史计划：Java AST 级支持与多语言扩展（已融入"技术栈评估 / ADR"）
- 历史计划：两周收敛计划（已融入"收敛里程碑"）

---

---

## 其他未完成项

> 非核心承诺，不影响 1.0 定位，但持续提升工程健康度。

### 测试覆盖率量化
- 当前 **无** istanbul/c8/nyc 等覆盖率工具，行/分支覆盖率未知
- 53 个测试文件全部为绿不代表高覆盖，需引入 `c8` 生成报告

### L3 品味问题（10 项活跃）
按 [TECH_DEBT.md](./docs/TECH_DEBT.md) 记录，优先级如下：

| 问题 | 严重程度 | 文件 |
|------|---------|------|
| `buildValidationAdvice` **274 行** 承担 5 项独立子工作 | 🔴 高 | `validation-advice.js` |
| `dep-graph.js` 8 个函数 >30 行 | 🟡 中 | `dep-graph.js` |
| `js.js` 2 个 visitor 超长（74 行 / 42 行）| 🟡 中 | `js.js` |
| `file-index.js` 4 个函数 >30 行 | 🟡 中 | `file-index.js` |

> AGENTS.md 已确认 `dep-graph.js` 内聚优先、不物理拆分，但**函数级拆分**仍有空间。

### GitNexus 高价值模式提取（待排期）
已完成可行性评估，以下模式按 ROI 排序，可随时插入：

| 模式 | 价值 | 成本 | 下一步 |
|------|------|------|--------|
| **C. 框架感知 Extractor**（Route + ORM）| 改 API 时自动提示前端调用方 | 0.5–1 天 | 新建 `src/services/dep-graph/framework-patterns.js`，在 `audit-diff`/`audit-file` formatter 中输出 `frameworkPatterns` |
| **F. AST Cache**（LRU + WASM dispose）| 防 `watch`/`repl` 长期运行内存泄漏 | 0.5 天 | 在 `tree-sitter.js` 中包一层 `lru-cache`，淘汰时调 `tree.delete()` |
| **D. 递进工具链文案**（WHEN TO USE / AFTER THIS）| 降低 CLI 决策成本 | 1 小时 | 改 `cli.js` help string + AGENTS.md 命令表 |
| A. 语言注册表重构 | 消除 parser dispatch 硬编码 | 2–3 天 | 等 P4-AST 全部完成后再做，避免中途重构增加回归成本 |

### 数据清理
- `reports/roadmap-m3-mapping-hitrate-compare.json` — 2026-04-07 生成的纯分析数据，无 `taskId`/`status`/`nextSteps`，建议归档或删除，避免 `reports/` 堆积死数据

### 产品功能缺口（AI 消费体验）

| 缺口 | 影响场景 | 当前状态 | 建议方向 | 工作量 |
|------|---------|---------|----------|--------|
| `function-impact.js` 硬编码 ext 白名单 | Python/Java 有 AST 但无法做 changed-function-impact | 只支持 `['.js','.jsx','.ts','.tsx','.go']` | 扩展白名单至 `['.py','.java']`，或利用 `functionRecords` 实现跨语言 | 0.5 天 |
| `audit-file` 无 validationAdvice | 改单个文件后不知道测什么、怎么测 | 只返回 impact + affectedTests 列表 | 集成轻量版 `buildValidationAdvice`（单文件 stack 检测 + 命令生成）| 0.5 天 |
| `health` 无具体修复建议 | healthScore 3/5 时不知道如何提升到 5/5 | 只返回 `checks` 布尔值 | 增加 `fixes` 数组：`[{ check, action, template }]` | 0.5 天 |
| `impact` 命令无影响路径 | 重构时不知道中间经过哪些文件 | 只有 `level` 拓扑距离 | 增加 `paths` 字段（利用 BFS 的 `path` 数组）| 0.5 天 |
| SKILL.md 缺失 5 个命令 + staleness + reuse-hints | Agent 契约不完整 | 缺 `workspace-info`、`diagnostics`、`audit-security`、`repl`、`watch` 说明 | 补全命令说明和输出示例 | 0.5 天 |
| C/C++ 无 stack 检测和验证命令 | 后端/嵌入式项目无法生成验证命令 | `stack-detector` 完全不检测 C/C++ | 添加 `hasCppProject` + `getCppCommands`（cmake/make）| 0.5 天 |
| Go/Rust 静态分析命令缺失 | 验证深度不足 | 缺 `go vet`、`cargo clippy` | `getGoCommands`/`getRustCommands` smoke 阶段添加 | 0.25 天 |
| `audit-diff` 缺文件类型统计 + 变更量 | AI 无法判断改动性质和规模 | 只有 changedFiles 计数 | 增加 `fileTypeBreakdown` + `changeMetrics`（git diff --numstat）| 0.5 天 |

### 性能瓶颈（大项目 >10k 文件）

| 级别 | 位置 | 问题 | 量化影响 | 建议修复 |
|:---|:---|:---|:---|:---|
| P0 | `resolvers.js:95-151` | JS import 解析 20× `fs.existsSync` 无缓存 | 100k import × 20 = **200 万次同步 I/O**，构建 30–120s | 单次 `build()` 生命周期内加 `Map<candidatePath, boolean>` 缓存 |
| P0 | `cli.js:633` | `JSON.stringify(result, null, 2)` 阻塞事件循环 | 100MB 对象 → **500ms–2s** 冻结 | 对 `audit-map` 等命令使用 streaming JSON 或分块输出 |
| P1 | `dep-graph.js:209` | `isKnownEntryFile()` 全文件 `readFileSync` | 10k 次 readFileSync，**50MB 读入**，200–800ms 阻塞 | 只读前 256 字节，或框架模式匹配失败后再读 |
| P1 | `dep-graph.js:566` | `_scanSymbolUsageInImporters` 重复读取 importer | 同一热门文件被读 **数百次** | 内容级缓存（`Map<filePath, content>`），单次 `build()` 生命周期 |
| P1 | `dep-graph.js:127-128` | `graph` + `reverseGraph` 双边冗余 | 100k 条边 → **16–24MB** 纯冗余 | 评估是否可改为单图 + 按需反向遍历 |
| P1 | `file-index.js:285-288` | `content.split('\n')` 仅数行数 | 1MB 文件 → 临时数组 **~20MB**；并发 50 个时峰值 **~1GB** | 改用 `content.match(/\n/g)?.length + 1` |
| P1 | `cache.js:112,157` | 缓存加载/保存双重内存峰值 | 50MB 缓存文件 → 峰值 **100MB+** | 接受现状（工程量大收益小），或评估 streaming JSON parser |
| P2 | `spawn-ast.js:16` | 20 并发 Python 子进程 | 20 × 30–80MB = **600MB–1.6GB** 瞬时内存 | 子进程并发限制（如 `p-limit` 4）|
| P2 | `go-ast.js:60-141` | Query 对象未 `delete()` | WASM 内存泄漏，`watch`/`repl` 长期运行增长 | `finally` 中加 `query.delete()` |
| P2 | `project-map.js:226-320` | edges Map 内存爆炸 | 100k edges → **30–50MB** | compact 模式提前聚合，跳过 rawEdges 实例化 |
| P2 | `overview-tools.js:116` | 50 并发 `git log --follow` | CPU/磁盘争用，总耗时 **5–10s** | 限制并发（如 8）或改为串行 |
| P2 | `cache.js` | 无增量写，每次 `save()` 全量序列化 | 改动 1 个文件也写 50MB | 评估增量 JSON patch 或 SQLite 替代 |

### 用户体验缺口

| 维度 | 问题 | 当前表现 | 理想表现 |
|------|------|----------|----------|
| 错误信息 | `--quiet` 模式下初始化失败根因完全丢失 | `Failed to initialize workspace container`，无细节 | `--quiet` 只抑制信息性 stderr，错误性 stderr 强制输出 |
| 错误信息 | `Unknown command` 后未提示 `--help` | `Unknown command: audit-dif` | 追加 `Run "workspace-bridge-cli --help" for available commands.` |
| Help | `printUsage()` 与 AGENTS.md 命令矩阵不一致 | AGENTS.md 只列 7 个核心命令，实际有 19 个 | AGENTS.md 扩充或标注"完整命令见 cli.js --help" |
| Help | 无 per-command help，无默认值说明 | 纯命令列表，无示例 | `--mode <quick|full> (default: quick)` + Examples 区块 |
| JSON 一致性 | `affected_tests` 用 `source`，`impact` 用 `file` | 同一语义不同字段名 | 统一为 `file`，或 `affected_tests` 同时保留 `file` |
| JSON 一致性 | `healthScore` 是字符串 `"3/5"` | AI 需额外解析 | 保留字符串，同时加 `{ passed: 3, total: 5, ratio: 0.6 }` |
| JSON 一致性 | `audit-map` compact 与非 compact 字段结构不一致 | compact 无 `workspaceRoot`，非 compact 无 `summary` | 两种模式都包含 `workspaceRoot` + `summary` |
| Windows | `.bat` 文件 spawn 缺少 `cmd.exe` 包装 | `gradlew.bat` 直接 spawn 失败 | `useWindowsCmdShim` 检测 `\.(cmd|bat)$` |
| Windows | 验证命令包含 Unix shell 语法 | `cd ${modDir} && go test ./...` | PowerShell 下生成 `cd ${modDir}; go test ./...` |
| 配置 | `.workspace-bridge.json` 无 schema 验证 | JSON 语法错误静默忽略，未知字段静默忽略 | 轻量 schema 验证，错误时 `console.error` 警告 |
| 配置 | 无 `init` 命令生成默认配置 | 用户只能手动创建 | `workspace-bridge-cli init` 生成带注释的默认配置 |
| 进度 | 大项目索引无中间进度 | 开始和结束两条日志，中间黑屏数十秒 | 每 100 个文件打印进度：`1200/10432 files indexed...` |

### 成功标准完成度（8 条）

| # | 成功标准 | 完成度 | 缺口 |
|---|----------|:------:|------|
| 1 | 混合仓库结果稳定 | 80% | 无配置时 reference/prototype 仍污染结果 |
| 2 | TS/Python/前端项目可信主线结论 | 90% | 极端框架（Nuxt layers、Django apps）可能漏报 |
| 3 | 从"哪里有问题"推进到"怎么改、测什么" | 85% | 单文件场景无验证建议；health 3/5 时无修复步骤 |
| 4 | symbol-level impact 可用 | 75% | Python/Java AST 的 `functionRecords` 未被 `function-impact.js` 消费 |
| 5 | 大仓库性能可接受 | 90% | 10k+ 文件首次索引未实测；resolvers 同步 I/O 风暴 |
| 6 | 可选外部工具后端（Semgrep）| 100% | — |
| 7 | 全栈语言覆盖（9 种）| 100% | — |
| 8 | 全栈 AST 覆盖（除 Rust/Kotlin/C/C++）| 67% | P4-AST 进行中 |

---

*Last updated: 2026-05-05（现状评估更新：Go AST ✅，P4-AST 剩余 Rust/Kotlin/C/C++；6 维度子代理深度扫描结果归档：活跃缺陷 20 项、产品缺口 8 项、性能瓶颈 12 项、用户体验缺口 12 项、成功标准完成度量化）*
