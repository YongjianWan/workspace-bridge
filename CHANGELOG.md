# Changelog

所有版本变更记录。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 修复（P0–P2 bug fixes + exit code 语义收敛）

- **`--cwd` 前置校验** `cli.js`：
  - `main()` 在 `ServiceContainer` 初始化前增加 `fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()` 检查
  - 无效路径立即返回 `{ ok: false, error: 'Directory not found: ${cwd}', schemaVersion }`，exit code = 1
  - 解决 AI agent 传错路径时无限挂起的问题

- **exit code 反模式修复** `cli.js`：
  - 新增 `--fail-on-findings` 标志（默认 `false`）
  - `determineExitCode()` 默认返回 `0`（分析成功即 0），无论是否有 findings；仅在 `--fail-on-findings` 显式开启时，有 findings 才返回 `1`
  - 未捕获异常仍返回 `2`
  - 修复 `--check-regression` 无基线时 `result.regression.ok = false` 但 `result.ok = true` 导致 exit=0 的问题：`determineExitCode` 增加 `result.regression?.ok === false` 检查
  - 解决 CI / AI agent 把正常分析结果误判为命令失败的问题

- **Java dead-exports 崩溃防御** `src/services/dep-graph.js`：
  - `GraphBuilder.analyzeFile()` 中 `entry.parser()` 调用增加 try-catch
  - 单文件 parse 错误不再 crash 整个 batch，而是降级为空 imports/exports 并继续分析其他文件
  - 解决 542 文件 Java 项目 `dead-exports` exit code 49 崩溃问题（根因：regex fallback 路径遇到非预期语法时抛出未捕获异常）

- **watch 缓存误报消除** `src/services/file-index.js`：
  - `shouldExclude()` 新增 `cache.db-wal` / `cache.db-shm` 排除，与现有 `cache.db` 一起被过滤
  - 解决 `audit-file --watch` 启动后将 SQLite WAL/shm 文件当作项目源文件监控的问题

- **`--exclude` 后 coverage 统计修复** `src/services/dep-graph.js` `cli.js`：
  - `GraphAnalyzer.getScopeSummary()` 在计数时同时应用 `shouldExclude()` 和 `shouldExcludeCli()` 过滤
  - `audit-summary` formatter 优先使用 `stats.filteredAnalysisCoverage || stats.analysisCoverage`
  - 解决 `--exclude` 后 `parsedFiles` 不下降、`coverageRatio` 硬截断 100% 的问题

- **`severity-filter-test.js` 去 brittle 化** `test/severity-filter-test.js`：
  - `testAuditSummarySeverityHigh` 不再断言 `deadExportsCount === 0`（依赖 codebase 无 high-confidence dead exports）
  - 改为断言所有返回的 dead exports 必须 `confidence === 'high'`，使测试对 codebase 状态变化免疫

- **`cache-backup-test.js` / `cache-corruption-test.js` 回归修复** `src/services/cache.js` `test/cache-backup-test.js` `test/cache-corruption-test.js`：
  - `WorkspaceCache` 构造函数正式接受 `options.cacheDir`，存在时委托 `GraphDB`（SQLite）持久化，否则回退 JSON
  - `load()` 为 SQLite 路径补充 `CACHE_TTL_MS` 过期检查（与 JSON 路径行为一致）
  - 新增 `close()` 方法关闭 `GraphDB` 连接（修复 Windows 上 `EBUSY` 无法删除缓存目录的问题）
  - 测试全部显式传 `{ cacheDir }`，并在 cleanup 中 `close()` 后再 `rmSync`

### 功能（tree 命令 + SQLite 默认迁移完成）

- **新增 `tree` 命令** `src/tools/tree-tools.js` `cli.js` `test/tree-tools-test.js`：
  - 基于 `DependencyGraph` 内存图构建文件级 import/dependent 树
  - `node cli.js tree --file <path> [--max-depth <n>] [--direction <imports|dependents|both>]`
  - 双向树形输出：`imports` 递归展开被当前文件 import 的模块，`dependents` 递归展开依赖当前文件的模块
  - 外部依赖自动标记 `external: true`，不参与递归
  - 支持 `--max-depth` 截断（默认 3，范围 1–10），防止大项目爆炸
  - 测试：`test/tree-tools-test.js` 覆盖 imports-only、dependents-only、both、maxDepth 截断、external 标记

- **SQLite 默认迁移真正完成** `src/services/cache.js` `src/services/container.js` `cli.js`：
  - `cli.js` `main()` 在未传 `--cache-dir` 时自动计算默认路径：`path.join(os.tmpdir(), 'workspace-bridge', md5(workspaceRoot).slice(0,8), 'cache.db')`
  - `container.js` `shutdown()` 新增 `cache.close()` 调用，确保 Windows 上 SQLite 连接正常释放
  - `cache.js` 导出 `computeDefaultCacheDir()` 纯函数
  - 修复 `computeDefaultCacheDir` 使用相对路径 `.` 导致 hash 错误的 bug：`path.resolve(parsed.cwd)` 前置
  - 测试不受影响：直接 `new WorkspaceCache(root)` 不传 `cacheDir` 时仍回退 JSON；仅 CLI 入口默认走 SQLite
  - 解决之前文档与代码状态不一致：CHANGELOG/AGENTS 声称迁移完成，实际默认仍是 JSON

### 修复（L3 双项收敛 — 功能缺口补全）

- **impact 入口扩散截断** `src/services/dep-graph.js` `test/p3-impact-explanation-test.js`：
  - `GraphQuery.getImpactRadius` BFS 邻居获取函数增加入口文件截断：`file !== start && this.dg.isKnownEntryFile(file)` 时返回 `[]`
  - 解决 `impact --file src/utils/path.js` 扩散到 `cli.js` / `app.vue` / `index.js` 等入口后仍继续展开的问题，消除对 AI 零信息量的输出膨胀
  - 向后兼容：查询起点本身是入口文件时不截断（仍返回其直接依赖方）
  - 测试：`test/p3-impact-explanation-test.js` 新增 `testGetImpactRadiusTruncatesAtEntryFiles` + `testGetImpactRadiusDoesNotTruncateStartNode`

- **diagnostics ESLint 检测盲区** `src/tools/workspace-tools.js` `test/workspace-tools-test.js`：
  - `buildChecks` 自动检测 eslint 配置逻辑增加 `package.json#eslintConfig` 字段和 `.eslintrc`（无扩展名）文件检测
  - 解决 Vue 等项目 ESLint 配置内嵌在 `package.json` 或使用无扩展名 `.eslintrc` 时 `noLintersDetected: true` 误报
  - 测试：新建 `test/workspace-tools-test.js`，覆盖 `eslintConfig` 和 `.eslintrc` 两种场景

### 重构（SQLite 持久化缓存迁移 — 解决工作目录污染）

- **新建 `src/services/graph-db.js`** — better-sqlite3 封装，替换 JSON 文件持久化：
  - 5 张表（`cache_metadata`/`file_metadata`/`parse_results`/`symbol_index`/`diagnostics`）对应 `WorkspaceCache` 数据结构
  - WAL 模式 + transaction 批量 upsert，异常安全（load 错误返回 null，save 错误自动回滚）
  - `loadAll()` 一次性加载到内存 Map；`saveAll()` 全量写入；`close()` 清理连接

- **重构 `src/services/cache.js`** — 内部内存 Map 不变，持久化介质从 JSON 替换为 SQLite：
  - 默认缓存路径：`path.join(os.tmpdir(), 'workspace-bridge', md5(cwd).slice(0,8), 'cache.db')`
  - **项目间隔离**：不同 `workspaceRoot` 产生不同 md5 hash → 不同子目录 → 完全独立的 `cache.db`
  - 支持 `options.cacheDir` 覆盖（供 `--cache-dir` CLI 参数使用）
  - 移除 `.bak` 备份和 `.tmp-` 原子写逻辑（SQLite transaction 已提供同等可靠性）
  - 保留 `CACHE_FILENAME` 常量供遗留文件排除用；新增 `CACHE_DB_FILENAME = 'cache.db'`
  - 向后兼容：所有 `getFileMetadata`/`setParseResult`/`getSymbols` 等 20+ 公共方法签名 100% 不变

- **CLI `--cache-dir` 参数** `cli.js` `src/services/container.js` — 用户可显式指定缓存目录：
  - `parseCliArgs` 注册 `'--cache-dir': { key: 'cacheDir' }`
  - `ServiceContainer` 透传 `options.cacheDir` 至 `WorkspaceCache`
  - 向后兼容：不加 `--cache-dir` 时行为 100% 不变（自动使用 tmpdir）

- **文件排除同步** `src/services/dep-graph.js` `src/services/file-index.js` `src/tools/git-tools.js` `.gitignore`：
  - 新增 `cache.db` / `cache.db-wal` / `cache.db-shm` 排除（`isCacheArtifact` 统一函数）
  - 保留旧 `.workspace-bridge-cache.json` / `.bak` 排除（处理遗留文件）

- **测试适配** `test/cache-backup-test.js` `test/cache-corruption-test.js` `test/cache-test.js` `test/phase01-quality-test.js` `test/severity-filter-test.js`：
  - `cache-backup-test.js`：重写为验证 SQLite save/load roundtrip 和 graceful 降级（无 db → false，损坏 db → false）
  - `cache-corruption-test.js`：重写为验证 SQLite 版本不匹配 / 缺失 / stale / 权限拒绝场景
  - `cache-test.js`：删除 `.tmp-` 原子写清理断言（SQLite 无此机制），保留 CRUD 和 roundtrip
  - `phase01-quality-test.js`：将 `.workspace-bridge-cache.json.tmp-123` 替换为 `cache.db`
  - `severity-filter-test.js`：消除硬编码 dead exports 数量（从 3 → 动态计算总数），避免新增导出导致测试 brittle

- **POC 阶段 3 结论固化**：cycle detection 保留内存算法（naive SQLite recursive CTE 大图 45 秒 vs 内存 DFS 37ms），SQLite 仅负责持久化 + deadExports + impact 查询

### 重构（SKILL 文档体系重构 — AI 协作优化）

- **SKILL.md 精简为 AI 决策树核心** `skills/workspace-audit/SKILL.md` — 从 395 行精简为 ~180 行，聚焦 AI 高频决策场景：
  - 置顶 **AI 默认调用约定**：定义 `--format markdown --quiet` 为默认参数，教 AI 不要裸调命令
  - **核心决策树**：8 个高频命令（audit-summary / audit-diff / audit-file / audit-security / audit-map / dead-exports / cycles / unresolved），其余命令明确标注为"避免调用"
  - **预热工作流**：教 AI "先 workspace-info 触发缓存，再 audit-summary"，避免冷启动 5-30s 超时
  - **可忽略字段指南**：明确标注 `architectureAdvice` / `stability` / `stabilityTrend` / `hotspots[].reason` / `parserAvailability` 为低价值字段，AI 可跳过以节省上下文
  - 删除 Fast/Slow 表格、完整 Raw Commands 列表、Language Support Matrix 等 AI 噪音内容
  - 删除 Aggregate/Quick/Raw 三层命令分类

- **新建 SKILL-REFERENCE.md** `skills/workspace-audit/SKILL-REFERENCE.md` — 从 SKILL.md 迁移完整命令参考：
  - 完整命令列表（Aggregate / Quick / Raw）、参数说明、Fast vs Slow 表格
  - Language Support Matrix、Known Limitations、Troubleshooting
  - 多仓库批量审计模板、安全审查清单完整版
  - 供人工查阅和深度使用；AI 快速上手优先阅读 SKILL.md

- **安全审查清单扩展** `skills/workspace-audit/SKILL.md` — 从仅 Spring Boot 扩展为三框架：
  - Django：`settings.py` SECRET_KEY/DEBUG、`urls.py` 鉴权、`views.py` SQL 注入/上传校验
  - Vue / Node：`vite.config.js` proxy 暴露、`.env` 密钥、`cors` 开放、代码注入（`eval`/`innerHTML`）
  - Spring Boot 保留原有必查清单

- **多仓库批量审计脚本** `scripts/multi-repo-audit.js` — 遍历父目录下的子仓库，逐条执行 `audit-summary --format jsonl`，输出 Markdown 表格聚合 severity/fileCount/deadExports/unresolved/cycles：
  - 自动过滤 `.git` / `node_modules`
  - 错误仓库标记 ❌，高 severity 仓库列表末尾警告
  - 零 CLI 改动，纯消费侧脚本

### 修复（阶段 1：误报清零）

- **schemaVersion 不一致** `package.json` `src/tools/overview-tools.js` `test/functionality-test.js` `test/overview-tools-test.js` — `package.json` version 1.1.1 → 1.2.0，`overview-tools.js` 内部 `schemaVersion` '1.1.1' → '1.2.0'，与 `cli.js` `SCHEMA_VERSION = '1.2.0'` 统一；同步修复 3 处测试断言

- **L2-6 Vue Admin cycle 白名单** `src/services/dep-graph.js` — `isLikelyFrameworkLegitimateCycle` 新增 `hasUtils` 维度检测：
  - Vue 项目中 store 目录文件（如 `store/modules/settings.js`）与 utils 目录文件（如 `utils/dynamicTitle.js`）之间的标准互引用，长度 ≤6 且涉及 store + utils 两个维度时，视为框架合法循环
  - 覆盖实战基地 zcypg-fe、zsgzt-fe 两个前端项目出现的相同误报模式

- **L2-7 stability 新文件全 fragile** `src/config/constants.js` — `STABILITY_BASE_SCORE` 40 → 45：
  - 新文件默认从 40（fragile 阈值边缘）提升到 45（moderate），消除"无测试 + 中等影响面"的新项目文件批量 fragile 问题
  - 向后兼容：仅 score 偏移 +5，assessment 阈值和语义不变；已有测试覆盖 score 计算逻辑

- **L3-3 architectureAdvice 单体抑制** `src/tools/overview-tools.js` — 按项目规模抑制激进拆分建议：
  - `buildCouplingSplitSuggestions` 检测 `mainlineFiles.length < 200`，标记为 `isSmallProject`
  - `generateCouplingSplitPlan` 第三个参数接收 `isSmallProject`，library 角色时建议从"按子域拆分"降级为"保持内聚优先，通过测试覆盖降低修改风险"
  - 仅影响 `couplingSplitSuggestions` 文案，不影响 cycleRefactorSuggestions 或其他输出字段

- **security-tools.js 内置规则扩展** `src/tools/security-tools.js` — 新增 9 条安全规则（总计从 12 → 21 条）：
  - **hardcoded-secret（medium）**：JS/Python/Java 各 1 条，检测 `password/secret/token/api_key` 等键值对后接 8+ 字符的硬编码字符串
  - **log-sensitive（low）**：JS/Python/Java 各 1 条，检测 `console.log`/`logger.info`/`System.out.print` 等语句中输出敏感字段
  - **file-upload-traversal（low）**：Java 1 条，检测 `MultipartFile`/`getOriginalFilename()`/`transferTo(` 等文件上传 API
  - 全部规则均支持 `// security-scan-ignore` 和 `/* security-scan-ignore` 单行抑制注释

---

### 新增（P4：可靠性收敛 — AI 可信信号）

- **`warnings[]` 解析降级信息入 JSON** `src/services/dep-graph.js` `cli.js` `src/cli/formatters/human-formatters.js` `test/formatter-direct-test.js` — 解决 `--quiet` suppress stderr 后 AI 无法感知解析质量的问题：
  - `GraphAnalyzer.buildWarnings()` 遍历 graph 按 `parseModeReason` 聚合三类警告：`regex-fallback`（AST 降级到 regex，medium）、`unsupported-extension`（未解析，low）、`empty-graph`（0 edges，high）
  - `DependencyGraph` facade 委托暴露 `buildWarnings()`
  - `cli.js` `main()` 在 result 构建完成后注入 `result.warnings = container.depGraph.buildWarnings()`，所有 JSON 输出（`--json`、`--format ai`）自动携带
  - `formatAi()` 将 `warnings` 原样透传至 output，AI 可直接消费
  - 向后兼容：无降级文件时 `warnings` 为空数组，不破坏现有解析器
  - 测试：`formatter-direct-test.js` 新增 `testFormatAiWithWarnings`，验证 warnings 数组正确透传

- **exit code 语义定义** `cli.js` — 解决 AI 无法区分"分析成功"和"工具崩溃"的问题：
  - 新增 `determineExitCode(command, result)`：0=成功完成，1=有 findings / 业务级失败（`result.ok === false`、文件不存在、参数错误），2=未捕获异常 / 工具崩溃
  - `audit-summary`/`audit-security`/`dead-exports`/`unresolved`/`cycles`/`health` 六个命令按 findings 有无区分 0/1；其余命令保持 0/1 按 `result.ok` 区分
  - `main()` catch 块：`process.exitCode = 1` → `process.exitCode = 2`，崩溃与业务失败语义分离
  - 测试适配：`test/analysis-test.js`/`formatter-e2e-test.js`/`regression-test.js`/`role-detection-test.js`/`staged-files-test.js`/`functionality-test.js`/`severity-filter-test.js` 7 个集成测试的 status 断言从 `=== 0` 放宽为 `=== 0 || === 1`（功能测试不关心 findings 有无，只关心工具未崩溃）

### 新增（阶段 2：暴露正确 + 输出策展）

- **`audit-security --builtin-only`** `src/tools/security-tools.js` `cli.js` `test/security-adapter-test.js` — 19 条内置安全规则独立 CLI 入口：
  - `auditSecurity` 签名扩展 `builtinOnly`，为 `true` 时跳过 `getAvailableAdapters()` 直接调用 `runBuiltinSecurityScan()`
  - `cli.js` `parseCliArgs` 注册 `'--builtin-only': true`，`audit-security` case 透传至 `auditSecurity()`
  - 向后兼容：不加 `--builtin-only` 时行为 100% 不变（有 Semgrep 仍优先 Semgrep，无则 fallback builtin）
  - 测试：`security-adapter-test.js` 新增 fake adapter 可用但 `builtinOnly=true` 时仍返回 `adapters: ['builtin']` 的断言

- **`--format summary`** `src/cli/formatters/human-formatters.js` `cli.js` `src/cli/formatters/index.js` `test/formatter-direct-test.js` — 纯模板策展摘要，解决 AI 上下文溢出：
  - 新增 `formatSummary(command, result)` 覆盖 8 个命令：`audit-summary`/`audit-overview`/`audit-security`/`audit-diff`/`audit-file`/`health`/`impact`/`affected-tests`
  - `audit-summary` 从 ~12 行压缩到 ~8 行关键结论（Severity/Health/Files/Issues/Coverage/Next steps）
  - 未知命令自动 fallback 到 `formatHuman`
  - `cli.js` `main()` human-readable 分支增加 `parsed.format === 'summary'` 路由
  - 测试：`formatter-direct-test.js` 新增 4 断言（行数≤10、字段存在、fallback、error 处理）

- **缓存 TTL 5 分钟 → 24 小时** `src/services/cache.js` `src/config/constants.js` `test/staleness-test.js` `test/cache-corruption-test.js` — 解决 AI 异步审查工作流中缓存形同虚设的问题：
  - `src/services/cache.js` `CACHE_TTL_MS` 5 分钟 → 24 小时
  - `src/config/constants.js` `STALENESS_THRESHOLD_MS` 5 分钟 → 24 小时
  - 同步修复 `staleness-test.js` 硬编码阈值断言（300000→86400000，boundary→86400000/86400001，description→"24 hours"）
  - 同步修复 `cache-corruption-test.js` stale 模拟时间（10 分钟→25 小时，确保超过 24h TTL）
  - 向后兼容：非测试代码无硬编码数值，全部通过 `DEFAULTS.STALENESS_THRESHOLD_MS` 和 `CACHE_TTL_MS` 消费

- **`audit-diff --since <commit>`** `src/tools/git-tools.js` `cli.js` `test/audit-diff-test.js` — PR diff 审查 commit range 支持：
  - `getChangedFiles` 新增 `since` 参数：存在时调用 `git diff --name-only <since>...HEAD` 替代 `git status`
  - `getDiffNumstat` 同步支持 `since`：`git diff --numstat <since>...HEAD`
  - `getChangedLineRanges` 同步支持 `since`：`git diff --unified=0 <since>...HEAD -- <file>`
  - `cli.js` `parseCliArgs` 注册 `'--since': { key: 'since' }`，`audit-diff` case 透传至三个 git 工具
  - 向后兼容：不加 `--since` 时 100% 走原有 `git status` + staged/unstaged 路径
  - 测试：`audit-diff-test.js` 利用已有临时 git 固件验证 `--since HEAD~2` 返回 `src/util.js`

- **`--format markdown`** `src/cli/formatters/human-formatters.js` `cli.js` `src/cli/formatters/index.js` `test/formatter-direct-test.js` — 纯模板 Markdown 输出，直接喂给 AI：
  - 新增 `formatMarkdown(command, result)` 覆盖 8 个命令，使用 Markdown 标题/列表/粗体/代码块
  - `audit-summary` 输出带 `# Audit Summary` 标题和 `## Next Steps` 二级标题的 Markdown
  - `audit-security` 输出带 `# Security Audit` 和 `## Findings` 的 Markdown，规则 ID 用行内代码包裹
  - 未知命令 fallback 到 `formatHuman`
  - `cli.js` `main()` 增加 `parsed.format === 'markdown'` 路由
  - 测试：`formatter-direct-test.js` 新增 4 断言（标题存在、列表存在、fallback、error）

- **`--staged` / `--files`** `cli.js` `src/tools/security-tools.js` `test/staged-files-test.js` — PR 审查核心能力补全：
  - `--staged`：`audit-diff` 只分析 git 暂存区，提交前快速自检；`getChangedFiles`/`getDiffNumstat`/`getChangedLineRanges` 均透传 `staged: true`
  - `--files a,b,c`：`audit-diff` 绕过 git status，直接以指定文件列表作为变更集；`audit-security` 将 `--files` 作为 `targets` 传入 `runBuiltinSecurityScan`，限定扫描范围
  - `security-tools.js` 修复 `runBuiltinSecurityScan` 在有 `depGraph` 时忽略 `targets` 的缺陷；新增目录/文件双模式过滤（目录命中则包含其下所有 depGraph 文件，文件则精确匹配）
  - 向后兼容：不加 `--staged`/`--files` 时行为 100% 不变
  - 测试：`staged-files-test.js` 5 断言覆盖参数解析、audit-diff 指定文件、audit-security 限定范围、staged+files 共存优先级、不存在的文件 graceful 降级

- **`--save` / `--check-regression`** `cli.js` `src/tools/regression-tools.js` `test/regression-test.js` — 建立"审计有记忆"的产品认知：
  - `--save <file>`：`audit-summary` 将 findings（deadExports/unresolved/cycles/healthGaps）保存为 JSON 基线快照，含 `schemaVersion`/`timestamp`/`workspaceRoot`
  - `--check-regression`：加载基线文件（默认 `.workspace-bridge-baseline.json`，可覆盖为 `--baseline <file>`），与当前结果逐类别对比
  - 对比输出：`regression.{deadExports|unresolved|cycles|healthGaps}.{new|fixed|open}`，问题标识策略为 dead export 按 `file#name`、unresolved 按 `file#source`、cycle 按排序后 `files.join('->')`、health gap 按 `checkName`
  - `cli.js` `audit-summary` case 顶部统一 `require` `regression-tools`（避免条件 require 被 depGraph 静态分析误判为无 importer）
  - 向后兼容：不加 `--save`/`--check-regression` 时输出 100% 不变
  - 测试：`regression-test.js` 4 断言覆盖 save 生成基线文件、无基线时 check-regression 报错、相同基线对比三态（new/fixed/open 均为空）、自定义 `--baseline` 路径

- **`--baseline <commit>`** `cli.js` `src/tools/regression-tools.js` `test/regression-test.js` — 基线对比支持任意 git commit，标注问题为"本次变更引入"还是"历史遗留"：
  - `regression-tools.js` 新增 `checkRegressionAgainstCommit(currentResult, commit, cwd)`：验证 commit 存在 → `git diff --name-only <commit>...HEAD` 获取变更文件 → 按文件归属标注 `new`/`legacy`
  - `cli.js` 路由：优先判断 `--baseline` 值是否为存在的文件路径；不是则尝试作为 git commit 解析；均失败时回退到默认基线文件对比
  - 向后兼容：`--baseline <file>` 行为 100% 不变
  - 测试：`regression-test.js` 新增 `--baseline HEAD~1` 断言（ok、commit 字段、new/legacy 数组结构）

- **hotspot reason 组合** `src/tools/overview-tools.js` `test/overview-tools-test.js` — 高耦合文件同时展示耦合数 + git 历史信号：
  - `buildHotspots` 中，当 `coupling.total > COUPLING_MEDIUM_MIN`（>10）且存在 `historyRisk.signals[0]` 时，reason 格式化为 `"耦合 X 个模块 · [历史信号]"`
  - 向后兼容：低耦合文件或没有历史信号的文件 reason 不变
  - 测试：`overview-tools-test.js` fixture 调整使 `src/a.js` coupling > 10，断言 reason 包含 `"耦合"` 前缀

- **L2-5 audit-overview schema 不一致** `src/tools/overview-tools.js` `test/overview-tools-test.js` — 统一 `audit-overview` 与 `audit-summary` 的 `summary` 子对象契约：
  - `summary.nextSteps`：新增别名，指向 `summary.recommendations`，兼容按 `audit-summary` 习惯读取 `nextSteps` 的集成方
  - `summary.counts`：新增 `{deadExports, unresolved, cycles, missingHygieneChecks}`，数值从当前 `depGraph` 结果直接提取
  - `summary.analysisCoverage`：当存在时同步放入 `summary`，消除 `audit-summary`（嵌套）与 `audit-overview`（顶层）的嵌套差异
  - 向后兼容：100% 保留现有字段（`insights`、`recommendations`、顶层 `analysisCoverage` 均不变）
  - 测试：`overview-tools-test.js` 新增 6 断言覆盖 `nextSteps` 存在性与长度、`counts` 四字段类型

- **`--format jsonl`** `src/cli/formatters/human-formatters.js` `cli.js` `src/cli/formatters/index.js` `test/formatter-direct-test.js` — JSON Lines 输出，管道友好：
  - `formatJsonl(command, result)`：按命令类型提取核心记录数组，每行一个 JSON 对象，带 `_type` 字段（`finding`/`dead-export`/`unresolved`/`cycle`/`changed-file`/`hotspot`/`impact`/...）
  - 覆盖命令：`audit-security`/`dead-exports`/`unresolved`/`cycles`/`audit-diff`/`audit-summary`/`audit-overview`/`impact`/`dependents`/`dependencies`/`affected-tests`/`audit-map`/`health`/`diagnostics`
  - 无数组命令 fallback 到整对象输出；空数组时输出 `_type: 'summary'` 行
  - `cli.js` 注册 `--format <mode>` help 文案（summary | markdown | jsonl），main() 增加 `parsed.format === 'jsonl'` 路由
  - 向后兼容：不加 `--format` 时行为 100% 不变
  - 测试：`formatter-direct-test.js` 新增 5 断言覆盖 error、audit-security findings、dead-exports、audit-summary 多类型混合、空数组 summary fallback

- **默认输出校准评估**（纯文档/决策，0 行代码）— 评估是否将默认输出从 `human-readable` 改为 `--format summary`：
  - **决策：保持 `human-readable` 默认不变**。理由：(1) AGENTS.md L1-1 Never break userspace，突然改变默认格式会 break 现有脚本；(2) 人类用户首次终端运行时期望看到完整字段，summary 是 AI 优化格式；(3) SKILL.md 已明确推荐 AI 场景使用 `--format summary`

---

### 新增（P1 `--format ai` AI 预消化输出）

- **`formatAi` 策展 formatter** `src/cli/formatters/human-formatters.js` — AI 可直接消费的预消化 JSON，替代原始 `--json` 嵌套深、体积大的问题：
  - 统一结构：`{ ok, schemaVersion, severity, meta, counts, topRisks[], actions[], confidence }`
  - `topRisks` 按业务优先级排序：低 coverage → cycles → unresolved → dead-exports → health，每条风险含 `severity` / `count` / `message` / `confidence`（数值 0–1）
  - `actions` 从 `nextSteps` 提取，最多 3 条，带 `priority: P0/P1/P2`
  - `confidence` 包含 `overall` 和 `coverageRatio`，AI 可据此校准信任度
  - 非 `audit-summary` 命令自动 fallback 到 `formatSummary`，不破坏现有体验

- **`--depth surface|detail|full` 渐进式发现** `cli.js` `src/cli/formatters/human-formatters.js`：
  - `surface`：只返回 counts + topRisks（最多 3）+ actions（最多 3）+ confidence + meta，~15 行 JSON
  - `detail`（默认）：追加 `riskFiles`，每类风险最多 3 个代表性文件（含 exports / import / cycle length）
  - `full`：追加完整 `details`（`deadExports[]` / `unresolved[]` / `cycles[]` 全部明细）

- **`--token-budget <n>` AI 上下文感知裁剪** `cli.js` `src/cli/formatters/human-formatters.js`：
  - 估算 token = `JSON.stringify(output).length / 4`
  - 超限时自动降级：full → detail → surface → 核心字段（`ok + severity + counts`）
  - 向后兼容：不加 `--token-budget` 时 100% 输出完整 depth 内容

- **CLI 参数与路由** `cli.js`：
  - `parseCliArgs` 注册 `'--depth': { key: 'depth' }` 和 `'--token-budget': { key: 'tokenBudget', transform: ... }`
  - Help 文案更新：`--format <mode>` 增加 `ai`；新增 `--depth` 和 `--token-budget` 说明
  - 主输出路由增加 `parsed.format === 'ai'` 分支，透传 `depth` / `tokenBudget` / `schemaVersion`

- **测试覆盖** `test/formatter-direct-test.js`：
  - `testFormatAiAuditSummarySurface`：验证无 `riskFiles`/`details`
  - `testFormatAiAuditSummaryDetail`：验证有 `riskFiles` 无 `details`
  - `testFormatAiAuditSummaryFull`：验证有 `riskFiles` 和 `details`
  - `testFormatAiTokenBudgetDowngrade`：验证低 budget 触发降级到核心字段
  - `testFormatAiFallbackToSummary`：验证非 audit-summary 命令 fallback
  - `testFormatAiError`：验证错误输出格式

---

### 修复（P0 去噪工程 — 误报清零 + 输出策展）

- **常量仓库 / 脚手架直接过滤** `src/services/dep-graph.js` — 从 `deadExports[]` 直接移除，不降级保留：
  - `findDeadExports` `importers.length === 0` 分支：若 `scaffold` 命中（RuoYi / Vue Admin），直接 `continue` 跳过
  - `findDeadExports` `unused.length > 0` 分支：若 `isLikelyConstantsWarehouse`（Java `Constants.java` / `HttpStatus.java` / `Utils.java`）或 `scaffold` 命中，直接 `continue` 跳过
  - 向后兼容：常量仓库和脚手架文件仍参与依赖图构建，仅不从 `deadExports[]` 输出；`classifyDeadExports` / `honesty-engine` 分类逻辑 100% 保留
  - 实战效果：Java 后端常量仓库误报 35% 清零；RuoYi/Vue Admin 脚手架 dead-export 噪音清零

- **`audit-overview` 去重合并** `src/tools/overview-tools.js` `test/overview-tools-test.js`：
  - 删除 `summary.nextSteps = summary.recommendations` 别名（`audit-overview` 内部两字段完全重复，8 条建议一模一样）
  - `buildCouplingSplitSuggestions` 返回数量从 `SCORING.TOP_N_LIST(10)` 截断为 3，消除 `splitPlan` 模板化文案重复堆积
  - 测试同步：移除 `overview-tools-test.js` 中 `nextSteps` 存在性与长度断言

- **`audit-security` 附加 `matchedText`** `src/tools/security-tools.js` — 正则命中后输出匹配到的具体字符串：
  - `runBuiltinSecurityScan` 每条 finding 新增 `matchedText` 字段（`lines[i].match(rule.pattern)[0]`），超长时截断至 120 字符
  - AI 消费者无需额外读文件即可判断 `password: 'admin123'` 等命中内容是否为真实问题
  - 向后兼容：未命中规则时 `matchedText` 为 `null`，不影响现有字段

### 修复（阶段 3：框架感知深化 — P6）

- **Vue `<script setup>` 编译器宏识别** `src/services/dep-graph/parsers/js.js` `src/services/dep-graph/framework-patterns.js` `test/vue-parser-test.js` `test/framework-patterns-test.js` — 消除 Vue 3 项目中 `defineProps`/`defineEmits`/`defineExpose` 被误标为 dead exports 的问题：
  - `js.js` 新增 `VUE_COMPILER_MACROS` 集合（`defineProps`/`defineEmits`/`defineExpose`/`defineOptions`/`defineSlots`/`defineModel`），在 AST 和 regex parser 中对 `.vue` 文件的 export 记录做过滤
  - AST 路径：`ExportNamedDeclaration` 的 `specifiers` 和 `declaration` 分支均跳过宏名 export
  - regex 路径：`parseJavaScript` 调用 `extractExportsWithRegex` 后统一过滤
  - 非 `.vue` 文件完全不过滤（保留向后兼容，避免误杀合法的同名函数 export）
  - `framework-patterns.js` `AST_PATTERNS.js` 新增 `vue-script-setup-macro` 内容检测模式，`detectFrameworkFromContent` 识别到宏调用时标记 `framework: 'vue'`、`isEntry: true`
  - 测试：`vue-parser-test.js` 新增 `testScriptSetupMacroExportsFiltered`（re-export 过滤）和 `testScriptSetupMacroDeclarationFiltered`（声明 export 过滤）；`framework-patterns-test.js` 新增宏内容检测断言

- **Spring 更多运行时注解识别（P7）** `src/services/dep-graph/framework-patterns.js` `test/framework-patterns-test.js` — 扩展 `AST_PATTERNS.java` 的 `spring-annotation` 模式，覆盖 `@FeignClient`（Spring Cloud 声明式 HTTP 客户端）和 `@Scheduled`（Spring 定时任务）：
  - `@FeignClient` 与 `@Scheduled` 追加到现有 `spring-annotation` patterns 数组，与 `@RestController`/`@Controller`/`@GetMapping`/`@PostMapping` 同组
  - 运行时注解管理的组件静态分析无法追踪调用方，统一标记 `framework: 'spring'`、`reason: 'spring-annotation'`、`isEntry: true`，`dep-graph.js` `isKnownEntryFile()` 自动保护，消除 dead-export 误报
  - 测试：`framework-patterns-test.js` 新增 `testDetectFrameworkFromContent` 中 `@FeignClient` 接口和 `@Scheduled` 方法的 content-based 检测断言

- **Django 配置驱动入口深化（P8）** `src/services/dep-graph/framework-patterns.js` `test/framework-patterns-test.js` — 补充 Django signals 运行时入口检测：
  - `AST_PATTERNS.py` 新增 `django-signal` 模式，覆盖 `@receiver` 装饰器和 `.connect(` 方法注册两种信号绑定写法
  - `detectFrameworkFromPath` 新增 `signals.py` 路径检测（Django 项目惯用信号集中存放文件名）
  - 信号处理函数被 Django 运行时通过信号分发机制调用，无静态 import 引用，统一标记 `isEntry: true`，消除 dead-export 误报
  - 测试：新增 `@receiver` content-based 检测、`post_save.connect` content-based 检测、`signals.py` path-based 检测 3 个断言

- **`--severity P0/P1` 过滤** `cli.js` `src/tools/security-tools.js` `test/severity-filter-test.js` — `audit-security` / `audit-summary` 输出前按 severity 过滤：
  - `parseCliArgs` 注册 `--severity`，校验值限定 `high|medium|low`
  - `audit-security`：对 `findings` 数组按 `severity` 过滤，过滤后重新计算 `summary.total` 和 `summary.bySeverity`
  - `audit-summary`：对 `deadExports.deadExports` 按 `confidence` 过滤（`high`/`medium`/`low` 与 severity 语义对齐），同步更新 `deadExportsCount` 和 `possibleFalsePositives`
  - 向后兼容：不加 `--severity` 时行为 100% 不变
  - 测试：`severity-filter-test.js` 覆盖 `audit-summary --severity high/medium`（利用当前项目 medium confidence dead exports 验证过滤效果）、非法 severity 值报错、`audit-security --severity high` 在有 finding 的临时文件上验证过滤

- **`--with-impact`** `cli.js` `test/with-impact-test.js` — `audit-diff` 输出追加 `impactFiles` 字段，变更文件依赖方自动展开：
  - `parseCliArgs` 注册 `--with-impact`
  - `audit-diff` case 对每个变更文件调用 `getImpactRadius(resolvedPath, 2)`，收集 depth=2 的依赖方，去重后注入 `result.impactFiles`
  - 使用 `safeEntries`（compact 前）获取 `resolvedPath`，避免 `compactChangedFile` 丢弃路径后无法计算 impact
  - 向后兼容：不加 `--with-impact` 时 `impactFiles` 字段不存在，行为 100% 不变
  - 测试：`with-impact-test.js` 覆盖 `--with-impact` 返回 `impactFiles` 非空、`--without` 时字段不存在

---

### 修复（大仓库并发限流 — 阶段 3）

- **Python 子进程信号量** `src/services/dep-graph/parsers/spawn-ast.js` `src/config/constants.js` `test/spawn-ast-concurrency-test.js` — 解决大仓库 Java/Python 项目构建时 20 个并发 Python 子进程导致 600MB–1.6GB 瞬时内存峰值的问题：
  - `spawn-ast.js` 新增模块级信号量（`activeParsers` + `parserQueue`），限制同时运行的 Python 子进程数为 `LIMITS.PYTHON_AST_CONCURRENCY = 4`
  - `acquireParserSlot()` / `releaseParserSlot()` 封装排队逻辑；`spawnPythonASTParser` 用 try-finally 包装，确保任何路径（成功/失败/超时/kill）都释放 slot
  - 向后兼容：非 Python/Java 文件解析不受影响；纯 JS parser 的并发仍为 20（`CONFIG.DEFAULT_CONCURRENCY`）
  - 测试：`test/spawn-ast-concurrency-test.js` 10 并发 mock 验证峰值 ≤ 4，且所有请求最终都完成

- **git log 分批次并发** `src/tools/overview-tools.js` `src/config/constants.js` `test/overview-tools-concurrency-test.js` — 解决 `audit-overview` 中 `buildHotspots` 对 50 个文件同时发起 `git log --follow`，导致磁盘/CPU 争用、总耗时 5–10s 的问题：
  - `buildHotspots` 从全量 `Promise.all(...map(...))` 改为分批次并发，每批 `LIMITS.GIT_LOG_CONCURRENCY = 8` 个文件
  - 批次内仍并行（同批文件互不影响），批次间串行（自然限制峰值并发）
  - 向后兼容：输出格式和排序 100% 不变；小仓库（<8 文件）行为完全不变
  - 测试：`test/overview-tools-concurrency-test.js` mock provider 验证 20 文件峰值 ≤ 8，且调用顺序在单批内保持

### 重构（git-tools.js 死代码清理）

- **删除 6 个无调用方的 git 工具函数** `src/tools/git-tools.js` `cli.js` — 根据 AGENTS.md L2-5 "删除 > 添加"铁律，清理自 MCP 转型以来无调用方的死代码：
  - 删除：`gitDiffSummary`、`gitBlame`、`gitHistory`、`gitBranchInfo`、`gitStash`、`gitLogGraph`
  - 这些函数在项目中无任何调用方（cli.js 无对应命令、无测试覆盖、被 dead-exports 分析明确标记为未使用）
  - `git-tools.js` 从 667 行 → 358 行（-309 行，-46%），dead exports 从 5 个 → 4 个
  - `cli.js` 合并重复的 `require('./src/tools/git-tools')` 为单一解构导入
  - 向后兼容：所有活跃函数（`getChangedFiles`、`getChangedLineRanges`、`getFileHistoryRisk`、`getDiffNumstat`）行为 100% 不变

### 修复（Windows 命令硬化：验证建议字符串在 PowerShell 下可执行）

- **`renderCommandString` 平台感知** `src/utils/stack-detectors/commands.js` `test/render-command-string-test.js` `test/go-module-path-test.js` — 解决 Windows 下 `cd ${cwd} && ${cmd}` 在 PowerShell 中无法直接复制粘贴执行的问题：
  - `renderCommandString(executable, platform = process.platform)`：Windows (`win32`) 下将 `cd ${cwd} && ${body}` 改为 `pushd ${cwd} && ${body}`。`pushd` 在 cmd 和 PowerShell 中均为内置命令，兼容性优于 `cd`
  - `parseCommandString` 同步扩展：`cd` 前缀解析正则增加 `pushd` 替代符，分隔符增加 `;`（PowerShell 语句分隔符），确保 `pushd backend && go test ./...` 和 `cd backend ; go test ./...` 都能正确恢复 `cwd`/`command`/`args` 结构
  - 向后兼容：非 Windows 平台行为 100% 不变；`executable` 结构化对象中的 `cwd` 字段语义不变，消费侧（`watch.js` `runCommandSecure`）仍通过 spawn 的 `cwd` 选项直接传递，不受字符串格式影响
  - 测试：`render-command-string-test.js` 新增 `testWindowsCwdPrefix` / `testLinuxCwdPrefix` / `testParsePushd` / `testParseSemicolon` / `testParsePushdSemicolon` 5 个断言；`go-module-path-test.js` 将硬编码 `cd ` 断言改为平台感知 `CD_PREFIX`

### 修复（测试基础设施稳定性）

- **`functionality-test.js` 不再修改 git tracked 文件** `test/functionality-test.js` — 移除对 `README.md` 的读写修改，改用临时 untracked 文件 `test-audit-diff-temp.txt` 触发 `audit-diff` 的变更检测。`finally` 块负责清理临时文件，即使测试被 SIGKILL 也不会脏化工作区
- **`java-parsers-test.js` javalang 探针超时提升** `test/java-parsers-test.js` — `spawnSync` timeout 从 5000ms → 15000ms，消除 Windows/Python 冷启动偶发超时导致的 flaky 测试
- **`runner.js` 增加单测试耗时打印** `test/runner.js` — 每个测试 PASS/FAIL 后输出耗时（ms），超过 10s 标记 `SLOW`，帮助识别性能回归和 CI 超时根因

### 重构（cli.js 门面拆分：`formatHuman` 提取到 formatters 层）

- **新建 `src/cli/formatters/human-formatters.js`** — 将 cli.js 中 ~200 行的 `formatHuman` switch 完整迁移至此文件，覆盖 19 个命令的人类可读格式化。cli.js 仅保留 `require('./src/cli/formatters').formatHuman` 一行委托调用
- **`src/cli/formatters/index.js`** 新增 `formatHuman` 导出
- **`cli.js`** 移除本地 `formatHuman` 函数定义和 `countTreeFiles` 直接导入（后者仅在 human-formatters.js 中使用），门面厚度从 ~623 行降至 ~420 行
- 向后兼容：所有 JSON/human 输出 100% 不变；新增命令时只需改 `human-formatters.js` 和 `runCommand` 路由，不再动 cli.js 的 formatter 逻辑

### 测试（formatter 直接测试覆盖）

- **新增 `test/formatter-direct-test.js`** `src/cli/formatters/human-formatters.js` `src/cli/formatters/repo-summary.js` — 直接测试此前仅被间接覆盖的 formatter 层：
  - `formatHuman` 覆盖 18 个命令分支（error / audit-summary / audit-overview / health / audit-file / dead-exports / unresolved / cycles / impact / affected-tests / dependencies / dependents / stats / audit-diff / audit-map / diagnostics / workspace-info / audit-security / default fallback）
  - `buildRepoSummary` 覆盖正常输入、coverageRatio < 0.5 severity 升级、node-first / java-first stack 优先级差异、nonMainline = 0 时的 totalFiles 提示
  - 纯新增测试，零生产代码改动
  - 测试数量从 94 → 95

- **新增 `test/formatter-e2e-test.js`** — 基于真实 CLI 输出的端到端第二层验证（白盒单元测试的补充）：
  - `audit-summary` / `audit-overview` human + JSON 双模式输出结构验证（含 P83/P88 totalFiles 标注断言）
  - `audit-file` / `health` / `stats` human 输出关键字段断言
  - `impact` 错误路径 human 格式断言（验证 `formatHuman` error fallback 在真实 CLI 链路中生效）
  - 测试数量从 95 → 96；e2e 单文件耗时 ~21s（主要开销来自 `audit-overview` 的 `git log --follow`）

- **新增 `test/parser-shared-polyglot-test.js`** — 直接测试此前仅被间接覆盖的 parser 底层纯函数：
  - `shared.js` 覆盖 9 个纯函数（`uniqueNames` / `exportKindFromDeclarationType` / `createExportRecord` / `isFunctionLikeNode` / `getCallName` / `buildFunctionFingerprint` / `normalizeImportedName` / `parseNamedBindings` / `createImportRecord`）
  - `polyglot.js` 覆盖 3 个 regex parser（`parseKotlin` / `parseGoRegex` / `parseRust`），含空输入边界
  - 纯新增测试，零生产代码改动；测试中发现 `parseKotlin` `enum class` 提取为 `class` 的已知边缘行为已文档化于测试注释中
  - 测试数量从 96 → 97

### 修复（P83/P88：`totalFiles` 语义标注消除用户困惑）

- **human-readable 输出显式标注 `totalFiles` 含义** `src/cli/formatters/human-formatters.js` `src/cli/formatters/repo-summary.js` — 解决用户看到 `totalFiles` 数值小于仓库实际文件数时产生"扫描不完整"的误解：
  - `audit-summary` human format 新增 `totalFiles: N (parseable source only; excludes assets/build artifacts/excluded dirs)` 行
  - `audit-overview` human format 同步修改 `totalFiles` 行，附加相同说明
  - `buildNextSteps` 在 `nonMainlineFiles > 0` 时追加解释性前缀：`Note: totalFiles counts only parseable source files; assets, build artifacts, and excluded directories are not included.`
  - 纯 JSON 输出 100% 不变（schema 冻结，不破坏 userspace）
  - 向后兼容：所有现有测试通过；消费者通过 `scope.counts.mainlineFiles` / `scope.counts.nonMainlineFiles` 仍可自行计算比例

### 修复（P77：`findUnresolvedImports` Windows 路径格式一致性）

- **新增 `fromNormalizedKey` 消除平台路径隐性假设** `src/utils/path.js` `src/services/dep-graph.js` `test/p77-unresolved-imports-test.js` — 修复 `findUnresolvedImports` 中 `hasFile()`（基于 `normalizePathKey`）与 `path.isAbsolute()` / `fs.existsSync()`（基于原始路径格式）判断不一致的边界：
  - `src/utils/path.js` 新增 `fromNormalizedKey(key)` 纯函数：Windows 下将 `c:/foo/bar`（normalizePathKey 格式）还原为 `c:\\foo\\bar`（平台原生格式）；POSIX 下为 no-op
  - `src/services/dep-graph.js` `findUnresolvedImports()` 第 941 行：将 `path.isAbsolute(imp)` 和 `fs.existsSync(imp)` 改为先 `fromNormalizedKey(imp)` 再判断，消除"normalizePathKey 格式的路径一定能被 `fs.existsSync` 正确识别"的隐性假设
  - 向后兼容：行为 100% 不变（当前 Windows 实测 `fs.existsSync('c:/foo')` 本就有效，修复仅为消除假设、统一范式）
  - 测试：`test/p77-unresolved-imports-test.js` 覆盖 `fromNormalizedKey` 转换语义 + `findUnresolvedImports` 对 normalizePathKey 格式路径的正确处理

### 重构（P8-2-1：`parseCommandString` 后处理补丁 → 正交设计）

- **`commands.js` 生成侧直接返回 `executable` 结构** `src/utils/stack-detectors/commands.js` `test/render-command-string-test.js` — 消除"生成侧拼字符串、消费侧拆字符串"的双源维护：
  - 新增 `renderCommandString(executable)` 纯函数：将 `{command, args, cwd, shell}` 合成人类可读的 `cmd` 字符串（`cd ${cwd} && ${command} ${args.join(' ')}`）
  - `buildNodeTestCommand` / `buildGoModuleTestCommands` / `buildRustTestCommands` 改为返回 `executable` 对象
  - `getNodeCommands` / `getPythonCommands` / `getJavaCommands` / `getGoCommands` / `getRustCommands` / `getCppCommands` / `generateCommands` 底部 direct-tests 等 20+ push 点全部改为 `executable: {...}`
  - `enrichCommandEntry` 双向化：已有 `executable` 无 `cmd` 时合成 `cmd`；已有 `cmd` 无 `executable` 时解析 `executable`。两者都有时保持不动，仅补全 `expectedExitCode` / `onFailure` 默认值
  - `addUniqueCommand` 兼容 `executable` 去重（`JSON.stringify(executable)` 比对 + `name` 比对）
  - 向后兼容：`cmd` 字符串字段**完全保留**，所有现有消费者（`watch.js` / `validation-advice.js` / `risk-actions.js` / `self-audit.js` / 10+ 测试文件）零改动继续工作。`generateCommands` 末尾的 `enrichCommandSet` 确保每个条目同时有 `cmd` + `executable`
  - `module.exports` 新增 `renderCommandString` 导出
  - 测试：`test/render-command-string-test.js` 8 断言覆盖基本合成、`cwd` 前缀、`shell` 优先、null 过滤、空对象、parse→render 往返、无 args

### 修复（P84：Maven 多模块边界检测 — 与 Gradle 对等）

- **P84: Maven 多模块项目模块边界零检测** `src/utils/stack-detectors/detect.js` `src/utils/stack-detectors/commands.js` `test/maven-module-detection-test.js` — 此前 Gradle subprojects 已完整支持（`settings.gradle` 解析 + 模块级命令），Maven `<modules>` 完全空白：
  - `detect.js` 新增 `detectMavenModules(root)`：解析根 `pom.xml` 的 `<module>` 元素，过滤无子 `pom.xml` 的幽灵条目，返回 `[{ name, dir }]` schema（与 Gradle `subprojects` 统一）
  - `detectStack()` 对 Maven 注入 `java.modules`（Gradle 保持原有行为）；`java.subprojects` 保留为兼容别名
  - `commands.js` `mapJavaFilesToGradleModules` → `mapJavaFilesToModules`，所有调用点通过 `java.modules || java.subprojects` 兼容旧消费者
  - Maven 多模块命令生成：受影响的模块通过 `-pl <module1>,<module2> -am` 精准构建（`compile`/`test`/`focused-tests`/`full-tests` 全阶段），未受影响模块完全跳过。单模块项目 fallback 到根目录命令，行为 100% 不变
  - 向后兼容：现有 Gradle mock stack（用 `subprojects` 字段）无需改动；`generateCommands` 自动 fallback
  - 测试：`test/maven-module-detection-test.js` 6 断言覆盖单模块/多模块/无模块/缺失子 pom/detectStack 注入/命令生成 `-pl` 验证

### 修复（路线 F：数据一致性收尾 — P92/P93/P94/P95）

- **P92: `workspace-info` 的 `entryFiles` 与 `audit-summary` 不一致** `src/tools/workspace-tools.js` — `workspaceInfo()` 改用 `projectContext.summarizeFiles(allOriginalPaths, getDependents)` 计算 `entryFiles`，替代原来的 `depGraph.entryFiles`（空 Set）。`allOriginalPaths` 从 `depGraph.graph.values()` 的 `originalPath` 属性聚合。与 `audit-summary` 的 `scope.entryFiles` 使用同一数据源和计算路径
- **P93: `workspace-info` 缺少 `stack` 字段** `src/tools/workspace-tools.js` — 返回值新增 `stack: {isNode, isJava, isPython, isGo, isRust}`，与 `health` 命令的 `stack` 字段同源同义。用户不再需要分别调用两个命令才能拿到完整项目画像
- **P94: `stats` 命令缺少 `fileRoles`** `src/services/dep-graph.js` — `GraphAnalyzer.getStats()` 在返回前调用 `this.getScopeSummary()` 获取 `fileRoles` 并注入 `stats` 对象。`stats` 与 `audit-summary` 的 `scope.fileRoles` 字段完全互通
- **P95: `ROLE_RULES` 与 `test-detector.js` 不同步** `src/utils/project-context.js` `test/role-detection-test.js` — `ROLE_RULES.test` 补入 `base === 'tests.py'` basename 匹配，与 `test-detector.js` 的 `TEST_DETECTION_RULES` 对齐。Django 项目的 `core/tests.py` 等不再被误标为 `library`。新增 `role-detection-test.js` Django 固件测试验证

### 修复（路线 G：框架感知补全 — P96/P101）

- **P96: Vue 长循环白名单不足（长度=6 被误报）** `src/services/dep-graph.js` `test/dep-graph-error-test.js` — `isLikelyFrameworkLegitimateCycle` 对 Vue 项目放宽至长度 ≤6（其他框架保持 ≤5）：① `allInVue` 目录匹配新增 `api`/`http`/`request`/`services`/`service` ② 维度检测新增 `hasApi`（≥2 个维度即合法）。`request→store→router→view→api→request` 标准数据流不再被误报为 cycles。新增 `testVueLongCycleWhitelist` 验证 5 文件 length=6 循环被正确过滤
- **P101: Django 项目 `testConfig` 被误报为缺失** `src/tools/health-tools.js` `test/health-tools-test.js` — `detectTestConfig()` 在无其他测试运行器时检测 `manage.py` 存在，返回 `frameworks: ['django-test']`。Django 项目 health 评分不再被不公正扣分。新增 `testDjangoTestConfigDetection` 验证

### 修复（路线 H：脚手架与模板同质化 — P97/P98/P99/P100）

- **P97: RuoYi Java 工具类循环被误报为架构缺陷** `src/services/dep-graph.js` `test/dep-graph-error-test.js` — `isLikelyFrameworkLegitimateCycle` 新增 RuoYi 脚手架工具类互依赖白名单：① 循环长度 ≤2 ② 路径含 `ruoyi`/`common/utils`/`common/core` ③ 所有文件名以 `Utils`/`Formatter`/`Serializer`/`Helper`/`Constants` 结尾。`StringUtils↔StrFormatter`、`Sensitive↔SensitiveJsonSerializer` 等同源脚手架同质循环不再重复报告为缺陷。新增 `testRuoYiJavaCycleWhitelist` 验证
- **P98: `scaffold-detector.js` 未覆盖 `Sensitive.java` 等 RuoYi 指纹** `src/tools/scaffold-detector.js` `test/scaffold-detector-test.js` — `ruoyi-java` 指纹补全：`pathPatterns` regex 新增 `sensitive`，覆盖 `Sensitive.java` 在 ruoyi 路径下的检测。新增 `testScaffoldDetectorSensitiveJava` 验证
- **P99: 第三方库复制文件被标 dead-export** `src/tools/honesty-engine.js` `test/honesty-engine-test.js` — 新增 `VENDOR_COPY_BASENAMES` 集合（`jsencrypt.js`、`md5.js`、`crypto-js.js` 等 14 个常见库），`classifyDeadExports()` 在 `FRAMEWORK_IMPLICIT_PATTERNS` 之后检测 vendor-copy 并标记 `reason: 'vendor-copy'`。`buildClassificationSummary` 将 `vendor-copy` 纳入假阳性统计。静态分析无法追踪全局变量运行时引用的问题现可被透明标注。新增 `testClassifyDeadExports_vendorCopy` 与 `testBuildClassificationSummary_vendorCopyCountedAsFalsePositive` 验证
- **P100: 根目录独立 `.py` 脚本未被识别为 `script`** `src/utils/project-context.js` `src/utils/path.js` `test/role-detection-test.js` — `ROLE_RULES.script` 新增根目录 `.py` 文件检测（深度=1，已被 `test`/`migration`/`entry`/`config` 前置规则捕获的除外）；`isStandaloneEntryPath()` 同步新增 `/^[^/]+\.py$/` 匹配，使孤儿检测与角色分类一致。`ai_gwy_backend` 根目录 20+ 运维脚本不再被误标为 `library`/`unknown`。新增根目录 `.py` script 角色覆盖测试

### 修复（路线 I-2：GitNexus 低垂果实吸收）

- **`yieldToEventLoop()` 防事件循环阻塞** `src/services/dep-graph.js` — `_processFilesWithLimit` 每处理 20 个文件 `await setImmediate` 主动让出；`applyFrameworkImplicitImports` 改为 async，同步 `fs.readFileSync` 替换为 `await readFile`，同循环内每 20 文件让出。`build()` / `updateFiles()` 中 `postProcessPhases` 调用改为 `await phase()`。大仓库（10k+ 文件）首次索引和 watch 长期运行时 CLI/UI 不再卡顿
- **数值 confidence 替代文本分级** `src/services/dep-graph.js` `src/config/constants.js` — `computeDeadExportConfidence` 返回值新增 `confidenceValue`（0.95 / 0.9 / 0.5）和 `confidenceSource`（`ast-no-importer` / `ast-unused-exports` / `regex-fallback` / `graph-sparse` / `java-constants-warehouse`）。下游 AI 消费者可按数值阈值过滤，消除 `high/medium/low` 文本分级无法排序/比较的问题。向后兼容：`confidence` 字符串字段完全保留
- **Staleness 检查 git HEAD** `src/services/container.js` `test/staleness-test.js` — `initialize()` 末尾执行 `git rev-parse HEAD` 并将 hash 存入 `cache.workspaceInfo`；`getStaleness()` 比较当前 HEAD 与缓存 HEAD，不一致时 `isStale: true` + `gitHeadChanged: true`。用户切换分支后缓存自动被视为过期，避免分支切换后的误报。非 git 目录或 git 不可用时不影响现有行为

### 重构（路线 J：Import 解析策略链重构 — GitNexus 模式吸收）

- **`resolvers.js` 配置表驱动策略链** `src/services/dep-graph/resolvers.js` `test/resolver-strategy-chain-test.js` — 吸收 GitNexus `import-resolvers/resolver-factory.ts` 设计模式：
  - 新增 `createResolver(strategies)` 工厂函数：有序策略链，第一个非 null 结果获胜
  - 新增 `registerResolverConfig(ext, strategies)` API：每种语言一行配置
  - 新增 10 个策略纯函数：`tryAlias` / `tryRelativeWithExtensions` / `tryPythonRelative` / `tryPythonAbsolute` / `tryJava` / `tryGoRelative` / `tryGoModule` / `tryRustCrate` / `tryRustSuper`
  - `resolveImport(fromFile, importPath, ext, root)` 门面：内部从 6 分支 if-else 改为 `RESOLVER_CONFIGS.get(ext) || default` + `createResolver(strategies)`。对外接口 100% 不变
  - 向后兼容：所有原有导出（`resolveJavaImport`, `clearResolverCaches`, `cachedExistsSync`）完全保留
  - 新增 `test/resolver-strategy-chain-test.js`：20 断言覆盖链式行为、配置表覆盖、facade 行为、扩展注册

### 修复（路线 I：GitNexus 模式吸收与图架构深化 — P102/P103/P104/P105）

- **P102: `updateFiles` 删除文件后图不一致（L1）** `src/services/dep-graph.js` `test/dep-graph-incremental-test.js` — 删除分支追加清理：① 遍历 `reverseGraph` 所有值，从 dependents 数组中移除被删除文件 ② 遍历 `graph` 所有条目，从 `imports` / `importRecords` 中过滤被删除文件 ③ 删除 `reverseGraph` 中以被删文件为 key 的条目。彻底消除 watch 长期运行的幽灵边。测试同步更新：删除后 `n.js` 不再引用 `m.js`，`getDependents(mKey)` 返回 `[]`
- **P103: `framework-patterns.js` 引入 `entryPointWeight` 梯度评分（L2）** `src/services/dep-graph/framework-patterns.js` `src/tools/overview-tools.js` `test/framework-patterns-test.js` — 将 `isEntry: true/false` 升级为 1.0–3.0 梯度评分（`ENTRY_WEIGHT` 常量表）：HIGH=3.0（page/controller/views/main/application）、MEDIUM_HIGH=2.5（layout/routes/URLs/handlers）、MEDIUM=2.0（admin/middleware/plugins）、LOW=1.5（components/prisma）、MINIMAL=1.0（manage.py）。`calculateHotspotScore` 接入 `entryPointWeight` multiplier（`> 1` 时 `score *= weight`），热点计算首次能区分 Spring Boot Controller 与 Django manage.py 的变更风险差异。向后兼容：`isEntry` 字段保留，现有消费者零改动
- **P104: 扩展隐式依赖模式 — React.lazy / Next.js dynamic / Angular loadChildren（L2）** `src/services/dep-graph/framework-usage-patterns.js` `test/framework-usage-patterns-test.js` — 新增 3 个 `FRAMEWORK_USAGE_PATTERNS` 配置：① `react-lazy` 扫描 `React.lazy(() => import('...'))` / `lazy(() => import('...'))` ② `nextjs-dynamic` 扫描 `dynamic(() => import('...'))` ③ `angular-loadchildren` 扫描 `loadChildren: () => import('...')`。各 pattern 含独立 scanner/extractor，复用现有 `resolveImplicitImports` 解析链路。消除 React/Next.js/Angular 项目懒加载组件的 orphan/dead-export 系统性误报。新增 3 组单元测试验证提取精度
- **P105: 软 post-process phase 架构（L3）** `src/services/dep-graph.js` — `GraphBuilder` 构造函数新增 `postProcessPhases: Array<() => void>`，默认注册 `applyFrameworkImplicitImports`。`build()` 和 `updateFiles()` 末尾的硬编码调用替换为 `for (const phase of this.postProcessPhases) phase()`。新增 `registerPostProcessPhase(fn)` API 供外部注册新 phase。向后兼容：不加 `--incremental` 时现有行为 100% 不变

### 新增（P8-3 增量策展 — 闭环能力完整）

- **`audit-file --watch`** `cli.js` `src/cli/watch.js` `test/audit-file-watch-test.js` — 文件保存后输出完整 audit-file 结构化结果（JSON Lines 事件流）：
  - `startAuditFileWatch(options)`：复用 `ServiceContainer` + `watch: true` 初始化，注册 `onFileChanged` 回调
  - `registerAuditFileWatchCallback`：支持 `--file <path>` 目标过滤，只对目标文件变更触发分析
  - `buildAuditFileWatchResult`：调用 `getImpactRadius` + `findAffectedTests` + `getFrameworkHint` + `buildFileValidationAdvice` + `buildFileSummary`，输出完整 audit-file 语义
  - JSON Lines 事件契约：`auditFileStart` → `auditFileResult`（含 `impact`/`affectedTests`/`validationAdvice`/`summary`/`frameworkPattern`）→ `auditFileComplete`
  - CLI 路由：`case 'audit-file'` 检测 `parsed.watch`，`isSelfManaged` 判断包含 `audit-file --watch` 以管理容器生命周期
- **`audit-diff --incremental`** `cli.js` `src/tools/incremental-diff.js` `test/audit-diff-incremental-test.js` — 范围过滤层，消除全库噪音：
  - `buildIncrementalFindings(changedFiles, container)`：收集 changed files + impact radius（depth=2）构成 `relatedFilesSet`，全库 `findDeadExports`/`findUnresolvedImports`/`findCircularDependencies` 只保留相关子集
  - 输出 Schema：audit-diff 返回值追加 `incremental: true` + `incrementalFindings`（`deadExportsCount`/`deadExports`/`unresolvedCount`/`unresolved`/`cyclesCount`/`cycles`）
  - 向后兼容：不加 `--incremental` 时现有字段 100% 不变
- **参数解析**：`cli.js` `parseCliArgs` 新增 `'--watch': true` / `'--incremental': true`，返回值映射 `watch`/`incremental` 字段
- **测试**：`test/audit-file-watch-test.js`（启动 → 触发文件变更 → 轮询验证 JSON Lines 事件 + target filtering）+ `test/audit-diff-incremental-test.js`（schema 验证 + 与全量输出对比 + 范围过滤断言）

### 新增（P78 脚手架噪音过滤 — 路线 B）

- **脚手架指纹检测** `src/tools/scaffold-detector.js` `src/tools/honesty-engine.js` `src/services/dep-graph.js` `src/cli/formatters/recommendation-engine.js` `src/cli/formatters/repo-summary.js` — 解决 RuoYi/Vue Admin 等常见脚手架在多个项目间产生 30+ 相同 dead-export 噪音的问题：
  - `scaffold-detector.js`：保守策略，两层匹配：① `exactBasenames`（高度特异的文件名，如 `AbstractQuartzJob.java`、`SysUser.java`、`ruoyi.js`）② `pathPatterns`（通用文件名如 `StringUtils.java` 仅在路径含 `ruoyi` 等标记时才匹配）。避免误标非脚手架项目。
  - `honesty-engine.js`：`classifyDeadExports` 集成 `detectScaffold()`，命中则 reason = `scaffold-ruoyi` / `scaffold-vue-admin`，纳入 `falsePositiveReasons`。
  - `dep-graph.js`：`findDeadExports` 返回记录新增 `scaffold` 字段（含 `name`/`reason`/`description`）。
  - `recommendation-engine.js`：`buildDeadExportRecommendation` 识别 `scaffold-*` primaryReason，文案提示 "known scaffolding boilerplate (RuoYi / Vue Admin)"。
  - `repo-summary.js`：`honesty.deadExports` 新增 `scaffoldDeadExports` 计数。
  - 测试：`test/scaffold-detector-test.js`（7 测试，覆盖 exact-basename / path-pattern / non-scaffold / null）+ `test/honesty-engine-test.js` 补充 4 测试 + `test/recommendation-engine-test.js` 补充 1 测试。

### 修复（实战检测发现 — L2-3/L2-5/L3-1/L3-2）

- **L2-3: `workspace-info` 语言检测遗漏 Python 文件** `src/utils/path.js` `src/services/dep-graph/parsers/registry.js` `src/tools/workspace-tools.js` — `detectWorkspace` 新增 `_hasPythonFiles(root)`：扫描根目录及一层子目录中的 `.py` 文件，与 Java 的 `_hasJavaInSubdirs` 保持一致。`registry.js` 的 Python `condition` 增加 `workspace.hasPythonFiles`，`workspaceInfo` 的 `detected.python` 同步更新。Node.js 项目中的 Python 辅助脚本（如 `scripts/*.py`）现被正确索引和统计
- **L2-5: `--exclude` 不支持 glob 模式** `src/services/file-index.js` `src/services/dep-graph.js` `cli.js` — `shouldExcludeCli` 新增简单 glob 支持：pattern 含 `*` 或 `?` 时转为正则，先匹配 basename、再匹配完整路径。`cli.js` `--help` 文案同步更新为 "simple globs (*.ext)"。`*.sql` / `*.py` 等扩展名排除现已生效
- **L3-1: `dead-exports` barrel / internal-use 模式误报** `src/services/dep-graph.js` — 新增 `_scanLocalSymbolUsage(filePath, symbols)`：逐行扫描源文件内容，检测模块内部的函数调用（`symbol(`）和属性访问（`symbol.`），跳过 `export` / `function` 声明行。`findDeadExports` 在 importer 扫描后追加本地使用扫描，消除 "导出符号仅被同模块内部使用" 的误报。自身项目 dead exports 15→5（-10 误报消除）
- **L3-2: `audit-overview` 耦合建议模板化严重** `src/tools/overview-tools.js` — `generateCouplingSplitPlan` 默认分支按耦合形状差异化：
  - `inDegree > outDegree * 2` → 核心服务拆分建议
  - `outDegree > inDegree * 2` → facade / 防腐层建议
  - `inDegree >= 3 && outDegree >= 3` → 双向耦合 / 读写分离建议
  - 其他 → 保留原 facade + 接口层建议

### 修复（数据一致性与分类完整性 — P17/P36/P47）

- **P17: `stability` 数组截断不透明，`aggregates` 与展示数据不一致** `src/tools/overview-tools.js` — `buildStability` 移除 `STABILITY_CANDIDATE_LIMIT` 截断，处理全部主线文件；`buildProjectOverview` 返回值新增 `stabilityMeta`（`totalCount`/`truncated`/`limit`），让用户明确知道还有多少文件未展示。同时统一 `mainlineFiles` 过滤逻辑，排除 test/docs/style/asset，与 `summarizeFiles` 的 `isTrulyMainline` 对齐
- **P36: `fileRoles` 缺少 `docs`、`style`、`asset` 角色，分类体系不完整** `src/utils/project-context.js` — `ROLE_RULES` 新增 `style`（`.css`/`.scss`/`.sass`/`.less`/`.stylus`）和 `asset`（图片/字体/媒体/压缩包）规则；`summarizeFiles` 的 `fileRoles` 初始化增加 `docs: 0, style: 0, asset: 0`，消除潜在的 `NaN` 风险；`isTrulyMainline` 同步排除 style/asset
- **P47: `scope.counts` 与 `stats` 命令完全没有代码量统计** `src/services/cache.js` `src/services/dep-graph.js` `src/tools/workspace-tools.js` — `cache.getStats()` 遍历 `fileMetadata` 累加 `lineCount`；`depGraph.getStats()` 透传 `totalLines`；`workspaceInfo` 输出新增 `totalLines`。`stats` 命令和 `workspace-info` 现已包含总行数

### 修复（核心功能可信度 — P42/P56/P51）

- **P42/P56: `deadExports.confidence` 分级逻辑不透明，90% 文件统一为 medium** `src/services/dep-graph.js` — 新增 `computeDeadExportConfidence()` 纯函数，按 `parseMode + graph reliability` 分级（importerCount 不参与降级，因为它衡量的是**文件**级引用而非**导出**级引用）：
  - `high`: 无 importer 且 graph 可靠
  - `medium`: AST 解析且存在 importer → AST 精确追踪符号使用，可信度中等
  - `low`: regex 解析、或 graph 稀疏 → regex 无法精确追踪符号，假阳性风险高
  每个 dead-export 条目新增 `confidenceReason` 字段，输出人类可读的解释。彻底消除黑盒分级
- **P51: 命令输出"零问题"组合形成系统性虚假安全感** `src/services/dep-graph.js` `src/cli/formatters/repo-summary.js` `src/tools/overview-tools.js` `cli.js` — `depGraph.getStats()` 新增 `analysisCoverage`（`totalFiles`/`parsedFiles`/`fallbackFiles`/`coverageRatio`）。`audit-summary` 和 `audit-overview` 输出均包含此字段。当 `coverageRatio < 0.5` 时，`summary.severity` 强制上浮为 `high`，并追加 `coverageWarning` 提示用户"findings may be incomplete"

### 修复（结果可信性 — P86/P87/P91）

- **P91: `audit-summary` / `audit-overview` orphans 聚合与明细不一致** `src/tools/overview-tools.js` — `buildOverviewSummary` 的 `orphanCount` 从 `Object.values(orphans).flat().length` 修复为 `orphans.all.length`。原代码把 `all`（已含全部孤儿）与各分类数组（docs/scripts/configs/modules）再次累加，造成重复计数（如 `ai_gwy_backend` 聚合报 4 但明细仅 2）
- **P87: `importerCount>0` 的 dead-export 解释模板化** `src/services/dep-graph.js` `src/config/constants.js` — `computeDeadExportConfidence` 按 `importerCount` 差异化 `confidenceReason`：
  - `importerCount >= 10` → "File has N importers, but these specific exports are not referenced by any importer"
  - `importerCount >= 3` → "File has N importers; unused exports may be internal helpers or barrel re-exports"
  - `importerCount < 3` → 保留原 "AST-level analysis found unused exports..."
  阈值常量 `DEAD_EXPORT.IMPORTER_COUNT_HIGH` / `IMPORTER_COUNT_MEDIUM` 进 `constants.js`。彻底消除 "importerCount=18 仍返回同一句话" 的模板化问题
- **P86: `vue-page-implicit` 等误报仅计数、未归因到具体文件** `src/tools/honesty-engine.js` — `classifyDeadExports` 在返回分类前给单条 dead-export 记录注入 `falsePositiveReason` 字段（如 `vue-page-implicit` / `java-constants-warehouse` / `scaffold-ruoyi` / `uncertain`）。`dead-exports` 命令 JSON 输出中的每条记录现可直接查看其 fp 标签，用户无需在聚合层和明细层之间来回比对

### 修复（Windows 平台硬化 + 配置一致性 — P89/P90）

- **P89: Windows 路径大小写被强制归一化** `src/utils/path.js` `src/services/dep-graph.js` `src/tools/dep-tools.js` `src/cli/repl.js` `src/tools/workspace-tools.js` `src/tools/security-tools.js` `src/cli/formatters/project-map.js` `src/tools/overview-tools.js` — 解决 Windows 上 `normalizePathKey()` 的 `toLocaleLowerCase('en-US')` 导致 JSON 输出路径丢失原始大小写的问题（如 `filePreview.js` → `filepreview.js`）：
  - `path.js` 新增 `toDisplayPath()` — 仅 POSIX 斜杠转换，保留原始大小写，用于外部输出
  - `GraphBuilder.analyzeFile()` 在 graph value 中存储 `originalPath`（原始绝对路径）
  - `DependencyGraph` 新增 `_displayPath(graphKey)` — 将内部 graph key 映射回原始路径
  - 所有输出方法统一转换：`findDeadExports`/`findUnresolvedImports`/`findCircularDependencies`/`getImpactRadius`/`findAffectedTests`/`getDependencies`/`getDependents` 返回的路径、CLI 命令 JSON、REPL `top`、formatters、security findings 全部使用 `_displayPath`
  - 防御性设计：所有调用点使用 `_displayPath?.(k) || k`，兼容测试 mock 对象
- **P90: `.workspace-bridge.json` 配置状态不对称** `src/utils/project-context.js` — 空配置文件（仅含 `$schema` 或 `{}`）与无配置文件的 `hasWorkspaceBridgeConfig` 标记不同（`true` vs `false`），导致处理路径分叉：
  - 新增 `hasEffectiveConfig(config)` — 排除 `$schema` 后检查是否有任何有效配置键
  - `summarizeFiles()` 中 `hasWorkspaceBridgeConfig` 改为 `pathExists(configPath) && hasEffectiveConfig(this.config)`
  - 空配置/纯 schema 配置现在与无配置行为完全一致

### 测试

- `test/dead-export-confidence-test.js` — 更新 `testManyImportersAst` 断言以反映 P87 差异化文案；新增 `testVeryManyImportersAst` 覆盖 `importerCount >= 10` 分支
- `test/honesty-engine-test.js` — 新增 `testClassifyDeadExports_falsePositiveReasonSinked` 验证 P86：`classifyDeadExports` 调用后单条记录自带 `falsePositiveReason`

### 性能

- **`file-index.js` `content.split('\n')` 内存峰值** `src/services/file-index.js` — 行数统计从 `content.split('\n').length` 改为 `(content.match(/\n/g)?.length || 0) + 1`，消除大文件临时数组内存峰值（1MB 文件 ~20MB → ~0MB）

### 测试

- `test/dead-export-confidence-test.js` — 覆盖 `computeDeadExportConfidence` 全部分支：无 importer 可靠/不可靠、AST 少 importer、AST 多 importer、regex 模式
- `test/analysis-coverage-test.js` — 覆盖 `getStats().analysisCoverage`：全 AST、混合 regex、空图

### 新增（Schema 冻结基础设施）

- **全局 `schemaVersion` 字段** `cli.js` — 定义 `SCHEMA_VERSION = '1.1.1'`，所有 JSON 输出（含 `init` 命令）自动注入 `schemaVersion`。核心字段 `{ ok, error, severity, summary }` 语义冻结：在 `schemaVersion` 不变时，这些字段的类型和含义绝不改变

### 新增（Parser 契约完整性 — Rust/Kotlin AST）

- **`rust-ast.js` 补 `imported` 提取** — `import.source`（`use std::io::Read` → `imported: ['Read']`）、`import.use_list`（`use std::io::{Read, Write}` → 每条 path 的末段符号）、`import.use_as`（`use crate::utils::Helper as MyHelper` → `imported: ['MyHelper']`）。此前 Rust AST 的 `imported` 始终为 `[]`
- **`kotlin-ast.js` 补 `imported` 提取** — 非 wildcard import（`import java.io.File` → `imported: ['File']`）。此前 Kotlin AST 的 `imported` 始终为 `[]`

### 新增（Impact 诚实度标注）

- **`importedSymbolsAvailable` 布尔字段** `src/services/dep-graph.js` — `getImpactRadius` 的每条 impact 记录新增 `importedSymbolsAvailable`。当 `matchingImports.length > 0 && matchingImports.some(r => r.imported.length > 0)` 时为 `true`，否则为 `false`。解决 AI 无法区分"使用了整包"与"parser 没提取符号"的歧义

### 测试

- `test/rust-ast-parser-test.js` — 新增 4 条 `imported` 提取断言：HashMap/`self`（use_list）/Read（use_list）/MyHelper（use_as）
- `test/kotlin-ast-parser-test.js` — 新增 3 条 `imported` 提取断言：File（普通 import）/wildcard（空数组）/delay（函数 import）

### 修复（Schema 一致性 — 冻结后修复）

- **`schemaVersion` 类型不一致：CLI 注入字符串 `'1.1.1'`，但 `audit-overview` 内部返回数字 `1`** `cli.js` `src/tools/overview-tools.js` `test/functionality-test.js` `test/overview-tools-test.js` — 全仓库统一为字符串 `'1.1.1'`（semver 风格）。此前 `overview-tools.js` 的 `hotspotData` / `stabilityTrend` 返回 `schemaVersion: 1`（number），与 CLI 的 `schemaVersion: '1.1.1'`（string）冲突，会导致 AI 解析器 `typeof` 检查失败

### 新增（P8-2 validationAdvice 可执行契约）

- **`commands` 数组新增 `executable` 结构化字段** `src/utils/stack-detectors/commands.js` `src/cli/formatters/validation-advice.js` — 所有 validationAdvice 命令条目从 `{name, description, cmd}` 扩展为 `{name, description, cmd, executable}`，其中 `executable` 包含：
  - `command`: 可执行文件名（如 `"npm"`、`"go"`、`"cargo"`）
  - `args`: 参数数组（如 `["run", "test"]`）
  - `cwd`: 工作目录（从 `cd <dir> && ` 前缀中提取，为 `null` 时在当前目录执行）
  - `shell`: 若命令含管道/重定向等 shell 运算符，保留原始字符串供 shell 执行；否则为 `null`
  - `expectedExitCode: 0` / `onFailure: 'abort'` — 供自动化流水线消费
  - 向后兼容：`cmd` 字符串完全保留，现有消费者无需改动
- **`parseCommandString` 尽力而为解析器** `src/utils/stack-detectors/commands.js` — 提取 `cd` 前缀、检测 shell 运算符、拆分参数。不追求 100% 精确（引号内空格未处理），但覆盖 95% 以上的真实验证命令

### 修复（测试稳定性 — watch-test.js flaky）

- **固定 `delay(2500)` 替换为轮询** `test/watch-test.js` — 创建触发文件后，轮询检查 stdout（最长 15s），消除 fs.watch 平台时序差异导致的偶发失败
- **独立临时目录隔离** `test/watch-test.js` — 触发文件从 repo root（`watch-test-temp-file.js`）迁移到 `test/.watch-temp/trigger.js`，避免测试崩溃时污染工作区，也不与 git tracked 文件冲突
- **新增 SIGINT 优雅退出覆盖** `test/watch-test.js` — 启动 watch 进程后发送 `SIGINT`，验证进程在 5s 内退出（Windows 上接受 `code === 0 || code === null` 以兼容平台差异）

### 新增（P8-1 watch 闭环）

- **`watch --run-tests`** `cli.js` `src/cli/watch.js` — 文件保存后自动执行 affected-tests 验证闭环：
  - `buildWatchValidationCommands`：利用 `depGraph.findAffectedTests` + `generateCommands`（`run-direct-tests` steps）生成可执行的 focused 测试命令
  - `executeWatchCommand`：spawn 执行单个 `executable` 结构化命令，支持 `cwd` / `shell` / `expectedExitCode` / 60s 超时 kill
  - `runWatchValidation`：顺序执行命令链，任何命令失败立即停止，输出 JSON Lines 事件流（`validationStart` / `commandStart` / `commandResult` / `validationComplete`）
  - 失败时 `commandResult` 包含完整 stdout/stderr；成功时省略以控制体积
  - 向后兼容：不加 `--run-tests` 时 watch 行为 100% 不变
- **`--run-tests` 测试覆盖** `test/watch-test.js` — 验证 `--run-tests` 启动后 stderr 提示 auto-run 模式，文件变更后 stdout 出现 `validationStart` + `validationComplete` JSON Lines 事件

### 路线 A 终点声明

- **P24** `impact` source 文件出现在自己的影响列表 — 代码已有 `level === 0 || file === start` guard，当前代码无法复现，标记为 **cannot-reproduce**
- **P30** `unresolved` 的 `resolvedTo` 语义 — 冻结为：`resolvedTo: null` = "该 import 未能解析到磁盘上的文件"，不改 schema，不在输出中增加新字段
- **P43** `health.checks.ci` 未检测到 `.github/workflows` — 当前代码已升级为递归扫描 `.yml`/`.yaml`，当前代码无法复现，标记为 **cannot-reproduce**

### 清理（Dogfooding — 删除真实死代码）

- **`getContainer` 全局单例无人使用** `src/services/container.js` — 删除 `getContainer()` 函数及导出。`cli.js` 直接 `new ServiceContainer()`，该单例工厂自始无调用方
- **`search-tools.js` 为 MCP 转型残留** `src/tools/search-tools.js` `test/search-redos-test.js` — 提交 `afe8f47`（"Refocus workspace-bridge on CLI audits"）删除了 `src/tool-registry.js`（MCP 工具注册表），`searchCode` 失去唯一调用方。现删除整个模块及专属测试。`test/security-test.js` 中 `validateQuery` 依赖内联为本地辅助函数，保留 ReDoS 安全概念测试

### 修复（UX — P35 compact tree 目录层级）

- **`audit-map --compact` 的 `tree` 只展示一层目录，用户误以为文件平铺** `src/cli/formatters/project-map.js` `test/audit-map-test.js` — `buildDirectorySkeleton` 的 `maxDepth` 从 2 提升到 3，保留到第 3 层目录（如 `src/views/policyeval`），第 4 层+ 继续折叠为 `fileCount`/`totalFileCount`。实测 GitNexus（1000+ 文件）：total directories 18→47，tree JSON lines 149→386，仍在 compact 可控范围内；`testProjectMapCompactDepthLimit` 同步更新断言以反映新层级行为

### 修复（文档 — P50 Fast/Slow 分类校准）

- **SKILL.md 的 Fast/Slow 分类与实际耗时脱节** `skills/workspace-audit/SKILL.md` — 基于 workspace-bridge（159 文件）实测缓存后耗时重新分类：
  - **Fast** (< 2s): 新增 `workspace-info`, `audit-map`, `stats`, `diagnostics`；移除错误归入的 `audit-overview`, `audit-diff`
  - **Medium** (2-5s): 新增 `audit-diff`（`git log --follow` + 变更分析）, `audit-overview`（`git log` 历史查询 + 热点计算）
  - 新增冷启动说明：首次运行任何命令都有索引构建成本（大项目 5-30s），与具体命令无关
  - 澄清 `diagnostics` 不是 network-bound，执行的是本地 linter（eslint/tsc/pyright/ruff），无网络请求

### 修复（实战基地系统性盲区 — Spring Boot / Vue 循环白名单）

- **Spring Boot 框架模式识别** `src/services/dep-graph/framework-patterns.js` `src/services/dep-graph.js` `src/config/constants.js` — 解决后端 3 个仓库 467 个 dead exports 中高 confidence 条目几乎全部是 Spring Boot 类被误标的问题：
  - `detectFrameworkFromPath` 增加 `*Application.java` 和 `*ServletInitializer.java` 路径检测（`===` → `endsWith` 修复 `XxxServletInitializer` 不匹配）
  - `AST_PATTERNS.java` 增加 `@SpringBootApplication`、 `@Configuration`、 `@ControllerAdvice`、 `@Component`、 `@Service`、 `@Repository`、 `@EnableAutoConfiguration`、 `@Aspect` content 检测
  - `isKnownEntryFile` 复用已有的文件读取代码做 `detectFrameworkFromContent` 检测，消除与 `getFrameworkHint` 的 I/O 重复
  - `ENTRY_SCAN_BYTES: 256 → 4096`，覆盖 import 繁多的大型 Java 文件（实测 `@Service` 在 1547 字节、`@Aspect` 在 1569 字节）
  - `detectFrameworkFromContent` 内部 `content.slice(0, 800)` → `slice(0, 4096)`，消除与 `ENTRY_SCAN_BYTES` 的隐性不一致
  - **实战效果**：zcypg_backend 205→134（-35%），zsgzt_backend 207→112（-46%），合计 412→246（-166 个误报消除）
- **Vue Router/Vuex 循环白名单** `src/services/dep-graph.js` — 新增 `isLikelyFrameworkLegitimateCycle` 方法，过滤掉 Vue 项目中 `store/` ↔ `router/` ↔ `views/`（含 `.vue`）的短循环（长度 ≤ 5）。这些循环是 Vue 正常设计模式（store 引用 router 跳转、router 引用 view 组件、view 引用 store 状态），不应被报告为缺陷
  - **实战效果**：zcypg_frontend 13→3，zsgzt_frontend 19→2
- **Python AST parser Windows 编码故障** `src/services/dep-graph/parsers/spawn-ast.js` — `spawnPythonASTParser` 的 `spawn` 调用新增 `env: { ...process.env, PYTHONIOENCODING: 'utf-8' }`。Windows 上 Python 子进程默认以系统编码（GBK/CP936）读取 stdin，但 Node.js 写入的是 UTF-8，导致包含中文注释/字符串的 `.py` 文件产生 surrogate 解码错误，全部 fallback 到 regex。修复后 gwy_backend 覆盖率 0.21→1.00（347/347 AST），Java parser 同步受益
- **P5: `nextSteps` 模板化、不可执行** `src/utils/stack-detectors/detect.js` `src/cli/formatters/repo-summary.js` `cli.js` — 新增 `detectNodeFramework()` 读取 package.json 的 dependencies/devDependencies，检测 Vue/React/Next/Nuxt/Svelte/Angular。`buildNextSteps` 接入框架级信息，生成差异化可执行建议：
  - Vue: cycle 建议明确提及 store→router→view 是正常设计模式；unresolved 建议指向 vite.config.js alias 和 `.vue` 扩展名
  - Java: hygiene 建议提及 Maven/Gradle wrapper 和 JUnit
  - Python: hygiene 建议区分 Django 和非 Django 的测试配置
  - 所有建议结合具体数据（"3 dependency cycles", "12 dead exports", "4 hygiene gaps"）而非泛泛的 "Break dependency cycles"
  - 实战效果：zcypg_frontend 和 zsgzt_frontend 的 cycle 建议从完全相同的模板变为 Vue 特异性文案
- **P27: SKILL.md Standard Output Contract 与实际 CLI 输出脱节** `skills/workspace-audit/SKILL.md` — 逐命令对比实际 JSON 输出，修正 6 处字段路径错误：
  - `workspace-info`: `scope.totalFiles` → `fileCount`（根级，无 `scope`）; `scope.languages` → `languages`
  - `diagnostics`: `diagnostics.totalIssues` → `diagnosticsSummary.total`; `diagnostics.byFile` → `results[].diagnostics`; 补充 `noLintersDetected` 场景说明
  - `audit-security`: `summary.totalFindings` → `summary.total`
  - `audit-summary`: `scope.mainlineFiles` → `scope.counts.mainlineFiles`; 新增 `analysisCoverage` 读取说明
  - `audit-diff`: `validationAdvice.phases` 补充 "可能为空数组" 说明
  - `audit-overview`: 新增 `stabilityMeta` 和 `analysisCoverage` 读取说明
  - 新增缺失命令的读取说明：`health`（`healthScore`/`checks`/`fixes`/`testCoverage`）、`stats`（`analysisCoverage`）、`dead-exports`/`unresolved`/`cycles`（`confidenceReason`/`possibleFalsePositives`）、`impact`/`dependents`/`dependencies`（`importedSymbolsAvailable`/`symbolImpact`）
  - 新增 `schemaVersion` 契约冻结说明

### 修复（产品体验 — P33/P62 overview recommendations 个性化）

- **P33: 两个前端项目 `audit-overview` recommendations 高度模板化** `src/tools/overview-tools.js` `src/cli/formatters/recommendation-engine.js` — 新建 `recommendation-engine.js`，提取 `buildUnresolvedRecommendation` / `buildCycleRecommendation` / `buildDeadExportRecommendation` 三个纯函数，消除 `repo-summary.js` `buildNextSteps` 与 `overview-tools.js` `buildOverviewSummary` 之间的重复 if-else 链。`audit-overview` 现在接入假阳性率（`possibleFalsePositives`）和框架检测（`stack.node.framework`），为 Vue 项目提示 alias/`.vue` 扩展名问题，为 Java 项目提示 Spring Boot 误报，为 cycle 提示 store→router→view 是正常设计模式
- **P62: 两个前端项目症状高度一致（overview 层面）** `src/tools/overview-tools.js` — 同 P33，`audit-overview` 的 `recommendations` 与 `audit-summary` 的 `nextSteps` 共享同等的个性化水平，两个 Vue 前端项目的输出不再完全相同

### 测试

- `test/framework-patterns-test.js` — 覆盖 Spring Boot 路径检测（Application/ServletInitializer）和 content 检测（SpringBootApplication/Configuration/ControllerAdvice）
- `test/dep-graph-error-test.js` — 覆盖 Spring Boot entry 排除 dead-export 逻辑，以及 Vue store-router-view 循环白名单过滤逻辑
- `test/recommendation-engine-test.js` — 覆盖 `buildUnresolvedRecommendation` / `buildCycleRecommendation` / `buildDeadExportRecommendation` 全部分支：count=0/null、通用文案、Vue alias、非 Vue alias、Vue cycle、通用 cycle、Vue dead-export fp、Java dead-export fp、其他 dead-export fp、fp 低于阈值

### 修复（Schema 一致性 — P57 字段命名统一）

- **P57: 字段命名风格不统一，增加集成成本** `cli.js` `src/tools/dep-tools.js` `src/cli/formatters/*` `src/services/dep-graph/*` `src/config/risk-thresholds.js` `test/*` — 统一各命令顶层计数字段为"数组名 + Count"规范：
  - `dependencyCount` → `dependenciesCount`
  - `dependentCount` → `dependentsCount`
  - `cycleCount` → `cyclesCount`
  - `deadExportCount` → `deadExportsCount`
  - `affectedTestCount` → `affectedTestsCount`
  - `impactCount` / `unresolvedCount` 保持不变（数组名本身为单数/不可数）
- **Schema 升级**：`SCHEMA_VERSION` `'1.1.1'` → `'1.2.0'`，核心字段语义不变，计数字段命名规范化
- **`scripts/self-audit.js`** 修复 `summary.counts` 读取错误（`deadExportCount` → `deadExports`、`unresolvedCount` → `unresolved`、`cycleCount` → `cycles`）

### 文档

- **TECH_DEBT.md** 已修复条目全部压缩为"标题 + 一行 ✅ 已修复 说明"，执行 AGENTS.md 清理铁律；P33/P62/P57 标记已修复
- **SESSION.md** 基线同步为 85/85 PASS；P57 关闭，`schemaVersion` 更新为 `1.2.0`
- **CHANGELOG.md** 追加 [Unreleased] 条目

### 新增（Django 框架模式识别）

- **`framework-patterns.js` 路径检测** `src/services/dep-graph/framework-patterns.js` — 新增 Django 特有路径模式：
  - `management/commands/*.py` → `django-management-command`，`isEntry: true`
  - `views/*.py`（目录形式，非 `__init__.py`）→ `django-views-dir`，`isEntry: true`
  - `views_*.py`（前缀形式，如 `views_coordination.py`）→ `django-views-prefix`，`isEntry: true`
  - `admin.py` → `django-admin`，`isEntry: true`
  - `tasks.py` → `django-tasks`（Celery），`isEntry: true`
- **`AST_PATTERNS.py` 内容检测** `src/services/dep-graph/framework-patterns.js` — 新增 Django/Celery 内容特征：`BaseCommand` / `class Command(`（管理命令）、`admin.site.register`（admin）、`@shared_task` / `@app.task`（Celery）
- **`dep-graph.js` `FRAMEWORK_MANAGED_PATTERNS`** `src/services/dep-graph.js` — 新增 `/management\/commands\/.*\.py$/` 和 `/tasks\.py$/`，确保 `isKnownEntryFile` 第一道防线覆盖
- **实战效果**：`ai_gwy_backend` dead exports 74→54（-20 误报消除），与 Spring Boot 同等水平
- **测试**：`test/framework-patterns-test.js` 新增 Django 路径/内容检测断言；`test/dep-graph-error-test.js` 新增 `testDjangoEntryDetection` 验证管理命令/视图/admin/tasks 不出现在 dead exports 中

### 修复（实战检测闭环 — L1/L2/L3 全命令检验）

- **L1-1: `impact` / `affected-tests` / `dependencies` / `dependents` 对不存在的文件返回 `ok: true`** `cli.js` — `runCommand` 的 4 个文件级命令分支中新增 `fs.existsSync` 前置检查，与 `audit-file` 保持一致。此前不存在的文件落入图查询返回空数组，导致自动化脚本无法区分"文件确实无影响"和"文件不存在"
- **L1-2: `init` 命令失败时退出码为 `0`** `cli.js` — `init` case 中当配置文件已存在时，返回前显式设置 `process.exitCode = 1`。此前 `init` 是 `SELF_MANAGED_COMMANDS`，`__managedLifecycle` 为 true 时绕过了 `main()` 的错误处理路径
- **L1-3: `audit-summary` 的 `analysisCoverage` 与 `--exclude` 不同步** `cli.js` — `audit-summary` 命令中基于 `scope.counts.totalFiles` 重新计算 `filteredAnalysisCoverage`，替代 `stats.analysisCoverage` 的全量统计。此前 `scope.counts.totalFiles = 74`（排除 test+benchmark）但 `analysisCoverage.totalFiles = 161`
- **L1-4: `audit-diff` 变更文件计数不一致** `cli.js` — `changeMetrics` 新增 `untrackedFileCount: changed.changedFiles.length - numstat.files.length`。`changedFiles` 包含 untracked，而 `changeMetrics` 来自 `numstat.files`（仅 tracked），新增字段明确区分两者口径
- **L1-5: `audit-diff` 出现 `undefined authors, undefined commits`** `src/cli/formatters/audit-diff-summary.js` `src/cli/formatters/validation-advice/metrics.js` — `compactChangedFile` 保留 `historyRisk.authorCount` 和 `historyRisk.commitCount`（此前被精简丢弃）；`metrics.js` 的 `buildTurbulenceNotes` 对缺失字段做 `?? 'unknown'` 兜底
- **L2-1: Windows 反斜杠路径在输出中残留** `cli.js` — `parseCliArgs` 中对 `raw.file` 做 `toPosixPath` 标准化。此前 `--file .\src\services\dep-graph.js` 返回 `".\\src\\services\\dep-graph.js"`，下游路径匹配可能失败
- **L2-2: REPL 在非交互环境下无明确错误即退出** `src/cli/repl.js` — `startRepl` 开头检测 `process.stdin.isTTY`，若非 TTY 则输出 `Error: REPL requires an interactive terminal (TTY).` 并设置 `process.exitCode = 1`
- **L2-4: `audit-security` builtin 扫描器对工具自身代码误报** `src/tools/security-tools.js` — 每行匹配后检查 `ignorePattern`（`/\/\/\s*security-scan-ignore\b|\/\*\s*security-scan-ignore\b/`），允许开发者用行尾注释显式抑制已知无害的命中。`security-tools.js` 的 7 条 pattern 定义行均加上 `// security-scan-ignore`
- **L3-3: `audit-file` 的 `--max-depth abc` 被静默忽略** `cli.js` — `parseCliArgs` 的 `--max-depth` transform 中增加 `Number.isNaN(n)` 检测，传入非数字字符串时立即抛出 `Invalid --max-depth value` 错误

### 测试

- `test/init-test.js` — 更新断言：`dup.status` 从 `0` → `1`，验证 `init` 重复运行时退出码正确反映失败状态
- `test/repl-shutdown-test.js` — 测试前临时设置 `process.stdin.isTTY = true`，绕过新增的 TTY 检测以继续验证 REPL shutdown 守卫逻辑

### 文档

- **TECH_DEBT.md** 全命令实战检测报告更新：L1-1~L1-5/L2-1/L2-2/L2-4/L3-3 标记已修复并删除；L1-6 澄清为测试样本选择导致的假阳性（Java 依赖图实际工作正常）；更新命令覆盖矩阵和修复优先级建议

### 修复（路线 A：数据一致性 + 框架边界硬化 — P85/P70/P71/P79/P80/P81/P72/P73）

- **P85: `audit-summary` vs `cycles` 数据不一致（L1）** `src/services/dep-graph.js` — 统一 cycle 计算路径：新增 `_cachedCycles` 缓存过滤后的完整 cycles 数组，`findCircularDependencies()` 优先返回缓存，`getStats()` 直接复用同一数组计算 `cycles.length`。`GraphBuilder` 在 `build()` / `updateFiles()` / `applyFrameworkImplicitImports()` 三处图变更点均重置缓存，彻底消除 `_cycleCount` 延迟计算与图生命周期耦合导致的 stale 数据风险
- **P70: Spring Boot `*Application.java` 在 `audit-summary` 中 `entryFiles` 缺失** `src/utils/project-context.js` — `ROLE_RULES` entry 检测新增 `application.*.java` 和 `*ServletInitializer.java` 路径模式，`inferFileRole()` 现与 `framework-patterns.js` 的 `detectFrameworkFromPath()` 对齐，Spring Boot 入口在 summary 层面不再遗漏
- **P71: Django 配置驱动入口覆盖不全** `src/services/dep-graph.js` `src/services/dep-graph/framework-patterns.js` — 扩展 `FRAMEWORK_MANAGED_PATTERNS` 和 `detectFrameworkFromPath()` / `AST_PATTERNS.py`，新增 middleware（`middleware.py` / `*middleware*.py`）、database router（`database_router.py` / `*router*.py`）、context processors（`context_processors.py`）、templatetags（`templatetags/*.py`）、forms（`forms.py`）、Celery 配置（`celery.py`）六类 Django 配置驱动入口，消除 Django 项目 dead-export 误报
- **P79/P80/P81: Spring/Quartz/MyBatis 组件 dead-export 系统性误报** `src/services/dep-graph/framework-patterns.js` — 新增运行时装配组件的路径 + 内容检测：
  - Spring: `Filter` / `Wrapper` / `Validator` / `Serializer` / `Interceptor` / `Listener`（路径含关键字或内容含 `@Component` / `implements Filter` / `FilterRegistrationBean` 等）
  - Quartz: `/quartz/` 路径 + `org.quartz.Job` / `@DisallowConcurrentExecution` / `extends AbstractQuartzJob` / `JobInvokeUtil`
  - MyBatis: `/typehandler/` 路径 + `implements TypeHandler` / `extends BaseTypeHandler`
  这些组件通过框架容器运行时装配，静态 import 分析无法追踪，现统一标记为 `isEntry: true`，`isKnownEntryFile()` 自动保护
- **P72: Java 常量类死导出系统性误报** `src/services/dep-graph.js` `src/tools/honesty-engine.js` — 新增 `isLikelyConstantsWarehouse()` 识别常量仓库模式（文件名以 `Constants` / `Status` / `Utils` 结尾 + 导出以 field/variable 为主），`findDeadExports()` 对匹配文件降级 confidence 为 `low` 并输出差异化 reason；`honesty-engine.js` 新增 `java-constants-warehouse` 假阳性原因，纳入 `falsePositiveReasons` 统计
- **P73: Java / React 循环依赖无白名单** `src/services/dep-graph.js` — `isLikelyFrameworkLegitimateCycle()` 从仅覆盖 Vue 扩展为三框架公平检测：
  - Vue: `store/` ↔ `router/` ↔ `view/`（保留）
  - React: `context/` ↔ `hooks/` ↔ `components/`（长度 ≤ 4，涉及至少两个维度）
  - Java: `domain/model/entity` ↔ `utils/util/common`（长度 ≤ 3，涉及领域模型和工具类两个维度）

### 重构（P8-0：dep-graph.js God Class 内部分拆）

- **`src/services/dep-graph.js`** — 对外接口 100% 不变，内部拆为三个 collaborator，`DependencyGraph` 退化为 facade：
  - `GraphBuilder` — `build()` / `updateFiles()` / `analyzeFile()` / `buildReverseGraph()` / `applyFrameworkImplicitImports()`
  - `GraphAnalyzer` — `findDeadExports()` / `findCircularDependencies()` / `findUnresolvedImports()` / `findAffectedTests()` / `getStats()` / `getScopeSummary()`
  - `GraphQuery` — `getDependencies()` / `getDependents()` / `getImpactRadius()`
- **P8-1 插槽预留**：`GraphBuilder.onBuildComplete` / `GraphBuilder.onFileUpdated`，供 watch 闭环使用
- **验证**：85/85 测试通过，healthScore=5/5，零外部调用方改动

### 修复（工程健康 — 路线 D：P74/P75/P76/P82）

- **P74: `_scanLocalSymbolUsage` 内存峰值** `src/services/dep-graph.js` — `content.split('\n')` 改为流式扫描（`indexOf('\n')` + `slice` 循环），消除大文件（1MB+）dead-export 分析时的 ~20MB 临时数组。行为与 `file-index.js` v1.1.0 的同类修复一致
- **P75: `framework-usage-patterns.js` 无缓存 I/O** `src/services/dep-graph/framework-usage-patterns.js` `src/services/dep-graph/resolvers.js` — `resolveImplicitImports` 的 `fs.existsSync` 替换为 `cachedExistsSync`（LRU 缓存，上限 2000）。`resolvers.js` 导出 `cachedExistsSync` 供外部复用
- **P76: `watch.js` stdout 拼接无上限** `src/cli/watch.js` `src/config/constants.js` — `executeWatchCommand` 新增 `WATCH_MAX_STDOUT_BYTES = 1MB` 上限，超限截断并标记 `truncated: true`。`commandResult` 事件透传 `truncated` 字段，防止测试框架海量日志导致 OOM
- **P82: Maven 项目 `testFiles: 0`** `src/utils/test-detector.js` — 扩展 `TEST_DETECTION_RULES` 对 Java 测试命名的覆盖：新增 `/.*(?:Test|Tests|IT)\.java$/i` 规则，明确匹配 Maven 常见的 `*Test.java` / `*Tests.java` / `*IT.java` 命名。补测试到 `test/test-detector-test.js`

### 测试（测试覆盖缺口补齐 — 阶段 4）

> 目标：消除 TECH_DEBT.md 中列出的所有"无直接测试"和"可深化"模块缺口。纯新增测试，零生产代码改动。

- **新增 `test/symbol-extractors-test.js`** `src/services/file-index/symbol-extractors.js` — 直接覆盖此前仅被 file-index 集成测试间接覆盖的 6 语言符号提取器：
  - Python（class/function）、JS/TS/JSX/TSX（class/function/constant）、Java（class/interface/enum/method）、Kotlin（class/interface/object/enum/function）、Go（type/function）、Rust（fn/struct）
  - 边界：未知扩展名返回空数组、空内容返回空数组、1-based 行号、trim 后的 signature
  - 测试中发现 `parseKotlin` `enum class` 被匹配为 `class` 的已知边缘行为，已文档化于测试注释
  - 测试数量从 97 → 98

- **新增 `test/spawn-ast-direct-test.js`** `src/services/dep-graph/parsers/spawn-ast.js` — 直接覆盖此前仅被 java-parsers-test / go-ast-parser-test 间接覆盖的 spawn-ast 边界：
  - 脚本不存在 → `null`、成功 JSON 解析、非零 exit → `null`、stdout 截断（10MB+）、stderr 截断（10MB+）、spawn error → `null`、stdin write error → `null`、非法 JSON → `null`
  - 与已有 `spawn-ast-test.js`（SIGKILL fallback）和 `spawn-ast-concurrency-test.js`（信号量限流）互补，形成 spawn-ast 的完整测试矩阵
  - 测试数量从 98 → 99

- **新增 `test/file-index-boundary-test.js`** `src/services/file-index.js` — 深化 file-index 的边界覆盖：
  - `readdir` EACCES 权限拒绝时 graceful skip（不抛异常、继续索引可读目录）
  - `build()` AbortController 超时中断（1ms 超时，验证不抛异常）
  - `indexByPattern()` AbortController 超时中断
  - 与已有 `file-index-race-test.js`（并发安全）、`file-index-exclude-test.js`（排除逻辑）、`file-index-rename-test.js`（重命名处理）互补
  - 测试数量从 99 → 100

- **新增 `test/watch-sigterm-test.js`** `src/cli/watch.js` — 深化 watch 的异常路径和信号处理：
  - `watch` SIGTERM graceful shutdown（验证进程正常退出）
  - `audit-file --watch` SIGINT graceful shutdown
  - `executeWatchCommand` 无受影响测试边界（孤立文件变更时 `validationComplete.passed === true`）
  - 与已有 `watch-test.js`（文件变化/SIGINT/`--run-tests`）和 `watch-format-test.js`（compact 格式）互补
  - 测试数量从 100 → 101

- **新增 `test/repl-edge-test.js`** `src/cli/repl.js` — 深化 repl 的 threshold 边界和输出格式：
  - `top` 命令：dependents 恰好等于 `HOTSPOT_MIN_DEPENDENTS` 时显示 hotspot；低于 threshold 时显示 "No hotspots detected"
  - `issues` 命令：无 structural issues 时 severity=low、nextSteps 提示 "No immediate structural issues detected"
  - `audit-map --compact` 和 `audit-map`（非 compact）输出字段验证
  - 与已有 `repl-test.js`（executeCommand 全分支）和 `repl-shutdown-test.js`（shutdown 守卫）互补
  - 测试数量从 101 → 102

- **新增 `test/cli-mapper-adapter-test.js`** `cli.js` — 深化 cli 的 mapper 异常和 adapter 验证：
  - `audit-diff` safeEntries 结构验证（每个 entry 必须有 `file` string 和 `graphKnown` boolean）
  - 非法 `--max-depth=abc` → exit 1
  - 非法 `--reuse-hints=maybe` → exit 1
  - 非法 `--trend-granularity=hour` → exit 1
  - `impact` / `dependents` / `dependencies` / `affected-tests` 传入不存在的文件 → exit 1 + human 错误提示
  - 与已有 `cli-error-handling-test.js`（缺失文件 human/JSON 错误）、`cli-args-validation-test.js`（参数校验）、`cli-fallback-test.js`（fallback 行为）互补
  - 测试数量从 102 → 103

## [1.1.1] - 2026-05-08

### 修复（低垂果实收尾 — P12/P32/P37/P43/P58）

- **P12: `--exclude` 在 `audit-overview` 中未过滤 hotspots/stability/coupling** `src/tools/overview-tools.js` — `buildProjectOverview` 的 `allFiles` 增加 `shouldExcludeCli` 过滤，确保 CLI `--exclude` 在 overview 全链路生效
- **P32: `staleness.thresholdMs` 无人类可读解释** `src/services/container.js` — `getStaleness` 新增 `thresholdDescription` 字段（如 `"5 minutes"`）
- **P37: `health.checks.*.sizeBytes` 是输出噪音** `src/tools/health-tools.js` — `projectHealth` 输出前删除所有 `sizeBytes` 字段
- **P43: `health.checks.ci` 未递归扫描 `.github/workflows/`** `src/tools/health-tools.js` — `detectCiConfig` 对 GitHub Actions 从检查目录存在升级为检查目录内是否有 `.yml`/`.yaml` 文件
- **P58: `audit-file` 的 `frameworkPattern` 永远为 null** `src/services/dep-graph.js` `src/services/dep-graph/framework-patterns.js` — `getFrameworkHint` 增加 content-based fallback：path-based 返回 null 时扫描文件前 800 字节中的框架特征（NestJS/Express/FastAPI/Flask/Spring/Vue 等）

### 文档

- **ROADMAP.md** 性能瓶颈表同步 5 项已修复；GitNexus 模式 D/A 标记已交付；成功标准 #5 90%→95%
- **AGENTS.md** 项目规模同步（159 文件 / 83 test / 13 script）
- **TECH_DEBT.md** P12/P32/P37/P43/P58 标记已修复
- **SESSION.md** 基线与活跃技术债列表同步

## [1.1.0] - 2026-05-06

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

### 修复（低垂果实收尾 — P12/P32/P37/P43/P58）

- **P12: `--exclude` 在 `audit-overview` 中未过滤 hotspots/stability/coupling** `src/tools/overview-tools.js` — `buildProjectOverview` 的 `allFiles` 增加 `shouldExcludeCli` 过滤，确保 CLI `--exclude` 在 overview 全链路生效
- **P32: `staleness.thresholdMs` 无人类可读解释** `src/services/container.js` — `getStaleness` 新增 `thresholdDescription` 字段（如 `"5 minutes"`）
- **P37: `health.checks.*.sizeBytes` 是输出噪音** `src/tools/health-tools.js` — `projectHealth` 输出前删除所有 `sizeBytes` 字段
- **P43: `health.checks.ci` 未递归扫描 `.github/workflows/`** `src/tools/health-tools.js` — `detectCiConfig` 对 GitHub Actions 从检查目录存在升级为检查目录内是否有 `.yml`/`.yaml` 文件
- **P58: `audit-file` 的 `frameworkPattern` 永远为 null** `src/services/dep-graph.js` `src/services/dep-graph/framework-patterns.js` — `getFrameworkHint` 增加 content-based fallback：path-based 返回 null 时扫描文件前 800 字节中的框架特征（NestJS/Express/FastAPI/Flask/Spring/Vue 等）

### 修复（Vue 生态收尾 + 数据一致性第二轮 — P24/P29/P31/P34/P39/P41/P60 + P1/P63 占位实现）

- **P31: `health.checks.envExample` 只认 `.env.example`，不认 Vue 生态的 `.env.development`** `src/tools/health-tools.js` — `checkHealthFile` 候选数组增加 `.env.development`、`.env.production`
- **P34: `languageSupport` 没有 Vue/Svelte 的统计条目** `src/tools/overview-tools.js` — `EXT_TO_LANG` 增加 `'.vue': 'vue'` 和 `'.svelte': 'svelte'`
- **P1/P63 剩余: Vue 自定义指令 + 动态字符串调用 extractor 占位实现** `src/services/dep-graph/framework-usage-patterns.js` — `vue-custom-directive` 扫描 `Vue.directive('xxx'` / `app.directive('xxx'`，按 `@/directive/xxx` 惯例映射；`dynamic-string-call` 扫描 `window['foo']` 字面量索引和字符串数组 `forEach` 遍历模式，映射为同级目录 `./foo`。假阳性率预期从 ~30% 降至 ~15%
- **P24: `impact` 数组中 source 文件出现在自己的影响列表里** `src/services/dep-graph.js` — `getImpactRadius` 的 `onVisit` 增加 `file === start` 防御过滤，消除循环依赖场景下 source 以 `transitive-dependency` 形式重复出现
- **P29: `impact` direct-import 的 `importedSymbols` 永远为空** `src/services/dep-graph/parsers/js.js` — AST `CallExpression` visitor 提取 `const { foo, bar } = require('./baz')` 的解构字段名填入 `imported`，regex fallback 已有覆盖，补全 AST 路径缺口。`cli.js` 实测 `importedSymbols` 从 `[]` → `['resolveWorkspaceFilePath']`
- **P39: `audit-file` 的 `severity` 反映的是影响范围而非代码质量风险** `src/cli/formatters/file-summary.js` — 输出新增 `severityContext: 'impact-radius'` 和 `severityNote`，明确告知 severity 衡量的是变更影响半径（dependents + affected tests），不是代码缺陷
- **P41: `fileRoles.library` 和 `orphans.modules` 数据矛盾** `src/utils/project-context.js` `src/services/dep-graph.js` `src/tools/overview-tools.js` — `summarizeFiles(files, isImportedFn)` 新增可选参数，当 `fileRole === 'library'` 但 `getDependents` 为空时降级为 `unknown`。`dep-graph.js` 和 `overview-tools.js` 调用方均传入 `getDependents` 回调，确保 library 与 orphan 互斥
- **P60: `missingHygieneChecks` 计数与 `health.fixes` 数组长度不一致** `src/cli/formatters/repo-summary.js` — `missingHygieneChecks` 从 `displayTotal - displayPassed` 改为 `Object.values(health.checks).filter(c => !c.found).length`，与 `fixes` 数组同源同义

### 修复（数据一致性小 bug — P23/P26/P30/P44/P55/P61）

- **P23: `audit-map --compact` 的 `highlightedFiles` 没有去重** `src/cli/formatters/project-map.js` — `toRelativePath()` 在 `root` 带尾部斜杠时对绝对路径返回绝对路径、对相对路径返回相对路径，导致同一文件产生两个 Map key。修复：去掉 `normalizedRoot` 的尾部斜杠，确保所有路径统一为相对格式。
- **P26: `validationAdvice` 建议的命令路径不可用** `src/tools/overview-tools.js` — `buildCycleRefactorSuggestions` 和 `buildCouplingSplitSuggestions` 的 `validation.command` 从 `'node cli.js ...'` 改为 `'workspace-bridge-cli ...'`。
- **P30: `unresolved` 的 `resolvedTo` 在失败时等于原路径** `src/services/dep-graph.js` — `findUnresolvedImports()` 中 unresolved 项的 `resolvedTo` 从 `imp` 改为 `null`。
- **P44: `scope.hasConfig` 命名歧义** `src/utils/project-context.js` `src/services/dep-graph.js` `test/role-detection-test.js` — `hasConfig` 重命名为 `hasWorkspaceBridgeConfig`。
- **P55/P61: `scope.counts` 缺少 `testFiles`** `src/utils/project-context.js` `src/services/dep-graph.js` `test/role-detection-test.js` — `summarizeFiles()` 和 `getScopeSummary()` 的 `counts` 均新增 `testFiles` 字段。

### 修复（建议模板化 + 数据一致性 — P18/P19/P25/P16/P22/P40）

- **P18/P19/P25: `validationAdvice` / `nextSteps` / `recommendations` 模板化，不区分项目实际特征** `src/cli/formatters/audit-diff-summary.js` `src/cli/formatters/validation-advice.js` `src/cli/formatters/repo-summary.js` `src/tools/overview-tools.js` `cli.js` — `getValidationTemplate(changeType, stackProfile, fileExtensions)` 按技术栈覆盖 phases actions 文案（node-first / java-first / python-first / go-first / rust-first / cpp-first）；`buildFileSpecificAdvice` 按扩展名追加专项建议（`.vue` → 检查模板绑定，`.java` → 检查接口契约，`py`/`go`/`rs` 同理）。`buildNextSteps` 接入 `stackProfile`：Java/Python 优先 review dead exports，Node 优先 unresolved，无 cycle 时不输出 break cycles，hygiene 文案按栈差异化。`buildOverviewSummary` recommendations 末尾追加技术栈基线建议（Node → linter+type-check，Java → Maven compile+surefire 等）。实战基地验证：Vue 前端 vs Java 后端 `audit-overview` recommendations 已明显不同。
- **P16: `audit-overview` 的 `entryPoints: []` 与 `audit-summary` 的 `entryFiles` 矛盾** `src/tools/overview-tools.js` — `buildSkeleton` 的 `entryPoints` 改用 `projectContext.summarizeFiles(allFiles).entryFiles`，与 `audit-summary` 的 `entryFiles` 单一事实源对齐。
- **P22: `scope.directoryRoles` 全为 0** `src/tools/overview-tools.js` — `buildProjectOverview` 返回值新增 `directoryRoles: scope.directoryRoles`（`scope = projectContext.summarizeFiles(allFiles)`）。回退兼容无 `summarizeFiles` 方法的 mock。
- **P40: 命令输出 schema 不一致，部分命令缺少 `ok` 字段** `src/tools/workspace-tools.js` — `runDiagnostics` 返回值加 `ok: true`（含 cached 路径）；`workspaceInfo` 返回值加 `ok: true`。

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
