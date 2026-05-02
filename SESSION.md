# SESSION.md

> 本轮会话上下文。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。

## 基线状态

- 代码干净：`git status` 无未提交改动
- 测试：**41/41 PASS**
- 版本：**v1.0.0**（已打 tag `v1.0.0`）
- 分支：`main`，ahead of origin by 10 commits

## 本轮完成（极简）

| 事项 | 关键文件 | 说明 |
|------|----------|------|
| 1.0 发布最后一公里 | `RELEASE_NOTES.md` / `CHANGELOG.md` / `ROADMAP.md` | Release Notes + breaking change 迁移指南 + `git commit` + `git tag v1.0.0` |
| Gradle 任务发现 | `src/utils/stack-detector.js` | 解析 `settings.gradle`/`settings.gradle.kts`，按子模块生成 `:app:test`/`:app:classes` 等精确命令 |
| Go module path 聚合 | `src/utils/stack-detector.js` | 检测嵌套 `go.mod`，生成 `cd <module> && go test ./...` |
| Rust 模块级测试过滤 | `src/utils/stack-detector.js` | 从文件路径推断模块名，`cargo test -p crate module_name` |
| 外部工具后端骨架 | `src/adapters/` / `src/tools/security-tools.js` | `BaseAdapter` + `SemgrepAdapter` + `CodeQLAdapter`(骨架) + `audit-security` 命令 |
| CodeQLAdapter 完整实现 | `src/adapters/codeql.js` | 自动语言检测、数据库创建/复用、SARIF v2.1.0 解析、severity 映射 |
| CLI 参数扩展 | `cli.js` | 新增 `--config` / `--language` / `--force-refresh` |
| Windows 平台适配 | `src/utils/command.js` | `resolveCommandForPlatform` 支持 `semgrep` / `codeql` 的 `.cmd` 后缀 |
| GitNexus 参考查看 | — | 通过 GitHub API 阅读语言注册表、知识图双索引、MCP 递进工具链、框架感知 Extractor |
| 测试补全 | `test/*` | `gradle-task-discovery-test.js` / `go-module-path-test.js` / `rust-module-filter-test.js` / `security-adapter-test.js` |
| 文档同步 | `CHANGELOG.md` / `ROADMAP.md` | P2 三项全部勾选，CHANGELOG 记录 v1.0.0 后 Unreleased 内容 |

## 关键决策记录

**为什么 CLI 瘦身取消？**

原计划把 23 个命令砍到 8 个。但用户明确说