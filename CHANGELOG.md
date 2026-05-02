# Changelog

所有版本变更记录。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-05-02

### Breaking Changes

- **`deps` 命令删除** `cli.js` — `deps` 是 `npm outdated --json` 的封装，与「跨文件结构化分析」核心定位无关，且 npm / pip / cargo 自带 `outdated` 功能。这是 1.0 唯一的 breaking change

### 决策变更

- **CLI 瘦身（23 → 8）取消** — 原计划删除 15 个命令，经产品视角重新评估后取消。主要用户是 AI agent，AI 调用原子命令比聚合命令更省 token（精确输出 vs 冗余超集），且 AI 不存在「命令太多选哪个」的认知 paralysis。保留完整命令集对 AI 用户是净收益

## [Unreleased]

### 新增

- **P2: Gradle 任务发现** `src/utils/stack-detector.js` — 新增 `detectGradleSubprojects()` 解析 `settings.gradle`/`settings.gradle.kts` 的 `include` 语句，提取子模块名与目录映射。`getJavaCommands()` 和 `generateCommands()` 的 direct-tests 路径均支持按受影响子模块生成精确 Gradle 命令（`:app:test`、`:app:classes`、`:app:checkstyleMain` 等），不再只能跑全量 `gradlew test`
- **P2: Go module path 聚合** `src/utils/stack-detector.js` — `hasGoProject()` 扩展为检测嵌套 `go.mod`（root 无 go.mod 时扫描一级子目录）；新增 `detectGoModules()` 与 `mapFileToGoModule()`。嵌套 go.mod 场景下，`getGoCommands()` 按模块生成 `cd <module> && go test ./...` 命令，避免在 root 运行导致跨模块测试失败
- **P2: Rust 模块级测试过滤** `src/utils/stack-detector.js` — 新增 `inferRustModuleName()` 从 `src/<module>.rs` / `src/<module>/mod.rs` 路径推断模块名。`getRustCommands()` 和 `generateCommands()` 的 direct-tests 路径在 workspace crate 过滤（`-p`）后追加模块过滤（`cargo test -p crate module_name`），非 workspace 项目也支持模块级过滤（`cargo test module_name`）
- **成功标准 #6：可选外部工具后端（骨架）** `src/adapters/` — 新增 adapter 架构：`BaseAdapter` 接口 + `SemgrepAdapter`（完整实现，调用 `semgrep --json`）+ `CodeQLAdapter`（骨架，待数据库创建策略）。新增 `audit-security` 命令，聚合外部扫描器结果，输出统一 severity 统计

### 测试
- 新增 `test/security-adapter-test.js` — 覆盖 BaseAdapter 接口契约、Semgrep normalizeFinding、severity 映射、auditSecurity 无 scanner fallback

- 新增 `test/gradle-task-discovery-test.js` — 覆盖单模块/多模块/nested 模块/文件在未知模块回退/direct-tests 去重
- 新增 `test/go-module-path-test.js` — 覆盖单模块路径聚合/多模块 cd 命令/root 模块/direct-tests 去重
- 新增 `test/rust-module-filter-test.js` — 覆盖 workspace crate+模块过滤、非 workspace 模块过滤、`mod.rs` 解析、direct-tests 去重

### 修复

- **耦合假阳性收敛（entry 角色）** `src/tools/overview-tools.js` `buildCouplingSplitSuggestions()` — `isOverCoupled` 新增 `!isEntry` 条件，排除 `cli.js`、`src/cli/formatters/index.js`、`src/services/dep-graph/parsers/index.js` 等入口/barrel 文件的误报；同时将非 high-level 阈值从 `total >= 3` 提升至 `total >= 8`（`DEFAULTS.COUPLING_SPLIT_MIN_TOTAL`），耦合建议从 10 条收敛至 2 条真实问题
- **FileIndex 排除测试 fixture** `src/services/file-index.js` — `DEFAULT_EXCLUDE_DIRS` 增加 `wb-analysis-fixture`，避免测试 fixture 被索引后产生死导出/未解析误报
- **search-tools ReDoS 保护加固** `src/tools/search-tools.js` — symbol 搜索路径新增 `String.prototype.includes` 预检，替代 `safeRegexTest()` 的直接调用；text 搜索已使用 `includes`，symbol 正则由 `escapeRegex()` 构建，回溯风险结构性消除
- **editor-state.js / better-sqlite3 清理** 确认 `editor-state.js` 已不存在、`better-sqlite3` 已从 `package.json` 移除，`docs/TECH_DEBT.md` 移除对应条目
- **CLI 错误处理修复（HIGH）** `cli.js` — `--quiet` 不再吞掉致命错误：`catch` 块改用备份的 `originalConsoleError` 输出，用户能在静默模式下仍看到崩溃原因；`formatHuman()` 新增 `result.ok === false` 守卫，避免对错误响应体访问 `result.summary.*` 导致 `TypeError` 崩溃
- **REPL 健壮性修复（MEDIUM）** `src/cli/repl.js` — `--max-depth` 参数新增 `Number.isFinite` + `> 0` 校验，防止 `NaN` 导致 BFS 遍历失控；初始化失败路径新增 `finally` 确保 `container.shutdown()` 总是被调用，消除资源泄漏；移除冗余的 `rl.setPrompt('> ')` 重复调用；`help` 文本补全 `quit` 别名
- **CLI 裸数字归一化（MEDIUM）** `cli.js` / `src/cli/repl.js` / `src/cli/watch.js` — 并发限制 `8`、history limit `25`、初始化超时 `60000`、symbol impact depth `4` 全部集中到 `src/config/constants.js`（`CLI_CONCURRENCY`、`HISTORY_LIMIT`、`INIT_TIMEOUT_MS`、`SYMBOL_IMPACT_DEPTH`）
- **classifyChangeType 精度提升（MEDIUM）** `src/cli/formatters/audit-diff-summary.js` — 新增比例感知：单一类型（test/config/script/code）占绝对多数（>50%）时直接返回该类型，避免 90% config + 10% test 被误判为 tests；`codeRatio > 0.2` 提取为 `DEFAULTS.CODE_CHANGE_RATIO_THRESHOLD`
- **Watch 模式常量归一化（MEDIUM）** `src/cli/watch.js` — 硬编码深度 `3` 改为引用 `DEFAULTS.WATCH_IMPACT_DEPTH`
- **#13** `arrow-function-test.js` 稳定性 — `src/services/dep-graph/parsers/js.js` `parseJavaScript()` regex fallback 现在返回 `functionRecords: []`，避免 `@babel/parser` 不可用时 `functionRecords` 为 `undefined`
- **#14/#15** `audit-diff-test.js` / `functionality-test.js` 诊断增强 — `src/services/dep-graph/function-impact.js` `getChangedFunctionImpact()` 返回 `unavailable` 时附带 `actualParseMode` 字段；测试断言失败前打印诊断日志，帮助定位 AST 模式缺失的根因
- **#16** `affected-tests-heuristic-test.js` 跨平台修复 — `src/utils/test-detector.js` `buildHeuristicSignature()` 在 POSIX 系统上正确处理 Windows 绝对路径（`C:\...`），避免 `path.relative` 行为差异导致启发式签名不匹配
- **#17** `java-parsers-test.js` 环境适配 — 测试开头检测 Python `javalang` 是否可用，缺失时 skip AST 测试而不是硬失败（fallback 测试始终运行）

## [0.9.14] - 2026-05-02

### 新增

- **`watch` 命令**
  - `src/cli/watch.js` — 复用 REPL 的 `ServiceContainer` 初始化骨架（`watch: true`），去掉 readline，注册 `fileIndex.onFileChanged` 回调，文件保存时自动打印 `<file> changed  <n> dependents affected: [list]`
  - `cli.js` — 新增 `watch` case，`printUsage()` 同步更新
  - `test/watch-test.js` — 集成测试：启动 watch → 创建临时文件触发 watcher → 验证 stdout 输出 → 清理

### 修复

- **孤儿检测假阳性收敛**
  - `src/tools/overview-tools.js` `findOrphanFiles()` — 新增跳过 `benchmark/` 目录，benchmark 脚本与 `scripts/`/`bin/` 一样是独立入口，不应被报孤儿
  - `src/tools/overview-tools.js` `findOrphanFiles()` — 新增跳过 `wb-analysis-fixture/` 目录，测试 fixture 不是真实代码
- **耦合建议假阳性收敛**
  - `src/tools/overview-tools.js` `buildCouplingSplitSuggestions()` — `role: script` / `role: test` 的阈值收紧：仅当 `coupling.level === 'high'` 时才建议拆分，排除 `level: low/medium` 的工具脚本和测试文件假阳性
  - 修复前：`src/tools/git-tools.js`（total=8, low）、`src/tools/overview-tools.js`（total=7, low）、`src/tools/workspace-tools.js`（total=6, low）、`test/phase01-quality-test.js`（total=6, low）均被误报
  - 修复后：上述 script/test 角色文件不再出现在耦合建议中

## [0.9.13] - 2026-05-02

### 新增

- **P5 Step 2：缓存解析结果（parseResults）**
  - `src/services/cache.js` — `CACHE_VERSION` 升级到 3，新增 `parseResults` Map（file → `{imports, exports, importRecords, exportRecords, functionRecords, parseMode, confidence, mtime}`），提供 `getParseResult()`/`setParseResult()`/`deleteParseResult()`/`hasParseResult()` API，支持 `save()`/`load()` 序列化/反序列化
  - `src/services/dep-graph.js` — `build()` 按 mtime 分离缓存命中与需解析文件：命中 → 直接 `graph.set(cached)`；未命中 → `analyzeFile()` 解析并写入 cache。实测 82 文件仓库 dep-graph 构建从 **289ms → 3ms**（100% cached），约 **96 倍**加速
  - `src/services/file-index.js` — `pruneExcludedCacheEntries()` 同步调用 `cache.deleteParseResult()`，清理 stale parseResult
  - `test/cache-test.js` — 补 `testParseResultGetSetDelete()` + `testSaveAndLoadRoundtrip()` 中追加 parseResult 断言
- **P5 Step 3：激活 Watcher 增量更新 dep-graph**
  - `src/services/dep-graph.js` — 新增 `updateFiles(filePaths)` 方法：删旧 reverse 边 → 检查 mtime（未变则跳过）→ 重新解析 → 加新 reverse 边。不重建全量 reverseGraph
  - `src/services/file-index.js` — `processPending()` 末尾新增 `onPendingProcessed(files)` 批量回调，所有 `handleFileChange` 完成后统一通知下游
  - `src/services/container.js` — 注册 `fileIndex.onPendingProcessed → depGraph.updateFiles`，实现文件变更 → dep-graph 增量更新的链路
  - `test/dep-graph-incremental-test.js` — 补 3 个测试：`testIncrementalUpdateChangesImports`（验证 import 变化后 reverseGraph 正确更新）、`testIncrementalUpdateSkipsUnchanged`（验证未变文件跳过重新解析）、`testIncrementalUpdateDeletesFile`（验证删除文件后 graph 清理）
- **REPL 交互查询模式**
  - `src/cli/repl.js` — 新增 `startRepl()` + `executeCommand()`，支持 `impact`/`affected-tests`/`dead-exports`/`unresolved`/`cycles`/`dependents`/`dependencies`/`stats`/`help`/`exit` 命令，精简人类可读输出
  - `cli.js` — 新增 `repl` case，`printUsage()` 同步更新。REPL 启动时 `watch: true`，dep-graph 常驻内存，大项目单次查询 <100ms

### 修复

- **Dogfooding 自审修复（耦合/孤儿/test-temp 误报）**
  - `src/tools/overview-tools.js` `buildCouplingSplitSuggestions()` — 排除 `outDegree=0` 的 pure utility 文件（`inDegree<20` 不再报告），消除 `path.js`（in=15）、`constants.js`（in=10）等工具函数/常量文件的耦合假阳性
  - `src/tools/overview-tools.js` `findOrphanFiles()` — `scripts/`/`bin/` 目录下的文件直接跳过，不再标记为孤儿。独立入口脚本不是"可能未使用"
  - `src/services/file-index.js` — `DEFAULT_EXCLUDE_DIRS` 补入 `test-temp`，避免测试 fixture 残留污染审计结果
  - `.gitignore` — 补入 `test-temp/`、`wb-analysis-fixture/`
  - `test/analysis-test.js` — 临时目录从 `test-temp` 迁移到 `wb-analysis-fixture`，避免与默认排除规则冲突
  - `ROADMAP.md` — 删除重复的 Step 3 旧内容
  - `SESSION.md` — 修正测试数 33/33 → 34/34

### 改进

- **DepGraph 构建日志** — 输出缓存命中率（`[DepGraph] Built in Xms: N files (P% cached)`）
- **DepGraph 增量更新日志** — 输出重解析数与跳过数（`[DepGraph] Incremental update: X re-parsed, Y skipped in Zms`）

## [0.9.12] - 2026-05-01

### 修复

- **Issue #6/#9: 框架感知缺失 + 排除规则缺陷**
  - `DEFAULT_EXCLUDE_DIRS` 新增 `.next`、`.nuxt`、`.svelte-kit`、`out`、`.turbo`、`coverage`、`.cache`
  - `isKnownEntryFile()` 识别 Next.js App Router 文件（`page.tsx`、`layout.tsx`、`route.ts` 等）为框架入口，消除 dead-export 误判
  - `isKnownEntryFile()` 识别 Python `if __name__ == '__main__'` CLI 脚本为入口，消除 dead-export 误判
  - `shouldExclude()` 对 `node_modules` 改用相对路径匹配：workspace root 本身位于 `node_modules` 内时，只排除子目录 `node_modules`，不再全量排除整个项目
- **Issue #7/#9/#10/#11: regex 字符串字面量误识别 + cycle 自循环 + 静默降级**
  - `parsers/js.js` regex fallback 新增 `sanitizeForRegex()`：在应用 import regex 前剥离注释和字符串字面量（含模板字符串），消除字符串中的 `import...from` 被误识别为真实 import
  - `parseJavaScript()` 首次 regex fallback 时输出 `console.warn` 提示用户 `@babel/parser` 缺失，避免静默降级
  - `dep-graph.js` `analyzeFile()` 过滤自身引用 import，阻止自循环进入依赖图
  - `findCircularDependencies()` 增加 `[A, A]` 型自循环过滤保险
- **Issue #8: 缓存文件副作用 + audit-file 鲁棒性**
  - `git-tools.js` `getChangedFiles()` 排除 `.workspace-bridge-cache.json`
  - `file-index.js` / `dep-graph.js` `shouldExclude()` 排除 `.workspace-bridge-cache.json`
  - `cli.js` `audit-file` 增加文件存在性检查，对不存在文件返回 `ok: false, error: "File not found: ..."`
- **遗留：性能卡点（`audit-diff` / `functionality-test.js` 超时）**
  - `file-index.js` `DEFAULT_EXCLUDE_DIRS` 补入 `gitnexus`（上一轮遗漏，与已存在的 `gitnexus-extract` 同级）
  - `findFilesAsync` 简化冗余的目录级 `shouldExclude` 双检
  - 清理 `reference/gitnexus/`、`reference/gitnexus-extract/`、`reference/gitnexus.zip` 物理残留与 `.workspace-bridge-cache.json` 旧缓存
- **`changeType` 判断精度提升**
  - `classifyChangeType` 排除 `reference`/`archive` 角色文件，避免参考代码影响主线验证策略
  - 引入 `codeRatio` 阈值（20%）：docs/tests/config 主导时若 code 占比 ≤20%，不强制升格为 `code`，避免改大量文档+1行代码却触发 full 回归
  - `stack-detector.js` 各语言 `get*Commands` 支持 `scripts` changeType，脚本变更不再零命令

## [0.9.11] - 2026-05-01

### 新增

- **`src/utils/test-detector.js`** — 从 `dep-graph.js` 提取测试检测工具函数（`normalizeStem`、`normalizeHeuristicName`、`buildHeuristicSignature`、`getHeuristicLanguageFamily`、`isTestLikeFile`）
- **`.github/workflows/release.yml`** — 自动 release workflow，`npm pack` 生成干净包（白名单过滤内部文档）

### 改进

- **audit-formatters.js 职责拆分** — 原 927 行单文件拆为 `src/cli/formatters/` 目录下 7 职责文件（`composite-risk.js`、`repo-summary.js`、`file-summary.js`、`audit-diff-summary.js`、`validation-advice.js`、`project-map.js`、`impact-explanations.js`）+ `index.js`，更新 5 处引用路径
- **mixed repo 命令精度** — `stack-detector.js` `getNodeCommands()` 引入 `codeTargets` 过滤（`js|jsx|ts|tsx|mjs|cjs`），排除 JSON/缓存文件误入 test runner 生成无意义命令（如 `npx jest .workspace-bridge-cache.json`）
- **classifyChangeType 单一数据源** — `audit-diff-summary.js` 改为 `fileRole` 优先、扩展名仅 fallback；`project-context.js` `inferFileRole()` 补全 `jest.config.` / `prettier.config.` / `requirements` / `pyproject` / `readme` / `sh` / `bash` / `ps1` 等配置/文档/脚本角色
- **skill 体系化** — `workspace-audit` skill description 补充中文触发词（"代码审计, 仓库审计..."），同步到用户级别 + `role-quality` 子 skill；`role-quality/SKILL.md` frontmatter 精简为标准 `name + description`
- **CLI 命令完整性** — `cli.js` 独立暴露 `stats`、`dependencies`、`dependents` 命令
- **配置表化重构（5 处硬编码 if-else 链清零）**
  - `stack-detector.js` — 7 组检测规则配置表化：`STACK_MARKERS`、`PACKAGE_MANAGER_RULES`、`TEST_RUNNER_FILE_RULES`、`LINTER_FILE_RULES`、`DOCS_TOOL_RULES`、`TYPE_CHECKER_FILE_RULES`、`JAVA_BUILD_RULES`
  - `dep-graph.js` — `isTestLikeFile` 改为 `TEST_DETECTION_RULES` 表驱动，工具函数下沉至 `test-detector.js`；文件 -67 行
  - `overview-tools.js` — `calculateHotspotScore` / `calculateStabilityScore` 重构为 `HOTSPOT_SCORE_RULES` / `STABILITY_SCORE_RULES` 数据结构驱动
  - `git-tools.js` — `computeHistoryRisk` 重构为 `HISTORY_RISK_SCORE_GROUPS`，组内 first-match、组间累加
  - `path.js` — `scoreDirectory` 重构为 `WORKSPACE_SCORE_RULES` 配置表驱动
- **`package.json` `files` 字段补全** — 新增 `skills/**`、`README.md`、`LICENSE`，release/npm 包结构完整

### 修复

- **`scripts/self-audit.js` Windows 跨平台** — `spawnSync('npm')` 在 Windows 上返回 ENOENT（Node.js 20+ 禁止直接 spawn `.cmd`），已添加 `shell: process.platform === 'win32'` 平台适配

### 文档

- `AGENTS.md` — 新增 Windows spawn 陷阱、提取类方法委托模式、配置表化互斥判断规则；更新历史债务状态
- `SESSION.md` / `TECH_DEBT.md` / `ROADMAP.md` — 同步本轮完成状态

## [0.9.0] - 2026-04-29

### 新增

- **P2: Rust workspace 子 crate 支持** — `stack-detector.js` 新增 `detectRustWorkspaceMembers()` 解析根 `Cargo.toml` `[workspace]` members，读取每个 member 的 `package.name`。改动 `.rs` 文件时生成 `cargo test -p crate-name`，不再只能跑全量 `cargo test`
- **P3: Language support matrix** — `audit-overview` JSON 输出新增 `languageSupport` 字段，按扩展名统计各语言的解析深度（ast/regex）和 confidence（high/medium/low），含 `files` 和 `astFiles` 计数。human 输出同步追加 `languages` 行
- **P1: 语言级使用点解析** — `dep-graph.js` 新增 `_scanSymbolUsageInImporters()`，轻量扫描 importer 文件内容中的方法调用/字段访问，补充 importRecords 未 capture 的使用（如 Java 实例调用 `foo.bar()`、Go `pkg.Func()`）。消除 Java/Go/Rust 符号级 dead-export 系统性误报
- **P3: 影响路径解释字段 + 变更影响解释链** — `getImpactRadius()` 扩展 `via`（路径链）+ `importedSymbols`（导入符号）+ `reason`；`audit-formatters.js` 新增 `buildImpactExplanations()` 聚合可读因果链（如"因 `resolvers.js` 被 `dep-graph.js` import（resolveImport），故波及测试"）。`audit-diff` 返回 `impactExplanations` 数组
- **P0T5: 内部函数改动→测试映射** — `function-impact.js` DFS 追溯调用链，找到调用内部函数的导出函数，再映射 dependents。`cli.js` 识别 `internal-function-call-chain` mode 触发 function-level test mapping
- **P3: CJS 符号解析补全** — `parsers.js` 识别 `module.exports = { fn }` 和 `exports.fn = ...`，`symbol-impact.js` `buildFunctionToDependents` 同时参考 `functionRecords`，CJS 项目 symbol-level impact 可用
- **JS/TS 全函数定义索引** — `parsers.js` 新增 `functionRecords`，收集所有 `FunctionDeclaration`/`FunctionExpression`/`ArrowFunctionExpression` 的 line range 与 callCallees，为调用链分析提供数据基础
- **P1.5: `audit-map` 全局项目地图** — 聚合 `tree`（目录骨架+文件角色）+ `edges`（import/export 拓扑）+ `issueOverlay`（deadExports/unresolved/cycles/orphans），给 AI 全局视野

### 改进

- **P4: parsers.js 按语言拆分** — 原 976 行超标文件拆为 `src/services/dep-graph/parsers/` 目录（`shared.js` + `js.js` + `python.js` + `java.js` + `polyglot.js` + `index.js`），均 < 500 行。现有 `require('./parsers')` 零改动
- **P0T5 验收达成** — 改 `resolvers.js` 中 `readGoMod`（内部函数）时，`audit-diff` 的 `functionLevelAffectedTests` 包含 `test/gors-resolver-test.js`
- **P1.5 验收达成** — `node cli.js audit-map --cwd . --json --quiet` 输出结构化地图（56 files / 65 edges / 3 deadExports / 9 orphans）

### 修复

- **`buildImpactExplanations()` 自引用语义** — `directImporter = imp.via[0]` 取成 `changedFile` 本身，导致 level>1 的 explanation 出现"被 A import A"。修复为 `imp.via[imp.via.length - 1]`，加 `if (directImporter === changedFile) continue` 防御
- **`checkFile()` 缓存永远失效** — `getDiagnostics()` 返回 diagnostics 数组，但 `checkFile()` 按 `{mtime, diagnostics}` 对象读 `.mtime`。新增 `cache.getDiagnosticsEntry()` 返回完整 wrapper，`checkFile()` 和 `getCached()` 改用之
- **`_scanSymbolUsageInImporters()` SyntaxError** — symbol 含 `$`、`.` 等正则元字符时直接拼接到 `new RegExp` 中导致异常或错误匹配。修复：拼接前做 `symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` 转义
- **`visitFunctionNode()` 遗漏箭头函数** — 只认 `FunctionDeclaration/FunctionExpression`，`const foo = () => {}` 完全跳过。修复：`visitFunctionNode(node, parent)` 新增 `ArrowFunctionExpression` 分支，从父 `VariableDeclarator` 取函数名

## [0.8.2] - 2026-04-28

### 新增

- **Java AST 支持**（P4-A）- `scripts/java_ast_parser.py` 使用 javalang 进行 AST 级解析，提取类名/public 方法/public 字段/接口方法，失败自动回退 regex
- **Kotlin/Go/Rust L2 支持**（P4-B）- 文件索引、regex 级解析器、技术栈检测与验证命令生成
- **多模块 Java source root 自动发现** - 支持 `module-a/src/main/java` 及 `src/main/kotlin` 目录结构

### 改进

- **Go 验证命令** - focused 阶段按 package directory 聚合生成 `go test ./pkg1 ./pkg2`，不再直接传文件路径
- **符号级影响分析** - Java 从 regex 提升到 AST 级；JS/TS/Python 已实现 AST 级

### 修复

- **Java static import 解析** - source 保持标准包路径（不再带 `static ` 前缀），resolver 可正确解析
- **Java 接口方法提取** - InterfaceDeclaration 中的方法纳入 exports，避免低估 symbol impact
- **Kotlin 依赖解析** - `resolveJavaImport` 同时查找 `.java` 和 `.kt` 文件，打通 Kotlin import 解析
- **Java 方法级 dead-export 误报** - 有 importer 的 Java AST 文件不再产生符号级 dead-export（实例调用 `foo.bar()` 不在 import 记录中体现）
- **Gradle Checkstyle 命令格式** - Gradle 项目使用 `gradlew checkstyleMain checkstyleTest`，不再混用 Maven 的 `checkstyle:check` 语法

## [0.8.0] - 2026-04-03

### 新增

- **audit-overview** - 项目全景视图命令（P3）：
  - 热区图（hotspotsByRisk）- 基于 Git 历史和依赖耦合度识别高风险文件
  - 稳定性趋势（stabilityCounts）- 综合测试覆盖、改动频率、循环依赖评分
  - 孤儿文件检测（orphans）- 发现可能未使用的文件
  - 架构建议（architectureAdvice）- 循环依赖重构建议、过度耦合模块拆分提示
- **可视化输出**（P5）- `audit-overview --format html` 生成交互式仪表板
- **技术栈检测增强** - 自动识别 Java（Maven/Gradle）、Python（Django/FastAPI/Flask）框架
- **函数级测试映射**（P2）- `audit-diff` 精确映射变更函数到相关测试（JS/TS 支持）
- **AST 相似度检测**（P2）- 发现相似函数时给出参考实现提示（可选功能）
- **CLI 回退链**（P6）- `scripts/cli-fallback.js` 支持全局安装回退到本地 cli.js
- **Skill 标准化 v1**（P6）- `workspace-audit` skill 支持随机路径启动、标准输出契约
- **性能基准**（P1）- 新增 500+ 文件性能测试脚本

### 改进

- **benchmark 阈值策略**（P6）- 相对基线 + 30% 波动容忍，替代固定 500ms 阈值
- **混合仓库识别** - 自动检测 prototypes/examples 目录并降权处理
- **入口识别增强** - 支持框架配置文件（vite.config、manage.py 等）作为入口
- **缓存系统** - 内容哈希缓存，自动失效机制
- **符号级影响分析** - JS/TS/Python 已实现 AST 级；Java 为 regex 级，AST 支持在 P4-A 计划中

### 变更

- **CLI-only** - 完全移除 MCP server，仅保留本地 CLI + skill 工作流
- **输出标准化** - 所有命令遵循 Scope/Top Risks/Actions/Validation/Confidence 契约

## [0.6.0] - 2026-03-27

### 新增

- **跨文件分析查询** - `dependency_graph` 工具新增三个 operation：
  - `dead_exports` - 查找未被引用的导出（confidence: high/medium）
  - `unresolved` - 查找解析失败的 import
  - `affected_tests` - 沿依赖图 BFS 查找受变更影响的测试文件
- **后台诊断缓存** - `diagnostics_live` 现在默认返回缓存结果（0ms），无缓存时调度后台检查
- **新增测试** - `test/analysis-test.js` 覆盖三个跨文件分析查询
- **配置集中化** - `diagnostics-engine.js` 和 `dep-graph.js` 添加 CONFIG 常量对象

### 改进

- **稳定性** - `server.js` 添加 SIGTERM 和 stdin close 处理，shutdown 添加 5 秒超时保护
- **性能** - `dep-graph.js` 使用异步 IO + 并发限制（20），避免大仓库阻塞事件循环
- **安全性** - `sanitize.js` 移除 shell arg 中的 `/` 和 `\` 允许，防止路径遍历绕过
- **错误处理** - `editor-state.js` 检测 SQLite magic bytes，明确返回 null 而不是假装成功

### 变更

- **Breaking** - `diagnostics_live` 的 `file` 参数改为 required，不再依赖 EditorState
- **版本** - 版本号更新至 0.6.0

### 修复

- 修复安全测试中 shell 参数消毒的绕过问题
- 修复跨平台测试中使用 `echo` 命令失败的问题（改用 `node -e`）
- 修复 `findDeadExports` 中 Map 迭代可能被修改的问题（使用 `Array.from()` 复制）

### 已知问题

- `editor-state.js` 模块当前不可用（VS Code state.vscdb 为 SQLite 二进制格式）
- `findDeadExports` 在无 AST 分析时误报率高，barrel exports 场景基本不可用
- `findUnresolvedImports` 内部仍有同步 IO（`fs.existsSync`）

---

## [0.5.1] - 2026-03-27

### 安全加固

- ReDoS 防护 - 正则查询添加 100ms 超时
- 错误信息脱敏 - 绝对路径和用户信息公开为 `<path>` / `<user>`
- 初始化竞争修复 - 所有工具添加 `await container.ensureReady()`
- 路径遍历防护 - `validateWorkspacePath()` 强制校验
- 命令注入防护 - 全部使用 `spawn` + 参数数组

---

## [0.5.0] - 2026-03-26

### 初始版本

- 11 个 MCP 工具：workspace_info、run_diagnostics、diagnostics_live、git_diff_summary、git_blame、git_history、search_code、lookup_symbol、project_health、check_dependencies、dependency_graph
- ServiceContainer 架构：WorkspaceCache、FileIndex、DiagnosticsEngine、EditorState、DependencyGraph
- 零运行时依赖
- 安全编码：参数化命令、路径校验、输入消毒

---

[0.8.0]: https://github.com/user/workspace-bridge/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/user/workspace-bridge/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/user/workspace-bridge/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/user/workspace-bridge/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/user/workspace-bridge/releases/tag/v0.5.0
