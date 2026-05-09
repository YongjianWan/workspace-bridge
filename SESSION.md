# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（必须执行）

```bash
# 1. 验证测试基线
node test/runner.js          # 期望: 84/84 PASS

# 2. 验证自审基线
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExportCount=15, unresolvedCount=0, cycleCount=0, totalFiles≈159, analysisCoverage.coverageRatio=1

# 3. 验证大项目 compact 可用性
node cli.js audit-map --cwd reference/GitNexus/gitnexus --compact --json --quiet
# 期望: 输出行数 < 1000, summary.severity 存在, highlightedFiles 按问题严重程度排序
```

**如果任何一步失败 → 先修基线，再做其他事。**

---

## 基线状态

- 测试：**84/84 PASS**
- 版本：**v1.1.1**（以 `package.json` 为准）
- 分支：`main`，已 push origin（领先 origin/main 3 提交）
- 自身项目规模：159 文件，entry=1, library=60, test=85, script=12, unknown=1
- 健康度：5/5，15 dead exports（模块内部使用/公共 API 预留），0 循环，0 未解析
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.1.1"` 已冻结**

**本轮状态**：Spring Boot 框架检测 + Vue 循环白名单 + Python parser 编码修复 + P5/P27/P35/P50 修复 + SKILL.md 全量同步。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 已知陷阱（新 agent 必看）

| 陷阱 | 位置 | 如何避免 |
|------|------|----------|
| `DEFAULT_EXCLUDE_DIRS` 全局污染 | `src/services/file-index.js` | 任何新增排除项必须是通用目录名（如 `node_modules`），不能是项目特定名称 |
| orphan 检测不同步 | `project-map.js` vs `overview-tools.js` | 两处 orphan 逻辑必须保持同步（scripts/bin/benchmark 跳过） |
| compact 模式只改 project-map.js | `cli.js` 也需要同步 | human-readable 输出和 `countTreeFiles()` 必须兼容 skeleton 模式（`totalFileCount`） |
| Windows PowerShell 管道 BOM | 所有 `node cli.js ... \| node -e` 命令 | PowerShell 管道传 JSON 会带 BOM，用文件中转（`> file`）再读取 |
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

### 活跃技术债（本轮未关闭）

| 编号 | 问题 | 状态 |
|------|------|------|
| P1/P63 | Vue 假阳性三角（dead-export + orphan） | ✅ 路由懒加载/全局组件/自定义指令/动态字符串调用 extractor 已全部实现；`fs.readFileSync` 运行时读取模式仍超出静态分析范围 |
| P24 | `impact` source 文件出现在自己的影响列表 | ⏸ cannot-reproduce，代码已有 guard |
| P30 | `unresolved` 的 `resolvedTo` 语义 | ⏸ 冻结：`resolvedTo: null` = 未解析到磁盘文件 |
| P33 | 两个前端项目输出高度模板化 | 活跃 |
| P43 | `health.checks.ci` 未检测到 `.github/workflows` | ⏸ cannot-reproduce，当前代码已递归扫描 |
| P57 | 字段命名风格不统一 | 活跃 |
| P62 | 两个前端项目症状高度一致 | 活跃（overview 层面 recommendations 仍偏模板化） |

### 实战基地审核发现（全部已处理）

| 方向 | 状态 |
|------|------|
| Spring Boot 框架模式识别 | ✅ 已修复 |
| Vue Router/Vuex 循环白名单 | ✅ 已修复 |
| Python parser Windows 编码 | ✅ 已修复（coverage 0.21→1.00） |
| 前端自定义指令全局模式 | ⏸ 无需修复（`checkPermi`/`checkRole` 为真实死代码） |

**数据**：后端 dead exports 合计 467→246（Spring Boot 误报消除），前端循环 32→5（Vue 白名单过滤）。详见 CHANGELOG.md [Unreleased]。

本轮已关闭/冻结：P5, P12, P17, P24, P27, P30, P32, P35, P36, P37, P42, P43, P47, P50, P51, P56, P58。

---

*Last updated: 2026-05-08（SESSION.md 压缩为新一轮基线）*
