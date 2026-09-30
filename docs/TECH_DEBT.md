# 当前技术债

这里只列仍需处理或明确冻结的债务。修复经过和已关闭条目见 [CHANGELOG.md](../CHANGELOG.md)；外部审查仍开放的问题见 [审查待处理项](./workspace-bridge-审查报告.md)。

## L3：改动时顺手处理

| ID | 当前问题 | 下一步与验收 |
|---|---|---|
| L3-8 | 内部契约被 `?.()`、空对象/空数组兜底吞掉，调用方可能收到静默错误。 | 触碰相关调用点时判断是否属于真实可恢复边界；内部契约错误直接暴露，并以语义测试验证。 |
| L3-12 | 测试 runner 的部分 fast/slow 分层靠源码启发式猜测，层级与实际耗时可能不符。 | 继续用 run report 的实测耗时检查猜测层；只在明确收益时改标记。 |
| L3-13 | 全量慢测耗时高（本机 301 项约 29 分钟，慢测并发 2），仍缺对整体 CPU、I/O 和并发瓶颈的归因；`cli-integration-core` 等四项在并发 4 下单项 130–172 秒，贴着 180 秒上限。 | 用完整 runner 与 CPU profile 定位成本，再决定是否调度、缓存或拆分；不可把减少测试选择误写成全量提速。 |
| L3-16 | 暖启动里仍有两处对已被 `FileIndex` 读过的文件重复 stat：`cache.js` `resolveCachedFilePath()` 对约 2977 个缓存文件各 stat 一次（Django 固定提交，全命中）；`entry-detector.js` `readScanContent()` 对 406 个文件各 stat 一次只为取大小（元数据里已有）。均未量化真实耗时。 | 先在固定 Django 提交上量各自耗时；`readScanContent` 可改读元数据 size；`resolveCachedFilePath` 的 stat 承担路径漂移兼容，改前须保住 Windows/WSL 旧 cache key 语义。 |
| L3-17 | Django 固定提交暖启动约 11–12 秒（分段计时，含采样开销，各段有重叠）：`FileIndex.build` 约 5.4 秒，其中逐文件校验只占 0.9 秒，其余约 4 秒是文件发现与过滤，尚未归因；`Builder.build` 约 6.3 秒，其中 `precomputeAggregates` 2.6 秒（`findDeadExports` 2.4 秒）；子进程：`git rev-parse HEAD` 执行两次共 1.1 秒、`git check-ignore --stdin` 0.7 秒、`python -c` 取标准库名 0.36 秒。Python 候选路径存在性探测已验证不是瓶颈（stat 次数减半、墙钟不变）。 | 先对 `FileIndex.build` 的文件发现阶段做逐步计时并归因；`git rev-parse HEAD` 在一次进程内取一次即可复用；`findDeadExports` 是否可在不需要死导出的命令里延后计算，须先看 `audit-overview` 输出是否依赖它。每步用固定 Django 提交冷/暖复测，输出计数须一致。 |

## P4：冻结，出现真实用例再处理

- C/C++ include resolver 对同名目录和仓外路径的命中边界仍需验证。
- Svelte 的 `<script>` 标签抽取及模板语义存在静态解析边界。
- Next.js 文件系统路由提取尚未建立可靠的结构映射。

## 外部审查待办

[审查待处理项](./workspace-bridge-审查报告.md) 保留 P0/P1/P2 开放问题、复现步骤和固定仓库版本。完成一项后从活跃清单移除，将原因、改动与验收写入 CHANGELOG。
