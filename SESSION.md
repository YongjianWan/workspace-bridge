# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（必须执行）

```bash
# 1. 验证测试基线
npm run test:all          # 期望: 45/45 PASS

# 2. 验证自审基线
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExportCount=0, unresolvedCount=0, cycleCount=0, totalFiles≈102

# 3. 验证大项目 compact 可用性
node cli.js audit-map --cwd reference/GitNexus/gitnexus --compact --json --quiet
# 期望: 输出行数 < 1000, summary.severity 存在, highlightedFiles 按问题严重程度排序
```

**如果任何一步失败 → 先修基线，再做其他事。**

---

## 基线状态

- 测试：**46/46 PASS**（`repl-test.js` 偶发 flaky，单独重跑即过）
- 版本：**v1.0.3**（待打 tag）
- 分支：`main`，已 push origin
- 自身项目规模：102 文件，entry=4, library=40, test=46, script=12
- 健康度：5/5，0 死导出，0 循环，0 未解析

---

## 上轮完成（2026-05-04）

### 功能交付

详见上一轮 SESSION.md。核心交付：audit-map `--compact` 三轮压缩、archive 自动排除、REPL compact 支持。

### 债务清理（三轮审查 + 本轮全量修复）

**P0 — 正确性与资源管理**
- cache.js `normalize*Entries` 防御性检查（旧缓存加载崩溃）
- cache.js `save()` 同步阻塞 → `async` + `fs.promises`
- file-index.js `node_modules` 特殊分支冗余删除
- file-index.js `handleFileChange` 漏清 parseResult/diagnostics → `_removeCacheEntry()`
- file-index.js 硬编码 cache 文件名 → `CACHE_FILENAME` 常量
- command.js Windows 命令解析：只给 npm/npx 加 `.cmd`，其他交给 spawn PATHEXT
- REPL SIGINT 资源泄漏 → `rl.on('SIGINT', () => rl.close())`
- watch.js shutdown 异常挂起 → `try-catch` 包围
- container.js shutdown 异常不安全 → 每步独立 `try-catch`
- dep-graph.js 引用污染 → `{ ...cached }` 浅拷贝
- semgrep.js 非零退出码丢弃 findings → 先解析 stdout 再判断
- hasGradlePlugin 循环内 `new RegExp()` → 提到循环外
- Linux watcher 硬编码禁用 → 运行时探测

**P1 — 结构与可维护性（上轮）**
- stack-detector.js 835 行 → 拆为 `detect.js`(396) + `commands.js`(433)
- extractSymbols 6 分支 `else-if` → `symbol-extractors.js` first-match 注册表
- 消除重复代码：`hasGoProject` 复用 `detectGoModules`；提取 `buildNodeTestCommand`、`buildGoModuleTestCommands`、`buildRustTestCommands`
- file-index.js 死代码删除：`findSymbol`、`searchSymbols`、`getFileSymbols`
- DEFAULT_EXCLUDE_DIRS 移除 `test-temp`、`wb-analysis-fixture`
- watch.js 移除 `originalCallback` dead code 参数
- `scoreHighlightedFile` 裸数字 → `HIGHLIGHT_SCORES` 注册表
- cli.js printUsage 补 `--config`、`--language` 文档

**P1 — 本轮新增债务修复（6 项）**
- dep-graph.js `shouldExclude` 硬编码缓存文件名 → 引入 `CACHE_FILENAME` 常量
- dep-graph.js `analyzeFile` 失败时 stale 数据残留 → catch 块主动 `graph.delete` + `cache.deleteParseResult`
- `countTreeFiles` 跨文件重复（cli.js ↔ repl.js）→ 提取到 `project-map.js` 统一导出
- overview-tools.js `generateCouplingSplitPlan` 7 分支 if 链 → `COUPLING_ADVICE_RULES` 配置表
- overview-tools.js `writeHotspotDataFile` / `writeStabilityTrendFile` / `writeOverviewDashboardFile` 三板斧重复 → 提取 `ensureWriteTextFile` 纯函数
- overview-tools.js `buildLanguageSupportMatrix` ext→lang if-else 链 → `EXT_TO_LANG` 映射表

**P2 — 本轮功能交付（compact 体验补齐 + REPL 命令扩展 + staleness 检测）**
- `watch --compact` — dependents >10 时分层策展：显式列出 entries/tests，其余聚合为 `+N more`
- `audit-diff --compact` — `changedFiles` 数组元素精简：impact/affectedTests cap 到 5，去掉 symbolImpact/changedLineRanges/recentCommits，historyRisk 只保留 score/level
- REPL `issues` 命令 — 一键输出 severity + deadExports/unresolved/cycles 计数 + nextSteps
- REPL `top` 命令 — 输出 dependentCount ≥5 的热点文件 top 5
- **Staleness 检测** — 所有 CLI JSON 输出统一注入 `staleness` 字段（indexAgeMs / isStale / thresholdMs=5min），AI 可判断数据新鲜度
- 设计原则落地：**压缩 = AI 策展（curation），不是截断（truncation）** — 问题优先、分层策展、数量即信号、保留入口、可下探
- 新增 `test/watch-format-test.js` + `test/audit-diff-compact-test.js` + `staleness-test.js` + `repl-test.js` 扩展验证

---

## 已知陷阱（新 agent 必看）

| 陷阱 | 位置 | 如何避免 |
|------|------|----------|
| `DEFAULT_EXCLUDE_DIRS` 全局污染 | `src/services/file-index.js` | 任何新增排除项必须是通用目录名（如 `node_modules`），不能是项目特定名称 |
| orphan 检测不同步 | `project-map.js` vs `overview-tools.js` | 两处 orphan 逻辑必须保持同步（scripts/bin/benchmark 跳过） |
| compact 模式只改 project-map.js | `cli.js` 也需要同步 | human-readable 输出和 `countTreeFiles()` 必须兼容 skeleton 模式（`totalFileCount`） |
| Windows PowerShell 管道 BOM | 所有 `node cli.js ... \| node -e` 命令 | PowerShell 管道传 JSON 会带 BOM，用 `cmd /c "... > file"` 再读文件 |
| cache.save() 已改为 async | `src/services/cache.js` | 调用方必须 `await`（container.js、测试均已适配） |
| repl-test.js flaky | `test/repl-test.js` | runner.js 串行执行时偶发失败，单独 `node test/repl-test.js` 稳定通过；若遇到，先重跑确认 |

---

## 下一步方向：剩余债务清单（按价值/风险排序）

> 以下债务由本轮深度品味审查发现，已按 L1/L2/L3 分层。未修复前不要推进新功能。

### 🔴 L1 铁律（不修 = 可能出 bug 或数据不一致）

| # | 债务 | 位置 | 修复方式 | 预估 |
|---|------|------|---------|------|
| 10 | `updateFiles` 解析失败时图不一致 | `dep-graph.js:318-382` | ✅ **本轮已修** — analyzeFile catch 时 graph.delete + cache.deleteParseResult |
| 9 | `shouldExclude` 硬编码缓存文件名 | `dep-graph.js:56` | ✅ **本轮已修** — 引入 `CACHE_FILENAME` 常量 |

### 🟡 L2 标准（不修 = 技术债务累积）

| # | 债务 | 位置 | 修复方式 | 预估 |
|---|------|------|---------|------|
| 11 | `visitNode` 220 行混杂 7 种业务逻辑 | `parsers/js.js:81-301` | 拆为 `visitors` 映射表，每个 visitor 独立函数 ~30-40 行 | 30 min |
| 12 | AST walker 重复 >90% | `parsers/js.js:292-300` vs `334-342` | 提取通用 `walkAST(node, visitor, parent?)` 纯函数 | 15 min |
| 13 | prop.key name 提取重复 ≈100% | `parsers/js.js:248-250` vs `262-264` | 提取 `getPropertyName(prop)` | 5 min |
| 14 | CJS export record push 重复 ≈80% | `parsers/js.js:252-259` vs `280-288` | 提取 `pushExportFromValue(name, valueNode, lineStart, lineEnd)` | 10 min |
| 15 | functionRecords.push 结构重复 | `parsers/js.js:313-318` vs `325-331` | 提取 `pushFunctionRecord(name, node)` | 5 min |
| 16 | 语言分发 if-else 链 | `dep-graph.js:241-257` | `PARSER_REGISTRY` 配置表：`[{exts, parser, async}]` | 15 min |
| 17 | 5 语言解析结果解构 100% 重复 | `dep-graph.js:248-256` | 随 `PARSER_REGISTRY` 一并消除 | — |
| 18 | 反向边构建逻辑重复 | `dep-graph.js:301-309` vs `364-375` | 提取 `_addReverseEdges(fileKey, imports)` | 10 min |
| 19 | `isKnownEntryFile` 配置名硬编码 + exports 死逻辑 | `dep-graph.js:140,152-156` | `KNOWN_CONFIG_NAMES` Set + 删除 152-154 死代码 | 10 min |
| 20 | 框架正则数组每次调用重建 | `dep-graph.js:122-136` | 提到模块级常量 | 5 min |
| 21 | `__main__` 正则在函数内重建 | `dep-graph.js:147` | 提到模块级常量 | 2 min |
| 22 | `_scanSymbolUsageInImporters` 循环内 `new RegExp` | `dep-graph.js:530-534` | 局部 `Map<symbol, RegExp>` 缓存，或改用 `String.includes` + 边界检查 | 10 min |
| 23 | `generateCouplingSplitPlan` 7 分支 if 链 | `overview-tools.js:281-337` | ✅ **本轮已修** — `COUPLING_ADVICE_RULES` 配置表 |
| 24 | `writeXxxFile` 三板斧重复 | `overview-tools.js:424-571` | ✅ **本轮已修** — `ensureWriteTextFile` 纯函数 |
| 25 | `buildLanguageSupportMatrix` ext→lang if 链 | `overview-tools.js:573-600` | ✅ **本轮已修** — `EXT_TO_LANG` 映射表 |
| 26 | `countTreeFiles` 跨文件重复 | `cli.js ↔ repl.js` | ✅ **本轮已修** — 提取到 `project-map.js` |
| 27 | overview-tools.js 大量裸数字未归零 | `overview-tools.js` ~20 处 | 热点评分/稳定性/耦合阈值/采样上限进 `constants.js` | 20 min |
| 28 | `splitTargetsByStack` regex 循环编译 | `commands.js:278-287` | ✅ **前轮已修** — `STACK_TARGET_PATTERNS` 模块级常量 |

### 🟢 L3 指南（不修 = 品味问题）

| # | 债务 | 位置 | 修复方式 | 预估 |
|---|------|------|---------|------|
| 29 | 两处三元嵌套可转配置表 | `parsers/js.js:32-38, 497-501` | `QUOTE_PATTERNS` + `DECL_KIND_MAP` | 5 min |
| 30 | `findAffectedTests` 84 行做两件事 | `dep-graph.js:640-724` | 拆为 `_findAffectedTestsByGraph` + `_findAffectedTestsByHeuristic` | 15 min |
| 31 | `findDeadExports` 56 行可拆分 | `dep-graph.js:555-611` | 提取 `_collectUsedExports(importers, filePath)` | 10 min |
| 32 | `updateFiles` 64 行 4 步骤 | `dep-graph.js:318-382` | 拆为 `_removeOldReverseEdges`、`_addNewReverseEdges` 等私有方法 | 15 min |

---

## 新会话指令（给下一轮 AI）

**目标**：把剩余 14 项 L2 债务清零。按以下顺序执行：

### 前置检查
1. 跑 `node test/runner.js` 确认基线绿色（当前 46/46 PASS；若 `repl-test.js` 偶发失败，单独重跑该文件确认）。
2. 跑 `node cli.js audit-summary --cwd . --json --quiet` 确认 healthScore=5/5。

### Step 1：parsers/js.js（#11-#15, #29）— 提取 walkAST + visitors 映射表 + 消除 4 处重复

**#12 提取 `walkAST(node, callback, parent = null)`**
- 当前两处 walker 几乎 100% 重复：`visitNode` 内第 292-300 行 vs `visitFunctionNode` 内第 334-342 行。
- 提取为文件级纯函数：`walkAST(node, callback, parent = null)`，callback 签名为 `(node, parent) => void`。
- 跳过键固定为 `'type'`, `'loc'`, `'start'`, `'end'`。

**#11 将 `visitNode` 拆为 visitors 映射表**
- 当前 `visitNode` 从第 81 行到 291 行，混杂 ImportDeclaration / ExportAllDeclaration / ExportNamedDeclaration / ExportDefaultDeclaration / ImportExpression / CallExpression(require) / AssignmentExpression(CJS) 共 7 种业务逻辑。
- 方案：保留两个 walker 调用（imports/exports 与 functions 分开），但都用 `walkAST`：
  - `const importExportVisitors = { ImportDeclaration(node) {...}, ExportAllDeclaration(node) {...}, ... };`
  - `const functionVisitors = { FunctionDeclaration(node, parent) {...}, ArrowFunctionExpression(node, parent) {...}, ... };`
  - `walkAST(ast, (node, parent) => { const handler = importExportVisitors[node.type]; if (handler) handler(node); });`
  - `walkAST(ast, (node, parent) => { const handler = functionVisitors[node.type]; if (handler) handler(node, parent); });`

**#13 提取 `getPropertyName(prop)`**
- 第 248-250 行 vs 262-264 行完全重复：
  ```js
  prop.key?.type === 'Identifier' ? prop.key.name
    : prop.key?.type === 'StringLiteral' ? prop.key.value
    : null;
  ```
- 提取为文件级纯函数 `getPropertyName(prop)`。

**#14 提取 `buildExportRecordFromValue(name, valueNode, fallbackLines)`**
- 第 252-259 行（`module.exports = { prop }` 属性值）与第 280-288 行（`exports.foo = ...`）push export record 的逻辑约 80% 重复：都判断 `isFunctionLikeNode`、都调用 `buildFunctionFingerprint`、都用 `createExportRecord`。
- 提取为：
  ```js
  function buildExportRecordFromValue(name, valueNode, fallbackLines) {
    const kind = isFunctionLikeNode(valueNode) ? 'function' : 'symbol';
    const fingerprint = kind === 'function' ? buildFunctionFingerprint(valueNode) : null;
    return createExportRecord(name, {
      kind,
      lineStart: valueNode.loc?.start?.line || fallbackLines.lineStart,
      lineEnd: valueNode.loc?.end?.line || fallbackLines.lineEnd,
      fingerprint,
    });
  }
  ```

**#15 提取 `pushFunctionRecord(records, name, node)`**
- 第 313-318 行（FunctionDeclaration/Expression）与第 325-331 行（ArrowFunctionExpression）结构几乎相同。
- 提取为文件级纯函数 `pushFunctionRecord(records, name, node)`，内部处理 `buildFunctionFingerprint` 与 `createExportRecord` 组装。

**#29 三元嵌套 → 配置表**
- `stripQuotedStrings` 第 32-38 行 → `const QUOTE_PATTERNS = { '"': /.../g, "'": /.../g, '`': /.../g };`
- `declarationExportRegex` 处理第 497-501 行 → `const DECL_KIND_MAP = { function: 'function', class: 'class', const: 'variable', let: 'variable', var: 'variable' };`

### Step 2：dep-graph.js 语言层（#16-#17, #19-#21）

**#16-#17 `PARSER_REGISTRY` 消除语言分发 if-else 链 + 解构重复**
- 当前第 242-258 行 6 分支 if-else 链，且 5 种语言的解构赋值 100% 重复。
- 在模块顶部定义：
  ```js
  const PARSER_REGISTRY = [
    { exts: ['.py'], parser: parsePython, async: true },
    { exts: ['.js', '.ts', '.jsx', '.tsx'], parser: parseJavaScript, async: false, needsFilePath: true },
    { exts: ['.java'], parser: parseJava, async: true },
    { exts: ['.kt'], parser: parseKotlin, async: true },
    { exts: ['.go'], parser: parseGo, async: true },
    { exts: ['.rs'], parser: parseRust, async: true },
  ];
  ```
- `analyzeFile` 中替换为统一查找：
  ```js
  const entry = PARSER_REGISTRY.find((e) => e.exts.includes(ext));
  if (entry) {
    const args = entry.needsFilePath ? [content, filePath] : [content];
    const result = entry.async ? await entry.parser(...args) : entry.parser(...args);
    imports = result.imports;
    exports = result.exports;
    importRecords = result.importRecords || [];
    exportRecords = result.exportRecords || [];
    functionRecords = result.functionRecords || [];
    parseMode = result.parseMode || 'regex';
  }
  ```

**#19 `KNOWN_CONFIG_NAMES` + 删除 exports 死逻辑**
- 第 141 行 `||` 链 → `const KNOWN_CONFIG_NAMES = new Set(['vite.config.js', 'vite.config.ts', 'eslint.config.js']); if (KNOWN_CONFIG_NAMES.has(base)) return true;`
- 第 152-155 行死逻辑：
  ```js
  if (!Array.isArray(exports) || exports.length === 0) {
    return false;
  }
  return false;
  ```
  无论条件真假都返回 false，直接删除这三行，保留最后的 `return false;`。

**#20-#21 正则提到模块级**
- 第 123-137 行 `frameworkManagedPatterns` 数组 → 提到模块顶部 `const FRAMEWORK_MANAGED_PATTERNS = [...];`
- 第 148 行 `/if\s+__name__\s*==\s*['"]__main__['"]\s*:/` → 提到模块顶部 `const PYTHON_MAIN_PATTERN = /.../;`

### Step 3：dep-graph.js 结构与异常层（#18, #22, #30-#32）

**#18 提取 `_addReverseEdges(fileKey, imports, options?)` 消除反向边构建重复**
- `buildReverseGraph` 第 301-314 行 与 `updateFiles` 第 365-379 行存在重复：遍历 imports、去重 seen、初始化 reverseGraph 数组、push fileKey。
- 提取为私有方法：
  ```js
  _addReverseEdges(fileKey, imports, { skipExisting = false } = {}) {
    const seen = new Set();
    for (const imp of imports) {
      if (seen.has(imp)) continue;
      seen.add(imp);
      if (!this.reverseGraph.has(imp)) {
        this.reverseGraph.set(imp, []);
      }
      const dependents = this.reverseGraph.get(imp);
      if (skipExisting && dependents.includes(fileKey)) continue;
      dependents.push(fileKey);
    }
  }
  ```
- `buildReverseGraph` 中循环体替换为 `this._addReverseEdges(file, info.imports);`
- `updateFiles` 中第 365-379 行替换为 `this._addReverseEdges(key, newInfo.imports, { skipExisting: true });`

**#22 `_scanSymbolUsageInImporters` 正则缓存**
- 第 531-538 行：对每个 importer、每个 symbol 都在循环内 `new RegExp`。
- 改为在每个 importer 内部使用局部 `Map` 缓存：
  ```js
  const patternCache = new Map();
  for (const symbol of symbols) {
    if (used.has(symbol)) continue;
    let patterns = patternCache.get(symbol);
    if (!patterns) {
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns = {
        callPattern: new RegExp(`\\b${escaped}\\s*\\(`),
        accessPattern: isJavaFamily ? new RegExp(`\\.${escaped}\\b`) : null,
      };
      patternCache.set(symbol, patterns);
    }
    if (patterns.callPattern.test(content) || (patterns.accessPattern && patterns.accessPattern.test(content))) {
      used.add(symbol);
    }
  }
  ```

**#30 拆分 `findAffectedTests`**
- 当前第 644-728 行，84 行做两件事：BFS graph 搜索 + heuristic 命名匹配。
- 拆为：
  - `_findAffectedTestsByGraph(filePath, maxDepth)`：第 644-682 行 BFS 逻辑。
  - `_findAffectedTestsByHeuristic(filePath, maxDepth, graphResults)`：第 684-725 行 heuristic 逻辑，直接 push 到传入的 `graphResults` 数组。
- `findAffectedTests` 变为 orchestrator：
  ```js
  findAffectedTests(filePath, maxDepth = CONFIG.DEFAULT_MAX_DEPTH, options = {}) {
    const results = this._findAffectedTestsByGraph(filePath, maxDepth);
    if (options?.includeHeuristic !== false) {
      this._findAffectedTestsByHeuristic(filePath, maxDepth, results);
    }
    return results;
  }
  ```

**#31 拆分 `findDeadExports`**
- 当前第 559-615 行，提取 `_collectUsedExports(importers, filePath)` 封装第 572-594 行的 usedNames / usesAllExports 收集逻辑。
- `_collectUsedExports` 返回 `{ usedNames: Set<string>, usesAllExports: boolean }`。
- `findDeadExports` 中对应段落替换为 `const { usedNames, usesAllExports } = this._collectUsedExports(importers, filePath);`。

**#32 拆分 `updateFiles`**
- 当前第 322-386 行 4 步骤：remove old edges / handle deleted / re-parse / add new edges。
- #18 已覆盖 "add new edges" → `_addReverseEdges`。
- 新增 `_removeOldReverseEdges(fileKey)` 封装第 339-352 行逻辑。
- `updateFiles` 中替换为：
  ```js
  this._removeOldReverseEdges(key);
  if (!fs.existsSync(filePath)) { ... continue; }
  await this.analyzeFile(filePath);
  const newInfo = this.graph.get(key);
  if (newInfo) {
    this._addReverseEdges(key, newInfo.imports, { skipExisting: true });
  }
  ```

### Step 4：overview-tools.js 裸数字（#27）— 阈值/采样上限进 constants.js

**需要新增到 `src/config/constants.js` 的常量分组（在 `DEFAULTS` 下方新增 `SCORING` 对象）：**

```js
const SCORING = {
  // Hotspot scoring
  HOTSPOT_COMMIT_COUNT_CAP: 10,
  HOTSPOT_COMMIT_COUNT_WEIGHT: 2,
  HOTSPOT_AUTHOR_COUNT_FALLBACK: 1,
  HOTSPOT_AUTHOR_COUNT_WEIGHT: 3,
  HOTSPOT_LAST_MODIFIED_DAYS_CAP: 30,
  HOTSPOT_LAST_MODIFIED_DAYS_MULTIPLIER: 0.5,
  HOTSPOT_REVERT_COUNT_FALLBACK: 0,
  HOTSPOT_REVERT_COUNT_WEIGHT: 5,
  HOTSPOT_SCORE_MAX: 100,

  // Stability scoring
  STABILITY_BASE_SCORE: 50,
  STABILITY_HAS_TESTS_DELTA: 20,
  STABILITY_LOW_IMPACT_DELTA: 10,
  STABILITY_HIGH_IMPACT_DELTA: -10,
  STABILITY_NON_MAINLINE_DELTA: -10,
  STABILITY_IN_CYCLE_DELTA: -15,
  STABILITY_CONFIG_ROLE_DELTA: 10,
  STABILITY_SCORE_MIN: 0,
  STABILITY_SCORE_MAX: 100,
  STABILITY_FRAGILE_THRESHOLD: 40,
  STABILITY_STABLE_THRESHOLD: 70,

  // Coupling thresholds
  COUPLING_HIGH_MIN: 20,
  COUPLING_MEDIUM_MIN: 10,

  // Core module detection
  CORE_MODULE_MIN_DEPENDENTS: 3,

  // Edge break scoring
  BREAK_EDGE_DEPENDENT_WEIGHT: 2,

  // Sampling / display limits
  TOP_N_RECOMMENDATIONS: 3,
  TOP_N_LIST: 10,
};
```

**然后在 `module.exports` 中加入 `SCORING`，并在 `overview-tools.js` 中全部替换：**
- `HOTSPOT_SCORE_RULES` 中的 `cap: 10` → `SCORING.HOTSPOT_COMMIT_COUNT_CAP`，`weight: 2` → `SCORING.HOTSPOT_COMMIT_COUNT_WEIGHT` 等。
- `STABILITY_SCORE_RULES` 中 `delta: 20` → `SCORING.STABILITY_HAS_TESTS_DELTA`，`score = 50` → `SCORING.STABILITY_BASE_SCORE` 等。
- `calculateCoupling` 中 `total > 20` → `SCORING.COUPLING_HIGH_MIN`，`total > 10` → `SCORING.COUPLING_MEDIUM_MIN`。
- `identifyCoreModules` 中 `dependents.length >= 3` → `>= SCORING.CORE_MODULE_MIN_DEPENDENTS`，`.slice(0, 10)` → `.slice(0, SCORING.TOP_N_LIST)`。
- `buildOverviewSummary` 中所有 `.slice(0, 3)` → `.slice(0, SCORING.TOP_N_RECOMMENDATIONS)`。
- `pickBreakEdge` 中 `fromDependents.length * 2` → `* SCORING.BREAK_EDGE_DEPENDENT_WEIGHT`。
- `buildCycleRefactorSuggestions` 中 `.slice(0, 10)` → `.slice(0, SCORING.TOP_N_LIST)`。
- `buildCouplingSplitSuggestions` 中 `.slice(0, 10)` → `.slice(0, SCORING.TOP_N_LIST)`。
- `calculateHotspotScore` 与 `calculateStabilityScore` 中的 `Math.min(100, ...)` / `Math.max(0, ...)` 也对应替换。

**注意**：`renderOverviewDashboard` 中的 CSS 像素值（`1100px`、`28px` 等）属于展示层，**不**需要进 constants.js。

### 约束（必须遵守）

- **每修完一个文件 → 跑 `node test/runner.js` 确认无新增失败。**
- **不强行拆分 dep-graph.js 物理文件**（AGENTS.md 已确认内聚优先，只拆方法）。
- **不引入 tree-sitter 等新依赖**（parsers/js.js 重构只动现有代码）。
- **不修改任何测试逻辑**（测试是验证门禁，只重构生产代码；若测试因接口变化失败，用最小适配修复测试，不改测试断言语义）。

---

## 新会话指令 B：注册表重构 + P6 语言扩展（给下一轮 AI）

> **背景**：用户明确后续要支持更多语言（P6：C/C++、Vue SFC、Svelte）。当前 `dep-graph.js:242-258` 是 6 分支硬编码 if-else 链，新增第 7 种语言时维护成本陡增。
> **决策**：提前做注册表重构（打破 ROADMAP 原定的"超 10 种才重构"阈值），把基础设施铺好，再逐语言落地。

### 目标

1. **注册表重构**（P4）— `PARSER_REGISTRY` 配置表驱动，新增/删除语言只需改一行
2. **Vue SFC 解析**（P6）— 提取 `<script>` / `<script setup>` 复用现有 JS parser
3. **C/C++ 解析**（P6）— regex 提取 `#include` + 函数/宏导出识别
4. **Svelte 解析**（P6）— 提取 `<script>` 块，regex 级解析

### 前置检查

1. 跑 `node test/runner.js` 确认基线绿色。
2. 跑 `node cli.js audit-summary --cwd . --json --quiet` 确认 healthScore=5/5。

### Step 1：注册表重构（约 30 分钟）

**1.1 统一 parser 接口**

当前 6 个 parser 返回结构一致（Record Schema），但参数签名不统一：
- `parseJavaScript(content, filePath)` — 需要 filePath
- 其他都是 `(content)`

在 `parsers/index.js` 中包一层适配器，统一为 `async (content, filePath)`：

```js
const PARSER_REGISTRY = [
  { exts: ['.py'], parser: parsePython },
  { exts: ['.js', '.ts', '.jsx', '.tsx'], parser: (c, f) => parseJavaScript(c, f) },
  { exts: ['.java'], parser: parseJava },
  { exts: ['.kt'], parser: parseKotlin },
  { exts: ['.go'], parser: parseGo },
  { exts: ['.rs'], parser: parseRust },
];
```

**1.2 替换 `dep-graph.js` `analyzeFile` 的 if-else 链**

当前第 242-258 行：
```js
if (ext === '.py') { ... } else if (['.js', '.ts', ...].includes(ext)) { ... } ...
```

替换为查表：
```js
const handler = PARSER_REGISTRY.find((h) => h.exts.includes(ext));
if (!handler) return;

const result = await handler.parser(content, filePath);
({ imports, exports, importRecords, exportRecords, functionRecords = [], parseMode } = result);
```

**1.3 导出 `PARSER_REGISTRY`**

从 `parsers/index.js` 导出，供 `dep-graph.js` require。同时保留现有单个 parser 的导出（向后兼容，其他文件可能直接引用）。

**1.4 测试回归**

- `node test/runner.js` — 必须全绿
- 重点验证：JS/TS、Python、Java、Kotlin、Go、Rust 的解析没有被破坏

### Step 2：Vue SFC 解析（约 30 分钟）

**策略**：ROADMAP P6 已定 — "提取 `<script>` / `<script setup>` 复用 JS/TS parser"。

**实现**：
1. 在 `polyglot.js` 或新建 `vue.js` 中写 `parseVue(content, filePath)`：
   - 用 regex 提取 `<script[^>]*>([\s\S]*?)</script>`
   - 如果有 `<script setup>`，也提取
   - 把提取出的 JS/TS 代码传给 `parseJavaScript(scriptContent, filePath)`
   - 返回 Record Schema
2. 在 `PARSER_REGISTRY` 加一行：`{ exts: ['.vue'], parser: parseVue }`
3. 写 `test/vue-parser-test.js`：验证 `.vue` 文件能正确提取 script 块的 imports/exports

**注意**：Vue SFC 的 `<script setup>` 没有显式 exports，所有顶层变量/函数都是隐式导出。`parseJavaScript` 处理 `<script setup>` 时会把顶层变量识别为 exports（因为不存在 `export` 关键字），这符合预期 — 因为 Vue 的隐式导出就是"所有顶层定义"。

### Step 3：C/C++ 解析（约 40 分钟）

**策略**：ROADMAP P6 已定 — "regex 提取 `#include` + 函数/宏导出识别"。

**实现**：
1. 在 `polyglot.js` 或新建 `cpp.js` 中写 `parseCpp(content)`：
   - `#include` 提取：`/^\s*#include\s+["<]([^">]+)[">]/gm`
   - 函数导出：`/^\s*(?:[\w:*&<>]+\s+)+(\w+)\s*\([^)]*\)\s*\{/gm`（简化版，不处理模板/重载）
   - 宏导出：`/^\s*#define\s+(\w+)/gm`
   - 返回 Record Schema，`parseMode: 'regex'`，`confidence: 'low'`
2. 在 `PARSER_REGISTRY` 加：`{ exts: ['.c', '.cpp', '.cc', '.h', '.hpp'], parser: parseCpp }`
3. 写 `test/cpp-parser-test.js`

**约束**：
- C++ 模板、重载、namespaces 不深入解析（regex 做不到）
- 只识别文件级函数和宏，类成员函数不识别（避免误报）
- `#include` 路径解析需要处理 `"local.h"` 和 `<system/header.h>` 两种形式

### Step 4：Svelte 解析（约 20 分钟）

**策略**：ROADMAP P6 已定 — "提取 `<script>` 块，regex 级解析"。

**实现**：
1. 在 `polyglot.js` 或新建 `svelte.js` 中写 `parseSvelte(content, filePath)`：
   - 用 regex 提取 `<script[^>]*>([\s\S]*?)</script>`
   - 传给 `parseJavaScript(scriptContent, filePath)`
   - 返回 Record Schema
2. 在 `PARSER_REGISTRY` 加：`{ exts: ['.svelte'], parser: parseSvelte }`
3. 写 `test/svelte-parser-test.js`

**注意**：Svelte 的隐式导出和 Vue `<script setup>` 类似，但 Svelte 的 `<script>` 块里通常有显式 `export let prop`，所以 `parseJavaScript` 能正常识别 exports。

### 语言注册表使用方式（新增第 N 种语言的 SOP）

注册表重构完成后，新增一种语言的步骤固定为：

1. **写 parser 函数** — 返回 Record Schema：`{ imports, exports, importRecords, exportRecords, functionRecords, parseMode }`
2. **在 `PARSER_REGISTRY` 加一行** — `{ exts: ['.xxx'], parser: parseXxx }`
3. **补测试** — `test/xxx-parser-test.js`
4. **跑全量测试** — `node test/runner.js`

### 验收标准

- `node test/runner.js` 全绿
- 新增 3 个 parser 测试文件（vue / cpp / svelte）
- `audit-map --compact --cwd .` 能正确识别 `.vue` / `.cpp` / `.svelte` 文件的角色
- ROADMAP P4 "插件化解析器注册表" 标记为 ✅ 已完成
- ROADMAP P6 C/C++ / Vue / Svelte 标记为 ✅ 已完成

### 约束

- **不引入 tree-sitter**（AGENTS.md 已确认）
- **不引入新 npm 依赖**
- **Vue/Svelte 复用现有 `parseJavaScript`**，不重新实现 JS AST 解析
- **每完成一个 Step → 跑全量测试确认无新增失败**

---

*Last updated: 2026-05-04（本轮：watch/audit-diff compact + REPL issues/top + staleness 检测交付 + 6 项债务修复，47/47 PASS，新增"新会话指令 B：注册表重构 + P6 语言扩展"）*
