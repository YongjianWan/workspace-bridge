# Changelog

所有版本变更记录。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 修复（L2 技术债清零 — 19 项）

- **L2-7: `audit-diff` 零变更时 hallucination 为 `"docs"`** `src/cli/formatters/validation-advice.js` — `buildValidationAdvice` 在 `entries.length === 0` 时短路返回 `changeType: "none"` 和空 `phases`
- **L2-10: `affected-tests` 扁平测试目录 heuristic 漏配** `src/services/dep-graph.js` — `_findAffectedTestsByHeuristic` 新增 leaf-name fallback
- **L2-13: `audit-map` 无 `--compact` 时信息过载** `src/cli/formatters/project-map.js` `src/config/constants.js` — compact 模式应用 `COMPACT_ISSUE_MAX_ITEMS`（10）截断
- **L2-14: Windows 路径格式混乱** `src/services/dep-graph.js` `src/tools/dep-tools.js` — 所有命令绝对路径统一为小写 POSIX 格式
- **L2-17: `vite.config.js` 被误判为 entry** `src/utils/project-context.js` — 将 `vite.config.*` 从 `FRAMEWORK_ENTRY_FILES` 移除，由 `CONFIG_PATTERNS` 统一归类为 `config`
- **L2-18: 深层 `index.js` 被误判为 entry** `src/utils/project-context.js` — `inferFileRole()` 对 `index.js`/`index.ts` 增加深度限制
- **L2-19: `stabilityScore` 所有文件统一为 60** `src/config/constants.js` — `STABILITY_BASE_SCORE` 50→40，`STABILITY_LOW_IMPACT_DELTA` 10→15，`STABILITY_CONFIG_ROLE_DELTA` 10→5
- **L2-20: `symbolToDependents` 与 `functionToDependents` 完全重复** `src/services/dep-graph/symbol-impact.js` `function-impact.js` — `buildFunctionToDependents` 不再返回完整 `dependents` 数组
- **L2-21: `deadExports.confidence` 分级与真实数据脱节** `src/services/dep-graph.js` — 新增 `importerCount` 字段，confidence 基于 importerCount + parseMode
- **L2-22: `cycles` 路径格式与其他命令不一致** `src/services/dep-graph.js` `src/tools/dep-tools.js` — 同 L2-14 统一修复
- **L2-23: `init` 命令生成空配置无引导价值** `cli.js` — 扫描根目录子目录，启发式填充 `generated` / `reference`
- **L2-24: `repl` 模式 stderr 污染** `src/cli/repl.js` — `startRepl` 接收 `quiet` 选项
- **L2-25: `audit-map --compact` 模块级 edges 严重遗漏** `src/cli/formatters/project-map.js` — `getModuleOf` 从 2 segments 提升到 3 segments
- **L2-26: `scope.nonMainlineFiles` 始终为 0** `src/utils/project-context.js` — `summarizeFiles()` 将 `test`/`docs` 计为 `nonMainline`
- **L2-27: `audit-overview` 默认输出含永久 `enabled: false` 噪音** `src/tools/overview-tools.js` — 默认输出不再包含未启用的 option 字段
- **L2-28: 15% 文件 AST fallback 无原因说明** `src/services/dep-graph.js` `src/tools/overview-tools.js` — `analyzeFile` 新增 `parseModeReason`；`buildLanguageSupportMatrix` 新增 `regexFiles` + `fallbackReasons`
- **L2-29: `parserAvailability.skipped` 信息未暴露** `src/tools/workspace-tools.js` `health-tools.js` — `workspaceInfo` 输出新增 `parserAvailability` 字段
- **L2-6: `impact` 命令 `transitiveCount` 与 `impact` 数组数据矛盾** `src/services/dep-graph/symbol-impact.js` — `transitiveCount` 从 `getImpactRadius()` 同步计算
- **L2-8: `audit-security` 无 semgrep 时直接不可用** `src/tools/security-tools.js` — 内置轻量规则扫描（`eval` / `innerHTML` / `document.write` 等）
- **L2-9: `diagnostics` 只跑 `npm run -s`，未执行 linter** `src/tools/workspace-tools.js` `cli.js` — 自动检测 eslint 配置并执行；无 linter 时返回 `total: null` + `noLintersDetected: true`
- **L2-12: `--exclude` 只影响 scope 计数，不影响分析结果** `src/services/file-index.js` `src/services/dep-graph.js` `src/utils/orphan-detector.js` — CLI `--exclude` 改为只在报告阶段过滤，被排除文件仍参与依赖图构建（保留 importer 关系）。`FileIndex` 分离 `baseExcludeDirs` / `cliExcludeDirs`；`DependencyGraph` 新增 `shouldExcludeCli()`；`findDeadExports` / `findUnresolvedImports` / `findOrphanFiles` / `getScopeSummary` 均在返回前过滤

### 修复（产品缺陷 — 5 项）

- **P2/P6: Java 后端项目完全失明（fileCount=0）** `src/config/constants.js` `src/services/file-index.js` — `FILE_INDEX_MAX_DEPTH` 5→12；`DEFAULT_EXCLUDE_DIRS` 补充 `target`/`bin`/`obj`/`.idea`/`.vscode`/`vendor`。两个 Java 后端项目（389 + 550 文件）现已正常扫描
- **P28: `hotspot` 配置文件被系统性误标为风险** `src/tools/overview-tools.js` `src/config/constants.js` — `calculateHotspotScore` 新增 `fileRole` 参数，config 文件 score 乘以 `HOTSPOT_CONFIG_DISCOUNT`（0.3）
- **`cycles` 数组首尾重复** `src/services/dep-graph.js` — 去掉 `.concat([file])`，输出标准图论不重复顶点列表
- **REPL `impact` 与独立命令结果不一致** `src/cli/repl.js` — 统一 `resolveWorkspaceFilePath` 解析相对路径为绝对路径
- **`file-index` 构建日志矛盾** `src/services/file-index.js` — 日志改为报告缓存总文件数 `getStats().files`
- **P10: `affected-tests` 永远返回 0** `src/services/dep-graph/parsers/registry.js` `test/parser-registry-test.js` — `.mjs` / `.cjs` / `.mts` / `.cts` 被 `file-index` 索引但 `registry.findByExt()` 未覆盖这些扩展名，导致 `analyzeFile` 跳过解析、imports 为空。`exts` 数组补充 4 个缺失扩展名。Vue 前端 `response.js` 实测从 0 → 2 个测试。`fs.readFileSync` 运行时读取模式仍超出静态分析范围。
- **P20: 命令输出中没有"误报率预估"或"诚实度"标注** `src/tools/honesty-engine.js` `src/tools/dep-tools.js` `src/cli/formatters/repo-summary.js` `cli.js` — 新增 `honesty-engine` 假阳性分类引擎。`dead-exports` / `unresolved` 输出 `possibleFalsePositives`（count / primaryReason / disclaimer）；`audit-summary` 输出 `honesty` 字段；`nextSteps` 根据假阳性比例动态调整建议文案
- **P64: Health 建议命令脱离实际技术栈** `src/tools/health-tools.js` — `FIX_SUGGESTIONS` 静态表改为 `buildFixSuggestions(stack)` 动态函数，接入 `detectStack` 的 `profile`（node-first / java-first / python-first / go-first / rust-first / cpp-first / mixed）生成差异化 `testConfig` 建议文案。Java 项目不再被建议 Jest，Node 项目优先提示 Vitest（Vite 生态）。

### 修复（生产环境实测 — 4 仓库端到端审计）

> 2026-05-07 用 2 个 Vue/Vite 前端 + 2 个 Maven 多模块 Java 后端做端到端测试，暴露 9 项严重缺陷，全部修复。

- **Java 多模块后端完全失明** `src/utils/path.js` — `detectWorkspace` 递归检查一层子目录的 `pom.xml`/`build.gradle`
- **Vue SFC `.vue` 扩展名省略导致 100% unresolved** `src/services/dep-graph/resolvers.js` — `RESOLVER_EXTENSIONS` 增加 `.vue`
- **Vue/Vite alias（`@/`/`~`）未解析导致 dead-export 假阳性 >80%** `src/services/dep-graph/resolvers.js` — 新增 `_resolveAlias` 读取 `tsconfig.json`/`jsconfig.json` 的 `compilerOptions.paths`
- **Vue 项目入口文件被标为 orphan** `src/services/dep-graph.js` `src/utils/orphan-detector.js` `src/utils/project-context.js` `src/services/dep-graph/framework-patterns.js` — `ENTRY_BASE_NAMES` 增加 `app.vue`；`framework-patterns.js` 对 `app.vue` 返回 `isEntry: true`
- **Severity 评级自相矛盾** `src/config/risk-thresholds.js` `src/tools/overview-tools.js` — `overviewSeverity` 增加 `unresolved`/`cycles`/`deadExports`/`orphans` 参数
- **health check 标准太偏 Node.js** `src/tools/health-tools.js` — 技术栈感知评分：核心项必检，`testConfig` 按栈动态要求，CI/docker/env/editorconfig 改为 bonus 项
- **`workspace-info` 预检毫无信息量** `src/tools/workspace-tools.js` — 增加 `fileCount`/`languages`/`entryFiles`/`availableChecks`
- **`--compact` 不够 compact** `src/cli/formatters/project-map.js` `src/config/constants.js` — compact 模式应用 `COMPACT_ISSUE_MAX_ITEMS`（10）截断
- **动态导入识别与 alias 联动失效** `src/services/dep-graph/resolvers.js` — alias 解析打通后动态导入链路完整

### 新增（框架隐式依赖插件化 — P7 首批交付）

- **Scanner → Extractor → Applier 统一流水线** `src/services/dep-graph/framework-usage-patterns.js` — 配置表驱动，4 种模式注册：
  - `vue-router-lazy`：正则提取 `component: () => import('@/views/xxx')`
  - `vue-global-component`：提取 `Vue.component('Name', ...)` 按命名约定映射到 `components/Name/index.vue`
  - `vue-custom-directive` / `dynamic-string-call`：占位接口，当前返回 `[]`
- **隐式边注入依赖图** `src/services/dep-graph.js` — `build()` 和 `updateFiles()` 后调用 `applyFrameworkImplicitImports()`，将解析成功的隐式边写入 `graph.imports` / `importRecords`（`usesAllExports: true, isImplicit: true`）和 `reverseGraph`
- **增量更新一致性** `src/services/dep-graph.js` — 重新解析后自动重新应用隐式边；防御性拷贝 `info.imports` / `info.importRecords` 防止污染缓存
- **端到端集成测试** `test/framework-usage-patterns-test.js` — 模拟 Vue 项目验证：router 懒加载 view 不再 orphan/dead-export；全局组件不再 orphan；impact 半径包含隐式依赖方

### 修复（正确性）

- **动态 `import()` 未被解析** `src/services/dep-graph/parsers/js.js` — 新增 `node.callee.type === 'Import'` 分支。GitNexus 实测 dead-export 误报从 53 → 30（-43%）
- **`vitest.config.ts` 未被识别为入口** `src/services/dep-graph.js` — `KNOWN_CONFIG_NAMES` 补充 `vitest.config.ts`
- **`new URL('./worker.js', import.meta.url)` 未被解析** `src/services/dep-graph/parsers/js.js` — 新增 `NewExpression` visitor 检测 worker 脚本加载模式
- **`findOrphanFiles` 与 `isKnownEntryFile` 不一致** `src/utils/orphan-detector.js` `src/tools/overview-tools.js` `src/cli/formatters/project-map.js` — `findOrphanFiles` 新增可选 `isKnownEntryFile` 参数

### 修复（用户体验）

- **`audit-map` 非 compact 缺 summary** `src/cli/formatters/project-map.js` — `--json` 输出均包含 `summary`
- **`affected_tests` 字段 `source` → `file`** `src/tools/dep-tools.js` — 与 `impact` 命令统一字段名
- **`Unknown command` 提示改进** `cli.js` — 错误消息精确为 `Run "workspace-bridge-cli --help" for available commands.`
- **`--help <command>` Common Options** `cli.js` — `printCommandHelp()` 增加命令专属选项说明
- **`validationAdvice` 建议不存在的 `npm run test`** `src/utils/stack-detectors/commands.js` — `node-all-tests` 仅在检测到 `testRunner` 时才建议
- **`affected-tests` human-readable 输出未展示 `via` 链** `cli.js` — `formatHuman` 新增 `viaStr` 展示完整影响路径

### 重构

- **语言注册表重构（模式 A）** — `defineLanguage()` 统一接口
  - 新建 `src/services/dep-graph/parsers/registry-core.js`：`defineLanguage()` + `LanguageRegistry`
  - 新建 `src/services/dep-graph/parsers/registry.js`：9 种语言集中注册
  - `src/services/dep-graph.js`：删除 `PARSER_REGISTRY` 硬编码数组
  - `src/services/file-index.js`：`getFilePatterns()` 委托 `registry.getFilePatterns()`
  - `src/services/dep-graph/parsers/index.js`：parser + registry 统一入口

### 新增

- **大项目索引进度条** `src/services/file-index.js` — 每 100 个文件打印进度
- **`init` 命令** `cli.js` — 生成默认 `.workspace-bridge.json`
- **c8 覆盖率** `package.json` `.gitignore` — `npm run test:coverage`，基线 **79.88%**
- **`.bat`/`.cmd` spawn 自动包装** `src/utils/command.js` — Windows 下自动用 `cmd.exe /c` 包装
- **`.workspace-bridge.json` schema 校验** `src/utils/project-context.js` — JSON 语法错误非阻塞提示

### 文档

- **SKILL.md 文档误导修复** `skills/workspace-audit/SKILL.md` — npx 优先调用；矩阵增加 Known Gaps 列；Known Limitations 增加 Vue/Java 专项说明；新增 Confidence rules 表格


## [1.1.0] - 2026-05-06

### 修复（20 项活跃缺陷全量修复）

**🔴 高危（崩溃/数据丢失/资源泄漏）**
- `fs.watch` 未注册 `'error'` 事件 — `src/services/file-index.js` `startWatching()` 新增 `watcher.on('error', ...)`
- `python.stdin` 无错误监听 — `src/services/dep-graph/parsers/spawn-ast.js` 新增 stdin error handler + write/end try-catch
- REPL 快速连按 Ctrl+C 跳过 shutdown — `src/cli/repl.js` 新增 `process.on('SIGINT', handler)` + finally 移除
- `isKnownEntryFile()` 读整个文件无大小限制 — `src/services/dep-graph.js` 读前 `fs.statSync`，超 64KB 跳过
- `updateFiles` 无重入锁 — `src/services/dep-graph.js` `_updating` 锁 + try-finally
- `shutdown()` 后 `initError` 阻止重新初始化 — `src/services/container.js` `initialize()` 开头清空 `initError`

**🟡 中危（边界条件/误报/竞态/性能）**
- TypeScript 诊断漏 `.tsx`/`.mts`/`.cts` — `src/services/diagnostics-engine.js` 扩展 TS_EXTS
- `cpp.js`/`java.js` regex 多项式回溯 — `MAX_LINE_LEN = 512`，超长匹配跳过
- `stopWatching` 无逐条 try-catch — `src/services/file-index.js` 逐条包围 `watcher.close()`
- `getStats()` 每次触发 O(V·E) DFS — `src/services/dep-graph.js` `_cycleCount` 延迟计算
- `pruneDeletedCacheEntries` 同步遍历阻塞事件循环 — 改为 async batchSize=100 + setImmediate yield
- `cache.save()` 只捕获 `RangeError` — 捕获所有序列化错误，两次降级后返回 false
- `moduleExportsRegex` 不支持嵌套对象 — `src/services/dep-graph/parsers/js.js` 注释文档化限制

**🟢 低危（代码异味/防御性缺口）**
- `search-tools.js` 两个重复 `escapeRegex` — 删除第二个
- `stripQuotedStrings` 模板字面量清理不彻底 — 改用模板字符串安全贪婪匹配
- `findCircularDependencies` 递归 DFS 无最大深度限制 — `MAX_CYCLE_DEPTH` 兜底 + try-finally 正确 pop
- `processPending` 串行 `await` 削弱 debounce — 小并发 CONCURRENCY=5
- Windows `toLowerCase()` Turkish `I→ı` — `src/utils/path.js` 改用 `toLocaleLowerCase('en-US')`

### 测试（新增 10 个测试文件）

- `test/parse-args-test.js` — CLI 参数解析入口
- `test/diagnostics-parser-test.js` — 诊断解析核心
- `test/test-detector-test.js` — 测试映射 heuristic
- `test/diagnostics-engine-test.js` — 诊断引擎生命周期
- `test/container-lifecycle-test.js` — ServiceContainer 初始化/关闭/重启
- `test/cache-corruption-test.js` — 缓存损坏/过期/版本迁移防御
- `test/dep-graph-error-test.js` — dep-graph 错误路径（空数组、删除、重入、懒计算）
- `test/path-utils-test.js` — 路径工具边界与平台兼容
- `test/cli-args-validation-test.js` — CLI 参数验证与帮助
- `test/resolvers-test.js` — 9 语言 import 解析核心

### 新增

- **Rust AST parser** `src/services/dep-graph/parsers/rust-ast.js` `test/rust-ast-parser-test.js` — 基于 `web-tree-sitter` WASM + Tree-sitter Query 实现 Rust AST 解析，替代原有 regex parser。支持 `use`（单路径 / use_list 展开 / `as` alias）、`pub fn`/`struct`/`enum`/`trait`/`type`/`mod`/`const`/`static`、`pub use` re-export、`impl` block 内 `pub fn`。非 `pub` 项自动过滤，消除 regex 级 dead-export 误报。失败自动 fallback 到 `polyglot.js` regex。`parseMode: 'ast'`
- `src/services/dep-graph/parsers/index.js` — `parseRust` 来源从 `polyglot.js` 切换至 `rust-ast.js`
- **Kotlin AST parser** `src/services/dep-graph/parsers/kotlin-ast.js` `test/kotlin-ast-parser-test.js` — 基于 `web-tree-sitter` WASM + Tree-sitter Query 实现 Kotlin AST 解析，替代原有 regex parser。支持 `import`（含 wildcard `.*`）、`class`/`interface`/`object`/`enum class`/`data class`/`fun`/`const val`/`val`/`typealias`。自动过滤 `private`/`internal`/`protected`，消除 regex 级 dead-export 误报。失败自动 fallback 到 `polyglot.js` regex。`parseMode: 'ast'`
- `src/services/dep-graph/parsers/index.js` — `parseKotlin` 来源从 `polyglot.js` 切换至 `kotlin-ast.js`

### 修复（产品功能缺口）

- **`function-impact.js` 硬编码 ext 白名单** `src/services/dep-graph/function-impact.js` — 从 `['.js','.jsx','.ts','.tsx','.go']` 改为检查 `parseMode === 'ast' && functionRecords.length > 0`。Python/Java/Kotlin/Rust 的 changed-function-impact 立即解锁
- **Go/Rust 静态分析命令缺失** `src/utils/stack-detectors/commands.js` — smoke 阶段新增 `go vet ./...` 和 `cargo clippy -- -D warnings`
- **C/C++ stack 检测和验证命令缺失** `src/utils/stack-detectors/detect.js` `commands.js` — 新增 `hasCppProject`（CMakeLists.txt / Makefile 检测）、`cpp-first` profile、`getCppCommands`（cmake build / ctest）。`STACK_TARGET_PATTERNS` 和 `splitTargetsByStack` 加入 C/C++ 扩展名
- **`audit-diff` 缺文件类型统计 + 变更量** `cli.js` `src/tools/git-tools.js` `src/cli/formatters/audit-diff-summary.js` — 新增 `getDiffNumstat()` 解析 `git diff --numstat`。`audit-diff` JSON 输出新增 `summary.fileTypeBreakdown`（按扩展名计数）和 `summary.changeMetrics`（+additions/-deletions）
- **SKILL.md 缺失命令说明** `skills/workspace-audit/SKILL.md` — 补全 `workspace-info`、`diagnostics`、`audit-security`、`repl`、`watch` 的命令说明、阅读指南、场景矩阵。语言支持矩阵同步更新（Kotlin/Rust AST ✅）

### 新增（GitNexus 模式提取 + 产品功能缺口）

- **框架感知 Extractor（模式 C）** `src/services/dep-graph/framework-patterns.js` `test/framework-patterns-test.js` — 翻译 GitNexus `framework-detection.ts` 核心路径模式，裁剪为 workspace-bridge 9 种语言。`detectFrameworkFromPath()` 路径模式检测 + `detectFrameworkFromContent()` AST 轻量扫描（前 800 字节）。覆盖 Next.js / Express / Django / FastAPI / Spring / Ktor / Go HTTP / Rust Web / Vue / Svelte 等框架。`dep-graph.js` `isKnownEntryFile()` 集成框架检测，消除框架入口文件 dead-export 误报。`audit-diff` / `audit-file` JSON 输出新增 `frameworkPattern` 字段
- **`audit-file` validationAdvice** `src/cli/formatters/validation-advice.js` `cli.js` `test/audit-file-validation-advice-test.js` — 新增 `buildFileValidationAdvice(filePath, workspaceRoot)` 轻量函数。检测 stack → 推断 changeType → 调用 `generateCommands()` → 去重返回。`audit-file` JSON 输出新增 `validationAdvice` 字段
- **`health` fixes 数组** `src/tools/health-tools.js` — 新增 `FIX_SUGGESTIONS` 配置表，`projectHealth()` 对未通过的 check 输出 `fixes: [{ check, action, severity }]`

### 修复（资源管理/性能）

- **`isKnownEntryFile()` 读整个文件** `src/services/dep-graph.js` — 将 `fs.readFileSync(filePath, 'utf8')` 改为 `fs.openSync` + `fs.readSync` 只读前 `ENTRY_SCAN_BYTES = 256` 字节。`MAX_ENTRY_FILE_SIZE` 裸数字移至 `src/config/constants.js`。消除大文件（最多 64KB）的全量读取开销
- **`resolvers.js` 同步 I/O 风暴** `src/services/dep-graph/resolvers.js` — 引入模块级 `_statCache` LRU 缓存（上限 `RESOLVER_STAT_CACHE_MAX = 2000`），`cachedStatSync` / `cachedExistsSync` 替代全部 `fs.existsSync`/`fs.statSync` 调用。`DependencyGraph.build()` 开头调用 `clearResolverCaches()` 防过时路径。大仓库批量 import 解析时重复 I/O 削减 80%+
- **`cli.js` JSON.stringify 阻塞事件循环** `cli.js` — 新增 `writeLargeJson()` 分块写入 stdout（每块 64KB，块间 `setImmediate` 让出）。JSON >1MB 时自动在 stderr 提示 `--compact`（仅限 `audit-map` edges >5000 且未 compact 时）
- **AST Cache 防御性上限** `src/services/dep-graph/parsers/tree-sitter.js` — `languageCache` 增加 `MAX_LANGUAGE_CACHE_SIZE = 12`，超限淘汰时调 `lang.delete()`，防 `watch`/`repl` 长期运行 Language 对象泄漏
- **Query 对象未 delete** `src/services/dep-graph/parsers/go-ast.js` `rust-ast.js` `kotlin-ast.js` `cpp-ast.js` — `finally` 块中补 `query.delete()`，消除 WASM 内存泄漏（ROADMAP 性能瓶颈 P2 项）

### 修复（用户体验）

- **`impact` human-readable 未展示 `via` 路径** `cli.js` — `formatHuman` impact case 新增 `via` 链展示：`2: utils/path.js via src/services/dep-graph.js -> src/cli/formatters/index.js`
- **`Unknown command` 后未提示 `--help`** `cli.js` — 错误消息追加 `Run with --help for available commands`
- **`--quiet` 模式下初始化失败根因丢失** `cli.js` — `catch` 块对 `container.initError` 输出完整 `err.stack` 而非仅 `err.message`，确保 quiet 模式下仍能拿到堆栈定位问题

### 新增（GitNexus 模式 D — 递进工具链文案）

- **`--help <command>` 详细指南** `cli.js` — 新增 `COMMAND_GUIDES` 配置表，覆盖全部 19 个命令。每个命令含 `desc` / `WHEN TO USE` / `AFTER THIS`。`node cli.js --help audit-diff` 输出递进式使用说明
- **`affected-tests` 描述补全** `cli.js` `printUsage()` — 原仅显示参数格式 `affected-tests --file <path> [--max-depth <n>]`，现补全描述 `Find tests related to a file`
- **AGENTS.md 命令表同步** — 核心命令表 + 原子命令表全部增加 `WHEN TO USE` / `AFTER THIS` 列，与 `COMMAND_GUIDES` 保持一致

## [1.0.4] - 2026-05-05

> **Highlights**：全栈语言覆盖达成（9 种：JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte），`audit-map --compact` 大项目压缩模式可用（GitNexus 954 文件实测 97% 压缩），Go AST parser 基于 tree-sitter WASM 落地，L2 技术债全部清零。

### 新增

- **C/C++ parser** `src/services/dep-graph/parsers/cpp.js` `test/cpp-parser-test.js` — regex 级解析 `#include`、文件级函数、`#define` 宏。扩展名覆盖 `.c` `.cpp` `.cc` `.h` `.hpp`，`parseMode: 'regex'`
- **Vue SFC parser** `src/services/dep-graph/parsers/vue.js` `test/vue-parser-test.js` — 提取 `<script>` / `<script setup>` 块，复用现有 `parseJavaScript` AST/regex 解析。支持多 script 块合并
- **Svelte parser** `src/services/dep-graph/parsers/svelte.js` `test/svelte-parser-test.js` — 提取 `<script>` 块，复用现有 `parseJavaScript`。支持 `context="module"` 等多 script 块
- **file-index 语言覆盖扩展** `src/services/file-index.js` `src/utils/path.js` — `getFilePatterns()` 在 `hasPackageJson` 时加入 `**/*.vue` `**/*.svelte`；新增 `hasCpp` workspace 特征（`CMakeLists.txt` / `Makefile`），匹配时加入 C/C++ 扩展名；fallback 模式亦覆盖新扩展名
- **parser 注册表 6 → 9 语言** `src/services/dep-graph.js` `src/services/dep-graph/parsers/index.js` — `PARSER_REGISTRY` 新增 `.vue` `.c/.cpp/.cc/.h/.hpp` `.svelte` 三行。达成 AGENTS.md 成功标准「全栈语言覆盖」
- **Go AST parser** `src/services/dep-graph/parsers/go-ast.js` `test/go-ast-parser-test.js` — 基于 `web-tree-sitter` WASM + tree-sitter Query 实现 Go AST 解析，替代原有 regex parser。支持 import/function/method/type/const/var/generics，修复 regex parser `lineEnd = lineStart` 硬编码 bug。失败自动 fallback 到原有 regex。`parseMode: 'ast'`

### 新增

- **`audit-map --compact`** `cli.js` `src/cli/formatters/project-map.js` `src/cli/repl.js` — 大项目信息压缩模式，三轮递进压缩：
  - Round 1：edges 聚合到目录级，删除文件 `exports`/`parseMode`
  - Round 2：tree 变为纯目录骨架（`fileCount` + `totalFileCount`），新增 `highlightedFiles` 透出 entry/issue 文件
  - Round 3：tree 深度限制为 2（深层目录折叠到父目录），edges 进一步聚合到模块级（前两段路径），issueOverlay 裁剪 `exports` 数组，`highlightedFiles` 上限 30
  - REPL `audit-map` 命令同步支持 `--compact`
  - **GitNexus（954 文件）输出从 28,818 行降到 862 行（~97% 压缩）**
- **archive/reference/generated 目录自动排除** `src/services/file-index.js` `src/utils/project-context.js` — `.workspace-bridge.json` 中标记为非 active 的目录（reference/archive/generated）现在被 `file-index` 直接排除，不再扫描、解析、构建 dep-graph。解决混合仓库中 reference 代码污染分析结果和拖慢构建时间的问题。自身项目 totalFiles 从 ~400 降到 98
- **audit-map `--compact` 问题驱动改造** `src/cli/formatters/project-map.js` `cli.js` — compact 模式从"单纯信息压缩"升级为"问题驱动输出"：新增 `summary` 字段（severity / issueCounts / 按优先级排序的 nextSteps），`highlightedFiles` 按问题严重程度排序（unresolved > cycle > dead-export > orphan > hotspot > entry），human-readable 输出首行即 severity + 下一步建议
- **SKILL.md 大项目模式文档** `skills/workspace-audit/SKILL.md` — 新增 `--compact` 使用场景和示例
- **`HIGHLIGHT_SCORES` 注册表** `src/config/constants.js` — 统一 `project-map.js` 中 highlighted file 的评分权重，消除裸数字
- **`symbol-extractors.js` 语言注册表** `src/services/file-index/symbol-extractors.js` — 将 `file-index.js` 中 6 分支 `else-if` 链重构为 first-match 配置表，新增语言只加一行，未知扩展名自然落空数组
- **`stack-detectors/detect.js` + `commands.js`** `src/utils/stack-detectors/` — 将 835 行的 `stack-detector.js` 按「检测/命令」维度拆分为两个子模块，主文件变为 14 行入口

### 修复

- **`DEFAULT_EXCLUDE_DIRS` 污染** `src/services/file-index.js` — 移除上一轮清理本地 `reference/gitnexus/` 残留时误加入的全局排除项 `'gitnexus'`，该规则导致任何名为 `gitnexus` 的目录被全盘跳过
- **cache.js 缓存加载崩溃** `src/services/cache.js` — `normalizeFileMapEntries` / `normalizeDiagnosticsEntries` / `normalizeParseResultEntries` 假设传入值是数组，旧缓存或损坏缓存中该字段可能是普通对象 `{}`。加 `Array.isArray(entries)` 防御性检查
- **hasGradlePlugin 循环内编译正则** `src/utils/stack-detectors/detect.js` — 每行 `new RegExp()` 提到循环外，一次编译复用
- **file-index.js 硬编码 cache 文件名** `src/services/file-index.js` — `'.workspace-bridge-cache.json'` 改为 `require('./cache').CACHE_FILENAME`
- **file-index.js node_modules 特殊分支冗余** `src/services/file-index.js` — `matchesPathFragment` 已覆盖 `node_modules/` 匹配，删除多余 `if (dir === 'node_modules')` 分支
- **file-index.js handleFileChange 漏清缓存** `src/services/file-index.js` — 文件删除时只清 `fileMetadata`，漏了 `parseResult`/`diagnostics`/`symbolIndex`。改为调用 `_removeCacheEntry()`
- **cache.js save() 同步阻塞** `src/services/cache.js` — `fs.writeFileSync` + `JSON.stringify(data, null, 2)` 对大型仓库可能产生数十 MB 字符串并冻结事件循环。改为 `async save()` + `fs.promises.writeFile/rename`，不再格式化 JSON 以减小体积
- **command.js Windows 命令解析** `src/utils/command.js` — 原来对 `semgrep`/`codeql` 强制加 `.cmd`，但它们在 Windows 上可能是 `.exe`。改为只对 `npm`/`npx` 加 `.cmd`，其他交给 `spawn` 按 PATHEXT 搜索
- **REPL SIGINT 资源泄漏** `src/cli/repl.js` — 注册 `rl.on('SIGINT', () => rl.close())`，确保 Ctrl+C 触发 finally 块中的 `container.shutdown()`
- **watch.js shutdown 异常挂起** `src/cli/watch.js` — `container.shutdown()` 抛错时 `process.exit(0)` 不执行，进程挂住。加 `try-catch` 包围 shutdown
- **container.js shutdown 异常不安全** `src/services/container.js` — `processPending()` 抛错时 `stopWatching()` 和 `cache.save()` 被跳过。每步独立 `try-catch`，DEBUG 模式输出细节
- **dep-graph.js 引用污染** `src/services/dep-graph.js` — cache hit 路径直接 `this.graph.set(key, cached)`，导致 graph 和磁盘缓存共享同一个对象引用。改为 `{ ...cached }` 浅拷贝隔离
- **semgrep.js 过度防御** `src/adapters/semgrep.js` — 非零退出码时直接丢弃 stdout 中的 findings。改为先尝试 `JSON.parse(result.stdout)`，解析成功且有有效 results 时保留 findings
- **Linux watcher 被错误禁用** `src/services/file-index.js` — Node.js v20+ Linux 已支持 `fs.watch(path, { recursive: true })`。改为运行时探测而非硬编码 `platform === 'win32' \|\| platform === 'darwin'`

### 重构

- **stack-detector.js 重复代码消除** `src/utils/stack-detectors/` — `hasGoProject` 直接复用 `detectGoModules`；提取 `buildNodeTestCommand`、`buildGoModuleTestCommands`、`buildRustTestCommands` 三个纯函数，消除 Node testRunner 三元链和 Go/Rust 命令生成的跨函数重复
- **file-index.js 死代码删除** `src/services/file-index.js` — `findSymbol`、`searchSymbols`、`getFileSymbols` 在 `src/` 中无调用方，删除
- **DEFAULT_EXCLUDE_DIRS 清理** `src/services/file-index.js` — 移除项目特定目录 `test-temp`、`wb-analysis-fixture`
- **watch.js dead code** `src/cli/watch.js` — 删除 `registerWatchCallback` 中永远收到 `undefined` 的 `originalCallback` 参数
- **project-map.js / overview-tools.js 硬编码对齐** `src/cli/formatters/project-map.js` `src/tools/overview-tools.js` — 同步移除 `wb-analysis-fixture` 硬编码跳过规则
- **cli.js printUsage 补文档** `cli.js` — 补全 `--config` 和 `--language` 参数说明
- **fs.watch handler 崩溃** `src/services/file-index.js` — `path.join(this.root, filename)` 在 `!filename` 守卫之前执行，`filename` 为 `undefined` 时抛 `TypeError`。调整顺序；同时处理 Windows 上 `filename` 为 `Buffer` 的情况
- **`_readPackageJson` 解析崩溃** `src/services/dep-graph.js` — `JSON.parse` 无 try-catch，损坏的 `package.json` 会导致 `DependencyGraph` 构造失败
- **`readTrendHistory` 解析崩溃** `src/tools/overview-tools.js` — 同上，趋势历史文件损坏时抛未处理异常
- **`resolveImport` 空指针** `src/services/dep-graph/resolvers.js` — 导出函数未校验 `importPath`，传入 `null`/`undefined` 时内部解析器崩溃
- **`buildAuditDiffSummary` 空指针** `src/cli/formatters/audit-diff-summary.js` — 对 `entries` 直接调用 `.filter()` 无 array guard
- **`getNodeCommands` / `getPythonCommands` 空指针** `src/utils/stack-detectors/commands.js` — `targets` 未校验直接调用 `.filter()` / `.length`
- **`auditSecurity` null 穿透** `src/tools/security-tools.js` — 解构默认 `targets = []` 只在属性缺失时生效，显式传入 `{ targets: null }` 会 crash
- **`matchGlob` 不完全转义** `src/tools/search-tools.js` — 只转义 `.` / `*` / `?`，其他正则元字符（`+` `[` `]` `(` `)` `{` `}` `^` `$` `|`）未处理，导致 glob 匹配错误
- **parsers/js.js  visitors 映射表** `src/services/dep-graph/parsers/js.js` — 220 行 `visitNode` 拆为 `importExportVisitors` / `functionVisitors` 映射表，7 种业务逻辑各归其位
- **parsers/js.js 通用 AST walker** `src/services/dep-graph/parsers/js.js` — 提取 `walkAST(node, callback, parent)` 消除两处 >90% 重复的 inline walker
- **parsers/js.js 重复代码消除 ×4** `src/services/dep-graph/parsers/js.js` — `getPropertyName(prop)`、`buildExportRecordFromValue(name, valueNode, fallbackLines)`、`pushFunctionRecord(records, name, node)`、`QUOTE_PATTERNS` + `DECL_KIND_MAP` 配置表
- **dep-graph.js 语言分发注册表** `src/services/dep-graph.js` — `PARSER_REGISTRY` 配置表消除 6 分支 if-else 链，新增语言只需改一行
- **dep-graph.js 反向边构建去重** `src/services/dep-graph.js` — 提取 `_addReverseEdges(fileKey, imports, options?)` + `_removeOldReverseEdges(fileKey)`，消除 `buildReverseGraph` 与 `updateFiles` 间的重复逻辑
- **dep-graph.js 模块级常量提取** `src/services/dep-graph.js` — `FRAMEWORK_MANAGED_PATTERNS`、`KNOWN_CONFIG_NAMES`、`PYTHON_MAIN_PATTERN` 提到模块顶部，消除函数内重复创建
- **dep-graph.js 正则缓存** `src/services/dep-graph.js` — `_scanSymbolUsageInImporters` 用局部 `Map<symbol, RegExp>` 缓存，避免每个 importer 对每个 symbol 都 `new RegExp`
- **dep-graph.js 方法拆分 ×3** `src/services/dep-graph.js` — `findAffectedTests` 拆为 `_findAffectedTestsByGraph` + `_findAffectedTestsByHeuristic`；`findDeadExports` 提取 `_collectUsedExports`；`updateFiles` 拆为 `_removeOldReverseEdges` + `_addReverseEdges`
- **overview-tools.js 裸数字归零** `src/config/constants.js` `src/tools/overview-tools.js` — 新增 `SCORING` 常量对象，覆盖 hotspot/stability/coupling/core-module/edge-break/sampling 全量阈值，~20 处裸数字替换
- **container.js / file-index.js 裸数字归零** `src/services/container.js` `src/services/file-index.js` `src/config/constants.js` — `initialize`/`ensureReady`/`build`/`getStaleness` 默认参数与进度批次全部替换为 `TIMEOUTS.*` / `DEFAULTS.*`；新增 `STALENESS_THRESHOLD_MS`、`FILE_INDEX_PROGRESS_BATCH`
- **js.js CJS regex fallback 补全** `src/services/dep-graph/parsers/js.js` — `extractExportsWithRegex` 新增 `module.exports = { ... }` 与 `exports.foo = ...` 检测，消除 CJS 项目 regex fallback 下静默丢导出的盲区

### 测试

- `test/cache-test.js` — 适配 `cache.save()` 改为异步（mock `fs.promises.rename` 替代 `fs.renameSync`）
- `test/cache-stale-prune-test.js` — `cache1.save()` 加 `await`
- `test/js-regex-cjs-test.js` — 新增：强制 regex fallback（故意放置非法语法使 AST 解析失败），验证 `module.exports = { foo, bar: 1 }` 与 `exports.baz = ...` 正确提取为 exportRecords

## [1.0.2] - 2026-05-03

### 变更

- **删除 CodeQL adapter** `src/adapters/codeql.js` — CodeQL 对 workspace-bridge 的核心定位（跨文件结构化分析）ROI 极低：安装包 >500MB、建数据库 1-5 min、分析 1-5 min，与 AI agent 秒级响应的期望冲突；维护成本 208 行 + 大量边界逻辑（混合仓库语言检测、数据库缓存、SARIF 解析、Windows 适配），上一轮修了 9 个 bug 仍持续产出问题。`audit-security` 保留 Semgrep（pip install 秒级、出结果秒级、20+ 语言覆盖），足够满足需求
- **CLI 清理** `cli.js` — 删除 `--db-path`、`--force-refresh`（CodeQL 专属参数）；`--language` 保留给 Semgrep 使用
- **`src/tools/security-tools.js`** — 删除 `dbPath` / `forceRefresh` 透传

### 测试
- `test/security-adapter-test.js` — 删除 CodeQL 相关测试，保留 Semgrep + auditSecurity 核心测试

## [1.0.1] - 2026-05-03

### 修复

- **CodeQL 数据库默认搬到 OS 缓存目录** `src/adapters/codeql.js` `cli.js` — 默认数据库路径从 `<cwd>/.codeql/`（污染用户仓库）改为 `~/.workspace-bridge-cache/codeql/<sha256(cwd).slice(0,12)>/`。不同项目互不影响，SARIF 结果解析后立即清理。CLI 新增 `--db-path` 参数供进阶用户覆盖
- **CodeQL 混合仓库语言检测** `src/adapters/codeql.js` — first-match-wins 改为 detect-all：0 候选返回检测失败，≥2 候选要求 `--language` 显式指定。修复 Spring Boot + 前端被识别为 javascript 的 bug
- **adapter 串行 → `Promise.all` 并行** `src/tools/security-tools.js` — Semgrep + CodeQL 同时跑，大仓库节省一半时间
- **`audit-security` 默认 targets `['.']`** `src/tools/security-tools.js` — 不传参数时扫当前目录，避免静默返回空结果
- **`dedupeFindings` 重命名为 `dedupeWithinTool`** `src/tools/security-tools.js` — 跨工具同位置发现不去重是有意设计（双工具确认是信号），新名 + JSDoc 让意图自解释
- **CodeQL `_ensureDatabase` 简化** `src/adapters/codeql.js` — 单次 `pathExists` 判断，删除旧库时 `force: true`
- **CodeQL summary 删除 `scanned: targets.length`** `src/adapters/codeql.js` — CodeQL 实际扫的是 `--source-root`，targets 不参与，旧字段是假数据
- **`commandExists` 与 spawn 命令名对齐** `src/utils/command.js` — `where`/`which` 现在也走 `resolveCommandForPlatform`，避免 Win 上 `where codeql` 找到 `.exe` 但 spawn 强制 `.cmd` 的不一致
- **Rust 模块名推断收敛** `src/utils/stack-detector.js` `inferRustModuleName()` — Cargo 特殊目录补 `examples/`（之前只排 `tests/`、`benches/`）；`src/mod.rs` 罕见情况 + pop 后空数组兜底，避免生成 `cargo test ''` 的未定义命令

### 测试
- `test/security-adapter-test.js` — 新增 CodeQL 多语言检测错误路径、auditSecurity 空 targets 默认 `['.']`
- `test/rust-module-filter-test.js` — 新增 `inferRustModuleName` boundary 测试（`examples/`、`benches/`、`tests/`、`mod.rs`、pop-to-empty）

## [1.0.0] - 2026-05-02

### Breaking Changes

- **`deps` 命令删除** `cli.js` — `deps` 是 `npm outdated --json` 的封装，与「跨文件结构化分析」核心定位无关，且 npm / pip / cargo 自带 `outdated` 功能。这是 1.0 唯一的 breaking change

### 决策变更

- **CLI 瘦身（23 → 8）取消** — 原计划删除 15 个命令，经产品视角重新评估后取消。主要用户是 AI agent，AI 调用原子命令比聚合命令更省 token（精确输出 vs 冗余超集），且 AI 不存在「命令太多选哪个」的认知 paralysis。保留完整命令集对 AI 用户是净收益

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

[1.0.4]: https://github.com/user/workspace-bridge/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/user/workspace-bridge/compare/v1.0.2...v1.0.3
[0.8.0]: https://github.com/user/workspace-bridge/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/user/workspace-bridge/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/user/workspace-bridge/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/user/workspace-bridge/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/user/workspace-bridge/releases/tag/v0.5.0
