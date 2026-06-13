# workspace-bridge 系统性代码审查报告

> **审查日期**：2026-06-13
>
> **基线提交**：`a54dc8c feat: queryify Java/Kotlin framework detection & update docs`
>
> **工作区状态**：存在 85 个修改文件；大量差异疑似 CRLF/LF 换行转换，以下结论同时反映当前工作区与已提交架构
>
> **审查范围**：代码、测试、CLI 实测、缓存一致性、CI/发布、README/SKILL/活跃文档
>
> **目的**：集中记录目前已知问题。`TECH_DEBT.md` 仍是正式活跃债务源，本文件是更完整的审查发现池。

---

## 结论摘要

workspace-bridge 已具备多语言 AST、依赖图、SQLite 持久化、增量分析、影响范围和 AI 策展输出等实质能力，不是玩具项目。

当前主要矛盾已经不是“功能不足”，而是：

1. **数据一致性不足**：细粒度查询可能静默返回旧快照。
2. **输出可信度不足**：动态加载模块、测试依赖和个人仓库 blame 会产生误导性建议。
3. **性能与产品定位不符**：推荐给 agent 的基线命令耗时几十秒到两分钟。
4. **发布纪律不足**：测试、Node 版本和发布流程之间缺少硬门禁。
5. **文档单一事实源失效**：多个活跃文档与真实代码、测试状态不一致。

在解决这些问题前，不建议继续优先扩展语言、框架规则或完整 call graph。

---

## 审查基线与实测

### 当前测试结果

```text
npm run test:fast
Ran 109 tests in 43886ms
105 passed, 4 failed
```

失败项：

| 测试 | 现象 |
|---|---|
| `cache-corruption-test.js` | 期望持久化失败返回 `false`，实际返回 `true` |
| `path-utils-test.js` | Unix 环境期望 `/Foo/Bar` 被小写为 `/foo/bar`，与实现契约冲突 |
| `wave11-analysis-deepening-test.js` | Java `else-if` dispatcher 未找到 |
| `wave15-ast-rules-test.js` | Java `batch` 缺少事务注解的 E2E finding 缺失 |

因此，`SESSION.md` 中“109/109 PASS”的记录不代表当前工作区真实状态。

### CLI 性能实测

| 命令 | 环境 | 耗时 | 峰值内存 | 输出 |
|---|---|---:|---:|---:|
| `audit-summary --json --quiet` | 热缓存 | 56.17s | 约 281MB | 35,897 字节 / 1,221 行 |
| `workspace-info --json --quiet` | 已有缓存 | 115.24s | 约 269MB | 990 字节 / 49 行 |

`workspace-info` 并非真正的轻量预检。它仍先执行完整 `ServiceContainer` 初始化、文件索引和依赖图构建。

### 工作区差异噪声

- `git status` 显示 85 个修改文件。
- 原始 diff 约 43,255 行变化。
- 忽略行尾空白后，实质差异主要集中在少数文档文件。
- `git diff --check` 报告大量 trailing whitespace，符合整仓换行符转换特征。

这会掩盖真实代码改动，使 review、bisect 和 merge 的可靠性显著下降。

---

## P0：确定的正确性与数据一致性问题

### P0-1 `query-*` 可能返回过期分析快照

**位置**：`src/tools/query-tools.js`

快照新鲜度只检查：

- `gitHead` 是否相同；
- 文件总数差异是否不超过 5。

它没有检查已有文件内容是否变化，也没有使用 `cache.checkFileChanges()`、内容哈希或工作区 dirty fingerprint。

已通过最小 mock 复现：

```text
checkFileChanges() => { changed: true, changedFiles: ["changed.js"] }
query-hotspots     => 仍返回缓存中的 old.js
```

另外，允许文件数相差 5 仍命中缓存，会让新增、删除少量文件后继续读取旧结果。

**影响**：

- `query-hotspots`
- `query-knowledge-risk`
- `query-stability`

可能在用户修改代码后静默提供旧建议。这违反 L1 数据一致性原则。

**建议方向**：

- 快照指纹至少包含 `gitHead + dirty file fingerprint + config hash + exact file count`。
- 命中快照前调用统一 staleness API，不在 `query-tools.js` 维护第二套判断。
- 增加“修改已有文件但 HEAD/文件数不变”的回归测试。

---

### P0-2 CLI 参数优先级被环境变量反向覆盖

**位置**：`src/cli/validate-args.js`

`resolveOption()` 当前先读取环境变量，再读取 CLI 参数。实际优先级是：

```text
环境变量 > CLI 参数
```

这与文档约定和常规 CLI 语义相反。已复现：

```text
WB_FORMAT=markdown ... --format ai  => markdown
WB_CWD=/tmp/from-env ... --cwd /tmp/from-cli => /tmp/from-env
WB_QUIET=0 ... --quiet => quiet=false
WB_JSON=0 ... --json => json=false
```

**影响**：

- agent 显式传参仍可能被宿主环境静默改写；
- `--json` 可能被关闭，破坏机器消费；
- `--quiet` 可能被关闭，污染 stderr；
- `--cwd` 可能分析错误仓库。

**建议方向**：

统一为：

```text
CLI args > 环境变量 > 项目配置 > 用户配置 > 内置默认值
```

并为每类标量和布尔参数增加 precedence contract tests。

---

### P0-3 当前快速测试基线失败

当前 `npm run test:fast` 为 105/109，而不是文档中的 109/109。

其中至少包含两类问题：

1. 生产行为回归：Java AST rule / dispatcher 提取。
2. 测试契约错误或环境假设错误：
   - Unix 路径大小写测试与实现约定冲突；
   - `chmod 0555` 在 WSL 挂载盘、root 或特殊文件系统上不能稳定制造写失败。

**建议方向**：

- 逐项判断生产回归与测试错误，不能以“更新断言”统一处理。
- 缓存失败测试应通过可控 dependency injection 或 mock 制造数据库错误。
- 修复后重新完整运行 `npm run test:fast`，不能只单跑失败文件。

---

### P0-4 SQLite 并发冷启动会静默丢失持久化写入

**位置**：

- `src/services/graph-db.js`
- `src/services/cache.js`
- `test/cache-concurrency-test.js`

专项审计使用 6 个进程同时打开同一个全新数据库，每个进程连续执行 10 次 `saveEdges()`。

稳定复现结果：

```text
writer 0-4: passed=0, failed=10
writer 5:   passed=10, failed=0
```

失败链：

```text
database is locked
-> schema 初始化未完成
-> 后续写入持续报 no such table: edges
```

但 5 个完全写入失败的 worker **退出码仍为 0**。最终数据库物理完整，只有最后一个 writer 的 500 条边存在，其他写入全部丢失。

现有 `cache-concurrency-test.js` 只断言：

- 两个 CLI 进程退出码为 0；
- 输出 JSON `ok=true`；
- stderr 没有 lock 字样。

生产代码在非 DEBUG 模式下吞掉数据库错误，因此该测试无法识别“CLI 分析成功但缓存完全没有落盘”。

**根因**：

- `_ensureOpen()` 没有 `busy_timeout`、重试或跨进程初始化锁；
- schema 创建和 migration 在每个进程首次打开时竞争；
- `saveEdges()` 等 API 将异常压缩为 `false`；
- 上层多数调用忽略该返回值。

**建议方向**：

- 数据库初始化使用单写者锁或带退避的 schema bootstrap。
- 配置 SQLite `busy_timeout`，但不能把它当作业务协调的替代品。
- 持久化失败必须进入 `warnings[]` 或使 cache 状态明确降级，不能静默成功。
- 并发测试应检查数据库中的 generation、表和记录，而不仅是 CLI 退出码。

---

### P0-5 预计算结果不是原子快照，崩溃后会产生混合代际数据

**位置**：

- `src/services/dep-graph/persistence.js`
- `src/services/graph-db.js`
- `src/services/dep-graph/analyzer.js`

一次 `savePrecomputed()` 会依次、分别提交：

1. aggregates
2. impact
3. routes
4. metrics
5. test map

每一步是独立事务。专项审计先写入 generation A，再让子进程写入 generation B aggregates 后立即 `SIGKILL`。

重启读取结果：

```text
aggregates: generation B, version 2
impact:     generation A, version 1
```

SQLite 单事务恢复本身是可靠的：在 `BEGIN + DELETE edges` 后 `SIGKILL`，重启能完整保留旧 edges，`PRAGMA integrity_check=ok`。问题在应用层把一个业务快照拆成多个事务。

恢复端也没有挡住混合代际：

- `injectPrecomputedAggregates()` 注释声称检查所有 row 的 version/fileCount，实际只检查第一行 `fileCount`；
- `injectPrecomputedImpact()` 只检查行数与 graph size 接近，不检查 row version；
- 已用 version 1/99 混合 rows 复现，两种 inject 均返回 `true`。

**影响**：

- overview、impact、routes、metrics 和 affected-tests 可能来自不同一次图构建；
- 数据库 `integrity_check` 仍为正常，因此普通损坏检测发现不了；
- 问题会表现为偶发、难复现的结果矛盾。

**建议方向**：

- 引入单一 `snapshot_generation`。
- 所有预计算表先写入新 generation，再通过一次原子 metadata 切换发布。
- 读取端只加载同一 generation 的完整集合。
- 最低限度也要严格验证所有 row version，并在任何维度缺失/不一致时整体放弃预计算。

---

## P1：高优先级产品可信度问题

### P1-1 动态加载 Query 模块被误判为孤儿并建议删除

**位置**：

- `src/utils/orphan-detector.js`
- `src/tools/overview-curator.js`
- `src/services/dep-graph/framework-patterns.js`

自审结果把以下运行时动态加载模块列为孤儿：

- route extraction query
- framework detection query

随后直接生成：

```text
审查孤儿模块是否可删除
```

这是危险建议。项目已经知道动态 `require` 会导致 dead-export 误报，但 orphan 路径仍没有共享同一套运行时 registry 可达性语义。

**建议方向**：

- registry 中注册的模块应成为显式 entry/reachable node。
- orphan、dead-export 和 project-map 必须消费同一个“运行时可达性”来源。
- 低置信 orphan 只能提示“无法静态确认用途”，不得生成删除建议。

---

### P1-2 已知假阳性仍会抬高仓库 severity

`SHADOW_EXTS` 已被文档认定为动态加载导致的静态分析误报，但仍作为 dead export candidate 参与：

- findings 数量；
- summary insight；
- severity；
- next steps。

**影响**：工具知道结论不可靠，却仍把它用于仓库级判断。

**建议方向**：

- `falsePositiveReason` 或低 confidence finding 默认不参与仓库 severity。
- “展示候选”和“驱动决策”应分开。
- 已知 registry 动态引用应从根因上建立边，而不是长期加白。

---

### P1-3 测试依赖污染生产架构指标

`src/services/dep-graph/parsers/js/shared.js` 被报告有 181 个 dependents。实际查询样本中大量为测试文件。

测试对生产模块的依赖被用于：

- core module 排名；
- coupling；
- hotspot；
- stability；
- split suggestion。

这会夸大生产耦合和重构风险。

**建议方向**：

保留两种视图：

1. **Impact view**：包含测试边，用于 affected-tests。
2. **Architecture view**：默认排除 test/reference/archive/generated → production 边。

不得用同一总度数同时回答“改动影响”与“生产架构耦合”。

---

### P1-4 Knowledge Risk 在个人仓库和 dirty worktree 中失真

当前 blame 结果把以下身份计入知识风险：

- `Not Committed Yet`
- 测试提交使用的 `Test`
- 单人项目的唯一作者

项目自身明确定位为个人项目，因此“单作者 = high risk”几乎覆盖全部文件，既没有区分度，也没有行动价值。

**额外成本**：逐文件 `git blame` 是 `audit-overview` 的主要性能负担之一。

**建议方向**：

- 作者总数为 1 的仓库默认将 knowledge risk 标为 `not-applicable`。
- 未提交行单独计为 working-tree ownership，不当作真实作者。
- 默认基线不运行 blame；改为显式 `--with-knowledge-risk` 或缓存后的专项查询。

---

### P1-5 `workspace-info` 伪装成轻量预热

**位置**：

- `cli.js`
- `src/services/container.js`
- `src/tools/workspace-tools.js`
- `skills/workspace-audit/SKILL.md`

skill 宣称：

```text
workspace-info 是 <2s 的轻量预检，可触发缓存
```

实际命令走完整容器初始化，实测 115.24 秒。推荐工作流会让 agent 先付出一次完整初始化，再运行一次重命令。

**建议方向**：

- `workspace-info` 改为 self-managed/lightweight command，不初始化 dep graph。
- 只读取 marker、配置、文件数量采样和 parser availability。
- 若需要预热，新增名字明确的 `warm-cache`，不要让信息命令承担隐式重任务。

---

### P1-6 `audit-summary/audit-overview` 不适合作为每次会话基线

热缓存仍需 56.17 秒、约 281MB，并输出 1,221 行 JSON。

这与以下目标冲突：

- CLI-first agent 脚手架；
- 新会话快速摸底；
- Token 预算感知；
- 预组装、去噪。

**建议方向**：

- 默认入口只计算高置信、低成本维度。
- history/blame/trend/security/smells 作为按需扩展。
- 建立热缓存 `<2s`、默认 JSON `<8KB` 的产品门槛。
- 细节通过 `query-*` 渐进加载，但必须先修复快照 staleness。

---

### P1-7 `--quiet` 仍污染 stderr

实测：

```text
node cli.js workspace-info --cwd . --json --quiet
```

stderr 仍包含 Node SQLite `ExperimentalWarning`。

根因是 `require('node:sqlite')` 在模块顶层发生，警告在 `_suppressSqliteExperimentalWarning()` 安装前已经触发。

**影响**：

- 与 skill 中“输出纯净”的承诺不符；
- 合并 stdout/stderr 的调用方可能无法解析 JSON；
- 测试需要特殊过滤 runtime warning。

**建议方向**：

- 不在库内 monkey-patch 全局 warning API。
- 将 SQLite import 延迟到可控初始化点，或由 CLI bootstrap 在加载 GraphDB 前处理。
- JSON 模式必须有 stderr cleanliness contract test。

---

### P1-8 `process.emitWarning` 全局 monkey-patch 仍是架构风险

**位置**：`src/services/graph-db.js`

历史修复仅通过引用计数改善多实例恢复，但仍会替换整个进程的 `process.emitWarning`。

**风险**：

- 嵌入式使用时吞掉其他库的 warning；
- `_ensureOpen()` 中途异常可能导致计数与真实实例不一致；
- 模块加载期 warning 无法覆盖；
- 资源实例不应拥有进程级全局行为。

该问题不应继续标为“完全修复”，更准确的状态是“多实例恢复部分缓解，根因仍在”。

---

### P1-9 真实循环依赖未列入正式活跃债务

当前自审发现：

```text
src/tools/incremental-diff.js
  <-> src/tools/audit-assembler.js
```

根因是 `incremental-diff.js` 反向 require `filterByCategory`，而 assembler 又加载 incremental diff。

**建议方向**：

- 将纯分类过滤函数下沉到独立已有宿主，例如 `src/tools` 的共享纯函数模块。
- 不使用 callback 注入掩盖简单职责错误。

---

## P1：CI、发布与兼容性问题

### P1-10 性能 CI 使用不受支持的 Node 20

**位置**：

- `.github/workflows/perf-guardrail.yml`
- `package.json`

项目声明：

```json
"node": ">=22.5.0"
```

并直接依赖 `node:sqlite`，但性能 workflow 配置 Node 20。

**影响**：性能门禁可能在初始化阶段失败，而不是测到性能。

**建议方向**：CI 至少覆盖 Node 22 和当前发布使用的 Node 24。

---

### P1-11 没有常规测试 CI

现有 workflow 只有性能与 release，没有一个 PR workflow 运行：

- `npm run test:fast`
- smoke/full tests
- package installation test
- lint/format checks

因此文档中的“全绿”依赖人工维护，无法作为合并门禁。

---

### P1-12 Release 在测试前直接发布

`release.yml` 在 tag push 后直接执行：

1. `npm pack`
2. 创建 GitHub Release
3. `npm publish`

没有测试、Node engine 检查、tarball 安装验证或 CLI smoke test。

**风险**：当前 4 个失败测试的状态仍可发布正式 npm 版本。

**建议方向**：

- release 依赖已通过的 CI commit；
- tarball 安装到临时目录后运行 `--version`、`workspace-info`、小 fixture audit；
- 确认 Python fallback scripts 和 WASM 资产可用。

---

### P1-13 包产物没有独立安装验证

`npm pack --dry-run` 能生成约 464KB tarball，但这只能证明文件被打包，不能证明：

- 全局 bin 安装后可运行；
- `node:sqlite` engine 要求被正确处理；
- Python helper 路径正确；
- tree-sitter WASM 在 npm tarball 中可解析；
- 非仓库 cwd 下动态 Query require 正常。

这些应通过 packed-tarball E2E，而不是源码目录测试替代。

---

### P1-14 `--version` / `--help` 提前加载完整分析栈

**位置**：`cli.js`

CLI 在解析并处理 `--version` / `--help` 之前，顶层加载：

- `ServiceContainer`
- command registry
- formatter registry
- `GraphDB`
- `node:sqlite`

隔离 tarball 实测：

| 命令 | 耗时 | 峰值内存 | stderr |
|---|---:|---:|---|
| `--version` | 0.21s | 约 60MB | SQLite ExperimentalWarning |
| `--help` | 0.25s | 约 63MB | SQLite ExperimentalWarning |

这还导致最基础的版本探测也依赖分析栈能成功加载。若 SQLite、parser 或某个 command module 有加载错误，用户甚至无法执行 `--help` 获取诊断信息。

**建议方向**：

- bootstrap 后先做最小参数扫描，直接处理 `--version` 和静态 help。
- 延迟加载 `ServiceContainer`、commands 和 formatters，直到确定需要执行分析命令。
- 把“CLI shell 可启动”和“分析引擎可初始化”分成两个独立契约。

---

## P2：测试与工程治理缺口

### P2-1 测试分层标记没有落实

AGENTS 要求所有测试文件头显式标注：

- `// @contract`
- `// @semantic`

实际：

```text
测试文件总数：202
已标记：68
未标记：134
```

测试 runner 自身使用另一套 `@slow/@watch/@serial` 和文件名/内容启发式分类。两个分类体系没有统一。

---

### P2-2 CLI 测试仍大量 spawn

约 44 个测试文件包含 child process/spawn，约有 189 次 `runCli*` 调用。

虽然 `cli.js` 已导出 `runCliInProcess()`，但直接使用者很少。结果是：

- 测试慢；
- Windows/WSL 环境差异放大；
- warning、编码、路径与进程启动噪声混入业务测试；
- runner 需要复杂的 warm cache 和 slow-test 启发式。

**建议方向**：

- 参数/handler/schema 测试使用 in-process。
- 只保留少量真正验证 bin、stdio、exit code、signal 的 spawn E2E。

---

### P2-3 Coverage 没有质量门槛

存在 `test:coverage` 命令，但 CI 不运行，也没有 statements/branches/functions/lines 最低阈值。

“所有核心模块有专属测试”不等于关键分支被覆盖，当前 CLI/env precedence 与 query staleness 就没有被现有测试发现。

---

### P2-4 测试 runner 分类依赖启发式

runner 通过：

- 文件名正则；
- 源码内容搜索；
- 手工 `KNOWN_SLOW_PATTERNS`

判断 fast/slow/watch。

这容易在测试重命名或 helper 封装后误分类，也解释了“fast”层仍耗时约 44 秒并包含 11 秒测试。

**建议方向**：逐步改成测试头显式 metadata，并由 runner 验证所有测试都有唯一层级。

---

### P2-5 已知 flaky 被文档化而非根治

已知包括：

- `repl-test.js`
- `audit-file-watch-test.js`

“失败后重跑”不应成为稳定基线。尤其 watch/signal 是 CLI 生命周期核心语义，应使用可控事件源、轮询断言和明确超时。

---

### P2-6 工作区换行符污染

当前大量文件表现为整文件删除再新增，`git diff --check` 出现大量 trailing whitespace。

**建议方向**：

- 先隔离并清理纯 EOL 变化；
- 增加 `.gitattributes` 固定源码和文档换行策略；
- 不要让格式化差异与功能改动进入同一提交。

---

### P2-7 Schema version 多处硬编码

`"1.2.0"` 分散存在于：

- `overview-assembler.js`
- `query-tools.js`
- `tree-tools.js`
- `regression-tools.js`
- dashboard/formatter

虽然已有 `SCHEMA_VERSION` 常量，但没有统一使用。

**风险**：版本升级后不同命令输出不同 schemaVersion。

---

### P2-8 “只读” WorkspaceSnapshot 暴露可变核心对象

`DependencyGraphView` 直接暴露：

- `graph`
- `reverseGraph`
- `analyzer`
- `symbolRegistry`

工具层可以绕过 facade 直接修改 Map 或 analyzer 状态。当前代码已经通过 `container.snapshot.graph.graph` 穿透到内部图。

**建议方向**：

- 对外提供只读迭代和查询方法；
- AST rule 等 consumer 不应依赖底层 Map；
- 若暂时不能收紧，至少不要将其描述为真正只读边界。

---

## P2：文档与产品契约漂移

### P2-9 `SKILL.md` 已重新膨胀

项目目标曾描述 skill 约 50/80 行，只保留“何时用、何时不用、标准工作流”。

实际：

```text
333 行
19,681 字节
```

它已经重新成为完整命令手册和架构文档，增加 agent 上下文成本。

---

### P2-10 SKILL 中存在大量失效源码链接

例如链接指向：

- `src/commands/audit-overview.js`
- `src/commands/audit-diff.js`
- `src/commands/audit-file.js`
- `src/repl.js`
- `src/cli.js`

这些路径均不存在。实际代码位于 `src/cli/commands/`、`src/cli/repl.js` 或根 `cli.js`。

链接还使用 `file:///src/...`，安装到其他机器后也不能可靠解析。

---

### P2-11 文档中的命令状态互相矛盾

示例：

- AGENTS 将 `audit-summary` 作为新会话基线；
- SKILL 称 `audit-summary` 已废弃，应使用 `audit-overview`；
- CLI help 仍把两者都列为 Tier 1；
- SESSION 的启动命令与 AGENTS 不一致。

agent 无法从“单一事实源”得到唯一推荐入口。

---

### P2-12 文档中的性能数字不可信

存在以下互相冲突描述：

- “1 秒确认”
- “workspace-info <2s”
- “首次索引 5-30s”
- 当前实测 56s/115s

性能数字应由基准结果自动生成或引用固定 benchmark 环境，不能手写后长期保留。

---

### P2-13 文档中的测试数字与规则过期

不同位置仍出现：

- 84 个 fast tests
- 85/85 PASS
- 88/88 PASS
- 109/109 PASS
- 159/159 全量

实际当前 fast 层为 109 项，105 通过。

**建议方向**：文档不保存易过期的精确测试数量，只记录验证命令和最近验证时间/commit。

---

### P2-14 CLI 可测试入口已实现但仍列为待开发

`cli.js` 已导出 `runCliInProcess()`，测试 helper 也已经使用。

ROADMAP/SESSION 仍把“抽出 CLI 可测试入口”列为候选方向，说明活跃文档未跟随代码更新。

---

### P2-15 安全扫描的产品措辞越过能力边界

AGENTS 明确要求 workspace-bridge 不回答 XSS、鉴权、事务等语义问题。

SKILL 却把用户意图“有没有安全问题”直接路由到 `audit-security --builtin-only`，并以 high/medium/low severity 呈现 19 条正则结果。

虽然后文承认只是字符串匹配，但入口措辞仍容易让 agent 把“敏感 API 出现”误解为“漏洞存在”。

**建议方向**：

- 重命名/描述为 `security-patterns` 或“安全相关代码线索”；
- 输出使用 `candidate`/`review-needed`，不宣称漏洞；
- 不参与整体代码质量 severity。

---

## P2：现有活跃架构债务

以下问题已经出现在 `docs/TECH_DEBT.md`，本报告为完整性一并记录。

### P2-16 框架检测 Query 语言等价性偏斜

Python、Java、Kotlin 和 JS/TS 部分框架已经 Query 化；Go、Rust、C/C++、Vue、Svelte 的框架检测仍存在 regex/cheap-signature 路径。

需要注意：这是演进债务，不应排在当前数据一致性和可信度问题之前。

---

### P2-17 缓存默认位于 `os.tmpdir()`

缓存容易被系统清理，跨会话命中率不稳定，也无法自然用于 CI cache。

迁移到项目目录前需要解决：

- 自动 `.gitignore` 是否应修改用户仓库；
- 只读工作区 fallback；
- legacy cache 迁移；
- 多工作树/符号链接的身份定义。

---

### P2-18 缺少用户级配置

多仓库默认排除项、日志和并发参数不能统一配置。

但在引入用户配置前，必须先修复 CLI/env precedence，避免再增加一层不一致来源。

---

### P2-19 缺少跨进程写协调

SQLite WAL 不等于多个写进程完全没有业务竞态。watch 与 CLI 同时更新：

- graph edges
- aggregate snapshots
- metadata

可能产生后写覆盖先写或部分维度版本不一致。

专项审计已经把该问题从“理论风险”升级为可复现缺陷：

- 并发冷启动会出现 `database is locked` 和 schema 不完整；
- 持久化失败被静默吞掉；
- 多表预计算会形成混合 generation。

完整证据见 P0-4、P0-5。建议先定义单写者模型和 snapshot generation/version，再决定是否引入 file lock。

---

### P2-20 npm tarball 中所有文件都被标记为可执行

`npm pack` 产物中，包括以下普通数据/源码文件在内，mode 均为 `0755`：

- `LICENSE`
- JSON 配置
- Markdown
- 普通 `.js` 模块

这来自当前工作区文件权限，并被 npm 原样打包。

**影响**：

- Unix 安装后的权限语义不整洁；
- 安全扫描和制品审计会出现不必要噪声；
- 可执行位变化可能造成跨平台 git/npm diff。

**建议方向**：

- 通过 git index 和构建前检查确保只有 CLI/script entry 具有 executable bit。
- release CI 检查 tarball mode。

---

### P2-21 生产依赖安装体积与支持语言范围不匹配

当前主要依赖解包体积：

| 依赖 | 约解包体积 |
|---|---:|
| `tree-sitter-wasms` | 50MB |
| `web-tree-sitter` | 5.7MB |
| `@babel/parser` | 2MB |

`tree-sitter-wasms` 包含约 36 个 grammar WASM，而 workspace-bridge 宣称支持 9 类语言。

源码 tarball 本身只有约 464KB，但真实安装主要成本来自整包 grammar 依赖。首次真实 `npm install` 在本次环境中超过 3 分钟未完成；该耗时受网络和 WSL 文件系统影响，不能单独认定为产品回归，但依赖体积是确定事实。

**建议方向**：

- 测量而不是猜测优化收益。
- 评估能否发布只含支持语言 grammar 的受控资产包。
- 若继续使用完整依赖，在 README 中区分 tarball size 与 installed size。
- release benchmark 增加 clean install time 和 installed size。

---

## P3：已知限制与次级缺憾

### P3-1 混合仓库仍依赖人工配置

自定义 reference/prototype/archive 目录无法全部靠通用启发式识别。未配置时会污染主线、orphan、hotspot 和 dead-export。

---

### P3-2 `--cwd` 默认向上提升到 workspace root

用户传入子目录时，默认可能分析整个仓库。虽然已有 `--strict-cwd`，但默认行为和参数名字不够直观。

建议输出中明确：

```text
requestedCwd
resolvedWorkspaceRoot
resolutionReason
```

---

### P3-3 workspace root 自动选择只检查一层嵌套目录

`findNestedWorkspaceRoot()` 只遍历起点的直接子目录，并以 marker 分数选择最高项。

在多项目目录中可能静默选择另一个子项目；分数相同又依赖目录顺序。对于 agent 来说，“分析错仓库”比命令失败更危险。

---

### P3-4 `--check-regression` 只比较结构计数

内容变化但 deadExports/unresolved/cycles 数量不变时，会得到“无回归”。这只能称为结构计数回归，不是代码回归检查。

---

### P3-5 动态语言和框架隐式依赖仍存在静态边界

包括：

- Spring DI
- Vue 模板编译期引用
- MyBatis XML binding
- JS 动态 require/import
- C/C++ include path

这些应继续通过 confidence/honesty 暴露，而不是追求“0 误报”宣传。

---

### P3-6 多模块 Maven/Gradle 边界仍不完整

文件级依赖图无法完整表达模块依赖、source set、generated sources 和 test fixtures。模块级聚合视图仍有缺口。

---

### P3-7 跨仓库分析尚未实现

前后端 API 契约、共享 schema、monorepo 外部服务依赖无法在单 `--cwd` 模型下统一处理。

---

### P3-8 部分核心文件认知负担较高

高行数文件包括：

- `human-formatters.js`
- `analyzer.js`
- `builder.js`
- `graph-db.js`
- `project-context.js`
- `audit-assembler.js`

行数本身不是拆分理由，但其中 formatter、assembler、project-context 已承担多个变化原因。应以修改是否需要同时理解多个概念为判断标准，而不是机械按行数拆分。

---

### P3-9 裸数字和阈值仍广泛分散

粗略搜索能找到大量数字条件和切片上限。并非全部违规，但与“新数字统一进 constants.js”的工程规则存在持续偏差。

尤其应优先集中：

- 快照容忍差值 5；
- coupling/hotspot 阈值；
- 输出截断数量；
- benchmark 与 timeout。

---

### P3-10 CHANGELOG 过大并进入 npm 包

当前 `CHANGELOG.md` 约 500KB、4,351 行，并被包含在 npm tarball 中。

这不是运行时 blocker，但说明历史记录粒度过细，也增加发布包和文档维护成本。可考虑按 major version 归档历史。

---

## 旧审查结论的状态修正

2026-06-01 旧报告中的以下问题已经修复或部分缓解：

- `_aggregateCache` / `_aggregateVersion` 外部直接访问已改为 getter。
- affected-tests heuristic 已补 `terminator`。
- REPL exit code 已集中处理。
- debug graph 已增加文件和边上限。
- 临时测试注释不再存在于生产代码。

其中 `process.emitWarning` 只能标为**部分缓解**：引用计数修复了部分多实例恢复问题，但全局 monkey-patch、加载时机和 `--quiet` warning 泄漏仍然存在。

---

## 专项审计中的正向结论

本轮专项并非所有结果都失败，以下能力已得到隔离验证：

1. `npm pack` 能生成完整源码 tarball，动态 Query 模块、Python/Java helper 和 SKILL 均存在。
2. 将 tarball 还原到仓库外目录并提供生产依赖后，CLI 能分析另一个独立 Git fixture。
3. `workspace-info`、`audit-file`、JSON 和 JSONL 输出可解析。
4. 未知命令退出码为 2；缺失文件和路径越界退出码为 1，基本符合公共退出码约定。
5. SQLite 单事务在 `SIGKILL` 后可以回滚，旧数据保留且 `integrity_check=ok`。
6. 并发问题没有造成 SQLite 文件物理损坏；问题集中在初始化竞争、错误传播和业务快照一致性。

这些正向结果说明无需替换 SQLite，也无需推翻 CLI-only 架构。修复重点应放在事务边界、generation、延迟加载和错误可见性。

---

## 建议执行顺序

### 阶段 A：恢复可信基线

1. 隔离并清理 EOL 污染。
2. 修复 4 个 fast test 失败，确认哪些是生产回归、哪些是测试错误。
3. 增加 Node 22/24 常规 CI。
4. release 增加测试和 packed-tarball smoke gate。

### 阶段 B：修数据一致性

1. 修复 `query-*` 快照 staleness。
2. 修复 SQLite 冷启动并发写和持久化错误传播。
3. 为预计算表引入原子 generation。
4. 修复 CLI > env precedence。
5. 统一 schemaVersion 来源。
6. 消除 `audit-assembler` / `incremental-diff` 循环依赖。

### 阶段 C：修策展可信度

1. 动态 registry 模块纳入可达性。
2. 架构指标排除测试边。
3. 个人仓库降级 knowledge risk。
4. 低置信 finding 不参与 severity 和删除建议。

### 阶段 D：修 agent 产品形态

1. 将 `workspace-info` 改成真正轻量命令。
2. 让 `--version` / `--help` 不加载分析栈。
3. 将默认 overview 压到热缓存 `<2s`、JSON `<8KB`。
4. 精简 SKILL，并修复失效路径。
5. 再考虑 Graph-first routes、语言 Query parity 和用户级配置。

---

## 建议验收命令

```bash
# 当前核心测试
npm run test:fast

# CLI 参数优先级
WB_FORMAT=markdown node cli.js audit-overview --format ai --cwd . --quiet

# quiet 模式 stderr 必须为空
node cli.js workspace-info --cwd . --json --quiet >out.json 2>err.log
test ! -s err.log

# 热缓存性能
/usr/bin/time -f 'elapsed=%e maxrss_kb=%M' \
  node cli.js audit-overview --cwd . --format ai --quiet

# 数据新鲜度
# 先生成 query snapshot，修改一个已有文件但不提交，再查询；
# 输出必须反映修改，不能继续命中旧 snapshot。
node cli.js query-hotspots --cwd . --json --quiet

# 发布包安装验证
npm pack
# 在临时目录 npm install 生成的 tgz，再运行 --version 和小 fixture audit。
```

---

## 最终评价

workspace-bridge 的分析能力已经超过其当前工程保障能力。下一阶段最有价值的工作不是继续增加规则数量，而是确保：

- 用户传入的参数真的生效；
- 修改代码后不会读到旧结果；
- 低置信发现不会生成危险动作；
- 推荐给 agent 的默认命令足够快；
- 任何发布版本都经过真实安装和测试门禁。

当这五点稳定后，现有的多语言 AST、影响分析和 SQLite 图存储才会真正形成可信的 AI coding 基础设施。
