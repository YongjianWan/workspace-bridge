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

> 状态：🔴 未开始。44b1780 未涉及，需单独排期。

### P0T1: 临时文件与缓存过滤（CLI 层面）

- **说明**：`.gitignore` 已更新（44b1780），但 `audit-diff` 代码层面仍将 `.tmp-*`、`.workspace-bridge-cache.json.tmp-*` 纳入 `changedFiles`。
- **代码落点**：`cli.js` `audit-diff` 的 changed files 收集逻辑（`getChangedFiles` 结果过滤或 `runCommand` 中 `safeEntries` 过滤）
- **改动量**：~5 行
- **验收**：存在 `.tmp-audit-summary.json` 时，`audit-diff` 的 `changedFiles` 不包含它。

### P0T2: 文件角色分类修正

- **说明**：`AGENTS.md`/`README.md` 被分类为 `library`；`cli.js` 同时出现在 `entryPoints` 和 `orphans` 中。
- **代码落点**：`src/utils/project-context.js` `classifyFile()` 增加文档/配置白名单；`src/tools/overview-tools.js` 孤儿检测排除 `entryFiles`
- **改动量**：~20 行
- **验收**：`audit-overview` 的 `orphans.modules` 不含 `cli.js`；`audit-diff` 中文档改动输出 `fileRole: docs, changeType: docs`。

### P0T3: Node 自定义测试脚本识别

- **说明**：`package.json` 中存在 `test:all`、`test:security` 等自定义脚本，但 `health.testConfig` 和 `stack.testRunner` 均报告为空。
- **代码落点**：`src/utils/stack-detector.js` `detectTestRunner()` 增加 `package.json` `scripts` 字段扫描（检测 `test` / `test:*` 前缀）
- **改动量**：~20 行
- **验收**：`audit-summary` 输出 `testConfig.found: true, frameworks: ["custom-node-scripts"]`；`audit-diff` 的 `commands.focused` 不为空。

### P0T4: 变更类型判断修正

- **说明**：文档/配置改动被输出为 `changeType: code`，验证模板错配。
- **代码落点**：`src/cli/audit-formatters.js` `buildValidationAdvice()` 增加 changeType 分支：当全部 changed files 的 `fileRole` 为 `docs/config` 时，`changeType = docs/config`
- **改动量**：~15 行
- **验收**：只改 `README.md` + `ROADMAP.md` 时，`audit-diff` 输出 `changeType: docs`。

### P0T5: Diff 场景 test mapping 激活（内部函数改动追踪）

- **说明**：改内部辅助函数（如 `readGoMod`）时，`changedFunctionImpact.mode = "no-exported-function-change"`，`affectedTests` 为 0。
- **代码落点**：`src/services/dep-graph.js` `getChangedFunctionImpact()` 增加内部函数调用链追踪 — 找到调用该内部函数的导出函数，再映射 dependents
- **改动量**：~50 行
- **验收**：改 `resolvers.js` 中 `readGoMod`（内部函数）时，`affectedTests` 包含 `test/gors-resolver-test.js`。

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
- **完成证据**：44b1780 已入栈；`npm run self-audit` 通过。
- **遗留项**：脚本运行前**未自动检测临时文件污染**（验收标准中要求，但未实现）。移至 Phase 0 后续补齐。

### W2T2: 收口命令建议质量 — ✅ 完成

- **说明**：Go/Rust config 改动触发 build/check；Java focused 测试只在 `.java` 改动时触发；`splitTargetsByStack` 纳入 `go.mod` 和 `Cargo.toml`。
- **代码落点**：`src/utils/stack-detector.js`
- **完成证据**：44b1780 + `test/w2t3-command-quality-test.js` 全绿。
- **遗留项**：Node 自定义测试命令生成仍未实现（`commands.focused` 为空）。移至 P0T3。

### W2T3: 修复 JSON 消费链路稳定性问题 — ✅ 完成

- **说明**：统一 JSON 输出消费方式，避免 PowerShell 管道二次处理导致误判为 JSON 损坏。
- **完成证据**：`scripts/self-audit.js` 使用 `spawnSync` 安全消费 CLI JSON，绕过 PowerShell 管道问题。

### W2T4: 发布前总回归 — ✅ 完成

- **说明**：跑核心套件与新增回归，确认没有引入新的误报回潮。
- **完成证据**：`npm run test:all` 17 项全绿。
- **注意**：Phase 0 基础止血未做，不满足"发布"标准，仅满足"当前提交无回归"。

---

## 第 3 周：Phase 0 基础止血（新增）

> 状态：🔴 未开始
> 目标：把 44b1780 未覆盖的 5 个止血点逐个闭环，每个 < 1 天。

| 任务 | 代码落点 | 改动量 | 验收命令 |
|------|----------|--------|----------|
| P0T1 临时文件过滤 | `cli.js` audit-diff 收集逻辑 | ~5 行 | `node cli.js audit-diff --cwd . --json --quiet` → changedFiles 不含 `.tmp-*` |
| P0T2 文件角色修正 | `project-context.js` + `overview-tools.js` | ~20 行 | `node cli.js audit-overview --cwd . --json --quiet` → `orphans.modules` 不含 `cli.js` |
| P0T3 自定义测试识别 | `stack-detector.js` `detectTestRunner()` | ~20 行 | `node cli.js audit-summary --cwd . --json --quiet` → `testConfig.found: true` |
| P0T4 变更类型修正 | `audit-formatters.js` `buildValidationAdvice()` | ~15 行 | 只改 `README.md` 后 `audit-diff` → `changeType: docs` |
| P0T5 内部函数→测试映射 | `dep-graph.js` `getChangedFunctionImpact()` | ~50 行 | 改 `resolvers.js` 内部函数后 `affectedTests` 包含 `gors-resolver-test.js` |

---

## 升级标准（9/10 门槛）

### v0.8.2 / 44b1780 已达成（8/10）
1. ✅ Java dead-export 已无已知高频误报复现。
2. ✅ Gradle Checkstyle 命令建议可直接执行。
3. ✅ 自审 JSON 在 Windows 中文路径环境可稳定解析。
4. ✅ 文档、实现、测试三者一致。
5. ✅ 关键回归套件稳定通过。

### 距 9/10 还缺（Phase 0 完成后才能发布）
6. 🔴 `audit-diff` 无临时文件噪音 — P0T1 完成后验收
7. 🔴 文件角色分类准确（文档不判为 library，entry 不判为 orphan）— P0T2 完成后验收
8. 🔴 自定义测试脚本被识别（`testConfig.found: true`）— P0T3 完成后验收
9. 🔴 文档改动输出 `changeType: docs` — P0T4 完成后验收
10. 🔴 内部函数改动能映射到测试 — P0T5 完成后验收
