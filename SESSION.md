# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。

---

## 新会话启动检查表（必须执行）

```bash
# 1. 验证测试基线
npm run test:all          # 期望: 44/44 PASS

# 2. 验证自审基线
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExportCount=0, unresolvedCount=0, cycleCount=0, totalFiles≈98

# 3. 验证大项目 compact 可用性
node cli.js audit-map --cwd reference/GitNexus/gitnexus --compact --json --quiet
# 期望: 输出行数 < 1000, summary.severity 存在, highlightedFiles 按问题严重程度排序
```

**如果任何一步失败 → 先修基线，再做其他事。**

---

## 基线状态

- 测试：**44/44 PASS**
- 版本：**v1.0.3**（待打 tag）
- 分支：`main`，已 push origin
- 自身项目规模：98 文件，entry=4, library=37, test=45, script=12
- 健康度：5/5，0 死导出，0 循环，0 未解析

---

## 本轮完成（2026-05-04）

| 事项 | 关键文件 | 说明 |
|------|----------|------|
| `DEFAULT_EXCLUDE_DIRS` 修复 | `src/services/file-index.js` | 移除误加入的 `'gitnexus'` |
| audit-map `--compact` 三轮压缩 | `cli.js`, `src/cli/formatters/project-map.js`, `src/cli/repl.js` | 大项目信息压缩：tree depth≤2 + 模块级 edges + highlightedFiles 上限 30。GitNexus 28,818 → **862 行** |
| compact 问题驱动改造 | `src/cli/formatters/project-map.js`, `cli.js` | 新增 `summary` 字段（severity / issueCounts / nextSteps），human-readable 首行即 severity |
| archive 目录自动排除 | `src/services/file-index.js`, `src/utils/project-context.js` | `.workspace-bridge.json` 中 reference/archive/generated 不再被 file-index 扫描。自身 totalFiles ~400 → **98** |
| orphan 检测对齐 | `src/cli/formatters/project-map.js` | 修复 project-map 与 overview-tools 的 orphan 规则不一致（scripts/bin/benchmark 误报） |
| REPL compact 支持 | `src/cli/repl.js` | `audit-map --compact` 可在 REPL 使用 |
| SKILL.md 更新 | `skills/workspace-audit/SKILL.md` | 新增 Large Project Mode 文档 |
| AGENTS.md 骨架更新 | `AGENTS.md` | 自分析数据更新为 2026-05-04 |

---

## 已知陷阱（新 agent 必看）

| 陷阱 | 位置 | 如何避免 |
|------|------|----------|
| `DEFAULT_EXCLUDE_DIRS` 全局污染 | `src/services/file-index.js` | 任何新增排除项必须是通用目录名（如 `node_modules`），不能是项目特定名称（如 `gitnexus`） |
| orphan 检测不一致 | `project-map.js` vs `overview-tools.js` | 两处 orphan 逻辑必须保持同步（scripts/bin/benchmark/wb-analysis-fixture 跳过） |
| compact 模式只改 project-map.js | `cli.js` 也需要同步 | human-readable 输出和 `countTreeFiles()` 必须兼容 skeleton 模式（`totalFileCount`） |
| Windows PowerShell 管道 BOM | 所有 `node cli.js ... \| node -e` 命令 | PowerShell 管道传 JSON 会带 BOM，用 `cmd /c "... > file"` 再读文件 |

---

## 下一步方向（按价值排序）

### 高价值 / 低风险
1. **给 `audit-diff` 加 `--compact`** — 当变更涉及大量文件时压缩输出
2. **给 `watch` 命令加 `--compact`** — 大项目文件保存时 dependents 列表可能很长
3. **REPL 增加 `issues` / `top` 命令** — 快速查看 summary 级别的问题汇总

### 高价值 / 中风险
4. **Kotlin AST 级支持** — ROADMAP 唯一剩余 P4。但无成熟纯 Python Kotlin AST 解析器，可能需要 regex 增强或接受现状
5. **插件化解析器注册表** — 从硬编码 if-else 迁移到配置表驱动。工作量 >3 天

### 维护
6. **v1.0.3 打 tag 发布** — 当前 main 已稳定，可打 tag

---

*Last updated: 2026-05-04（收工状态：44/44 PASS, main push 完成）*
