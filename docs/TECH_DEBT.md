# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

*当前无 L1 Blocker。*

---

## 架构债务（不阻塞功能，但阻塞演进速度）

#### P8-2-1. `parseCommandString` 是后处理补丁，非正交设计

**数据**：`commands.js` 中 20+ 处 `push({cmd: '...'})`，最后由 `parseCommandString` 统一 regex 解析为 `executable`。同一条命令的信息在生成侧（拼字符串）和消费侧（拆字符串）各存在一次。

**成本**：新增语言/命令时，开发者需同时验证：① `cmd` 字符串正确 ② `parseCommandString` 能正确拆分它。引号内空格、Windows 路径空格等边界情况随时可能击穿解析器。

**理想形态**：`buildNodeTestCommand`、`buildGoModuleTestCommands` 等处直接返回 `{name, description, executable}`，`cmd` 由 `renderCommandString(executable)` 纯函数合成。新增语言只需维护一处结构。

**触发重构条件**（任一满足即做）：
1. `parseCommandString` 遇到真实解析 bug
2. 新增第 10 种语言，命令生成逻辑继续膨胀
3. P8-1 需要修改 `commands.js` 的命令生成逻辑

---

#### P77. `findUnresolvedImports` Windows 路径格式不一致

**数据**：`dep-graph.js:751` `if (!this.dg.hasFile(imp) && path.isAbsolute(imp) && !fs.existsSync(imp))`。`hasFile()` 使用 `normalizePathKey()`（Windows 下小写+POSIX 斜杠），而 `path.isAbsolute(imp)` 检查原始路径格式。

**根因**：`imp` 可能是 `c:/users/...`（normalizePathKey 格式），`path.isAbsolute()` 在 Windows 上能识别 `c:/...`，但理论上存在 `hasFile` 和 `isAbsolute` 判断不一致的边界。

**风险**：低。当前代码在 Windows 实测正常，但这是隐性假设，未在测试中覆盖。

---

#### P83. 文件扫描数量与用户预期差距大

**数据**：`ai_zcypg_backend` 实际 1547 文件，扫描到 389；`ai_zsgzt_backend` 实际 1789 文件，扫描到 550。前端：`ai_zcypg_frontend` 实际 368 文件，扫描到 228；`ai_gwy_frontend` 实际 23 文件，扫描到 11。

**根因**：workspace-bridge 只统计能解析的 mainline 文件（Java/JS/Vue 源码），Maven 项目的 `target/`、资源文件（`*.xml`、`*.yml`、`*.properties`）、前端产物（SVG、图片、CSS）等被排除。这是设计行为，但 `totalFiles` 的命名可能让用户误以为扫描不完整。

**影响**：低。但资产文件排除和 testFiles 计数的叠加，可能让用户对索引完整性产生怀疑。

---

#### P84. 多模块 Maven 项目模块边界未显式标注

**数据**：两个 Spring Boot 多模块项目的 `unresolvedCount` 均为 0。

**根因**：模块间交叉引用（如 `aizcypg-biz` 引用 `aizcypg-common`）被正确解析，但模块间的耦合强度、跨模块依赖热力图未被显式输出。所有文件被扁平化处理。

**影响**：架构审计中丢失了一个重要维度——模块边界内的紧耦合 vs 模块间的松耦合。

---

#### P88. 前端分析文件数差距（368 vs 228，23 vs 11）

**数据**：`ai_zcypg_frontend` 实际 368 文件，扫描到 228（排除了 92 SVG + 其他资产）；`ai_gwy_frontend` 实际 23 文件，扫描到 11（排除了 CSS 和 public 资产）。

**根因**：同 P83。前端项目的 SVG、图片、样式等被作为资产排除，但 `src/` 内的 `setupProxy.js`、`config.js` 等配置文件是否被正确归类也存疑。

---

#### cli.js 厚门面

**数据**：~623 行，`formatHuman` ~200 行 switch 覆盖 20+ 命令。每新增命令或参数都要改 cli.js。

**影响**：变更频率与 feature 增长速度成正比，长期是瓶颈。

**方案**：每个 formatter 文件额外导出 `formatHuman(result)`，cli.js 动态查找。与 P8-2 同期做。

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
| `src/tools/git-tools.js`                  | ~620 | 中           | `getChangedFiles()` 手动字符级解析是已知债务            |
| `cli.js`                                  | ~623 | 中           | 命令分发中心，分支短                                      |
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
| `services/file-index/symbol-extractors.js`  | 🟡 中    | 被 file-index 集成测试间接覆盖                           |
| `services/dep-graph/parsers/shared.js`      | 🟡 中    | 被 parser 测试间接覆盖                                   |
| `services/dep-graph/parsers/spawn-ast.js`   | 🟡 中    | 被 java-parsers-test.js / go-ast-parser-test.js 间接覆盖 |
| `services/dep-graph/parsers/polyglot.js`    | 🟡 中    | 被 parser-schema-contract-test.js 间接覆盖               |
| `cli/formatters/*.js`                       | 🟡 中    | 被 functionality-test.js / audit-diff-test.js 间接覆盖   |

### 有测试但可继续深化的模块

| 模块              | 测试文件                  | 仍缺覆盖                                                 |
| ----------------- | ------------------------- | -------------------------------------------------------- |
| `file-index.js` | 间接测试                  | watcher 完整链路、readdir 权限拒绝、AbortController 超时 |
| `watch.js`      | `watch-test.js`         | compact 模式真实输出、SIGINT/SIGTERM 异常隔离            |
| `repl.js`       | `repl-test.js`          | 真实容器初始化、热点 threshold 边界                      |
| `cli.js`        | `functionality-test.js` | mapper 异常、adapter 异常、所有 human 格式化分支         |

### Flaky 根因

| 测试文件                                             | 根因                                                    | 建议修复                                           |
| ---------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `functionality-test.js`                            | 修改 repo root 的 tracked 文件（README.md）+ 无原子恢复 | 用 `fs.copyFileSync` 在副本上操作                |
| `java-parsers-test.js` / `go-ast-parser-test.js` | 外部进程 `timeout: 5000` 冷启动可能超时               | 提升至 15000ms 或根据 `CI` 环境变量动态调整      |
