# 会话交接指令

> 生成时间：2026-04-29
> 当前版本：v0.8.2+
> 会话主题：系统性 bug 扫荡（孤儿检测 / 耦合建议 / 安全 / 缓存 / 路径）

---

## 1. 项目当前状态

**workspace-bridge** 是 CLI-first 工作区分析引擎，当前 v0.8.2+。

### 已完成（本轮）

| 事项 | 状态 | 关键文件 | 说明 |
|------|------|----------|------|
| P0T5 内部函数→测试映射 | ✅ | `function-impact.js` DFS 调用链 + `cli.js` mode 识别 | 3614e16 |
| P3 CJS 符号解析补全 | ✅ | `parsers.js` `module.exports = { fn }` + `symbol-impact.js` `buildFunctionToDependents` | 3614e16 |
| P1.5 `audit-map` 全局地图 | ✅ | `audit-formatters.js` `buildProjectMap()` + `cli.js` case | a3ad106 |
| JS/TS `functionRecords` 索引 | ✅ | `parsers.js` 收集所有 `FunctionDeclaration`/`FunctionExpression` + callCallees | 3614e16 |
| **resolveJavaScriptImport 目录截断** | ✅ | `resolvers.js` `resolveJavaScriptImport()` | 跳过目录候选，优先返回文件；无 index 时返回 null |
| **audit-map tree 目录聚合** | ✅ | `audit-formatters.js` `buildDirectoryTree()` | tree 从扁平数组改为按目录聚合的树结构 |
| **audit-map deadExports confidence** | ✅ | `audit-formatters.js` `buildProjectMap()` | issueOverlay.deadExports 保留 confidence 字段 |
| **audit-map hotspots** | ✅ | `audit-formatters.js` `buildProjectMap()` | issueOverlay 新增依赖中心性 hotspots（dependentCount >= 5） |
| **toRelativePath 边界校验** | ✅ | `audit-formatters.js` `toRelativePath()` | 增加 root 边界检查，防止 `/repo-extra` 被截断为 `extra` |
| **audit-map human files 计数** | ✅ | `cli.js` `countTreeFiles()` | `formatHuman` 正确统计目录树中的文件数量 |
| **staged 分支绕过 isTempFile** | ✅ | `git-tools.js` `getChangedFiles()` | staged 模式也过滤 `.tmp-*` 和 cache 临时文件 |
| **getChangedLineRanges staged/unstaged 合并** | ✅ | `git-tools.js` `getChangedLineRanges()` | 根据 `staged` 选项只取对应 diff，不再合并两者 |
| **detectTestConfig 不认 package.json test** | ✅ | `health-tools.js` `detectTestConfig()` | 识别 `package.json` `scripts.test` 为 `custom-node-scripts` |
| **runDiagnostics 缓存吞结果** | ✅ | `cache.js` `getAllDiagnostics()` + `workspace-tools.js` | 缓存分支正确返回诊断数据和统计，不再置空 |
| ~~ReDoS 过滤器漏洞~~ | ✅ 核实无需修复 | `search-tools.js` `containsReDoSPattern()` | 当前正则 `\([^()]*[+*][^()]*\)[+*]` 已正确拦截嵌套量词 |
| **runDiagnostics 缓存快路径永远进不去** | ✅ | `container.js` `cache.setWorkspaceInfo()` | `initialize()` 后设置 workspaceInfo，使缓存命中路径生效 |
| **孤儿检测路径匹配错误** | ✅ | `overview-tools.js` `findOrphanFiles()` | `includes('/scripts/')` 不匹配根级 `scripts/foo.js`，改为 `startsWith\|\|includes` |
| **耦合拆分建议模板化** | ✅ | `overview-tools.js` `buildCouplingSplitSuggestions()` | 按 role + 出入度生成针对性建议（entry/utility/consumer/script/test/config） |
| **detectTestConfig 不认 test:* 脚本** | ✅ | `health-tools.js` `detectTestConfig()` | 同步 `stack-detector.js` 逻辑，识别 `key === 'test' \|\| key.startsWith('test:')` |
| **reverseGraph 重复 dependents** | ✅ | `dep-graph.js` `buildReverseGraph()` | 同一文件多 import（如 `import {a}` 和 `import {b}` from './foo'）导致 inDegree 虚高 |
| **classifyChangeType 路径匹配遗漏** | ✅ | `audit-formatters.js` `classifyChangeType()` | 根级 `test/`、`scripts/` 路径未被后备分支识别 |
| **isSafePath 路径遍历漏洞** | ✅ | `diagnostics-engine.js` `isSafePath()` | `startsWith()` 把 `workspace-extra` 误判为在 workspace 内；改为 `path.relative()` 检查 |
| **resolvePythonCommand 引号包裹** | ✅ | `path.js` `resolvePythonCommand()` | 返回 `"C:\path"` 导致 `spawn()` 将其视为带引号的字面文件名而失败 |
| **cache getStats diagnostics 计数错误** | ✅ | `cache.js` `getStats()` | `.flat()` 对 `{mtime, diagnostics}` 对象无效，计数永远为 0 |
| **getUnusedExports 死代码** | ✅ | `dep-graph.js` 删除 `getUnusedExports()` | 逻辑错误（检查路径包含符号名）且无人调用 |

### 待完成（按 ROADMAP 价值排序）

| 任务 | 优先级 | 说明 |
|------|--------|------|
| P1 Java/Go/Rust 使用点解析 | P1 | 消除 dead-export 系统性误报（实例调用不在 import 记录中） |
| P3 影响路径解释字段 | P1 | `impact` 数组增加 `reason` + `importedSymbols` + `via` |
| P3 变更影响解释链（聚合） | P1 | `audit-diff` 输出可读因果链 |
| P2 构建/测试命令智能化 | P2 | Gradle 任务发现、Go package 聚合、Rust workspace 子 crate |
| ~~P3 耦合拆分建议去模板化~~ | ✅ 已完成 | `audit-overview` `couplingSplitSuggestions` 已按出入度生成针对性建议 |
| P4 Kotlin AST / 大仓库性能 / 注册表 | P3 | 技术债，不急 |

### 已知缺陷（本轮 Code Review 发现，下轮优先修）

| 评级 | 问题 | 落点 | 修复投入 | 阻塞 |
|------|------|------|----------|------|
| ~~HIGH~~ | ~~audit-map 漏掉 re-export 边~~ | ✅ 已确认当前代码从 `importRecords` 读取，`re-export` 边正常生成 | — | — |
| ~~HIGH~~ | ~~audit-map 同 `from\|to` 边去重丢失符号信息~~ | ✅ `edgeMap` 合并 symbols 是设计行为，同对文件多 import 合并为一条带全 symbols 的边 | — | — |
| ~~HIGH~~ | ~~resolveJavaScriptImport 目录截断~~ | ✅ `resolvers.js` 遍历 candidates 时跳过目录，fallback 返回 null 而非目录路径 | — | — |
| ~~MEDIUM~~ | ~~audit-map re-export 边缺 `to` 字段~~ | ✅ 当前 re-export 边已包含 `to` 字段 | — | — |
| ~~MEDIUM~~ | ~~audit-map human 输出 `workspaceRoot: undefined`~~ | ✅ `buildProjectMap()` 返回 `workspaceRoot: root`，实测输出正确 | — | — |
| ~~MEDIUM~~ | ~~audit-map `tree` 是扁平数组~~ | ✅ 已改为 `buildDirectoryTree()` 目录聚合结构 | — | — |
| ~~MEDIUM~~ | ~~audit-map `deadExports` 丢掉 confidence~~ | ✅ issueOverlay 已保留 confidence | — | — |
| ~~LOW~~ | ~~audit-map `issueOverlay` 未包含 hotspots~~ | ✅ 已新增基于依赖中心性的 hotspots | — | — |
| ~~LOW~~ | ~~`toRelativePath()` 边界校验~~ | ✅ 已增加 root 边界检查 | — | — |
| ~~MEDIUM~~ | ~~staged 分支绕过 `isTempFile()`~~ | ✅ `getChangedFiles()` staged 分支已加 `isTempFile` 过滤 | — | — |
| ~~MEDIUM~~ | ~~`getChangedLineRanges()` 合并 staged+unstaged~~ | ✅ 已改为根据 `staged` 选项只取对应 diff | — | — |
| ~~MEDIUM~~ | ~~`detectTestConfig()` 不认 `package.json` test script~~ | ✅ 已识别 `scripts.test` 并返回 `custom-node-scripts` | — | — |
| ~~MEDIUM~~ | ~~`runDiagnostics()` 缓存吞结果~~ | ✅ `cache.getAllDiagnostics()` 正确展平 Map，`runDiagnostics` 返回缓存数据 | — | — |
| ~~LOW~~ | ~~ReDoS 过滤器漏洞~~ | ✅ 当前正则已正确拦截 `(a+)+` / `(a*)*` | — | — |
| ~~MEDIUM~~ | ~~`runDiagnostics()` 缓存快路径永远进不去~~ | ✅ `container.js` 已加 `setWorkspaceInfo()` 调用 | — | — |
| ~~MEDIUM~~ | ~~孤儿检测路径匹配错误~~ | ✅ `startsWith('scripts/')` 已补全 | — | — |
| ~~MEDIUM~~ | ~~耦合拆分建议模板化~~ | ✅ 已按 role + 出入度生成针对性建议 | — | — |
| ~~MEDIUM~~ | ~~`detectTestConfig()` 不认 `test:*` 脚本~~ | ✅ 已同步 `stack-detector.js` 逻辑 | — | — |
| ~~LOW~~ | ~~`reverseGraph` 重复 dependents~~ | ✅ 已去重 | — | — |
| ~~LOW~~ | ~~`classifyChangeType()` 路径匹配遗漏~~ | ✅ 已补全 `startsWith` | — | — |
| ~~HIGH~~ | ~~`isSafePath()` 路径遍历漏洞~~ | ✅ 已改为 `path.relative()` 检查 | — | — |
| ~~MEDIUM~~ | ~~`resolvePythonCommand()` 引号包裹~~ | ✅ 已移除引号 | — | — |
| ~~LOW~~ | ~~`cache.getStats()` diagnostics 计数错误~~ | ✅ 已正确遍历 `{mtime, diagnostics}` 结构 | — | — |
| ~~LOW~~ | ~~`getUnusedExports()` 死代码~~ | ✅ 已删除 | — | — |

---

## 2. 快速验证命令

```bash
# 全量回归（21 项，必须绿）
npm run test:all

# 官方自审（~25s）
npm run self-audit

# P1.5 验收
node cli.js audit-map --cwd . --json --quiet

# P0T5 验收（需临时改 resolvers.js 内部函数）
node cli.js audit-diff --cwd . --json --quiet

# 孤儿检测验收
node cli.js audit-overview --cwd . --json --quiet

# 性能基准
npm run benchmark:perf
```

---

## 3. 关键代码落点

### P0T5：内部函数调用链追溯
- `src/services/dep-graph/parsers.js` — `functionRecords`（所有函数定义 + `callCallees`）
- `src/services/dep-graph/function-impact.js` — `getChangedFunctionImpact()` DFS 向上追溯导出调用者
- `src/services/dep-graph/symbol-impact.js` — `buildFunctionToDependents()` 同时参考 `functionRecords`
- `cli.js` — `internal-function-call-chain` mode 触发 `functionLevelAffectedTests`

### P3：CJS 导出识别
- `src/services/dep-graph/parsers.js` — `visitNode()` 中 `AssignmentExpression` 分支识别 `module.exports = { fn }` / `exports.fn = ...`

### P1.5：全局项目地图
- `src/cli/audit-formatters.js` — `buildProjectMap()` 聚合 tree + edges + issueOverlay
- `cli.js` — `audit-map` case 调用 `buildProjectMap(container.depGraph)`

### 本轮修复（commit `f8c291e`）
- `src/services/dep-graph/resolvers.js` — `resolveJavaScriptImport()` 目录截断修复
- `src/cli/audit-formatters.js` — `toRelativePath()` 边界校验 + `buildDirectoryTree()` 目录聚合 + deadExports confidence + hotspots
- `cli.js` — `countTreeFiles()` 适配目录树 human 输出
- `test/audit-map-test.js` — 5 项测试覆盖目录树 / confidence / re-export / hotspots / 边界校验

### 本轮修复（commit `b8683ea` + 当前轮次）
- `src/tools/git-tools.js` — staged 分支 `isTempFile` 过滤 + `getChangedLineRanges()` staged/unstaged 分离
- `src/tools/health-tools.js` — `detectTestConfig()` 识别 `package.json` `scripts.test` 及 `test:*`
- `src/services/cache.js` — 新增 `getAllDiagnostics()` 方法 + 修复 `getStats()` diagnostics 计数
- `src/tools/workspace-tools.js` — `runDiagnostics()` 缓存分支正确返回诊断数据
- `test/phase01-quality-test.js` — 新增 `testTempFileFilterStaged` + `testDetectTestConfigFromPackageJson`
- `test/git-line-ranges-test.js` — 新增 staged/unstaged 分离测试
- `test/diagnostics-cache-test.js` — 新增缓存返回数据 + 空缓存穿透测试
- `test/container-workspace-info-test.js` — 验证 `ServiceContainer.initialize()` 设置 `workspaceInfo`

### 本轮修复（系统性 bug 扫荡）
- `src/tools/overview-tools.js` — `findOrphanFiles()` 路径匹配 + `generateCouplingSplitPlan()` 去模板化
- `src/services/dep-graph.js` — `buildReverseGraph()` 去重 + 删除 `getUnusedExports()` 死代码
- `src/cli/audit-formatters.js` — `classifyChangeType()` 根级路径匹配补全
- `src/services/diagnostics-engine.js` — `isSafePath()` 路径遍历漏洞修复
- `src/utils/path.js` — `resolvePythonCommand()` 移除引号包裹

### 已知限制（未变）
- `parsers.js` 876 行，唯一超 500 行铁律的文件，后续应拆成按语言的 dispatch 表
- `src/services/dep-graph.js` 711 行，接近上限

---

## 4. 下轮建议

**首选：P1 Java/Go/Rust 使用点解析**
- 问题：实例调用 `foo.bar()` 不在 import 记录中，导致 dead-export 系统性误报
- 思路：轻量扫描符号使用（不需要完整 AST），标记被使用过的符号不判为 dead-export
- 落点：`src/services/dep-graph.js` `findDeadExports()`
- 验收：`audit-summary` 的 deadExports 数量对本项目更合理（当前 1 个 `logger.js`，需判断是否为真误报）

**次选：P3 影响路径解释字段**
- 问题：`impact` 数组只有 `file` 和 `level`，没有 `why`
- 思路：`getImpactRadius()` 增加 `reason` + `importedSymbols` + `via` 字段
- 落点：`src/services/dep-graph.js` `getImpactRadius()`

---

## 5. 架构决策

### 5.1 外部工具集成策略（不变）

| 维度 | 策略 | 理由 |
|------|------|------|
| 依赖图 | **自研** | 多语言统一是壁垒 |
| 增量分析 | **自研** | git diff 驱动 <200ms 是护城河 |
| 风格/质量 | **自研 + Semgrep 可选** | 你管格式，Semgrep 管规则库 |
| 精确影响/污点 | **CodeQL 后端 + adapter** | 承认打不过 |
| tree-sitter | **不引入** | Python 标准库 `ast` 已够用；native binding 放大 Windows 中文路径风险 |

### 5.2 文件拆分（待执行）

- `parsers.js` 876 行，唯一超 500 行铁律的文件
- 建议拆成按语言的 dispatch 表（`src/parsers/js.js`、`python.js`、`java.js`...），但等 P1（使用点解析）稳定后再拆，避免图逻辑变动时跨文件重构

---

## 6. 本轮教训

1. **问题描述必须精确** — P0T5 最初描述为 "affectedTests 为 0"，实际为 "functionLevelAffectedTests 为 0"。文件级 affectedTests 通过依赖图一直正常工作。描述不精确会导致解法方向误判。
2. **P0T5 依赖 P3 才能闭环** — `resolvers.js` 使用 CJS `module.exports`，没有 CJS 导出识别，调用链追溯找不到导出终点。两个任务耦合，必须同轮完成。
3. **测试 mock 数据必须真实** — `test/p0t5-internal-function-impact-test.js` 最初 `functionRecords` 缺少 `kind` 字段，测试通过但真实场景失败。mock 数据应与生产产出一致。
4. **Windows 路径大小写陷阱** — `workspaceRoot` 是 `C:\...`（大写），graph key 是 `c:/...`（小写），`startsWith` 直接失败。路径比较必须 `toLowerCase()`。
5. **PowerShell 管道输出 UTF-16 LE** — `node cli.js ... > file.json` 在 PowerShell 中输出 UTF-16 LE BOM，JSON.parse 失败。验证脚本应使用 `fs.writeFileSync` 或 `execSync` + Node.js 处理。
6. **StrReplaceFile 多段替换要精确匹配** — 本轮 `buildProjectMap` 的 return 语句被替换插入到中间，导致语法错误。多段替换时目标字符串必须精确到上下文边界，避免错位。
7. **startsWith 不能替代路径安全判断** — `isSafePath()` 最初用 `startsWith` 判断文件是否在 workspace 内，`workspace-extra` 被误判为安全。路径 containment 必须用 `path.relative()`。
8. **spawn 参数不需要手动加引号** — `resolvePythonCommand()` 返回 `"C:\path"`，`spawn()` 把引号当作文件名的一部分。命令参数数组本身已防注入，无需额外引号。
9. **注意对象结构再调用数组方法** — `cache.getStats()` 对 `{mtime, diagnostics}` 对象调用 `.flat()`，结果永远是原数组（对象不是数组），计数错误。读取嵌套结构前先确认类型。
10. **删除死代码时确认无人调用** — `getUnusedExports()` 逻辑完全错误，全仓 grep 确认零调用后才删除。

---

*Last updated: 2026-04-29*

## 18. 本轮审查新增

1. `search-tools.js` 的 ReDoS 过滤器有实证漏洞：`validateQuery('(a+)+')`、`validateQuery('(a*)*')` 都返回 `valid: true`，说明 `containsReDoSPattern()` 的危险模式匹配写错了，典型嵌套量词没有被拦住。
2. `getChangedFiles()` 的 staged 分支绕过了 `isTempFile()` 过滤，若临时文件被 staged，`audit-diff` 会把本该忽略的 `.tmp-*` / `*.workspace-bridge-cache.json.tmp-*` 带进结果。
3. `getChangedLineRanges()` 无论 `options.staged` 取什么值都会把 staged diff 和 unstaged diff 一起合并；而 `audit-diff` 目前固定传 `staged: false`，这会让工作区未暂存分析意外混入已暂存修改。

## 19. 本轮审查继续补充

1. `health-tools.js` 的 `detectTestConfig()` 只认框架配置文件，不认 `package.json` 里的 test script；当前仓库明明有 `package.json:test`，`projectHealth()` 仍然返回 `testConfig.found = false`，导致 `healthScore` 少算一项。
2. `runDiagnostics()` 命中缓存后直接返回 `diagnosticsSummary: { total: 0, ... }`，同时把 `diagnostics` 和 `results` 置空；`cache` 分支不是复用结果，而是把已有诊断结果吞掉了。

## 20. 本轮审查新增

1. ~~`src/services/cache.js` 新增的 `getAllDiagnostics()` 和真实存储结构不匹配~~ ✅ 已修复。`getDiagnostics()` 和 `getAllDiagnostics()` 现在正确读取 `{ mtime, diagnostics }` 结构中的 `diagnostics` 数组。

## 21. 本轮审查继续补充

1. ~~`audit-diff` 对 staged-only 文件会丢失函数级影响~~ ✅ 已修复。`cli.js` `audit-diff` 现在对每个文件同时获取 staged 和 unstaged 的 line ranges，合并去重后喂给 `changedFunctionImpact`，staged-only 文件不再丢失函数级影响。

## 22. 本轮审查继续补充

1. ~~`runDiagnostics()` 的缓存快路径实际上永远进不去~~ ✅ 已修复。`ServiceContainer.initialize()` 中 `cache.load()` 后增加 `this.cache.setWorkspaceInfo({ root: this.workspaceRoot })`，使 `runDiagnostics()` 的 `container.cache.getWorkspaceInfo()` 能命中。
2. 验证：`new WorkspaceCache('.').getWorkspaceInfo()` 默认就是 `null`，而全仓检索不到生产代码调用 `setWorkspaceInfo()`。

## 23. 本轮系统性 bug 扫荡（新会话）

1. ~~`findOrphanFiles()` 路径匹配错误~~ ✅ 已修复。`includes('/scripts/')` 不匹配根级 `scripts/foo.js`；改为 `startsWith('scripts/') || includes('/scripts/')`（bin 同理）。
2. ~~`buildCouplingSplitSuggestions()` 10 条相同模板~~ ✅ 已修复。新增 `generateCouplingSplitPlan(role, coupling)`，按 entry/utility/consumer/script/test/config 生成针对性建议。
3. ~~`detectTestConfig()` 不认 `test:*` 脚本~~ ✅ 已修复。同步 `stack-detector.js` 的 `key === 'test' || key.startsWith('test:')` 逻辑。
4. ~~`buildReverseGraph()` 重复 dependents~~ ✅ 已修复。同一文件多 import 产生 duplicate reverse-graph 条目；增加 `seen` Set 去重。
5. ~~`classifyChangeType()` 根级路径匹配遗漏~~ ✅ 已修复。同 bug 1 模式，补全 `startsWith('test/')` 和 `startsWith('scripts/')`。
6. ~~`isSafePath()` 路径遍历漏洞~~ ✅ 已修复。`startsWith()` 把 `workspace-extra` 误判为在 workspace 内；改为 `path.relative()` 检查。
7. ~~`resolvePythonCommand()` 引号包裹~~ ✅ 已修复。返回 `"C:\path"` 导致 `spawn()` 失败；移除引号。
8. ~~`cache.getStats()` diagnostics 计数错误~~ ✅ 已修复。`.flat()` 对 `{mtime, diagnostics}` 对象无效；改为遍历累加 `diagnostics.length`。
9. ~~`getUnusedExports()` 死代码~~ ✅ 已删除。逻辑错误且全仓零调用。
