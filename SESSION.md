# 会话交接指令

> 生成时间：2026-04-29
> 当前版本：v0.8.2+
> 会话主题：P0T5 内部函数调用链追溯 + P3 CJS 导出识别 + P1.5 audit-map 全局地图

---

## 1. 项目当前状态

**workspace-bridge** 是 CLI-first 工作区分析引擎，当前 v0.8.2+。

### 已完成（本轮）

| 事项 | 状态 | 关键文件 | 提交 |
|------|------|----------|------|
| P0T5 内部函数→测试映射 | ✅ | `function-impact.js` DFS 调用链 + `cli.js` mode 识别 | 3614e16 |
| P3 CJS 符号解析补全 | ✅ | `parsers.js` `module.exports = { fn }` + `symbol-impact.js` `buildFunctionToDependents` | 3614e16 |
| P1.5 `audit-map` 全局地图 | ✅ | `audit-formatters.js` `buildProjectMap()` + `cli.js` case | a3ad106 |
| JS/TS `functionRecords` 索引 | ✅ | `parsers.js` 收集所有 `FunctionDeclaration`/`FunctionExpression` + callCallees | 3614e16 |

### 待完成（按 ROADMAP 价值排序）

| 任务 | 优先级 | 说明 |
|------|--------|------|
| P1 Java/Go/Rust 使用点解析 | P1 | 消除 dead-export 系统性误报（实例调用不在 import 记录中） |
| P3 影响路径解释字段 | P1 | `impact` 数组增加 `reason` + `importedSymbols` + `via` |
| P3 变更影响解释链（聚合） | P1 | `audit-diff` 输出可读因果链 |
| P2 构建/测试命令智能化 | P2 | Gradle 任务发现、Go package 聚合、Rust workspace 子 crate |
| P3 耦合拆分建议去模板化 | P2 | `audit-overview` `couplingSplitSuggestions` 根据出入度生成针对性建议 |
| P4 Kotlin AST / 大仓库性能 / 注册表 | P3 | 技术债，不急 |

---

## 2. 快速验证命令

```bash
# 全量回归（20 项，必须绿）
npm run test:all

# 官方自审（~25s）
npm run self-audit

# P1.5 验收
node cli.js audit-map --cwd . --json --quiet

# P0T5 验收（需临时改 resolvers.js 内部函数）
node cli.js audit-diff --cwd . --json --quiet

# 性能基准
npm run benchmark:perf
```

---

## 3. 关键代码落点

### P0T5：内部函数调用链追溯
- `src/services/dep-graph/parsers.js` — `functionRecords`（所有函数定义 + `callCallees`）
- `src/services/dep-graph/function-impact.js` — `getChangedFunctionImpact()` DFS 向上追溯导出调用者
- `src/services/dep-graph/symbol-impact.js` — `buildFunctionToDependents()` 同时参考 `functionRecords`
- `cli.js` — `internal-function-call-chain` mode 触发 `functionLevelAffectedTests`

### P3：CJS 导出识别
- `src/services/dep-graph/parsers.js` — `visitNode()` 中 `AssignmentExpression` 分支识别 `module.exports = { fn }` / `exports.fn = ...`

### P1.5：全局项目地图
- `src/cli/audit-formatters.js` — `buildProjectMap()` 聚合 tree + edges + issueOverlay
- `cli.js` — `audit-map` case 调用 `buildProjectMap(container.depGraph)`

### 已知限制（未变）
- `parsers.js` 876 行，唯一超 500 行铁律的文件，后续应拆成按语言的 dispatch 表
- `src/services/dep-graph.js` 711 行，接近上限

---

## 4. 下轮建议

**首选：P1 Java/Go/Rust 使用点解析**
- 问题：实例调用 `foo.bar()` 不在 import 记录中，导致 dead-export 系统性误报
- 思路：轻量扫描符号使用（不需要完整 AST），标记      被使用过的符号不判为 dead-export
- 落点：`src/services/dep-graph.js` `findDeadExports()`
- 验收：`audit-summary` 的 deadExports 数量对本项目更合理（当前 3 个，需判断是否为真误报）

**次选：P3 影响路径解释字段**
- 问题：`impact` 数组只有 `file` 和 `level`，没有 `why`
- 思路：`getImpactRadius()` 增加 `reason` + `importedSymbols` + `via` 字段
- 落点：`src/services/dep-graph.js` `getImpactRadius()`

---

## 5. 架构决策

### 5.1 外部工具集成策略（不变）

| 维度 | 策略 | 理由 |
|------|------|------|
| 依赖图 | **自研** | 多语言统一是壁垒 |
| 增量分析 | **自研** | git diff 驱动 <200ms 是护城河 |
| 风格/质量 | **自研 + Semgrep 可选** | 你管格式，Semgrep 管规则库 |
| 精确影响/污点 | **CodeQL 后端 + adapter** | 承认打不过 |
| tree-sitter | **不引入** | Python 标准库 `ast` 已够用；native binding 放大 Windows 中文路径风险 |

### 5.2 文件拆分（待执行）

- `parsers.js` 876 行，唯一超 500 行铁律的文件
- 建议拆成按语言的 dispatch 表（`src/parsers/js.js`、`python.js`、`java.js`...），但等 P1（使用点解析）稳定后再拆，避免图逻辑变动时跨文件重构

---

## 6. 本轮教训

1. **问题描述必须精确** — P0T5 最初描述为 "affectedTests 为 0"，实际为 "functionLevelAffectedTests 为 0"。文件级 affectedTests 通过依赖图一直正常工作。描述不精确会导致解法方向误判。
2. **P0T5 依赖 P3 才能闭环** — `resolvers.js` 使用 CJS `module.exports`，没有 CJS 导出识别，调用链追溯找不到导出终点。两个任务耦合，必须同轮完成。
3. **测试 mock 数据必须真实** — `test/p0t5-internal-function-impact-test.js` 最初 `functionRecords` 缺少 `kind` 字段，测试通过但真实场景失败。mock 数据应与生产产出一致。
4. **Windows 路径大小写陷阱** — `workspaceRoot` 是 `C:\...`（大写），graph key 是 `c:/...`（小写），`startsWith` 直接失败。路径比较必须 `toLowerCase()`。
5. **PowerShell 管道输出 UTF-16 LE** — `node cli.js ... > file.json` 在 PowerShell 中输出 UTF-16 LE BOM，JSON.parse 失败。验证脚本应使用 `fs.writeFileSync` 或 `execSync` + Node.js 处理。

---

*Last updated: 2026-04-29*
