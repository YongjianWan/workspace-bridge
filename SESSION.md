# 会话交接指令

> 生成时间：2026-04-28
> 当前版本：v0.8.2
> 会话主题：workspace-bridge Phase 0-1 止血 + P1 包级解析器 + 代码审核闭环

---

## 1. 项目当前状态

**workspace-bridge** 是 CLI-first 工作区分析引擎，当前 v0.8.2。

### 已完成（本轮及上轮延续）

| 事项 | 状态 | 关键文件 |
|------|------|----------|
| W2T3 命令建议质量收口 | ✅ | `src/utils/stack-detector.js` |
| W2T4 发布前总回归 | ✅ | `npm run test:all` 18 项全绿 |
| P1 包级解析器（Go/Rust） | ✅ | `src/services/dep-graph/resolvers.js` |
| P0T1 临时文件过滤 | ✅ | `src/tools/git-tools.js` |
| P0T2 文件角色分类修正 | ✅ | `src/utils/project-context.js` + `src/services/dep-graph.js` |
| P0T3 自定义测试脚本识别 | ✅ | `src/utils/stack-detector.js`（`test`/`test:*`，排除 pretest） |
| P0T4 变更类型判断修正 | ✅ | `src/cli/audit-formatters.js` + `src/utils/project-context.js` |
| 44b1780 审核修复 | ✅ | goModCache mtime、Rust super:: src/边界、self-audit 污染检测 |
| b4e97e7 最终修复 | ✅ | functionality-test 干净工作区兼容 |

### 待完成（留给下轮）

| 任务 | 优先级 | 说明 |
|------|--------|------|
| P0T5 Diff test mapping 激活 | P0 | 内部函数改动（如 `readGoMod`）时 `affectedTests` 不应恒为 0。需追踪内部函数调用链 → 找到调用它的导出函数 → 映射 dependents。落点：`src/services/dep-graph.js` `getChangedFunctionImpact()` |
| P1.5 `audit-map` 命令 | P1 | 聚合 `tree` + `edges` + `issueOverlay`，数据已存在只需序列化 |
| P3 CJS 符号解析补全 | P1 | `parsers.js` 识别 `module.exports = { fn }`，使 `symbolToDependents` 不再为空 |
| P1 使用点解析 | P2 | Java/Go/Rust 轻量符号使用扫描，消除 dead-export 误报 |

---

## 2. 快速验证命令

```bash
# 全量回归（必须绿）
npm run test:all

# 官方自审（~30s，已验证通过）
npm run self-audit

# 性能基准
npm run benchmark:perf

# 关键专项测试
node test/java-parsers-test.js
node test/java-resolver-test.js
node test/java-dead-export-test.js
node test/java-gradle-checkstyle-test.js
node test/gors-stack-detection-test.js
node test/gors-resolver-test.js
node test/w2t3-command-quality-test.js
node test/phase01-quality-test.js
```

---

## 3. 文档结构（精简后）

| 文件 | 角色 | 行数 |
|------|------|------|
| **AGENTS.md** | 唯一根入口（状态/原则/重点/品味） | ~220 |
| **README.md** | 使用入口（安装/命令/场景） | ~100 |
| **SKILL.md** | 独立命令契约（模式/输出/排障） | ~240 |
| **ROADMAP.md** | 未竟事项（Phase 0-1 + P1-P4） | ~110 |
| **CHANGELOG.md** | 历史版本 | ~125 |
| **docs/plans/** | 决策摘要 | ~50/篇 |

**注意**：AGENTS.md 已更新铁律——文件 < 500 行、注释写"为什么"。

---

## 4. 关键代码落点

### 多语言解析
- `scripts/java_ast_parser.py` — javalang AST 解析
- `src/services/dep-graph/parsers.js` — parseJava(parseMode='ast'/'regex') + parseKotlin/Go/Rust
- `src/services/dep-graph/resolvers.js` — resolveJavaImport(多模块source root) + resolveGo/RustImport

### dead-export 保守策略
- `src/services/dep-graph.js` 第529-533行：Java AST 跳过方法级 dead-export 判定

### 命令生成
- `src/utils/stack-detector.js` — generateCommands()，getJavaCommands() 已分 Maven/Gradle

### Phase 0-1 止血
- `src/tools/git-tools.js` — `getChangedFiles()` 过滤 `.tmp-*` / `cache.tmp-*`
- `src/utils/project-context.js` — `inferFileRole()` 识别 docs/config/entry/test
- `src/cli/audit-formatters.js` — `classifyChangeType()` 尊重 `fileRole === 'docs'`

---

## 5. 下轮建议

**首选**：推进 **P0T5**（Diff 场景 test mapping 激活）。
- 落点：`src/services/dep-graph.js` `getChangedFunctionImpact()`
- 思路：内部辅助函数改动时，向上追溯调用链，找到调用它的导出函数，再映射 dependents
- 验收：改 `resolvers.js` 中 `readGoMod` 时，`affectedTests` 包含 `test/gors-resolver-test.js`

**次选**：推进 **P1.5 audit-map** 或 **P3 CJS 符号解析**。

---

## 6. 架构决策（待下轮确认）

### 6.1 文件拆分：从"按功能"到"按语言"

当前结构是"功能 × 语言"的二维矩阵（parsers.js 876 行、resolvers.js 286 行、stack-detector.js 549 行）。按语言拆成目录的收益：
- 加一种语言 → 新增一个目录，不碰现有文件
- 每种语言的 workaround 关在笼子里
- parsers.js 从 900 行变成 30 行的 dispatch 表

**风险**：P0T5（内部函数→测试映射）还没做，如果先拆后改图逻辑，会更痛苦。

**建议顺序**：
1. 先完成 P0T5（图逻辑稳定后再拆）
2. 先拆 `parsers.js`（唯一超 500 行铁律），其他文件暂缓
3. 通用函数（`createImportRecord`、`uniqueNames`）提到 `_shared.js`

### 6.2 外部工具集成策略

| 维度 | 策略 | 理由 |
|------|------|------|
| 依赖图 | **自研** | 多语言统一是壁垒 |
| 风格/质量 | **自研 + Semgrep 可选** | 你管格式，Semgrep 管规则库 |
| 安全/死循环 | **自研为主** | 够用就行 |
| 精确影响/污点 | **CodeQL 后端 + adapter** | 承认打不过，但包装成你的格式 |
| 增量分析 | **自研，不接外部** | git diff 驱动是核心优势 |

**下一步**：写 `adapters/codeql.js`，把 SARIF 翻译成紧凑标签行。让 AI 看到的是统一的 `[RISK][HIGH] file:line`，但底层是 CodeQL 在算。

## 7. 本轮教训

1. `functionality-test.js` 的 `audit-diff` 断言假设工作区有改动——已在 `try/finally` 中临时修改 `README.md` 解决。
2. `startsWith('test')` 会误匹配 `pretest`——已改为 `key === 'test' || key.startsWith('test:')`。
3. Rust `super::` 解析需限制不越过 `src/`——已加 `!parent.startsWith(srcRoot)` 边界。
4. 模块级缓存需 mtime 失效——`readGoMod` 已加 `statSync` 检查。

---

*Last updated: 2026-04-28*
