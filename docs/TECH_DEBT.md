# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

全部清零（2026-05-05）。见 [CHANGELOG.md](../CHANGELOG.md)。

---

## 产品层面缺陷（非代码错误，是产品价值/信任/可用性问题）

#### P1/P63. Vue 假阳性三角（dead-export + orphan）— 部分残留

| 根因                           | 状态                |
| ------------------------------ | ------------------- |
| `.vue` 扩展名省略 + alias    | ✅ 已修复           |
| 动态路由懒加载                 | ✅ 已修复           |
| 全局组件注册                   | ✅ 已修复           |
| 自定义指令 / 动态字符串调用    | ✅ 已修复           |
| `fs.readFileSync` 运行时读取 | ⏳ 超出静态分析范围 |
| 动态字符串调用 orphan          | ⏳ 占位，需语义分析 |

---

#### P24. `impact` source 文件出现在自己的影响列表里 ⏸ cannot-reproduce

⏸ cannot-reproduce。代码已有 guard，当前无法复现。如发现复现路径，重新打开。

---

#### P30. `unresolved` 的 `resolvedTo` 语义冻结

⏸ 冻结。`resolvedTo: null` = 未解析到磁盘文件。不改 schema，不增加新字段。

---

#### P43. `health.checks.ci` 未检测到 `.github/workflows` ⏸ cannot-reproduce

⏸ cannot-reproduce。当前代码已递归扫描 `.yml`/`.yaml` 文件，无法复现。

---

## 架构债务（不阻塞功能，但阻塞演进速度）

#### P8-2-1. `parseCommandString` 是后处理补丁，非正交设计

**数据**：`commands.js` 中 20+ 处 `push({cmd: '...'})`，最后由 `parseCommandString` 统一 regex 解析为 `executable`。同一条命令的信息在生成侧（拼字符串）和消费侧（拆字符串）各存在一次。

**成本**：新增语言/命令时，开发者需同时验证：① `cmd` 字符串正确 ② `parseCommandString` 能正确拆分它。引号内空格、Windows 路径空格等边界情况随时可能击穿解析器。

**理想形态**：`buildNodeTestCommand`、`buildGoModuleTestCommands` 等处直接返回 `{name, description, executable}`，`cmd` 由 `renderCommandString(executable)` 纯函数合成。新增语言只需维护一处结构。

**触发重构条件**（任一满足即做）：
1. `parseCommandString` 遇到真实解析 bug
2. 新增第 10 种语言，命令生成逻辑继续膨胀
3. P8-1 需要修改 `commands.js` 的命令生成逻辑

#### P8-0. dep-graph.js God Class ✅ 已完成

**数据**：~1121 行 → ~1168 行（+47 行粘合代码），coupling total=25（in=14, out=11），原同时承载 6 项职责。

**方案**：对外接口 100% 不变，内部拆为 `GraphBuilder` / `GraphAnalyzer` / `GraphQuery` 三个 collaborator，`DependencyGraph` 退化为 facade。不物理拆文件。

**验证**：85/85 测试通过，healthScore=5/5，零外部调用方改动。

**P8-1 插槽已预留**：`GraphBuilder.onBuildComplete` / `GraphBuilder.onFileUpdated`。

#### P74. `_scanLocalSymbolUsage` 内存峰值（已修复问题的遗留）

**数据**：`dep-graph.js:655` `_scanLocalSymbolUsage` 仍使用 `content.split('\n')`。`file-index.js` 的同样问题已在 v1.1.0 修复（改用 `content.match(/\n/g)?.length + 1`），但 `_scanLocalSymbolUsage` 的逐行扫描逻辑未同步优化。

**影响**：大文件（1MB+）的 dead-export 分析会产生 ~20MB 临时数组，与 file-index.js 修复前的内存峰值相同。

**修复方向**：改用 `content.match(/\n/g)` 遍历或流式扫描。

---

#### P75. `framework-usage-patterns.js` 无缓存 I/O

**数据**：`resolveImplicitImports()` 每次调用 `fs.existsSync(resolved)`，无缓存。`applyFrameworkImplicitImports()` 在每次 `build()` / `updateFiles()` 时全量扫描所有 JS/Vue 文件并重复解析隐式边。

**影响**：大仓库中每次增量更新都会触发数十到数百次同步 I/O。

**修复方向**：复用 `resolvers.js` 的 `cachedExistsSync` 或引入局部缓存。

---

#### P76. `watch.js` `executeWatchCommand` stdout 拼接无上限

**数据**：`child.stdout.on('data', (data) => { stdout += data.toString(); })` 对长时间运行/高输出的测试无体积限制。

**影响**：极端情况下（如测试框架输出大量日志）可能 OOM。

**修复方向**：设置 `stdout`/`stderr` 上限（如 1MB），超限截断并标记 `truncated: true`。

---

#### P77. `findUnresolvedImports` Windows 路径格式不一致

**数据**：`dep-graph.js:751` `if (!this.dg.hasFile(imp) && path.isAbsolute(imp) && !fs.existsSync(imp))`。`hasFile()` 使用 `normalizePathKey()`（Windows 下小写+POSIX 斜杠），而 `path.isAbsolute(imp)` 检查原始路径格式。

**根因**：`imp` 可能是 `c:/users/...`（normalizePathKey 格式），`path.isAbsolute()` 在 Windows 上能识别 `c:/...`，但理论上存在 `hasFile` 和 `isAbsolute` 判断不一致的边界。

**风险**：低。当前代码在 Windows 实测正常，但这是隐性假设，未在测试中覆盖。

---

#### P78. 脚手架噪音淹没业务信号（RuoYi/Spring Boot 模板同质化）✅ 已修复

**数据**：`ai_zcypg_backend` 与 `ai_zsgzt_backend` 基于同一套若依（RuoYi）脚手架，两个仓库的 dead-exports 重合度 > 90%。

**修复**：`src/tools/scaffold-detector.js` 精简交付。保守两层匹配：`exactBasenames`（高度特异文件名）+ `pathPatterns`（通用文件名仅在含 `ruoyi` 等路径标记时匹配）。`honesty-engine` / `dep-graph` / `recommendation-engine` / `repo-summary` 全链路集成。`audit-summary` JSON 新增 `honesty.deadExports.scaffoldDeadExports`。

---

#### P86. `vue-page-implicit` 误报仅计数、未归因到具体文件

**数据**：`ai_zcypg_frontend` 的 `possibleFalsePositives` 报告 `vue-page-implicit: 2`，提示"2 of 10 dead exports could be false positives"，但 10 条 `deadExports` 明细中没有任何一条标注 `reason: "vue-page-implicit"` 或类似的误报风险提示。

**根因**：`honesty-engine.js` 的聚合层统计了 false positive 原因分布，但未把该标签下沉到单条 dead-export 记录。

**影响**：用户无法定位哪两个导出是疑似误报，增加了排查成本。

---

#### P87. importerCount>0 的 dead-export 解释信息过于模板化

**数据**：`ai_zcypg_frontend` 中，`ruoyi.js` 的 `sprintf`（importerCount=8）、`validate.js` 的 7 个导出（importerCount=8）、`policyeval/controller.js` 的 2 个导出（importerCount=18），所有条目的 `confidenceReason` 均为完全相同的字符串："AST-level analysis found unused exports (dynamic imports or string calls may bypass static detection)"。

**根因**：这些模块**本身被大量文件导入**，只是具体的 named export 未被使用。但 `computeDeadExportConfidence()` 未区分"模块无人导入（importerCount=0）"和"模块有导入方但特定导出未使用（importerCount>0）"，统一返回相同的 `confidenceReason`。

**影响**：用户看到 `importerCount: 18` 却收到"可能绕过静态检测"的模糊解释，降低了结果可信度。应返回差异化文案，如"File has 18 importers but these specific exports are not referenced by any importer"。

---

#### P82. Maven 项目 `testFiles: 0`

**数据**：`ai_zcypg_backend`（389 文件）和 `ai_zsgzt_backend`（550 文件）均报告 `testFiles: 0`。实际两个 Maven 多模块项目均有 `src/test/java` 目录。

**根因**：`file-index.js` 的 `getFilePatterns()` 或 `shouldExclude()` 可能排除了测试目录，或 `isTestLikeFile()` 的 Java 测试检测规则未覆盖 Maven 的 `*Test.java` / `*Tests.java` 命名。

**影响**：health 检查的 `testConfig` 和 `testFiles` 均失效，影响 AI 对项目测试覆盖的判断。

---

#### P83. 文件扫描数量与用户预期差距大

**数据**：`ai_zcypg_backend` 实际 1547 文件，扫描到 389；`ai_zsgzt_backend` 实际 1789 文件，扫描到 550。前端：`ai_zcypg_frontend` 实际 368 文件，扫描到 228；`ai_gwy_frontend` 实际 23 文件，扫描到 11。

**根因**：workspace-bridge 只统计能解析的 mainline 文件（Java/JS/Vue 源码），Maven 项目的 `target/`、资源文件（`*.xml`、`*.yml`、`*.properties`）、前端产物（SVG、图片、CSS）等被排除。这是设计行为，但 `totalFiles` 的命名可能让用户误以为扫描不完整。

**影响**：低。但 `testFiles: 0`（P82）和资产文件排除的叠加，可能让用户对索引完整性产生怀疑。

---

#### P84. 多模块 Maven 项目模块边界未显式标注

**数据**：两个 Spring Boot 多模块项目的 `unresolvedCount` 均为 0。

**根因**：模块间交叉引用（如 `aizcypg-biz` 引用 `aizcypg-common`）被正确解析，但模块间的耦合强度、跨模块依赖热力图未被显式输出。所有文件被扁平化处理。

**影响**：架构审计中丢失了一个重要维度——模块边界内的紧耦合 vs 模块间的松耦合。

---

#### P88. 前端分析文件数差距（368 vs 228，23 vs 11）

**数据**：`ai_zcypg_frontend` 实际 368 文件，扫描到 228（排除了 92 SVG + 其他资产）；`ai_gwy_frontend` 实际 23 文件，扫描到 11（排除了 CSS 和 public 资产）。

**根因**：同 P83。前端项目的 SVG、图片、样式等被作为资产排除，但 `src/` 内的 `setupProxy.js`、`config.js` 等配置文件是否被正确归类也存疑。

---

#### P89. Windows 路径大小写被强制归一化

**数据**：`ai_gwy_frontend` 磁盘实际文件为 `src/utils/filePreview.js`（`P` 大写），但 JSON 输出路径为 `src/utils/filepreview.js`（全小写）。

**根因**：`normalizePathKey()` 在 Windows 上使用 `toLocaleLowerCase('en-US')` 做大小写归一化。虽然本地匹配无影响，但跨平台（如与 Linux CI 对比）时可能导致路径匹配失败。

**影响**：低。但这是隐性假设，未在测试中覆盖。

---

#### P90. `.workspace-bridge.json` 配置状态不对称触发 cycle 数据不一致

**数据**：`ai_zcypg_frontend` 存在 `.workspace-bridge.json`（内容为空，仅含 schema），`hasWorkspaceBridgeConfig: true`；`ai_zsgzt_frontend` 无该文件，`hasWorkspaceBridgeConfig: false`。该差异导致 zcypg 被识别出 15 个 non-mainline 文件（test），而 zsgzt 为 0。更关键的是，zcypg 的 `audit-summary`（cycles=7）与 `cycles` 命令（cycles=3）数据不一致，而 zsgzt 的两条命令均一致（cycles=2）。

**根因**：工具对"有空配置"和"无配置"的处理路径不同，可能间接触发了 `_cycleCount` 的缓存/计算路径分叉。

**风险**：条件触发，难以稳定复现。但这是架构层面的信号路径不一致问题。

---

#### P91. `audit-summary` / `audit-overview` orphans 聚合与明细不一致

**数据**：`ai_gwy_backend` 的 `audit-summary` 报告 `orphanCount: 4`，但明细列表中仅列出 2 个 orphan 文件。`audit-overview` 的 `orphanFiles` 数组长度同样与顶部统计数字不符。

**根因**：`overview-tools.js` 中的聚合逻辑与 `project-map.js` / `audit-summary` 中的 orphan 计数逻辑存在路径分叉。`getOrphanFiles()` 和 `summarizeFiles()` 可能使用了不同的排除规则（如 `scripts/` / `bin/` / `benchmark/` 目录的跳过逻辑不同步）。

**影响**：用户看到"4 orphans"但只能找到 2 条明细，产生数据不可信感。

**修复方向**：统一 orphan 判定和计数逻辑，确保聚合层与明细层使用同一套过滤规则。

---

#### cli.js 厚门面

**数据**：~623 行，`formatHuman` ~200 行 switch 覆盖 20+ 命令。每新增命令或参数都要改 cli.js。

**影响**：变更频率与 feature 增长速度成正比，长期是瓶颈。

**方案**：每个 formatter 文件额外导出 `formatHuman(result)`，cli.js 动态查找。与 P8-2 同期做。

---

## L3 品味问题（建议修，非债务）

以下问题属于代码风格/长度建议，不影响功能正确性。已完成项（`validation-advice.js`、`container.js`、`function-impact.js`、`symbol-impact.js`、`project-context.js` 拆分/降行）不再列出。

| 位置                  | 问题                                                              | 优先级 |
| --------------------- | ----------------------------------------------------------------- | ------ |
| `git-tools.js`      | `getChangedFiles()` 手动字符级解析                              | 低     |
| `overview-tools.js` | `renderOverviewDashboard` 中 HTML/CSS 裸数字                    | 低     |
| `js.js`             | `parseJavaScriptAST` ~265 行、`parseJavaScript` regex ~147 行 | 低     |
| `path.js`           | `hasPathSegment` 语义陷阱：只取 segment 最后一级                | 低     |
| `dep-graph.js`      | `isLikelyFrameworkLegitimateCycle` 仅覆盖 Vue，React/Java 无过滤 | 低     |
| `framework-patterns.js` | Django middleware/database router/context processors 未覆盖   | 低     |
| `honesty-engine.js`   | `vue-page-implicit` 等 fp 原因未下沉到单条 dead-export 记录    | 低     |
| `dep-graph.js`        | `computeDeadExportConfidence` 未按 importerCount 差异化 reason   | 低     |

---

## 文件级雷区地图

| 文件                                        | 行数 | 风险         | 状态                                                      |
| ------------------------------------------- | ---- | ------------ | --------------------------------------------------------- |
| `src/services/dep-graph.js`               | ~1121 | **高** | 核心引擎类，AGENTS.md 已确认"内聚优先、不物理拆分"        |
| `src/tools/overview-tools.js`             | ~622 | 中           | 裸数字已归零（JS侧），HTML/CSS 裸数字仍在                 |
| `src/tools/git-tools.js`                  | ~620 | 中           | `getChangedFiles()` 手动字符级解析是已知债务            |
| `cli.js`                                  | ~623 | 中           | 命令分发中心，分支短                                      |
| `src/cli/formatters/validation-advice.js` | ~312 | 低           | 已拆为 6 个纯函数；文件变长是因为总代码量增加，内聚性提升 |
| `src/utils/project-context.js`            | ~297 | 低           | `inferFileRole()` 已降至 12 行，顶部常量集合可继续提取  |
| `src/utils/stack-detectors/detect.js`     | ~351 | 低           | 已从 stack-detector.js 拆分                               |
| `src/utils/stack-detectors/commands.js`   | ~404 | 低           | 已从 stack-detector.js 拆分                               |
| `src/services/file-index.js`              | ~420 | 低           | 已从 ~523 行降下                                          |

---

## 测试覆盖缺口

> **2026-05-05 更新**：新增 `test/js-regex-cjs-test.js`，JS regex fallback 已有基础覆盖。

| Parser / 模块                   | 测试文件                                | 状态 |
| ------------------------------- | --------------------------------------- | ---- |
| JS AST + functionRecords        | `test/arrow-function-test.js`         | ✅   |
| Java AST + regex fallback       | `test/java-parsers-test.js`           | ✅   |
| JS regex fallback (CJS exports) | `test/js-regex-cjs-test.js`           | ✅   |
| Python (AST/regex)              | `test/parser-schema-contract-test.js` | ✅   |
| Kotlin / Go / Rust (polyglot)   | `test/parser-schema-contract-test.js` | ✅   |

---

### 仍无直接测试的模块（低优先级）

| 文件                                          | 风险等级 | 说明                                                     |
| --------------------------------------------- | -------- | -------------------------------------------------------- |
| `utils/orphan-detector.js`                  | ✅ 低    | 已补 `test/orphan-detector-test.js`                    |
| `services/file-index/symbol-extractors.js`  | 🟡 中    | 被 file-index 集成测试间接覆盖                           |
| `services/dep-graph/function-similarity.js` | ✅ 低    | 已补 `test/function-similarity-test.js`                |
| `services/dep-graph/parsers/shared.js`      | 🟡 中    | 被 parser 测试间接覆盖                                   |
| `services/dep-graph/parsers/spawn-ast.js`   | 🟡 中    | 被 java-parsers-test.js / go-ast-parser-test.js 间接覆盖 |
| `services/dep-graph/parsers/polyglot.js`    | 🟡 中    | 被 parser-schema-contract-test.js 间接覆盖               |
| `cli/formatters/*.js`                       | 🟡 中    | 被 functionality-test.js / audit-diff-test.js 间接覆盖   |

### 有测试但可继续深化的模块

| 模块              | 测试文件                  | 仍缺覆盖                                                 |
| ----------------- | ------------------------- | -------------------------------------------------------- |
| `file-index.js` | 间接测试                  | watcher 完整链路、readdir 权限拒绝、AbortController 超时 |
| `watch.js`      | `watch-test.js`         | compact 模式真实输出、~~SIGINT/SIGTERM 异常隔离~~ ✅ 已覆盖 |
| `repl.js`       | `repl-test.js`          | 真实容器初始化、热点 threshold 边界                      |
| `cli.js`        | `functionality-test.js` | mapper 异常、adapter 异常、所有 human 格式化分支         |

### Flaky 根因

| 测试文件                                             | 根因                                                    | 建议修复                                           |
| ---------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `watch-test.js`                                    | ~~固定 `delay(2500)` 假设 + fs.watch 平台时序差异~~ ✅ 已修复 | — |
| `functionality-test.js`                            | 修改 repo root 的 tracked 文件（README.md）+ 无原子恢复 | 用 `fs.copyFileSync` 在副本上操作                |
| `java-parsers-test.js` / `go-ast-parser-test.js` | 外部进程 `timeout: 5000` 冷启动可能超时               | 提升至 15000ms 或根据 `CI` 环境变量动态调整      |
