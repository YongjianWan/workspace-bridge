# SESSION.md

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- Windows 本机 Node 25.6.0（2026-10-05）：快测 210/210、lint 退出码 0；全量 326/326、0 失败、退出码 0（约 18.8 分钟）。wb-repro 27/27、退出码 0。平台结果分别记录，不能外推。
- 缓存契约：CACHE_VERSION=54，schemaVersion=1.2.0；parse_results 仍只保存纯解析输出。索引不完整时覆盖率为 null，消费者必须保留 warnings 与 degraded 状态。
- 缓存损坏隔离优先重命名；Windows 的 EBADF 路径退回独占备份后删除。备份失败时保留原文件并显式告警，不能吞掉读写失败。不要据此关闭尚未具备真实条件的环境项。
- WSL Ubuntu 24.04/ext4、Node 22.13.0：全量 321/321、0 失败、退出码 0；lint 退出码 0。GitHub Actions 矩阵、Windows Node 22/24 与 macOS/Docker 当前修复尚待重验，见 H-18。
- affected-tests 真值基线 TP 3045、FP 2512、FN 29；评测方法见 eval/README.md，不能把冻结 probe 外推为全语料准确率。
- U-15/U-30 仍需深信服隔离、真实同步盘与域策略条件；当前无这些条件，保留待核。深信服 aES 为公司管理，保持运行；不要求卸载。
- 重点开放问题：H-28（watch 测试顺序）、H-29（Windows 外部工具探测）、H-32 与 L2-45、L3-18（缓存回收）；证据和验收线以 TECH_DEBT 为准。

## 下一步

1. 将当前修复送入 GitHub Actions（上次 `9fd7ba8`：Windows 快测 1 个、慢层 8 个失败，已按 H-18 条目修复待验证），按 H-18 验证 Node 22/24、ubuntu/windows 矩阵与慢层连续全绿，并重验其他平台。
2. 第 3、4 步已完成；第 5 步台账的警告部分已完成（约 22 个原因码，提交 8e0cc92）；下一块是错误信封（H-15）：先列错误生产点清单，建原因码白名单，再分小块迁移；H-20 剩 3000 文件 17.4 秒（验收 15 秒） 大仓分段取证，再迁移统一分析记录与错误信封。H-11 等其余开放项以 TECH_DEBT 为准。
3. H-24、L1-19：核验 gitignore 子目录根判定与 submodule 的 git check-ignore 异常。
4. L2-41：补生成客户端代码的 api-contracts 匹配；不要把取证脚本退出 0 当作业务验收。
5. L3-17/H-20：隔离文件发现成本与大仓规模成本；已有真实指标不能由小夹具替代。
6. 获得真实条件后继续 U-15/U-30。原始报告位于 gitignored 的 eval/truth，复跑脚本保留在 eval。

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

读取完整警告与覆盖率，再对目标文件运行 impact 和 affected-tests；收工验证按 AGENTS.md 执行。
