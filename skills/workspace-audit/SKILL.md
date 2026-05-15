---
name: workspace-audit
description: Use this skill when the goal is to audit a local codebase with workspace-bridge-cli, especially for repo-level summaries, file impact checks, project overview, dead export candidates, unresolved imports, cycles, health checks, or dependency drift. 触发词：代码审计, 仓库审计, 项目结构分析, 影响范围, 死代码检测, 循环依赖, 健康检查, 依赖漂移, 文件影响分析, 孤儿文件检测, 热点文件分析.
---
# workspace-audit

> **AI-first 调用约定。** 本 skill 教 AI 如何高效使用 workspace-bridge-cli。完整命令参考见 [SKILL-REFERENCE.md](./SKILL-REFERENCE.md)。

## Purpose

本地 CLI 分析引擎，给 AI 提供跨文件视角和变更验证建议。只做**结构分析**（谁依赖谁、改了什么），不做**语义分析**（代码逻辑、安全鉴权、并发正确性）。

## AI 默认调用约定

**不要裸调命令。总是使用以下默认参数：**

```bash
workspace-bridge-cli <command> --cwd <project> --format markdown --quiet
```

| 场景 | 命令 |
|------|------|
| 首次摸底 / 定期健康检查 | `audit-summary` |
| 有 git 变更，需审查 | `audit-diff` |
| 改特定文件前，评估影响 | `audit-file --file <path>` |
| 安全扫描 | `audit-security --builtin-only` |
| 项目结构太复杂，理一理 | `audit-map --compact` |
| 死代码清理 | `dead-exports` |
| 循环依赖/架构问题 | `cycles` |
| 断链 import | `unresolved` |

**为什么 `--format markdown`**：直接输出带标题/列表的 Markdown，AI 无需解析 JSON，减少 token 消耗和解析错误。需要结构化数据时用 `--format jsonl`。

**`--format ai`（推荐用于 `audit-summary`）**：输出预消化的策展 JSON — `severity + topRisks + actions + confidence`，AI 可直接消费，无需自己从 400 行原始 JSON 中提取结论。支持 `--depth surface|detail|full` 渐进式发现和 `--token-budget <n>` 自动裁剪。

**为什么 `--quiet`**：消除 stderr 日志污染，输出纯净。

### 预热工作流（避免冷启动超时）

首次分析新路径时，CLI 需要 5-30s 构建索引。AI 工作流易超时。

```bash
# Step 1: 轻量预检，触发缓存（< 2s）
workspace-bridge-cli workspace-info --cwd <project> --quiet

# Step 2: 缓存已热，执行重命令
workspace-bridge-cli audit-summary --cwd <project> --format markdown --quiet
```

> 若 `workspace-info` 返回 `fileCount: 0`，停止后续命令，报告"未找到可解析源文件"。

## 核心决策树

| 用户意图 | 推荐命令 | 说明 |
|---------|---------|------|
| "看看这个项目怎么样" | `audit-summary` | 整体健康度 + 结构问题 + 下一步建议 |
| "我改了些代码，帮忙看看" | `audit-diff` | 变更分析 + 验证建议 + 具体执行命令 |
| "改这个文件会影响什么" | `audit-file --file <path>` | 影响半径 + 受影响测试 |
| "有没有安全问题" | `audit-security --builtin-only` | 19 条内置规则，< 2s |
| "项目结构太复杂，理一理" | `audit-map --compact` | 目录树 + 依赖边 + 问题高亮 |
| "死代码清理" | `dead-exports` | 0 引用符号候选（需人工确认后删除） |
| "循环依赖/架构问题" | `cycles` | 逐条循环路径 |
| "断链 import" | `unresolved` | 未解析的导入列表 |

**避免调用的命令**：`audit-overview`（与 audit-summary 重叠，除非需要 hotspots）、`stats`（数据太 raw）、`repl`/`watch`（交互式，不适合 AI 批量调用）。

## 核心命令详解

### audit-summary — 默认入口

```bash
# 推荐：预消化 JSON，AI 直接消费
workspace-bridge-cli audit-summary --cwd <project> --format ai --quiet

# 备选：人类可读的 Markdown
workspace-bridge-cli audit-summary --cwd <project> --format markdown --quiet
```

**`--format ai` 读取优先级**：
1. `severity` → 整体风险级别
2. `topRisks` → 按优先级排序的风险列表（coverage → cycles → unresolved → dead-exports → health），每条带 `confidence`
3. `actions` → `P0/P1/P2` 优先级可执行建议
4. `counts` → 问题数量概览
5. `confidence.coverageRatio` → 若 < 0.5，提示"分析可能不完整"

**渐进式发现**：
- `--depth surface`：只给 counts + top 3 risks + actions，~15 行 JSON，适合快速摸底
- `--depth detail`（默认）：追加 `riskFiles`（每类风险最多 3 个代表性文件）
- `--depth full`：追加完整 `details`（全部 deadExports / unresolved / cycles）
- `--token-budget 500`：超限自动降级深度，防止上下文溢出

**`--format markdown` 读取优先级**：
1. `summary.severity` → 整体风险级别
2. `summary.nextSteps` → 可执行建议
3. `scope.counts` → 项目规模与角色分布
4. `analysisCoverage.coverageRatio` → 若 < 0.5，提示"分析可能不完整"
5. `honesty` → 假阳性率预估，决定是否信任 findings

**注意**：`architectureAdvice` 字段价值低，直接忽略。

### audit-diff — 变更审查

```bash
workspace-bridge-cli audit-diff --cwd <project> --format markdown --quiet
workspace-bridge-cli audit-diff --cwd <project> --since HEAD~3 --format markdown --quiet  # PR range
workspace-bridge-cli audit-diff --cwd <project> --staged --format markdown --quiet         # 暂存区
```

**AI 读取优先级**：
1. `summary.changeMetrics` → 变更规模
2. `validationAdvice.changeType` / `phases` → 验证计划（smoke → focused → full）
3. `validationAdvice.commands` → 可执行验证命令
4. `incrementalFindings`（加 `--incremental` 时）→ 只与变更相关的问题

### audit-file — 改前影响评估

```bash
workspace-bridge-cli audit-file --cwd <project> --file <path> --format markdown --quiet
```

**AI 读取优先级**：
1. `severity` → 变更风险级别
2. `impact` → 直接/传递依赖方
3. `affectedTests` → 需要跑的测试
4. `validationAdvice` → 验证建议
5. `frameworkPattern` → 框架模式提示

### audit-security — 安全扫描

```bash
workspace-bridge-cli audit-security --cwd <project> --builtin-only --format markdown --quiet
workspace-bridge-cli audit-security --cwd <project> --builtin-only --files <file1>,<file2> --format markdown --quiet
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
  workspace-bridge-cli audit-summary --cwd "$dir" --format jsonl --quiet
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
| `parserAvailability` | 非 Node 项目 `skipped: true` 是正常初始化路径，不代表文件被跳过 |

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
| `command not recognized` | `npx workspace-bridge-cli ...` |
| `fileCount: 0` | 检查 `pom.xml`/`package.json` 是否存在；Java 项目确保在 `pom.xml` 所在目录运行 |
| 输出含 `coverageWarning` | `analysisCoverage.coverageRatio < 0.5`，部分文件 fallback 到 regex 解析，findings 可能不完整 |
| Windows 路径问题 | `--file` 参数使用正斜杠或双反斜杠：`--file src/services/dep-graph.js` |
