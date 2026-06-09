---
name: workspace-audit
description: Use this skill when the goal is to audit a local codebase with workspace-bridge-cli, especially for repo-level summaries, file impact checks, project overview, dead export candidates, unresolved imports, cycles, health checks, or dependency drift. 触发词：代码审计, 仓库审计, 项目结构分析, 影响范围, 死代码检测, 循环依赖, 健康检查, 依赖漂移, 文件影响分析, 孤儿文件检测, 热点文件分析.
---
# workspace-audit

> **AI-first 调用约定。** 本 skill 教 AI 如何高效使用 workspace-bridge-cli。

## Purpose

本地 CLI 分析引擎，给 AI 提供跨文件视角和变更验证建议。只做**结构分析**（谁依赖谁、改了什么），不做**语义分析**（代码逻辑、安全鉴权、并发正确性）。

## AI 默认调用约定

**不要裸调命令。总是使用以下默认参数：**

```bash
workspace-bridge-cli <command> --cwd <project> --json --quiet
```

> 为什么 `--json` 而非 `--format markdown`：Markdown 需要 AI 做正则/启发式解析，易出错且 token 浪费。`--json` 输出结构化数据，`JSON.parse` 一次成功，字段路径稳定（`schemaVersion: "1.2.0"` 已冻结）。

| 场景 | 命令 | 层级 |
|------|------|------|
| **首次摸底 / 定期健康检查** | **`audit-overview`** | **L1 策展入口（默认）** |
| 有 git 变更，需审查 | `audit-diff` | L1 策展入口 |
| 改特定文件前，评估影响 | `audit-file --file <path>` | L1 策展入口 |
| 安全扫描 | `audit-security --builtin-only` | L3 环境诊断 |
| 项目结构太复杂，理一理 | `audit-map --compact` | L1 策展入口 |
| **深入理解模块依赖链** | **`tree --file <path>`** | **L4 debug** |
| 死代码清理 | `dead-exports` | L4 debug |
| 循环依赖/架构问题 | `cycles` | L4 debug |
| 断链 import | `unresolved` | L4 debug |

> **L4 命令为 debug 层级**：`dead-exports` / `cycles` / `unresolved` / `tree` / `dependencies` / `dependents` / `stats` 均为原始查询命令，数据已被 L1（`audit-summary`/`audit-file`/`audit-diff`）策展覆盖。**日常审计优先用 L1/L2，L4 仅在需要原始数据或调试时调用。**

**`--format ai`**（`audit-overview` 专用）：输出预消化的策展 JSON — `severity + topRisks + actions + confidence`，AI 可直接消费，无需自己从 400 行原始 JSON 中提取结论。支持 `--depth surface|detail|full` 渐进式发现和 `--token-budget <n>` 自动裁剪。**其余命令统一用 `--json`**。

**为什么 `--quiet`**：消除 stderr 日志污染，输出纯净。

### 预热工作流（避免冷启动超时）

首次分析新路径时，CLI 需要 5-30s 构建索引。AI 工作流易超时。

```bash
# Step 1: 轻量预检，触发缓存（< 2s）
workspace-bridge-cli workspace-info --cwd <project> --quiet

# Step 2: 缓存已热，执行重命令
workspace-bridge-cli audit-overview --cwd <project> --json --quiet
```

> 若 `workspace-info` 返回 `fileCount: 0`，停止后续命令，报告"未找到可解析源文件"。

**缓存位置**：默认 SQLite（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离。可通过 `--cache-dir <path>` 覆盖。旧 `.workspace-bridge-cache.json` 已废弃。

## 核心决策树

| 用户意图 | 推荐命令 | 说明 |
|---------|---------|------|
| "看看这个项目怎么样" | **`audit-overview`** | **默认入口**。热点文件 + 知识风险 + 死导出 + 未解析 + 循环依赖 + 孤儿文件 + 语言覆盖 |
| "看看这个项目怎么样（旧命令，兼容）" | `audit-summary` | **已废弃**。内部 redirect 到 `audit-overview`；`healthScore` 字段无意义，忽略 |
| "我改了些代码，帮忙看看" | `audit-diff` | 变更分析 + 验证建议 + 具体执行命令 |
| "改这个文件会影响什么" | `audit-file --file <path>` | **一站式**：`impact[]` + `affectedTests[]` + `validationAdvice` + `coChanges[]`。无需再单独调 `impact` 或 `affected-tests` |
| "这个模块依赖谁、谁依赖它" | `tree --file <path>` | **[L4 debug]** 递归 import/dependent 树，比 `impact` 更直观展示依赖层次 |
| "有没有安全问题" | `audit-security --builtin-only` | 19 条内置规则，< 2s |
| "项目结构太复杂，理一理" | `audit-map --compact` | 目录树 + 依赖边 + 问题高亮 |
| "死代码清理" | `dead-exports` | **[L4 debug]** 0 引用符号候选（需人工确认后删除） |
| "循环依赖/架构问题" | `cycles` | **[L4 debug]** 逐条循环路径 |
| "断链 import" | `unresolved` | **[L4 debug]** 未解析的导入列表 |
| "快速查一个文件的依赖/影响" | `repl --eval "impact <file>"` | **非交互单命令**，比直接 `impact` 更快（复用内存图），适合 AI/CI 批量调用 |

**避免调用的命令**：`stats` / `dependencies` / `dependents`（数据太 raw，已被 L1/L2 覆盖）、`dead-exports` / `cycles` / `unresolved`（数据已被 `audit-overview` 策展覆盖）、`impact` / `affected-tests`（已被 `audit-file` 覆盖）、`tree`（仅在需要理解依赖层次时调用）、`watch`（交互式文件监控，不适合 AI 批量调用）、`health`（已废弃，redirect 到 `audit-overview`）。

> `audit-overview` 不再是"避免调用"，而是**默认首选入口**。

> `repl` 已支持 `--eval <command>` 非交互模式，不再属于"避免调用"。不带 `--eval` 的纯交互式 `repl` 仍不适合 AI 批量调用。

> ⚠️ **`audit-summary` 已废弃，`healthScore` 是无意义指标**：`healthScore` 只检查文件是否存在（README/.gitignore/CI/Dockerfile 等），**不反映代码质量**。项目可能有 4 个死导出、1311 行核心文件、6 条活跃债务，healthScore 仍可能是满分。**默认入口已改为 `audit-overview`**，其输出包含真正的结构性指标（hotspots / knowledgeRisk / deadExports / unresolved / cycles / orphans）。

## 核心命令详解

### audit-overview — 默认入口

```bash
# 推荐：预消化 JSON，AI 直接消费
workspace-bridge-cli audit-overview --cwd <project> --format ai --quiet

# 备选：人类可读的 Markdown
workspace-bridge-cli audit-overview --cwd <project> --format markdown --quiet
```

**`--format ai` 读取优先级**：
1. `severity` → 整体风险级别
2. `topRisks` → 按优先级排序的风险列表（hotspots → knowledgeRisk → coverage → cycles → unresolved → dead-exports），每条带 `confidence`
3. `actions` → `P0/P1/P2` 优先级可执行建议
4. `counts` → 问题数量概览（deadExports / unresolved / cycles / orphans）
5. `hotspots` → 高危险文件（历史修改频繁 + PageRank 高 + 耦合度高）
6. `knowledgeRisk` → 单作者文件（bus factor = 1，改之前要格外小心）
7. `confidence.coverageRatio` → 若 < 0.5，提示"分析可能不完整"

**渐进式发现**：
- `--depth surface`：只给 counts + top 3 risks + actions，~15 行 JSON，适合快速摸底
- `--depth detail`（默认）：追加 `riskFiles`（每类风险最多 3 个代表性文件）
- `--depth full`：追加完整 `details`（全部 hotspots / knowledgeRisk / deadExports / unresolved / cycles / orphans）
- `--token-budget 500`：超限自动降级深度，防止上下文溢出

**`--format markdown` 读取优先级**：
1. `summary.severity` → 整体风险级别
2. `summary.nextSteps` → 可执行建议
3. `scope.counts` → 项目规模与角色分布
4. `analysisCoverage.coverageRatio` → 若 < 0.5，提示"分析可能不完整"
5. `honesty` → 假阳性率预估，决定是否信任 findings

**注意**：`architectureAdvice` 字段价值低，直接忽略。

### audit-summary — 兼容层（已废弃）

```bash
# 旧命令，内部 redirect 到 audit-overview
workspace-bridge-cli audit-summary --cwd <project> --format ai --quiet
```

- `health` 字段已废弃，不再返回有意义的 healthScore。
- `deadExports` / `unresolved` / `cycles` 数据已从 `audit-overview` 获取。
- 建议迁移到 `audit-overview`。

### audit-diff — 变更审查

```bash
workspace-bridge-cli audit-diff --cwd <project> --json --quiet
workspace-bridge-cli audit-diff --cwd <project> --commits HEAD~9..HEAD --json --quiet  # commit range
workspace-bridge-cli audit-diff --cwd <project> --since HEAD~3 --json --quiet           # since 模式
workspace-bridge-cli audit-diff --cwd <project> --staged --json --quiet                # 暂存区
```

**AI 读取优先级**：
1. `summary.changeMetrics` → 变更规模
2. `validationAdvice.changeType` / `phases` → 验证计划（smoke → focused → full）
3. `validationAdvice.commands` → 可执行验证命令
4. `incrementalFindings`（加 `--incremental` 时）→ 只与变更相关的问题

### audit-file — 改前影响评估

```bash
workspace-bridge-cli audit-file --cwd <project> --file <path> --json --quiet
```

**AI 读取优先级**：
1. `severity` → 变更风险级别
2. `impact[]` → 直接/传递依赖方（含 `level`/`via`/`importedSymbols`）
3. `affectedTests[]` → 需要跑的测试（含 `distance`/`source`/`via`）
4. `coChanges[]` → 历史上与该文件频繁共变的文件（高价值，易遗漏）
5. `validationAdvice` → 验证建议（含 `commands.smoke/focused/full`）
6. `frameworkPattern` → 框架模式提示

**coChanges[] 使用指南（高价值，易遗漏）**

`coChanges` 基于 git 历史统计：历史上与目标文件**频繁出现在同一次 commit** 中的文件列表。

**为什么重要**：结构依赖（`impact[]`）只告诉你"谁 import 了它"，但 `coChanges` 告诉你"改它的时候历史上也经常改谁"。后者捕捉的是**业务耦合**和**隐性依赖**，不是代码 import 能暴露的。

**AI 消费流程**：
1. 读取 `coChanges[].file` → 获取共变文件路径
2. 检查 `coChanges[].confidence` → `high` 表示强共变（≥5 次同 commit），`medium`/`low` 可降级参考
3. **关键动作**：对比当前变更集（git diff / staged）→ 若 `coChanges` 中的文件**不在当前变更中**，提示用户"历史上改 A 必改 B，本次是否遗漏了 B？"

**示例场景**：
```json
"coChanges": [
  { "file": "src/services/order-service.js", "confidence": "high", "coChangeCount": 12 },
  { "file": "src/models/order.js", "confidence": "medium", "coChangeCount": 5 }
]
```
→ 改 `payment-gateway.js` 时历史上 12 次同时改了 `order-service.js`。若当前 PR 只改了 payment 没碰 order，需要人工确认是否遗漏业务侧联动修改。

**⚠️ affectedTests 过滤规则**：
- `source === "graph"` → **高优先级**（真实 import 依赖边）
- `source === "mention"` → **低优先级/可忽略**（仅文件名 stem 匹配，空文件可能触发 30+ 误报）
- `source === "heuristic"` → 中等优先级，人工确认后采纳

> `audit-file --json` 已完整包含 `impact` + `affected-tests` + `validationAdvice` + `coChanges`。**不要**再单独调用 `impact` 或 `affected-tests`。

### tree — 依赖链深入分析

```bash
# 双向展开（imports + dependents），默认深度 3
workspace-bridge-cli tree --cwd <project> --file <path> --format json --quiet

# 只看 imports 链（向下追踪依赖）
workspace-bridge-cli tree --cwd <project> --file <path> --direction imports --format json --quiet

# 深度限制为 2
workspace-bridge-cli tree --cwd <project> --file <path> --max-depth 2 --format json --quiet
```

**AI 读取优先级**：
1. `tree.imports` → 递归 import 链，展示"这个文件依赖谁"
2. `tree.dependents` → 递归 dependent 链，展示"谁依赖这个文件"
3. `external: true` → 外部依赖（如 npm 包），不参与递归

**何时用 `tree` 而非 `impact`**：
- `impact` 给出扁平的 impact 列表（36 个文件），**无层次**
- `tree` 给出**树形结构**（`cache.js → container.js → cli.js`），更适合理解架构层次和间接依赖路径

### audit-security — 安全扫描

```bash
workspace-bridge-cli audit-security --cwd <project> --builtin-only --json --quiet
workspace-bridge-cli audit-security --cwd <project> --builtin-only --files <file1>,<file2> --json --quiet
```

**AI 读取优先级**：
1. `summary.total` → 命中数
2. `findings[]` → 逐条规则命中（severity, rule, file, line）

> **关键认知**：19 条规则全是正则匹配，只能发现"出现了敏感字符串"。框架级语义漏洞（如 `permitAll()` 通配符开放）必须 AI 手动审查。

## 安全审查清单（AI 必须手动执行）

CLI 只能给**结构线索**，安全判断必须 AI 自己做。按项目类型执行：

### Spring Boot
- `SecurityConfig.java` / `WebSecurityConfig.java` → 搜索 `permitAll()`、`@Anonymous`
- `application.yml` / `application-dev.yml` → 搜索明文密码、JWT secret、数据库连接串
- 所有 `@RestController` → 检查是否有 `@PreAuthorize` / `@Secured` / 方法级鉴权
- `FileUploadController` / `*Upload*.java` → 路径遍历防护、文件名校验
- `LogAspect.java` / 全局异常处理 → 是否打印 token/密码/身份证号
- 所有 SSE/WS endpoint → 是否有鉴权拦截器
- `batchSave` / `batchInsert` → `@Transactional` + 乐观锁 `version`

### Django
- `settings.py` → `SECRET_KEY` 是否硬编码、`DEBUG = True` 生产环境
- `urls.py` → 敏感路由是否有 `@login_required` / 权限检查
- `views.py` → 文件上传路径校验、SQL 注入（`raw()` / 字符串拼接）
- `middleware.py` → 鉴权中间件是否覆盖全站
- 所有 `*.py` → `print()` / `logger` 中是否输出敏感字段

### Vue / Node
- `vite.config.js` / `vue.config.js` → proxy 配置是否暴露内网接口
- `.env` / `.env.development` → 是否含密钥、token
- 接口请求层（`utils/request.js`）→ token 存储方式、是否自动附带到请求头
- `eval()` / `Function()` / `innerHTML` / `document.write` → 代码注入风险
- `cors` 配置 → 是否开放 `*` 或反射 origin
- `console.log` → 是否打印用户输入 / token / 个人信息

## 多仓库批量审计

同一目录下有多个仓库时：

```bash
# Shell 循环模板
for dir in */; do
  echo "=== $dir ==="
  workspace-bridge-cli audit-overview --cwd "$dir" --format jsonl --quiet
done
```

或使用聚合脚本（输出合并 severity）：

```bash
node scripts/multi-repo-audit.js <parent-dir>
```

> `scripts/multi-repo-audit.js` 需另行提供，见 [SKILL-REFERENCE.md](./SKILL-REFERENCE.md)。

## 可忽略字段指南

AI 消费输出时，以下字段价值低，可跳过以节省上下文：

| 字段 | 理由 |
|------|------|
| `architectureAdvice` | 单体项目建议"按子域拆分"，不实用 |
| `stability` | 新文件默认 fragile，噪声大 |
| `stabilityTrend` | 基于 git 历史，对 AI 决策帮助有限 |
| `hotspots[].reason` | 只展示 git 信号，真正的风险看 `score` 和 `coupling` |
| `parserAvailability` | 非 Node 项目 `usedFallbackPath: true` 是正常初始化路径，不代表文件被跳过 |

## 标准输出契约

所有 JSON/Markdown 输出均含 `schemaVersion: "1.2.0"`。核心字段 `{ok, error, severity, summary}` 语义冻结。

### Confidence 规则

| Finding | 默认置信度 | 何时降级 |
|---------|-----------|---------|
| `unresolved` | High | Vue/Vite 省略 `.vue` 扩展名时 → Medium |
| `dead-exports` | Medium (AST) / Low (regex) | alias (`@/...`) 或动态导入时 → Low |
| `cycles` | High | 框架合法循环（Vue store↔router）已自动过滤 |
| `hotspots` | Medium-High | 配置文件/生成文件 → Medium |

### 混合仓库

若目录含 `prototypes/` / `reference/` / `archive/`，创建 `.workspace-bridge.json`：

```json
{
  "directories": {
    "archive": ["reference", "prototypes"],
    "generated": ["dist", "build", ".next", "coverage"]
  }
}
```

## Troubleshooting

| 问题 | 修复 |
|------|------|
| `command not recognized` | `npx workspace-bridge-cli@1.2.0 ...` |
| `fileCount: 0` | 检查 `pom.xml`/`package.json` 是否存在；Java 项目确保在 `pom.xml` 所在目录运行 |
| 输出含 `coverageWarning` | `analysisCoverage.coverageRatio < 0.5`，部分文件 fallback 到 regex 解析，findings 可能不完整 |
| Windows 路径问题 | `--file` 参数使用正斜杠或双反斜杠：`--file src/services/dep-graph.js` |
| Exit code 误判 | 默认 findings 不触发 exit=1。只有 `result.ok === false` 或 `--fail-on-findings` 显式开启时才会 exit=1。exit=2 表示未捕获异常 |
