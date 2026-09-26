# workspace-bridge 观察到的输出问题（eval 期间）

> 记录在评测过程中观察到的 workspace-bridge 输出 bug。**只记录，不修复**（src/ 由其他 agent 负责）。
> 格式：每条包含 — 现象、复现命令、观察到的输出、涉及的报告问题 ID（如有）。

## 模板

### <标题>

- **日期**：
- **仓库/文件**：
- **复现**：`node cli.js <command> --cwd ... --json --quiet`
- **现象**：
- **期望**：
- **疑似关联**：（审查报告 P0-x / P1-x，或新问题）

---

## 观察记录

### `test/eval_affected_tests.py` 在 Windows 上预测恒为 0（路径分隔符）

- **日期**：2026-09-26
- **仓库/文件**：`test/eval_affected_tests.py`（`predictions()` + `is_test` lambda）
- **复现**：`eval/truth/venv-typer/Scripts/python.exe test/eval_affected_tests.py eval/truth/repos/typer eval/truth/out/typer/typer.cov tests`
- **现象**：per-file 表全部 `pred=0 hit=0`，`micro precision=0.00 recall=0.00`。
  `os.path.relpath` 在 Windows 返回 `tests\test_cli.py`（反斜杠），而
  `is_test = p.startswith(test_dir + '/')` 只认 `tests/` 前缀 → 预测全被过滤；
  gt 侧的 candidate 是 `'/'.join(...)` 正反斜杠混用，交集也为空。
- **期望**：两侧 `replace('\\','/')` 归一后再比较；或用 `os.sep` 拼前缀。
- **疑似关联**：审查未发现（审查环境是 Linux）。**test/ 不许改**——eval/score.js 已按同语义
  移植成 JS（分隔符归一），python 文件保持原样作为方法论权威。

### typer 测试套件在 Windows + coverage 下非全绿（21 failed / 16 errors）

- **日期**：2026-09-26
- **仓库/文件**：typer @ `a80f6e5ecd`，`tests/`
- **复现**：`node eval/run.js typer`（见 `eval/truth/out/typer/pytest.log`）
- **现象**：`21 failed, 1358 passed, 21 skipped, 2 xfailed, 16 errors in 1153s`。
  失败集中在 `tests/test_tutorial/test_exceptions/*` 等子进程/终端相关用例（Windows 环境差异）。
- **期望**：不阻塞评测——coverage 真值与通过与否无关（gt 与审查数字一致：rich_utils=109）。
  `run.js` 因此接受 pytest exit 0/1，只在 exit ∉ {0,1} 或 cov 缺失时判 pending。
- **疑似关联**：无（环境观察，非 workspace-bridge bug）。

### vitesse `src/composables/dark.ts` 三个导出标 high，疑似 auto-import 误报（未在审查 27 条内）

- **日期**：2026-09-26
- **仓库/文件**：vitesse @ `8a01bc9283`，`src/composables/dark.ts`
- **复现**：`node cli.js dead-exports --cwd eval/truth/repos/vitesse --json --quiet`
- **现象**：`isDark` / `toggleDark` / `preferredDark` 被报 dead export，confidence=high。这些是
  `unplugin-auto-import` 扫描 `src/composables/` 自动注入的组合式函数（组件里直接用、无 import 语句）。
- **期望**：与审查已核实的 `useUserStore`（同为 auto-import FP）同一命运——不应标 high，或根本不该报。
- **疑似关联**：P0-6 家族（auto-import 一条对应审查第 5 阶段验收），但该文件不在 §5.1 的 27 条里。
  **不擅自扩标签**（标签 = 审查真值），仅记录；它当前会被计为 unlabeled TP，抬高 vitesse 的 precision。

### typer `scripts/docs.py` 不再被报告（与审查时点不一致）

- **日期**：2026-09-26
- **仓库/文件**：typer @ `a80f6e5ecd`
- **复现**：`node eval/run.js typer && node eval/score.js`（看 `labeledRows` 里 `scripts/docs.py` 的 `reported`）
- **现象**：审查时 `scripts/docs.py` 的 `@app.command()` 命令被标 high 死代码；当前构建
  （deadExportsCount=2，只有 `rich_utils.escape_before_html_export` 和 `_typing.NoneType`，均 medium）
  不再报告该文件。两条 p0-1 关联标签仍被报告。
- **期望**：无需动作——记录差异。可能是并发修复已生效，也可能是 Windows 环境差异；未归因。
- **疑似关联**：审查 §5.1（typer 行）、P0-6。
