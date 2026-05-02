# workspace-bridge

一个用于 AI 编程助手的工作区分析引擎，当前只保留本地 CLI + skill 工作流。

给本地 AI coding agent 补跨文件视角和变更验证建议的 CLI 工具。支持 JS/TS/Python/Java/Kotlin/Go/Rust。

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

## 核心命令

```bash
node cli.js audit-summary --cwd .    # 整体健康度
node cli.js audit-file --file <path> # 单文件影响
node cli.js audit-diff --cwd .       # 当前 git 变更 + 验证建议
node cli.js audit-overview --cwd .   # 项目全景（热区、孤儿文件）
```

完整命令列表、参数说明与 `.workspace-bridge.json` 配置见 [skills/workspace-audit/SKILL.md](./skills/workspace-audit/SKILL.md)。

## 适用场景

| 项目规模 | 推荐度 | 注意事项 |
|----------|--------|----------|
| 小型（<100文件） | ✅ 推荐 | 直接使用 |
| 中型（100-500文件） | ✅ 可用 | 使用 `--exclude` 过滤参考目录 |
| 大型（>500文件） | ⚠️ 谨慎 | 首次索引较慢，建议定期清理缓存 |
| 混合仓库 | ⚠️ 需配置 | 创建 `.workspace-bridge.json` 标注目录角色 |

## 相关文档

- [AGENTS.md](./AGENTS.md) — 开发原则、架构决策、当前状态
- [ROADMAP.md](./ROADMAP.md) — 长期路线与未竟事项
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更历史
- [skills/workspace-audit/SKILL.md](./skills/workspace-audit/SKILL.md) — 完整命令契约与使用指南

## 许可证

MIT








