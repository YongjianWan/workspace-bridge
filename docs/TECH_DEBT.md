# 技术债与代码气味地图

> 本文档记录当前活跃的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。
> 最后审查：2026-05-04

---

## 按铁律分类的问题

### 1. "消除边界情况 > if" — 部分失守

- `src/cli/formatters/composite-risk.js` `buildCompositeRisk()` — 分数累加仍是一堆 if-else（唯一剩余；等新增第 6 种评分维度时统一重构）

---

## 文件级雷区地图

| 文件 | 行数 | 风险 | 状态 |
|------|------|------|------|
| `src/services/dep-graph.js` | ~760 | **高** | 核心引擎类，单一 `DependencyGraph` 类，方法间共享内部状态 |
| `src/tools/overview-tools.js` | ~749 | 中 | 已按功能域拆分出多个纯函数，当前可接受 |
| `src/tools/git-tools.js` | ~640 | 中 | `getChangedFiles()` 手动字符级解析（与轻量理念冲突，但当前正确） |
| `cli.js` | ~600 | 中 | 命令分发中心；裸数字已归一化到 `constants.js` |
| `src/utils/stack-detectors/detect.js` | ~396 | 低 | 已从 stack-detector.js 拆分，检测逻辑内聚 |
| `src/utils/stack-detectors/commands.js` | ~433 | 低 | 已从 stack-detector.js 拆分，命令生成内聚 |
| `src/services/file-index.js` | ~450 | 低 | 已从 ~523 行降下，extractSymbols 外移至注册表 |

**已解决**：`stack-detector.js`(835→14) 和 `file-index.js`(523→450) 均已完成拆分/重构。

---

## 追加发现

### 超大文件评估

以下文件超过 AGENTS.md 500 行阈值，当前状态：
- `src/services/dep-graph.js` (~760 行) — **唯一剩余超大文件**。单一类 `DependencyGraph`，方法间共享大量内部状态（`graph`、`reverseGraph`、`symbolIndex` 等），强行拆分会破坏内聚。建议保持现状，优先从「减少方法复杂度」而非「物理拆分文件」角度优化。
- `src/tools/overview-tools.js` (~749 行) — 已按功能域拆分出多个纯函数，当前状态可接受。
- `src/tools/git-tools.js` (~640 行) — `getChangedFiles()` 的手动字符级解析是已知债务，但功能正确且测试覆盖，当前不优先处理。
- `cli.js` (~600 行) — 命令分发中心，每个分支极短，行数来自命令数量而非单个函数膨胀。

---

## 已清零债务（本轮三轮审查）

| 原债务 | 修复方式 | 文件 |
|--------|----------|------|
| stack-detector.js 835 行膨胀 | 拆为 detect.js + commands.js | `src/utils/stack-detectors/` |
| extractSymbols 6 分支 else-if | 注册表驱动外移 | `src/services/file-index/symbol-extractors.js` |
| hasGoProject / detectGoModules 重复遍历 | hasGoProject 复用 detectGoModules | `detect.js` |
| Node/Go/Rust 命令生成重复 | 提取纯函数 | `commands.js` |
| DEFAULT_EXCLUDE_DIRS 项目特定目录 | 移除 test-temp / wb-analysis-fixture | `file-index.js` |
| cache.js 同步阻塞 | async save() + fs.promises | `cache.js` |
| cache.js 加载防御缺失 | Array.isArray 检查 | `cache.js` |
| REPL SIGINT 泄漏 | rl.on('SIGINT') | `repl.js` |
| watch.js shutdown 挂起 | try-catch | `watch.js` |
| container.js shutdown 不安全 | 每步独立 try-catch | `container.js` |
| dep-graph.js 引用污染 | { ...cached } 浅拷贝 | `dep-graph.js` |
| semgrep.js 过度防御 | 先解析再判断 | `semgrep.js` |
| file-index.js node_modules 冗余 | 删除特殊分支 | `file-index.js` |
| file-index.js handleFileChange 漏清 | _removeCacheEntry() | `file-index.js` |
| file-index.js 死代码 | 删除 findSymbol/searchSymbols/getFileSymbols | `file-index.js` |
| command.js Windows 解析 | 只给 npm/npx 加 .cmd | `command.js` |
| Linux watcher 禁用 | 运行时探测 | `file-index.js` |
| hasGradlePlugin 循环编译 | 正则提到循环外 | `detect.js` |
| scoreHighlightedFile 裸数字 | HIGHLIGHT_SCORES 注册表 | `constants.js` + `project-map.js` |
| project-map.js / overview-tools.js orphan 不一致 | 同步移除 wb-analysis-fixture | `project-map.js` + `overview-tools.js` |
| watch.js originalCallback dead code | 删除参数 | `watch.js` |
| cli.js printUsage 缺文档 | 补 --config / --language | `cli.js` |

---

*注：本文档只记录当前活跃债务。修复时应优先写失败测试（red），再动实现（green）。*
