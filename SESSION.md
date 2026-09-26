# SESSION.md

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- 外部审查的自动复现门禁：`node test/wb-repro.js cli.js` 应为 24/24 OK、退出码 0。它不覆盖全部人工发现；待处理项见 [审查报告](./docs/workspace-bridge-审查报告.md)。
- 缓存版本 43；`audit-overview` 应显示覆盖率 1、fallback 0、schema 1.2.0。若实际输出变化，以新命令结果为准并更新 [AGENTS.md](./AGENTS.md)。
- 测试回归基线：`npm run test:fast` 196 选 194 过，全量 `node test/runner.js` 291 选 289 过；仅 `wave15-ast-rules-test.js` / `wave15-neighbor-aware-test.js` 两条 Windows/libuv 异常退出（3221226505）。出现其他失败必须查根因。

## 下一步

1. 用 [eval/README.md](./eval/README.md) 的固定仓库与真值重新评测 affected-tests、dead-exports 和缓存性能；记录新分数，再决定未解决的 P0/P1 修复顺序。
2. 处理审查报告中仍开放的误报与测试映射问题。完成一项就从活跃清单删除，并将修复经过写入 CHANGELOG。

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

只需确认当前输出，再针对要改的文件运行 `impact` 和 `affected-tests`。收工验证按 [AGENTS.md](./AGENTS.md) 执行。