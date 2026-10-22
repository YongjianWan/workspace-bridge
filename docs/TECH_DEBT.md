# 当前技术债

这里只列仍需处理或明确冻结的债务。修复经过和已关闭条目见 [CHANGELOG.md](../CHANGELOG.md)。原外部审查报告的开放项已并入本文件。

## 根因归属（修法见 [ROADMAP.md](../ROADMAP.md)「架构修复路线（冻结）」）

以下归类只对应当前开放条目；结构性方案见 ROADMAP。根因 A（缺少统一的分析台账）、根因 C（建图与分析存在重复工作）和根因 E（语言能力缺少统一声明）目前没有开放条目，所以表中没有它们。

| 根因 | 证据 | 对应条目 |
|---|---|---|
| 输出没有统一出口（横切） | 规则散在 `elideDeep`、`route-formatter.js`、两千行量级的 `human-formatters.js` | 冻结（见 P4） |
| 根因 D：结论缺少按目标说明的证据边界 | `impact` 每行只给文件名和图层级，不说明为什么入选；diff 上下文是否生效也不说明 | H-36、L3-19 |

不归入上述原因、独立处理：H-19、H-34、H-35、H-37、H-38。

## P1：输出看着正常、实际是错的（静默错误）

| ID | 现象与复现 | 验收线 |
|---|---|---|
| H-36 | `impact` 的 diff 上下文排序在以下三条路径不生效，输出既没有 `warnings[]`，也没有字段说明这一步是否生效（返回对象见 `src/tools/dep-tools/impact.js:47-65`）：① 工作区 diff 超过 `DIFF_CONTEXT_MAX_DIFF_CHARS`（20 万字符）时整段丢弃（`src/tools/dep-tools/diff-context.js:57-62`）；② diff 超过 `maxBuffer`（40 万字符）或 git 调用失败时，`readWorkspaceDiff` 返回 null（`diff-context.js:139-145`）；③ 标识符按全工作区 diff 中出现的先后只取前 `DIFF_CONTEXT_MAX_SYMBOLS`（200）个（`diff-context.js:77`），输入文件自己的改动可能被其他脏文件的标识符挤掉。生效时行上带 `source: 'diff-context'`，但 agent 分不清"工作区没有改动"和"改动被丢弃"。属 AGENTS L1-4 所说的环境降级；2026-10-22 读代码确认。 | 输出增加 diff 上下文状态（是否生效、原因、提取的标识符数、是否截断），或在降级路径写 `warnings[]`；`test/impact-diff-context-test.js` 对超长 diff、git 失败、标识符截断三条路径各断言一个可见信号；工作区干净时不产生警告；JSON 字段快照测试同步（契约只增不删）。 |

## P2：安全、缓存与文档隐患（条目编号 H-n）

| ID | 现象与复现 | 验收线 |
|---|---|---|
| H-19 | 发布流程半手动且已多次中断，版本号与发布物脱节。2026-10-02 实测：① 发布只由推送 `v*` 标签触发（`.github/workflows/release.yml`：`npm ci` → 快层测试 → 冒烟 → `npm pack` → GitHub Release → `npm publish --provenance`）；版本号与 CHANGELOG 靠手工提交（如 `ad84bd1` "切版 2.1.0"），仓库里没有自动化脚本。② `package.json` 为 2.1.0（2026-07-17）、CHANGELOG 有 `[2.1.0]`，但最新标签与 GitHub Release 是 `v1.2.1`（2026-05-28），此后 271 个提交，2.0.0、2.1.0 从未打标签。③ 发布工作流最近 3 次（v1.1.0、v1.1.1、v1.2.1）都失败在 "Publish to npm"，v1.0.2、v1.0.3 成功；现查 `npm view workspace-bridge` 返回 404（包不在 npm 上）。④ 冒烟步骤只检查 `--version` 与 `workspace-info`：本机按同样步骤解压 `npm pack` 产物（192 个文件，约 550 KB，不含 `eval/`、`test/`、`docs/`）到没有 `node_modules` 的目录，二者都通过，而 `audit-overview` 在该目录退化为 regex 解析（提示 `@babel/parser not available`）；所以产物缺运行依赖时冒烟仍会绿。⑤ 打包：`npx pkg . --targets node22-win-x64` 离线构建成功（20 秒，使用缓存的 v22.22.3 基础二进制；`pkg` 对 `tree-sitter-wasms` 动态 require 给出一条警告），产物 121 MB，`--version` 为 2.1.0，在 typer 上 `audit-overview` 解析 639/639 个文件，覆盖率与警告和 `node cli.js` 一致。仓库根的 `workspace-bridge-win.exe`（114 MB，已被 `.gitignore` 忽略）仍可运行，但版本是 2.0.0，落后 274 个提交。 | 先查明 npm 发布失败的原因（令牌或包名权限），再决定是否发布；补打 2.0.0/2.1.0 对应标签或在 README 说明版本从 2.x 起不再发布；冒烟增加一条需要运行依赖的分析命令（如对解压目录自身 `audit-overview` 并检查 `parsedFiles` 大于 0 且无 `@babel/parser not available`）；旧 `workspace-bridge-win.exe` 是删除还是用新构建替换，由项目所有者决定。
| H-34 | 入口标记一词两义：`src/utils/project-context.js` 的 `isEntry` 既表示"运行时由框架调用，不报孤儿 / 死导出"（`src/utils/orphan-detector.js`、`src/services/dep-graph/analyzer.js`），又被 `src/services/dep-graph/query.js` 的 `getImpactRadius` 当作"遇到即停"。`/mapper/`、`/repository/`、`/config/`、`/task/` 目录和文件名含 `filter|wrapper|validator|serializer` 的 Java 文件因此成为影响分析的终点。J1 回放（截 15、关入口停止对开入口停止）：Java→Java 0.496→0.526、实体→VO/DTO 0.211→0.350、Mapper XML→Java 0.516→0.629，复跑 `node eval/truth/phase1-info-probe.js`（本机）。 | 两种语义分成两个判断：孤儿 / 死导出豁免保持现状；影响停止只认真正的汇聚点（Controller、`main`、框架启动类）。J1 默认配置回放各边类型不低于现状，实体→VO/DTO 与 Mapper XML→Java 提高；孤儿与死导出数在评测语料上不变（`node eval/run.js && node eval/score.js` 零 FAIL）。2026-10-11 已实施（`1a3d25b`、`c94532e`）：影响停止改为"入口且所有引用方都是测试"，`test/impact-entry-stop-test.js` 六语言夹具锁定；回放（`0a5a1a4`，代码同 `c94532e`，dirty=false，0 错误，中位 15）：J1 全部类型 0.5661→0.5735、Java→Java 0.5856→0.5897、Java→Mapper XML 0.5962→0.5975、Mapper XML→Java 0.6208→0.6433、实体→VO/DTO 0.4245→0.3854（32 个输入中 2 个各丢 1 个真值，原排第 9 位，被新增图行挤出前 15）；F1 0.5247→0.5302；P1 0.5175→0.5533。完整 runner 383/383、eval 23 PASS / 0 FAIL、scoreboard 指标无变化（死导出与孤儿数不变）、CI 9/9。实体→VO/DTO 未达原召回验收线；2026-10-12 项目所有者明确保留语义修复并接受上述代价，旧阶段召回门禁继续未通过。当前进入语义与通用回归的待验收状态。 |
| H-35 | `src/services/dep-graph/analyzer.js` 的 `findAffectedRoutes` 把所有 `isKnownEntryFile` 为真的文件记成"受影响路由"的终点，MyBatis Mapper 接口、barrel `index` 这类被生产代码引用的入口会被当成请求处理器列进 `impact` 的 `affectedRoutes`。只影响标签，不截断遍历；与 H-34 同属入口标记一词两义。 | 路由终点只认请求处理器（Controller、路由文件、框架页面）；在含 MyBatis Mapper 的夹具上 `affectedRoutes` 不出现 Mapper 接口，Controller 仍出现。 |
| H-37 | `impactCount` 不反映单个文件的影响大小。它等于合并排序后的全部行数（`src/tools/dep-tools/impact.js:51`），而默认 `direction=all`、深度 5 的遍历基本覆盖整个连通图。2026-10-22 在本仓库实测 4 个位置差别很大的输入：`src/tools/dep-tools/impact.js`、`src/tools/summaries/index.js`、`src/utils/truncate.js`、`src/config/constants.js`，`impactCount` 分别是 530、530、532、532，直接引用方数（`symbolImpact.directCount`）分别是 2、2、9、73。`skills/workspace-audit/SKILL.md:47` 让 agent 用 `impactCount` 看相关性截断后的剩余总数，`SKILL.md:107` 让 agent "以计数为准判断影响范围"，agent 会把一个对任何输入都差不多的数读成这个文件的影响大小。 | SKILL 改为用有区分度的计数判断影响范围（例如直接引用方数、按方向拆开的遍历计数），并说明 `impactCount` 是合并候选总数；`impactCount` 字段保留（契约只增不删）。新增计数字段时，在上述 4 个输入上新计数之间有明显差异，并有测试锁定。 |
| H-38 | 回放口径 v1（ROADMAP 5.2）有三处会让结论偏乐观或无法判断。2026-10-22 对 `eval/truth/replay/` 下 J1、F1、P1 的 `runs.jsonl` 重算（按提交有放回抽样 10000 次）：① 笨基线"篇幅对齐"实际没对齐：候选只取共改至少 1 次或同主干的文件，常凑不满；J1 留出集 110 个输入中 66 个比工具短、22 个为空。用同目录文件补到同样长度后，J1 Java→Java 增益从 +15.1pp 降到 +12.1pp（95% 区间 [+4.0, +21.9]），F1 默认配置对补位基线只高 +2.3pp，区间跨 0。② 两级平均让只有 2 个 Java 输入的小提交占了近一半权重：J1 留出集按配对加权，工具 0.414、笨基线 0.194；Java 输入超过 3 个的 11 个提交上，工具 0.523。③ 结论不带区间：J1 留出集只有 20 个提交，工具 0.6545 的 95% 区间是 [0.512, 0.793]，增益 +15.1pp 的区间是 [+6.1, +25.1]，分不清 0.6545 和 70%，也分不清 +15.1pp 和 +15pp，按每提交召回的标准差推算约需 410 个提交才能分清前者（2026-10-11 止损依据的样本内 75 个提交为 0.5856，区间 [0.509, 0.662]，已排除 70%）。同一批 20 个提交已被用来挑 diff-context 版本、裁决 15 个排序变体，不再适合当 T2.2 的任务池（ROADMAP 第 7 节）。 | 回放口径升 v2，按 5.2 规则更新版本号并用新口径重跑已有结果：笨基线候选不足时用同目录文件补到与工具同长度；summary 同时报两级平均和按配对加权的召回，并给出按提交 bootstrap 的 95% 区间；ROADMAP 第 7 节 T2.2 改用从未回放过的提交当任务。 |

## U：未验证方向（条目编号 U-n）

U 表示"还没查过，不知道有没有问题"，不是已确认的债务。查完后有问题的转成 P1/P2/L 条目，没问题的整行删除。U 表只列尚未核对的方向，验证经过只写 CHANGELOG。语料在 `eval/truth/repos/<语言>/<仓库名>`（gitignored，说明见 [eval/README.md](../eval/README.md)）。

| ID | 要查什么 | 怎么查 | 验收线 |
|---|---|---|---|
| U-15 | 深信服 aES 本身对 WASM 与 SQLite 耗时的影响仍未隔离。 | 当前没有可用对照条件；待项目所有者或公司提供可比较的防护条件或性能取证环境；不要求卸载，不由 agent 修改系统安全设置。 | 可归因的耗时对照；腾讯开关结果不能外推为深信服影响。 |
| U-30 | 真实同步盘 SQLite WAL 与公司域策略下的安装行为。 | 当前没有实际同步盘或公司域策略测试环境；取得环境后分别核对分析集合、警告、安装结果与副作用。进程级 Restricted/AllSigned 不替代域策略。 | 实际环境符合夹具真值；不能用本地普通目录或 CI 临时盘替代同步盘。 |
| U-32 | 同主干候选规则对前端仓库召回的影响。`impact` 的同主干候选（`src/tools/impact-ranking.js:16-32,77-87`）按"去掉最后一个扩展名、再剥去后缀表后的基名相等"选取，不限目录和语言，并且整组排在共改候选前面。2026-10-22 本仓库实测：输入 `src/tools/summaries/index.js` 时，前 15 里第 2、4、7 位是其他目录的 `index.js`。前端仓库里 `index.vue`、`index.js` 很多，这条规则在 F1 上一直生效，但没做过消融。 | F1 回放做消融：同主干限同目录（或限同扩展名）对现状，其余参数不变，比较前端内部召回。 | 消融结果写进 ROADMAP 第 6 节；召回提高就改规则并转成 H 条目，不提高就删除本行。 |
| U-33 | 回放只评估 `impact` 命令的默认配置（深度 5、前 15、输入文件自己在该提交里的最终 diff，见 `eval/replay-impact.js:482-486`），以下三条实际使用路径没有召回数字：① `skills/workspace-audit/SKILL.md:30` 把"改特定文件前评估影响"引到 `audit-file`，它调 impact 时不传深度（`src/tools/audit-assembler.js:412-418`），落到 `getImpactRadius` 的默认深度 3，索引超过 500 个文件时每个列表压到 5 条（`COMPACT_IMPACT_MAX`）；② A4 的全工作区 diff：回放显式传单文件 diff，这条路径从未触发；③ 共改历史窗口 300 个提交（`src/tools/cochange-tools.js:11`）：J1、F1、P1 的非合并提交都少于 300，窗口从未截断过；另外工具按提交里全部文件数过滤超过 20 个文件的提交（`cochange-tools.js:93`），回放按统计文件数过滤，两边对"大提交"的口径不同。 | ① J1 回放加 `--impact-option max-depth=3 --impact-option max-files=5`，对照默认配置；② 回放增加一种模式，把同提交其他输入文件的 diff 一并传入，对照单文件 diff；③ 选一个非合并提交超过 300 的仓库，对照窗口 300 与不限。 | 三条各有一组回放数字写进 ROADMAP 第 6 节；召回明显低于 `impact` 默认配置的路径，转成 H 条目（例如改 SKILL 的引导或 audit-file 的深度）。 |

## L1：可能导致崩溃、死锁或彻底不可用的架构隐患（阻塞级）

当前无开放条目。

## L2：数据一致性、静默错误与跨平台漂移（破坏级）

当前无开放条目。

## L3：改动时顺手处理

| ID | 现象与复现 | 验收线 |
|---|---|---|
| L3-19 | `impact` 的每行不说明自己为什么入选，agent 没法按证据强弱取舍：① `curateImpact` 合并时，共改或同主干候选如果也在图结果里，输出用图行替换，行内的 `coChangeCount` 和 `source` 丢失（`src/tools/impact-ranking.js:90-103`）；② 只共改过 1 次的候选能进前 15，但顶层 `coChanges` 只列共改至少 2 次的文件（`src/tools/dep-tools/impact.js:24`），同主干入选的原因在输出里也看不到；③ diff 上下文行只有 `diffRefs` 分数，不列匹配到的标识符（`src/tools/dep-tools/diff-context.js:105-111`）。2026-10-22 本仓库实测：输入 `src/tools/dep-tools/impact.js` 时前 15 行全部没有 `source`、`confidence` 字段，其中 7 行同时出现在顶层 `coChanges`（计数 2–4），占的是共改候选的槽位。SESSION「前沿方法」C1（给证据，排序交给 agent）以本条为前置。 | 每行列出全部入选来源（图层级与 `via`、共改次数、同主干、diff 匹配到的标识符），重复来源合并保留，不互相覆盖；前 15 的顺序不变（回放召回不变）；夹具锁定"图行与共改候选重复时两类证据都保留"；JSON 契约只增字段。 |

## P4：冻结，出现真实用例再处理

- C/C++ include resolver 对同名目录和仓外路径的命中边界仍需验证。
- C/C++ 孤儿检测里无配对头的独立程序（带 `main` 的 `test.c`、fuzzer 入口）仍被判孤儿。
- Svelte 的 `<script>` 标签抽取及模板语义存在静态解析边界。
- Next.js 文件系统路由提取尚未建立可靠的结构映射。
- 全量测试慢（Windows 本机 355 项约 26 分钟）：慢层池利用率 98%（111 项总耗时 2037 秒，并发 2 的理论下限 1018 秒，实际 1036 秒），瓶颈是工作量而不是调度；本机 `node -e 1` 单次启动就要 0.47–1.0 秒，慢测里每次 CLI 子进程都付这笔固定成本。把慢测并发提到 4 时曾出现单项 130–172 秒、贴近 180 秒超时，因此不改并发。重新处理的条件：全量超过 35 分钟，或 CI 慢层接近作业超时。
- 暖启动剩余固定成本（Django 固定提交 `a013c821ea` 暖启动约 7–8 秒）：Python 标准库名查询的子进程约 0.35 秒，结果随解释器版本变化、内置名单不等价，所以保留；死导出预计算约 1.2 秒，`audit-overview` 输出需要它。重新处理的条件：该提交暖启动超过 10 秒。
- 语言处理分散：提到 Kotlin 的源文件 23 个、Rust 24 个、Go 25 个，每门语言都是同一量级。当前没有新增语言的计划；决定新增第 10 门语言之前，先把语言专属分支收进语言注册表。
- 超大仓库内存：生成仓库实测 3060 文件暖启动峰值 184 MB、30600 文件 1508 MB（每文件约 0.13 MB，线性）；外推 10 万文件约 4.5 GB，接近 Node 默认堆上限。重新处理的条件：出现 5 万文件以上的真实仓库，或有人报告 OOM。
- `affected-tests` 精确率：typer 0.548（召回率 0.991），cobra 0.374，spring-petclinic 0.563。`node eval/verify-h7-tradeoff.js` 实测任何截取规则都满足不了召回率 0.9（距离 ≤ 1 时精确率 0.947、召回率 0.063），原因是真值里的测试确实经共享入口执行到几乎所有源文件；输出已按距离、枢纽扇入排序并带 `distance`/`via`。重新处理的条件：有了运行时覆盖信息可作为边的权重。
- 输出没有统一出口：路径写法已在 `src/cli/path-spelling.js` 统一，但 `elideDeep`、`route-formatter.js`、`human-formatters.js` 各自处理截断、掩码与格式，没有一份按命令的 JSON Schema。当前没有因此产生的错误输出；出现第二类跨命令输出不一致时，再收口为单一序列化器（ROADMAP 步骤 6）。
