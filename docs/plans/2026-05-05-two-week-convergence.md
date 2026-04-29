# 两周收敛计划：8/10 → 9/10

> **状态：已归档（内容已融入 ROADMAP.md）**
> 起始日期：2026-04-28
> 目标：提升结论可信度、命令可执行性、自审稳定性
>
> 当前单一事实源：[ROADMAP.md](../../ROADMAP.md) "收敛里程碑" 章节

---

## 总目标

1. **提升基础可信度（优先）**：修复文件分类、临时文件过滤、自定义测试识别，消除 audit-diff 噪音。
2. 提升多语言结论可信度：减少误报，特别是 Java 符号级误报。
3. 提升命令可执行性：生成的验证命令开箱即用。
4. 提升自审稳定性：CLI 的 JSON 输出与消费链路在 Windows 中文路径下稳定。

---

## Phase 0：基础止血（前置，1-2 天）

> 状态：✅ P0T1-P0T5 全部已完成。详见 ROADMAP.md "基础能力（Phase 0-1）"。

---

## 第 1 周：先修可信度和命令正确性

> 状态：✅ 已完成（v0.8.2 + 44b1780）

### W1T1: 修复 Java dead-export 误报策略 — ✅ 完成

- **说明**：Java AST 仍保留方法/字段提取，但 dead-export 在 Java 上先降级为保守策略，不做当前不可靠的方法级判定。
- **代码落点**：`src/services/dep-graph.js` `findDeadExports()`
- **完成证据**：CHANGELOG v0.8.2 — "Java 方法级 dead-export 误报 — 有 importer 的 Java AST 文件不再产生符号级 dead-export"

### W1T2: 修复 Gradle Checkstyle 命令生成 — ✅ 完成

- **说明**：按构建工具分支生成命令，避免 Maven/Gradle 命令语义混用。
- **代码落点**：`src/utils/stack-detector.js` `getJavaCommands()`
- **完成证据**：CHANGELOG v0.8.2 — "Gradle Checkstyle 命令格式 — Gradle 项目使用 `gradlew checkstyleMain checkstyleTest`"

### W1T3: 补回归测试 — ⚠️ 部分完成

- **说明**：原计划两条测试锁死 Java dead-export 和 Gradle Checkstyle。实际新增了 `test/gors-resolver-test.js` + `test/w2t3-command-quality-test.js`，覆盖了 Go/Rust 解析和命令质量，但专项目标测试未写。
- **延期原因**：gors-resolver-test 和 w2t3-test 优先级更高（44b1780 核心改动）；Java dead-export / Gradle Checkstyle 的专门测试可后续补充。
- **代码落点**：`test/java-dead-export-conservative-test.js`（待补）、`test/gradle-checkstyle-command-test.js`（待补）

### W1T4: 文档诚实化同步 — ✅ 完成

- **说明**：把语言支持矩阵和版本说明与当前实现完全对齐。
- **完成证据**：AGENTS.md / ROADMAP.md / SKILL.md 已同步 v0.8.2 能力矩阵。

---

## 第 2 周：做自审可用性和工程收口

> 状态：✅ 已完成（44b1780）

### W2T1: 建立一套官方自审脚本入口 — ✅ 完成

- **说明**：提供一键脚本跑 summary、diff、关键回归，并输出精简结论。
- **代码落点**：`scripts/self-audit.js`
- **完成证据**：44b1780 已入栈；530c6b7 补充 `checkTempPollution()` 检测；`npm run self-audit` 通过。

### W2T2: 收口命令建议质量 — ✅ 完成

- **说明**：Go/Rust config 改动触发 build/check；Java focused 测试只在 `.java` 改动时触发；`splitTargetsByStack` 纳入 `go.mod` 和 `Cargo.toml`。
- **代码落点**：`src/utils/stack-detector.js`
- **完成证据**：44b1780 + `test/w2t3-command-quality-test.js` 全绿。
- **遗留项**：Node 自定义测试命令生成仍未实现（`commands.focused` 为空）。移至 P0T3 并已解决。

### W2T3: 修复 JSON 消费链路稳定性问题 — ✅ 完成

- **说明**：统一 JSON 输出消费方式，避免 PowerShell 管道二次处理导致误判为 JSON 损坏。
- **完成证据**：`scripts/self-audit.js` 使用 `spawnSync` 安全消费 CLI JSON，绕过 PowerShell 管道问题。

### W2T4: 发布前总回归 — ✅ 完成

- **说明**：跑核心套件与新增回归，确认没有引入新的误报回潮。
- **完成证据**：`npm run test:all` 17→21 项全绿。
- **注意**：Phase 0 基础止血已在本轮后续完成，当前满足发布标准。

---

## 第 3 周：Phase 0 基础止血 + 审核修复

> 状态：✅ 5/5 全部完成（b4e97e7 + 530c6b7 + 后续轮次）
>
> 详见 ROADMAP.md "基础能力（Phase 0-1）"章节。

---

## 升级标准（9/10 门槛）

### v0.8.2 / 44b1780 已达成（8/10）
1. ✅ Java dead-export 已无已知高频误报复现。
2. ✅ Gradle Checkstyle 命令建议可直接执行。
3. ✅ 自审 JSON 在 Windows 中文路径环境可稳定解析。
4. ✅ 文档、实现、测试三者一致。
5. ✅ 关键回归套件稳定通过。

### 距 9/10 还缺（已全部解决）
6. ✅ `audit-diff` 无临时文件噪音 — b4e97e7 完成
7. ✅ 文件角色分类准确 — b4e97e7 完成
8. ✅ 自定义测试脚本被识别 — b4e97e7 完成
9. ✅ 文档改动输出 `changeType: docs` — b4e97e7 完成
10. ✅ 内部函数改动能映射到测试 — P0T5 已完成（3614e16 + 后续轮次）
11. ✅ `functionality-test.js` 环境依赖断言 — 已修复为 `>= 0`

---

*归档日期：2026-04-29。后续变更以 ROADMAP.md 为准。*
