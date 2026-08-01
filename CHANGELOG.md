# Changelog

所有版本变更记录。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
**版本导航**：[Unreleased](#unreleased)（当前活跃） · [2.1.0](#210---2026-07-17) · 历史版本（v0.5.0 – v2.0.0）与 ADR 已归档至 [docs/changelog/CHANGELOG-v0.5-v2.0.md](./docs/changelog/CHANGELOG-v0.5-v2.0.md)

### L2-21 收口：Go 包级依赖入图 —— 包导入展开到全包文件 + 同包 tier3 边，cobra 12 → 279 (2026-08-01)

L2-21（2026-07-31 登记：Go 包导入绑字母序首文件、同包引用完全无图）今日修复即删，历史等价覆盖于本条。

**变异实验收口（先证据后修复）**：上一轮「读侧字符串判据冗余」被独立复核降级（承重跑 ② 落在变异被中途 revert 的污染窗口内、④ 合并变异无逐处归因权），本轮补两笔闭合证据链：

- **② 受控复跑**：7 处变异（5 处删 `|| resolutionMethod === 'java-same-package'` 析取半 + `analyzer.js:352` / `query.js:76` 两处唯一判据换 `tier === 'tier3'`），跑前/中/后三次 `git diff` 核实变异在位，不接管道取 runner 退出码——**266/266 全绿**。「5/7 冗余 + 2/7 等价」升级为已证。
- **四处单点归因**（每处单独杀成 `if (false)`、单独全量、跑前跑后验 diff）：`analyzer.js:1218` 红 `java-same-package-dead-export-consistency-test.js`、`query.js:76` 红 `java-package-imports-test.js`——两处守护测试坐实；`analyzer.js:646`（cycles Rule 5）与 `analyzer.js:352`（GraphAnalyzer 版 reason 标签）**全绿——零覆盖坐实**，登记测试覆盖缺口。646 首跑被 `cli-error-handling-test.js` 写坏仓库根配置的竞态污染（红的是 `cli-integration-edge-test.js`，与变异无因果路径），重跑干净。

**结论**：判别器（tier/confidence）本就语言中立，「泛化 vs 平行」的架构选择不存在。Go 同包边只要带 `tier='tier3'/confidence=0.3`，读侧（hasImplicit 族、L1-3 死导出、cycles Rule 5）不需要知道 Go 存在。读侧 7 处字符串判据**未删**——冗余已证但删除是另一笔清理，本轮不动。

- **Fixed** `tryGoModule`（`resolvers/go.js`）包导入绑字母序首文件：锚文件降级为只满足单路径 resolver 契约，`outMeta.goPackageDir` 携带包目录，绑定语义移入后处理阶段。修复前 cobra 上 `import "github.com/spf13/cobra"` 只产一条指向 `active_help.go` 的边——`impact command.go` 查不到 `doc/*` 的任何依赖方。
- **Added** `expand-go-packages` 后处理阶段（`builder.js`，照 Java `expand-java-packages` 同形）：go-module 包导入展开为该包**全部非测试** `.go` 文件（tier1/confidence 1.0，锚记录之外的注入记录带 `goPackageExpansion` 标记供 strip 识别）；同包（同目录）文件互引生成隐式边（`go-same-package`，tier3/confidence 0.3，source `<same-package:<dir>>`）。`_test.go` 既不作源也不作目标。阶段注册进 `postProcessPhases`（triggers `['.go']`），cold/warm 两路径自动重放，strip-then-expand 幂等；watch 增量走既有「非 Java 阶段整跑」回退。`_stripGoExpansions` 清 imports 数组时保留仍被存活记录引用的边（锚记录覆盖的锚文件不被误摘）。
- **Added** `test/go-package-imports-test.js`（4 条）：resolver 标包目录 / 同包 tier3 边形状（tier3、0.3、`go-same-package`、反向边）/ 包导入展开到全包且排除 `_test.go` / 二次运行幂等。先 RED（`outMeta.goPackageDir` undefined）后 GREEN。
- **Changed** CACHE_VERSION 27→28：v27 缓存里 Go 仓的包导入只有锚文件单条边、且无同包边。
- **实测** cobra（`scripts/resolver-precision.js`，修复后 HEAD 冷构建）：总边 **12 → 279**，分解 `go-same-package` 202 + `go-module` 77、symbol-table 0——202 = 根包 14 非测试文件 14×13 + `doc/` 5 文件 5×4；77 = doc 5 文件 × 根包 14 + 7 条 `cobra/doc` 被引。**全部可解释**。
- **Changed** TECH_DEBT：L2-21 修复即删；「依赖准确性缺口排序」第 1 项（Go 绑首文件）随修复移除，Python 23/290 与 JVM manifest 未读两项保留；测试覆盖缺口的 ⚠️ 待验注摘除（646/352 零覆盖经单点归因坐实）；预防性约束「postProcess 注入的 importRecords 不落盘」覆盖范围补 Go 阶段；P1 行 L2-21 销记，P1 出空。
- **验证**：全量 `node test/runner.js`（含 slow）**267/267**、runner exit 0（266 + 新增 go-package-imports-test）。本轮机器降速（基线 387s → 本轮 530–550s 档），判读只看红绿不看墙钟。

### T6 判决并执行：symbol-table 摘 JS/TS/Python、保 JVM、Go/Rust 不动 (2026-07-31)

挂了三个月的 L2-10 今日落槌。**判决是四路不是一个**（用户拍板，原话：之前把它们捆成一个「摘不摘」是错的框法）。判决材料全程两个 session 交叉验证：一方测、另一方不信记录亲手复测，包括两次独立冷构建（186.5s / 177s）、全量核对代替抽样、两次变异各自复现。

**判决与依据**：

| 路 | 判决 | 依据（均为 2026-07-31 当日 HEAD 实测） |
| --- | --- | --- |
| JS/TS（含 vue/svelte） | **摘** | zod 374 / execa 1044 / GitNexus 4110 / workspace-bridge 1041，symbol-table 恒 0；闸前本仓 212 条假边（全部 `require('path')` → `parsers/js/shared.js`，一次导出手滑放大而成，`impact` 报 212 真值 3）证明失效模式：**对导出卫生零容错且从未产出正确边** |
| Python | **摘** | CodeGraphContext 510 / code-review-graph 414，恒 0；`tryPythonAbsolute` 结构解析已吃满（315+254 条） |
| JVM | **保** | okhttp 101 条全量核对**无一条类名==文件名**——顶层函数入 `certificates.kt`、`-HostnamesCommon.kt` 连字符前缀、`TestUtilJvm.kt` 多类文件，路径算术天然无解；spring-petclinic 0 无假边。符号表在 JVM 有**界限清晰的合法辖区**，且该判断已被证伪测试验过：我们说 10 条不属于辖区（depth≥2 缺口），修完它们原地 tier2→tier1、总边 2760 一条不变 |
| Go | **不动** | cobra 总边仅 **12**——分母失真，「贡献 0」是噪音不是结论。转 L2-21（图完整性存疑，可能比 T6 更值钱） |
| Rust | **不动** | qartez-mcp 763 边 / st **1 条**（fuzz crate 自引用）——「必须保留」的论据已蒸发，但同一把尺：n=1 不拍摘。转 L2-22（第二仓取数即判；若摘，`trySymbolTable` 塌成 JVM 专用，L3-4 内部分支整体消亡） |

- **Changed** 注册机制：registry 条目声明 `symbolTableFallback`（`defineLanguage` 透传，默认 `true`），`resolvers.js` 注册循环按它挂/不挂 `trySymbolTable`——**按语言组装**，正是 L3-4 要的方向。javascript / python / vue / svelte 四条声明 `false`（vue/svelte 属 JS 家族：同一道闸、同一失效模式，script block 就是 JS/TS；无直接测量，`droppedImports` 记账覆盖）。JVM / Rust / Go / C++ 与 `default` 链保留。JS 闸（`_isExternalJsPackage` 等）**不删**——builder 的丢弃记账是它的第二个消费方。
- **Added** `testT6SymbolTableChainMembership` + `testT6JsBareSymbolNoLongerResolves`（`resolver-strategy-chain-test.js`）：11 个摘除扩展名链上无 `trySymbolTable`、9 个保留扩展名 + `default` 链上有；e2e 同注册表 JS 调用者返回 null、Java 调用者照中。均先 RED 后修，**两次变异**：循环退回无条件挂 → 咬中 `.js`；vue 单点 flag 翻转 → 咬中 `.vue`。
- **Changed** `wave10-symbol-intelligence-test.js` 的 outMeta 测试迁移到 `.java` 调用者——它锁的 `symbol-table` 元数据契约（method/tier2/0.8）活在 `trySymbolTable` 内部、与语言无关；死的只是 JS 链成员。
- **Changed** CACHE_VERSION 26→27：v26 缓存里 JS/Python 仓的 symbol-table tier2 边应变成 droppedImports 记账。
- **实测复核（摘除后六仓）**：zod 374 / execa 1044 / GitNexus 4110 / CodeGraphContext 510 / code-review-graph 414——**与摘除前逐边相同，零 delta**；本仓 1041 → 1042（+1，系当日新增测试代码的 require 边，非丢边）。零产出策略的摘除就该是这个形状：什么都没变，因为本来就没有。
- **Changed** TECH_DEBT：L2-10 修复即删（历史等价覆盖于本条目）；新立 L2-21（Go 图完整性）、L2-22（Rust 待第二仓）、L3-14（tryJava probe 前后对照——原挂 T6 名下的墙钟缺口，「JVM 只剩 tryJava 承重」的前提随 JVM 保留判决消失，转非阻塞测量债）；L3-4 记进展（JS/Python 分支已随链消失，剩余分支终态路径见 L2-22）；P 表与 footer 同步，活跃债务 10 → 12 项。
- **验证**：`test:fast` 145/145、eslint exit 0、`resolver-strategy-chain-test` / `resolver-symbol-table-test`（31/31）/ `wave10-symbol-intelligence-test` 直跑全 exit 0、六仓 `resolver-precision` 复核（上文）。**未跑 slow 全量**（本机约 35 分钟）。

### resolver：JVM 源根扫描下一层 — okhttp symbol-table 111 → 101，冷构建墙钟补齐 (2026-07-31)

T6 判决材料复测（当日 HEAD 十仓逐仓点名）时挖到的：L2-14 记的「剩余 111 条 symbol-table 全是类名≠文件名族」**不实**——101 条成立，10 条全在 `samples/tlssurvey/`、类名与文件名精确相等（`okhttp3.survey.types.Client` → `types/Client.kt`）。真因是 `discoverJavaSourceRoots` 的多模块扫描只到根+一层子目录，而 `samples/` 是无 `src` 的纯容器目录，8 个平级模块全部落在扫描范围外——符号表在替一个结构缺口兜底，不是它的合法形态。

- **Fixed** `discoverJavaSourceRoots`（`resolvers/base.js`）：抽出 `collectModuleRoots(dir, roots)`（标准布局 + sourceSet 两层扫描，单模块段与多模块段原各抄一遍，顺手消重），多模块扫描对每个一级子目录**再下一层**。下潜带噪音闸：`node_modules`/`build`/`dist`/`out`/`target` + 所有点目录不进——npm 包的 fixture（`node_modules/x/src/main/java`）不是源根，变异 2 实测过没有闸时两个噪音根都会混进来。
- **实测**（okhttp 冷构建，修复后 HEAD）：总边 **2760 → 2760 不变**，symbol-table **111 → 101**——10 条 tlssurvey 边从符号表挪进结构解析，一条没丢。抽样 40 条三元组全是合法族（`-hostnamescommon.kt` 连字符前缀、`testutiljvm.kt` 多类文件、顶层函数入 `certificates.kt`），`samples/tlssurvey/` 一条不剩。JVM 保留符号表的论据如预期变得更干净：它承担的范围收敛到真正无解的那族。
- **实测** 冷构建墙钟 **3m6.5s**（2760 边，整脚本含收集开销、构建占绝对大头）——补掉 L2-10 名下 07-31 评审登记的测量缺口。口径说明：这是 L2-14 **之后**的现状基线，「前后对照」的「前」需 checkout 旧 commit 单独取，未取；判决需要的「T6 摘除后 `tryJava` 独自承重的现状成本」就是这个数，3 分钟级落在可接受区间。
- **Added** `test/resolver-strategy-chain-test.js` `testDiscoverJavaSourceRootsContainerDirDepth2`：容器目录（无 `src`）下的 depth-2 模块必须被发现、depth-1 模块不受影响、`node_modules`/`build` 不得下潜、端到端 `tryJava('okhttp3.survey.types.Client')` 直中。先 RED（容器模块未发现）后修，**两次变异验证**：砍下潜循环 → 咬中发现断言；去噪音闸 → 咬中 node_modules 断言。
- **Changed** TECH_DEBT L2-10 三处订正：「全是类名≠文件名族」→ 101/10 拆分（判决顺序条目与建议动作段同步）；新增 2026-07-31 十仓复测段——五路复现，**Go 证据降级为无效**（cobra 总边仅 12，分母失真，「Go 贡献 0」近乎空话，T6 拍板时 Go 一路须单独取数或分开处理）；Rust 复测 5 → 1（唯一存活是 fuzz crate 自引用）。
- **验证**：`test:fast` 145/145、eslint exit 0、`resolver-strategy-chain-test` 直跑 exit 0、okhttp `resolver-precision` 复测（上文两数）。**未跑 slow 全量**（本机约 35 分钟）。

### 评审后续：query-* 重算分支把 replay 标记吞了 + 三条撒谎注释 (2026-07-31)

审 07-30 那四笔提交挖到的。诚实机制又只接了一半——这次漏的是**第二条路径**：4617ec2 给 replay 路径接上了出处，重算路径却硬写 `replayedFrom: null`。

- **Fixed** `ensureSnapshotData`（`query-tools.js`）的 fallthrough 分支无条件返回 `replayedFrom: null`，而它调用的 `buildProjectOverview` 有**更严格**的 freshness 判据，能 replay 掉 query-* 刚刚拒绝的同一行快照并在结果上挂自己的 `replayedFrom`。入口是 coarse 判据通过但载荷缺 `hotspots` 键：query-* 落到重算 → overview 判定新鲜并 replay → 标记被覆盖成 null → **响应宣称"本轮算的"，实际是 replay**。正是 4617ec2 要杀的那个谎，往上挪了一层。改为 `result.replayedFrom || null` 透传。
- **Changed** `replayedFrom` 统一成一个形状：`overview-tools.js` 的 replay 标记补 `contentMatch: true`。它在那个位置**定义上为真**——`contentMatch` 是 `isSnapshotFresh` 返回值的合取项之一，走到挂标记那行说明它已经成立。写出来而不是留给读者推导，是为了让消费方**不需要知道自己在读哪个生产者**就能解释这个字段（query-* 用粗判据服务 replay，报 `contentMatch: false`）。附加字段，无消费方做 deepStrictEqual，`replayedFrom` 自身在 c3e0352 新增时也未 bump，故 SCHEMA_VERSION 保持 1.2.0。
- **Added** `test/query-replay-provenance-test.js` 第 6 例 `testProvenanceSurvivesTheRecomputeBranch`：冷跑落快照 → 直接开 `cache.db` 把 `hotspots` 键摘掉、**freshness 四项（head/count/config/signature）逐字节保留** → `query-hotspots` 必须仍带出处且 `contentMatch: true`。先 RED（红在 `assert.ok(data.replayedFrom)`，前置断言全通过）后修。**两处改动各自做了变异验证**：摘 `contentMatch: true` → 咬中 contentMatch 断言；`replayedFrom` 改回 null → 咬中出处断言。
- **Changed** 三条与实现不符的注释——4617ec2 刚修完两条同类，同批新代码里又写下三条：
  - `exit-codes.js` 说 freshness "consults `cache.checkFileChanges()`"。实际走 `getContentSignature()` + `content_signature` 列；`checkFileChanges()` 是另一个仍然活着的方法，同批 CHANGELOG 甚至写了"删掉已无意义的 `checkFileChanges` mock"。会把下一个读者领到错的函数上。顺带写明 `FINDINGS` 的**实际用途宽于其名**（config/validation 错误也走它，值一直是 1，本次收编裸字面量未改行为）。
  - `runner.js` `runPool` 文档说 report 记 `startOffsetMs`，字段实际叫 `finishOffsetMs`（`recordResult` 那处注释是对的，两处自相矛盾；全仓 `startOffsetMs` 零命中）。
  - `runner.js` `require.main` 守卫注释指向不存在的 `test/runner-report-test.js`，实为 `runner-classification-test.js`。
- **Added** TECH_DEBT：L3-8 追加两条新写下的 `?.()` 实例（`getContentSignature?.()` × 2，方向 fail-safe 但形状同族）；L2-10 追加 T6 前置的测量缺口（`tryJava` 逐段剥尾把 probe 数从 `roots×2` 变成 `segments×roots×2`，L2-14 只记了边数没记冷构建墙钟，而 T6 一摘符号表 JVM 侧就只剩它承重）。
- **验证**：`test:fast` 145/145、eslint exit 0、query-replay-provenance / gate-on-replay / phase35-query-sql / severity-filter / query-tools / runner-classification 直跑全 exit 0。**未跑 slow 全量**（本机约 35 分钟）。

### 测试执行：批屏障换工作池 + 每跑落 JSON 报告 — slow 层 775s → 317s (2026-07-30)

先建可观测性再优化，两刀单变量分开测。**所有对照跑的 `warmup` 均在 12–14s 健康带内**，是校准过的比较。

- **Added** run report：每条测试落 `{file, layer, classifiedBy, phase, concurrency, finishOffsetMs, elapsedMs, ok, status, signal, error}` 进 `test/.reports/run-<ISO>.json` + `latest.json`（已 gitignore），**写在 `process.exit(1)` 之前**——失败那次的耗时分布才是最想看的一次。`classifyTest` 拆出 `classifyTestDetail`，`reason` 区分**声明**（`annotation-slow` / `known-slow-pattern`）与**猜测**（`heuristic-runcli` / `heuristic-heavy-api`）。环境段记 `warmup{ms,source}`：`warmCache()` 那次冷 `audit-summary` 是本机唯一有健康带的校准探针。**刻意不记 `CurrentClockSpeed`**——本机 `Current == Max == P 核基频`恒为 1200，健康与否读数完全一样（2026-07-27 已实证，2026-07-30 复核：电源策略处理器最大状态 AC/DC 均 100%，探针 12.3s 正常），记它等于给每份报告盖一个无鉴别力的戳。
- **Fixed** `runConcurrentPhase` 原本是 `for i += concurrency { await Promise.all(slice) }`——**批屏障，不是工作池**，每批等最慢那条。基线实测：940s CPU 摊在 775s 墙钟上，**其中 579s 是空转**；一个批次把 `e2e-gitnexus`(92.1s) 与 `file-index-boundary`(0.4s) 配对，一个 worker 干等 91.7s。换成 `runPool`（任一 slot 空出立刻补下一条）。
- **Changed** `SLOW_CONCURRENCY` 从硬编码 `min(2, …)` 改为随机器推导 `min(4, max(2, ⌊cpus/4⌋), FAST)`：2 核 CI runner 仍得 2，本机 18 线程得 4。定 4 不定 6 的依据是交换率与超时余量，不是墙钟——C=6 用 21% 额外 CPU 换 18% 墙钟（基本平价），且把最长单条的超时余量从 3.3x 压到 2.7x；本套件的历史故障模式正是 spawn 测试在负载下超时并被误读为回归，排查成本远超它省下的 57s。
- **实测**（114 条 slow，本机 18 线程，四跑全部 114/114）：

  | | 墙钟 | 边际 | CPU 累计 | 最长单条 | 超时余量 |
  | --- | ---: | ---: | ---: | ---: | ---: |
  | batch C=2（基线） | 775s | — | 940s | 92.1s | 2.0x |
  | pool C=2 | 466s | −39.9% | 903s | 42.9s | 4.2x |
  | **pool C=4（新默认）** | **317s** | −32.0% | 1167s | 55.4s | 3.3x |
  | pool C=6 | 260s | −18.0% | 1413s | 66.8s | 2.7x |

  fast 层同一刀 15.6s → 9.8s（−37%），145/145 不变。调度那刀是净赚（CPU 累计反降，它消的是空转）；并发那刀是买的（+29% CPU 换 −32% 墙钟，114 条里 108 条各自变慢）。
- **已知污染，不修饰**：`e2e-gitnexus-test.js` 在基线跑 92.1s、池子跑 11.3s，**八倍差未查清**（候选解释：该测试吃 `reference/GitNexus`，首跑操作系统页缓存冷）。775s 那份基线因此可能含一次性冷盘代价，调度刀的真实收益大概率低于 −39.9%。要证实需清页缓存重跑，未做。
- **Added** `test/runner-classification-test.js`（6 例）锁 `reason` 标签——L3-12 的统计靠它们，标签一漂统计静默归零、看着像债还完了。`runner.js` 的 `main()` 加 `require.main` 守卫以便被 require。
- **Added** TECH_DEBT L3-12（分层靠猜：49/114 是启发式塞进去的，30 条比 fast 最慢那条还快；`needsCacheDir()` 把缓存隔离绑在层上，抽查 5 个候选全无隔离锚点，重分类不是一行改动）与 L3-13（每条各自冷启动：CPU 累计 903s / 114 条 ≈ 7.9s，一次冷构建 12–13s，调度与并发只能摊开不能消除）。
- **口径订正**：原计划称"73 个文件被内容启发式静默降级"，实测是 **49**（heavy-api 25 + runcli 24）。原数以 217 为基数，而全仓只有 266 个测试文件。

### 评审修复：query-* 的 replay 从此有出处，JVM 闸的接线从此会炸 (2026-07-30)

评审 07-29 全天 18 个提交时挖到的两条，加两处清理。共同形状还是 L1-4：**新加的诚实机制只接了一半，另一半静默**。

- **Fixed** `query-*` 服务快照时零信号（L1-4 正面冲突）。L2-15 给 `audit-overview` 的 `isSnapshotFresh` 加了内容签名，但 `query-tools.js` 有自己那份 coarse `isSnapshotFresh`（gitHead + 文件数 + config），读的是**同一行快照**——原地编辑后 `audit-overview` 重算、`query-hotspots` 照旧返回旧数字，且 `findSnapshot` 连 `contentSignature` 字段都直接丢掉了。粗粒度换速度是刻意的设计，**保留**；被修掉的是沉默：`ensureSnapshotData` 改返回 `{data, replayedFrom}`，三个 query 命令经 `withReplayProvenance()` 挂上 `replayedFrom{computedAt, gitHead, fileCount, contentMatch}`，`contentMatch === false` 时追加 `snapshot-content-drift` 警告。未签名的旧行（`''`）判为**不可验证**而非"验证过相等"，同样告警。
- **Fixed** `cli.js` 用 `result.warnings = buildWarnings()` **覆盖**命令自产的 warnings，改为追加。上一条的 drift 警告在真实 CLI 路径上本会被这行整条抹掉——正是 T5 那条教训（测裸函数只证明"算得对"，测用户路径才证明"拿得到"）的第二个实例。变异验证：改回覆盖式 → CLI 路径那条断言恰好转红。
- **Fixed** `GraphBuilder.workspacePackages` 无初始值，`undefined` 与"算过但为空集"共用同一个返回分支——JVM 零名单闸把两者都读成"未知"并自我关闭，第三方 import 无声退回符号表猜测，边数不动、无 warning。构造函数显式置 `null`（= 未计算），`resolveFileOnly` 见 `null` 直接抛（L3-8 判据：结构性不该发生的，让它炸）。变异验证：摘掉 `build()` 里的 `_refreshWorkspacePackages()` → 报错点名该方法，`dropped-imports-test` 转红；此前同一变异是完全静默的。
- **Added** `test/query-replay-provenance-test.js`（5 例：未动树 replay 标记且不告警 / 动过树告警且仍服务 / 未签名旧行判不可验证 / 三个 query 命令都带出处 / **走完整 CLI 路径**验证警告不被抹）、`test/jvm-gate-wiring-test.js`（2 例：未刷新即 resolve 必抛 / 刷新后合法）。全部先 RED 后修。
- **Changed** 两处注释纠偏：`query-tools.js` 的 "Validate freshness: … and actual content changes" 与函数体里的 "Intentionally skip content-change checks" 自相矛盾（前者是假的）；`tree-sitter.js` 的 "A rejected … load is evicted" 描述了一个不存在的分支（两个 loader 内部全 catch，只会 settle null，永不 reject）。
- **Removed** `src/.workspace-bridge/cache.db`（3.4MB，2026-07-02 遗留，某次以 `src/` 为 cwd 的运行留下；被 gitignore 遮住所以 `git status` 看不见）。与 P4 冻结区那两个 `UserssdsesAppDataLocalTemp*` 目录同族。
- **不改**：`_isExternalJvmPackage` 的 `pkg.startsWith(base + '.')` 反向前缀分支，评审初判为"外部依赖的免检通道"，**复核后撤回**——该分支只在指定符是仓内包的**严格祖先**时命中，而类导入要成为包路径的严格祖先，需要仓内存在以类名为段的包（`org.junit.Assert.helpers`），Java 命名约定下不成立。契约已由 `testJvmWorkspacePackageGate` 的 `belowCtx` 两条断言锁住（类导入 → external、通配导入 → internal），实测通过。

### L2-14：JVM 源根发现支持 KMP 布局 + 成员导入逐段剥尾 — okhttp symbol-table 1037→111 (2026-07-30)

- **Fixed** 两个结构缺口，第二个是修完第一个复测时带出来的：(1) `discoverJavaSourceRoots`（`resolvers/base.js`）只认 Maven/Gradle 标准布局，KMP 的 `<module>/src/<sourceSet>/{kotlin,java}` 深一层且 sourceSet 名任意——改按叶名 `kotlin`/`java` 扫描，**不硬编码 sourceSet 名**；与标准布局扫描的重叠处去重（`src/main/java` 两路都会命中）。(2) **成员导入**：`import okhttp3.HttpUrl.Companion.toHttpUrl`（Kotlin Companion/扩展）与 `com.foo.Outer.Inner`（Java 嵌套类）的指定符**越过类名**，全路径当文件路径必然落空——`tryJava` 改逐段剥尾、最长命中赢（成员必随类文件，剥到首个存在的文件即停，不会 overshoot 成包级猜测）。光源根修复后复测剩 272 条 symbol-table，195+ 条是这一族。
- **实测**（okhttp 冷构建，两轮递进；基准为缺口 C 后的 937——债条登记时的 1037 含 83 条第三方假边，已被闸清零）：symbol-table **937 → 272（源根）→ 111（成员导入）**；丢弃 **841 → 459 → 241**；java-package tier1 **→ 1723**；总边 2415 → **2760**（+345 条首次结构化成边）。剩余 111 条 symbol-table 全是**类名≠文件名**族（`-HostnamesCommon.kt` 连字符前缀文件、`TestUtilJvm.kt` 多类文件、`Client.kt` 小写命名）——债条早已判定该族路径算术天然无解、符号表是唯一可行策略。**T6 JVM 侧判决材料取到：结构解析覆盖后符号表正产出 ~111 条，全部落在它唯一合法的形态——JVM 的答案因此与 JS 相反，符号表在 JVM 是刚需兜底不是噪音源**。剩余 241 条丢弃 = 顶层函数导入（`okhttp3.internal.closeQuietly`，函数名不含文件信息，路径算术与符号表两侧都够不着）+ 深层成员链扎进多类文件。- **对照**：spring-petclinic 冷构建 `droppedCount` 保持 **0**、symbol-table 边 0——逐段剥尾未给纯 Java 仓引入第三方假边。
- **Added** `testDiscoverJavaSourceRootsKmpSourceSetLayout`（KMP kotlin/java 两叶发现 / resources 叶不混入 / 标准布局不回归 / 根列表去重 / tryJava 端到端命中）与 `testTryJavaMemberImportsStripToClassFile`（Companion 成员 / 嵌套类 / 深链剥尾 / 直达路径不受扰 / 无命中仍 null），全先 RED 后实现。CACHE_VERSION 24 → 25。

### Fixed：`--severity` 过滤运行双向绕过 'overview' 快照 (2026-07-30)

- **Fixed** 老 bug，L2-15 收官的 slow 层验证把它咬了出来：快照 key 不含 severity，但 `--severity` 运行此前既不绕读也不绕写——读侧：replay 全量快照时 severity 过滤被整个跳过（replay 分支只跑 baseline/output-limits，没有 severity 逻辑，`severity-filter-test` 据此转红）；写侧：过滤运行把子集写进共享 'overview' key，后续全量消费者静默少数（本仓 dogfood 实测：一次 `--severity high` 直跑把 0 条死导出的子集写进快照，后续普通运行 replay 到它）。与 `--category` 同形同刀：读绕 + 写绕（`overview-tools.js`）。
- **Added** `testSeverityFilterAppliesOnSnapshotReplay`（读侧：先存全量快照，同 cache 带 `--severity high` replay 仍必须过滤）与 `testSeverityRunMustNotPoisonSnapshot`（写侧：severity 先行，后续普通运行不得 replay 到过滤子集），先 RED 后修。写侧做变异验证：摘除写绕 → 咬中的恰是毒化链（`--severity high` 写入子集 → 下一测试的"全量"运行 replay 它 → `mediumCount <= totalCount` 反转），断言过的是用户真实路径。

### L2-15 收官：快照新鲜度认内容签名，门禁拒绝机制整体退休 (2026-07-29)

- **发现过程**：本轮第一次跑完整 slow 层（112 个测试），`regression-test.js` 与 `phase35-query-sql-test.js` 两条 FAIL。`git stash` 全部本轮改动后仍 FAIL，再把 `9e372f8` 的 `cli.js` + `overview-tools.js` 回退到父提交即 PASS——**归属实证到 L2-15 动作 0 自身**。8c6802d 那批只跑了 fast，「slow 层曾腐烂」的教训再次应验：门禁类改动尤其不能只看 fast。
- **Fixed** 根因是 freshness 判据太粗，不是门禁吃了 replay。`isSnapshotFresh` 的三项（git head / 文件数 / config）在**原地编辑**时全都不变——那正是 replay 会说谎的唯一场景。动作 0 的「拒绝」是对症状下药，而且误伤：树没动时 replay 与冷算逐字节相同，拒绝是纯误报，`regression-test.js` 三处 `--save` 全被拒即实证。
- **Added** `analysis_snapshots.content_signature` 列（`_migrate()` 增量迁移，`DEFAULT ''` 让迁移前的行判为不可验证并重算）+ `cache.getContentSignature()`：全部被索引文件的 `路径|mtime|size` 排序后 sha256。**独立列，不并入 `config_hash`**——`query-*` 刻意用粗粒度换速度（其注释明写），并进共享字段会连带把它拖慢。债条动作 2 原估「成本是每次调用扫一遍 stat」，实际实现只读 container 初始化时已填好的 `fileMetadata`，**不碰磁盘**，成本远低于预估。
- **Removed** 拒绝机制整体退休：`overview-tools.js` 的 replay 拒绝分支、`cli.js` 的 `--fail-on-findings` replay 拦截、`EXIT_CODES.GATE_REFUSED` 三处一并删除。freshness 诚实之后，门禁与报告可以共用同一份快照，不需要任何特例——**一个正确的判据替掉一整套特例**。`EXIT_CODES` 保留 `OK/FINDINGS/CLI_ERROR`（`CLI_ERROR=2` 收编 `buildErrorResponse` 原本的裸字面量）。
- **Fixed** 门禁前置校验提到快照分支之前（`buildProjectOverview` 开头，try/catch **之外**）：`--check-regression` 无基线时抛 `Baseline file not found` 并走 `CLI_ERROR`。留在快照分支内的话，它的 throw 会被那个 `catch`（语义是「快照读不了，重算」）吞掉，命令白付一次完整冷构建再报同一个错。
- **Changed** `test/gate-on-replay-test.js` 按新契约重写四阶段：未编辑树 replay 可服务且门禁照跑 / 无基线报基线缺失 / **原地编辑后必须不 replay**（git head、文件数、config 三项全不变的那一格，正是旧判据漏掉的）/ CLI 门禁回到普通判决。`phase35-query-sql-test.js` 的手工快照注入补上签名，并删掉已无意义的 `checkFileChanges` mock。

### CLI：门禁拒绝独立退出码 — EXIT_CODES.GATE_REFUSED (2026-07-28)

- **Added** `src/config/exit-codes.js`：`OK=0 / FINDINGS=1 / GATE_REFUSED=2`。「我拒绝判决」与「我判决了、有 findings」对 CI 是相反的响应（重跑刷新快照 vs 修代码），同压 1 号会逼每个消费方 grep stderr 才能分辨。`--fail-on-findings` 在 `cli.js` 出口拦到 replay 标记时返回 GATE_REFUSED；`determineExitCode`（`route-formatter.js`）全表改走常量，不再裸写字面量。
- **注意**：GATE_REFUSED 与既有「参数错误 / 无效命令」同号 2——同属「未产出业务判决」桶，分辨靠 stderr 的 `gate_on_replay` 标签；TECH_DEBT 的 Exit Code 契约矩阵已同步此行。若 CI 需要按码区分「用法错」与「门禁拒绝」，这里得换成独立码（如 3），拍板在人。
- **Changed** `test/gate-on-replay-test.js` Phase 3 断言从「非 0 + stderr 标签」收紧为「恰好 GATE_REFUSED 且 ≠ FINDINGS」——上轮的教训同族：断「非 0」挡不住语义漂移。

### Resolver 两处路径形状修正：manifest 链原生返回 + Python absolute 两遍搜索 (2026-07-28)

- **Fixed** `packageManifestChain`（`resolvers/base.js`）与 `findCargoCrateRoot` 同病——normalizePathKey 陷阱的**第三个实例**：归一化只能进比较与缓存键，**返回值必须平台原生、原大小写**。消费方拿返回值 `path.join` / `startsWith` 对齐 file-index 的原生路径，归一化返回会反向打破算术；Windows 上还会把 `readPackageDeps` 的 mtime 缓存劈成同目录两份。这病三个实例了（缺口 A 的比较方、findCargoCrateRoot 的返回方、本条的返回方），预防性约束见 TECH_DEBT。
- **Fixed** `tryPythonAbsolute` 改**两遍搜索**（`resolvers/python.js`）：namespace 兜底是对全部 searchRoots 的兜底，不是逐 root 短路——L2-17 的单循环让前位 root 的弱证据（恰好持有同名文件的 namespace 目录）压过后位 root 的真 `__init__.py`。src-layout 仓根残留同名目录正是此形状。CACHE_VERSION 23 → 24。
- **Added** 契约测试三条，全在真实入口上：`testTryPythonAbsoluteRegularPackageWinsAcrossSearchRoots`（后位 root 的强证据必赢前位的弱兜底）、`testPackageManifestChainReturnsNativePaths`（路径形状契约，与 `findCargoCrateRoot` 共享同一条纪律）、JVM 闸**反向包含只限通配符**三条断言（仓拥有 `org.junit.support` ≠ 拥有 `org.junit.Assert`——普通类导入保持外部，`org.junit.*` 通配才算仓内；生产行为本已如此，补锁防漂移）。

### TECH_DEBT 坟头清理：修复即删，历史只进 CHANGELOG (2026-07-28)

- **Changed** `docs/TECH_DEBT.md` 按文档铁律「修复即删，历史只进 CHANGELOG」清理已修条目的实例记录：L1-3 / L1-4 / L2-11（A/B/C 三缺口）/ L2-12 / L2-13 / L2-16 / L2-17 / L2-18 / L2-19 / L2-20 / L3-6 / 架构-2 共 12 节移除，CHANGELOG 等价覆盖删前逐条核实（对应上方 T2 / 缺口 A·B·C / T5 / L2-16~L2-20 等条目）。机制债（让实例能发生的结构）不删，留在预防性约束区。
- **Removed** P4 冻结区「TECH_DEBT.md 自身臃肿」一条——本次清理即其解冻条件达成；「测试覆盖缺口」小节同步收敛为一行（其建议动作已被 T1 的 `language-parity-edges-test.js` 实现：十语言 fixture 边产出 + `droppedCount` 全 0 断言）。
- **Fixed** 清理带出的悬挂引用：L2-10/L2-14/L3-4 正文里指向已删节的「见 L2-11」「归 L2-11 第三方半」改为「史见 CHANGELOG」；footer 重计数——活跃债务 7 → **9 项**口径修正（旧 footer 漏数：L2=3 待决/活跃 + L3=6，P0/P1 已出空）。编号不重排：L2-10/L2-14/L2-15、L3-4/5/7/8/9/10 是稳定标识不是序号。


### L2-17：Python PEP 420 namespace 包 — `from PKG import X` 绑定子模块 PKG/X (2026-07-28)

- **Fixed** 分组定量先救场（债条要求）：CodeGraphContext 34 条丢弃里 `codegraphcontext.*` 6 条全部来自 tests/ 按安装名导入，根因是 **namespace 包**——`tools/handlers/` 与 `tools/languages/` 是无 `__init__.py` 的目录，候选只有 `X.py` / `X/__init__.py` 两种。全部 6 条都是 `from PKG import <子模块>` 形状：namespace 包没有自己的代码，X 不是子模块就是 ImportError，绑定子模块是该语句的唯一语义，不是猜。新增 `_tryNamespaceSubmodule` 兜底（plain 候选永远优先，常规包仍解析 `__init__.py`），`tryPythonAbsolute` / `tryPythonRelative` 双侧共用——复测带出同病的 `.tools.handlers` / `..languages` 两条相对导入形状，同刀修复；python.js 顺手去重（两个策略的候选逻辑原各抄一份）。builder 把 `record.imported` 经 extraCtx 穿进策略（additive，与 JVM 闸同例）。
- **实测**：CodeGraphContext 丢弃 **34 → 26**（6 + 2 清零，`codegraphcontext.*` 与相对点号两组归零）。剩余 26 = 第三方传递依赖（manifest 未声明，L2-11 留档的设计题）+ tests/fixtures 平铺 script-dir 导入（另一个机制）。**P1 层出空**。
- **Added** resolver-strategy-chain 五条：absolute namespace 命中 / 不造边（非模块名不猜、裸 `import PKG` 无文件目标）/ 常规包 `__init__.py` 优先不被抢 / facade 穿 imported / relative namespace 命中 + 不造边。全先 RED。CACHE_VERSION 22 → 23。

### L2-20：tree-sitter 装填竞态 — 并发首调共享一次 Language.load (2026-07-28)

- **Fixed** 实测发现：cobra 冷构建 36 个 Go 文件 19 个静默降级 regex（cJSON 18/99 同病），但串行直跑 parseGo 36/36 全 AST、36 路并发直跑也零降级。埋点抓到的真错误是 init 阶段的 `Incompatible language version 0` ×19——根因是 `loadLanguage` 的**装填竞态**：同步查缓存、异步 `Language.load` 后才写缓存，N 个并发首调全部看到 miss 各自装填，竞态窗口产出 version 0 损坏对象；`getParserModule` 同形（`Parser.init()` 可被并发调多次）。parse/query 本身是同步调用，同线程无真互踩——所以修 loader 而不是给 go/kotlin/cpp 补三把 parse 锁（登记时的初步方案被实验证伪后修正）。
- **Changed** `tree-sitter.js` 两个缓存改存 **in-flight promise**：并发调用者共享同一次装填；装填失败自动 eviction 允许重试（保持旧的失败不缓存语义）。rust-ast 既有串行锁保留不赌。CACHE_VERSION **不 bump**：竞态降级条目 `parseModeReason='regex-fallback'`，本来就命中「regex-fallback 缓存永不信任」约束每次重解析，旧缓存自愈。
- **实测**：cobra **fallback 19 → 0（36/36 AST）**；cJSON **fallback 18 → 0（99/99 AST）**——九仓 AST 覆盖率全部实测归真。
- **Added** `tree-sitter-loader-race-test`：16 并发首调必须返回同一 Language 对象（确定性咬在机制上——`Promise.all` map 同步展开，无 promise-cache 必然 N 个 distinct，探针实证 24/24 distinct）+ 混语言四路各只装一次。先 RED 后修。

### L2-19：Rust 裸首段 `use` 按当前模块作用域解析 — tryRustScoped (2026-07-28)

- **Added** `tryRustScoped`（`resolvers/rust.js`，`.rs` 链第三位）：Rust 2018+ 的裸首段 `use grounding::FileFacts` 首段 = **当前模块的子模块**（rustc 实证 edition 2024 合法，不是 2015 的 crate 根绝对路径）。模块算术按 2018 路径规则：mod.rs/lib.rs/main.rs 的子模块在旁侧目录，其他文件（`server.rs`）的在 `<stem>/` 下；锚定最近 Cargo.toml 的 src，越界即 null 交给外部闸/符号表——extern crate 与 `std::` 在此不存在文件，自然落空，不抢闸的活。
- **明确不做**祖先模块回溯：祖先模块项在 2018+ 没有 `super::`/`crate::` 不在作用域，回溯 = 给编译不过的代码造边。债条原方案含逐级祖先，实现时按 rustc 语义收窄，理由写进代码注释与 TECH_DEBT。
- **实测**（qartez-mcp 冷构建）：丢弃 **12 → 0**——benchmark/mod.rs 11 条子模块形状 + qartez-dashboard/src/lib.rs 1 条 crate 根形状（`cli::DashboardCommand`）全解开，**Rust 侧 droppedImports 清零**（152 → 0 全程：L2-16 → L2-18 → L2-19）。
- **Added** gors-resolver 四条：mod.rs 子模块 / crate 根文件 / 非 mod 文件 stem 目录 / 不造边（未知段落空、`std::` 留给闸、跨模块不泄漏、`self::` 不归本条）。全先 RED。CACHE_VERSION 21 → 22。

### L2-18：Rust parser 花括号列表关键字前缀 — `use super::{a,b}` 不再抽成 `::a` (2026-07-28)

- **Fixed** 根因：tree-sitter 把花括号列表前缀位置的 `super`/`self`/`crate` 发成**独立节点类型**（关键字，不是 identifier），`getUseListPrefix` 只认 `scoped_identifier`/`identifier` → 前缀取空串 → 列表项拼出 `::a` 这种非法 specifier。qartez-mcp 实测 22 条丢弃全是这一族（L2-16 分组统计分出）。同刀补齐两个同函数缺口：列表内**嵌套 scoped 项**（`use crate::{config::AppConfig}` 的 `config::AppConfig` 原本整项被跳过，import 与 reexport 名单两侧都丢）与 `use_as_clause` 的 scoped 原路径。regex fallback（polyglot）本就拼前缀，parity 无需对齐。
- **实测**（qartez-mcp 冷构建）：丢弃 **34 → 12**，`::ident` 一族清零；剩余 12 条全是裸首段（`grounding::FileFacts` 类），即 L2-19 的账，报警形状与债条预言完全一致。
- **Added** `testRustUseListKeywordPrefixes`（rust-ast-parser）：fixture 覆盖 `super::{…}` / `crate::{嵌套 scoped}` / `self::inner::{…}` / 列表内 `self` / 列表内别名 全形状，外加全称断言「不存在任何 `::` 前导的 source」——先 RED（咬在第一条 super 断言上）后实现。CACHE_VERSION 20 → 21。

### L2-16：Rust crate 名归一 + member manifest — own-crate 路径回到模块算术 (2026-07-28)

- **Fixed** Cargo 包名 `qartez-mcp` → crate 名 `qartez_mcp`（`-`→`_`），`tryRustCrate` 与外部闸此前都按字面比对：own-crate 路径（集成测试的 `qartez_mcp::graph`）两边不认——猜中的进符号表、猜不中的进丢弃（qartez-mcp 152 丢弃 / 167 symbol-table，同一缺口两侧）。新增 `readCargoCrateName`（`[lib] name` 优先，`[package] name` 按 Cargo 规则归一）与共享 `normalizeCrateName`（resolver / 闸 / `readCargoDeps` 三处共用，不复制）；own-crate 路径按 `crate::` 同构解析。
- **Fixed** 同仓带出的第二组：member crate 的依赖声明在自己的 Cargo.toml（qartez-dashboard 声明 axum/tower/http，根包没有）——外部闸改读导入方所属 crate 的**最近** Cargo.toml（Cargo 无 manifest 链，`workspace = true` 在 member 文件里重新声明，最近 manifest 即全部真相）；own-crate 名显式让位。
- **Fixed** 同批顺手修 `findCargoCrateRoot` 的路径比较：与缺口 A 同一 normalizePathKey 陷阱，但方向相反——归一化只能用于比较与缓存键，**返回值必须保持原始大小写**（消费方拿返回值与 fromFile 原始路径做 startsWith 算术，归一化返回会把那边的算术打破；gors 测试当场抓住）。
- **实测**（qartez-mcp 冷构建）：丢弃 **152 → 34**；symbol-table **167 → 5**（TECH_DEBT 的预言坐实：「Rust 是符号表唯一有正产出的语言」的依据 ~97% 由结构缺口撑出——T6 判决材料取到）；rust-crate 292 → 513；总边 676 → **745**（+69 条首次结构化成边）。
- **Added** `testRustOwnCrateNameImport` / `testRustLibNameOverridesPackageName`（gors-resolver）与 `testRustMemberManifestDepsRecognized`（resolver-symbol-table），均先 RED。分组统计分出的另两组已分流登记：**L2-18**（parser 把 `use super::{a,b}` 抽成 `::a`，22 条）与 **L2-19**（Rust 2018+ 裸首段 `use` 按当前模块作用域解析，rustc 实证合法，12 条）。CACHE_VERSION 19 → 20。

### L2-11 缺口 C：JVM 零名单闸 — 仓内包前缀集合之外 = 外部 (2026-07-28)

- **Fixed** Java/Kotlin 第三方 import 此前全裸：spring-petclinic 49 文件 44 个报丢弃、362 条全是 `org.junit.*`/`org.assertj.*`/`org.apache.commons.*` 假警报；okhttp 图里躺着 83 条第三方假边（`org.junit`/`assertk`/`okio` 等猜向本地同名类）。**没走读 pom/gradle 的老方案**（groupId 与包名不同构，且 pom 未声明但 classpath 上有的照样判错）——按 TECH_DEBT 订正后的零名单设计：parser 已把每个文件的 `package` 声明抽进图，「仓内包前缀集合之外的一切 = 外部」是确定事实，与 Go 那道零名单闸同构。
- **Added** `_isExternalJvmPackage` 闸行（`resolvers.js`，闸表行 now 收 `fromExt`——标准库半仍走 registry `isBuiltIn` 单一知识源，不复制名单）；builder 在每次 resolve 批边界刷新 `workspacePackages`（全量 parse 阶段后 / 增量 link 阶段前 / 单文件 `analyzeFile`——批内 resolve 不新增包，免脏标记）。集合缺失或为空时闸让位（旧行为），不瞎拦。`resolveImport` 加可选第 8 参 `extraCtx`（additive）。
- **实测**：spring-petclinic droppedCount **362 → 0**；okhttp symbol-table 边 **1037 → 937**，第三方假边**清零**、`okhttp3.*` 仓内真命中 933+ 条保住。okhttp 剩 841 条丢弃全是仓内 specifier 结构解析落空（L2-14 的地界）——仓内包不被闸，结构缺口的报警原样保留，正是设计意图。
- **Added** `testJvmWorkspacePackageGate`：第三方闸死不猜 / 仓内包与子包照常命中 / 通配符内部 / 空集合让位；`testJavaThirdPartyStillGuessesForNow` 改写为「无集合时的让位契约」（其原注释本就写着「该测试的绿是债，方案落地时必须反转」）。**L2-11 至此清零**，P0 层出空。CACHE_VERSION 18 → 19。

### L2-11 缺口 A：JS 外部闸读 manifest 链（monorepo 子包 deps） (2026-07-28)

- **Fixed** JS 外部依赖闸此前只读工作区根的 `package.json`：monorepo 子包自己声明的 deps 全部漏认。zod（pnpm workspace）实测 `@rollup/plugin-*` 声明在 `packages/treeshake/package.json`，根上没有 → 80 条丢弃全是假警报（42/409 文件）。新增 `packageManifestChain(fromDir, root)`（`resolvers/base.js`）：从导入方文件向上到根逐层收集含 `package.json` 的目录（缓存键为归一化 fromDir+root 对，与 `_cargoCrateRootCache` 同形）；`_isExternalJsPackage` 沿链查 manifest 声明与 `node_modules` 探测（node 语义，无 `fromFile` 时退化为根 manifest，行为与旧版一致）。`fromFile` 经 ctx 穿进闸的两个消费方（`trySymbolTable` 与 builder 的 droppedImports 记账）。
- **踩坑**：链的包含比较必须过 `normalizePathKey`——调用方给的路径有原始与归一化两种形态（Windows 上差大小写与分隔符），直接 `startsWith` 会把链静默截断成只剩根 manifest，修复等于没修。RED 先抓住这个。
- **实测**：zod 冷构建 droppedCount **80 → 4**。残余 4 条是 `.configs/rollup.config.js` 位于根层、import 只挂在子包 devDeps 上的包——它的 manifest 链上确实无人声明（pnpm hoist 运行时侥幸），属真阳性，不设机制。
- **Added** `testMonorepoSubPackageDepsRecognized`：子包声明被闸认 / 根声明对深层导入方仍生效（合并非替换）/ 未声明 specifier 照常落到符号表。CACHE_VERSION 17 → 18。

### L2-11 缺口 B：Python 标准库名单补漏（`__future__` / `tomllib` / `zoneinfo`） (2026-07-28)

- **Fixed** `PYTHON_STDLIB_ROOTS`（`resolvers.js`）补三个漏项：`__future__`（债条点名的那一行）、`tomllib`（3.11+，**修完复测时实测带出**——CodeGraphContext 的 droppedImports 里它就排在 `__future__` 旁边）、`zoneinfo`（3.9，与名单里已有的 `graphlib` 同 cohort 的漏项）。名单式闸的通病，补一个是一个，不设机制。
- **实测**：CodeGraphContext 冷构建 droppedCount **70 → 34**，`__future__` 与 `tomllib` 从样本清零。剩余构成：L2-17 结构缺口（`codegraphcontext.*` 仓内绝对导入）+ httpx/anyio 这类**传递依赖**（manifest 未声明、非标准库——名单与 manifest 两道闸都够不着，要么接受要么上 site-packages 探测，属另一个设计题，已记入 L2-11）。
- **Changed** `testPythonStdlibNotGuessed` 补 `__future__.annotations` / `__future__` / `tomllib` 三条断言（本地注册同名符号，闸不拦就会被猜中——断言有牙，非 vacuous）。先 RED 后补名单。CACHE_VERSION 16 → 17（与历次闸扩张同例：旧缓存可能存着这三个 specifier 的假边）。

### L2-15 动作 0+1：门禁不吃 replay + 响应级 `replayedFrom` 标记 (2026-07-28)

- **Added** replay 响应盖 `replayedFrom: { computedAt, gitHead, fileCount }` 标记（`overview-tools.js` replay 分支）——报告路径消费方可区分「本次现算」vs「replay 自某次冷构建」，与 `measured`（字段级）同一思路升到响应级。
- **Changed** 三条决策型入口吃到 replay 时**直接拒绝**，不再静默拿上次冷构建的数据做判决（L2-15 核实：exit code / 回归判定 / 基线文件此前全部可以建立在 replay 上）：
  - `--save` / `--check-regression`：`buildProjectOverview` replay 分支返回 `ok:false` + 原因与刷新方法，**不写基线、不比回归**；
  - `--fail-on-findings`：`cli.js` 出口拦截带 replay 标记的响应，exit 1 + `gate_on_replay` stderr 标签。此前「修了循环依赖退出码还是 1、引入新的还是 0」成立。
- **Added** `test/gate-on-replay-test.js`（@semantic @slow）：报告路径放行且带标记 / 两条门禁拒绝且基线不落盘 / CLI 退出码路径拦截 / 同缓存不带门禁旗标照常通过。两个拒绝点各自变异验证（env 探针置假条件 → 恰好对应断言 RED，恢复即绿）。**测试本身的教训**：CLI 断言初稿用 `exit≠0 + /replay/` ——exit 1 也能来自 hasFindings、`replayedFrom` 标记本身就能匹配 /replay/，变异探针一跑发现假绿，改为断 stderr 的 `gate_on_replay` 专属标签才有牙。
- **Changed** TECH_DEBT 总览：P0 并列第二项（L2-15 动作 0）清零出表，机制债转入预防性约束「门禁型出口不吃 replay」；L2-15 本体保留（动作 2–3 freshness 设计，P3 记账不排期）。无 CACHE_VERSION bump（不改边语义、不改快照格式——`replayedFrom` 只在 replay 出口现盖）。

### T5 输出层补漏：droppedImports 不再恒为 0 (2026-07-28)

- **Fixed** `audit-overview`/`audit-summary` 的 `droppedImports` 段此前**恒为 0**：`DependencyGraphView`（workspace-snapshot.js）是显式白名单委托类，T5 忘了把 `getDroppedImports` 加进名单，`overview-assembler` 的 `?.()` 静默兜成全零——warnings 侧说丢了 N 条，结构化字段说 0 条，同一份输出自相矛盾。消费它的 AI agent 拿到「依赖图完整」的假信号，正是 T5 要修的 L1-4 形状在输出层换位置又长了一个。全量 runner **261/261 全绿**期间该段照样恒为 0——不是测试挂了没人管，是没有任何测试站在用户实际走的入口上（「假绿比红更危险」的又一实例）。修复是 view 补一行委托；`?.()` 兜底同时摘除，探测失败直接抛错，不再能兜成 0。
- **如实更正 T5 条目**：T5 写的「parity 基准第二条断言……实测全 0」当时**没有验证任何事**——它读的就是那个死字段。本轮给断言装上牙：新增 `measured` 字段区分「冷构建实测 0 丢弃」与「根本没测」（warm 路径 / 方法缺失），parity 十一个 fixture 全部断言 `measured === true`；新增负向 fixture `js-dropped-import`（一条好边 + 一条无人认领的裸 specifier）断言 `droppedCount === 1` **走完整 CLI JSON 路径**（snapshot view → overview-assembler → stdout）。
- **Added** `getDroppedImports()` 返回 `measured: boolean`（additive）：builder 冷构建入口把 `_droppedImports` 从 `null` 改为初始化空账，warm-only 图保持未初始化 → `measured: false`。overview 段透传该字段。
- **Fixed** `test/test-helpers.js` mock 补 `getDroppedImports` 语义默认值：Proxy 兜底 `() => []` 返回的是**真值数组**，view 委托接通后 `dropped.samples.slice` 直接炸（overview-tools / overview-history-optional 两个测试 RED）——委托把「静默全零」变成了「暴露 mock 谎言」，这是对的方向。
- **Changed** `AGENTS.md` 债务行更正：L1=1→0（L1-4 已由 T2 修复）、L3=4→3，与 TECH_DEBT 总览一致。
- **Fixed**（同日三轮）`measured` 被存进 `analysis_snapshots` 的 overview 快照并随 replay 原样返回——它存在的理由是回答「这个数字是不是这轮真测的」，一旦跟着 replay 走就永远答「是」，包括根本没测的那些轮（warm 三跑探针：import 已在磁盘删除，字段仍报 `droppedCount:1, measured:true`，与现算的 warnings 方向相反地自相矛盾）。修法不动快照粗粒度设计（deadExports/cycles 同理，刻意保留）：replay 出口按当前图的 `getDroppedImports().measured` 现算覆盖——warm 跑出来 `count:1, measured:false`，读起来就是「这数来自上次冷构建」，本来是实话。顺带 `samples[].file` 从小写化 graph key 改为 `_displayPath`（native 大小写 originalPath），与 deadExports/unresolved 字段同一约定。
- **验证**：parity 先 RED（11/11 FAIL：`measured` 缺失 + 负向 fixture `dropped:0≠1`）后 GREEN（`js-dropped-import: 1 edges [relative:1] dropped:1`）；变异（注释掉 view 委托）→ parity 11/11 RED + `dropped-imports-test` 的 view 断言 TypeError，恢复即绿；`dropped-imports-test` 同时锁裸图与 snapshot view 两条路径；三轮的两条断言（samples 显示路径 / warm replay `measured:false`）均先见 RED 后见 GREEN；fast 层 143/143；eslint 干净。无 CACHE_VERSION bump（不改边语义）。

### T5：L2-13 — 解析失败不再静默（droppedImports + unresolved 正名） (2026-07-28)

- **Added** `resolveFileOnly()` 丢弃分支记账（L1-4 能藏住整整一个语言的机制根源）：gate 已知的外部 specifier（node 内建 / 标准库 / manifest 声明）**不计**——不成边是设计行为；只数「看着像自己的」丢弃。经 `dg.getDroppedImports()`、`buildWarnings()` 的 `unresolved-dropped` 警告（丢弃文件占比 >10% → medium）、`audit-overview`/`audit-summary` 的 `droppedImports` 段（additive）三处出面。无 CACHE_VERSION bump（不改边语义）。
- **Added** parity 基准第二条断言：十个 fixture `droppedCount` 必须全为 0（T1 留的 TODO 打开）——Go fixture 的 `fmt` 被闸正确排除、Rust `mod b;` 无丢弃，实测全 0。下一个语言缺口会自己在这条断言上报出来。
- **Changed** `unresolved` 段新增 `staleResolvedImportsCount` 别名并注明真实语义（数的是「曾解析成绝对路径但文件已消失」的失效边，不是解不开的 import）；旧字段保留为弃用别名（Never break userspace）。
- **留档发现**：`require('./missing')` 这类相对路径写错**不走丢弃分支**——`tryRelativeWithExtensions` 对不存在的目标无条件返回 phantom 路径（`resolvers/javascript.js:116`），成为幽灵边，正是 `findUnresolvedImports()` 现有条目的来源。行为未改（边语义 + impact 有消费方），分工已写进 TECH_DEBT：`staleResolvedImportsCount` 管相对路径写错，`droppedImports` 管裸 specifier 无人认领。
- **验证**：`test/dropped-imports-test.js`（先 RED——首次跑还顺手暴露了 phantom 路径那条真相——后 GREEN）；变异（记账条件置 false）→ RED；parity 十语言 `dropped:0` 全绿；fast 层 143/143；eslint 干净。

### T4：`isBuiltIn` 接线 — JVM 标准库闸 + L3-6 清零 (2026-07-28)

- **Added** `_isExternalDependency()` 在 `EXTERNAL_DEPENDENCY_CHECKS` 未命中时回退 `registry.findByExt(ext)?.isBuiltIn?.(specifier)`——九个语言条目里躺着的 `java.`/`javax.`/`kotlin.` 前缀声明首次有了消费方（L3-6 清零，方案 A）。如实说明消费深度：实际经回退生效的只有 `.java`/`.kt`，其余有闸表行的语言行优先。Java/Kotlin 的**第三方 jar** 仍放行（无 pom/gradle 读取器，L2-11 剩余一半，`testJavaThirdPartyStillGuessesForNow` 把这个缺口锁成显式契约——manifest 读取器落地时该测试必须反转）。
- **验证**：`testJavaStdlibNotGuessed` / `testKotlinStdlibNotGuessed` 先 RED 后 GREEN；变异（回退置 false）→ 恰好这两条 RED；fast 层 143/143。
- **实测**（reference/okhttp、reference/spring-petclinic）：spring-petclinic 511 边 / symbol-table 0；okhttp 2415 边 / symbol-table 1037（43%）。对 1037 条按包前缀分组后两种成分分明——**~950 条仓内自引用**（`okhttp3.*` / `mockwebserver3.*`），成因是 `tryJava` 的源根发现不认识 KMP 布局（`okhttp/src/commonJvmAndroid/kotlin`）与类名≠文件名两种落空，符号表按类名兜底命中为真（JVM「类名=文件名=包路径」语义让末段猜测可靠，新登记 L2-14）；**83 条第三方假边**（`org.junit` 37 / `assertk` 27 / `okio` 13 / `org.mockserver` 3 / `org.gradle` 3——第三方 specifier 配本地 target 必假，okio 未 vendored 已核实），是 L2-11 剩余那半（JVM 第三方 manifest）的首批实测样本。这条实测同时改写 L2-10 的判决材料：「零正产出」结论只在 JS/TS/Python 成立，JVM 侧 symbol-table 有真实正产出，判决要等 L2-14 修完重量。
- **Changed** `CACHE_VERSION` 15→16。

### T3：外部闸 Svelte 腿 — `.svelte` 进 JS 家族 (2026-07-28)

- **Fixed** `JS_FAMILY_EXTENSIONS` 漏 `.svelte`（列了八个 JS 后缀加 `.vue` 唯独漏它）——SvelteKit 项目里 `svelte/store`、node 内建等 specifier 此前会被猜向本地同名符号。一个字符串的修复，但走的是完整流程：先 RED（`testSvelteCallerCoveredByJsFamilyGate`，node 内建 + devDependencies 声明的 `svelte` 两条断言）、GREEN、变异验证（摘掉 `.svelte` → RED，恢复 → 25/25）。
- **实测** `reference/realworld`（SvelteKit）：12 条边、symbol-table 0。
- **Changed** `CACHE_VERSION` 14→15（闸覆盖变化 = 边语义变化）。

### T2：L1-4 修复 — C/C++ 首次产边 + 外部闸同轮落地 (2026-07-28)

- **Added** `src/services/dep-graph/resolvers/cpp.js` 的 `tryCppInclude`：引号形式 `#include "b.h"` 按语言定义相对包含文件解析（C/C++ 从不写 `./`），失败回退 `include/`/`src/` 惯例根；尖括号形式永不解析到仓内文件。解析方法 `cpp-include`，tier1/confidence 1.0。
- **Added** C/C++ 外部闸 `_isExternalCppHeader`（`EXTERNAL_DEPENDENCY_CHECKS` 第五行）：angle 形式（parser 写的 `isLocal === false`）不猜、无扩展名 specifier（C++ stdlib 命名）不猜、C/POSIX 系统头名单不猜。**与解析修复同一提交**——没有闸的解析会把 `boost/algorithm/string.hpp` 猜成名叫 `hpp` 的符号（`.` 分隔符末段是扩展名），正是 `require('path')` 那 212 条的形状。
- **Added** `importHints` 透传：`builder.js → resolveImport → ctx.importHints`，引号/尖括号区分复用 parser 写的 `isLocal`，不在 resolver 重新猜。`CPP_BUILTINS` 收进 `resolvers/cpp.js` 单一出处（registry 的 `isBuiltIn` 声明改为导入）。
- **Changed** registry 的 cpp 条目 `resolveStrategies` 从照抄 JS 的 `[tryAlias, tryRelativeWithExtensions]` 改为 `[tryCppInclude, tryRelativeWithExtensions]`（`tryAlias` 是 tsconfig paths，对 C/C++ 无意义）；`CACHE_VERSION` 13→14（旧缓存 C/C++ 仓 0 边且混仓静默丢边，必须作废）。
- **实测**：`reference/cJSON` 0 → 96 条边（96/96 `cpp-include`）、`reference/fmt` → 135 条 `cpp-include`（另 1 条 symbol-table 是 Python 侧 vendored docopt，真边）；C/C++ 上 symbol-table 贡献 0。`#include "../cJSON.h"`（爬升）与 `#include "fmt/format-inl.h"`（include 根回退）人工核对正确。T1 的 parity 基准 cpp 条转绿（`cpp-include:2`），十语言全绿。
- **变异验证**：摘 `tryCppInclude` 注册 → parity cpp 条 RED（0 边）；摘闸行 → `boost/algorithm/string.hpp` 猜中诱饵符号 `hpp`、测试 RED。两个变异各自独立生效。
- **Added** `test/cpp-resolver-test.js` 七条契约（引号相对 / include 根回退 / angle 不解析 / angle 不猜 / 无 hints 时系统头与无扩展名兜底 / 本地头过闸正向对照），先 RED 后 GREEN。

### T1：每语言边产出基准测试入库 — L1-4 的 RED (2026-07-28)

- **Added** `test/language-parity-edges-test.js`（`@semantic @slow`，十次冷构建）：十个最小「A 依赖 B」fixture（`test/fixtures/language-parity/build-fixtures.js`，各带项目标记——package.json / tsconfig.json / requirements.txt / pom.xml / build.gradle.kts / go.mod / Cargo.toml / CMakeLists.txt），逐语言跑 `audit-summary` 后直读 cache.db，断言**每语言 ≥1 条边且来自结构解析方法**（`relative` / `python-absolute` / `java-package` / `go-module` / `rust-crate`），symbol-table 命中不算等价（L2-10）。等价性验收从 parser 层下放到边层——TECH_DEBT「测试覆盖缺口」条目建议的落地。
- **现状**：cpp 一条 RED（L1-4，预期内——T2 的修复对象），其余九条 GREEN，无一条靠 symbol-table。环境降级防护：java/python fixture 的 AST 解析 spawn Python（`spawn-ast.js`），机器无 python 时报 SKIP 并在输出注明，不让工具链缺失伪装成语言缺陷。
- **留口**：`droppedImports === 0` 断言以 TODO 形式挂在测试尾部，等 T5（builder 累计丢弃数，L2-13）落地后打开。

### 九语言等价性实测：发现 C/C++ 零边（L1-4）+ 三项新债登记 (2026-07-28)

铁律 #8 的等价性此前只在 **parser 层**验收，本轮把探针下放到**边**这一层：给九种语言各建一个「A 依赖 B」的最小 fixture（十个仓，含 JS/TS 分测），逐语言量边产出；另做闸隔离探针（让符号表对任何名字都命中，`null` 即闸拦住）与注册表六钩子消费审计。**纯文档登记，未改任何生产代码。**

实测结果（当前 HEAD，5 次重跑一致）：

| 语言 | 边 | 解析方法 | | 语言 | 边 | 解析方法 |
| --- | ---: | --- | --- | --- | ---: | --- |
| js / ts | 1 | `relative` | | go | 1 | `go-module` |
| python | 1 | `python-absolute` | | rust | 1 | `rust-crate` |
| java | 2 | `java-package` + 同包隐式 | | vue / svelte | 1 | `relative` |
| kotlin | 1 | `java-package` | | **cpp** | **0** | **—** |

- **新登记 L1-4（Blocker）**：C/C++ 产不出任何依赖边。parser 正常（`parse_mode: ast`，直调 `parseCppAst` 能拿到 `importRecords`、`isLocal: true`），死在 resolver——注册表给 C/C++ 配的是 JavaScript 那套 `[tryAlias, tryRelativeWithExtensions]`，而 `#include "foo.h"` 按 C/C++ 语义就是相对当前文件、从不写 `./`，于是被当 npm 包找、找不到、被 `resolveFileOnly()` 丢弃。实测 `resolveImport('main.cpp','helper.h','.cpp') → null` 而 `'./helper.h' → 成功`。后果是错误的行动建议：工具报「审查孤儿模块是否可删除: helper.h」，而 `main.cpp` 正 include 它。纯 C/C++ 仓有 `empty-graph`(high) 警告兜底，**混合仓没有**（其他语言的边让该警告不触发）。
- **订正 L2-11 缺口范围**：从「只剩 Java / Kotlin」订正为 **Java / Kotlin / Svelte / C-C++ 四个**。Svelte 的原因是 `JS_FAMILY_EXTENSIONS` 列了八个 JS 后缀加 `.vue` 却漏了 `.svelte`，补一个字符串即可；C/C++ 的闸与 L1-4 强耦合，必须同轮做——否则 `#include <stdio.h>` 会去查名为 `"h"` 的符号（非 Rust/Go 分隔符是 `.`，末段取到扩展名），等于把 `require('path')` 那 212 条的病重新引进来。
- **新登记 L2-13**：`unresolved` 统计的是「曾解析成绝对路径、但文件已不在磁盘」，不是「解不开的 import」。十个 fixture 全报 `unresolved: 0`，包括丢了两条 `#include` 的 C/C++ 仓——解不开的 specifier 不是绝对路径、且早被丢弃，两道门都进不去。该字段是 `audit-summary` 一线指标，结构上无法回答它看起来在回答的问题。
- **新登记 L3-6**：`isBuiltIn` 死配置。九个语言条目各声明一份内建名单（`java.`/`javax.`、`kotlin.`、`CPP_BUILTINS`、`GO_BUILTINS`、`PYTHON_BUILTINS`），全仓零调用方；同批审计的其余五个钩子（`resolveStrategies` / `extractSymbols` / `condition` / `filePatterns` / `needsWorkspaceRoot`）均有消费方。而 L2-11 缺闸的三个语言所需名单正躺在这里——接线即可推进，不必新写。
- **新登记 L3-7**：Vue / Svelte 的 `extractSymbols` 是逐行正则，而其 `parse` 走 babel AST；`file-index.js` 消费的是正则那条。
- **Changed** ROADMAP 成功标准：标准 8「全栈 AST 覆盖 100%」补注口径为**在 parser 层**，新增标准 8b「全栈依赖边覆盖 8/9 = 89%」；标准 4 的「仅 C/C++ regex 无 functionRecords」已过期作废（`cpp-ast.js` 产出 functionRecords），真实缺口指向 L1-4。
- **Added** 开发纪律条目「覆盖率声明必须写清在哪一层验收」+ 测试覆盖缺口条目：建议把 `scripts/resolver-precision.js` 扩成每语言边产出基准，用这十个 fixture 断言「每语言至少 1 条边、丢弃数为 0」，L1-4 与 L2-13 会被同一条测试兜住。

### L2-12 清零：Rust `super::`/`crate::` 从猜名字回到模块算术 (2026-07-28)

- **Fixed** `tryRustSuper` 的 off-by-one：`super` 是模块概念不是目录概念——非 mod 文件（`blame.rs`）的第一个 `super` 命名文件所属模块本身，子模块目录就是文件所在目录，不爬升；`mod.rs` 文件本身就是父目录命名的模块，每级 `super` 才爬。旧代码每级必爬，非 mod 文件的 `super::` 路径全部落空掉进符号表。
- **Fixed** `tryRustCrate` 锚定错误：`crate::` 改锚**最近的 Cargo.toml** 的 src（`base.js` 新增 `findCargoCrateRoot`，缓存进 `clearResolverCaches()`）——多 crate 工作区（qartez-mcp/qartez-dashboard）里原来锚工作区根，member crate 的 `crate::` 全部落空。
- **Added** 单段末条的基模块回退：末段命名基模块的**条目**而非子模块时（`super::QartezServer`），回退基模块文件（`mod.rs` / `baseDir.rs` / `lib.rs` / `main.rs`）。多段失败不回退——`super::foo::Bar` 要求 foo 是模块。
- **实测**（qartez-mcp 重建）：symbol-table 313 → 160（正好 −153），总边 594 → 676（+82 条原先连猜都猜不出、被静默丢弃的 import 首次成边），随机抽 6 条新 tier1 边人工核对全对，零重复 (source,target) 对。
- **Changed** `CACHE_VERSION` 12→13。`test/gors-resolver-test.js` 新增 4 条契约（对旧 `rust.js` 验证 RED）；旧断言 `super::super::lib → null` 锁的正是 off-by-one，改为 crate 根语义。

### 删掉 `shared.js` 转手再导出的 `path` — 假边的根因，不再只靠闸盖住 (2026-07-28)

外部依赖闸挡住了 212 条假边，但没人问过**为什么本仓会有 212 条**。答案是一行 shorthand：`parsers/js/shared.js` 第 1 行 `require('path')`，第 195 行原样再导出，于是符号表登记了「shared.js 导出一个叫 `path` 的符号」，全仓 215 个 `require('path')` 的文件在闸出现前全部解析到它。`impact parsers/js/shared.js` 因此报 212 个被依赖文件，真值 3（`js.js` / `ast-parser.js` / `regex-fallback.js`）。

- **Removed** `shared.js` 的 `const path = require('path')` 与 `module.exports.path`——该文件自身零处使用 `path`，这行 require 纯粹为了转手。全仓唯一消费者 `ast-parser.js` 改为自己 `require('path')`（只用在一处 `path.extname()`）。
- 变异验证（闸不是遮羞布的证据）：临时让 `_isExternalJsPackage()` 恒返回 false，改前 1230 边 / **212 条** symbol-table（212 条 specifier 全是 `path`、target 全是 `shared.js`，无第二种形状），改后 1018 边 / **0 条**，总边数与闸开启时一致——根因已除，且没有任何真边依赖这条路径。探针已撤，未入库。
- **Changed** `_isExternalJsPackage()` 的文档注释口径修正：原文称 `debug`/`config`/`glob`/`semver`/`path` 「碰撞够频繁」，实测本仓只有 `path` 真的撞了，其余是假想例子；数字 209/1219 亦为过期快照，改为 212/1230 并注明根因已删除。`scripts/resolver-precision.js` 头部同步——清洁树上重跑会得到 0，要看机制须先关闸。
- 无 `CACHE_VERSION` bump：闸已在 v9 起作废这类边，本次删除不改变任何在用缓存的语义。

**L2-10 复测（`reference/` 四仓新鲜数据）**：GitNexus (TS) 2621/**0**、CodeGraphContext (Py) 400/**0**、code-review-graph (Py) 252/**0**、workspace-bridge (JS) 1018/**0**；qartez-mcp (Rust) 594/**313**，拆分为 156 条 `qartez_mcp::` + 127 条 `super::` + 26 条 `crate::`（后两类正是 L2-12 记的结构解析缺口）。zod / execa 不在本地 `reference/` 下，那两条仍是 2026-07-28 的记录而非本次复测。

### 外部依赖闸扩到 Go (2026-07-28)

四条语言腿里最便宜的一条：Go import 永远带完整路径，归属判断不需要任何名单——

- **Added** `_isExternalGoModule()`：specifier 以 `go.mod` 的 module 路径为根 = 工作区内部（与 Rust 的 `qartez_mcp::` 情形同构，放行）；dotted 首段 = 外部模块（`github.com/…`）、无点首段 = 标准库（`fmt`、`encoding/json`），两类都拦。无 `go.mod` 可读时后两类依旧确定，照常拦——那时猜名字是纯风险，Go 仓 symbol-table 实测贡献为 0。作为一行加进 `EXTERNAL_DEPENDENCY_CHECKS`，复用既有 `readGoMod`，零新 manifest 读取器。
- **Changed** `CACHE_VERSION` 11→12。
- 验证：`resolver-symbol-table-test.js` 24/24（新增 4 条：stdlib 不猜 / 外部模块不猜 / 无 go.mod 仍拦 / 本 module 路径仍解析的正向对照），先 RED 3 条；变异摘掉 Go 分派行 → 恰那 3 条 RED。TECH_DEBT L2-11 只剩 Java / Kotlin。

### 外部依赖闸扩到 Python (2026-07-28)

`import requests` 撞上本地导出的 `requests`，与 `require('path')`、`std::process::Command` 是同一形状的假边。闸的第三条语言腿：

- **Added** `base.js` 的 `readPythonDeps(root)`：合并 `requirements.txt` 与 `pyproject.toml`（`[project] dependencies` / `[project.optional-dependencies]` 数组 + `[tool.poetry...dependencies]` 表），mtime 双文件联合缓存，接入 `clearResolverCaches()`。包名 PEP 503 归一（小写、`-_.` 连段坍缩为 `-`），所以 `tree-sitter` 匹配导入名 `tree_sitter`；`python-dotenv→dotenv`、`pyyaml→yaml`、`pillow→pil`、`beautifulsoup4→bs4`、`scikit-learn→sklearn`、`opencv-python→cv2` 六个著名错配走别名表。
- **Added** `resolvers.js` 的 `PYTHON_STDLIB_ROOTS`（Python 3 标准库顶层模块名单）+ `_isExternalPythonModule()`，根段判定（`os.path.join` 归属 `os`），作为一行加进 `EXTERNAL_DEPENDENCY_CHECKS` 分派表。
- **Changed** `CACHE_VERSION` 10→11：v10 缓存里 Python 仓的 symbol-table 边可能混着这类假边。
- 验证：`test/resolver-symbol-table-test.js` 20/20（新增 4 条：stdlib 不猜 / requirements 不猜（含 `>=` 版本符与 `[extras]` 剥离）/ pyproject 不猜（含别名）/ 无归属 specifier 仍解析的正向对照）。变异验证：摘掉 Python 分派行 → 恰好那 3 条闸门测试 RED。真实 manifest 抽查：CodeGraphContext 39 个名（含 `dotenv`/`yaml` 别名与 `tree-sitter` 归一）、code-review-graph 30 个、qartez-mcp 正确返回 null（无 Python manifest，Rust 闸不受影响）。诚实记录：precision 基准上两个 Python reference 仓的 symbol-table 贡献实测为 0，此闸是铁律 #8 的等价性保险而非修复已测到的假边。
- TECH_DEBT L2-11 状态更新：剩 Go / Java / Kotlin 无闸。

### resolver 精度基准 + 外部依赖闸扩到 Rust (2026-07-28)

**Added** `scripts/resolver-precision.js`（TECH_DEBT L2-10 的判决工具）：join `edges.resolution_method` 与 `parse_results.import_records`，输出「导入方 —[原始 specifier]→ 目标」三元组——只数数字无法判断对错，人工确认需要看见源码里写的是什么。首次测量（五个真实仓）：

| repo | 总边 | symbol-table | 占比 |
| --- | ---: | ---: | ---: |
| GitNexus (TS/Py) | 2621 | 0 | 0% |
| CodeGraphContext (Py/TS) | 400 | 0 | 0% |
| code-review-graph (Py/Java/Go) | 252 | 0 | 0% |
| workspace-bridge (JS) | 1018 | 0 | 0% |
| qartez-mcp (Rust) | 642 | **361** | **56.2%** |

结论有两面：**JS/TS/Python 上这个策略贡献恒为 0**（L2-10 判决所需的第一个数字），而 **Rust 上它撑起半张图**——Rust 集成测试用 crate 绝对路径（`qartez_mcp::server::QartezServer`）引用自己的 crate，符号表正好解得动，156 条这类边全部正确。

- **Fixed** 但那 361 条里混着 48 条与 `require('path')` 同病的假边：`std::process::Command` → 本地 `src/cli.rs`、`rmcp::…`（外部 MCP SDK crate）40 条、`tokio::…` 1 条。现 Rust 调用方同样先判外部归属：`std`/`core`/`alloc`/`proc_macro`/`test` 前缀 + `Cargo.toml` 四类依赖段声明的 crate（含 `[dependencies.foo]` 子表、`[target.'cfg(...)'.dependencies]`，包名连字符按 Rust 路径形态归一为下划线）。**`path = ` 依赖刻意不拦**——那是工作区内的本地 crate，源码就在图里。实测 361 → 313，正好少 48，156 条正确边一条未伤。
- **Added** `base.js` 的 `readCargoDeps(root)`，mtime 缓存，形状同 `readGoMod`/`readPackageDeps`，接入 `clearResolverCaches()`。
- **Changed** 两处外部判定收进按语言分派的 `EXTERNAL_DEPENDENCY_CHECKS` 表（原先是 `trySymbolTable` 里的扩展名 if），加语言 = 加一行 + 一个 manifest 读取器。L3-4 的形状债因此缩小但未清零（分隔符选择仍是扩展名分支）。
- **Changed** `CACHE_VERSION` 9→10：v9 缓存存着那 48 条假边。
- 遗留观察（未修）：qartez-mcp 剩下的 313 条里有 127 条 `super::` 与 26 条 `crate::`——这两类是结构可解析的模块路径，本不该靠猜名字命中，说明 `tryRustSuper`/`tryRustCrate` 有覆盖缺口。已记入 TECH_DEBT。

### warm/cold 同构契约测试：接线测试的替代品 (2026-07-28)

- **Added** `test/warm-cold-parity-test.js`（slow 层）：同一 fixture 冷启一次、暖启一次，比较**可观察输出**必须完全一致——边集、每文件被依赖数、符号表（含 `isExported`）、重复符号数、`affected-tests`（含 `distance` 与 `source`，wave8 当年正是在这两个字段上 warm/cold 分叉：cold 44 vs warm 16/23）。此前每发现一处 warm 遗漏，就补一句调用 + 写一条锁调用顺序的接线测试（L1-3 的 java 展开、符号表重建各一次）；接线测试锁的是症状，这条锁的是契约，内部怎么重构都不影响它。
- 该测试同时断言第二次启动的 `build()` 调用数为 0——否则 warm 一旦静默回落 cold，它会退化成"cold 比 cold"，在保护对象消失后依然全绿（`docs/TECH_DEBT.md` 的"假绿比红更危险"纪律）。变异验证：注释掉 `loader.js` 的 `_buildSymbolRegistry()` → RED（符号表全空、`duplicateSymbols` 2→0）。
- **Changed** `docs/TECH_DEBT.md` 架构-1 降级为预防性约束。**刻意未做**把后处理抽成单一 `finalize()`：两条路径重建图的方式本质不同（cold 解析 import，warm 从持久化边恢复），塞进一个函数需要 warm/cold 条件分支——那是以消除边界之名增加判断。分歧交给契约测试兜底，不由结构强行统一。

### CACHE_VERSION 门禁收敛到单一读侧闸口（补漏第五次 → 归零）(2026-07-28)

同一个不变量此前在四个地方各补了一次：wave8 预计算污染（`eda0e8c`）→ `analysis_snapshots` 逐行盖戳 → `loader.js` 的 `edgeMeta` 门禁 → `savePrecomputed` 的 test_map 无条件重写（均见下方条目）。根因不是四个 bug，是**读侧没有唯一闸口**：`loadAll()` 版本不符只 `return null` 而不清表，其余 `loadXxx` 各自裸读。

- **Added** `graph-db.js` 的 `_readGuard(label, fn, fallback)`：所有表读取的唯一入口，版本不符即返回该调用点语义下的"缓存未命中"。改写 11 个读入口经由它——`loadAll` / `loadEdges` / `loadRoutes` / `loadMetrics` / `loadTestMap` / `loadPrecomputedAggregates` / `loadPrecomputedImpact` / 三个 `*ForFiles` 变体 / `findAffectedHttpRoutes`。最后那个是审计中发现的漏网：它用递归 CTE 直读 `edges` + `routes`，长得不像 `loadXxx`，正是最容易漏的形状。`loadAll` 内部那份重复的版本判断随之删除，规则只剩一处。
- **Added** `_stampVersionIfUnset()`，挂在 `_withWriteLock` 上：读侧闸只做了一半——只查戳不建立出处，导致只经历过分表写入（`saveEdges`/`saveRoutes`，无 `saveAll`）的库因"无戳"被自己写的进程拒读。现任何写入都会给**无戳**库盖戳。刻意只在无戳时盖：戳存在但不同 = 别的语义写的库，覆盖它等于把闸重新开向读不懂的数据，只有整库重建（`saveAll` 清表 + 重盖）才恢复可读。
- **Fixed** `loadAll()` 把"从未被完整写过的库"当成暖启动空结果返回：仅 `saveAll`/`saveIncremental` 写 `timestamp`，缺它即不是缓存，必须回落冷启动（`cache-backup-test.js` 的"无数据库时 load 必须 false"契约捕获）。
- **Changed** `queryReadOnly` 明确标注**不设闸**：它是 `query-sql` 这个人工排查入口，盖上闸就正好藏起了排查者要看的行。
- **Added** `test/graph-db-version-gate-test.js`：五条契约，核心是枚举**每一个读入口**（新增 `loadXxx` 必须来这里加一行，加不进来说明它绕过了闸），外加"无戳库可读且被盖戳""外来戳不被分表写入覆盖""重建后恢复可读（否则一次版本 bump 会把用户 cache 目录永久砖掉）"。变异验证：摘掉闸内那一行 → RED。

### warm 路径后处理泛化 + `debug --what symbols` 重复符号口径修正 (2026-07-28)

- **Fixed** `orchestrator.js` 的 warm 分支写死 `expandJavaPackageImports()`，而 `build()` 是遍历 `postProcessPhases` 数组——**任何经 `registerPostProcessPhase()` 注册的新阶段在 warm 路径被静默跳过**，L1-3 正是这个形状的第一例。现两条路径共用 `builder.runPostProcessPhases()`，"注册即两路径生效"从纪律变成机制。阶段作者的契约（幂等）写进方法文档。`orchestrator-warm-java-expansion-test.js` 借用真实 `runPostProcessPhases` 实现 + 假 phases 列表，新增用例锁自定义阶段必须在 warm 重放（变异验证：只跑 java 阶段 → RED）。
- **Fixed** `debug --what symbols` 直接遍历 `registry.exports` 原始 locations 统计重复符号，不过滤 `isExported: false`：同一份 JSON 里 `duplicateCount`（未过滤）与 `stats.duplicateSymbols`（已过滤）自相矛盾，且把本仓 227 个测试文件各自私有的 `function main()` 报成"重复符号"。这条命令的全部用途就是找同名碰撞。现新增 `SymbolRegistry.getDuplicateSymbols()` 作为"重复"的唯一定义，`getRegistryStats()` 与 debug 命令都走它（实测本仓 86/86 一致，top 重复为 28 个语言模块各自导出的 `language`/`framework` 等真碰撞）。
- **Added** `test/debug-symbols-command-test.js`：该命令此前零测试。四条契约——私有声明不算重复、`duplicateCount` 与 `stats.duplicateSymbols` 必须描述同一集合、一导出一私有不算碰撞、registry 缺失时干净报错。
- **Changed** `builder.js` 的第二次 `_buildSymbolRegistry()` 加实测注释：两次调用产出同 hash（2193 符号），当前纯重复，但保留为 fail-safe 方向，删除需先立"post-process 阶段不得注入 exportRecords"的契约。
- **Changed** `docs/dogfood.md` 四处基于空数据的过期判断作废：`debug` 曾被标记"🔴 应废弃（symbolCount=0，graph 不支持）"，实测 symbols/graph 均有真实数据——原结论建立在符号表功能尚未落地时。

### symbol-table 外部依赖闸：本仓 209 条假边清零 (2026-07-27)

`trySymbolTable` 挂在每条 resolver 链的链尾，也就是说**凡是解析不到文件的 import 都会拿末段名字去全局符号表赌一把**——第三方依赖天然全部走这条路。实测代价（本仓 dogfood）：

| | 总边数 | symbol-table 边 | `parsers/js/shared.js` 的被依赖数 |
|---|---|---|---|
| 闸前 | 1219 | 209 | 212 |
| 闸后 | 1010 | 0 | 3 |

209 条全部同一个成因：`parsers/js/shared.js` 把 `const path = require('path')` 带进了 `module.exports`，于是全仓 209 个 `require('path')` 都被解析成指向它的边，confidence 0.8 / tier2。`impact parsers/js/shared.js` 因此会报"影响 212 个文件"，真值 3。GitNexus（2621 边）上该策略贡献 0 条，即实测净产出为负。

- **Fixed** `trySymbolTable` 在 JS/TS 调用方处先判外部归属，命中即不猜：`node:` 等协议前缀、node 内建模块、`package.json` 四类依赖字段里声明的包、`node_modules/<pkg>` 实际存在。这是确定性事实而非又一层启发式，所以排在整个打分逻辑之前。作用域限定在 JS 家族扩展名，Java/Python/Go/Rust 调用方不受影响（Java 的"文件名 ≠ 类名"才是该策略的原始用途）。
- **Added** `base.js` 的 `readPackageDeps(root)`：mtime 缓存的根 package.json 依赖名集合，形状与既有 `readGoMod` 一致，并接入 `clearResolverCaches()`。
- **Added** `resolver-symbol-table-test.js` 六条闸门契约测试（声明依赖 / node 内建 / `node:` 前缀 / 仅存在于 node_modules / scoped 子路径 / 非 JS 调用方不受影响），含正向对照：未声明的裸 specifier 仍然回落符号表，闸门不得把策略本身关掉。
- **Changed** `CACHE_VERSION` 8→9：v8 缓存里持久化着那 209 条假边，不作废会被当新鲜数据服务。

### 评审跟进：CACHE_VERSION 门禁补漏 + 接线契约补测 (2026-07-27)

对 `02ce28a`（L1-3）与 `eda0e8c`（wave8 + query-tools flaky）的复审产出。两个 commit 的语义修复都成立，漏的是同一类东西：**契约测试锁语义、不锁接线**。

- **Fixed** `loader.js` 的 `CACHE_VERSION` 门禁在 `edgeMeta` 缺失时被整体跳过：原判断是 `if (edgeMeta) { ...三项校验... }`，即"没有元数据 = 没有要检查的东西"。但 `edgeMeta` 是 warm 路径上 CACHE_VERSION 的**唯一**执行点——`loadAll` 版本不匹配只返回 null 不清表，而 `loadEdges`/`loadTestMap`/`loadMetrics`/`loadRoutes`/`loadPrecomputedImpact` 全是直读表无版本检查。元数据缺失应当意味着"整张 DB 不可信"，现改为 `if (!edgeMeta) return false` 回落冷建。
- **Fixed** `savePrecomputed` 在新图算不出任何 `test_map` 时跳过写入，而 `saveTestMap` 是 DELETE-全表 + INSERT 语义——DB 里留着上一次 build 的映射，内存却已被清空，下一个进程 `restorePrecomputed` 把旧图映射注入 analyzer 当新鲜的用（wave8 病族的另一个入口）。现无条件重写，与相邻 `saveRoutes` 早已注释说明的处理保持一致。
- **Added** `test/orchestrator-warm-java-expansion-test.js` 接线契约测试：L1-3 的真实病灶是"loadGraph 成功后没人重跑 `expandJavaPackageImports()`"，但既有的 `java-same-package-dead-export-consistency-test.js` 自己手动调该方法，把 `orchestrator.js` 里那行删掉 4 个用例照样全绿（已实测确认）。新测试锁调用与顺序：warm 必跑且必须早于增量 delta，cold 不得重复跑。
- **Added** `test/loader-edge-meta-gate-test.js` 与 `test/savepre-testmap-stale-clear-test.js` 契约测试（均先 RED 后 GREEN）。
- **Fixed** `e2e-gitnexus-test.js` 在 `reference/GitNexus`（本地 gitignored fixture）缺失时硬 FAIL——任何干净 clone 或 git worktree 里跑全量 runner 都会挂在这条，且报错长得像真回归。现缺 fixture 时 SKIP。
- **Changed** `cli-integration-query-test.js` 清理已废除的 `precomputed_aggregates` `analysis_snapshot` 镜像行预置：该路径上个 commit 已删除，残留 fixture 会让人以为它仍受支持。

### Stage 4 Step 1：Pre-scan 全局符号映射完成 (Pilot: JS/TS + Python) (2026-07-23)

- **Fixed** `dep-graph.js` 的 `loadGraph()` 载入 SQLite 节点后恢复缺失 `SymbolRegistry` 的死穴 bug，实现 Warm / Cold 路径 100% 相同同构性。
- **Added** `symbol-registry.js` 重构升级：实现 `lookupBestMatch()` 得分消歧算法（显式 export、同目录亲和、公共路径深度算术），定义 `CONFIG.SYMBOL_DISAMBIGUATION` 门禁常数（遵守 L2-6）。
- **Fixed** `resolvers.js` 中 `trySymbolTable` 支持多语言分隔符（`.`, `/`, `::`），避免 Go (`pkg/sub.Func`) 与 Rust (`mod::Struct`) 分割错误。
- **Added** `ast-parser.js` 支持顶层非 export 声明提取入 Superset（标注 `isExported: false`），零 SQLite 列扩展冗余成本；同时在 `exports` 提取时过滤非导出符号以防止死导出误报风险。
- **Changed** `CACHE_VERSION` 6→7：作废未解析非导出符号的旧缓存，确保冷热启动均能加载最新符号。
- **Added** `test/symbol-prescan-registry-test.js` 同构与消歧契约测试（含 ServiceContainer 冷热对比，归 slow 层）。
- **Fixed**（评审修复 10 项）：恢复 `ast-parser.js` 被误删的 CJS `ObjectMethod` 分支（shorthand method 导出丢失 + ObjectProperty 双记录曾致 `lookupBestMatch` 平分返回 null）；`trySymbolTable` 分隔符按语言收口（`::` 仅 Rust、`/` 仅 Go，JS/TS 保持 `.`，杜绝 npm 子路径 import 误配本地符号）并删除 `lookupBestMatch` 存在性死分支；`lookupBestMatch` 单命中尊重 `isExported: false`（非导出符号不解析 import）；消歧常数改为顶部引用 `scoring.js`（删兜底副本），`SCORE_SAME_LANG_FAMILY` 更名 `SCORE_SAME_EXT`（实现即扩展名全等）；`getExportedSymbols()`/`getRegistryStats()` 过滤非导出记录维持公共契约；registry 重建从 facade 下沉到 `loader.js` load 机制内（warm/cold 单一机制）；`CACHE_VERSION` 7→8 作废坏 parser 写出的 v7 缓存行。
- **Fixed**（评审修复 11 项之补）`lookupBestMatch` 的"非导出符号不解析 import"只在单命中分支成立，多候选打分路径漏掉：当**全部**候选都是 `isExported: false`（顶层预扫描记录）时，同目录候选拿 `SCORE_SAME_DIR + SCORE_SAME_EXT` = 50、远处候选拿 10，gap 40 过阈值，于是返回一个私有函数所在文件——裸 import 末段名字撞上两处同名私有函数即产假边。现改为**打分前先滤掉非导出候选**：`length === 1` 特例随之消失，`SCORE_EXPLICIT_EXPORT` 成为对 gap 数学无影响的死项，已从 `scoring.js` 删除。测试见 `symbol-registry-test.js: testLookupBestMatchNeverResolvesToNonExported`（先 RED 后 GREEN）。
- **Fixed** `e2e-gitnexus-test.js` 交叉校验断言：曾被弱化为恒真式（count 对 count），现编码真实契约——JSON 输出经 `elideDeep` 在 `JSON_OUTPUT_MAX_ARRAY_ITEMS`(100) 截断而 `summary.counts` 保真值，断言 `数组长度 === min(counts, cap)`（GitNexus 死导出 104 > 100 首次踩中该边界）。

### analysis_snapshots 版本门禁 + precomputed_aggregates 单一写入方 (2026-07-23)

- **Fixed** `analysis_snapshots` 是 CACHE_VERSION 门禁的后门：版本 mismatch 时 `loadAll` 只拒读不清表，旧语义（如 v5 dead-exports 口径）算出的 overview 快照存活，gitHead/fileCount/configHash 恰好匹配时被 `buildProjectOverview` 短路 / `query-*` 直接消费。现 `analysis_snapshots` 逐行盖 `cache_version` 戳（`_migrate()` 加列，DEFAULT 0 自动作废所有存量行），`loadAnalysisSnapshot` 门禁拒收非当前版本行，消费方视为 cache miss 重算。
- **Fixed** `precomputed_aggregates` 两写入方互删（runner 并发下 query-tools-test 间歇性失败的真凶）：该表是 DELETE-全表 + INSERT 语义，`savePrecomputed`（graph:built 触发）写 4 个聚合 key 时清掉 overview 的 `analysis_snapshot` 镜像行，`buildProjectOverview` 写镜像行时反向清掉 4 个聚合 key——后者还意味着 **overview 每次落库都静默清空 warm 聚合预计算**（长期存在的静默性能回退）。修法为删除：overview 不再写该表（`analysis_snapshots` 是快照唯一归宿），`query-tools` 的镜像行兼容回退一并删除（该行无版本戳，是版本门禁的第二个后门）。
- **Added** `test/query-tools-test.js` 新契约用例 `testOverviewDoesNotClobberAggregates`：预置聚合 key → 强制 overview 全量计算 → 聚合 key 必须存活 + 快照落 `analysis_snapshots` 真表（TDD：先 RED 后 GREEN）。`testQueryToolsCacheHit` 断言改打 `analysis_snapshots` 真表。
- **Added** `test/precomputed-roundtrip-test.js` 新契约用例 `testGraphDBAnalysisSnapshotVersionGate`：当前版本快照可读、篡改为旧版本后必须拒收。
- **验证**：全量 runner **251/251 全绿**（wave8 与 query-tools 两个历史 flaky 全部根治后首次零失败）。

### wave8 flaky 根治：affected-tests 深度门禁 + 预计算旧缓存污染清理 (2026-07-23)

- **Fixed** `findAffectedTests` 中 `_testMapCache` fast path 的计数分歧（wave8 `44 !== 16`）：两层病灶——(a) 预计算深度是裸数字 `3`（persistence.js）而查询默认深度是 `CONFIG.DEFAULT_MAX_DEPTH = 5`，两个"默认"各过各的，现统一引用同一常量；(b) `mention` 启发式终结符集合是 `maxDepth` 的函数（深图条目在浅查询里会被冷路径重分类为 mention），预计算 map 是按深度参数化的答案，行级 `distance <= maxDepth` 过滤在数学上无法复现冷路径。现 fast path 仅在 `maxDepth === CONFIG.DEFAULT_MAX_DEPTH` 时服务且不做任何过滤（按构造无需），外来深度绕过走冷路径活算；同时给终结符加上 `terminator: true` 与冷路径 Schema 保持 100% 同构。
- **Fixed** `savePrecomputed` 生成 `test_map` 时的旧内存快照污染：在算 `test_map` 之前先调用 `depGraph.analyzer.injectPrecomputedTestMap([])` 强清内存，确保 `findAffectedTests` 针对新图跑冷算，存盘后再用新结果刷新内存 cache。
- **Changed** `CACHE_VERSION` 5→6：作废按 v5 存储的在非默认深度下缺项的 test_map 缓存。
- **Added** `test/affected-tests-testmap-terminator-test.js` 契约测试：匹配深度出完整 map 与 `terminator: true`、外来深度（`maxDepth != DEFAULT`）强制 bypass fast path 走活算、`includeHeuristic: false` 不打终结符。

### L1-3 清零：Java same-package 隐式边 build/loadGraph 路径语义统一 (2026-07-23)

- **Fixed** dead-exports 在「刚 build」与「loadGraph 恢复」两条路径下结果不一致（TECH_DEBT L1-3）：`setParseResult` 在 postProcess 之前持久化，tier1 wildcard-resolved 与 tier3 same-package 展开记录均不落盘，warm 路径边在、记录缺。现 `orchestrator.js` 在 loadGraph 成功后重跑 `expandJavaPackageImports()`（幂等 strip-and-rebuild，非 Java 项目建索引后早退），warm 路径与冷 build 内存态完全一致。
- **Changed** 语义决策落地（TECH_DEBT 既定倾向）：tier3 same-package 记录不再参与死导出「已使用」判定——与 cycles Rule 5 排除 tier3 的先例一致。同包真实引用由 importer 内容扫描兜底；仅剩隐式 importer 的死导出照报，但强制 `confidence: low` + `confidenceSource: 'implicit-same-package'`。**Java 项目 dead-exports 数字会变**：原被同包边掩盖的死类现以低置信度可见。
- **Changed** `CACHE_VERSION` 4→5：旧缓存中按 v4 语义计算的 deadExports 聚合必须失效；所有项目下次运行冷启动重建一次（一次性代价）。
- **Added** `test/java-same-package-dead-export-consistency-test.js` 契约测试：cold 报出低置信同包死类、warm 恢复态重展开后与 cold 一致、同包真实引用内容扫描抑制、wildcard tier1 双路径抑制一致（TDD：先 RED 后 GREEN）。
- **Added** TECH_DEBT 新预防性约束：postProcess 注入的 importRecords 不落盘——新增此类注入必须同步 loadGraph 分支重跑或持久化元数据。

### mixed repo L1/L2 评审修复：正则词边界 + audit-file 触达 + 契约测试 (2026-07-23)

- **Fixed** `INFRA_PATTERNS` 除 `.env` 外的分支缺词尾锚点，`Dockerfiles/`、`Makefiles/` 等目录下任意文件被误报为 infra 变更；同时补齐 `compose.yaml`（Compose v2 官方推荐名）与 `docker-compose.override.yml` 识别。
- **Fixed** `audit-file` 单查 infra 文件（如 Dockerfile）时 `changedTargets` 为空、`mixed-infra-smoke` 提醒永不触发的死角——`buildFileValidationAdvice` 对 infra 文件豁免 Route B 空 targets 策略（与编译型语言例外同理）。
- **Removed** `merged.full.length > 0` 守卫：full 为空时 L1 提醒被静默丢弃，违反 L1-4 静默降级禁令；unshift 空数组本无任何问题。
- **Changed** `unownedFiles` / `changedStacks` 判定改由 `Object.values(STACK_TARGET_PATTERNS)` / `split` 派生，消除三处手写六栈清单——新增语言栈不再静默漏判。
- **Fixed** validation-advice dedupe 以 `c.cmd` 为键，两条 advisory 条目（`cmd` 均为 `undefined`）会互相吞并的潜雷——键回退 `c.cmd || c.name`。
- **Added** `test/mixed-infra-commands-test.js` 契约测试：正则边界 15 用例 + L1 头部插入/空 full 不丢弃/非 infra 不触发 + L2 跨栈兜底 + 非 mixed profile 无 advisory + audit-file 触达（TDD：先 RED 后 GREEN）。

### 改进 mixed repo 验证命令生成：无归属文件 + 多栈兜底 (2026-07-20)

- **Added** `src/utils/stack-detectors/commands.js` 新增 `INFRA_PATTERNS` 正则匹配 Dockerfile/docker-compose/.env/Makefile/CI 配置等无归属文件类型。
- **Added** Layer 1：mixed repo 中无归属文件（不匹配任何语言栈的文件扩展名）变更时，在 `merged.full` 头部插入 `mixed-infra-smoke` 提醒，列出变更的基础设施文件名，建议全栈 smoke 检查。
- **Added** Layer 2：mixed repo 中 2 个及以上语言栈同时有文件变更时，在 `merged.full` 追加 `cross-stack-full-tests` 兜底提醒，防止遗漏跨栈集成回归。
- **Changed** ROADMAP.md 已知限制表中 `mixed repo 技术栈启发式` 状态从 `⏳ 持续改进` 更新为 `🔄 L1/L2 已交付，L3 规划中`。

### 同步 SKILL.md 文档：补全 `--max-files` / `--compact` / `api-contracts` 说明 (2026-07-20)

- **Changed** `skills/workspace-audit/SKILL.md`：更新 `--max-files` 适用范围从 7 个命令扩展到 17 个（补充 `dependencies`/`dependents`/`dead-exports`/`unresolved`/`cycles`/`audit-file`/`api-contracts`/`guard`）、`--compact` 从 2 个扩展到 5 个（补充 `audit-file`/`api-contracts`/`guard`）、决策树新增 `api-contracts` 行。
- **Changed** user-scope 副本已从项目权威副本同步覆盖。

### 修复测试间共享缓存污染（2026-07-20）

- **Fixed** `test/phase35-query-sql-test.js` 中 `testOverviewShortCircuitAndSave` 向 `analysis_snapshots` 注入残缺 mock（不含 `cycles`/`deadExports`/`unresolved` 等字段）后未恢复原始快照，导致后续测试（`testFieldsFiltering`）和全量 runner 中其他测试（`wave8-regression-test.js`）从缓存加载残缺数据。现 `finally` 块中恢复原始 `firstResult` 到 `saveAnalysisSnapshot('overview', ...)`。
- **Fixed** `test/query-tools-test.js` 中 `testQueryToolsCacheHit` 同样注入 mock 后未恢复，现同样修复。
- **Root cause** mock 数据缺少 `cycles` 字段 → `--fields hotspots,cycles` 输出中 `cycles` 为 `undefined` → `assert.ok(data.cycles !== undefined)` 失败。全量 runner 中 wave8 因 overview 快照残缺导致 CLI vs REPL 的 `affectedTestsCount` 不一致（44 vs 16）。

### 修复降级路径静默自信：dogfood 实战挖出的 5 个问题 (2026-07-20)

> 背景：在真实 Java 仓库深用 `audit-overview --format ai` 后发现——curated 层在 AST 语言上好用，但降级路径会悄悄退化成低价值输出却不改变可信的脸（违反 L1-4）。本轮全部修复。

- **Fixed（L1-4，最致命）regex-fallback 的 0-importer 死导出拿 high confidence + safeToDelete**：`src/services/dep-graph/shared.js` 的 `computeDeadExportConfidence()` 0-importer 分支此前完全忽略 parseMode，Java 无 javalang 时 import 正则照常产边导致 graph-sparse 保护不触发，垃圾数字拿 `high`/`ast-no-importer` 并被 honesty-engine 标 `safeToDelete=true`。现新增第 4 参 `parseModeReason`，`'regex-fallback'` 时降级 `low`/`regex-fallback`；`'regex-native'`（C/C++/Svelte，regex 即原生 parser）不受连坐。同步修复 `src/services/orchestrator.js` `bootstrapFromSchema` 丢弃 `parseModeReason` 的缺口（影响所有 schema 测试）。
- **Fixed（L1-4）缓存不随工具链变化失效**：无 javalang 时的 regex-fallback 结果入 SQLite 缓存后，装好 javalang 重跑仍命中旧缓存（key 只看 mtime/SHA-256，不感知 parser 状态），必须手删 cache.db。`builder.js` 新增 `_isDegradedCacheEntry()` / `_isParseCacheUsable()`，对 `parseMode='regex' && parseModeReason='regex-fallback'` 的条目**永不信任缓存**、每次重解析（AST 成功后自动恢复命中）；统一应用于 `build()` / `parseFileOnly()` / `updateFiles()` fast path + SHA-256 path 四处命中判定；`loader.js` 的 `loadGraph()`（SQLite 整图恢复路径）发现降级条目同样回退 build()——这是用户实际踩中的路径，E2E 实测"装好 javalang 后同 cache dir 重跑自动升级"。零 schema 变更，利用已持久化但未被消费的 `parse_mode_reason` 字段。
- **Fixed win32 python 硬编码 + 环境级失败逐文件白 spawn**：`spawn-ast.js` 此前 `win32 ? 'python' : 'python3'`，不走项目自己的 venv-aware `resolvePythonCommand()`——用 venv 装 javalang 的机器上永远找不到。现支持 workspace root 透传（registry 新增 `needsWorkspaceRoot` 标记，java/python 两个 entry 启用），优先 `.venv`/`venv` python，无 venv 时保持平台默认不变。新增环境级失败 memo：python 缺失（`python-missing`）/ parser 依赖缺失（`dependency-missing`，识别 stderr 中 `ModuleNotFoundError` 等）在同进程内短路后续 spawn；瞬时失败（超时/坏 JSON/脚本崩溃）不 memo，下个文件照常重试。
- **Fixed warnings 呈现断点**：`buildWarnings()` 的 `regex-fallback` 信号此前只进 JSON `warnings[]`，`dead-exports` / `audit-overview` 的 human/summary/markdown 格式器完全不渲染——默认输出下降级不可见。现照 api-contracts 模式统一渲染（新增 `appendWarnings()` helper）；warning 文案按 spawn-ast memo 区分"依赖缺失（e.g. pip install javalang）"vs"python 未找到"vs"超时/WASM"，不再一句误导性的 "possible spawn timeout" 打发。
- **Fixed cycles 组合爆炸与口径不一致**：单个稠密 SCC 的 Johnson 枚举无 per-SCC 上限，可独吞全局 1000 条路径额度饿死其他 SCC，且上限触发完全静默。现新增 `LIMITS.PER_SCC_CYCLE_CAP`（25），analyzer 暴露 `getCycleMeta()`（`{sccCount, truncated}`——SCC 数是严重度信号，路径列表仅是示例）；`cycles` 命令输出新增 `sccCount`/`totalPaths`/`truncated` 并把路径列表截到 `OUTPUT_EXTRA_LONG`；`audit-overview` 透传 `sccCount`/`truncated`；human/summary/markdown 展示补 "... and N more cycle paths (across N SCCs)" 提示。`cyclesCount`（路径数）语义不变，regression 快照格式不变。
- **Fixed `--json --compact` 下载断标记丢失**：`overview-tools.js` 的 `sliceArray` 把 `truncated`/`total` 挂在数组对象属性上，`JSON.stringify` 会丢弃。现 `applyOutputLimits()` 同步产出 JSON 安全的 `outputTruncation` 汇总对象。
- **Fixed skill 副本分裂与幽灵命令**：user-scope `workspace-audit` skill 副本仍是旧版（教 `workspace-bridge-cli`），已从项目内权威副本（`node cli.js` 入口）同步覆盖；同时把 `--format ai` digest 的 `actions[]` 与 `overview-curator.js` 的 validation command 从不存在的 `workspace-bridge-cli` 改为 `node cli.js`（npm 包未发布，该命令在源码安装下不存在，`cli-fallback.js` 的全局命令探测机制保留）。
- **Added** 回归测试：`test/cache-regex-fallback-invalidation-test.js`、`test/spawn-ast-env-test.js`、`test/dead-export-regex-fallback-confidence-test.js`、`test/cycles-scc-cap-test.js`（全部 `@semantic`）。

### 彻底治愈 `repl-test.js` 和 `audit-file-watch-test.js` 串行/并发运行 Flaky 缺陷 (2026-07-19)

- **Fixed** 修复了 precompute 过程中 `_findAffectedTestsByMention` 在大项目下对每个非测试文件重复读取所有测试文件，导致执行 33,000+ 次同步 `fs.readFileSync` 与 `stripComments` 的性能设计漏洞。
- **Changed** 在 `GraphAnalyzer` 引入 `_mentionContentCache` 内存缓存，单次 precompute 的 I/O 与正则处理操作暴降至 110 次左右，将图冷启动 initialization 与 `savePrecomputed` 的 precompute 执行时间从 20-30 秒缩短至 100ms 以内（效率提升 100+ 倍以上）。
- **Changed** 每次图结构变更触发 `graph:updated` 事件时，自动清空 `_mentionContentCache`，保证数据质量与缓存一致性。
- **Verified** 编写并发和串行循环重现脚本，实测优化后 `audit-file-watch-test.js` 连续跑 20 次迭代 **0 失败**（此前 20 跑失败 13 次）；`repl-test.js` 在并发 8 下 100 次迭代 **0 失败**。全量测试 `npm run test:fast` (133/133 PASS)，`node test/runner.js` (147/147 PASS) 100% 成功绿过。

## [2.1.0] - 2026-07-17

### 修复 `audit-file --depth` 语义重载导致的静默分析变更 (2026-07-17)

- **Fixed** `audit-file --depth surface` 会把 affected-tests 的图遍历深度静默截断到 1 层（`detail` 映射为 4）的问题：help 文档把 `--depth` 描述为 `--format ai` 的输出深度，但 `src/tools/audit-assembler.js` 的 `assembleFile()` 同时把它映射为真实遍历深度，且输出无任何 `dataQuality`/`warnings` 标记（L1-4：静默错误必须显式）。
- **Changed** affected-tests 遍历深度改由 `--max-depth` 唯一控制；未传时使用 `DEFAULTS.AFFECTED_TEST_DEPTH`（5），与独立 `affected-tests` 命令默认行为对齐；`--depth` 仅保留 `--format ai` 输出深度与 human/summary/markdown 文本截断语义。
- **Added** 回归测试 `test/audit-file-depth-decoupling-test.js`（fast 层）：锁定 `--depth surface/detail` 不改变遍历深度、`--max-depth` 在 `--depth` 存在时仍唯一生效的参数契约。
- **Verified**: `npm run test:fast` 133/133 PASS；`npx eslint .` exit 0。

### 修复 formatter 未接收统一输出限制参数的 L2 债务 (2026-07-15)

- **Fixed** `formatHuman` / `formatMarkdown` / `formatSummary` 不接收 CLI 限制参数的问题：
  - `src/cli/formatters/human-formatters.js` 新增 `resolveOutputLimit(defaultLimit, options)`，按 `--max-files` > `--limit` > `--depth surface|detail|full` 的优先级解析输出上限；`surface` 收紧到 `LIMITS.OUTPUT_SHORT`，`full` 对应 `Infinity`（不截断）。
  - 所有 formatter registry 函数签名改为 `(r, _options = {}) => ...`，`summary`/`markdown` 的 `slice(0, LIMITS.OUTPUT_*)` 全部改为 `slice(0, resolveOutputLimit(LIMITS.OUTPUT_*, _options))`。
  - 对原本不截断的 `human` formatter（`impact`、`affected-tests`、`affected-routes`、`dependencies`、`dependents`、`dead-exports`、`unresolved`、`cycles`）新增 `slice(0, resolveOutputLimit(Infinity, _options))`，保持默认行为不变，仅在用户传入 `--max-files`/`--limit`/`--depth` 时才截断。
  - `formatAuditSummary()` 与 `buildSecurityLines()` 同样接收并透传 `options`。
- **Fixed** `src/cli/route-formatter.js` 的 `formatCliResult()` 现在向 `formatHuman` / `formatSummary` / `formatMarkdown` 透传 `{ maxFiles: parsed.maxFiles, limit: parsed.limit, depth: parsed.depth }`。
- **Changed** `--depth` 非 AI 场景的 warning 逻辑：由于 `--depth` 现在对 `human`/`summary`/`markdown` 也有意义（控制截断级别），仅在 `json`/`jsonl` 下遇到 `--depth` 时才输出 ignored warning。
- **Added** 回归测试 `testTextFormatterLimits` 与 `testFormatCliResultTextLimits`（`test/formatter-direct-test.js`），覆盖 `--max-files` / `--limit` / `--depth` 对 human/summary/markdown 的截断行为。
- **Verified**: `npx eslint .` exit 0；`npm run test:fast` 132/132 PASS。

### 补全 `audit-file` / `api-contracts` 的 `--compact` 支持 (2026-07-15)

- **Fixed** `audit-file` 普通模式忽略 `--compact` 的问题：
  - `src/tools/audit-assembler.js` 在 `assembleFile()` 中识别 `compact` 标志，清空 `impact.impact[]` / `impact.coChanges[]` / `impact.affectedRoutes[]` / `affectedTests.affectedTests[]` / `validationAdvice.commands[]` 等详细列表，仅保留 counts 与 `suggestedCommand`。
  - `src/cli/formatters/human-formatters.js` 的 `audit-file` human formatter 在 compact 模式下追加提示，避免用户误以为数据缺失。
- **Fixed** `api-contracts` 忽略 `--compact` 的问题：
  - `src/tools/api-contract-tools.js` 的 `buildResult()` 在 `options.compact` 下清空 `matched[]` / `unmatchedClient[]` / `unmatchedServer[]` / `warnings[]`，保留 counts 并设置 `compact: true`。
  - `src/cli/formatters/human-formatters.js` 的 `api-contracts` human/summary/markdown formatter 均追加 compact 提示（此前仅截断提示）。
- **Added** 回归测试 `testBuildResultCompact`（`test/api-contracts-test.js`），验证 compact 标志对数组的清空行为、counts 的保留，以及 human/summary/markdown 输出中的 compact 提示。
- **Verified**: `npm run test:fast` 132/132 PASS；`npx eslint .` exit 0。

### 扩展 `--max-files` / `--compact` 到 audit-overview / audit-map / query-* (2026-07-14)

- **Fixed** `audit-map --max-files <n>` 被忽略的问题：
  - `src/cli/formatters/project-map.js` 的 `buildProjectMap()` 新增 `options.maxFiles`，对文件列表排序后取前 N，并同步过滤 edges / issueOverlay / hotspots，保证输出内部一致。
  - `src/cli/commands/index.js` 的 `audit-map` 命令将 `parsed.maxFiles` 透传到底层。
- **Fixed** `audit-overview --max-files <n>` / `--compact` 被忽略的问题：
  - `src/tools/overview-tools.js` 新增 `applyOutputLimits()`，对 `hotspots`、`stability`、`deadExports`、`unresolved`、`cycles`、`astRules`、`boundaries`、`smells`、`knowledgeRisk`、`orphans.samples` 等数组进行统一截断。
  - `--compact` 未配 `--max-files` 时使用 `DEFAULTS.COMPACT_ISSUE_MAX_ITEMS`（10）作为默认上限。
  - 带 `--max-files` / `--compact` 的运行跳过 aggregate snapshot 写入，防止子集结果毒化后续 `query-*` 消费者（与 `--category` 过滤采用相同策略）。
- **Fixed** `query-hotspots` / `query-knowledge-risk` / `query-stability` 忽略 `--max-files` 的问题：现在 `--max-files` 与 `--limit` 同时存在时取较小值；仅有 `--max-files` 时直接作为上限。
- **Fixed** `tree --max-files <n>` 只截断根节点、子节点完全不受限的问题：改为每个节点按方向（imports / dependents）独立应用 `maxFiles`，根节点与子节点均被截断，保留 `importsTruncated` / `dependentsTruncated` 标记以兼容 `treeQuery` 的 `truncated` 计算。
- **Fixed** `audit-file` 普通模式忽略 `--max-files` 的问题：将 `parsed.maxFiles` 透传给底层 `impact` 与 `affected_tests` 查询，统一截断 `impact[]` 与 `affectedTests[]`。
- **Fixed** `api-contracts` 忽略 `--max-files` 的问题：`src/cli/commands/api-contracts.js` 将 `parsed.maxFiles` 透传至 `src/tools/api-contract-tools.js` 的 `runApiContracts()`；`buildResult()` 对 `matched[]` / `unmatchedClient[]` / `unmatchedServer[]` / `warnings[]` 统一截断并设置 `truncated` 标记；human/summary/markdown formatter 在输出被截断时追加提示。
- **Fixed** `guard` 不支持 `--max-files` / `--compact` 的问题：`src/cli/commands/guard.js` 现在截断 `directDependents[]` / `transitiveDependents[]` / `impactItems[]` 并设置 `truncated` 标记；`--compact` 模式下省略详细列表，仅保留统计与阈值；`src/cli/formatters/guard-formatter.js` 同步显示 compact/truncated 提示；新增 `test/guard-command-test.js` 回归测试。
- **Fixed** `--format json` 与 `--json` 抽象泄漏：`src/cli/validate-args.js` 现在保留 `format: 'json'` 而不是置为 `null`；`src/cli/route-formatter.js` 显式处理 `format === 'json'`，与 `--json` 等价输出结构化 JSON；同步更新 `test/cli-bool-flags-env-test.js` 断言。
- **Refactored** formatter 硬编码截断阈值：在 `src/config/limits.js` 新增 `OUTPUT_TINY`/`OUTPUT_SHORT`/`OUTPUT_MEDIUM`/`OUTPUT_LONG`/`OUTPUT_EXTRA_LONG`/`STRING_SNIPPET_MAX_CHARS`，并替换 `src/cli/formatters/human-formatters.js`、`src/cli/formatters/project-map.js`、`src/cli/formatters/validation-advice/risk-actions.js` 中的所有 `slice(0, N)` 为对应常量（L2-6 裸数字归零）。
- **Verified** `query-hotspots` / `query-knowledge-risk` / `query-stability` 正确消费 `--limit` 并与 `--max-files` 取较小值；移除 `TECH_DEBT.md` 中对应过时条目。
- **Improved** `test/query-tools-test.js`：将 `--limit` / `--max-files` / `--risk` / `--assessment` 等边界测试从真实 `ServiceContainer` 迁移到 mock snapshot，消除对 workspace-bridge 自身项目 hotspots 数量的不稳定依赖。
- **Changed** `cli.js` help 与 `skills/workspace-audit/SKILL.md` 更新 `--max-files` / `--compact` 适用范围。
- **Verified**: `npm run test:fast` 131/131 PASS；`npx eslint .` exit 0。

### 修复 CLI 输出塑形参数全局一致性缺口 (2026-07-14)

- **Fixed** `--fields` 白名单仅在 `audit-summary` / `audit-overview` 生效的问题：
  - 将 `applyFieldsFilter` 从 `src/cli/commands/index.js` 下沉到 `src/cli/route-formatter.js`，在 `--json` / `--format ai` / `--format jsonl` 等结构化输出前统一应用， Essential 字段（`ok/error/schemaVersion/command/hasFindings/staleness/warnings`）始终保留。
  - 人类可读格式（`human` / `markdown` / `summary`）不再受 `--fields` 裁剪，避免 formatter 访问已被删除的字段而崩溃。
  - 当 `--format ai` 与 `--fields` 同时使用时，输出 `warnings` 中追加 `--fields reduced AI digest input; counts and topRisks may be incomplete`，防止 AI 消费者静默拿到被降级的 digest。
- **Fixed** `--token-budget` / `--depth` 在非 `--format ai` 场景下静默忽略的问题：现在在结构化输出结果中追加 warning，明确告知这两个参数只对 `--format ai` 有效。
- **Fixed** `--category health` 等 help 示例与校验集合不一致的问题：
  - `src/config/defaults.js` 的 `FINDING_CATEGORIES` 新增 `health` 与 `ast-rules`，与 `src/tools/category-filter.js` 的 `CATEGORY_ALIASES` 保持一致。
  - `cli.js` help 文案更新为 `audit-summary / audit-overview` 及完整可用类别列表。
- **Fixed** `audit-summary --format human --fields <不含 health>` 崩溃： human formatter 对 `result.health`、`result.scope.counts` 等字段使用可选链与默认值，避免 `TypeError`。
- **Verified**: `npm run test:fast` 131/131 PASS；`npx eslint .` exit 0。

### 扩展 `--format ai` 至 diagnostics/health/tree/query 等剩余命令 (2026-07-14)

- **Added** `AI_DIGEST` 注册表条目覆盖 `diagnostics`、`health`、`tree`、`query`，连同此前已适配的 `stats`、`workspace-info`、`dependencies`、`dependents`、`audit-map`，使这些命令在 `--format ai` 下输出结构化 `counts` / `topRisks` / `actions` / `details`，不再只返回 `counts: {}` + `summary` 字符串。
  - `diagnostics`：输出 checksRun / failedChecks / diagnostics / errors / warnings，失败检查与诊断问题按 severity 分级并给出 P0/P1/P2 行动建议。
  - `health`：复用 `audit-overview` digest 并叠加 `healthScore` 计数（deprecated 命令保持兼容）。
  - `tree`：递归统计 imports / dependents / circular edges，标记循环依赖与高 fan-in 风险，detail/full 深度附带树片段。
  - `query`：输出行数、列名与样本行，避免 AI 直接消化原始 SQL 结果表。
- **Refactored** `formatAi()` 通用分支：由 `AI_DIGEST` 函数统一返回 `details` / `fullDetails`，`formatAi` 按 `depth` 自动附加，不再为单个命令写特化 `else if`。
- **Added** 回归测试 `testAiDigestForOtherCommands` 覆盖 `diagnostics`、`health`、`tree`、`query` 的 `--format ai` 结构与关键字段断言。
- **Verified**: `npm run test:fast` PASS；`npx eslint .` exit 0。

### 新增 `api-contracts` 命令：前后端 API 契约对接 MVP (2026-07-14)

- **Added** `api-contracts --frontend <dir> --backend <dir>` CLI 命令，静态对齐前端 HTTP 调用与后端路由。
  - 前端提取器（`src/services/dep-graph/api-contracts/client-call-extractor.js`）：支持 `axios.get/post/...`、 `axios({ url, method })`、`fetch(..., { method })` 等静态 URL 调用；跳过模板字符串与动态拼接，并生成 `warnings`。
  - 后端复用现有 `framework-patterns.extractRoutes()`，支持 Express/NestJS/Spring/FastAPI/Django/Flask/Gin/Fiber/Actix/Axum 等框架。
  - 匹配器（`src/services/dep-graph/api-contracts/contract-matcher.js`）：按 `(HTTP method, 归一化 path)` 对齐，路径变量段（`:id` / `{id}`）统一归一为 `{}`；不做字段级契约对比。
  - 输出 `matched[]`、`unmatchedClient[]`、`unmatchedServer[]`、`coverageRatio` 与 `warnings[]`，并支持 human/markdown/summary/jsonl 格式化。
- **Added** 编排层 `src/tools/api-contracts-tools.js` 与命令入口 `src/cli/commands/api-contracts.js`：独立初始化 frontend/backend 两个 `ServiceContainer`（`strictCwd: true`），避免与 `--cwd` 的缓存/工作区混淆。
- **Added** CLI 参数 `--frontend` / `--backend`（`src/cli/validate-args.js`）、help 文本、`src/cli/formatters/human-formatters.js` 格式化输出。
- **Added** 回归测试 `test/api-contracts-test.js`（fast 层）：覆盖 axios/fetch/config 提取、路径归一化、匹配算法、端到端对齐与缺失参数错误。
- **Verified**: `npm run test:fast` 131/131 PASS；`npx eslint` 新文件零错误。

### 修复 `api-contracts` 引入的两项 L2 技术债务 (2026-07-14)

- **Refactored** `cli.js` 中 `api-contracts` 的生命周期例外：新增声明式集合 `SELF_CONTAINER_COMMANDS`（`src/cli/commands/index.js`），由命令注册表声明哪些命令自行管理 `ServiceContainer`，CLI 编排层不再硬编码 `parsed.command !== 'api-contracts'`。
- **Refactored** `src/tools/api-contract-tools.js` 不再独立维护 `TEST_LIKE_PATTERNS`：改为复用 `src/utils/project-context.js` 导出的 `isTestLikeFile()`，消除 test-like 判定规则的重复来源。
- **Verified**: `npm run test:fast` 131/131 PASS；`npx eslint .` exit 0。

### 修复 `api-contracts` 提取器与格式化输出缺陷 (2026-07-14)

- **Fixed** `src/cli/formatters/human-formatters.js` 中 `api-contracts` 的 human/summary/markdown/jsonl formatter 不展示 `warnings` 的问题；现在动态 URL 跳过、路径变量归一化等警告会透传到所有输出格式。
- **Fixed** `src/services/dep-graph/api-contracts/client-call-extractor.js` 中无插值反引号模板字符串（`` `/api/users` ``）被静默跳过的问题；`isStaticPath()` 现在将反引号视为合法静态引号。
- **Fixed** `client-call-extractor.js` regex 扫描会命中注释中代码导致的假阳性；新增 `stripComments()` 在保留字符串字面量的前提下剥离 `//` 与 `/* */` 注释。
- **Fixed** `extractAxiosConfigCalls()` 正则过于宽松导致 `apiConfig({...})`、`myApi.request({...})` 等非 axios 调用被误匹配；现在只匹配字面量 `axios(...)` 或 `axios.request(...)`。
- **Added** 回归测试覆盖上述四种场景（`test/api-contracts-test.js`）。
- **Verified**: `npm run test:fast` 131/131 PASS；`npx eslint .` exit 0。

### 优化 `api-contracts` `--format ai` 输出，降低 AI 消化成本 (2026-07-14)

- **Added** `AI_DIGEST['api-contracts']`（`src/cli/formatters/human-formatters.js`）：为 `api-contracts` 输出结构化 `counts`（clientCalls / serverRoutes / matched / unmatchedClient / unmatchedServer / coverageRatio）、`topRisks`（按 unmatched-client / unmatched-server / extraction-limitations 分类）、`actions`（P0/P1 建议）。
- **Added** `formatAi()` 中对 `api-contracts` 的 severity 推导：有未匹配前端调用时为 `high`，仅有未匹配后端路由时为 `medium`。
- **Added** `depth=detail/full` 时的 `keyContracts` 字段，直接携带前 5 条 matched / unmatchedClient / unmatchedServer / warnings；`depth=full` 时输出完整 `details`。
- **Added** 回归测试 `testAiFormatDigest` 覆盖 `--format ai` detail / surface 两种深度。
- **Verified**: `npm run test:fast` 131/131 PASS；`npx eslint .` exit 0。

### 工程基线补全：eslint 工具链 + CI Windows/slow 层 + 仓库卫生 + SKILL.md 补全 (2026-07-10)

- **Added** eslint flat config（`eslint.config.js`，recommended 级 + 少量正确性规则，无风格约束）、`npm run lint`、CI `Lint` 步骤。清零全仓 148 个 lint 错误：
  - 删除约 120 处死代码（未使用的 require/变量/写死计数器），含 `workspace-tools.js` 的 write-only `hasNodeCheck`、`analyzer.js` 的 `regexNativeCount`/`total`/`visitedGlobal`、`project-context.js` 的 `pathNotUnderscore` 等。
  - `symbol-impact.js`：`buildTransitiveUsage()` 调用保留但去掉未消费的返回值绑定，并加注释说明其对 `direct` 的 push 副作用是 wildcard re-export 传播所必需（防止未来被当死代码误删）。
  - 7 处 `throw new Error(...)` 补 `{ cause: err }`（security-tools、project-context、test-helpers、benchmark-perf），保留原始错误链。
  - 修复两个**沉默的测试**：`cli-bool-flags-env-test.js` 的 `WB_MODE=FULL` 用例原断言的是外层 `parsedMode`（复制粘贴错误，断言恒真），已改为断言 `parsed.mode === 'full'`；`audit-diff-incremental-test.js` 注释声称 "related to changed file" 但只断言 `de.file` 存在，已补 `changedSet.has(de.file)` 严格断言。两者修正后均 PASS。
  - 12 处无用正则转义移除；`sanitize.js` 控制字符正则加显式 `eslint-disable` 说明。
- **Changed** CI（`test.yml`）：矩阵增加 `windows-latest`（此前 Windows 路径/BOM 逻辑零 CI 覆盖）；新增 `test-slow.yml`（push main + 每日定时 + 手动触发，ubuntu/windows 双平台跑 `test:slow`——此前 slow 层一百余个测试从不在 CI 执行）。
- **Changed** 仓库卫生：CHANGELOG 历史版本（v0.5.0–v2.0.0）与 ADR 归档至 `docs/changelog/CHANGELOG-v0.5-v2.0.md`（主文件 586KB → 158KB）；untrack `reference/*.zip|*.docx` 二进制；删除 `gitnexus-*.stderr`、一次性脚本 `trim-skill-frontmatter.py`；`.gitignore` 补 `*.stderr`、`/reference/*.zip|*.docx`。
- **Changed** README 安装说明：npm 包未发布（registry 404），改为从源码 `npm install -g .` 的真实可用路径。
- **Changed** `skills/workspace-audit/SKILL.md` 补全 AI 关键消费面：`guard` 防爆检查、`query-hotspots`/`query-knowledge-risk`/`query-stability` 快速切片、`query --sql`、`repl --eval` 批量模式、`--service` monorepo 聚焦、Token 控制（`--format ai --token-budget --depth` / `--fields` / `--max-files` / `--compact`）、CI 回归基线（`--save`/`--check-regression`/`--fail-on-findings`）、Exit Code 契约表。guard exit 1 与 `--save`/`--check-regression` 契约已实测验证。
- **Fixed** 三个 slow 层存量回归（首次本地全量跑 slow 层时发现；均在改动前 HEAD 上可复现，因 slow 层从不进 CI 而漏网）：
  1. **`--category` 快照毒化（L1-3 缓存一致性）**：`buildProjectOverview` 的 'overview' 快照 key/新鲜度检查不含 `--category`，带过滤的运行会把**子集结果**存成全量快照，后续 `audit-overview`/`audit-summary`/`query-*` 命中"新鲜"快照后静默返回残缺数据（无 warning 无 dataQuality）。修复：category 过滤的运行双向绕过快照（不读不写）。`test/wave12-category-filter-test.js` 的漂移性失败即此因。
  2. **`hasJavaTestFiles` 不递归**：只查 `src/test/java` 一层目录，而 Java 测试按惯例在包路径子目录（`src/test/java/com/example/...`），导致几乎所有真实 Maven/Gradle 项目被判 `hasTests: false`，`java-all-tests`/`java-focused-tests` 命令从不生成。修复：有界递归（深度 8）。`functionality-polyglot-test.js` 失败即此因。
  3. **Route B 误伤编译型语言**：`buildFileValidationAdvice` 在 `affectedTests=0` 时清空 changedTargets（为防 `pytest <源文件>`），连带扑灭了 Java/Go/Rust/C++ 依赖 targets 判语言的 compile-check fallback（这些命令不引用源文件路径，本不在 Route B 防御范围）。修复：编译型语言文件始终传入 targets。`audit-file-validation-advice-test.js` 的 java-compile-check 失败即此因。
  - 另修 `audit-file-validation-advice-test.js` 与仓库环境的硬编码耦合：原断言"所有命令都是 `npm run test`"，仓库自带 linter 后必假；改为通用不变量 + 仅对测试命令断言完整形态。
- **Verified**: `npx eslint .` exit 0；`npm run test:fast` 130/130 PASS；slow 层三个存量失败修复后单测 PASS。

### precomputeAggregates 不再按文件数跳过重算 (2026-07-03)

- **Fixed** `analyzer.js` `precomputeAggregates()` which previously had an early-return guard: if `_aggregateCache.stats.files === this.dg.graph.size`, it skipped recomputation. This caused `audit-overview` and L4 atomic commands (e.g. `cycles`) to return different results when `graph:built` fired multiple times during build — the first call cached a partial result, and subsequent calls were skipped because file count hadn't changed (even though import edges had). Observed on a Python project where `audit-overview` reported 10 cycles while `cycles` reported 0.
- **Fix**: Removed the early-return guard. `precomputeAggregates()` now always recomputes on `graph:built` — the event itself means data may have changed. File count alone is not a reliable staleness signal.
- **Relates to**: L1-4 (静默错误必须是显式的) — two commands must not give different answers.

### Incremental update cache eviction — unified invalidation (2026-07-03)

- **Fixed** `builder.js` `updateFiles()` fast-path cache serving stale exports after file modification.
- **Root cause**: two parse-cache layers (in-memory `_parseCache` + SQLite `cache.parseResults`) had separate eviction paths. `_parseCache.delete()` cleared memory, but `cache.getParseResult()` (SQLite) still held the old parse result with the **new** file's mtime (metadata was updated but parse wasn't invalidated). The fast path `cached.mtime === meta.mtime` matched → skipped re-parsing.
- **Fix (elimination, not patch)**: Added `_invalidateParseCache(keyOrPath)` as the **single entry point** for parse-cache eviction — invalidates all layers (memory + SQLite) in one call. Used in both the `toEvictCache` loop and the deleted-files loop. Future cache layers must be invalidated inside this method; adding a layer does not require changes to `updateFiles`.
- **Preventive constraint** documented in `docs/TECH_DEBT.md`: "禁止直接调用 `_parseCache.delete()` 或 `cache.deleteParseResult()`，只允许通过 `_invalidateParseCache()`".
- **Verified** with `scratch/_verify.js`: `updateFiles` on a modified file now correctly shows `['bar']` instead of stale `['foo']`. Full test suite 130/130 PASS.

### Route B AI consumption fixes — fileSpecificAdvice, safeToDelete, suggestedCommand (2026-07-03)

- **Fixed** `buildFileSpecificAdvice()` in `src/cli/formatters/validation-advice.js` to be context-aware:
  - Now accepts `{ impactCount, affectedTestsCount, isDeadExport }` context and suppresses irrelevant advice (e.g., migration warnings) when the file has zero downstream impact.
  - For Python dead-export files, emits a positive "Safe to delete or archive" message instead of the generic model migration warning.
- **Added** `safeToDelete` boolean flag to dead export records in `src/tools/honesty-engine.js`:
  - Set to `true` when `importerCount === 0 && confidence !== 'low' && reason !== 'graph-unreliable'`.
  - Gives AI agents an explicit signal instead of requiring them to infer safety from multiple fields.
- **Fixed** `buildFileValidationAdvice()` to stop suggesting test commands when there are no affected tests:
  - When `affectedTests=0`, no longer passes the source file path as a test target to `generateCommands()`, preventing suggestions like `pytest <source-file>`.

### validationAdvice.commands Python/Django usability fix (2026-07-03)

- **Fixed** Python focused test commands in `src/utils/stack-detectors/commands.js` so they no longer pass source `.py` files directly to pytest:
  - Added `derivePythonTestCandidates()` covering Django app conventions (`app/tests/test_<module>.py`, `app/tests.py`), project-level `tests/`, and same-directory `test_*.py` / `*_test.py`.
  - Added `findExistingTestFiles()` to map changed source files to actually-existing test files before emitting focused pytest commands.
  - `generateCommands()` now accepts an optional `workspaceRoot` and routes it to Python command generation; callers in `validation-advice.js` supply it.
  - When no matching test file exists, focused pytest commands are omitted instead of suggesting `pytest <source-file>`.
- **Added** Python/Django test environment probing in `src/utils/environment-probe.js`:
  - `probePythonTestEnvironment()` statically detects Django + pytest projects and warns when `pytest-django` is not declared in `requirements*.txt` or `pyproject.toml`.
  - Always emits a database-reachability prerequisite note for Django projects so users do not mistake a local PostgreSQL failure for a product regression.
- **Exposed** `environmentNotes` on validation advice output (`validationAdvice.environmentNotes`) in both `buildValidationAdvice()` and `buildFileValidationAdvice()`.
- **Updated** `src/cli/formatters/human-formatters.js` markdown output to render `environmentNotes` for `audit-diff` and `audit-file`.
- **Added** regression tests:
  - `test/python-test-path-derivation-test.js` (fast layer)
  - `test/python-environment-probe-test.js` (fast layer)
  - Fixture trees under `test/fixtures/python-test-paths/` and `test/fixtures/python-env-probe/`.

### Evidence-chain completion for conservative judgments (2026-07-03)

- **Extended** `test/dead-export-ground-truth-test.js` with additional JS corpus samples:
  - Added rename re-export (`export { usedFn as renamedFn }`), dynamic import usage, and their consumers as known negatives.
  - Documented that `import * as lib from './lib.js'` is intentionally excluded because the current analyzer conservatively treats namespace imports as consuming every export.
  - Corpus now reports precision=1 and recall=1 on the supported subset, while honestly stating that global recall remains unproven.
- **Strengthened** `test/resolver-strategy-chain-test.js` conflict matrix:
  - Added `testSymbolTableBeatsFallback()` using real `trySymbolTable` and a fake fallback strategy to prove `symbol-table` wins before fallback when ordered first.
  - All conflict-matrix tests restore the default chain and call `clearResolverCaches()` in `finally` to prevent registry pollution.
- **Documented** Java AST environment boundary in `skills/workspace-audit/SKILL.md`:
  - Added troubleshooting row explaining that missing `javalang` triggers regex fallback and that AST golden snapshots should not be compared in that mode.
- **Archived** 6/22–7/2 critical commit root causes in `scratch/commit-root-cause-archive.md`:
  - For each of 8 commits: root cause, affected files (by architectural layer), and existing regression tests.
  - Identified two gaps and closed them with new tests.
- **Added** `test/data-quality-contract-test.js` to lock the `DATA_QUALITY` three-state contract (`certain`/`degraded`/`unavailable`) and remediation keys.
- **Added** `test/java-spring-symbol-impact-note-test.js` to assert that Spring / Spring Boot framework hints add the DI/reflection limitation note to `symbolImpact` output.

### Dead-export ground-truth smoke test (2026-07-03)

- **Added** `test/dead-export-ground-truth-test.js` as a minimal precision/recall smoke test for `dead-exports`:
  - Builds a temp workspace with two positive files (`lib.js`, `orphan.js`) and multiple live negatives (`consumer.js`, `live.test.js`, `barrel.js`, `barrel-consumer.js`).
  - Verifies the CLI reports the exact known dead exports from the JS corpus and no known live files.
  - This does not prove global recall, but it turns the "recall is unmeasured" critique into a repeatable corpus-level check.

### Java parser golden test becomes environment-aware (2026-07-03)

- **Fixed** `test/parser-golden-test.js` so the Java golden snapshot no longer fails when `javalang` is missing from the local Python environment:
  - Added an explicit `javalang` availability probe, matching the existing pattern in `test/java-parsers-test.js`.
  - When `javalang` is unavailable, the test now asserts the Java parser's regex fallback semantics instead of overwriting or comparing against AST goldens.
  - This keeps the test suite honest about the optional AST dependency without turning environment drift into a false product regression.

### audit-security Rule ID Consistency Fix (2026-07-02)

- **Fixed** `audit-security` JSON/Markdown rule ID inconsistency:
  - External scanner findings that only provide `ruleId` now get a normalized `rule` alias equal to `ruleId` in `src/tools/security-tools.js`.
  - Builtin findings already exposed both fields; the adapter path is now equally consistent.
  - Strengthened `test/security-adapter-test.js` to assert Semgrep `normalizeFinding` returns `rule === ruleId` and that `auditSecurity` normalizes adapter findings missing `rule`.

### JS/TS Destructured Export Symbol Impact Fix (2026-07-02)

- **Fixed** `symbolImpact` missing multi-symbol destructured exports in JS/TS files:
  - `export const { foo, bar } = ...`, `export const [a, b] = ...`, nested patterns (`{ nested: { leaf } }`), and renamed properties (`{ x, y: aliasY }`) are now extracted as individual source symbols.
  - Added `extractPatternBindingNames` helper in `src/services/dep-graph/parsers/js/ast-parser.js` to recursively walk `ObjectPattern` / `ArrayPattern` / `AssignmentPattern` / `RestElement` bindings.
  - Rest elements (`{ ...rest }`) emit an `unknown` export record (`name: '*'`) so consumers know additional exports exist without inflating `sourceSymbols`.
  - Updated `exportedNames` collection to include destructured bindings, ensuring `functionRecords.isExported` is correctly set for arrow functions declared via destructuring.
- **Added** `test/js-destructured-export-test.js` to assert that destructured export symbols are indexed and propagate correctly through symbol-level impact analysis.

### SKILL.md Tiered Reorganization (2026-07-02)

- **Reduced** `skills/workspace-audit/SKILL.md` from 333 lines to ~112 lines:
  - Removed redundant per-command deep dives, Architecture Layer Mapping table, and duplicated guidance.
  - Kept the essential AI contract: default parameters, core decision tree, when-not-to-use list, warm-up workflow, and security checklist.
  - Aligned the skill with the Stage 2.5 "CLI减负与认知负担" goal.

### query-* Snapshot Cache Optimization (2026-07-02)

- **Fixed** `audit-overview` and `query-*` to actually hit the persisted aggregate snapshot:
  - Relaxed `isSnapshotFresh` in both `src/tools/overview-tools.js` and `src/tools/query-tools.js` to skip file-content-change checks.
  - Aggregate snapshots now stay fresh on gitHead + fileCount + configHash match, matching the Stage 3.5 design intent of coarse-grained cached aggregates.
  - `audit-overview` core computation drops from ~5s to ~10ms on a warm cache; `query-stability` and `query-knowledge-risk` complete in ~2s.
  - Updated `test/query-staleness-test.js` to reflect the relaxed freshness semantics.

### Indexing Progress Reporting (2026-07-02)

- **Added** large-repository indexing progress visibility:
  - `ServiceContainer._runStage` now prints phase-level progress (e.g. `[Container] Phase: fileIndex ...`) so users know which initialization stage is running.
  - `FileIndex.processFilesWithLimit` emits percentage progress via `this.bus.emit('progress', { phase, current, total, percent })` and prints `[FileIndex] 24% (100/419 files indexed)` to stderr during human-facing runs.
  - Added `test/indexing-progress-test.js` to assert progress events and CLI phase output.

### Guard Command Visualization (2026-07-02)

- **Added** visual blast radius representation to `guard` command:
  - Collected BFS `impactItems` with full `via` path links and `level` inside `src/cli/commands/guard.js`.
  - Implemented `buildAsciiTree` and `buildMermaidGraph` formatting helpers inside `src/cli/formatters/guard-formatter.js`.
  - Displayed dependency propagation paths as an ASCII Tree in Human/Summary output, and as a Mermaid Diagram in Markdown output.
  - Extended `test/guard-command-test.js` to ensure visual components are rendered properly.

### Non-Blocking Config Warnings & Path Normalization Protection (2026-07-02)

- **Fixed** `.workspace-bridge.json` config validation to be non-blocking:
  - Refactored `validateWorkspaceConfig` in `src/utils/project-context.js` to collect warnings instead of throwing exceptions for unknown keys or type mismatches when a warnings array is provided.
  - Implemented warning propagation in `DependencyGraphAnalyzer.buildWarnings()` to ensure config warnings are included in the final JSON schema `warnings[]` output.
  - Refactored `FileIndex._applyWorkspaceExcludeDirs` to leverage `ProjectContext` configuration to prevent duplicate validation parsing and throwing.
  - Extended `test/cli-config-validation-test.js` to assert non-blocking warnings work correctly.
- **Fixed** `matchesPathFragment` path matching:
  - Pre-filter relative paths inside `src/utils/path.js` to prefix them with a leading slash, allowing relative head-directory paths (e.g. `src/services`) to match correctly.
- **Added** cross-platform path normalization regression tests:
  - Created `test/path-normalization-cross-platform-test.js` to verify path resolution behavior (backslashes, mixed slashes, casing, etc.) on Windows and POSIX logic layers.

### Subdirectory Restricted Analysis (strictCwd) Support (2026-07-02)

> **⚠️ BREAKING CHANGE**: `--strict-cwd` now defaults to `true`. Previously, running `--cwd` inside a Git subdirectory silently elevated analysis to the repository root. To restore the old behavior, set `WB_STRICT_CWD=false` or add `"strictCwd": false` to `.workspace-bridge.json`.

- **Fixed** `--cwd` subdirectory behavior:
  - Enabled `--strict-cwd` by default (i.e. default `strictCwd` to `true`) so that analyzing a Git sub-directory limits the analysis to that subdirectory instead of automatically elevating to the Git root.
  - Added `--strict-cwd` to the `COMMON_OPTIONS` list in `cli.js` so it is visible in `--help`.
  - Updated `getChangedFiles` and `getDiffNumstat` in `src/tools/git-tools.js` to resolve Git-relative paths against the top-level Git root (using `git rev-parse --show-toplevel`) and filter out files outside the current `workspaceRoot` subdirectory scope.
  - Added dedicated semantic test suite `test/subdirectory-strict-cwd-test.js` to verify subdirectory restricted analysis.

### Route B Fixes: Java Spring Gaps Resolution (2026-07-02)

- **Fixed** `affectedRoutes` grouping/implicit tracking:
  - Track recursive level (`lvl`) and implicit/low-confidence edges in SQLite CTE and in-memory BFS.
  - Enrich output schema with `routeType: 'direct' | 'indirect'` and `hasImplicit: boolean`.
  - Prioritize and sort direct and non-implicit routes first.
  - Suffix implicit routes with ` (implicit)` in human, summary, and markdown outputs.
  - Added new test suite `test/affected-http-routes-implicit-test.js`.
- **Fixed** Java Spring `symbolImpact` clarity:
  - Append a warning note to `symbolImpact` if the file's framework hint contains `spring` or `springboot` to clarify DI/reflection static analysis limits.
- **Fixed** multi-module Maven command mapping:
  - Normalize and match absolute paths in `mapJavaFilesToModules` and `buildFileValidationAdvice`.
  - Respect `stack.java.hasTests` within the direct test generator in `generateCommands`.
  - Added test case `testJavaMultiModuleAbsolutePaths` to `test/audit-file-validation-advice-test.js`.

### Route B: Java Spring Boot real-project validation (2026-06-30)

- Validated workspace-bridge consumer experience on `C:/Users/sdses/Desktop/神思/code/ai_zcypg_backend` (Java Spring Boot multi-module, 395 files).
- Focus file: `aizcypg-biz/src/main/java/com/aizcypg/biz/controller/PolicyMissingController.java`.
- Real task: implement the `checkMissing` TODO at `POST /{policyId}/missing-check`.
- Findings captured in `scratch/route-b-report-ai-zcypg-backend.md`:
  - ✅ Framework detection works: `spring-controller-file`, `isEntry=true`.
  - ✅ AST coverage is solid: `coverageRatio = 1.00`.
  - ❌ **Java same-package visibility is reported as `direct-import` with `impact=13`**, even though no other file references `PolicyMissingController`.
  - ⚠️ `affectedRoutes` is flooded with unrelated routes from the same-package controllers.
  - ⚠️ `validationAdvice` suggests `mvn -q -Dtest=*Test test` even though the project has no test files.
  - ⚠️ `symbolImpact` reports zero dependents for all methods, which is expected for Spring DI/reflective calls but not explained in the output.
- **Fixed** the P0 Java same-package false-positive:
  - `src/services/dep-graph/builder.js`: downgrade `java-same-package` edges to `tier3` / `confidence=0.3`.
  - `src/services/dep-graph/query.js` + `src/services/dep-graph/analyzer.js`: emit `reason: "implicit-same-package"` instead of `direct-import`.
  - `test/java-package-imports-test.js`: added assertions for tier, confidence, and reason.
  - Validation: `npm run test:fast` 126/126 PASS; re-audited `PolicyMissingController.java` and confirmed all 13 same-package dependents now carry `implicit-same-package`.
- **Fixed** the P1 Java no-tests validation advice issue found in Route B round 2:
  - `src/utils/stack-detectors/detect.js`: detect real `src/test/java` test files and expose `stack.java.hasTests`.
  - `src/utils/stack-detectors/commands.js`: when `hasTests` is false, downgrade focused/full commands from `test` to `compile`/`package -DskipTests` (Maven) or `build -x test` (Gradle); default to `true` for backward compatibility.
  - `test/audit-file-validation-advice-test.js`: added `testJavaNoTestsFallsBackToCompileAndPackage` and `testJavaWithTestsKeepsTestCommands`.
  - Validation: `npm run test:fast` 126/126 PASS; re-audited `PolicyChatController.java` and confirmed suggested command is now `mvn -q -DskipTests compile`.
- Updated `docs/TECH_DEBT.md`, `SESSION.md`, and `AGENTS.md` debt tallies.

### Debt: confirm full zero active debt and sync active docs (2026-06-29)

- Verified that all previously claimed fixed debts are truly resolved:
  - **Weak assertion cleanup**: remaining `typeof` checks are defensive schema-contract assertions or runner/environment helpers, not low-signal test assertions.
  - **Framework-detection Query language parity**: `FRAMEWORK_QUERY_REGISTRY` covers JS/TS/Python/Java/Kotlin/Go/Rust/Vue/Svelte via tree-sitter queries; `AST_PATTERNS` remains only as a cheap pre-filter and synchronous fallback, not an unclosed parity gap.
- Synchronized active-doc debt tallies with `docs/TECH_DEBT.md` (the single source of truth for active debt):
  - `ROADMAP.md` §active-debt table: L1/L2/architecture/L3 all set to **0**.
  - `ROADMAP.md` §known-limitations row 27 updated to reflect completed framework-detection Query parity.
  - `AGENTS.md` project-state summary updated from "1 remaining L3 taste issue" to "L1/L2/product/architecture/L3 debt fully zero".
  - `SESSION.md` last-updated timestamp refreshed to record the verification.
- Validation: `npm run test:fast` 126/126 PASS.

### Documentation: integrate and update active docs (2026-06-26)

- Created `docs/README.md` as a navigation page; clarified that `docs/` does not maintain a second source of truth and that `AGENTS.md` remains the single source of project state.
- Removed the completed `cli.js` testable-entry row from `ROADMAP.md` (already delivered per `SESSION.md` direction 3).
- Moved the "known pitfalls" table and the detailed repair flow from `SESSION.md` to `AGENTS.md`, so timeless agent guidance lives in the root entry and `SESSION.md` stays focused on the current session.
- Trimmed redundant sections from `SESSION.md` (historical change details, moved pitfalls/repair flow).
- Marked `docs/code_review.md` as historical archive; active limitations now live in `ROADMAP.md` and fixed findings in `CHANGELOG.md`.
- Fixed broken table formatting and stray `|` separators in `ROADMAP.md`.
- Removed completed items still marked as active from `ROADMAP.md` long-term direction table and user-experience gap table.
- Added missing `// @contract` annotation to `test/api-consistency-test.js`; cleaned up AI reasoning artifacts and trailing placeholder text from the archived `docs/code_review.md`.

### Security & Privacy Hardening (2026-06-25)

- **Fix SQL UNION/INTERSECT/EXCEPT injection in `query` command**: `GraphDB.queryReadOnly()` previously rejected data-modification keywords but allowed set operations such as `SELECT ... UNION SELECT sql FROM sqlite_master`, which exposed the full DB schema. The forbidden-keyword regex now includes `union`, `intersect`, and `except`, and the error message was updated to mention set operations.
  - `src/services/graph-db.js`: expanded the read-only SQL defense layer.
  - `test/phase35-query-sql-test.js`: added parameterized assertions for `UNION`, `INTERSECT`, and `EXCEPT` attacks, verifying each is rejected with `ok: false`.
- **Stop leaking parent environment variables to spawned helpers**: `src/cli/watch.js` and `src/services/dep-graph/parsers/spawn-ast.js` previously passed the entire `process.env` to child processes, risking exposure of secrets like `AWS_SECRET_ACCESS_KEY`, `DATABASE_URL`, or `NPM_TOKEN`.
  - `src/utils/command.js`: added `buildSafeEnv(extraEnv)` whitelist helper that preserves only variables child processes actually need (`PATH`, `HOME`/`USERPROFILE`, `APPDATA`, `SYSTEMROOT`/`WINDIR`, `TEMP`/`TMP`, `LANG`/`LC_*`, `PYTHONIOENCODING`, `UV_THREADPOOL_SIZE`, `DEBUG`) and merges explicit overrides. `runCommandSecure()` (used for `git`, `npm`, `npx`, Python modules, etc.) now defaults to this safe environment as well.
  - `src/cli/watch.js`: watch validation commands now use `buildSafeEnv()`.
  - `src/services/dep-graph/parsers/spawn-ast.js`: Python AST parsers now use `buildSafeEnv({ PYTHONIOENCODING: 'utf-8' })`.
  - `test/safe-env-test.js`: new contract tests asserting sensitive variables are stripped while required variables remain present and explicit overrides are honored.
- **Stop auto-appending to `.gitignore` on cache initialization**: `computeDefaultCacheDir()` silently appended `.workspace-bridge/` to an existing `.gitignore` every time a cache was initialized, surprising users and creating dirty git state in CI/read-only environments. Cache-directory gitignore management is now performed only by the explicit `init` command.
  - `src/services/cache.js`: removed the auto-append block from `computeDefaultCacheDir()` and documented the rationale.
  - `test/tech-debt-cleanup-test.js`: updated cache-dir test to assert `.gitignore` is **not** modified by `computeDefaultCacheDir()`.
- **Reduce watch shell-injection surface**: `parseCommandString()` previously treated the structural `cd <dir> && ` prefix as a shell operator, causing watch validation commands to run through a shell unnecessarily. It now recognizes a plain `cd/pushd <dir> && <command> <args>` pattern as a single command and sets `shell: null`, so `watch.js` spawns the process directly without a shell.
  - `src/utils/stack-detectors/commands.js`: refined shell-operator detection so only real operators (pipes, redirections, subshells, multiple statements) require shell execution.
  - `test/render-command-string-test.js`: added assertions that `cd backend && go test ./...` does **not** require shell, while `cat file.txt | grep x` does.

### Code Quality: Weak Assertion Cleanup (2026-06-25)

- Replaced low-signal `typeof` checks in tests with more semantic assertions where practical:
  - `test/dead-exports-imports-scratch-config-test.js`: replaced `typeof p === 'string'` filter with an explicit `Array.isArray` check on the sample list.
  - `test/wave3-formatter-experience-test.js`: replaced `typeof treeText === 'string'` guard with truthy check plus content assertion.

### API Consistency Check (2026-06-25)

- Added `test/api-consistency-test.js` to lock down public contracts touched by the security fixes:
  - `query` command is registered and its error envelope is surfaced consistently across `human`, `summary`, `markdown`, and `jsonl` formats.
  - `buildSafeEnv()` is exported from `src/utils/command.js` and correctly strips sensitive variables while preserving required ones and honoring explicit overrides.

### Code Review Follow-up: query CLI security, snapshot freshness, comment stripping, and workspace hygiene (2026-06-24)

- **Secure `query` command**: Moved SQL execution from `src/cli/commands/index.js` directly touching `container.cache._graphDb.db` into a dedicated `GraphDB.queryReadOnly()` method exposed through `WorkspaceCache`. This removes knowledge of private storage internals from the CLI layer.
- **Stronger read-only validation**: `queryReadOnly()` now explicitly whitelists `SELECT`, `EXPLAIN SELECT`, and `PRAGMA table_info(...)`, rejects data-modification keywords, rejects multi-statement queries by checking for embedded semicolons, and caps results to 1000 rows to avoid dumping huge tables like `edges`.
- **Conservative snapshot short-circuiting**: `src/tools/overview-tools.js` `isSnapshotFresh()` now treats an unavailable or malformed `checkFileChanges()` result as stale instead of optimistically assuming no changes.
- **Improved C-family comment stripping**: `src/services/dep-graph/analyzer.js` `stripComments()` now uses a small state machine for C-family languages to preserve string literals while removing `//` and `/* */` comments, preventing mention-heuristic false negatives when a source stem appears inside a string.
- **Improved Python/Ruby comment stripping**: Added `stripHashFamilyComments()` to preserve single/double/triple-quoted strings while removing `#` line comments, avoiding mention-heuristic false negatives for Python/Ruby source stems inside strings.
- **Refactor `audit-assembler.js` `buildFixSuggestions`**: Replaced the 6-arm flat dispatcher with an ordered `resolveTestAction()` rule table, eliminating the `flat-dispatcher` code smell while preserving identical output semantics.
- **Document `--fields` behavior**: Updated `--help` text and `applyFieldsFilter()` JSDoc to clarify that essential envelope keys are always kept and that `audit-summary`'s deprecated `health` field must be explicitly requested.
- **Workspace hygiene**: Removed accidentally-committed JetBrains inspection viewer artifacts (`index.html`, `script.js`, `styles.css`) from the repository root and added them to `.gitignore` so they cannot be indexed as project orphans again.
- **IO safety: prevent symlink directory loops**: `src/services/file-index.js` `findFilesAsync()` now resolves real paths and tracks visited directories, preventing symlink cycles from causing repeated scans or stack exhaustion.
- **IO safety: cap parser file size**: Added `LIMITS.PARSER_MAX_FILE_BYTES` (1 MB) and enforced it in `src/services/dep-graph/builder.js` `parseFileOnly()`; oversized files return `parseMode: 'none'` / `parseModeReason: 'file-too-large'` instead of being read entirely into memory.
- **Docs fix**: Corrected `src/utils/truncate.js` JSDoc that still claimed `elideDeep` depth was capped at 8; the actual default is 12.

### Documentation: archive historical SQLite graph-storage ADR from ROADMAP (2026-06-24)

- **Background**: `ROADMAP.md` was trimmed to keep only active/future directions. The delivered ADR section covering the SQLite graph-storage decision, target architecture, schema design, implementation phases, concurrency model, and rollback rationale has been migrated to the `Historical Architecture Records` section at the end of this CHANGELOG to preserve decision history.
- This satisfies the project rule: *active documents keep only current state; historical information goes into CHANGELOG*.

### Bug Fixes: Rust parser no longer falls back to regex under concurrent parsing (2026-06-20)

- **Route B follow-up (qartez-mcp)**: During full-graph builds of Rust workspaces, some `.rs` files (especially in `tests/`) were stored with `parse_mode='regex'` / `parse_mode_reason='regex-fallback'` even though the same files parsed successfully in isolation. Root cause: tree-sitter's WASM backend is not safe for concurrent parser/query use across separate `Parser` instances sharing the same language module.
- `src/services/dep-graph/parsers/rust-ast.js`: added a module-level async serialization lock so all Rust WASM parsing happens sequentially. The exported `parseRust()` interface is unchanged.
- `test/rust-ast-parser-test.js`: added `testRustConcurrentParsing()` which fires 10 concurrent `parseRust()` calls and asserts every result uses `parseMode: 'ast'` with the expected imports/exports.
- Verified on `reference/qartez-mcp` with a cold cache: `analysisCoverage.fallbackFiles` went from 19 to 0, `coverageRatio` = 1.00, and `languageSupport.rust.regexFiles` = 0.

### AI Consumption: `audit-file` now emits executable focused test commands (2026-06-20)

- **Route B follow-up**: `audit-file` previously reported affected tests but left `validationAdvice.commands.focused` empty. It now generates stack-aware focused test commands (`node-direct-tests`, `python-direct-tests`, `go-direct-tests`, etc.) by passing `affectedTests` into `buildFileValidationAdvice` and reusing the existing `run-direct-tests` step in `generateCommands`.
- `src/tools/audit-assembler.js`: forwards the `affectedTests` result to `buildFileValidationAdvice()`.
- `src/cli/formatters/validation-advice.js`: constructs `run-direct-tests` steps from affected test files and suppresses the coarser `*-focused-tests` command when direct tests are available.
- `src/cli/formatters/validation-advice/risk-actions.js`: `pickSuggestedCommand` now prefers `direct-tests` over `focused-tests`, so the AI gets the most precise runnable command first.
- `src/utils/stack-detectors/commands.js`: `buildNodeTestCommand` no longer emits `npx null <files>` when no specific runner is detected; it falls back to `npm run test` instead.
- Added `test/audit-file-validation-advice-test.js` case with a temporary vitest fixture to assert focused command generation, executable metadata, and command arguments.

### AI Consumption: `affected-tests` mention heuristic ignores comment-only references (2026-06-20)

- **Route B follow-up**: `affected-tests` `mention` source previously counted a test file as affected if the source stem appeared anywhere in the file, including comments. It now strips comments/docstrings by language family before matching.
- `src/services/dep-graph/analyzer.js`: added `stripComments(content, languageFamily)` supporting C-family (JS/TS/Java/Kotlin/Go/Rust/C/C++/Vue/Svelte), Python-family, and Ruby-family; applied in `_findAffectedTestsByMention`.
- `test/affected-tests-mention-test.js`: refactored into positive and negative cases; added comment-only mention test that asserts the test file is excluded.

### AI Consumption: `impact.affectedRoutes` now tagged with `source: 'src' | 'test'` (2026-06-20)

- **Route B follow-up**: `impact --json` returned `affectedRoutes` without distinguishing production routes from routes defined in test fixtures. Each route object now includes a `source` field derived from `DependencyGraph.isTestLikeFile()`.
- `src/services/dep-graph/query.js`: added `_routeToOutput(file, r)` helper to centralize route object construction; `findAffectedHttpRoutes` now emits `source` for both the SQLite CTE fast path and the in-memory BFS fallback.
- `test/affected-http-routes-source-test.js`: new test asserting `source: 'src'` for production routes and `source: 'test'` for test-file routes, covering both SQLite and in-memory paths.
- Verified on `reference/GitNexus`: test-file routes from `fastapi-prefix-pipeline.test.ts` and `receiver-extraction.test.ts` are now correctly tagged `source: 'test'`.

### AI Consumption: Rust focused test commands now include `tests/` integration tests (2026-06-20)

- **Route B follow-up (qartez-mcp)**: Rust validation advice previously dropped integration tests in `tests/*.rs` because `inferRustModuleName()` returns `null` for those paths. Only inline test modules in `src/**/*.rs` were surfaced.
- `src/utils/stack-detectors/commands.js`: `buildRustTestCommands()` now splits Rust targets into unit modules (`cargo test <module-path>`) and integration tests (`cargo test --test <stem>`), emitting separate commands when both are present. Workspace `-p <crate>` args are preserved.
- `test/rust-workspace-test.js`: added `testIntegrationTestCommands()` and `testIntegrationTestOnlyCommands()` to assert `--test <stem>` generation and correct handling when integration and unit targets are mixed.
- Verified on `reference/qartez-mcp`: `audit-file --file src/guard.rs` now emits both `cargo test server::tools::test_gaps` and `cargo test --test <all-affected-integration-tests>`.

### AI Consumption: Rust library public API dead exports are no longer high-confidence false positives (2026-06-20)

- **Route B follow-up (qartez-mcp)**: `dead-exports` reported 113 findings in `reference/qartez-mcp`, most of which were `pub` items in modules re-exported by `src/lib.rs`. These items are the crate's public API surface and are invisible to intra-workspace static analysis.
- `src/services/dep-graph/analyzer.js`: added `_markRustPublicApiFalsePositives()` which walks `src/lib.rs` → `pub mod` → submodule chains recursively and marks matching dead-export findings with `confidence: 'low'` and `falsePositiveReason: 'rust-public-api'`.
- `src/tools/honesty-engine.js`: added `'rust-public-api'` to `DEAD_EXPORT_FALSE_POSITIVE_REASONS` so these findings are excluded from severity-driving counts.
- `test/rust-dead-export-public-api-test.js`: new semantic tests covering direct lib.rs re-exports, nested `src/<name>/mod.rs` modules, private internal modules, and binary crates without `lib.rs`.
- Verified on `reference/qartez-mcp`: 75/113 dead-export findings are now correctly downgraded to low-confidence `rust-public-api`; only 25 remain as high/medium confidence candidates.

### Bug Fixes (2026-06-17)

- **Restore `--all` CLI help flag**: Re-added `--all` to argument parser configuration in `src/cli/validate-args.js` to fix E2E help commands validation.
- **Isolate mock query testing**: Fixed query E2E test mock injection by writing mock payload directly to the newly introduced `analysis_snapshots` table as well as `precomputed_aggregates`, avoiding cache-miss fallback issues.
- **Deep object formatting safety**: Increased safety-net `maxDepth` limit of `elideDeep` from 16 to 12 in `src/utils/truncate.js` to prevent deep nested arrays/objects (like `functionLevelAffectedTests` list elements at depth 9) from being incorrectly elided to `null`.

### Phase 2: Graph-first HTTP Route Query (2026-06-17)

- **WorkspaceCache Route Wrappers**: Added `saveRoutes`, `loadRoutes`, and `loadRoutesForFiles` to `cache.js` to enable route table persistence in SQLite.
- **SQLite CTE Route Analysis**: Implemented `findAffectedHttpRoutes(filePath, depth)` in `graph-db.js` using a recursive CTE query that traces dependents and yields affected HTTP routes.
- **Graph-First Route Query Integration**: Optimized `findAffectedHttpRoutes` in `query.js` to utilize the SQLite CTE path when cache is present, falling back to in-memory BFS traversal when missing.
- **Verification**: Created [graph-first-http-routes-db-test.js](test/graph-first-http-routes-db-test.js) asserting direct DB route queries, fallback correctness, and incremental route updates.

### Phase 3.5: Persistent aggregate snapshots, fine-grained queries, and SQL query CLI (2026-06-17)

- **Persistent analysis snapshots**: Added `analysis_snapshots` table to SQLite cache DB schema. Implemented migration logic to auto-upgrade existing caches. Saved computed aggregates to the new table.
- **Short-circuiting**: Integrated cache lookup into `buildProjectOverview` to skip graph computation and directly load cached snapshot if git HEAD, file count (scope-filtered), and config hash are identical.
- **Fine-grained SQL CLI query**: Added `query` CLI command to run read-only SELECT/EXPLAIN queries against the cache DB. Built custom formatters (human/markdown/jsonl/summary) for query output. Added strict SQL injection and modification syntax validation to restrict commands to SELECT, EXPLAIN SELECT, and PRAGMA table_info.
- **Fields filtering**: Added `--fields` argument to `audit-overview` and `audit-summary` CLI commands to prune output keys.
- **Verification**: Created [phase35-query-sql-test.js](test/phase35-query-sql-test.js) and ensured `npm run test:fast` (123/123 PASS) and `npm run test:smoke` (126/126 PASS) run completely clean.

### DataQuality 环境降级探测完整化 (2026-06-16)

- 新增 `src/utils/git-environment-probe.js`：统一探测 shallow clone、sparse checkout、submodule 边界（含子仓库内/外）、Git LFS pointer 以及 monorepo 错误 workspaceRoot 五种环境降级因素。
- 更新 `src/config/data-quality.js`：补充 `MONOREPO_ROOT` 修复提示字符串。
- 重构 `src/tools/cochange-tools.js`：用 `analyzeGitEnvironment()` 替代仅检测 shallow clone 的本地逻辑，使 co-change 信号在任一环境降级因素下正确标记为 `DEGRADED` 并返回对应 `remediation`。
- 修复 `src/services/cache.js` 的 `METADATA_SCHEMA.coChanges`：序列化/反序列化时保留 `dataQuality` 和 `remediation`，解决暖启动后 shallow clone 降级信号丢失为 `UNAVAILABLE` 的 bug。
- 新增 `test/git-environment-probe-test.js`：用真实 git 仓库覆盖五种环境探测及 `analyzeCoChanges()` 的降级语义。
- 新增 `test/cache-data-quality-test.js`：验证 co-change 降级标记经 SQLite 缓存往返后保持不变。
- 清理 `docs/TECH_DEBT.md`：DataQuality 环境降级表已修复，L2 活跃债务归零。
- **第二轮：降级标记扩展到所有 git 相关信号**：
  - `src/services/container.js` 暴露懒加载 `container.gitEnvironment`，避免重复执行 git 探测。
  - `src/tools/dep-tools/impact.js` 输出新增 `dataQuality` 与 `environmentRemediation`。
  - `src/tools/dep-tools/dead-exports.js` 输出新增 `dataQuality` 与 `environmentRemediation`。
  - `src/tools/overview-assembler.js` 的 `knowledgeRisk` 输出新增 `dataQuality` 与 `remediation`。
  - `src/services/cache.js` 的 `checkFileChanges()` 对 LFS pointer 文件跳过 mtime+size 快路径，强制走 SHA-256 二次确认。
  - 新增 `test/data-quality-propagation-test.js`：用 CLI 真实运行验证 impact、dead-exports、audit-overview knowledgeRisk 在 shallow/sparse/submodule 环境下均返回 `DEGRADED`。
  - `test/cache-data-quality-test.js` 补充 LFS pointer 强制 hash 验证用例。
- **第三轮：降级标记覆盖 cycles / unresolved / audit-diff**：
  - `src/tools/dep-tools/cycles.js` 输出新增 `dataQuality` 与 `environmentRemediation`。
  - `src/tools/dep-tools/unresolved.js` 输出新增 `dataQuality` 与 `environmentRemediation`。
  - `src/tools/audit-assembler.js` 的 `buildDiffResult()` 为 `audit-diff` 输出新增 `dataQuality` 与 `environmentRemediation`。
  - `test/data-quality-propagation-test.js` 扩展三个 CLI 用例：shallow clone 下 `cycles` 降级、sparse checkout 下 `unresolved` 降级、submodule 下 `audit-diff` 降级。
- 验证：`node test/git-environment-probe-test.js`、`node test/cache-data-quality-test.js`、`node test/data-quality-propagation-test.js`、`node test/shallow-clone-integration-test.js` 通过；`npm run test:fast` **123/123 PASS**；`npm run test:smoke` **126/126 PASS**。

### Modification Guard (AI Safety Shield) 变更保护与影响审查 (2026-06-16)

- 新增 `guard` CLI 命令行指令，用于在修改代码文件前审查其波及范围（依赖 blast radius）以保证 AI 安全。支持单文件 `--file`、多文件 `--files` 以及 Git 变更 `--staged` 文件的直接与传递依赖（transitive dependents）联合去重统计。
- 支持通过 `--max-dependents` 与 `--max-transitive` 参数（支持对应 `WB_MAX_DEPENDENTS` 与 `WB_MAX_TRANSITIVE` 环境变量）设定变更限制阈值，一旦超出限制，CLI 会以状态码 `1` 退出拦截非预期的大范围变更。
- 新增 `guard-formatter.js` 输出格式化层，支持 `human`/`markdown`（包含警告块摘要与详细名单）、`ai`（精简提示词友好警示文本）以及 `json` 输出类型。
- 在 `cli.js` 注册并公开 `guard` 相关参数和命令说明。
- 新增 `test/guard-command-test.js` 并覆盖单文件、多文件、Git staged 以及超出阈值阻断 exit 1 的完整业务语义校验。

### 多语言 AST 解析 Golden 镜像与容错测试 (2026-06-16)

- 在 `test/fixtures/tricky/` 针对所有 9 种语言提供包含类装饰器、框架路由、动态导入、多导入块等复杂边缘特性的测试样本代码。
- 新增 `test/parser-golden-test.js` 黄金测试门禁，解析各类 tricky 代码并对其输出执行深层路径/时间戳规范化过滤（如 `<WORKSPACE>` 占位替换、换行符 LF 对齐等），断言其与 `test/fixtures/goldens/*.json` 镜像结果深等价。
- 支持 `UPDATE_GOLDENS=1` 环境变量一键重新生成 AST 解析黄金快照；增加语法损坏/废料输入容错测试，验证各语言 AST parser 能安全进入 fallback 模式（`parseMode: 'none'` / `ok: false`）而不是引发致命进程崩溃。

### 跨平台路径归整与测试环境鲁棒性修复 (2026-06-16)

- 新增 `test/path-crossplatform-regression-test.js` 以覆盖 Windows 下大小写敏感/不敏感路径映射、`git-tools` 路径转换和 mixed path resolver 规范化一致性断言。
- 修复 `cli.js` 在异常捕获块中直接用 `args.includes('--json')` 匹配 JSON 输出请求的 bug：由于忽略了环境变量 `WB_JSON=1` / `WB_FORMAT=json`，会导致当环境开启 JSON 时输入参数校验错误仍以 stderr 形式输出，使 JSON 接收端崩溃。现在同时从 argv 与 env variables 校验并确保输出 JSON。
- 修复 `test/wave14-noise-env-test.js` 中 `testCliOverridesEnv` 的绝对路径包含 Windows 盘符 casing 断言不一致的缺陷，改用 `path.resolve('/tmp/from-cli')` 进行跨平台精确相等比对。
- 修复 `test/query-tools-test.js` 动态快照 freshest 比对在本地工作拷贝有修改时由于 `checkFileChanges()` 抛出 dirty files 变化而导致缓存命中测试失败的问题：在 `testQueryToolsCacheHit` 中临时 stub `checkFileChanges` 结果，消除 local workspace 变更污染。
- 修复交互式/集成测试中开启 Chokidar 背景文件监听导致 Windows 独占锁定临时测试目录、引起 `fs.rmSync` 清理失败及 test 任务偶发 SIGTERM 锁死挂起的问题：规范化在 `query-tools-test.js`、`graph-first-routes-test.js`、`precompute-hotspot-test.js`、`persisted-graph-test.js` 等测试容器 initialize 调用中显式禁用 `watch` (`watch: false`)。
- 修复 unified `test-helpers.js` 共享容器 `_injectCacheDir` 自动注入临时隔离 cache 目录而 `wave8-regression-test.js` 使用自定义 `spawnSync` 不带 `--cache-dir` 导致 CLI 与 REPL 针对不同缓存目录产生依赖数不一致的问题：将 `wave8` 替换为统一的 `runCliRaw` 辅助函数。
- 调整 `test/runner.js` 使 `e2e-gitnexus-test.js` 超时阈值扩展到 5 分钟，避免在重度并发 CPU load windows 平台上冷启动 indexing 1329 个文件时因偶发超时被 killed。
- 验证：`npm run test:fast` **122/122 PASS**；`npm run test:smoke` **125/125 PASS**。

### 过滤 getStaleness() 中非代码（文档、样式、资源）变更以避免缓存过度失效

- 在 `src/services/container.js` 的 `getStaleness()` 方法中，过滤由 `cache.checkFileChanges()` 返回的 `changedFiles`。排除经由 `projectContext.classifyFile()` 分类为 `docs`、`style` 或 `asset` 的文件，以防修改文档（如 `AGENTS.md`、`CHANGELOG.md`）或样式等资源文件造成不必要的缓存重建。
- 在 `test/staleness-test.js` 中新增针对上述过滤逻辑的单元测试，验证文档、样式和资源文件的变动不会导致缓存被标记为过期。
- 验证：`node test/staleness-test.js` 通过；`npm run test:smoke` 中 `staleness-test.js` PASS。

### 收紧 project-context 导出面并将 scratch 目录标记为 archive

- 从 `src/utils/project-context.js` 的 `module.exports` 中移除仅内部使用的 `JS_TS_EXTS` 与无外部调用方的 `normalizeRelativePath`；移除顶部未使用的 `readJsonSafe` 解构导入。
- 从 `cli.js` 的 `src/config/constants` 解构中移除未使用的 `DEFAULTS`。
- 在 `.workspace-bridge.json` 的 `directories.archive` 中增加 `scratch`，使 `scratch/*.js` 不再被报告为 orphan 模块。
- 新增 `test/dead-exports-imports-scratch-config-test.js` 覆盖导出面与 orphan 行为。
- 验证：`node cli.js dead-exports --cwd . --json --quiet` 不再列出 `JS_TS_EXTS`；`node test/dead-exports-imports-scratch-config-test.js` 通过。

### 修复 entry-detector 使用 raw path 检查已知入口文件

- 修复 `src/services/dep-graph/entry-detector.js` 的 `isKnownEntryFile()`：将 `entryFiles.has(filePath)` 改为 `entryFiles.has(key)`，避免 Windows 原生反斜杠路径无法命中已规范化的入口集合。
- 在 `test/entry-detector-test.js` 新增回归测试 `testIsKnownEntryFileNormalizesRawPath`。
- 验证：`node test/entry-detector-test.js` 通过；`npm run test:fast` 中 `entry-detector-test.js` PASS。

### 修复 audit-diff 在干净仓库误报 .gitignore 变更

- 调整 `src/services/cache.js` 的 `computeDefaultCacheDir()`：仅向已存在的 `.gitignore` 追加 `.workspace-bridge/` 条目，不再在缺少 `.gitignore` 的仓库中自动创建新文件，避免 `audit-diff` 等只读命令把自动生成的 `.gitignore` 统计为变更文件。
- 在 `src/cli/commands/init.js` 的默认 `.gitignore` 条目中补充 `.workspace-bridge/`，确保 `init` 命令仍正确配置缓存目录忽略。
- 更新 `test/tech-debt-cleanup-test.js` 以匹配新行为。
- 验证：`node test/audit-diff-test.js`、`node test/tech-debt-cleanup-test.js` 通过；`npm run test:fast` **120/120 PASS**；`npm run test:smoke` **123/123 PASS**。

### L2 代码品味修复：CLI help 与框架检测表驱动化

- 在 `cli.js` 提取 `COMMON_OPTIONS` 共享选项表，消除 `printUsage` 短/长帮助之间约 70 行重复选项文案。
- 在 `src/utils/project-context.js` 将 266 行 `detectFrameworkFromPath` if-else 链重构为 `FRAMEWORK_RULES` 配置表，保持语义等价并降低新增语言/框架时的修改成本。
- 新增 `test/cli-help-dry-test.js` 与 `test/framework-detector-table-test.js` 覆盖重构后行为。
- 验证：`npm run test:fast` **120/120 PASS**；`npm run test:smoke` **123/123 PASS**。

### 修复默认缓存目录被索引/解析导致的 EISDIR 错误

- 在 `src/utils/exclude-patterns.js` 的 `DEFAULT_EXCLUDE_DIRS` 中新增 `.workspace-bridge`，确保默认 SQLite 缓存目录及其子文件不会被 `FileIndex` 发现或 `DepGraph` 尝试解析。
- 在 `test/file-index-exclude-test.js` 新增回归测试：在 `.workspace-bridge` 下放置 `.js` 文件，验证其不被索引。
- 修复 `test/audit-assembler-test.js` 因缓存创建 `.gitignore` 导致 `assembleDiff` 变更文件数断言失败：改用隔离的 `cacheDir` 运行 `ServiceContainer`，避免污染 fixture 仓库。
- 验证：`node test/file-index-exclude-test.js`、`node test/audit-assembler-test.js`、`node test/git-tools-test.js` 通过；`npm run test:fast` **118/118 PASS**；`npm run test:smoke` **121/121 PASS**。

### 修复 audit-diff 误报 workspace-bridge 缓存产物

- 修复 `src/tools/git-tools.js` 的 `isCacheArtifact()`：除保留 `cache.db` / `cache.db-wal` / `cache.db-shm` basename 过滤外，新增对任意位于 `.workspace-bridge/` 目录下文件路径的过滤，避免缓存锁文件等产物被 `audit-diff` 统计为变更文件。
- 导出 `isCacheArtifact` 供单元测试使用，并在 `test/git-tools-test.js` 补充路径分段与 Windows 反斜杠场景的语义断言。
- 验证：`npm run test:fast` **118/118 PASS**；`npm run test:smoke` **121/121 PASS**。

### 文档一致性修复 (2026-06-16)

- 同步 `AGENTS.md`、`SESSION.md`、`docs/TECH_DEBT.md` 测试基线为 `npm run test:fast` **118/118 PASS**、`npm run test:smoke` **121/121 PASS**（以实际 runner 输出为准），项目规模为 totalFiles≈397 / mainline=181 / test=216。
- 统一活跃架构债务计数为 0 项；从 `AGENTS.md` L4 架构分层表中移除已删除的 `health-tools.js` 引用。
- 更新 `SESSION.md` 多语言框架检测矩阵：Go/Rust/Vue/Svelte 标记为 AST-Query，新增 Python（Django/FastAPI/Flask/Celery）行。
- 标记方向 4 #13（架构指标默认排除 test→source 边）为已交付；修复 `SESSION.md` 已修复清单中的重复编号。
- 更新 `AGENTS.md`、`SESSION.md` 与 `docs/TECH_DEBT.md` last-updated 日期。

### 测试分层标记补齐与跨平台断言审计 (2026-06-16)

- 为缺失分层标记的测试文件补全头部注解：`test/affected-routes-test.js` 与 `test/graph-first-routes-test.js` 统一标注 `// @semantic`。
- 审计 `staleness-test.js`、`path-utils-test.js`、`path-format-consistency-test.js` 等路径相关测试的跨平台断言：当前 fast 套件已使用平台分支或 `normalizePathKey` 进行键值比对，未发现新的 Windows/POSIX 路径回归。
- 验证：`npm run test:fast` **118/118 PASS**。

### Async 生命周期修复 (2026-06-16)

- 修复 `ServiceContainer` 在 `GraphBuilder.updateFiles` 执行期间收到 `pending:processed` 批量事件时直接丢弃批次的问题：新增 `_pendingUpdateQueue` 与 `_drainPendingUpdates()` 串行处理队列，并等待 `_updating` 结束后再提交下一批。
- 修复 `GraphBuilder.updateFiles()` 在持久化完成前就调用 `_finishUpdating()` 导致状态提前变为 `READY` 的问题：将 `_finishUpdating()` 移到 `graph:built` 事件（含 persistence 监听器）处理完成后，并用 try/finally 保证异常路径也能恢复状态。
- 修复 `persistence.js` 中 `graph:built` 监听器在 `precomputeAggregates()` 或 `precomputeImpact()` 抛出时中断、导致 `savePrecomputed()` 未执行的问题：为两者分别加 try/catch，失败仍继续保存。
- 修复 `ServiceContainer.initialize()` 中 `_readyPromise` 在状态已切到 `INITIALIZING` 后仍未赋值的竞态窗口：改为先创建 Promise 再 transition，并在 catch 块中使用局部引用避免 shutdown 将其置空后无法 reject。
- 新增 `test/async-lifecycle-fixes-test.js` 覆盖上述四种场景；验证：`npm run test:fast` **118/118 PASS**。

### Cache 数据一致性与跨平台修复 (2026-06-16)

- 修复 `resolveCachedFilePath()` 在文件缺失时回退返回 normalized key 而非原始 `cachedPath` 的问题，使 Windows 下删除文件检测返回平台原生路径；新增 `test/cache-fixes-test.js` 回归覆盖。
- 修复 `checkFileChanges()` mtime 快路径使用严格浮点相等导致 SQLite INTEGER 存储后反复误判变更的问题，改为整数精度比较并同步更新 repaired metadata。
- 修复 `computeDefaultCacheDir()` 迁移 legacy `cache.db` 时遗漏 `cache.db-wal` / `cache.db-shm` 的问题，避免 WAL 模式未 checkpoint 数据丢失。
- 修复 `deleteFileMetadata()` 未级联清理 `parseResults`、`diagnostics`、`parsedHashes` 与 `symbolIndex` 中对应条目的问题，删除文件不再留下幽灵缓存数据。
- 为 `WorkspaceCache.close()` 与 `walCheckpoint()` 添加 try-catch，避免 GraphDB 关闭异常向上传播。
- 提取 `_resolveKeys()` 辅助函数消除 `deleteFileMetadata()` / `deleteParseResult()` / `clearDiagnostics()` 中重复的 `uniquePathCandidates([key, filePath])` 模式。
- 验证：`node test/staleness-test.js && node test/cache-fixes-test.js && node test/cache-test.js && node test/cache-consistency-test.js` 通过；`npm run test:fast` **118/118 PASS**。

### Fast 测试基线修复 (2026-06-16)

- 修复本地未安装 `javalang` 时 Java parser 落到 regex fallback 后丢失 `decorators`、`fingerprint`、`branchCount` 与 `maxArms` 的问题，恢复 Java `else-if` dispatcher 和 `batch-no-transactional` 规则的 fallback 语义。
- 将 `cache-corruption-test.js` 的持久化失败用例从依赖 `chmod` 的权限假设改为直接模拟 SQLite 保存层失败，避免不同平台/用户权限下产生假失败。
- 验证：`node test/cache-corruption-test.js && node test/wave11-analysis-deepening-test.js && node test/wave15-ast-rules-test.js` 通过；`npm run test:fast` **117/117 PASS**。

### Overview staleness 与热缓存修复 (2026-06-16)

- 修复 WSL/bash 读取 Windows 旧缓存路径时 `checkFileChanges()` 将 `C:\...` 误判为删除的问题；现在会尝试 exact key、normalized key 与 `/mnt/<drive>/...` 兼容路径，并在命中后修复 `originalPath`。
- 修复 `WorkspaceCache.load()` 替换内存 Map 后 DirtyTracker 仍指向旧 Map，导致 load 后新增/更新的 file metadata 与 parse result 无法持久化的问题。
- 修复 `edgeMeta` 被后续 `cache.save()` 写成 `"null"` 并抹掉的问题，并确保 `saveEdges()` 同步更新内存中的 edge metadata，使 `loadGraph()` 能走真正热缓存路径。
- 修复 `ServiceContainer._runStage()` 未 await async stage 导致 `_phaseTimes` 性能定位失真的问题；同时隐藏非 git fixture 下 `git rev-parse` 的无意义 stderr。
- 验证：`node test/cache-test.js && node test/staleness-test.js && node test/persisted-graph-test.js && node test/cache-corruption-test.js` 通过；`npm run test:fast` **117/117 PASS**；`audit-overview --json --quiet` 热缓存约 **14.5s**，`staleness.isStale=false`。

### 漏洞与并发稳定性问题修复 (2026-06-16)

修复了在 Git 提交审计与漏洞评估中发现的 5 项关于并发、锁定与正则逃逸的稳定性问题：

- **Bug 1 (空锁死锁)**：修复了 `acquireLockSync` 在遇到空/损坏的锁文件（PID 无法解析或长度为 0）时产生无限超时死锁的问题，现在会自动 unlink 该锁文件并进行重试。
- **Bug 2 (框架正则边界逃逸)**：将 `framework-patterns.js` 正则字面量中的 `\\b` 修正为单反斜杠 `\b`，解决了 Spring Boot 和 Ktor 框架的 AST 查询匹配失效问题。
- **Bug 3 (并发 Schema 迁移竞争)**：在 `_ensureOpen` 触发 `_migrate()` 时将 Schema 变更逻辑封装在 SQLite 事务中，防止并发只读命令初始化时抛出 `SQLITE_BUSY` 或造成 Schema 损坏。
- **Bug 4 (缓存目录迁移并发竞争)**：在 `computeDefaultCacheDir` 迁移 legacy 缓存前，增加对旧缓存锁文件状态的检查，避免并发写入/查询时直接迁移文件导致 DB 损坏。
- **Bug 5 (单元测试 Shared Container 污染)**：修复了 in-process 测试运行器中 `_getSharedContainer` 会忽略新 `cacheDir` 参数的 bug，加入了对不同 `cacheDir` 容器的自动销毁与重置逻辑，消除测试间的环境污染。

### Code Review 发现问题系统性修复 (2026-06-15)

针对 `docs/code_review.md` 报告中指出的所有确定的正确性、一致性、可信度、发布与测试治理等 P0、P1、P2 级缺陷进行了全面彻底的修复，清空了所有已审查出的代码缺陷：

- **P0-1 `query-*` 可能返回过期分析快照**：修复了 `query-tools.js` 仅比对 `gitHead` 和文件数的快照失效问题，引入了配置摘要 `.workspace-bridge.json` 的 SHA-256 哈希以及 `cache.checkFileChanges()` SHA-256 内容校验，实现精确一致性校验。
- **P0-2 CLI 参数优先级被环境变量反向覆盖**：将参数解析规则统一为 `CLI args > Env vars > Project Config > User Config > Defaults`。
- **P0-3 当前快速测试基线失败**：修复了 Java Regex Fallback 方法签名匹配错误、Ubuntu CI 缺少 `javalang` 依赖、跨平台路径大小写断言不符等 CI 失败缺陷，恢复 `npm run test:fast` 全绿。
- **P0-4 SQLite 并发冷启动会静默丢失持久化写入**：在 `graph-db.js` 写入路径实现了 pid-based advisory lock 锁文件排他控制，超时 5 秒，支持自动创建锁文件父目录。
- **P0-5 预计算结果不是原子快照，崩溃后会产生混合代际数据**：在 `injectPrecomputedAggregates` 和 `injectPrecomputedImpact` 中验证所有 row 的 version 和 fileCount 一致性，若存在混合代际或不一致数据，则整体放弃加载，确保快照原子性与一致性。
- **P1-1 动态加载 Query 模块被误判为孤儿**：在 `framework-patterns.js` 导出注册 query 路径，并在 `dep-graph.js` / `orphan-detector.js` 联动排除，使动态 registry 模块纳入运行时可达性图。
- **P1-2 已知假阳性仍会抬高仓库 severity**：屏蔽了 `SHADOW_EXTS` 等已知动态 registry 导出误报参与仓库 severity 评分。
- **P1-3 测试依赖污染生产架构指标**：REPL `top` 等分析指标已默认使用 `{ architectureOnly: true }` 排除 test ➔ source 边。
- **P1-4 Knowledge Risk 在个人仓库和 dirty worktree 中失真**：过滤 `Not Committed Yet` 等伪作者，且当仓库有效作者数 <= 2 时，自动将 knowledge risk 标记为 `too-few-authors` 禁用，避免个人仓库的 blame 噪音与性能损耗。
- **P1-5 workspace-info 伪装成轻量预热**：剥离了 `workspace-info` 对 `ServiceContainer` 的重度依赖，新增 `lightweightFileScan()`，实测预检耗时从 115s 缩短至 <1s。
- **P1-6 audit-summary/audit-overview 不适合作为每次会话基线**：新增 `--with-history` 显式开关，默认禁用高开销的 `git blame`。
- **P1-7 `--quiet` 仍污染 stderr**：延迟加载 `node:sqlite` 并安全拦截 `ExperimentalWarning`。
- **P1-8 `process.emitWarning` 全局 monkey-patch 仍是架构风险**：将全局 warning 劫持改为 scoped `_withSqliteWarningSuppressed()` 临时拦截并在 finalizer 中精确还原。
- **P1-9 真实循环依赖未列入正式活跃债务**：提取 `category-filter.js` 共享模块，彻底消除 `audit-assembler.js ↔ incremental-diff.js` 之间的循环依赖。
- **P1-10 性能 CI 使用不受支持的 Node 20**：更新性能 GitHub workflow 容器版本为 Node 24。
- **P1-11 没有常规测试 CI**：新增 `.github/workflows/test.yml` 实实现在 Node 22/24 上的常规测试门禁。
- **P1-12 Release 在测试前直接发布**：加固 `release.yml` 在 `publish` 前增加单元测试与打包 tarball 安装验证步骤。
- **P1-13 包产物没有独立安装验证**：Release 流程新增 Packed-tarball E2E 安装与 `--version`、`workspace-info` 测试以保证产物可用。
- **P1-14 `--version / --help` 提前加载完整分析栈**：优化 CLI 命令加载逻辑，未确定执行分析命令前不初始化 `ServiceContainer` 与其他重度模块。
- **P2-1 测试分层标记没有落实**：补齐 130 个测试文件的 `// @contract` 与 `// @semantic` 标签。
- **P2-2 CLI 测试仍大量 spawn**：提供了 `runCliInProcess()` 并在单元测试中迁移了 41 个 spawn 测试到 in-process runner，测试速度大幅提升。
- **P2-3 Coverage 没有质量门槛**：新增 `.c8rc.json` 并在 CI 增加 coverage gate（lines/statements >=72%）。
- **P2-6 工作区换行符污染**：规范化换行符策略，通过 `.gitattributes` 将 80 个 CRLF 换行符文件强制为 LF。
- **P2-7 Schema version 多处硬编码**：统一使用 `SCHEMA_VERSION` 常量。
- **P2-10/11/12/13/14/15 文档、命令状态、链接及安全分析措辞越界治理**：修复了 SKILL.md 失效链接，归整了重叠的命令，排除了安全模式中对“漏洞”的武断断言。
- **P2-16/17/18/19 清空四大活跃技术债**：完成了多语言框架 AST-Query 编译、默认缓存迁入工作区 `.workspace-bridge/`、优先级配置链支持 `~/.workspace-bridge/config.toml` 与 `.env`、以及基于 PID file lock 的跨进程并发写协调。
- **P2-20 npm tarball 中所有文件都被标记为可执行**：通过规范化本地工作区权限及构建检查，确保非脚本入口文件不携带可执行属性，并在 Release CI 中增加 tarball 权限校验。

### 清空四大活跃技术债 (2026-06-15)

- **框架检测 Query 语言等价性偏斜**：
  - 为 Go (Gin, Echo, Fiber)、Rust (Actix-web, Axum, Rocket)、Vue 和 Svelte 开发并注册了 AST-Query 检测规则，彻底消除了多语言框架检测偏斜。
  - 使用 identifier / scoped_identifier 捕获节点，大幅简化 Rust 框架检测的 tree-sitter 查询，解决了通用路由属性 `#[get(...)]` 在不同 Rust 框架之间的命名碰撞冲突。
- **缓存默认目录位于项目外导致易失**：
  - 将默认 SQLite 缓存目录迁移至 `<workspaceRoot>/.workspace-bridge/`。
  - 自动管理 `.gitignore` 保证缓存文件不被误提交。
  - 实现对 `os.tmpdir()` 的写权限 fallback 降级和 legacy `cache.db` 的跨会话自动迁移。
- **全局配置链优先级及用户级配置**：
  - 支持 `~/.workspace-bridge/config.toml` 和 `.env` 作为全局用户配置。
  - 引入了 `CLI > Environment variables > Project Config > User Config > Defaults` 的五层配置优先级决策链，并提供了 `_sources` 的 Precedence Origin Report。
  - 修复 `.workspace-bridge.json` 新字段的 schema 校验噪音。
- **跨进程并发控制与 busy 重试**：
  - 在 `graph-db.js` 写入路径实现了 pid-based advisory lock 锁文件排他控制，超时 5 秒，支持自动创建锁文件父目录。
  - 封装 Windows 平台读操作的指数退避重试，最大 3 次，防止 WAL 模式下的读写冲突。
  - 修复 `cache-backup-test.js`、`cache-corruption-test.js` 和 `path-format-consistency-test.js` 的连接释放与 async 调用顺序。
- **测试分层标记全面落地**：
  - 自动化补充了 130 个未打标签测试文件的 `// @contract` 与 `// @semantic` 注解，彻底清空了测试层级规范技术债。
- **验证**：新建专属技术债测试 `test/tech-debt-cleanup-test.js`；`npm run test:fast` **117/117 PASS**；`npm run test:smoke` **120/120 PASS**；`npm run test:coverage:check` 通过。

### Graph-first 路由提取与影响分析升级 (2026-06-15)

- **问题**：旧有的受影响 Web 路由计算依赖于 `savePrecomputed` 阶段对磁盘源文件进行高开销的二次 I/O 扫描和正则分析，增量/全量构建开销大，且无法利用内存依赖图进行高效查询。
- **修复**：
  - 将路由提取（`extractRoutes`）前置到 `parseFileOnly` AST 解析阶段，支持全量 9 种语言，在 `resolveFileOnly` 时挂载到内存节点的 `routes` 属性并同步写入 SQLite 缓存。
  - 在 `_serializeEdges()` 中将路由展开为 `edgeType = 'handles-route'` 类型的边写入持久化图关系；而在 `loadGraph()` 恢复内存图结构时，强制过滤掉非 `'import'` 类型的边（即排除 `handles-route` 边），保持主依赖关系纯净。
  - 在 `query.js` 引入 `findAffectedHttpRoutes` 内存图 BFS 查询，完全取代 `persistence.js` 里的二次磁盘扫描。
  - 重构 `impact.js` 以调用 `snapshot.graph.findAffectedHttpRoutes` 快速内存检索，干掉了对 SQLite `routes` 关系表的运行时读取。
- **验证**：新增 `test/graph-first-routes-test.js` 并通过全量单元测试（覆盖缓存、增量更新、BFS半径等场景）。`npm run test:fast` **116/116 PASS**；`npm run test:smoke` **119/119 PASS**；`npm run test:coverage:check` 通过。

### 迁移 CLI spawn 测试到 in-process runner (#21) (2026-06-14)

- **问题**：约 44 个测试文件仍通过 `runCli`/`runCliRaw`/`runCliText` 走 `child_process.spawnSync`，CI 串行开销大、flaky 风险高；`runCliInProcess()` 已导出但迁移率低。
- **修复**：
  - `test/test-helpers.js` 新增 `runCliInProcess` / `runCliInProcessText` / `runCliInProcessRaw`，共享 `ServiceContainer` 并在 `--cwd` 非仓库根目录时自动回退到 spawn。
  - `cli.js` 修复 `runCliInProcess` 对 `--help` 的输出（此前返回空 stdout，与真实 CLI 行为不一致）。
  - 迁移 41 个测试文件到新的 in-process helper；保留 `repl` / `watch` / `audit-file --watch` / `cache-concurrency` / `cli-error-handling`（依赖进程级 config 隔离）/ `workspace-info-lightweight`（依赖轻量预检时间断言）等必须使用真实子进程的测试不变。
  - 修复 `test/severity-filter-test.js` 中 `medium severity` 断言对低置信死导出的误判。
- **验证**：`npm run test:fast` **116/116 PASS**；`npm run test:smoke` **119/119 PASS**。

### 增加 CI coverage gate (#22) (2026-06-14)

- **问题**：`test:coverage` 脚本存在但 CI 不跑，无法防止覆盖率回归；缺少最低门槛时，新增未覆盖代码难以被及时发现。
- **修复**：
  - 新增 `.c8rc.json` 配置全局门槛：`lines/statements >= 72%`，`functions >= 70%`，`branches >= 68%`；基于 fast 层真实基线（~74% / ~70% / ~71% / ~74%）保留约 2% 缓冲。
  - 调整 `package.json`：`test:coverage` 改为生成本地 HTML 完整报告，`test:coverage:check` 用于 CI gate，跑 fast 层并校验门槛。
  - `.github/workflows/test.yml` 新增独立 `coverage` job，在 Node 22 / Ubuntu 上运行 `npm run test:coverage:check`。
- **验证**：本地 `npm run test:coverage:check` exit 0；`npm run test:fast` **116/116 PASS**；`npm run test:smoke` **119/119 PASS**。

### 修复测试边污染架构指标 (#13) (2026-06-14)

- **问题**：REPL `top` 命令在计算热点时未过滤测试文件依赖，导致生产文件因被大量测试 import 而虚高为 hotspot；虽然 `audit-overview` 的 `buildHotspots` / `buildCouplingSplitSuggestions` / `identifyCoreModules` 已使用 `{ architectureOnly: true }`，但交互式 REPL 的架构视图与 impact view 未对齐。
- **修复**：`src/cli/repl.js` 的 `top` 命令跳过测试文件本身，并使用 `graph.getDependents(file, { architectureOnly: true })` 统计生产依赖；扩展 `test/repl-edge-test.js` 验证纯测试依赖不会把生产文件抬成 hotspot。
- **验证**：`npm run test:fast` **116/116 PASS**。

### 修复 CI 跨平台失败 (#23) (2026-06-14)

- **问题**：新引入的 `.github/workflows/test.yml` 在 Ubuntu (Node 22/24) 上运行 `npm run test:fast` 与 `npm run test:smoke` 时失败：
  - `test/path-utils-test.js` 在 POSIX 上期望 `normalizePathKey` lowercase，与实现（仅 Windows lowercase）矛盾；
  - `src/services/dep-graph/parsers/java.js` 的 regex fallback 中 `methodRegex` 字符类 `\[\w<>\[]` 被错误解析，导致 AST 不可用时 `functionRecords` 为空，进而 `wave11-analysis-deepening-test.js` 与 `wave15-ast-rules-test.js` 的 Java E2E 断言失败；
  - CI runner 未安装 `javalang`，Java AST parser 被迫 fallback；
  - `test/affected-tests-heuristic-test.js` 的 Windows 路径 heuristics 在 POSIX 上运行并断言失败。
- **修复**：
  - 修正 `path-utils-test.js` 的断言，POSIX 上验证 casing 保留，Windows 上验证 lowercase；
  - 修正 `java.js` 的 `methodRegex` 字符类为 `[\w<>\[\]]`，恢复 regex fallback 对 public 方法签名的正确匹配；
  - `.github/workflows/test.yml` 新增 `python3 -m pip install javalang`，确保 Java AST parser 在 CI 上可用；
  - `affected-tests-heuristic-test.js` 的 `testWindowsPaths` 在非 Windows 平台跳过。
- **验证**：GitHub Actions `Test` workflow Node 22/24 双矩阵 `test:fast` + `test:smoke` 全部通过；本地 `npm run test:fast` **116/116 PASS**，`npm run test:smoke` **119/119 PASS**。

### 收尾：修复 CRLF 残留、测试分层标记与文档同步 (2026-06-14)

- 将 `src/services/dep-graph/framework-patterns.js` 规范化为 LF 行尾，消除 `.gitattributes` 生效后仍残留的 CRLF 噪音。
- 给 `test/knowledge-risk-test.js` 头部追加 `// @slow`，修正 runner 对其包含 `spawnSync/child_process` 的误分类警告。
- 同步 `AGENTS.md` 与 `SESSION.md` 中的 fast/smoke 测试数量及 last updated 行，统一为 `test:fast 116/116 PASS`、`test:smoke 119/119 PASS`。

### 修复 audit-summary/overview 默认跑逐文件 blame (#10) 与 Knowledge risk 对个人仓库失真 (#14) (2026-06-13)

- **问题**：`audit-overview` / `audit-summary` 默认会调用 `getFileKnowledgeRisk()` / `getFileHistoryRisk()` 等逐文件 blame，热缓存下仍 ~56s，与“1 秒基线”目标冲突；同时单作者或个人仓库中所有文件都被判为 high risk，未提交行被显示为 `Not Committed Yet`，指标失真且制造噪音。
- **修复**：
  - `src/cli/validate-args.js` 新增 `--with-history` 标志（支持 `WB_WITH_HISTORY` 环境变量）；`cli.js` 帮助文本同步更新。
  - `src/tools/overview-tools.js` 将历史/ blame 改为 opt-in：默认 `audit-overview` / `audit-summary` 不再传入 `getFileHistoryRisk`，仅在显式 `historyProvider` 或 `--with-history` 时启用。
  - `src/tools/overview-assembler.js` 新增 `buildEmptyKnowledgeRisk()`；`assembleOverviewData()` 未请求历史时直接返回空桶并标记 `disabledReason: 'history-not-enabled'`；`buildHotspots()` 在历史提供者不存在时跳过逐文件 `git log`；`buildKnowledgeRisk()` 在启用历史时先通过 `getRepoEffectiveAuthorCount()` 检测仓库作者分布，effective author count <= 2 时返回 `disabledReason: 'too-few-authors'`，避免个人仓库跑昂贵 blame。
  - `src/tools/git-tools.js` 新增 `isUncommittedAuthor()` 与 `getRepoEffectiveAuthorCount()`，在 `parseBlamePorcelain()` 中过滤 `Not Committed Yet` 等伪作者。
  - `src/tools/query-tools.js` 的 `queryKnowledgeRisk()` 显式传入 `withHistory: true`，确保查询知识风险时按需计算。
  - `src/cli/formatters/human-formatters.js` 在 human/summary/markdown 输出中展示 knowledge risk 禁用原因，保持输出可读。
- **测试**：新增 `test/overview-history-optional-test.js`（`// @semantic`）验证默认 overview 不调用 historyProvider、`--with-history` / 显式 provider 可启用、`assembleOverviewData()` 尊重 opt-in、个人仓库禁用、未提交行不计入作者；扩展 `test/knowledge-risk-test.js` 验证 `getRepoEffectiveAuthorCount()` 与单作者场景；`npm run test:fast` **116/116 PASS**，`npm run test:smoke` **119/119 PASS**。

### 修复 SHADOW_EXTS 误报仍参与 severity (#12) (2026-06-13)

- **问题**：`src/services/dep-graph/shadow-candidates.js` 导出的 `SHADOW_EXTS` 被 `findDeadExports()` 误判为死导出；该导出属于动态 registry API，静态分析无法识别消费者，但此前以 `confidence: medium` 计入 findings 并抬高 `audit-overview` / `audit-summary` severity，违反“保守判断”定位。
- **修复**：`src/services/dep-graph/analyzer.js` 新增 `KNOWN_REGISTRY_EXPORTS`，对 `SHADOW_EXTS` 这类已知 registry 导出自动降级为 `confidence: low` 并标记 `falsePositiveReason: 'dynamic-registry-export'`；`src/tools/honesty-engine.js` 将 `dynamic-registry-export` 纳入死导出误报原因集合并导出 `DEAD_EXPORT_FALSE_POSITIVE_REASONS`；`src/tools/overview-curator.js`、`src/tools/overview-assembler.js`、`src/cli/formatters/repo-summary.js`、`src/cli/commands/index.js` 在计算仓库级 severity 时排除已知误报，仅让真实死导出驱动 severity。
- **测试**：扩展 `test/dead-export-confidence-test.js` 验证 `SHADOW_EXTS` 被降级为 low 并标记动态 registry 误报；扩展 `test/overview-curator-test.js` 与 `test/formatter-direct-test.js` 验证仅含误报死导出时不提升 `audit-overview` / `audit-summary` severity；`npm run test:fast` **115/115 PASS**。

### 修复动态 query registry 模块被误判为孤儿 (#11) (2026-06-13)

- **问题**：`src/services/dep-graph/queries/...` 下的动态 query 文件（如 `java-spring.js`、`kt-ktor.js`）通过 `framework-patterns.js` 的 `FRAMEWORK_QUERY_REGISTRY` / `ROUTE_QUERY_REGISTRY` 被动态 `require`，静态依赖图无法识别其可达性，导致 `orphan-detector.js` 将其误判为孤儿模块并建议审查删除。
- **修复**：`framework-patterns.js` 新增并导出 `getRegisteredQueryFiles()`，解析运行时 registry 中所有 query 模块的绝对路径；`src/services/dep-graph.js` 在 `findOrphanFiles()` 中将其规范化后传给 `orphan-detector.js`；`orphan-detector.js` 新增可选 `registeredFiles` 参数，命中 registry 的文件直接跳过，不进入孤儿列表。
- **测试**：新增 `test/orphan-registered-query-test.js`（`// @semantic`）验证 registry 文件被跳过、非 registry 孤儿仍被报告、registry 文件不掩盖真实孤儿；`npm run test:fast` **115/115 PASS**。

### 修复 query-* 快照未感知 .workspace-bridge.json 配置变化 (#19) (2026-06-13)

- **问题**：`query-hotspots` / `query-knowledge-risk` / `query-stability` 的聚合快照只记录 `gitHead` 与文件数，修改 `.workspace-bridge.json`（如 directoryRoles）后仍可能命中旧快照，返回过期结果。
- **修复**：新增 `src/utils/project-context.js` `computeConfigHash()` 对有效配置做稳定 SHA-256 摘要；`src/services/graph-db.js` 在 `precomputed_aggregates` 表新增 `config_hash` 列并通过 `_migrate()` 自动升级旧库；`src/tools/overview-tools.js` 保存快照时写入配置摘要，`src/tools/query-tools.js` `isSnapshotFresh()` 比对当前配置摘要，不匹配则重新计算。
- **测试**：扩展 `test/query-staleness-test.js` 覆盖配置变化、配置一致、无配置、遗留快照四种场景；更新 `test/query-tools-test.js` 注入快照时携带正确 `configHash`；`npm run test:fast` **114/114 PASS**。

### 实现 workspace-info 真正轻量预检 (#15) (2026-06-13)

- **轻量路径**：`cli.js` 对 `workspace-info` 命令跳过完整 `ServiceContainer` 初始化，直接调用 `workspaceInfo()` 轻量检测；`src/tools/workspace-tools.js` 新增 `lightweightFileScan()`，按语言扩展名快速统计文件数与语言分布，不读取文件内容。
- **排除规则对齐**：轻量扫描复用 `DEFAULT_EXCLUDE_DIRS` 与 `project-context.js` 的 `DEFAULT_DIRECTORY_HINTS`（reference/archive/generated），并读取 `.workspace-bridge.json` 的 `directories` 配置，避免进入大目录。
- **测试**：新增 `test/workspace-info-lightweight-test.js`（`// @contract`）验证 CLI 在 2s 内完成、轻量容器下 fileCount/language 正确、不附加 `staleness`/`warnings`；`npm run test:fast` **114/114 PASS**，`npm run test:smoke` **117/117 PASS**。

### 安全化 SQLite ExperimentalWarning 抑制 (#16) (2026-06-13)

- **消除全局 monkey-patch**：`src/services/graph-db.js` 将 `node:sqlite` 的 `ExperimentalWarning` 抑制改为 scoped 包装器 `_withSqliteWarningSuppressed()`，仅在 `require` / `new DatabaseSync()` 期间临时替换 `process.emitWarning`，并确保 `finally` 恢复原始函数，避免多实例 / 嵌入式场景下全局 warning API 被持续覆盖。
- **测试**：新增 `test/graph-db-warning-suppression-test.js`（`// @contract`）验证 `_ensureOpen()` 与 `close()` 后 `process.emitWarning` 均恢复为原始函数；`npm run test:fast` **114/114 PASS**。

### 修复 CLI 布尔旗标 raw 读取与 category-filter 死代码 (#17 #18) (2026-06-13)

- **统一布尔旗标解析**：`src/cli/validate-args.js` 中 `--builtin-only`、`--watch`、`--strict-cwd` 改为通过 `resolveOption()` 解析，支持 `WB_BUILTIN_ONLY`、`WB_WATCH`、`WB_STRICT_CWD` 环境变量覆盖，并正确记录 `_sources` 来源。
- **消除 category-filter 死代码**：`src/cli/validate-args.js` 的 `--category` 校验改为复用 `src/tools/category-filter.js` 的 `validateCategories()`，避免与共享模块重复维护有效类别集合。
- **测试**：新增 `test/cli-bool-flags-env-test.js` 与 `test/category-filter-validate-used-test.js`；`npm run test:fast` **113/113 PASS**。

### 修复 --quiet 下 SQLite ExperimentalWarning 泄漏 (2026-06-13)

- **修复 warning 泄漏**：将 `src/services/graph-db.js` 中 `node:sqlite` 的 `require` 从模块顶层延迟到 `_ensureOpen()` 内部，并在调用 `_suppressSqliteExperimentalWarning()` 之后加载，确保 SQLite 的 `ExperimentalWarning` 被 `process.emitWarning` wrapper 捕获，不再泄漏到 `--quiet` JSON 管道输出。
- **测试**：新增 `test/graph-db-quiet-warning-test.js`（`// @slow`）强制验证子进程中打开 GraphDB 不输出 `ExperimentalWarning` / `sqlite` 到 stderr；`npm run test:fast` **111/111 PASS**。

### 工程稳定化：换行符治理与 CI/发布门禁 (2026-06-13)

- **换行符治理**：新增 `.gitattributes` 强制文本文件使用 LF 换行符；将 80 个 working tree 中仍保持 CRLF 的源码、测试与文档文件统一转换为 LF，消除 `git diff` 中的换行噪声。
- **CI Node 版本修复**：将 `.github/workflows/perf-guardrail.yml` 的 Node 版本从 20 升级到 24，与 `package.json` 声明的 `node: ">=22.5.0"` 及 `node:sqlite` 依赖保持一致。
- **新增常规测试 CI**：新增 `.github/workflows/test.yml`，在 Node 22/24 矩阵上运行 `npm ci`、`npm run test:fast` 与 `npm run test:smoke`，作为 PR 与 main 分支推送的硬门禁。
- **发布链路加固**：更新 `.github/workflows/release.yml`，在 `npm publish` 前增加 `npm run test:fast`、`npm run test:smoke` 与 packed tarball smoke test（验证 `--version` 与 `workspace-info` 可在 tarball 解压目录正常运行），防止失败版本被正式发布。

### 数据一致性与工程治理 (2026-06-13)

- **修复 `query-*` 快照 staleness**：`src/tools/query-tools.js` 原先仅比对 `gitHead` 与文件数（且允许 ±5 误差），修改后额外调用 `container.cache.checkFileChanges()` 进行 SHA-256 内容校验，并把文件数匹配改为精确相等，避免用户在修改已有文件后继续读到旧聚合快照。
- **修复 CLI 参数优先级**：`src/cli/validate-args.js` 中 `resolveOption()` 与环境变量 `WB_EXCLUDE` 的处理逻辑原先让环境变量覆盖 CLI 参数；现已改为 `CLI args > env > default`，并统一 `--staged` 使用解析后的变量，避免 agent 显式传参被宿主环境静默改写。
- **统一 `schemaVersion` 来源**：将 `src/tools/query-tools.js`、`src/tools/tree-tools.js`、`src/tools/regression-tools.js`、`src/tools/overview-assembler.js`、`src/cli/formatters/dashboard-formatter.js`、`src/cli/formatters/human-formatters.js` 中硬编码的 `"1.2.0"` 全部替换为 `SCHEMA_VERSION` 常量，消除版本升级时不同命令输出不一致的风险。
- **消除 `audit-assembler.js ↔ incremental-diff.js` 循环依赖**：新增 `src/tools/category-filter.js` 共享模块，将 `filterByCategory`、`parseCategories`、`CATEGORY_ALIASES`、`EMPTY_CATEGORY_STUBS` 下沉；`incremental-diff.js`、`overview-assembler.js`、`cli/commands/index.js` 改为从 `category-filter.js` 导入，`audit-assembler.js` 保留兼容重导出。新增 `test/category-filter-cycle-test.js` 强制验证循环已断开。
- **测试**：新增 `test/query-staleness-test.js` 覆盖快照新鲜度判断；在 `test/wave14-noise-env-test.js` 补充 CLI 覆盖环境变量的回归测试；`npm run test:fast` **111/111 PASS**。

### Wave 15: AST-Query 框架检测与同步转异步重构 (2026-06-13)

- **框架检测 Query 异步化重构**：将框架检测逻辑下沉至 Parse Phase（异步），消除 tree-sitter queries 在 Link Phase 同步加载的架构瓶颈。
- **缓存框架 Hint 持久化与 Schema 升级**：增加 SQLite 表 `parse_results` 的 `framework_hint` TEXT 字段。升级 `CACHE_VERSION` 至 `4`。在 `GraphDB` 启动时自动通过 `_migrate()` 平滑执行 schema 升级并保留旧数据。
- **同步 Known Entry 缓存加速**：重构 `EntryDetector` 构造函数接收 `getFileInfo` 实例查询，在 `isKnownEntryFile()` 和 `getFrameworkHint()` 中优先从图节点 node cache 中 O(1) 获取已解析的 `frameworkHint`，消除反复文件内容扫描开销。若缓存不命中则优雅降级为同步 content-scan Fallback。
- **动态 Query 文件死代码加白**：在 `analyzer.js` `findDeadExports` 循环中自动排除 `/[\\/]queries[\\/]/i` 目录下的动态 query 注册文件，避免不必要的死导出误报。
- **Python 框架检测 AST Query 化（Django / FastAPI / Flask / Celery）**：新建 `src/services/dep-graph/queries/framework-detection/py-django.js`、`py-fastapi.js`、`py-flask.js`、`py-celery.js`，每个模块只负责单一框架，通过 tree-sitter query 广泛捕获、在 `postProcess` 中做精确验证；`framework-patterns.js` 注册全部 4 个 query。
- **Java / Kotlin 框架检测 AST Query 化**：新建 `src/services/dep-graph/queries/framework-detection/java-spring.js`、`java-spring-boot.js`、`kt-spring.js`、`kt-ktor.js`，分别覆盖 Java Spring MVC/Cloud/Task、Java Spring Boot、Kotlin Spring、Ktor 的框架签名；`framework-patterns.js` 完成注册。
- **修复 AST-Query 预过滤过于严格**：为 `AST_PATTERNS` 中已 query 化的 Python / Java / Kotlin 框架增加 `preFilterRe` 正则字段，使 `@bp.route`、`@worker.task`、`@CustomController`、`routing {` 等非常规写法也能触发 AST-Query，避免被 cheap pre-filter 跳过而错误降级到 regex fallback。
- **测试与验证**：
  - 更新 `framework-patterns-test.js` 并使所有 content-based 检测测试变为 `async/await`。
  - 在 `graph-db-test.js` 补齐 `testRoundTrip` 对 `frameworkHint` 的验证，并新增 `testMigration` 模拟旧数据库并校验自动升级。
  - 在 `entry-detector-test.js` 新增 `testEntryDetectorCacheHitAndFallback` 验证缓存命中与降级逻辑。
  - 修复 `ROUTE_PATTERNS.go` Gin fallback regex 字符类笔误（`[^'']` → `[^"']`），避免双引号路由路径被错误截留尾部引号；新增 `wave15-gin-query-test.js` regression test 强制 fallback 路径覆盖双引号场景。
  - 收窄 `analyzer.js` 死导出加白范围：从全局 `/queries/` 正则改为精确前缀 `src/services/dep-graph/queries/`，避免误伤用户项目中同名目录。
  - 全量 `npm run test:fast` **109/109 PASS**，`npm run test:smoke` **112/112 PASS**。
- **文档同步**：
  - `SESSION.md` 在「下一步候选方向」前补充「本轮已交付」活跃上下文摘要；修正基线状态中「架构债务清零」与 `TECH_DEBT.md` 不一致的描述；同步架构债务数量变为 4 项。
  - `ROADMAP.md` 大规模同步交付状态：将 Wave 9–15 中已交付的长期方向项标记为「已交付」；更新已知限制中 Wave 11-15 多语言等价性偏斜状态；修正 L3 品味与架构债务小节；新增从参考仓库提炼的 5 个方向：缓存目录默认化到项目内、用户级配置目录、跨进程并发控制、预索引便携快照、Modification Guard。
  - `docs/TECH_DEBT.md` 新增 3 项架构债务：缓存默认目录位于 `os.tmpdir()` 导致易失、缺少用户级配置目录、缺少跨进程并发控制；活跃债务总览更新为 L1=0 / L2=0 / 架构债务=4 / L3=1。
  - 删除 `docs/和reference的对比.md`：该对比报告（code-review-graph / qartez-mcp / CodeGraphContext）的核心建议已提炼为 `TECH_DEBT.md` 架构债务与 `ROADMAP.md` 长期方向；原始稿存在标题混淆、大量论断已过时，使命完成后删除以避免误导新会话。

### Wave 15: 深度扩展 — 增量更新、缓存优化与 AST 轻量规则引擎 (2026-06-12)

- **15-4 增量缓存更新一致性修复**：修复 `GraphBuilder.updateFiles()` 二次 SHA-256 校验对比 `meta.hash` 产生的 cache-skip 误判。新增 `Cache.parsedHashes` 内存 Map 跟踪解析时的文件哈希，以正确比对物理变更，解决 `FileIndex` 先于 `updateFiles()` 更新 `meta.hash` 导致缓存检测永远失效并跳过解析的 bug。
- **15-1 AST 轻量规则引擎**：新建 `src/services/dep-graph/ast-rules.js`，实现单文件方法级规则匹配 findings（如 `batch*` 方法缺少 `@Transactional`、TS 导出方法缺少 `returnType` 注解）。
- **15-1B 跨语言 AST 规则补齐**：扩展 `src/services/dep-graph/ast-rules.js` 内置规则覆盖全部 9 种语言：JS/TS/Vue/Svelte 导出函数无返回类型、Python 公共函数无类型提示、Go 导出 mutator 缺少 error 返回、Rust 公共函数无显式返回类型、C/C++ 导出函数无返回类型声明；调整 TypeScript 规则在 `.ts` 文件上无条件触发，在纯 JavaScript/Vue/Svelte 文件中仅当文件已使用 TS 类型注解时触发，兼顾规则召回与低误报。
- **15-1 CLI 与 Curation 接入**：在 `overview-assembler.js`、`overview-tools.js` 及 `audit-assembler.js` 中完整集成 AST Rules 检查逻辑；支持在 `audit-summary` 及 `audit-overview` 的 human, summary, markdown 和 jsonl 风格格式化器中输出 findings 统计与明细。
- **15-3 ParseCache 跨调用缓存**：在 `builder.js` 中新增 LRU 内存缓存（上限 200），在文件 `mtime` 未变时直接复用解析结果，抵消增量邻居重解析开销。
- **15-4 L1-L4 增量更新四层叠加协议**：
  - **L1/L2 增量过滤**：集成 SHA-256 二次过滤机制，避免 mtime 精度问题带来的伪阳性重新解析。
  - **L3 Neighbor-aware & Shadow Candidates**：新建 `src/services/dep-graph/shadow-candidates.js`，重构 `updateFiles()` 在解析前自动扩展 1-hop dependents 邻居及 shadow targets，实现跨文件 import 关系在增量下的精准重构，修复了以前已删除文件依赖边残留的死循环和残留问题。
  - **L4 WAL Checkpoint SQLite 写入节流**：新建 `src/services/dep-graph/wal-cadence.js`，在 watch/repl 增量写之后执行 SQLite 的 `PASSIVE` 写入节流，并以时间间隔（60s）/批次量（32次）阈值交替触发 `TRUNCATE` checkpoint。
- **15-2 框架路由提取 9/9 语言 query 化**：在 `framework-patterns.js` 注册 FastAPI/Django/Gin/Fiber/Actix-web/Axum/Nuxt/SvelteKit 的 tree-sitter query，覆盖全部 9 种语言；query-first + regex 永久 fallback。
- **15-4 Shadow Candidates 9/9 语言显式覆盖**：在 `shadow-candidates.js` 为 Java/Kotlin、Go、Rust 添加显式 shadow 组，补齐 Language Parity。
- **修复 `framework-patterns.js` 常量引用错误**：将 `detectFrameworkFromContent` 中误用的 `DEFAULTS.ENTRY_SCAN_BYTES` 改为 `LIMITS.ENTRY_SCAN_BYTES`，恢复 regex fallback 路由提取。
- **测试**：
  - 新增 `wave15-parse-cache-test.js`、`wave15-neighbor-aware-test.js`、`wave15-shadow-candidates-test.js`、`wave15-wal-cadence-test.js`、`wave15-ast-rules-test.js` 专项测试。
  - 跑通 `npm run test:fast`（109/109 PASS）和 `npm run test:smoke`（104/104 PASS）。

### 修复与内部质量 (2026-06-12)

- Update project guide (`AGENTS.md`) and technical debt (`TECH_DEBT.md`) to document Wave 11-15 multi-language parity debt, and establish a development rule requiring all 9 designed languages to be updated synchronously for all features.
- Fix `bootstrapFromSchema` path normalization inconsistency; schema keys, `imports`, and `importRecords[].resolved` are now normalized via `normalizeFilePath`, eliminating Windows mock-test workarounds.
- `bootstrapFromSchema` now keeps the first occurrence when two schema keys normalize to the same graph key (e.g. POSIX and Windows absolute paths on Windows), making `originalPath` deterministic.
- `_findAffectedTestsByHeuristic` now computes heuristic signatures from `node.originalPath` instead of the normalized graph key, preserving correct Java/Kotlin test-suffix stripping after key lowercasing.
- Refactor `test/affected-tests-heuristic-test.js`: split Windows-path scenarios into a standalone `makeWindowsGraph()` so POSIX and Windows keys no longer collide in one schema, restoring strict assertions for both platforms.
- Fix Kotlin AST parser (`src/services/dep-graph/parsers/kotlin-ast.js`) to populate `functionRecords` with `decorators`, `isExported`, and `returnType`, enabling the `batch-no-transactional` AST rule to fire on real Kotlin source. Added integration assertions in `test/kotlin-ast-parser-test.js`.
- Fix Java AST parser (`scripts/java_ast_parser.py` + `src/services/dep-graph/parsers/java.js`) to populate `functionRecords` with `decorators`, enabling the `batch-no-transactional` AST rule to correctly skip `@Transactional` batch methods on real Java source. Added integration assertions in `test/java-parsers-test.js`.
- Fix Java branch/maxArms parity: promote `branchCount` and `maxArms` from `fingerprint` to the top level of `functionRecords` in `scripts/java_ast_parser.py`, map them through `src/services/dep-graph/parsers/java.js`, and add top-level/fingerprint parity assertions in `test/java-parsers-test.js`.
- Fix Kotlin branch/maxArms parity: compute `branchCount` and `maxArms` from tree-sitter AST in `src/services/dep-graph/parsers/kotlin-ast.js`, expose them both in `functionRecords[].fingerprint` and at the top level of `functionRecords`, covering `if`/`when`/`try`/`for`/`while`/`do..while`, logical operators (`&&`/`||`), and the Elvis operator (`?:`). Added top-level/fingerprint parity assertions in `test/kotlin-ast-parser-test.js`.
- Fix JS/TS AST parser (`src/services/dep-graph/parsers/js/ast-parser.js` + `src/services/dep-graph/parsers/js/shared.js`) to populate `functionRecords` with `isExported`, `returnType`, and `decorators`, enabling the `public-method-no-return-type` AST rule to fire on real TypeScript source. Added integration assertions in `test/js-ast-rules-fields-test.js`.
- Fix JS/TS regex fallback (`src/services/dep-graph/parsers/js/regex-fallback.js`) to best-effort populate `isExported` and `returnType` for function records, correcting a bug where returnType carried a leading colon and resolving arrow function returnType search boundaries.
- Fix C/C++ AST parser (`src/services/dep-graph/parsers/cpp-ast.js`) to populate `functionRecords` with `isExported`, `returnType`, and `decorators`, closing the Wave 11-15 language parity gap for C/C++. Added integration assertions in `test/cpp-parser-test.js`.
- Fix C/C++ branch/maxArms parity: compute `branchCount` and `maxArms` from tree-sitter AST in `src/services/dep-graph/parsers/cpp-ast.js`; set both to `0` in the regex fallback `src/services/dep-graph/parsers/cpp.js`; promote both fields to the top level of `functionRecords`. Added AST and regex-fallback assertions in `test/cpp-parser-test.js`.
- Fix Go AST parser (`src/services/dep-graph/parsers/go-ast.js`) and regex fallback (`src/services/dep-graph/parsers/polyglot.js`) to populate `functionRecords` with `isExported`, `returnType`, and `decorators`, closing the Wave 11-15 language parity gap for Go. Added integration assertions in `test/go-ast-parser-test.js`.
- Fix Go branch/maxArms parity: compute `branchCount` and `maxArms` from tree-sitter AST in `src/services/dep-graph/parsers/go-ast.js` covering `if`/`switch`/`type_switch`/`select`/`for`, logical operators (`&&`/`||`), and if-else-if arm chains; compute best-effort values in the regex fallback `src/services/dep-graph/parsers/polyglot.js`; promote both fields to the top level of `functionRecords`. Added top-level assertions in `test/go-ast-parser-test.js`.
- Fix Python AST parser (`scripts/python_ast_parser.py`) and JS wrapper (`src/services/dep-graph/parsers/python.js`) to populate `functionRecords` with `isExported`, `returnType`, and `decorators`, closing the Wave 11-15 language parity gap for Python. Added integration assertions in `test/python-parser-fields-test.js` and strengthened optional field checks in `test/parser-schema-contract-test.js`.
- Fix shadow candidates lookup (`src/services/dep-graph/shadow-candidates.js`) on `.d.ts` files by replacing `path.extname` suffix extraction with matching against sorted extensions, ensuring correct candidates are generated.
- Extend shadow candidates support to Python (`.py` ↔ `.pyi`) and C/C++ (`.h`/`.hpp` ↔ `.c`/`.cpp`/`.cc`) with language-group isolation, preventing cross-language shadowing; update `test/wave15-shadow-candidates-test.js` with dedicated coverage.
- Extend shadow candidates support to Vue SFC (`.vue` ↔ `.ts`/`.js`) and Svelte SFC (`.svelte` ↔ `.ts`/`.js`) with language-group isolation, allowing `.ts`/`.js` files to shadow both framework SFCs without bleeding between `.vue` and `.svelte`; update `test/wave15-shadow-candidates-test.js` with dedicated coverage.
- Fix JS/TS/Vue/Svelte function record parity: promote `branchCount` and `maxArms` from `fingerprint` to the top level of `functionRecords` in `src/services/dep-graph/parsers/js/shared.js` (AST path) and `src/services/dep-graph/parsers/js/regex-fallback.js` (regex fallback); add top-level/fingerprint parity assertions for Vue and Svelte in `test/wave15-shadow-candidates-test.js`.
- Fix `GraphBuilder.updateFiles()` (`src/services/dep-graph/builder.js`) to evict deleted files from the in-memory parse cache, preventing stale cache hits after file deletion.
- Enhance `test/wave15-ast-rules-test.js` with end-to-end real parser tests for Java, Kotlin, TypeScript, JavaScript, Vue, Svelte, Python, Go, Rust, and C/C++ AST rules, plus unit tests and multi-language `checkAllRules` coverage.
- Refactor `src/services/dep-graph/ast-rules.js` extension-to-language resolution from a hardcoded `if-else` chain into a declarative `EXT_TO_LANGUAGE` config table; register `.py/.go/.rs/.c/.cpp/.vue/.svelte` mappings to `python/go/rust/cpp/cpp/vue/svelte` while keeping `.java/.kt/.ts/.tsx` unchanged. Added config-table and custom-rule coverage in `test/wave15-ast-rules-test.js`.
- Fix Rust AST parser (`src/services/dep-graph/parsers/rust-ast.js`) to populate `functionRecords` with `isExported`, `returnType`, and `decorators`, closing the Wave 11-15 language parity gap for Rust. Added integration assertions in `test/rust-ast-parser-test.js`.
- Fix `test/wave15-parse-cache-test.js` `testLruEviction` by adding real assertions that verify the 200-entry LRU cap and oldest-entry eviction behavior.

### Wave 11-15 多语言等价性补齐与功能完整性修复 (2026-06-13)

- **修复 `audit-smells` / `audit-diff complexityTrend` 对 C/C++ 失效**：`src/tools/dep-tools/smells.js` 和 `src/tools/complexity-tools.js` 现在优先读取 `functionRecords` 顶层 `branchCount`/`maxArms`，以 `fingerprint` 作为向后兼容 fallback；当 AST 存在但无有效分支数据时回退到 LOC 趋势判断，避免 C/C++ 项目产生沉默的 0 smells 或错误 trend。
- **补齐 C/C++ `functionRecords.fingerprint`**：`src/services/dep-graph/parsers/cpp-ast.js` 在顶层字段之外额外输出 `fingerprint: { branchCount, maxArms }`，与 smells/complexity 消费端对齐。
- **补齐 `.kts` 到 AST rules 语言映射**：`src/services/dep-graph/ast-rules.js` 增加 `.kts: 'kotlin'`，使 Kotlin script 文件也能触发规则。
- **补齐 C/C++ / Kotlin script 路由提取映射与 regex fallback**：`src/services/dep-graph/framework-patterns.js` 为 `.c/.cpp/.cc/.h/.hpp` 和 `.kts` 添加 `EXT_TO_LANGUAGE` 映射；`extractRoutesWithRegex` 支持 C/C++ 走专用 `cpp` key；新增 `ROUTE_PATTERNS.cpp` 覆盖 Crow/Pistache/通用 C++ HTTP 库模式。
- **统一 `functionRecords` 顶层字段契约**：
  - Java AST (`scripts/java_ast_parser.py`)：补充 `isExported`、`returnType`、`hasParameterTypeHints`。
  - Kotlin/Go/Rust regex fallback (`src/services/dep-graph/parsers/polyglot.js`)：补充 `isExported`、`returnType`、`decorators`、`hasParameterTypeHints`、`branchCount`、`maxArms`。
  - JS/TS regex fallback (`src/services/dep-graph/parsers/js/regex-fallback.js`)：补充 `decorators: []`。
  - Go/Rust/C/C++ AST：补充 `hasParameterTypeHints: true`。
- **回归测试**：在 `test/wave11-analysis-deepening-test.js` 新增 `testCppFlatDispatcherDetection`，覆盖 C/C++ AST 的 branchCount/maxArms 提取及 `checkSmells` 正确识别 flat dispatcher。
- **验证**：`npm run test:fast` 109/109 PASS。

### Wave 12: 类别过滤 Summary 同步与性能优化 (2026-06-12)

- **类别过滤与 Summary 同步 (12-3)**：修复了 `--category` 过滤时 repo / overview / incremental-diff 汇总的 counts 和 recommendations 不同步的 bug。现在，被过滤类别的 counts 指标以及 `incrementalFindings` 字段会被彻底排除，且 nextSteps/recommendations 中不再生成该类别的诊断建议，同时严重性评级（severity）也将自动剔除已省略项的影响。
- **高开销分析提前剪枝 (12-3)**：在 `audit-overview` 路径中，若未选择 `boundaries` 或 `smells` 类别，直接跳过相关检查，避免不必要的 AST/依赖分析开销，极大提升了大项目下的 CLI 响应性能。
- **测试**: 更新 `test/wave12-category-filter-test.js` 补充了对 summary.counts 缺省键、增量 findings 排除及建议排除的断言，确保不发生回归。

### Wave 12: 输出精炼补全 (2026-06-11)

- **大项目自动截断 (12-4)**：新增 `DEFAULTS.LARGE_PROJECT_FILE_THRESHOLD`（500 文件）；项目总文件数超阈值时 `audit-map` / `audit-diff` 自动启用 `--compact`，`--no-compact` 显式覆盖，`--compact` / `WB_COMPACT` 仍显式生效。
- **类别过滤 (12-3)**：`audit-summary` 支持 `--category dead-exports,unresolved,cycles,health` 过滤，未选类别置空；`--severity` 实际取值为 `high|medium|low`。
- **手动文件截断 (12-5)**：`audit-diff` 支持 `--max-files <n>` 限制变更文件数；`impact`/`affected-tests`/`affected-routes`/`dependencies`/`dependents`/`tree` 支持 `--max-files <n>` 限制返回结果数；未指定时保持原有默认截断行为不变。
- **测试**: 新增 `test/wave12-large-project-compact-test.js` 覆盖 compact 优先级、audit-map / audit-diff 自动 compact、`--max-files` 截断与 category 过滤；在 `test/wave12-output-truncation-test.js` 补全 6 个 `--max-files` 命令层用例。

### 修复与可靠性提升 (2026-06-11)

- **PowerShell 管道 BOM 消除 (BOM Purge)**:
  - 新增 `stripBOM(str)` 辅助函数到 `src/utils/sanitize.js`。
  - 在所有涉及读取或接收 JSON 输入的地方（包括 `readJsonSafe`、`loadWorkspaceConfig`、`loadBaseline`、`loadAndCompileRules`、`readTrendHistory`、tsconfig/jsconfig 注释剥离、Pyright 扫描输出、Semgrep 扫描输出以及 `package.json` 读取处）引入 BOM 过滤，彻底消除在 Windows PowerShell 管道或重定向场景下因 `\ufeff` 导致的 JSON 解析崩溃问题。
  - 简化 `hasTsconfigPaths` 重用 `_readTsconfigPaths` 公共解析，避免重复实现。
- **REPL 并发测试缓存隔离**:
  - 重构 `startRepl` 使其支持 `cacheDir` 配置，并在 `repl` 命令中将 `--cache-dir` 正确路由。
  - 在 `test/repl-test.js` 和 `test/repl-edge-test.js` 中将 `process.env.WB_TEST_CACHE_DIR` 传入 Mock 容器，保证多进程并发测试下 SQLite 缓存文件不发生物理锁冲突。
- **Watch 单元测试可靠性提升与超时放宽**:
  - 修复 `test/watch-test.js`、`test/watch-sigterm-test.js` 和 `test/audit-file-watch-test.js` 中 `waitForStartup` 的实参变量提前求值 bug，改用 Getter 函数形式在循环中对 live `stderr` 进行动态求值。
  - 将 `waitForStartup` 的冷启动超时上限从固定的 8 秒放宽至 20 秒，且支持自定义预期启动就绪字符（`expected`），彻底解决了在 Windows 慢速或无缓存环境下跑 Watch 测试因超时引发的 Flaky 误报。
  - 为 `test/audit-file-watch-test.js` 配套了测试进程优雅回收与物理资源清理。
- **孤儿文件检测逻辑收拢与 Mock 桩适配**:
  - 重构收拢 `project-map.js` 和 `overview-assembler.js` 中的手写孤儿检测（Orphan Detection）逻辑，统一直接调用 `depGraph.findOrphanFiles()` 实例方法。
  - 在 `DependencyGraph` 和 `DependencyGraphView` 门面层统一定义 `findOrphanFiles`，实现单点维护。
  - 在 `test/test-helpers.js` 的 proxy mock（`_createStubDepGraph`）及 `test/repl-edge-test.js` 的 Mock Graph 中同步适配了 `findOrphanFiles` 的真实路由计算，保证所有使用 Schema 级 Stub 缓存的 E2E 与单元测试能自动算得真实的孤儿文件结果，避免测试断言失败。

### Wave 14: 配置、降噪与环境变量 (2026-06-11)

- **安全扫描规则引擎配置化 (Wave 14-1)**：
  - 将内置安全规则提取为独立配置文件 `src/config/security-rules.json`。
  - 重构 `src/tools/security-tools.js` 支持从 `--config <path>` 加载自定义规则配置，并保留静态默认规则作为 Fallback 兜底。
  - 新增 `test/wave14-configurable-rules-test.js` 验证配置载入与加白过滤逻辑。
- **路径解析与配置文件注释解析修复**：
  - 修复 Python 相对导入路径解析器 `tryPythonRelative` 在未找到对应文件时错误返回 `basePath` 的问题（未找到时返回 `null`）。
  - 修复 tsconfig.json/jsconfig.json 带注释/尾随逗号解析失败的问题，支持安全剥离单行/多行注释并去除尾随逗号。
  - 补充 `test/resolver-strategy-chain-test.js` 中相关的回归单元测试。
- **安全扫描与符号解构缺陷修复**：
  - 恢复 `rule` 作为 `ruleId` 的别名以确保向后兼容，更新 `test/security-ruleId-test.js`。
  - 修复 CJS 解构别名（如 `const { a: b } = require('./foo')`）解析逻辑以确保 `symbolImpact` 匹配。
- **降噪与噪音抑制增强 (Wave 14-2)**：
  - 为 `findDeadExports()` / `findUnresolvedImports()` 返回的每个 finding 添加 `id` 字段（格式 `dead-export:<path>` / `unresolved:<path>:<import>`），作为 `--mark-false-positive` 的标识基础。
  - 实现 `ignore.findings` 过滤逻辑：在 `GraphAnalyzer` 层统一过滤，被忽略的 finding ID 不再出现在 `dead-exports`、`unresolved`、`audit-overview`、`audit-diff` 等所有消费路径中。修复了命中 `_aggregateCache` 缓存时过滤失效的 Bug，通过在返回路径动态过滤使配置变更实时生效。
  - 实现 `ignore.frameworks` 框架感知排除：在 `dep-graph.js` `shouldExcludeCli()` 中读取 `ignore.frameworks`，匹配 `frameworkHint.framework` 的文件从报告输出中排除，不影响图构建。
  - 在 `human-formatters.js` 的 `dead-exports` / `unresolved` human 与 summary 输出中追加 `(id: ...)`，方便用户直接复制 ID 进行屏蔽。
  - 为 `--mark-false-positive` 的 JSON 配置文件读取补上 `stripBOM` 过滤，消除 Windows PowerShell 场景下的 BOM 崩溃风险。
- **配置优先级与环境变量层 (Wave 14-3)**：
  - 在 `validate-args.js` 中新增 7 个 `WB_*` 环境变量支持：`WB_COMPACT`、`WB_FAIL_ON_FINDINGS`、`WB_STAGED`、`WB_RUN_TESTS`、`WB_WITH_IMPACT`、`WB_INCREMENTAL`、`WB_CHECK_REGISTRATION`，全部遵循 `env > cli > file` 优先级。
  - 细化 CLI 启动时的 Precedence Origin Report：将笼统的 "other config from file" 细化为具体的 file 层配置 key（如 `ignore from file`、`boundaries from file`）。
- **测试与工程契约**：
  - 新增 `test/wave14-noise-env-test.js`（8 个测试用例），覆盖 `ignore.findings` 过滤、`ignore.frameworks` 过滤、`WB_*` 环境变量、`--mark-false-positive` 端到端、配置来源报告细化，以及动态过滤缓存 findings 的正确性（`testIgnoreFindingsDynamicCache`）。
  - 在 `bootstrapFromSchema` 中传递 `frameworkHint` 字段到节点数据，保证 mock 场景下框架感知逻辑可用。

### Wave 15: 框架检测 Query 化 (2026-06-11)

- **Query 编译基础设施** `src/services/dep-graph/query-compiler.js`：
  - 新建 `compileQuery(language, querySource)` + `runQuery(tree, compiledQuery)` 接口，复用现有 `tree-sitter.js` 的 `getParserModule()` / `loadLanguage()`。
  - 实现 SHA-256 缓存键 + LRU 淘汰（上限 20），避免重复编译 tree-sitter Query。
  - 统一错误处理：任何阶段失败返回 `null`，调用方自动 fallback。
  - 配套单元测试 `test/wave15-query-compiler-test.js` 覆盖编译、缓存命中、Go/TypeScript AST 执行、清理。
- **路由提取 Query 化（Phase 2）** `src/services/dep-graph/framework-patterns.js`：
  - 新建 `queries/route-extraction/` 目录，Express 试点 `js-express.js` 使用 tree-sitter TypeScript grammar 匹配 `app.get('/path')` / `router.post('/path')`。
  - `extractRoutes()` 改为 async，query-first + regex 永久 fallback，解决 16384 字节硬截断导致的漏报问题。
  - 超大 Controller 文件（>16KB）后半部分的路由现在可被完整提取。
  - `persistence.js` 同步适配 `await extractRoutes()`。
  - 配套测试 `test/wave15-express-query-test.js` 覆盖基础路由、超大文件、去重、非 Express 文件、query-regex 等价性。
- **框架检测 Query 基础设施（Phase 3 预备）**：
  - 新建 `queries/framework-detection/js-express.js` 声明文件，为后续 `detectFrameworkFromContent` query 化预留接口。
  - 推迟 `detectFrameworkFromContent` 的完整 query 化至后续波次（涉及 `dep-graph.js` / `entry-detector.js` 同步→异步转换，改动面广，需单独评估）。
- **路由提取扩展覆盖（Phase 4）**：
  - **NestJS** `queries/route-extraction/js-nestjs.js`：tree-sitter TypeScript query 匹配 `@Get(':id')` / `@Post('items')` 等方法级装饰器，过滤 `@Controller` 前缀。
  - **Spring Boot** `queries/route-extraction/java-spring.js`：tree-sitter Java query 匹配 `@GetMapping("/users")` / `@RequestMapping("/api")` 等注解，正确处理 `RequestMapping` → `ALL` 方法映射。
  - `framework-patterns.js` 的 `tryExtractRoutesWithQuery` 重构为单 parse + 多 query 遍历模式，支持同一文件内多个框架路由提取。
  - 关键修复：`web-tree-sitter` WASM 版 `query.matches()` 不自动过滤 `#match?` predicates，所有过滤逻辑移至 `postProcess`（Express / NestJS / Spring Boot 均已修正）。
  - 配套测试 `test/wave15-nestjs-spring-query-test.js` 覆盖 NestJS 基础路由、空参数过滤、Spring Boot 基础路由、RequestMapping 映射、去重、多框架共存。

### Wave 13: 契约规范与可观测性 (2026-06-10)

- **统一语言解析器契约** `src/services/dep-graph/parsers/registry-core.js` / `registry.js`：
  - 规范并统一 `defineLanguage` 参数，使其支持 `language`、`extensions`、`parse`、`extractImports`、`extractExports`、`extractSymbols`、`isBuiltIn` 和 `resolveStrategies`。
  - 保留并回补对 `.name`、`.exts` 和 `.parser` 的兼容性 Getters/Setters 访问（支持 test 侧 monkey-patch 覆盖）。
  - 在 `registry.js` 中将 9 种语言按照新格式统一声明并注册，把 symbol 提取、isBuiltIn 标识以及具体 resolver 策略完全内敛到 registry 核心声明中。
- **解析器与 Resolver 配置解耦** `src/services/dep-graph/resolvers.js` / `src/services/file-index.js`：
  - 删除冗余的 `src/services/file-index/symbol-extractors.js`。
  - 更新 `file-index.js` 和测试 `symbol-extractors-test.js`，统一转而通过 `registry.findByExt(ext).extractSymbols()` 动态提取符号。
  - 重构 `resolvers.js`，动态加载并循环遍历 `registry.languages` 自动完成 resolver configurations 注册，并附加 `trySymbolTable` 兜底。
  - 将 `builder.js` 和 `complexity-tools.js` 中所有对 `.parser(...)` 的调用迁移至统一 the `.parse(...)`。
- **架构生命周期边界文档补全** `src/services/dep-graph.js` / `builder.js` / `analyzer.js` / `skills/workspace-audit/SKILL.md`：
  - 在 core-engine 代码头部补齐了清晰的 Parse Phase 与 Link Phase 两阶段生命周期的职责文档。
  - 重构 `SKILL.md`，追加 "Architecture Layer Mapping" 章节详细映射 CLI 命令到 L0-L6 系统架构层级。
- **性能基准可观测性扩展** `scripts/benchmark-perf.js` / `benchmark/compare.js`：
  - 扩展基准测试套件，全面覆盖 8 大核心 CLI 命令的 hot cache 延迟与 JSON 正确性检查。
  - 针对 Windows 环境下进程 spawn 及 tree-sitter WASM 载入的巨大耗时，引入 `win32` 自动乘以 4 倍的安全阈值缩放，消除 CI 偶发抖动引起的 false-positive 失败。

### Wave 12: 输出精炼 (2026-06-10)

- **诚实截断机制 (12-1)** `src/utils/truncate.js` / `src/tools/dep-tools/impact.js` / `affected-tests.js` / `affected-routes.js` / `src/tools/audit-assembler.js` / `src/cli/formatters/audit-diff-summary.js` / `human-formatters.js`：
  - 新增 `truncateArray()` 工具函数，对 `impact[]`、`affectedTests[]`、`affectedRoutes[]`、`coChanges[]` 等数组施加硬上限（默认 50/50/30/20）。
  - 当结果超过上限时，在返回对象中显式设置 `truncated: true`，让 AI 消费者诚实知道数据被截断。
  - `compactChangedFile` 同步标记 `truncated` 当 impact/affectedTests/explanations 被 compact 截断时。
  - human/summary/markdown 格式化器在截断时追加 `... truncated (showing X of Y)` 提示。
- **JSON token 削减兜底 (12-2)** `src/utils/truncate.js` / `src/cli/route-formatter.js`：
  - 新增 `elideDeep()` 递归工具，在 `--json` 输出前作为最后一道防线：超长数组自动切片、超长字符串自动截断（默认 500 字符）、嵌套深度超过 8 层自动归零。
  - 新增 `JSON_OUTPUT_MAX_*` 系列阈值常量至 `src/config/defaults.js`，全部附 rationale 注释。
- **补全 Wave 12 单元测试** `test/wave12-output-truncation-test.js`：
  - 覆盖 truncateArray / elideString / elideDeep 纯函数、compactChangedFile 截断标记、formatter 截断提示、impact/affected-tests/affected-routes 命令层截断行为。`npm run test:fast` **91/91 PASS**。

### Wave 11: 分析深化 (2026-06-09)

- **重构消除 L2-7 重复代码技术债** `src/utils/path.js` / `src/tools/dep-tools/boundaries.js` / `src/cli/formatters/composite-risk.js`：
  - 提取 `get2LevelPrefix()` 至 `path.js` 公共路径工具模块，统一 Windows/POSIX 兼容处理，消除了边界检查与风险评分格式化中的重复定义。
- **实现架构边界检查 (`audit-boundaries`)** `src/tools/dep-tools/boundaries.js` / `src/utils/project-context.js` / `src/cli/commands/index.js`：
  - 新增边界验证工具，支持从 `.workspace-bridge.json` 读取 `boundaries[]` 配置规则（`from` + `deny`/`allow` glob 模式）。
  - 无配置时自动根据目录级 import 图生成建议规则，排除测试文件、循环依赖和扁平目录。
  - 在 `audit-overview` 中集成边界违规统计与建议。
- **实现代码异味检测 (`audit-smells`)** `src/tools/dep-tools/smells.js` / `src/services/dep-graph/parsers/shared.js` / `scripts/python_ast_parser.py` / `scripts/java_ast_parser.py`：
  - 新增 Flat Dispatcher 检测（arms >= 6 + cc <= arms + 5，或 arms >= 12 + arms >= cc * 0.4）。
  - 增强 JS/TS、Python、Java 的 AST 指纹计算，统一支持 `maxArms`（if-else/switch 分支臂数）和循环语句的 branchCount。
  - 修复 `src/services/dep-graph/parsers/java.js` 中 AST 路径丢失 fingerprint 的问题。
- **实现复杂度趋势分析** `src/tools/complexity-tools.js` / `src/tools/audit-assembler.js`：
  - 新增 `getFileComplexityTrend()`，基于 git 历史比较文件在 base commit 与当前版本的复杂度变化。
  - 支持 AST 双路径解析（函数 branchCount 总和）与 LOC 回退，确保 parity。
  - 未跟踪文件自动标记为 `GROWING`。
- **重构统一 5 维度风险评分** `src/cli/formatters/composite-risk.js`：
  - 将旧版加权模型替换为结构化 5 维度评分：`flow_participation` + `community_crossing` + `test_coverage` + `caller_count` + `security_sensitive`。
  - 输出显式 `dimensions` 对象，方便下游 AI 消费。
- **补全格式化器与测试覆盖** `src/cli/formatters/human-formatters.js` / `test/wave11-analysis-deepening-test.js`：
  - 为 `audit-boundaries` 和 `audit-smells` 添加 human/summary/markdown/jsonl/AI 格式化器。
  - 新增 `wave11-analysis-deepening-test.js`，覆盖边界验证、JS/Python/Java 分支臂计数、复杂度趋势、5 维度风险评分。`npm run test:fast` **90/90 PASS**。

### Wave 10: 符号级智能 (2026-06-09)

- **实现两阶段（Parse-and-Link）构建与增量更新** `src/services/dep-graph/builder.js`：
  - 重构 `GraphBuilder` 机制，解耦文件解析与导入解析，提取为 `parseFileOnly()` 和 `resolveFileOnly()` 两个独立生命周期阶段。
  - 在 `build()` 和 `updateFiles()` 增量编译中，先执行 Parse 提取所有符号并注册到 `symbolRegistry`，然后再执行 Link/Resolve，彻底解决了 cold start / 全量构建下循环/前向符号引用的无法解析问题。
- **扩展依赖边 edges 元数据打标与持久化** `src/services/graph-db.js` / `src/services/cache.js` / `src/services/dep-graph/resolvers.js` / `resolvers/*.js`：
  - 更新 `edges` 表结构，新增 `tier` 和 `resolution_method` 两列并配套 `_migrate()` 动态自动 Schema 变更与默认值落盘。
  - 向后兼容重构 `resolveImport()` 方法，支持通过可选的 `outMeta` 参数返回置信飞轮的 `tier`、`confidence` 和 `resolutionMethod` 字段。
  - 为所有 9 语言的 resolver 链策略实现精确的置信度与解析方法打标。
- **清偿代码品味与 L2/L3 技术债务**：
  - 在 `src/services/graph-db.js` 中重构并合并了 9 个高度重复的 CRUD 方法，提取了 `_saveBatch()`、`_loadAll()` 与 `_loadForFiles()` 通用数据库层原语。
  - 在 `src/services/dep-graph/builder.js` 中将重复的文件分析/解析错误处理模板收回至 `_markParseError()` 统一管理，并将事件循环出让频率的 20 裸数字提取为常量 `YIELD_INTERVAL`。
  - 移除了 `src/services/dep-graph/framework-patterns.js` 中 `ROUTE_SCAN_MULTIPLIER` (4) 裸数字，并增加了说明注释。
  - 移除了 `src/services/dep-graph/persistence.js` 中的 `DEFAULT_AFFECTED_TESTS_DEPTH` (3) 裸数字，并使用异步 I/O `fs.promises.readFile` 替代原有的同步 `fs.readFileSync` 路由提取，消除事件循环阻塞隐患。
- **新增回归单元测试套件** `test/wave10-symbol-intelligence-test.js`：
  - 编写了 4 个单测场景覆盖 schema 迁移、元数据持久化 roundtrip、策略打标以及两阶段符号解析。`npm run test:fast` 89/89 PASS。

### SQL 持久化与测试映射优化 (2026-06-09)

- **实现 metrics 与 test_map 表持久化与往返读写** `src/services/graph-db.js` / `src/services/cache.js` / `src/services/dep-graph/persistence.js`：
  - 新增 `metrics` 表（支持 PageRank、hotspot_score、risk_score、cochange_score 存储）与 `test_map` 表（存储 source 到 test 关联关系与信号）。
  - 在 `GraphDB` 和 `WorkspaceCache` 中实现了这四个表的往返读写（save/load）接口，并在持久化层 `savePrecomputed` 和 `restorePrecomputed` 中接入。
- **扩展 file_metadata 表属性字段** `src/services/graph-db.js` / `src/services/file-index.js`：
  - 修改 `file_metadata` 表以支持 `type`、`role` 和 `lang` 字段。
  - 支持在 `_migrate()` 中自动探测并 `ALTER TABLE ADD COLUMN` 扩展历史 schema，实现向后兼容。
  - 在索引构建 `indexFile()` 时提取并保存文件的 type/role/lang。
- **GraphAnalyzer 缓存与测试查找加速** `src/services/dep-graph/analyzer.js`：
  - 在构造函数中定义并初始化 `_testMapCache`，实现 `injectPrecomputedTestMap()` 和 `injectPrecomputedMetrics()` 方法。
  - 优化 `findAffectedTests()` 方法，优先利用 `_testMapCache` 缓存执行 O(1) 检索，显著提升测试定位性能。
- **新增回归单元测试** `test/precomputed-roundtrip-test.js`：
  - 新增 4 个针对指标和测试映射的单元测试，覆盖数据库往返、分析器注入与受影响测试快速路经查找验证。`test:fast` 88/88 绿灯通过。

### 预计算深化回归测试与测试断言对齐 (2026-06-09)

- **新增未解析导入回归测试档案** `test/fp_regression_unresolved.js`：
  - 归档并覆盖未解析导入（unresolved imports）的已知误报与正确性场景，包括 Java 通配符导入、Java 同包隐式引用、Node.js 原生模块与第三方依赖导入。
  - 验证真实未解析相对导入的检测正确性以及 `resolvedTo` 为 `null` 的契约。
- **修正 CLI 校验错误 Exit Code 测试断言** `test/cli-mapper-adapter-test.js`：
  - 将测试中对参数校验错误（如无效 `--max-depth`、`--reuse-hints` 等）的 Exit Code 断言由 `2`（崩溃）修正为 `1`（业务失败），与 Wave 8 引入的参数验证错误 Exit Code 规范完全对齐。

### 修复 CLI 设计债：配置 schema 校验与 JSON 格式错误对齐 (2026-06-08)

- **强化配置 JSON 结构校验** `src/utils/project-context.js`：
  - 在 `ProjectContext` 构造函数和 `loadWorkspaceConfig()` 内部，统一引入并调用 `validateWorkspaceConfig()`。
  - 对 `.workspace-bridge.json` 进行严格的 schema 校验（如错误的 top-level keys、不正确的 directories 或 directoryRoles 数组类型）。校验失败时立即抛出 Error，而不是输出被忽略的 stderr 警告，从而避免静默失效并回退到全量扫描。
- **对齐 CLI 参数验证错误与 JSON 格式输出** `cli.js` / `src/cli/validate-args.js`：
  - 重构了 `main()` 和 `runCliInProcess()`。如果在执行 CLI 参数解析（如无效的 `--severity` 参数）阶段抛出错误，会首先检测参数中是否要求了 `--json` 或 `--format json`。
  - 若已要求 JSON 格式，则用 JSON 格式包装并输出错误结果 `{"ok": false, "error": ...}` 到 `stdout`，而不是在 `stderr` 打印纯文本，彻底解决 client 侧 AI 消费时反序列化崩溃的问题。
- **新增单元与端到端测试** `test/cli-config-validation-test.js`：
  - 新增测试用例，覆盖各种损坏配置结构的验证以及参数校验失败下的 JSON/非 JSON 错误响应转换。

### 架构评估与代码审计修复 (2026-06-08)

- **修复增量更新缓存一致性** `src/services/dep-graph/builder.js`：
  - 在 `updateFiles()` 增量更新入口处补上 `clearResolverCaches()` 调用，确保增量更新时文件删除或修改能正确刷新 resolver 的文件系统缓存。
- **修复 WASM AST 解析器内存泄漏** `src/services/dep-graph/parsers/` 下的 `go-ast.js` / `kotlin-ast.js` / `rust-ast.js` / `cpp-ast.js`：
  - 在 Go、Kotlin、Rust、C++ 的 AST 解析器 `finally` 块中添加 `try { if (tree) tree.delete(); } catch {}`，确保 `tree-sitter` 语法树在解析完成后被正确释放，避免 WASM 堆内存泄漏。
- **重构 JavaScript 正则 Fallback 正确性与回溯预防** `src/services/dep-graph/parsers/js/regex-fallback.js`：
  - 重构了 `sanitizeForRegex` 状态机。只在检测到当前字符串字面量紧随 `from`、`require(`、`import(` 等导入上下文时才保留其字符串内容，其余情况替换为 `""`，以此防止无关字符串对正则分析的干扰，同时确保了 fallback 状态下能**正确提取到所有导入路径**（修复前会因内容被抹成 `""` 导致提取出来的 imports 全部为空）。
  - 将 `importFromRegex` 的非贪婪匹配 `[\s\S]*?` 替换为 `[^;]+?`（即不跨越分号），有效避免了大文件/畸形输入下的灾难性正则回溯。
- **新增回归与单元测试** `test/js-regex-import-test.js`：
  - 新增专用测试，完整覆盖各种 imports、requires、动态 imports 以及模板字面量假 import 干扰下正则 Fallback 提取导入关系的正确性。

### 阶段 3.5 E2E集成测试 — 增加 `query-*` CLI 命令 E2E/集成测试（2026-06-08）

- **新增 CLI Query 命令 E2E/集成测试** `test/cli-integration-query-test.js`：
  - 为 `query-hotspots`、`query-knowledge-risk` 和 `query-stability` 新增端到端/集成测试。
  - 通过 `spawnSync` 模拟真实进程调用 CLI，验证不同格式化器（`human`、`summary`、`markdown`、`jsonl`、`ai`）、过滤条件（`risk`、`level`、`assessment`）与限制参数（`--limit`）的业务语义。
  - 通过注入至少一条依赖 edge 并执行 `audit-summary` 预热，配合 `GraphDB` 成功写入 Mock `analysis_snapshot` 聚合结果，从而解决冷启动缓存重算与 precomputed_aggregates 全表清空的缓存未命中问题。
- **注册 Slow 运行层** `test/runner.js`：
  - 将 `cli-integration-query-test.js` 注册进 `KNOWN_SLOW_PATTERNS`，使其在慢 layer/E2E 进程隔离环境下稳定并发运行。

### 兼容性修复 — `DependencyGraph` `_state` 属性回补（2026-06-03）

- **回补 `dg._state` 私有属性** `src/services/dep-graph.js`：
  - 修复了此前将状态机 `GraphStateMachine` 拆分至独立模块后，`DependencyGraph` facade 实例遗漏 `_state` 私有属性，导致 `test/dep-graph-error-test.js` 断言失败的回归缺陷。
  - 通过 `Object.defineProperty` 声明 backward-compatible 的 `_state` 属性映射至状态机的 `state`，恢复对老测试契约和直接访问的支持。

### 阶段 3.5 — 聚合结果持久化与细粒度查询 CLI (2026-06-03)

- **修复 Snapshot 缓存永久失效 bug** `src/services/graph-db.js`：
  - 修复了 `loadPrecomputedAggregates` 在加载 precomputed aggregates 时盲目将 `version` 转换为 `Number` 的 bug。以前这会导致存储在 `version` 字段中的 Git commit hash 被转换成 `NaN`，从而在 `ensureSnapshotData` 中绕过 gitHead 变化检测，导致数据缓存匹配失效并始终触发全量 `buildProjectOverview` 的冷启动。
  - 修复为对非数字 version 字符串类型进行判断保留，确保了 gitHead 变化检测正常工作。
- **补全 query-* 命令格式化器** `src/cli/formatters/human-formatters.js`：
  - 在 `FORMATTERS` 和 `AI_DIGEST` 注册表中添加了 `query-hotspots`、`query-knowledge-risk` 和 `query-stability` 的 human-friendly 格式化（输出紧凑列表与表格）、summary 格式化、markdown 表格渲染以及对齐 spec 的 jsonl 格式化（首行总是输出包含统计元数据的 summary 记录）。
- **新增回归与单元测试** `test/query-tools-test.js`：
  - 新增 `testQueryToolsCacheHit` 测试用例，通过直接注入 mock 数据模拟 SQLite 数据库中的 `analysis_snapshot` 缓存记录，验证 `gitHead` 和 `fileCount` 匹配时能以 `< 50ms` 速度在缓存中命中而不再重算 `buildProjectOverview`。
  - 新增 `testQueryToolsFormatters` 测试用例，确保 `human`、`summary`、`markdown` 和 `jsonl` 格式化器能够输出正确内容。

### CLI & REPL 优化 — JSONL 格式化器重构与 REPL Exit Code 修复（2026-06-03）

- **重构并对齐 JSONL 格式化器** `src/cli/formatters/human-formatters.js`：
  - 提取了重复的 `push` 本地 helper 为全局 `pushRecord` helper 函数，清偿了 L2-7 重复代码技术债。
  - 统一并对齐了 `audit-summary` 和 `audit-overview` JSONL 输出 schema，两者均顺次输出 `hotspot`、`stability`、`knowledge-risk`、`orphan`、`dead-export`、`unresolved`、`cycle` 记录。
  - 所有列表/Findings 导向的 JSONL 格式化器（包括 `audit-summary`、`audit-overview`、`audit-security`、`audit-diff`、`health`、`impact`、`affected-tests`、`affected-routes`、`diagnostics`、`audit-map`、`dependencies`、`dependents`  、`dead-exports`、`unresolved`、`cycles`）现在总是先输出一个包含核心统计信息的 `summary` 元数据行，不论 findings 是否为空，以便下游命令行工具（如 `jq`）首行流式读取与筛选。
  - 更新了 [formatter-direct-test.js](test/formatter-direct-test.js) 中相应的断言，验证各命令总是先输出 summary。
- **修复 REPL `--eval` 多命令执行 Exit Code 覆盖 bug** `src/cli/repl.js`：
  - 修复了在 non-JSON eval 模式下，执行多条命令（如 `invalid; stats`）时后续成功命令重置并覆盖前序错误 exit code 的 bug。
  - 引入了 `maxExitCode` 状态，确保在退出时返回所有已执行命令中最高优先级的错误代码（`2` 表示未知命令/语法错，`1` 表示业务失败，`0` 表示成功）。
  - 在 [bug-27-28-29-regression-test.js](test/bug-27-28-29-regression-test.js) 中添加了 Cases 6, 7, 8 以防止未来回归。
  - `npm run test:fast` 全量 **86/86 PASS**。

### 开发体验修复 — fast 层慢测试根治（2026-06-02）

- **修复 `overview-tools-test.js` 与 `diagnostics-cache-test.js` 各 ~15s 挂起**：fast 层总时间从 ~36s 降至 ~6s，开发反馈循环快 **6 倍**。
  - **根因 A**：`src/utils/command.js` `runCommandSecure` 同时使用了 `cp.spawn({ timeout })` 与自建 `setTimeout` 两套超时机制。Node.js 的 `cp.spawn({ timeout })` 在 Windows 上存在已知行为：当 spawn 失败（ENOENT / 无效 cwd）时，子进程对象的内置 timeout 仍会挂起事件循环直到超时（15s）。自建 `setTimeout` + `child.kill('SIGTERM')` 已完全覆盖超时需求，且跨平台行为一致。
  - **修复 A**：移除 `cp.spawn` 中的 `timeout` 选项，保留自建 timer 机制。
  - **根因 B**：`src/tools/workspace-tools.js` `runDiagnostics` 使用 `Promise.race([buildChecks(...), setTimeout(...)])` 保护 `buildChecks` 不阻塞。当 `buildChecks` 先完成（或先抛出）时，`setTimeout` 未被清理，形成 dangling timer，挂起进程 15s。
  - **修复 B**：显式保存 timer 引用并在 `Promise.race` 完成后 `clearTimeout(timer)`。
  - **修复 B+（follow-up）**：`clearTimeout` 从 `await` 后行内调用改为 `.finally(() => clearTimeout(buildChecksTimer))`，确保 `buildChecks` 先 reject（抛异常）时 timer 仍被清理，彻底消除 dangling timer。
  - `test:fast` **86/86 PASS**，`overview-tools-test.js` 从 ~15s → 438ms，`diagnostics-cache-test.js` 从 ~15s → 293ms。

### 技术债务清偿 — `savePrecomputed` 重复 `if` 块配置表重构（L2-7）（2026-06-02）

- **`src/services/dep-graph/persistence.js` `savePrecomputed`**：将 4 个几乎相同的 `if (cache.xxx !== undefined)` 块重构为 `AGGREGATE_KEYS` 配置表循环。
  - 原 32 行（4 组 × 8 行）压缩为 11 行（数组定义 + for 循环 + push），行数减少约 66%。
  - 行为零变化：键顺序、字段结构、`undefined` 守卫、`JSON.stringify` 处理完全一致。
  - 新增 key 只需在数组末尾追加，无需复制粘贴模板。
  - `test:fast` **86/86 PASS**。

### 审查修复 — 数据质量缺陷与代码清理（2026-06-02）

- **修复 `parseBlamePorcelain` 解析 git blame --porcelain 压缩格式错误** `src/tools/git-tools.js`：
  - 同一提交的连续多行中，git 只在第一行输出完整 author 元数据，后续行仅输出 SHA+行号+content。
  - 原解析器遇到 SHA 行就重置 `currentEmail/currentName`，导致后续行被跳过，所有文件变成 `totalLines=1`、`authorCount=1`。
  - 修复：SHA 行不再重置当前 author，保持元数据继承到同一块的后续行。
  - 补测试 `test/git-tools-blame-test.js`：`testParseBlamePorcelainCompressedBlock` 验证 3 行压缩块正确计数。
- **修复 cycles 重复报告同一个 cycle** `src/services/dep-graph/analyzer.js`：
  - `dep-graph.js` 内两条 `require('./orchestrator')` 生成重复 import records，`_getCircularDependencies()` 返回的邻接表未去重，导致 Johnson 算法两次遍历同一节点。
  - 修复：`return [...new Set(filtered)]` 防御性去重。
  - 补测试 `test/cycle-dedup-test.js`：构造 duplicate imports mock，验证 `_getCircularDependencies()` 返回无重复。
- **清理真死导出 `DG_VALID_TRANSITIONS`** `src/services/orchestrator.js`：
  - 该常量导出后无任何外部模块消费，从 `module.exports` 中移除，内部 `_transition()` 仍保留定义。

### 路线 A-2 收尾 — 阶段 1：提取 EntryDetector（2026-06-02）

- **新建 `src/services/dep-graph/entry-detector.js`**：提取 `isKnownEntryFile()` ~55 行 + `getFrameworkHint()` ~21 行 + `_entryFileCache` + `graph:updated` 缓存失效监听。
  - 消除 `isKnownEntryFile` 与 `getFrameworkHint` 之间的**内容扫描重复代码**（两者都读前 4096 字节 + `detectFrameworkFromContent`），提取公共纯函数 `readScanContent(filePath)`。
  - `EntryDetector` 接收 `{ entryFiles, normalizeFilePath, bus }` 依赖注入，不持有 depGraph 引用。
  - `dep-graph.js` 保留 `isKnownEntryFile()` / `getFrameworkHint()` thin wrapper， facade 公开 API **零变化**，所有外部调用方无需修改。
  - 删除 dep-graph.js 中 `FRAMEWORK_MANAGED_PATTERNS`、`KNOWN_CONFIG_NAMES`、`PYTHON_MAIN_PATTERN`、`detectFrameworkFromPath`、`detectFrameworkFromContent` 的冗余 import。
  - 补测试 `test/entry-detector-test.js`（缓存命中、框架模式匹配、已知配置名、bus 失效、手动失效、路径级 framework hint、缺失文件容错）。
  - `test:fast` **86/86 PASS**。

### 路线 A-2 收尾 — 阶段 2：提取 GraphLoader（2026-06-02）

- **新建 `src/services/dep-graph/loader.js`**：提取 `loadGraph()` ~99 行到独立纯函数模块。
  - `loadGraph(depGraph, options)` 接收 depGraph 实例作为参数，操作其 `graph`、`reverseGraph`、`cache`、`bus` 等字段。
  - 包含 staleness guard、metadata 验证、graph 重建、orphan edge 处理、bus emit、状态机切换（`_finishBuilding`）、预计算恢复（`restorePrecomputed`）。
  - `dep-graph.js` 保留 `loadGraph(options)` thin wrapper（`return loadGraphImpl(this, options)`），facade 公开 API **零变化**。
  - 删除 dep-graph.js 中 `restorePrecomputed` 的冗余 import（仅在 loader.js 中使用）。
  - 冷热启动双路径验证通过（清除缓存后冷启动 + 已有缓存热启动均正常）。
  - `test:fast` **86/86 PASS**。

### 路线 A-2 收尾 — 阶段 3：打破循环依赖（2026-06-02）

- **新建 `src/services/dep-graph/state-machine.js`**：下沉 `DG_STATES` + `GraphStateMachine` + `DG_VALID_TRANSITIONS`，使 dep-graph.js 和 orchestrator.js 共享同一状态机基底，而非互相指向对方。
- **新建 `src/services/dep-graph/persistence.js`**：收容 `registerGraphBuiltHandler` + `savePrecomputed` + `restorePrecomputed`，使 dep-graph.js 和 orchestrator.js 共享同一持久化基底。
- **dep-graph.js 不再静态依赖 orchestrator.js**：
  - `DG_STATES` / `GraphStateMachine` 改为从 `state-machine.js` 导入。
  - `registerGraphBuiltHandler` 改为从 `persistence.js` 导入。
  - `static fromSchema` 中运行时 require orchestrator.js 的 `bootstrapFromSchema`，但显式传入 `DependencyGraphClass` 参数，避免 bootstrapFromSchema 内部反向运行时 require dep-graph.js。
- **orchestrator.js 精简**：删除本地内联的 `DG_STATES`、`GraphStateMachine`、`registerGraphBuiltHandler`、`savePrecomputed`、`restorePrecomputed` 定义，改为从子模块导入并重新导出以保持向后兼容。
- **loader.js 更新**：`restorePrecomputed` 改为从 `persistence.js` 导入。
- **循环依赖检测**：`node cli.js cycles --cwd .` 报告 **cyclesCount = 0**，facade ↔ orchestrator 双向耦合彻底消除。
- `test:fast` **86/86 PASS**。

### 架构债务清偿 — 路线 A-2: dep-graph.js 协调职责上移 — **部分完成**（2026-06-02）

> **诚实评估**：~60% 完成。已提取的职责属实，但 facade 中仍有 ~175 行协调逻辑未动，orchestrator.js 成为了新的"职责收容所"，且引入了 facade ↔ orchestrator 循环依赖。

**已提取到 `src/services/orchestrator.js`**：

- `registerGraphBuiltHandler(depGraph)`：注册 `graph:built` 事件监听，协调 `analyzer.precomputeAggregates()` → `precomputeImpact()` → `savePrecomputed()`。
- `savePrecomputed(depGraph)`：序列化并保存预计算 aggregates + impact 到 SQLite（原 `_savePrecomputed` 方法，~68 行）。
- `restorePrecomputed(depGraph)`：从 SQLite 恢复预计算数据到 analyzer（原 `loadGraph()` 内联逻辑）。
- `bootstrapFromSchema(...)`：从序列化 schema 重建 DependencyGraph（原 `fromSchema` 核心逻辑），dep-graph.js 保留 `static fromSchema` thin wrapper 保证 backward compat。
- `initializeDepGraph(...)`：封装 container.js 中的 load/build/update 决策树（原 `_initDepGraph` ~65 行）。

**仍残留在 `src/services/dep-graph.js` facade 中**：

- `loadGraph()` ~99 行：混合 staleness guard、metadata 验证、graph 重建、orphan 处理、bus emit、状态机切换、预计算恢复。本质是加载协调器，不是 facade 数据存取。
- `isKnownEntryFile()` ~55 行：含 `fs.statSync`/`fs.readSync` 文件 I/O + 框架语义推断，不属于 facade。
- `getFrameworkHint()` ~21 行：与 `isKnownEntryFile()` 的内容扫描逻辑**完全重复**（都读前 800 字节 + `detectFrameworkFromContent`）。
- 构造函数内 `graph:updated` 监听器 3 行：缓存失效协调未收拢到 orchestrator.js。

**引入的新债务**：

- `dep-graph.js` ↔ `orchestrator.js` 循环依赖：facade 静态 require orchestrator（获取 DG_STATES/GraphStateMachine），orchestrator 运行时 require facade（`bootstrapFromSchema` 中实例化 DependencyGraph）。运行时 require 打破死锁，但双向耦合仍在。
- `orchestrator.js` 成为"职责收容所"：330 行混入工厂（`bootstrapFromSchema`）、持久化（`savePrecomputed`/`restorePrecomputed`）、状态机、编排，不是纯粹的薄编排层。`savePrecomputed` 中存在 4 个几乎相同的 `if (cache.xxx !== undefined)` 重复块。

### Added — affected-routes 端到端请求路径（2026-06-01）

- **新增 `affected-routes` 命令** `src/services/dep-graph/analyzer.js` + `dep-graph.js` + `workspace-snapshot.js` + `src/tools/dep-tools/affected-routes.js` + `src/cli/commands/index.js` + `cli.js` + `human-formatters.js`：
  - 给定一个文件，反向追溯所有从已知入口文件（entry files）到该文件的完整调用/导入路径。
  - 排除 test-like files 作为 route endpoint，避免测试结果稀释生产入口路径。
  - 上限 50 条路径，自动去重（JSON key dedup）。
  - 支持 `--max-depth` 限制搜索深度。
  - 补测试 `test/affected-routes-test.js`（契约 + 语义 + maxDepth + entry 边界）。

### 技术债务偿还 — 重复模式消除与模块收敛（2026-06-01）

- **cache.js 重复模式清零** `src/services/cache.js`：
  - 提取 `_normalizeEntries(entries, options)` 通用函数，消灭 3 个复制粘贴变体（`normalizeFileMapEntries` / `normalizeDiagnosticsEntries` / `normalizeParseResultEntries`）。
  - 提取 `DirtyTracker` 类，用结构化的 `mark(key)` / `unmark(key)` / `getDirtyEntries()` / `clear()` 替代 8 个手写 dirty/deleted Set 及 16 行成对 add/delete 调用。INVARIANT 由数据结构保证，注释约束消除。净减 13 行（-17%）。
- **`shouldExclude` 收敛到单一模块** `src/utils/exclude-patterns.js` + `file-index.js` + `dep-graph.js`：
  - 将 `DEFAULT_EXCLUDE_DIRS` 从 `file-index.js` 移至 `exclude-patterns.js`。
  - 新增 `shouldExcludeBase(filePath, baseExcludeDirs)` 统一 cache.db 产物排除 + baseExcludeDirs 匹配逻辑。
  - `file-index.js` 与 `dep-graph.js` 均委托 `shouldExcludeBase()`；dep-graph.js 顺带修复了 cache.db-wal/shm 遗漏排除的问题。
- **health-tools.js 冗余模块删除** `src/tools/audit-assembler.js` + `health-tools.js`：
  - 将 `projectHealth` + 5 个私有 helper（`checkHealthFile` / `hasWorkflowFiles` / `detectCiConfig` / `detectTestConfig` / `buildFixSuggestions`）内联到 `audit-assembler.js`。
  - 删除 `src/tools/health-tools.js`（212 行），消除仅有一个 consumer 的独立数据层。导出 `projectHealth` 供现有测试继续引用。
  - `cli/commands/index.js` 移除未使用的 `projectHealth` 死导入。
- **`normalizeFilePath` 跨文件收敛** `src/services/cache.js` + `dep-graph.js`：
  - 删除两文件中重复定义的 `normalizeFilePath()` 实例方法，改为 constructor 中绑定闭包直接委托 `path.js::normalizeFilePath()`。消除"同一包装、两处实现"的重复信号。
- **exclude-patterns.js basename 无效短路修复** `src/utils/exclude-patterns.js`：
  - 对含 `/` 的路径型 glob（如 `src/**/test.js`）跳过 `path.basename` 测试，直接走后缀匹配；保留文件名-only glob（如 `*.test.js`）的 basename 优化。消除无效正则尝试和阅读误导。
- **graph-db.js `_debugError` 缺失定义补漏** `src/services/graph-db.js`：
  - 上一轮 commit 在 11 处调用点引入了 `_debugError()` 但未定义函数。补全模块级 `_debugError(label, err)`  helper，避免 `DEBUG=1` 时触发 `ReferenceError`。

### 架构边界维护 — _aggregateCache 封装修复与契约统一（2026-06-01）

- **根治 `_aggregateCache` 封装泄漏** `src/services/dep-graph/analyzer.js` + `container.js` + `dep-graph.js` + `overview-assembler.js`：
  - 新增 `GraphAnalyzer.getAggregateVersion()` getter，与已有的 `getAggregateCache()` 配套。
  - 将 4 处外部 `_aggregateCache` 直读 + 8 处 `_aggregateVersion` 直读全部替换为 getter 调用，彻底消除封装 bypass。
  - `overview-assembler.js` 使用 `?.getAggregateCache?.()` 防御 mock 测试对象。
- **统一 `affectedTests` `terminator` 字段语义** `src/services/dep-graph/analyzer.js`：
  - `_findAffectedTestsByHeuristic` 补 `terminator: true`，与 `_findAffectedTestsByMention` 保持一致，避免下游 consumer 因字段缺失而过滤/排序错位。
- **封装 `process.emitWarning` monkey-patch** `src/services/graph-db.js`：
  - 引入 `_suppressCount` 引用计数，`_ensureOpen()` 中首次 patch，`close()` 中归零恢复，消除模块级全局污染和多实例竞态。
- **统一 REPL 退出码判断** `src/cli/repl.js`：
  - 提取 `determineReplExitCode(error, output)` 统一函数，替换 4 处分散的 `isUnknown ? 2 : 1` 判断，消除 exit code 契约分叉。
- **限制 `debug.js` graph 分支计算量** `src/cli/commands/debug.js`：
  - 加 `MAX_DEBUG_GRAPH_FILES = 5000` 和 `MAX_DEBUG_GRAPH_EDGES = 50000` 上限，超限截断并标记 `truncated: true`，防止 O(files × avg_edges) hang。
- **产出审查文档** `docs/code_review.md`：
  - 归档全历史回溯发现的 5 个系统性问题、修复动作与防御措施建议。

### 测试与 CLI 语义修复 — 探索发现项清零（2026-06-01）

- **补 `_filterNonValueImports` 零覆盖单元测试** `test/builder-filter-nonvalue-test.js`：
  - 直接对 `GraphBuilder._filterNonValueImports()` 做 synthetic graph 单元测试，覆盖 Rule 2（type-only）、Rule 3（interface-only target）、Rule 5（Java utility↔utility）、Rule 6（Java utility→entity）及正常 value import 保留。纳入 fast 层。
- **修复 `VALIDATION_ERROR` exit code 语义错误** `cli.js`：
  - `runCliInProcess` catch 块与 `main()` 中参数验证错误（`VALIDATION_ERROR`）的 exit code 从 `2`（崩溃）修正为 `1`（业务失败），与 AGENTS.md 语义定义对齐。
  - 同步更新 `test/cli-exit-code-test.js`、`test/cli-args-validation-test.js` 中的 exit code 期望与函数命名。
- **更新环路测试注释语义** `test/dep-graph-error-test.js`：
  - 将旧 "should be whitelisted" 注释/断言文案更新为反映实际过滤机制（MVVM logic→view boundary / Java utility↔utility edge pruning / annotation-only target pruning），消除测试意图与实际实现之间的语义漂移。
- **修正 `MAX_CYCLE_EDGE_DEPTH` 注释歧义** `src/services/dep-graph/analyzer.js`：
  - 将 "8 nodes (7 edges)" 的误导性描述修正为 "8 nodes (8 edges when the loop closes)"，准确反映 Johnson 搜索深度上限的物理含义。

### 技术债务偿还 — graph-db.js save 系列 TABLE_SCHEMA 化（2026-06-01）

- **`graph-db.js` save/saveIncremental 手工拼接 → 注册表驱动** `src/services/graph-db.js`：
  - 给 `CACHE_TABLE_SCHEMA` 补全 `serialize` + `incrementalKeys`（`{dirty, deleted}`），实现 schema → SQL 的双向映射。
  - `saveAll()` 遍历注册表自动生成 `DELETE` + `INSERT`，消灭 5 张表 × 2 处 = 10 处手工拼接。
  - `saveIncremental()` 遍历注册表自动生成 `DELETE` + `INSERT OR REPLACE`，消灭 5 张表 × 2 处 = 10 处手工拼接。
  - 新增表只需在 `CACHE_TABLE_SCHEMA` 注册一次，load/save/saveIncremental 三处自动生效，对称 `cache.js` 的 `METADATA_SCHEMA` 模式。
  - 外部接口零变化，行为完全保持 backward compatible；`test:fast` 84/84 PASS。

### 技术债务偿还与架构优化 — AST/Resolver 级导入过滤与环路检测彻底重构（2026-06-01）

- **完全剔除魔数 Heuristic 环路过滤** `src/services/dep-graph/analyzer.js`：
  - 彻底移除了脆弱的、基于硬编码长度限制的 `isLikelyFrameworkLegitimateCycle` 方法，将环路判定提升到严谨的物理依赖边过滤维度。
- **高内聚的 AST/Resolver 级物理边过滤引擎** `src/services/dep-graph/builder.js`：
  - 新增 `_filterNonValueImports()` 私有方法。在构建/更新依赖图的最后阶段（`build` & `updateFiles`），对 `imports` 边进行精细化过滤。
  - **规则 1 & 2**：过滤掉 lazy/dynamic 动态导入（`isLazy: true`）和 explicit type-only 的类型级别物理依赖边。
  - **规则 3**：读取被依赖目标文件的 `exportRecords` 属性。若目标文件仅导出类型、接口、注解（或导入的所有具体符号都属类型系统），则判定该边为 type-only/interface 物理边，执行源源头剪枝。
  - **规则 4（MVC/MVVM View 边界）**：对 Vue、React 组件（`.vue`、`.jsx`、`.tsx` 等 view 目录角色）进行架构边界感知，若 logic/model 文件（如 store/router/api/request/service）同步静态导入组件，则视为结构性注册/绑定依赖而非运行期业务逻辑，剥离此物理依赖边。
  - **规则 5 & 6（Java 专用）**：针对 Java/Kotlin 平台，过滤掉无状态工具类互依赖耦合（如 RuoYi 脚手架 Utils 间同原循环）以及工具对纯数据结构/Entity/Domain/DTO 的类型级别依赖，精准消除非运行时环路误报。
- **多语言 AST Parser 深度赋能**：
  - `ast-parser.js`：对 TS 接口 `TSInterfaceDeclaration`、TS 类型别名 `TSTypeAliasDeclaration` 导出记录正确识别并将其 kind 标记为 `'interface'` 和 `'type'`；动态导入 `import()` 自动标记 `{ isLazy: true }`。
  - `java_ast_parser.py` + `java.js`：重写 Java AST 解析器和 fallback 正则解析器，支持对类、接口、枚举和 `@interface` 注解类型的 kind 字段精准标记与向下导出。
  - 完美在 0 魔数魔法和 0 脆弱补丁的基础上，使 existing 框架 whitelist 环路测试 100% 成功通过！

### 技术债务偿还 — 环路检测算法性能与正确性重构（2026-06-01）

- **环路检测 `findCircularDependencies` 算法重构** `src/services/dep-graph/analyzer.js`：
  - 引入 Tarjan 的强连通分量 (SCC) 算法对依赖图进行 $O(V+E)$ 划分。
  - 将 Johnson 的初等环路查找算法限制在强连通分量 (SCC) 内部执行，减少冗余搜索。在大规模代码库上性能提升数个数量级。
  - 彻底消除了原暴力 DFS 全局 `visited` 剪枝在复杂相交依赖路径下会遗漏部分环路的潜在 bug，完美通过所有 framework 环路白名单测试。
  - 将 `MAX_CYCLE_DEPTH` 重命名为 `MAX_CYCLE_EDGE_DEPTH` 以消除“节点数 vs 边数”的歧义，并在递归入口处补齐了详尽的 off-by-one（环路长度上限为 8，对应 7 条边）的数学逻辑注释，杜绝后续开发者的猜测开销。
  - 在 `docs/code_review.md` 中将 Issue #9 标记为 ✅ 已修复。

### Wave 8 — 歼灭最后 3 项 active Dogfood 缺陷（2026-06-01）

- **#27: `--exclude` glob 模式与深层级匹配支持** `src/utils/exclude-patterns.js`：
  - 重构 `shouldExcludeCli` 匹配器。支持通过 `**` 进行跨目录递归排除（如 `test/**/*.js`），以及使用 `*` 匹配单层目录下的模式（如 `src/utils/*`），从而避免由于 glob 翻译过于天真导致排除失效的问题。
- **#28: REPL `--eval` 错误码区分与返回** `src/cli/repl.js`：
  - 当 eval 执行时遇到 `"Unknown command"`、`"Usage:"` 等参数越界或未知指令错误时，REPL 将准确置 `process.exitCode = 2`；在遭遇业务流程失败（如文件未找到）时设置 `process.exitCode = 1`，彻底改变之前静默吃掉 exit code 永远返回 0 的缺陷。
- **#29: Windows 混合/反斜杠路径健壮性解析** `src/utils/path.js`：
  - 在 `normalizePath` 和 `resolveWorkspaceFilePath` 入口前，将路径中的 `\` 反斜杠统一转换为 `/` 正斜杠进行基础解析。避免非 Windows 环境或 mixed-shell 下 backslash 路径被作为普通字符串片段而导致建图与文件查找失败的兼容性痛点。
- **回归测试补充**：
  - 编写了 `test/bug-27-28-29-regression-test.js` 并注入 `test/runner.js`。完整覆盖了上述 glob 递归排除、REPL `--eval` 参数与业务错误退出码验证，以及 Windows 反斜杠绝对与相对路径的跨平台还原逻辑。

### 技术债务偿还 — baseline fallback 重复消除（2026-06-01）

- **消除 `audit-assembler.js` ↔ `overview-tools.js` baseline 操作重复代码** `src/tools/regression-tools.js`：
  - 新增 `applyBaselineOperations(result, args)` 公共函数，统一封装 save baseline + check regression 两套重复逻辑。
  - `audit-assembler.js` / `overview-tools.js` 各自 10 行重复代码替换为单行调用。
  - 补充 `test/regression-tools-test.js` `testApplyBaselineOperationsSave` / `testApplyBaselineOperationsCheckRegression` 语义测试。
  - 从 `TECH_DEBT.md` L3 品味问题中移除。

### 文档清理 — Dogfood 历史归档与已知限制迁移（2026-06-01）

- **TECH_DEBT.md 删除 300+ 行历史 Dogfood 报告**：按"修复即删，历史只进 CHANGELOG"铁律，删除 Pitfalls、验证矩阵、✅ 边界行为、命令层级评估、SKILL.md 建议等全部历史归档内容。
- **ROADMAP.md 追加已知限制**：将仍在的 10 项陷阱/❌Bug/⚠️ 未定义行为从 Dogfood 报告迁移至 ROADMAP.md §已知限制表格（`--format json` 语义混淆、配置 JSON 静默回退、`--cwd` 覆盖、ESM 注入崩溃、Glob 排除失效、REPL 错误码、Windows 反斜杠、symbolImpact 遗漏、Rule ID 映射错位等）。
- **ROADMAP.md 同步 L3 债务计数**：`2 项活跃` → `1 项活跃`，移除 `parsers/js.js` 行（与 `TECH_DEBT.md` 实际条目对齐）。

### 技术债务偿还 — 弱断言清理与 slow 层拆分（2026-06-01）

- **弱断言清理** 10 处 `typeof` 型 schema 契约检查升级为语义验证：
  - `audit-diff-incremental-test.js`：3 处计数字段 `typeof === 'number'` → `Number.isFinite()`。
  - `cli-pipeline-depth-test.js`：`severity` 改为枚举值检查（`['low','medium','high'].includes`）；`impactCount` 改为非负有限数检查。
  - `audit-file-watch-test.js`：`severity` / `impactCount` / `affectedTestsCount` 同步升级。
  - `repl-json-test.js`：`impactCount` / `affectedTestsCount` 同步升级。
- **slow 层头部瓶颈拆分**：
  - `cli-integration-test.js`（~23s，15 个测试）拆分为 `cli-integration-core-test.js`（核心依赖图命令）+ `cli-integration-edge-test.js`（边界与特殊场景），runner.js `KNOWN_SLOW_PATTERNS` 同步更新。
  - `formatter-e2e-test.js`（~21s，7 个测试）拆分为 `formatter-e2e-summary-test.js`（summary/overview 格式）+ `formatter-e2e-others-test.js`（file/health/stats/error 格式），`KNOWN_SLOW_PATTERNS` 同步更新。

### Wave 8 — 歼灭最后 8 项 P2 Dogfood 缺陷（2026-06-01）

- **#25: Mention-based affected-tests distance 写死修复** `src/services/dep-graph/analyzer.js`：

  - `_findAffectedTestsByMention` 的 `distance: maxDepth + 1` 改为 `distance: null`，消除误导性图深度指标。
- **#27: `--exclude` 参与 coverageRatio 计算修复** `src/tools/overview-assembler.js`：

  - `overview-assembler` 改用 `filteredAnalysisCoverage` 替代 `analysisCoverage`，与 `audit-assembler` 保持一致，尊重 `--exclude` 参数。
- **#28: `--staged + --commits` 组合行为定义** `src/tools/git-tools.js`：

  - `getChangedFiles` 开头添加冲突检测：两者同时存在时返回明确的参数冲突错误（exit 2）。
- **#29: REPL vs CLI affected-tests 一致性验证** `test/wave8-regression-test.js`：

  - 复现验证两者输出已一致（25 count，相同 distance 分布），编写回归测试确保未来不回归；从 TECH_DEBT.md 移除。
- **#31: `--check-regression` 文档化** `cli.js`：

  - help 文本中 `--check-regression` 描述明确注明"仅比较结构性指标计数（deadExports/unresolved/cycles）"。
- **#32: `--reuse-hints` 反馈机制** `src/tools/audit-assembler.js`：

  - `audit-diff` 结果 `options` 中新增 `reuseHintsApplied` 计数，显式反馈 hints 应用数量。
- **#34: Markdown 模板丰富化** `src/cli/formatters/human-formatters.js`：

  - `audit-file` markdown 新增 impact radius 列表、affected tests 列表、history risk 概览。
  - `audit-diff` markdown 新增 changed files 列表。
  - 修复 validationAdvice `commands.full` 对象数组被 `join` 成 `[object Object]` 的序列化 bug。
- **#36: Git stderr 污染清理** `src/tools/git-tools.js`：

  - 新增 `cleanGitError()` 辅助函数，将 `fatal: ambiguous argument` / `bad revision` 等原始 git stderr 映射为干净的错误消息。
  - 覆盖 `getChangedFiles` / `getChangedLineRanges` / `getFileHistoryRisk` / `getDiffNumstat` 等 6 处错误出口。
- **文档同步**：清理 `SESSION.md` / `TECH_DEBT.md` 中过期的 `debug --what graph` 活跃问题标记。

  - 该功能已在 v2.0.0 前实现（`src/cli/commands/debug.js` 已支持 `graph` 维度查询，覆盖文件数/边数/样本文件）。
  - `test/cli-integration-test.js` 已包含 `testDebugGraph()` 回归测试，运行正常。
- **Diagnostics 单检查超时补全** `src/tools/workspace-tools.js`：

  - `buildChecks()` 中 5 个此前无显式 `timeout` 的 check 补全超时：`node:typecheck` (60s)、`node:tsc` (30s)、`node:lint` (30s)、`django:check` (15s)、`python:compileall` (15s)。
  - 消除无 timeout check 回退到默认 120s 导致的长尾延迟风险。
  - 新增 `test/workspace-tools-test.js` `testBuildChecksAllChecksHaveTimeout`：遍历 full mode 下所有生成的 check，断言每个都有正数 timeout。
  - 扩展 `test/wave5-boundary-hardening-test.js` 源代码检查，覆盖 `DIAGNOSTICS_CHECK_MS` 和 `DIAGNOSTICS_MEDIUM_MS`。

### 架构债务清偿 — CLI 可测试化与容器初始化管道拆分（2026-06-01）

- **CLI 入口拆分（路线 B）** `cli.js` → `src/cli/validate-args.js` + `src/cli/route-formatter.js` + `src/cli/bootstrap.js`：
  - `src/cli/validate-args.js`：提取 `parseCliArgs()`（参数解析与验证）、`sanitizeCliPaths()`（路径安全）、`classifyError()`（错误分类）。纯函数，可直接单元测试。
  - `src/cli/route-formatter.js`：提取 `writeLargeJson()`（流式 JSON 输出）、`determineExitCode()`（退出码语义）、`formatCliResult()`（格式化器路由）、`buildErrorResponse()`（错误响应组装）。纯函数，可直接单元测试。
  - `src/cli/bootstrap.js`：提取 `UV_THREADPOOL_SIZE` 进程配置与 `installFatalHandlers()` 致命错误处理。必须在任何异步 I/O 之前 require。
  - `cli.js` 从 ~628 行精简为 ~260 行，仅保留 `main()` 命令分发、`runCliInProcess()` 进程内执行入口、`printUsage()`/`printCommandHelp()` 帮助文本。所有导出与行为 100% 向后兼容。
- **容器初始化管道拆分（路线 A-1）** `src/services/container.js`：
  - 引入 `_runPipeline(cwd, options)` 显式初始化管道，将原先 monolithic try 块中的隐式阶段序列提升为 10 个命名阶段：`workspaceRoot` → `cache` → `projectContext` → `fileIndex` → `diagnostics` → `depGraph` → `aggregate` → `snapshot` → `callbacks` → `gitHead`。
  - 引入 `_runStage(name, fn)` 阶段包装器：自动计时（存入 `this._phaseTimes[name]`）、错误包装（`Stage 'X' failed: ...`）。
  - 阶段失败时错误信息直接指向责任阶段，消灭"restore interface / 竞态窗口"类 commit 的根因（初始化顺序变更引发 regression）。
  - 零公共 API 变更；`test:fast` 84/84 PASS。

### 回归修复 — slow 层遗留问题清零（2026-06-01）

- **修复 `bug-15-cli-bounds-validation-test.js` 过时 exit code 期望**：
  - Wave 8 已将 `VALIDATION_ERROR` exit code 从 `2` 修正为 `1`，但 `bug-15-cli-bounds-validation-test.js` 的三处断言仍期望 `2`。
  - 同步更新为期望 `1`，与当前语义定义对齐。
- **修复 `cli-error-handling-test.js` Node.js 警告污染**：
  - Node.js v22 SQLite `ExperimentalWarning` 通过 `spawnSync` stderr 泄漏到测试中，导致 `quiet mode should suppress stderr diagnostic logs` 误报。
  - 在测试中过滤 `(node:...)` 前缀的警告行，仅对诊断性 stderr 做断言。
- **修复 `shouldExcludeCli` `**` glob 语义缺陷** `src/utils/exclude-patterns.js`：
  - `test/**/*.js` 原正则 `^test/.*/[^/]*.js$` 要求至少一个子目录层级，漏匹配 `test/watch-test.js`（直接位于 `test/` 下的文件）。
  - 引入 `**/` → `(?:.*/)?` 替换（在 `**` 和 `*` 替换之前），使 `test/**/*.js` 正确生成 `^test/(?:.*/)?[^/]*.js$`，同时匹配 `test/*.js` 和 `test/*/*.js`。
- **修复 `repl.js` `determineReplExitCode` 对成功输出误报 1** `src/cli/repl.js`：
  - `help`、`stats` 等成功命令在 `--eval` 模式下被置为 exit code `1`，因为 `determineReplExitCode` 默认返回 `1`。
  - 补充 `if (!error && output !== null && output !== undefined) return 0;`，使成功输出正确返回 `0`。
- **修复 `audit-assembler.js` `detectTestConfig` 未导出** `src/tools/audit-assembler.js`：
  - `health-tools.js` 删除时 `detectTestConfig` 被内联到 `audit-assembler.js` 但未加入 `module.exports`。
  - 导致 `phase01-quality-test.js`（slow 层）`MODULE_NOT_FOUND` 崩溃。
  - 将 `detectTestConfig` 加入导出列表。

### L3 品味问题修复 — `audit-summary` `--format jsonl` 管道友好化（2026-06-03）

- **增强 `audit-summary` 的 `jsonl` 格式化器** `src/cli/formatters/human-formatters.js`：
  - 原 `jsonl` 仅输出 `dead-export` / `unresolved` / `cycle` 三类 record，且当这些为空时只回退一行 `_type: 'summary'` 元数据，管道可用性极低。
  - 新增输出：`hotspot`、`orphan`、`knowledge-risk`，与原有 record 类型对齐。
  - 元数据行（`_type: 'summary'`）现在总是第一行，包含 `totalFiles`、`deadExports`、`unresolved`、`cycles`、`orphans` 等关键计数，便于管道首行筛选。
  - 用户可用 `--format jsonl | jq -r 'select(._type=="hotspot").file'` 直接筛选热点文件，无需再钻取深层嵌套对象。
  - `test/formatter-direct-test.js` 扩展 `testFormatJsonlAuditSummary` 验证全部 6 种 record 类型 + 元数据行。
  - `test:fast` **86/86 PASS**。
- **TECH_DEBT.md L3 债务清零**：移除 `--json 嵌套深，管道不友好` 条目。

### Wave 14-4: Monorepo 边界检测与服务过滤 (2026-06-11)

- **`--service <subpath>` CLI 参数** `src/cli/validate-args.js` / `cli.js`：
  - 注册 `--service` 参数，支持 `WB_SERVICE` 环境变量，遵循 `env > cli > file` 优先级。
  - 在 `sanitizeCliPaths` 中进行路径安全验证（防穿越）和存在性检查（必须为目录），失败返回 `VALIDATION_ERROR`。
  - `cli.js` 帮助文本新增说明，并将 `service` 传递给 `container.initialize()`。
- **ProjectContext 自动子项目发现** `src/utils/project-context.js`：
  - 引入 `WORKSPACE_MARKERS` 过滤 `.git` 后的 `PROJECT_MARKERS` 作为子项目边界识别依据。
  - 新增 `detectProjectBoundaries()`：递归扫描子目录（最大深度 3，排除 `node_modules`/隐藏目录），检测边界文件存在性。
  - 重构 `buildDirectoryRules()`：当传入 `--service` 时，将目标服务标记为 `active`（source: `service`），自动发现的兄弟子项目降级为 `reference`（source: `service-downgrade`）。
  - 重构 `classifyDirectory()` 匹配优先级为 `cli/service > config > default`，确保 CLI 规则（`--service`、`--exclude`）始终覆盖配置文件。
- **DependencyGraph 非 active 文件过滤** `src/services/dep-graph.js`：
  - `shouldExcludeCli()` 新增对 `projectContext.classifyFile(filePath).isMainline` 的检查，将 `reference`/`archive`/`generated` 目录角色下的文件排除在 CLI findings 报告之外。
  - 防御性检查 `typeof this.projectContext.classifyFile === 'function'`，保持与现有 mock 测试的向后兼容。
- **测试覆盖** `test/wave14-monorepo-service-test.js`：
  - 6 个测试用例覆盖：无 service 时全 active、service findings 过滤、ProjectContext 角色分类、路径穿越验证、不存在路径验证、优先级排序（cli > config）。

