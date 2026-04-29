# workspace-bridge

一个用于 AI 编程助手的工作区分析引擎，当前只保留本地 CLI + skill 工作流。

## 功能特性

- **🔍 智能代码索引** — 自动索引 JS/TS/Python/Java/Kotlin/Go/Rust 符号
- **🔗 依赖分析** — AST 级 import/export 解析，计算变更影响范围
- **⚡ 验证建议** — `audit-diff` 自动生成 smoke → focused → full 验证命令
- **🧠 融合风险判断** — `compositeRisk` 融合结构影响 + 测试映射 + Git 历史风险
- **📦 技术栈自动检测** — 识别项目技术栈并生成可执行验证命令

## 快速开始

```bash
npm install
node cli.js audit-summary --cwd . --json --quiet
```

可选诊断工具：
```bash
pip install ruff pyright        # Python
npm install -g eslint typescript # Node
```

## CLI 命令

| 命令 | 描述 |
|------|------|
| `workspace-info` | 检测工作区根目录和技术栈 |
| `diagnostics` | 运行 quick/full 诊断 |
| `audit-summary` | 聚合 health + dead exports + unresolved + cycles |
| `audit-file --file` | 聚合 impact + affected tests |
| `audit-diff` | 聚合当前 git 变更 + 验证建议 |
| `audit-overview` | 项目全景视图（热区、稳定性、孤儿检测） |
| `health` | 汇总项目健康度 |
| `deps` | 检查过时依赖 |
| `dead-exports` | 查找死导出候选 |
| `unresolved` | 查找未解析 import |
| `cycles` | 查找循环依赖 |
| `impact --file` | 分析文件影响半径 |
| `affected-tests --file` | 分析受影响测试 |

示例：

```bash
node cli.js audit-diff --cwd . --json --quiet
```

聚合命令返回结构化摘要，包含 `summary.severity`、`summary.nextSteps` 和各阶段可执行命令：

```json
{
  "validationAdvice": {
    "changeType": "code",
    "stack": { "profile": "mixed", "node": { ... }, "python": { ... } },
    "commands": {
      "smoke": [{ "name": "lint", "cmd": "npx eslint cli.js" }],
      "focused": [{ "name": "run-direct-tests", "cmd": "npm run test:functionality" }],
      "full": [{ "name": "run-all-tests", "cmd": "npm run test" }]
    }
  }
}
```

默认使用顺序：
1. `audit-summary` — 先看整体健康度
2. `audit-file --file ...` — 聚焦单文件影响
3. `audit-diff` — 基于当前改动做验证

对于 mixed repo，用 `--exclude` 过滤参考目录，或在根目录放置 `.workspace-bridge.json`：

```json
{
  "directories": {
    "reference": ["prototypes", "reference", "examples"],
    "archive": ["archive", "legacy"],
    "generated": ["dist", "build", ".next"]
  }
}
```

## 适用场景

| 项目规模 | 推荐度 | 注意事项 |
|----------|--------|----------|
| 小型（<100文件） | ✅ 推荐 | 直接使用 |
| 中型（100-500文件） | ✅ 可用 | 使用 `--exclude` 过滤参考目录 |
| 大型（>500文件） | ⚠️ 谨慎 | 首次索引较慢，建议定期清理缓存 |
| 混合仓库 | ⚠️ 需配置 | 创建 `.workspace-bridge.json` 标注目录角色 |

## 路线图

- [X] CLI-first 聚合审计：`audit-summary` / `audit-file` / `audit-diff` / `audit-overview`
- [X] JS/TS/Python/Java AST 级 symbol-level impact
- [~] Kotlin/Go/Rust L2 regex 级支持（需 AST 升级达到同等精度）
- [ ] mixed repo 技术栈检测与验证命令继续打磨

更多项目背景、开发原则与架构取舍见 [AGENTS.md](./AGENTS.md)。

## 许可证

MIT

