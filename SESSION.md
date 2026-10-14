# SESSION.md

个人项目不自我设限：题目不是限制，也不是唯一解。ROADMAP 的测量口径和通过线用来判断方向，不用来框住能做什么。

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- 代码修改权（ROADMAP 第 3 节规则 1）：**Vivian（Kimi）2026-10-14 会话持有**。按「下一步」第 1 条（项目所有者 2026-10-13 最高优先级指令）执行过线任务。策略声明：主通道 B1 学习排序（候选内特征 + 时间切分训练，权重从训练数据学出、不在留出样本上调）；辅通道 A3 提交说明 TF-IDF 语义检索（声明后探针）。已探死通道（1–6、9-文本级、A1）不重复。所有数字以留出提交为唯一判官。
- 过线任务终审（2026-10-14，Vivian 实施）：**所有回放可裁决通道全部关闭，未过线**。基线复现 `J1-holdout-v5-base` 与 v4 逐项一致（全类型 0.6099、ceiling 0.8165、110 输入 0 错误）；Java→Java +15pp 条件其实已满足（0.6545−0.5034=+15.1pp，SESSION 此前记的 +13.7pp 是全类型行），唯一缺口是召回 0.6545<0.70。B1 学习排序三变体终审：pairwise 0.6532 / pointwise 0.6393 / pairwise+交互 0.6332（均 ≤ 产品 0.6545）；A3 提交说明 TF-IDF 0.6393。候选池 92.8% 含真值、完美排序可达 0.9642——瓶颈是排序信号，而静态+diff+任务模板信号已全部榨干。证据产物（本机 gitignored）：`eval/truth/phase6-feature-dump.js`（108 提交候选特征转储）、`eval/truth/phase6-ranker.js` / `phase6-ranker-v2.js` / `phase6-a3-probe.js`、`eval/truth/replay/p6-dump-j1/`（features.jsonl 568 输入）。剩余通道（A2/A4/C1）非回放可裁决，归项目所有者决策。
- diff 上下文（2026-10-13 实施，已推送待复核）：`impact` 输入文件有未提交改动时，改动标识符的 IDF 加权引用方以 `source: 'diff-context'` 交替前置（回放 `--diff-context` 传 P→C diff）。提交 `8e7c28f`（代码）+ `29c59a3`（文档）；CI 全绿：Test 6 作业 [38391386179](https://github.com/YongjianWan/workspace-bridge/actions/runs/38391386179) 与慢层 2 作业 [38391386190](https://github.com/YongjianWan/workspace-bridge/actions/runs/38391386190) 均 success。J1 留出终态实测（`J1-holdout-diffctx-v4` 对 `J1-holdout-v1`，v2/v4 确定性一致）：Java→Java +2.2pp（0.6325→0.6545）、Java→XML +9.8pp（→0.4931）、XML→Java +2.4pp（→0.4764）、全部 +3.2pp（→0.6099）。关键规则"近唯一指针"（diffRefs≥0.5）与"diff 行限占槽位"（先到先得交替，v3 全优先实测 -0.7pp 回滚）；AST 调用边层（v3）评估后放弃，理由与证据见 CHANGELOG。实施方自测：快层 280/280、完整 runner 385/385（报告 `test/.reports/run-2026-10-13T10-53-59-112Z.json`）、lint、eval 23 PASS/0 FAIL。独立验收仍按下列命令重跑：`node test/impact-diff-context-test.js`、`node test/replay-impact-test.js`、`npm run lint`、`npm test`、`node eval/run.js && node eval/score.js`、`node eval/replay-impact.js --target J1 --name <新名> --holdout 0 --max-commits 20 --diff-context` 后比对 `eval/truth/compare-recall.js`（Java→Java 应 ≥0.63、Java→XML ≥0.45）。重启线仍未满足（Java→Java 0.6545<70%，对笨基线 +13.7pp<15pp）。
- 评审修复批次（评测口径解耦、方向词表单点、超深 gitignore 目录不再误报，提交见 git log）：Windows / Node 25.6.0 完整 runner 382/382、0 失败、退出码 0（报告 `test/.reports/run-2026-10-11T12-04-11-099Z.json`）；lint 退出码 0；`node eval/run.js` 与 `node eval/score.js` 23 PASS / 0 FAIL。实施方自测，2026-10-13 由 Vivian（Kimi 会话）独立验收通过：验收命令全列重跑（见「下一步」原第 3 条），`npm test` 384/384、退出码 0（报告 `test/.reports/run-2026-10-13T08-21-50-864Z.json`；首轮有 8 项高负载偶发失败，单独重跑全过、复跑全绿，不作为回归）。
- 当前验证源码：`75253fe`（2026-10-11）。Windows / Node 25.6.0：快层 279/279、完整 runner 382/382、0 失败、退出码 0；九项专项与 lint 退出码 0。完整报告 `test/.reports/run-2026-10-11T05-19-22-405Z.json`；全部测试记录 `ok=true`、`status=0`，无 error 或 signal。
- 源码 CI：[Test 38116087949](https://github.com/YongjianWan/workspace-bridge/actions/runs/38116087949) 的 7 作业与 [慢层 38116087948](https://github.com/YongjianWan/workspace-bridge/actions/runs/38116087948) 的 2 作业均 success；Test 的失败作业原样重跑后通过。平台结果分别记录，不外推为其他环境全量验收。
- T1.4 独立回放：J1 holdout 20、88 提交 / 458 输入；F1 holdout 20、144 / 848；P1 holdout 0、75 / 325。三个产物均来自 clean `75253fe`，0 错误、逐条输出 ≤15、中位 15；原真值与 619 份源码、12 份原基线指纹无漂移。J1/F1 与实施稳定结果一致，P1 为原完整范围的有效结果。汇总见本机 gitignored `eval/truth/t14-independent-final.json`，三个 final 目录与指标见 ROADMAP 第 6 节。
- 最终源码的 `node eval/run.js` 与 `node eval/score.js` 已顺序完整重跑，退出码均 0；新 scoreboard 实际 23 PASS、0 FAIL。计分脚本退出 0 本身不代表门禁通过，须检查 verdict。
- 缓存契约：CACHE_SCHEMA_REVISION=55（CACHE_VERSION 另含引擎源码指纹），schemaVersion=1.2.0；parse_results 只存纯解析输出。索引不完整时 `discoveryComplete=false`、`coverageRatio=null`，消费者必须保留 warnings 与 degraded 状态，不按 100% 覆盖解读。
- 其他平台的最近核验（各自独立，不外推）：WSL Ubuntu 24.04/ext4、Node 22.13.0（2026-10-04）全量 321/321、约 269 秒；Docker（node:22、Linux 容器）全量 327/327、约 176 秒；`main` 合并门禁 9 个必需检查，管理员可绕过。慢测默认并发 2。
- affected-tests 真值基线 TP 3045、FP 2512、FN 29；评测方法见 eval/README.md，不能把冻结 probe 外推为全语料准确率。
- U-15/U-30 仍待深信服隔离、真实同步盘及域策略环境核验；无对应条件时保持冻结。深信服 aES 为公司管理，保持运行。其余冻结项与重启条件按 ROADMAP 第 9 节。
- Vivian（Kimi，验收会话）2026-10-13：只读独立验收已完成（结果见「下一步」第 3 条）；通道 1–6 离线探针评估完毕（便宜通道关门，增益不过留出样本）；通道 9 按项目所有者"都干"指示已完成实施（diff 上下文 + AST 函数层，见上方 diff 上下文行；v3 回放验证进行中），产品实施中的探针与证据在 `eval/truth/phase4-diff-probe.js` 与 `J1-holdout-diffctx-*`。

## 下一步

0. 本地工作流（2026-10-13 项目所有者决定）：**本地不再跑全量慢层**，日常迭代只跑 `npm run test:fast`（约 90 秒）+ 被改动波及的专项慢测；全量慢层交给 GitHub（main 推送 + 每日定时，`.github/workflows/test-slow.yml`）。例外不变：改 AGENTS 高危文件仍按规则 2 先跑 impact/affected-tests，且提交前须确认快层与相关专项绿。慢层提速（削进程税/重测试工作量）保持 P4 冻结，重启条件仍按 TECH_DEBT。
1. **过线任务状态（2026-10-14）：算法通道全部关闭，优化转向产品侧**。召回缺口只剩 Java→Java 0.6545<0.70（+15pp 条件已满足 15.1pp）；回放可裁决通道（1–6、9、A1、B1 五变体、A3）终审全部 ≤ 产品现状，候选池 92.8% 含真值、oracle 0.9642，静态+diff+任务模板信号已榨干。项目所有者指示"不以过线为满足、继续优化"：A4 全工作区 diff 条件化已落地（`446d039`，六语言夹具、快层 280/280）。剩余归项目所有者的决策：①是否接受 0.6545 为过线任务的终审结论；②C1 给证据不排序（改输出契约）；③是否直接走 T2.2 真人真用对照验证工具增量价值。文档：SESSION「当前交接」终审行 + 前沿方法表；产物 `eval/truth/phase6-*`（本机）。
2. H-34：项目所有者已于 2026-10-12 选择保留语义修复并接受实体→VO/DTO 少找 2 个文件的代价（42.45%→38.54%）；旧召回门禁仍未通过。语义与通用回归 2026-10-13 由 Vivian（Kimi 会话）独立验收通过（命令与结果同上一条，`npm test` 384/384 绿）。H-35 已登记，未开工。
3. 独立验收已完成（2026-10-13，Vivian / Kimi 会话）：`node test/replay-impact-test.js`、`node test/index-depth-config-test.js`、`npm run lint`、`node eval/run.js && node eval/score.js`（23 PASS / 0 FAIL）、`npm test`（384/384，首轮 8 项高负载偶发失败单独重跑全过、第二轮全绿）全部通过；`node cli.js audit-overview --cwd . --json --quiet` 的 `analysisCoverage.discoveryComplete` 为 true（637/637）。

## 未试信息通道（2026-10-13 Vivian 整理，按成本从低到高）

背景：ROADMAP 第 6 节诊断证明 8 种图结构特征排序封顶 0.60；`eval/truth/phase2-ident-probe.js` 两轮探针证明内容特征（共享字符串/表名/类名）有真实增量（Java→Java 0.6308、打分融合 XML→Java 0.6824、实体→VO/DTO 0.6435），但便宜组合在 Java→Java 封顶 0.62–0.63，距 70% 线差 7pp；通道 6 留出终审证明这些增益不过留出样本。下表 1–12 是第一轮评估，9 已实施；「前沿方法」是第二轮整理。

| # | 通道 | 干什么 | 成本 | 预期增益 | 状态 |
|---|---|---|---|---|---|
| 1 | 共享标识符/字符串 | 抽字符串字面量、SQL 表名、类名引用按重叠排序 | 半天 | 已测：Java→Java +4.5pp | ✅ 探完 |
| 2 | 组合打分/多路交替 | 标识符+历史+图合并排序 | 半天 | 已测：Java→Java 封顶 0.63 | ✅ 探完 |
| 3 | 提交信息/任务号关联 | 同 issue 号、同提交说明主题共改加权 | 0.5–1 天 | 已测：J1 仅 0.8% 提交含可抽任务号，纯排序 0.5290 | ❌ J1 上判死（换仓库或可复活） |
| 4 | 时间近因加权共改 | 共改按时间衰减（半衰期 90 天）替代次数 | 0.5–1 天 | 已测：+标识符 Java→Java 0.6486、XML→Java 0.6915 | ✅ 有效 |
| 5 | Hunk 级共改 | 同提交内输入与候选增删行共享标识符才计分 | 1–2 天 | 已测：+标识符 Java→Java 0.6530（全部策略最高） | ✅ 有效 |
| 6 | 留出提交终审 | 20 个留出提交上验证 1/2/4/5（回放已产出 J1-holdout-v1：110 输入、0 错误） | 1–2 天 | 已测：Java→Java 全部探针策略 0.615–0.621，**全部低于当前产品 0.6325**；笨基线 0.5034（+12.9pp，未到 15pp）；重启线两条都不满足 | ✅ 探完：便宜通道关门（增益不过样本） |
| 7 | 交互式第二文件 hint | `impact` 接受已知改动文件做交集排序 | 1–2 天（动产品） | 中-大，改用法不改口径 | ⬜ 产品决策 |
| 8 | 时间切分训练排序器 | 靠前提交训练、靠后提交评测，终审静态信号有无 | 2–4 天 | 通道 6 已证明样本内选策略会过拟合；训练器是免疫此问题的唯一便宜路线，但上限预期低 | ⬜ 可选诊断 |
| 9 | diff/符号级影响 | 真实 diff 喂工具，追被改方法/字段的引用方 | 3–5 天（动工具层+回放） | **已实施**（2026-10-13）：标识符行（近唯一指针规则）→ AST 调用边行（导出函数粒度）→ 图+历史三层合并；J1 留出 v2 实测 Java→Java +2.2pp、Java→XML +9.8pp、XML→Java +2.4pp；v3（优先级修复后）结果待填 | ✅ 已实施，v3 验证中 |
| 10 | 语义嵌入 | embed 文件内容按向量相似排序 | 2–3 天 + 模型依赖 | 未知，回放不再确定 | ⬜ 通道 1 的贵替，优先级低 |
| 11 | 运行时覆盖 | 测试覆盖给边加权 | 1 周+，需运行时环境 | 大 | ❄️ P4 写明条件不满足 |
| 12 | 跨仓库前后端边 | 前端调用→Controller 接入 impact | 2–3 天 | 只对"漏了后端" | ❄️ 阶段 2 冻结，T2.1 触发 |

### 前沿方法（2026-10-13 二轮整理，项目所有者要求"不设限"后）

总判断：不读任务意图的方法（图/历史/内容/diff）已接近天花板——同一输入改不同功能时一起改的文件不同，区分信息不在代码里，在任务痕迹里。剩余 frontier 分三类：

| # | 方法 | 机制 | 成本 | 预期 |
|---|---|---|---|---|
| A1 | 整提交类比检索 | 历史提交表示为"改动文件集+符号"向量；当前 diff 检索最相似历史提交，推荐其伴随文件（任务模板信号，区别于成对共改） | 1–2 天探针 | 已测（`phase5-analog-probe.js`，J1 留出）：类比纯排序 0.43/0.29/0.22 全面低于产品 0.6545/0.4931/0.4764，与产品交替只会拖累（0.6021）——历史共改机器已榨干任务模板信号，本操作化无增量 | ❌ 探完关门 |
| A2 | 跨仓库时间关联 | J1/F1 同任务两仓各一提交，时间邻近+说明相似关联 | 0.5–1 天探针 | 解"漏了后端/前端"，数据现成 |
| A3 | 提交说明语义检索 | embed 中文提交说明，按相似任务找历史提交（通道 3 的结构化任务号已死，语义不需要结构化） | 1 天探针 | 已测（`phase6-a3-probe.js`，字符二元组 TF-IDF + 说明点名特征，J1 留出）：0.6393 低于产品 0.6545，模板信号不迁移 | ❌ 探完关门 |
| A4 | 全工作区 diff 条件化 | diff-context 从"输入文件的 diff"扩到"整个工作区脏文件集合"（机制已建好，扩展读取范围） | 0.5 天 | **已实施**（2026-10-14，`446d039`）：工作区查询读全量 `git diff HEAD`，单脏文件行为不变，六语言跨文件夹具锁定；回放显式 diffText 路径不受影响，留出数字不变 | ✅ 已实施 |
| B1 | 学习排序（LightGBM/LambdaRank） | 全部特征 + 时间切分训练，留出窗口前训练、留出上评测 | 2–4 天 | 已测（`phase6-ranker*.js`，自包含 pairwise/pointwise LR + 交互项，88 提交训练 / 20 留出）：0.6532 / 0.6393 / 0.6332，全部 ≤ 产品 0.6545；候选池 92.8% 含真值、oracle 0.9642，静态特征组合无剩余可学信号 | ❌ 探完关门 |
| C1 | 给证据不排序 | impact 输出候选池+每候选证据，`--max-files` 放宽，排序交给读它的 agent | 0.5 天 | 产品正解候选，工具定位本来就是 AI 脚手架 |
| C2 | 在线学习 | T2.1 日志的"帮上了/漏了"标记做反馈排序 | 依赖日志 | 长期 |

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

读取完整警告与覆盖率，再对目标文件运行 impact 和 affected-tests；收工验证按 AGENTS.md 执行。
