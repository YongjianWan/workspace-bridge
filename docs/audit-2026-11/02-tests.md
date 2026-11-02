# 02 测试：耗时与价值

结论见 [README.md](./README.md)。数据来源：`test/.reports/` 下 334 份历史运行报告（2026 年 7 月 30 日至 11 月 2 日，本机运行，涉及 402 个文件）、测试源码、git 历史。

## 时间花在哪

最近一份全量报告（`run-2026-10-13T10-53-59`，385 项）：墙钟 1618 秒，各项耗时累加 3618 秒（并发下测得，只能比较，不能当单项真实耗时）。最近一份快层报告（`run-2026-11-02T15-15-23`）：281 项，墙钟 93 秒，累加 1006 秒（实测）。

| 层 | 项数 | 累加耗时（秒） |
|---|---|---|
| fast | 280 | 916 |
| slow | 95 | 2436 |
| serial | 5 | 127 |
| watch | 5 | 139 |

全量耗时分布（实测）：5 秒以下 273 项占 13.6%；5 至 30 秒 78 项占 30.3%；30 至 120 秒 33 项占 52.2%；120 秒以上 1 项占 3.9%。Top 15 占累加耗时的 34.6%。没有发现 sleep 等待型测试。

慢的原因有三个：

1. **进程税。** 本机创建一个进程约 0.55 秒（见 [04](./04-runtime-cost-and-duplication.md)）。385 个测试文件每个是一个 node 进程，仅启动就是 350 至 800 秒累加（推算）；其中 92 个文件还会起 CLI 子进程，59 个起完整容器。
2. **反复冷建图。** 凡是对 `--cwd .` 起子进程的测试，每调用一次就对本仓库完整建一次图，单次 29 至 58 秒（实测 3 次，隔离缓存目录）。例子：`bug-27-28-29-regression`（8 次 `repl --eval`）、`repl-json`（7 次）、`cli-error-handling`（约 9 次）。
3. **git 夹具逐次初始化。** `git-environment-probe`（140 秒）、`data-quality-propagation`（101 秒）等每次 init、config、commit、clone。

**进程内辅助函数名不副实。** `test/test-helpers.js:208` 的 `runCliInProcessRaw` 在 cwd 不是仓库根时回退到 `spawnSync`。静态扫描 213 个调用点中 141 个（约 66%）落入这条回退，涉及 40 个文件。而 `cli.js` 里的 `runCliInProcess` 不传 container 时会自己建容器，对任意 cwd 都能进程内运行，所以这条回退可以直接去掉。

**固定超时与实际耗时贴得太近。** `runCliRaw` 的默认超时是 60 秒；本机空闲时 `repl --eval "impact ..." --json` 单次 35 至 48 秒（实测）。2026 年 11 月 2 日 `repl-json-test` 在机器被子代理占满时返回 `status null`（超时），空闲后单独重跑通过，用时 3 分 12 秒。登记为「偶发」的失败中，相当一部分是这一类。

## 提速项（估算）

| 顺序 | 做什么 | 预期收益 |
|---|---|---|
| 1 | 去掉 `test-helpers.js:208` 的 spawn 回退 | 40 个文件约 858 秒累加里省 40% 至 60%，约 350 至 500 秒 |
| 2 | bug-27-28-29、repl-json、bug-7 的 `repl --eval` 合并为一次分号连写 | 232 秒降到约 40 秒 |
| 3 | cli-error-handling、impact-ranking-cli、functionality-core 的 `--cwd .` 调用改用共享容器 | 约 260 秒降到约 60 秒 |
| 4 | git 夹具复制预建模板仓库，不逐次 init | 这批合计省三成到五成 |
| 5 | replay-impact-test 夹具进程内化 | 90 秒降到约 30 秒 |

全部完成后，全量墙钟约从 1618 秒降到 700 至 900 秒，快层约从 93 秒降到 60 至 70 秒。降不下去的部分是 git 夹具的进程税，以及约 60 个必须验证退出码与 stdout 的真 CLI 测试，每个保留一个子进程冒烟。

## 测试是否帮到了项目所有者

失败事件共 369 次：崩溃 185、超时 15、普通失败 169。**崩溃里 172 次来自 `wave15-ast-rules` 和 `wave15-neighbor-aware` 两个文件，只在 2026 年 9 月出现**，10 月起基本消失。单看失败次数会把环境噪声当成价值。

- 335 次运行里没有任何普通失败的文件有 294 个（75%），其中 282 个全程零失败。这 282 个文件占累计耗时的 60%（2.17 亿毫秒，总计 3.64 亿毫秒）。
- 失败后跟着改 `src/`、测试本身没改、之后转绿的事件约 12 起，涉及约 25 个文件（推算，窗口为失败前后 1 小时）。例子：短路径修复 `ebbbb49` 一次让 17 个测试同时变红；`layering-test` 拦住了 MyBatis 功能 `7a2847f` 带来的分层问题；Go 包依赖功能 `77a3fd6` 弄坏了 `java-same-package` 一致性。
- 抽样 30 个普通失败（报告未存错误文本，按时间窗口人工归类）：

| 类别 | 个数 | 占比 |
|---|---|---|
| 真回归 | 6 | 20% |
| 开发中途或测试先红 | 9 | 30% |
| 无代码改动，重跑转绿 | 13 | 43% |
| 无法判定 | 2 | 7% |

- 弱断言抽读 15 个零失败文件：`validation-advice-schema`（只测 typeof 和 `Array.isArray`）、`formatter-e2e-summary`（字符串 includes）、`security-ruleId`、`cli-help-dry` 偏弱；`js-ast-new-url`、`safe-env`、`cycle-dedup`、`w2t3-command-quality` 偏强。启发式统计低信号断言约占 6% 至 7%，抽样的 20 个文件里没有一个以低信号为主。

## 三档名单

- **保留：** 有普通失败记录的 93 个文件，其中约 25 个有真回归证据；强断言核心语义：`layering`、`resolvers`、`builder`、各语言 parser 与 resolver、`audit-diff` 系列。
- **合并或降级：**
  - `wave15-*-query` 共 11 个文件，同一套「query 对比 regex 回退」模板，改成一个表驱动文件。
  - `cache-*` 共 17 个文件，可并成 3 至 4 个。
  - 参数边界：`bug-15-cli-bounds-validation`、`cli-args-validation`、`severity-filter`、`wave2-boundary-fixes` 合并为一个。
  - 格式化输出：保留 `formatter-direct` 与 `json-contract-snapshot`，其余重叠文件并入。
  - 零失败且耗时 30 秒以上的 9 个慢层文件（`severity-filter` 85 秒、`wave2-boundary-fixes` 69 秒、`cache-concurrency` 67 秒、`functionality-core` 67 秒等）合并后少约 30%。
  - `test/wb-repro.js` 是一次性复现脚本，移出 `test/`。
- **删除（7 个，均为零失败且断言弱或被覆盖）：** `validation-advice-schema`、`formatter-e2e-summary`、`formatter-e2e-others`、`security-ruleId`、`bug-7-repl-nonexistent`（被 `bug-27-28-29` 覆盖）、`bug-15-cli-bounds-validation`、`cli-format-json`。

删除 7 个约省 224 秒累计耗时（累计的 6%），合并若干后合计约 440 秒，占 3684 秒的 12%（估算）。慢层 95 个文件占累计耗时 65%，所以删测试救不了时间，该动的是第一节的进程税。

## 测试数量被当成成果展示

`SESSION.md` 写「280/280」「321/321」「327/327」，`ROADMAP.md` 写「270 项」「369 项中 368 项」，`CHANGELOG.md` 约 110 行带 NNN/NNN，`docs/TECH_DEBT.md` 写「355 项约 26 分钟」。这些是门禁通过的记录，不全是虚荣，但它们不说明测试强不强。AGENTS 自己写了「不要硬编码历史测试总数」，实际没有遵守。
