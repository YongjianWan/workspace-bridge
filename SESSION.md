# SESSION.md

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- Windows 本机 Node 25.6.0：快测 271/271（2026-10-08，+1 为 2026-10-06 `62f9072` 新增 `cache-version-fingerprint-test.js`）；全量 369 项通过 368 项（2026-10-05，约 19 分钟）：`workspace-info-lightweight-test` 在整套并发下耗时 3039 ms，超过它自己 3000 ms 的墙钟阈值，单独连跑 4 次都通过（本机 `node -e 1` 启动耗时在 0.1–1 秒间波动）。wb-repro 27/27、退出码 0。平台结果分别记录，不能外推。
- ROADMAP T0.1 已完成（2026-10-08，另一模型独立验收）：`eval/replay-impact.js` + `test/replay-impact-test.js` 交付，自回放本仓库 20 提交退出码 0；`--target` 模式（J1/F1/P1 回放入口）已补测试覆盖，测试缝为环境变量 `WB_REPLAY_TRUTH`。深度口径已裁决（2026-10-08，项目所有者选①）：ROADMAP 5.2 工具输出描述与 T0.5 归因④⑤⑥的沿引用方向步数边界已改为 5（`impact` 默认深度，`src/config/defaults.js:7` + `src/cli/commands/index.js:151`），结构上限仍 3 步，两个数定义不同、文档已注明。注意：REPL 的 `impact` 命令默认深度是 3（`src/cli/repl.js:191` 用 `WATCH_IMPACT_DEPTH`；`repl.js:204` 的 `affected-tests` 才是 5），与 CLI 不一致，测量以 CLI 为准，不影响 T0.2 起的回放。
- 缓存契约：缓存布局修订号 CACHE_SCHEMA_REVISION=55（CACHE_VERSION 另含引擎源码指纹），schemaVersion=1.2.0；parse_results 仍只保存纯解析输出。索引不完整时覆盖率为 null，消费者必须保留 warnings 与 degraded 状态。
- 缓存损坏隔离优先重命名；Windows 的 EBADF 路径退回独占备份后删除。备份失败时保留原文件并显式告警，不能吞掉读写失败。不要据此关闭尚未具备真实条件的环境项。
- WSL Ubuntu 24.04/ext4、Node 22.13.0（2026-10-04）：全量 321/321、0 失败、退出码 0，约 269 秒；lint 退出码 0。GitHub Actions 的 Node 22/22.13.0/24、ubuntu/windows 矩阵与慢层在 `2d8403f`、`10d7876`、`027c7ab` 连续 3 次全绿；macOS 作业已于 2026-10-06 移出 CI 测试矩阵（ROADMAP 小修 S3）；Docker（node:22、Linux 容器）全量 327/327、约 176 秒；`main` 已设合并门禁（9 个检查必须通过，管理员可绕过）。慢测默认并发 2。
- affected-tests 真值基线 TP 3045、FP 2512、FN 29；评测方法见 eval/README.md，不能把冻结 probe 外推为全语料准确率。
- U-15/U-30 仍需深信服隔离、真实同步盘与域策略条件；当前无这些条件，保留待核。深信服 aES 为公司管理，保持运行；不要求卸载。
- 开发计划以 ROADMAP 为准：当前阶段是阶段 0（测量）；执行规则见 ROADMAP 第 3 节，冻结项见第 9 节。
- 代码修改权（ROADMAP 第 3 节第 1 条）：无。T0.1 代码已完成并验收，下一个要改代码或测试的会话，先在这一行写上自己的标识和开始时间，做完后改回"无"。

## 下一步

1. **T0.2 起被 targets.json 挡住**：`eval/truth/targets.json` 不存在，需要项目所有者提供 J1、F1、P1 的本机路径（格式见 ROADMAP 5.1：`{"J1": {"path": "<本机绝对路径>", "type": "java-mybatis", "cutoff": "<截止提交哈希>"}, ...}`；`cutoff` 首次运行时记录，可先不填）。文件放 gitignored 的 `eval/truth/` 下。拿到后按 T0.2→T0.3→T0.4 顺序跑回放。
2. **待项目所有者决定**：REPL `impact` 默认深度 3（`src/cli/repl.js:191`，`WATCH_IMPACT_DEPTH`）与 CLI `impact` 的 5 不一致（`repl.js:204` 的 `affected-tests` 才是 5）。要么改 `src/cli/repl.js` 对齐 CLI，要么记 TECH_DEBT 冻结；动 src/ 需单独立项，等拍板。
3. **排队，未开工**：T2.0 使用日志（要动 src/，超出阶段 0 范围）；"无工具 agent 漏改"基线实验（按 ROADMAP 5.2，留出任务池是 J1、F1 各自最新 20 个可用提交，仍然依赖私有路径；要换池子先定口径）。两项都等项目所有者点头。
4. ROADMAP 第 8 节小修 S1（测试残留）、S2（未知错误输出调用栈），可与阶段 0 并行，同样遵守单会话改代码规则。
5. 小修 S3（macOS 移出 CI 矩阵）待验收：由另一个会话确认下一次推送后 Test 工作流没有 macOS 作业且其余作业通过，然后在 ROADMAP 第 8 节改为"完成"。

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

读取完整警告与覆盖率，再对目标文件运行 impact 和 affected-tests；收工验证按 AGENTS.md 执行。
