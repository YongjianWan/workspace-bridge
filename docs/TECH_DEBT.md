# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

无当前活跃 L1。

---

## L2 债务（阻塞演进或导致结果不可信）

#### cache 失效策略粗糙

**数据**：staleness 只检查 `gitHeadChanged`，不检查 dirty worktree 的文件变化。改了文件但没 commit 时，缓存不会失效。

**根因**：`getStaleness()` 仅对比 git HEAD hash，未对比文件 mtime/内容哈希。

**影响**：dirty worktree 场景下拿到 stale 结果，分析结论与代码实际状态不一致。

**方案**：缓存失效增加文件级检查：比较 `fileMetadata` 中存储的 mtime/hash 与当前磁盘状态，任一文件变化即标记 stale。

---

#### `--check-regression` 基线对比崩溃

**数据**：`audit-summary --save` 成功生成 baseline（747 字节），但 `--check-regression` 崩溃：`Cannot read properties of undefined (reading 'slice')`。

**根因**：基线文件 schema 与当前代码读取逻辑不匹配；`loadBaseline()` 或 `compareFindings()` 未防御缺失字段 / 旧格式。

**影响**："跨时间审计追踪"能力完全不可用，SKILL.md 推荐的基线工作流断裂。

**方案**：`loadBaseline()` 增加防御式解析（空文件 → 空基线、缺失字段 → 默认值）；`compareFindings()` 前置空值检查。

---

#### Java `dead-exports` 大图崩溃

**数据**：ai_zcypg_backend（542 文件 Java）跑 `dead-exports` 返回 exit code 49，零输出。同项目 `audit-summary` 正常。

**根因**：待定位。可能路径：① `spawn-ast.js` Java AST 子进程 OOM / 超时；② `dep-graph.js` `findDeadExports` 在特定 exportRecords 结构上抛未捕获异常；③ Java parser regex fallback 路径异常。

**影响**：Java 项目死导出检测能力完全不可用。

**方案**：先复现 → 加 `--verbose` 或 stderr 捕获定位崩溃文件 → 在 parser / GraphAnalyzer 层加 try-catch 防御 → 修复根因。

---

#### diagnostics linter 检测与 workspace-info 结果矛盾

**数据**：`workspace-info` 显示 `availableChecks: ["npm scripts", "eslint", "prettier"]`，但 `diagnostics` 返回 `noLintersDetected: true`，只跑了 `git status --short`。

**根因**：`buildChecks`（diagnostics 用）与 `detectAvailableChecks`（workspace-info 用）是两套独立检测逻辑，不同步。`buildChecks` 可能未识别 `.eslintrc.js` / `eslintConfig` 等配置变体。

**影响**： diagnostics 输出不可信，AI 无法依赖其 linter 状态判断。

**方案**：统一两套检测逻辑为单一 `detectLinters()` 纯函数，或被 `buildChecks` 调用，或两者共享配置表。

---

## 架构债务（不阻塞功能，但阻塞演进速度）

#### CLI 设计缺陷迫使 skill 膨胀（根本问题）

**数据**：SKILL.md 395 行 → 精简后 180 行，仍远厚于理想状态（50 行）。命令碎片化严重：20+ 命令中 `health` 输出与 `audit-summary.health` **数据完全重合**；`dependents` 是 `impact` 的子集（无 symbol 信息）；`dead-exports`/`cycles`/`unresolved` 被 aggregate 命令覆盖。

**根因**：**不是"文档写太长"，是 CLI 把策展工作外包给 AI**。具体：
- `--format ai` broken → AI 被迫自己筛 235 行 raw JSON
- `validationAdvice.commands: []` → AI 拿不到闭环指令，文档被迫教"怎么绕过"
- `affected-tests` 返回 0 → AI 无法信任测试关联，文档被迫写 fallback chain
- `health` / `dependents` 等冗余命令 → AI 被迫学"什么时候用哪个"，文档被迫当说明书
- exit code 反模式 → AI 拿到 exit=1 第一反应"命令挂了"，文档被迫解释"exit code 语义"

**影响**：SKILL.md 180 行里 ~150 行是"怎么绕过 CLI 缺陷"的补偿性指南。擦的是不该存在的屁股。

**更深层的定位修正**：workspace-bridge 不是"AI 的替代方案"，而是**"所有 AI（IDE + 终端）都需要的基础设施"**——就像数据库索引。IDE AI（Cursor/Claude）没有预建的全局 import/export 图、影响半径计算、死代码 AST 检测——它们只有 LSP（单文件）和 RAG（语义检索）。真正危险的不是"AI IDE 做得更好"，而是"**用户以为 AI IDE 已经做了，所以不需要你**"。

**方案**：病根全在 CLI 出口质量。优先级：
1. 修 `--check-regression` crash → "跨时间基线"核心价值可用
2. 修 exit code → CI / AI agent 稳定调用
3. 修 `--format ai`（depth/token-budget 生效）→ AI 直接消费策展结论
4. 修 `validationAdvice.commands` → 从"信息工具"升级为"行动工具"
5. 修 `affected-tests` → AI 信任测试关联
6. 合并冗余命令（`health`→`audit-summary` 别名、`dependents`→`impact` 子集标记废弃）
7. 届时 SKILL.md 可缩至 50 行：一条命令 + 版本锁定

#### cli.js 厚门面（部分缓解）

**数据**：~770 行（`formatHuman` ~200 行已提取至 `human-formatters.js`），剩余 `runCommand` ~350 行 switch 覆盖 20+ 命令。

**影响**：新增命令仍需改 `runCommand` 路由和 `human-formatters.js`，但 formatter 逻辑不再耦合在 cli.js 中。

**方案**：`runCommand` 可进一步拆分为 `src/cli/commands/` 目录下的独立处理器文件，每个命令一个模块。当前已足够，暂缓。

---

#### `--exclude` 未完全过滤 cycle

**数据**：`audit-diff --exclude src/views,src/components` 后，被排除目录下的文件产生的 cycle 仍被输出。

**根因**：待定位。可能路径：① `file-index.js` 的 exclude 只影响文件枚举，未同步清除已缓存的 cycle 结果；② `dep-graph.js` 的 `findCircularDependencies` 未接收 exclude 过滤后的文件列表；③ 缓存 stale 检测未感知 exclude 变化。

**影响**：exclude 承诺"排除指定目录"，但 cycle 输出仍包含被排除文件，结果与预期矛盾，用户信任受损。

**方案**：复现 → 确认是缓存问题还是 cycle 检测逻辑未过滤 → 在 `findCircularDependencies` 入口增加 `excludedFiles` 过滤，或确保 exclude 变化触发 cache 失效。

---

#### `watch` 误报缓存文件变更

**数据**：`watch` 启动后检测到 `.workspace-bridge-cache.json.tmp-*` / `.bak` 变更，输出 "0 dependents affected"。

**根因**：`watch` 的文件监控排除列表未同步更新。SQLite 迁移后缓存文件变为 `cache.db` / `cache.db-wal` / `cache.db-shm`，但遗留的 `.tmp-*` / `.bak` 排除逻辑可能仍存在于旧路径，且新的 SQLite 缓存文件也未被 watch 排除。

**影响**：工具自身缓存变更被当作项目源文件监控，产生自噪声，干扰 AI 对真实文件变更的判断。

**方案**：同步更新 `watch.js` 的排除逻辑：① 保留旧 `.workspace-bridge-cache.json` / `.bak` 排除（处理遗留文件）；② 新增 `cache.db` / `cache.db-wal` / `cache.db-shm` 排除。

---

---

#### `--cwd` 指向不存在的目录时挂起

**数据**：`node cli.js audit-summary --cwd 不存在的目录` 5 秒内无响应，无限期挂起。

**根因**：`file-index.js` 或 `container.js` 在无效路径下未做前置校验，进入扫描/解析循环后阻塞。可能是 `fs.readdirSync`/`glob` 在无效路径下的异常未捕获，或 `path.resolve()` 后未检查目录存在性。

**影响**：AI agent 调用时若路径错误（如拼写错误），会永久卡住而不是快速报错。这是最严重的鲁棒性问题。

**方案**：CLI 入口或 `ServiceContainer` 初始化时增加 `fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()` 前置检查，无效时立即返回 `{ ok: false, error: 'Directory not found: ${cwd}' }`。

---

#### `--exclude` 后 `parsedFiles` 不更新

**数据**：`audit-diff --exclude src/views,src/components` 后，`totalFiles` 从 239 降至 98，但 `parsedFiles` 始终是 238。`coverageRatio` 计算被 `Math.min(1, parsed/total)` 硬截断为 100%。

**根因**：`--exclude` 只做输出过滤，不重建子集索引。缓存索引在冷启动时建了一次，exclude 只是查询时的过滤条件，未同步更新 `analysisCoverage` 统计基数。

**影响**：coverageRatio 完全不可信。用户看到 100% 覆盖率，实际只分析了 98 个文件中的部分。

**方案**：`--exclude` 生效时重新计算 `parsedFiles` 和 `totalFiles`，或让 coverage 统计基于过滤后的实际文件集。

---

#### Python 管道大数据崩溃（exit code 49）

**状态**：⏳ **环境兼容性问题，但项目侧必须处理**。根因已澄清——**Windows Store Python 在 Git Bash 管道里接收大数据时崩溃**。

**数据**：`audit-file --file src/app.vue`、`frameworkPattern`、Java `dead-exports` 都返回 exit code 49，零输出。`audit-summary` 的 JSON Python 能正常解析（数据量小）。

**根因**：Windows Store Python (`C:\Users\sdses\AppData\Local\Microsoft\WindowsApps\python.exe`) 在 Git Bash 管道里接收大数据时崩溃。`audit-file` 输出的 JSON 完全合法，问题在管道传输层。

**为什么项目侧要修**：用户不关心"这是谁的 bug"。用户看到的是"workspace-bridge 跑崩了，零输出，不知道怎么办"。

**项目侧方案（三选一）**：
1. **诊断信息**（最低成本，~10 行）：检测到 exit 49 时，如果是 Python 子进程崩溃，stderr 追加 `"Python pipe failure detected. If using Windows Store Python in Git Bash, try: 1) Use system Python instead, 2) Run in PowerShell, or 3) Set PYTHONIOENCODING=utf-8"`
2. **文件中转**（中成本，~30 行）：大数据场景不直接管道传 JSON，改为 Python 写临时文件 → Node 读文件。绕过管道限制。
3. **环境检测**（高成本，不推荐）：启动时检测 Windows Store Python + Git Bash 组合，预报警告。过于侵入。

**推荐**：方案 1（诊断信息）+ 文档标注已知限制。让用户知道"不是工具挂了，是环境需要调整"。

---

#### 路径格式混用

**数据**：同一命令 `audit-file` 里同时出现两种格式：`workspaceRoot` = `C:\Users\sdses\Desktop\...`（Windows 原生），`resolvedPath` = `c:/users/sdses/desktop/...`（小写 + 正斜杠）。

**根因**：两个模块各自用了不同的 path 归一化策略。`workspaceRoot` 走 `path.resolve()`，`resolvedPath` 走额外的归一化（`toLowerCase()` + 正斜杠）。

**影响**：路径比较可能失败（`C:\foo` !== `c:/foo`），导致依赖图边缺失或重复。

**方案**：统一全链路路径格式，要么全部走 `path.posix.normalize(path.resolve(...).toLowerCase())`，要么全部走 Windows 原生格式。不要混用。

---

## L3 品味问题（建议修，非债务）

| 位置                  | 问题                                                              | 优先级 |
| --------------------- | ----------------------------------------------------------------- | ------ |
| `git-tools.js`      | `getChangedFiles()` 手动字符级解析；`--since` 已新增，字符级解析债务仍在 | 低     |
| `overview-tools.js` | `renderOverviewDashboard` 中 HTML/CSS 裸数字                    | 低     |
| `js.js`             | `parseJavaScriptAST` ~265 行、`parseJavaScript` regex ~147 行 | 低     |
| `path.js`           | `hasPathSegment` 语义陷阱：只取 segment 最后一级                | 低     |
| `workspace-tools.js` / `SKILL.md` | `parserAvailability.skipped: true` 命名语义陷阱：`skipped` 暗示"文件被跳过"，实际为"tree-sitter WASM 无 package.json 初始化路径"，AGENTS.md 和 SKILL.md 都要专门解释 | 低     |
| `cli.js` / `formatters` | `--json` 嵌套深、体积大，`--compact` 后仍有 400 行，管道场景不友好；默认 human-readable 输出缺乏实战打磨。**根因是 CLI 不输出预消化报告，迫使 skill 变厚补偿** | 中     |
| ~~`cli.js` / `container.js`~~ | ~~`--quiet` suppress stderr~~ | ✅ 已修复：`warnings[]` 注入 JSON，`--format ai` 和 `--json` 均携带降级信息 |

| `cli.js` / `constants.js` | `--compact` 500 文件阈值无 rationale，拍脑袋定。239 文件项目 `audit-map --compact` 已输出 29KB；应按**输出 Token 数**或 `--budget-tokens` 决定压缩策略 | 中     |
| `SKILL.md` / `package.json` | npx 版本未锁定，`npx workspace-bridge-cli` 可能自动升级到不兼容版本，schema 变更后 AI 解析直接崩 | 中     |

---

## 文件级雷区地图

| 文件                                        | 行数 | 风险         | 状态                                                      |
| ------------------------------------------- | ---- | ------------ | --------------------------------------------------------- |
| `src/services/dep-graph.js`               | ~1311 | **高** | 核心引擎类，AGENTS.md 已确认"内聚优先、不物理拆分"        |
| `src/tools/overview-tools.js`             | ~622 | 中           | 裸数字已归零（JS侧），HTML/CSS 裸数字仍在；L2-5 schema 不一致源 |
| `cli.js`                                  | ~766 | 中           | `formatHuman` 已提取至 `human-formatters.js`，剩余 `runCommand` 路由；L2-8/L2-9 参数路由源 |
| `src/tools/git-tools.js`                  | ~358 | 低           | `getChangedFiles()` 手动字符级解析是已知债务；6 个死函数已清理（-309 行）；L2-9 commit range 源 |
| `src/tools/security-tools.js`             | ~170 | 低           | `--builtin-only` 已新增；L2-8 已关闭                        |
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
