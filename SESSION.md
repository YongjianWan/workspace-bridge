# SESSION.md

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- Windows 本机 Node 25.6.0（2026-10-05）：快测 270/270、lint 退出码 0；全量 369 项通过 368 项（约 19 分钟）：`workspace-info-lightweight-test` 在整套并发下耗时 3039 ms，超过它自己 3000 ms 的墙钟阈值，单独连跑 4 次都通过（本机 `node -e 1` 启动耗时在 0.1–1 秒间波动）。wb-repro 27/27、退出码 0。平台结果分别记录，不能外推。
- 缓存契约：缓存布局修订号 CACHE_SCHEMA_REVISION=55（CACHE_VERSION 另含引擎源码指纹），schemaVersion=1.2.0；parse_results 仍只保存纯解析输出。索引不完整时覆盖率为 null，消费者必须保留 warnings 与 degraded 状态。
- 缓存损坏隔离优先重命名；Windows 的 EBADF 路径退回独占备份后删除。备份失败时保留原文件并显式告警，不能吞掉读写失败。不要据此关闭尚未具备真实条件的环境项。
- WSL Ubuntu 24.04/ext4、Node 22.13.0（2026-10-04）：全量 321/321、0 失败、退出码 0，约 269 秒；lint 退出码 0。GitHub Actions 的 Node 22/22.13.0/24、ubuntu/windows 矩阵与慢层在 `2d8403f`、`10d7876`、`027c7ab` 连续 3 次全绿；macOS 只跑快层与 smoke（通过），未跑慢层；Docker（node:22、Linux 容器）全量 327/327、约 176 秒；`main` 已设合并门禁（9 个检查必须通过，管理员可绕过）。慢测默认并发 2。
- affected-tests 真值基线 TP 3045、FP 2512、FN 29；评测方法见 eval/README.md，不能把冻结 probe 外推为全语料准确率。
- U-15/U-30 仍需深信服隔离、真实同步盘与域策略条件；当前无这些条件，保留待核。深信服 aES 为公司管理，保持运行；不要求卸载。
- 重点开放问题：H-22（路径写法统一，对应 ROADMAP「路径身份」）；证据和验收线以 TECH_DEBT 为准。

## 下一步

1. 阶段 0：在目标仓库的提交历史上回放 `impact`（ROADMAP「产品化路线」）。通过线与回放口径已定（该节「回放口径」）；前置是项目所有者对该节剩余两项待决定事项拍板；做完回报每类边的召回率、输出文件数中位数和与笨基线的对比。
2. H-22：路径写法统一（ROADMAP「路径身份」，改动落在 `path.js`、`dep-graph.js` 等高危文件，先跑 impact 与 affected-tests）。启动时机以产品化路线阶段 0 到 2 的数据为准。
3. 获得真实条件后继续 U-15/U-30。原始报告位于 gitignored 的 eval/truth，复跑脚本保留在 eval。

其余开放项以 TECH_DEBT 为准。

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

读取完整警告与覆盖率，再对目标文件运行 impact 和 affected-tests；收工验证按 AGENTS.md 执行。
