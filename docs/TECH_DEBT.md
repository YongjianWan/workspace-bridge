# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。
> 最后审查：2026-05-08。已修复条目详情见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

全部清零（2026-05-05）。见 [CHANGELOG.md](../CHANGELOG.md)。

---

#### L2-12. `--exclude` 只影响 scope 计数，不影响分析结果 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### L2-19. `stabilityScore` 完全没有区分度 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### L2-20. `symbolImpact` 数据冗余：`symbolToDependents` 与 `functionToDependents` 完全重复 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### L2-25. `audit-map --compact` 的模块级 `edges` 严重遗漏 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### L2-28. `languageSupport.javascript.astFiles < files`，15% 文件 AST fallback 无原因说明 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### L2-29. `parserAvailability.skipped: true` 在后端项目出现，但 `workspace-info` 未暴露此信息 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

## 产品层面缺陷（非代码错误，是产品价值/信任/可用性问题）

> 以下问题从**用户体验和产品价值**角度记录。它们不一定是 crash 或报错，但会直接影响用户对工具的采纳和信任。

---

#### P1. 假阳性淹没真实问题 → 信任崩塌（最严重的产品风险）

两个前端项目合计产生 **117 个 dead exports**（51 + 66）和 **48 个 unresolved imports**（24 × 2），实测**几乎全部是误报**。

**根因分类（按频率）**：

| 根因 | 数量 | 状态 |
|------|------|------|
| Vue `.vue` 扩展名省略 + alias 未解析 | ~45 | ✅ 已修复（resolvers.js 增加 `.vue` + `tsconfig.json` paths 读取） |
| Vue 动态路由懒加载导致 orphan | ~30 | ✅ 已修复（framework-usage-patterns.js: vue-router-lazy） |
| Vue 全局组件注册导致 orphan/dead-export | ~20 | ✅ 已修复（framework-usage-patterns.js: vue-global-component） |
| Vue 自定义指令 / 动态字符串调用 | ~15 | ✅ 已修复（framework-usage-patterns.js: vue-custom-directive / dynamic-string-call）|
| 真实的死代码 | ~7 | — |

**产品影响**：

- 用户第一次使用会花大量时间排查这 117 个"死代码"，最后发现全是 alias 或 `.vue` 扩展名导致的假阳性。
- 直接触发"狼来了"效应：用户对后续所有检测结果（包括真实的循环依赖）都不再信任。
- 产品从"代码质量助手"降级为"噪音生成器"。

---

#### P2. 后端项目"零文件 + low 严重度" = 最危险的虚假安全感 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P3. Severity 自相矛盾 → 用户决策瘫痪 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P4. 健康检查 3/5 统一打分 → 无差异化诊断价值 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P5. `nextSteps` 建议不可执行或指向死胡同 ✅ 已修复

✅ 已修复。`detectNodeFramework()` 新增 Vue/React/Next/Nuxt/Svelte/Angular 检测；`buildNextSteps` 接入 framework 级信息生成差异化建议（Vue cycle 提及 store→router→view 正常模式；Java hygiene 提及 Maven/Gradle + JUnit）。所有建议嵌入具体 counts（"3 cycles" / "12 dead exports"）替代模板文案。详情见 CHANGELOG.md [Unreleased]。

---

#### P6. Language Support Matrix 是虚假广告 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P7. `diagnostics` 返回 `"total": 0` → 虚假安全感 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P8. `audit-security` 不可用但文档列为推荐命令 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P9. `init` 生成空配置 = onboarding 断裂 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P10. `affected-tests` 永远返回 0 = 核心场景失效 ✅ 已修复（主要根因）

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P11. `workspace-info` 预检无价值但文档标为"must run" ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P12. `--exclude` 行为违背用户心智模型 ✅ 已修复

✅ 已修复。`--exclude` 现在同时在 `audit-overview` 的 `allFiles`/`mainlineFiles` 阶段过滤，确保 hotspots、stability、coupling 等分析均不纳入被排除文件。详情见 CHANGELOG.md [Unreleased]。

---

#### P13. `stabilityScore` 无区分度 → 失去"热点识别"价值 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P14. `audit-map --compact` 仍包含完整 issue 列表 → 不够 compact ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P15. `repl` 模式 stderr 污染 + 数据不一致 = 双重不可信 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P16. `audit-overview` 的 `entryPoints: []` 与 `audit-summary` 的 `entryFiles` 矛盾 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P17. `stability` 数组只列 10 个文件，但 `aggregates` 说 moderate 有 30 个 ✅ 已修复

✅ 已修复。`buildStability` 移除 `STABILITY_CANDIDATE_LIMIT` 截断，处理全部主线文件；`buildProjectOverview` 返回 `stabilityMeta`（`totalCount`/`truncated`/`limit`），数据透明。`mainlineFiles` 过滤同步排除 test/docs/style/asset，与 `summarizeFiles` 对齐。

---

#### P18. `architectureAdvice` 建议过于抽象，无法执行 ✅ 已修复（phases 层面）

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P19. `summary.nextSteps` 模板化，没有根据项目实际情况定制 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P20. 命令输出中没有"误报率预估"或"诚实度"标注 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P21. 同一命令内 `file` 字段混用相对路径和绝对路径 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P22. `scope.directoryRoles` 全为 0，目录角色检测完全失效 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P23. `audit-map --compact` 的 `highlightedFiles` 没有去重 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P24. `impact` 数组中 source 文件出现在自己的影响列表里 ⏸ cannot-reproduce

⏸ cannot-reproduce。代码已有 `level === 0 || file === start` guard，当前代码无法复现。如发现复现路径，重新打开。

---

#### P25. `architectureAdvice` 拆分建议过于泛滥且不区分文件类型 ✅ 已修复（耦合建议已收敛）

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P26. `validationAdvice` 建议的命令路径不可用 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P27. skill 文档的 Standard Output Contract 与实际 CLI 输出脱节

SKILL.md 要求 agent 输出包含：

> 1. Scope 2. Top Risks 3. Actions 4. Validation 5. Confidence

实际 CLI 输出：

- `stats` → 只有 `files`/`imports`/`exports`/`cycles`，没有 Top Risks/Actions/Validation/Confidence
- `dependencies` → 只有 `dependencies` 数组，没有上述 contract
- `dependents` → 只有 `dependents` 数组

**产品影响**：

- skill 的 contract 是设计给 agent 消费的，但底层 CLI 根本无法提供这些数据。
- agent 按照 skill 文档去解析输出时，会发现大量字段缺失，被迫编造内容来填充 contract。
- 这意味着 skill 文档的承诺和实际工具能力之间存在结构性 gap。

---

#### P28. `hotspot` 检测维度单一，配置文件被误标为风险 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P29. `impact` direct-import 的 `importedSymbols` 永远为空，symbol 追踪不完整 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P30. `unresolved` 的 `resolvedTo` 语义冻结

⏸ 冻结。`resolvedTo: null` = "该 import 未能解析到磁盘上的文件"。不改 schema，不增加新字段。语义见 CHANGELOG.md [Unreleased]。

---

#### P31. `health.checks.envExample` 只认 `.env.example`，不认 Vue 生态的 `.env.development` ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P32. `staleness` 的 `thresholdMs: 300000` 无解释，用户不知道多久算旧 ✅ 已修复

✅ 已修复。`staleness` 输出新增 `thresholdDescription` 字段（如 `"5 minutes"`），人类可读。详情见 CHANGELOG.md [Unreleased]。

---

#### P33. 两个前端项目输出高度模板化，缺乏项目间差异化

| 维度                 | ai_zcypg_frontend | ai_zsgzt_frontend |
| -------------------- | ----------------- | ----------------- |
| unresolved           | 24                | 24                |
| healthScore          | 3/5               | 3/5               |
| nextSteps            | 4 条相同模板      | 4 条相同模板      |
| missingHygieneChecks | 2                 | 2                 |
| fileRoles.entry      | 11                | 10                |
| fileRoles.library    | 197               | 208               |

**产品影响**：

- 两个项目一个有循环依赖、一个没有；一个 51 dead exports、一个 66；一个 162 orphans、一个 192——这些差异在输出中完全没有体现。
- 产品的 nextSteps、healthScore、hygieneChecks 像是从模板填充的，没有根据项目实际特征做个性化诊断。
- 用户感觉不到工具"看懂了我的项目"，而是觉得"它给每个项目都发了一样的体检报告"。

---

#### P34. `languageSupport` 没有 Vue 的统计条目，注册了 parser 但不暴露 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P35. `audit-map --compact` 的 `tree` 只展示一层目录，用户误以为文件是平铺的 ✅ 已修复

✅ 已修复。`buildDirectorySkeleton` 的 `maxDepth` 从 2 提升到 3，保留到第 3 层目录（如 `src/views/policyeval`），第 4 层+ 继续折叠为 `fileCount`/`totalFileCount`。GitNexus 项目实测：total directories 从 18 → 47，tree JSON lines 从 149 → 386，仍在 compact 可控范围内。详情见 CHANGELOG.md [Unreleased]。

---

#### P36. `fileRoles` 缺少 `docs`、`style`、`asset` 角色，分类体系不完整 ✅ 已修复

✅ 已修复。`ROLE_RULES` 新增 `style`（CSS/SCSS/SASS/Less/Stylus）和 `asset`（图片/字体/媒体/压缩包）规则；`summarizeFiles` 的 `fileRoles` 初始化增加 `docs/style/asset: 0`，消除潜在 `NaN` 风险；`isTrulyMainline` 同步排除 style/asset。

---

#### P37. `health.checks.readme.sizeBytes` 等字段是输出噪音 ✅ 已修复

✅ 已修复。`health.checks.*` 中的 `sizeBytes` 字段已从输出中移除，聚焦真正需要行动的事项。详情见 CHANGELOG.md [Unreleased]。

---

#### P38. `reuseHints: "off"` 永久出现但无解释 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P39. `audit-file` 的 `severity` 反映的是影响范围而非代码质量风险 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P40. 命令输出 schema 不一致，部分命令缺少 `ok` 字段 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P41. `fileRoles.library` 和 `orphans.modules` 数据矛盾 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P42. `deadExports.confidence` 分级逻辑不透明，同类型文件不同 confidence ✅ 已修复

✅ 已修复。`computeDeadExportConfidence()` 按 `importerCount + parseMode + graph reliability` 三维度分级，每个条目输出 `confidenceReason`。详情见 CHANGELOG.md [Unreleased]。

---

#### P43. `health.checks.ci` 未检测到 `.github/workflows` 目录 ⏸ cannot-reproduce

⏸ cannot-reproduce。当前代码已升级为递归扫描 `.yml`/`.yaml` 文件，当前代码无法复现。如发现复现路径，重新打开。

---

#### P44. `scope.hasConfig` 命名歧义，易误解为"项目无配置" ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P46. `file-index.js` 的默认排除目录缺少 `vendor`、`bin`、`obj` 等常见目录 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P47. `scope.counts` 完全没有代码量统计（LOC、SLOC） ✅ 已修复

✅ 已修复。`cache.getStats()` 遍历 `fileMetadata` 累加 `lineCount`；`depGraph.getStats()` 和 `workspaceInfo()` 均新增 `totalLines` 字段。`stats` 与 `workspace-info` 现已包含总行数。

---

#### P48. `deadExports` 对 Vue SFC 组件（`.vue` 文件）的误报 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P49. `unresolved` 的 `resolvedTo` 在 `.vue` 场景下退化为目录路径 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P50. SKILL.md 的 Fast vs Slow 分类与实际耗时脱节 ✅ 已修复

✅ 已修复。基于实测数据重新分类（workspace-bridge 159 文件项目，缓存命中后）：
- **Fast** (< 2s): `workspace-info`, `audit-summary`, `audit-file`, `audit-map`, `stats`, `health`, `dead-exports`, `unresolved`, `cycles`, `impact`, `affected-tests`, `diagnostics`
- **Medium** (2-5s): `audit-diff`（`git log --follow` + 变更分析）, `audit-overview`（`git log` 历史查询 + 热点计算）
- 新增说明：所有命令首次运行都有冷启动索引成本（大项目 5-30s），与具体命令无关；`diagnostics` 不是 network-bound，执行的是本地 linter。详情见 CHANGELOG.md [Unreleased]。

---

#### P51. 工具输出的"零问题"组合形成系统性虚假安全感 ✅ 已修复

✅ 已修复。`audit-summary` / `audit-overview` 新增 `analysisCoverage`（`totalFiles`/`parsedFiles`/`fallbackFiles`/`coverageRatio`）；`coverageRatio < 0.5` 时 `severity` 强制上浮为 `high` 并输出 `coverageWarning`。详情见 CHANGELOG.md [Unreleased]。

---

#### P52. `overview-tools.js` 的 `renderOverviewDashboard` 生成 HTML 但 `enabled: false` ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P53. `audit-overview` 的 `options` 中多个 `null` 字段是输出噪音 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P55. `scope.counts` 缺少 `testFiles`，与 `fileRoles.test` 数据分散 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P56. `deadExports` 中同类型文件 confidence 不一致，黑盒逻辑 ✅ 已修复

✅ 已修复。同 P42，`computeDeadExportConfidence()` 统一分级规则并输出 `confidenceReason`。详情见 CHANGELOG.md [Unreleased]。

---

#### P57. 字段命名风格不统一，增加集成成本

不同命令的计数字段命名不一致：

| 命令               | 计数字段名                                          |
| ------------------ | --------------------------------------------------- |
| `impact`         | `impactCount`                                     |
| `dead-exports`   | `deadExportCount`                                 |
| `unresolved`     | `unresolvedCount`                                 |
| `cycles`         | `cycleCount`                                      |
| `dependents`     | `dependentCount`（不是 `dependentsCount`）      |
| `affected-tests` | `affectedTestCount`（但数组叫 `affectedTests`） |

**产品影响**：

- 自动化脚本和消费方需要为每个命令维护独立的字段映射表。
- 命名风格在 "XxxCount" 和 "XxCount" 之间摇摆（`impactCount` vs `deadExportCount`），缺乏命名规范。
- `dependentCount` 与 `dependents` 数组的复数形式不一致，增加了理解成本。

---

#### P58. `audit-file` 返回 `frameworkPattern: null`，框架检测完全失效 ✅ 已修复

✅ 已修复。`dep-graph.js` 的 `getFrameworkHint` 增加 content-based fallback：当 path-based 检测返回 null 时，扫描文件前 800 字节中的框架特征（NestJS/Express/FastAPI/Flask/Spring/Vue 等），显著减少 `frameworkPattern: null` 的情况。详情见 CHANGELOG.md [Unreleased]。

---

#### P60. `missingHygieneChecks: 2` 但 `health.fixes` 数组有 5 个条目 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P61. `skeleton.testFiles` 只在 `audit-overview` 里有，`audit-summary` 里没有 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P62. 两个前端项目症状高度一致，暴露系统性缺陷而非项目特有问题

| 症状 | ai_zcypg_frontend | ai_zsgzt_frontend | 状态 |
|------|-------------------|-------------------|------|
| unresolved | 24（100% 是 Vue `.vue` 省略） | 24（100% 是 Vue `.vue` 省略） | ✅ 已修复（resolvers.js `.vue` + tsconfig paths） |
| dead exports 模式 | 以 `src/api/*.js`、`src/utils/*.js`、`src/store/modules/*.js` 为主 | 以 `src/api/*.js`、`src/utils/*.js`、`src/store/modules/*.js` 为主 | ✅ 无需修复（`utils/permission.js` 的 `checkPermi`/`checkRole` 经全局 grep 确认无任何调用方，是真实死代码） |
| orphans 模式 | `src/main.js`、`src/app.vue` 等入口被标孤儿 | `src/main.js`、`src/app.vue` 等入口被标孤儿 | ✅ 已修复（framework-usage-patterns: vue-router-lazy / vue-global-component） |
| cycles | 13 | 19 | ✅ 已修复（Vue store-router-view 循环白名单，zcypg 13→3，zsgzt 19→2） |
| health score | 3/5 | 3/5 | ✅ 已改善（4/5） |
| nextSteps | 完全相同的 4 条模板 | 完全相同的 4 条模板 | ✅ 已修复（接入 framework 检测，生成 Vue 特异性可执行建议） |

**产品影响**：

- 两个不同业务（政策评估 vs 招商工作台）、不同文件数（228 vs 218）的项目，在核心缺陷指标上已从"几乎完全一致"改善为"差异明显"。
- 循环依赖从 32 个降至 5 个，unresolved 从 48 个降至 0 个，orphan 入口误报已基本消除。
- 剩余的主要盲区是 **nextSteps 的 overview 层面个性化**（P5 已解决 audit-summary 层面，但 audit-overview 的 recommendations 仍偏模板化）。
- 工具对 Vue/Vite 项目的可用性已显著提升，核心假阳性（unresolved/orphan/cycles）已基本清零，dead exports 中除 `src/api/*.js`（可能被运行时动态调用）外大部分为真实死代码或低 confidence。

---

#### P63. Orphan 检测在 Vue 项目中噪声 >50%，基本不可用

两个 Vue 前端项目分别产生 60/62 个 orphan，其中约 50% 是明显误报。

**典型误报模式**：

| 模式 | 示例 | 解决方式 |
|------|------|----------|
| 动态路由懒加载 | `src/views/*` 页面被 `() => import('@/views/xxx')` 引用 | ✅ 已修复（framework-usage-patterns.js: vue-router-lazy） |
| 全局组件注册 | `src/components/breadcrumb/index.vue` 被 `Vue.component('Breadcrumb', ...)` 注册 | ✅ 已修复（framework-usage-patterns.js: vue-global-component） |
| 动态字符串调用 | `src/utils/generator/*.js` 的函数被 `window[fnName]()` 调用 | ⏳ 占位，需语义分析 |

**产品影响**：

- Orphan 检测的底层逻辑是"没被任何文件 import"，但 Vue 项目的动态路由和全局组件打破了这种假设。
- 该检测在 Vue 项目中基本不可用，产生大量噪声，直接淹没真实问题。
- 与 P1 共同构成 Vue 项目的系统性假阳性三角。

---

#### P64. Health check "按技术栈打分"后，建议命令仍然脱离实际 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

## L3 品味问题（建议修，非债务）

以下问题属于代码风格/长度建议，不影响功能正确性，按价值排序记录：

| 位置                     | 问题                                                              | 说明                                                                                                             |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `validation-advice.js` | ✅ 已拆分                                                         | `buildValidationAdvice` 从 274 行拆为 6 个纯函数，主函数降至 35 行                                             |
| `project-context.js`   | `inferFileRole()` 已降至 12 行                                  | 顶部 `FRAMEWORK_ENTRY_FILES` / `CONFIG_PATTERNS` / `ROLE_RULES` 等常量集合仍分散，可继续提取为独立配置模块 |
| `container.js`         | ✅ 已拆分                                                         | `initialize()` 从 ~85 行拆为 7 个私有方法，主函数降至 25 行                                                    |
| `function-impact.js`   | `getChangedFunctionImpact()` 已降至 83 行                       | 已拆分为 9 个纯函数，内聚性恢复                                                                                  |
| `symbol-impact.js`     | `getSymbolImpact()` 已降至 52 行                                | 已拆分为 11 个纯函数，超阈值问题消除                                                                             |
| `git-tools.js`         | `getChangedFiles()` 手动字符级解析                              | 620 行文件中已知债务，当前不优先                                                                                 |
| `overview-tools.js`    | `renderOverviewDashboard` 中 HTML/CSS 裸数字                    | `padding:14px`、`font-size:26px` 等仍在                                                                      |
| `js.js`                | `parseJavaScriptAST` ~265 行、`parseJavaScript` regex ~147 行 | 函数过长，但 parser 边界稳定，低优先级                                                                           |
| `path.js`              | `hasPathSegment` 语义陷阱：只取 segment 最后一级                | 函数名与实际行为不符                                                                                             |

---

## 文件级雷区地图

| 文件                                        | 行数 | 风险         | 状态                                                      |
| ------------------------------------------- | ---- | ------------ | --------------------------------------------------------- |
| `src/services/dep-graph.js`               | ~704 | **高** | 核心引擎类，AGENTS.md 已确认"内聚优先、不物理拆分"        |
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

| Parser / 模块                   | 测试文件                                | 状态    |
| ------------------------------- | --------------------------------------- | ------- |
| JS AST + functionRecords        | `test/arrow-function-test.js`         | ✅      |
| Java AST + regex fallback       | `test/java-parsers-test.js`           | ✅      |
| JS regex fallback (CJS exports) | `test/js-regex-cjs-test.js`           | ✅ 新增 |
| Python (AST/regex)              | `test/parser-schema-contract-test.js` | ✅      |
| Kotlin / Go / Rust (polyglot)   | `test/parser-schema-contract-test.js` | ✅      |

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
| `watch.js`      | `watch-test.js`         | compact 模式真实输出、SIGINT/SIGTERM 异常隔离            |
| `repl.js`       | `repl-test.js`          | 真实容器初始化、热点 threshold 边界                      |
| `cli.js`        | `functionality-test.js` | mapper 异常、adapter 异常、所有 human 格式化分支         |

### Flaky 根因

| 测试文件                                             | 根因                                                    | 建议修复                                           |
| ---------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `watch-test.js`                                    | 固定 `delay(2500)` 假设 + fs.watch 平台时序差异       | 轮询检查预期输出，而非固定 delay；使用独立临时目录 |
| `functionality-test.js`                            | 修改 repo root 的 tracked 文件（README.md）+ 无原子恢复 | 用 `fs.copyFileSync` 在副本上操作                |
| `java-parsers-test.js` / `go-ast-parser-test.js` | 外部进程 `timeout: 5000` 冷启动可能超时               | 提升至 15000ms 或根据 `CI` 环境变量动态调整      |
