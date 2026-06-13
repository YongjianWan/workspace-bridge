# 技术债与代码气味地图

> 本文档只记录**当前活跃**的技术债务。已修复历史见 [CHANGELOG.md](../CHANGELOG.md)。

---

## L1 Blocker（违反铁律，必须修）

> 当前无活跃的 L1 Blocker。

## L2 债务（阻塞演进或导致结果不可信）

> 当前无活跃的 L2 债务。

---

> **当前活跃债务总览**：L1 Blocker **0** | L2 债务 **0** | 架构债务 **4** | L3 品味问题 **1** | 合计 **5 项**

## 架构债务（不阻塞功能，但阻塞演进速度）

#### 框架检测 Query 语言等价性偏斜（Language Parity Debt）
- **背景**：已成功建立 AST-Query 框架检测基础设施。Python (Django, FastAPI, Flask, Celery)、Java (Spring, Spring Boot)、Kotlin (Spring, Ktor) 与 JS/TS (Express) 已实现 AST-Query 提取；Go (Gin, Echo, Fiber)、Rust (Actix-web, Axum, Rocket)、C/C++、Vue、Svelte 仍依赖 regex/cheap-signature 降级匹配 (`detectFrameworkFromContentSync`)。
- **重构方向**：逐步对 Gin, Echo, Fiber, Actix-web, Axum, Rocket, Vue, SvelteKit 等框架开发 AST-Query 并集成至 `FRAMEWORK_QUERY_REGISTRY`，以消除多语言特性偏斜。

#### 缓存默认目录位于项目外导致易失
- **背景**：当前 `cache.js` 默认将 SQLite 缓存置于 `os.tmpdir()/workspace-bridge/<hash>/cache.db`，系统清理或重启会导致缓存丢失，无法积累跨会话索引，CI 场景也无法利用缓存加速。参考 code-review-graph 的 `<repo>/.code-review-graph/` 与 qartez 的 `<project>/.qartez/index.db` 设计，项目内持久化是更成熟的做法。
- **重构方向**：将默认缓存目录迁移到 `<workspaceRoot>/.workspace-bridge/`（保留 `--cache-dir` 覆盖能力）；增加 legacy 缓存自动迁移；自动写入 `.gitignore` 防止误提交；评估写权限 fallback 到 tmpdir 的降级路径。

#### 缺少用户级配置目录
- **背景**：当前配置仅来自项目级 `.workspace-bridge.json` 与 CLI/环境变量，缺少全局用户级配置目录。多 repo 场景下无法统一管理默认行为（如默认排除项、日志级别、并发参数）。参考 code-review-graph 的 `~/.code-review-graph/watch.toml` 与 CodeGraphContext 的 `~/.codegraphcontext/.env` 设计。
- **重构方向**：引入 `~/.workspace-bridge/` 用户级目录，支持全局 `config.toml` / `.env`；配置优先级：CLI args > 环境变量 > 项目级 `.workspace-bridge.json` > 用户级配置 > 内置默认值；提供配置来源报告（config from: ...）。

#### 缺少跨进程并发控制
- **背景**：当前 SQLite 通过 WAL 模式支持一写多读，但 watch 进程与 CLI 命令之间没有显式的 advisory file lock 或进程协调。在 watch 写入的同时触发 CLI 写操作（如 `--save` 写 SQLite）理论上存在竞态风险。参考 qartez 的 `RepoLock`（`fs4` OS-level advisory lock + 指数退避 + PID 诊断）。
- **重构方向**：在 `cache.js` / `graph-db.js` 写入路径增加轻量 advisory lock（`proper-lockfile` 或 Node.js `fs` advisory lock 跨平台封装）；默认超时 5s；Windows 单独处理读锁冲突；保留当前 WAL 一写多读能力，lock 仅保护写事务边界。

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

