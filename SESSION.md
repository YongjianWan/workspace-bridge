# SESSION.md

个人项目不自我设限：题目不是限制，也不是唯一解。ROADMAP 的测量口径和通过线用来判断方向，不用来框住能做什么。

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- 代码修改权（ROADMAP 第 3 节规则 1）：Vivian（Claude）本会话，2026-10-11 开始；当前任务 TECH_DEBT H-34（入口标记一词两义）。
- 评审修复批次（评测口径解耦、方向词表单点、超深 gitignore 目录不再误报，提交见 git log）：Windows / Node 25.6.0 完整 runner 382/382、0 失败、退出码 0（报告 `test/.reports/run-2026-10-11T12-04-11-099Z.json`）；lint 退出码 0；`node eval/run.js` 与 `node eval/score.js` 23 PASS / 0 FAIL。实施方自测，待另一会话独立验收。
- 当前验证源码：`75253fe`（2026-10-11）。Windows / Node 25.6.0：快层 279/279、完整 runner 382/382、0 失败、退出码 0；九项专项与 lint 退出码 0。完整报告 `test/.reports/run-2026-10-11T05-19-22-405Z.json`；全部测试记录 `ok=true`、`status=0`，无 error 或 signal。
- 源码 CI：[Test 38116087949](https://github.com/YongjianWan/workspace-bridge/actions/runs/38116087949) 的 7 作业与 [慢层 38116087948](https://github.com/YongjianWan/workspace-bridge/actions/runs/38116087948) 的 2 作业均 success；Test 的失败作业原样重跑后通过。平台结果分别记录，不外推为其他环境全量验收。
- T1.4 独立回放：J1 holdout 20、88 提交 / 458 输入；F1 holdout 20、144 / 848；P1 holdout 0、75 / 325。三个产物均来自 clean `75253fe`，0 错误、逐条输出 ≤15、中位 15；原真值与 619 份源码、12 份原基线指纹无漂移。J1/F1 与实施稳定结果一致，P1 为原完整范围的有效结果。汇总见本机 gitignored `eval/truth/t14-independent-final.json`，三个 final 目录与指标见 ROADMAP 第 6 节。
- 最终源码的 `node eval/run.js` 与 `node eval/score.js` 已顺序完整重跑，退出码均 0；新 scoreboard 实际 23 PASS、0 FAIL。计分脚本退出 0 本身不代表门禁通过，须检查 verdict。
- 缓存契约：CACHE_SCHEMA_REVISION=55（CACHE_VERSION 另含引擎源码指纹），schemaVersion=1.2.0；parse_results 只存纯解析输出。索引不完整时 `discoveryComplete=false`、`coverageRatio=null`，消费者必须保留 warnings 与 degraded 状态，不按 100% 覆盖解读。
- 其他平台的最近核验（各自独立，不外推）：WSL Ubuntu 24.04/ext4、Node 22.13.0（2026-10-04）全量 321/321、约 269 秒；Docker（node:22、Linux 容器）全量 327/327、约 176 秒；`main` 合并门禁 9 个必需检查，管理员可绕过。慢测默认并发 2。
- affected-tests 真值基线 TP 3045、FP 2512、FN 29；评测方法见 eval/README.md，不能把冻结 probe 外推为全语料准确率。
- U-15/U-30 仍待深信服隔离、真实同步盘及域策略环境核验；无对应条件时保持冻结。深信服 aES 为公司管理，保持运行。其余冻结项与重启条件按 ROADMAP 第 9 节。

## 下一步

1. 阶段 1 已止损（2026-10-11 项目所有者确认），阶段 2 冻结；止损后维护的命令范围待项目所有者指定（ROADMAP 第 10 节）。
2. 进行中：H-34 已实施（`1a3d25b`、`c94532e`），快层 279/279、lint 0、六语言新测试通过。正在依次回放 J1/F1/P1（`--name <代号>-h34-impl`），之后跑完整 runner 与 eval；结果写入本节后状态改为待验收。验收线见 TECH_DEBT H-34。H-35（路由标签）已登记，未开工。
3. 待独立验收：评审修复批次（见上方当前交接）。验收命令：`node test/replay-impact-test.js`、`node test/index-depth-config-test.js`、`npm run lint`、`npm test`、`node eval/run.js && node eval/score.js`，以及 `node cli.js audit-overview --cwd . --json --quiet` 的 `analysisCoverage.discoveryComplete` 为 true。

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

读取完整警告与覆盖率，再对目标文件运行 impact 和 affected-tests；收工验证按 AGENTS.md 执行。
