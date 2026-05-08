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

> **Compact 模式设计原则**：压缩不是截断，是**面向 AI 消费的策展（curation）**。详见 [AGENTS.md §Compact 设计哲学](./AGENTS.md#compact-设计哲学)。
>
> `audit-map --compact` / `audit-diff --compact` / `watch --compact` / REPL `issues` / `top` 全部完成。交付记录见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased] §新增/修复。

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

### 首批模式（2 种实现 + 2 种占位）

| 模式 | 框架 | Scanner | Extractor | 状态 |
|------|------|---------|-----------|------|
| 路由懒加载 | Vue | 路径含 `router` 或内容含 `component:` | 正则提取 `import('...')` 路径 | ✅ 已交付 |
| 全局组件注册 | Vue | `main.js` / `app.js` 等入口文件 | 提取 `Vue.component('Name', ...)`，按命名约定映射到组件文件 | ✅ 已交付 |
| 自定义指令 | Vue | 入口文件 + 所有 `.vue` 模板 | 关联指令名 `v-hasPermi` 与导出函数 | ⏳ 占位（需模板扫描） |
| 动态字符串调用 | any | 所有 `.js` / `.ts` | `window[fnName]()` 语义分析 | ⏳ 占位（需语义分析） |

### 后续扩展成本

React `lazy(() => import(...))`、Angular `loadChildren`、SvelteKit 路由只需注册一行 `{ scanner, extractor }` 配置，流水线全部复用。

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
- ✅ **c8 已引入**，`npm run test:coverage` 生成 HTML 报告。当前基线 **79.88%**（77 测试）

### L3 品味问题（10 项活跃）
按 [TECH_DEBT.md](./docs/TECH_DEBT.md) 记录，优先级如下：

| 问题 | 严重程度 | 文件 |
|------|---------|------|
| `buildValidationAdvice` 已拆分 | ✅ 已完成 | `validation-advice.js` |
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

### 数据清理
- `reports/roadmap-m3-mapping-hitrate-compare.json` — 2026-04-07 生成的纯分析数据，无 `taskId`/`status`/`nextSteps`，建议归档或删除，避免 `reports/` 堆积死数据

### 产品功能缺口（AI 消费体验）

| 缺口 | 影响场景 | 当前状态 | 建议方向 | 工作量 |
|------|---------|---------|----------|--------|
| `function-impact.js` 硬编码 ext 白名单 | Python/Java 有 AST 但无法做 changed-function-impact | ✅ 已解锁所有 AST 语言 | — | — |
| `audit-file` 无 validationAdvice | 改单个文件后不知道测什么、怎么测 | ✅ `buildFileValidationAdvice()` 已集成 | — | — |
| `health` 无具体修复建议 | healthScore 3/5 时不知道如何提升到 5/5 | ✅ `fixes` 数组已输出 | — | — |
| `impact` 命令无影响路径 | 重构时不知道中间经过哪些文件 | ✅ `via` 数组即完整路径 | — | — |
| SKILL.md 缺失命令说明 | Agent 契约不完整 | ✅ 已补全 | — | — |
| C/C++ 无 stack 检测和验证命令 | 后端/嵌入式项目无法生成验证命令 | ✅ `hasCppProject` + `getCppCommands` 已添加 | — | — |
| Go/Rust 静态分析命令缺失 | 验证深度不足 | ✅ `go vet` / `cargo clippy` 已添加 | — | — |
| `audit-diff` 缺文件类型统计 + 变更量 | AI 无法判断改动性质和规模 | ✅ `fileTypeBreakdown` + `changeMetrics` 已添加 | — | — |

### 性能瓶颈（大项目 >10k 文件）

| 级别 | 位置 | 问题 | 量化影响 | 建议修复 |
|:---|:---|:---|:---|:---|
| P0 | `resolvers.js:95-151` | JS import 解析 20× `fs.existsSync` 无缓存 | 100k import × 20 = **200 万次同步 I/O**，构建 30–120s | ✅ 已修复 v1.1.0：`cachedStatSync`/`cachedExistsSync` LRU 缓存替代全部同步 I/O |
| P0 | `cli.js:633` | `JSON.stringify(result, null, 2)` 阻塞事件循环 | 100MB 对象 → **500ms–2s** 冻结 | ✅ 已修复 v1.1.0：`writeLargeJson()` 分块写入（64KB/块 + `setImmediate`）|
| P1 | `dep-graph.js:209` | `isKnownEntryFile()` 全文件 `readFileSync` | 10k 次 readFileSync，**50MB 读入**，200–800ms 阻塞 | ✅ 已修复 v1.1.0：改为 `fs.openSync` + `fs.readSync` 只读前 256 字节 |
| P1 | `dep-graph.js:566` | `_scanSymbolUsageInImporters` 重复读取 importer | 同一热门文件被读 **数百次** | ✅ 已修复 v1.0.4：`_scanContentCache` + `_scanPatternCache` 双缓存 |
| P1 | `dep-graph.js:127-128` | `graph` + `reverseGraph` 双边冗余 | 100k 条边 → **16–24MB** 纯冗余 | 评估是否可改为单图 + 按需反向遍历 |
| P1 | `dep-graph.js:127-128` | `graph` + `reverseGraph` 双边冗余 | 100k 条边 → **16–24MB** 纯冗余 | 评估是否可改为单图 + 按需反向遍历 |
| P1 | `file-index.js:285-288` | `content.split('\n')` 仅数行数 | 1MB 文件 → 临时数组 **~20MB**；并发 50 个时峰值 **~1GB** | 改用 `content.match(/\n/g)?.length + 1` |
| P1 | `cache.js:112,157` | 缓存加载/保存双重内存峰值 | 50MB 缓存文件 → 峰值 **100MB+** | 接受现状（工程量大收益小），或评估 streaming JSON parser |
| P2 | `spawn-ast.js:16` | 20 并发 Python 子进程 | 20 × 30–80MB = **600MB–1.6GB** 瞬时内存 | 子进程并发限制（如 `p-limit` 4）|
| P2 | `go-ast.js:60-141` | Query 对象未 `delete()` | WASM 内存泄漏，`watch`/`repl` 长期运行增长 | ✅ 已修复 v1.1.0：`go-ast`/`rust-ast`/`kotlin-ast`/`cpp-ast` 均在 `finally` 中加 `query.delete()` |
| P2 | `project-map.js:226-320` | edges Map 内存爆炸 | 100k edges → **30–50MB** | compact 模式提前聚合，跳过 rawEdges 实例化 |
| P2 | `overview-tools.js:116` | 50 并发 `git log --follow` | CPU/磁盘争用，总耗时 **5–10s** | 限制并发（如 8）或改为串行 |
| P2 | `cache.js` | 无增量写，每次 `save()` 全量序列化 | 改动 1 个文件也写 50MB | 评估增量 JSON patch 或 SQLite 替代 |

### 用户体验缺口

| 维度 | 问题 | 当前表现 | 理想表现 |
|------|------|----------|----------|
| 错误信息 | ✅ `--quiet` 下错误性 stderr 已强制输出 | `Failed to initialize workspace container`，无细节 | `--quiet` 只抑制信息性 stderr，错误性 stderr 强制输出 |
| 错误信息 | ✅ `Unknown command` 已提示 `--help` | `Unknown command: audit-dif` | 追加 `Run "workspace-bridge-cli --help" for available commands.` |
| Help | ✅ 命令参考已统一至 `--help` / SKILL.md | AGENTS.md 只列 7 个核心命令 | AGENTS.md 引用 `cli.js --help` 与 SKILL.md 作为单一事实源 |
| Help | ✅ per-command help 已加 Common Options | 纯命令列表，无示例 | `--help <command>` 输出含 `--cwd/--json/--quiet/--help` 说明 |
| JSON 一致性 | ✅ `affected_tests` 已统一为 `file`（原 `source`） | `impact` 与 `affected_tests` 语义相同字段名不同 | 统一为 `file` |
| JSON 一致性 | ✅ `healthScore` 已加 `healthScoreNumeric`（含 `passed/total/ratio`）| AI 需额外解析 | 保留字符串，同时加 `healthScoreNumeric` |
| JSON 一致性 | ✅ `audit-map` 两种模式均含 `workspaceRoot` + `summary` | compact 无 `summary`（workspaceRoot 本来就有） | 非 compact 也输出 `summary` |
| Windows | ✅ `.bat`/`.cmd` spawn 已自动包装 `cmd.exe` | `gradlew.bat` 直接 spawn 失败 | `useWindowsCmdShim` 检测 `\.(cmd|bat)$` |
| Windows | 验证命令包含 Unix shell 语法 | `cd ${modDir} && go test ./...` | PowerShell 下生成 `cd ${modDir}; go test ./...` |
| 配置 | ✅ `.workspace-bridge.json` 已加轻量 schema 校验 | JSON 语法错误静默忽略，未知字段静默忽略 | 校验 JSON 语法 + 未知字段/类型错误警告（非阻塞） |
| 配置 | ✅ `init` 命令已添加 | 用户只能手动创建 | `workspace-bridge-cli init` 生成默认配置 |
| 进度 | ✅ 大项目索引进度条已添加 | 开始和结束两条日志，中间黑屏数十秒 | 每 100 个文件打印进度：`1200/10432 indexed...` |

### 成功标准完成度（8 条）

| # | 成功标准 | 完成度 | 缺口 |
|---|----------|:------:|------|
| 1 | 混合仓库结果稳定 | 80% | 无配置时 reference/prototype 仍污染结果 |
| 2 | TS/Python/前端项目可信主线结论 | 90% | 极端框架（Nuxt layers、Django apps）可能漏报 |
| 3 | 从"哪里有问题"推进到"怎么改、测什么" | **95%** | health 3/5 时 `fixes` 数组已输出；`audit-file` 已有 `validationAdvice`；`audit-diff` phases 已按技术栈差异化；剩余：极端框架（Nuxt layers）的 fileSpecificAdvice 精度 |
| 4 | symbol-level impact 可用 | 90% | `function-impact.js` 已解锁所有 AST 语言；仅 C/C++ regex 无 functionRecords |
| 5 | 大仓库性能可接受 | 95% | 10k+ 文件首次索引未实测；两个 P0 性能瓶颈已修复 |
| 6 | 可选外部工具后端（Semgrep）| 100% | — |
| 7 | 全栈语言覆盖（9 种）| 100% | — |
| 8 | 全栈 AST 覆盖（9/9 语言）| **100%** | — |

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

---

*Last updated: 2026-05-08（低垂果实收尾 P12/P32/P37/P43/P58；性能瓶颈表同步；83/83 测试通过，覆盖率 79.88%，healthScore=5/5）*
