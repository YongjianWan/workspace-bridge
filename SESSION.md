# SESSION.md

> 本轮会话上下文。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。

## 基线状态

- 测试：**41/41 PASS**
- 版本：**v1.0.2**（待打 tag）
- 分支：`main`，已 push origin

## 本轮完成（v1.0.2 — 删除 CodeQL + 文档精简 + GitNexus 参考）

| 事项 | 关键文件 | 说明 |
|------|----------|------|
| 删除 CodeQL adapter | `src/adapters/codeql.js`（删除） | ROI 极低：>500MB 安装、5-10min 运行、208 行高维护成本 |
| 保留 Semgrep | `src/adapters/index.js` | audit-security 退化为 Semgrep-only，足够轻量 |
| CLI 清理 | `cli.js` | 删除 `--db-path`、`--force-refresh`；保留 `--language` 给 Semgrep |
| security-tools 清理 | `src/tools/security-tools.js` | 删除 `dbPath` / `forceRefresh` 透传；message 改为仅提示 Semgrep |
| 测试清理 | `test/security-adapter-test.js` | 删除 CodeQL 测试，保留 Semgrep + auditSecurity 核心测试 |
| .gitignore 清理 | `.gitignore` | 删除 `.codeql/` |
| AGENTS.md 更新 | `AGENTS.md` | 外部工具策略表删除 CodeQL 引用 |
| CHANGELOG 去重 | `CHANGELOG.md` | 删除重复 `[1.0.0]` 块；新增 `[1.0.2]` 删除 CodeQL 条目 |
| RELEASE_NOTES 更新 | `RELEASE_NOTES.md` | 新增 v1.0.2 删除说明 + 迁移指南；保留历史 1.0.0/1.0.1 记录 |
| ROADMAP 精简 | `ROADMAP.md` | 已知限制删除 ✅ 已完成项；P5 删除 obsolete planned 块；1.0 发布准备归档；成功标准 #6 更新 |
| USAGE_PROOF 标记 | `docs/USAGE_PROOF.md` | 顶部加 DEPRECATED，指向 AGENTS.md + self-audit |
| GitNexus clone | `reference/GitNexus/` | 作为架构参考（语言注册表、图双索引、框架 extractor） |

## 仍未处理的 review 项

| 项 | 卡点 |
|----|------|
| `DB_TIMEOUT_MS = 300000` 改成 option | UX 选择：CLI flag / env var（当前仅存于 SemgrepAdapter，若 Semgrep 也删则无需处理） |
| `getJavaCommands` Gradle 两分支去重 | 纯美容，无功能问题 |
| `classifyChangeType` `mainlineCount === 0` 显式处理 | 需看 entries 上下文确认是否真有空集场景 |

## 验证命令

```bash
npm run test:all          # 41/41 绿
npm run self-audit        # 自审通过
node cli.js audit-summary --cwd . --json --quiet | jq '.deadExports.deadExportCount'  # 0
```

---

*Last updated: 2026-05-03（v1.0.2 CodeQL 删除 + 文档精简 + GitNexus 参考）*
