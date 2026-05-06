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
- 版本：**v1.0.8**
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

### 下一步方向（按价值排序）

**性能瓶颈（ROADMAP P0/P1，大项目体验）**：
1. `resolvers.js` 同步 I/O 风暴 — JS import 解析 20× `fs.existsSync` 无缓存
2. `cli.js` `JSON.stringify` 阻塞事件循环 — 大项目 audit-map 100MB+ 对象
3. `isKnownEntryFile()` 读整个文件 — 可只读前 256 字节

**GitNexus 高价值模式剩余**：
- **模式 D：递进工具链文案**（WHEN TO USE / AFTER THIS）— 改 `cli.js` help string + AGENTS.md 命令表，1 小时
- **模式 A：语言注册表重构** — `defineLanguage()` 统一接口，2–3 天，等性能瓶颈处理后再做

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

*Last updated: 2026-05-06*
