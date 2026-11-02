# 04 运行时成本与重复验证

结论见 [README.md](./README.md)。耗时数字里，标「空闲」的是 2026 年 11 月 3 日所有子代理结束后在空闲机器上的实测；其余是机器被占用时测得，只当量级。

## 每个进程要多久

在 Node 内用 `spawnSync` 各跑 10 次取均值（空闲，实测）：`git --version` 543 毫秒，`node -e 0` 573 毫秒。普通开发机上两者一般是几十毫秒，所以本机进程创建比常见水平慢一个数量级。原因可能是端点安全软件逐进程扫描（TECH_DEBT U-15 登记过，尚未隔离），不下结论。

## 一次 `impact` 调用里发生了什么

命令：`node cli.js impact --cwd . --file src/services/container.js --json --quiet`，空闲，实测。

- 总耗时：默认缓存 42 秒，全新缓存目录 34 至 35 秒。
- 日志：默认缓存下「Discovered 644 files」但「Built in 17505ms, 7832 files indexed」；全新缓存下 644 个文件、12551 毫秒。DepGraph 构建 2.1 秒（100% 解析缓存命中）。
- CPU 剖面（47 秒墙钟）：`spawnSync` 自身占 23.7 秒，空闲等待 7.4 秒，路径归一化 1.9 秒，其余是 stat、open、读文件和 tree-sitter 解析，各不到 1.1 秒。
- 子进程清单（给 `child_process` 打桩，实测）：共 16 次、合计 10.3 秒。

| 命令 | 次数 | 合计（毫秒） |
|---|---|---|
| `git rev-parse --show-superproject-working-tree` | 2 | 2062 |
| `git config --get core.sparseCheckout` | 2 | 1123 |
| `git sparse-checkout list` | 2 | 1044 |
| `python -c`（取版本） | 1 | 1005 |
| `git rev-parse --show-toplevel` | 2 | 996 |
| `git diff HEAD` | 1 | 984 |
| `git rev-parse --is-shallow-repository` | 2 | 975 |
| `git rev-parse --is-inside-work-tree` | 2 | 938 |
| `git log --format=%H --name-only` | 1 | 637 |
| `git rev-parse HEAD` | 1 | 558 |

环境探测的同一条 git 命令各被调用两次，是纯重复。剖面里 `spawnSync` 的 23.7 秒比桩统计的 10.3 秒大，差额还没拆开（可能是 Python 之外的探测、`git check-ignore` 等未被桩覆盖的路径）。

**被推翻的猜想：** 遍历仓库内被 gitignore 的语料目录不是主因。用 Node 递归遍历 `eval/truth` 要 24 秒（119582 个文件），`reference` 要 4 秒，`src` 只要 37 毫秒；但给 `impact` 加 `--exclude eval/truth,reference` 后整条命令是 41 秒，不加是 42 秒，工具自己的发现流程已经绕开这些目录。

## 验证机制的运行时成本

清单与行数（实测）：逐文件内容哈希核对（`file-index.js` 约 40 行）、`checkFileChanges`（`cache.js:683`，39 行）、`getContentSignature`（12 行）、引擎指纹与快照指纹（`versions.js`，约 80 行）、图库版本门（约 25 行）、快照新鲜度判据（76 行）、`getStaleness`（53 行）、收尾警告（约 70 行）、环境探测（389 行，两个文件）、不可信标注与清洗（145 行）、文件锁与损坏库隔离（约 65 行）。

- 验证类机制约占 J1 单次调用的 35% 至 45%（推算）；J1 初始化 14.5 至 22.3 秒中，清单 stat 5.7 秒、`getDroppedImports` 4.4 至 5.7 秒、重哈希 1.1 至 1.5 秒（TECH_DEBT 他人实测）。
- SHA-256 本身只占约 12%：读 618 个文件（3.85 MB）加哈希 823 毫秒，只读是 724 毫秒（实测）。成本是整仓读文件，不是哈希运算。
- 每次 CLI 启动，引擎指纹与快照指纹的计算要 165 至 263 毫秒，与命令无关（实测）。

## 重复验证

**运行时。** 本仓库一次 `impact` 做了 8478 次文件 SHA-256：646 次来自 `FileIndex.processFile`，7832 次来自 `checkFileChanges`；后者遍历缓存元数据的全部条目，条目数是当前索引的 12 倍（实测；残留条目的来源是推算，未核）。新鲜度窗口 `INDEX_VERIFIED_FRESH_MS` 是 10 秒，初始化比它长，刚验证过的索引又被验证一遍：三次负载下运行里 `getStaleness` 占 16.0、16.5、19.6 秒（总耗时 72 至 94 秒）；把窗口调到极大后，同一调用降到 5 毫秒，哈希降到 646 次（实测）。其他重复：

- 每条命令收尾调 `getStaleness` 再调 `buildWarnings`，后者再算 `getDroppedImports`；`audit-overview` 里 `getDroppedImports` 至少算 2 次。
- JVM 等构建清单每次读取都先 stat（TECH_DEBT H-48）。
- `versions.js` 启动时对 203 个源文件算两遍指纹，其中 83 个引擎文件同属两个集合。

**测试。** 384 个文件中 92 个起 CLI，38 个自建容器。`json-contract-snapshot-test` 已有 27 次 CLI 调用，其中包含 9 条命令的 CLI 与 REPL 字段集比对；`repl-json-test` 另对整个仓库起 8 次进程，断言是它的子集；`format-ai-fields-test` 与 `cli-format-json-test` 各自重建容器。降级字段在 `cross-format-degradation`、`data-quality-contract`、`ledger-warnings`、`formatter-direct`（1192 行）里都出现，重叠程度只看了头部注释，未逐条比对。

**CI。** `test.yml` 有 6 个作业，每个都先跑 `test:fast` 再跑 `test:smoke`，而 smoke 已包含全部 fast 再加 3 个慢测（`runner.js:254-280`），所以 fast 每个作业跑两遍；`coverage` 作业再跑一次，`release.yml` 再跑两次。`perf-guardrail` 只挂在 PR 上，而 main 全是直接推送，从未运行（TECH_DEBT H-46）。

**文档。** 缓存版本 55 和 schema 1.2.0 在 SESSION 里手抄，源头是 `versions.js`；SESSION 的快层基线「280/280」停在 2026 年 10 月 14 日；H-39、H-40 的状态在 CHANGELOG、SESSION、TECH_DEBT 三处各写一遍。

**输出层。** `formatCliResult` 本身已是 CLI 的单出口，重复在 REPL：`runShared` 自己调清洗、拼 `untrusted`；`human` 和 `summary` 有 5 处 `appendWarnings` 加 2 处内联循环，限额和行格式各不同，而 markdown、jsonl、ai 走 `degradationSignals` 单点。

## 合并项

| # | 做什么 | 改动面 | 风险 | 预计节省（估算） | 顺序 |
|---|---|---|---|---|---|
| 1 | 初始化末尾记录验证时间，`checkFileChanges` 只遍历已确认键，收尾复用初始化结论 | 约 3 个文件 | 低；REPL 与 watch 保留重算 | J1 约 1.1 至 1.5 秒；本仓库负载下 16 至 20 秒 | 1 |
| 2 | `getDroppedImports` 缓存，清单 stat 进定位批次（H-48 前两项） | 约 3 个文件 | 低到中；输出须不变 | J1 约 10 秒 | 2 |
| 3 | 环境探测去重、Python 版本探测缓存 | 约 2 个文件 | 低 | 约 4 秒（8 次 × 0.55 秒） | 2 |
| 4 | CI 去重：smoke 只留 3 个代表慢测，coverage 并入主作业，release 不重测 | 3 个 workflow | 低 | 每次推送约 10 CPU 分钟 | 3 |
| 5 | 契约测试合并为表驱动：命令 × 格式 × 入口，共用一个容器 | 约 4 个文件 | 低；断言只增不删 | 慢层 1 至 2 分钟 | 4 |
| 6 | 文档单一来源：脚本生成 `test/BASELINE.json`，H-xx 状态只写 TECH_DEBT | 1 个脚本加 4 篇文档 | 低 | 每次小改的文档动作从 3 至 4 篇降到 1 篇 | 5 |
| 7 | 输出统一出口 `src/cli/emit.js`：`prepareOutput`、`renderOutput`、`renderDegradation` 三个函数，CLI 与 REPL 共用 | 约 6 个文件 | 中 | 不省时，省 H-39、H-40 类返工（REPL 对齐修复提交 5 个） | 6 |
| 8 | 指纹单遍遍历 | 1 个文件 | 低 | 约 0.1 秒 | 7 |

删除而不是合并的候选（风险较高，需先评估）：对「mtime 与大小被还原而内容变了」这类归档拷贝场景的整仓逐文件哈希、多进程文件锁与死进程判定、损坏库隔离、LFS 指针探测。个人单机使用几乎碰不到这些场景，但删除前要跑 `impact` 与 `affected-tests`。
