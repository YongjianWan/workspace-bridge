# SESSION.md

当前工作只记录在这里；完成事项和旧会话经过见 [CHANGELOG.md](./CHANGELOG.md)。项目约束见 [AGENTS.md](./AGENTS.md)，活跃债务见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。

## 当前交接

- 外部审查自动复现门禁：`node test/wb-repro.js cli.js` 27/27 OK、退出码 0。
- 回归基线（2026-09-30，本机 18 线程、Node 25.6.0）：`npm run test:fast` 199/199；全量 `node test/runner.js` 304/304、退出码 0，本次约 17 分钟（前次同并发 29 分钟，随机器负载波动）（快测 200、慢测 95、串行 5、watch 4）。慢测默认并发为 2：最重的四项在并发 4 下单项 130–172 秒，贴着每项 180 秒上限，新旧代码 A/B 相同，见 CHANGELOG `[Unreleased]`。出现 SIGTERM 先看是否用 `TEST_SLOW_CONCURRENCY` 调高了并发，再查代码。
- 缓存契约：`CACHE_VERSION=53`；SQLite 保留文件元数据、纯解析结果和 overview 快照，图边与逐文件影响每次根据当前文件集合在内存中重算。`graph:built` 的聚合预计算仍存在。新增文件与同 stat 内容修改的暖冷一致性测试通过。
- Django 固定提交 `a013c821ea`：Windows/Node 25.6.0、独立缓存单次冷/暖 `audit-overview` 56.5/19.8 秒，缓存 11.3 MB；覆盖率 1、fallback 3，冷暖输出计数一致。同机 v52 为 83.7/15.9 秒、缓存 198.4 MB，即暖启动慢约 4 秒；RSS 尚未测。去掉 `getStaleness()` 的重复内容哈希后（未提交），同机 Django 暖启动约少 2 秒；再去掉 prune 重复探测、Python 清单链重复 stat、放大 resolver 存在性缓存后（均未提交），约 11–12 秒；其余成本见 TECH_DEBT.md L3-17。
- CI 状态（2026-10-02，`gh run list`）：`Test` 工作流最近 90 次成功 11 次、最后一次成功 2026-07-02；`Test (slow layer)` 最近 100 次成功 0 次。本机 304/304 只代表 Windows；WSL2 Ubuntu 上快测 199/200、慢测 93/95（见 TECH_DEBT.md H-18）。
- 未验证方向 U-n 已查 18 项（结果转入 S-6 至 S-10、H-8 至 H-21），仍开放 3 项：U-12（macOS、Docker overlayfs）、U-13（Node 22.13 慢测）、U-15（杀软对比），各自的前置条件写在 TECH_DEBT.md「U」一节。
- typer affected-tests 基线现在用实时查询，固定提交上 v52/v53 同为 TP 3045、FP 2512、FN 29；评测方法见 eval/README.md。

## 下一步

0. **先让 CI 变绿（H-18）**：修 `test/file-index-prune-probes-test.js` 第 30 行的 Lint 错误；`dead-export-regex-fallback-confidence-test.js` 的夹具不依赖路径大小写；`cochange-test.js` 用 `git init -b main`；查明 `audit-diff-test.js` 在 Linux 失败的原因。绿灯之后，后续每项修复才有门禁。
1. **P1 静默错误 S-1 到 S-10（见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)「P1」一节）最先处理**：先做 S-2（图按路径排序构建，一处改动同时解决输出顺序不稳与截断内容不稳），S-6（`safeToDelete` 误标，对 agent 危害最直接）可与 S-2 并行；再做 S-1（索引超时降级信号与总时限）、S-3（热点候选按排名取）、S-5（缓存写入失败与损坏自愈）、S-4（历史读取失败告警）。每项先写失败测试；S-2 的验收是同一仓库 5 次冷启动输出哈希一致，覆盖 9 种语言的 eval 仓库。
2. H-1（`--save` 目录限制）、H-8（`audit-security` 输出明文密钥）、H-11（仓库文本无不可信标注）随后处理；H-20（万级文件规模）在 S-2 之后做；H-2 到 H-7、H-9 到 H-22 与 V-1 按 TECH_DEBT.md 的「P2」一节排期。
3. 审查问题 R-3、R-4：复现 `gitignore.js` 子目录根判定与 submodule 路径的 `git check-ignore` 128 异常。
4. 审查问题 P1-14：扩充 `api-contracts` 对生成客户端代码的调用匹配模式；P2-6 的 `guard` 退出码区分随后处理。
5. Django 暖启动（约 11–12 秒）：先按 TECH_DEBT.md L3-17 归因 `FileIndex.build` 文件发现阶段的约 4 秒；重复哈希、重复 stat、resolver 存在性探测均已验证不是主因。

## 开工命令

```bash
node cli.js audit-overview --cwd . --json --quiet
```

只需确认当前输出，再针对要改的文件运行 `impact` 和 `affected-tests`。收工验证按 [AGENTS.md](./AGENTS.md) 执行。
