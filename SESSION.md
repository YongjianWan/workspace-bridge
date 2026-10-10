# SESSION.md

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- Windows 本机 Node 25.6.0：快测 274/274（2026-10-09：273 基线 +T1.1 的 `mybatis-mapper-xml-test`；同日慢层 91/91，全量无回归。2026-10-08 构成：271 基线上 +S6 的 `repl-cli-impact-depth-test`、+T2.0 的 `usage-log-test`；此前 271=270+2026-10-06 `62f9072` 新增的 `cache-version-fingerprint-test.js`。2026-10-09 验收会话重跑同为 273/273 退出码 0）；全量 369 项通过 368 项（2026-10-05，约 19 分钟）：`workspace-info-lightweight-test` 在整套并发下耗时 3039 ms，超过它自己 3000 ms 的墙钟阈值，单独连跑 4 次都通过（本机 `node -e 1` 启动耗时在 0.1–1 秒间波动）。wb-repro 27/27、退出码 0。平台结果分别记录，不能外推。
- ROADMAP T0.1 已完成（2026-10-08，另一模型独立验收）：`eval/replay-impact.js` + `test/replay-impact-test.js` 交付，自回放本仓库 20 提交退出码 0；`--target` 模式（J1/F1/P1 回放入口）已补测试覆盖，测试缝为环境变量 `WB_REPLAY_TRUTH`。深度口径已裁决（2026-10-08，项目所有者选①）：ROADMAP 5.2 工具输出描述与 T0.5 归因④⑤⑥的沿引用方向步数边界已改为 5（`impact` 默认深度，`src/config/defaults.js:7` + `src/cli/commands/index.js:151`），结构上限仍 3 步，两个数定义不同、文档已注明。注意：REPL 的 `impact` 命令默认深度是 3（`src/cli/repl.js:191` 用 `WATCH_IMPACT_DEPTH`；`repl.js:204` 的 `affected-tests` 才是 5），与 CLI 不一致，测量以 CLI 为准，不影响 T0.2 起的回放。
- 缓存契约：缓存布局修订号 CACHE_SCHEMA_REVISION=55（CACHE_VERSION 另含引擎源码指纹），schemaVersion=1.2.0；parse_results 仍只保存纯解析输出。索引不完整时覆盖率为 null，消费者必须保留 warnings 与 degraded 状态。
- 缓存损坏隔离优先重命名；Windows 的 EBADF 路径退回独占备份后删除。备份失败时保留原文件并显式告警，不能吞掉读写失败。不要据此关闭尚未具备真实条件的环境项。
- WSL Ubuntu 24.04/ext4、Node 22.13.0（2026-10-04）：全量 321/321、0 失败、退出码 0，约 269 秒；lint 退出码 0。GitHub Actions 的 Node 22/22.13.0/24、ubuntu/windows 矩阵与慢层在 `2d8403f`、`10d7876`、`027c7ab` 连续 3 次全绿；macOS 作业已于 2026-10-06 移出 CI 测试矩阵（ROADMAP 小修 S3）；Docker（node:22、Linux 容器）全量 327/327、约 176 秒；`main` 已设合并门禁（9 个检查必须通过，管理员可绕过）。慢测默认并发 2。
- affected-tests 真值基线 TP 3045、FP 2512、FN 29；评测方法见 eval/README.md，不能把冻结 probe 外推为全语料准确率。
- U-15/U-30 仍需深信服隔离、真实同步盘与域策略条件；当前无这些条件，保留待核。深信服 aES 为公司管理，保持运行；不要求卸载。
- 开发计划以 ROADMAP 为准：当前阶段是阶段 1（补缺口）；执行规则见 ROADMAP 第 3 节，冻结项见第 9 节。
- 代码修改权（ROADMAP 第 3 条规则 1）：无。T1.2 实施完成（2026-10-10，Vivian 会话）待验收：impact 方向扩展（`--direction dependents|dependencies|neighbors|all`、`--no-stop-at-entry`），默认行为零漂移（J1 默认回放与 T1.1 基线逐字节一致）；扩展全开（all + 入口不停）J1 工具总召回 0.1866→0.6122、XML 两方向与实体→VO/DTO 过 70% 线，但输出中位 50>15 **触发 T1.3 插到最前**，扩展暂不设默认；快层 275/275、慢层 91/91、eval 23 项零 FAIL。验收命令在 ROADMAP T1.2 行；下一个要改代码或测试的会话，先在这一行写上自己的标识和开始时间，做完后改回"无"。

## 下一步

1. **阶段 0 已完成（2026-10-09 另一会话验收通过）**：T0.2–T0.6、S6、T2.0 重跑全过——J1/F1/P1 全量 summary 与 runs.jsonl 除 wallMs/durationMs/出处字段外与原件一致（dirty=false），5.6 三表逐格核对通过，T0.5 counts 与 5.6 归因表全等，S6/T2.0 专项过、快层 273/273。5.5 判定：进入阶段 1（J1 Java→Java 工具 0.2263 对笨基线 0.2853，低 5.9 个百分点，归因第一位④方向属①-⑦）。
2. **阶段 1 进行中：T1.2 实施完成待验收，T1.3 已触发插到最前**（T1.2 扩展全开输出中位 50>15；分解证明膨胀主因是双向 BFS 宽度，T1.3 做截断/排序把中位压到 ≤15 后扩展才设默认），T1.4（合并排序）排在 T1.3 之后，T1.5 不需要。"不下降"对比基准一律用 T1.1 后 J1 summary（工具总召回 0.1866，默认配置未变）；按统一验收第 2 条规则，T1.2 与 T1.3 合并验收（中位在扩展下超 15）。开工会话先登记代码修改权，统一验收五条见 ROADMAP 第 6 节。
3. **待验收清单**：S3 已验收通过（2026-10-10 推送 `50ba737..e7454e4`，run 38038677463 无 macOS 作业、CI_EXIT=0 全绿；2026-10-05 同改动首次运行 windows-latest+Node24 的 audit-assembler flake 为已知并发类，非 S3 回归）。
4. **排队未动**：typer/cobra 无工具基线试点，排在 T1.1/T1.2 验收之后（T2.2 的方法预演，不阻塞当前判定）。
5. ROADMAP 第 8 节小修 S1（测试残留）、S2（未知错误输出调用栈）可并行，同样遵守单会话改代码规则。

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

读取完整警告与覆盖率，再对目标文件运行 impact 和 affected-tests；收工验证按 AGENTS.md 执行。
