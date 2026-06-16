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

| 测试                                  | 现象                                                             |
| ------------------------------------- | ---------------------------------------------------------------- |
| `cache-corruption-test.js`          | 期望持久化失败返回 `false`，实际返回 `true`                  |
| `path-utils-test.js`                | Unix 环境期望 `/Foo/Bar` 被小写为 `/foo/bar`，与实现契约冲突 |
| `wave11-analysis-deepening-test.js` | Java `else-if` dispatcher 未找到                               |
| `wave15-ast-rules-test.js`          | Java `batch` 缺少事务注解的 E2E finding 缺失                   |

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

# workspace-bridge 全量审计 Checklist

## 一、综合审计

### 1. 项目状态

* 读取 `AGENTS.md`
* 读取 `SESSION.md`
* 读取 `docs/TECH_DEBT.md`
* 检查 `git status`
* 识别用户改动、生成文件和 EOL 噪声
* 运行基线 `audit-summary`
* 核对文档、代码、测试数字是否一致
* 确认版本、schemaVersion、Node engine
* 检查未追踪文件和意外制品

### 2. 架构边界

* 检查 L0-L6 依赖方向
* 检查循环依赖
* 检查跨层反向 require
* 检查 facade 是否泄漏可变内部对象
* 检查私有字段的外部访问
* 检查同一业务语义是否重复实现
* 检查模块是否承担多个变化原因
* 检查动态 registry 是否进入可达性图
* 区分生产架构图和测试影响图
* 检查新增抽象是否确有用途

### 3. 数据一致性

* 检查缓存引用是否进入可变结构
* 检查删除实体时关联槽位是否全部清理
* 检查内存图、SQLite 与快照是否同代
* 检查所有预计算表 generation
* 检查缓存失效条件
* 检查 dirty worktree 内容变化
* 检查配置变化是否使缓存失效
* 检查文件新增、删除、重命名
* 检查回滚与部分写入行为
* 检查持久化失败是否向上暴露

### 4. 异常安全

* 检查初始化中途失败
* 检查 shutdown 每一步独立捕获异常
* 检查 cache load 损坏和旧格式
* 检查数据库 transaction rollback
* 检查 SIGINT
* 检查 SIGTERM
* 检查 SIGKILL 后恢复
* 检查子进程 timeout 和强制终止
* 检查 watcher 关闭
* 检查 listener、timer 和文件句柄泄漏

### 5. CLI 契约

* CLI 参数优先于环境变量
* 环境变量优先于配置文件
* 布尔参数支持显式覆盖
* `--cwd` 解析符合预期
* `--strict-cwd` 不向上提升
* `--service` 边界正确
* `--file` 拒绝目录和越权路径
* `--files` 每项独立验证
* 未知命令退出 2
* 业务失败退出 1
* 成功退出 0
* `--fail-on-findings` 正确
* `--quiet` 保证 stderr 为空
* `--version` 不加载分析引擎
* `--help` 不加载分析引擎
* 错误输出包含可执行建议

### 6. 输出契约

针对每个公开命令检查：

* JSON 成功结构
* JSON 失败结构
* JSONL 每行可解析
* AI 格式字段完整
* Markdown 不崩溃
* Human 格式不崩溃
* Summary 格式不崩溃
* `schemaVersion` 来源统一
* `{ok,error,severity,summary}` 核心子集一致
* `warnings[]` 不被遗漏
* 路径格式统一
* 截断时带 total/truncated
* Token budget 真正生效
* 用户源码不能注入输出结构
* 低置信结论明确标注

### 7. 策展可信度

* 已知假阳性不提升总 severity
* 低置信 finding 不生成删除建议
* 动态加载文件不判孤儿
* 测试文件不污染生产耦合度
* reference/archive/generated 不污染主线
* 单人仓库 knowledge risk 降级
* 未提交 blame 不计为真实作者
* recommendations 与 findings 一一对应
* 建议命令真实存在且可运行
* 工具不越界宣称语义漏洞
* 无数据时不生成自信结论

### 8. 测试体系

* 所有测试标记 `@contract` 或 `@semantic`
* 所有测试有明确 fast/slow/watch/serial 层
* 测试验证业务语义
* 不以 `typeof` 代替行为验证
* 不只检查退出码
* 测试不依赖 chmod 等脆弱环境假设
* 临时目录独立
* 缓存目录独立
* 测试完成后无残留进程
* flaky 测试有稳定根因修复
* fast 层全绿
* smoke 层全绿
* 全量层全绿
* Coverage 有最低门槛
* 回归测试先失败再修复
* spawn E2E 数量保持最小
* 业务测试优先使用 in-process runner

### 9. 文档一致性

* AGENTS 只保存当前状态
* SESSION 只保存当前会话
* TECH_DEBT 只保存活跃债务
* CHANGELOG 只保存历史
* README 命令真实存在
* SKILL 路径真实存在
* 文档没有 `file:///src/...` 失效链接
* 默认推荐命令唯一
* 测试数量没有互相矛盾
* 性能数据注明环境和提交
* 已完成方向不再列为待开发
* 已修复问题从活跃债务删除
* 文档没有过期版本和 schema 数字

---

# 二、专项审计

## A. SQLite 与缓存

### 初始化与并发

* 两个进程并发打开空数据库
* 6-10 个进程并发打开空数据库
* schema migration 并发执行
* busy timeout 行为
* lock timeout 行为
* writer 失败可见
* reader 不阻塞 writer
* writer 不产生 `no such table`
* 最终数据包含明确 generation
* CLI 成功不掩盖缓存失败

### 事务与恢复

* 事务中 SIGKILL 后完整回滚
* COMMIT 后 SIGKILL 数据保留
* WAL 文件损坏恢复
* 主 DB 损坏优雅降级
* 磁盘满
* 目录只读
* 文件权限变化
* 数据库被删除
* checkpoint 失败
* shutdown 保存失败
* rollback 本身失败

### 快照一致性

* aggregates 与 impact 同 generation
* routes 与 graph 同 generation
* metrics 与 graph 同 generation
* test_map 与 graph 同 generation
* 所有 row version 一致
* 所有 row fileCount 一致
* 缺少任一维度时整体降级
* mixed-generation 数据拒绝加载
* 配置 hash 参与指纹
* dirty files 参与指纹

## B. 增量更新

* 修改文件内容但大小不变
* 修改内容但恢复原 mtime
* 只改变 mtime
* 新增文件
* 删除文件
* 文件重命名
* 目录重命名
* 扩展名变化
* JS/TS shadow candidate 抢占
* Python package/module 抢占
* Go module 变化
* Rust module 变化
* Java package 变化
* import alias 变化
* export 删除
* symbol 重命名
* entry point 变化
* framework annotation 变化
* route 变化
* 测试映射及时清理
* reverseGraph 无残留边
* PageRank 正确失效
* aggregate cache 正确失效
* git checkout/rebase 后正确更新

## C. Watch 与 REPL 长稳

* 连续运行 1 小时
* 连续修改 1,000 次
* 内存不持续增长
* listener 数量稳定
* timer 数量稳定
* watcher 数量稳定
* 高频保存 debounce 正确
* 同文件事件合并
* 多文件事件不丢失
* 删除后创建同名文件
* 原子保存/临时文件替换
* SIGINT 保存并退出
* SIGTERM 保存并退出
* 双 Ctrl+C 不跳过清理
* REPL 多命令复用同一图
* watch 与普通 CLI 同时运行
* 更新积压有背压策略
* 回调失败不停止后续更新

## D. 发布包与安装

* `npm pack` 成功
* tarball 文件清单正确
* 只有入口文件有可执行位
* 全新临时目录安装
* 全局安装
* npm CLI bin 可运行
* 从非仓库 cwd 运行
* `--version`
* `--help`
* JS fixture
* Python fixture
* Java fixture
* Go fixture
* Rust fixture
* C/C++ fixture
* Vue fixture
* Svelte fixture
* WASM grammar 可加载
* Python helper 在包内
* Java helper 在包内
* 动态 Query 模块在包内
* Node 22
* Node 24
* Linux
* Windows
* macOS
* installed size 记录
* clean install time 记录
* 无网络情况下错误明确
* npm 发布前 smoke gate

## E. 原生 Windows

* 盘符大小写
* 反斜杠路径
* UNC 路径
* 中文路径
* 空格路径
* 超长路径
* 大小写不同的同一路径
* symlink/junction
* PowerShell BOM
* cmd.exe 参数转义
* Git Bash 路径转换
* Defender 下性能
* 文件锁
* chmod 测试不适用
* SIGTERM 替代行为
* watcher rename 事件
* SQLite WAL 清理
* npm global bin shim

## F. 多语言准确率

每种语言均检查：

* import 提取
* export/definition 提取
* function records
* decorators/annotations
* return type
* branch count
* unresolved imports
* dead exports
* impact
* affected tests
* routes
* framework detection
* fallback 原因
* malformed source
* Unicode identifier
* generated code
* 真实开源项目 fixture
* false positive 数量
* false negative 数量

语言矩阵：

* JS
* TS
* Python
* Java
* Kotlin
* Go
* Rust
* C
* C++
* Vue
* Svelte

## G. 性能与容量

* 100 文件
* 500 文件
* 1,000 文件
* 5,000 文件
* 10,000 文件
* 冷启动
* 热启动
* 单文件增量
* 100 文件批量变化
* 内存峰值
* SQLite 文件大小
* WAL 最大尺寸
* JSON 输出大小
* Token 估算准确率
* blame 成本
* PageRank 成本
* cycle 检测成本
* route 提取成本
* parser 并发度
* OOM 后错误输出
* timeout 后无残留进程

## H. 安全与恶意仓库

* `../` 路径逃逸
* 绝对路径逃逸
* symlink 逃逸
* junction 逃逸
* 输出文件写到 workspace 外
* `--cache-dir` 路径安全
* `--save` 路径安全
* 恶意配置 JSON
* 恶意 regex 导致 ReDoS
* 超大 JSON 配置
* 恶意符号名输出注入
* ANSI escape 注入
* Markdown 注入
* HTML dashboard XSS
* shell 参数注入
* validation command 注入
* Git filename 注入
* 二进制伪装源码
* 压缩炸弹/巨型文件
* 敏感内容是否进入缓存
* cache 权限是否合适

## I. 配置矩阵

* 内置默认值
* 用户级配置
* 项目级配置
* 环境变量
* CLI 参数
* 优先级逐层验证
* 布尔 true 覆盖 false
* 布尔 false 覆盖 true
* 数组合并还是替换
* 非法字段
* 非法类型
* BOM
* 空配置
* 配置修改使缓存失效
* `--exclude`
* `--service`
* `--strict-cwd`
* `WORKSPACE_ROOT`
* `WB_CWD`
* `WB_FORMAT`
* `WB_JSON`
* `WB_QUIET`
* `WB_CACHE_DIR`

## J. 输出 Schema 矩阵

对每个命令执行：

* 默认 human
* `--json`
* `--format json`
* `--format jsonl`
* `--format ai`
* `--format markdown`
* `--format summary`
* 成功
* 无结果
* 业务失败
* 参数错误
* 初始化崩溃
* findings + `--fail-on-findings`
* 大输出截断
* schemaVersion 一致
* stderr 洁净
* exit code 一致

命令范围：

* audit-overview
* audit-summary
* audit-file
* audit-diff
* audit-map
* workspace-info
* diagnostics
* audit-security
* impact
* affected-tests
* affected-routes
* dead-exports
* unresolved
* cycles
* tree
* dependencies
* dependents
* query-hotspots
* query-knowledge-risk
* query-stability
* repl

---

## 三、推荐执行顺序

* **Phase 0** ：清理 EOL 噪声，恢复 fast tests 全绿
* **Phase 1** ：SQLite 并发与 snapshot generation
* **Phase 2** ：CLI 参数优先级与缓存失效
* **Phase 3** ：策展误报与生产/测试图分离
* **Phase 4** ：CI、release、tarball 安装矩阵
* **Phase 5** ：增量更新与 Watch/REPL 长稳
* **Phase 6** ：原生 Windows
* **Phase 7** ：多语言真实 fixture 准确率
* **Phase 8** ：大仓库性能与容量
* **Phase 9** ：恶意仓库与输出 Schema 全矩阵

每完成一个 Phase，都应：

* 写失败测试或复现脚本
* 修复根因
* 运行专项测试
* 运行 `npm run test:fast`
* 必要时运行全量测试
* 更新 `docs/code_review.md`
* 更新 `docs/TECH_DEBT.md`
* 在 `CHANGELOG.md [Unreleased]` 记录已验证变更
