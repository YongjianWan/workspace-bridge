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

#### P5. `nextSteps` 建议不可执行或指向死胡同

`audit-summary` 建议：

> "Inspect unresolved imports first; they can indicate broken code paths..."

**产品影响**：

- 24 个 unresolved 全部是 Vue `.vue` 省略导致的误报，按建议去 inspect 等于做无用功。
- 产品输出的"行动建议"如果 90% 是错的，用户会怀疑整个工具的智能程度。
- AI 代理（如 Kimi Code CLI）如果直接执行这些 nextSteps，会产生大量无效操作。

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

#### P17. `stability` 数组只列 10 个文件，但 `aggregates` 说 moderate 有 30 个

`audit-overview` 的 `stability` 数组只展示了 10 个文件，而 `aggregates.stabilityCounts.moderate: 30`。剩下 20 个 moderate 文件是什么？用户无从得知。

**产品影响**：

- 产品承诺"识别脆弱模块"，但只展示了 1/3 的数据。
- 用户无法判断"没展示的那 20 个文件是不是更危险"。
- 数据不透明直接削弱了产品的可信度。

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

#### P24. `impact` 数组中 source 文件出现在自己的影响列表里 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

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

#### P30. `unresolved` 的 `resolvedTo` 在失败时等于原路径，字段无意义 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

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

#### P35. `audit-map --compact` 的 `tree` 只展示一层目录，用户误以为文件是平铺的

`src/views` 目录下明明有 `policyeval/`、`system/`、`tool/`、`monitor/` 等大量子目录，但 `tree` 输出中 `src/views` 的 `children` 是空的，`fileCount: 94` 直接挂在 `src/views` 节点上。

**产品影响**：

- 用户看到 `src/views: 94 files`，但没有子目录信息，会误以为这 94 个文件是平铺在 `src/views` 根目录下的。
- compact 模式为了压缩输出牺牲了目录结构信息，但压缩得过于粗暴，失去了"项目长什么样"的基本上下文。
- 产品输出从"目录树"降级为"扁平计数"，可用性大幅下降。

---

#### P36. `fileRoles` 缺少 `docs`、`style`、`asset` 角色，分类体系不完整

`fileRoles` 只有 `entry`、`library`、`config`、`test`、`migration`、`script`，但项目中明显存在：

- `README.md`、`CHANGELOG.md` → 没有 `docs` 角色
- `.css`、`.scss` 文件 → 没有 `style` 角色
- 图片、字体等静态资源 → 没有 `asset` 角色

**产品影响**：

- 产品设计了 6 种文件角色，但大量文件无法被归类，只能被塞进 `library` 或遗漏。
- 基于 fileRoles 的统计和建议（如"你的 docs 文件占比过高"）完全无法输出。
- 一个设计了分类体系但覆盖不全的产品，比不做分类更让用户困惑。

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

#### P42. `deadExports.confidence` 分级逻辑不透明，同类型文件不同 confidence

同为 `src/` 下的工具模块：

- `src/utils/ruoyi.js` → `confidence: medium`
- `src/utils/validate.js` → `confidence: high`
- `src/router/index.js` → `confidence: medium`

**产品影响**：

- 用户无法从输出中理解"为什么这个文件是 medium，那个是 high"。
- confidence 的判定标准没有文档、没有注释、没有 traceability。
- 当一个产品的核心指标（confidence）是黑盒时，用户只能凭运气判断哪些该信、哪些该忽略。

---

#### P43. `health.checks.ci` 未检测到 `.github/workflows` 目录 ✅ 已修复

✅ 已修复。`detectCiConfig` 对 GitHub Actions 从"检查目录存在"升级为"检查目录内是否存在 `.yml`/`.yaml` 文件"，覆盖任意命名的 workflow。详情见 CHANGELOG.md [Unreleased]。

---

#### P44. `scope.hasConfig` 命名歧义，易误解为"项目无配置" ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。

---

#### P46. `file-index.js` 的默认排除目录缺少 `vendor`、`bin`、`obj` 等常见目录 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。
---

#### P47. `scope.counts` 完全没有代码量统计（LOC、SLOC）

所有命令的 `scope` 中只有 `totalFiles`、`mainlineFiles`、`nonMainlineFiles`，没有任何关于：

- 总代码行数（LOC）
- 源代码行数（SLOC）
- 注释行数
- 空行数
- 平均文件大小

**产品影响**：

- 用户无法判断"这是一个 1 万行的小项目还是一个 50 万行的大项目"。
- 在横向对比两个项目时（如 zcypg_frontend 223 文件 vs zsgzt_frontend 218 文件），用户不知道它们的代码量差异。
- `stats` 命令只输出 `files`/`imports`/`exports`/`cycles` 四个维度，连最基础的代码规模指标都没有。

---

#### P48. `deadExports` 对 Vue SFC 组件（`.vue` 文件）的误报 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。
---

#### P49. `unresolved` 的 `resolvedTo` 在 `.vue` 场景下退化为目录路径 ✅ 已修复

✅ 已修复。详情见 CHANGELOG.md [Unreleased]。
---

#### P50. SKILL.md 的 Fast vs Slow 分类与实际耗时脱节

文档分类：

> **Fast** (< 2s): `audit-summary`, `audit-file`, `audit-overview`, `audit-diff`, `health`, `dead-exports`, `unresolved`, `cycles`, `impact`, `affected-tests`
> **Slow** (network-bound): `diagnostics`

实际测试：

- `diagnostics` 耗时 < 1s，因为它只跑了 `npm run -s`（列出 scripts），没有任何网络请求。
- `audit-overview` 和 `audit-map` 耗时 2-3s，反而比 `diagnostics` 慢。
- **`audit-overview` 实测 4.5s**（223 文件 Vue 前端项目），远超文档声称的 "<2s"。

**产品影响**：

- 文档的 Fast/Slow 分类依据不是实测耗时，而是主观假设。
- 用户按文档预期 `diagnostics` 会很慢（network-bound），实际几乎瞬间完成——但完成的同时没有产生任何诊断结果。
- 分类错误会误导用户做性能预期管理，更重要的是掩盖了 `diagnostics` "快但无用"的本质。
- `audit-overview` 被标为 Fast (<2s)，实际 4.5s，在 CI 管道中可能导致门禁超时。

---

#### P51. 工具输出的"零问题"组合形成系统性虚假安全感

后端项目的完整输出画像：

| 命令               | 输出                                 |
| ------------------ | ------------------------------------ |
| `audit-summary`  | `totalFiles: 0`, `severity: low` |
| `dead-exports`   | `deadExportCount: 0`               |
| `unresolved`     | `unresolvedCount: 0`               |
| `cycles`         | `cycleCount: 0`                    |
| `diagnostics`    | `total: 0`                         |
| `audit-security` | `total: 0`                         |
| `health`         | `3/5`（不严重）                    |

**产品影响**：

- 单独看每个输出都是"项目没问题"，但组合起来是一个完整的幻觉——因为工具根本没分析任何文件。
- 这是最危险的产品形态：不是报错，而是系统性地输出"一切正常"。
- 用户、AI 代理、CI 管道都会基于这些"零问题"信号做出错误决策（如"后端代码质量良好，无需关注"）。

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

#### P56. `deadExports` 中同类型文件 confidence 不一致，黑盒逻辑

同为 `src/utils/` 下的工具模块：

| 文件                              | confidence | 说明         |
| --------------------------------- | ---------- | ------------ |
| `src/utils/validate.js`         | high       | 常规工具函数 |
| `src/utils/ruoyi.js`            | medium     | 常规工具函数 |
| `src/utils/scroll-to.js`        | high       | 常规工具函数 |
| `src/router/index.js`           | medium     | 路由配置     |
| `src/utils/generator/config.js` | medium     | 生成器配置   |

**产品影响**：

- 用户无法从输出中推断"为什么 ruoyi.js 是 medium 而 validate.js 是 high"。
- 同目录、同类型、同用途的文件得到不同 confidence，说明判定规则不透明且不稳定。
- 当一个产品的核心分级指标没有可解释性时，用户只能放弃使用这个指标做决策。

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

| 症状              | ai_zcypg_frontend                                                        | ai_zsgzt_frontend                                                        |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| unresolved        | 24（100% 是 Vue `.vue` 省略）                                          | 24（100% 是 Vue `.vue` 省略）                                          |
| dead exports 模式 | 以 `src/api/*.js`、`src/utils/*.js`、`src/store/modules/*.js` 为主 | 以 `src/api/*.js`、`src/utils/*.js`、`src/store/modules/*.js` 为主 |
| orphans 模式      | `src/main.js`、`src/app.vue` 等入口被标孤儿                          | `src/main.js`、`src/app.vue` 等入口被标孤儿                          |
| health score      | 3/5                                                                      | 3/5                                                                      |
| nextSteps         | 完全相同的 4 条模板                                                      | 完全相同的 4 条模板                                                      |

**产品影响**：

- 两个不同业务（政策评估 vs 招商工作台）、不同文件数（223 vs 218）的项目，在核心缺陷指标上几乎完全一致。
- 这不是巧合，而是工具对 Vue/Vite 项目的解析逻辑存在**系统性盲区**（alias、`.vue` 扩展名、动态导入、entry 检测）。
- 产品的缺陷不是"偶尔在某些项目里出现"，而是"只要遇到 Vue 项目就一定会触发"。这意味着该工具目前**不适合用于 Vue/Vite 前端项目的生产审计**。

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
