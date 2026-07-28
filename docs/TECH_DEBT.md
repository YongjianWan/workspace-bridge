# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

> 当前无活跃的 L1 债务。
>
> L1-3（Java same-package 隐式边 build/loadGraph 路径语义不一致）已于 2026-07-23 清零：
> orchestrator 在 loadGraph 成功后重跑 `expandJavaPackageImports()` 统一两路径数据；
> tier3 记录不参与死导出「已使用」判定（与 cycles Rule 5 先例一致），仅剩隐式 importer
> 的死导出报出但强制 `low` + `implicit-same-package`；`CACHE_VERSION` 4→5 作废旧语义聚合。
> 契约锁定：`test/java-same-package-dead-export-consistency-test.js`。详见 CHANGELOG。

### ⚠️ 预防性约束：postProcess 注入的 importRecords 不落盘

**约束**：`setParseResult` 在 postProcess **之前**持久化——任何在 postProcess 阶段注入 importRecords 的新逻辑（现有：java wildcard tier1 / same-package tier3），其记录都不会进 parse_results。新增此类注入时，**必须**同步在 orchestrator 的 loadGraph 成功分支重跑注入，或改为持久化元数据，否则 warm 路径静默丢数据（L1-3 的根因即此）。

**触发条件**：新增任何 postProcess 阶段的图结构/记录注入逻辑时。

---

## L2 债务（阻塞演进或导致结果不可信）

### L2-10：symbol-table 解析策略没有精度基准，两个真实仓实测净产出为负

**状态**：复测完成（2026-07-28），**判决数据齐备，待拍板**。JS/TS 家族四个真实仓命中恒为 0：

| repo | 总边 | symbol-table |
| --- | ---: | ---: |
| GitNexus (TS) | 2621 | 0 |
| zod (TS) | 374 | 0 |
| execa (TS) | 1044 | 0 |
| workspace-bridge (JS) | 1018 | 0（闸前 209，全是假边） |

加上 Python 两仓（CodeGraphContext 400 / code-review-graph 252，均 0），该策略在 JS/TS/Python 六个仓上**从未产出过一条正确边**；唯一的正产出在 Rust（qartez-mcp 313/594 = 52.7%，156 条 crate 绝对路径全对）。注意口径：闸后 JS 侧命中为 0 部分**是因为闸把裸 specifier 全拦了**——闸前本仓那 209 条说明没拦时它只会猜错。两种情况都不支持保留。

**证据**：本仓 dogfood，闸前 1219 条边里 209 条由 `trySymbolTable` 产出，**全部是假边**（`parsers/js/shared.js` 把 `const path = require('path')` 带进了 `module.exports`，全仓每个 `require('path')` 都被解析成指向它的边，confidence 0.8/tier2），`impact parsers/js/shared.js` 因此报 212 个被依赖文件，真值 3。GitNexus（2621 边）上该策略贡献 0 条。

**为什么是债**：`SYMBOL_DISAMBIGUATION` 的 `SCORE_SAME_DIR: 40 / SCORE_SAME_MODULE: 20 / SCORE_SAME_EXT: 10 / MIN_GAP_THRESHOLD: 20` 四个常数没有任何实测依据，单测只锁了不变量（不解析非导出符号、平分返回 null），锁不住精度。没有基准，这四个数字没人敢动，也无法判断策略该留该删。

**建议动作**：把 `trySymbolTable` 从 JS 家族链上摘掉（保留 Rust，JVM 保留待 L2-11 一并定）——连带收益：L2-11 的 JS 闸（`readPackageDeps`/`NODE_BUILTINS`/`node_modules` 探测）与 L3-4 的扩展名分支一起消失。Python/Go 链同理可摘（贡献同为 0，且闸已让它们的命中不可能为真），但 Python/Go 各有 `tryPythonAbsolute`/`tryGoModule` 结构解析在前，摘符号表影响面与 JS 相同。**这是结构性决定，等用户拍板。**

**触发条件**：调整 `SYMBOL_DISAMBIGUATION` 任一常数、或把符号表铺到新语言之前。跑 `node scripts/resolver-precision.js reference/*` 取数。

### L2-11：外部依赖闸只覆盖 JS 家族 — 违反 AGENTS.md 铁律 #8（多语言等价性）

**状态**：大部分收敛（2026-07-28）。JS 家族（node 内建 / `package.json` 四类依赖字段 / `node_modules`）、Rust（`std`/`core`/`alloc`/`proc_macro` 前缀 / `Cargo.toml` 声明的 crate，`path = ` 依赖不拦）、Python（标准库根段名单 / `requirements.txt` + `pyproject.toml` 的 `[project]` 与 poetry 依赖段，PEP 503 归一 + 别名表）与 Go（无需名单——import 永远带完整路径：module 路径之外的一切都不猜，dotted 首段 = 外部模块、无点首段 = 标准库）已有闸，经 `EXTERNAL_DEPENDENCY_CHECKS` 表分派。**Java / Kotlin 仍无闸**。

**为什么是债**：病灶机制与语言无关，且已在两种语言上实测到实例——JS 的 `require('path')`（本仓 209 条）与 Rust 的 `std::process::Command` / `rmcp::` / `tokio::`（qartez-mcp 48 条）。Python `import requests` 撞上本地导出的 `requests` 是同一形状，只是尚未取到样本。按铁律 #8 仍属语言偏斜。

**建议动作**：补 `pom.xml`/`build.gradle` manifest 读取器 + JDK 包名前缀名单（`java.`/`javax.`/`jdk.` 已是确定前缀，拦的就是第三方 groupId 与 import 包名不同构的那部分），加一行进 `EXTERNAL_DEPENDENCY_CHECKS`。注意：没有闸的语言，其 resolver 精度数据不可信（假边混在命中里）。

**触发条件**：任何语言的 unresolved import 报出"疑似被解析到本地同名符号"时，优先补该语言的闸。

### L2-12：Rust 的 `super::` / `crate::` 靠符号表猜名字命中，说明结构解析有缺口

**状态**：活跃（2026-07-28 测量发现）。qartez-mcp 闸后剩下的 313 条 symbol-table 边里，127 条根段是 `super::`、26 条是 `crate::`。

**为什么是债**：这两类是**结构可解析**的模块路径——`crate::a::b` 就是 crate 根往下走，`super::x` 就是父模块——本该由 `tryRustCrate` / `tryRustSuper` 按路径算出确定答案，而不是落到链尾拿末段名字去全局猜。猜对了也是运气：同名符号一多就会静默指错，且这类边带 confidence 0.8 的"较可信"标签。

**建议动作**：查 `resolvers/rust.js` 两个策略的覆盖缺口（很可能是 `mod.rs` / `lib.rs` 布局或多级 `super::super::` 未处理），补齐后这 153 条应当从 symbol-table 转到结构解析方法名下。用 `node scripts/resolver-precision.js reference/qartez-mcp` 验证转移。

**触发条件**：修改 `resolvers/rust.js` 时；或 Rust 项目报出可疑的跨模块边时。

### ⚠️ 预防性约束：`_invalidateParseCache()` 是 parse cache 的唯一失效入口

**状态**：已收敛（`builder.js` 中 `_invalidateParseCache(keyOrPath)` 统一负责内存 `_parseCache` 和 SQLite `cache.parseResults` + `parsedHashes` 的失效）。

**约束**：`builder.js` 的 `updateFiles()` 和删除文件循环中，parse cache 失效**只允许**通过 `this._invalidateParseCache(keyOrPath)`，**禁止**直接调用 `this._parseCache.delete()` 或 `this.dg.cache.deleteParseResult()`。

**为什么这是约束而非已修复债务**：当前只有两层 parse cache（内存 + SQLite），`_invalidateParseCache` 已覆盖。但如果未来新增第三层缓存（如聚合 summary 快照、内存 LRU 的热路径缓存），**必须在该方法内追加失效逻辑，不能在其他地方手工补 evict**。违反此约束会导致静默 stale（2026-07-03 的 mtime 失效 bug 便是先例：SQLite 层忘记 evict，内存层清了，fast path 读到 SQLite 旧数据 + 新 mtime → 跳过重解析）。

**触发条件**：新增任何与文件解析结果相关的缓存层时。

### ⚠️ 预防性约束：`regex-fallback` 缓存条目永不信任

**状态**：已收敛（2026-07-20，`builder.js` 的 `_isParseCacheUsable()` / `_isDegradedCacheEntry()` 统一四处缓存命中判定：`build()` / `parseFileOnly()` / `updateFiles()` fast path + SHA-256 path）。

**约束**：缓存命中判定**必须**经过 `_isParseCacheUsable()`，禁止再写裸的 `cached.mtime === meta.mtime`；`loader.js` 的 `loadGraph()`（从 SQLite 整图恢复的路径）同样必须拒绝含 regex-fallback 条目的缓存并回退 build()。`parseMode='regex' && parseModeReason='regex-fallback'` 的条目表示"外部 AST 工具链缺失时的降级产物"——缓存 key（mtime/SHA-256）看不见工具链变化（如 `pip install javalang`），此类条目必须每次重解析，拿到 AST 结果后自动恢复命中。

**为什么**：2026-07-20 dogfood 实测 bug——无 javalang 时 116 死导出入缓存，装好 javalang 重跑仍命中旧缓存拿到一模一样的垃圾数字，必须手删 cache.db。`regex-native` 语言（C/C++/Svelte）不受影响：regex 是它们的原生 parser。

**触发条件**：新增任何缓存命中判定路径、或修改 `checkFileChanges()` staleness 逻辑时。

---

> **当前活跃债务总览**：L1 Blocker **0** | L2 债务 **3**（L2-10 符号表精度待判决 / L2-11 外部闸缺 JVM / L2-12 Rust 结构解析缺口） | 架构债务 **0**（warm 后处理与版本门禁均已清零，转为预防性约束） | L3 品味问题 **2**（L3-4 扩展名分支 / L3-5 死方法） | 合计 **5 项**

## 架构债务（不阻塞功能，但阻塞演进速度）

### ⚠️ 预防性约束（原架构-1，2026-07-28 降级）：warm 与 cold 的产出必须逐字节一致

**已建立的机制**：
1. 后处理阶段由 `builder.runPostProcessPhases()` 统一执行，cold（`build()`）与 warm（orchestrator 的 loadGraph 成功分支）走同一个数组——经 `registerPostProcessPhase()` 注册的阶段自动两路径生效，不再需要在 warm 分支手工补调用。阶段必须幂等。
2. `test/warm-cold-parity-test.js` 锁契约而非接线：同一 fixture 冷启一次、暖启一次，比较**可观察输出**（边集、被依赖数、符号表含 `isExported`、重复符号数、`affected-tests` 含 `distance` 与 `source`）必须 deepStrictEqual。该测试同时断言第二次启动确实没调 `build()`——否则它会退化成"cold 比 cold"，在保护对象消失后依然全绿。变异验证：注释掉 loader 的 `_buildSymbolRegistry()` → RED。

**未做且刻意不做**：把 build 的后处理抽成单一 `finalize()` 序列。两条路径重建图的方式本质不同（cold 解析 import，warm 从持久化边恢复），塞进一个函数需要 warm/cold 条件分支——那是在消除边界的名义下增加判断。分歧由上面第 2 条的契约测试兜底，而不是由结构强行统一。

**约束**：新增任何 post-process 阶段或 warm 需要重建的派生状态时，走 `registerPostProcessPhase()`；如果它体现在可观察输出上，`warm-cold-parity-test.js` 会自动捕捉——**不要**为它单独写"锁调用顺序"的接线测试。

### ✅ 架构-2 已清零（2026-07-28）：CACHE_VERSION 门禁收敛到单一读侧闸口

**状态**：已修复。史：wave8 预计算污染 → `analysis_snapshots` 逐行盖戳 → `loader.js` 的 `edgeMeta` 门禁 → `savePrecomputed` 的 test_map 无条件重写，同一不变量补了四次。现 `graph-db.js` 的 `_readGuard` 是所有表读取的唯一入口（11 个读入口全部经由它，含长得不像 `loadXxx` 的 `findAffectedHttpRoutes` 递归 CTE），写侧 `_stampVersionIfUnset` 补齐出处。详见 CHANGELOG 2026-07-28 条目。

### ⚠️ 预防性约束：新增 SQLite 读方法必须走 `_readGuard`

**约束**：任何从 SQLite 读取版本化数据的新方法，**必须**通过 `this._readGuard(label, fn, fallback)`，并在 `test/graph-db-version-gate-test.js` 的 `READ_ENTRY_POINTS` 表里加一行。加不进那张表 = 它绕过了闸。唯一豁免是 `queryReadOnly`（人工排查入口，见其注释）。

**为什么是约束而非债务**：闸已收敛，但"读侧入口"是个会长的集合——`findAffectedHttpRoutes` 这次就是靠人工审计才发现的漏网，它用递归 CTE 直读 `edges` + `routes`，方法名里没有 `load`。

**触发条件**：新增任何直读 SQLite 表的方法时。

---

## L3 品味问题（建议修，非债务）

### L3-4：`trySymbolTable` 内部按扩展名分支两次，而链本身已经是按语言组装的

`resolvers.js` 的注册循环是 `[...lang.resolveStrategies, trySymbolTable]`——语言信息在组装时就有。但函数内部又按 `path.extname(fromFile)` 分支了两次：一次挑分隔符（`.rs` / `.go` / 其余），一次判外部依赖闸是否生效（JS 家族）。这是把语言差异塞进共享函数的边界判断，正是"消除边界优于加判断"要消掉的形状。改法：按语言注册不同的符号表策略（`trySymbolTableJs` / `trySymbolTableJvm` / …），共享打分内核。L2-11 补其他语言的闸时应当顺势做掉，否则第三、第四个语言分支会继续往里堆。

### L3-5：`lookupUnique()` 生产代码零调用

`symbol-registry.js` 的 `lookupUnique(symbolName, preferredDir)` 自 2026-07-23 被 `lookupBestMatch(symbolName, fromFile)` 取代后，生产路径已无调用方，只剩 `symbol-registry-test.js` 里 6 条用例还在测它。按"删除 > 添加、重复即债务"，应连同那 6 条用例一起删；保留的唯一理由是它的路径规范化用例（Windows 原生分隔符、冗余分隔符）——若删除，需确认 `lookupBestMatch` 侧有等价覆盖。

> 历史记录：弱断言分布已清理至 schema 契约测试中的防御性 `typeof` 检查；其余 `status === 0` 均为环境探测 helper，不属于测试断言。详见 [CHANGELOG.md](../CHANGELOG.md) [Unreleased] §Code Quality: Weak Assertion Cleanup。

---

## 开发纪律（不是代码债，是踩坑教训，必须记住）

### ⚠️ 「全绿」有盲区：测试覆盖了你想到的场景，没覆盖你没想到的

**案例**：2026-07-03 发现 `builder.js` 增量更新缓存失效 bug。`npm run test:fast` 130/130 全绿，但 bug 一直存在。原因是所有增量测试（`dep-graph-incremental-test.js`）只测了命名 import / 直接依赖，没有一个用 wildcard re-export（`export * from`）当探针。wildcard re-export 的导出列表依赖上游文件的实际解析结果，上游变更后如果缓存失效没传播，下游导出列表静默过期——而命名 re-export（`export { foo } from`）的导出列表来自自身源码，上游变更不影响它，所以假绿。

**纪律**：
1. **「全绿」只证明你想到的场景对，证明不了你没想到的场景不存在。** 每次声称"全绿"，心里必须补一句"在我测过的场景下"。
2. **增量逻辑的测试必须覆盖「依赖数据源变更后，下游数据是否刷新」，不只测「修改文件后自己的数据是否刷新」。** 典型探针：wildcard re-export、barrel file、`__init__.py` 重导出、TypeScript `export * from`。
3. **如果同一个被测模块有两种语法路径（命名 vs wildcard），两种都测。** 不能因为第一种 PASS 就假设第二种也 PASS。

### ⚠️ 假绿比红更危险

红的测试告诉你"这里有问题"→ 你会修。假绿告诉你"这里没问题"→ 你信了，然后带着 bug 上线。2026-07-03 的 mtime 失效 bug 是典型案例：130 个测试全 PASS，没有一个失败，但增量更新对任何文件修改都在静默返回旧数据。

**纪律**：看到全绿时，问自己"我有没有测过反向路径/边界条件/失效场景？"如果没有，全绿不表示安全。

---

## 文件级雷区地图

| 文件                                      | 行数 | 风险 | 状态                      |
| ----------------------------------------- | ---- | ---- | ------------------------- |
| `src/tools/git-tools.js`                | ~392 | 低   | L2-9 commit range 源      |
| `src/utils/stack-detectors/detect.js`   | ~443 | 低   | stack-detector 检测子模块 |
| `src/utils/stack-detectors/commands.js` | ~639 | 低   | stack-detector 命令子模块 |

---

## 测试覆盖缺口

> 所有核心/分析模块均已实现专属/直接单元测试覆盖（无遗留的零专属测试模块）。

---

> CLI Dogfooding 历史缺陷已全部修复，并按"修复即删"铁律完成清理（历史详情归档于 [CHANGELOG.md](../CHANGELOG.md) [Unreleased]）。
> 仍在的已知限制与陷阱详见 [ROADMAP.md](../ROADMAP.md) §已知限制。

## 规格参考与边界行为（非债务，供 Agent 查阅）

### ✅ 已验证的边界安全行为 (Verified Safe Boundary Behaviors)

| #  | 边界场景                                    | 结果                                                    | 评估        |
| -- | ------------------------------------------- | ------------------------------------------------------- | ----------- |
| 1  | **仅注释文件**                        | `severity=low`, `impact=0`, `affectedTests=0`     | ✅ 正确处理 |
| 2  | **Shebang 脚本（无后缀）**            | `file-fallback`, `reason="source-not-indexed"`      | ✅ 正确处理 |
| 3  | **伪装成 `.js` 的二进制文件**       | `file-fallback`, `reason="ast-unavailable"`         | ✅ 优雅降级 |
| 4  | **UTF-16 BOM 文件**                   | `file-fallback`, `reason="ast-unavailable"`         | ✅ 优雅降级 |
| 5  | **超大文件（5万行 / ~350KB）**        | `file-fallback`, `reason="ast-unavailable"`, 无超时 | ✅ 性能安全 |
| 6  | **语法损坏的文件**                    | `file-fallback`, `reason="ast-unavailable"`, 不崩溃 | ✅ 优雅降级 |
| 7  | **符号链接 (Symbolic link)**          | 解析至真实目标，正常分析                                | ✅ 正确处理 |
| 8  | **表情/中文 Unicode 文件名**          | 符号正常解析                                            | ✅ 正确处理 |
| 9  | **`--save /dev/null`**              | 成功写入无报错                                          | ✅ 正确处理 |
| 10 | **自定义 `--cache-dir` + 删除重构** | 自动创建`cache.db`，正常重构                          | ✅ 正确处理 |
| 11 | **源文件修改后立即审计**              | 结果实时反映变更                                        | ✅ 正确处理 |
| 12 | **极短时间内连续运行相同命令**        | 命中缓存，结果稳定                                      | ✅ 正确处理 |

### 🔍 验证矩阵 (Validation Matrices & Behavior)

#### Exit Code 契约矩阵

| 执行情况                       | 命令示例                                         | 实际退出码 | 预期语义                | 状态    |
| ------------------------------ | ------------------------------------------------ | ---------- | ----------------------- | ------- |
| **干净运行**             | `node cli.js audit-summary`                    | `0`      | 执行成功                | ✅ Pass |
| **无问题 + 严格模式**    | `node cli.js dead-exports --fail-on-findings`  | `0`      | 成功（未发现债务）      | ✅ Pass |
| **发现债务 + 严格模式**  | `node cli.js audit-summary --fail-on-findings` | `1`      | 业务/校验失败           | ✅ Pass |
| **缺少参数**             | `node cli.js impact` (无 `--file`)           | `2`      | 参数错误                | ✅ Pass |
| **无效命令**             | `node cli.js invalid-command`                  | `2`      | 执行失败                | ✅ Pass |
| **未找到目标文件**       | `node cli.js tree --file missing.js`           | `1`      | 业务/校验失败           | ✅ Pass |
| **路径越权 (Traversal)** | `node cli.js audit-file --file /tmp/x.js`      | `1`      | 安全违规 (受保护工作区) | ✅ Pass |
| **REPL 错误命令**        | `repl --eval "invalid"`                        | `2`      | 预期执行失败            | ✅ Pass |

#### 路径边界处理矩阵

| 路径语法                     | 示例                                | 解析状态    | 备注                         |
| ---------------------------- | ----------------------------------- | ----------- | ---------------------------- |
| **相对路径**           | `src/services/container.js`       | ✅ 已解析   | 正常工作。                   |
| **含 `./` 相对路径** | `./src/services/container.js`     | ✅ 已解析   | 正常工作。                   |
| **绝对路径**           | `C:/Users/sdses/.../container.js` | ✅ 已解析   | 正常工作。                   |
| **Windows 反斜杠**     | `src\services\container.js`       | ✅ 已解析   | 兼容支持。                   |
| **Unicode / 中文**     | 原生路径字符串                      | ✅ 已解析   | fs 标准支持。                |
| **目录**               | `src/services/`                   | ⚠️ 已接受 | 接受但产生空统计。           |
| **非项目文件**         | `/tmp/external.js`                | ✅ 已拒绝   | 被 path-traversal 防御拦截。 |
| **非代码文件**         | `README.md`                       | ✅ 优雅降级 | 安全排除在 dep-graph 之外。  |

### 💡 SKILL.md 适配建议

1. **默认格式选择**：AI 集成时，避免默认推荐 `--format markdown --quiet`，应优先推荐 `--json --quiet` 以减少 Markdown 字符串拼接和正则解析开销。
2. **重新评估 `audit-overview`**：不要将其放入 "avoid" 禁用清单，它包含 `knowledgeRisk` 和 `hotspots` 等 `audit-summary` 不提供的关键指标。
3. **精简调用**：在 AI 审计特定文件时，`audit-file --json` 会在内部自行算好 `impact` 与 `affected-tests`，无需二次分步运行多个 CLI。
4. **过滤 Heuristics 误报**：在消费 `affected-tests` 时，优先处理 `source: "graph"` 的确定性依赖，低优先级处理 `source: "mention"`。
5. **消费 `coChanges`**：`audit-file --json` 输出的 `coChanges[]` 指出了历史协同变更概率高的文件，对 AI 评估潜在波及范围非常有价值。

---

*Last updated: 2026-07-23（活跃债务清零：L1=0 / L2=0 / 架构债务=0 / L3=0；本轮 L1-3 清零：tier3 不参与已使用判定 + loadGraph 后重跑展开 + CACHE_VERSION bump + 契约测试；新增预防性约束「postProcess 注入的 importRecords 不落盘」；wave8 与 query-tools 历史 flaky 同日根治（深度门禁 + 版本戳门禁 + 单一写入方）；npm run test:fast 137/137 PASS；**全量 runner 251/251 全绿**）*
