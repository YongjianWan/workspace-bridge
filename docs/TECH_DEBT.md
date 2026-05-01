# 技术债与代码气味地图

> 本文档记录当前活跃的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。
> 最后审查：2026-05-02

---

## 按铁律分类的问题

### 1. "消除边界情况 > if" — 部分失守

- `src/cli/formatters/composite-risk.js` `buildCompositeRisk()` — 分数累加仍是一堆 if-else（唯一剩余；等新增第 6 种评分维度时统一重构）
- `src/cli/formatters/audit-diff-summary.js` `classifyChangeType()` — 当前 `fileRole` 优先，但仍需提升精度（下一步任务见 [ROADMAP.md §P0](../ROADMAP.md)）

---

## 文件级雷区地图

| 文件 | 行数 | 风险 | 状态 |
|------|------|------|------|
| `src/utils/path.js` | 215 | **最高** | 最底层基础设施 |
| `src/services/dep-graph.js` | ~680 | **高** | 核心引擎类 |
| `src/cli/formatters/` | ~920 | 中 | 已拆分：7 文件 + index.js |
| `src/utils/stack-detector.js` | ~630 | 中 | 已配置表化 |
| `src/tools/overview-tools.js` | ~720 | 中 | 已配置表化 |
| `src/tools/git-tools.js` | ~610 | 中 | `getChangedFiles()` 手动字符级解析（与轻量理念冲突，但当前正确） |

---

## 追加发现

### `better-sqlite3` 重依赖

`better-sqlite3` 是需要 native 编译的重依赖，但只在 `editor-state.js`（327 行）中使用。而 `editor-state.js` 已被 container 默认禁用，`AGENTS.md` 明确说"价值一般，后续可能继续降权甚至删掉"。

**结论**：删掉 `editor-state.js` 时，`better-sqlite3` 应同步从 `package.json` 移除，安装速度提升明显。

### `search-tools.js` ReDoS 保护是事后检测

`safeRegexTest()` 的 `Date.now()` 检查写在 `pattern.test()` **之后**。灾难性回溯时会阻塞事件循环，超时检查无法执行。

当前缓解：text 搜索改用 `String.prototype.includes`；`safeRegexTest` 注释已诚实化，标注为"事后慢查询检测"。真正的防线仍是上游 `validateQuery()` + `escapeRegex()`。

---

*注：本文档只记录当前活跃债务。修复时应优先写失败测试（red），再动实现（green）。*
