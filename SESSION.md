# SESSION.md

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- 外部审查的自动复现门禁：`node test/wb-repro.js cli.js` 应为 27/27 OK、退出码 0。它不覆盖全部人工发现；待处理项见 [审查报告](./docs/workspace-bridge-审查报告.md)。
- 缓存版本 50（v50=P1-6 precomputed_impact 改 v2g 路径压缩编码——行内字典索引+剥根前缀+gzip，存 affected_tests 列；v49=P1-13 无插值模板字符串的动态导入/require 按普通字符串提取；v48=P1-12 C/C++ 源文件只导出外部链接函数、配对头的源文件不判孤儿）；`audit-summary`（不是 audit-overview）应显示 `analysisCoverage.coverageRatio` 1、`fallbackFiles` 0、`schemaVersion` 1.2.0，2026-09-28 实测符合。若实际输出变化，以新命令结果为准并更新 [AGENTS.md](./AGENTS.md)。
- Django @a013c821ea 性能基线（2026-09-28 本机实测，P1-6/7 修复后）：缓存 DB 214MB（precomputed_impact 27.9MB），冷启动 ~69s / 峰值 ~840MB，暖启动 ~14s / 峰值 ~640MB。冷启动 CPU 大头曾是 normalizePathKey（~45%，已加 LRU 备忘）；test_map 20.8 万行 / 45MB 是现缓存最大表，再压收益递减，留作后续候选。
- 测试回归基线：`npm run test:fast` 202 选 200 过，全量 `node test/runner.js` 302 选 299 过（2026-09-28 更新；302=301+`p1-6-impact-codec-test`）。已知红：`wave15-ast-rules-test.js` / `wave15-neighbor-aware-test.js` 两条 Windows/libuv 异常退出（3221226505，后者偶发、单跑稳过）；`workspace-info-lightweight-test.js` 的 2000ms wall-clock 预算偶发超限——runner 满负载或 CACHE_VERSION 刚 bump 的冷缓存重建都会触发（2026-09-27 归因：`eval/truth` 语料克隆使 `workspace-info --cwd .` 轻量扫描膨胀到 4881 文件、暖缓存单跑 ~1.7s 贴着预算，非代码回归；单跑稳定通过）。出现其他失败必须查根因。
- 运行要求 Node `>=22.13.0`（engines，P1-4）；更低版本 `node:sqlite` 不存在，GraphDB 打一次性 stderr 警告后每次冷启动。
- 评测集（`eval/`）现有 8 仓带真值分数，基线 `eval/baseline.json` 于 2026-09-27 重生成（score.js 全 PASS 后取自 scoreboard）。分数含义与解读规则见 [eval/README.md](./eval/README.md)。当前 typer affected-tests P 0.6019 / R 0.9847；27 条 dead-exports 真值 0 条 high；cJSON 死代码 14 条发现全是已标注误报且全为 low（精确率 0 是口径所致，见 baseline note）。

## 下一步

1. 审查报告 P1 已清零；剩余开放项为 P2 工程卫生十条（退出码语义、audit-diff 分类、相对路径解析等），按第 4 节逐条复现处理。完成一项从活跃清单删除，修复经过写入 CHANGELOG。
2. eval 扩充的候选：给 hexyl/vitesse 补更多测试文件样本（当前 n 只有个位数，不下结论）；okhttp 的 247 个真实 dropped 逐类归因（多是 workspace 内部模块引用未解析）。
3. 符号级映射暂不立项（2026-09-27 定）：affected-tests 多报只是多跑测试，漏报才会让 agent 放过回归；召回率 0.98 已够用。重新考虑的条件：某个评测仓精确率低到让 agent 实际跑不完推荐测试（如 cobra 0.40 的样本扩大后仍偏低）。

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

只需确认当前输出，再针对要改的文件运行 `impact` 和 `affected-tests`。收工验证按 [AGENTS.md](./AGENTS.md) 执行。