# 技术债与代码气味地图

> 本文档记录当前活跃的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。
> 最后审查：2026-05-02

---

## 按铁律分类的问题

### 1. "消除边界情况 > if" — 部分失守

- `src/cli/formatters/composite-risk.js` `buildCompositeRisk()` — 分数累加仍是一堆 if-else（唯一剩余；等新增第 6 种评分维度时统一重构）

---

## 文件级雷区地图

| 文件 | 行数 | 风险 | 状态 |
|------|------|------|------|
| `src/utils/path.js` | 215 | **最高** | 最底层基础设施 |
| `src/services/dep-graph.js` | ~760 | **高** | 核心引擎类 |
| `src/cli/formatters/` | ~920 | 中 | 已拆分：7 文件 + index.js |
| `src/utils/stack-detector.js` | ~630 | 中 | 已配置表化 |
| `src/tools/overview-tools.js` | ~749 | 中 | 已配置表化 |
| `src/tools/git-tools.js` | ~640 | 中 | `getChangedFiles()` 手动字符级解析（与轻量理念冲突，但当前正确） |
| `cli.js` | ~599 | 中 | 命令分发中心；裸数字已归一化到 `constants.js` |

---

## 追加发现

### 超大文件评估

以下文件超过 AGENTS.md 500 行阈值，1.0 前应评估拆分必要性：
- `src/services/dep-graph.js` (~760 行)
- `src/tools/overview-tools.js` (~749 行)
- `src/tools/git-tools.js` (~640 行)
- `src/utils/stack-detector.js` (~630 行)
- `src/services/file-index.js` (~510 行)

**结论**：dep-graph.js 和 overview-tools.js 优先评估。dep-graph.js 是单一类 `DependencyGraph`，方法间共享大量内部状态，强行拆分会破坏内聚；overview-tools.js 已按功能域拆分出多个纯函数（`buildHotspot*`, `buildStability*`, `renderOverviewDashboard`），当前状态可接受。

---

*注：本文档只记录当前活跃债务。修复时应优先写失败测试（red），再动实现（green）。*
