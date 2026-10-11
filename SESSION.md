# SESSION.md

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- 补修提交 `e21d9d4` 已推送并核实远端 main；CI `38109199030`（Test，7 作业）与 `38109199005`（慢层，2 作业）均 success。独立验收通过（2026-10-11）：快层 276/276、完整 378/378、lint 与四专项通过、eval 23 PASS/0 FAIL；报告 `test/.reports/run-2026-10-11T03-42-26-349Z.json`。

- Windows 本机 Node 25.6.0（2026-10-11，本轮补修）：`npm run test:fast` 276/276；`npm test` 378/378（快层 276、慢层 92、串行 10），0 失败、退出码 0，约 24 分钟；`npm run lint` 退出码 0。全量报告 `test/.reports/run-2026-10-11T02-47-04-364Z.json`。本轮完整门禁未复现已记录的三项时序 flake。平台结果分别记录，不能外推。
- ROADMAP T0.1 已完成（2026-10-08，另一模型独立验收）：`eval/replay-impact.js` + `test/replay-impact-test.js` 交付，自回放本仓库 20 提交退出码 0；`--target` 模式（J1/F1/P1 回放入口）已补测试覆盖，测试缝为环境变量 `WB_REPLAY_TRUTH`。深度口径已裁决（2026-10-08，项目所有者选①）：ROADMAP 5.2 工具输出描述与 T0.5 归因④⑤⑥的沿引用方向步数边界已改为 5（`impact` 默认深度，`src/config/defaults.js:7` + `src/cli/commands/index.js:151`），结构上限仍 3 步，两个数定义不同、文档已注明。REPL 的 `impact` 默认深度已由 S6 对齐 CLI 的 5，默认方向为 all；底层 `getImpactRadius` 的缺省方向仍为 dependents。
- 缓存契约：缓存布局修订号 CACHE_SCHEMA_REVISION=55（CACHE_VERSION 另含引擎源码指纹），schemaVersion=1.2.0；parse_results 仍只保存纯解析输出。索引不完整时覆盖率为 null，消费者必须保留 warnings 与 degraded 状态。
- 缓存损坏隔离优先重命名；Windows 的 EBADF 路径退回独占备份后删除。备份失败时保留原文件并显式告警，不能吞掉读写失败。不要据此关闭尚未具备真实条件的环境项。
- WSL Ubuntu 24.04/ext4、Node 22.13.0（2026-10-04）：全量 321/321、0 失败、退出码 0，约 269 秒；lint 退出码 0。GitHub Actions 的 Node 22/22.13.0/24、ubuntu/windows 矩阵与慢层在 `2d8403f`、`10d7876`、`027c7ab` 连续 3 次全绿；macOS 作业已于 2026-10-06 移出 CI 测试矩阵（ROADMAP 小修 S3）；Docker（node:22、Linux 容器）全量 327/327、约 176 秒；`main` 已设合并门禁（9 个检查必须通过，管理员可绕过）。慢测默认并发 2。
- affected-tests 真值基线 TP 3045、FP 2512、FN 29；评测方法见 eval/README.md，不能把冻结 probe 外推为全语料准确率。
- U-15/U-30 仍需深信服隔离、真实同步盘与域策略条件；当前无这些条件，保留待核。深信服 aES 为公司管理，保持运行；不要求卸载。
- 开发计划以 ROADMAP 为准：当前阶段是阶段 1（补缺口）；执行规则见 ROADMAP 第 3 节，冻结项见第 9 节。
- 代码修改权（ROADMAP 第 3 条规则 1）：Codex 本会话（2026-10-11，T1.4 合并排序与回放命名覆盖修复；生产实现已完成，当前门禁与独立验收期间冻结代码，仅本会话处理失败修复）。**T1.3 验收完成（2026-10-11，Vivian 验收会话）：与 T1.2 合并验收通过**——J1 默认配置重跑与实施存档 `J1-t13-default` 逐格一致（总召回 0.4216、中位 15、0 错误、四条边类型逐项相等）；J1 all+nostop 重跑 458 输入与地板前 15 逐格一致（截断契约成立）；F1 0.1909→0.4668、P1 0.1800→0.3660（翻默认受益、0 错误、中位均 15）；快层 276/276、eval 23 项零 FAIL、慢层除 bug-27-28-29 flake 外全过（单独两次 + CI 绿）；CLI 抽查与词表校验通过。验收中修了一处 T1.2 引入的 CI lint 红（`validate-args.js` 重复 `--direction` 键，删 205 行重复项，`e135bbe`，CI 双绿）。回放坑+1：`eval/replay-impact.js` 用 `--target` 时**静默忽略 `--name`**（输出目录恒为 `replay/<代号>`，并发跑同代号会互踩、跑完覆盖基线目录），独立命名存档必须用 `--repo <路径> --name <名>` 形式；本会话 P1 基线目录因此被覆盖，以 `P1-pre-accept` 存档为对比基准（阶段 0 验收已证二者一致），验收产物在 `J1-accept-t13-default/`、`J1-accept-t13-nostop/`、`F1-accept-t13/`、`P1-accept-t13/`（由被覆盖的 `P1/` 目录改名而来，summary 内 name 字段仍为 "P1"，不影响数据）。

- T1.2/T1.3 验收遗漏补修：独立验收通过（代码提交 `6b0b426`，2026-10-11）；本机 lint、快层 276/276、完整 runner 378/378 均通过（退出码 0），六种主语言真实解析夹具四方向通过，独立只读审查无新增问题。`node eval/run.js` 与 `node eval/score.js` 完整重跑，23 项 PASS、0 FAIL；scoreboard 除时间与缓存大小外无指标变化。独立验收命令见 ROADMAP 第 6 节补修段。

## 下一步

1. **阶段 0 已完成（2026-10-09 另一会话验收通过）**：T0.2–T0.6、S6、T2.0 重跑全过——J1/F1/P1 全量 summary 与 runs.jsonl 除 wallMs/durationMs/出处字段外与原件一致（dirty=false），5.6 三表逐格核对通过，T0.5 counts 与 5.6 归因表全等，S6/T2.0 专项过、快层 273/273。5.5 判定：进入阶段 1（J1 Java→Java 工具 0.2263 对笨基线 0.2853，低 5.9 个百分点，归因第一位④方向属①-⑦）。
2. **阶段 1 进行中：T1.1–T1.3 完成（2026-10-11 Vivian 验收会话合并验收通过，证据见 ROADMAP 两行），只剩 T1.4**——合并排序，靶子已明确：J1 Java→Java 合并列表 0.5708 vs 工具 0.4957，差 7.5pp，超过 T1.4 触发线 5pp。**阶段 1 通过线现状（默认配置 = all+stop+截 15）**：Java→Java 0.4957（线 70%）、笨基线 0.4229、工具高 7.3pp（线 +15pp）、输出中位 15（线 ≤15 达标）——通过线依赖 T1.4 把共改信号合入。XML 两方向距 70% 线也远（0.3748/0.5163），T1.4 后若仍不过，归项目所有者复核线。T1.5 不需要。F1/P1 翻默认后验收重跑均受益（F1 0.1909→0.4668、P1 0.1800→0.3660，0 错误、中位 15）。"不下降"对比基准一律用 T1.1 后 J1 summary（工具总召回 0.1866）。统一验收五条见 ROADMAP 第 6 节。
3. **当前验证**：T1.2/T1.3 遗漏补修已独立验收通过；T1.4 与回放独立命名修复正在跑完整 runner、eval 和 J1/F1/P1 独立命名回放。主路径历史验收记录保留。回放子进程 require 工作区代码，历史基线须用独立 worktree；`--target --name` 已支持独立存档，并发使用不同名字。
4. **排队未动**：typer/cobra 无工具基线试点，排在 T1.1/T1.2 验收之后（T2.2 的方法预演，不阻塞当前判定）。
5. ROADMAP 第 8 节小修 S1（测试残留）、S2（未知错误输出调用栈）可并行，同样遵守单会话改代码规则。

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

读取完整警告与覆盖率，再对目标文件运行 impact 和 affected-tests；收工验证按 AGENTS.md 执行。
