# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（必须执行）

```bash
# 1. 验证测试基线
node test/runner.js          # 期望: 70/70 PASS

# 2. 验证自审基线
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExportCount=0, unresolvedCount=0, cycleCount=0, totalFiles≈140

# 3. 验证大项目 compact 可用性
node cli.js audit-map --cwd reference/GitNexus/gitnexus --compact --json --quiet
# 期望: 输出行数 < 1000, summary.severity 存在, highlightedFiles 按问题严重程度排序
```

**如果任何一步失败 → 先修基线，再做其他事。**

---

## 基线状态

- 测试：**70/70 PASS**
- 版本：**v1.1.0**（以 `package.json` 为准）
- 分支：`main`，已 push origin
- 自身项目规模：139 文件，entry=4, library=52, test=71, script=12
- 健康度：5/5，0 死导出，0 循环，0 未解析
- cache 一致性：✅ 已修复（删除文件后无 ghost 数据）
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**（C/C++ AST 已于 2026-05-06 交付）
- **本轮新增**：框架感知 Extractor（GitNexus 模式 C）、AST Cache 防御性上限 + Query.delete()、health fixes、audit-file validationAdvice

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
| `framework-patterns.js` 新增框架时 | `src/services/dep-graph/framework-patterns.js` | 路径检测逻辑按语言分块，新增语言需同时更新 `isEntry` 标记和测试 |
| `buildFileValidationAdvice` 导出链 | `validation-advice.js` → `index.js` → `cli.js` | 新增 formatter 函数必须在 `src/cli/formatters/index.js` 中显式导出，否则 cli.js 解构为 `undefined` |

---

## 新会话指令（给下一轮 AI）

### 前置检查

1. 跑 `node test/runner.js` 确认基线绿色（当前 70/70 PASS；若 `repl-test.js` 偶发失败，单独重跑该文件确认）。
2. 跑 `node cli.js audit-summary --cwd . --json --quiet` 确认 healthScore=5/5。注意：测试运行后会生成 `fixture-temp/` 临时目录，此时 totalFiles 会临时增加至 ~144，清理后恢复为 ~139。

### 本轮已完成（GitNexus 对比补全 + 产品缺口）

**模式 C：框架感知 Extractor** ✅
- 新建 `src/services/dep-graph/framework-patterns.js`（~200 行）
- 翻译 GitNexus `framework-detection.ts` 核心路径模式，裁剪为 workspace-bridge 9 种语言
- `detectFrameworkFromPath()` + `detectFrameworkFromContent()` 双路径检测
- `dep-graph.js` `isKnownEntryFile()` 集成框架检测，消除框架入口文件 dead-export 误报
- `audit-diff` / `audit-file` JSON 输出新增 `frameworkPattern` 字段
- 测试：`test/framework-patterns-test.js`

**模式 F：AST Cache 加固** ✅
- `tree-sitter.js` `languageCache` 增加防御性大小上限（`MAX_LANGUAGE_CACHE_SIZE = 12`），超限淘汰时调 `lang.delete()`
- 4 个 AST parser（go/rust/kotlin/cpp）`finally` 块中补 `query.delete()`，消除 WASM 内存泄漏
- 测试：现有 AST parser 测试全部通过

**产品功能缺口 — health fixes** ✅
- `src/tools/health-tools.js` 新增 `FIX_SUGGESTIONS` 配置表
- `projectHealth()` 输出新增 `fixes` 数组：`[{ check, action, severity }]`
- 仅对未通过的 check 生成建议，AI 可直接消费

**产品功能缺口 — audit-file validationAdvice** ✅
- `src/cli/formatters/validation-advice.js` 新增 `buildFileValidationAdvice(filePath, workspaceRoot)`
- 轻量版：检测 stack → 推断 changeType → 调用 `generateCommands()` → 去重返回
- `cli.js` `audit-file` 输出新增 `validationAdvice` 字段
- 测试：`test/audit-file-validation-advice-test.js`

**产品功能缺口 — impact paths** ✅（经确认已在 0.9.0 交付）
- `impact` 命令 JSON 输出中的 `via` 数组即完整影响路径，无需额外 `paths` 字段

**性能瓶颈（ROADMAP P0/P1）** ✅
- `isKnownEntryFile()` 只读前 256 字节 — `fs.openSync` + `fs.readSync` 替代 `fs.readFileSync`，消除大文件全量读取
- `resolvers.js` 同步 I/O 缓存 — 模块级 `_statCache` LRU（上限 2000），`DependencyGraph.build()` 自动刷新
- `cli.js` 超大 JSON 分块写入 — `writeLargeJson()` 64KB 分块 + `setImmediate` 让出；>1MB 时 stderr 提示 `--compact`

**用户体验缺口** ✅
- `impact` human-readable 输出展示 `via` 路径 — `formatHuman` impact case 新增 via 链
- `Unknown command` 后提示 `--help`
- `--quiet` 模式下初始化失败输出完整 `err.stack`

**GitNexus 模式 D — 递进工具链文案** ✅
- `cli.js` 新增 `COMMAND_GUIDES` 配置表，覆盖 19 个命令，`--help <command>` 输出 WHEN TO USE / AFTER THIS
- `affected-tests` 描述补全
- AGENTS.md 核心命令表 + 原子命令表增加 WHEN TO USE / AFTER THIS 列

### 下一步方向（按价值排序）

**GitNexus 高价值模式剩余**：
- **模式 A：语言注册表重构** — `defineLanguage()` 统一接口，2–3 天

**用户体验缺口**：
- `impact` 命令 human-readable 输出未展示 `via` 路径（JSON 已有，formatter 未展示）
- `--quiet` 模式下初始化失败根因丢失
- `Unknown command` 后未提示 `--help`

### 新增第 N 种语言的 SOP（已验证，未来复用）

1. **写 parser 函数** — 返回 Record Schema：`{ imports, exports, importRecords, exportRecords, functionRecords, parseMode }`
2. **在 `PARSER_REGISTRY` 加一行** — `{ exts: ['.xxx'], parser: parseXxx }`
3. **补测试** — `test/xxx-parser-test.js`
4. **更新 file-index** — `getFilePatterns()` 加入对应扩展名
5. **跑全量测试** — `node test/runner.js`

---

## 下一会话指令（模式 A：语言注册表重构）

> **目标**：把新增语言从"改 3 个文件"降到"改 1 个文件"。
> **参考**：AGENTS.md §Reference 与架构取舍 → GitNexus 模式 1（语言注册表）。

### 前置检查（必须执行）

```bash
node test/runner.js          # 期望: 70/70 PASS
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExports=0, unresolved=0, cycles=0, totalFiles≈138
```

### 任务：模式 A — `defineLanguage()` 统一接口

**Step 1：实现注册表基础设施** ✅ 骨架已新建 `src/services/dep-graph/parsers/registry-core.js`
- 确认 `defineLanguage()` + `LanguageRegistry` 接口不变
- `register()` / `findByExt()` / `getAllExts()` / `getFilePatterns(workspace)`

**Step 2：新建 `src/services/dep-graph/parsers/registry.js`**
- 引入 `registry-core.js`
- 引入全部 9 个 parser 函数
- 用 `defineLanguage()` 注册 9 种语言，配置包含：`name, exts, parser, async, needsFilePath, filePatterns, condition`
- `condition` 函数对应 `file-index.js` 原 `getFilePatterns()` 中的 workspace 特征判断
- 导出 `const registry = new LanguageRegistry()`

**Step 3：重构 `src/services/dep-graph.js`**
- 删除 `PARSER_REGISTRY` 硬编码数组
- 改为 `const { registry } = require('./dep-graph/parsers/registry');`
- `analyzeFile()` 中 `PARSER_REGISTRY.find(...)` → `registry.findByExt(ext)`

**Step 4：重构 `src/services/file-index.js`**
- 引入 `const { registry } = require('../dep-graph/parsers/registry');`
- `getFilePatterns()` 方法体替换为 `return registry.getFilePatterns(this.workspace);`
- 保留 fallback 语义（注册表内部已处理）

**Step 5：更新 `src/services/dep-graph/parsers/index.js`**
- 保留各 parser 独立导出（外部测试/脚本可能直接引用）
- 新增导出 `const { registry, defineLanguage, LanguageRegistry } = require('./registry');`
- 使 `parsers/index.js` 成为 parser + registry 的统一入口

**Step 6：验证**
- `node test/runner.js` 70/70 PASS
- `node cli.js audit-summary --cwd . --json --quiet` healthScore=5/5
- 新增一个 dummy 语言注册，确认只改 `registry.js` 一处即可

### 关键文件清单

| 文件 | 操作 | 原因 |
|------|------|------|
| `src/services/dep-graph/parsers/registry-core.js` | 确认/微调 | 基础设施，已新建 |
| `src/services/dep-graph/parsers/registry.js` | **新建** | 9 种语言统一注册 |
| `src/services/dep-graph.js` | 修改 | 删除 `PARSER_REGISTRY`，用 `registry.findByExt` |
| `src/services/file-index.js` | 修改 | `getFilePatterns()` 委托给 registry |
| `src/services/dep-graph/parsers/index.js` | 修改 | 导出 registry |

### 风险点

- `file-index.js` 引入 `parsers/registry.js` 是否产生循环依赖？**否** — registry 不引用 file-index。
- `condition(workspace)` 函数必须与 `file-index.js` 原 `getFilePatterns()` 逻辑逐条对齐，否则会导致某些语言文件漏扫。
- `needsFilePath` 和 `async` 标志必须保留，否则 `analyzeFile()` 的参数传递会崩溃。

---

*Last updated: 2026-05-06*
