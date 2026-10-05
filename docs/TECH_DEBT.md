# 当前技术债

这里只列仍需处理或明确冻结的债务。修复经过和已关闭条目见 [CHANGELOG.md](../CHANGELOG.md)。原外部审查报告的开放项已并入本文件。

## 根因归属（修法见 [ROADMAP.md](../ROADMAP.md)「架构修复路线」）

以下归类只对应当前开放条目；结构性方案见 ROADMAP。根因 C（建图与分析存在重复工作）目前没有开放条目，所以表中没有它。

| 根因 | 证据 | 对应条目 |
|---|---|---|
| B 路径没有统一身份 | 路径归一化散布于调用方，显示路径与缓存键仍有多种写法 | H-22 ② |
| D 结论缺少按目标说明的证据边界 | 结构性影响与语义测试关联的能力边界仍需明确，不能从空结果推出无风险 | H-7 |
| E 语言能力缺少统一声明 | Kotlin 导出模型仍把函数体内局部变量当成导出；能力对等需要场景矩阵约束 | H-13 |
| 输出没有统一出口（横切） | 规则散在 `elideDeep`、`route-formatter.js`、2027 行的 `human-formatters.js` | H-22 ③ |
| 验证体系自身不可信（横切） | CI 近 90 次成功 11 次；核心模块变异捕获率约 65% | H-17、H-19 |

不归入上述原因、独立处理：H-4、H-6、H-25、H-26。

## P1：输出看着正常、实际是错的（静默错误）

当前无开放项。

## P2：安全、缓存与文档隐患（条目编号 H-n）

| ID | 现象与复现 | 验收线 |
|---|---|---|
| H-4 | 分层出现 5 条反向依赖（AGENTS.md「项目骨架」规定依赖只向下）：`src/services/container.js` → `src/tools/overview-tools.js`、`src/tools/cochange-tools.js`；`src/tools/audit-assembler.js` → `src/cli/formatters/index.js`；`src/tools/overview-tools.js` → `src/cli/formatters/dashboard-formatter.js`；`src/services/file-index.js` → `src/services/dep-graph/parsers/registry.js`。项目自身的 `boundaries` 检查为 0 违规，说明规则未覆盖这些边。 | 为这 5 条边补边界规则并消除或明确登记为例外。 |
| H-6 | Python 分析依赖本机 Python：标准库名单来自本机解释器的 `sys.stdlib_module_names`，不同机器版本不同则内部/外部导入判定可能不同；无 Python 时退回硬编码名单。 | 输出 `warnings[]` 或字段标明所用来源与解释器版本。 |
| H-7 | `affected-tests` 的预测质量：typer 精确率 0.548（召回率 0.991，CLI 输出与评测同口径）。`typer/testing.py` 被几乎所有测试导入，距离 2 的传递依赖把大半测试拉进来（`typer/_completion_shared.py` 真值 1 个测试，预测 96 个）；当前只在截断时把经枢纽文件的测试排后（`orderedBy: distance,hubFanIn,file`），列表不超过 500 条时它们仍全部返回。静态传递的上限同样出现在 cobra（召回率 1.0、精确率 0.374：根包源文件互相引用，经传递把 17 个测试都拉进每个文件的预测，真值每个文件平均 4.6 个）和 spring-petclinic（召回率 0.98、精确率 0.563：`@SpringBootTest` 测试对同模块所有 JVM 源码都列出，其中需要 Docker 的集成测试在真值运行里没有执行，被算作误报）。hexyl 1.0 / 0.5 仅 4 个样本，vitesse 仅 1 个样本，无统计意义。复现：`node eval/score.js`。 | typer 精确率有可验证的提升方案（枢纽路径降级为"弱关联"标记或默认不返回），且召回率不低于 0.9；cobra、petclinic 在不降低召回率的前提下提升精确率（例如按距离或证据强度分档返回）。 |
| H-13 | Kotlin 把函数体内的局部变量当作导出符号，使 `dead-exports` 数量虚高。2026-10-02 在 okhttp 固定提交上运行 `WB_CACHE_DIR=eval/truth/out/kotlin/okhttp/cache node cli.js dead-exports --cwd <eval/truth/repos/kotlin/okhttp 绝对路径> --json --quiet`：`deadExportsCount` 227（`dataQuality: degraded`，另有 247 条 import 无法解析被丢弃）。`okhttp-tls/.../HeldCertificate.kt` 报出的 `now`、`issuer`、`result` 分别是该文件第 231、355、410 行函数体内缩进的 `val` 局部变量，不是导出。同一次运行 227 条的置信度都不高于 medium，`safeToDelete` 为 0，所以不会直接诱导删除，但数量与清单不可信。 | Kotlin 的导出只包含顶层与类成员声明，不含函数体内局部变量；okhttp 上 `deadExportsCount` 重新统计并抽查 20 条无局部变量；有 Kotlin 夹具测试（函数体内 `val` 不出现在 exports）。 |
| H-19 | 发布流程半手动且已多次中断，版本号与发布物脱节。2026-10-02 实测：① 发布只由推送 `v*` 标签触发（`.github/workflows/release.yml`：`npm ci` → 快层测试 → 冒烟 → `npm pack` → GitHub Release → `npm publish --provenance`）；版本号与 CHANGELOG 靠手工提交（如 `ad84bd1` "切版 2.1.0"），仓库里没有自动化脚本。② `package.json` 为 2.1.0（2026-07-17）、CHANGELOG 有 `[2.1.0]`，但最新标签与 GitHub Release 是 `v1.2.1`（2026-05-28），此后 271 个提交，2.0.0、2.1.0 从未打标签。③ 发布工作流最近 3 次（v1.1.0、v1.1.1、v1.2.1）都失败在 "Publish to npm"，v1.0.2、v1.0.3 成功；现查 `npm view workspace-bridge` 返回 404（包不在 npm 上）。④ 冒烟步骤只检查 `--version` 与 `workspace-info`：本机按同样步骤解压 `npm pack` 产物（192 个文件，约 550 KB，不含 `eval/`、`test/`、`docs/`）到没有 `node_modules` 的目录，二者都通过，而 `audit-overview` 在该目录退化为 regex 解析（提示 `@babel/parser not available`）；所以产物缺运行依赖时冒烟仍会绿。⑤ 打包：`npx pkg . --targets node22-win-x64` 离线构建成功（20 秒，使用缓存的 v22.22.3 基础二进制；`pkg` 对 `tree-sitter-wasms` 动态 require 给出一条警告），产物 121 MB，`--version` 为 2.1.0，在 typer 上 `audit-overview` 解析 639/639 个文件，覆盖率与警告和 `node cli.js` 一致。仓库根的 `workspace-bridge-win.exe`（114 MB，已被 `.gitignore` 忽略）仍可运行，但版本是 2.0.0，落后 274 个提交。 | 先查明 npm 发布失败的原因（令牌或包名权限），再决定是否发布；补打 2.0.0/2.1.0 对应标签或在 README 说明版本从 2.x 起不再发布；冒烟增加一条需要运行依赖的分析命令（如对解压目录自身 `audit-overview` 并检查 `parsedFiles` 大于 0 且无 `@babel/parser not available`）；旧 `workspace-bridge-win.exe` 是删除还是用新构建替换，由项目所有者决定。
| H-22 | agent 输出仍有两类摩擦：② 同一结果的路径包含原大小写反斜杠、全小写正斜杠与混合 id，消费者必须自行归一化；③ 发布包的 parser 降级、EventBus 监听失败和 watch 解析失败仍可能在 `--quiet` 下写入 stderr（初始化单阶段超过 30 秒的"仍在运行"心跳是有意例外，见 CHANGELOG）。 | ② 同一结果的路径统一写法并声明大小写策略；③ `--quiet` 下 stderr 为空，除非进程失败或出现上述心跳。 |
| H-25 | `diagnostics --mode full`、`stats --format markdown` 和已 deprecated 的 `health` 命令价值存疑（来自原审查报告，未复核）。 | [手工] 分别执行三个命令，核对 `checksRun`、Markdown 内容与 `audit-summary.health` 是否重复；空转命令删除或合并，格式损坏的修复后再决定去留。 |
| H-26 | 语言注册抽象泄漏：Kotlin 的处理逻辑散在约 20 个文件（`ast-rules`、`framework-patterns`、orphan-detector、test-detector、`overview-assembler` 等）；新增一门语言要改的文件数同量级（来自原审查报告，未复核数字）。 | `grep -rln "\.kt\b\|'kotlin'" src \| wc -l` 取当前文件数；在新增 C# 之前，把语言专属分支收进语言注册表。 |

## U：未验证方向（条目编号 U-n）

U 表示"还没查过，不知道有没有问题"，不是已确认的债务。查完后有问题的转成 P1/P2/L 条目，没问题的整行删除。U 表只列尚未核对的方向，验证经过只写 CHANGELOG。语料在 `eval/truth/repos/<语言>/<仓库名>`（gitignored，说明见 [eval/README.md](../eval/README.md)）。

| ID | 要查什么 | 怎么查 | 验收线 |
|---|---|---|---|

| U-15 | 深信服 aES 本身对 WASM 与 SQLite 耗时的影响仍未隔离。 | 当前没有可用对照条件；待项目所有者或公司提供可比较的防护条件或性能取证环境；不要求卸载，不由 agent 修改系统安全设置。 | 可归因的耗时对照；腾讯开关结果不能外推为深信服影响。 |

| U-30 | 真实同步盘 SQLite WAL 与公司域策略下的安装行为。 | 当前没有实际同步盘或公司域策略测试环境；取得环境后分别核对分析集合、警告、安装结果与副作用。进程级 Restricted/AllSigned 不替代域策略。 | 实际环境符合夹具真值；不能用本地普通目录或 CI 临时盘替代同步盘。 |

## L1：可能导致崩溃、死锁或彻底不可用的架构隐患（阻塞级）

| ID | 当前问题 | 根因与风险 | 下一步与验收 |
|---|---|---|---|
| L1-18 | SQLite 锁创建窗口与忙等待缺失 | 零字节锁创建窗口可被另一实例接管；实测连接 `PRAGMA busy_timeout` 为 0。不能据此断言并发运行必然崩溃。 | 关闭锁创建接管窗口；对真实并发写入复测忙等待与错误信号。 |
| L1-19 | submodule 下 gitignore fallback 的过滤契约 | `git check-ignore` 在 submodule 路径失败时存在 fallback；大规模默认排除集合与 OOM 风险尚缺实测。 | 逐项核对 submodule 文件集合、默认排除及大规模退化行为，不能把 fallback 本身当作 OOM 证据。 |

## L2：数据一致性、静默错误与跨平台漂移（破坏级）

| ID | 当前问题 | 根因与风险 | 下一步与验收 |
|---|---|---|---|

| L2-41 | api-contracts 缺少生成客户端主流调用模式支持 (P1-14) | `client-call-extractor.js` 仅支持 axios/fetch 与局部 request。现代前后端（FastAPI 模板、OpenAPI 生成代码）中常见的 `client.<method>`、`client.request`、`__request` 全被忽略，导致生成客户端项目的前端调用数为 0。 | 扩展客户端匹配规则覆盖常见生成代码模式并在固定前后端夹具中验证。 |
| L2-45 | 父仓库的 submodule gitlink 变更不展开到源码级 audit-diff | 父 git diff 有 sub/child，父 audit-diff changedFiles 为空；子仓库独立 --cwd 则报告 helper.js。父 overview 同时索引子仓库源码，父 diff 不能据此外推对子仓库改动已完成影响分析；目前没有针对 gitlink 省略的明确说明。 | 明确父/子分析边界并提示对子仓库独立运行；若支持展开，核对两个 git 上下文而非把 gitlink 当普通文件。 |

## L3：改动时顺手处理

| ID | 当前问题 | 下一步与验收 |
|---|---|---|

## P4：冻结，出现真实用例再处理

- C/C++ include resolver 对同名目录和仓外路径的命中边界仍需验证。
- C/C++ 孤儿检测里无配对头的独立程序（带 `main` 的 `test.c`、fuzzer 入口）仍被判孤儿。
- Svelte 的 `<script>` 标签抽取及模板语义存在静态解析边界。
- Next.js 文件系统路由提取尚未建立可靠的结构映射。
- 全量测试慢（Windows 本机 355 项约 26 分钟）：慢层池利用率 98%（111 项总耗时 2037 秒，并发 2 的理论下限 1018 秒，实际 1036 秒），瓶颈是工作量而不是调度；本机 `node -e 1` 单次启动就要 0.47–1.0 秒，慢测里每次 CLI 子进程都付这笔固定成本。把慢测并发提到 4 时曾出现单项 130–172 秒、贴近 180 秒超时，因此不改并发。重新处理的条件：全量超过 35 分钟，或 CI 慢层接近作业超时。
- 暖启动剩余固定成本（Django 固定提交 `a013c821ea` 暖启动约 7–8 秒）：Python 标准库名查询的子进程约 0.35 秒，结果随解释器版本变化、内置名单不等价，所以保留；死导出预计算约 1.2 秒，`audit-overview` 输出需要它。重新处理的条件：该提交暖启动超过 10 秒。
