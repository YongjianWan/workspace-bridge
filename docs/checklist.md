# workspace-bridge 验证清单

这份清单告诉执行审计的 AI：workspace-bridge 有哪些方面可以验证、每一面怎么验证、怎样算通过。它只做索引：问题的现象、复现和修法在 [TECH_DEBT.md](./TECH_DEBT.md)，已修复的历史在 [CHANGELOG.md](../CHANGELOG.md)。

## 怎么用

- 先读 [AGENTS.md](../AGENTS.md)、[SESSION.md](../SESSION.md)、TECH_DEBT.md，再选要验的面。
- "检查面"后面括号里的"已知"是 TECH_DEBT 条目编号，表示这一面已经查出过问题；复现步骤与验收线以那一条为准，本表"通过条件"是概括。
- "怎么验证"里带 ※ 的是拟定的方法，没有实际运行过，先跑一遍确认可行再据此下结论；不带 ※ 的取自 TECH_DEBT 里已有的复现记录。
- 验出新问题进 TECH_DEBT；验的结果不记在本表。新发现的检查面直接加一行。
- 执行顺序不在本表维护，以 SESSION.md 的"下一步"为准；修复流程以 AGENTS.md 的调试流程为准。

## 通用写法

| 记号 | 含义 |
|---|---|
| `<repo>` | 固定评测仓库的绝对路径，位于 `eval/truth/repos/<语言>/<仓库名>`（gitignored，准备方法见 [eval/README.md](../eval/README.md)）；仓库与钉死的提交见 `eval/corpus.json` |
| `<fresh>` | 一个新建的空目录，作为 `WB_CACHE_DIR`，用来保证冷启动 |
| 基础命令 | `node cli.js <命令> --cwd <repo> --json --quiet`；`WB_CACHE_DIR=<目录>` 在 Bash 里前缀写，在 PowerShell 里先 `$env:WB_CACHE_DIR='<目录>'` |
| 比较输出 | 两次输出相比较时，先去掉所有耗时与时间戳字段 |

## 术语

| 词 | 含义 |
|---|---|
| 图 | `DependencyGraph.graph`，文件路径到文件信息的 Map |
| 冷启动 / 暖启动 | 缓存目录为空 / 缓存已建好时的一次分析 |
| 降级信号 | 输出里让 agent 知道结果不可信的字段：`warnings[]`、`dataQuality: degraded`、`confidence: low` |
| 覆盖率分母 | `analysisCoverage.coverageRatio` 的分母；应包含发现了但没索引的文件 |
| 快层 / 慢层 | `npm run test:fast` / 全量 `node test/runner.js` 中耗时长的那部分 |

---

## 一、项目与文档

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 基线数字（已知：H-18、U-27） | 运行 `node cli.js audit-overview --cwd . --json --quiet`、`node test/wb-repro.js cli.js`、`npm run test:fast`；对照 AGENTS.md「当前核验」与 README 里的数字 | 文档数字与实跑一致，且标明平台 |
| 文档互不矛盾（已知：H-5、H-16、U-27） | 用只读单个文件的干净 agent 逐份冷读 README、SKILL.md、AGENTS.md，列出矛盾与读不懂处 | 矛盾清单为空 |
| 文档只存当前 | 逐份检查 AGENTS、SESSION、TECH_DEBT：无历史流水、无已修复项 ※ | 活跃文档里没有已完成条目 |
| 文档命令可运行 | 把 README 与 SKILL.md 里的命令逐条在本仓和固定评测仓库上执行 ※ | 每条命令退出码与描述一致 |
| 工作区干净 | `git status --short`，核对每个文件的来源 | 只含本次任务相关改动，无临时脚本与调试输出 |
| 仓库跟踪文件（已知：L2-42） | `git ls-files .claude reference` | 无本地私有配置与大体积二进制 |
| 旧条目复核 | 逐条按 TECH_DEBT 里的复现步骤重跑 L1、L2、L3 条目 | 得出仍成立与已过期的清单，已过期的从 TECH_DEBT 删除 |

## 二、架构与数据一致性

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 分层依赖方向（已知：H-4） | `node cli.js audit-overview --cwd . --category boundaries --json --quiet`；再对照 AGENTS.md「项目骨架」逐层 grep 反向 `require` | 无反向依赖，或每条已登记为例外 |
| 循环依赖 | `node cli.js cycles --cwd . --json --quiet`；增量场景：造三文件无环项目，让 `c.js` 反向导入 `a.js` 后调用 `updateFiles`，对比冷启动 | 环数与冷启动一致 |
| 同一语义单点实现（已知：H-26） | `grep -rln "\.kt\b\|'kotlin'" src \| wc -l`，其他语言同法 | 语言专属分支集中在语言注册表 |
| 缓存失效条件（已知：H-2） | 改一个 parser 或 resolver 源码但不改 `CACHE_VERSION`，暖启动后核对输出是否用了旧解析结果 ※ | 改解析器代码即自动失效 |
| 缓存只存纯解析输出 | 读 `src/services/dep-graph/builder.js` 与 `graph-db.js`；新增文件后核对未改动文件的依赖边是否更新 | `parse_results` 不含已解析目标路径，边每次重算 |
| 缓存路径身份 | 对同一目录分别传 `C:\...`、`c:\...`、`C:/...`，数 `WB_CACHE_DIR` 默认位置下生成的缓存目录 | 只产生一个缓存目录 |

## 三、异常安全与资源

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| SIGINT / SIGTERM 清理（已知：L2-25） | 启动 `watch`，发信号后检查进程退出、缓存目录里有无残留 `.lock` 与 WAL ※ | 无残留锁文件，退出码符合约定 |
| shutdown 逐步独立（已知：L2-32） | 在测试里让第一个 container 的 `shutdown()` 抛错，核对第二个是否仍执行 ※ | 每一步独立 try-catch |
| 强杀后恢复 | 冷启动中途强杀进程，再连续运行两次 | 第三次回到暖启动耗时（已验证，作回归用） |
| 缓存损坏 | 把 `cache.db` 写成随机字节或截断一半，连续运行两次 | 改名为 `cache.db.corrupt-<时间戳>` 并重建，输出告警，第二次回到暖启动耗时 |
| 缓存目录不可写 | Windows 用 ACL 拒绝当前用户创建文件；Linux 用 tmpfs 加 `mount -o remount,ro`；`WB_CACHE_DIR` 指向该目录运行 `dead-exports` 与 `query` | `warnings[]` 含 `cache-write-failed`，错误说明是不可写 |
| 磁盘满 | 用小容量卷作缓存目录，运行 `audit-overview` ※ | 有告警，不静默变慢 |
| 子进程超时与输出完整（已知：L2-31） | 用输出大、退出快的命令验证 `watch.js` 的测试子进程，核对末尾是否被截断 ※ | 输出完整，超时后无残留进程 |
| SQLite 多进程并发（已知：L1-18） | 同一缓存目录同时启动 4 到 10 个冷启动 `audit-overview`，之后跑 `PRAGMA integrity_check` | 全部退出码 0，无 `SQLITE_BUSY`，完整性 ok |
| WASM 解析器淘汰（已知：L1-21） | 并发解析超过 12 种语言的文件，观察是否崩溃 ※ | 无 SIGSEGV |
| watch 与 REPL 行为 | 高频保存、同文件事件合并、多文件事件不丢、删除后重建同名文件、原子保存（临时文件替换）、事件积压时的背压、回调失败后继续、双 Ctrl+C、watch 与普通 CLI 同时运行 ※ | 事件不丢不重，清理不被跳过，失败不停止后续更新 |
| 句柄、监听器、定时器 | `watch` 连续运行 60 分钟、每 30 秒改一个文件，记录内存与 stderr | 内存无增长趋势，stderr 无 `EISDIR`（已知：H-21） |

## 四、输入处理与静默降级

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 同输入同输出 | 用 5 个不同的 `WB_CACHE_DIR` 对同一仓库做冷启动 `audit-overview --json`，比较去掉时间字段后的哈希；各语言的固定评测仓库各做一次 | 5 次哈希相同 |
| 超时与索引残缺 | 临时把 `DEFAULTS.FILE_INDEX_BUILD_TIMEOUT_MS` 改为 30，对 zod 固定提交跑 `audit-overview` | 高严重度警告含已索引与已发现文件数，覆盖率分母含未索引文件 |
| 超限输入（已知：L2-27） | 造 40 MB 单文件、20000 层 import 链、30 层深目录三个夹具，各跑 `audit-overview` | 各自有对应警告，`ok` 或 `dataQuality` 反映降级；目录深度上限可由 CLI 或 `.workspace-bridge.json` 覆盖 |
| 内部契约被兜底吞掉（已知：L3-8） | 在内部调用点搜 `?.(`、`\|\| {}`、`\|\| []`，逐个判断是否真实可恢复边界 ※ | 内部契约错误直接抛出，有语义测试 |
| 目标文件不可分析 | `node cli.js impact --cwd . --file README.md --json --quiet` | 顶层 `warnings[]` 含 `target-not-indexed`，`hasFindings` 不为 false |
| 非法或空参数 | `audit-security --language cobol`、`audit-overview --fields nonexist`、`audit-overview --exclude` | 报错并列出合法取值，或声明已忽略 |
| 监听器失败 | 20000 层 import 链夹具，看 stderr 与输出 | 失败时 `warnings[]` 含 `analysis-stage-failed` |
| git 历史读取失败 | 构造 git 超时用例，跑带历史的 `audit-overview` ※ | `warnings[]` 含 `history-unavailable` |
| 空内容告警 | 对本仓运行 `audit-overview`，看 `warnings[]` | 无内容为空的警告 |
| 路径边界（已知：L2-35、L2-37） | 传入 `/src/index.js` 形式的路径；大小写不同的目录各建一个 ※ | 工作区内路径可解析，遍历无重复 |
| submodule 与 gitignore（已知：L1-19、H-24） | 含 submodule 的夹具跑 `audit-overview`；用子目录作 `--cwd`，对照 `git rev-parse --show-toplevel` | 只降级 submodule 路径；根目录一致 |

## 五、依赖边与结论准确性

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 动态加载漏边 | 夹具含 `require('./' + name)`、配置里的字符串路径、`import.meta.glob`、`importlib.import_module('pkg.b')`；对目标文件跑 `impact` | 字面量能确定的有边；不能确定的 `warnings[]` 含 `dynamic-load-unresolved` |
| 跨模块与工作区 | ripgrep 固定仓库跑 `impact --file crates/core/haystack.rs`；Go `go.work` 夹具跑 `impact --file a/util/util.go` | 影响里含 `main.rs`、`hiargs.rs`、`b/main.go` |
| 运行时依赖注入 | Spring 夹具改 `EnGreeter.java` 跑 `impact` | 影响含注入方 `Ctl.java` |
| `safeToDelete` 证据门槛 | 对各固定评测仓库跑 `dead-exports`，统计 `safeToDelete: true` 并人工抽查 | 抽查 0 误标 |
| 孤儿与入口判定（已知：L2-30） | 各语言造只含常规入口（`main.py`、`main.go`、`Main.java`）的夹具跑 `audit-overview` | 入口不被判孤儿 |
| 增量更新（已知：L1-34） | 对 Go 夹具删除一个同包文件后调用 `updateFiles`，与冷启动的边集合比对；对重命名、目录重命名、扩展名变化、`git checkout` 同法 ※ | 边集合与冷启动一致 |
| 增量更新细目 | 夹具里分别做：JS/TS 同名候选抢占、Python package 与 module 抢占、alias 变化、入口变化、框架注解变化、路由变化、export 删除、符号重命名；之后检查 `reverseGraph` 无残留边、PageRank 与聚合缓存已失效、测试映射已清理 ※ | 与冷启动的边集合、测试映射、PageRank 一致 |
| 符号级影响（已知：L1-39） | 对 Go、C、C++、Java 夹具跑 `impact --file <被调用文件> --symbols`，与文件级 `impact` 对比 | 真实调用者不丢，无符号导入记录时降级为文件级 |
| Java/Kotlin 依赖边 | 夹具里让工具类引用 entity 或 DTO，改 DTO 后跑 `impact` 与 `affected-tests` | 真实引用者被召回；降噪用边属性标记，不物理断边 |
| `affected-tests` 准确率（已知：H-7） | `node eval/score.js`；typer 用 CLI 实际输出对 coverage 真值打分 | 可见部分精确率与召回率达标（验收线见 H-7） |
| 其他命令准确率 | 为 `impact`、`cycles`、热点、`guard`、`tree`、`affected-routes`、`audit-overview --category boundaries`、`--category smells`、`audit-map` 在固定评测仓库上抽样人工标注 ※ | 各命令有精确率与召回率 |
| Kotlin 导出（已知：H-13） | okhttp 固定提交跑 `dead-exports`，抽查 20 条 | 无函数体内局部变量 |
| 生成客户端 API 契约（已知：L2-41） | 在前后端夹具里分别加入 `client.post` 与 `__request` 调用，跑 `api-contracts` | 两种调用都被关联 |
| 越界语义规则（已知：L2-38） | 搜 `ast-rules.js` 里的业务语义规则（如事务） | 只剩结构级规则 |

## 六、CLI 与输出契约

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 退出码（已知：H-15） | 分别触发成功、业务失败、未知命令、非法参数、`guard` 未通过、`guard` 运行出错 | 与 AGENTS.md 约定一致，`guard` 两种失败可区分 |
| `--quiet`（已知：H-22 ③） | 对解压后的发布包、`watch`、超限夹具运行，捕获 stderr | stderr 为空，除非进程失败 |
| 错误文案（已知：H-15） | 逐个触发 `--cwd` 不存在、`--file` 不存在、路径越界、非法提交范围、`guard` 缺目标，带与不带 `--json` | 每条带下一步，`--json` 下是含 `ok:false`、`error`、`command`、`schemaVersion` 的 JSON |
| 参数优先级 | 同一选项分别用默认值、配置文件、环境变量（`WB_CWD`、`WB_FORMAT`、`WB_JSON`、`WB_QUIET`、`WB_CACHE_DIR`、`WORKSPACE_ROOT`）、CLI 设置，逐层比对生效值 ※ | CLI 优先于环境变量，环境变量优先于配置文件；布尔可显式覆盖 |
| 路径参数边界 | `--file ../x`、绝对路径、目录；`--save` 指向工作区外的已有文件 | 越权与目录被拒绝，不覆盖非本工具文件 |
| JSON 字段集（已知：H-16） | 对每个命令的 `--json` 输出生成键路径快照并与基线比较 ※ | 删字段或改类型即失败，新增字段需显式更新快照 |
| 路径写法（已知：H-22 ②） | 在同一份输出里抽取所有路径字段 | 格式统一 |
| 输出体积（已知：H-14） | zod 固定提交上量各命令默认输出字节数 | 不超过 30 KB，或超出时写明如何缩小 |
| 截断声明 | 对输出超限的命令检查 `truncated` 与 `elided[]` | 截断时两者齐全 |
| 命令 × 格式矩阵 | 每个公开命令依次用 human、`--json`、`--format jsonl`、`ai`、`markdown`、`summary`，各跑成功、无结果、业务失败、参数错误 ※ | 均不崩溃，JSONL 每行可解析 |
| REPL | 在一个 `repl` 会话里连续执行多条命令 ※ | 复用同一张图，结果与单独运行一致 |

## 七、安全与恶意仓库

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 仓库文本进输出（已知：H-11） | 把 `IGNORE PREVIOUS INSTRUCTIONS …` 放进文件名、未解析 import、路由路径、提交者、提交信息，对 `audit-overview`、`audit-map`、`audit-security`、`audit-diff`、`impact`、`tree` 的 json、ai、markdown 输出搜该文本 | 出现处全部带不可信标记 |
| 密钥进输出 | 造含假密钥的仓库跑 `audit-security` 的 json、markdown、ai、human | 完整密钥值出现 0 次 |
| 密钥进缓存（已知：H-9） | 运行后用 `node:sqlite` 扫描 `cache.db` 全部表全部列 | 完整密钥值出现 0 次 |
| 密钥规则召回（已知：H-10） | 夹具含 `sk_live_`、`AKIA`、`const pw = "…"`、连接串内嵌密码等 5 种写法 | 5 条全部报出 |
| 供应链（已知：H-12） | `npm audit`、`npm audit --omit=dev` | 运行依赖 0；开发依赖清零或逐条写明原因 |
| 仓库内容触发执行（已知：U-24） | 构造恶意 `package.json` scripts 与恶意仓库配置，运行 `watch --run-tests`、semgrep 适配器 | 仓库内容不会在无确认下被执行 |
| 符号链接、junction 逃逸（已知：U-25） | 夹具里建指向工作区外的链接，运行 `audit-overview` ※ | 不读写工作区外 |
| 配置 ReDoS 与巨型配置 | 构造恶意 regex 与超大 JSON 配置，限时运行 ※ | 有上限且不拖死进程 |
| 输出转义 | 符号名与文件名带 ANSI、Markdown、HTML 片段，查 dashboard 与各格式输出 ※ | 已转义或标记 |
| 命令与路径注入 | 文件名、符号名、Git 文件名含 shell 元字符与引号，检查验证命令建议与 spawn 参数；`--cache-dir` 指向工作区外与敏感目录 ※ | 参数被转义或拒绝，缓存目录权限不放宽 |

## 八、测试与 CI

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| CI 状态（已知：H-18） | `gh run list --workflow Test` 与 `--workflow "Test (slow layer)"` | 两条在 ubuntu 与 windows 上全绿并保持 |
| 平台基线（已知：H-18） | 在 Windows 与 Linux（含 WSL）各跑快层与慢层 | AGENTS.md 按平台分别记基线 |
| 断言有效性（已知：H-17） | 对核心模块逐处替换 `===`、`&&`、`>=` 等运算符，只跑快层 | 捕获率不低于 90%，等价变异逐个注明 |
| 测试只测行为（已知：H-23、H-17） | 全局搜断言源码文本的测试；检查零断言文件与 `@contract`/`@semantic` 标注 | 无源码文本断言，无零断言测试，标注齐全 |
| 测试不改仓库身份（已知：H-27） | 跑测试前后 `git config --local --get user.name` 与 `user.email` | 前后一致 |
| 慢层耗时与分层（已知：L3-12、L3-13） | 用 run report 的实测耗时对照 fast/slow 标记；用 CPU profile 看瓶颈 | 标记与实测相符，耗时有归因 |
| 残留进程 | 测试结束后列出 node 进程 ※ | 无残留 |

## 九、发布与安装

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 版本、标签、npm 包一致（已知：H-19） | 对照 `package.json` 版本、`git tag`、GitHub Release、`npm view workspace-bridge` | 每个版本三处都有 |
| 冒烟覆盖运行依赖（已知：H-19） | `npm pack`，解压到无 `node_modules` 的目录，运行 `audit-overview` 并看 `parsedFiles` 与警告 | `parsedFiles` 大于 0，无 `@babel/parser not available` |
| tarball 内容 | `npm pack` 后列文件清单，核对 WASM、Python 与 Java 辅助脚本、动态查询模块在包内；只有入口文件有可执行位 ※ | 清单正确 |
| 打包二进制（已知：H-19 ⑤） | `npx pkg . --targets node22-win-x64`，再对 typer 跑 `audit-overview` | 版本与解析覆盖和 `node cli.js` 一致；Linux、macOS 目标未构建 |
| 全新安装 | 空目录联网 `npm install`，全局安装后从非仓库目录运行 `--version`、`--help` 与分析；无网络时看错误 ※ | 可运行，无网络时错误明确 |
| Node 版本 | Node 22.13.0、22、24 分别跑快层与慢层；Windows 22.13.0 慢层已完成 95/95，其他组合按 CI 分平台核对 | 通过，或 `engines` 改为实测下限 |
| 平台（已知：U-12） | Windows、Linux、macOS、Docker overlayfs、WSL `/mnt/c` 各跑 `node test/wb-repro.js cli.js` 与快层 | 各平台通过情况有记录 |

## 十、Windows 专属

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 盘符大小写、反斜杠、UNC（已知：U-30） | `--file SRC\Main.py` 与 `src/main.py`；`C:\` 与 `c:\`；UNC 路径 ※ | 认成同一文件 |
| 超长路径、链接成环、编码（已知：U-25） | 逐项构造夹具运行 `audit-overview`、`audit-diff` ※ | 有告警或正确处理 |
| CRLF（U-30） | `core.autocrlf=true` 的仓库里造至少 2 次共同修改的提交，跑 `impact --file <其中一个文件>` 看 `coChanges`（共现不是独立命令，`minCount` 为 2）；另造含 CRLF 与 BOM 的源文件跑 `audit-overview` | `coChanges` 非空且 `dataQuality` 不是 unavailable，解析结果与 LF 一致 |
| 中文、空格路径与 shell 差异 | `--cwd` 含中文与空格；Git Bash 路径转换；cmd.exe 与 PowerShell 参数转义；文件被占用；npm 全局 bin shim ※ | 均可运行或错误明确 |
| 同步盘与执行策略（已知：U-30） | 缓存目录放 OneDrive；受限执行策略下运行 `setup-global-cli.ps1` ※ | WAL 正常，脚本可运行或错误明确 |
| 杀毒软件影响（已知：U-15） | 前置：项目所有者暂停实时扫描并回报；之后同仓库同冷缓存各跑 3 次 `audit-overview` | 记录开启与暂停的耗时差 |
| PowerShell 管道 BOM | 在 PowerShell 管道里 `node cli.js … \| node -e` 解析 JSON | 按 AGENTS.md 的 workaround 可解析 |

## 十一、多语言

对 JS、TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte 逐一覆盖：import 提取、导出提取、函数记录、未解析 import、死导出、影响面、测试映射、路由、框架识别、降级原因、畸形源码、生成代码。

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 固定评测仓库 | `eval/corpus.json` 共 18 个仓库，每种语言至少一个；逐个跑 `audit-overview`、`dead-exports` | 覆盖率、fallback、unresolved 有记录且可复测 |
| 死导出精确率（已知：H-13） | 用 `eval/labels/` 的人工标注逐条核对 high 级告警 | 公开 API、auto-import、宏、动态注册不被标为可删 |
| 测试映射（已知：H-7） | `node eval/score.js` 取各语言精确率与召回率 | 与 `eval/baseline.json` 一致或更好 |
| 解析器降级（已知：L2-22） | 让 tree-sitter WASM 不可用，再跑含 Java、Python 的仓库 | 显式降级，0 importer 死导出降为 low，回退条目不命中缓存 |
| 外部解释器（已知：H-6） | 在无 Python、不同 Python 版本、无 Java 的环境运行 | 输出标明所用来源与版本 |
| Unicode 标识符与畸形源码 | 各语言造含 Unicode 标识符、语法错误文件的夹具 ※ | 不崩溃，有告警 |
| 生成代码 | 各语言造含生成文件（`*.pb.go`、`*_generated.ts` 等）的夹具 ※ | 不污染主线统计 |

## 十二、性能与容量

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 规模曲线（已知：H-20） | 仓库里的生成器只有 `scripts/benchmark-perf.js --files <n>`（n 至少 500，默认 620，配比与 H-20 不同）；复测 H-20 数字需在临时目录自写生成脚本，用完删除，配比为 TS 约 55%、Python 约 27%、JS 约 9%、Java 约 9%，每文件约 40 行、同目录随机 import 3 个兄弟文件，造 1000、3000、10000、30000 文件各一份，各自独立缓存冷、暖各跑一次 `audit-overview`，记录耗时与峰值内存 | 3000 文件暖启动不超过 15 秒，10000 文件不超过 60 秒，10000 与 1000 文件耗时比不超过 15 倍；3 万文件 10 分钟内给出结果或明确提示 |
| 暖启动固定成本（已知：L3-16、L3-17） | Django 固定提交 `a013c821ea`，`--cpu-prof` 分段计时 | 按条目验收线逐项归因 |
| Java 大包展开（已知：L2-26） | 生成含 500 个以上类的同包夹具，跑 `audit-overview` 计时 ※ | 不出现分钟级卡死 |
| 资源记录 | 记录 SQLite 文件大小、WAL 最大尺寸、`--format ai` 的 token 估算与真实分词的差、blame、PageRank、环检测、路由提取各自耗时、parser 并发度、安装体积与干净安装耗时 ※ | 有数据；OOM 时输出可读错误，不是崩溃堆栈 |
| 内存（已知：L1-20） | 万级文件监控峰值堆 | 不 OOM |
| 小规模与增量 | 造 100、500 文件仓库测冷暖启动；单文件改动、100 文件批量改动测增量耗时 ※ | 有耗时数据 |
| 并行解析（已知：U-29） | 读 `builder.js` 的解析调度，试验 worker 线程 ※ | 给出可行性与预期收益 |
| 缓存体积与生命周期（已知：U-26） | 升级 `CACHE_VERSION` 后看旧目录；对多个工作区反复运行并统计缓存总大小 | 旧缓存有处置，总大小有上限或清理 |
| 长时间运行反馈（已知：H-22、H-20） | `--quiet` 下跑超大仓库，观察 stderr | 超过预期耗时时有提示 |

## 十三、真实使用效果

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| agent 采信与误导（已知：U-23） | 固定 5 个真实改动任务，分别在有、无本工具条件下让 agent 完成并比对；再用含注入文本的仓库观察 agent 是否照做 | 任务完成正确率差值与注入是否生效有记录 |
| 技能手册有效性（已知：H-14） | 按 SKILL.md 推荐命令在 zod 上跑一遍，量输出字节；核对 `~/.agents/skills/` 副本与项目内 SKILL.md 是否一致 | 首选命令不撑爆上下文，user-scope 副本与项目内一致 |

## 十四、配置与项目角色

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 配置文件内容 | 对 `.workspace-bridge.json` 分别写入非法字段、非法类型、空文件、带 BOM、超大 JSON，运行 `audit-overview` ※ | 非法的报错或告警并说明；空配置按默认；BOM 可读；超大文件有上限 |
| `init` | 在空目录运行 `node cli.js init`，再运行一次 ※ | 生成默认配置，重复运行不覆盖已有配置 |
| 配置修改使缓存失效 | 改 `.workspace-bridge.json` 后做暖启动 ※ | 结果随配置变化 |
| 目录角色 | 混合仓库用 `.workspace-bridge.json` 标注角色后跑 `audit-overview` | reference、archive、generated 不污染主线统计，孤儿不严重误报 |
| `--exclude` | 目录名、路径片段、`*.ext` 三种写法各一次；配置与 CLI 同时给出时看是合并还是替换 ※ | 各写法命中；合并或替换的规则明确并写入文档 |
| `--service` | monorepo 夹具运行 `--service <子路径>` ※ | 其余服务变为 reference，影响与孤儿只算该服务 |
| `--strict-cwd` 与 git 根提升 | 子目录作 `--cwd`，分别用默认、`--strict-cwd`、`WB_STRICT_CWD=false`；已有 `test/subdirectory-strict-cwd-test.js` | 默认提升到 git 根，另两种不提升 |

## 十五、策展可信度

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 已知假阳性不抬高总 severity | 夹具含已知假阳性原因的死导出，跑 `audit-overview` ※ | 总 severity 不因假阳性升高 |
| 低置信不生成删除建议 | 夹具含 `confidence: low` 的死导出 | 无 `safeToDelete` 与删除建议 |
| 动态加载文件不判孤儿（已知：L2-30） | 夹具含经动态注册加载的文件 | 不被判孤儿，或带降级信号 |
| 测试与非主线目录 | 测试文件、reference、archive、generated 目录在热点与耦合度里的占比 ※ | 不污染主线统计 |
| 知识风险降级 | 单作者仓库与含未提交改动的仓库跑 `audit-overview --with-history` ※ | 单人仓库降级，未提交 blame 不计为真实作者 |
| 建议与发现一一对应 | 从 `audit-overview` 输出里取全部建议命令逐条运行 ※ | 每条建议对应一个发现，命令真实存在且可运行 |
| 工具不越界 | 在输出里搜"漏洞"、"XSS"、"事务"等语义结论（已知：L2-38） | 不宣称语义问题 |
| 无数据时不下自信结论 | 空仓库与文件很少的仓库跑 `audit-overview` ※ | 标低置信或说明无数据 |
| 验证命令选择 | 各语言夹具跑 `audit-diff`，核对 `validation-advice` 给出的验证命令 ※ | 命令与该技术栈一致且可运行 |

## 十六、audit-diff 与回归门禁

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| `hasFindings` 判定 | 改动引入循环依赖或未解析 import，改动文件未达 high risk 且无测试文件，运行 `audit-diff --incremental --fail-on-findings` | 退出码 1 |
| `--max-depth` 透传（已知：L2-44） | `audit-diff --with-impact` 分别用 `--max-depth 2` 与 `4` | 结果随参数变化 |
| 范围选项 | `--staged`、`--files`、`--commits HEAD~9..HEAD`；无改动、非法范围、detached HEAD、submodule、worktree ※ | 各情形输出明确；非法范围的错误回显传入值（已知：H-15） |
| `--reuse-hints` | 同一改动分别用 `on`、`off` ※ | 结果一致，只有耗时不同 |
| 回归基线 | `--save <文件>` 保存后增加死导出，再用 `--check-regression --baseline <文件>`；`--baseline <提交>` 同法 ※ | 计数变多时失败，持平时通过；`--save` 拒绝工作区外、链接逃逸与普通文件覆盖 |

## 十七、命令与产物覆盖

| 检查面 | 怎么验证 | 通过条件 |
|---|---|---|
| 缓存查询命令 | `query-hotspots`、`query-knowledge-risk`、`query-stability` 分别在暖缓存与冷缓存下运行 ※ | 暖缓存快速返回；冷缓存给出明确提示，不崩溃 |
| `query --sql` | 写语句、多语句（含 `;`）、非 SELECT ※ | 拒绝并说明只允许 SELECT（单条写语句已验证，见 H-15） |
| 图查询命令 | `dependencies`、`dependents`、`unresolved`、`stats`、`debug --what symbols`、`debug --what graph` ※ | 数字与 `audit-overview` 一致 |
| 环境诊断命令（已知：H-25） | `workspace-info`、`diagnostics --mode quick`、`--mode full`、`health` | 空转命令删除或合并，输出格式正确 |
| 外部扫描器 | `audit-security` 在未安装 Semgrep、`--config` 非法时运行 ※ | 未安装时明确告警，不以空发现冒充通过 |
| 产物文件 | `--hotspot-data`、`--stability-trend-data`、`--overview-dashboard` 的输出路径与内容 ※ | 输出路径不越界，HTML 已转义，JSON 可解析 |
| 输出控制参数 | `--token-budget`、`--depth`、`--compact`、`--no-compact`、`--fields`、`--max-files` ※ | 按设定生效，被截内容有 `elided[]` |
