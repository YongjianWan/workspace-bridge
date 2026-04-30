# Changelog

所有版本变更记录。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- **CLI 命令完整性补全** — 新增 `stats`、`dependencies --file`、`dependents --file` 三个独立命令，底层 `dep-tools.js` 的 operation 全部暴露

### 改进

- **`classifyChangeType()` docs 主导判断** — 当 docs 占严格多数（>50%）且没有 code/tests 改动时，整体返回 `docs`，避免大量文档改动因夹杂一个配置文件而生成无意义的测试命令
- **`search-tools.js` ReDoS 防线强化** — `text` 类型搜索改用 `String.prototype.includes` 替代正则，彻底消除灾难性回溯风险；`safeRegexTest` 注释诚实化（标注为"事后检测"而非"超时保护"）

### 修复

- **`.claude/settings.local.json` 文件角色** — `project-context.js` `inferFileRole()` 将 `settings.local.json` 识别为 `config`，不再被分类为 `library`

### 清理

- **删除死代码** — 移除 `src/utils/logger.js`（high confidence 死导出）、`src/services/editor-state.js`（已废弃，container 默认禁用），同步从 `package.json` 移除 `better-sqlite3` 依赖

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
