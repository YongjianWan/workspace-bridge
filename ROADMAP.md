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
| 文件扫描数量与用户预期差距 | ⏳ 观察 | 1547 实际文件 → 389 扫描文件（排除资产/产物） | 文档说明 `totalFiles` 为 mainline 源码计数 |
| 多模块 Maven 模块边界未显式标注 | ⏳ 观察 | 模块间耦合强度丢失 | 评估是否输出模块级聚合视图 |
| `updateFiles` 删除文件后图不一致 | ✅ P102 已修复 | watch 长期运行积累幽灵边 | 入边 + imports/importRecords 全清理，测试已验证 |

> 历史修复记录见 [CHANGELOG.md](./CHANGELOG.md)。

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

---

## 未竟事项（按价值排序）

### P4：技术债与架构决策

- [x] 超标文件拆分（`parsers/` 目录、`formatters/` 目录）
- [x] 大仓库性能专项优化（>10k 文件）— 详见 P5
- [x] 插件化解析器注册表 — **决策更新：提前重构**（原定为"超 10 种时"，现 6→9 种途中即做）
- [x] **P4-AST：全栈 AST 覆盖** — 9/9 语言全部 AST（2026-05-06 完成）。交付记录见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased] §新增。

  > 技术选型、实现策略与验证详情见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased] §重构/新增。

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

### P5：大项目体验优化（REPL + 缓存 + Watcher + Compact）— ✅ 已完成

> **Compact 模式设计原则**：压缩不是截断，是**面向 AI 消费的策展（curation）**。详见 [AGENTS.md §Compact 设计哲学](./AGENTS.md#compact 设计哲学）。
>
> `audit-map --compact` / `audit-diff --compact` / `watch --compact` / REPL `issues` / `top` 全部完成。交付记录见 [CHANGELOG.md](./CHANGELOG.md)。

- Step 1：REPL / 精确查询模式 ✅
- Step 2：缓存解析结果（parseResults）✅
- Step 3：Watcher 增量更新 dep-graph ✅

---

## P6：语言扩展（全栈支持）

> 个人全栈开发场景驱动：C/C++ 后端/嵌入式 + Vue/Svelte 前端需要纳入依赖图。

| 语言 | 策略 | 状态 |
|------|------|------|
| **C / C++** | regex + tree-sitter AST fallback | ✅ 已完成 v1.0.4 |
| **Vue SFC** | 提取 `<script>` 复用 JS/TS AST parser | ✅ 已完成 v1.0.4 |
| **Svelte** | 提取 `<script>` 复用 JS/TS AST parser | ✅ 已完成 v1.0.4 |
| **HTML / CSS** | 不纳入（无 import 语义）| ❌ 跳过 |

> 9 种语言全部接入 `defineLanguage()` 注册表。交付记录见 [CHANGELOG.md](./CHANGELOG.md)。

---

## P7：框架隐式依赖插件化（首批已交付）

> 解决 P1/P63 Vue 假阳性三角的核心架构。不是"迁移硬编码 if-else"，而是新增一层能力——框架特殊调用模式产生的依赖关系不会被静态 import 捕获，需要额外扫描。

### 架构：Scanner → Extractor → Applier

```
扫描器 Scanner     解析器 Extractor      应用器 Applier
    ↓                  ↓                    ↓
"哪些文件可能     "从内容提取隐式      "把隐式边注入
 包含这种模式"     import 路径"         依赖图"
```

### 首批模式（2 种实现 + 2 种占位 + 2 种待实现）

| 模式 | 框架 | Scanner | Extractor | 状态 |
|------|------|---------|-----------|------|
| 路由懒加载 | Vue | 路径含 `router` 或内容含 `component:` | 正则提取 `import('...')` 路径 | ✅ 已交付 |
| 全局组件注册 | Vue | `main.js` / `app.js` 等入口文件 | 提取 `Vue.component('Name', ...)`，按命名约定映射到组件文件 | ✅ 已交付 |
| Django 管理命令 | Django | 路径含 `management/commands/` | 检测 `Command` 类，标记为框架入口 | ✅ 已交付（`ai_gwy_backend` 6+ 误报消除） |
| Django 视图/URL | Django | 路径含 `views/` 或 `urls.py` | 解析 `urls.py` 中的 `path()` 和 `include()`，建立视图文件映射 | ✅ 已交付（`ai_gwy_backend` 15+ 视图文件误报消除） |
| 自定义指令 | Vue | 入口文件 + 所有 `.vue` 模板 | 关联指令名 `v-hasPermi` 与导出函数 | ⏳ 占位（需模板扫描） |
| 动态字符串调用 | any | 所有 `.js` / `.ts` | `window[fnName]()` 语义分析 | ⏳ 占位（需语义分析） |
| React lazy | React | 所有 `.js` / `.jsx` / `.ts` / `.tsx` | 提取 `React.lazy(() => import(...))` 路径 | ✅ 已交付（P104） |
| Next.js dynamic | Next.js | 所有 `.js` / `.jsx` / `.ts` / `.tsx` | 提取 `dynamic(() => import(...))` 路径 | ✅ 已交付（P104） |
| Angular loadChildren | Angular | 所有 `.ts` | 提取 `loadChildren: () => import(...)` 路径 | ✅ 已交付（P104） |

### 后续扩展成本

React `lazy(() => import(...))`、Next.js `dynamic()`、Angular `loadChildren`、SvelteKit 路由只需注册一行 `{ scanner, extractor }` 配置，流水线全部复用。

### 核心文件

- ✅ 新建 `src/services/dep-graph/framework-usage-patterns.js` — 配置表 + 流水线
- ✅ 修改 `src/services/dep-graph.js` — `build()` / `updateFiles()` 后增加 `applyFrameworkImplicitImports()`
- ⏸ 修改 `src/utils/orphan-detector.js` — 隐式边已注入 reverseGraph，`getDependents()` 自动覆盖，无需额外双源参数

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
8. **全栈 AST 覆盖**（9/9 语言全部 AST）
9. **闭环验证**（文件改动 → 自动计算影响 → 自动跑相关测试 → 结果自动回传 AI）

---

## 已归档计划

以下历史技术方案已完成并融入本文档，原始文件保留供追溯：

- 历史计划：Java AST 级支持与多语言扩展（已融入"技术栈评估 / ADR"）
- 历史计划：两周收敛计划（已融入"收敛里程碑"）

---

---

## P8：从"报告"到"闭环"（行动层基础设施）

> 第一性原理推导：AI 不可能一次性写对。基础设施的任务不是帮 AI 避免错误，而是帮 AI 把"错误 → 发现 → 修正"的循环压缩到最短。
>
> 当前 workspace-bridge 是"信息层"基础设施（告诉 AI 世界长什么样），下一步是"行动层"基础设施（让 AI 安全地与世界互动）。

### P8-0：架构前置——dep-graph.js 内部拆分

已完成。内部拆为 `GraphBuilder` / `GraphAnalyzer` / `GraphQuery`，`DependencyGraph` 退化为 facade。验证：85/85 测试通过，healthScore=5/5。详见 [CHANGELOG.md](./CHANGELOG.md)。

### P8-1：watch 闭环

已完成。CLI 新增 `--run-tests` 标志，文件保存后自动计算 impact → 跑 affected-tests → JSON Lines 结果回传。详见 [CHANGELOG.md](./CHANGELOG.md)。

**未实现（未来扩展）**：
- 触发粒度仅支持 onSave（onGitStaged / 定时轮询占位）
- 多命令并行执行（当前为顺序执行）

### P8-2：validationAdvice 可执行契约（P1）

已完成。`commands` 数组从字符串升级为结构化对象 `{ command, args, cwd, shell, expectedExitCode, onFailure }`。详见 [CHANGELOG.md](./CHANGELOG.md)。

**P8-2-1 已完成**：`parseCommandString` 后处理补丁已重构为 `renderCommandString` 正交设计。生成侧直接返回 `executable`，`cmd` 由纯函数合成。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased] §重构。

### P8-3：增量策展

已完成。`audit-file --watch` 输出完整 audit-file JSON Lines；`audit-diff --incremental` 范围过滤，只保留 changed files + impact radius 内的问题。详见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 下一步方向（观察期）

> 路线 A–J 全部完成。当前进入**观察期**，无新的核心功能承诺。
>
> 剩余问题是**工程结构瓶颈**与**产品体验缺口**（见 TECH_DEBT.md）。

### 路线 I：GitNexus 模式吸收与图架构深化

**P102: 增量更新图一致性（L1）** ✅
- `updateFiles` 删除文件时清理入边 + 其他文件 imports 中的残留引用
- 工作量：小（~20 行）

**P103: `framework-patterns.js` 引入 `entryPointWeight`（L2）** ✅
- 将 `isEntry: true/false` 升级为梯度评分（1.0–3.0），接入 hotspot 计算
- 工作量：中（~50 行 + 测试）

**P104: 扩展隐式依赖模式（L2）** ✅
- React.lazy、Next.js dynamic、Angular loadChildren
- 工作量：中（~80 行 + 测试）

**P105: 软 post-process phase 架构（L3）** ✅
- `postProcessPhases: Array<() => void>`，解耦 `applyFrameworkImplicitImports`
- 工作量：小（~30 行）

### 路线 F–H（已完成，归档）

- 路线 F（数据一致性 P92–P95）：`workspace-info` / `stats` / `ROLE_RULES` 同步 ✅
- 路线 G（框架感知 P96/P101）：Vue 长循环白名单、Django testConfig ✅
- 路线 H（模板同质化 P97–P100）：RuoYi 循环白名单、vendor-copy 分类、根目录 `.py` script ✅

---

## 其他未完成项

> 非核心承诺，不影响 1.0 定位，但持续提升工程健康度。

### 测试覆盖率量化
- ✅ **c8 已引入**，`npm run test:coverage` 生成 HTML 报告。当前基线 **79.88%**（89 测试）

### L3 品味问题（4 项活跃）
按 [TECH_DEBT.md](./docs/TECH_DEBT.md) 记录，优先级如下：

| 问题 | 严重程度 | 文件 |
|------|---------|------|
| `dep-graph.js` 8 个函数 >30 行 | 🟡 中 | `dep-graph.js` |
| `js.js` 2 个 visitor 超长（74 行 / 42 行）| 🟡 中 | `js.js` |
| `file-index.js` 4 个函数 >30 行 | 🟡 中 | `file-index.js` |

> AGENTS.md 已确认 `dep-graph.js` 内聚优先、不物理拆分，但**函数级拆分**仍有空间。

### GitNexus 高价值模式提取

| 模式 | 价值 | 成本 | 状态 |
|------|------|------|------|
| **C. 框架感知 Extractor**（Route + ORM）| 改 API 时自动提示前端调用方 | 0.5–1 天 | ✅ 已交付 |
| **F. AST Cache**（LRU + WASM dispose）| 防 `watch`/`repl` 长期运行内存泄漏 | 0.5 天 | ✅ 已交付 |
| **D. 递进工具链文案**（WHEN TO USE / AFTER THIS）| 降低 CLI 决策成本 | 1 小时 | ✅ 已交付 v1.1.0：`--help <command>` 输出递进式使用说明 |
| A. 语言注册表重构 | 消除 parser dispatch 硬编码 | 2–3 天 | ✅ 已交付 v1.0.4：`defineLanguage()` 统一接口，`registry-core.js` + `registry.js` 集中注册 9 种语言 |
| B. 知识图双索引（`edgeIdsByNode`）| 节点删除 O(edges-touching-node) | 0.5 天 | ⏸ P102 已用最小化实现替代（入边 + imports/importRecords 全清理），完整 `edgeIdsByNode` 索引暂不需要 |

### 数据清理
- `reports/roadmap-m3-mapping-hitrate-compare.json` — 2026-04-07 生成的纯分析数据，无 `taskId`/`status`/`nextSteps`，建议归档或删除，避免 `reports/` 堆积死数据

### 产品功能缺口（AI 消费体验）

| 缺口 | 影响场景 | 当前状态 | 建议方向 | 工作量 |
|------|---------|---------|----------|--------|
| `ROLE_RULES` 与 `test-detector.js` 不同步 | Django `tests.py` 被误标为 `library` | ✅ 已修复 P95 | — | — |
| Vue 长循环白名单不足 | `request→store→router→view→api→request` 长度=6 被误报 | ✅ 已修复 P96 | — | — |
| Django `testConfig` 误报 | `manage.py test` 能力未被识别 | ✅ 已修复 P101 | — | — |

### 性能瓶颈（大项目 >10k 文件）

| 级别 | 位置 | 问题 | 量化影响 | 建议修复 |
|:---|:---|:---|:---|:---|
| P1 | `dep-graph.js:127-128` | `graph` + `reverseGraph` 双边冗余 | 100k 条边 → **16–24MB** 纯冗余 | 评估是否可改为单图 + 按需反向遍历 |
| P1 | `dep-graph.js:655` | ~~`_scanLocalSymbolUsage` 仍用 `content.split('\n')`~~ | ~~同 file-index.js 已修复问题，dead-export 分析时复现内存峰值~~ | ✅ P74 已修复（流式扫描 `indexOf('\n')` + `slice`） |
| P1 | `framework-usage-patterns.js` | ~~`resolveImplicitImports` 无缓存 `fs.existsSync`~~ | ~~每次 build/updateFiles 重复同步 I/O~~ | ✅ P75 已修复（复用 `cachedExistsSync` LRU 2000） |
| P1 | `cache.js:112,157` | 缓存加载/保存双重内存峰值 | 50MB 缓存文件 → 峰值 **100MB+** | 接受现状（工程量大收益小），或评估 streaming JSON parser |
| P2 | `spawn-ast.js:16` | 20 并发 Python 子进程 | 20 × 30–80MB = **600MB–1.6GB** 瞬时内存 | 子进程并发限制（如 `p-limit` 4）|
| P2 | `go-ast.js:60-141` | ~~Query 对象未 `delete()`~~ | ~~WASM 内存泄漏，`watch`/`repl` 长期运行增长~~ | ✅ v1.1.0 已修复（`finally` 中加 `query.delete()`） |
| P2 | `project-map.js:226-320` | edges Map 内存爆炸 | 100k edges → **30–50MB** | compact 模式提前聚合，跳过 rawEdges 实例化 |
| P2 | `overview-tools.js:116` | 50 并发 `git log --follow` | CPU/磁盘争用，总耗时 **5–10s** | 限制并发（如 8）或改为串行 |
| P2 | `cache.js` | 无增量写，每次 `save()` 全量序列化 | 改动 1 个文件也写 50MB | 评估增量 JSON patch 或 SQLite 替代 |

### 用户体验缺口

| 维度 | 问题 | 当前表现 | 理想表现 |
|------|------|----------|----------|
| Windows | ⏳ 待评估 | 验证命令包含 Unix shell 语法（`cd ${modDir} && go test`） | PowerShell 下生成 `cd ${modDir}; go test ./...` |
| 配置 | ⏳ 待评估 | `.workspace-bridge.json` schema 校验可更严格 | 未知字段/类型错误警告（非阻塞） |
| 进度 | ⏳ 待评估 | 超大仓库（>10k 文件）索引进度粒度不足 | 按百分比或按模块打印进度 |

### 成功标准达成评估（现状 / 9 条）

| # | 成功标准 | 完成度 | 缺口 |
|---|----------|:------:|------|
| 1 | 混合仓库结果稳定 | 80% | 无配置时 reference/prototype 仍污染结果 |
| 2 | TS/Python/前端项目可信主线结论 | **90%** | P70 Spring Boot 入口 ✅ / P71 Django 配置驱动入口 ✅ / P73 跨框架循环白名单 ✅；剩余：React hooks 隐式依赖、Java 多模块 AST 深度 |
| 3 | 从"哪里有问题"推进到"怎么改、测什么" | **95%** | health 3/5 时 `fixes` 数组已输出；`audit-file` 已有 `validationAdvice`；`audit-diff` phases 已按技术栈差异化；剩余：极端框架（Nuxt layers）的 fileSpecificAdvice 精度 |
| 4 | symbol-level impact 可用 | 90% | `function-impact.js` 已解锁所有 AST 语言；仅 C/C++ regex 无 functionRecords |
| 5 | 大仓库性能可接受 | 95% | 10k+ 文件首次索引未实测；P74 `_scanLocalSymbolUsage` 流式扫描已修复；剩余：双边冗余内存（单图改造评估中） |
| 6 | 可选外部工具后端（Semgrep）| 100% | — |
| 7 | 全栈语言覆盖（9 种）| 100% | — |
| 8 | 全栈 AST 覆盖（9/9 语言）| **100%** | — |
| 9 | 闭环验证（P8）| **100%** | P8-1 `watch --run-tests` ✅；P8-2 validationAdvice 可执行 ✅；P8-3 增量策展 ✅。剩余：onGitStaged 触发、失败信息注入 AI 上下文 |

---

---

## 产品评估

> 以下评估记录工具从"不可用"到"及格"后的真实竞争力与剩余架构债。

### v2.0.0 理想态

- 假阳性率 < 10%，数据可信，建议可执行
- 输出体积可控（< 500 行 @ 223 文件项目）
- 一个 CLI 同时覆盖 JS + Java + 验证建议 + 影响半径

### 与专业工具对比

| 维度 | knip | dependency-cruiser | SonarQube | workspace-bridge |
|------|------|-------------------|-----------|------------------|
| JS dead exports | 95% | — | — | 85% |
| JS cycles | — | 95% | — | 可用 |
| Java 分析深度 | — | — | 很高 | 能检测到文件 |

**给人类用**：仍然打不过专业工具。**给 AI 用**：有独特优势（统一接口、轻量、JSON、验证建议 + 影响半径一体化）。

### 剩余架构债

- dep-graph.js 函数级拆分空间
- Java 多模块 AST 解析深度
- Vue SFC 解析与 `languageSupport` 统计打通
- 测试覆盖补全（flaky 测试修掉）
- cli.js 厚门面（~623 行，`formatHuman` ~200 行 switch）
- P8-2-1 `parseCommandString` 后处理补丁
- ~~P102 增量更新图一致性（L1，watch 长期运行风险）~~ ✅ 已修复
- ~~P103 `entryPointWeight` 梯度评分（热点计算精细化）~~ ✅ 已交付
- ~~P104 React/Next.js/Angular 懒加载隐式边（ orphan/dead-export 误报）~~ ✅ 已交付

### 产品方向诚实评估

**跨框架公平性：已从"赤字"改善为"基本对齐"。**

路线 A（P70–P73）已大幅收敛非 Vue 语言的框架感知差距：
- React：循环白名单 ✅（P73：context↔hooks↔components）
- Java/Spring Boot：循环白名单 ✅（P73）、summary 入口 ✅（P70：`*Application.java`）、框架模式识别 ✅（P79–P81）
- Django：middleware/router/context processors/templatetags/forms ✅（P71）

剩余差距：React hooks 隐式依赖（P104）、Java 多模块 AST 深度、Vue SFC 与 `languageSupport` 统计打通。

**当前最影响"基础设施"定位的问题：**
1. P102 增量更新图一致性 — watch 长期运行的数据可信性风险
2. cli.js 厚门面 — 新增命令的改动成本持续累积
3. ~~P84 模块边界 — Java 多模块项目的架构审计仍停留在文件级~~ ✅ 已修复（v1.2.0+：`detectMavenModules` + `-pl` 模块级命令）

---

---

## 路线 I-2：GitNexus 深度对比补充发现

> 第二轮深入阅读 `call-processor.ts`（3330 行）、`ARCHITECTURE.md`、`resources.ts`、`TESTING.md` 后的新增发现。
> 
> 核心结论：workspace-bridge 在"文件级图"上已做到极致，但 GitNexus 在**符号级调用解析**（call resolution）、**字段访问追踪**（ACCESSES）、**接口派发**（interface dispatch）三个维度上建立了完整的 6 阶段流水线。这不是代码差距，是架构定位差异——workspace-bridge 是文件级依赖图，GitNexus 是符号级知识图。

---

### 发现 1：Call-Resolution DAG（6 阶段调用解析流水线）

**来源**：`gitnexus/src/core/ingestion/call-processor.ts`

**设计**：
```
extract-call → classify-form → infer-receiver → select-dispatch → resolve-target → emit-edge
   (1)            (2)             (3)[hook]       (4)[hook]          (5)            (6)
```

**牛逼之处**：
- **Stage 1 extract-call**：提取调用点（callee name、receiver、argCount）
- **Stage 2 classify-form**：判断调用形式 `free` / `member` / `constructor`
- **Stage 3 infer-receiver**：通过 `typeEnv.lookup()` + 构造函数绑定验证推断接收者类型
- **Stage 4 select-dispatch**：语言特定 hook（如 Ruby `ancestryView: 'singleton'`）
- **Stage 5 resolve-target**：**MRO walk**（Method Resolution Order）+ 接口派发找到实现类方法
- **Stage 6 emit-edge**：生成带 **数值 confidence** 的 `CALLS` 边

**workspace-bridge 差距**：
- 无数值 confidence（只有 `high/medium/low` 文本分级）
- 无字段访问追踪（`foo.bar = 1` 无法识别为对 `bar` 的写访问）
- 无接口派发（Java 接口方法的调用方无法自动关联到实现类）
- 无 MRO walk（类继承链上的方法解析依赖文本级正则）

**吸收成本**：高。需要引入 `typeEnv`、heritage 索引、MRO walker，与当前文件级图架构冲突。

**建议**：长期 roadmap，不急于实施。若未来需要回答"谁调用了 `UserService.validate()` 的第三个重载"，这是必经之路。

---

### 发现 2：分层置信度评分（3-tier confidence with numeric values）

**来源**：`gitnexus/src/core/ingestion/model/resolution-context.ts`

**设计**：
```ts
Tier 1 — same-file:     confidence 0.95
Tier 2 — import-scoped: confidence 0.9
Tier 3 — global:        confidence 0.5
```

**牛逼之处**：数值化 confidence 让下游消费者（AI agent）可以按阈值过滤。例如 `impact` 命令可以只展示 `confidence >= 0.9` 的依赖，自动消除低确信度的噪声。

**workspace-bridge 差距**：当前 `dead-exports` / `impact` / `unresolved` 使用文本分级（`high/medium/low`），消费者无法做数值比较或排序。

**吸收成本**：低。只需将 `computeDeadExportConfidence` 和 `getImpactRadius` 的返回值从字符串改为数值区间映射。

**建议**：下一轮迭代顺手做（~20 行）。→ 已完成。

---

### 发现 3：ACCESSES 边（字段读写追踪）

**来源**：`call-processor.ts` _assignment capture 分支

**设计**：识别 `foo.bar = 1` 形式的赋值，生成 `ACCESSES {reason: 'write'}` 边；字段读取同理 `reason: 'read'`。

**牛逼之处**：静态分析可以回答"哪些函数修改了 `User.address` 字段"——这对影响分析和安全审计极具价值。

**workspace-bridge 差距**：完全缺失。`_scanSymbolUsageInImporters` 只能做文本级正则扫描，无法区分"读取字段"和"调用方法"。

**吸收成本**：高。需要 AST 级字段访问提取 + 接收者类型推断。可在 `js.js` / `java.js` 等 AST parser 中新增 `accessRecords` 输出。

**建议**：长期 roadmap。优先级低于 P102/P104。

---

### 发现 4：`yieldToEventLoop()` 主动让出

**来源**：`call-processor.ts:750`、`parse-impl.ts`

**设计**：大仓库解析时，每处理 20 个文件主动 `await yieldToEventLoop()`，防止事件循环阻塞。

**牛逼之处**：同步 I/O 密集型场景（如 `fs.readFileSync`、`tree-sitter` 解析）下，Node.js 事件循环不会被饿死，UI/CLI 保持响应。

**workspace-bridge 差距**：`_processFilesWithLimit` 有并发限制（20）但没有主动让出。`applyFrameworkImplicitImports` 中的 `fs.readFileSync` 循环在大仓库可能阻塞事件循环数十毫秒。

**吸收成本**：极低。
```js
async function yieldToEventLoop() {
  return new Promise(r => setImmediate(r));
}
// 在循环中：if (i % 20 === 0) await yieldToEventLoop();
```

**建议**：P102 修复时顺带做（~5 行）。→ 已完成。

---

### 发现 5：Import 语义统一抽象（4 种策略）

**来源**：`ARCHITECTURE.md §Import resolution`

**设计**：16 种语言的 import 归纳为 4 种策略：

| 策略 | 语言 | 行为 |
|------|------|------|
| `named` | TS/JS/Java/C#/Rust/PHP/Kotlin | 仅显式导入的名字可见 |
| `wildcard-leaf` | Go/Ruby/Swift/Dart | 整包导入，不传播 re-export |
| `wildcard-transitive` | C/C++ | `#include` 闭包链 |
| `namespace` | Python | 模块别名在调用点解析 |

每种语言配置 `ImportResolutionConfig`（有序策略链），首次非空结果获胜。

**workspace-bridge 差距**：`resolvers.js` 是硬编码逻辑（`_resolveAlias`、`_resolveGoMod`、`_resolveJavaImport` 等分散函数）。新增语言需要改 `resolvers.js`。

**吸收成本**：中。需要把当前分散逻辑重构为策略链，但接口设计可以一次性做好。

**建议**：新增第 10 种语言时做（触发条件）。→ 已完成（路线 J）。

---

### 发现 6：Staleness 精确检查（git-aware）

**来源**：`src/core/git-staleness.ts`（通过 `staleness.ts` 引用）

**设计**：比较索引时的 `lastCommit` 与当前 `HEAD`，精确判断数据是否过时。`resources.ts` 的 `getContextResource()` 自动在 YAML 输出头部注入 staleness hint。

**workspace-bridge 差距**：`getStaleness`（`container.js`）只检查**缓存时间戳**（mtime），不检查 git HEAD 变化。用户切换分支后缓存仍认为数据新鲜。

**吸收成本**：低。`git rev-parse HEAD` 对比缓存中的 commit hash 即可。

**建议**：下一轮迭代做（~30 行）。→ 已完成。

---

### 发现 7：Chunked Parse 内存预算

**来源**：`pipeline-phases/parse.ts`、`parse-impl.ts`

**设计**：大仓库解析按 **~20MB 字节预算** 分块处理，每块内用 worker pool 或 sequential fallback，块间清空临时缓存。

**workspace-bridge 差距**：全量并发解析，`graph` + `reverseGraph` 随文件数线性增长。10k+ 文件项目内存峰值可能达数百 MB。

**吸收成本**：中。需要把 `GraphBuilder.build()` 改为分块循环，每块后可选清空临时缓存。

**建议**：实测 10k+ 文件 OOM 时做，或作为预防性优化在 P105 软 phase 架构中预留。

---

### 发现 8：CI Scope Parity 工作流

**来源**：`.github/workflows/ci-scope-parity.yml`（ARCHITECTURE.md 提及）

**设计**：架构演进时（旧解析路径 → 新解析路径），CI 同时跑**两条路径**，对比输出图是否完全一致。任何 divergence 都导致 CI 失败。

**workspace-bridge 差距**：1.1.0 升级 `schemaVersion` 时（`1.1.1` → `1.2.0`），如果有一个"旧 schema vs 新 schema" parity test，可以避免字段命名不一致的 bug（如 `overview-tools.js` 内部返回数字 `1` 而 CLI 注入字符串 `'1.1.1'` 的问题）。

**吸收成本**：低。新增一个测试文件，同时跑新旧路径对比 JSON 输出即可。

**建议**：下一次 schema 变更前做。

---

### 发现 9：结果自带 confidence source 标签（重命名工具的启发）

**来源**：`mcp/tools.ts` `rename` tool

**设计**：重命名结果区分来源：
- `confidence: "graph"` — 通过知识图关系找到（高置信度）
- `confidence: "text_search"` — 通过正则文本搜索找到（低置信度）

**workspace-bridge 差距**：`dead-exports` 有 `confidence: high/medium/low`，但没有标注**推断来源**（如 `"ast-no-importer"` vs `"regex-fallback"`）。AI 无法判断"为什么这个结论是 high"。

**吸收成本**：低。在 `computeDeadExportConfidence` 返回值中新增 `source` 字段即可。

**建议**：下一轮迭代顺手做（~10 行）。

---

### 路线 I-2 吸收优先级汇总

| 发现 | 价值 | 成本 | 状态 |
|------|------|------|------|
| 数值 confidence 替代文本分级 | 高 | 低 | ✅ 已完成 |
| `yieldToEventLoop()` 防阻塞 | 高 | 极低 | ✅ 已完成 |
| 结果自带 `confidenceSource` 标签 | 中 | 极低 | ✅ 已完成（与数值 confidence 同期） |
| Staleness 检查 git HEAD | 中 | 低 | ✅ 已完成 |
| Import 语义策略链抽象 | 中 | 中 | ✅ 已完成（路线 J）|
| Chunked 解析内存预算 | 中 | 中 | ⏳ 实测 10k+ 文件 OOM 时做 |
| CI Schema Parity 测试 | 中 | 低 | ⏳ 下一次 schema 变更前做 |
| ACCESSES 字段读写追踪 | 高 | 高 | ⏳ 长期 roadmap，需 AST 增强 |
| Call-Resolution DAG（6 阶段） | 高 | 很高 | ⏳ 长期 roadmap，符号级图升级时做 |
