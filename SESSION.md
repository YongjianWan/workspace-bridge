# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（确认状态即可，不用跑 runner）

> **定位**：workspace-bridge 是**AI 的代码脚手架**，不是人类审计工具。CLI 负责策展（预组装、去噪、按优先级排序），skill 负责驾驶手册（什么时候用/不用/标准工作流）。
>
> **🔴 开工前不读 CHANGELOG.md**。确定现状只需读本文档 + AGENTS.md + TECH_DEBT.md + 下方 1 条基线命令。CHANGELOG 是历史存档，读它不能替代读活跃文档。
>
> 收工时已跑 `npm run test:fast` 并确认 fast 层全绿，开工无需重跑。全量 runner 状态见下方「基线状态」。直接读取下方「基线状态」确认当前文档记录是否仍成立。
>
> 开发迭代推荐 `npm run test:fast`（~37s，97 个 fast 层测试），比全量 runner（~4min）快 6×。

```bash
# 1. 快速自审（1 秒确认，不用等 runner，不读 CHANGELOG）
node cli.js audit-summary --cwd . --json --quiet
# 期望: health.healthScore=7/8, summary.counts.deadExports=0, summary.counts.unresolved=0, summary.counts.cycles=0, summary.analysisCoverage.totalFiles≈261, summary.analysisCoverage.coverageRatio=1
```

**如果 audit-summary 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 历史变更见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `healthScore=7/8`
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（当前 0 L1 + 0 L2 + 8 L3）

---

## 基线状态

- 测试：**受影响测试全部 PASS**；`npm run test:fast` **80/80 PASS**（~5–6s）。全量 runner **141/141 PASS**（~4min）。开发迭代首选 `npm run test:fast`（~5–6s）或 `npm run test:smoke`（~54s）。当前 fast 层 80 个测试，slow 层 54 个。
- 版本：**v1.2.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~276 文件（entry=1, mainline=133, test=142），commands/ 去壳后减少 17 个透传文件
- 健康度：7/8（缺 dockerConfig），deadExports=0，cycles=0，unresolved=0
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust Regular Expressions、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验）
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**本轮交付（Wave 5：并发测试第二波与健壮 CLI 参数解析）**:
- **重型 Serial 测试并发化与隔离** `test/`：
  - 将 5 个原本位于 `@serial` 单线程串行执行的重型测试（`cli-mapper-adapter-test.js`、`audit-diff-incremental-test.js`、`severity-filter-test.js`、`staged-files-test.js`、`regression-test.js`）从单进程串行阶段解放出来，彻底移入 Slow 并发层（concurrency=4）。
  - 彻底重构测试内部的临时文件与基线文件读写逻辑，使用 `makeTempDir` 创建独立的临时目录，并使用 `--cwd` 将 CLI 执行范围限制在 hermetic 的临时目录中，实现 100% 物理层面上测试的真正解耦。
  - 为 `staged-files-test.js` 和 `severity-filter-test.js` 内的 `tempDir` 新增 dummy `package.json`，解决自动工作区根目录识别（`findWorkspaceRoot`）在空临时文件夹下会一路回溯到用户 Home 目录、进而导致全盘扫描及严重挂起/超时的问题。
- **健壮 CLI 选项与 Baseline 智能解析** `src/utils/parse-args.js` + `src/tools/audit-assembler.js`：
  - 升级 `parseArgs` 核心库：当遇到带有可选值/默认值的参数（如 `--save`、`--baseline`）且下一个参数为命令行 Flag（以 `-` 开头）时，智能判定为无参 Flag 形式，不再错误地将下一个 Flag 消费为它的值。
  - 升级 `assembleSummary` 路径处理：支持以 Boolean 传入的 `--save` 和 `--baseline` 参数，并智能在 `parsed.cwd`（而非 `process.cwd()`）下解析 `DEFAULT_BASELINE_FILE`，完美支持并发及任何隔离执行场景。
- **验证**：全量 runner 141/141 PASS，重型测试彻底并发执行，测试总时间大幅优化！

**本轮交付**（Wave 4：Graph Facade 收敛与卫生清理）：
- REPL / Watch / Debug / CLI 命令 Facade 迁移：`src/cli/repl.js` / `watch.js` / `commands/debug.js` / `commands/index.js` / `cli.js` 剩余 20 处 `container.depGraph` 穿透全部替换为 `container.snapshot.graph`；`DependencyGraphView` 补全 `symbolRegistry` getter。
- Container `depGraph` Deprecation Guard：`src/services/container.js` 将 `depGraph` 改为 getter/setter，首次外部访问输出一次性 deprecation warning；内部生产代码全部改为 `this._depGraph`。
- `isKnownEntryFile` 同步 I/O 缓存：`src/services/dep-graph.js` 新增 `_entryFileCache`，`findDeadExports` 遍历文件时避免重复磁盘读；`graph:updated` 自动清空缓存。
- **测试基础设施：Stub Facade 终结者** `test/test-helpers.js`：`_createStubDepGraph` Proxy 工厂替换 `createMockDepGraph` stub 与 `makeMockSnapshot` defaultStubs 中 20+ 手工方法声明，两个调用点共享单一 `semanticDefaults` 事实源；未知方法自动安全兜底。
- **CLI 渐进式披露：Tier 1 Curated Commands** `cli.js`：默认 `--help` 从 22 命令缩减为 10 个高频命令（L1 策展入口 5 个 + impact / affected-tests / dead-exports / tree / cycles），L2-L4 诊断与调试工具折叠到 `--help --all`；测试同步更新 `cli-args-validation-test.js`。
- **预计算缓存细粒度失效** `src/services/dep-graph/analyzer.js` `builder.js` `dep-graph.js`：
  - `graph:updated` 事件从无参改为携带上下文 `{ changedFiles?: string[], fullRebuild?: boolean }`。
  - `GraphAnalyzer` 新增 `_invalidateCycles(ctx)`：仅当变更文件与已缓存 cycle 集合相交时才清空 `_cachedCycles`；`fullRebuild` 时无条件清空。
  - `builder.js` / `dep-graph.js` 全部 6 个 `emit('graph:updated')` 点已传递上下文（`build()` / `expandJavaPackageImports()` / `expandJavaPackageImportsIncremental()` / `updateFiles` 删除/更新 / `loadGraph()`）。
  - `findCircularDependencies()` 缓存 cycles 时同步构建 `_cycleFiles` Set（O(cycleLength)），失效检查 O(k)。
  - 测试：`dep-graph-postprocess-incremental-test.js` 新增 `testCycleCacheFineGrainedInvalidation`，验证无关文件变更缓存保留、cycle 内文件变更缓存清空、fullRebuild 缓存清空。
- **`functionality-test.js` 拆分与测试套件并发优化** `test/`：
  - 将原本独占单线程串行执行 ~110s 的 monolithic `functionality-test.js` 彻底拆分为 `functionality-core-test.js`（串行）、`functionality-temp-test.js`（并发）、`functionality-polyglot-test.js`（并发）。
  - `runner.js` 新增对 `// @serial` 文件头部注释的自动识别与动态分类，使这类需要修改 git / 仓库根目录的测试能自动落入串行阶段，彻底消除 filesystem crosstalk 引起的所有潜在 flaky 问题。
  - 全量运行耗时大幅缩减，测试总数上升至 141 且 Windows 上 100% 稳定全绿。

**历史交付**：路线 A–J 全部完成；阶段 1/2/3 全部完成；Wave 1/2/3 已完成；L2 债务清零；产品债务清零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 已知陷阱（新 agent 必看）

| 陷阱                                                   | 位置                                                   | 如何避免                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_EXCLUDE_DIRS` 全局污染                      | `src/services/file-index.js`                         | 任何新增排除项必须是通用目录名（如 `node_modules`），不能是项目特定名称                                                           |
| orphan 检测不同步                                      | `project-map.js` vs `overview-tools.js`            | 两处 orphan 逻辑必须保持同步（scripts/bin/benchmark 跳过）                                                                          |
| compact 模式只改 project-map.js                        | `cli.js` 也需要同步                                  | human-readable 输出和 `countTreeFiles()` 必须兼容 skeleton 模式（`totalFileCount`）                                             |
| Windows PowerShell 管道 BOM                            | 所有 `node cli.js ... \| node -e` 命令                | PowerShell 管道传 JSON 会带 BOM，导致 `JSON.parse` 必 crash。**这是主要消费路径上的 broken pipe**，修法：JSON 输出时 strip BOM，或用 Buffer 写 stdout 绕过 PowerShell 编码。当前 workaround：用文件中转（`> file`）再读取                                              |
| cache.save() 已改为 async                              | `src/services/cache.js`                              | 调用方必须 `await`（container.js、测试均已适配）                                                                                  |
| repl-test.js flaky                                     | `test/repl-test.js`                                  | runner.js 串行执行时偶发失败，单独 `node test/repl-test.js` 稳定通过；若遇到，先重跑确认                                          |
| `framework-patterns.js` 新增框架时                   | `src/services/dep-graph/framework-patterns.js`       | 路径检测逻辑按语言分块，新增语言需同时更新 `isEntry` 标记和测试                                                                   |
| `buildFileValidationAdvice` 导出链                   | `validation-advice.js` → `index.js` → `cli.js` | 新增 formatter 函数必须在 `src/cli/formatters/index.js` 中显式导出，否则 cli.js 解构为 `undefined`                              |
| `--quiet` 不再 monkey-patch `console.error`        | `cli.js` / `container.js`                          | `quiet` 通过 `ServiceContainer` → `FileIndex` / `DependencyGraph` 传递；信息性日志条件输出，错误日志仍用 `console.error` |
| `findDeadExports()` edges/files 降级                 | `src/services/dep-graph.js`                          | 单文件项目（files=1）不受降级影响；多文件项目 edges/files < 0.1 时 confidence 降为 low                                              |
| `.workspace-bridge-cache.json.bak` 泄漏到 git status | `src/tools/git-tools.js`                             | `getChangedFiles()` 已排除 `.bak` 备份文件，防止 audit-diff 误报                                                                |
| `resolvers.js` 策略链新增策略                        | `src/services/dep-graph/resolvers.js`                | 新增语言需在 `registerResolverConfig()` 中加一行，策略函数签名 `(importPath, fromFile, ctx) => string\|null`                     |
| `checkFileChanges()` 双路径                          | `src/services/cache.js`                              | fast path（mtime+size）+ slow path（SHA-256）。修改 staleness 逻辑时必须保持双路径行为                                              |

---

## 本轮上下文

> 活跃问题与技术债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。历史已修复条目不重复记录。

### 本轮做了什么

**本轮（Wave 3：Builder/Analyzer 解耦 + 后处理 Affected-only 增量化）**：

- **Builder/Analyzer 生命周期与缓存彻底解耦**：
  - `_cachedCycles`、`_cycleCount`、`_scanContentCache`、`_scanPatternCache` 从 `DependencyGraph` 完全下沉到 `GraphAnalyzer` 内部封装，Builder 不再直接篡改 Analyzer 缓存字段。
  - `GraphAnalyzer` 通过 `graph:updated` 事件自主失效自身缓存，彻底消除穿透反模式。
  - `DependencyGraph` 保留向后兼容 getter/setter delegate，保障 userspace 测试断言零破坏。
- **框架隐式依赖计算下沉到单文件解析阶段**：
  - 将 `applyFrameworkImplicitImports` 的全图 JS/TS 正则扫盘后处理，迁移到 `analyzeFile` 的单文件解析阶段完成。
  - 隐式依赖现在作为常规 `importRecords` 随 `parseResult` 落入 SQLite 缓存，增量更新时无需重新读盘扫描。
- **Java 包展开幂等化与 Affected-only 增量计算**：
  - 拆分 `expandJavaPackageImports` 为 `_buildPackageIndex` / `_stripJavaExpansions` / `_expandJavaForFile` 四个单一职责方法。
  - 新增 `expandJavaPackageImportsIncremental(affectedFiles)`：仅对 package 变更波及的文件执行局部展开，彻底废除全图扫盘。
  - `java.js` regex fallback 新增 `package` 字段提取，确保 wildcard import 增量展开有完整包索引。
- **防御性修复（审核中发现并修复）**：
  - 用显式 `id: 'expand-java-packages'` 替代脆弱的 `phase.fn.toString().includes(...)` 文本匹配。
  - `_expandJavaForFile` 内部不再操作 `reverseGraph`，统一由调用方 `_removeOldReverseEdges` + `_addReverseEdges` 负责，同时修复全量版本旧 reverseGraph 边未清理的 bug。
  - `expandJavaPackageImports` / `expandJavaPackageImportsIncremental` 改为无条件 emit `graph:updated`，防止只减少边时 analyzer 缓存不失效。
  - `deletedOrUpdatedKeys` 拆分为 `deletedKeys` + `updatedKeys`，cache-hit 文件不再无意义加入 affected set。
- **测试覆盖**：
  - 新增 `test/dep-graph-postprocess-incremental-test.js`（3 个语义测试）：框架隐式依赖缓存集成、Java 包变更一致性、Affected-only O(k) 展开。
  - 新增 `testScanContentCacheBoundary`（`p1-usage-scan-test.js`）：验证 `graph:updated` 正确清空 analyzer 缓存。


---

## 活跃问题与技术债务

| 级别               | 数量        | 内容                                                                                                                                     |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| L1 Blocker         | 0           | —                                                                                                                                       |
| L2 债务            | 0           | —                                                                                                                                       |
| L3 债务与品味      | 5           | 后处理风暴 / 弱断言 / 测试失衡 / slow层测试过重 / 参数校验冗余等 |
| **产品债务** | **0** | —                                                                                                                                       |

**测试覆盖缺口**

> **`npm run test:fast` 80/80 PASS**（~5–6s）。全量 runner **141/141 PASS**（~4min）。测试基础设施已收敛。

> **剩余测试债务（已量化）**：
>
> - **弱断言 ~10 处**：仅余 `typeof` 型 schema 契约检查（带消息参数，风险低）。占总断言数 ~2.3%
> - **console.log 噪音 7 处**：代码字符串内嵌、平台跳过诊断、runner.js 骨架输出
> - **`audit-map-test.js` graph 数据字面量** 仍内联
> - **时序依赖**：mock 内部延迟保留、进程退出超时保护保留
> - **CLI 集成测试补齐**：✅ 已完成物理 CLI 管道与 BOM 边界 E2E 覆盖。
>
> **测试类型分布失衡**：单元测试 ~74%（良好），集成与端到端测试 ~26%（已补充物理磁盘、进程 spawn 和 CLI 管道 E2E 覆盖，物理防线建立完毕），混沌/模糊 0（暂缓）。

---

## 下一步方向

> 阶段 1（误报清零）、阶段 2（暴露正确 + 输出策展）、阶段 3（框架感知深化）全部完成。
> 当前进入 **"低垂果实 + 波次化架构升级"** 双轨阶段。
>
> **根因判断**：resolvers.js 启发式字符串匹配 + 零全局符号表，是 import 解析脆弱、dead-exports 误报、增量性能击穿、Builder 越权操控 Analyzer 的共同根因。修复路线：Pre-scan 全局符号映射 → 语言 Provider 注册表统一契约 → Resolver 策略链物理拆分 → Builder/Analyzer 生命周期事件解耦 → 后处理 Affected-only 增量化。
>
> 相关架构背景参考（独立文档，与本节 Wave 定义非同一套）：
>
> - [REFACTOR：数据层、编排层、输出层三层齐改](./docs/architecture/REFACTOR-2026-05-data-orchestration-output.md) — 22 项代码审计问题的三层重构方案（D1-D8 / O1-O7 / U1-U9）

### 当前状态

- 活跃债务：**0 个 L1** + **0 个 L2** + **5 个 L3** + **0 个产品 bug** + **0 个产品债务**
- 版本：v1.2.0，schemaVersion 冻结
- 测试：**`npm run test:fast` 80/80 PASS**（~5–6s）。全量 runner **141/141 PASS**（~4min）。开发迭代首选 `npm run test:fast`（~5–6s）
- **定位**：AI 的代码脚手架
- **核心认知**：底层引擎能力足够，CLI 出口质量（`--format ai`）已交付。P0–P4 / Wave 1 / Wave 2（D1-D3/D5/D7-D8）/ O1-O3 / U1-U3 全部完成；ROADMAP 阶段 3 框架感知补完（Vue + Spring + Django）已完成，历史见 CHANGELOG。下一阶段主线是**解析精度结构性升级**（Wave 2/3）与**输出层/编排层剩余债务**，必须波次化执行。

### P0 低垂果实（现在做，零风险高 ROI）

> 当前无待执行的 P0 低垂果实。

### P1 解析精度升级

> **约束**：波次化执行，每波之间保持 `npm run test:fast` 80/80 PASS，全量 runner 141/141 PASS。禁止一次性做多层心脏移植。
> Wave 1（SymbolRegistry）已完成，历史见 CHANGELOG。

| 波次     | 范围                                         | 侵入性 | 验证标准                                       | 状态   |
| -------- | -------------------------------------------- | ------ | ---------------------------------------------- | ------ |
| **Wave 2** | Resolver 策略链物理拆分（LanguageProvider）    | 中     | 所有语言解析测试全绿，benchmark 无回归         | ✅ 已完成 |
| **Wave 3** | Builder/Analyzer 解耦 + 后处理 Affected-only | 高     | 增量更新 benchmark 证明 O(k)，watch 模式无泄漏 | ✅ 已完成 |

### 数据层剩余项

> **来源**：[REFACTOR：数据层、编排层、输出层三层齐改](./docs/architecture/REFACTOR-2026-05-data-orchestration-output.md)
> D1-D3 / D5 / D7-D8 已完成，历史见 CHANGELOG。

| #  | 行动                         | 文件                      | 状态    | 说明                             |
| -- | ---------------------------- | ------------------------- | ------- | -------------------------------- |
| D6 | 消除 parseResults/graph 冗余 | `cache.js` `dep-graph.js` | ⏳ 长期 | `nodes` + `edges` 成为唯一事实源 |

### P2 高 ROI 用户可见功能（评估中）

| # | 目标                            | 状态      | 说明                                                                       |
| - | ------------------------------- | --------- | -------------------------------------------------------------------------- |
| 1 | **Bus Factor / 知识分布** | ⏳ 待评估 | `audit-overview` 新增 `knowledgeRisk`：逐文件 git blame + mailmap 去重 |
| 2 | **回归测试档案**          | ⏳ 待评估 | `fp_regression_*.js` 归档已知误报场景，防止修复后复发                    |
| 3 | **路径参数安全清洗**      | ⏳ 待评估 | `--file`/`--cwd` 统一清洗，拒绝 `../` 逃逸                           |

### P3 输出层渐进改善（Dogfood 后续，按节奏推进）

> 来源：本轮 dogfood 实际痛点，ROI 已排序。前三项为"建议做但按节奏来"的渐进改善；第四项已评估为越界，仅作记录。

| # | 目标 | 状态 | 说明 |
|---|------|------|------|
| 1 | **`audit-map` 目录级聚合 compact** | ⏳ 待评估 | edges 按目录聚合（如 `src/services/ → src/tools/ (15 edges)`），或异常-only 模式（只输出 fan-out > N、跨层依赖、孤立子图）。现有 `--compact` 仅压缩 tree 展示，未对 edges 做目录级聚合。 |
| 2 | **Fan-out / Fan-in 指标进 `audit-overview`** | ⏳ 待评估 | hotspot `reason` 只输出"耦合 N 个模块"总数，不区分 fan-in（被多少模块 import）vs fan-out（import 多少模块）。风险性质完全不同：高 fan-out = "这个文件知道太多"，高 fan-in = "改这个文件影响太大"。数据已有（`imports.length` / `reverseGraph`），只需拆分展示。 |
| 3 | **`--format ai` 风险分层输出** | ⏳ 待评估 | 当前 `--json` 太详细（几百行），`--format ai` 太压缩（丢了 `confidenceReason`）。按风险分层：高风险展开详情（file / reason / confidence / `duplicateOf`），低风险一行带过。与 `audit-diff` auto-compact 逻辑同思路。 |
| 4 | **Duplication detection 通用化** | ❌ 暂缓 | 已评估为超出结构分析边界。`severityMeetsFilter` 案例能被抓到是巧合（同时满足"死导出"+"SymbolRegistry 同名"两个独立条件）。专门做 AST 级代码重复检测会变成 SonarQube，违反"结构分析 ≠ 语义分析"原则。 |

### 待挖掘/待验证问题（本轮新增）

| # | 问题                               | 深挖价值 | 验证方案                                                                                                                                                                              |
| - | ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6 | **CLI 命令分层认知负担**     | 高       | ✅ **已修复**（2026-05-24）：默认 `--help` 从 22 命令缩减为 10 个高频 Curated Commands（Tier 1），L2-L4 工具折叠到 `--help --all`。AI 消费者打开 help 后只需在 10 个命令中选择，认知负担降低 55%。 |
| 7 | **Windows 兼容性补丁式累积** | 中       | 路径兼容不是通过统一抽象解决的，而是通过散落在 parser/resolver/git-tools/cli 各处的 `toPosixPath` 调用。验证：搜索 `toPosixPath` 调用点数量，若 >10 处，说明需要统一路径适配层    |
| 8 | **`isKnownEntryFile` 同步磁盘 I/O** | 中       | ✅ **已修复**（2026-05-24）：`_entryFileCache` + `graph:updated` 清空已落地。1329 文件项目的重复同步读已消除。 |
| 9 | **`this.dg.graph` 穿透（38 处）** | 高       | ✅ **已完成**（2026-05-24）：CLI/REPL 边界层剩余 20 处穿透已全部迁移到 `container.snapshot.graph`，`cli.js` 最终组装处已收敛。L4 工具层已在 prior wave 完成迁移。剩余 fallback 路径（`|| container.depGraph`）仅用于测试 mock 兼容。 |
| 10 | **预计算失效粒度太粗** | 中       | ✅ **已修复**（2026-05-24）：`graph:updated` 事件携带变更上下文 `{ changedFiles, fullRebuild }`；`GraphAnalyzer._invalidateCycles()` 仅在变更文件与已缓存 cycle 相交时才清空 `_cachedCycles`，否则保留。`builder.js` / `dep-graph.js` 所有 emit 点已传递上下文。Watch 模式下编辑非 cycle 文件时 cycles 缓存不再重算。 |

### 当前不做

- daemon / 常驻索引进程：违反 CLI-only 原则
- `--suggest` 修复代码自动生成：违反"结构分析 ≠ 语义分析"
- `--cross-repo` 跨仓库依赖分析：成本过高
- 污点追踪 / 跨文件数据流：运行时绑定问题仍解不了
- **`affectedRoutes` 端到端路由提取**：越界语义分析。路由注册（`app.get('/users/:id', handler)`）是运行时语义，不是静态 import 边。若未来要做，只能做成可选适配器，不可成为默认依赖

---

## 实战基地

> `C:\Users\sdses\Desktop\神思\code` 是 workspace-bridge 的实战基地，内含四个仓库，用于功能验证与实战演练。

---

*Last updated: 2026-05-24（Wave 4 Graph Facade 收敛 + Stub Facade 终结者 + CLI Tier 1 渐进式披露 + 预计算缓存细粒度失效 + runner 预热缓存 + slow 并发降级 + watch 超时收紧 + 去 serial 化已完成；80/80 fast 测试全绿；deprecation warning 零泄漏；L3 债务 5 项）*

> **本轮验证状态**：`npm run test:fast` **80/80 PASS**（~5–6s）；全量 runner **141/141 PASS**（~4min）；基线 `node cli.js audit-summary --cwd . --json --quiet` 通过（`healthScore=7/8`，`deadExports=0`，`unresolved=0`，`cycles=0`，`coverageRatio=1.00`，`totalFiles=276`）；CLI smoke（`impact` / `affected-tests` / `repl --eval` / `dead-exports`）零 deprecation warning。
> **实战基地量化**：3 个后端项目（Python 542 文件 / Java 395 文件 / Java 565 文件）`unresolved` 全部为 0 → SymbolRegistry 接入 resolver 的 immediate payoff 为 0，接入优先级降低，暂缓实施。
