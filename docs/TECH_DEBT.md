# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

*当前无 L1 Blocker。*

---

## 架构债务（不阻塞功能，但阻塞演进速度）

---

#### cli.js 厚门面（部分缓解）

**数据**：~770 行（`formatHuman` ~200 行已提取至 `human-formatters.js`），剩余 `runCommand` ~350 行 switch 覆盖 20+ 命令。

**影响**：新增命令仍需改 `runCommand` 路由和 `human-formatters.js`，但 formatter 逻辑不再耦合在 cli.js 中。

**方案**：`runCommand` 可进一步拆分为 `src/cli/commands/` 目录下的独立处理器文件，每个命令一个模块。当前已足够，暂缓。

---

## L3 品味问题（建议修，非债务）

| 位置                  | 问题                                                              | 优先级 |
| --------------------- | ----------------------------------------------------------------- | ------ |
| `git-tools.js`      | `getChangedFiles()` 手动字符级解析                              | 低     |
| `overview-tools.js` | `renderOverviewDashboard` 中 HTML/CSS 裸数字                    | 低     |
| `js.js`             | `parseJavaScriptAST` ~265 行、`parseJavaScript` regex ~147 行 | 低     |
| `path.js`           | `hasPathSegment` 语义陷阱：只取 segment 最后一级                | 低     |

---

## 文件级雷区地图

| 文件                                        | 行数 | 风险         | 状态                                                      |
| ------------------------------------------- | ---- | ------------ | --------------------------------------------------------- |
| `src/services/dep-graph.js`               | ~1311 | **高** | 核心引擎类，AGENTS.md 已确认"内聚优先、不物理拆分"        |
| `src/tools/overview-tools.js`             | ~622 | 中           | 裸数字已归零（JS侧），HTML/CSS 裸数字仍在                 |
| `src/tools/git-tools.js`                  | ~358 | 低           | `getChangedFiles()` 手动字符级解析是已知债务；6 个死函数已清理（-309 行）
| `cli.js`                                  | ~766 | 中           | `formatHuman` 已提取至 `human-formatters.js`，剩余 `runCommand` 路由                                      |
| `src/cli/formatters/validation-advice.js` | ~312 | 低           | 已拆为 6 个纯函数；文件变长是因为总代码量增加，内聚性提升 |
| `src/utils/project-context.js`            | ~297 | 低           | `inferFileRole()` 已降至 12 行，但 P95/P100 暴露规则缺口 |
| `src/utils/stack-detectors/detect.js`     | ~351 | 低           | stack-detector 检测子模块                                   |
| `src/utils/stack-detectors/commands.js`   | ~404 | 低           | stack-detector 命令子模块                                   |
| `src/services/file-index.js`              | ~420 | 低           | 已从 ~523 行降下                                          |

---

## 测试覆盖缺口

### 仍无直接测试的模块（低优先级）

| 文件                                          | 风险等级 | 说明                                                     |
| --------------------------------------------- | -------- | -------------------------------------------------------- |
| ~~`services/file-index/symbol-extractors.js`~~ | ✅ 已覆盖 | `test/symbol-extractors-test.js` 直接覆盖 6 语言 × 边界 |
| ~~`services/dep-graph/parsers/shared.js`~~  | ✅ 已覆盖 | `test/parser-shared-polyglot-test.js` 直接覆盖 9 个纯函数 |
| ~~`services/dep-graph/parsers/spawn-ast.js`~~ | ✅ 已覆盖 | `test/spawn-ast-test.js`（SIGKILL）+ `spawn-ast-concurrency-test.js`（限流）+ `spawn-ast-direct-test.js`（成功/截断/错误边界） |
| ~~`services/dep-graph/parsers/polyglot.js`~~| ✅ 已覆盖 | `test/parser-shared-polyglot-test.js` 直接覆盖 `parseKotlin`/`parseGoRegex`/`parseRust` |
| ~~`cli/formatters/*.js`~~                   | ✅ 已覆盖 | `test/formatter-direct-test.js` + `formatter-e2e-test.js` 双层次覆盖 |

### 有测试但可继续深化的模块

| 模块              | 测试文件                  | 覆盖状态                                                 |
| ----------------- | ------------------------- | -------------------------------------------------------- |
| `file-index.js` | `file-index-race-test.js` | ✅ race / exclude / rename / boundary（EACCES/AbortController） |
| `watch.js`      | `watch-test.js`         | ✅ 文件变化 / SIGINT / SIGTERM / --run-tests / compact 格式 |
| `repl.js`       | `repl-test.js`          | ✅ executeCommand 全分支 / shutdown 守卫 / 热点 threshold 边界 |
| `cli.js`        | `functionality-test.js` | ✅ mapper 异常 / adapter 异常 / 所有 human 格式化分支 |

### Flaky 根因

| 测试文件                                             | 根因                                                    | 建议修复                                           |
| ---------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| ~~`functionality-test.js`~~                        | ~~修改 README.md + 无原子恢复~~                       | ✅ 已修复：改用临时 untracked 文件 + finally 清理 |
| ~~`java-parsers-test.js`~~                         | ~~外部进程 `timeout: 5000` 冷启动超时~~               | ✅ 已修复：timeout 提升至 15000ms                  |
