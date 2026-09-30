# 当前技术债

这里只列仍需处理或明确冻结的债务。修复经过和已关闭条目见 [CHANGELOG.md](../CHANGELOG.md)；外部审查仍开放的问题见 [审查待处理项](./workspace-bridge-审查报告.md)。

## P1：输出看着正常、实际是错的（静默错误）

P1 的判据：命令退出码为 0、`ok: true`，但结论残缺或不稳定，AI agent 会直接采信。下面 S-1 到 S-5 均于 2026-09-30 在 Windows、Node 25.6.0 上实测（S-4 除外，仅读代码）。术语：「图」指 `DependencyGraph.graph`（文件路径到文件信息的 Map）；「主线文件」指 `audit-overview` 里 `skeleton.mainlineFiles` 统计的非测试、非文档、非样式、非资源文件。

| ID | 现象与复现 | 影响 | 验收线 |
|---|---|---|---|
| S-1 | 文件发现超时后索引残缺，输出却报告成功。复现：把 `src/config/defaults.js` 的 `DEFAULTS.FILE_INDEX_BUILD_TIMEOUT_MS` 临时改为 30，对 zod 固定提交（`eval/truth/repos/js-ts/zod`，409 个文件）运行 `node cli.js audit-overview --cwd <路径> --json --quiet`：只索引 120 个文件，输出 `ok: true`、`warnings: []`、`analysisCoverage.coverageRatio: 1`、退出码 0，仅 stderr 一行 `Build timed out`。默认超时 300000 毫秒，超大仓库会触发。另：`container.initialize(cwd, _timeoutMs, ...)` 的超时形参从未使用，所有调用方传入的 `INIT_TIMEOUT_MS`（60000）不生效，整条初始化流水线没有总时限。 | 大仓库上 agent 拿到残缺图仍判定"分析完成"；覆盖率分母只含已索引文件，把丢失的文件隐藏了。 | 超时后 `warnings[]` 含高严重度条目（含已索引/已发现文件数），`analysisCoverage` 分母包含未索引文件或标记降级；`initialize` 要么真正执行总时限，要么删除该形参并在 AGENTS.md 写明总时限由哪一层负责。 |
| S-2 | 图的文件顺序每次冷启动都不同，下游按顺序截断的输出随之不稳定。复现：用不同的 `WB_CACHE_DIR`（覆盖缓存目录的环境变量）对同一仓库做多次冷启动，取 `Array.from(depGraph.graph.keys())` 计算哈希，每次不同（typer、cobra、ripgrep、spring-petclinic、okhttp、cJSON、vitesse、realworld、zod 均出现；边集合哈希则完全一致）。原因：解析任务按异步完成顺序写入图。可见后果：zod 上 `astRules.findings` 共 122 条、按上限只展示 100 条，四次冷启动展示的 100 条不是同一批（并集 101 条）；`deadExports`、`stability` 的顺序每次不同；`hotspots` 在四次里有一次多出 `locales/nl.ts`。暖启动输出稳定，所以平时不易发现。 | 同一份代码两次分析，被截断的列表内容不同；`elided[]` 只声明"展示 100/共 122"，agent 无法知道漏掉的是哪些。 | 图按路径排序的顺序构建（在写入处消除，不在各消费者处补排序）；同一仓库 5 次冷启动的 `audit-overview --json`（去掉时间字段）哈希相同，对 9 种语言的 eval 仓库各验证一次。 |
| S-3 | 热点与知识风险的候选文件是"图顺序的前 50 个"，不是排名前 50。代码：`src/tools/overview-assembler.js` 的 `buildHotspots` 与 `buildKnowledgeRisk` 均取 `mainlineFiles.slice(0, DEFAULTS.HOTSPOT_CANDIDATE_LIMIT)`。Django 固定提交（`a013c821ea`）有 934 个主线文件，前 50 个候选集中在 `django/views`（23 个）、`django/utils`（11 个）、`docs/_ext`，`django/db/models/query.py`、`django/db/models/base.py`、`django/http/request.py` 均不在其中；报出的 10 个热点全在 `django/views/`。 | 超过 50 个主线文件的仓库，"热点"结论只反映一个任意子集；叠加 S-2 后还随冷启动变化。 | 候选由排名（如 PageRank、被依赖数）决定，与图顺序无关：打乱图顺序后热点列表不变；Django 上候选包含 `django/db/models/` 下高被依赖文件。 |
| S-4 | git 历史读取失败被静默丢弃（仅读代码，未复现）。`overview-assembler.js` 的 `getHistoryRisk` 在 `result.ok === false` 时返回 null、抛异常时只 `console.error`，热点评分照常继续。并发 1/8/16 调用 `getFileHistoryRisk` 未出现失败，触发条件（git 超时、进程数耗尽）尚未构造。 | 历史缺失的文件被当作"无历史"参与评分，热点随环境变化。 | 历史读取失败时 `warnings[]` 含 `history-unavailable`（含失败文件数）；构造 git 超时用例验证。 |
| S-5 | 缓存写入失败与缓存损坏都不出声，永久退化为冷启动。① `container.js` 的 `cache.save()` 失败只在设置 `DEBUG` 时打印。② 把 `cache.db` 写成随机字节或截断一半：命令仍成功，但此后每次运行都是冷启动（zod 16 秒，正常暖启动 4.5 秒），文件原样不动，无任何提示。冷启动中强杀进程则可自愈（第三次运行回到暖启动），不受此影响。 | 磁盘满、杀毒软件占用、文件损坏后，工具永久变慢且无人知晓。 | 写入失败输出 `warnings[]`（`cache-write-failed`）；检测到损坏（`file is not a database` 等）时改名为 `cache.db.corrupt-<时间戳>` 并重建、输出告警；对 `cache.db` 写随机字节后运行两次，第二次回到暖启动耗时。 |

## P2：安全、缓存与文档隐患（条目编号 H-n，避免与审查报告的 P2-n 混淆）

| ID | 现象与复现 | 验收线 |
|---|---|---|
| H-1 | `--save <路径>` 不限制目录且直接覆盖已有文件，而 `--file` 会拒绝 `../` 与绝对路径。复现：`node cli.js audit-overview --cwd <工作区> --json --quiet --save <工作区外的已有文件>`，该文件被 JSON 覆盖。agent 的参数若被提示注入影响，即成任意文件覆盖点。 | `--save` 目标限定在工作区或显式允许的目录内，且不覆盖非本工具生成的文件（或需 `--force`）。 |
| H-2 | 缓存有效性靠人工递增 `src/config/versions.js` 的 `CACHE_VERSION`：解析缓存只按文件内容哈希命中，键里没有解析器版本。历史上改过 `parsers/`、`resolvers/` 的提交 83 个，改过版本号的 45 个。忘记递增时，用户拿到旧解析结果。 | 缓存戳纳入解析器与 resolver 源码的指纹（或 tree-sitter WASM 版本），改代码即自动失效。 |
| H-3 | Windows 盘符大小写分裂缓存（与 L2-24 同一问题，已实测）：对同一目录分别传 `C:\...`、`c:\...`，各建一个缓存目录、各自冷启动（14 秒、17 秒），输出的 `workspaceRoot` 大小写也不一致；`C:/...` 则复用前者。 | 缓存目录哈希前对 `workspaceRoot` 做与图键相同的归一化；三种写法只产生一个缓存目录。 |
| H-4 | 分层出现 5 条反向依赖（AGENTS.md「项目骨架」规定依赖只向下）：`src/services/container.js` → `src/tools/overview-tools.js`、`src/tools/cochange-tools.js`；`src/tools/audit-assembler.js` → `src/cli/formatters/index.js`；`src/tools/overview-tools.js` → `src/cli/formatters/dashboard-formatter.js`；`src/services/file-index.js` → `src/services/dep-graph/parsers/registry.js`。项目自身的 `boundaries` 检查为 0 违规，说明规则未覆盖这些边。 | 为这 5 条边补边界规则并消除或明确登记为例外。 |
| H-5 | `skills/workspace-audit/SKILL.md` 第 82 行称缓存默认在 `os.tmpdir()/workspace-bridge/<hash>/`，实际优先在 `%LOCALAPPDATA%`（Linux 为 `XDG_CACHE_HOME`），tmp 只是回退（`src/services/cache.js` 的 `computeDefaultCacheDir`）。AGENTS.md 原则 8 要求同步适配全部 9 种语言，而「语言范围」一节又把 Kotlin、C/C++、Svelte 降为 P3/P4，两处矛盾。 | 两处文档改为与代码和现行范围一致。 |
| H-6 | Python 分析依赖本机 Python：标准库名单来自本机解释器的 `sys.stdlib_module_names`，不同机器版本不同则内部/外部导入判定可能不同；无 Python 时退回硬编码名单。 | 输出 `warnings[]` 或字段标明所用来源与解释器版本。 |
| V-1 | 待复核：本文件（他人写入）L1-33 称增量模式在"此前没有环"时漏报新环。2026-09-30 实测未复现：无环的三文件项目里让 `c.js` 反向导入 `a.js` 并调用 `updateFiles`，`findCircularDependencies()` 与 `{skipCache:true}` 均报 1 个环；286 个文件的 TS 项目里造环、断环、再造环，环数与冷启动一致。 | L1-33 作者给出复现步骤，或将其关闭。 |

## U：未验证方向（条目编号 U-n）

U 表示"还没查过，不知道有没有问题"，不是已确认的债务。查完后有问题的转成 P1/P2/L 条目，没问题的整行删除。此前只验证过"同样输入是否同样输出"和"工具是否崩溃或悄悄退化"，没有验证"结论是否正确"。语料在 `eval/truth/repos/<语言>/<仓库名>`（gitignored，说明见 [eval/README.md](../eval/README.md)）。

| ID | 要查什么 | 怎么查 | 验收线 |
|---|---|---|---|
| U-1 | `affected-tests` 精确率。SESSION 记录 typer 为 TP 3045、FP 2512、FN 29，约 55% 的建议测试不相关。 | 读 `eval/scoreboard.json` 看其他语言同类数字；统计误报集中在哪类文件。 | 每种语言给出精确率与召回率，并列出误报最多的两类文件。 |
| U-2 | `dead-exports` 在库项目上的误报：入口文件被判 0 引用即标可删。 | 对 zod、cobra 等库仓库用 `eval/labels` 标注核对。 | 库仓库上公开 API 被标可删的数量与比例。 |
| U-3 | `honesty-engine` 的 `safeToDelete`（对应本文件 L1-28，未验证）。 | 同一批库仓库运行，统计被标 `safeToDelete: true` 的公开 API。 | L1-28 复现或关闭。 |
| U-4 | `impact` 漏报：动态 import、反射、框架约定路由不在边图里。 | 故障注入构造"改 A 应影响 B"的用例，统计漏报率。 | 每类边的漏报率；漏报处输出 `warnings[]` 或降低置信度。 |
| U-5 | 路径别名与 monorepo 解析：tsconfig `paths`、pnpm/yarn workspaces、Go 多模块、Cargo workspace。 | 在 bulletproof-react、ripgrep 等仓库统计 `unresolved` 中本应能解析的比例。 | 每种机制给出可解析比例。 |
| U-6 | 输出体积：一次 `audit-overview` 约 145 KB。 | 统计各命令默认输出大小，估算 token 数。 | 各命令默认输出大小表，并判定默认值是否需要缩小。 |
| U-7 | `--json` 契约：`schemaVersion` 1.2.0 是否有测试锁定字段。 | 对比历史提交中输出字段的增删，看有无破坏性变更未升版本。 | 字段增删清单与结论。 |
| U-8 | 报错信息是否告诉 agent 下一步该做什么。 | 逐条检查退出码 1、2 的错误文案。 | 不可操作的错误文案清单。 |
| U-9 | watch 与 REPL 长跑：内存增长、Windows 文件事件丢失、watch 进程与 CLI 同时写缓存。 | 跑 watch 一小时，周期性改文件，监控内存，结束后与冷重建输出对比。 | 内存曲线；增量结果与冷重建一致，或差异被 `warnings[]` 声明。 |
| U-10 | 超万文件真实内存（他人声称 OOM，本仓只测过合成 9000 文件）。 | 造 3 万个真实形态文件，测峰值内存。 | 峰值内存与失败阈值。 |
| U-11 | 单个巨大文件、超深目录、大量小文件（只测过 3 MB 二进制和 250 万字符单行）。 | 分别构造并运行。 | 各场景耗时、内存，以及超限时是否有声明。 |
| U-12 | Linux、macOS、WSL（含 WSL 挂载 Windows 盘时 SQLite WAL 是否可靠、路径大小写）。本机只有 Windows。 | 在对应环境运行 `node test/wb-repro.js cli.js` 与快测。 | 各平台通过情况。 |
| U-13 | Node 22.13 精确下限（只测过 22.14、22.20、25.6）。 | 用 22.13 跑快测。 | 通过，或 `engines` 改为实测下限。 |
| U-14 | 只读文件系统、容器、CI 中缓存目录不可写（只测过"路径是个文件"）。 | 构造只读目录与无权限目录。 | 各情形有明确警告，且结果与可写时一致。 |
| U-15 | 杀毒软件或 EDR 对 WASM 与 SQLite 文件的耗时干扰。 | 对比关闭实时扫描与开启时的冷启动耗时。 | 耗时差值。 |
| U-16 | 敏感信息：`.env`、密钥文件是否被读进输出或缓存；缓存目录明文存了什么。 | 造含假密钥的仓库，grep 命令输出与 `cache.db`。 | 假密钥不出现在输出与缓存；出现则登记为 P2。 |
| U-17 | 依赖供应链：运行依赖版本是否固定、有无已知漏洞。 | `npm audit`，检查 `package.json` 版本范围与锁文件。 | 结果记录。 |
| U-18 | 提示注入面：仓库内注释、文件名原样出现在输出中，可能含针对 agent 的指令。 | 造含恶意注释与文件名的仓库，看输出是否转义或标注"来自仓库内容"。 | 结论与是否需要标注。 |
| U-19 | 测试质量：304 个测试中只断言 `code === 0` 的"沉默测试"占比，以及 mutation 检查覆盖。 | 静态扫描断言；对核心模块抽样做 mutation。 | 沉默测试清单。 |
| U-20 | 跨会话并发编辑：两个会话同时改同一仓库无防护。 | 记录冲突场景，评估是否需要机制。 | 结论。 |
| U-21 | 发布流程：版本号、CHANGELOG、`npm publish` 是否自动化；仓库根 `workspace-bridge-win.exe` 是 5 月 28 日的旧构建，`pkg` 配置是否仍可用。 | 执行一次打包并运行产物。 | 打包可用性与旧二进制的处置结论。 |

## L3：改动时顺手处理

| ID | 当前问题 | 下一步与验收 |
|---|---|---|
| L3-8 | 内部契约被 `?.()`、空对象/空数组兜底吞掉，调用方可能收到静默错误。 | 触碰相关调用点时判断是否属于真实可恢复边界；内部契约错误直接暴露，并以语义测试验证。 |
| L3-12 | 测试 runner 的部分 fast/slow 分层靠源码启发式猜测，层级与实际耗时可能不符。 | 继续用 run report 的实测耗时检查猜测层；只在明确收益时改标记。 |
| L3-13 | 全量慢测耗时高（本机 301 项约 29 分钟，慢测并发 2），仍缺对整体 CPU、I/O 和并发瓶颈的归因；`cli-integration-core` 等四项在并发 4 下单项 130–172 秒，贴着 180 秒上限。 | 用完整 runner 与 CPU profile 定位成本，再决定是否调度、缓存或拆分；不可把减少测试选择误写成全量提速。 |
| L3-16 | 暖启动里仍有两处对已被 `FileIndex` 读过的文件重复 stat：`cache.js` `resolveCachedFilePath()` 对约 2977 个缓存文件各 stat 一次（Django 固定提交，全命中）；`entry-detector.js` `readScanContent()` 对 406 个文件各 stat 一次只为取大小（元数据里已有）。均未量化真实耗时。 | 先在固定 Django 提交上量各自耗时；`readScanContent` 可改读元数据 size；`resolveCachedFilePath` 的 stat 承担路径漂移兼容，改前须保住 Windows/WSL 旧 cache key 语义。 |
| L3-17 | Django 固定提交暖启动约 11–12 秒（分段计时，含采样开销，各段有重叠）：`FileIndex.build` 约 5.4 秒，其中逐文件校验只占 0.9 秒，其余约 4 秒是文件发现与过滤，尚未归因；`Builder.build` 约 6.3 秒，其中 `precomputeAggregates` 2.6 秒（`findDeadExports` 2.4 秒）；子进程：`git rev-parse HEAD` 执行两次共 1.1 秒、`git check-ignore --stdin` 0.7 秒、`python -c` 取标准库名 0.36 秒。Python 候选路径存在性探测已验证不是瓶颈（stat 次数减半、墙钟不变）。 | 先对 `FileIndex.build` 的文件发现阶段做逐步计时并归因；`git rev-parse HEAD` 在一次进程内取一次即可复用；`findDeadExports` 是否可在不需要死导出的命令里延后计算，须先看 `audit-overview` 输出是否依赖它。每步用固定 Django 提交冷/暖复测，输出计数须一致。 |

## P4：冻结，出现真实用例再处理

- C/C++ include resolver 对同名目录和仓外路径的命中边界仍需验证。
- Svelte 的 `<script>` 标签抽取及模板语义存在静态解析边界。
- Next.js 文件系统路由提取尚未建立可靠的结构映射。

## 外部审查待办

[审查待处理项](./workspace-bridge-审查报告.md) 保留 P0/P1/P2 开放问题、复现步骤和固定仓库版本。完成一项后从活跃清单移除，将原因、改动与验收写入 CHANGELOG。
