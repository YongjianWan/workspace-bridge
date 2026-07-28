# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 本轮会话 (2026-07-27 → 07-28)

### 会话上下文
- 起点：用户要求评审前一晚未提交的两摊改动（符号表 Stage 4 + 评审跟进），确认后提交；随后授权连续推进，按 P0→P3 优先级做到工作三小时。
- 前一晚三次全量（13→42→81 分钟、13 失败）**全部作废**：失败项清一色 spawn 子进程超时（exit `null`/SIGTERM），根因是环境而非代码。诊断方法教训见下方。

### 本轮完成
1. **符号表 Stage 4 + 评审跟进提交**（`22bd54d` / `dfac598`）：按 hunk 拆两摊——`loader.js` 的 `_buildSymbolRegistry` 归符号表、`edgeMeta` 门禁归评审跟进。评审中发现并修掉一个真 bug：`lookupBestMatch` 的"非导出符号不解析 import"只在单命中分支成立，多候选打分路径漏掉（全部候选皆私有时，同目录那个靠 locality 分数胜出）。修法是打分前先滤非导出，`length===1` 特例与 `SCORE_EXPLICIT_EXPORT` 死项随之消失。
2. **symbol-table 外部依赖闸**（`3a35180`，P0）：`trySymbolTable` 挂在每条 resolver 链尾，第三方依赖天然全部走它。本仓 dogfood 实测 **1219 边中 209 条是假边**（`shared.js` 把 `const path = require('path')` 带进 `module.exports`，全仓 `require('path')` 都指向它），`impact parsers/js/shared.js` 报 212 个受影响文件、真值 3。闸后 209→0，GitNexus 上该策略贡献本就为 0。`CACHE_VERSION` 8→9。
3. **warm 后处理泛化 + debug 重复符号口径**（`b13d29f`，P1 一半）：orchestrator warm 分支写死 `expandJavaPackageImports()`，改为遍历 `postProcessPhases`——任何 `registerPostProcessPhase()` 注册的阶段自动两路径生效。`debug --what symbols` 把 227 个私有 `function main()` 报成重复符号且与自身 stats 矛盾，收敛到 `getDuplicateSymbols()` 单一定义。
4. **CACHE_VERSION 门禁收敛**（P2，架构-2 清零）：`_readGuard` 成为 11 个读入口的唯一闸口，`_stampVersionIfUnset` 补齐写侧出处。人工审计逮到漏网的 `findAffectedHttpRoutes`（递归 CTE 直读 edges+routes，名字里没有 `load`）。
5. **文档**：`docs/TECH_DEBT.md` 从"0 项"改为如实登记（现 5 项活跃）；`docs/dogfood.md` 四处基于空数据的过期判断作废（`debug` 曾被判"🔴 应废弃"，实测 symbols 2192 / graph 445 文件均有真实数据）。

6. **warm/cold 同构契约**（`22fdfff`，架构-1 降级为约束）：`warm-cold-parity-test.js` 比较可观察输出而非内部字段，并断言第二次启动 `build()` 调用数为 0（否则 warm 静默回落 cold 时测试会退化成"cold 比 cold"）。刻意未做 `finalize()` 抽取，理由见 TECH_DEBT。
7. **resolver 精度基准 + Rust 外部闸**（P3）：`scripts/resolver-precision.js` 首测五仓——**JS/TS/Python 四仓 symbol-table 贡献恒为 0，Rust 的 qartez-mcp 却是 361/642 = 56%**，其中 156 条 crate 绝对路径正确、48 条是 `std::`/`rmcp::`/`tokio::` 假边。补 Rust 闸后 361→313，正好少 48，正确边未伤。`CACHE_VERSION` 9→10。新记 L2-12：剩下的 127 条 `super::` + 26 条 `crate::` 本该由结构解析算出，靠猜名字命中说明 `resolvers/rust.js` 有覆盖缺口。

### 续轮 (2026-07-28，定向验证模式，不跑全量)
8. **Python 外部闸**（L2-11 第三条语言腿）：`readPythonDeps(root)` 合并 `requirements.txt` + `pyproject.toml`（`[project]`/optional-dependencies/poetry 三段），PEP 503 归一 + 六个包名/导入名别名；`PYTHON_STDLIB_ROOTS` + `_isExternalPythonModule` 加一行进 `EXTERNAL_DEPENDENCY_CHECKS`。`CACHE_VERSION` 10→11。定向验证：`resolver-symbol-table-test.js` 20/20（先 RED 3 条）、变异摘分派行→恰那 3 条 RED、真实 manifest 抽查（CodeGraphContext 39 名含别名 / code-review-graph 30 名 / qartez-mcp 正确 null）、resolver 五个测试文件全绿、`graph-db-version-gate-test.js` 5/5、eslint exit 0。**诚实记录：precision 基准上 Python 仓 symbol-table 实测贡献为 0，此闸是铁律 #8 等价性保险，非修复已测到的假边。**
9. **Go 外部闸**（L2-11 第四条腿，最便宜的一条）：Go import 永远带完整路径，`_isExternalGoModule` 零名单——`go.mod` module 路径为根 = 内部放行，dotted 首段 = 外部模块、无点首段 = 标准库，都拦。无 `go.mod` 时后两类依旧确定照常拦。`CACHE_VERSION` 11→12。24/24（先 RED 3 条 + 变异验证）。L2-11 只剩 Java / Kotlin，与 L2-10 判决联动。
10. **L2-12 清零**（Rust super::/crate:: 回模块算术）：两个独立缺口——`tryRustSuper` 把 super 当目录爬（非 mod 文件首级不该爬），`tryRustCrate` 锚工作区根（该锚最近 Cargo.toml）；加单段基模块条目回退。qartez-mcp 实测 symbol-table 313→160（正好 −153），总边 594→676（+82 条原先连猜都猜不出的 import 首次成边），抽 6 条全对。`CACHE_VERSION` 12→13。另有 Claude 线：`shared.js` 假边根因（path shorthand）拔除 + 六仓新鲜数据齐备，L2-10 待用户拍板。

### 验证状态
- `npm test` 全量六轮全绿：255/255（745s）→ 255/255（807s）→ 256/256（818s）→ 257/257（782s）→ 258/258（802s）→ 258/258（823s，含 Rust 闸 + CACHE_VERSION 10）。
- `npm run test:fast` 142/142，`npx eslint .` exit 0。
- 每项修复均先 RED 后 GREEN，且做了变异验证（注释掉修复行 → 对应测试必须红）。

### 待办
- [ ] **L2-10 判决 symbol-table 在 JS 家族的去留**：已有首批数据（四个 JS/TS/Py 仓命中恒为 0），再取两三个真实仓复测即可拍板；摘掉能让 L2-11 的 JS 闸与 L3-4 的分支一起消失。
- [ ] **L2-11 补 JVM 的外部闸**：JS + Rust + Python + Go 已有（Go 无需名单：module 路径之外一切不拦则已一拦俱全）。JVM 麻烦在 pom/gradle 两种格式且 groupId 与 import 包名不同构，建议和 L2-10 判决联动。
- [x] ~~**L2-12 `resolvers/rust.js` 结构解析缺口**~~ → 2026-07-28 清零：super:: 模块算术修正 + crate:: 最近 Cargo.toml 锚定 + 基模块条目回退，153 条转 tier1、另 82 条首成边，`CACHE_VERSION` 13。
- [x] ~~架构-1 warm/cold 同构~~ → 2026-07-28 以「阶段遍历机制 + 同构契约测试」收敛，`finalize()` 抽取刻意不做。

### 本轮方法论教训
- **先测量再下结论**。前一晚在"是环境还是回归"上判断错两次，都是先下结论后测量。正确做法是 15 秒的受控探针：`rm -rf $CACHE && time node cli.js audit-summary --cwd . --cache-dir $CACHE --quiet --json`，健康值 12–14s。
- **WMI 的 `CurrentClockSpeed` 在这台机器上没有诊断价值**：Core Ultra 5 125H 恒定回报 1200（P 核基频），健康时读数一模一样。
- **闸只做一半比不做更危险**：读侧查戳而写侧不建立出处，导致进程读不回自己刚写的数据；而写侧无条件盖戳又会把旧库重新开闸。正确形态是"读侧查、写侧仅在无戳时盖"。
- **审计"每一个入口"时，别按名字找**：`findAffectedHttpRoutes` 就是靠通读而非 `grep load` 才发现的。

---

## 上轮会话 (2026-07-23)

### 会话上下文
- 用户要求审查最近提交 + 未提交 diff。审查发现 mixed repo L1/L2 兜底（未提交 diff）零测试、正则边界 bug、audit-file 死角，全部修复并提交。
- 下一步已定：TECH_DEBT L1-3 清零（Java same-package build/loadGraph 路径分歧），设计方案已过用户确认流程（tier3 不算使用 + loadGraph 后重跑展开 + CACHE_VERSION bump），待执行。

### 本轮完成
1. **mixed repo L1/L2 评审修复**（详见 CHANGELOG 2026-07-23 条目）：`INFRA_PATTERNS` 词尾锚点 + `compose.yaml`/override 识别、`audit-file` 单查 infra 文件触达 L1、删除 `full.length` 静默丢弃守卫、unowned/changedStacks 判定去重复、dedupe 键回退 `name`、新增 `test/mixed-infra-commands-test.js`（7 用例，先 RED 后 GREEN）。
2. **wave8 flaky 彻底根治**（三层病灶）：（a）预计算深度裸数字 `3` vs 查询默认 `CONFIG.DEFAULT_MAX_DEPTH=5`，统一引用同一常量；（b）`findAffectedTests` 的 `_testMapCache` fast path 增加 `maxDepth === CONFIG.DEFAULT_MAX_DEPTH` 强门禁并删除行级过滤——`mention` 终结符集合是 `maxDepth` 的函数，预计算 map 是按深度参数化的答案，非匹配深度绕过走冷路径活算；（c）终结符条目与冷路径 `terminator: true` Schema 对齐。
3. **persistence 预计算旧缓存污染治理**：`savePrecomputed` 生成 `test_map` 前显式调用 `injectPrecomputedTestMap([])` 清场，彻底杜绝“旧图内存快照被再次写进新图 DB/缓存”的隐性问题；存盘后用新行刷新内存。
4. **TECH_DEBT L1-3 清零**：analyzer tier3 记录不参与「已使用」判定 + 仅隐式 importer 强制 `low`/`implicit-same-package`、orchestrator loadGraph 后重跑 `expandJavaPackageImports()`、CACHE_VERSION 5→6。
5. **analysis_snapshots 版本门禁**：该表此前是 CACHE_VERSION 的后门——版本 mismatch 只拒读不清表，旧语义快照在 head/count/config 匹配时被 overview 短路 / query-* 消费。现逐行盖 `cache_version` 戳（迁移 DEFAULT 0 自动作废存量行），`loadAnalysisSnapshot` 门禁拒收。
6. **precomputed_aggregates 单一写入方**（runner 里 query-tools-test 间歇失败的真凶）：DELETE-全表语义上 `savePrecomputed` 与 `buildProjectOverview` 两写入方互删（后者还每次静默清空 warm 聚合预计算）。修法为删除：overview 镜像行写入与 query-tools 兼容回退全部移除，`analysis_snapshots` 是快照唯一归宿。

7. **Stage 4 Step 1：Pre-scan 全局符号映射完成 (Pilot Phase: JS/TS + Python)**：
   - 补齐 `dep-graph.js` 的 `loadGraph()` Facade，在 SQLite 节点载入后显式调用 `builder._buildSymbolRegistry()`，治愈了 Warm 路径下 `symbolRegistry` 恢复丢失的真实代码死穴；
   - 扩充 `symbol-registry.js` 实现 `lookupBestMatch()` 打分消歧算法与纯路径深度算术（`commonDepth >= 2`）；
   - 在 `scoring.js` 中增加 `SYMBOL_DISAMBIGUATION` 常数，遵守 L2-6 铁律；
   - 修复 `resolvers.js` 的 `trySymbolTable` 多语言分隔符（`.`, `/`, `::`）提取 Bug；
   - 扩充 `ast-parser.js` 提取顶层非 export 的 `class` / `function`（标注 `isExported: false`），采用 Superset 扩展模式，零 SQLite Schema 冗余开销；同时在 `exports` 提取时过滤掉 `isExported === false`，规避死导出误报；且 `CACHE_VERSION` 升级 6→7 作废旧语义缓存行，保证冷热路径绝对同构；
   - 新增 `test/symbol-prescan-registry-test.js` 契约与同构性测试 PASS.

### 验证状态（2026-07-23 新鲜证据，评审修复后）
- `npm run test:fast` **137/137 PASS** ✅（symbol-prescan-registry-test 因 `new ServiceContainer` 归 slow 层，此前"138/138"声明有误）
- `npx eslint .` exit 0 ✅
- `test/e2e-gitnexus-test.js` PASS ✅（断言恢复交叉校验并编码 elideDeep 截断契约；弱化版恒真式已废）
- 新增契约测试：`test/symbol-prescan-registry-test.js`（多语言消歧 + Warm/Cold 全同构）PASS ✅
- 全量 runner（含 slow 层）：评审修复后重跑中，以最终输出为准

### 待办
- [x] ~~wave8 runner/slow-cache 环境下 affected-tests 计数差异（44 vs 16）~~ → 2026-07-23 完成
- [x] ~~TECH_DEBT L1-3 清零~~ → 2026-07-23 完成
- [x] ~~Stage 4 Step 1：Pre-scan 全局符号映射 (Pilot)~~ → 2026-07-23 完成

### 本轮方法论教训
- **"单独跑 PASS"证明不了 runner 环境**：wave8/query-tools 都要用 runner 自己的机制（warm cache 拷贝 + `WB_TEST_CACHE_DIR`）复现才算数；query-tools-test 不带 cacheDir，打的是真仓库默认缓存。
- **后台跑 runner 必须全量日志落盘**（`> log 2>&1`），管道截尾会把失败断言详情丢掉。
- 本轮五只 bug 同族：缓存拿旧语义答案冒充新鲜（哨兵过滤、深度错位、savePrecomputed 回环、快照免检版本、双写入方互删）。缓存修复的验收标准永远是"warm 输出与 cold 逐字节一致"。

---

## 上轮会话 (2026-07-20 续)

### 会话上下文
- 上轮 5+1 个问题修复后的收尾验证：全量 runner 246/248 残留 2 个失败（phase35-query-sql-test.js + wave8-regression-test.js）。

### 本轮完成
1. **提交 5 问题修复**：`8b64a59`（28 文件，+906/-59），包含 regex-fallback 静默降级、缓存工具链感知、venv-aware python、cycles per-SCC cap、幽灵命令修正、warnings 文本渲染、outputTruncation JSON 修复、测试缓存污染修复、4 个新回归测试。
2. **同步 SKILL.md 文档**：更新 `--max-files`（7→17 命令）、`--compact`（2→5 命令）、决策树补充 `api-contracts`；项目权威副本 + user-scope 副本已逐字节一致。
3. **修复 phase35-query-sql-test 缓存污染**：`testOverviewShortCircuitAndSave` 向 `analysis_snapshots` 注入残缺 mock（不含 `cycles`/`deadExports` 等字段）后未恢复，导致后续 `testFieldsFiltering` 和 runner 中其他测试加载残缺数据。`finally` 块中恢复原始 `firstResult` 到 `saveAnalysisSnapshot('overview', ...)`。
4. **修复 query-tools-test 同样问题**：`testQueryToolsCacheHit` 同样注入 mock 后未恢复，同样修复。
5. **wave8-regression-test 预存问题确认**：全量 runner 中 247/248（wave8 仍失败，`44 !== 16`），但单独运行和精确 runner 模拟均通过。该失败为 7/20 代码变更引入的预存问题（7/19 基线 147/147 PASS），非本轮缓存修复导致。疑与 warm cache + 并发条件下 `_getSharedContainer` 和 REPL 进程的图加载差异有关。

### 验证状态
- `npm run test:fast` **135/135 PASS** ✅（~~wave8 已修复，不再失败~~ 7/23 证伪：仅 fast 层通过，slow 层后首跑仍失败）
- `npx eslint .` exit 0 ✅
- phase35 单独运行 3/3 PASS ✅
- query-tools-test 单独运行 PASS ✅
- wave8 单独运行 PASS ✅
- 全量 runner: **247/248**（1 预存失败：wave8-regression-test）

### 待办
- [x] ~~深入排查 wave8 runner 环境下的 CLI vs REPL affected-tests 计数差异（44 vs 16）~~ → ~~根因已确认：phase35/query-tools-test 缓存污染~~ **7/23 证伪并重开**（见 2026-07-23 会话待办）：缓存污染只是来源之一，slow 层后 wave8 首跑仍失败。

---

## 本轮会话 (2026-07-20)

### 会话上下文
- 用户 dogfood 实战反馈（真实 Java 仓库深用 `audit-overview --format ai`）：curated 层在 AST 语言上好用（抓到前端断链已修、新循环、后端 116→40 的水分），但挖出 5 个真问题，核心主题是**降级路径静默自信**（违反 L1-4）。

### 本轮完成（5 个问题全部修复，TDD）
1. **🔴 静默降级（最致命）**：`computeDeadExportConfidence` 0-importer 分支此前忽略 parseMode，regex-fallback 的垃圾数字拿 high confidence + `safeToDelete=true`。现第 4 参 `parseModeReason==='regex-fallback'` 时降 `low`；`regex-native` 不受连坐。同步补 `orchestrator.js` 丢弃 `parseModeReason` 的缺口。`dead-exports`/`audit-overview` 的 human/summary/markdown 格式器现在渲染 `warnings[]`（此前只进 JSON）；warning 文案区分 javalang 缺失/python 缺失/超时。
2. **🔴 缓存不随工具链失效**：`builder.js` 新增 `_isParseCacheUsable()`，regex-fallback 条目永不信任缓存、每次重解析（工具链修复后自动升级为 AST 并恢复命中）；统一四处命中判定。零 schema 变更。
3. **🟡 win32 python 硬编码**：`spawn-ast.js` 改走 venv-aware `resolvePythonCommand()`（registry 新增 `needsWorkspaceRoot`，java/python entry 透传 root）；新增环境级失败 memo（python-missing/dependency-missing 同进程短路，瞬时不 memo）。
4. **🟡 cycles 组合爆炸**：per-SCC cap（`PER_SCC_CYCLE_CAP`=25）+ `getCycleMeta()`（sccCount/truncated）；`cycles` 命令与 `audit-overview` 透传 sccCount/truncated/totalPaths；文本输出补 "... and N more cycle paths"；修复 `sliceArray` 截断标记被 `JSON.stringify` 丢弃（新增 `outputTruncation` 汇总对象）。
5. **skill 副本分裂**：user-scope 副本（教旧命令 `workspace-bridge-cli`）已从项目内权威副本同步覆盖；AGENTS.md 陷阱表新增"改 SKILL.md 后记得同步"。

### 新增测试
- `test/cache-regex-fallback-invalidation-test.js`、`test/spawn-ast-env-test.js`（@slow）、`test/dead-export-regex-fallback-confidence-test.js`、`test/cycles-scc-cap-test.js`

### 基线验证
- `npm run test:fast` **135/135 PASS**（spawn-ast-env 按约定归 slow 层后）
- `npx eslint .` exit 0
- 全量 runner 结果见本节前文（收工时更新）

### 待办 / 下一步
- [ ] 决定是否 `npm publish`（2.1.0 已切版，README 仍注明未发布）。
- [ ] `api-contracts` 后续可扩展：Spring 类级别 `@RequestMapping` 前缀组合、更多前端 http client、字段级契约（需评估项目定位）。

---

## 上轮会话 (2026-07-19)

- 彻底治愈 `repl-test.js` / `audit-file-watch-test.js` flaky：`GraphAnalyzer._mentionContentCache` 消除 precompute 的 3.3 万次重复同步 I/O（效率 100×+）；20/100 次循环重现 0 失败。详见 CHANGELOG [Unreleased] §Flaky 条目。

---

## 上轮会话 (2026-07-17)

### 会话上下文

- 用户要求评估最近修复与 git 提交过程。发现：7/14–7/15 会话 22 项工作全部未提交、TECH_DEBT 记录 1 条活跃 L1（`audit-file --depth` 语义重载）、三份活跃文档数字互相矛盾、施工脚本与 stash 残留。按 write-goal 设定的目标逐项处理完毕。

### 本轮完成

1. **抢救性提交**：7/14–7/15 全部工作提交为 `4643a73`（api-contracts 命令 + 输出塑形一致性，33 文件）。两股改动在 `cli.js` / `human-formatters.js` 等共享文件中交织，hunk 级拆分会产生无法通过测试的中间 commit，按会话内聚性整体提交。
2. **L1 修复（TDD）**：`audit-file --depth surface` 静默截断 affected-tests 遍历深度 → 遍历深度改由 `--max-depth` 唯一控制，缺省回退 `DEFAULTS.AFFECTED_TEST_DEPTH(5)`；新增 `test/audit-file-depth-decoupling-test.js` 锁定契约；TECH_DEBT 活跃债务清零（commit `b6f9638`）。
3. **仓库卫生**：删除一次性 code-mod 脚本 `scripts/patch-*.py`×3；验证 `lint-session-wip` stash 冗余（102 文件反向 apply 干净，3 个上下文漂移文件逐 hunk 确认已含于 HEAD）后 drop。
4. **切版 2.1.0**：`package.json` 2.0.0→2.1.0，CHANGELOG [Unreleased] 积累约 6 周的内容移入 `[2.1.0]` 段落。
5. **文档数字对齐**：SESSION 基线状态/默认动作/页脚、AGENTS 页脚更新到实测值（test:fast 133/133、smoke 136/136、totalFiles≈434、deadExports=0、orphans=2 已知项）。

### 基线验证

- `npx eslint .` exit 0
- `npm run test:fast` **133/133 PASS**；`npm run test:smoke` **136/136 PASS**
- `node cli.js audit-overview --cwd . --json --quiet`：ok=true, unresolved=0, cycles=0, deadExports=0, coverageRatio=1

### 待办 / 下一步

- [ ] 决定是否 `npm publish`（2.1.0 已切版，README 仍注明未发布）。
- [ ] `repl-test.js` / `audit-file-watch-test.js` 串行 flaky 根因仍未修（记录在 TECH_DEBT）。
- [ ] `api-contracts` 后续可扩展：Spring 类级别 `@RequestMapping` 前缀组合、更多前端 http client、字段级契约（需评估项目定位）。

---

## 更早会话 (2026-07-14)

### 会话上下文

- 用户反馈：ROADMAP 中提到的前后端 API 契约对接能力当前 CLI 无法提供。按 Plan Mode 评估后，交付一个最小可行命令 `api-contracts`，作为可选适配器，不侵入核心引擎。

### 本轮完成

1. **新增 `api-contracts` 命令**：`node cli.js api-contracts --frontend <dir> --backend <dir>` 静态对齐前端 HTTP 调用与后端路由，输出 matched / unmatched client / unmatched server / coverageRatio / warnings。
2. **前端调用提取器**：支持 axios shorthand / axios config / fetch；跳过模板字符串与动态拼接；生成 warnings。
3. **后端复用现有 route extraction**：Express / NestJS / Spring / FastAPI / Django / Flask / Gin / Fiber / Actix / Axum 等框架自动识别。
4. **契约匹配器**：按 `(method, 归一化 path)` 对齐，路径变量段归一为 `{}`；明确不做字段级契约对比。
5. **双 workspace 独立初始化**：frontend/backend 各自 `ServiceContainer`（`strictCwd: true`），缓存隔离，不污染 `--cwd`。
6. **完整 CLI 集成**：参数解析、help 文本、formatter（human/markdown/summary/jsonl）、命令注册、回归测试 `test/api-contracts-test.js`。
7. **修复 `api-contracts` 引入的两项 L2 技术债务**：
   - `cli.js` 中 `parsed.command !== 'api-contracts'` 硬编码改为声明式 `SELF_CONTAINER_COMMANDS`。
   - `src/tools/api-contract-tools.js` 删除独立 `TEST_LIKE_PATTERNS`，复用 `src/utils/project-context.js` 导出的 `isTestLikeFile()`。
8. **修复 `api-contracts` 提取器与格式化输出缺陷**：
   - formatter 现在展示 `warnings`（human/summary/markdown/jsonl）。
   - 无插值反引号模板字符串不再被静默跳过。
   - 注释中的示例代码不再被误提取为真实调用。
   - `axios(...)` / `axios.request(...)` 正则收窄，避免 `apiConfig` / `myApi.request` 等误匹配。
9. **优化 `api-contracts --format ai` 输出**：新增 `AI_DIGEST['api-contracts']` 输出结构化 `counts` / `topRisks` / `actions` / `keyContracts`，AI 无需再解析 summary 字符串即可拿到未匹配接口和行动建议。
10. **扩展 `--format ai` 至更多命令**：为 `diagnostics`、`health`、`tree`、`query` 以及此前已适配的 `stats`、`workspace-info`、`dependencies`、`dependents`、`audit-map` 补全 `AI_DIGEST`，统一由 `formatAi()` 通用分支渲染 `counts` / `topRisks` / `actions` / `details`，避免 AI 消化原始 summary 字符串。
11. **修复 CLI 输出塑形参数全局一致性缺口**：
    - 将 `--fields` 白名单过滤下沉到 `src/cli/route-formatter.js`，在 `--json` / `--format ai` / `--format jsonl` 结构化输出前统一应用；`human` / `markdown` / `summary` 文本输出不再被 `--fields` 裁剪。
    - `--format ai` 与 `--fields` 组合时输出 warning，防止 AI 静默拿到被降级的 digest。
    - `--token-budget` / `--depth` 在非 `--format ai` 场景下不再静默忽略，输出 warning 明确只对 `--format ai` 有效。
    - 修复 `--category health` help 示例与校验集合不一致（`FINDING_CATEGORIES` 新增 `health` / `ast-rules`）。
    - 修复 `audit-summary --format human --fields <不含 health>` 的 `TypeError`。
    - 同步更新 `TECH_DEBT.md` / `CHANGELOG.md` / `SKILL.md`。
12. **扩展 `--max-files` / `--compact` 到 `audit-overview` / `audit-map` / `query-*`**：
    - `audit-map` 支持 `--max-files`，对文件/边/issueOverlay 同步裁剪。
    - `audit-overview` 支持 `--max-files` / `--compact`，统一截断热点、稳定性、死导出、循环依赖等数组；带这些参数时跳过快照写入，避免毒化 `query-*`。
    - `query-hotspots` / `query-knowledge-risk` / `query-stability` 支持 `--max-files`（与 `--limit` 取较小值）。
    - 更新 `cli.js` help、`SKILL.md`、`TECH_DEBT.md`、`CHANGELOG.md`，并补充单元测试。
13. **修复 `tree --max-files` 只截断根节点、子节点不受限的问题**：
    - 改为每个节点按 `imports` / `dependents` 方向独立应用 `maxFiles`，子节点也被截断，保留 `importsTruncated` / `dependentsTruncated` 标记。
    - 修复 `test/wave12-output-truncation-test.js` 回归；`npm run test:fast` 131/131 PASS。
    - 更新 `TECH_DEBT.md`、`CHANGELOG.md`。
14. **清理 `--limit` 债务**：确认 `query-hotspots` / `query-knowledge-risk` / `query-stability` 已正确消费 `--limit` 并与 `--max-files` 取较小值；从 `TECH_DEBT.md` 移除过时条目，活跃 L2 债务降至 2 项。
15. **重构 `test/query-tools-test.js`**：将 `--limit` / `--max-files` / filter 测试改为 mock snapshot，消除对真实项目数据的不稳定依赖；`npm run test:fast` 131/131 PASS。
16. **修复 `audit-file` 普通模式忽略 `--max-files` 的问题**：将 `parsed.maxFiles` 透传给 `impact` / `affected_tests`，统一截断两个列表；新增 `test/audit-file-max-files-test.js`。
17. **修复 `--format json` 与 `--json` 抽象泄漏**：`validate-args.js` 保留 `format: 'json'`；`route-formatter.js` 显式处理 `format === 'json'`；更新 `test/cli-bool-flags-env-test.js`。
18. **集中 formatter 截断阈值**：在 `src/config/limits.js` 新增 `OUTPUT_*` 常量，替换 `human-formatters.js`、`project-map.js`、`validation-advice/risk-actions.js` 中所有裸数字 `slice(0, N)`。
19. **修复 `api-contracts` 忽略 `--max-files` 的问题**：将 `parsed.maxFiles` 透传至 `runApiContracts()`；`buildResult()` 截断 `matched[]` / `unmatchedClient[]` / `unmatchedServer[]` / `warnings[]` 并标记 `truncated`；formatter 追加截断提示；新增 `testBuildResultMaxFiles`。
20. **修复 `guard` 不支持 `--max-files` / `--compact` 的问题**：`src/cli/commands/guard.js` 截断 `directDependents[]` / `transitiveDependents[]` / `impactItems[]` 并标记 `truncated`；`--compact` 省略详细列表；`src/cli/formatters/guard-formatter.js` 显示 compact/truncated 提示；新增 `testGuardMaxFilesAndCompact`；`npm run test:fast` 132/132 PASS。
21. **补全 `audit-file` / `api-contracts` 的 `--compact` 支持**：`audit-file` 普通模式在 `assembleFile()` 中清空详细列表、保留 counts；`api-contracts` 在 `buildResult()` 中清空 `matched[]` / `unmatchedClient[]` / `unmatchedServer[]` / `warnings[]` 并标记 `compact`；human/summary/markdown formatter 均追加 compact 提示；新增 `testBuildResultCompact`；`npm run test:fast` 132/132 PASS。
22. **修复 formatter 未接收统一输出限制参数的 L2 债务**：`formatHuman` / `formatMarkdown` / `formatSummary` 现在接收并透传 `--max-files` / `--limit` / `--depth`；`route-formatter.js` 在调用文本 formatter 时传入限制参数；`human` 格式默认保持不截断以兼容旧行为，`summary`/`markdown` 默认仍回退到 `LIMITS.*`；移除 `--depth` 对文本格式的无效 warning；新增 `testTextFormatterLimits` 与 `testFormatCliResultTextLimits`；活跃 L2 债务清零；`npm run test:fast` 132/132 PASS。

### 待办 / 下一步

- [ ] 决定是否发布 npm 包（README 已注明未发布；`npm publish` 是唯一让外部用户可用的路径）。
- [ ] 考虑切一个 2.1.0 版本释放 [Unreleased]（当前未发布区已积累 6 周变更）。
- [ ] `repl-test.js` / `audit-file-watch-test.js` 串行 flaky 根因仍未修（记录在 TECH_DEBT）。
- [ ] git stash 中留有一份上轮改动的冗余备份（`lint-session-wip`），确认无需后可 `git stash drop`。
- [ ] `api-contracts` 后续可扩展：Spring 类级别 `@RequestMapping` 前缀组合、更多前端 http client（如 Vue `$http`）、请求/响应字段级契约（仅在项目定位允许范围内评估）。

### 基线验证

- `npx eslint .` exit 0
- `npm run test:fast` **132/132 PASS**

---

## 上轮会话 (2026-07-10)

### 会话上下文

- 对项目做全面评估（分发、CI、仓库卫生、工具链、文档），随后按评估结论集中修复。详见 CHANGELOG [Unreleased] §工程基线补全。

### 本轮完成

1. **eslint 工具链落地**：flat config + `npm run lint` + CI Lint 步骤，清零 148 个错误（约 120 处死代码删除、7 处 error cause 补链、2 个沉默测试断言修正）。
2. **CI 缺口补齐**：test.yml 矩阵加 `windows-latest`；新增 `test-slow.yml`（push main + 每日定时）——slow 层此前从不进 CI。
3. **slow 层首次全量本地跑，挖出 3 个存量回归并修复**（全部在改动前 HEAD 可复现）：
   - `--category` 快照毒化（overview 快照不含 category 维度，过滤子集毒化全量消费者）→ 双向绕过快照；
   - `hasJavaTestFiles` 不递归 → 几乎所有真实 Java 项目被判无测试 → 有界递归修复；
   - Route B 清空 changedTargets 误伤 Java/Go/Rust/C++ compile-check fallback → 编译型语言始终传入。
4. **仓库卫生**：CHANGELOG 归档（586KB→158KB，历史入 `docs/changelog/`）；untrack reference 二进制；删根目录杂物。
5. **README 安装说明改为源码安装**（npm 包未发布）；**SKILL.md 补全** guard/query-*/token 控制/CI 基线/Exit Code 契约。

### 基线验证

- `npx eslint .` exit 0
- `npm run test:fast` **130/130 PASS**
- slow 层 3 个存量失败修复后单测 PASS（audit-file-validation-advice / functionality-polyglot / wave12-category-filter）

---

## 上轮会话 (2026-07-03)

### 会话上下文

- 对 AGENTS.md 信息密度、工具完整度、workspace-bridge 对 AI agent 的价值进行了多轮深入讨论。
- 确认 workspace-bridge 对无 LSP 的 CLI agent（如 Claude Code）是核心拐杖，对有 LSP 的 agent（如 Copilot）是卫星图。
- 项目当前处于成熟 polish 阶段：主要在补安全漏洞、边缘 case、AI 消费体验。

### Route B 实战验证 — 死代码删除闭环

- 在 `ai_gwy_backend`（556 文件 Django 项目）上用 CLI 完成死代码识别→删除→验证闭环。
- 发现 4 个 CLI 消费体验问题，修复 3 个（详见下方）。详细报告：`scratch/route-b-live-report.md`

### 增量更新缓存失效 bug — 本轮最大发现

- 用户赌注：re-export 增量更新超 1-hop 下游静默过期。
- 实际发现：**`updateFiles` 对任何文件修改都静默返回旧数据**——`builder.js` 的 fast path 只 evict 了内存 `_parseCache`，未 evict SQLite 持久化缓存。SQLite 中旧解析结果的 mtime 被抢先更新为新文件 mtime → `cached.mtime === meta.mtime` 命中快路径 → 跳过重解析。
- wildcard re-export（`export * from`）是让 bug 可见的探针——命名 re-export（`export { foo } from`）因为导出列表来自自身源码，假绿。
- 修复：新增 `_invalidateParseCache(keyOrPath)` 单一入口，同时失效内存 `_parseCache` + SQLite `parseResults` + `parsedHashes`。消除边界，不是补丁。
- 关键教训：130 测试全 PASS 下藏着一个对所有文件修改都静默失效的 bug。假绿比红更危险。

### 本轮修复清单

| 修复                                  | 文件                     | L1/L2 |
| ------------------------------------- | ------------------------ | :---: |
| `fileSpecificAdvice` 上下文感知     | `validation-advice.js` |  —  |
| 死导出`safeToDelete` 信号           | `honesty-engine.js`    |  —  |
| `suggestedCommand` 无测试时不瞎建议 | `validation-advice.js` |  —  |
| `_invalidateParseCache()` 统一入口  | `builder.js`           | L1-4 |

### 文档更新

- **AGENTS.md**：L1-4 新增「静默错误必须是显式的」——禁止让 AI agent 在无警告情况下消费静默过期数据。
- **TECH_DEBT.md**：新增预防性约束（parse cache 唯一失效入口）+ 开发纪律（全绿有盲区、假绿比红更危险）。
- **CHANGELOG.md**：[Unreleased] 追加 3 条条目。
- **SESSION.md**：本文档。

### 基线验证

- `npm run test:fast` **130/130 PASS**
- 项目自审 `audit-overview`：ok=true, deadExports=0, cycles=0, coverageRatio=1

---

## 新会话启动检查表（确认状态即可，不用跑 runner）

> **定位**：workspace-bridge 是**AI 的代码脚手架**，不是人类审计工具。CLI 负责策展（预组装、去噪、按优先级排序），skill 负责驾驶手册（什么时候用/不用/标准工作流）。
>
> **🔴 开工前不读 CHANGELOG.md**。确定现状只需读本文档 + AGENTS.md + TECH_DEBT.md + 下方 1 条基线命令。CHANGELOG 是历史存档，读它不能替代读活跃文档。
>
> 收工时已跑 `npm run test:fast` 并确认 fast 层全绿，开工无需重跑。全量 runner 状态见下方「基线状态」。直接读取下方「基线状态」确认当前文档记录是否仍成立。
>
> 开发迭代推荐 `npm run test:fast`（~18s，126 个 fast 层测试），比全量 runner（~5min）快 16×。

```bash
# 1. 快速自审（1 秒确认，不用等 runner，不读 CHANGELOG）
node cli.js audit-overview --cwd . --json --quiet
# 期望: summary.hotspots.length>0, summary.knowledgeRisk.high.length>=0, summary.orphans.length>=0, summary.deadExports.count>=0, summary.unresolved.count=0, summary.cycles.count>=0, summary.analysisCoverage.totalFiles≈434, summary.analysisCoverage.coverageRatio=1
```

**如果 audit-overview 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 历史变更见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `audit-overview` 输出正常（hotspots / knowledgeRisk / deadExports / unresolved / cycles）
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（2026-07-23：活跃债务全部清零，L1=0 / L2=0 / L3=0）

---

## 基线状态

- 测试：**全量 runner 251/251 全绿**（2026-07-23，wave8/query-tools 历史 flaky 根治后首次零失败）；`npm run test:fast` **137/137 PASS**（~22s）。开发迭代首选 `npm run test:fast`。
- CI：**GitHub Actions `Test` workflow 在 Node 22/24 矩阵上全部通过**（`test:fast` + `test:smoke`）；新增独立 `coverage` job 跑 `npm run test:coverage:check`（门槛：lines/statements ≥72%，functions ≥70%，branches ≥68%）。
- 版本：**v2.1.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：~434 文件（以 `audit-overview` 实测为准）
- 结构性指标：deadExports=0（原 `shadow-candidates.js` 的 `SHADOW_EXTS` 低置信误报已不再计入），cycles=0，unresolved=0，orphans=2（`.workspace-bridge.json` 作为 config 文件正常，以及 Windows 大小写不敏感路径 `agents.md`/`AGENTS.md` 被重复识别）；overview 维度：hotspots>0，knowledgeRisk 默认 `disabledReason: 'history-not-enabled'`，`--with-history` 启用
- 架构债务：**活跃债务全部清零**（2026-07-23，L1-3 于本日关闭，详见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)）。
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验）
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**历史交付**：路线 A–J 全部完成；阶段 1/2/3 全部完成；Wave 1-15 全部完成；L2 债务清零；产品债务清零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

直说我的判断。

## 项目处在什么阶段

workspace-bridge 过去几轮做了大量的**内省循环**：写功能 → code review → 修 review 发现 → 更新文档 → 再 review。这个循环已经把 P0-P2 清零了，测试 123/123 全绿，9 语言 AST 全覆盖。

但问题是：**你已经在研磨精度递减的抛光工作了。** §3.5 聚合持久化、SKILL.md 精简、弱断言清理——这些都是 5%-to-5.5% 的改进，不是 0-to-1。

## 两条路线

### 路线 A：继续打磨（安全、低风险、递减回报）

按 ROADMAP §3.5 走：

1. `analysis_snapshots` 落盘 + `--fields` 白名单（~100 行）
2. 热缓存压到 <2s（需要 profile 瓶颈在哪）
3. 文档数字漂移修复
4. `.npmignore` 排除 CHANGELOG

**2-3 个会话搞完。然后呢？** 又回到找下一个打磨点的循环。

### 路线 B：换个姿势——真实项目实战验证（有风险、高信息密度）

你有实战基地（`C:\Users\sdses\Desktop\神思\code` 四个仓库）。但从文档看，实战主要是"跑 CLI 看输出对不对"，不是"让 AI agent 真正用 workspace-bridge 的输出来改代码，看它在哪里卡住"。

**真正的产品验证是**：

1. 拿一个真实任务（不是 workspace-bridge 自己）
2. 让 AI agent（你自己）只通过 workspace-bridge 的 CLI 输出来理解项目结构
3. 基于输出做代码修改
4. 记录哪里输出有用、哪里废话、哪里缺了关键信息

这会产生**比 code review 高 10 倍价值的反馈**——因为你不是在检查"代码有没有 bug"，而是在回答"这个工具作为 AI 的眼睛，看得够不够清楚"。

## 我的建议

**先做 30 分钟路线 A 的无脑活**（文档数字修复 + `.npmignore`），然后切路线 B。

原因很简单：workspace-bridge 定位是"AI 的代码脚手架"，但你一直在用**人类工程师视角**审计它。code_review.md 是人写的 review，TECH_DEBT.md 是人的品味标准，§3.5 是人设计的 query API。

缺的是：**从 AI 消费者视角回答——当我拿到 `audit-file --json` 的输出，我能不能在 5 秒内决定改这个文件要跑哪些测试、会波及哪些路由、有没有环路风险？**

如果答案是"能"——那 §3.5 不急。
如果答案是"不能，因为 X"——那 X 才是真正的下一步。
路线 C：Stage 4 — 符号级调用图（大工程）
ROADMAP 写的长期目标。把文件级依赖图升级到符号级 Call DAG。意味着：

impact --file foo.js --symbol handleLogin 能精确告诉你只有 3 个调用者受影响，不是整个文件的 47 个 dependents
affected-tests 从"这个文件被测试 import 了"变成"这个函数被测试调用了"
dead-exports 从启发式猜测变成确定性判断
成本极高（ROADMAP 自己写了"当前不做"）。需要跨文件 receiver-bound 调用解析、重载消解、继承链追踪。Spring DI / Vue 模板 / 动态 require 仍然解不了。

但—— 你已经有 functionRecords、symbolRegistry、symbol-impact.js。基础设施在那里。问题是从"文件 A import 了文件 B 的 foo"到"文件 A 的 bar() 调用了文件 B 的 foo()"这一步的工程量。

值得做的前提：你认为文件级粒度已经不够用了，AI 在实际修改代码时需要函数级精度。

路线 D：从工具变产品 — guard 命令深化
你刚交付了 guard 命令。这可能是 workspace-bridge 最有产品直觉的功能——在 AI 改代码之前拦截它，告诉它"你要改的这个文件会波及 47 个模块，你确定？"

深化方向：

pre-commit hook 集成：guard --staged --max-transitive 50 失败则阻止提交
AI agent 自动调用：改任何文件前自动跑 guard，超阈值自动拆分修改计划
blast radius 可视化：输出依赖扇出的 ASCII 树或 mermaid 图
这是把 workspace-bridge 从"分析工具"变成"AI 安全护栏"的方向。卖点从"告诉你项目结构"变成"阻止 AI 搞砸事情"。


路线 F：换赛道 — 把 workspace-bridge 变成 SKILL 本身
现在的架构：CLI 是引擎，SKILL.md 是 264 行驾驶手册。AI agent 读 SKILL → 调 CLI → 解析输出 → 做决策。

但如果把 workspace-bridge 的能力直接编码进 skill 的决策逻辑呢？不是"告诉 AI 有哪些命令"，而是"skill 自己判断什么时候该跑什么分析，然后直接把结论注入 AI 的上下文"。

类似于从"给你一把锤子"变成"我帮你钉钉子"。

总结：5 条路线的性质
路线	性质	风险	回报
A：继续打磨	维护	零	递减
B：实战验证	产品发现	低	高信息密度
C：符号级调用图	技术攻坚	高	质变（如果成功）
D：guard 深化	产品聚焦	中	明确卖点
F：SKILL 自动化	形态转换	中	改变使用方式

## 本轮上下文：参考仓库探索与架构借鉴（活跃）

> **背景**：为验证蓝图的技术可行性和避免闭门造车，对参考仓库进行了主动同步与架构对标。

### 参考仓库状态

| 仓库                        | 旧 HEAD      | 新 HEAD      | 变更规模  | 关键更新                                                                                                             |
| :-------------------------- | :----------- | :----------- | :-------- | :------------------------------------------------------------------------------------------------------------------- |
| **CodeGraphContext**  | `5b1a1f6`  | `fb093bb`  | 39 文件   | E2E Bug 报告扩充、writer 路径规范化测试、watcher 轮询观察器测试                                                      |
| **GitNexus**          | `b9a17f55` | `1716bf7c` | 1629 文件 | 多语言 scope resolution 大重构、PR Swarm Review、devcontainer、i18n、CLI`uninstall`、graph-assisted 路由提取       |
| **code-review-graph** | `0c9a5ff`  | `0c9a5ff`  | —        | 已是最新。Python MCP server，tree-sitter + SQLite，Leiden 聚类，5 维度 risk scoring                                  |
| **qartez-mcp**        | `ac6fec2`  | `ac6fec2`  | —        | 已是最新。Rust MCP server + CLI 双模式，37 语言 tree-sitter，workspace fingerprint 增量，6 层启发式 scope resolution |

### GitNexus 架构探索摘要（7 个维度）

| 维度                          | GitNexus 核心做法                                                                                                                      | 对 workspace-bridge 的借鉴价值                                                                                                                                                               |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. 语言插件管道**     | `LanguageProvider` + `ScopeResolver` 双契约；`satisfies Record<SupportedLanguages, LanguageProvider>` 编译时穷举表；统一捕获标签 | **高** → Wave 13-1 语言注册表统一契约可直接引用此模式，替代当前约定俗成的 parser 返回结构                                                                                             |
| **2. Scope Resolution** | 通用编排器 + 语言钩子；SCC 有序跨文件返回类型传播；MRO-aware dispatch                                                                  | **中** → workspace-bridge 定位"结构分析 ≠ 语义分析"，不追求完整 call graph，但 **3-tier import resolution** 和 **confidence-tiered edges** 可直接强化 Wave 10 的置信飞轮 |
| **3. Call Graph**       | 跨文件、receiver-bound、arity/type-aware overload 消解                                                                                 | **低（当前不做）** → 超出项目定位                                                                                                                                                     |
| **4. 路由提取**         | **Graph-first** 策略：优先复用 ingestion 时已产生的 `HANDLES_ROUTE` edges（符号级），fallback 才走 tree-sitter source-scan     | **高** → 对应下一步**方向 2**。实施路径：将路由提取从 `savePrecomputed` 的同步 source-scan 前移到 `builder.js` parse phase，AST-based 提取并关联 handler 符号               |
| **5. PR Swarm Review**  | CLI-neutral canonical spec + 薄 wrapper；7 persona 分 lane 执行；model-tier routing；Synthesis Critic 硬 gate                          | **中** → Wave 12 输出精炼可借鉴其结构化 finding 格式                                                                                                                                  |
| **6. 增量更新**         | **Shadow-candidate 枚举**；**1-hop boundary expansion**；chunk-level parse cache                                           | **高** → Wave 15-4 增量更新已引入 shadow-candidates + 1-hop boundary expansion，解决了跨文件边元数据 stale 问题                                                                       |
| **7. 图存储**           | LadybugDB（KuzuDB 派生）；edge evidence traces                                                                                         | **中** → SQLite 足够；但 **edge evidence traces** 可作为 Wave 11-4 统一 risk scoring 的输入                                                                                     |

### CodeGraphContext 架构探索摘要

| 维度                          | CGC 核心做法                                                                         | 对 workspace-bridge 的借鉴价值                                                                                    |
| :---------------------------- | :----------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| **1. 整体管道**         | Discovery → Pre-scan（全局`imports_map`）→ Parse → Write Pass 1 → Write Pass 2 | **中** → 两阶段写入（nodes first, edges second）与 Wave 10 的 Parse-and-Link 一致                          |
| **2. 多数据库后端**     | Neo4j/FalkorDB/KuzuDB/LadybugDB/Nornic 五后端                                        | **低** → SQLite 关系模型对 CLI 更务实                                                                      |
| **3. SCIP 混合索引**    | 可选 SCIP + Tree-sitter overlay                                                      | **中** → "SCIP 验证/覆盖 heuristic edges"的模式可作为未来 **strict mode** 的设计参考                 |
| **4. Watcher 增量更新** | `watchdog` 轮询/事件驱动；2s debounce；**O(k) 邻居重链接**                   | **高** → CGC 的 "query neighbors before delete" 是 watch 模式的最佳实践                                    |
| **5. Bundle 系统**      | `.cgc` ZIP 预索引图快照                                                            | **低** → 我们的 SQLite cache 已是等价物                                                                    |
| **6. 路径规范化**       | `Path(p).resolve().as_posix()` 强制正斜杠                                          | **高** → **stark warning**。已审计并修复 `path.js` 跨平台路径回归，防范 Windows 反斜杠查询静默失败 |
| **7. API/MCP 层**       | FastAPI + MCP SSE server                                                             | **低** → 明确排除，保持 CLI-only                                                                           |
| **8. 测试策略**         | Golden tests；E2E parity tests                                                       | **高** → 计划引入 parser golden snapshot 测试和路径回归测试                                                |

### code-review-graph 架构探索摘要

| 维度                      | CRG 核心做法                                                                            | 对 workspace-bridge 的借鉴价值                                                     |
| :------------------------ | :-------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| **1. 整体定位**     | Python MCP server，tree-sitter + SQLite                                                 | **中** → 验证了 "tree-sitter + SQLite + impact radius" 方向的市场价值       |
| **2. 核心图模型**   | 节点 =`File`/`Class`/`Function`，边 = `CALLS`/`IMPORTS_FROM`等；递归 CTE 查找 | **高** → SQLite recursive CTE 做 BFS，可评估迁移以减少 JS-side BFS 内存占用 |
| **3. Leiden 聚类**  | igraph 依赖， co-change cohesion 计算                                                   | **中** → 可直接用于增强 `audit-boundaries` 目录划分                       |
| **4. Risk Scoring** | 5 维度加法模型（flow + community + test + security + caller），max 聚合                 | **高** → 直接对应 Wave 11-4 "统一 risk scoring（5 维度）"                   |

### qartez-mcp 架构探索摘要

| 维度                            | qartez 核心做法                                      | 对 workspace-bridge 的借鉴价值                                                                                   |
| :------------------------------ | :--------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| **1. 整体架构**           | Rust MCP server + CLI 双模式，SQLite WAL+mmap        | **中** → `OutputFormat` 枚举设计更干净                                                                  |
| **2. 解析与图构建**       | shape hash；`owner_type`/`parent_idx` 捕获       | **高** → 强化 `functionRecords`/`exportRecords` 以改善方法重载消解（method disambiguation）           |
| **3. Scope Resolution**   | 6 层启发式逻辑；`via_method_syntax` 规避泛型迭代器 | **高** → `via_method_syntax` 防止类似 `map`/`filter` 的迭代器方法在 JS 中产生大量跨文件 false edges |
| **4. Workspace/Monorepo** | 自动解析包管理器配置文件中的 workspace 定义          | **中** → 对应 Wave 14-4 自动发现                                                                          |
| **5. ParseCache 与增量**  | Workspace fingerprint 级别的冷启动跳过               | **高** → 替代逐文件 mtime 检查，实现 cold-start 秒级跳过                                                  |

### 借鉴优先级与 Wave 映射

| 优先级       | 借鉴点                      | 对应 Wave    | 预计改动文件                       | 设计参考                          |
| :----------- | :-------------------------- | :----------- | :--------------------------------- | :-------------------------------- |
| **P0** | 1-hop 边界扩展增量更新      | 15-4         | `builder.js`                     | ✅ 已交付 (GitNexus 模式)         |
| **P0** | 框架检测 query 化           | 15-2         | `framework-patterns.js`          | ✅ 已交付 (Java/Kotlin/Python/JS) |
| **P1** | 语言注册表显式契约          | 13-1         | `parsers/registry.js`            | ✅ 已交付 (GitNexus 模式)         |
| **P1** | Edge evidence traces        | 强化 Wave 10 | `builder.js`, `graph-db.js`    | ⏳ 规划中                         |
| **P2** | Graph-first 路由提取        | 修复 L3      | `builder.js`, `persistence.js` | **方向 2（待开发）**        |
| **P3** | Parser golden snapshot 测试 | 补测试       | `test/`                          | ⏳ 规划中                         |

### Route B 实战验证（本轮新增）

> **目标**：验证 workspace-bridge 的输出是否足以让 AI agent 在真实项目中做修改决策。
> 详见完整报告：`scratch/gitnexus-validation-report.md`

**验证对象**：`reference/GitNexus`（TypeScript，1290 文件）
**聚焦文件**：`gitnexus/src/core/ingestion/scope-resolution/scope/walkers.ts`（30 直接依赖，最近 #2038 大重构涉及）

**关键发现**：

| 维度         | 结果                                                                                               | 评估              |
| :----------- | :------------------------------------------------------------------------------------------------- | :---------------- |
| 依赖图准确性 | `impact` = 63 文件，`affected-tests` = 27 个测试，symbol-level 导入细节准确                    | ✅ 高价值         |
| 循环依赖风险 | `cycles = 0`                                                                                     | ✅ 无风险         |
| 解析完整性   | `coverageRatio = 1.00`                                                                           | ✅ 可信           |
| 验证命令建议 | `audit-file` 的 `validationAdvice.commands.focused/full` 为空，仅建议 `git diff --check`     | ❌ 最后一英里断裂 |
| 启发式误报   | `csharp-hooks.test.ts` 因注释中提到 `lookupBindingsAt` 被 `mention:stem` 算入 affected tests | ⚠️ 低置信度噪音 |
| 路由噪音     | `affectedRoutes` 包含测试文件中的 Express 路由，未区分 `src/` vs `test/`                     | ⚠️ 相关性低     |

**验证结果**：

- ✅ `audit-file` 现在会生成 `node-direct-tests` / `python-direct-tests` 等 focused 命令（复用 `generateCommands` 的 `run-direct-tests` step）。
- ✅ `pickSuggestedCommand` 优先推荐 `direct-tests`，AI 拿到输出后可直接执行。
- ⚠️ GitNexus 根目录未检测到 vitest（子包在 `gitnexus/`），命令回退为 `npm run test`；这是 stack-detector 的 monorepo 边界问题，非本次修复范围。

**验证结果**：

- ✅ `affected-tests` `mention` 启发式现在在匹配前会按语言族去除注释（C-family / Python / Ruby），`csharp-hooks.test.ts` 这种仅注释引用的情况不再被误报。
- ⚠️ 旧缓存可能仍保留修复前的 mention 结果；新缓存或 `--cache-dir` 刷新后生效。

**验证结果**：

- ✅ `impact.affectedRoutes` 现在为每条路由附加 `source: 'src' | 'test'`，AI 消费者可直接过滤掉测试夹具路由。
- 实现路径：`src/services/dep-graph/query.js` 在 SQLite CTE 快速路径和内存 BFS 回退路径统一通过 `isTestLikeFile()` 计算 `source`。

**Route B 扩展验证：qartez-mcp（Rust，223 文件）**

**聚焦文件**：`src/guard.rs`（35 直接依赖，14 个 affected tests）

| 维度         | 结果                                                                                              | 评估              |
| :----------- | :------------------------------------------------------------------------------------------------ | :---------------- |
| 依赖图准确性 | `impact` = 35 文件，`affected-tests` = 14 个测试，symbol-level 准确                           | ✅ 高价值         |
| 验证命令建议 | `audit-file` 生成 `cargo test server::tools::test_gaps`，但 13 个 `tests/*.rs` 集成测试丢失 | ❌ 最后一英里断裂 |
| 死导出       | `deadExports = 113`，大量 `pub` 项为库公共 API 误报                                           | ⚠️ 已知限制     |
| 解析完整性   | `coverageRatio = 0.91`，19 个 Rust 测试文件 regex fallback                                      | ⚠️ 可接受       |

**验证结果**：

- ✅ Rust focused/direct 命令现在拆分单元模块与集成测试：`cargo test <module>` 与 `cargo test --test <stem>`，14 个 affected tests 全部可执行。

**验证结果**：

- ✅ Rust 库公共 API 死导出误报已修复。`src/lib.rs` 通过 `pub mod` 链式公开的模块中，`pub` 未使用项会被标记为 `rust-public-api` 并降级为 `low` confidence，不再驱动仓库级 severity。
- 在 `reference/qartez-mcp` 上：113 个死导出候选中 75 个被正确识别为公共 API 误报并降级。

**Route B 扩展验证：ai_zcypg_backend（Java Spring Boot，395 文件）**

**聚焦文件**：`aizcypg-biz/src/main/java/com/aizcypg/biz/controller/PolicyMissingController.java`
**真实任务**：实现 `checkMissing` 方法 TODO（`/policy/policies/{policyId}/missing-check` 缺漏检查逻辑）
**完整报告**：`scratch/route-b-report-ai-zcypg-backend.md`

| 维度         | 结果                                                                                                      | 评估                                 |
| :----------- | :-------------------------------------------------------------------------------------------------------- | :----------------------------------- |
| 解析完整性   | `coverageRatio = 1.00`（395/395）                                                                       | ✅ 可信                              |
| 框架识别     | `spring-controller-file` / `isEntry=true`                                                             | ✅ 高价值                            |
| 依赖图准确性 | `impact` = 13 文件，但全为同包 Controller 可见性误报；全项目搜索无真实 `PolicyMissingController` 引用 | ❌**核心误报**                 |
| 路由噪音     | `affectedRoutes` 包含 30+ 条路由，大量来自被误报的 Controller                                           | ⚠️ 噪音高                          |
| 验证命令     | `mvn -q -Dtest=*Test test`，但项目无 `src/test/java`                                                  | ❌ 不匹配实际                        |
| symbolImpact | 10 个符号全部`dependentsCount=0`                                                                        | ⚠️ Java Spring DI/反射无法静态解析 |

**Route B 第二轮验证：ai_zcypg_backend / PolicyChatController.java**

**聚焦文件**：`aizcypg-biz/src/main/java/com/aizcypg/biz/controller/PolicyChatController.java`
**真实任务**：实现 `callAiForAnswer` 方法 TODO（对接 Dify 聊天 API）
**完整报告**：`scratch/route-b-report-ai-zcypg-backend-02.md`

| 维度                 | 结果                                                                                       | 评估                                                                       |
| :------------------- | :----------------------------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| 上一轮修复持续性     | 13 个 impact 全部`implicit-same-package`                                                 | ✅ 修复稳定                                                                |
| 验证命令             | 修复前：`mvn -q -Dtest=*Test test`；修复后：`mvn -q -DskipTests compile` / `package` | ✅ 已修复                                                                  |
| 路由噪音             | `affectedRoutes` 30+ 条，已按 direct 和 non-implicit 排序并过滤/分组                     | ✅ 已修复                                                                  |
| symbolImpact         | 已追加 Java Spring DI 限制说明注解                                                         | ✅ 已修复                                                                  |
| 多模块命令           | 模块路径已正常识别并追加`-pl` 与 `-am` 参数                                            | ✅ 已修复                                                                  |
| `--cwd` 子目录行为 | 子目录下运行`--cwd` 被自动提升至 Git 根目录                                              | ✅**本轮修复**（`strictCwd` 默认开启，Git 路径自动相对映射与过滤） |

**剩余缺口**：

- Route B 实战验证发现的所有 7 个消费体验缺口已全部修复并验证通过。
- `--cwd` 子目录限制分析已完美支持。
- 配置文件的非阻塞警告（warnings 收集）已完成支持，且跨平台路径归一化回归测试套件 100% PASS。
- 全量测试套件 `npm run test:fast` 达到 127/127 PASS。

---

## 下一步候选方向与多语言框架检测矩阵

### 候选方向状态（更新于 2026-07-02）

* **方向 1：Java / Kotlin 框架检测 Query 化**

  * **状态**：✅ 已于 2026-06-13 交付。
  * **内容**：新建了 `java-spring.js`、`java-spring-boot.js`、`kt-spring.js`、`kt-ktor.js` 动态 Query 模块，并完成注册与测试。
* **方向 2：Graph-first 路由提取升级**

  * **状态**：✅ 已于 2026-06-17 交付。
  * **内容**：实现了通过 SQLite 递归 CTE 直接进行图查询获取 affectedRoutes，避免了全量 BFS 或 disk source-scan 开销；补全了 cache.js 中的 saveRoutes 等持久化方法与测试。
* **方向 3：CLI 可测试化入口**

  * **状态**：✅ 已交付（`cli.js` 已导出 `runCliInProcess()`）。
  * **遗留**：大量测试仍使用 child process spawn，迁移率低；文档中曾仍列为待开发，已修正。
* **方向 4：策展可信度（Wave C）**

  * **状态**：✅ 已于 2026-06-14 交付。
  * **已完成**：动态 registry 模块已纳入 orphan 可达性（#11）；`SHADOW_EXTS` 等已知误报已排除 severity（#12）；个人仓库 knowledge risk 已关闭/降级（#14）；默认 overview 已不再跑逐文件 blame（#10）；REPL `top` 等架构指标默认排除 test→source 边（#13）。
* **方向 5：Agent 产品形态（Wave D）**

  * **状态**：🔄 部分交付，中优先级。
  * **已完成**：`--quiet` 下 SQLite warning 泄漏已修复（#9）；`workspace-info` 已改为真正轻量命令（#15），实测 `<1s`；默认 `audit-overview` 已跳过逐文件 blame（#10），热缓存从 ~56s 降至 ~16s。
  * **已完成（本轮）**：配置文件 `.workspace-bridge.json` 语法与未知参数校验从致命报错改写为非阻塞的 `config-warning`，在 final output warnings[] 数组中反馈。
  * **已完成（本轮）**：大仓库索引进度可视化——`ServiceContainer` 输出阶段进度，`FileIndex` 输出百分比进度并发出 `progress` 事件，解决用户不知道是在工作还是卡住的问题。
  * **已完成（本轮）**：聚合快照缓存命中修复——`overview-tools.js` 与 `query-tools.js` 的 `isSnapshotFresh` 统一跳过 content-change 检查；`audit-overview` 核心计算从 ~5s 压到 ~10ms，`query-stability` / `query-knowledge-risk` 热缓存 ~2s，`query-hotspots` 核心查询逻辑 ~10ms。
  * **已完成（本轮）**：`skills/workspace-audit/SKILL.md` 按层级重组，从 333 行精简到 ~112 行，保留"默认参数 / 核心决策树 / 何时不用 / 预热工作流 / 安全清单"。
  * **待完成**：继续降低端到端 CLI 耗时（当前受 container 初始化 ~1.5s 制约）和默认输出 JSON 体积（当前 ~15KB，目标 <8KB）。

---

### 多语言框架检测与路由提取支持矩阵

| 语言   | 框架                              | 框架检测方式                                                                             | 已有 route-extraction query？                                                 |
| :----- | :-------------------------------- | :--------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| JS/TS  | NestJS                            | regex (`AST_PATTERNS`)                                                                 | ✅`js-nestjs.js`                                                            |
|        | Vue / Vue-router                  | ✅ AST-Query (`js-vue.js`)                                                             | ❌                                                                            |
|        | Nuxt                              | 路径推断 + route query                                                                   | ✅`js-nuxt.js`                                                              |
|        | SvelteKit                         | 路径推断 + route query                                                                   | ✅`js-sveltekit.js`                                                         |
| Python | Django / FastAPI / Flask / Celery | ✅ AST-Query (`py-django.js` / `py-fastapi.js` / `py-flask.js` / `py-celery.js`) | ✅ Django / FastAPI (`py-django.js` / `py-fastapi.js`); ❌ Flask / Celery |
| Java   | Spring / Spring Boot              | ✅ AST-Query (`java-spring.js` / `java-spring-boot.js`)                              | ✅`java-spring.js`                                                          |
|        | Quartz                            | regex                                                                                    | ❌                                                                            |
|        | MyBatis                           | regex                                                                                    | ❌                                                                            |
| Kotlin | Spring-Kotlin                     | ✅ AST-Query (`kt-spring.js`)                                                          | ❌（复用 Java route）                                                         |
|        | Ktor                              | ✅ AST-Query (`kt-ktor.js`)                                                            | ❌                                                                            |
| Go     | Gin                               | ✅ AST-Query (`go-gin.js`)                                                             | ✅`go-gin.js`                                                               |
|        | Echo                              | ✅ AST-Query (`go-echo.js`)                                                            | ❌                                                                            |
|        | Fiber                             | ✅ AST-Query (`go-fiber.js`)                                                           | ✅`go-fiber.js`                                                             |
| Rust   | Actix-web                         | ✅ AST-Query (`rs-actix.js`)                                                           | ✅`rs-actix.js`                                                             |
|        | Axum                              | ✅ AST-Query (`rs-axum.js`)                                                            | ✅`rs-axum.js`                                                              |
|        | Rocket                            | ✅ AST-Query (`rs-rocket.js`)                                                          | ❌                                                                            |
| C/C++  | 无特定框架标签                    | 纯路径推断                                                                               | ❌                                                                            |
| Svelte | Svelte / SvelteKit                | ✅ AST-Query (`js-svelte.js`)                                                          | ✅`js-sveltekit.js`                                                         |
| Vue    | Vue 组件 / Vue-router             | ✅ AST-Query (`js-vue.js`)                                                             | ❌                                                                            |

---

## 修复流程

详见 [AGENTS.md §验证与调试](./AGENTS.md#验证与调试） 与 §Agent 认知边界。

---

## 实战基地

> `C:\Users\sdses\Desktop\神思\code` 是 workspace-bridge 的实战基地，内含四个仓库，用于功能验证与实战演练。

---

*Last updated: 2026-07-23（wave8 + query-tools 两个历史 flaky 彻底根治：affected-tests 深度门禁 + 预计算深度常量统一 + savePrecomputed 清场 + analysis_snapshots 版本门禁 + precomputed_aggregates 单一写入方；CACHE_VERSION 5→6；全量 runner **251/251 全绿**；`npm run test:fast` 137/137 PASS；活跃债务清零；schemaVersion: 1.2.0；version: 2.1.0）*

---

## 架构判断校准记录（2026-07-02）

> 以下结论来自对当前实现的一次审问式复盘，用于修正文档中可能过于自满的描述。

| 原判断                            | 修正后判断                                                                                                                                                                                                       | 依据                   |
| :-------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------- |
| `dep-graph.js` 是“单概念”门面 | **单主契约 + 邻近消费者**：`dep-graph.js:39` 只是门面，真实契约分散在 `builder.js:114`、`analyzer.js:339`、`query.js:40`；同包可见性修正 `450986d` 跨 3 个文件，路由修正 `2fc3340` 跨 2 个文件 | 近期修复实际跨多个文件 |
| resolver 策略链是隐式全局状态     | **显式有序策略链**：`registry.js:18` + `resolvers.js:65` 按注册顺序命中即停；顺序本身就是契约                                                                                                          | 代码结构明确           |
| dead exports 11/12 命中证明可靠   | **只证明 precision，不证明 recall**：现有测试验证高置信命中与 FP 降级，但没有 ground-truth 语料计算漏报率                                                                                                  | 测试覆盖的是保守性     |
| 增量更新是否真实有效              | **真实增量**：`cache.js:673` mtime+size → SHA-256 双路径；`builder.js:699` 只重建 changed files、1-hop dependents、Java 包扩展；query snapshot 宽松 freshness 是设计选择                              | 多份测试覆盖           |
| 9 语言测试是否充分                | **强于 happy path，弱于全面证明**：已有 Java 同包、增量更新、缓存精度、删除清理等语义回归，但缺少系统性的 resolver 冲突表驱动测试和 ground-truth recall 语料                                               | 测试矩阵现状           |

**后续两个最值钱补强方向**：

1. **Resolver 冲突表驱动测试**：明确“同一 import 在不同策略顺序下谁赢”。
2. **Dead exports ground-truth 语料**：至少能同时报告 precision 和 recall，而不是只报高置信命中。

### 7/3 follow-up

- **已补强**：`test/resolver-strategy-chain-test.js` 现在包含真实的 alias vs symbol-table 冲突矩阵，并清理了注册表测试的 `.custom` / `.matrix` 污染；新增 `testSymbolTableBeatsFallback()` 证明 symbol-table 优先于 fallback。
- **已扩展**：`test/dead-export-ground-truth-test.js` 已从单文件 smoke 扩到 JS 多文件真值集，覆盖 direct import、barrel re-export、rename re-export、dynamic import 与 test-like negative；明确排除 namespace import 样本并注释原因。
- **已显式化**：`README.md` 与 `skills/workspace-audit/SKILL.md` 现在均明确写出 `javalang` 是 Java AST 的可选前提，缺失时应把 regex fallback 当成 degraded mode。
- **已归档**：`scratch/commit-root-cause-archive.md` 完成 8 个 6/22–7/2 关键 commit 的“根因-影响文件-回归测试”三件套梳理。
- **已补缺**：新增 `test/data-quality-contract-test.js` 锁定 DataQuality 三态契约；新增 `test/java-spring-symbol-impact-note-test.js` 锁定 Spring DI/reflection 降级说明。
- **仍然成立**：dead-exports 的“recall”只能算 corpus-level smoke，不应被解读成全局证明。
