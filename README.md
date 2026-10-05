# workspace-bridge

一个用于 AI 编程助手的工作区分析引擎，当前只保留本地 CLI + skill 工作流。

给本地 AI coding agent 补跨文件视角和变更验证建议的 CLI 工具。支持 JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue SFC、Svelte，自动识别框架入口（Spring Boot、Django、Vue 等），消除死代码误报。

## 快速开始

> ⚠️ 本包**尚未发布到 npm registry**，请从源码安装。

### 从源码全局安装（推荐）

```bash
git clone https://github.com/YongjianWan/workspace-bridge.git
cd workspace-bridge
npm install
npm install -g .    # 注册 workspace-bridge-cli 全局命令
workspace-bridge-cli audit-overview --cwd <your-project> --json --quiet
```

### 本地直接使用（不装全局）

```bash
git clone https://github.com/YongjianWan/workspace-bridge.git
cd workspace-bridge
npm install
node cli.js audit-overview --cwd . --json --quiet
```

可选诊断工具：

```bash
pip install ruff pyright        # 可选：Python lint/type check
# Java/Python AST 使用随包提供的 tree-sitter WASM，无需额外安装 Python/JVM 解析器
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

`--save [file]` 只允许保存到 `--cwd` 工作区内，拒绝目录链接逃逸、文件符号链接和硬链接；已有文件必须符合本工具的基线格式，普通文件不会被覆盖。省略文件名时使用 `.workspace-bridge-baseline.json`。

内置 `audit-security` 的敏感规则将 `matchedText` 整体替换为 `[REDACTED]`，保留规则、文件与行号。自定义安全规则可声明 `sensitive: true`；这不代表扫描已覆盖所有密钥形态，规则召回限制仍见 TECH_DEBT。

Java 与 Python 解析默认走进程内 tree-sitter WASM；如果 WASM 加载或解析失败，才会显式降级为 `regex-fallback`。降级结果可用，但不能当成 AST 级字段或 golden snapshot 的等价结果。

当前结论：

- `dead-exports` 已有最小 ground-truth smoke，但它证明的是 corpus-level 的 precision/recall，而不是全局召回率。
- resolver 的真实风险是顺序语义；`alias`、`symbol-table`、fallback 的优先级变化必须用冲突矩阵锁住。
- Java/Python AST 的前提是随包提供的 tree-sitter WASM；出现 `regex-fallback` 时按 degraded mode 读结果，不要把 fallback 当成 AST 回归或等价结果。

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

| 字段          | 作用                                          |
| ------------- | --------------------------------------------- |
| `archive`   | 归档/历史代码目录，不参与主线分析和死代码检测 |
| `reference` | 参考实现/示例代码，不视为项目主线             |
| `generated` | 构建产物/生成代码，跳过孤儿文件和死代码检测   |

完整命令契约与使用指南见 [skills/workspace-audit/SKILL.md](./skills/workspace-audit/SKILL.md)。

## 适用场景

| 项目规模            | 推荐度      | 注意事项                                    |
| ------------------- | ----------- | ------------------------------------------- |
| 小型（<100文件）    | ✅ 推荐     | 直接使用                                    |
| 中型（100-500文件） | ✅ 可用     | 使用`--exclude` 过滤参考目录              |
| 大型（>500文件）    | ⚠️ 谨慎   | 首次索引较慢，建议定期清理缓存              |
| 混合仓库            | ⚠️ 需配置 | 创建`.workspace-bridge.json` 标注目录角色 |

## 相关文档

- [AGENTS.md](./AGENTS.md) — 开发原则、架构决策、当前状态
- [ROADMAP.md](./ROADMAP.md) — 长期路线与未竟事项
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更历史
- [skills/workspace-audit/SKILL.md](./skills/workspace-audit/SKILL.md) — 完整命令契约与使用指南

## 依赖与供应链

- 运行依赖 7 个，`package-lock.json` 全部从 `registry.npmjs.org` 解析并带 `integrity` 哈希；CI 用 `npm ci` 按锁文件安装，并在每个矩阵作业里运行 `npm audit --omit=dev --audit-level=high`（运行依赖出现 high 及以上即失败）。
- `tree-sitter-wasms@0.1.13`（Unlicense，仓库 `Gregoor/tree-sitter-wasms`）提供第三方预编译的 tree-sitter WASM 解析器，版本由锁文件固定；其构建过程没有逐文件复核，不可用时 CLI 按 `regex-fallback` 降级并在 `warnings[]` 里说明。

## 许可证

MIT
