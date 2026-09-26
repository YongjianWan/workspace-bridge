# eval/ — workspace-bridge 最小评测集

固定仓库 + 独立真值 + 打分。回应外部审查（`docs/workspace-bridge-审查报告.md`）的核心结论：
「没有外部真值，所有验证都是自己验证自己」。这里是外部真值的最小骨架。

**评分不是门禁**：`score.js` 永远 exit 0；`baseline.json` 对比只打印 PASS/FAIL 行。

## 目录结构

```
eval/
├── corpus.json          # 钉版本仓库清单（3 个）+ faultInjection 采样文件 + reason 词表
├── labels/              # 审查报告 §5.1 全部 27 条 FP 标签（.jsonl，一仓一文件）
├── truth/               # [gitignored] 克隆仓库 + 生成的真值 + CLI 输出缓存
│   ├── repos/<name>/    #   钉 commit 的克隆
│   ├── out/<name>/      #   dead-exports.json / audit-overview.json / status.json
│   │                    #   typer 另有 typer.cov / gt.json / covrc / pytest.log
│   └── venv-typer/      #   typer coverage 专用隔离 venv
├── run.js               # 克隆 + 跑 CLI + 编排 typer coverage 真值
├── inject-fault.js      # 故障注入真值生成（显式 flag，昂贵）
├── score.js             # 生成 scoreboard.json，对比 baseline
├── baseline.json        # 首次成功跑出的实测数字
├── scoreboard.json      # score.js 每次重写
├── findings.md          # eval 期间观察到的输出 bug（只记录不修）
└── README.md            # 本文件
```

## 前置条件

| 步骤 | 需要什么 | 缺失时的行为 |
| --- | --- | --- |
| `run.js`（全部仓库） | Node ≥ 22.13、git、网络（clone） | 直接失败并报错 |
| typer affected-tests | python3 + venv + pip 网络（自动 `pip install pytest coverage` 与 `pip install -e <typer>` 进 `eval/truth/venv-typer`，不污染系统环境） | `status.json` 记 `pending: <原因>`，其余指标继续 |
| spring-petclinic 故障注入 | `java -version` + `mvn -v` | 打印 `pending: <原因>` 后 exit 0，不伪造 |
| vitesse 故障注入 | `pnpm -v`（自动 `pnpm install --frozen-lockfile`） | 同上 |

Windows/Git Bash 注意：不要把 CLI 的 JSON 经 PowerShell 管道（BOM 问题）；
`run.js`/`score.js` 全部用 `spawnSync` + 文件中转，不走管道。

## 用法

```bash
# 1. 跑评测（默认全部仓库；--force 忽略缓存强制重跑）
node eval/run.js                # 全部
node eval/run.js typer          # 单个
node eval/run.js --force        # src/ 改动后强制刷新 CLI 输出

# 2. 打分（永远 exit 0）
node eval/score.js              # -> eval/scoreboard.json + 终端摘要

# 3. （可选，昂贵）故障注入真值 —— petclinic 需要 JDK+mvn，vitesse 需要 pnpm
node eval/inject-fault.js spring-petclinic
node eval/inject-fault.js vitesse
node eval/score.js              # 重跑打分，affected-tests 由 pending 变 ok
```

**缓存语义**：每个耗时步骤（克隆、dead-exports、audit-overview、coverage+pytest）在
输出存在且「目标仓库 commit + `src/` 最新 mtime」都没变时跳过。src/ 改动后要么 `--force`，
要么 score 自然读旧缓存——对比 baseline 前记得 `--force` 刷新。

## 真值与打分方法

### affected-tests（typer，coverage 真值）

严格按审查报告 §5.2：

1. `run.js` 在 `eval/truth/venv-typer` 建隔离 venv，装 `pytest coverage` + `pip install -e <typer 克隆>`。
2. **独立 rcfile 是强制的**：typer 自带的 `[tool.coverage.run]` 是 `parallel = true` + 自定义
   `data_file`，与 pytest-cov 冲突；`run.js` 生成只含 `source=<clone>/typer`、
   `dynamic_context=test_function`、`data_file=<out>/typer.cov` 的 rcfile。
3. 在克隆目录里执行（`-p no:cov` 关 pytest-cov；typer 的 pyproject 仍会被 pytest 读到，
   `minversion=9` 由 venv 里最新 pytest 满足）：
   ```
   python -m coverage run --rcfile=... -m pytest -q -p no:cacheprovider -p no:cov tests
   ```
4. `gt.json` = per-file → test-function 真值（`dump_gt.py`，`ground_truth()` 的逐行移植：
   coverage context → 测试文件；raw contexts 也存了）。**真值是下限**：子进程跑的示例程序
   coverage 追不到。实测 gt 与审查一致（`rich_utils.py` 实际 109、`_types.py` 实际 9）。
5. `score.js` 把 `test/eval_affected_tests.py` 的匹配循环**移植到 JS**（ground truth 读
   `gt.json`，预测读克隆里 cache.db 的 `precomputed_impact`，两侧路径归一成 `/` 后跑
   同一个 micro P/R 循环）。**为什么不 shell 出那个 python 文件**：它在 Windows 上
   `os.path.relpath` 产出反斜杠，而 `is_test` 过滤检查的是 `tests/` 前缀——预测全被过滤成 0
   （实测 precision=recall=0.00；见 findings.md）。test/ 下的文件不许改，方法论以它为准，
   移植只做分隔符归一，循环语义逐句对应。pytest exit 1（有用例失败）照样接受——真值取自
   coverage 数据，与通过与否无关。

### affected-tests（故障注入真值，petclinic / vitesse）

`inject-fault.js` 对 corpus 里每 10 个采样文件（独立运行才执行）：

- **选的是运行时故障，不是语法错误**：Java 在第一个 class 声明后插
  `static { throw new RuntimeException("wb-eval-fault"); }`（类初始化即炸，恰好打到「用到这个类的测试」）；
  TS/Vue 在第一行 / `<script>` 后插 `throw new Error('wb-eval-fault')`。
  语法错误会导致整模块编译失败 → 全部测试挂 → 真值退化成「全集」，无信号，所以不选。
- 每个文件：备份 → 注入 → 跑套件（petclinic: `mvn -B test`，解析 surefire XML；
  vitesse: `pnpm exec vitest run --reporter=json`）→ 恢复（finally + 事后 `git checkout -f`）。
- 失败测试（减 baseline）映射到测试文件路径，写 `truth/out/<name>/affected-tests-truth.json`。
- `score.js` 对每个注入文件调 CLI `affected-tests --file`，按测试路径规则过滤后做 micro P/R。

### dead-code（标签真值）

- 标签 = 审查报告 §5.1 的 **27 条 FP**（`labels/*.jsonl`，词表见 `corpus.json.reasonVocabulary`）。
- 打分按**符号级**：`dead-exports` 的每个 `(file, symbol)` 对上标签（glob `*`/`**`、
  裸文件名按 basename 匹配、`symbol:"*"` 匹配任意符号）→ FP；没标签的 → **presumed TP**。
  `precision = 未标注 / (未标注 + 仍被报告的已标注 FP)`，按工具自报 confidence 分桶
  （`precisionHigh` / `precisionLow` / 全量 `precision`）。
- **口径警告**：标签只标了 FP，没验证过其余发现——这是**相对指标**，不是绝对精度。
  例：vitesse `src/composables/dark.ts` 三个导出疑似同属 auto-import 误报但不在 27 条里，
  会把数字抬高（见 findings.md）。v1 不擅自扩标签。
- 报告有 exports 截断 100 上限（P1-17），符号级计数在超大文件上可能不满。

## 解读规则（interpretation rules）

- **affected-tests：recall 优先**。审查实测 0.63 / 0.95；召回率不许下降（漏报比多报更贵），
  精确率随 P0-1 等修复应上升。
- **dead-code：precision 优先**。`precisionHigh` 应 ≥ 0.9（审查验收标准：27 条里没有一条再标
  high——达到时 `labels` 中 `reported=true && reportedConfidence=high` 应为 0）。
- 与 `baseline.json` 相比任一数值指标下降 > 0.05 → 该行打印 `FAIL`（其余 `PASS`），
  **exit 仍为 0**。更新基线 = 用新 scoreboard 覆写 baseline.json（人工确认后）。
- 同时看 `counts.labeledNotReported`：已知误报不再被报告 = 真实进步，precision 可能反而下降
  （分母里 FP 没了、TP 也没进来），别只看单个数字。
- 并发修复期间数字合法地漂移——**记录实测，不许倒推凑数**。

## held-out 机制

`corpus.json` 每个仓库有 `heldOut: boolean`（v1 全部 `false`）。
将来新增仓库时：调参/修 bug 阶段只看 `heldOut=false` 的分数；`heldOut=true` 的仓库只在
发布前跑一次做最终检验，平时不许拿它的分数指导修改。`scoreboard.json` 里透出该字段。

## 如何加标签 / 加发现

- **加标签**（真值变了）：往 `eval/labels/<repo>.jsonl` 追加一行
  `{"repo","file","symbol","label":"FP","reason":<词表>}`。`file` 支持 `*`/`**` glob 或裸文件名；
  `symbol:"*"` = 文件级标签（README 里注明，如 NeEEvA `sensevoice_server.py` 一行代表 35 个导出）。
  新 reason 必须进 `corpus.json.reasonVocabulary`。
- **加仓库**：`corpus.json` 加一项（name/url/commit/languages/shape/metrics/heldOut），
  建对应 `labels/<name>.jsonl`，`node eval/run.js <name>`。
- **记录工具新 bug**：`findings.md` 按模板追加，**不修 src/**。

## 标签清单（27 条，来源 = 审查报告 §5.1）

| 标签文件 | 条数 | 对应仓库在 corpus？ |
| --- | --- | --- |
| `typer.jsonl` | 3 | ✅ |
| `vitesse.jsonl` | 4 | ✅ |
| `spring-petclinic.jsonl` | 1 | ✅ |
| `NeEEvA.jsonl` | 3 | ❌（v1 只转录，不打分） |
| `full-stack-fastapi-template.jsonl` | 5 | ❌（同上；alembic 文件路径由 GitHub 该 commit 的 tree 核对） |
| `glow.jsonl` | 2 | ❌ |
| `hexyl.jsonl` | 3 | ❌ |
| `cJSON.jsonl` | 6 | ❌（fuzz 文件路径已按该 commit 核对） |

转录口径备注：
- NeEEvA `sensevoice_server.py` 一行 `symbol:"*"` 代表报告里 35 个导出；
  `seedvc_server.py` 拆成两行（装饰器路由 / `__main__` 守卫）。
- typer `NoneType` 报告没给文件，实测发现来自 `typer/_typing.py`（已按实测校正）。
- 报告说 typer `scripts/docs.py` 曾被标 high 误报；当前构建不再报告它
  （`labeledNotReported` 会记 1），标签保留——它是审查时点的真值。

## CI：slow 层 / nightly 集成建议

参照 `.github/workflows/test-slow.yml` 的惯例（`schedule` cron + `workflow_dispatch`、
`npm ci`、独立 job 不阻塞 PR）。评测比 slow 层更慢（clone + coverage + pytest 数分钟），建议：

```yaml
# .github/workflows/eval-nightly.yml（建议，尚未添加）
name: Eval (nightly)
on:
  schedule:
    - cron: '0 19 * * *'   # 避开 test-slow 的 18:00，错峰
  workflow_dispatch:
jobs:
  eval:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: npm ci
      - run: node eval/run.js            # 3 仓库 + typer coverage 真值
      - run: node eval/score.js          # exit 0，靠输出里的 FAIL 行报警
      - uses: actions/upload-artifact@v4
        with: { name: scoreboard, path: eval/scoreboard.json }
      # 故障注入更贵，建议单独 workflow_dispatch job：
      # - run: node eval/inject-fault.js vitesse   （ubuntu 自带 pnpm 需先启用 corepack）
      # spring-petclinic 需要 actions/setup-java（temurin 21 + maven）
```

要点：`score.js` 不阻塞（exit 0），报警靠人看 FAIL 行或后续把 `summary.fail` 接到
workflow 输出；克隆缓存可用 `actions/cache` 缓 `eval/truth/repos`（键里带 commit）。

## 已知副作用（记录在案）

- `eval/*.js` 会在项目自身 `audit-overview` 的孤儿检测里出现（未被引用的根级 JS）——
  可接受，见审查/自审时忽略它们。
- 为了让 `npm run lint` 干净，`eslint.config.js` 的 ignores 增加了一行 `eval/truth/**`：
  克隆里带第三方自己的 `eslint.config.js`（vitesse 的 `@antfu/eslint-config` 未安装会直接
  让 `eslint .` 崩溃）。这是排除第三方克隆，不是放松本仓库规则；`eval/*.js` 本身照常被 lint。
- `.gitignore` 只加了目录锚定的 `eval/truth/` 一行（刻意不用裸模式，见报告 P1-15）。
