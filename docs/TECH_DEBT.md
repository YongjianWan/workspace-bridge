# 当前技术债

这里只列仍需处理或明确冻结的债务。修复经过和已关闭条目见 [CHANGELOG.md](../CHANGELOG.md)。原外部审查报告的开放项已并入本文件。

## 根因归属（修法见 [ROADMAP.md](../ROADMAP.md)「架构修复路线」）

以下归类只对应当前开放条目；结构性方案见 ROADMAP。根因 A（缺少统一的分析台账）、根因 C（建图与分析存在重复工作）、根因 D（结论缺少按目标说明的证据边界）和根因 E（语言能力缺少统一声明）目前没有开放条目，所以表中没有它们。

| 根因 | 证据 | 对应条目 |
|---|---|---|
| 输出没有统一出口（横切） | 规则散在 `elideDeep`、`route-formatter.js`、两千行量级的 `human-formatters.js` | 冻结（见 P4） |

不归入上述原因、独立处理：H-19。

## P1：输出看着正常、实际是错的（静默错误）

| ID | 现象与复现 | 验收线 |
|---|---|---|
| H-33 | 升级代码后，`audit-overview` 会继续重放旧代码算出的分析快照。原因：`analysis_snapshots` 每行只校验 `CACHE_VERSION`，而 `CACHE_VERSION` 的引擎指纹只覆盖 `src/services/dep-graph/`（`src/config/versions.js`）；`src/tools/` 里生成 overview 结果的代码不在指纹范围内，`isSnapshotFresh()`（`src/tools/snapshot-freshness.js`）也不比较代码版本。2026-10-05 在 `d57bc11` 的独立 worktree 上复现：两文件夹具，用同一个 `WB_CACHE_DIR` 先跑一次 `audit-overview --json --quiet` 生成快照；给 `src/tools/overview-tools.js` 的结果对象加一个字段 `probe: 1` 后再跑，输出带 `replayedFrom`，没有 `probe`。对照组换一个空缓存目录跑，输出有 `probe: 1`。重放结果只靠 `replayedFrom` 表明来源，未核对其 `warnings[]` 是否提示代码已变。 | 改 `src/tools/` 中参与生成分析快照的代码后，不手动加修订号也不会重放旧快照；有回归测试锁定（改代码指纹后快照失效）。 |

## P2：安全、缓存与文档隐患（条目编号 H-n）

| ID | 现象与复现 | 验收线 |
|---|---|---|
| H-19 | 发布流程半手动且已多次中断，版本号与发布物脱节。2026-10-02 实测：① 发布只由推送 `v*` 标签触发（`.github/workflows/release.yml`：`npm ci` → 快层测试 → 冒烟 → `npm pack` → GitHub Release → `npm publish --provenance`）；版本号与 CHANGELOG 靠手工提交（如 `ad84bd1` "切版 2.1.0"），仓库里没有自动化脚本。② `package.json` 为 2.1.0（2026-07-17）、CHANGELOG 有 `[2.1.0]`，但最新标签与 GitHub Release 是 `v1.2.1`（2026-05-28），此后 271 个提交，2.0.0、2.1.0 从未打标签。③ 发布工作流最近 3 次（v1.1.0、v1.1.1、v1.2.1）都失败在 "Publish to npm"，v1.0.2、v1.0.3 成功；现查 `npm view workspace-bridge` 返回 404（包不在 npm 上）。④ 冒烟步骤只检查 `--version` 与 `workspace-info`：本机按同样步骤解压 `npm pack` 产物（192 个文件，约 550 KB，不含 `eval/`、`test/`、`docs/`）到没有 `node_modules` 的目录，二者都通过，而 `audit-overview` 在该目录退化为 regex 解析（提示 `@babel/parser not available`）；所以产物缺运行依赖时冒烟仍会绿。⑤ 打包：`npx pkg . --targets node22-win-x64` 离线构建成功（20 秒，使用缓存的 v22.22.3 基础二进制；`pkg` 对 `tree-sitter-wasms` 动态 require 给出一条警告），产物 121 MB，`--version` 为 2.1.0，在 typer 上 `audit-overview` 解析 639/639 个文件，覆盖率与警告和 `node cli.js` 一致。仓库根的 `workspace-bridge-win.exe`（114 MB，已被 `.gitignore` 忽略）仍可运行，但版本是 2.0.0，落后 274 个提交。 | 先查明 npm 发布失败的原因（令牌或包名权限），再决定是否发布；补打 2.0.0/2.1.0 对应标签或在 README 说明版本从 2.x 起不再发布；冒烟增加一条需要运行依赖的分析命令（如对解压目录自身 `audit-overview` 并检查 `parsedFiles` 大于 0 且无 `@babel/parser not available`）；旧 `workspace-bridge-win.exe` 是删除还是用新构建替换，由项目所有者决定。

## U：未验证方向（条目编号 U-n）

U 表示"还没查过，不知道有没有问题"，不是已确认的债务。查完后有问题的转成 P1/P2/L 条目，没问题的整行删除。U 表只列尚未核对的方向，验证经过只写 CHANGELOG。语料在 `eval/truth/repos/<语言>/<仓库名>`（gitignored，说明见 [eval/README.md](../eval/README.md)）。

| ID | 要查什么 | 怎么查 | 验收线 |
|---|---|---|---|

| U-15 | 深信服 aES 本身对 WASM 与 SQLite 耗时的影响仍未隔离。 | 当前没有可用对照条件；待项目所有者或公司提供可比较的防护条件或性能取证环境；不要求卸载，不由 agent 修改系统安全设置。 | 可归因的耗时对照；腾讯开关结果不能外推为深信服影响。 |

| U-30 | 真实同步盘 SQLite WAL 与公司域策略下的安装行为。 | 当前没有实际同步盘或公司域策略测试环境；取得环境后分别核对分析集合、警告、安装结果与副作用。进程级 Restricted/AllSigned 不替代域策略。 | 实际环境符合夹具真值；不能用本地普通目录或 CI 临时盘替代同步盘。 |

## L1：可能导致崩溃、死锁或彻底不可用的架构隐患（阻塞级）

| ID | 当前问题 | 根因与风险 | 下一步与验收 |
|---|---|---|---|

## L2：数据一致性、静默错误与跨平台漂移（破坏级）

| ID | 当前问题 | 根因与风险 | 下一步与验收 |
|---|---|---|---|


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
- 语言处理分散：提到 Kotlin 的源文件 23 个、Rust 24 个、Go 25 个，每门语言都是同一量级。当前没有新增语言的计划；决定新增第 10 门语言之前，先把语言专属分支收进语言注册表。
- 超大仓库内存：生成仓库实测 3060 文件暖启动峰值 184 MB、30600 文件 1508 MB（每文件约 0.13 MB，线性）；外推 10 万文件约 4.5 GB，接近 Node 默认堆上限。重新处理的条件：出现 5 万文件以上的真实仓库，或有人报告 OOM。
- `affected-tests` 精确率：typer 0.548（召回率 0.991），cobra 0.374，spring-petclinic 0.563。`node eval/verify-h7-tradeoff.js` 实测任何截取规则都满足不了召回率 0.9（距离 ≤ 1 时精确率 0.947、召回率 0.063），原因是真值里的测试确实经共享入口执行到几乎所有源文件；输出已按距离、枢纽扇入排序并带 `distance`/`via`。重新处理的条件：有了运行时覆盖信息可作为边的权重。
- 输出没有统一出口：路径写法已在 `src/cli/path-spelling.js` 统一，但 `elideDeep`、`route-formatter.js`、`human-formatters.js` 各自处理截断、掩码与格式，没有一份按命令的 JSON Schema。当前没有因此产生的错误输出；出现第二类跨命令输出不一致时，再收口为单一序列化器（ROADMAP 步骤 6）。
