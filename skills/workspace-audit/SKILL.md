---
name: workspace-audit
description: Use this skill when the goal is to audit a local codebase with workspace-bridge-cli. 触发词：代码审计, 仓库审计, 项目结构分析, 影响范围, 死代码检测, 循环依赖, 健康检查, 依赖漂移, 文件影响分析, 孤儿文件检测, 热点文件分析.
---
# workspace-audit

> AI-first 调用约定。只教三件事：**默认参数、何时用什么命令、何时不用**。

## Purpose

本地 CLI 分析引擎，给 AI 提供跨文件视角和变更验证建议。只做**结构分析**（谁依赖谁、改了什么），不做**语义分析**（代码逻辑、安全鉴权、并发正确性）。

## 默认参数

```bash
workspace-bridge-cli <command> --cwd <project> --json --quiet
```

- `--json`：结构化输出，`schemaVersion: "1.2.0"` 已冻结。
- `--quiet`：消除 stderr 日志污染。
- 人类可读时用 `--format markdown`；AI 预消化时用 `--format ai`（仅 `audit-overview`）。

## 核心决策树

| 用户意图 | 推荐命令 | 层级 |
|---------|---------|------|
| 首次摸底 / 定期健康检查 | **`audit-overview`** | **L1 默认入口** |
| 有 git 变更，需审查 | `audit-diff` | L1 |
| 改特定文件前，评估影响 | `audit-file --file <path>` | L1 |
| 安全扫描 | `audit-security --builtin-only` | L3 |
| 项目结构太复杂，理一理 | `audit-map --compact` | L1 |
| 深入理解模块依赖链 | `tree --file <path>` | L4 debug |
| 死代码清理 | `dead-exports` | L4 debug |
| 循环依赖/架构问题 | `cycles` | L4 debug |
| 断链 import | `unresolved` | L4 debug |

**L4 命令仅在需要原始数据或调试时调用**。日常审计优先用 L1（`audit-overview` / `audit-file` / `audit-diff`），数据已被策展去噪。

**避免调用**：`audit-summary`（已废弃，redirect 到 `audit-overview`）、`health`（已废弃）、`stats` / `dependencies` / `dependents`（太 raw）、`impact` / `affected-tests`（已被 `audit-file` 覆盖）、`watch`（交互式，不适合批量调用）。

## 预热工作流

首次分析新路径时，CLI 需要 5-30s 构建索引。

```bash
# Step 1: 轻量预检，触发缓存（< 2s）
workspace-bridge-cli workspace-info --cwd <project> --quiet

# Step 2: 缓存已热，执行重命令
workspace-bridge-cli audit-overview --cwd <project> --json --quiet
```

若 `workspace-info` 返回 `fileCount: 0`，停止后续命令，报告"未找到可解析源文件"。

缓存位置：默认 SQLite（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），可通过 `--cache-dir <path>` 覆盖。

## 关键读取优先级

### audit-overview
1. `severity` / `summary`
2. `topRisks` / `actions`（`--format ai`）
3. `hotspots` / `knowledgeRisk`
4. `counts`（deadExports / unresolved / cycles / orphans）
5. `analysisCoverage.coverageRatio`

### audit-file
1. `severity`
2. `impact[]`（真实依赖边）
3. `affectedTests[]`（优先 `source === "graph"`，`mention` 可忽略）
4. `coChanges[]`（历史上与该文件频繁共变的文件，检查是否遗漏）
5. `validationAdvice.commands`

### audit-diff
1. `summary.changeMetrics`
2. `validationAdvice.commands`
3. `incrementalFindings`（加 `--incremental`）

## 安全审查清单

CLI 只给结构线索，安全判断必须 AI 手动执行。

**Spring Boot**：检查 `SecurityConfig` 的 `permitAll()`、`@Anonymous`；`application*.yml` 明文密钥；`@RestController` 方法级鉴权；文件上传路径校验；日志是否打印 token/身份证。

**Django**：检查 `settings.py` 的 `SECRET_KEY` / `DEBUG`；`urls.py` 权限装饰器；`views.py` 上传路径 / SQL 注入；日志敏感字段。

**Vue / Node**：检查 `.env` 密钥；`utils/request.js` token 存储；`eval()` / `innerHTML` / `document.write`；cors 是否开放 `*`；`console.log` 是否打印敏感信息。

## 混合仓库配置

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
| `fileCount: 0` | 检查 `package.json`/`pom.xml` 是否存在 |
| 输出含 `coverageWarning` | `analysisCoverage.coverageRatio < 0.5`，findings 可能不完整 |
| Windows 路径问题 | `--file src/services/dep-graph.js`（正斜杠） |
| Exit code 2 | 未捕获异常；exit=1 是业务失败 |
| Java 项目 `coverageRatio=1` 但缺少 AST 字段 | 本地未安装 `javalang`（`pip install javalang`），parser 已回退到 regex；fallback 结果可用，但不应与 AST golden 对比 |

---

*核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结。*
