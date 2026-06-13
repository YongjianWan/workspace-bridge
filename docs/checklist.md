

下面是一份可长期复用的完整审计 Checklist。

# workspace-bridge 全量审计 Checklist“专项审计与修复交替”

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

有，无法保证 50 项已经穷尽。尚未深入覆盖的主要审计面包括：

* 原生 Windows：路径大小写、反斜杠、Defender、文件锁、SIGTERM 替代行为。
* Watch/REPL 长时间运行：内存增长、listener 泄漏、重复回调、更新积压。
* 9 语言真实项目准确率：false positive/negative、resolver、框架路由等价性。
* 大仓库压力：数千至数万文件、超长路径、超大文件、OOM 和超时恢复。
* 配置组合：项目配置、环境变量、CLI、`--service`、`--strict-cwd` 的笛卡尔组合。
* 增量正确性：重命名、删除、扩展名抢占、跨文件符号变化、git checkout/rebase。
* 安全边界：符号链接逃逸、输出文件路径、配置 regex DoS、恶意仓库内容。
* 输出契约：所有命令 × JSON/JSONL/AI/Markdown × 成功/失败的 schema 一致性。
* npm/发行：原生全新联网安装、Node 22/24、Linux/macOS/Windows、全局安装。
* Python/Java fallback：解释器缺失、版本不兼容、子进程乱码和异常终止。

不过继续逐行泛审计已经不划算。现在应采用：

1. 先修两个 P0：SQLite 并发/快照 generation。
2. 随后审计增量更新与 watch 长稳。
3. 再做原生 Windows 和多语言真实 fixture。
4. 最后做安全及全命令 schema 矩阵。

所以答案是：**肯定还有未发现问题，但当前信息已足够开始修复；继续无边界扫描只会让清单膨胀。**
