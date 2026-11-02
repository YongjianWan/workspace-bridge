# 03 架构与代码健康

结论见 [README.md](./README.md)。脚本为审计子代理自写，放在临时目录，没有进仓库。数字为实测，圈复杂度为粗算。

## 分层是真的

- 204 个文件、547 条 require（去重后 532 对），只数顶层 require 时 0 个环，与 TECH_DEBT 登记的 203、545、0 基本一致。算上惰性 require 有 1 个环：`repl.js` → `commands/repl.js` → `commands/index.js`，`repl.js:32` 已用惰性 require 绕开。
- 按 AGENTS 层次表，低层引用高层的只有 3 条：`container.js:453`、`container.js:465` 的惰性 require，加 `file-index.js:17`。
- 结论：依赖方向健康，没有地基层面的问题。

## 体量

- `src/` 加 `cli.js` 共 41,560 行；测试 390 个文件、52,926 行，比源码还多。
- 行数最多的文件：`human-formatters.js` 2129、`analyzer.js` 1839、`builder.js` 1625、`resolvers/base.js` 1005、`project-context.js` 850。
- 2638 个函数中超过 150 行的 14 个，超过 100 行的 41 个，圈复杂度不小于 20 的 81 个。最重的：`parseCliArgs` 420 行、复杂度 101；`updateFiles` 338 行、91；`executeCommand` 231 行、70；`buildProjectOverview` 230 行、64。
- 复杂度集中在命令参数、增量更新和 REPL 三处，不是到处都乱。
- 语言专属文件合计 7837 行，约占 19%：Python 1782、JS/TS 1922、Rust 1015、Java 967、C/C++ 608、Go 596、Kotlin 541、Vue 342、Svelte 64。目录之外还有 180 处语言名字符串字面量，分布在 17 个文件；写成 `language ===` 比较的只有 2 处，多数是数据表。带 3 个以上扩展名的列表有 29 处，各写一份（TECH_DEBT 根因 E）。

## 反复出问题的地方：横切状态没有唯一拥有者

近 300 个标题含 fix 的提交（实测）：

- `versions.js` 被改 29 次，几乎都是手动给缓存版本号加 1，其中 20 次与 `resolvers*.js` 同时改。
- 同时改 `analyzer.js` 和 `builder.js` 的提交 14 个，`analyzer.js` 与 `query.js` 9 个，三者一起 4 个。写入、分析、查询三层基本各改各的。
- 有多个 `src` 文件的提交里，成对改动按粗层级算有 71% 跨层，集中在：`container.js` 与 `cache.js` 17 次，`cli.js` 与 `repl.js` 13 次，`cache.js`、`graph-db.js`、`file-index.js` 之间 13 至 14 次，`cli.js` 与 `file-index.js` 9 次。

对应的五个横切点：

| 横切点 | 散落情况 |
|---|---|
| 缓存新鲜度 | 5 套判定：`cache.js:683` 按内容哈希；`builder.js:144` 按解析记录是否可用；`snapshot-freshness.js:26` 严格与宽松两档；`container.js:585` 的 `getStaleness` 看时间窗口与 git HEAD；`graph-db.js` 版本闸门加手动版本号 |
| 降级信号 `dataQuality` | 51 处赋值；`container.gitEnvironment \|\| {…}` 这段在 6 个工具里各抄一遍（`audit-assembler:259`、`cycles:10`、`dead-exports:7`、`impact:33`、`unresolved:7`、`overview-assembler:231`）；汇合点 `finalize-result.js:25` 刚收口，`dep-tools.js:61` 另写一份 |
| 文件角色（入口、测试） | 4 个以上实现：`project-context.js:605` 与 `:755`、`test-detector.js:155`、`entry-detector.js:63`、`security-tools.js:110`、`framework-patterns.js`、`orphan-detector.js`、17 个 framework-detection 查询 |
| 输出格式 | `human-formatters.js` 的 `FORMATTERS`（`:177`，约 26 个命令）和 `AI_DIGEST`（`:1334`）两张手写表，加 json、jsonl 和字段快照 |
| 命令入口 | CLI 有 32 个命令；REPL 分派已在 `99c4eea` 改走 `COMMANDS`，但 `executeCommand` 仍保留自己的参数解析与缺省值（`repl.js:169-231`） |

另外，`dep-graph.js` 是 59 个方法的纯转发门面，按 require 数它只被 1 个文件引用，实际有 34 个文件通过对象依赖它；`container.js` 有 27 个方法，45 个文件提到它；`project-context.js` 放在最底层却承担角色分类，被 23 个文件引用。

## 判断

不是分层的根本缺陷。派生的全局状态（图、缓存、快照）没有单一的推导函数，所以缓存、增量和冷启动反复对不上；信号和角色没有拥有者，所以每个命令各补一遍，也就有了验证螺旋。测试慢是同一个原因的另一面：92 个测试文件要起完整容器，59 个要起子进程。

## 只改一件事

选 ROADMAP 第 9 节的步骤 3：

1. 建一个纯函数 `buildSnapshot(解析记录, 文件集合)`，返回不可变的图快照，冷启动、watch、REPL 增量都只走它。
2. 缓存只存解析记录，键里带引擎指纹，去掉手动改的 `CACHE_SCHEMA_REVISION`。
3. 聚合预计算并进这个快照。

预计能消掉 L2-46、「增量失效与冷启动不等价」和 H-48 的预计算部分，终结手动版本号带来的缓存问题；测试可以直接喂记录，不必起容器。它覆盖不了信号和角色，H-39、H-40、H-44、H-45 靠第二刀：单一的 `finalize`（降级信号汇到一处）和 `classifyEntry`（文件角色唯一拥有者）。
