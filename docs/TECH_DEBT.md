# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

### L1-3：Java same-package 隐式边在 build 路径与 loadGraph 路径下语义不一致（2026-07-20 发现，待设计决策）

**现象**：Java 项目的 `dead-exports` 结果在「刚 build 完」和「从 SQLite loadGraph 恢复」两种路径下不同：

- build 路径：`expandJavaPackageImports()` 的 postProcess 给同包类互加 tier3 隐式边，importRecords 带 `usesAllExports` 标记 → 死导出分析把同包类全部视为「被使用」→ 同包死类被完全掩盖（0 报告）。
- loadGraph 路径：边从 edges 表恢复（含 tier3 边），但 importRecords 从 parse_results 恢复（**不含 tier3 记录的 usesAllExports 元数据**，因为 `setParseResult` 在 postProcess 之前就持久化了）→ 同包类被当作普通 importer 扫描 → 报告死导出。

**实测**（2026-07-20，fixture：Foo/Bar 同包、Bar 无任何真实引用，javalang AST 模式）：build 后立刻跑 dead-exports = 0；重跑（loadGraph）= 2。**与用户是否操作无关，同一个项目两次运行数字不同。**

**设计冲突（按开发原则 7 暴露，不折中）**：tier3 隐式边到底算不算「使用」？

- 算（build 路径现状）：保守、不误报，但同包死类对 dead-exports 完全不可见，Java 死导出检测形同虚设。
- 不算（loadGraph 路径现状）：能报出死类，但 Spring DI 等同包真实引用会混入，需要 confidence 机制兜底。

**修复方向（下一轮）**：先统一两条路径的数据（persist tier3 importRecords 元数据，或 loadGraph 后重跑 `expandJavaPackageImports`），再决定语义。倾向：tier3 边不参与死导出的「已使用」判定（与 cycles 检测排除 tier3 的既有先例一致，`analyzer.js:646`），让死导出可见但标 `implicit-same-package` 低置信。

**验证命令**：

```bash
# fixture: 两个同 package 的 java 类，互相无真实引用
node cli.js dead-exports --cwd <fixture> --cache-dir <tmp> --json --quiet   # cold: build 路径
node cli.js dead-exports --cwd <fixture> --cache-dir <tmp> --json --quiet   # warm: loadGraph 路径，两次 count 应相等
```

---

## L2 债务（阻塞演进或导致结果不可信）

> 当前无活跃的 L2 债务。

### ⚠️ 预防性约束：`_invalidateParseCache()` 是 parse cache 的唯一失效入口

**状态**：已收敛（`builder.js` 中 `_invalidateParseCache(keyOrPath)` 统一负责内存 `_parseCache` 和 SQLite `cache.parseResults` + `parsedHashes` 的失效）。

**约束**：`builder.js` 的 `updateFiles()` 和删除文件循环中，parse cache 失效**只允许**通过 `this._invalidateParseCache(keyOrPath)`，**禁止**直接调用 `this._parseCache.delete()` 或 `this.dg.cache.deleteParseResult()`。

**为什么这是约束而非已修复债务**：当前只有两层 parse cache（内存 + SQLite），`_invalidateParseCache` 已覆盖。但如果未来新增第三层缓存（如聚合 summary 快照、内存 LRU 的热路径缓存），**必须在该方法内追加失效逻辑，不能在其他地方手工补 evict**。违反此约束会导致静默 stale（2026-07-03 的 mtime 失效 bug 便是先例：SQLite 层忘记 evict，内存层清了，fast path 读到 SQLite 旧数据 + 新 mtime → 跳过重解析）。

**触发条件**：新增任何与文件解析结果相关的缓存层时。

### ⚠️ 预防性约束：`regex-fallback` 缓存条目永不信任

**状态**：已收敛（2026-07-20，`builder.js` 的 `_isParseCacheUsable()` / `_isDegradedCacheEntry()` 统一四处缓存命中判定：`build()` / `parseFileOnly()` / `updateFiles()` fast path + SHA-256 path）。

**约束**：缓存命中判定**必须**经过 `_isParseCacheUsable()`，禁止再写裸的 `cached.mtime === meta.mtime`；`loader.js` 的 `loadGraph()`（从 SQLite 整图恢复的路径）同样必须拒绝含 regex-fallback 条目的缓存并回退 build()。`parseMode='regex' && parseModeReason='regex-fallback'` 的条目表示"外部 AST 工具链缺失时的降级产物"——缓存 key（mtime/SHA-256）看不见工具链变化（如 `pip install javalang`），此类条目必须每次重解析，拿到 AST 结果后自动恢复命中。

**为什么**：2026-07-20 dogfood 实测 bug——无 javalang 时 116 死导出入缓存，装好 javalang 重跑仍命中旧缓存拿到一模一样的垃圾数字，必须手删 cache.db。`regex-native` 语言（C/C++/Svelte）不受影响：regex 是它们的原生 parser。

**触发条件**：新增任何缓存命中判定路径、或修改 `checkFileChanges()` staleness 逻辑时。

---

> **当前活跃债务总览**：L1 Blocker **1** | L2 债务 **0** | 架构债务 **0** | L3 品味问题 **0** | 合计 **1 项**

## 架构债务（不阻塞功能，但阻塞演进速度）

> 当前无活跃的架构债务。

---

## L3 品味问题（建议修，非债务）

> 当前无活跃的 L3 品味问题。
>
> 历史记录：弱断言分布已清理至 schema 契约测试中的防御性 `typeof` 检查；其余 `status === 0` 均为环境探测 helper，不属于测试断言。详见 [CHANGELOG.md](../CHANGELOG.md) [Unreleased] §Code Quality: Weak Assertion Cleanup。

---

## 开发纪律（不是代码债，是踩坑教训，必须记住）

### ⚠️ 「全绿」有盲区：测试覆盖了你想到的场景，没覆盖你没想到的

**案例**：2026-07-03 发现 `builder.js` 增量更新缓存失效 bug。`npm run test:fast` 130/130 全绿，但 bug 一直存在。原因是所有增量测试（`dep-graph-incremental-test.js`）只测了命名 import / 直接依赖，没有一个用 wildcard re-export（`export * from`）当探针。wildcard re-export 的导出列表依赖上游文件的实际解析结果，上游变更后如果缓存失效没传播，下游导出列表静默过期——而命名 re-export（`export { foo } from`）的导出列表来自自身源码，上游变更不影响它，所以假绿。

**纪律**：
1. **「全绿」只证明你想到的场景对，证明不了你没想到的场景不存在。** 每次声称"全绿"，心里必须补一句"在我测过的场景下"。
2. **增量逻辑的测试必须覆盖「依赖数据源变更后，下游数据是否刷新」，不只测「修改文件后自己的数据是否刷新」。** 典型探针：wildcard re-export、barrel file、`__init__.py` 重导出、TypeScript `export * from`。
3. **如果同一个被测模块有两种语法路径（命名 vs wildcard），两种都测。** 不能因为第一种 PASS 就假设第二种也 PASS。

### ⚠️ 假绿比红更危险

红的测试告诉你"这里有问题"→ 你会修。假绿告诉你"这里没问题"→ 你信了，然后带着 bug 上线。2026-07-03 的 mtime 失效 bug 是典型案例：130 个测试全 PASS，没有一个失败，但增量更新对任何文件修改都在静默返回旧数据。

**纪律**：看到全绿时，问自己"我有没有测过反向路径/边界条件/失效场景？"如果没有，全绿不表示安全。

---

## 文件级雷区地图

| 文件                                      | 行数 | 风险 | 状态                      |
| ----------------------------------------- | ---- | ---- | ------------------------- |
| `src/tools/git-tools.js`                | ~392 | 低   | L2-9 commit range 源      |
| `src/utils/stack-detectors/detect.js`   | ~443 | 低   | stack-detector 检测子模块 |
| `src/utils/stack-detectors/commands.js` | ~639 | 低   | stack-detector 命令子模块 |

---

## 测试覆盖缺口

> 所有核心/分析模块均已实现专属/直接单元测试覆盖（无遗留的零专属测试模块）。

---

> CLI Dogfooding 历史缺陷已全部修复，并按"修复即删"铁律完成清理（历史详情归档于 [CHANGELOG.md](../CHANGELOG.md) [Unreleased]）。
> 仍在的已知限制与陷阱详见 [ROADMAP.md](../ROADMAP.md) §已知限制。

## 规格参考与边界行为（非债务，供 Agent 查阅）

### ✅ 已验证的边界安全行为 (Verified Safe Boundary Behaviors)

| #  | 边界场景                                    | 结果                                                    | 评估        |
| -- | ------------------------------------------- | ------------------------------------------------------- | ----------- |
| 1  | **仅注释文件**                        | `severity=low`, `impact=0`, `affectedTests=0`     | ✅ 正确处理 |
| 2  | **Shebang 脚本（无后缀）**            | `file-fallback`, `reason="source-not-indexed"`      | ✅ 正确处理 |
| 3  | **伪装成 `.js` 的二进制文件**       | `file-fallback`, `reason="ast-unavailable"`         | ✅ 优雅降级 |
| 4  | **UTF-16 BOM 文件**                   | `file-fallback`, `reason="ast-unavailable"`         | ✅ 优雅降级 |
| 5  | **超大文件（5万行 / ~350KB）**        | `file-fallback`, `reason="ast-unavailable"`, 无超时 | ✅ 性能安全 |
| 6  | **语法损坏的文件**                    | `file-fallback`, `reason="ast-unavailable"`, 不崩溃 | ✅ 优雅降级 |
| 7  | **符号链接 (Symbolic link)**          | 解析至真实目标，正常分析                                | ✅ 正确处理 |
| 8  | **表情/中文 Unicode 文件名**          | 符号正常解析                                            | ✅ 正确处理 |
| 9  | **`--save /dev/null`**              | 成功写入无报错                                          | ✅ 正确处理 |
| 10 | **自定义 `--cache-dir` + 删除重构** | 自动创建`cache.db`，正常重构                          | ✅ 正确处理 |
| 11 | **源文件修改后立即审计**              | 结果实时反映变更                                        | ✅ 正确处理 |
| 12 | **极短时间内连续运行相同命令**        | 命中缓存，结果稳定                                      | ✅ 正确处理 |

### 🔍 验证矩阵 (Validation Matrices & Behavior)

#### Exit Code 契约矩阵

| 执行情况                       | 命令示例                                         | 实际退出码 | 预期语义                | 状态    |
| ------------------------------ | ------------------------------------------------ | ---------- | ----------------------- | ------- |
| **干净运行**             | `node cli.js audit-summary`                    | `0`      | 执行成功                | ✅ Pass |
| **无问题 + 严格模式**    | `node cli.js dead-exports --fail-on-findings`  | `0`      | 成功（未发现债务）      | ✅ Pass |
| **发现债务 + 严格模式**  | `node cli.js audit-summary --fail-on-findings` | `1`      | 业务/校验失败           | ✅ Pass |
| **缺少参数**             | `node cli.js impact` (无 `--file`)           | `2`      | 参数错误                | ✅ Pass |
| **无效命令**             | `node cli.js invalid-command`                  | `2`      | 执行失败                | ✅ Pass |
| **未找到目标文件**       | `node cli.js tree --file missing.js`           | `1`      | 业务/校验失败           | ✅ Pass |
| **路径越权 (Traversal)** | `node cli.js audit-file --file /tmp/x.js`      | `1`      | 安全违规 (受保护工作区) | ✅ Pass |
| **REPL 错误命令**        | `repl --eval "invalid"`                        | `2`      | 预期执行失败            | ✅ Pass |

#### 路径边界处理矩阵

| 路径语法                     | 示例                                | 解析状态    | 备注                         |
| ---------------------------- | ----------------------------------- | ----------- | ---------------------------- |
| **相对路径**           | `src/services/container.js`       | ✅ 已解析   | 正常工作。                   |
| **含 `./` 相对路径** | `./src/services/container.js`     | ✅ 已解析   | 正常工作。                   |
| **绝对路径**           | `C:/Users/sdses/.../container.js` | ✅ 已解析   | 正常工作。                   |
| **Windows 反斜杠**     | `src\services\container.js`       | ✅ 已解析   | 兼容支持。                   |
| **Unicode / 中文**     | 原生路径字符串                      | ✅ 已解析   | fs 标准支持。                |
| **目录**               | `src/services/`                   | ⚠️ 已接受 | 接受但产生空统计。           |
| **非项目文件**         | `/tmp/external.js`                | ✅ 已拒绝   | 被 path-traversal 防御拦截。 |
| **非代码文件**         | `README.md`                       | ✅ 优雅降级 | 安全排除在 dep-graph 之外。  |

### 💡 SKILL.md 适配建议

1. **默认格式选择**：AI 集成时，避免默认推荐 `--format markdown --quiet`，应优先推荐 `--json --quiet` 以减少 Markdown 字符串拼接和正则解析开销。
2. **重新评估 `audit-overview`**：不要将其放入 "avoid" 禁用清单，它包含 `knowledgeRisk` 和 `hotspots` 等 `audit-summary` 不提供的关键指标。
3. **精简调用**：在 AI 审计特定文件时，`audit-file --json` 会在内部自行算好 `impact` 与 `affected-tests`，无需二次分步运行多个 CLI。
4. **过滤 Heuristics 误报**：在消费 `affected-tests` 时，优先处理 `source: "graph"` 的确定性依赖，低优先级处理 `source: "mention"`。
5. **消费 `coChanges`**：`audit-file --json` 输出的 `coChanges[]` 指出了历史协同变更概率高的文件，对 AI 评估潜在波及范围非常有价值。

---

*Last updated: 2026-07-20（活跃债务：L1=1（Java same-package 隐式边 build/loadGraph 路径语义不一致，待设计决策）/ L2=0 / 架构债务=0 / L3=0；本轮修复 dogfood 反馈 5 问题：regex-fallback 静默降级显式化、缓存随工具链失效、venv-aware python spawn、cycles per-SCC cap、skill 副本同步；npm run test:fast 135/135 PASS）*
