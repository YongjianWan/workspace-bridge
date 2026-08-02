# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

### ⚠️ 预防性约束：postProcess 注入的 importRecords 不落盘

**约束**：`setParseResult` 在 postProcess **之前**持久化——任何在 postProcess 阶段注入 importRecords 的新逻辑（现有：java wildcard tier1 / same-package tier3、go-module 包导入展开 tier1 / go same-package tier3），其记录都不会进 parse_results。新增此类注入时，**必须**同步在 orchestrator 的 loadGraph 成功分支重跑注入，或改为持久化元数据，否则 warm 路径静默丢数据（L1-3 的根因即此）。

**触发条件**：新增任何 postProcess 阶段的图结构/记录注入逻辑时。

---

## L2 债务（阻塞演进或导致结果不可信）

### 依赖准确性缺口排序（2026-08-01 登记；目标：文件/函数级依赖更准，按回报）

1. ~~Go 包导入绑字母序首文件~~ ✅（2026-08-01 随 L2-21 修复销记，史见 CHANGELOG）
2. ~~Python 标准库判定 23/290~~ ✅（2026-08-01 随 L3-15 修复销记：换源 `sys.stdlib_module_names`，史见 CHANGELOG）
3. ~~**JVM 第三方 manifest 未读**~~ ✅（2026-08-02 修复销记，史见 CHANGELOG 同日条目：`readJvmDeps` 三源合并 + 闸否决证据 + jdk/sun 名单；前提被侦察修正——原描述「一律挡不住」过时，真缺口是 Kotlin `package` 零抽取 / 前缀碰撞 / jdk-sun 无名单，三者同轮闭合。groupId↔包名不同构由 `JVM_IMPORT_ALIASES` 别名表承接，精度天花板仍在，v2 多模块链记账于 SESSION）。

> **标准库/官方包本体不引入图中**（反复被问，留档）：影响分析从变更文件流向依赖方，标准库既不是变更源也不是你代码的依赖方，**永远不出现在任何一次查询的答案里**，拉进来是纯成本（Python stdlib 数千文件、JDK 数万 class，且 Python/Java 每文件一次 spawn）。需要的是官方 **manifest**（项目自己声明、不会腐烂），不是官方**包**。

（L2-21 的历史——cobra 12 边诊断、tryGoModule 绑首文件 bug、四轮变异实验与独立复核降级、② 受控复跑 + 四处单点归因、Go 写侧修复与 cobra 12→279 复测——已按「修复即删」移入 CHANGELOG 2026-08-01 条目。）

### ~~L2-22：Rust symbol-table 去留~~ ✅ 判留（2026-08-01，史见 CHANGELOG 同日条目）

> ripgrep 第二仓取数：129 边 / symbol-table 45 条（34.88%），逐条人工核对形状全合法（`crate::` 绝对路径 / workspace 跨 crate / `self::`），与 qartez-mcp 互证无一假边——合法辖区坐实，符号表在 Rust 保留。L3-4 的「塌成 JVM 专用」终态路径随之作废。

### ⚠️ 预防性约束：`_invalidateParseCache()` 是 parse cache 的唯一失效入口

**状态**：已收敛（`builder.js` 中 `_invalidateParseCache(keyOrPath)` 统一负责内存 `_parseCache` 和 SQLite `cache.parseResults` + `parsedHashes` 的失效）。

**约束**：`builder.js` 的 `updateFiles()` 和删除文件循环中，parse cache 失效**只允许**通过 `this._invalidateParseCache(keyOrPath)`，**禁止**直接调用 `this._parseCache.delete()` 或 `this.dg.cache.deleteParseResult()`。

**为什么这是约束而非已修复债务**：当前只有两层 parse cache（内存 + SQLite），`_invalidateParseCache` 已覆盖。但如果未来新增第三层缓存（如聚合 summary 快照、内存 LRU 的热路径缓存），**必须在该方法内追加失效逻辑，不能在其他地方手工补 evict**。违反此约束会导致静默 stale（2026-07-03 的 mtime 失效 bug 便是先例：SQLite 层忘记 evict，内存层清了，fast path 读到 SQLite 旧数据 + 新 mtime → 跳过重解析）。

**触发条件**：新增任何与文件解析结果相关的缓存层时。

### ⚠️ 预防性约束：路径归一化只进比较与缓存键，不进返回值

**约束**：任何**走树**的 helper（`findCargoCrateRoot` / `packageManifestChain` / 未来的同类），比较与缓存键必须过 `normalizePathKey`（调用方给的路径有原始与归一化两种形态，Windows 上差大小写与分隔符，裸 `startsWith` 会静默截断），但**返回值必须保持平台原生、原大小写**——消费方拿返回值 `path.join` / `startsWith` 对齐 file-index 的原生路径，归一化返回会反向打破另一边的算术，还会把按路径键控的缓存劈成两份。

**病史**：同一陷阱三个实例，两个方向都踩过——缺口 A 的比较方（不归一化比较，链静默只剩根 manifest）、`findCargoCrateRoot` 的返回方（归一化后返回，gors 测试当场红）、`packageManifestChain` 的返回方（同形，2026-07-28 收刀）。契约锁在 `testPackageManifestChainReturnsNativePaths`。

**触发条件**：写任何「归一化后做路径算术，再把路径还给调用方」的函数时。

### ⚠️ 预防性约束：`regex-fallback` 缓存条目永不信任

**状态**：已收敛（2026-07-20，`builder.js` 的 `_isParseCacheUsable()` / `_isDegradedCacheEntry()` 统一四处缓存命中判定：`build()` / `parseFileOnly()` / `updateFiles()` fast path + SHA-256 path）。

**约束**：缓存命中判定**必须**经过 `_isParseCacheUsable()`，禁止再写裸的 `cached.mtime === meta.mtime`；`loader.js` 的 `loadGraph()`（从 SQLite 整图恢复的路径）同样必须拒绝含 regex-fallback 条目的缓存并回退 build()。`parseMode='regex' && parseModeReason='regex-fallback'` 的条目表示"外部 AST 工具链缺失时的降级产物"——缓存 key（mtime/SHA-256）看不见工具链变化（如 `pip install javalang`），此类条目必须每次重解析，拿到 AST 结果后自动恢复命中。

**为什么**：2026-07-20 dogfood 实测 bug——无 javalang 时 116 死导出入缓存，装好 javalang 重跑仍命中旧缓存拿到一模一样的垃圾数字，必须手删 cache.db。`regex-native` 语言（C/C++/Svelte）不受影响：regex 是它们的原生 parser。

**触发条件**：新增任何缓存命中判定路径、或修改 `checkFileChanges()` staleness 逻辑时。

---

> **债务总览（2026-07-28 重排）**——记账口径按用户要求改了：**债务不会消失，只会转移优先级**。所以下面不写"清零"，写"现在排在哪一层"。已修条目的机制债（不是那个实例，是让它能发生的结构）一律留在预防性约束里，那才是它转移之后的位置。
>
> | 层 | 条目 | 为什么在这一层 |
> | --- | --- | --- |
> | **P0 现在做** | ~~L2-11 三个闸缺口~~ ✅ 清零（2026-07-28，A/B/C 同日：manifest 链 / 标准库名单补漏 / JVM 零名单闸）——**P0 出空，下一层自动顶上来** | zod 80→4 / CodeGraphContext 70→34 / spring-petclinic 362→0；报警器现在的每一次响都默认是真信号 |
> | **P1 紧随** | ~~L2-21 Go 包级依赖无图~~ ✅（2026-08-01：变异实验收口 + 包导入展开全包 + 同包 tier3 边，cobra 12→279 全可解释，史见 CHANGELOG） · ~~L2-16 Rust crate 名归一~~ ✅ · ~~L2-17 Python namespace 包~~ ✅（2026-07-28，丢弃 34→26） · ~~L2-18 Rust parser 花括号列表前缀~~ ✅ · ~~L2-19 Rust 裸首段 use~~ ✅ · ~~L2-20 tree-sitter 装填竞态~~ ✅——**P1 出空，下一层自动顶上来** | L2-21 销记：Go 边层不再是文件粒度图装不下包语义——包导入绑全包、同包互引有 tier3 边 |
> | **P2 依赖前两层** | ~~L2-10 符号表判决（T6）~~ ✅ 已拍已执行（2026-07-31：摘 JS/TS/Python、留 JVM、Go/Rust 不动，史见 CHANGELOG） · ~~L2-22 Rust 去留~~ ✅ 判留（2026-08-01，ripgrep 45 条全真边坐实辖区） · ~~L2-14 JVM 源根~~ ✅（2026-07-30，KMP 布局 + 成员导入，st 1037→111）——**P2 出空，L2 层清零** | T6 的 Rust 半局由第二仓闭合：45 条可核对真边，判留 |
> | **P3 记账不排期** | L3-4 扩展名分支（T6 后只剩 JVM/Rust/Go/C++ 共享段，L2-22 判留后塌缩终态作废） · ~~L3-5 死方法~~ ✅（2026-08-02 `lookupUnique` 连测试删除） · L3-7 Vue/Svelte 正则抽符号 · L3-8 防御性兜底 · L3-9 Python/Java spawn AST → tree-sitter 迁移 · L3-10 hasCpp 不覆盖纯 .c 仓 · L3-11 双 freshness 判据 · L3-12 分层靠猜 · L3-13 每条各自冷启动 · L3-14 tryJava probe 放大缺前后对照 · ~~L3-15 Python stdlib 手抄名单~~ ✅（2026-08-01 换源 sys.stdlib_module_names） | L3-8 走"接触即修"，不做大扫除；L3-11 的沉默已修、分歧留档；L3-12/13 是测试执行债，可观测性与调度已落地，剩下两条都要"先测再改"；L3-14 是纯测量债，有变慢迹象再取 |
> | **P4 冻结** | 见下方 P4 冻结区 | 语言出范围 / 明确不做，每条带解冻条件 |
> | **预防性约束** | postProcess 记录不落盘 · `_invalidateParseCache` 单一入口 · regex-fallback 缓存不信任 · warm/cold 逐字节一致 · `_readGuard` 单一读闸 · DependencyGraphView 白名单同步 · 「本轮实测」字段不进快照 · 门禁型出口不吃 replay · **路径归一化不进返回值**（新，三个实例后的收刀） | 这些是已修债务转移后的形态：实例没了，让实例发生的结构还在 |
>
> 2026-07-28 同日按「修复即删，历史只进 CHANGELOG」清理：L1-3 / L1-4 / L2-11 / L2-12 / L2-13 / L2-16 / L2-17 / L2-18 / L2-19 / L2-20 / L3-6 / 架构-2 / 测试覆盖缺口（T1 已兜住）的实例记录已移除（CHANGELOG 等价覆盖逐条核实），机制债转移进预防性约束。

## 架构债务（不阻塞功能，但阻塞演进速度）

### ⚠️ 预防性约束（原架构-1，2026-07-28 降级）：warm 与 cold 的产出必须逐字节一致

**已建立的机制**：
1. 后处理阶段由 `builder.runPostProcessPhases()` 统一执行，cold（`build()`）与 warm（orchestrator 的 loadGraph 成功分支）走同一个数组——经 `registerPostProcessPhase()` 注册的阶段自动两路径生效，不再需要在 warm 分支手工补调用。阶段必须幂等。
2. `test/warm-cold-parity-test.js` 锁契约而非接线：同一 fixture 冷启一次、暖启一次，比较**可观察输出**（边集、被依赖数、符号表含 `isExported`、重复符号数、`affected-tests` 含 `distance` 与 `source`）必须 deepStrictEqual。该测试同时断言第二次启动确实没调 `build()`——否则它会退化成"cold 比 cold"，在保护对象消失后依然全绿。变异验证：注释掉 loader 的 `_buildSymbolRegistry()` → RED。

**未做且刻意不做**：把 build 的后处理抽成单一 `finalize()` 序列。两条路径重建图的方式本质不同（cold 解析 import，warm 从持久化边恢复），塞进一个函数需要 warm/cold 条件分支——那是在消除边界的名义下增加判断。分歧由上面第 2 条的契约测试兜底，而不是由结构强行统一。

**约束**：新增任何 post-process 阶段或 warm 需要重建的派生状态时，走 `registerPostProcessPhase()`；如果它体现在可观察输出上，`warm-cold-parity-test.js` 会自动捕捉——**不要**为它单独写"锁调用顺序"的接线测试。

### ⚠️ 预防性约束：新增 SQLite 读方法必须走 `_readGuard`

**约束**：任何从 SQLite 读取版本化数据的新方法，**必须**通过 `this._readGuard(label, fn, fallback)`，并在 `test/graph-db-version-gate-test.js` 的 `READ_ENTRY_POINTS` 表里加一行。加不进那张表 = 它绕过了闸。唯一豁免是 `queryReadOnly`（人工排查入口，见其注释）。

**为什么是约束而非债务**：闸已收敛，但"读侧入口"是个会长的集合——`findAffectedHttpRoutes` 这次就是靠人工审计才发现的漏网，它用递归 CTE 直读 `edges` + `routes`，方法名里没有 `load`。

**触发条件**：新增任何直读 SQLite 表的方法时。

### ⚠️ 预防性约束（2026-07-28 新登记）：`DependencyGraphView` 是白名单，新增 facade 方法必须同步

**约束**：任何加进 `DependencyGraph`（`src/services/dep-graph.js`）的公开读方法，**必须**同步加进 `DependencyGraphView`（`src/models/workspace-snapshot.js`）的委托列表。工具层拿到的是 `container.snapshot.graph`（视图），不是裸图——漏一行 = 该方法在整条产品路径上不存在。

**病史**：T5 的 `getDroppedImports` 就漏了。视图上不存在 + 调用点写了 `?.()` 兜底 = 输出段恒为 0，**261 个测试全绿**。测试没抓住是因为它拿的是 `container._depGraph`（裸图），锁的语义对、锁的入口错。

**衍生纪律（比约束本身重要）**：新增 facade 方法的契约测试**必须至少有一条走 `container.snapshot.graph`**，不能只测裸图。裸图断言证明的是"算得对"，视图断言才证明"用户拿得到"。

**为什么不改成默认委托 + 黑名单**：视图的白名单是有意的——它挡住 `build`/`updateFiles`/`analyzeFile` 这些生命周期方法，改成 Proxy 默认转发会把可变入口一起放出去。代价就是这条同步义务，认了；用上面那条测试纪律兜底，而不是靠记性。

**触发条件**：给 `DependencyGraph` 加任何公开方法时。

### ⚠️ 预防性约束（2026-07-28 新登记）：「本轮实测」型字段不得随快照 replay

**约束**：任何回答「这个数字是不是**这一轮**算出来的」的字段（当前只有 `droppedImports.measured`），**必须**在 replay 出口按当前图现算覆盖，不能让它跟着 `analysis_snapshots` 的数据一起搬。

**病史**：`measured` 加进来的当天就随快照 replay 了——warm 跑（甚至把出错的 import 删掉之后再跑）照样报 `measured: true`，一个专门用来标注「测没测过」的字段，答的是上一轮的答案。修法在 `overview-tools.js` 的 replay 分支（`5f0dbc0`）。

**为什么是约束**：快照新鲜度已经收紧到认内容签名（L2-15 收官，史见 CHANGELOG），replay 只在树没动时发生——但**约束不因此解除**。replay 机制本身还在，而「这个数字是不是这一轮算的」与「数据是不是最新的」是两个问题：树没动时 replay 的数据是对的，`measured` 却依然该答 false，因为这一轮确实没测。设计判据不变：这个字段描述的是**数据**还是**这次运行**？描述运行的，一律不进快照。

---

## L3 品味问题（建议修，非债务）

### L3-4：`trySymbolTable` 内部按扩展名分支两次，而链本身已经是按语言组装的

`resolvers.js` 的注册循环是 `[...lang.resolveStrategies, trySymbolTable]`——语言信息在组装时就有。但函数内部又按 `path.extname(fromFile)` 分支了两次：一次挑分隔符（`.rs` / `.go` / 其余），一次判外部依赖闸是否生效（JS 家族）。这是把语言差异塞进共享函数的边界判断，正是"消除边界优于加判断"要消掉的形状。改法：按语言注册不同的符号表策略（`trySymbolTableJs` / `trySymbolTableJvm` / …），共享打分内核。T6 若拍板摘符号表应顺势做掉，否则第三、第四个语言分支会继续往里堆。

**进展（2026-07-31 T6 执行）**：按语言组装的机制已落地——registry 条目声明 `symbolTableFallback: false`（JS 家族四语言 + Python），注册循环按它挂/不挂 `trySymbolTable`，JS/Python 链上的符号表分支**已随链一起消失**（不再是函数内分支，是链成员）。剩下的分支只服务还在链上的语言：分隔符 `.rs`/`.go` 分支 + `EXTERNAL_DEPENDENCY_CHECKS` 闸表。~~终态路径已写进 L2-22~~ **L2-22 已判留**（2026-08-01，ripgrep 45 条全真边）——塌成 JVM 专用的路径作废，这些分支长期服务 JVM/Rust/Go，本条维持 P3。

### ~~L3-5：`lookupUnique()` 生产代码零调用~~ ✅（2026-08-02，史见 CHANGELOG 同日条目）

> 删除前置条件（`lookupBestMatch` 侧需有等价路径规范化覆盖）实测不成立——先补 `testLookupBestMatchNormalizesFromFile`（冗余分隔符 + Windows 原生反斜杠两断言，杀变异验红），再连方法带 3 个孤儿测试函数删除。CACHE_VERSION 不动。

### L3-7：Vue / Svelte 的 `extractSymbols` 是逐行正则

注册表里这两个语言的 `extractSymbols` 用正则匹配 `class` / `function` / `const` 逐行抽符号，而它们的 `parse` 走的是 babel AST。同一语言两条路径两种精度。这不影响依赖边（边来自 `parse`），但它是"9 种语言 AST 覆盖 100%"这一说法的折扣项——`file-index.js` 消费的是正则那条。

> **Vue 的范围说明**（2026-07-28）：Vue **在范围内且边层健康**——`.vue` 在 `JS_FAMILY_EXTENSIONS` 闸内（`resolvers.js:111`）、parity 实测 `relative:1 / dropped:0`、`reference/vue-realworld-example-app` 是编制内基准仓、framework-patterns 有 vue-script 与 script-setup 宏两条检测。降级的只有本条 L3-7（符号抽取精度），**不是语言支持**。Svelte 的边层同样通着（T3 的闸 + realworld 12 边），只是它的语言级债务整体降 P3。

### L3-8：防御性兜底是这个项目复杂度的主要来源（`?.()` / `|| {}` / Proxy fallback）

**状态**：活跃（2026-07-28 登记，系统性问题，不指向单个文件）。同一轮里两个 bug 都不在逻辑里，都在**兜底**里：`getDroppedImports?.()` 把「视图没这个方法」兜成 0；test-helpers 的 Proxy 兜底 `() => []` 把「mock 没实现」兜成空数组（委托接通后立刻炸出两个 overview 测试——那是**好事**，静默的谎言变成了显式失败）。

**形状**：每一层都替下一层擦屁股。builder 记账 → facade → view → assembler → snapshot replay → CLI，六层，每层都写了「拿不到就当没有」。单看每处都叫稳健，合起来的效果是**错误永远传不到人眼前**，只能靠外部探针撞出来。这与铁律 #4「静默错误必须显式」是正面冲突——铁律写在 AGENTS.md 里，可选链写在代码里，代码赢了。

**判据（新增代码时问一句）**：这个 `?.` / `||` 兜的是**真实可能发生且可恢复**的情况，还是**结构性不该发生**的情况？后者一律让它炸。内部模块之间互相信任，不做防御性检查——只在真正的外部边界（用户输入、文件系统、spawn 子进程）设防。

**建议动作**：不做一次性大扫除（改动面太大、收益不可测）。改为**接触即修**：任何一次触碰到带兜底的调用点，顺手判断一次并处理掉。已处理：`overview-assembler` 的 `getDroppedImports?.()`（`cc82b0d`）；`GraphBuilder.workspacePackages` 的"未计算 = 空集 = 闸自我关闭"（2026-07-30，改为 `null` + `resolveFileOnly` 直抛）。

**待处理（2026-07-31 评审登记，L2-15 那批新写下的同族实例）**：`container.cache?.getContentSignature?.()` 两处（`overview-tools.js` 的 `isSnapshotFresh`、`query-tools.js` 的 `describeReplay`）+ `getContentSignature()` 内部的 `meta?.mtime` / `meta?.size`（`meta` 取自同一个 Map 的 keys，`undefined` 结构上不可能）。**方向都是 fail-safe** ——方法缺失退回重算/告警，不产出假数据，比 `getDroppedImports?.()` 那次轻一档；但形状一模一样，且是规则写进本文档**之后**新写的。这说明"接触即修"只在改老代码时生效，写新代码时没人想起来。下次碰 freshness 链时一并清掉。

**同族但形状不同的一个变种（同轮发现）**：不是兜底，是**覆盖**——`cli.js` 出口 `result.warnings = graph.buildWarnings()` 把命令自产的 warnings 整条删掉。兜底把"没有"说成 0，覆盖把"有"说成没有，殊途同归都是让信号到不了人眼前。写任何"统一填充响应字段"的出口逻辑时，先问一句：这个字段命令自己会不会已经填过？

**触发条件**：写下任何 `?.()` 或 `|| { 空值 }` 时；review 时看到跨层调用带兜底时。

> 历史记录：弱断言分布已清理至 schema 契约测试中的防御性 `typeof` 检查；其余 `status === 0` 均为环境探测 helper，不属于测试断言。详见 [CHANGELOG.md](../CHANGELOG.md) [Unreleased] §Code Quality: Weak Assertion Cleanup。

### L3-9：Python / Java AST 走 spawn Python 进程——部署脆性 + 成本离群，tree-sitter WASM 已在 node_modules 里躺着

**状态**：活跃（2026-07-28 语言解析深度盘点发现）。九语言里七门是进程内解析（Babel / tree-sitter WASM），唯独 Python 与 Java 每文件 **spawn 一个 Python 进程**（`scripts/python_ast_parser.py` / `java_ast_parser.py`，后者靠 javalang）。三层代价：(1) **部署脆性**——用户机器没有 python / javalang 就静默永远 regex（`spawn-ast.js` 自己承认 `'python-missing'` 会 recur，README 只写了 javalang 这条，Python 那条同病未写）；(2) **冷构建成本离群**——每文件一次进程创建，这两语言的冷构建贵一个量级；(3) **体系割裂**——`tree-sitter-wasms/out/` 35 个 grammar 里 `tree-sitter-python.wasm` 与 `tree-sitter-java.wasm` **都在**，偏偏这两门没用。迁移代价：重写 tree-sitter 查询与字段映射（fingerprint / `package` 抽取 / 装饰器 / 分支统计），java 侧要验证 tree-sitter-java 的 `package` 声明抽取与 javalang 等价（闸的零名单前缀集合全靠它，L2-11 缺口 C 的地基）。迁移后 L2-20 的共享串行锁自然覆盖这两门。

**触发条件**：动 `spawn-ast.js` / `python.js` / `java.js`、或用户报"没装 python 的机器上 Python/Java 仓解析质量差"时。

### L3-10：`hasCpp` 条件疑似不覆盖纯 `.c` 仓——cJSON 的 `languageSupport` 是空表

**状态**：活跃（2026-07-28 九仓实测发现，**未单独验证**）。cJSON（99 个 `.c`/`.h`）冷构建 `languageSupport: []`，但文件照样进图、照样记了 124 条 dropped——说明 parse 走了（扩展名映射层），语言支持声明层却没认这门语言。疑点：`registry.js` 的 cpp 条件 `workspace.hasCpp` 的探测逻辑可能只看 `.cpp`/`.cc`/`.hpp`，纯 `.c` 仓落空。后果待查：`languageSupport` 空会影响哪些消费方（能力声明 / 报告展示）没摸清；124 条 dropped 的构成也没分组（angle include 不解析是设计，但 124 是否全是设计内待验）。先验证条件探测再定改法——可能就一行（`.c` 加进探测列表）。

**触发条件**：纯 C 仓 `languageSupport` 为空、或改动 stack 探测 / registry 条件时。

### L3-11：同一行快照有两个 freshness 判据，两个消费方各判各的

**状态**：活跃（2026-07-30 评审登记，**沉默已修，分歧未消**）。`analysis_snapshots` 的 `'overview'` 行有两个读者，各带一份 `isSnapshotFresh`：`overview-tools.js` 那份自 L2-15 起比对 `content_signature`，`query-tools.js` 那份明写 "Intentionally skip content-change checks"（粗粒度换速度，是刻意的）。后果是原地编辑之后，`audit-overview` 重算而 `query-hotspots` 返回旧数字——**同一份数据，两个命令给出不同年代的答案**。

评审当轮修掉的是沉默那一半：query-* 现在挂 `replayedFrom.contentMatch` 并在漂移时告警（史见 CHANGELOG）。**没修的是分歧本身**——两份 freshness 逻辑各自演进，下一次给 overview 侧加判据时，query 侧不会自动跟上，也没有测试会红。

**为什么不直接统一**：统一就是取消 query-* 的速度承诺（它存在的理由）。正确形状大概是一个判据函数带 `strict` 参数、共享全部字段比较，由调用方选严格度——而不是两份各写各的。**没做，因为改动面进 query-* 的热路径，收益是防未来漂移而非修当前 bug**，不值得在 T6 之前动。

**触发条件**：给任一侧的 `isSnapshotFresh` 加/改判据时——**必须同时看另一侧**，并决定这条判据属不属于粗粒度那份。

### L3-12：测试分层靠猜不靠测——slow 层 43% 是启发式塞进去的

**状态**：活跃（2026-07-30 实测登记）。`runner.js` 的 `classifyTest` 第三优先级按"文件里提到什么 API"判层：出现 `runCli` / `new ServiceContainer` / `new FileIndex` → slow。**这是猜测，不是测量**。run report 的 `classifiedBy` 字段现在把它变成了可数事实：

| 来源 | 条数 | 中位耗时 |
| --- | ---: | ---: |
| `annotation-slow` + `known-slow-pattern`（声明） | 65 | 4394ms |
| `heuristic-runcli` + `heuristic-heavy-api`（**猜测**） | **49** | **1275ms** |

猜测那 49 条里 **30 条比 fast 层自己最慢的那条（3003ms）还快**，最快的 175ms，30 条加起来才 27.3s。它们全程排在 slow 队列里。

> 口径订正：这条债最初被描述为"73 个文件被静默降级"。那个数是拿"header 注解 fast 217 − 实跑 144"算的，而全仓只有 266 个测试文件，217 这个基数不成立。**实测是 49。** 结论方向不变，量级要按这里的表。

**为什么不是一行改动**：`needsCacheDir()` 把**缓存隔离绑死在层上**——非 fast 一律发独立 cache 目录，fast 只在文件内容命中 `runCli|spawnSync|child_process|WB_TEST_CACHE_DIR` 时才发。抽查 5 个候选（`java-package-imports` / `precompute-aggregate` / `cache-stale-prune` / `file-index-rename` / `container-workspace-info`）**全部不含这些锚点**：直接改层 = 它们掉进真实项目缓存，互相串味。这个仓库被缓存串味咬过两次（2026-07-20 phase35/query-tools 快照注入未恢复、2026-07-03 mtime 失效），代价都是"全绿但数据是假的"。

**建议动作（按成本升序，前两条必须一起做）**：
1. 把 `needsCacheDir()` 与层解耦——隔离需求由内容单独判定，不再问"你是哪层"。这是前置，单独做也有价值（它现在给一批不需要隔离的 slow 测试白发目录，NTFS 上 mkdtemp/rm 不便宜）。
2. 引入 `// @fast` 显式标注（优先级 1，声明压过猜测），按 report 实测耗时逐个下放，**每下放一批就跑一次对照**——成员集合变了，别和调度/并发改动混在一起归因。
3. 长期：把 `classifiedBy` 为猜测且实测 < 3s 的条目做成 CI 提示，让分层随实测自动收敛，而不是靠人记得回来看。

**触发条件**：改 `classifyTest` / `needsCacheDir` / `KNOWN_SLOW_PATTERNS` 时；或 `runner-classification-test.js` 的启发式计数掉到 0（那说明这条债已清，连同该测试一起删）。

### L3-13：slow 层每条测试各自冷启动——池子和并发只能摊开它，消不掉

**状态**：活跃（2026-07-30 实测登记）。114 条 slow 测试 CPU 累计 903s（并发 2 实测），**平均每条 7.9s**；而 `warmCache()` 一次冷 `audit-summary` 是 12–13s。每条测试各自 `new ServiceContainer` + 建图 + 建 cache，warm cache 拷贝只省掉一部分。

**为什么是债**：这是**结构问题不是配置问题**。2026-07-30 的两刀已经把调度和并发的水挤干了——775s → 466s（换工作池）→ 317s（并发 2→4），但那些收益全部来自"把同样多的启动费并行摊开"。CPU 累计不降反升（903s → 1167s）。剩下的路只有消除重复启动本身。

**影响面**：本地开发循环 + CI 的 `test-slow.yml`。当前墙钟 317s（本机 18 线程，C=4）。理论下界 `max(CPU/并发, 最长单条)`——目前是 CPU 项主导，说明还有空间；一旦最长单条成为主导项，加机器就没用了。

**建议动作（按成本升序）**：
1. **先测再改**：从 run report 里挑 CPU 占比最高的 10 条，确认它们的时间真花在容器初始化上而不是别处。没有这一步就上共享 fixture 是在优化一个假设。
2. 共享 warm fixture：一份预建图，测试只读不写。**风险是这套方案里最高的**——共享状态引入测试间耦合，而"slow 层曾腐烂"那次的病根正是这类耦合。必须配一条"每个测试单独跑也必须过"的检查，否则耦合会伪装成通过。
3. 把真正需要写的测试留在独立容器里，别为了统一硬塞。

**相邻但不同的问题（别混进来）**：`runner --affected`——用仓库自己的 `affected-tests` 从 git diff 算要跑的子集。那解决的是"我只想跑相关的"（选择），不是"跑得快"（速度）；它不会让全量变快，CI 仍要跑全量。想做可以做，但它不属于本条债的修复路径。

**触发条件**：动 `warmCache()` / 测试的容器初始化方式时；或 slow 层墙钟的瓶颈从 CPU 累计项转到最长单条项时（此时本条债升级为唯一出路）。

### L3-14：`tryJava` 逐段剥尾的 probe 放大缺前后对照（测量债，非阻塞）

**状态**：2026-07-31 登记（原挂 L2-10/T6 名下，T6 执行后转独立条目）。

**缺口**：L2-14 的成员导入逐段剥尾把 `tryJava` 的 probe 数从 `roots × 2` 变成 `segments × roots × 2`，depth≥2 下潜又让 roots 变多——miss 路径的 probe 数被两级放大。CHANGELOG 记的全是边数，**没有一次前后对照的冷构建墙钟**。

**已知的**：depth≥2 修复后 HEAD 现状两次独立实测 **186.5s / 177s**（okhttp 2760 边，整脚本墙钟含收集开销）。量级不吓人。

**不知道的**：「不吓人」和「没变慢」是两句话——没有「前」（`053e17a~1`），绝对值回答不了 L2-14 有没有引入回归。取法：在 `053e17a~1` 开 worktree（无 `node_modules`，得挂 junction）单独跑一次。

**为什么不阻塞任何决定**：原登记理由是「T6 一摘 JVM 就只剩 `tryJava` 承重」——T6 判决 **JVM 保留符号表**，前提已消失。剩下的动机只是量化 L2-14 的性能回归本身，有用户感知变慢的迹象时再做。

**触发条件**：收到 JVM 仓构建变慢的报告；或动 `tryJava` probe 路径 / `discoverJavaSourceRoots` 扫描深度时顺手补。


### ~~L3-15：Python 标准库判定是手抄的 23 个名字，而进程里就坐着权威来源~~ ✅（2026-08-01，史见 CHANGELOG 同日条目）

> 换源 `sys.stdlib_module_names`（新模块 `resolvers/python-stdlib.js`，spawnSync + 进程 memo），手抄名单降级为 python-missing 兜底；同刀删 `PYTHON_BUILTINS`/`GO_BUILTINS` 死名单与死 `isBuiltIn`。前后对照零 delta（CodeGraphContext 26→26、code-review-graph 6→6）——卫生债，不是正确性债。

---

## P4 冻结区（已登记，不排期；解冻条件写在每条里）

> 这些不是"已解决"，是**优先级被移走**。语言范围（2026-07-28 用户拍板）：TS/JS（含 `.jsx`/`.tsx`，即 React——它不是独立语言，走同一 parser / 同一链 / 同一闸）、Python、Go、Rust、Java、Vue 在范围内；Kotlin / C·C++ / Svelte 边层通着但债务降级。

- **C/C++ `tryCppInclude` 不校验命中类型与仓外爬升**（`resolvers/cpp.js`）：`cachedExistsSync` 只判 stat 非 null，`#include "utils"` 撞上同名**目录**会返回目录当边；`#include "../../../x.h"` 会把仓外文件拉进图。`tryRelativeWithExtensions` 同款（既有行为，非本轮引入）。解冻条件：C/C++ 回到范围内，或任何仓报出目录型节点 / 仓外路径节点。改法：命中后加 `isFile()` + root 包含判定。
- **`resolveFileOnly` 的 ext 大小写不一致**（`builder.js:407`）：`resolveImport` 拿裸 `path.extname(filePath)`，而 T5 的闸调用拿 `ext.toLowerCase()`。`MAIN.C` / `Foo.H` 这类文件 resolver 链落到 default（等于回到 L1-4 的病），而丢弃记账走 cpp 闸——两边判定分叉。解冻条件：出现大写扩展名的真实仓，或统一 ext 归一时顺手做掉（一行）。
- **仓库根目录两个垃圾目录**：`UserssdsesAppDataLocalTempwb-test-b331ad95` / `UserssdsesAppDataLocalTempwb-test-cache`（2026-07-20 遗留，某测试把 Windows 绝对路径当相对目录用、分隔符被吃掉）。`git status` 看不见是因为里面只有被 ignore 的 `cache.db`。可直接删；根因是哪个测试没查。
- **Next.js 路由提取缺失**（`framework-patterns.js`）：有 Nuxt（:143）与 SvelteKit（:145）的 route query，**没有 React/Next**（该文件 `react`/`next` 零命中）。后果：Next 的文件系统路由（`app/` / `pages/api/`）抽不出，`api-contracts` 拿 Next 当后端全部对不上。**明确不做**——它是加特性不是减债，与当前"只做减法"的方向冲突。解冻条件：噪声治理完成（L2-11 三缺口 + L2-16）之后，若真实 Next 仓的实测数据支持，再评估。

---

## 开发纪律（不是代码债，是踩坑教训，必须记住）

### ⚠️ 覆盖率声明必须写清「在哪一层验收」，否则它保护的是层，不是能力

**案例**：2026-07-28 发现 C/C++ 产不出任何依赖边（L1-4），而 ROADMAP 同期写着"全栈 AST 覆盖 9/9 = 100%"——**这句话是真的**，C/C++ 的 tree-sitter 确实跑通，`parse_mode` 老实写着 `ast`，`parseCppAst` 直接调也能拿到 `importRecords`。问题在于铁律 #8 的等价性一直在 parser 层验收，而用户拿到的能力（边、impact、孤儿判定）在 resolver 之后。两层之间隔着一个把 resolve 失败记录直接丢弃的分支，整整一个语言从那里漏掉，所有绿灯都没变色。

**纪律**：
1. **写"X 覆盖 100%"时必须补上在哪一层测的。** "AST 覆盖 100%"和"依赖边覆盖 100%"是两个命题，前者推不出后者。
2. **验收点要选在用户消费的那一层。** 中间层全绿而末端为空，是最难发现的一类假绿——因为每个模块的测试都是对的。
3. **多语言等价性的最小探针是"A 依赖 B 能不能成边"。** 十行 fixture、每语言一个，比任何 parser 单测都更能证明这门语言真的可用。

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

> 所有核心/分析模块均已实现专属/直接单元测试覆盖（无遗留的零专属测试模块）。层级覆盖缺口（边层横向对比）已由 T1 的 `test/language-parity-edges-test.js` 兜住——十语言 fixture 各一条「A 依赖 B」，断言至少 1 条边且 `droppedCount` 全 0（史见 CHANGELOG T1 条目）。教训沉淀在上方「开发纪律」第一节。

> **2026-08-01 两处零覆盖已补守护（同日登记同日渐补）**：`analyzer.js:646`（cycles Rule 5）与 `:352`（GraphAnalyzer 版 reason 标签）由 `test/analyzer-same-package-guards-test.js`（4 例）锁定——646 锁 Java/Go 双语言 `getCycleMeta().sccCount === 0`（**cycles 列表断言守不住**：`_isSamePackageCycle` 后过滤兜底，SCC 数才是杀伤信号），352 锁 `implicit-same-package` reason 标签（Java+Go）。杀变异逐例验红、还原验绿。守护就位后，读侧 7 处字符串判据已删（史见 CHANGELOG 同日条目）。同族防线不变：L1-3 死导出排除（`analyzer.js:1218`）由 `java-same-package-dead-export-consistency-test.js` 守着，query 版 reason 标签（`query.js:76`）由 `java-package-imports-test.js` 守着。

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

> 注：码值的单一来源是 `src/config/exit-codes.js`（`OK=0 / FINDINGS=1 / CLI_ERROR=2`）。**没有「门禁拒绝」码**——快照新鲜度收紧到认内容签名之后，replay 只在树没动时发生，门禁与报告共用同一份快照，无需特例（L2-15 收官，史见 CHANGELOG 2026-07-29）。

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

*Last updated: 2026-08-02（活跃债务 **9 项**：L1=0 / **L2=0**（L2-22 判留销记，L2 层清零）/ 架构债务=0 / L3=9（L3-4/7/8/9/10/11/12/13/14）；P4 冻结 4 条。**2026-08-02 续三**：Kotlin `package` 零抽取修复（tree-sitter + regex 双路径补抽，纯 Kotlin 仓 workspacePackages 空集洞根因闭合，kotlin golden +1 行，CACHE_VERSION 29→30）+ JVM manifest v1（`readJvmDeps(root)` 三源手撸合并——pom dependency/parent 块、gradle 字面坐标、libs.versions.toml [libraries]；闸加 manifest 层裁决空集/前缀碰撞两种降级场景，reactor 模块源码优先；`JVM_IMPORT_ALIASES` 四条桥接 groupId↔import 前缀错配；`jdk.*`/`sun.*`/`com.sun.*` 进 registry isBuiltIn 单一归宿；CACHE_VERSION 30→31；`jvm-manifest-deps-test.js` 10 例，杀变异 C/D/E 逐处验红；test:fast 147/147——史见 CHANGELOG 同日条目）。**2026-08-02**：销 L3-5（`lookupUnique` 死方法连 3 个孤儿测试函数删除；前置条件实测不成立——`lookupBestMatch` 侧零路径规范化覆盖，先补 `testLookupBestMatchNormalizesFromFile` 双断言、杀变异验红，再删。CACHE_VERSION 不动；test:fast 146/146——史见 CHANGELOG 同日条目）。2026-08-01 续二：L2-22 判留（ripgrep 第二仓 129 边 / symbol-table 45 条逐人工核对全合法形状——`crate::` 绝对路径 / workspace 跨 crate / `self::`，与 qartez-mcp 互证，L3-4 塌缩终态作废）；修 `cli-error-handling-test.js` 仓库根配置竞态（646 假红根源，改临时 cwd）；补 646/352 守护测试（`analyzer-same-package-guards-test.js` 4 例，杀变异逐例验红——646 的杀伤信号是 sccCount 不是 cycles 列表，`:855` 后过滤会兜底）；删读侧 7 处字符串判据（5 析取半 + 2 换 `tier==='tier3'`，reason 标签语言中立化）；销 L3-15（Python stdlib 换源 `sys.stdlib_module_names`，前后对照零 delta——卫生债；同刀删 PYTHON/GO_BUILTINS 死名单与死 isBuiltIn，CACHE_VERSION 28→29）；hugo 复测 12094 边（go-module 7796 + same-pkg 4298）坐实 279 式展开非 cobra 特例；reference 编制 12→14（ripgrep / hugo）；test:fast 146/146——史见 CHANGELOG 2026-08-01 各条目。2026-08-01 销 L2-21：变异实验收口（② 受控复跑 266/266 全绿——「5/7 字符串判据冗余 + 2/7 tier 等价」升级为已证；四处单点归因——`analyzer.js:1218`/`query.js:76` 各有守护测试坐实，`analyzer.js:646` cycles Rule 5 与 `:352` GraphAnalyzer 版 reason 标签零覆盖坐实、登记测试缺口），Go 写侧修复（go-module 包导入展开到全包非测试文件 + 同包 `go-same-package` tier3 边，`expand-go-packages` 后处理阶段照 Java 同形，CACHE_VERSION 27→28），cobra 12→279（go-same-package 202 + go-module 77，全可解释），全量 267/267——修复即删，史见 CHANGELOG 2026-08-01 条目。依赖准确性缺口排序三项全部销记（Go 首文件绑定 / Python 23/290 / JVM manifest 未读）。）*
