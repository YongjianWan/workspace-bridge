# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

无。

---

## L2 债务（阻塞演进或导致结果不可信）

#### 超时常量分散定义 — 违反 L2-6

**数据**：超时阈值在多个文件中各自硬编码，未统一到 `src/config/constants.js`：

| 文件 | 硬编码值 | 用途 |
|------|----------|------|
| `src/services/diagnostics-engine.js` | 5000, 10000, 15000 | checker/ruff/pyright/eslint/tsc 超时 |
| `src/tools/workspace-tools.js` | 10000, 30000, 60000, 15000, 120000 | ruff/pyright/eslint/pytest/compileall/diagnostics 总超时 |
| `src/tools/health-tools.js` | 30000, 10000, 60000, 15000 | eslint/ruff/pip-audit/pip-outdated 超时 |
| ~~`cli.js`~~ | ~~1024, 1024~~ | ~~`LARGE_JSON_THRESHOLD`, `JSON_WRITE_CHUNK_SIZE`~~ | ✅ 已归零：`STREAMING` 对象移入 `constants.js` |
| `test/runner.js` | 120000 | 测试总超时 |

**根因**：新超时阈值加入时直接内联到调用点，未进 `constants.js`。

**影响**：调整全局超时策略需改 5+ 个文件，极易漏改。不同文件的相同用途超时（如 linter 10s）可能因漏改而不一致。

**方案**：所有超时阈值集中到 `src/config/constants.js` 的 `TIMEOUTS` 对象，各模块统一导入。

---


## 架构债务（不阻塞功能，但阻塞演进速度）

#### CLI 设计缺陷迫使 skill 膨胀（根本问题）

**数据**：SKILL.md 已从 395 行精简至 ~264 行，仍厚于理想状态（50 行）。命令分层混乱：20+ 命令中 L4 原始查询（`dead-exports`/`cycles`/`unresolved`/`dependencies`/`dependents`/`stats`/`tree`）被 L1 aggregate 命令（`audit-summary`/`audit-file`）完全覆盖，但作为一等公民暴露；`health` 与 `audit-summary.health` **数据完全重合**；`dependents` 是 `impact` 的子集。AI 不知道该用 aggregate 还是 raw。

**根因**：**不是"文档写太长"，是 CLI 把策展工作外包给 AI**。具体：
- `--format ai` broken → AI 被迫自己筛 235 行 raw JSON
- ~~`validationAdvice.commands: []`~~ → ~~AI 拿不到闭环指令~~ ✅ **已修复**：`audit-file` 与 `audit-diff` 均返回 `suggestedCommand`（非空字符串）
- ~~`affected-tests` 返回 0~~ → ~~AI 无法信任测试关联~~ ✅ **已修复**：`test-detector.js` 扩展 9 种布局/命名规则（`__tests__`/`cypress`/`e2e`/`ruby`/`UnitTest`/`IntegrationTest` 等）
- `health` / `dependents` 等命令分层混乱 → L4 原始查询与 L1 aggregate 混在同一层级暴露，AI 被迫学"什么时候用哪个"，文档被迫当说明书
- exit code 反模式 → AI 拿到 exit=1 第一反应"命令挂了"，文档被迫解释"exit code 语义"

**影响**：SKILL.md ~264 行里 ~200 行是"怎么绕过 CLI 缺陷"的补偿性指南。擦的是不该存在的屁股。

**更深层的定位修正**：workspace-bridge 不是"AI 的替代方案"，而是**"所有 AI（IDE + 终端）都需要的基础设施"**——就像数据库索引。IDE AI（Cursor/Claude）没有预建的全局 import/export 图、影响半径计算、死代码 AST 检测——它们只有 LSP（单文件）和 RAG（语义检索）。真正危险的不是"AI IDE 做得更好"，而是"**用户以为 AI IDE 已经做了，所以不需要你**"。

**方案**：病根全在 CLI 出口质量。优先级：
1. 修 `--check-regression` crash → "跨时间基线"核心价值可用
2. 修 exit code → CI / AI agent 稳定调用
3. 修 `--format ai`（depth/token-budget 生效）→ AI 直接消费策展结论
4. ~~修 `validationAdvice.commands`~~ → ✅ **已完成**：`buildFileValidationAdvice` 与 `buildValidationAdvice` 均生成 `suggestedCommand`
5. ~~修 `affected-tests`~~ → ✅ **已完成**：启发式规则覆盖 `__tests__`/`cypress`/`e2e`/`ruby`/`UnitTest`/`IntegrationTest` 等常见模式
6. ~~合并冗余命令~~ → **分层暴露**：`--help` 按 L1/L2/L3/L4 分组输出；`health` 改为 `audit-summary --health-only` 别名 + deprecation；L4 命令（`dead-exports`/`cycles` 等）保留但标记为 debug 层级
7. 届时 SKILL.md 可缩至 ~80 行：L1 命令表 + L2 场景指南 + 版本锁定

#### cli.js 厚门面（部分缓解）

**数据**：~974 行（`formatHuman` 等 formatter 逻辑已提取至 `human-formatters.js` ~720 行），剩余 `runCommand` ~350 行 switch 覆盖 20+ 命令。

**影响**：新增命令仍需改 `runCommand` 路由和 `human-formatters.js`，但 formatter 逻辑不再耦合在 cli.js 中。

**方案**：`runCommand` 可进一步拆分为 `src/cli/commands/` 目录下的独立处理器文件，每个命令一个模块。当前已足够，暂缓。

---

#### ~~路径格式混用~~ — ✅ 已修复

**数据**：同一命令 `audit-file` 里同时出现两种格式：`workspaceRoot` = `C:\Users\sdses\Desktop\...`（Windows 原生），`resolvedPath` = `c:/users/sdses/desktop/...`（小写 + 正斜杠）。

**根因**：`file-index.js` 遍历得到的平台原生路径经 `cache.js` 的 `normalizeFilePath` 转为 `normalizePathKey` 后作为 key 存储；`dep-graph.js` 从 `cache.fileMetadata.keys()` 读取这些 key 并直接作为 `originalPath` 存入 graph，导致 `_displayPath` 返回小写正斜杠格式。

**修复**：
1. `file-index.js` `build()` 末尾存储 `this._indexedFiles = allFiles`（原始平台路径列表）
2. `container.js` 将 `_indexedFiles` 传给 `depGraph.build(sourceFiles)`
3. `dep-graph.js` `build()` 优先使用 `sourceFiles` 作为原始路径；cache-hit 时用 `meta.originalPath || file` 覆盖
4. `cache.js` `setFileMetadata` 自动附加 `originalPath`
5. `graph-db.js` 新增 `original_path` 列并持久化，支持缓存恢复后格式保持一致

**验证**：`node cli.js audit-file --file src/services/dep-graph.js --json --quiet` 输出中 `workspaceRoot` 与 `resolvedPath` 均为 `C:\Users\...` 格式（Windows 原生）。

---

## 测试代码债务（109 文件 / 460 函数）

#### 测试代码重复率过高 — 违反 L2-7

**数据**：
- **118 处 `fs.mkdtempSync()`** + 对应 **118 处 `fs.rmSync(..., { recursive: true })`**——临时目录 setup/teardown 在每个需要文件系统隔离的测试中重复
- ~~**99 处内联 mock `depGraph`** 构造——`new Map([['/repo/src/a.js', { imports: [...], exports: [...] }]])` 模式在 `audit-map-test.js`、`overview-tools-test.js` 等文件中反复出现~~ **部分收敛**：`audit-map-test.js` 公共方法（`getFileInfo`/`hasFile`/`getDependents`/`getDependencies`/`isTestLikeFile`）已提取为 `BASE_MOCK_METHODS`，文件从 592 行降至 544 行；graph 数据字面量仍内联
- `console.log('...: ok')` / `console.log('...: all passed')` 残留——CHANGELOG 声称"169 处清零"，实际 `audit-map-test.js`（本轮已清）、`repl-test.js`、`cli-args-validation-test.js` 等仍有 ~30 处；runner 本身输出 PASS/FAIL，测试内部打印不增加暴露错误的能力

**根因**：没有提取测试 fixture 工厂函数和 setup/teardown 抽象；`console.log` 噪音未彻底清理。

**影响**：
- 修改 `depGraph` mock 接口需改 99 处（方法已提取，数据字面量仍分散）
- 临时目录泄漏风险（若测试中途崩溃，`rmSync` 在 finally 中可能未执行）
- `console.log` 污染 runner 输出，增加验证门禁"阅读完整输出"的阅读成本

**方案**：
1. 提取 `makeTempDir()` 和 `cleanupTempDir()` 到 `test-helpers.js`（已提供，待迁移剩余 36 文件）
2. `audit-map-test.js` graph 数据字面量进一步提取为配置表驱动的工厂调用
3. 彻底清理 `console.log` 噪音（repl-test.js、cli-args-validation-test.js 等剩余 ~30 处）

---

#### runner.js 并发执行 SQLite 写冲突 — 违反 L1-2 异常安全

**数据**：`test/runner.js` 并发执行（CONCURRENCY > 1）时，多个测试子进程同时在 `repoRoot` 上运行 CLI，读写同一 SQLite 缓存文件（`cache.db`），导致子进程 hang 住超过 120s 或抛出 `ReferenceError`。

**根因**：`better-sqlite3` WAL 模式支持并发读，但并发写会阻塞等待。当 4-8 个测试同时启动 `node cli.js` 并触发缓存写入时，SQLite 锁竞争导致部分子进程无法及时退出。

**影响**：
- 并发 runner 无法稳定使用，总时间超过 300s 甚至无限挂起
- 被迫回退到串行执行（CONCURRENCY=1），测试总时间 ~286s
- 与 AGENTS.md 验证门禁"收工前必跑全量测试"冲突：串行 runner 在 CI 中耗时过长

**方案**：
1. **短期**：默认串行（已实施），环境变量 `TEST_CONCURRENCY` 可覆盖
2. **中期**：每个测试子进程启动时传入 `--cache-dir` 指向独立临时目录，彻底隔离缓存写
3. **长期**：评估 SQLite 是否真的需要跨进程共享；若为纯测试隔离场景，内存缓存（JSON fallback）可能更快且无锁竞争

---

#### 时序依赖测试脆弱 — 违反 L1-2 异常安全

**数据**：测试中存在大量固定延时，依赖事件循环/文件系统 watch 的时序：

| 文件 | 延时 | 场景 |
|------|------|------|
| `audit-file-watch-test.js` | 100ms, 200ms, 2000ms, 3000ms ×2 | fs.watch 触发等待 |
| `diagnostics-unbounded-timer-test.js` | 1200ms ×2, 3000ms | timer 测试 |
| `file-index-race-test.js` | 20ms | 竞态条件模拟 |
| `file-index-rename-test.js` | 200ms | 重命名事件等待 |
| `overview-tools-concurrency-test.js` | 5ms, 30ms | 并发批次模拟 |
| `repl-shutdown-test.js` | 30ms ×2, 50ms | shutdown 守卫 |
| `spawn-ast-test.js` | 50ms, 60ms | 子进程 kill 等待 |

**根因**：使用固定延时等待异步事件，而非轮询或信号机制。

**影响**：在慢速 CI 环境或高负载机器上极易 flaky。`audit-file-watch-test.js` 已因时序问题做过一轮修复（从固定 `delay(2500)` 改为轮询），但其他文件仍未整改。

**方案**：统一改为轮询检查（如 `watch-test.js` 的修复模式）或事件驱动等待，消除固定延时。

---

#### 模块级副作用与硬编码魔数

**数据**：
- `audit-diff-incremental-test.js:20`：硬编码 `timeout: 60000`
- `java-parsers-test.js:10`：硬编码 `timeout: 15000`
- `runner.js`：硬编码 `TIMEOUT_MS = 120000`
- `analysis-test.js`：硬编码 fixture 路径 `fixture-temp/test-module.js`

**根因**：测试代码未遵循 L2-6"裸数字归零"和 L1-2"异常安全"原则。

**影响**：
- 超时阈值无 rationale，不同文件各自拍脑袋定
- 硬编码 fixture 路径可能与真实文件冲突

**方案**：
1. 所有超时阈值提取到 `test/test-constants.js`
3. fixture 路径使用 `path.join(os.tmpdir(), 'wb-test-' + random)` 隔离

---

## L3 品味问题（建议修，非债务）

| 位置                  | 问题                                                              | 优先级 |
| --------------------- | ----------------------------------------------------------------- | ------ |
| `git-tools.js`      | `getChangedFiles()` 手动字符级解析；`--since` 已新增，字符级解析债务仍在 | 低     |
| `overview-tools.js` | `renderOverviewDashboard` 中 HTML/CSS 裸数字                    | 低     |
| `js.js`             | `parseJavaScriptAST` ~476 行、`parseJavaScript` regex ~41 行 | 低     |
| `path.js`           | `hasPathSegment` 语义陷阱：只取 segment 最后一级                | 低     |
| `workspace-tools.js` / `SKILL.md` | `parserAvailability.skipped: true` 命名语义陷阱：`skipped` 暗示"文件被跳过"，实际为"tree-sitter WASM 无 package.json 初始化路径"，AGENTS.md 和 SKILL.md 都要专门解释 | 低     |
| `cli.js` / `formatters` | `--json` 嵌套深、体积大，`--compact` 后仍有 400 行，管道场景不友好；默认 human-readable 输出缺乏实战打磨。**根因是 CLI 不输出预消化报告，迫使 skill 变厚补偿** | 中     |
| `cli.js` / `constants.js` | `--compact` 500 文件阈值无 rationale，拍脑袋定。239 文件项目 `audit-map --compact` 已输出 29KB；应按**输出 Token 数**或 `--budget-tokens` 决定压缩策略 | 中     |
| `SKILL.md` / `package.json` | npx 版本未锁定，`npx workspace-bridge-cli` 可能自动升级到不兼容版本，schema 变更后 AI 解析直接崩 | 中     |
| `human-formatters.js` | 同一命令在 4-5 个 formatter 函数中重复判断：`audit-summary` 出现在 formatHuman/formatSummary/formatMarkdown/formatAi/formatJsonl 的 switch 中各一次 | 中     |

---

## 文件级雷区地图

| 文件                                        | 行数 | 风险         | 状态                                                      |
| ------------------------------------------- | ---- | ------------ | --------------------------------------------------------- |
| `src/services/dep-graph.js`               | ~1582 | **高** | 核心引擎类，AGENTS.md 已确认"内聚优先、不物理拆分"        |
| `src/tools/overview-tools.js`             | ~868 | 中           | 裸数字已归零（JS侧），HTML/CSS 裸数字仍在；L2-5 schema 不一致源 |
| `cli.js`                                  | ~974 | 中           | `formatHuman` 已提取至 `human-formatters.js`，剩余 `runCommand` 路由；L2-8/L2-9 参数路由源 |
| `src/tools/git-tools.js`                  | ~358 | 低           | `getChangedFiles()` 手动字符级解析是已知债务；6 个死函数已清理（-309 行）；L2-9 commit range 源 |
| `src/tools/security-tools.js`             | ~170 | 低           | `--builtin-only` 已新增；L2-8 已关闭                        |
| `src/cli/formatters/validation-advice.js` | ~312 | 低           | 已拆为 6 个纯函数；文件变长是因为总代码量增加，内聚性提升 |
| `src/utils/project-context.js`            | ~297 | 低           | `inferFileRole()` 已降至 12 行，但 P95/P100 暴露规则缺口 |
| `src/utils/stack-detectors/detect.js`     | ~351 | 低           | stack-detector 检测子模块                                   |
| `src/utils/stack-detectors/commands.js`   | ~404 | 低           | stack-detector 命令子模块                                   |
| `src/services/file-index.js`              | ~544 | 低           | 已从 ~523 行降下                                          |

---

## 测试覆盖缺口

### 有测试但可继续深化的模块

| 模块              | 测试文件                  | 覆盖状态                                                 |
| ----------------- | ------------------------- | -------------------------------------------------------- |
| `file-index.js` | `file-index-race-test.js` | ✅ race / exclude / rename / boundary（EACCES/AbortController） |
| `watch.js`      | `watch-test.js`         | ✅ 文件变化 / SIGINT / SIGTERM / --run-tests / compact 格式 |
| `repl.js`       | `repl-test.js`          | ✅ executeCommand 全分支 / shutdown 守卫 / 热点 threshold 边界 |
| `cli.js`        | `functionality-test.js` | ✅ mapper 异常 / adapter 异常 / 所有 human 格式化分支 |

### Flaky 根因

| 测试文件 | 根因 | 建议修复 |
| -------- | ---- | -------- |
