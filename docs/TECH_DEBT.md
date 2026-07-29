# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

### L1-4：C/C++ 产不出任何依赖边，且据此给出「删除被引用头文件」的建议

**状态**：✅ 已修复（2026-07-28，T2，CACHE_VERSION 14）。`tryCppInclude`（`resolvers/cpp.js`）：引号形式按语言定义相对包含文件解析 + `include/`/`src/` 回退；尖括号形式永不解析到仓内文件。闸同轮落地（`_isExternalCppHeader`：angle 形式不猜 / 无扩展名不猜 / C·POSIX 系统头名单），引号/尖括号区分复用 parser 写的 `isLocal`（`importHints` 透传，不重新猜）。实测：cJSON 96/96 条边全 `cpp-include`、fmt 135 条 `cpp-include`（另 1 条 symbol-table 是 Python 侧 vendored docopt，真边），symbol-table 在 C/C++ 上贡献 0；`#include "../cJSON.h"`（爬升）与 `#include "fmt/format-inl.h"`（include 根回退）两种形状人工核对正确。双变异验证通过（摘注册 → parity cpp 条 RED；摘闸行 → `boost/.../string.hpp` 猜中诱饵符号 `hpp`，测试 RED）。回归约束：`test/language-parity-edges-test.js` 的 cpp 条 + `test/cpp-resolver-test.js` 七条。

以下为发现时的原始记录（留档）：十个最小 fixture（每个仓一条「A 依赖 B」）里 C/C++ 是**唯一** `edges: 0` 的，5 次重跑全部为 0。RED 测试 `test/language-parity-edges-test.js` 当时入库，本修复后转绿。

| 语言 | 边 | 解析方法 | | 语言 | 边 | 解析方法 |
| --- | ---: | --- | --- | --- | ---: | --- |
| js / ts | 1 | `relative` | | go | 1 | `go-module` |
| python | 1 | `python-absolute` | | rust | 1 | `rust-crate` |
| java | 2 | `java-package` + 同包隐式 | | vue / svelte | 1 | `relative` |
| kotlin | 1 | `java-package` | | **cpp** | **0** | **—** |

**根因**：parser 是好的（`main.cpp:ast` / `helper.h:ast`，直接调 `parseCppAst` 能拿到 `importRecords`，`local.h` 还正确标了 `isLocal: true`）。死在 resolver——注册表里 C/C++ 的 `resolveStrategies` 是 `[tryAlias, tryRelativeWithExtensions]`，**整套照抄 JavaScript**：

```
resolveImport('main.cpp', 'helper.h',   '.cpp') → null
resolveImport('main.cpp', './helper.h', '.cpp') → 解析成功
```

JS 语义里裸 specifier = npm 包；C/C++ 语义里 `#include "foo.h"` 的引号形式**按语言定义就是相对当前文件**，从不写 `./`。于是每条 include 都被当包找，找不到，`builder.js` 的 `resolveFileOnly()` 把 resolve 失败的记录直接 `return null` 丢弃。

**为什么是 L1**：违反铁律 #4（静默错误必须显式）且已产出**错误的行动建议**——fixture 里工具报 `审查孤儿模块是否可删除: helper.h`，而 `main.cpp` 正 `#include` 它。连带 `impact` 对 .cpp 返回空、环检测看不见 C/C++ 的环、所有头文件被判孤儿。

纯 C/C++ 仓会触发 `empty-graph`（severity high）警告，所以不是完全静默；但**混合仓（如 Python 主仓带 C 扩展）图里有大量其他语言的边，该警告不触发，C/C++ 部分静默丢边**——那才是真实风险场景。

**建议动作**：新增 `tryCppInclude` 策略（引号形式相对当前文件；尖括号形式判系统头直接不猜），注册进 C/C++ 的 `resolveStrategies`。**必须与 L2-11 的 C/C++ 闸同一轮做**：当前 C/C++ 的 import 到不了链尾纯属侥幸，一旦能解析，`#include <stdio.h>` 会去查一个叫 `"h"` 的符号（非 Rust/Go 的分隔符是 `.`，末段取到的是扩展名），`boost/algorithm/string.hpp` 查 `"hpp"`——等于把 `require('path')` 那 212 条的病重新引进来。

**触发条件**：修改 `parsers/registry.js` 的 C/C++ 条目、或任何 C/C++ 项目报出 0 边 / 全量孤儿时。复现：建两文件仓（`main.cpp` 内 `#include "helper.h"` + `CMakeLists.txt`），跑 `audit-summary --json` 看 `edges`。

---

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

| repo | 总边 | symbol-table | 数据新鲜度 |
| --- | ---: | ---: | --- |
| GitNexus (TS) | 4110 | 0 | 2026-07-28 最新代码复测（pull 后 +495 commits） |
| zod (TS) | 374 | 0 | 2026-07-28 复测（`reference/zod`） |
| execa (TS) | 1044 | 0 | 2026-07-28 复测（`reference/execa`） |
| workspace-bridge (JS) | 1018 | 0（闸前 212，全是假边） | 2026-07-28 复测 |

加上 Python 两仓（CodeGraphContext 502 / code-review-graph 413，均为 2026-07-28 最新代码复测的 0），该策略在 JS/TS/Python 六个仓上**从未产出过一条正确边**；唯一的正产出在 Rust。qartez-mcp v0.11.0（L2-12 修复后）：709 边 / symbol-table 167 = 23.6%，占比从 52.7% 降半的原因是分母被 tier1 真边喂大，且抽样显示剩余的几乎全是 `qartez_mcp::` 集成测试 crate 自引用——L2-12 之后，Rust 侧 symbol-table 收敛到它唯一合法的形态。注意口径：闸后 JS 侧命中为 0 部分**是因为闸把裸 specifier 全拦了**——闸前本仓那 212 条说明没拦时它只会猜错。两种情况都不支持保留。

**边界（2026-07-28 T4 实测补）**：「零正产出」只在 JS/TS/Python 成立，**不覆盖 JVM**。okhttp 2415 边里 1037 条 symbol-table（43%），按包前缀分组后：~950 条仓内自引用（`okhttp3.*`/`mockwebserver3.*`——KMP 源根布局与类名≠文件名两种结构落空，符号表兜底命中为真，见 L2-14）+ **83 条第三方假边**（`org.junit`/`assertk`/`okio` 等，第三方 specifier 配本地 target 必假，L2-11 第三方半的实测样本）。「JS 摘」的判决不受影响；「JVM 摘不摘」要等 L2-14 修完再量——结构解析覆盖后还剩多少正产出，才是 JVM 侧的判决数据。

**证据**：本仓 dogfood，闸前 1230 条边里 212 条由 `trySymbolTable` 产出，**全部是假边**，且全部同构——212 条的 specifier 无一例外是 `path`、target 无一例外是 `parsers/js/shared.js`（该文件把 `const path = require('path')` 带进了 `module.exports`），confidence 0.8/tier2；`impact parsers/js/shared.js` 因此报 212 个被依赖文件，真值 3。GitNexus（4110 边）上该策略贡献 0 条。

**根因已于 2026-07-28 单独清除**（见 CHANGELOG）：那行转手再导出已删，闸关闭时本仓假边 212→0。这削弱了「本仓 212 条」作为摘除论据的分量——它证明的是**该策略对导出卫生零容错**（一处手滑放大成 212 条假边），而非它在 JS 上必然产出垃圾。L2-10 的判决因此主要靠下面这张表的「零正产出」，而不是靠假边计数。

**为什么是债**：`SYMBOL_DISAMBIGUATION` 的 `SCORE_SAME_DIR: 40 / SCORE_SAME_MODULE: 20 / SCORE_SAME_EXT: 10 / MIN_GAP_THRESHOLD: 20` 四个常数没有任何实测依据，单测只锁了不变量（不解析非导出符号、平分返回 null），锁不住精度。没有基准，这四个数字没人敢动，也无法判断策略该留该删。

**建议动作**：把 `trySymbolTable` 从 JS 家族链上摘掉（保留 Rust；JVM 保留待 L2-14 修完重量——okhttp 实测 symbol-table 在 JVM 非标布局上是正产出，见上方边界段）——连带收益：L2-11 的 JS 闸（`readPackageDeps`/`NODE_BUILTINS`/`node_modules` 探测）与 L3-4 的扩展名分支一起消失。Python/Go 链同理可摘（贡献同为 0，且闸已让它们的命中不可能为真），但 Python/Go 各有 `tryPythonAbsolute`/`tryGoModule` 结构解析在前，摘符号表影响面与 JS 相同。**这是结构性决定，等用户拍板。**

**触发条件**：调整 `SYMBOL_DISAMBIGUATION` 任一常数、或把符号表铺到新语言之前。跑 `node scripts/resolver-precision.js reference/<repo> [...]` 逐仓点名取数（勿用 `reference/*` 通配，目录里混着非仓文件；编制与闸状态见 `reference/README.md`）。

### L2-11：外部依赖闸只覆盖 JS 家族 — 违反 AGENTS.md 铁律 #8（多语言等价性）

**状态**：大部分收敛（2026-07-28）。JS 家族（node 内建 / `package.json` 四类依赖字段 / `node_modules`，**含 .svelte**）、Rust（`std`/`core`/`alloc`/`proc_macro` 前缀 / `Cargo.toml` 声明的 crate，`path = ` 依赖不拦）、Python（标准库根段名单 / `requirements.txt` + `pyproject.toml` 的 `[project]` 与 poetry 依赖段，PEP 503 归一 + 别名表）、Go（无需名单——import 永远带完整路径：module 路径之外的一切都不猜，dotted 首段 = 外部模块、无点首段 = 标准库）、**C/C++**（angle 形式不猜 / 无扩展名不猜 / C·POSIX 系统头名单，与 L1-4 修复同轮落地）与 **Java / Kotlin 的标准库半**（`java.`/`javax.`/`kotlin.` 前缀，经 `isBuiltIn` 回退接线，T4）已有闸。**剩余唯一缺口：Java / Kotlin 的第三方 jar**（`java.` 之外的 groupId，需要 `pom.xml`/`build.gradle` manifest 读取器）。

实测方法：让符号表对任何名字都命中，隔离出闸本身的行为（`null` = 闸拦住）——

| 来源文件 | specifier | 结果 | | 来源文件 | specifier | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| `.ts` | `path` | 拦住 | | `.svelte` | `path` | 拦住（T3 后） |
| `.vue` | `path` | 拦住 | | `.cpp` | `vector` | 拦住（T2 后） |
| `.py` | `os` | 拦住 | | `.java` | `java.util.List` | 拦住（T4 后） |
| `.go` | `fmt` | 拦住 | | `.kt` | `kotlin.collections.List` | 拦住（T4 后） |
| `.rs` | `std::vec::Vec` | 拦住 | | | | |

~~**Svelte 的原因很蠢**~~：已修（T3）——`.svelte` 进 `JS_FAMILY_EXTENSIONS`，一个字符串。`testSvelteCallerCoveredByJsFamilyGate` 锁契约（node 内建 + devDependencies 声明的 `svelte` 两条），变异验证通过；`reference/realworld`（SvelteKit）实测 12 条边、symbol-table 0。CACHE_VERSION 15。

~~**C/C++ 的闸与 L1-4 强耦合**~~：已按计划在 L1-4 修复的同一提交落地（T2）——尖括号形式经 `importHints.isLocal === false` 不解析也不猜，无扩展名 specifier 与 C/POSIX 系统头名单兜底无 hints 的入口。实测 fmt 135 条新边零 symbol-table。

**为什么是债**：病灶机制与语言无关，且已在两种语言上实测到实例——JS 的 `require('path')`（本仓 212 条）与 Rust 的 `std::process::Command` / `rmcp::` / `tokio::`（qartez-mcp 48 条）。Python `import requests` 撞上本地导出的 `requests` 是同一形状，只是尚未取到样本。按铁律 #8 仍属语言偏斜。

**建议动作**：只剩 JVM 第三方 jar 一半。（a）~~内建前缀接线~~ 已做（T4，经 `isBuiltIn` 回退）；（b）**第三方** jar 需要 `pom.xml`/`build.gradle` manifest 读取器——难点是 groupId 与 import 包名不同构（`com.google.guava:guava` ↔ `com.google.common.collect`），只能做到「顶级域名段 + 组织段」前缀匹配。**这一半已有实测样本**（T4，okhttp）：83 条第三方假边在图里（`org.junit` 37 / `assertk` 27 / `okio` 13 / `org.mockserver` 3 / `org.gradle` 3，第三方 specifier 配本地 target 必假）。**验证仓已入编待闸**（`reference/README.md`）：spring-petclinic / okhttp（JVM）；cJSON / fmt（C/C++）已在 T2 量过（96/96 与 135/136 条结构边，symbol-table 贡献 0）、realworld（Svelte）已在 T3 量过（12 边，symbol-table 0）；cobra（Go）现在就可测。

**触发条件**：任何语言的 unresolved import 报出"疑似被解析到本地同名符号"时，优先补该语言的闸。

### L2-13：`unresolved` 统计的不是「解不开的 import」，所以它永远看不见被丢弃的记录

**状态**：✅ 已修复（2026-07-28，T5）。（b）`resolveFileOnly()` 的丢弃分支现在记账：gate 已知的外部 specifier（node 内建 / 标准库 / manifest 声明的依赖）**不计**——它们不成边是设计行为，计数等于对每句 `import os` 狼来了；只数「看着像自己的」丢弃，进 `dg.getDroppedImports()` + `buildWarnings()` 的 `unresolved-dropped` 警告（severity 按丢弃文件占比，>10% → medium）+ `audit-overview`/`audit-summary` 新增 `droppedImports` 段（additive，无破坏）。parity 基准已打开第二条断言：十个 fixture `droppedCount` 必须全为 0——下一个语言缺口会自己在这里报出来。（a）`unresolved` 段新增 `staleResolvedImportsCount` 别名并注明真实语义（数的是「曾解析但文件已消失」的失效边）；`unresolved`/`unresolvedCount` 保留为弃用别名（Never break userspace），消费方迁移后再删。

**输出层补漏（2026-07-28 同日）**：T5 的 overview `droppedImports` 段当时恒为 0——`DependencyGraphView` 白名单漏加 `getDroppedImports`，`?.()` 静默兜零，parity 第二条断言读死字段等于没断。已修：view 补委托；新增 `measured` 字段区分「实测 0」与「没测」（warm/方法缺失 → false）；parity 改断 `measured === true` 并加负向 fixture `js-dropped-import`（断言 `droppedCount === 1` 走完整 CLI JSON 路径）；test-helpers mock 补 `getDroppedImports` 默认值（Proxy 兜底 `() => []` 是真值数组，委托接通后会把消费方炸出来）。

**发现的相邻真相**（留档）：相对路径写错（`require('./missing')`）**不走丢弃分支**——`tryRelativeWithExtensions` 对不存在的目标无条件返回 phantom 路径（`resolvers/javascript.js:116`），成为图里的幽灵边，正是 `findUnresolvedImports()` 现有条目的来源。这条行为未改（改了是边语义变化，且 phantom 边在 impact 里有消费方），但它说明两个字段的分工：`staleResolvedImportsCount` 管「相对路径写错」，`droppedImports` 管「裸 specifier 无人认领」。

以下为发现时的原始记录（留档）：十个 fixture **全部**报 `unresolved: 0`，包括丢掉了两条 `#include` 的 C/C++ 仓。`analyzer.js` 的 `findUnresolvedImports()` 判定条件是 `!this.dg.hasFile(imp) && path.isAbsolute(fsPath) && !fs.existsSync(fsPath)`——数的是「曾经解析成绝对路径、但文件已不在磁盘」，而真正解不开的 import 从来不是绝对路径、且早在 `resolveFileOnly()` 就被丢弃，两道门都进不去。

**为什么是债**：这个字段是 `audit-summary` / `audit-overview` 的一线指标，AI agent 会拿它判断"这个仓的依赖图完不完整"。它结构上无法回答那个问题，却长得像能回答——违反铁律 #4。L1-4 只是把它暴露得最彻底（丢 2 条报 0），但**所有语言都受影响**：任何 resolve 失败的 import 都静默消失，无计数、无 warning。

**建议动作**：两件事分开。（a）给字段正名或改语义——要么改名为 `staleResolvedImports`，要么让它真的统计 resolve 失败数。（b）在 `resolveFileOnly()` 丢弃记录处累计一个 `droppedImports` 计数并进 `warnings[]`，这是 L1-4 之所以"静默"的机制根源，修了它，未来任何语言的解析缺口都会自己报出来。

**触发条件**：修改 `resolveFileOnly()` 的记录丢弃分支、或消费 `unresolvedCount` 做判断时。

### L2-14：`tryJava` 的源根发现不认识 Gradle KMP / 非标布局，okhttp 43% 的边靠符号表兜底

**状态**：活跃（2026-07-28 T4 实测发现）。okhttp 2415 条边里 1037 条（43%）`resolution_method = symbol-table`。按包前缀分组：**~950 条是仓内自引用**（`okhttp3.*` / `mockwebserver3.*`），命中为真；**83 条是第三方假边**（`org.junit` 37 / `assertk` 27 / `okio` 13 / `org.mockserver` 3 / `org.gradle` 3——第三方 specifier 配本地 target 必假，okio 未 vendored 已核实），归 L2-11 的第三方 manifest 半，不在本条范围。

**根因**（自引用那 ~950 条）：`discoverJavaSourceRoots`（`resolvers/base.js`）只认 `src/main/java`、`src/main/kotlin` 等 Maven/Gradle 标准布局。okhttp 主源码在 `okhttp/src/commonJvmAndroid/kotlin/`（Kotlin Multiplatform 的 sourceSet 布局），不在名单里——`tryJava` 拿 `okhttp3.HttpUrl` 找 `okhttp3/HttpUrl.(java|kt)` 全部落空，掉进符号表。另有一小部分是类名≠文件名（`mockwebserver3.SocketEffect` 这类，路径算术天然无解，`testJavaFacadeFallback` 同款），那部分符号表是**唯一**可行策略。

**为什么现在才看见**：这些边是**对的**——JVM 的「类名 = 文件名 = 包路径」语义让末段猜测可靠，所以没人报错。但它们是 confidence 0.8/tier2 的猜测：一旦本地出现同名类（导出卫生问题，本仓 `path` 那 212 条的形状）就静默错指，且 `impact` 的置信度传播把 tier2 当次等证据。结构解析能给 tier1/confidence 1.0。

**建议动作**：`discoverJavaSourceRoots` 支持 KMP sourceSet 布局——扫描项目两级子目录内名为 `kotlin`/`java` 的源根（`src/<sourceSet>/kotlin`、`src/<sourceSet>/java`），别硬编码 `commonJvmAndroid` 这个具体 sourceSet 名。修完重量 okhttp：symbol-table 应大幅萎缩，**剩下的才是 L2-10 JVM 侧的判决材料**。验证基准就是现状：okhttp 1037 条。

**触发条件**：JVM 仓 symbol-table 占比异常高（>10%）、或 `impact` 对 JVM 类返回 tier2 证据为主时。

### L2-15：overview 快照的粗粒度新鲜度——warm 输出整体可以是旧的，而 warnings 是现算的，同一份输出自相矛盾

**状态**：活跃（2026-07-28 warm 三跑探针发现，用户明确要求入债）。`isSnapshotFresh`（`overview-tools.js:85-105`）只核三项：git head + 文件数 + config hash——「跨未提交编辑保持新鲜」是写在注释里的刻意设计，换的是重复调用近乎零成本。代价：`audit-overview`/`audit-summary` 在文件编辑后 replay 的 `deadExports`/`cycles`/`aggregates`/`droppedImports` 等**全部是上次冷构建的旧值**，而同一份输出里的 `warnings` 不在快照里、每次现算。探针实测：import 已从磁盘删除，字段仍报 `droppedCount:1`，warnings 为空——这个自相矛盾**对快照里每个字段都成立**，不只是 droppedImports。`measured` 的 replay 覆盖（`5f0dbc0`）只修了「谎称这轮测过」那一格，**旧数字本身还是旧的**。

**为什么是债**：「假绿比红更危险」同款——输出看起来像一次完整的当前分析，实际一半是上一轮的结果，且**没有任何标记**告诉消费方哪些 section 是现算的、哪些是 replay 的。AI agent 拿 `deadExports` 做删除决策时，删的可能是已经改过的代码；拿 `droppedImports` 判断图完整度时，读的是上次构建的账本。

**建议动作**（不动设计本身，先动可观测性；按成本排序，拍板在人）：
1. **最小**：replay 出口给整个响应盖 `replayedFrom` 标记（快照 generatedAt / gitHead / fileCount）——和 `measured` 同一思路，从字段级升到响应级，消费方一眼能区分「本次现算」vs「replay 自某次冷构建」。
2. **中**：freshness 信号细化——快照存内容 hash 集或 mtime 上界，编辑即失效。成本是每次调用扫一遍 stat，丢掉的正是粗粒度想省的那部分速度。
3. **大**：快照降级为「预计算聚合缓存」，section 级 freshness——哪些段可 replay、哪些必须与 warnings 同源现算。

粗粒度换速度是真实收益，不是纯错误——所以这条是「记账 + 给消费方抓手」，不是「必须改掉」。

**触发条件**：修改 `isSnapshotFresh` / `saveAnalysisSnapshot`、或消费 `audit-overview` 输出做删除/重构决策时。

### ✅ L2-12 已清零（2026-07-28）：Rust 的 `super::` / `crate::` 转回模块算术

**诊断**：两个独立缺口。(1) `tryRustSuper` 把 `super` 当**目录**爬升——非 mod 文件的第一个 `super` 命名的是文件所属模块本身（子模块目录就是文件所在目录），不该爬；旧代码每级必爬一层，导致非 mod 文件的所有 `super::` 路径全部落空。(2) `tryRustCrate` 锚在工作区根的 `src`——多 crate 工作区（qartez-mcp/qartez-dashboard）里 `crate::` 应锚定**最近的 Cargo.toml** 的 src。另有第三类：末段命名的是基模块的**条目**而非子模块（`super::QartezServer` → `server/mod.rs`），单段时回退基模块文件（`mod.rs`/`baseDir.rs`/`lib.rs`/`main.rs`）。

**实测验证**（qartez-mcp 重建）：symbol-table 313 → **160**（正好少 153，剩 156 条 `qartez_mcp::` 真命中 + 4 个单例），rust-crate 292 / rust-super 206。总边 594 → **676**（+82）——那不是转移，是 82 条原先连猜都猜不出、被静默丢弃的 import 首次成边。随机抽 6 条新 tier1 边人工核对全对；零重复 (source,target) 对。

**契约**：`test/gors-resolver-test.js` 新增 4 条（非 mod 首级不爬 / 基模块条目回退 / mod.rs 立即爬 / 最近 Cargo.toml 锚定），对旧 `rust.js` 验证 RED 后转绿。旧断言 `super::super::lib → null` 锁的正是 off-by-one bug，已改为 crate 根语义（`foo::bar` 上两级 = crate root = `src/lib.rs`）。

**副产品**：`base.js` 新增 `findCargoCrateRoot(fromFile, root)`，缓存进 `clearResolverCaches()`。`CACHE_VERSION` 12→13。

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

> **当前活跃债务总览**：L1 Blocker **0**（L1-4 已由 T2 修复） | L2 债务 **4**（L2-10 符号表精度待判决 / L2-11 外部闸只剩 JVM 第三方 manifest 一半 / L2-14 JVM 非标源根布局 / L2-15 overview 快照粗粒度新鲜度；L2-13 已由 T5 修复） | 架构债务 **0**（warm 后处理与版本门禁均已清零，转为预防性约束） | L3 品味问题 **3**（L3-4 扩展名分支 / L3-5 死方法 / L3-7 Vue·Svelte 正则抽符号） | 合计 **7 项**
>
> L1-4 / L2-11 的四条腿 / L2-13 / L3-6 / L3-7 均来自 2026-07-28 的九语言等价性实测（十个最小 fixture + 闸隔离探针），复现脚本与判据见各条目。

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

### L3-6：`isBuiltIn` 是死配置，而它正装着 L2-11 补闸需要的名单

**状态**：✅ 已清零（2026-07-28，T4 方案 A）。`_isExternalDependency()` 在闸表未命中时回退 `registry.findByExt(ext)?.isBuiltIn?.(specifier)`，九处声明首次有了消费方。**如实说明消费深度**：实际经这条回退生效的只有 `.java` / `.kt` 两个（JS 家族 / Rust / Python / Go / C-C++ 各有闸表行，行优先于声明；Vue / Svelte 的 `() => false` 永不触及）。`java.util.List` / `kotlin.collections.List` 猜向本地同名类的路径已堵（`testJavaStdlibNotGuessed` / `testKotlinStdlibNotGuessed`，先 RED 后 GREEN，变异验证通过）。CPP_BUILTINS 已收进 `resolvers/cpp.js` 单一出处（T2）。

以下为发现时的原始记录（留档）：`parsers/registry.js` 里九个语言条目每个都声明了 `isBuiltIn`——`java.`/`javax.` 前缀、`kotlin.`、`CPP_BUILTINS`、`GO_BUILTINS`、`PYTHON_BUILTINS`。全仓（`src` / `test` / `scripts`）**零调用方**，`registry-core.js` 里也只有默认值填充，没有任何读取。

对照其余五个钩子的消费情况（2026-07-28 实测）：`resolveStrategies` 1 处、`extractSymbols` 1 处（`file-index.js`）、`condition` 与 `filePatterns` 由 `registry-core.js` 的 `getFilePatterns()` 消费、`needsWorkspaceRoot` 1 处——只有 `isBuiltIn` 是死的。

讽刺之处：`EXTERNAL_DEPENDENCY_CHECKS`（L2-11 的闸表）在另一个文件里重新实现的正是同一份知识，而缺闸的 Java / Kotlin / C-C++ 所需名单已经写好躺在这里。二选一，别留着：接进闸表（顺手推进 L2-11），或按"删除 > 添加"删掉九处声明。

### L3-7：Vue / Svelte 的 `extractSymbols` 是逐行正则

注册表里这两个语言的 `extractSymbols` 用正则匹配 `class` / `function` / `const` 逐行抽符号，而它们的 `parse` 走的是 babel AST。同一语言两条路径两种精度。这不影响依赖边（边来自 `parse`），但它是"9 种语言 AST 覆盖 100%"这一说法的折扣项——`file-index.js` 消费的是正则那条。

> 历史记录：弱断言分布已清理至 schema 契约测试中的防御性 `typeof` 检查；其余 `status === 0` 均为环境探测 helper，不属于测试断言。详见 [CHANGELOG.md](../CHANGELOG.md) [Unreleased] §Code Quality: Weak Assertion Cleanup。

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

> 所有核心/分析模块均已实现专属/直接单元测试覆盖（无遗留的零专属测试模块）。

**缺的不是模块覆盖，是层级覆盖**：多语言等价性（铁律 #8）目前只在 **parser 层**被验收——"9/9 语言 AST 覆盖 100%"是真的，C/C++ 的 `parse_mode` 老实写着 `ast`。但**能出 AST ≠ 能出边**，中间隔着 resolver，而没有任何测试在"边"这一层做横向对比。L1-4 就是从这个缝里漏了整整一个语言。

**建议**：把 `scripts/resolver-precision.js` 扩成每语言边产出基准（现在只测 symbol-table 一条策略），输入用 2026-07-28 那十个最小 fixture（每仓一条「A 依赖 B」），断言每种语言至少产出 1 条边、且 resolve 失败丢弃数为 0。L1-4 / L2-13 都会被这一条测试同时兜住。

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

*Last updated: 2026-07-28（活跃债务 **7 项**：L1=0 / L2=4（L2-10 待拍板 / L2-11 只剩 JVM 第三方 manifest 半 / L2-14 JVM 非标源根布局 / L2-15 overview 快照粗粒度新鲜度）/ 架构债务=0 / L3=3；本轮：T1–T5 全部落地——边层等价性基准（含 dropped:0 断言）、L1-4 C/C++ 修复、Svelte 闸、JVM 标准库闸 + L3-6 接线、L2-13 解析失败记账；okhttp 实测发现 L2-14 并改写 L2-10 的 JVM 判决材料，83 条 JVM 第三方假边成为 L2-11 剩余半的首批实测样本）*
