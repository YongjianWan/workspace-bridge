# SESSION.md

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- 外部审查的自动复现门禁：`node test/wb-repro.js cli.js` 应为 27/27 OK、退出码 0。它不覆盖全部人工发现；待处理项见 [审查报告](./docs/workspace-bridge-审查报告.md)。
- 缓存版本 52；文件角色分类变更后旧缓存自动重建。`audit-overview` 当前实测 `analysisCoverage.coverageRatio` 1、`fallbackFiles` 0、`schemaVersion` 1.2.0。
- Django @a013c821ea 的 v51 参考测量（2026-09-28，固定 checkout、冷/暖各一次）：缓存 DB 189.6MB，其中 `precomputed_impact` 6.6MB；冷启动 61.8s、暖启动 11.5s，Node 进程内 RSS 峰值分别为 1379MB、548MB。v52 仅改文件角色并使缓存重建，尚未复测 Django 性能；`test_map` 约 45MB，暂不为压数字增加复杂度。
- 测试回归基线：`npm run test:fast` 205 选 203 过，全量 `node test/runner.js` 305 选 302 过（2026-09-28 独立临时缓存目录实测）。已知两条 `wave15-ast-rules-test.js` / `wave15-neighbor-aware-test.js` 因 Windows/libuv 异常退出（3221226505）；`workspace-info-lightweight-test.js` 在全量负载下耗时 2222ms，超过 2000ms 预算，暖缓存单跑两次均过。本机默认缓存库经 `PRAGMA quick_check` 确认损坏；回归使用独立缓存目录。出现其他失败必须查根因。
- 运行要求 Node `>=22.13.0`（engines，P1-4）；更低版本 `node:sqlite` 不存在，GraphDB 打一次性 stderr 警告后每次冷启动。
- 评测集（`eval/`）现有 8 仓带真值分数，基线 `eval/baseline.json` 于 2026-09-27 重生成（score.js 全 PASS 后取自 scoreboard）。分数含义与解读规则见 [eval/README.md](./eval/README.md)。当前 typer affected-tests P 0.6019 / R 0.9847；27 条 dead-exports 真值 0 条 high；cJSON 死代码 14 条发现全是已标注误报且全为 low（精确率 0 是口径所致，见 baseline note）。

## 下一步

1. 审查报告 P1 已清零；下一项复现并处理 P2-6：`guard` 未通过与运行出错都返回退出码 1，CI 难以区分。其余 P2 逐条复现处理；完成项从活跃清单删除，经过写入 CHANGELOG。
2. eval 扩充的候选：给 hexyl/vitesse 补更多测试文件样本（当前 n 只有个位数，不下结论）；okhttp 的 247 个真实 dropped 逐类归因（多是 workspace 内部模块引用未解析）。
3. 符号级映射暂不立项（2026-09-27 定）：affected-tests 多报只是多跑测试，漏报才会让 agent 放过回归；召回率 0.98 已够用。重新考虑的条件：某个评测仓精确率低到让 agent 实际跑不完推荐测试（如 cobra 0.40 的样本扩大后仍偏低）。

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

只需确认当前输出，再针对要改的文件运行 `impact` 和 `affected-tests`。收工验证按 [AGENTS.md](./AGENTS.md) 执行。
