# workspace-bridge

一个用于 AI 编程助手的工作区分析引擎，当前只保留本地 CLI + skill 工作流。

给本地 AI coding agent 补跨文件视角和变更验证建议的 CLI 工具。支持 JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue SFC、Svelte，自动识别框架入口（Spring Boot、Django、Vue 等），消除死代码误报。

## 快速开始

### 全局安装（推荐）

```bash
npm install -g workspace-bridge
workspace-bridge-cli audit-overview --cwd . --json --quiet
```

### 本地使用

```bash
git clone <repo>
cd workspace-bridge
npm install
node cli.js audit-overview --cwd . --json --quiet
```

可选诊断工具：
```bash
pip install ruff pyright        # Python
npm install -g eslint typescript # Node
```

## 核心命令

```bash
node cli.js audit-overview --cwd .   # 项目全景与整体健康度（热区、孤儿文件、死代码、循环依赖等）
node cli.js audit-file --file <path> # 单文件影响评估与验证建议
node cli.js audit-diff --cwd .                       # 当前 git 变更分析 + 验证建议
node cli.js audit-diff --cwd . --commits HEAD~5..HEAD  # 指定 commit range 变更分析
node cli.js audit-map --cwd .        # 全局项目依赖地图（大项目建议加 --compact）
node cli.js watch --cwd .            # 文件保存时自动打印变更影响面
node cli.js repl --cwd .             # REPL 交互查询模式
node cli.js repl --cwd . --eval "impact src/app.js"  # 非交互单命令（AI/CI 批量调用高效复用内存图）
```

完整命令列表、参数说明与 `.workspace-bridge.json` 配置见 [skills/workspace-audit/SKILL.md](./skills/workspace-audit/SKILL.md)。

## 配置

对于混合仓库（同时包含主代码、原型、参考实现、生成产物等），在项目根目录创建 `.workspace-bridge.json`：

```json
{
  "directories": {
    "archive": ["reference", "prototypes"],
    "reference": [],
    "generated": ["dist", "build", ".next", "coverage"]
  }
}
```

| 字段 | 作用 |
|------|------|
| `archive` | 归档/历史代码目录，不参与主线分析和死代码检测 |
| `reference` | 参考实现/示例代码，不视为项目主线 |
| `generated` | 构建产物/生成代码，跳过孤儿文件和死代码检测 |

完整命令契约与使用指南见 [skills/workspace-audit/SKILL.md](./skills/workspace-audit/SKILL.md)。

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
