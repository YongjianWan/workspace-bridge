# 两周收敛计划：8/10 → 9/10

> 状态：执行中
> 起始日期：2026-04-28
> 目标：提升结论可信度、命令可执行性、自审稳定性

---

## 总目标

1. **提升基础可信度（优先）**：修复文件分类、临时文件过滤、自定义测试识别，消除 audit-diff 噪音。
2. 提升多语言结论可信度：减少误报，特别是 Java 符号级误报。
3. 提升命令可执行性：生成的验证命令开箱即用。
4. 提升自审稳定性：CLI 的 JSON 输出与消费链路在 Windows 中文路径下稳定。

---

## Phase 0：基础止血（前置，1-2 天）

### P0T1: 临时文件与缓存过滤

- **说明**：`audit-diff` 将 `.tmp-*`、`.workspace-bridge-cache.json.tmp-*` 纳入 changed files，导致 severity 虚高。
- **代码落点**：`src/cli/audit-diff.js`（或 diff 收集逻辑）
- **验收**：`git status` 中存在临时文件时，`audit-diff` 的 `changedFiles` 不应包含它们。

### P0T2: 文件角色分类修正

- **说明**：`AGENTS.md`/`README.md` 不应被分类为 `library`；`cli.js` 不应同时出现在 `entryPoints` 和 `orphans` 中。
- **代码落点**：文件角色启发式规则
- **验收**：`audit-overview` 的 `orphans.modules` 不含 `cli.js`；`audit-diff` 中文档改动输出 `changeType: docs`。

### P0T3: Node 自定义测试脚本识别

- **说明**：`package.json` 中存在 `test:all`、`test:security` 等自定义脚本，但 `health.testConfig` 和 `stack.testRunner` 均报告为空。
- **代码落点**：`src/utils/stack-detector.js`
- **验收**：有 `test:*` 脚本的 Node 项目，`audit-summary` 的 `testConfig.found` 为 `true`；`audit-diff` 的 `commands.focused` 能生成具体子集命令。

---

## 第 1 周：先修可信度和命令正确性

### W1T1: 修复 Java dead-export 误报策略

- **说明**：Java AST 仍保留方法/字段提取，但 dead-export 在 Java 上先降级为保守策略，不做当前不可靠的方法级判定。
- **代码落点**：`src/services/dep-graph.js` `findDeadExports()`
- **验收**：最小复现中，实例调用的方法不再被判 dead export。

### W1T2: 修复 Gradle Checkstyle 命令生成

- **说明**：按构建工具分支生成命令，避免 Maven/Gradle 命令语义混用。
- **代码落点**：`src/utils/stack-detector.js` `getJavaCommands()`
- **验收**：Gradle 项目下 smoke 命令可直接执行，不出现任务不存在错误。

### W1T3: 补两条回归测试

- **说明**：一条锁死 Java dead-export 误报场景，一条锁死 Gradle Checkstyle 命令格式。
- **代码落点**：`test/java-dead-export-conservative-test.js`、`test/gradle-checkstyle-command-test.js`
- **验收**：两条测试在本地和 CI 都稳定通过。

### W1T4: 文档诚实化同步

- **说明**：把语言支持矩阵和版本说明与当前实现完全对齐。
- **验收**：变更说明与测试结果一一对应。

---

## 第 2 周：做自审可用性和工程收口

### W2T1: 建立一套官方自审脚本入口

- **说明**：提供一键脚本跑 summary、diff、关键回归，并输出精简结论。自审脚本本身应覆盖 Phase 0 的临时文件检查。
- **代码落点**：`scripts/self-audit.js`
- **验收**：团队成员执行一次命令即可得到可读风险摘要与下一步命令；脚本运行前自动检测并报告临时文件污染。

### W2T2: 收口命令建议质量

- **说明**：继续检查 Go/Rust/Java 命令建议是否与实际工程工具链匹配；同时验证 Node 自定义测试命令生成。
- **验收**：重点样例仓库中，建议命令成功率达到可接受阈值；Node 项目 diff 场景下 `commands.focused` 不为空。

### W2T3: 修复 JSON 消费链路稳定性问题

- **说明**：统一 JSON 输出消费方式，避免 PowerShell 管道二次处理导致误判为 JSON 损坏。此任务延后到输入数据干净后再做，避免稳定地传输噪音。
- **验收**：在 Windows 中文路径环境下，audit-summary 与 audit-diff 都可稳定被脚本解析。

### W2T4: 发布前总回归

- **说明**：跑核心套件与新增回归（含 P0T1-P0T3 的回归测试），确认没有引入新的误报回潮。
- **验收**：关键测试全绿，且无新增高优先级审查结论。

---

## 升级标准（9/10 门槛）

1. Java dead-export 已无已知高频误报复现。
2. Gradle Checkstyle 命令建议可直接执行。
3. 自审 JSON 在 Windows 中文路径环境可稳定解析。
4. 文档、实现、测试三者一致。
5. 关键回归套件稳定通过。
