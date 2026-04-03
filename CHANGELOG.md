# Changelog

所有版本变更记录。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.7.0] - 2026-04-03

### 新增

- **audit-overview** - 项目全景视图命令，输出：
  - 热区图（hotspotsByRisk）- 基于 Git 历史和依赖耦合度识别高风险文件
  - 稳定性趋势（stabilityCounts）- 综合测试覆盖、改动频率、循环依赖评分
  - 孤儿文件检测（orphans）- 发现可能未使用的文件
  - 架构建议（architectureAdvice）- 循环依赖重构建议、过度耦合模块拆分提示
- **可视化输出** - `audit-overview --format html` 生成交互式仪表板
- **技术栈检测增强** - 自动识别 Java（Maven/Gradle）、Python（Django/FastAPI/Flask）框架
- **函数级测试映射** - `audit-diff` 现在能精确映射变更函数到相关测试（JS/TS 支持）
- **AST 相似度检测** - 发现相似函数时给出参考实现提示（非强制，可选功能）
- **CLI 回退链** - `scripts/cli-fallback.js` 支持全局安装回退到本地 cli.js
- **Skill 标准化 v1** - `workspace-audit` skill 支持随机路径启动、标准输出契约

### 改进

- **性能基准** - 新增 500+ 文件性能测试脚本
- **benchmark 阈值策略** - 相对基线 + 30% 波动容忍，替代固定 500ms 阈值
- **混合仓库识别** - 自动检测 prototypes/examples 目录并降权处理
- **入口识别增强** - 支持框架配置文件（vite.config、manage.py 等）作为入口
- **缓存系统** - 内容哈希缓存，自动失效机制

### 变更

- **CLI-only** - 完全移除 MCP server，仅保留本地 CLI + skill 工作流
- **输出标准化** - 所有命令遵循 Scope/Top Risks/Actions/Validation/Confidence 契约

## [0.6.0] - 2026-03-27

### 新增

- **跨文件分析查询** - `dependency_graph` 工具新增三个 operation：
  - `dead_exports` - 查找未被引用的导出（confidence: high/medium）
  - `unresolved` - 查找解析失败的 import
  - `affected_tests` - 沿依赖图 BFS 查找受变更影响的测试文件
- **后台诊断缓存** - `diagnostics_live` 现在默认返回缓存结果（0ms），无缓存时调度后台检查
- **新增测试** - `test/analysis-test.js` 覆盖三个跨文件分析查询
- **配置集中化** - `diagnostics-engine.js` 和 `dep-graph.js` 添加 CONFIG 常量对象

### 改进

- **稳定性** - `server.js` 添加 SIGTERM 和 stdin close 处理，shutdown 添加 5 秒超时保护
- **性能** - `dep-graph.js` 使用异步 IO + 并发限制（20），避免大仓库阻塞事件循环
- **安全性** - `sanitize.js` 移除 shell arg 中的 `/` 和 `\` 允许，防止路径遍历绕过
- **错误处理** - `editor-state.js` 检测 SQLite magic bytes，明确返回 null 而不是假装成功

### 变更

- **Breaking** - `diagnostics_live` 的 `file` 参数改为 required，不再依赖 EditorState
- **版本** - 版本号更新至 0.6.0

### 修复

- 修复安全测试中 shell 参数消毒的绕过问题
- 修复跨平台测试中使用 `echo` 命令失败的问题（改用 `node -e`）
- 修复 `findDeadExports` 中 Map 迭代可能被修改的问题（使用 `Array.from()` 复制）

### 已知问题

- `editor-state.js` 模块当前不可用（VS Code state.vscdb 为 SQLite 二进制格式）
- `findDeadExports` 在无 AST 分析时误报率高，barrel exports 场景基本不可用
- `findUnresolvedImports` 内部仍有同步 IO（`fs.existsSync`）

---

## [0.5.1] - 2026-03-27

### 安全加固

- ReDoS 防护 - 正则查询添加 100ms 超时
- 错误信息脱敏 - 绝对路径和用户信息公开为 `<path>` / `<user>`
- 初始化竞争修复 - 所有工具添加 `await container.ensureReady()`
- 路径遍历防护 - `validateWorkspacePath()` 强制校验
- 命令注入防护 - 全部使用 `spawn` + 参数数组

---

## [0.5.0] - 2026-03-26

### 初始版本

- 11 个 MCP 工具：workspace_info、run_diagnostics、diagnostics_live、git_diff_summary、git_blame、git_history、search_code、lookup_symbol、project_health、check_dependencies、dependency_graph
- ServiceContainer 架构：WorkspaceCache、FileIndex、DiagnosticsEngine、EditorState、DependencyGraph
- 零运行时依赖
- 安全编码：参数化命令、路径校验、输入消毒

---

[0.7.0]: https://github.com/user/workspace-bridge/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/user/workspace-bridge/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/user/workspace-bridge/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/user/workspace-bridge/releases/tag/v0.5.0
