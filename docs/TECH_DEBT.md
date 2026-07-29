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

**判决顺序已修正（2026-07-28，六仓 `droppedImports` 实测后）**：原计划是「T5 落地即可摘——丢弃会被记账，风险从静默降级为报警」。实测推翻了这个时机判断：**报警器本身噪声太大**（Java 44/49 文件报警、zod 42/409 文件报警，绝大多数是闸缺口造成的假阳性，见 L2-11），此时摘符号表 = 在一个一直响的警报器旁边动刀。正确顺序：

1. L2-11 闸缺口（~~`__future__`~~ 已修 2026-07-28 / Java 仓内包前缀闸 / monorepo 子包 deps）→ 把假警报压掉
2. L2-16 Rust crate 名归一 → **Rust 保留符号表的依据本身要重量**（那 167 条与 152 条丢弃是同一缺口两侧）
3. L2-14 JVM 源根（Kotlin 已降 P3，Java 侧按需）→ JVM 判决材料
4. 再拍 JS/TS/Python/Go 的摘除，此时 `droppedImports` 才是可信的安全网

**另一处需要订正的旧结论**：「摘掉能连带让 L2-11 的 JS 闸和 L3-4 分支一起消失」——**已过期**。T5 之后 `isExternalDependency` 有了第二个消费方（builder 的丢弃记账用它区分「该丢的」和「漏掉的」），闸删不掉了，连带收益缩水成只剩 L3-4 那个分支。

**触发条件**：调整 `SYMBOL_DISAMBIGUATION` 任一常数、或把符号表铺到新语言之前。跑 `node scripts/resolver-precision.js reference/<repo> [...]` 逐仓点名取数（勿用 `reference/*` 通配，目录里混着非仓文件；编制与闸状态见 `reference/README.md`）。

### L2-11：外部依赖闸只覆盖 JS 家族 — 违反 AGENTS.md 铁律 #8（多语言等价性）

**状态**：语言维度大部分收敛，但**知识来源维度有三个缺口**（2026-07-28 六仓实测订正）。JS 家族（node 内建 / `package.json` 四类依赖字段 / `node_modules`，**含 .svelte**）、Rust（`std`/`core`/`alloc`/`proc_macro` 前缀 / `Cargo.toml` 声明的 crate，`path = ` 依赖不拦）、Python（标准库根段名单 / `requirements.txt` + `pyproject.toml` 的 `[project]` 与 poetry 依赖段，PEP 503 归一 + 别名表）、Go（无需名单——import 永远带完整路径：module 路径之外的一切都不猜，dotted 首段 = 外部模块、无点首段 = 标准库）、**C/C++**（angle 形式不猜 / 无扩展名不猜 / C·POSIX 系统头名单，与 L1-4 修复同轮落地）与 **Java / Kotlin 的标准库半**（`java.`/`javax.`/`kotlin.` 前缀，经 `isBuiltIn` 回退接线，T4）已有闸。

**「剩余唯一缺口是 JVM 第三方」这句话已被实测推翻**（2026-07-28，L2-13 的 `droppedImports` 首次在真实仓上接触）。闸漏认的每一个外部 specifier，现在不再只是「可能被猜成假边」，它还会被记进 `droppedImports` 并触发 `unresolved-dropped` 警告——**闸的缺口 = 报警器的假警报**。六个在范围内的仓冷构建实测：

| 仓 | 语言 | 文件 | droppedCount | 涉及文件 | 性质 |
| --- | --- | ---: | ---: | ---: | --- |
| execa | TS | 438 | **0** | 0 | 干净 |
| cobra | Go | 36 | **0** | 0 | 干净（零名单闸的红利） |
| zod | TS | 409 | 80 | 42 | **闸缺口 A**：monorepo 子包 deps |
| CodeGraphContext | Py | 284 | 70 → **34**（缺口 B 修复后复测） | 60 | ~~闸缺口 B~~（已修，2026-07-28）+ 结构缺口（见 L2-17）+ 传递依赖（httpx/anyio，manifest 未声明） |
| qartez-mcp | Rust | 230 | 152 | 35 | 结构缺口为主（见 L2-16） |
| spring-petclinic | Java | 49 | **362** | **44 / 49** | **闸缺口 C**：第三方 jar 全裸 |

- **缺口 A — monorepo 子包依赖**：`readPackageDeps(root)` 只读工作区根的 `package.json`。zod 是 pnpm workspace，`@rollup/plugin-*` 声明在 `packages/treeshake/package.json` 里，根上没有 → 80 条全被当成「看着像自己的」丢弃。影响面是所有 pnpm/yarn/npm workspace 仓，**而那正是 workspace-bridge 的主力场景**。改法：从导入方文件向上找最近的 `package.json`，与根合并（缓存键要带这个目录，别只按 root 缓存）。
- **缺口 B — Python 标准库名单漏项**：✅ **已修（2026-07-28）**。`__future__` 补进 `PYTHON_STDLIB_ROOTS`（`resolvers.js:169`），同批复测带出同病的 `tomllib`（3.11+，实测出现在 CodeGraphContext 的 droppedImports 里）与 `zoneinfo`（3.9 同 cohort 漏项）一并补上。CodeGraphContext 实测 70 → 34 条；剩余是 L2-17 结构缺口（`codegraphcontext.*` 仓内绝对导入）与 httpx/anyio 这类**传递依赖**（manifest 未声明、非标准库——名单+manifest 两道路径都够不着，要么接受要么上 site-packages 探测，那是另一个设计题）。CACHE_VERSION 17。
- **缺口 C — Java 第三方 jar**：spring-petclinic 49 个文件里 44 个报丢弃、362 条全是 `org.junit.*` / `org.assertj.*` / `org.apache.commons.*`。Java 用户现在看到的 `droppedImports` 是纯噪音。

**建议动作（缺口 C 别按老方案做）**：TECH_DEBT 早先写的方案是「读 `pom.xml`/`build.gradle`，难点是 groupId 与包名不同构」——**这条路没必要走**。Java/Kotlin 的 import 永远是全限定包名，而**仓内有哪些包是已知的**：parser 已经把每个文件的 `package` 声明抽进图（`builder.js` 的 `parsed.package`）。所以闸的判据是「仓内包前缀集合之外的一切 = 外部」，零名单、零 manifest 解析、零 groupId 猜测——与 Go 那道零名单闸同构，且比读 pom 更准（pom 未声明但 classpath 上有的照样判对）。代价是需要在图建完之后才能定型，实现上要么走 postProcess 阶段，要么在 builder 首轮扫描时先收集 package 集合。

**旧方案的实测样本留档**（T4，okhttp）：83 条第三方假边在图里（`org.junit` 37 / `assertk` 27 / `okio` 13 / `org.mockserver` 3 / `org.gradle` 3，第三方 specifier 配本地 target 必假）。

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

**触发条件**：任何语言的 unresolved import 报出"疑似被解析到本地同名符号"时、或某语言的 `droppedImports` 占比异常高时，优先补该语言的闸。复现取数：`node cli.js audit-summary --cwd reference/<repo> --cache-dir <tmp> --quiet --json`，读 `droppedImports.samples`（冷构建才有值，`measured` 必须为 true）。

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

**影响面比「AI 读到旧数字」更远（2026-07-28 追加核实）**：replay 的字段会一路走进**决策型出口**，不只是给人/agent 看的报告——

| 出口 | 位置 | 后果 |
| --- | --- | --- |
| `hasFindings` | `cli/commands/index.js:98,121` 由 `deadExports` / `unresolved` / `cycles` / `boundaries` / `smells` / `astRules` / `orphans` 汇总 | 全部来自 replay |
| exit code | `cli/route-formatter.js:77`（`failOnFindings && hasFindings → 1`） | **CI 的红绿灯建立在上次冷构建的数据上** |
| `summary.severity` | `cli/commands/index.js:74` `repoSeverity({unresolved, cycles, deadExports})` | 同上 |
| `--check-regression` | `tools/regression-tools.js:116,150` 拿 `currentResult` 比基线 | 回归可能被旧值掩盖，或凭空造出一个 |

也就是说：改完代码立刻跑一次 `audit-summary --fail-on-findings`，只要 git head / 文件数 / config 三项没变，**拿到的是改动前的判决**。这条把 L2-15 从「输出可观测性」抬到「门禁可信度」。

**建议动作**（不动设计本身，先动可观测性；按成本排序，拍板在人）：

0. ✅ **已完成（2026-07-28，`test/gate-on-replay-test.js`）**：决策型入口不吃 replay——`--save` / `--check-regression` 在 `buildProjectOverview` 的 replay 分支直接拒绝（不写基线、不比回归，错误说明原因与刷新方法）；`--fail-on-findings` 在 `cli.js` 出口拦截带 replay 标记的响应（exit 1 + `gate_on_replay` stderr 标签）。报告可以旧，门禁不能旧；这两者的可容忍度天然不同，混在一个 freshness 策略里就是把边界抹掉。两个拒绝点各自做过变异验证（置假条件 → 恰好对应断言 RED）。
1. ✅ **已完成（同批）**：replay 出口给整个响应盖 `replayedFrom: { computedAt, gitHead, fileCount }` 标记——和 `measured` 同一思路，从字段级升到响应级；动作 0 的拒绝正是以它为判据。
2. **中**：freshness 信号细化——快照存内容 hash 集或 mtime 上界，编辑即失效。成本是每次调用扫一遍 stat，丢掉的正是粗粒度想省的那部分速度。
3. **大**：快照降级为「预计算聚合缓存」，section 级 freshness——哪些段可 replay、哪些必须与 warnings 同源现算。

粗粒度换速度是真实收益，不是纯错误——所以这条是「记账 + 给消费方抓手」，不是「必须改掉」。**但这个定性只对报告路径成立**：门禁路径（上表第 2、4 行）不存在「旧一点也行」的容忍度，那部分是 bug 不是取舍，见动作 0。

**触发条件**：修改 `isSnapshotFresh` / `saveAnalysisSnapshot`、消费 `audit-overview` 输出做删除/重构决策、或给 `hasFindings` 增删汇总项时。

### L2-16：Rust crate 名 `-`/`_` 不同构，qartez-mcp 152 条自引用掉进丢弃/符号表

**状态**：活跃（2026-07-28 `droppedImports` 六仓实测发现）。qartez-mcp 230 文件报 **152 条丢弃 / 35 个文件**，样本首位是 `qartez_mcp::cli::WorkspaceAction`、`qartez_mcp::graph`——**crate 自引用**。Cargo 包名是 `qartez-mcp`，crate 名是 `qartez_mcp`（Cargo 自动把 `-` 换成 `_`），`tryRustCrate` / 外部闸两侧都按字面比对，两边都不认这个 specifier：既解不成边，也不被判为外部。

**为什么它对 L2-10（T6）有直接影响**：L2-12 清零后 qartez-mcp 还剩 167 条 symbol-table，当时归因为「`qartez_mcp::` 集成测试自引用，是该策略唯一合法形态」。现在看，那 167 条与这 152 条丢弃是**同一个缺口的两侧**——猜中的进符号表、猜不中的进丢弃。所以「Rust 是符号表唯一有正产出的语言」这个判决依据**是被结构缺口撑起来的**，与 JVM 那 ~950 条（L2-14）形状完全一致。**修完这条再量 Rust 的符号表占比，才是 T6 的真判决材料。**

**建议动作**：crate 名归一——读 `Cargo.toml` 的 `[package] name` 后按 Cargo 规则做 `-`→`_` 转换（`[lib] name` 显式声明时以它为准），`tryRustCrate` 与 `_isExternalRustCrate` 共用同一个归一函数，别在两处各写一遍（L2-7 重复即债务）。验证基准就是现状：qartez-mcp 152 条丢弃 / 167 条 symbol-table，修完两个数都应大幅下降，且总边数上升。

**另有一类待确认**：样本里出现 `::count_same_file_refs_outside_range` 这种**前导双冒号**的 specifier，不是合法的 Rust import 写法，疑似 parser 抽取产物而非 resolver 问题。修 crate 名之前先分组统计一次，别把 parser 的账记到 resolver 头上。

**触发条件**：Rust 仓 `droppedImports` 非零、或改动 `resolvers/rust.js` / `_isExternalRustCrate` 时。

### L2-17：Python 仓内绝对包路径解不开（`codegraphcontext.tools.handlers`）

**状态**：活跃（2026-07-28 实测发现，**待分组定量**）。CodeGraphContext 284 文件报 70 条丢弃 / 60 个文件，样本里混着三类：`__future__`（标准库名单漏项，归 L2-11 缺口 B）、`httpx`（第三方，需核对是否在 manifest 里声明）、`codegraphcontext.tools.handlers`（**仓内包的绝对导入，本该由 `tryPythonAbsolute` 解开**）。三类的占比没分组统计过，**先取数再动手**——本条的范围只是第三类。

**为什么值得查**：Python 的 `tryPythonAbsolute` 在 parity fixture 上是绿的（`python-absolute:1`），说明基本能力在；真实仓里落空，大概率是包根发现（`src/` 布局、`__init__.py` 缺失、namespace package）或多级包路径的问题。这与 L2-14（JVM 源根）、L2-16（Rust crate 名）是同一族：**结构解析在真实布局上落空 → 符号表兜底或静默丢弃**，三个语言各一个实例。

**建议动作**：先跑分组统计（按 specifier 首段是否等于仓内已知顶级包名分三类），再决定改 `tryPythonAbsolute` 的哪一段。

**触发条件**：Python 仓 `droppedImports` 非零、或改动 `resolvers/python.js` 时。

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

> **债务总览（2026-07-28 重排）**——记账口径按用户要求改了：**债务不会消失，只会转移优先级**。所以下面不写"清零"，写"现在排在哪一层"。已修条目的机制债（不是那个实例，是让它能发生的结构）一律留在预防性约束里，那才是它转移之后的位置。
>
> | 层 | 条目 | 为什么在这一层 |
> | --- | --- | --- |
> | **P0 现在做**（降噪，有序） | L2-11 剩余两个闸缺口（Java 仓内包前缀闸 / monorepo 子包 deps；~~`__future__`~~ 缺口 B 已修 2026-07-28） | 报警器现在响的多半是假警报（Java 44/49 文件、zod 42/409 文件），不压掉，后面所有判决都没有可信数据 |
> | **P1 紧随** | L2-16 Rust crate 名归一 · L2-17 Python 仓内包路径 | 结构解析在真实布局上落空 → 符号表兜底/静默丢弃，与 L2-14 同族；直接决定 T6 的判决材料 |
> | **P2 依赖前两层** | L2-10 符号表判决（T6）· L2-14 JVM 源根（Java 侧） | 数据齐了才能拍；顺序与理由写在 L2-10 内 |
> | **P3 记账不排期** | L2-15 的动作 2–3（freshness 细化 / section 级设计；动作 0+1 已于 2026-07-28 完成——门禁拒绝 + `replayedFrom` 标记） · L3-4 扩展名分支 · L3-5 死方法 · L3-7 Vue/Svelte 正则抽符号 · L3-8 防御性兜底 | 粗粒度换速度是真实收益，报告路径只补抓手；L3-8 走"接触即修"，不做大扫除 |
> | **P4 冻结** | 见下方 P4 冻结区 | 语言出范围 / 明确不做，每条带解冻条件 |
> | **预防性约束** | postProcess 记录不落盘 · `_invalidateParseCache` 单一入口 · regex-fallback 缓存不信任 · warm/cold 逐字节一致 · `_readGuard` 单一读闸 · **DependencyGraphView 白名单同步**（新） · **「本轮实测」字段不进快照**（新） · **门禁型出口不吃 replay**（新） | 这些是已修债务转移后的形态：实例没了，让实例发生的结构还在 |
>
> 本轮（2026-07-28 复核）新增：L2-16 / L2-17 / L3-8 / 两条预防性约束 / P4 冻结区五条。全部来自 `droppedImports` 的六仓首次实测与三轮外部探针，**没有一条是读代码读出来的**——见「开发纪律」里"全绿有盲区"。
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

### ⚠️ 预防性约束（2026-07-28 新登记）：`DependencyGraphView` 是白名单，新增 facade 方法必须同步

**约束**：任何加进 `DependencyGraph`（`src/services/dep-graph.js`）的公开读方法，**必须**同步加进 `DependencyGraphView`（`src/models/workspace-snapshot.js`）的委托列表。工具层拿到的是 `container.snapshot.graph`（视图），不是裸图——漏一行 = 该方法在整条产品路径上不存在。

**病史**：T5 的 `getDroppedImports` 就漏了。视图上不存在 + 调用点写了 `?.()` 兜底 = 输出段恒为 0，**261 个测试全绿**。测试没抓住是因为它拿的是 `container._depGraph`（裸图），锁的语义对、锁的入口错。

**衍生纪律（比约束本身重要）**：新增 facade 方法的契约测试**必须至少有一条走 `container.snapshot.graph`**，不能只测裸图。裸图断言证明的是"算得对"，视图断言才证明"用户拿得到"。

**为什么不改成默认委托 + 黑名单**：视图的白名单是有意的——它挡住 `build`/`updateFiles`/`analyzeFile` 这些生命周期方法，改成 Proxy 默认转发会把可变入口一起放出去。代价就是这条同步义务，认了；用上面那条测试纪律兜底，而不是靠记性。

**触发条件**：给 `DependencyGraph` 加任何公开方法时。

### ⚠️ 预防性约束（2026-07-28 新登记）：「本轮实测」型字段不得随快照 replay

**约束**：任何回答「这个数字是不是**这一轮**算出来的」的字段（当前只有 `droppedImports.measured`），**必须**在 replay 出口按当前图现算覆盖，不能让它跟着 `analysis_snapshots` 的数据一起搬。

**病史**：`measured` 加进来的当天就随快照 replay 了——warm 跑（甚至把出错的 import 删掉之后再跑）照样报 `measured: true`，一个专门用来标注「测没测过」的字段，答的是上一轮的答案。修法在 `overview-tools.js` 的 replay 分支（`5f0dbc0`）。

**为什么是约束**：`L2-15` 那条粗粒度新鲜度短期不会动，只要 replay 还在，**下一个「本轮实测」型字段会掉进同一个坑**。设计判据很简单：这个字段描述的是**数据**还是**这次运行**？描述运行的，一律不进快照。

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

> **Vue 的范围说明**（2026-07-28）：Vue **在范围内且边层健康**——`.vue` 在 `JS_FAMILY_EXTENSIONS` 闸内（`resolvers.js:111`）、parity 实测 `relative:1 / dropped:0`、`reference/vue-realworld-example-app` 是编制内基准仓、framework-patterns 有 vue-script 与 script-setup 宏两条检测。降级的只有本条 L3-7（符号抽取精度），**不是语言支持**。Svelte 的边层同样通着（T3 的闸 + realworld 12 边），只是它的语言级债务整体降 P3。

### L3-8：防御性兜底是这个项目复杂度的主要来源（`?.()` / `|| {}` / Proxy fallback）

**状态**：活跃（2026-07-28 登记，系统性问题，不指向单个文件）。同一轮里两个 bug 都不在逻辑里，都在**兜底**里：`getDroppedImports?.()` 把「视图没这个方法」兜成 0；test-helpers 的 Proxy 兜底 `() => []` 把「mock 没实现」兜成空数组（委托接通后立刻炸出两个 overview 测试——那是**好事**，静默的谎言变成了显式失败）。

**形状**：每一层都替下一层擦屁股。builder 记账 → facade → view → assembler → snapshot replay → CLI，六层，每层都写了「拿不到就当没有」。单看每处都叫稳健，合起来的效果是**错误永远传不到人眼前**，只能靠外部探针撞出来。这与铁律 #4「静默错误必须显式」是正面冲突——铁律写在 AGENTS.md 里，可选链写在代码里，代码赢了。

**判据（新增代码时问一句）**：这个 `?.` / `||` 兜的是**真实可能发生且可恢复**的情况，还是**结构性不该发生**的情况？后者一律让它炸。内部模块之间互相信任，不做防御性检查——只在真正的外部边界（用户输入、文件系统、spawn 子进程）设防。

**建议动作**：不做一次性大扫除（改动面太大、收益不可测）。改为**接触即修**：任何一次触碰到带兜底的调用点，顺手判断一次并处理掉。已处理：`overview-assembler` 的 `getDroppedImports?.()`（`cc82b0d`）。

**触发条件**：写下任何 `?.()` 或 `|| { 空值 }` 时；review 时看到跨层调用带兜底时。

> 历史记录：弱断言分布已清理至 schema 契约测试中的防御性 `typeof` 检查；其余 `status === 0` 均为环境探测 helper，不属于测试断言。详见 [CHANGELOG.md](../CHANGELOG.md) [Unreleased] §Code Quality: Weak Assertion Cleanup。

---

## P4 冻结区（已登记，不排期；解冻条件写在每条里）

> 这些不是"已解决"，是**优先级被移走**。语言范围（2026-07-28 用户拍板）：TS/JS（含 `.jsx`/`.tsx`，即 React——它不是独立语言，走同一 parser / 同一链 / 同一闸）、Python、Go、Rust、Java、Vue 在范围内；Kotlin / C·C++ / Svelte 边层通着但债务降级。

- **C/C++ `tryCppInclude` 不校验命中类型与仓外爬升**（`resolvers/cpp.js`）：`cachedExistsSync` 只判 stat 非 null，`#include "utils"` 撞上同名**目录**会返回目录当边；`#include "../../../x.h"` 会把仓外文件拉进图。`tryRelativeWithExtensions` 同款（既有行为，非本轮引入）。解冻条件：C/C++ 回到范围内，或任何仓报出目录型节点 / 仓外路径节点。改法：命中后加 `isFile()` + root 包含判定。
- **`resolveFileOnly` 的 ext 大小写不一致**（`builder.js:407`）：`resolveImport` 拿裸 `path.extname(filePath)`，而 T5 的闸调用拿 `ext.toLowerCase()`。`MAIN.C` / `Foo.H` 这类文件 resolver 链落到 default（等于回到 L1-4 的病），而丢弃记账走 cpp 闸——两边判定分叉。解冻条件：出现大写扩展名的真实仓，或统一 ext 归一时顺手做掉（一行）。
- **仓库根目录两个垃圾目录**：`UserssdsesAppDataLocalTempwb-test-b331ad95` / `UserssdsesAppDataLocalTempwb-test-cache`（2026-07-20 遗留，某测试把 Windows 绝对路径当相对目录用、分隔符被吃掉）。`git status` 看不见是因为里面只有被 ignore 的 `cache.db`。可直接删；根因是哪个测试没查。
- **Next.js 路由提取缺失**（`framework-patterns.js`）：有 Nuxt（:143）与 SvelteKit（:145）的 route query，**没有 React/Next**（该文件 `react`/`next` 零命中）。后果：Next 的文件系统路由（`app/` / `pages/api/`）抽不出，`api-contracts` 拿 Next 当后端全部对不上。**明确不做**——它是加特性不是减债，与当前"只做减法"的方向冲突。解冻条件：噪声治理完成（L2-11 三缺口 + L2-16）之后，若真实 Next 仓的实测数据支持，再评估。
- **TECH_DEBT.md 自身臃肿**：已修条目保留大段"以下为发现时的原始记录（留档）"，与文档铁律「修复即删，历史只进 CHANGELOG」冲突，本文件已 200+ 行且一半是坟头。不擅自删——留档里有复现路径与判据，删之前要确认 CHANGELOG 侧等价覆盖。解冻条件：文件超过阅读预算（新会话读它超过一屏就该压缩）。

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
