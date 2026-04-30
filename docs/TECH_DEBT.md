# 技术债与代码气味地图

> 本文档记录通过代码审查和 CLI 自分析发现的代码质量问题。> 能力层面：项目核心引擎（dep-graph / file-index / cache）数据结构清晰，CLI 输出可信。> 债务层面：评分/格式化层存在硬编码算法和职责混乱，是主要技术债集中地。
> 最后审查：2026-04-29

---

## 高危文件（改一行，炸一片）

| 文件 | 行数 | 上游依赖 | 影响文件 | 影响测试 | 风险 |
|------|------|---------|---------|---------|------|
| `src/utils/path.js` | 218 | 14 | 32 | 17 | **最高** — 最底层基础设施 |
| `src/services/dep-graph.js` | 747 | 9 | 11 | 8 | **高** — 核心引擎类 |
| `src/cli/audit-formatters.js` | 920 | — | — | — | **高** — 职责混乱的垃圾桶 |
| `src/utils/stack-detector.js` | 614 | 5 | — | — | 中 — 技术栈检测硬编码 |
| `src/tools/overview-tools.js` | 724 | — | — | — | 中 — 评分算法重复 |

---

## 按铁律分类的问题

### 1. "消除边界情况 > if" — 全面失守

**硬编码评分算法散落在 4 个文件：**

- `audit-formatters.js`
  - `buildCompositeRisk()` — 分数累加是一堆 if-else
  - `buildRepoSummary()` — severity 判定
  - `buildAuditDiffSummary()` — severity 判定（第三套阈值）
- `git-tools.js` `computeHistoryRisk()` — 又是分数累加 if-else
- `overview-tools.js` `calculateHotspotScore()` / `calculateStabilityScore()` — 又是分数累加
- `utils/path.js` — 居然也有 `let score = 0;`（grep 确认），评分逻辑渗透到 utils

**severity 阈值不统一（同一概念，三套规则）：**

```js
// audit-formatters.js buildRepoSummary
unresolved > 0 || cycle > 0 → high

// audit-formatters.js buildAuditDiffSummary
highRiskFiles > 0 || affectedTests >= 5 → high

// git-tools.js computeHistoryRisk
score >= 6 → high, score >= 3 → medium
```

**`classifyChangeType()` 是 if-else 链式地狱：**

同时从三个来源推断文件类型：扩展名、fileRole、文件名子串。没有优先级文档，靠 `if-else` 顺序隐含优先级。正解：fileRole 是单一事实源，其余仅作 fallback。

---

### 2. "内部代码互相信任" — 严重违反

`audit-formatters.js` 17 处 `toNumber()` 防御性包装：

```js
const impactCount = toNumber(entry?.impactCount);
const historyRiskScore = toNumber(entry?.historyRisk?.score);
const symbolMode = entry?.symbolImpact?.mode || null;
```

formatter 不信任上游数据结构。如果上游真的会返回 `undefined`，问题在数据契约而不是 formatter。

---

### 3. "删除即品味" — 没做到

- ~~`src/utils/logger.js` — CLI 自分析确认为死导出（high confidence），导出的 `debug/info/warn/error/isDebug` 无人使用~~ ✅ 2026-04-30 已删除
- ~~`src/services/editor-state.js` — 327 行，`container.js` 中已 deprecated + 默认禁用~~ ✅ 2026-04-30 已删除，`better-sqlite3` 同步移除

---

### 4. "让错误暴露，别吞异常" — 多处违反

```js
// dep-graph.js _readPackageJson
try { ... } catch (e) { return null; }

// overview-tools.js getHistoryRisk
try { ... } catch (e) { return null; }

// stack-detector.js readTextIfExists
try { ... } catch { return ''; }
```

---

### 5. "单一数据源" — 违反

- `classifyChangeType` 同时从扩展名、fileRole、文件名子串三个来源推断类型
- severity 阈值在三处重复定义，阈值不一致

---

### 6. 封装被破坏

`file-index.js` `pruneExcludedCacheEntries()` 直接操作 `WorkspaceCache` 内部私有数据结构：

```js
this.cache.symbolIndex.delete(symName);
```

`symbolIndex` 是 `WorkspaceCache` 的内部 Map，外部直接 `.delete()` 撕开封装。

---

### 7. 假 async

`cache.js` 的 `load()` 和 `save()` 声明为 `async`，但内部全用 sync API：

```js
async load() {
  if (!fs.existsSync(this.cachePath)) { ... }      // sync
  const stat = fs.statSync(this.cachePath);         // sync
  const data = JSON.parse(fs.readFileSync(...));    // sync
}
```

没有 await，async 只是装饰。

---

### 8. 用正则解析结构化格式

`stack-detector.js` `detectRustWorkspaceMembers()`：

```js
const membersMatch = content.match(/members\s*=\s*\[([^\]]*)\]/s);
```

TOML 不是正则能可靠解析的。嵌套数组、多行数组、带注释的数组全都会失败。

`detectLinters()` 从 `build.gradle` / `pom.xml` 里正则匹配 spotbugs/pmd/errorprone/jacoco，但 gradle 插件声明可能在注释里，会误报。

---

### 9. 魔法数字无文档

```js
// overview-tools.js
mainlineFiles.slice(0, 50)   // 为什么是 50？
mainlineFiles.slice(0, 30)   // 为什么是 30？

// dep-tools.js / dep-graph.js
maxDepth = 5                 // 为什么是 5？
```

---

### 10. 超时泄漏

`file-index.js` `indexByPattern()`：

```js
await Promise.race([indexingPromise, timeoutPromise]);
```

超时后 `indexingPromise` 仍在后台运行，没有取消机制，浪费计算。

---

### 11. console.error 滥用于日志

`cache.js` `load()`：

```js
console.error('[Cache] No cache file found');        // 正常情况
console.error('[Cache] Cache expired (...s old)');   // 正常情况
console.error('[Cache] Loaded: ...');                // 成功信息
```

`stderr` 被当日志流使用，与真正的错误输出混在一起。

---

## 文件级雷区地图

### `src/cli/audit-formatters.js`（920 行）— 头号垃圾桶

- **问题**：评分计算、摘要构建、变更分类、验证模板、文本格式化、JSON 格式化全部塞在一个文件
- **违反铁律**：消除边界情况 > if（多处）、内部互相信任（17 处 toNumber）、文件职责单一
- **建议**：拆分为 `risk-scoring.js`、`validation-templates.js`、`formatters/` 目录

### `src/services/dep-graph.js`（747 行）— 核心引擎，但边界不清

- **问题**：`normalizeStem()`、`normalizeHeuristicName()` 等工具函数放在核心引擎文件里；`_readPackageJson()` 吞异常
- **违反铁律**：让错误暴露、消除边界情况（`isTestLikeFile()` 16 个正则塞一个函数）
- **建议**：工具函数下沉到 `utils/`，`isTestLikeFile` 用规则表重构

### `src/utils/stack-detector.js`（614 行）— 硬编码检测器

- **问题**：技术栈检测是一堆 `pathExists` + 正则的重复模式；用正则解析 TOML 和 Gradle 配置
- **违反铁律**：消除边界情况 > if、数据结构先于算法
- **建议**：检测规则写成配置表，TOML 解析换用可靠库或至少用更健壮的解析器

### `src/tools/overview-tools.js`（724 行）— 评分算法重复

- **问题**：`calculateHotspotScore()`、`calculateStabilityScore()` 和 audit-formatters 的评分逻辑重复且阈值不一致
- **违反铁律**：单一数据源、消除边界情况 > if
- **建议**：统一评分规则表，所有评分走同一套数据结构驱动逻辑

### `src/tools/git-tools.js`（610 行）— 解析脆弱

- **问题**：`getChangedFiles()` 手动字符级解析 git porcelain 格式；`computeHistoryRisk()` 硬编码评分
- **违反铁律**：消除边界情况 > if
- **建议**：porcelain 解析用更可靠的库或至少加更多边界测试

### `src/services/cache.js`（260 行）— 假 async + 封装泄露

- **问题**：async 函数内部全 sync；`file-index.js` 直接操作内部 `symbolIndex`
- **违反铁律**：让错误暴露（load/save 吞异常）、封装
- **建议**：要么真 async，要么去掉 async；提供 `removeSymbolsForFile()` 公共接口替代直接 `.delete()`

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

### 14. 三个独立的 `parseArgs()` 实现

- `cli.js` — 582 行入口，手动维护十几个字段
- `scripts/benchmark-perf.js` — 另一个手动解析器
- `scripts/workflow-loop.js` — 第三个手动解析器

没有统一参数解析工具，新增脚本就要重写一遍。

### 15. `health-tools.js` 和 `stack-detector.js` 代码重复

| health-tools.js | stack-detector.js | 相似度 |
|-----------------|-------------------|--------|
| `detectPackageManager()` | `detectNodePackageManager()` | 几乎一样 |
| `detectTestConfig()` | `detectTestRunner()` | 高度重复 |
| `detectCiConfig()` | （无） | — |

两个文件都在做技术栈检测，但各写各的，阈值和检测范围不一致。

### 16. `shell: true` 与项目安全原则矛盾

`scripts/self-audit.js` 和 `scripts/workflow-loop.js` 使用了 `shell: true`：

```js
spawnSync('npm', ['run', 'test:all'], { shell: true });
```

但项目其他命令执行模块（`command.js`）明确标榜：

> "SECURE VERSION - All commands use spawn with parameter arrays to prevent injection"

脚本层和库层的安全标准不一致。

### 17. `test:all` 用 `&&` 串联 30+ 个测试

`package.json`：

```json
"test:all": "node test/cache-test.js && node test/function-impact-test.js && ..."
```

中间一个失败就全停，看不到后面的失败。标准做法是用一个测试 runner 汇总所有结果。

---

*注：本文档只记录问题，不记录修复方案。修复时应优先写失败测试（red），再动实现（green）。*
