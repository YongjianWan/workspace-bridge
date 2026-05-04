# SESSION.md

> 本轮会话上下文。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。

## 基线状态

- 测试：**43/43 PASS**
- 版本：**v1.0.3**（待打 tag）
- 分支：`main`，已 push origin

## 本轮完成（v1.0.3 — 债务清理 + 混合仓库误判修复 + 文档精简 + GitNexus 参考）

见下方「会话延续」段落。

| 事项 | 关键文件 | 说明 |
|------|----------|------|
| 删除 CodeQL adapter | `src/adapters/codeql.js`（删除） | ROI 极低：>500MB 安装、5-10min 运行、208 行高维护成本 |
| 保留 Semgrep | `src/adapters/index.js` | audit-security 退化为 Semgrep-only，足够轻量 |
| CLI 清理 | `cli.js` | 删除 `--db-path`、`--force-refresh`；保留 `--language` 给 Semgrep |
| security-tools 清理 | `src/tools/security-tools.js` | 删除 `dbPath` / `forceRefresh` 透传；message 改为仅提示 Semgrep |
| 测试清理 | `test/security-adapter-test.js` | 删除 CodeQL 测试，保留 Semgrep + auditSecurity 核心测试 |
| .gitignore 清理 | `.gitignore` | 删除 `.codeql/` |
| AGENTS.md 更新 | `AGENTS.md` | 外部工具策略表删除 CodeQL 引用；自分析骨架加 `<!-- generated -->` |
| CHANGELOG 去重 | `CHANGELOG.md` | 删除重复 `[1.0.0]` 块；新增 `[1.0.2]` 删除 CodeQL 条目；新增 `[1.0.3]` 债务清理 |
| RELEASE_NOTES 更新 | `RELEASE_NOTES.md` | 新增 v1.0.2 删除说明；保留历史记录 |
| ROADMAP 精简 | `ROADMAP.md` | 已知限制删除 8 条 ✅ 已完成项；P5 删除 obsolete planned 块；1.0 发布准备归档；成功标准 #6 更新 |
| USAGE_PROOF 标记 | `docs/USAGE_PROOF.md` | 顶部加 DEPRECATED，指向 AGENTS.md + self-audit |
| GitNexus clone | `reference/GitNexus/` | 作为架构参考 |
| `mainlineCount === 0` 处理 | `src/cli/formatters/audit-diff-summary.js` | 无主线文件时返回 `'docs'`（最轻验证模板），避免 reference 变更触发全量回归 |
| Gradle 去重 | `src/utils/stack-detector.js` | 合并 `getJavaCommands` 中 Gradle 子模块有无两个分支的重复代码 |
| 混合仓库误判修复 | `src/utils/project-context.js` | `prototypes` 从 `reference` hints 移到 `archive` hints；`classifyDirectory` 优先匹配用户配置规则 |
| 项目配置示例 | `.workspace-bridge.json` | 新增根目录配置，显式标注 `reference` / `prototypes` 为 archive |

## 仍未处理的 review 项

| 项 | 卡点 |
|----|------|
| `getJavaCommands` Gradle 两分支去重 | ✅ 已合并（提取公共变量 `compileTasks` / `testTasks` / `checkstyleTasks`） |
| `classifyChangeType` `mainlineCount === 0` 显式处理 | ✅ 已处理（返回 `'docs'`，补测试） |
| `DB_TIMEOUT_MS = 300000` 改成 option | ✅ 不再适用 — CodeQL 已删除 |

## 验证命令

```bash
npm run test:all          # 41/41 绿
npm run self-audit        # 自审通过
node cli.js audit-summary --cwd . --json --quiet | jq '.deadExports.deadExportCount'  # 0
```

---

## 会话延续（本轮新增）

| 事项 | 关键文件 | 说明 |
|------|----------|------|
| DEFAULT_EXCLUDE_DIRS 修复 | `src/services/file-index.js` | 移除上一轮清理残留时误加入的 `'gitnexus'`，该规则导致 GitNexus 项目被全盘跳过 |
| audit-map `--compact` 模式 | `cli.js`, `src/cli/formatters/project-map.js`, `src/cli/repl.js`, `test/audit-map-test.js` | 解决大项目信息爆炸问题。三轮压缩：① edges 聚合到目录级 + 删除文件元数据；② tree 变为纯目录骨架 + `highlightedFiles`；③ depth 限制为 2 + edges 聚合到模块级 + issueOverlay 裁剪 + highlightedFiles 上限 30 |
| REPL compact 支持 | `src/cli/repl.js` | `audit-map --compact` 可在 REPL 中使用 |
| SKILL.md 更新 | `skills/workspace-audit/SKILL.md` | 增加 Large Project Mode 使用说明 |
| archive 目录自动排除 | `src/services/file-index.js`, `src/utils/project-context.js` | `.workspace-bridge.json` 中标记为 reference/archive/generated 的目录不再被 file-index 扫描，减少构建时间和结果污染。自身项目 totalFiles 从 ~400 降到 98 |
| 大项目验证 | `reference/GitNexus/gitnexus` | GitNexus（954 文件）audit-map 从 28,818 行 -> **862 行**（~97% 压缩），AI 可消费 |

---

*Last updated: 2026-05-04（audit-map --compact 三轮压缩完成，GitNexus 862 行）*
