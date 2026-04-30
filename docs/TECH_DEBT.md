# 技术债与代码气味地图

> 本文档记录通过代码审查和 CLI 自分析发现的代码质量问题。> 能力层面：项目核心引擎（dep-graph / file-index / cache）数据结构清晰，CLI 输出可信。> 债务层面：评分/格式化层存在硬编码算法和职责混乱，是主要技术债集中地。
> 最后审查：2026-04-30（本轮清理后剩余 0 项 P0/P1 技术债）

---

## 高危文件（改一行，炸一片）

| 文件 | 行数 | 上游依赖 | 影响文件 | 影响测试 | 风险 |
|------|------|---------|---------|---------|------|
| `src/utils/path.js` | 215 | 14 | 32 | 17 | **最高** — 最底层基础设施 |
| `src/services/dep-graph.js` | 726 | 9 | 11 | 8 | **高** — 核心引擎类 |
| `src/cli/formatters/` | ~920 | — | — | — | 已拆分：7 文件 + index.js，职责分离 |
| `src/utils/stack-detector.js` | 630 | 5 | — | — | 中 — 技术栈检测硬编码 |
| `src/tools/overview-tools.js` | 719 | — | — | — | 中 — 评分算法重复 |

---

## 按铁律分类的问题

### 1. "消除边界情况 > if" — 全面失守

**硬编码评分算法：已清理 3/4**

- `audit-formatters.js`
  - `buildCompositeRisk()` — 分数累加是一堆 if-else（唯一剩余；等新增第 6 种评分维度时统一重构）
  - ~~`buildRepoSummary()` — severity 判定~~ ✅ 已收拢至 `risk-thresholds.js`
  - ~~`buildAuditDiffSummary()` — severity 判定（第三套阈值）~~ ✅ 已收拢至 `risk-thresholds.js`
- ~~`git-tools.js` `computeHistoryRisk()`~~ ✅ 已重构为 `HISTORY_RISK_SCORE_GROUPS` 数据结构驱动
- ~~`overview-tools.js` `calculateHotspotScore()` / `calculateStabilityScore()`~~ ✅ 已重构为 `HOTSPOT_SCORE_RULES` / `STABILITY_SCORE_RULES` 数据结构驱动
- ~~`utils/path.js`~~ ✅ 已重构为 `WORKSPACE_SCORE_RULES` 配置表驱动

~~**severity 阈值不统一（同一概念，三套规则）**~~ ✅ 已修复：全部收拢至 `src/config/risk-thresholds.js`，`scoreToLevel` / `fileImpactSeverity` / `repoSeverity` / `diffSeverity` / `overviewSeverity` 五函数统一映射。

**`classifyChangeType()` 是 if-else 链式地狱：**

同时从三个来源推断文件类型：扩展名、fileRole、文件名子串。没有优先级文档，靠 `if-else` 顺序隐含优先级。正解：fileRole 是单一事实源，其余仅作 fallback。

---

### 2. "内部代码互相信任" — 严重违反

~~`audit-formatters.js` 17 处 `toNumber()` 防御性包装~~ ✅ 已修复：全部替换为 `|| 0` 默认值，`toNumber` 函数已删除。上游数据契约已确认（`length` 字段、评分字段均由生产代码保障为数字，仅 `historyRisk?.score` 和 `scope?.counts` 可能为 `undefined`，用 `|| 0` 兜底足够）。

---

### 3. "删除即品味" — 没做到

- ~~`src/utils/logger.js` — CLI 自分析确认为死导出（high confidence），导出的 `debug/info/warn/error/isDebug` 无人使用~~ ✅ 2026-04-30 已删除
- ~~`src/services/editor-state.js` — 327 行，`container.js` 中已 deprecated + 默认禁用~~ ✅ 2026-04-30 已删除，`better-sqlite3` 同步移除

---

### 4. "让错误暴露，别吞异常" — 已清理

- ~~dep-graph.js `_readPackageJson`~~ ✅ 已去掉 try-catch；ENOENT 由外部 guard，JSON 解析错误会暴露
- ~~dep-graph.js `isKnownEntryFile` shebang 读取~~ ✅ 改为只吞 `ENOENT`，其他错误继续抛出
- ~~overview-tools.js `getHistoryRisk`~~ ✅ 无条件 `console.error`，不再只在 DEBUG 下静默
- ~~overview-tools.js `readTrendHistory`~~ ✅ ENOENT 由外部 guard，JSON 解析错误会暴露
- `stack-detector.js` `readTextIfExists` 保留容错（设计语义即"尽量读"）

---

### 5. "单一数据源" — 违反

- ~~`classifyChangeType` 同时从扩展名、fileRole、文件名子串三个来源推断类型~~ ✅ 已修复：`fileRole` 成为单一事实源，扩展名仅 fallback
- ~~severity 阈值在三处重复定义，阈值不一致~~ ✅ 已统一至 `src/config/risk-thresholds.js`

---

~~### 6. 封装被破坏~~ ✅ 已修复

`file-index.js` `pruneExcludedCacheEntries()` 和 `handleFileChange()` 直接操作 `WorkspaceCache` 内部 `symbolIndex`：

```js
this.cache.symbolIndex.delete(symName);
```

→ 已新增 `WorkspaceCache.deleteSymbol(name)` 公共接口，两处调用均替换为 `this.cache.deleteSymbol(symName)`。

---

### 7. 假 async

~~`cache.js` 的 `load()` 和 `save()` 声明为 `async`，但内部全用 sync API~~ ✅ 已修复：去掉 `async` 关键字，`container.js` 同步调用。

---

---

~~### 8. 用正则解析结构化格式~~ ✅ 已修复

`stack-detector.js` `detectRustWorkspaceMembers()`：

```js
const membersMatch = content.match(/members\s*=\s*\[([^\]]*)\]/s);
```

→ 新增 `extractTomlStringArray(content, key)` 逐行解析 TOML 数组，找到 key 后收集到闭合 `]` 为止的内容，再提取引号内字符串。支持多行数组。

`detectLinters()` 从 `build.gradle` 里正则匹配 spotbugs/pmd/errorprone/jacoco：
→ 新增 `hasGradlePlugin()` 逐行处理 Gradle 文本，跳过 `//` / `/*` / `*` 注释行后再做正则匹配，消除注释内伪声明的误报。

---

~~### 9. 魔法数字无文档~~ ✅ 已修复

全部收拢至 `src/config/constants.js` `DEFAULTS`：

| 常量 | 值 | 文档说明 |
|------|-----|----------|
| `AFFECTED_TEST_DEPTH` | 5 | 传递依赖搜索深度上限；真实映射多坐于 1-3 跳 |
| `SYMBOL_IMPACT_DEPTH` | 4 | 符号级影响比文件级少一跳 |
| `FILE_INDEX_MAX_DEPTH` | 5 | 目录递归上限，防依赖目录无限下钻 |
| `HOTSPOT_CANDIDATE_LIMIT` | 50 | 限制历史查询文件数，防大仓库 Git churn |
| `STABILITY_CANDIDATE_LIMIT` | 30 | 稳定性分析预算，小于 hotspots 因无 history provider 开销 |

---

~~### 10. 超时泄漏~~ ✅ 已修复

`file-index.js` `indexByPattern()` 原用 `Promise.race([indexingPromise, timeoutPromise])`，超时后 indexingPromise 仍在后台运行。

→ 改为 `AbortController` 信号传递：
- `findFilesAsync` 每次循环前检查 `signal.aborted`
- `processFilesWithLimit` 启动新任务前检查 `signal.aborted`
- `build()` 去掉 `Promise.race`，改为在 pattern 边界处检查总耗时

已启动的任务无法中途取消（Node.js 限制），但不再启动新任务，泄漏范围缩至 `concurrency limit` 以内。

---

### 11. console.error 滥用于日志

~~`cache.js` `load()` / `save()`~~ ✅ 已修复：正常情况（无缓存、缓存过期、版本不匹配）和成功信息（已加载、已保存）的 `console.error` 已删除，只保留真正的错误（`Load failed` / `Save failed`）使用 `console.error`。

---

## 文件级雷区地图

~~### `src/cli/audit-formatters.js`（920 行）— 头号垃圾桶~~ ✅ 已拆分

- ~~**问题**：评分计算、摘要构建、变更分类、验证模板、文本格式化、JSON 格式化全部塞在一个文件~~
- ~~**违反铁律**：消除边界情况 > if（多处）、内部互相信任（17 处 toNumber）、文件职责单一~~
- ~~**建议**：拆分为 `risk-scoring.js`、`validation-templates.js`、`formatters/` 目录~~

**已完成（2026-04-30）**：按职责拆分为 `src/cli/formatters/` 目录下的 7 个文件 + `index.js`：
- `composite-risk.js` — `buildCompositeRisk`
- `repo-summary.js` — `buildRepoSummary`
- `file-summary.js` — `buildFileSummary`
- `audit-diff-summary.js` — `buildAuditDiffSummary` + `classifyChangeType` + `getValidationTemplate`
- `validation-advice.js` — `buildValidationAdvice`
- `project-map.js` — `buildProjectMap` + `buildDirectoryTree` + `toRelativePath`
- `impact-explanations.js` — `buildImpactExplanations`

~~### `src/services/dep-graph.js`（747 行）— 核心引擎，但边界不清~~ ✅ 已修复

- ~~**问题**：`normalizeStem()`、`normalizeHeuristicName()` 等工具函数放在核心引擎文件里~~ → 已下沉至 `src/utils/test-detector.js`
- ~~**违反铁律**：消除边界情况（`isTestLikeFile()` 16 个正则塞一个函数）~~ → 已重构为 `TEST_DETECTION_RULES` 表驱动
- 文件从 747 行降至 ~680 行（-67 行）

~~### `src/utils/stack-detector.js`（614 行）— 硬编码检测器~~ ✅ 已修复

- ~~**问题**：技术栈检测是一堆 `pathExists` + 正则的重复模式~~ → 已重构为配置表：`STACK_MARKERS`、`PACKAGE_MANAGER_RULES`、`TEST_RUNNER_FILE_RULES`、`LINTER_FILE_RULES`、`DOCS_TOOL_RULES`、`TYPE_CHECKER_FILE_RULES`、`JAVA_BUILD_RULES`
- ~~**违反铁律**：消除边界情况 > if、数据结构先于算法~~
- ~~**建议**：检测规则写成配置表~~ → 已完成

~~### `src/tools/overview-tools.js`（724 行）— 评分算法重复~~ ✅ 已修复

- ~~**问题**：`calculateHotspotScore()`、`calculateStabilityScore()` 硬编码 if-else 评分~~ → 已重构为 `HOTSPOT_SCORE_RULES` / `STABILITY_SCORE_RULES` 数据结构驱动
- ~~**违反铁律**：单一数据源、消除边界情况 > if~~
- ~~**建议**：统一评分规则表~~ → 已完成

~~### `src/tools/git-tools.js`（610 行）— 解析脆弱~~ ✅ 部分修复

- ~~**问题**：`computeHistoryRisk()` 硬编码评分~~ → 已重构为 `HISTORY_RISK_SCORE_GROUPS` 数据结构驱动（组内 first-match，组间累加）
- `getChangedFiles()` 手动字符级解析 git porcelain 格式 → 保留。当前解析逻辑已正确处理重命名/空行/状态码，引入外部库与轻量 CLI 理念冲突

~~### `src/services/cache.js`（260 行）— 假 async + 封装泄露~~ ✅ 已修复

- ~~**问题**：async 函数内部全 sync~~ → 已去掉 `async` 关键字
- ~~`file-index.js` 直接操作内部 `symbolIndex`~~ → 已新增 `deleteSymbol()` 公共接口
- 当前状态：无活跃债务

---

## 正面参考

`src/tools/dep-tools.js` — 117 行，switch 路由，每个 case 只做一件事。这是项目里少数完全符合"函数只做一件事"的文件。

---

## 追加发现（2026-04-29 第二轮审查）

### 12. `better-sqlite3` 重依赖只在已废弃模块中使用

`better-sqlite3` 是需要 native 编译的重依赖，但只在 `editor-state.js`（327 行）中使用。而 `editor-state.js` 已被 container 默认禁用，`AGENTS.md` 明确说"价值一般，后续可能继续降权甚至删掉"。

**结论**：删掉 `editor-state.js` 时，`better-sqlite3` 应同步从 `package.json` 移除，安装速度提升明显。

### 13. `search-tools.js` ReDoS 保护是假的 → ✅ 部分修复

`safeRegexTest()`：

```js
const startTime = Date.now();
const result = pattern.test(line);  // ← 阻塞在这里
if (Date.now() - startTime > maxMs) { ... }  // ← 灾难性回溯时根本执行不到
```

`Date.now()` 检查写在 `pattern.test()` **之后**。如果正则灾难性回溯，JS 事件循环被完全阻塞，超时检查永远不会执行。这个"保护"只能告诉你"刚才那个正则花了很长时间"，但阻止不了攻击本身。

**修复（2026-04-30）：**
- `text` 类型搜索改用 `String.prototype.includes`，彻底绕过正则风险
- `safeRegexTest` 注释诚实化：明确标注为"事后慢查询检测"，不再声称"超时保护"
- 真正的防线仍是上游 `validateQuery()` + `escapeRegex()`

~~### 14. 三个独立的 `parseArgs()` 实现~~ ✅ 已修复

新增 `src/utils/parse-args.js` 提供通用轻量解析器。`cli.js`、`scripts/benchmark-perf.js`、`scripts/workflow-loop.js` 均改用之，消除重复循环。每个调用方保留自己的默认值和验证逻辑（在解析后执行），避免过度抽象。

### 15. `health-tools.js` 和 `stack-detector.js` 代码重复

| health-tools.js | stack-detector.js | 相似度 |
|-----------------|-------------------|--------|
| ~~`detectPackageManager()`~~ | `detectNodePackageManager()` | 几乎一样 |
| ~~`detectTestConfig()`~~ | `detectTestRunner()` | 高度重复 |
| `detectCiConfig()` | （无） | — |

~~两个文件都在做技术栈检测，但各写各的，阈值和检测范围不一致。~~ ✅ 已统一：`health-tools.js` 删除 `detectPackageManager` 和 `detectTestConfig` 的独立实现，改为从 `stack-detector.js` 导入 `detectNodePackageManager` 和 `detectTestRunner`。`stack-detector.js` 成为单一数据源。

### 16. `shell: true` 与项目安全原则矛盾

~~`scripts/self-audit.js`~~ ✅ 已修复：去掉 `shell: true`，参数已是数组形式，不需要 shell。

~~`scripts/workflow-loop.js`~~ ✅ 已修复：新增 `needsShell()` 检测，不含 shell 元字符的命令拆分为 `spawnSync(cmd, args)` 安全调用；只有含 `|><;&$` 的命令才回退到 `shell: true`（用户配置的命令确实可能需要 shell 语法，此时诚实回退）。

**追加修复（本轮）**：`self-audit.js` 在 Windows 上 `spawnSync('npm')` 返回 `ENOENT`（Node.js 20+ 禁止直接 spawn `.cmd`），已添加 `shell: process.platform === 'win32'` 平台适配。

### 17. `test:all` 用 `&&` 串联 30+ 个测试

~~`package.json`：~~ ✅ 已修复：

```json
"test:all": "node test/runner.js"
```

~~中间一个失败就全停，看不到后面的失败。~~ `test/runner.js` 串行运行 32 个测试，失败时立即打印输出并继续，最后统一汇总 `X passed, Y failed`。

---

*注：本文档只记录问题，不记录修复方案。修复时应优先写失败测试（red），再动实现（green）。*
