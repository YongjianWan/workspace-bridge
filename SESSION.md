# SESSION.md

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- 代码修改权（ROADMAP 第 3 节规则 1）：**无**。阶段 1 所有已触发任务完成，未达到阶段通过线；止损待项目所有者确认，阶段 2 未开始。
- 当前验证源码：`75253fe`（2026-10-11）。Windows / Node 25.6.0：快层 279/279、完整 runner 382/382、0 失败、退出码 0；九项专项与 lint 退出码 0。完整报告 `test/.reports/run-2026-10-11T05-19-22-405Z.json`；全部测试记录 `ok=true`、`status=0`，无 error 或 signal。
- 源码 CI：[Test 38116087949](https://github.com/YongjianWan/workspace-bridge/actions/runs/38116087949) 的 7 作业与 [慢层 38116087948](https://github.com/YongjianWan/workspace-bridge/actions/runs/38116087948) 的 2 作业均 success；Test 的失败作业原样重跑后通过。平台结果分别记录，不外推为其他环境全量验收。
- T1.4 独立回放：J1 holdout 20、88 提交 / 458 输入；F1 holdout 20、144 / 848；P1 holdout 0、75 / 325。三个产物均来自 clean `75253fe`，0 错误、逐条输出 ≤15、中位 15；原真值与 619 份源码、12 份原基线指纹无漂移。J1/F1 与实施稳定结果一致，P1 为原完整范围的有效结果。汇总见本机 gitignored `eval/truth/t14-independent-final.json`，三个 final 目录与指标见 ROADMAP 第 6 节。
- 最终源码的 `node eval/run.js` 与 `node eval/score.js` 已顺序完整重跑，退出码均 0；新 scoreboard 实际 23 PASS、0 FAIL。计分脚本退出 0 本身不代表门禁通过，须检查 verdict。
- 缓存契约：CACHE_SCHEMA_REVISION=55（CACHE_VERSION 另含引擎源码指纹），schemaVersion=1.2.0；parse_results 只存纯解析输出。索引不完整时 `discoveryComplete=false`、`coverageRatio=null`，消费者必须保留 warnings 与 degraded 状态，不按 100% 覆盖解读。
- U-15/U-30 仍待深信服隔离、真实同步盘及域策略环境核验；无对应条件时保持冻结。深信服 aES 为公司管理，保持运行。其余冻结项与重启条件按 ROADMAP 第 9 节。

## 下一步

1. **请项目所有者确认 ROADMAP 第 4 节止损。** J1 Java→Java 工具召回 58.56%、当期笨基线 43.98%、合并列表 58.79%；两项增益 14.58pp / 14.81pp，均 <15pp，工具召回也低于 70%。任务通过不等于阶段通过。
2. 在所有者裁决前保持阶段 2 未开始，不继续盲调排序或调整阈值。确认止损后转为实验项目，维护命令范围由所有者指定；当前没有新增代码实施授权。

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

读取完整警告与覆盖率，再对目标文件运行 impact 和 affected-tests；收工验证按 AGENTS.md 执行。
