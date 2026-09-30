# SESSION.md

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- 外部审查自动复现门禁：`node test/wb-repro.js cli.js` 27/27 OK、退出码 0。
- 回归基线（2026-09-30，本机 18 线程、Node 25.6.0）：`npm run test:fast` 199/199；全量 `node test/runner.js` 302/302、退出码 0，本次约 17 分钟（前次同并发 29 分钟，随机器负载波动）（快测 199、慢测 94、串行 5、watch 4）。慢测默认并发为 2：最重的四项在并发 4 下单项 130–172 秒，贴着每项 180 秒上限，新旧代码 A/B 相同，见 CHANGELOG `[Unreleased]`。出现 SIGTERM 先看是否用 `TEST_SLOW_CONCURRENCY` 调高了并发，再查代码。
- 缓存契约：`CACHE_VERSION=53`；SQLite 保留文件元数据、纯解析结果和 overview 快照，图边与逐文件影响每次根据当前文件集合在内存中重算。`graph:built` 的聚合预计算仍存在。新增文件与同 stat 内容修改的暖冷一致性测试通过。
- Django 固定提交 `a013c821ea`：Windows/Node 25.6.0、独立缓存单次冷/暖 `audit-overview` 56.5/19.8 秒，缓存 11.3 MB；覆盖率 1、fallback 3，冷暖输出计数一致。同机 v52 为 83.7/15.9 秒、缓存 198.4 MB，即暖启动慢约 4 秒；RSS 尚未测。去掉 `getStaleness()` 的重复内容哈希后（未提交），同机 Django 暖启动约少 2 秒；其余成本见 TECH_DEBT.md L3-15。
- typer affected-tests 基线现在用实时查询，固定提交上 v52/v53 同为 TP 3045、FP 2512、FN 29；评测方法见 eval/README.md。

## 下一步

1. 审查问题 R-3、R-4：复现 `gitignore.js` 子目录根判定与 submodule 路径的 `git check-ignore` 128 异常。
2. 审查问题 P1-14：扩充 `api-contracts` 对生成客户端代码的调用匹配模式；P2-6 的 `guard` 退出码区分随后处理。
3. Django 暖启动（19.8 秒）优化：做 TECH_DEBT.md L3-15 的 resolver 存在性探测（重复哈希已去除）；每步用固定 Django 提交的冷/暖 `audit-overview` 复测，冷暖输出计数必须一致。

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

只需确认当前输出，再针对要改的文件运行 `impact` 和 `affected-tests`。收工验证按 [AGENTS.md](./AGENTS.md) 执行。
