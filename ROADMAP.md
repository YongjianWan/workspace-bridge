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
| 大项目冷启动超时 | ⏳ 观察 | ~~395 文件实测 59s~~ 实测 239 文件 2s / 542 文件 7s（环境差异），但 7s 对 CI 仍不够友好 | 预热工作流 + 评估 `--cache-dir` + 大项目默认 `--compact` |
| 默认输出对 AI 不友好 | ⏳ 评估 | human-readable 默认输出迫使 AI 每次手动加 `--format markdown --quiet`。**根因是 CLI 把策展工作外包给 AI**：`--format ai` broken → AI 被迫筛 235 行 raw JSON；`commands: []` → AI 拿不到闭环指令；文档被迫写 ~264 行补偿指南 | 修 CLI 出口质量（`--format ai` / `commands` / `affected-tests` / exit code），届时 skill 可缩至 50 行 |
| ~~工作目录污染~~ | ✅ **已修复** | ~~`.workspace-bridge-cache.json` / `.bak` dump 到项目根目录~~ | 缓存迁移至 SQLite，`os.tmpdir()` 默认路径 + `--cache-dir` 参数 |
| ~~Java 常量仓库假阳性~~ | ✅ **已修复** | ~~已识别 `java-constants-warehouse` 但仍出现在 dead-exports~~ | `findDeadExports` 直接过滤，不再保留 |
| ~~Vue 脚手架残留假阳性~~ | ✅ **已修复** | ~~已识别 `scaffold-vue-admin` 但仍出现在 dead-exports~~ | `findDeadExports` 直接过滤 |
| ~~audit-overview 数据冗余~~ | ✅ **已修复** | ~~recommendations/nextSteps 完全重复~~ | 删除 `nextSteps` 别名，`couplingSplitSuggestions` 截断为 3 条 |
| ~~audit-security message 太泛~~ | ✅ **已修复** | ~~正则命中但不输出具体内容~~ | 命中规则附加 `matchedText` 字段（截断至 120 字符） |
| ~~`--quiet` 丢失关键诊断信息~~ | ✅ **已修复** | ~~regex fallback 信息被 suppress~~ | `warnings[]` 注入所有 JSON 输出，不再走 stderr |
| ~~cache 失效策略粗糙~~ | ✅ **已修复** | ~~只检查 git HEAD，dirty worktree 文件变化不触发失效~~ | `cache.js` 新增 `checkFileChanges()` 对比 `mtime`/`size`，`getStaleness()` 返回 `filesChanged`/`changedFiles` |
| ~~`--check-regression` 基线对比崩溃~~ | ✅ **已修复** | ~~`audit-summary --save` 成功，但 `--check-regression` JS 报错~~ | `loadBaseline()` 防御式解析 + `compareFindings()` 空值检查 |
| Java `dead-exports` 大图崩溃 | 🔴 **高优先级** | 542 文件 Java 项目跑 `dead-exports` 返回 exit code 49，零输出 | **部分修复**：`GraphBuilder.analyzeFile()` 已加 try-catch 防止 crash batch，但 exit code 49 根因是 Windows Store Python + Git Bash 管道大数据崩溃，环境问题未根治 |
| diagnostics linter 检测矛盾 | 🔴 **高优先级** | `workspace-info` 显示 eslint 可用，但 `diagnostics` 返回 `noLintersDetected: true` | **部分修复**：`detectNodeLinters` 已统一供 `workspaceInfo` 和 `buildChecks` 共用；残留：`diagnostics` 缓存命中路径不携带 `noLintersDetected`，`buildChecks` 中该字段仅在 `mode === 'quick'` 设置 |
| ~~impact 入口扩散无截断~~ | ✅ **已修复** | ~~level 扩散到 main.js/app.vue 等入口，信息量为零~~ | `getImpactRadius` 遇到 `isKnownEntryFile` 停止扩散 |
| ~~diagnostics ESLint 盲区~~ | ✅ **已修复** | ~~Vue 项目 100% 有 ESLint 配置但 `noLintersDetected: true`~~ | `buildChecks` 增加 `.eslintrc`（无扩展名）和 `package.json#eslintConfig` 检测 |
| ~~exit code 语义反模式~~ | ✅ **已修复** | ~~`audit-summary` severity=high/medium 时 exit=1~~ | 增加 `--fail-on-findings` 显式开关，默认 findings 不触发 exit=1 |
| `--compact` 阈值无 rationale | ⏳ 待评估 | 500 文件拍脑袋定，239 文件 compact 已输出 29KB | 按输出 token 数动态决定，或 `--budget-tokens` |
| 跨仓库静态分析 | ⏳ 评估中 | 前后端 API 契约纯文本匹配可做（`@RequestMapping` vs `axios.get`），但 CLI 只能单 `--cwd` | 评估多 `--cwd` 或 `--cross-repo` 低复杂度方案 |
| npx 版本未锁定 | ⏳ 待评估 | 可能自动升级到不兼容版本，schema 变更后 AI 解析崩 | skill 强制 `npx workspace-bridge-cli@1.2.0` |
| 命令分层混乱 | ⏳ 待评估 | L4 原始查询（`dead-exports`/`cycles`/`unresolved`/`dependencies`/`dependents`/`stats`/`tree`）被 L1 aggregate 完全覆盖，但作为一等公民暴露；`health` 与 `audit-summary.health` 重合；AI 不知道该用 aggregate 还是 raw | `--help` 按 L1/L2/L3/L4 分组输出；`health` 改为 `audit-summary --health-only` 别名 + deprecation；SKILL.md 按层级重写命令表 |
| `repl` 非交互环境不可用 | ⏳ 待评估 | 需要 TTY，AI agent / CI / GitHub Actions 完全无法使用 | 评估 `--eval <command>` 非交互模式，或从 skill 降级推荐 |
| ~~`affected-tests` 关联能力弱~~ | ✅ **已修复** | ~~15 个 test files 项目返回 0 个 affected tests~~ | `test-detector.js` 扩展 `HEURISTIC_ROOT_SEGMENTS`（`__tests__`/`cypress`/`e2e`）+ `TEST_DETECTION_RULES`（`.cy.`/`.e2e.`/`spec.rb`）+ `normalizeHeuristicName`（`UnitTest`/`IntegrationTest` 等），覆盖率大幅提升 |
| ~~`validationAdvice.commands` 为空~~ | ✅ **已修复** | ~~Purpose 承诺"concrete commands"，但实测 `audit-file` `suggestedCommand: null`~~ | `buildFileValidationAdvice` 与 `buildValidationAdvice` 均生成 `suggestedCommand`（复用 `pickSuggestedCommand`），实测非空 |
| `init` 生成空配置 | ⏳ 待评估 | `.workspace-bridge.json` 目录列表全空，schema 存在但无默认值/无引导 | 预填 `entryPoints`/`libraryDirs` 启发式猜测，或改为交互式向导 |
| ~~`--exclude` 未完全过滤 cycle~~ | ✅ **已修复** | ~~排除 `src/views` 后 cycle 仍包含被排除文件~~ | `findCircularDependencies` DFS 入口追加 `shouldExcludeCli` 检查 |
| ~~`watch` 误报缓存文件变更~~ | ✅ **已修复** | ~~检测到 `.workspace-bridge-cache.json.tmp-*` / `.bak` 变更~~ | `file-index.js#shouldExclude` 增加 `.bak`/`.tmp-*` 缓存文件排除 |
| ~~`--cwd` 不存在目录时挂起~~ | ✅ **已修复** | ~~5 秒内无响应，无限期挂起~~ | CLI 入口增加 `fs.existsSync(cwd)` 前置检查 |
| ~~compact 模式比 full 慢 4x~~ | ✅ **已修复** | ~~542 文件 compact 26s vs full 6s，聚合计算 overhead~~ | `buildProjectMap` compact 路径直接聚合到模块级别，跳过文件级 edgeMap + rawEdges 实例化 + re-export 处理 |
| ~~`commands` + `suggestedCommand` 全空~~ | ✅ **已修复** | ~~`phases` 有文案但 `commands` 永远为空~~ | `generateCommands` fallback 确保 commands 非空；`buildFileValidationAdvice` 与 `buildValidationAdvice` 均生成 `suggestedCommand`。 |
| ~~`--exclude` 后 `parsedFiles` 不更新~~ | ✅ **已修复** | ~~totalFiles=98 但 parsedFiles=238~~ | exclude 生效时 `totalFiles`/`parsedFiles` 同步过滤 |
| ~~路径格式混用~~ | ✅ **已修复** | ~~workspaceRoot Windows 原生 vs resolvedPath 小写正斜杠~~ | `file-index` 传递原始路径列表给 `dep-graph`；`cache` 持久化 `originalPath`；`build()` cache-hit 路径用 `meta.originalPath` 覆盖。`workspaceRoot` 与 `resolvedPath` 格式现已一致 |

> 近期已修复的限制见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]：`--builtin-only`、`--since <commit>`、TTL 24h、git-aware staleness、`--format jsonl`、SKILL 文档体系重构。
>
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

## 下一步方向：AI 脚手架形态升级

> 路线 A–J 全部完成。基于 ai_zcypg_frontend 实测审计 + 6 仓库误报率统计，核心认知升级：
> 
> **workspace-bridge 不是"带 JSON 输出的人类审计工具"，而是"为 AI 设计的代码感知接口"。**
> 
> 当前 CLI 有脚手架的"材料"（symbol-level impact、cycle breakCandidate、honesty engine），但没有脚手架的"形态"（统一入口、Token 预算感知、渐进式发现、去噪输出）。
>
> 升级原则：砍掉给人类看的分类/模板文案/重复字段，让 AI 直接消费策展后的结论。

### 阶段 1：误报清零（**已完成**）→ 升级为"去噪工程"

原阶段 1 只清零了框架循环误报。在"AI 脚手架"定位下，"去噪"范围扩展：
- 常量仓库和脚手架文件默认过滤（不是降级）
- audit-overview 去重（recommendations/nextSteps 合并）
- architectureAdvice 默认抑制
- coupling 建议文案去重

与开发原则第 2 条一致。实战基地 6 仓库审计直接暴露的 3 项活跃债务 + 1 项安全规则缺口。

| 目标 | 改动文件 | 预期收益 | 工作量 |
|------|---------|---------|--------|
| **L2-6**：Vue Admin `settings.js ↔ dynamictitle.js` cycle 白名单 | `dep-graph.js` `isLikelyFrameworkLegitimateCycle` | 两个前端 cycle 误报消除 | ~10 行 |
| **L2-7**：stability 新文件全 fragile | `overview-tools.js` `calculateStabilityScore` + `constants.js` | 新文件从"fragile"变为中性/"new" | ~20 行 |
| **L3-3**：architectureAdvice 单体项目抑制 | `overview-tools.js` `generateCouplingSplitPlan` | 单体项目不再收到"按子域拆分" | ~30 行 |
| **security-tools.js 规则扩展** | `security-tools.js` | 新增：文件上传路径遍历、配置密钥硬编码、日志 token 打印 | ~30 行 |

**状态**：2026-05-14 全部完成，103/103 测试通过。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

### 阶段 2：AI 预消化输出（短期，1 周内）

原阶段 2 是"把已有能力暴露正确"。在"AI 脚手架"定位下，升级为"CLI 直接输出 AI 可消费的策展结论"：
- **`--format ai`**：统一入口，预组装 severity + top risks + actions + confidence
- **`--token-budget <n>`**：AI 上下文感知，自动裁剪保留高优先级内容
- **`--depth surface|detail|full`**：渐进式发现，Layer 1 只给 counts + top 3 risks

当前 compact 模式是**结构降维**（文件→目录、边→模块），不是**语义策展**。AI 消费的是策展后的结论，不是压缩后的结构。同时产品评估发现已有能力（19 条内置安全规则、git diff commit range）因无 CLI 入口而被用户误以为不存在。

**不是新增子系统，是把已有的能力暴露正确。**

| # | 目标 | 改动文件 | 预期收益 | 工作量 |
|---|------|---------|---------|--------|
| 1 | **`audit-security --builtin-only`** | `security-tools.js` + `cli.js` + `parse-args.js` | 19 条零依赖规则可独立运行，< 2s，解决"安全扫描形同虚设" | ~10 行 |
| 2 | **`--format summary` 纯模板摘要** | `human-formatters.js` 新增分支 | 1000 文件项目从 ~400 行 JSON → 20 行关键结论 | ~50 行 |
| 3 | **`audit-diff --since <commit>`** | `git-tools.js` `getChangedFiles` + `cli.js` | PR diff 审查只输出变更相关结果，消除全库噪音 | ~40 行 |
| — | hotspot `reason` 组合展示 | `overview-tools.js` `buildHotspots` | 高耦合新文件显示"高耦合 + 无历史"而非仅"无历史" | ~15 行 |

**决策逻辑**：纯 formatter / 参数层改动，不动 graph/parser/cache。三项均不引入 LLM 调用、网络依赖或外部工具，保持 CLI 轻量本地属性。

---

### 阶段 3：AI 脚手架形态完成（中期，2-4 周）

- ~~`audit-ai` 统一入口~~ → **重新评估**：不是"合并到 1 个命令"，是"`--help` 和 SKILL.md 按 L1/L2/L3/L4 分层暴露"。`audit-summary`/`audit-diff`/`audit-file`/`audit-overview` 作为 L1 策展入口保持独立；`dead-exports`/`cycles`/`unresolved` 等 L4 命令对人类调试有价值，不应删除，只需降级为 debug 层级。
- **Token 预算感知**：所有命令支持 `--token-budget`，超限自动 compact + 截断低价值字段
- **渐进式发现**：`--depth surface`（severity + counts）→ `--depth detail`（file-level + symbol-level）→ `--depth full`（完整图）
- **Skill 精简为 50 行驾驶手册**：删除命令分类表、参数说明、Known Limitations，只保留"什么时候用/什么时候不用/标准工作流"

静态分析的硬边界（Vue 模板编译时、Spring DI 运行时、MyBatis XML 绑定）无法突破，但在边界内仍可深化。

| 目标 | 改动文件 | 预期收益 | 边界 |
|------|---------|---------|------|
| **Vue `<script setup>` 编译器宏识别** | `js.js` / `framework-patterns.js` | `defineProps`/`defineEmits`/`defineExpose` 导出不标记 dead-export | 只能识别宏定义，不能追踪模板使用 |
| **Spring 更多运行时注解** | `framework-patterns.js` `AST_PATTERNS.java` | 覆盖 `@RestController`/`@FeignClient`/`@Scheduled` | 只标记 framework-managed，不追踪反射调用 |
| **Django 更多配置驱动入口** | `framework-patterns.js` | middleware、router、context processors 等 | 同现有模式 |

**决策逻辑**：投入可控（每种框架加几行 pattern），收益明确（减少误报）。不碰 call graph / 数据流。

---

### 阶段 4：长期（观察中）

- **跨仓库 API 契约检查**：frontend `axios.get('/api/policy/xxx')` vs backend `@GetMapping('/api/policy/xxx')`，纯静态文本匹配，评估低复杂度实现方案
- **增量脚手架**：`watch --on-change "audit-file --file {changedFile}"`，AI 启动后持续监听，文件保存自动推送 impact

---

### 当前不做（与核心原则冲突）

| 需求 | 当前不做理由 | 如果硬做会怎样 |
|------|---------|--------------|
| **污点追踪 / 跨文件数据流** | 需要新增 call graph 子系统。即使做了，Spring DI / Vue 模板 / MyBatis XML 等运行时绑定问题仍解不了 | 投入 ~1 个月，对实战基地几乎无收益 |
| **接入 SpotBugs/PMD** | 需要 JVM 环境。外部工具策略已明确"可选适配器，不做核心依赖" | 破坏轻量 CLI 定位 |
| **MCP Server / daemon 模式** | 开发原则第 1 条：CLI-only。daemon = 常驻进程 = 协议层维护成本 | 与 CLI-only 方向直接冲突 |
| **修复代码自动生成（`--suggest`）** | 这是 AI 语义理解的能力圈，不是结构分析的产出。给出具体重构建议需要理解代码语义 | 需要内置 LLM 调用，与轻量本地属性冲突 |
| ~~**命令合并（audit-summary + audit-overview）**~~ | ~~违反 L1-1~~ | ~~已重新评估：不是"合并命令"，是"分层暴露"。`audit-summary` 与 `audit-overview` 职责不同（健康度 vs 全景），保持独立；L4 原始查询命令保留但降级为 debug 层级~~ |
| ~~**智能 compact（自动启用）**~~ | ~~保守判断原则~~ | ~~用户明确：加 `--no-compact` 覆盖即可，已重新评估为**接受**~~ |
| **`rules --config` 重规则引擎** | 将 `security-tools.js` 硬编码规则提取为外部 YAML/JSON 属于"规则引擎层次 A"，但完整的 `rules --list/run/config` CLI 是重规则引擎产品 | 与"轻量 CLI"定位冲突。层次 A 可在不新增命令的前提下实现（如 `--config <file>` 覆盖内置规则集） |
| **AGENTS.md 语义联动** | AGENTS 红线多为语义规则，需要数据流分析才能判断来源是否安全 | 与"结构分析 ≠ 语义分析"原则冲突 |
| **`--cross-repo` 跨仓库关联** | 需要解析前后端接口契约（OpenAPI/REST）并对比字段变更 | 属于跨项目语义关联，需要接口契约解析子系统，投入 ~1 个月 |
| **`--field` 数据库字段级追踪** | 需要数据库 schema 解析 + 跨语言字段引用追踪 | 属于数据流分析，与"结构分析 ≠ 语义分析"原则冲突 |
| **`--method` 方法级追踪** | 需要完整的 call graph 子系统（caller/callee 解析 + 重载消解 + 继承链追踪） | 属于符号级调用解析，工作量大但收益高。可在持久化图存储阶段评估 |
| **`--workers 4` 多线程** | Node.js 单线程，worker_threads 引入共享内存/消息传递复杂度 | 当前 `Promise.all` + 信号量限流已满足需求，多线程收益有限 |
| **已知缺口自动追踪** | 需要理解 AGENTS.md 自然语言语义并映射到代码位置 | 属于 NLP + 语义分析，与"结构分析 ≠ 语义分析"原则冲突 |

---

### L3 品味问题（8 项活跃）

按 [TECH_DEBT.md](./docs/TECH_DEBT.md) 记录：

| 位置 | 问题 | 优先级 |
|------|------|--------|
| `git-tools.js` | `getChangedFiles()` 手动字符级解析 | 低 |
| `overview-tools.js` | `renderOverviewDashboard` 中 HTML/CSS 裸数字 | 低 |
| `js.js` | `parseJavaScriptAST` ~476 行、`parseJavaScript` regex ~41 行 | 低 |
| `path.js` | `hasPathSegment` 语义陷阱：只取 segment 最后一级 | 低 |
| `workspace-tools.js` / `SKILL.md` | `parserAvailability.skipped: true` 命名语义陷阱 | 低 |
| `cli.js` / `formatters` | `--json` 嵌套深、体积大，`--compact` 后仍有 400 行，管道场景不友好；默认 human-readable 输出缺乏实战打磨 | 中 |
| `cli.js` / `constants.js` | `--compact` 500 文件阈值无 rationale，拍脑袋定 | 中 |
| `SKILL.md` / `package.json` | npx 版本未锁定，可能自动升级到不兼容版本 | 中 |

---

### 性能瓶颈（大项目 >10k 文件，未修复项）

| 级别 | 位置 | 问题 | 量化影响 | 建议修复 |
|:---|:---|:---|:---|:---|
| P1 | `dep-graph.js:127-128` | `graph` + `reverseGraph` 双边冗余 | 100k 条边 → **16–24MB** 纯冗余 | 评估是否可改为单图 + 按需反向遍历 |
| P1 | `cache.js:112,157` | 缓存加载/保存双重内存峰值 | 50MB 缓存文件 → 峰值 **100MB+** | 接受现状（工程量大收益小），或评估 streaming JSON parser |
| ~~P2~~ | ~~`project-map.js:226-320`~~ | ~~edges Map 内存爆炸~~ | ~~100k edges → **30–50MB**~~ | ✅ **已修复**：compact 路径直接聚合到模块级别，跳过文件级 edgeMap + rawEdges 实例化 + re-export 处理 |
| ~~P2~~ | ~~`cache.js`~~ | ~~无增量写，每次 `save()` 全量序列化~~ | ~~改动 1 个文件也写 50MB~~ | ✅ **已修复**：SQLite 迁移完成，upsert 增量写入，文件大小小 610 倍 |

> 已修复项（P74 流式扫描 / P75 缓存 I/O / Python 子进程限流 / git log 限流）见 [CHANGELOG.md](./CHANGELOG.md)。

---

### 用户体验缺口

| 维度 | 问题 | 当前表现 | 理想表现 |
|------|------|----------|----------|
| 配置 | ⏳ 待评估 | `.workspace-bridge.json` schema 校验可更严格 | 未知字段/类型错误警告（非阻塞） |
| 进度 | ⏳ 待评估 | 超大仓库（>10k 文件）索引进度粒度不足 | 按百分比或按模块打印进度 |
| 安全扫描入口 | ✅ 已完成 | 19 条内置规则无独立入口 | `--builtin-only` 显式入口 + Help 文案修正 |
| 增量分析范围 | ✅ 已完成 | 只能分析 working tree vs HEAD | `--since HEAD~N` + `--staged` + `--files` |
| 输出策展 | ✅ 已完成 | `--compact` 是结构降维，AI 仍需解析 400 行 JSON | `--format summary` / `--format markdown` / `--format jsonl` |
| 缓存/图持久化 | ✅ 已完成 | TTL 5 分钟 / git pull 后重新解析 / 内存 Map 无法跨会话 | TTL 24h + git-aware HEAD staleness |
| JSON 消费困难 | ✅ 已完成 | `--json` 嵌套深、体积大、管道不友好 | `--format jsonl` 一行一条记录，流式消费 |
| human-readable 输出 | ✅ 已完成 | skill 一直要求 `--json`，human 分支缺乏实战打磨 | SKILL.md 定义 AI 默认 `--format markdown`，human 分支保持现状 |
| AI 协作设计 | ✅ 已完成 | SKILL.md 过厚（395 行），命令分层混乱，上下文消耗大 | SKILL.md 精简为 ~180 行 AI 决策树 + 新建 SKILL-REFERENCE.md + SECURITY-CHECKLIST.md |
| 多仓库批量审计 | ✅ 已完成 | 只能分析单个 `--cwd` | `scripts/multi-repo-audit.js` 聚合脚本 + skill 层 shell 循环模板 |

---

## 长期方向（非承诺，见路线 I-2 深度评估）

| 方向 | 价值 | 成本 | 判断 | 触发条件 |
|------|------|------|------|----------|
| 符号级调用解析（Call-Resolution DAG） | 高 | 很高 | **当前不做** | 需要新增 call graph 子系统；即使做了，Spring DI / Vue 模板 / MyBatis XML 等运行时绑定问题仍解不了 |
| 字段读写追踪（ACCESSES 边） | 高 | 高 | **当前不做** | 同污点追踪，需要跨文件数据流分析，与"结构分析 ≠ 语义分析"原则冲突 |
| CI Schema Parity 测试 | 中 | 低 | 观察 | 下一次 schema 变更前 |
| **规则引擎层次 A（配置化）** | 中 | 低 | **接受** | 将 `security-tools.js` 硬编码规则提取为外部 YAML/JSON，无需数据库。通过 `--config <file>` 参数接入，不新增 `rules` 子命令 |
| **规则引擎层次 B（AST 轻量规则）** | 中高 | 中 | **接受** | 基于现有 `functionRecords` 做方法级条件检查（如"batch* 方法无 @Transactional"），不跨文件 |
| **AI 预消化输出（`--format ai`）** | 高 | 低 | **接受** | CLI 直接输出"Top 3 Risks + Actions + Confidence"预消化报告，skill 从 180 行缩至 50 行。当前 skill 过厚是因为 CLI 不预消化，skill 被迫补偿 |
| **AI 摘要输出（纯模板）** | 高 | 低 | ✅ **已完成** | `--format summary` / `--format markdown` 用模板将 JSON 策展为 20 行关键结论或 Markdown 审查意见，不引入 LLM 调用 |
| **增量分析扩展** | 高 | 低 | ✅ **已完成** | `--since <commit>` commit range、`--staged` 暂存区、`--files a,b,c` 指定文件列表、`--with-impact` 变更+依赖方自动展开 |
| **持久化图存储（SQLite）** | 高 | 中 | **P2 启动，POC 通过** | POC 三阶段全部完成：
- 小图（239 nodes）：findDeadExports **1ms**、recursive CTE impact **0ms**、增量 update **1ms**、文件大小小 18 倍 ✅
- 大图（5000 nodes / 17580 edges）：findDeadExports **4ms**、impact d=5 **1ms**、random 100× **5ms**、batch update **10ms**、文件大小小 610 倍 ✅
- **cycle detection**：naive recursive CTE **45,601ms** ❌；内存 DFS **37ms** ✅ → **cycle 保留内存算法，SQLite 负责持久化 + deadExports + impact + 增量更新**
- 方案：`better-sqlite3`（~10MB，零服务器），3 张表 `nodes` + `edges` + `file_metadata`。下一步：核心引擎迁移
| **分层输出过滤** | 中 | 低 | ✅ **已完成** | `--severity P0/P1` 按严重程度过滤、`--category security/performance` 按类别过滤（需规则打标签） |
| **审查追踪（轻量）** | 中 | 低 | ✅ **已完成** | `--save <file>` 保存审计结果、`--check-regression` 对比上次审计检查 P0/P1 是否修复、`--baseline <commit>` 按变更文件标注问题为 `new`/`legacy` |
| **JSON Lines 输出** | 高 | 低 | **接受** | `--format jsonl` 一行一条记录（finding/changedFile/edge），解决 `--json` 嵌套过深、体积大、管道不友好问题 |
| **默认输出模式校准** | 中 | 低 | **接受** | 默认输出改为 `--format markdown`（AI 场景为主）或 `--format summary`。加 `--format human` 显式恢复人工输出。用户明确：当前仅单用户，重构优先于兼容 |
| **命令分层暴露** | 高 | 低 | **接受** | `--help` 按 L1 策展入口 / L2 专项工具 / L3 环境诊断 / L4 原始查询 四层分组输出；`health` 改为 `audit-summary --health-only` 别名 + deprecation；SKILL.md 按层级重写。不删除任何命令，只改暴露方式 |
| **大项目自动截断/自适应** | 中 | 低 | **接受** | 500+ 文件自动启用 `--compact`，或自动抑制低价值字段（architectureAdvice 等）。加 `--no-compact` 显式覆盖 |
| **噪音抑制增强** | 中 | 低 | **接受** | `.workspace-bridge.json` 扩展 `ignore` 配置（框架感知排除）、`--mark-false-positive <id>` 记录误报（轻量，不引入机器学习） |
| **`--cache-dir` 参数** | 高 | 低 | **接受** | 让缓存持久化到指定目录，避免每次新 session 重建索引。解决 395 文件冷启动 59s 的最直接手段 |
| **大项目截断（手动）** | 低 | 低 | **接受** | `--max-files <n>` 只分析前 N 个变更/影响最大的文件，控制输出体积 |

> 路线 I-2 GitNexus 深度对比的 9 项发现中，数值 confidence / yieldToEventLoop / confidenceSource 标签 / git-aware staleness / import 策略链抽象 5 项已吸收并完成。详见 [CHANGELOG.md](./CHANGELOG.md)。
>
> **2026-05-14 评估更新**：阶段 1 误报清零完成。污点追踪 / 数据流分析 / 图数据库 三个方向**当前不做**（非永久拒绝）。`rules --config` 重规则引擎和 AGENTS.md 语义联动当前不做。规则引擎层次 A/B 和 AI 摘要输出在轻量边界内接受。详见 [SESSION.md](./SESSION.md)。
