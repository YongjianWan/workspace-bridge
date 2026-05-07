# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（必须执行）

```bash
# 1. 验证测试基线
node test/runner.js          # 期望: 80/80 PASS

# 2. 验证自审基线
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExportCount=0, unresolvedCount=0, cycleCount=0, totalFiles≈154

# 3. 验证大项目 compact 可用性
node cli.js audit-map --cwd reference/GitNexus/gitnexus --compact --json --quiet
# 期望: 输出行数 < 1000, summary.severity 存在, highlightedFiles 按问题严重程度排序
```

**如果任何一步失败 → 先修基线，再做其他事。**

---

## 基线状态

- 测试：**80/80 PASS**
- 版本：**v1.1.0**（以 `package.json` 为准）
- 分支：`main`，已 push origin
- 自身项目规模：154 文件，entry=1, library=60, test=81, script=12
- 健康度：5/5，0 死导出，0 循环，0 未解析
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**

**本轮状态**：P2/P6 Java 后端复明 + P28 hotspot 修复 + 5 项 L2 修复（L2-19~L2-29）。历史详情见 CHANGELOG.md [Unreleased]。

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
| `--quiet` 不再 monkey-patch `console.error` | `cli.js` / `container.js` | `quiet` 通过 `ServiceContainer` → `FileIndex` / `DependencyGraph` 传递；信息性日志条件输出，错误日志仍用 `console.error` |
| `findDeadExports()` edges/files 降级 | `src/services/dep-graph.js` | 单文件项目（files=1）不受降级影响；多文件项目 edges/files < 0.1 时 confidence 降为 low |
| `.workspace-bridge-cache.json.bak` 泄漏到 git status | `src/tools/git-tools.js` | `getChangedFiles()` 已排除 `.bak` 备份文件，防止 audit-diff 误报 |

---

## 下一步方向

> 活跃问题见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。历史已修复条目不重复记录。

### 本轮聚焦（框架隐式依赖插件化）

**架构决策**：新增 `Scanner → Extractor → Applier` 统一流水线，把框架特殊调用模式（如 Vue Router 懒加载、全局组件注册）产生的**隐式依赖**注入依赖图。

**不是"迁移硬编码 if-else"，而是"新增一层能力"**。当前代码对这 4 种模式完全未处理，所以产生 orphan/dead-export 误报。

**首批实现（2 种）**：
1. **Vue Router 懒加载** — 扫描路由配置文件，正则提取 `component: () => import('@/views/xxx')`，建立 router → page 的隐式边
2. **Vue 全局组件注册** — 扫描入口文件，提取 `Vue.component('SvgIcon', ...)`，按命名约定映射到 `components/SvgIcon/index.vue`

**占位留接口（2 种）**：
3. Vue 自定义指令 — 需要模板扫描，当前 extractor 返回 `[]`
4. 动态字符串调用 — 需要语义分析，当前 extractor 返回 `[]`

**后续扩展成本**：React `lazy(() => import(...))`、Angular `loadChildren` 只需注册一行 `{ scanner, extractor }` 配置，流水线全部复用。

**核心文件**：
- 新建 `src/services/dep-graph/framework-usage-patterns.js` — 配置表 + 流水线
- 修改 `src/services/dep-graph.js` — `build()` 后增加 `applyFrameworkImplicitImports()` 阶段
- 修改 `src/utils/orphan-detector.js` — 双源判断（显式依赖 + 隐式依赖）

### 活跃技术债（按价值排序）

| 编号 | 问题 | 文件 |
|------|------|------|
| L2-12 | `--exclude` 只影响 scope 计数，不影响分析结果 | `src/services/file-index.js` |
| P1/P63 | Vue 假阳性三角（dead-export + orphan） | `dep-graph.js` / `orphan-detector.js` |
| P18/P19/P25 | 建议模板化，不区分项目实际特征 | `overview-tools.js` / `validation-advice.js` |
| P20 | 命令输出没有"误报率预估"或"诚实度"标注 | 多个 formatter |
| P33 | 两个前端项目输出高度模板化 | `overview-tools.js` |
| P39 | `audit-file` severity 反映影响范围而非代码质量 | `dep-tools.js` |
| P64 | Health 建议命令脱离实际技术栈 | `health-tools.js` |

---

*Last updated: 2026-05-07（SESSION.md 清理历史信息，只存当前上下文）*
