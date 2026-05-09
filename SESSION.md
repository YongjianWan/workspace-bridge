# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 新会话启动检查表（必须执行）

```bash
# 1. 验证测试基线
node test/runner.js          # 期望: 85/85 PASS

# 2. 验证自审基线
node cli.js audit-summary --cwd . --json --quiet
# 期望: healthScore=5/5, deadExportsCount=5, unresolvedCount=0, cyclesCount=0, totalFiles=165, analysisCoverage.coverageRatio=1

# 3. 验证大项目 compact 可用性
node cli.js audit-map --cwd reference/GitNexus/gitnexus --compact --json --quiet
# 期望: 输出行数 < 1000, summary.severity 存在, highlightedFiles 按问题严重程度排序
```

**如果任何一步失败 → 先修基线，再做其他事。**

---

## 边界行为回归测试（可选，发版前执行）

```bash
# 不存在的文件 → 明确错误 + exit=1
node cli.js impact --file nonexistent.js --json --quiet
node cli.js affected-tests --file nonexistent.js --json --quiet

# init 重复运行 / 非 git 目录 audit-diff → exit=1
node cli.js init --json

# --exclude 过滤后 analysisCoverage 同步
node cli.js audit-summary --exclude test,benchmark --json --quiet

# Windows 反斜杠路径标准化
node cli.js audit-file --file .\src\services\dep-graph.js --json --quiet

# 非法参数值 → 明确报错
node cli.js audit-file --file src/services/dep-graph.js --max-depth abc --json --quiet

# REPL 非 TTY → exit=1
node cli.js repl
```

---

## 基线状态

- 测试：**86/86 PASS**
- 版本：**v1.2.0**（以 `package.json` 为准）
- 分支：`main`，已 push origin（领先 origin/main 3 提交）
- 自身项目规模：179 文件，entry=1, library=61, test=86, script=14, unknown=17
- 健康度：5/5，11 dead exports（脚本/工具函数公共 API 预留），0 循环，0 未解析
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**

**上轮状态**（2026-05-09）：P8-0/P8-1/P8-2 全部完成，L2-3/L2-5/L3-1/L3-2 修复，dead exports 15→5。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

**上轮状态**（2026-05-09）：实战基地六仓库系统性审核，发现 8 项新问题（P70–P77），2 项产品方向问题。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased] §路线 A。

**本轮状态**（2026-05-09）：路线 A 全部完成（P85/P70/P71/P79/P80/P81/P72/P73），数据一致性与框架边界硬化交付。85/85 测试通过。

**本轮状态**（路线 B 已完成）：P78 脚手架噪音过滤 —— `src/tools/scaffold-detector.js` 精简交付（高度特异的 `exactBasenames` + 路径特征 `pathPatterns`），`honesty-engine.js` / `dep-graph.js` / `recommendation-engine.js` / `repo-summary.js` 集成完成，`test/scaffold-detector-test.js` + `test/honesty-engine-test.js` + `test/recommendation-engine-test.js` 补充完成。86/86 测试通过。

**下轮状态**（路线 D 建议）：P74 `_scanLocalSymbolUsage` 内存优化 / P75 framework-usage-patterns 缓存 / P76 watch.js stdout 上限 / P82 Maven testFiles=0。

---

## 已知陷阱（新 agent 必看）

| 陷阱 | 位置 | 如何避免 |
|------|------|----------|
| `DEFAULT_EXCLUDE_DIRS` 全局污染 | `src/services/file-index.js` | 任何新增排除项必须是通用目录名（如 `node_modules`），不能是项目特定名称 |
| orphan 检测不同步 | `project-map.js` vs `overview-tools.js` | 两处 orphan 逻辑必须保持同步（scripts/bin/benchmark 跳过） |
| compact 模式只改 project-map.js | `cli.js` 也需要同步 | human-readable 输出和 `countTreeFiles()` 必须兼容 skeleton 模式（`totalFileCount`） |
| Windows PowerShell 管道 BOM | 所有 `node cli.js ... \| node -e` 命令 | PowerShell 管道传 JSON 会带 BOM，用文件中转（`> file`）再读取 |
| cache.save() 已改为 async | `src/services/cache.js` | 调用方必须 `await`（container.js、测试均已适配） |
| repl-test.js flaky | `test/repl-test.js` | runner.js 串行执行时偶发失败，单独 `node test/repl-test.js` 稳定通过；若遇到，先重跑确认 |
| `framework-patterns.js` 新增框架时 | `src/services/dep-graph/framework-patterns.js` | 路径检测逻辑按语言分块，新增语言需同时更新 `isEntry` 标记和测试 |
| `buildFileValidationAdvice` 导出链 | `validation-advice.js` → `index.js` → `cli.js` | 新增 formatter 函数必须在 `src/cli/formatters/index.js` 中显式导出，否则 cli.js 解构为 `undefined` |
| `--quiet` 不再 monkey-patch `console.error` | `cli.js` / `container.js` | `quiet` 通过 `ServiceContainer` → `FileIndex` / `DependencyGraph` 传递；信息性日志条件输出，错误日志仍用 `console.error` |
| `findDeadExports()` edges/files 降级 | `src/services/dep-graph.js` | 单文件项目（files=1）不受降级影响；多文件项目 edges/files < 0.1 时 confidence 降为 low |
| `.workspace-bridge-cache.json.bak` 泄漏到 git status | `src/tools/git-tools.js` | `getChangedFiles()` 已排除 `.bak` 备份文件，防止 audit-diff 误报 |

---

## 下一步方向

> 活跃问题见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。历史已修复条目不重复记录。

### 活跃技术债（本轮未关闭）

| 编号 | 问题 | 状态 |
|------|------|------|
| P8-0 | dep-graph.js God Class 内部分拆 | ✅ 已完成 |
| P1/P63 | Vue 假阳性三角 | ⏳ 只剩运行时读取超出静态分析范围 |
| P24 | `impact` source 自引用 | ⏸ cannot-reproduce |
| P30 | `unresolved` 语义 | ⏸ 冻结 |
| P43 | `health.checks.ci` | ⏸ cannot-reproduce |
| **P74** | `_scanLocalSymbolUsage` 内存峰值 | 🆕 **新发现** |
| **P75** | `framework-usage-patterns.js` 无缓存 I/O | 🆕 **新发现** |
| **P76** | `watch.js` stdout 拼接无上限 | 🆕 **新发现** |
| **P77** | `findUnresolvedImports` Windows 路径格式不一致 | 🆕 **新发现** |
| **P78** | 脚手架噪音淹没业务信号（RuoYi 模板同质化） | 🆕 **第二轮新发现** |
| **P82** | Maven 项目 `testFiles: 0` | 🆕 **第二轮新发现** |
| **P83** | 文件扫描数量与用户预期差距大 | 🆕 **第二轮新发现** |
| **P84** | 多模块 Maven 模块边界未显式标注 | 🆕 **第二轮新发现** |
| **P86** | `vue-page-implicit` 误报仅计数未归因 | 🆕 **第二轮新发现** |
| **P87** | `importerCount>0` 的 dead-export 解释模板化 | 🆕 **第二轮新发现** |
| **P88** | 前端分析文件数差距（368 vs 228） | 🆕 **第二轮新发现** |
| **P89** | Windows 路径大小写强制归一化 | 🆕 **第二轮新发现** |
| **P90** | `.workspace-bridge.json` 配置状态不对称 | 🆕 **第二轮新发现** |

### 实战基地审核发现

| 方向 | 状态 | 关键数据 |
|------|------|----------|
| Spring Boot 框架模式识别 | ✅ 已修复 | dead exports 467→246 |
| Vue Router/Vuex 循环白名单 | ✅ 已修复 | cycles 32→5 |
| Python parser Windows 编码 | ✅ 已修复 | coverage 0.21→1.00 |
| Java 依赖图失效 | ✅ 已澄清 | 假阳性，实际工作正常 |
| **orphans 聚合不一致** | 🆕 **新发现** | `ai_gwy_backend` orphans total(4) ≠ 明细加总(2) |
| **P8-3 增量策展空白** | 🆕 **新发现** | 文档承诺，代码零实现 |
| **实战基地测试耗时** | ⚠️ 观察 | 85 测试 132s，大仓库端到端命令 60–120s |
| **脚手架噪音淹没业务信号** | 🆕 **第二轮** | 两个 RuoYi 后端 dead-exports 重合度 > 90%，cycles/health 完全重合 |
| **Maven testFiles=0** | 🆕 **第二轮** | 两个 Spring Boot 多模块项目均有 `src/test/java` 但 testFiles=0 |
| **Windows 路径大小写归一化** | 🆕 **第二轮** | `filePreview.js` 输出为 `filepreview.js` |

---

## 第一性原理反思（本轮新增）

基于实战基地六仓库端到端审核的系统性审视，workspace-bridge 当前状态：

| 维度 | 评级 | 说明 |
|------|------|------|
| 产品定位 | ✅ 基础设施级别 | 解决 AI 的结构性失明，方向正确 |
| 策展哲学 | ✅ 基础设施级别 | compact 模式、验证建议一体化，有价值 |
| 功能覆盖 | ✅ 9 种语言 AST 全覆盖 | 足够广 |
| 可靠性/边界一致性 | ✅ L1/L2/L3 已硬化 | 上轮完成，本轮无新增崩溃 |
| 错误契约 | ✅ 退出码、空值降级、路径标准化已治理 | 达到基础设施标准 |
| **闭环能力** | ⚠️ **P8-1 可用，P8-3 空白** | `watch --run-tests` ✅ 已交付；但增量策展（P8-3）文档承诺而代码零实现 |
| **跨框架公平性** | ❌ **Vue 优先，其他不足** | Vue 享有循环白名单+隐式依赖+框架模式最高支持；Java/React/Django 同等支持明显不足 |
| **结果可信度** | ✅ **框架边界已硬化** | Spring Boot/Django/Java 框架感知已对齐，循环白名单已公平化 |

**核心结论**：信息层基础设施已稳固（P8-1 闭环可用），但产品叙事与工程现实在三个维度出现脱节：
1. **P8-3 增量策展** — 文档大肆宣传，代码完全空白
2. **跨框架公平性** — "全栈覆盖"的品牌承诺与 "Vue 优先" 的工程现实不符
3. **框架边界渗漏** — Django/Java 的配置驱动/常量仓库模式未得到与 Spring Boot 同等的框架感知待遇

**下一步方向**：见 [ROADMAP.md §P8](./ROADMAP.md#p8从报告到闭环) 和 [TECH_DEBT.md](./docs/TECH_DEBT.md)。

#### 上轮关闭问题清单（已归档）

上轮（2026-05-09）关闭：L2-3, L2-5, L3-1, L3-2, Django 框架模式识别（74→53）等。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

#### 本轮未关闭问题清单

| 问题 | 严重度 | 证据 | 修复建议 |
|------|--------|------|----------|
| P74: `_scanLocalSymbolUsage` 内存峰值 | L2 | `content.split('\n')` 与 file-index.js 已修问题相同 | 改用流式扫描 |
| P75: `framework-usage-patterns.js` 无缓存 I/O | L2 | `fs.existsSync` 无缓存 | 复用 `cachedExistsSync` |
| P76: `watch.js` stdout 无上限 | L2 | 字符串拼接无体积限制 | 设置 1MB 截断 |
| P77: `findUnresolvedImports` Windows 格式 | L3 | `path.isAbsolute` 与 `hasFile` key 格式隐性假设 | 统一路径标准化 |
| P78: 脚手架噪音淹没业务信号 | L2 | 两个 RuoYi 后端 dead-exports 重合度 > 90%，cycles/health 完全重合 | 引入脚手架指纹检测（RuoYi/Vue Admin） |
| P82: Maven `testFiles: 0` | L2 | 两个 Spring Boot 多模块均有 `src/test/java` 但 testFiles=0 | 修复 `isTestLikeFile()` 对 Java 测试命名覆盖 |
| P86: `vue-page-implicit` 误报未归因 | L2 | `possibleFalsePositives` 计数 2 但明细无标签 | 将 fp 原因下沉到单条 dead-export 记录 |
| P87: dead-export 解释模板化 | L2 | `importerCount=18` 仍返回"可能绕过静态检测" | `computeDeadExportConfidence` 按 importerCount 差异化 reason |
| P89: Windows 路径大小写归一化 | L2 | `filePreview.js` → `filepreview.js` | 评估 `normalizePathKey` 跨平台影响 |
| P90: 配置状态不对称触发不一致 | L2 | zcypg 有 `.workspace-bridge.json` 而 zsgzt 无，间接触发 cycle 不一致 | 统一"有空配置"和"无配置"的处理路径 |
| P91: orphans 聚合与明细不一致 | L2 | `ai_gwy_backend` orphans total(4) ≠ 明细加总(2) | 统一 `overview-tools.js` 与 `project-map.js` 的 orphan 计数逻辑 |
| P83/P88: 文件扫描数量差距 | L3 | 1547→389、368→228、23→11 | 文档说明或调整 `totalFiles` 命名 |
| P84: 模块边界未显式标注 | L3 | 多模块 Maven  unresolved=0 但模块耦合强度丢失 | 评估是否输出模块级聚合视图 |

详见 [TECH_DEBT.md](./docs/TECH_DEBT.md) 和 [ROADMAP.md](./ROADMAP.md) §产品方向诚实评估。

---

### 下一轮优先方向

基于两轮实战基地审核（六仓库 + 代码深度审查），下一轮路线重新排序：

**路线 A：数据一致性 + 框架边界硬化 ✅ 已完成**
修复会直接导致"数据不可信"的问题。
- **P85**（L1）：`audit-summary` vs `cycles` 数据不一致 — 统一 `_cycleCount` 计算路径 ✅
- **P70**：`inferFileRole()` 接入框架检测，修复 Spring Boot 入口缺失 ✅
- **P71**：扩展 Django 配置驱动入口（middleware/router/context processors）✅
- **P79/P80/P81**：Spring/Quartz/MyBatis 组件误报 ✅
- **P72**：Java 常量仓库模式识别 ✅
- **P73**：Java/React 循环白名单 ✅

**路线 B：脚手架噪音过滤（产品可用性关键）**
- **P78**：引入脚手架指纹检测 — 识别 RuoYi、Vue Admin 等常见模板的公共文件路径，将脚手架代码标记为 `scaffold: true`，在 summary 层面折叠或单独分组（1–2 天）
- 这是"让工具输出直接可用"的工作，而非"让工具更强大"。优先级应高于 P8-3。

**路线 C：P8-3 增量策展 MVP 或文档诚实化**
- 若做：`audit-file --watch` 原型（1 天）+ `audit-diff --incremental` 原型（1–2 天）
- 若不做：从 AGENTS.md/ROADMAP.md 中删除 P8-3 承诺，停止虚假预期（0.5 天）

**路线 D：性能与工程健康（可并行）**
- **P74**：`_scanLocalSymbolUsage` 内存优化（0.5 天）
- **P75**：`framework-usage-patterns.js` 缓存（0.5 天）
- **P76**：`watch.js` stdout 上限（0.5 天）
- **P82**：Maven `testFiles=0` 修复（0.5 天）
- 测试提速（85 测试 132–139s 明显偏慢）（1 天）

**建议顺序**：A（数据一致性优先） → B（脚手架噪音） → D（工程健康） → C（P8-3 决策）。

---

*Last updated: 2026-05-09（路线 A 交付：P85/P70/P71/P79/P80/P81/P72/P73 全部完成；数据一致性与框架边界硬化；85/85 测试通过）*
