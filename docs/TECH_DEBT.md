# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。
> 最后审查：2026-05-05（本轮深度清零后更新）

---

## L1 Blocker（违反铁律，必须修）

全部清零（2026-05-05）。见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L2 债务（技术债务，计划修）

全部清零（2026-05-05）。见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L3 品味问题（建议修，非债务）

以下问题属于代码风格/长度建议，不影响功能正确性，按价值排序记录：

| 位置 | 问题 | 说明 |
|------|------|------|
| `validation-advice.js` | ✅ 已拆分 | `buildValidationAdvice` 从 274 行拆为 6 个纯函数，主函数降至 35 行 |
| `project-context.js` | `inferFileRole()` 已降至 12 行 | 顶部 `FRAMEWORK_ENTRY_FILES` / `CONFIG_PATTERNS` / `ROLE_RULES` 等常量集合仍分散，可继续提取为独立配置模块 |
| `container.js` | ✅ 已拆分 | `initialize()` 从 ~85 行拆为 7 个私有方法，主函数降至 25 行 |
| `function-impact.js` | `getChangedFunctionImpact()` 已降至 83 行 | 已拆分为 9 个纯函数，内聚性恢复 |
| `symbol-impact.js` | `getSymbolImpact()` 已降至 52 行 | 已拆分为 11 个纯函数，超阈值问题消除 |
| `git-tools.js` | `getChangedFiles()` 手动字符级解析 | 620 行文件中已知债务，当前不优先 |
| `overview-tools.js` | `renderOverviewDashboard` 中 HTML/CSS 裸数字 | `padding:14px`、`font-size:26px` 等仍在 |
| `js.js` | `parseJavaScriptAST` ~265 行、`parseJavaScript` regex ~147 行 | 函数过长，但 parser 边界稳定，低优先级 |
| `path.js` | `hasPathSegment` 语义陷阱：只取 segment 最后一级 | 函数名与实际行为不符 |

---

## 文件级雷区地图

| 文件 | 行数 | 风险 | 状态 |
|------|------|------|------|
| `src/services/dep-graph.js` | ~704 | **高** | 核心引擎类，AGENTS.md 已确认"内聚优先、不物理拆分" |
| `src/tools/overview-tools.js` | ~622 | 中 | 裸数字已归零（JS侧），HTML/CSS 裸数字仍在 |
| `src/tools/git-tools.js` | ~620 | 中 | `getChangedFiles()` 手动字符级解析是已知债务 |
| `cli.js` | ~623 | 中 | 命令分发中心，分支短 |
| `src/cli/formatters/validation-advice.js` | ~312 | 低 | 已拆为 6 个纯函数；文件变长是因为总代码量增加，内聚性提升 |
| `src/utils/project-context.js` | ~297 | 低 | `inferFileRole()` 已降至 12 行，顶部常量集合可继续提取 |
| `src/utils/stack-detectors/detect.js` | ~351 | 低 | 已从 stack-detector.js 拆分 |
| `src/utils/stack-detectors/commands.js` | ~404 | 低 | 已从 stack-detector.js 拆分 |
| `src/services/file-index.js` | ~420 | 低 | 已从 ~523 行降下 |

---

## 测试覆盖缺口

> **2026-05-05 更新**：新增 `test/js-regex-cjs-test.js`，JS regex fallback 已有基础覆盖。

| Parser / 模块 | 测试文件 | 状态 |
|---------------|----------|------|
| JS AST + functionRecords | `test/arrow-function-test.js` | ✅ |
| Java AST + regex fallback | `test/java-parsers-test.js` | ✅ |
| JS regex fallback (CJS exports) | `test/js-regex-cjs-test.js` | ✅ 新增 |
| Python (AST/regex) | `test/parser-schema-contract-test.js` | ✅ |
| Kotlin / Go / Rust (polyglot) | `test/parser-schema-contract-test.js` | ✅ |

---

### 仍无直接测试的模块（低优先级）

| 文件 | 风险等级 | 说明 |
|------|---------|------|
| `utils/orphan-detector.js` | ✅ 低 | 已补 `test/orphan-detector-test.js` |
| `services/file-index/symbol-extractors.js` | 🟡 中 | 被 file-index 集成测试间接覆盖 |
| `services/dep-graph/function-similarity.js` | ✅ 低 | 已补 `test/function-similarity-test.js` |
| `services/dep-graph/parsers/shared.js` | 🟡 中 | 被 parser 测试间接覆盖 |
| `services/dep-graph/parsers/spawn-ast.js` | 🟡 中 | 被 java-parsers-test.js / go-ast-parser-test.js 间接覆盖 |
| `services/dep-graph/parsers/polyglot.js` | 🟡 中 | 被 parser-schema-contract-test.js 间接覆盖 |
| `cli/formatters/*.js` | 🟡 中 | 被 functionality-test.js / audit-diff-test.js 间接覆盖 |

### 有测试但可继续深化的模块

| 模块 | 测试文件 | 仍缺覆盖 |
|------|---------|----------|
| `file-index.js` | 间接测试 | watcher 完整链路、readdir 权限拒绝、AbortController 超时 |
| `watch.js` | `watch-test.js` | compact 模式真实输出、SIGINT/SIGTERM 异常隔离 |
| `repl.js` | `repl-test.js` | 真实容器初始化、热点 threshold 边界 |
| `cli.js` | `functionality-test.js` | mapper 异常、adapter 异常、所有 human 格式化分支 |

### Flaky 根因

| 测试文件 | 根因 | 建议修复 |
|----------|------|----------|
| `watch-test.js` | 固定 `delay(2500)` 假设 + fs.watch 平台时序差异 | 轮询检查预期输出，而非固定 delay；使用独立临时目录 |
| `functionality-test.js` | 修改 repo root 的 tracked 文件（README.md）+ 无原子恢复 | 用 `fs.copyFileSync` 在副本上操作 |
| `java-parsers-test.js` / `go-ast-parser-test.js` | 外部进程 `timeout: 5000` 冷启动可能超时 | 提升至 15000ms 或根据 `CI` 环境变量动态调整 |

