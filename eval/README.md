# eval/ — workspace-bridge 真实仓库评测集

用钉死版本的真实开源仓库，检验 workspace-bridge 的结论准不准。它回应一次外部审查
（原报告已并入 `docs/TECH_DEBT.md`）的核心结论：「没有外部真值，所有验证都是自己验证自己」。

和另外两套检查的分工：

| | `test/` | `eval/` | `benchmark/` |
| --- | --- | --- | --- |
| 测什么 | 功能对不对 | 结论准不准（精确率/召回率）+ 真实仓库上的运行健康度 | 快不快 |
| 输入 | 本仓自造的小夹具 | 钉版本的真实开源仓库 | 脚本生成的合成仓库 |
| 答案来源 | 测试作者写死的断言 | 外部真值：coverage、故障注入、人工标注 | 无，只有耗时 |
| 是否门禁 | 是（失败即红） | 否（`score.js` 永远 exit 0，靠 FAIL 行报警） | 超基线+容差报警 |

与 `reference/` 的区别：`reference/` 是竞品/参考代码，版本可随手更新，没有真值；
`eval/` 的仓库版本钉死（标签与真值都对着那个 commit），两者互不共用 clone。

## 目录结构

```
eval/
├── corpus.json          # 仓库清单：lang / url / 钉死 commit / metrics / affectedTests 配置
├── labels/<name>.jsonl  # dead-code 误报标签（27 条）
├── truth/               # [gitignored] 全部生成物
│   ├── repos/<lang>/<name>/   # 钉 commit 的 clone（partial clone，只拉检出需要的 blob）
│   ├── out/<lang>/<name>/     # 每仓输出：
│   │     audit-overview.json / dead-exports.json / health.json / status.json / marker.json
│   │     cache/                    # 本仓的 workspace-bridge 缓存（WB_CACHE_DIR 钉在这里）
│   │     gt.json, coverage.data    # coverage-pytest 真值（typer）
│   │     affected-tests-truth.json # 故障注入真值
│   └── venvs/<name>/          # coverage-pytest 用的隔离 venv
├── lib.js               # 三个脚本共用：corpus 读取、按语言分目录的路径、spawn、状态文件
├── run.js               # clone + 健康指标 + dead-exports + coverage 真值
├── inject-fault.js      # 故障注入真值（显式运行，昂贵）
├── score.js             # 打分 → scoreboard.json，对比 baseline.json
├── baseline.json        # 人工确认过的基线数字
├── scoreboard.json      # score.js 每次重写
└── findings.md          # 评测中观察到的工具问题（只记录，不在 eval 里修 src/）
```

`<lang>` 取值固定为 `python / js-ts / vue / svelte / java / kotlin / go / rust / c-cpp`
（`lib.js` 的 `LANG_DIRS`，写错直接报错）。React 不是独立语言，React 仓库放 `js-ts`。

## 仓库清单

以 `corpus.json` 为准。每个仓库都产出 health；dead-code 需要 `labels/<name>.jsonl`；
affected-tests 需要能跑对方测试的工具链。

| lang | 仓库 | metrics | affected-tests 真值 |
| --- | --- | --- | --- |
| python | typer | health, dead-code, affected-tests | coverage-pytest |
| python | full-stack-fastapi-template | health, dead-code | — （后端测试依赖 Postgres） |
| python | NeEEvA | health, dead-code | — （含 C#，不在支持范围） |
| python | django | health | — （用于大仓性能/缓存体积） |
| js-ts | zod | health, affected-tests | fault-injection / vitest |
| js-ts | execa | health | — |
| js-ts | bulletproof-react | health | — |
| vue | vitesse | health, dead-code, affected-tests | fault-injection / vitest |
| vue | vue-realworld-example-app | health | — （测试是 playwright e2e） |
| svelte | realworld (SvelteKit) | health | — |
| java | spring-petclinic | health, dead-code, affected-tests | fault-injection / maven |
| kotlin | okhttp | health | — （gradle 多模块，过重） |
| go | glow | health, dead-code | — |
| go | cobra | health, affected-tests | fault-injection / go |
| rust | hexyl | health, dead-code, affected-tests | fault-injection / cargo |
| rust | ripgrep | health | — |
| c-cpp | cJSON | health, dead-code | — |
| c-cpp | fmt | health | — |

## 前置条件

| 步骤 | 需要 | 缺失时 |
| --- | --- | --- |
| `run.js` | Node ≥ 22.13、git、网络 | 该仓记 `health: error`，其余仓继续，最后 exit 1 |
| coverage-pytest | python3 + pip 网络（自动建 `truth/venvs/<name>`，不污染系统环境） | `affected-tests: pending` |
| fault-injection / maven | `mvn`、`java` | 打印 `pending: <原因>`，exit 0 |
| fault-injection / vitest | `pnpm`（首次自动 `pnpm install --frozen-lockfile`） | 同上 |
| fault-injection / go | `go` | 同上 |
| fault-injection / cargo | `cargo` | 同上 |

Windows 注意：CLI 的 JSON 不要经 PowerShell 管道（BOM）；脚本全部 `spawnSync` + 文件中转。

## 用法

```bash
node eval/run.js                   # 全部仓库
node eval/run.js typer cobra       # 指定仓库
node eval/run.js --lang rust       # 某一语言
node eval/run.js --force           # src/ 改动后强制重跑（含 typer 约 20 分钟的 coverage）

node eval/inject-fault.js cobra    # 故障注入真值，每仓单独跑（昂贵）

node eval/score.js                 # -> scoreboard.json + 按语言分组的终端摘要，永远 exit 0
node eval/verify-u31-graph.js     # cJSON 固定提交：独立 include 真值 vs impact/tree/guard/cycles/audit-map
```

`verify-u31-graph.js` 要求 `truth/repos/c-cpp/cJSON` 已检出 `corpus.json` 钉定的提交；完整比对写到 gitignored 的 `truth/out/c-cpp/cJSON/u31-graph.json`。它是单仓样本，不能代表九语言整体准确率。

**缓存语义**：CLI 步骤在「目标 commit + `src/` 最新 mtime」都没变且输出齐全时跳过；
coverage 真值只认 commit。改了 src/ 后不加 `--force` 也会自动重跑 CLI 步骤（mtime 变了）。

## 指标与真值

### health（每个仓库，无真值）

`run.js` 先清空该仓缓存，连跑两次 `audit-overview`（冷、暖）再跑 `dead-exports`，写 `health.json`：
`coldMs / warmMs / cacheBytes / totalFiles / coverageRatio / fallbackFiles / unsupportedFiles /
unresolvedCount / droppedCount / warnings / languages{files, astFiles, regexFiles} / deadExports{symbols, byConfidence}`。

没有对错，只看趋势。`score.js` 只拿 `coverageRatio` 对比基线；耗时随机器限频大幅波动，只记录不判定。

### affected-tests：coverage-pytest（typer）

口径：

1. 在 `truth/venvs/<name>` 建隔离 venv，装 `pytest coverage` + `pip install -e <clone>`。
2. **独立 rcfile 是强制的**：typer 自带的 `[tool.coverage.run]` 是 `parallel = true` + 自定义
   `data_file`，与之冲突；rcfile 只含 `source=<clone>/<source>`、`dynamic_context=test_function`、
   `data_file=<out>/coverage.data`。
3. 在 clone 里执行 `python -m coverage run --rcfile=... -m pytest -q -p no:cacheprovider -p no:cov <tests>`。
   pytest exit 1（有用例失败）照样接受——真值取自 coverage 数据，与通过与否无关。
4. `gt.json` = 每个源文件 → 实际执行到它的测试文件。**真值是下限**：子进程里跑的代码 coverage 追不到。
5. `score.js` 对 `gt.json` 中每个源文件调用 CLI `affected-tests --json`（agent 实际拿到的输出，含截断）取得预测；
   两侧路径归一成 `/` 后做 micro P/R，这是基线与 FAIL 判定的口径。同时用进程内 `findAffectedTests` 的完整预测算一份 `full` 字段，仅供对照截断损失。

### affected-tests：fault-injection

`inject-fault.js` 对每个目标文件：注入**运行时**故障 → 跑对方测试套件 → 相比干净基线新增失败的测试 = 真值 → 恢复文件。
不用语法错误：编译失败会让全部测试一起挂，真值退化成全集，没有信号；注入后编译不过的文件记为 error，不算真值。

| runner | 注入方式 | 失败测试 → 测试文件 |
| --- | --- | --- |
| maven | 第一个 class 声明后插 `static { if (true) throw ... }`（`if (true)` 不能省：javac 拒绝无法正常结束的初始化块） | surefire XML 的类名 → `src/test/java/<pkg>/<Class>.java` |
| vitest | `.ts/.js` 首行 `throw`；`.vue` 在 `<script>` 后 | vitest json 报告里的文件 |
| go | 每个顶层 `func` 首行 `panic(...)` | 测试 panic 会中止整个测试二进制，所以对失败的包逐个 `_test.go` 单独 `-run` 重跑 |
| cargo | `#[cfg(test)]` 之前每个非 const `fn` 首行 `panic!(...)` | `Running tests/x.rs` 段落里的失败 = `tests/x.rs`；内联单测和 doc test 只记 id、无文件 |

目标文件：`affectedTests.files` 显式列出，或按 `sample`（默认 10）从排序后的非测试源文件里等距抽取
（可用 `sampleDir` 限定目录）——对钉死的 commit 是确定的。
打分时两侧都按 `lib.TEST_FILE_RULES[runner]` 过滤测试文件，预测来自 CLI `affected-tests --file`。

### dead-code（标签真值）

- 标签 = 原外部审查标出的 **27 条误报**（`labels/*.jsonl`，reason 词表见 `corpus.json.reasonVocabulary`）。
- 按符号打分：`dead-exports` 的每个 `(file, symbol)` 对上标签（`*`/`**` glob、裸文件名按 basename、
  `symbol:"*"` 匹配任意符号）→ 误报；没对上的 → **默认算对**。
  `precision = 未标注 / (未标注 + 仍被报告的已标注误报)`，按工具自报 confidence 分桶。
- **这是相对指标**：只标了误报，其余发现没核过。例：vitesse `src/composables/dark.ts` 三个导出疑似
  同类 auto-import 误报但不在 27 条里，会抬高数字（见 findings.md）。
- dead-exports 的 exports 列表有 100 条截断上限（审查 P1-17），超大文件的符号计数可能不满。

## 解读规则

- **affected-tests：召回优先**。漏报比多报贵，召回率不许下降；精确率应随修复上升。
- **dead-code：精确优先**。`precisionHigh` 应 ≥ 0.9；验收标准是 27 条里没有一条再被标 high。
- 与 `baseline.json` 相比任一比率指标（precision / recall / precisionHigh / precisionLow / coverageRatio）
  下降 > 0.05 → 打印 `FAIL`，exit 仍为 0。更新基线 = 人工核对后用新 scoreboard 覆写 baseline.json。
- 同时看 `counts.labeledNotReported`：已知误报不再被报告是真进步，precision 可能反而下降。
- 样本量小的数字（n 只有个位数）不下结论。记录实测，不倒推凑数。

## held-out

`corpus.json` 每个仓库有 `heldOut`（目前全部 `false`）。设为 `true` 的仓库只在发布前跑一次做最终检验，
调参和修 bug 期间不看它的分数。

## 如何扩充

- **加仓库**：`corpus.json` 加一项（`name / lang / url / commit / languages / shape / metrics / heldOut`，
  要故障注入再加 `affectedTests: { method: "fault-injection", runner, files | sample, sampleDir? }`），
  然后 `node eval/run.js <name>`。commit 用 `git ls-remote <url> HEAD` 取当前值后钉死。
- **加 runner**：在 `inject-fault.js` 的 `RUNNERS` 加一项（tools / isSource / inject / run，可选 prepare），
  并在 `lib.TEST_FILE_RULES` 加对应测试文件规则。
- **加标签**：往 `labels/<name>.jsonl` 追加 `{"repo","file","symbol","label":"FP","reason"}`，新 reason 进词表。
- **记录工具问题**：`findings.md` 按模板追加。

## 标签转录备注

- NeEEvA `sensevoice_server.py` 一行 `symbol:"*"` 代表报告里 35 个导出；`seedvc_server.py` 拆成两行
  （装饰器路由 / `__main__` 守卫）。
- typer `NoneType` 报告没给文件，实测来自 `typer/_typing.py`。
- typer `scripts/docs.py` 当前构建不再报告（`labeledNotReported` 记 1），标签保留，它是审查时点的真值。
- full-stack-fastapi-template 的 alembic 路径、cJSON 的 fuzz 路径已按钉死 commit 的文件树核对。

## 专项结论核对入口

| 命令 | 输出（gitignored）与口径 |
|---|---|
| `node eval/verify-command-truth.js` | `eval/truth/command-truth.json`：固定 Petclinic/cJSON 的入口、边界、函数异味人工真值；非全语言验收。 |
| `node eval/verify-platform-boundaries.js` | `eval/truth/platform-boundaries.json`：Windows 路径、编码、Git 形态、默认缓存隔离与删除行为；需 Python、Git、PowerShell、本机 UNC 访问。 |
| `node eval/verify-execution-paths.js` | `eval/truth/execution-paths.json`：Windows 本地命令探针、semgrep 探测、watch 完整源文件验证事件；需 .NET C# compiler，模拟测试子进程不代表实际 Jest。 |
| `node --expose-gc eval/verify-parser-workers.js` | `eval/truth/parser-workers.json`：内存 JS 源码的真实解析函数与 worker 对照，不包含磁盘、SQLite 和全图分析。 |
| `python -X utf8 eval/verify-python-graph.py` | `eval/truth/python-graph-truth.json`：固定 Typer 的静态 import oracle 初筛；集合差异须逐边裁决，不能直接当工具 FP/FN。 |
| `node eval/verify-python-import-truth.js` | `eval/truth/python-import-truth.json`：Python 运行时确认普通包、namespace 包、相对导入的多个子模块均被加载，再核对 6 条命名子模块边及 impact；不评价 package 初始化边。 |

退出 0 表示脚本完整取证；不表示工具结论通过。核对报告里的真值、实际集合与 watch 事件。当前开放问题只在 TECH_DEBT.md；验证经过只在 CHANGELOG。

## CI 建议（尚未添加）

评测比 slow 层还慢（clone + coverage + 对方测试套件），建议独立的 nightly workflow，不阻塞 PR：
`npm ci` → `node eval/run.js` → `node eval/score.js` → 上传 `scoreboard.json`；故障注入按 runner
拆成 `workflow_dispatch` job（maven 需 setup-java，go 需 setup-go，vitest 需启用 corepack）。
可用 `actions/cache` 缓存 `eval/truth/repos`（键里带 commit）。

## 已知副作用

- `eval/*.js` 会出现在本项目自身 `audit-overview` 的孤儿检测里（未被引用的 JS），可忽略。
- `eslint.config.js` 的 ignores 有 `eval/truth/**`：clone 里带第三方自己的 lint 配置，会让 `eslint .` 崩溃。
  这是排除第三方代码，`eval/*.js` 本身照常 lint。
- `.gitignore` 只有目录锚定的 `eval/truth/` 一行（刻意不用裸模式，见审查 P1-15）。

## 执行路径与旧债取证入口

- `node eval/verify-watch-real.js`：需要真实 Jest 29.7.0；核对直接测试与 watch 的实际命令及完成事件。
- `node eval/verify-semgrep-real.js`：需要真实 Semgrep；本地规则验证 adapter 执行路径与 PATH 中同名程序的入口，不等价于默认 auto 配置验收。
- `node eval/verify-old-debts.js`：逐项输出旧债证据。退出 0 仅表示取证完成；必须逐项读取 status、scope 和 evidence，源码检查不等价于动态复现，性能政策不等价于新测量。
- `node eval/measure-scanner-overhead.js <条件标签>`：固定语料、独立项目缓存三次测量；操作系统文件缓存不清，必须记录扫描条件后配对，单组数据不能推断防护开关的影响。

原始报告位于 gitignored 的 `eval/truth/`；真实 Jest、Semgrep 的依赖装在隔离环境，未加入产品依赖。WSL 的本机环境入口见 `eval/truth/wsl-audit/linux-dir.txt`。历史样本、测量与发现只记录在 CHANGELOG，活跃问题与待核范围见 TECH_DEBT。

## 剩余方向的专项入口

- `node eval/verify-cache-growth.js`：多项目缓存增长、内容 churn 与删除后占用。
- `node eval/verify-u25-matrix.js`：普通 symlink、大小写、1200 提交及 parent/child submodule；大小写敏感样本须在相应文件系统执行。
- `node eval/verify-u22-graph-matrix.js`：冻结复杂 SCC、反向闭包与直接边的独立标签。`node eval/verify-u22-fixed-injection.js` 把相同标签注入固定仓库的独立副本；只评估 probe，不代表全仓精确率/召回率。
- `node eval/verify-unresolved-truth.js`：已知 builtin 与缺失本地目标；分别消费 unresolved、droppedImports 和 warnings，不把一个计数当作所有语言的同一语义。
- `node eval/verify-history-truth.js`：控制 churn 和 blame 份额。知识风险衡量代码归属集中，稳定性评分衡量结构信号；本实验不证明缺陷/事故预测或人的实际知识留存。
- `node eval/verify-old-debt-variants.js`、`node eval/verify-lifecycle-gates.js`、`node eval/verify-signal-cleanup.js`：旧债变种、实际编排故障注入与实际 CLI 信号路径；逐项读报告，不把脚本退出 0 当作产品无问题。
- `node eval/verify-full-parser-workers.js`：完整冷 CLI worker spike，索引/resolve/分析/SQLite 仍在主线程；比较结果抽样、时间、CPU 与 200ms RSS 采样。两个 preload 只供实验，产品不加载。
- `node eval/verify-setup-policy.js`：Windows 进程策略与安装失败控制流，外部 npm/CLI 故障为隔离模拟，不修改系统设置。

跨平台取证工作流在独立 `codex/u12-platform-validation-20261003` 分支；日志含真实失败，作业成功不是测试成功。原始报告仍 gitignored，交接须明确本机证据入口。
