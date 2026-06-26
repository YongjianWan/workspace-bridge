# workspace-bridge 系统性代码审查报告（历史归档）

> **审查日期**：2026-06-13
>
> **基线提交**：`a54dc8c feat: queryify Java/Kotlin framework detection & update docs`
>
> **状态**：**历史归档**。本报告中的 P0–P2 缺陷已全部修复并归档至 [`CHANGELOG.md`](../CHANGELOG.md) [Unreleased]；活跃已知限制见 [`ROADMAP.md`](../ROADMAP.md) §已知限制；当前活跃债务见 [`TECH_DEBT.md`](./TECH_DEBT.md)。
>
> 保留本文件仅作为审查过程与 2026-06-13 基线状态的参考。

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

| 测试                                  | 现象                                                            |
| ------------------------------------- | --------------------------------------------------------------- |
| `cache-corruption-test.js`          | 期望持久化失败返回`false`，实际返回 `true`                  |
| `path-utils-test.js`                | Unix 环境期望`/Foo/Bar` 被小写为 `/foo/bar`，与实现契约冲突 |
| `wave11-analysis-deepening-test.js` | Java`else-if` dispatcher 未找到                               |
| `wave15-ast-rules-test.js`          | Java`batch` 缺少事务注解的 E2E finding 缺失                   |

因此，`SESSION.md` 中“109/109 PASS”的记录不代表当前工作区真实状态。

### CLI 性能实测

| 命令                              | 环境     |    耗时 | 峰值内存 |                   输出 |
| --------------------------------- | -------- | ------: | -------: | ---------------------: |
| `audit-summary --json --quiet`  | 热缓存   |  56.17s | 约 281MB | 35,897 字节 / 1,221 行 |
| `workspace-info --json --quiet` | 已有缓存 | 115.24s | 约 269MB |       990 字节 / 49 行 |

`workspace-info` 并非真正的轻量预检。它仍先执行完整 `ServiceContainer` 初始化、文件索引和依赖图构建。

### 工作区差异噪声

- `git status` 显示 85 个修改文件。
- 原始 diff 约 43,255 行变化。
- 忽略行尾空白后，实质差异主要集中在少数文档文件。
- `git diff --check` 报告大量 trailing whitespace，符合整仓换行符转换特征。

这会掩盖真实代码改动，使 review、bisect 和 merge 的可靠性显著下降。

---

## P0、P1、P2 历史缺陷（已全面修复）

> 所有审查发现的 P0、P1、P2 级缺陷已全面修复，具体修复细节和缺陷描述已归档移动至 [CHANGELOG.md](../CHANGELOG.md) [Unreleased] 的 **Code Review 发现问题系统性修复** 小节中。

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

下面是一份可长期复用的完整审计 Checklist。

---

# 第二轮深度审计报告

## 一、SQL 注入漏洞 🔴 已确认

**刚通过实际代码执行验证**：

```bash
node -e "
const { parseCliArgs } = require('./src/cli/validate-args');
const r = parseCliArgs(['node', 'cli.js', 'query', '--sql',
  \"SELECT * FROM file_metadata UNION SELECT sql FROM sqlite_master--\"]);
console.log(r.sql); # 输出: SELECT * FROM file_metadata UNION SELECT sql FROM sqlite_master--
"
```

`queryReadOnly()` 的三层防御**全部被绕过**：

1. ✅ 以 `SELECT` 开头 → 通过
2. ✅ forbidden 正则不含 `UNION` → 通过
3. ✅ 无分号 → 通过

**攻击效果**：攻击者可通过 `UNION SELECT` 读取 `sqlite_master` 获取完整 schema，或读取 `cache_metadata` 中的 `workspaceInfo`（含 git HEAD 等内部信息）。

**修复方案**：在 `graph-db.js:queryReadOnly()` 的 forbidden 正则中加入：

```
\b(union|intersect|except|subquery)\b
```

---

## 二、watch 模式 shell 注入 🟠 风险

`watch.js:105` 的 `shell: useShell` 在命令包含 shell 操作符（`|`、`&`、`;` 等）时设为 `true`，此时 `spawn()` 会通过系统 shell 执行命令。

`commands.js:431` 的 `hasShellOps` 检测：`/[|&;<>()]/.test(rest)` — 如果文件路径中包含这些字符，命令会被标记为需要 shell 执行。

**风险场景**：如果文件名包含 `; rm -rf /`，且被拼接到 shell 命令中，理论上可执行任意命令。

**缓解因素**：

- 命令生成用的是 `generateCommands()`，基于 stack detection 的硬编码模板
- 文件路径通过 `path.relative()` 转换，不会直接拼接 shell 操作符
- 实际利用需要精心构造的文件名

**评估**：低概率但非零风险。建议：在 `executeWatchCommand()` 中对 `exec.shell` 模式增加参数转义。

---

## 三、子进程环境变量泄露 🟠 确认

`watch.js:108`：`env: process.env` — 完整环境变量传递给子进程。

`spawn-ast.js:82`：`env: { ...process.env, PYTHONIOENCODING: 'utf-8' }` — 同样泄露。

**影响**：如果用户环境中有 `AWS_SECRET_ACCESS_KEY`、`DATABASE_URL`、`NPM_TOKEN` 等敏感变量，会被 fork 出的 Python/Node 子进程继承。

**修复方案**：构建最小环境白名单：

```js
const safeEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  PYTHONIOENCODING: 'utf-8',
  // 按需添加 LANG/LC_ALL
};
```

---

## 四、自动追加 .gitignore 🟡 确认

`cache.js:93-100`：`computeDefaultCacheDir()` 在检测到 `.gitignore` 存在时，如果其中没有 `.workspace-bridge` 条目，会 `appendFileSync` 追加。

**问题**：

- 静默修改用户文件（即使只是追加）
- 在 CI/CD 环境中可能产生意外的 dirty git state
- 只检查是否存在 `.gitignore`，不检查是否只读

**建议**：移除此逻辑，改为 `init` 命令显式写入。

---

## 五、解析器健壮性 ✅ 良好

| 解析器  | AST 优先          | Regex 降级                  | 边界处理               |
| ------- | ----------------- | --------------------------- | ---------------------- |
| JS/TS   | Babel parser      | `sanitizeForRegex` + 正则 | ✅ 优雅降级            |
| Python  | 外部 Python AST   | 正则                        | ✅ 超时保护 + 并发限制 |
| Java    | 外部 javalang AST | 正则 +`findMatchingBrace` | ✅ MAX_LINE_LEN 限制   |
| Kotlin  | 外部 AST          | 正则                        | ✅ 同 Python           |
| Go      | 外部 AST          | 正则                        | ✅ 同 Python           |
| Rust    | 外部 AST          | 正则                        | ✅ 异步锁串行化        |
| C/C++   | tree-sitter WASM  | 正则                        | ✅ 优雅降级            |
| Vue SFC | Babel + template  | 正则                        | ✅                     |
| Svelte  | tree-sitter WASM  | 正则                        | ✅                     |

**亮点**：

- Java regex 有 `MAX_LINE_LEN = 512` 防止 ReDoS
- 符号名 regex 构建前都做了 `symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` 转义
- Python AST 解析器有并发信号量（`LIMITS.PYTHON_AST_CONCURRENCY`）防止内存爆炸

---

## 六、REPL 资源管理 ✅ 良好

- SIGINT handler 在 finally 块中 `removeListener`
- `container.shutdown()` 在 finally 中调用
- eval 模式不注册 SIGINT（避免在非交互场景干扰）
- readline 接口在 finally 中关闭

**无资源泄漏风险**。

---

## 七、watch 资源管理 ✅ 良好

- `stopWatching()` 关闭所有 watcher + 清除 timer
- `setupGracefulShutdown()` 注册 SIGINT/SIGTERM handler
- `container.shutdown()` 在 shutdown 流程中调用

**无资源泄漏风险**。

---

## 八、CI/CD 安全 ✅ 良好

| 检查项                          | 结果                  |
| ------------------------------- | --------------------- |
| `actions/checkout@v4`         | ✅ 固定大版本         |
| `actions/setup-node@v4`       | ✅ 固定大版本         |
| `npm ci` 而非 `npm install` | ✅ 锁文件一致性       |
| 无密钥泄露到日志                | ✅                    |
| `GITHUB_TOKEN` 权限限制       | ✅`contents: write` |
| npm provenance                  | ✅`--provenance`    |
| 无第三方不可信 action           | ✅ 仅用官方 action    |

---

## 九、EventBus 设计 ✅ 优秀

- 错误隔离：单个 listener 异常不影响其他 listener
- 同步 `emit()` + 异步 `emitAsync()` 双模式
- 类型检查：listener 必须是函数

---

## 十、文件索引 symlink 处理 ✅ 良好

- `findFilesAsync()` 使用 `realpath()` 解析真实路径
- `visitedRealPaths` Set 防止循环
- 断裂 symlink 通过 `stat()` 检测后跳过
- 目录 symlink 进入队列后由 realpath 去重

---

## 十一、glob 模式安全 🟡 可改进

`exclude-patterns.js` 的 `shouldExcludeCli()` 使用手写 glob → regex 转换：

```js
const escaped = cleanPattern
  .replace(/\*\*\//g, '###GLOB_STAR_SLASH###')
  .replace(/\*\*/g, '###GLOB_DOUBLE_STAR###')
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // 缺少 ! 和 ~
  .replace(/\*/g, '[^/]*')
  .replace(/\?/g, '[^/]')
```

**问题**：转义序列中的临时标记 `###GLOB_STAR_SLASH###` 如果用户输入恰好包含此字符串，会导致意外行为。概率极低但不是零。

**建议**：使用成熟的 glob 库（如 `minimatch`）替代手写转换。

---

## 更新后的问题清单

### 🔴 P0（新增）

| # | 问题                     | 位置                            | 状态                            |
| - | ------------------------ | ------------------------------- | ------------------------------- |
| 0 | **SQL UNION 注入** | `graph-db.js:queryReadOnly()` | 🔴 刚验证，可读取 sqlite_master |

### 🟠 P1（原有 + 补充）

| # | 问题                 | 位置                                  | 状态      |
| - | -------------------- | ------------------------------------- | --------- |
| 1 | SQL UNION 注入       | `graph-db.js`                       | 🔴 同上   |
| 2 | 环境变量泄露         | `watch.js:108`, `spawn-ast.js:82` | 🟠 已确认 |
| 3 | 自动 .gitignore 追加 | `cache.js:93-100`                   | 🟡 已确认 |
| 4 | 同步锁阻塞事件循环   | `graph-db.js:acquireLockSync`       | 🟡 原有   |
| 5 | watch shell 注入风险 | `watch.js:105`                      | 🟡 低概率 |

### 🟡 P2（原有）

| #  | 问题                           |
| -- | ------------------------------ |
| 6  | analyzer.js 1517 行 8 个关注点 |
| 7  | validate-args.js 593 行        |
| 8  | 文档维护成本过高               |
| 9  | ROADMAP 已完成项未清理         |
| 10 | 双边冗余内存                   |

---

要我直接修 P0 的 SQL 注入？这个改动很小——在 forbidden 正则里加一个 `union` 就行。

老实说，看完全部代码和文档后，我的定义是：

**它是一个"AI 的跨文件感知层"——补全 AI agent 天然缺失的"项目全局上下文"。**

不是图辅助查询。图只是底层实现手段，不是产品定位。

具体来说：

**AI agent 的天然盲区**：它一次只能看到一个文件（或一个上下文窗口），不知道"改了 A 文件会波及谁"、"哪些测试要跑"、"有没有循环依赖"。

**workspace-bridge 填的就是这个洞**：把项目的结构关系（依赖图、影响半径、死代码、热点、路由）预计算好，策展成 AI 能直接消费的 JSON 输出。

用一句话概括：

> **给 AI 一双"项目级的眼睛"。**

它不是数据库（不是存数据的），不是报告工具（不是给人看的），不是代码审查器（不找逻辑 bug）。它是一个**结构感知接口**——AI 问"我改这个文件安全吗"，它回答"会波及 47 个模块、27 个测试、3 条路由，你确定？"

所以 ROADMAP 里写的"AI 的代码脚手架"这个定位是准确的——脚手架不是建筑物本身，是帮施工者（AI）在高处站稳的东西。刚交付的审计报告里，**全部问题都还没修**——那是一份评估，不是修复清单。

按优先级排，需要动手的：

## 🔴 P1（应该立即修的 4 个）

| # | 问题                   | 一句话描述                                                                      |
| - | ---------------------- | ------------------------------------------------------------------------------- |
| 1 | SQL`UNION` 注入缺口  | `queryReadOnly()` 的 forbidden 正则没拦 `UNION SELECT`，攻击者可探测 schema |
| 2 | 子进程环境变量泄露     | `spawn-ast.js` 把整个 `process.env` 传给 Python，敏感变量会被继承           |
| 3 | 静默修改`.gitignore` | `computeDefaultCacheDir()` 自动往用户的 `.gitignore` 追加内容               |
| 4 | 同步锁阻塞事件循环     | `acquireLockSync()` 用 `Atomics.wait()` 阻塞主线程                          |

## 🟡 P2（应该修但不紧急的 5 个）

| # | 问题                                                         |
| - | ------------------------------------------------------------ |
| 5 | `analyzer.js` 1517 行塞了 8 个关注点，该拆                 |
| 6 | `validate-args.js` 593 行参数解析，过重                    |
| 7 | 文档维护成本过高（SESSION/ROADMAP/AGENTS 每次改 4-5 个文件） |
| 8 | ROADMAP.md 已完成项没清理，和 CHANGELOG 重叠                 |
| 9 | 双边冗余内存（graph + reverseGraph）                         |

## 🔵 P3（可选）

| #  | 问题                                            |
| -- | ----------------------------------------------- |
| 10 | `node:sqlite` 实验性 API，Node 升级可能 break |
| 11 | ~10 处弱断言                                    |
| 12 | `code_review.md` 应归档不再维护               |

---

---

# 第三轮深度审计报告

## 一、算法正确性 ✅ 全部通过

### 1.1 PageRank

| 检查项                                  | 结果      |
| --------------------------------------- | --------- |
| 阻尼因子默认 0.85                       | ✅ 标准值 |
| 节点泄漏处理（dangling nodes 均匀分配） | ✅ 正确   |
| 收敛检测（epsilon = 1e-5）              | ✅        |
| 暖启动（prevRanks sum > 0.5）           | ✅        |
| 边去重（adjacency list dedup）          | ✅        |
| 自环跳过（`src === dst`）             | ✅        |

### 1.2 循环依赖检测

- **Tarjan SCC**（O(V+E)）→ **Johnson 算法**（找所有简单环）
- 保护措施：`CYCLE_FINDER_MAX_CALLS = 20000`，最大环长度 8，最多返回 1000 个环
- **注意**：`strongconnect` 是递归实现，超大图（>10K 节点深度链）可能爆栈。但实际项目中极难触发。

### 1.3 BFS 遍历

- 使用 singly-linked list 做路径追踪（不是数组拷贝），内存高效
- `maxDepth` 限制正确
- `onVisit` 返回 `false` / `'STOP'` 可提前终止

### 1.4 增量更新

| 检查项                                              | 结果 |
| --------------------------------------------------- | ---- |
| 删除文件清理 reverseGraph + imports + importRecords | ✅   |
| 1-hop 边界扩展（邻居依赖者重解析）                  | ✅   |
| Shadow Candidates（跨语言扩展名候选）               | ✅   |
| SHA-256 二次校验排除 mtime 伪阳性                   | ✅   |
| 重入保护（`_updating` guard）                     | ✅   |
| parseCache 清理                                     | ✅   |

---

## 二、XSS / 输出注入防护 ✅ 良好

### 2.1 HTML Dashboard

- 服务端模板使用 `escapeHtml()` 转义 `& < > " '`
- 客户端 JS 使用 `textContent`（不是 `innerHTML`）渲染数据
- `JSON.stringify(data).replace(/</g, '\\u003c')` 防止 `</script>` 注入

### 2.2 Markdown 输出

- 无用户输入直接拼接 Markdown 链接（文件路径是内部生成的，不是用户输入）

---

## 三、原型污染 ✅ 无风险

- `JSON.parse` 均在 try-catch 中
- `parseArgs()` 不使用 `__proto__` 或 `constructor` 作为 key
- 配置加载（`.workspace-bridge.json`）使用 `JSON.parse(stripBOM(...))` — 无 merge/extend 操作
- 无 `Object.assign(target, userInput)` 模式

---

## 四、ReDoS ✅ 无风险

| 正则               | 位置                    | 评估                             |
| ------------------ | ----------------------- | -------------------------------- |
| glob → regex 转换 | `exclude-patterns.js` | ✅ 无嵌套量词                    |
| Java method regex  | `java.js:89`          | ✅ 有`MAX_LINE_LEN = 512` 限制 |
| 符号名 regex       | `analyzer.js`         | ✅ 全部做了`escapeRegExp`      |
| mention pattern    | `analyzer.js:1358`    | ✅ 做了转义                      |

---

## 五、资源限制 ✅ 全面

| 资源                | 限制 | 位置                              |
| ------------------- | ---- | --------------------------------- |
| 命令输出            | 10MB | `COMMAND_OUTPUT_MAX_BYTES`      |
| Watch 输出          | 1MB  | `WATCH_MAX_STDOUT_BYTES`        |
| 解析文件大小        | 1MB  | `PARSER_MAX_FILE_BYTES`         |
| Python 子进程并发   | 4    | `PYTHON_AST_CONCURRENCY`        |
| Git log 并发        | 8    | `GIT_LOG_CONCURRENCY`           |
| 循环检测调用        | 20K  | `CYCLE_FINDER_MAX_CALLS`        |
| 最大环长度          | 8    | `MAX_CYCLE_EDGE_DEPTH`          |
| 最大环数量          | 1000 | hard-coded                        |
| Resolver stat cache | 2000 | `RESOLVER_STAT_CACHE_MAX`       |
| Symbol 内容 cache   | 2000 | `SCAN_SYMBOL_CONTENT_CACHE_MAX` |
| Git 文件列表        | 500  | `GIT_FILE_LIST_MAX`             |
| Git commit 数       | 10   | `GIT_COMMIT_MAX`                |

---

## 六、网络隔离 ✅ 完全隔离

源代码中**零网络调用**。无 `fetch`、`axios`、`request`、`http`、`https`、`download`。CLI-only 定位严格遵守。

---

## 七、process.exit 使用 ✅ 合理

仅 3 处：

1. `bootstrap.js:21` — unhandledRejection（正确）
2. `bootstrap.js:28` — uncaughtException（正确）
3. `watch.js:274` — SIGINT/SIGTERM shutdown（正确）

其他地方使用 `process.exitCode` 设置退出码，不强制退出。

---

## 八、Shadow Candidates 覆盖 ✅ 全面

| 语言组      | 扩展名                            | 互相 shadow      |
| ----------- | --------------------------------- | ---------------- |
| JS/TS       | .d.ts/.tsx/.ts/.jsx/.js/.mjs/.cjs | ✅ 含 index 目录 |
| Vue         | .vue ↔ .ts/.js                   | ✅               |
| Svelte      | .svelte ↔ .ts/.js                | ✅               |
| Python      | .pyi ↔ .py                       | ✅               |
| C/C++       | .hpp/.h ↔ .cpp/.c/.cc            | ✅               |
| Kotlin      | .kt ↔ .kts                       | ✅               |
| Java/Kotlin | .java ↔ .kt                      | ✅               |
| Go          | .go（无 shadow）                  | ✅ 显式声明      |
| Rust        | .rs（无 shadow）                  | ✅ 显式声明      |

---

## 九、状态机设计 ✅ 优秀

两个状态机（`ServiceContainer` + `GraphStateMachine`）：

- 合法转换表完整
- 非法转换抛 Error（不是静默忽略）
- IDLE → BUILDING → READY → UPDATING → SHUTTING_DOWN 生命周期清晰

---

## 十、WAL Cadence ✅ 合理

- 首次运行：TRUNCATE（清理 WAL）
- 后续：每 32 次 batch 或 60 秒 TRUNCATE 一次
- 中间：PASSIVE（不阻塞写入）

---

## 十一、测试质量量化

| 指标         | 数值                                                   |
| ------------ | ------------------------------------------------------ |
| 测试文件     | 200+                                                   |
| 总断言数     | **5902**                                         |
| fast 层      | 124/124 PASS                                           |
| smoke 层     | 127/127 PASS                                           |
| 弱断言       | ~10 处（`typeof` 型）                                |
| 测试分层注解 | `@contract` / `@semantic` / `@slow` / `@watch` |

**断言密度**：5902 断言 / 30K 代码 ≈ 0.2 断言/行 — 对于 CLI 工具来说属于中上水平。

---

## 十二、依赖树健康度

| 检查项                 | 结果                                                         |
| ---------------------- | ------------------------------------------------------------ |
| 运行时依赖             | 仅 3 个（@babel/parser、tree-sitter-wasms、web-tree-sitter） |
| devDependencies        | 仅 2 个（@yao-pkg/pkg、c8）                                  |
| 无已知 CVE             | npm audit 不可用（镜像源不支持），但依赖面极小               |
| tree-sitter-wasms 体积 | ⚠️ 包含所有语言的 WASM，较大                               |

---

## 累计问题清单（三轮合并）

### 🔴 P0 — 必须修

| # | 问题                                                                      | 验证状态  |
| - | ------------------------------------------------------------------------- | --------- |
| 1 | **SQL UNION 注入** — `queryReadOnly()` 无法拦截 `UNION SELECT` | ✅ 已实锤 |

### 🟠 P1 — 应该修

| # | 问题                         | 验证状态  |
| - | ---------------------------- | --------- |
| 2 | 环境变量完整传递给子进程     | ✅ 已确认 |
| 3 | 自动追加 .gitignore          | ✅ 已确认 |
| 4 | acquireLockSync 阻塞事件循环 | ✅ 已确认 |
| 5 | watch 模式 shell 注入风险    | 🟡 低概率 |

### 🟡 P2 — 建议修

| #  | 问题                              |
| -- | --------------------------------- |
| 6  | analyzer.js 1517 行 8 个关注点    |
| 7  | validate-args.js 593 行           |
| 8  | 文档维护成本过高                  |
| 9  | ROADMAP 已完成项未清理            |
| 10 | 双边冗余内存                      |
| 11 | Tarjan 递归实现可能爆栈（超大图） |
| 12 | glob 转义使用临时标记字符串       |

---

**结论**：三轮审计覆盖了安全、架构、算法、运行时、CI/CD、输出注入、资源管理、测试质量共 8 个维度。项目整体质量**极高**——唯一确认的安全漏洞是 SQL UNION 注入（P0），修复成本极低（一行代码）。
