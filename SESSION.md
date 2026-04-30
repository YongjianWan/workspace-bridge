# 会话交接指令

> 生成时间：2026-04-30
> 当前版本：v0.9.0+
> 会话主题：从还债模式切换到产品化模式（audit-formatters 拆分 + mixed repo 精度 + skill 体系化）

---

## 1. 项目意义（为什么存在）

**workspace-bridge** 是 CLI-first 工作区分析引擎，给本地 AI coding agent 补"跨文件视角"和"变更验证建议"。

核心价值：
- **跨文件结构化分析** — 不是 another shell wrapper，客户端已有 Read/Grep/Bash，workspace-bridge 做这些工具做不到的聚合判断
- **变更影响范围 + 测试建议** — 改一个文件，知道波及谁、该测什么
- **Git 历史风险提示** — 高频改动文件自动标红
- **验证命令生成** — 根据技术栈和变更类型输出 smoke/focused/full 三阶段可执行命令

成功标准：
1. 对混合仓库结果稳定（不误报）
2. TS/Python/前端项目都能给出可信主线结论
3. 能从"哪里可能有问题"推进到"该怎么改、改完测什么"
4. symbol-level impact 可用
5. 大仓库性能可接受（<30s 索引）

---

## 2. 项目当前状态

### 已完成（本轮：产品化模式切换）

| 事项 | 状态 | 关键文件 | 说明 |
|------|------|----------|------|
| audit-formatters.js 拆分 | done | src/cli/formatters/ 7 文件 + index.js | 最后一块 P2 债务清零，927 行拆为职责分离 |
| CLI 命令完整性 | done | cli.js | stats/dependencies/dependents 独立暴露 |
| mixed repo 命令精度 | done | src/utils/stack-detector.js | getNodeCommands codeTargets 过滤，排除 json/cache 误入 focused tests |
| classifyChangeType 单一数据源 | done | src/cli/formatters/audit-diff-summary.js | fileRole 优先，扩展名仅 fallback，删除冗余文件名子串判断 |
| inferFileRole 补全 | done | src/utils/project-context.js | 新增 jest.config./prettier.config./requirements/pyproject/readme/sh/bash/ps1 |
| skill 体系化 | done | skills/workspace-audit/SKILL.md | 同步到用户级别 + role-quality 子 skill，description 加中文触发词 |
| role-quality 精简 | done | role-quality/SKILL.md | frontmatter 从 60 行缩到 8 行，触发词和 workspace-audit 分工 |

### 基线健康

- **32/32 测试全绿**
- **0 死导出、0 循环依赖、0 未解析导入**
- **健康度 5/5**
- **P0/P1 技术债清零**，P2 剩余 1 项（评分算法统一化为数据结构驱动，等新增第 6 种维度时再重构）

### 已知问题（基线，非阻塞）

| 问题 | 修复方案 | 优先级 |
|------|----------|--------|
| 孤儿检测误报（scripts/ 和 benchmark/ 入口文件被识别为孤儿） | 快：加 .workspace-bridge.json 标注；慢：改进 orphan 算法排除 script/entry 角色 | 低 |
| 缺少 .workspace-bridge.json | 项目根目录加配置，标注 reference/ 目录 | 低 |
| 无代码覆盖率脚本 | 可选：添加 npm run coverage | 低 |

---

## 3. 后续更新方向

> 原则：**真实场景驱动 > 提前假设优化**。当前骨架足够好，等真实仓库来敲门。

### 现在做（本轮已清，无遗留）

- audit-formatters.js 拆分 done
- mixed repo 命令精度 done
- skill 体系化 done

### 近期重点（1-2 周，有具体验收标准）

**P5：大项目体验优化（REPL + 缓存解析结果 + Watcher）**

> 基础设施现状：file-index.js 已有 fs.watch + pendingUpdates debounce 骨架，但只更新 fileMetadata，未接到 dep-graph；cache.js 只存了 {mtime, size, hash}，不存 parseResult。

**Step 1：REPL / 精确查询模式（1-2 天）**
- 新增 `node cli.js repl --cwd .`，启动一次，交互查询，按需输出
- 支持命令：`impact <file>`、`dependents <file>`、`affected-tests <file>`、`dead-exports`、`cycles`
- 只输出请求字段，不吐全量 JSON
- 改动：`cli.js` 新增 `repl` case + 新增 `src/cli/repl.js`（readline 循环）
- 验收：启动后输入 `impact src/utils/path.js`，<100ms 返回精简结果

**Step 2：缓存解析结果（1-2 天）**
- 扩展 `cache.js`，新增 `parseResults` Map（file -> {imports, exports, importRecords, exportRecords, functionRecords, parseMode, mtime}）
- `dep-graph.js build()` 增量逻辑：文件 mtime 未变 -> 从缓存读取 parseResult，跳过解析
- 收益：10k 文件仓库改 1 个文件后 rebuild，从"解析 10k 文件"变成"解析 1 个 + 读取 9999 个缓存"
- 验收：第二次 `node cli.js audit-summary --cwd .` < 3s（10k 文件 fixture）

**Step 3：激活 Watcher（在 Step 2 基础上，2-3 天）**
- `file-index.js` 已有 `fs.watch` + `pendingUpdates` debounce，只需在 `processPending()` 末尾触发 dep-graph 增量更新
- `dep-graph.js` 新增 `updateFiles(filePaths)`：重新解析 -> 删除旧 import 引用 -> 添加新引用（不重建全量 reverseGraph）
- 收益：文件保存后终端实时打印 "1 file updated, 14 dependents affected"
- 验收：`node cli.js watch --cwd .` 后改一个文件，<500ms 完成增量更新

### 等信号再做（不主动投入）

| 方向 | 等待的信号 |
|------|-----------|
| Kotlin AST 级支持 | 真实 Kotlin 项目用户反馈 regex 级解析不够用 |
| Gradle 任务发现 / Go module path 聚合 / Rust 模块级测试过滤 | 真实多模块 Gradle/Go/Rust 项目反馈命令不准 |
| CodeQL / Semgrep adapter | 企业级用户需要安全/深度分析，且愿意接受可选外部依赖 |
| 评分算法统一为数据结构驱动 | 当前 if-else 评分工作正常，统一化只提升代码美感。等新增第 6 种评分维度时再重构 |

---

## 4. 快速验证命令

```bash
# 全量回归（32 项，必须绿）
npm run test:all

# 官方自审
npm run self-audit

# 基线健康检查
node cli.js audit-summary --cwd . --json --quiet
node cli.js audit-overview --cwd . --json --quiet

# 性能基准
npm run benchmark:perf
```

---

## 5. 关键代码落点

### classifyChangeType 单一数据源
- src/cli/formatters/audit-diff-summary.js — classifyChangeType()，fileRole 优先，扩展名仅 library fallback
- src/utils/project-context.js — inferFileRole()，config/docs/script 覆盖补全

### audit-formatters 拆分
- src/cli/formatters/composite-risk.js — buildCompositeRisk
- src/cli/formatters/repo-summary.js — buildRepoSummary
- src/cli/formatters/file-summary.js — buildFileSummary
- src/cli/formatters/audit-diff-summary.js — buildAuditDiffSummary + classifyChangeType + getValidationTemplate
- src/cli/formatters/validation-advice.js — buildValidationAdvice
- src/cli/formatters/project-map.js — buildProjectMap + buildDirectoryTree + toRelativePath
- src/cli/formatters/impact-explanations.js — buildImpactExplanations
- src/cli/formatters/index.js — 统一导出

### mixed repo 命令精度
- src/utils/stack-detector.js — getNodeCommands() codeTargets 过滤（js|jsx|ts|tsx|mjs|cjs），排除 json 文件误入 test runner

### skill 体系
- skills/workspace-audit/SKILL.md — 项目内 skill
- ~/.config/agents/skills/workspace-audit/SKILL.md — 用户级别 skill
- role-quality/references/legacy/workspace-audit/SKILL.md — role-quality 子 skill

---

## 6. 架构决策（不变）

| 维度 | 策略 | 理由 |
|------|------|------|
| 依赖图 | 自研 | 多语言统一是壁垒 |
| 增量分析 | 自研 | git diff 驱动 <200ms 是护城河 |
| 风格/质量 | 自研 + Semgrep 可选 | 你管格式，Semgrep 管规则库 |
| 精确影响/污点 | CodeQL 后端 + adapter | 承认打不过 |
| tree-sitter | 不引入 | Python 标准库 ast 已够用；native binding 放大 Windows 中文路径风险 |

---

## 7. 本轮教训

1. **skill description 必须包含中文触发词** — 英文 description 在中文会话中几乎无法触发。workspace-audit 加了"代码审计, 仓库审计..."后才可用。
2. **skill 目录位置必须正确** — Kimi CLI 项目级 skill 目录是 .agents/skills/，不是 skills/。role-quality 的子 skill 路径声明为 references/legacy/<名>/，复制错位置会导致子 skill 加载失败。
3. **伞技能 frontmatter 必须标准** — role-quality 塞了 12 个自定义字段（child_skill_directories, routing_priority 等），Kimi CLI 标准系统只认 name + description，其余全是占 token 的死重。
4. **classifyChangeType 和 inferFileRole 必须互补闭环** — 重构 classifyChangeType 时删除的文件名子串判断（readme、jest.config 等），必须同步补到 inferFileRole 里，否则行为会漂移。
5. **mixed repo full 阶段不过滤是设计意图** — w2t3-command-quality-test.js 明确断言"mixed py-only should keep node full (regression)"，改动前必须读测试契约。
6. **临时目录会污染其他测试** — test-temp-mixed-repo 等 fixture 未清理会导致 cli-fallback-test.js / functionality-test.js / analysis-test.js 失败，因为它们检测当前目录下的 git 仓库。
7. **json 文件被 splitTargetsByStack 归入 node 栈** — .workspace-bridge-cache.json 等 json 文件会被 getNodeCommands 传给 jest/vitest/mocha，生成 npx jest .workspace-bridge-cache.json 这种无意义命令。

---

## 8. 历史完成记录

### 本轮完成（2026-04-30）

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| 1 | audit-formatters.js 职责混乱（927 行垃圾桶） | src/cli/formatters/ 目录 | 拆为 7 职责文件 + index.js，更新 5 处引用路径 |
| 2 | CLI 只暴露 impact/affected-tests | cli.js | stats/dependencies/dependents 独立命令已可用 |
| 3 | mixed repo focused 含无意义 node 命令 | src/utils/stack-detector.js | getNodeCommands 引入 codeTargets 过滤，排除 json/cache |
| 4 | classifyChangeType 三来源推断 | src/cli/formatters/audit-diff-summary.js + src/utils/project-context.js | fileRole 单一事实源，inferFileRole 补全覆盖 |
| 5 | skill 无中文触发词 | skills/workspace-audit/SKILL.md | description 加中文触发词，三处同步 |
| 6 | role-quality frontmatter 膨胀 | role-quality/SKILL.md | 精简为标准 name+description，触发词分工 |

### 本轮完成（2026-05-01）— TECH_DEBT 清零行动

| # | 债务 | 文件 | 修复 |
|---|------|------|------|
| 7 | self-audit.js Windows 跑不过（`spawnSync npm ENOENT`） | scripts/self-audit.js | `shell: process.platform === 'win32'`，Node.js 20+ `.cmd` spawn 限制适配 |
| 8 | dep-graph.js 工具函数赖在核心引擎 | src/services/dep-graph.js + src/utils/test-detector.js | `normalizeStem/HeuristicName/Signature/LanguageFamily` 下沉至 `test-detector.js`；`isTestLikeFile` 改为 `TEST_DETECTION_RULES` 表驱动；文件 -67 行 |
| 9 | stack-detector.js 硬编码 `pathExists` 链 | src/utils/stack-detector.js | 7 组配置表：`STACK_MARKERS`、`PACKAGE_MANAGER_RULES`、`TEST_RUNNER_FILE_RULES`、`LINTER_FILE_RULES`、`DOCS_TOOL_RULES`、`TYPE_CHECKER_FILE_RULES`、`JAVA_BUILD_RULES` |
| 10 | overview-tools.js 评分算法 if-else | src/tools/overview-tools.js | `HOTSPOT_SCORE_RULES` + `STABILITY_SCORE_RULES` 数据结构驱动 |
| 11 | git-tools.js `computeHistoryRisk` 硬编码 | src/tools/git-tools.js | `HISTORY_RISK_SCORE_GROUPS` 组内 first-match、组间累加 |
| 12 | path.js `scoreDirectory` 评分逻辑渗透 | src/utils/path.js | `WORKSPACE_SCORE_RULES` 配置表驱动 |

### 测试

- 新增：无（重构保持零行为变更，现有测试覆盖即足够）
- 全量：npm run test:all -> 32/32 全绿（3 次回归验证）
- 自审：`npm run self-audit` ✅ 通过（40.5s）

---

*Last updated: 2026-05-01（TECH_DEBT 清零行动后同步）*
