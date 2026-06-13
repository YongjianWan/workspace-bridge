# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

> 当前无活跃的 L1 Blocker。

## L2 债务（阻塞演进或导致结果不可信）

> 当前无活跃的 L2 债务。

---

> **当前活跃债务总览**：L1 Blocker **0** | L2 债务 **0** | 架构债务 **1** | L3 品味问题 **1** | 合计 **2 项**

## 架构债务（不阻塞功能，但阻塞演进速度）

#### 框架检测 Query 基础设施（Phase 3 预备）
- **背景**：路由提取已成功完全 Query 化，但 [detectFrameworkFromContent](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/dep-graph/framework-patterns.js#L259) 框架检测目前仍使用轻量文本正则匹配（`AST_PATTERNS`）。
- **瓶颈**：Tree-sitter WASM 语法加载在 JS 环境中必须为异步（async），而当前的 `detectFrameworkFromContent` 及其上游调用链路（含 [builder.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/dep-graph/builder.js#L11) 和 [entry-detector.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/dep-graph/entry-detector.js#L12) 内的 known entry 判定）均是同步执行。
- **重构方向**：需将整个框架检测与 entry 判定链路进行同步转异步重构，从而能无缝接入已完成的 `queries/framework-detection` 目录下的 Tree-sitter AST queries，实现检测引擎的彻底统一，消除正则 fallback 噪音。

---

## L3 品味问题（建议修，非债务）

#### 弱断言分布 — 占总断言数 ~2.3%

**数据**：

| 弱断言模式                                      | 数量      | 风险等级 | 说明                                                          |
| ------------------------------------------ | ------- | ---- | ----------------------------------------------------------- |
| `typeof x === 'string'/'number'/'boolean'` | ~10 → 0 已清理 | 低    | 核心 schema 字段（severity/impactCount/affectedTestsCount 等）已升级为语义验证；剩余边缘字段维持 `typeof` 防御性检查         |
| `.status === 0`                            | 1       | 中    | `java-parsers-test.js` 环境检测逻辑 `isJavalangAvailable()`，非测试断言 |
| `!== null/undefined`                       | ~20     | 低    | 存在性检查，属防御性验证，不纳入弱断言统计                                       |
| `strictEqual(result.ok, true/false)`       | ~48     | 低    | 深层嵌套防御性检查，风险低，不纳入弱断言统计                                      |
| **合计弱断言（需修复）**                             | **~10** | —    | 从 ~44 处降至 ~10 处（仅余 `typeof` 型 schema 契约检查）                   |

---

## 文件级雷区地图

| 文件                                      | 行数   | 风险  | 状态                                                                                        |
| --------------------------------------- | ---- | --- | ----------------------------------------------------------------------------------------- |
| `src/tools/git-tools.js`                | ~392 | 低   | L2-9 commit range 源                                                                       |
| `src/utils/stack-detectors/detect.js`   | ~443 | 低   | stack-detector 检测子模块                                                                      |
| `src/utils/stack-detectors/commands.js` | ~639 | 低   | stack-detector 命令子模块                                                                      |

---

## 测试覆盖缺口

> 所有核心/分析模块均已实现专属/直接单元测试覆盖（无遗留的零专属测试模块）。

---

### Flaky 根因

| 测试文件           | 根因                           | 建议修复                                                            |
| -------------- | ---------------------------- | --------------------------------------------------------------- |
| `repl-test.js` | runner.js 串行执行时偶发失败；单独运行稳定通过 | 已记录于 SESSION.md §已知陷阱；若遇失败先重跑确认，再单独 `node test/repl-test.js` 验证 |

> CLI Dogfooding 历史缺陷已全部修复，并按"修复即删"铁律完成清理（历史详情归档于 [CHANGELOG.md](../CHANGELOG.md) [Unreleased]）。
> 仍在的已知限制与陷阱详见 [ROADMAP.md](../ROADMAP.md) §已知限制。

---

## 规格参考与边界行为（非债务，供 Agent 查阅）

### ✅ 已验证的边界安全行为 (Verified Safe Boundary Behaviors)

| # | 边界场景 | 结果 | 评估 |
|---|----------|------|------|
| 1 | **仅注释文件** | `severity=low`, `impact=0`, `affectedTests=0` | ✅ 正确处理 |
| 2 | **Shebang 脚本（无后缀）** | `file-fallback`, `reason="source-not-indexed"` | ✅ 正确处理 |
| 3 | **伪装成 `.js` 的二进制文件** | `file-fallback`, `reason="ast-unavailable"` | ✅ 优雅降级 |
| 4 | **UTF-16 BOM 文件** | `file-fallback`, `reason="ast-unavailable"` | ✅ 优雅降级 |
| 5 | **超大文件（5万行 / ~350KB）** | `file-fallback`, `reason="ast-unavailable"`, 无超时 | ✅ 性能安全 |
| 6 | **语法损坏的文件** | `file-fallback`, `reason="ast-unavailable"`, 不崩溃 | ✅ 优雅降级 |
| 7 | **符号链接 (Symbolic link)** | 解析至真实目标，正常分析 | ✅ 正确处理 |
| 8 | **表情/中文 Unicode 文件名** | 符号正常解析 | ✅ 正确处理 |
| 9 | **`--save /dev/null`** | 成功写入无报错 | ✅ 正确处理 |
| 10 | **自定义 `--cache-dir` + 删除重构** | 自动创建 `cache.db`，正常重构 | ✅ 正确处理 |
| 11 | **源文件修改后立即审计** | 结果实时反映变更 | ✅ 正确处理 |
| 12 | **极短时间内连续运行相同命令** | 命中缓存，结果稳定 | ✅ 正确处理 |

### 🔍 验证矩阵 (Validation Matrices & Behavior)

#### Exit Code 契约矩阵

| 执行情况 | 命令示例 | 实际退出码 | 预期语义 | 状态 |
|---|---|---|---|---|
| **干净运行** | `node cli.js audit-summary` | `0` | 执行成功 | ✅ Pass |
| **无问题 + 严格模式**| `node cli.js dead-exports --fail-on-findings` | `0` | 成功（未发现债务） | ✅ Pass |
| **发现债务 + 严格模式** | `node cli.js audit-summary --fail-on-findings` | `1` | 业务/校验失败 | ✅ Pass |
| **缺少参数** | `node cli.js impact` (无 `--file`) | `2` | 参数错误 | ✅ Pass |
| **无效命令** | `node cli.js invalid-command` | `2` | 执行失败 | ✅ Pass |
| **未找到目标文件** | `node cli.js tree --file missing.js` | `1` | 业务/校验失败 | ✅ Pass |
| **路径越权 (Traversal)** | `node cli.js audit-file --file /tmp/x.js` | `1` | 安全违规 (受保护工作区) | ✅ Pass |
| **REPL 错误命令** | `repl --eval "invalid"` | `2` | 预期执行失败 | ✅ Pass |

#### 路径边界处理矩阵

| 路径语法 | 示例 | 解析状态 | 备注 |
|---|---|---|---|
| **相对路径** | `src/services/container.js` | ✅ 已解析 | 正常工作。 |
| **含 `./` 相对路径**| `./src/services/container.js` | ✅ 已解析 | 正常工作。 |
| **绝对路径** | `C:/Users/sdses/.../container.js`| ✅ 已解析 | 正常工作。 |
| **Windows 反斜杠**| `src\services\container.js` | ✅ 已解析 | 兼容支持。 |
| **Unicode / 中文**| 原生路径字符串 | ✅ 已解析 | fs 标准支持。 |
| **目录** | `src/services/` | ⚠️ 已接受 | 接受但产生空统计。 |
| **非项目文件** | `/tmp/external.js` | ✅ 已拒绝 | 被 path-traversal 防御拦截。 |
| **非代码文件** | `README.md` | ✅ 优雅降级| 安全排除在 dep-graph 之外。 |

### 💡 SKILL.md 适配建议

1. **默认格式选择**：AI 集成时，避免默认推荐 `--format markdown --quiet`，应优先推荐 `--json --quiet` 以减少 Markdown 字符串拼接和正则解析开销。
2. **重新评估 `audit-overview`**：不要将其放入 "avoid" 禁用清单，它包含 `knowledgeRisk` 和 `hotspots` 等 `audit-summary` 不提供的关键指标。
3. **精简调用**：在 AI 审计特定文件时，`audit-file --json` 会在内部自行算好 `impact` 与 `affected-tests`，无需二次分步运行多个 CLI。
4. **过滤 Heuristics 误报**：在消费 `affected-tests` 时，优先处理 `source: "graph"` 的确定性依赖，低优先级处理 `source: "mention"`。
5. **消费 `coChanges`**：`audit-file --json` 输出的 `coChanges[]` 指出了历史协同变更概率高的文件，对 AI 评估潜在波及范围非常有价值。

