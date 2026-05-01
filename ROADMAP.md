# workspace-bridge Roadmap

> 目标：把 `workspace-bridge` 从"可用的审计 CLI"推进成"能补足 AI 项目视角短板的工程脚手架"。
> 
> 历史版本见 [CHANGELOG.md](./CHANGELOG.md)；历史技术方案见 [docs/plans/](./docs/plans/)。

---

## 已知限制

| 问题 | 状态 | 影响 | 缓解措施 |
|------|------|------|----------|
| 临时文件污染 | ✅ 已修复 | `.tmp-*`、缓存临时文件被纳入 `audit-diff` | `git-tools.js` `isTempFile()` 已过滤（P0T1） |
| 测试配置盲区 | ✅ 已修复 | `package.json` 自定义 `test:*` 脚本未被识别为测试框架 | `detectTestConfig()` 已识别 `test` / `test:*`（P0T2/P0T3） |
| 文件角色误判 | ✅ 已修复 | 文档（`AGENTS.md`、`README.md`）被分类为 `library`，导致 `changeType: code` | `inferFileRole()` 新增 `docs` 角色（P0T3） |
| 孤儿检测假阳性 | ✅ 已修复 | 入口文件未被识别 | `_collectEntryFiles()` 路径规范化（P0T3） |
| 混合仓库误判 | ⏳ 需配置 | prototypes/reference 被视为主线 | 使用 `.workspace-bridge.json` 标注目录角色 |
| mixed repo 技术栈启发式 | ⏳ 持续改进 | Node/Python 共存时命令可能不够精确 | 持续打磨 `stack-detector` |
| 大仓库性能 | ⏳ 有方案待执行 | 10k+ 文件索引慢；全量 JSON 输出爆炸 | 三步走：REPL 精确查询 -> 缓存解析结果 -> watcher 增量更新。详见下方 P5 |
| Next.js / Python CLI dead-export 误报 | ✅ 已修复 | `page.tsx`、`if __name__ == '__main__'` 被误判为 dead export | `isKnownEntryFile()` 新增框架入口模式（v0.9.12） |
| `.next`/`.nuxt` 编译产物未排除 | ✅ 已修复 | Next.js/Nuxt 编译输出被纳入分析 | `DEFAULT_EXCLUDE_DIRS` 扩展（v0.9.12） |
| node_modules 路径陷阱 | ✅ 已修复 | 全局安装包（cwd 在 node_modules 内）被全量排除 | `shouldExclude()` 相对路径匹配（v0.9.12） |
| regex 字符串字面量误识别 | ✅ 已修复 | 模板字符串中的 `import...from` 被误识别 | `sanitizeForRegex()` 剥离字符串和注释（v0.9.12） |
| cycle 自循环 | ✅ 已修复 | 文件自身被报告为循环依赖 | `analyzeFile()` 自引用过滤 + cycle 检测保险（v0.9.12） |
| 缓存文件副作用 | ✅ 已修复 | `.workspace-bridge-cache.json` 被 audit-diff 误判 + 污染 git status | `shouldExclude()` + `getChangedFiles()` 双重排除（v0.9.12） |
| audit-file 不存在文件 | ✅ 已修复 | 对不存在的文件路径返回 `ok:true` | `cli.js` 增加 `fs.existsSync` 检查（v0.9.12） |

---

## 基础能力（Phase 0-1）—— 先止血，再增功能
按 AGENTS.md 原则"先减少误报，再加功能"，以下问题当前最伤害输出可信度，优先于多语言深度。每个条目已拆为"代码落点 + 验收命令"。

### P0T1: 临时文件过滤（CLI 层面）— ✅ 完成
- **问题**：`.gitignore` 已更新，但 `audit-diff` 代码层面仍将 `.tmp-*`、`.workspace-bridge-cache.json.tmp-*` 纳入 `changedFiles`
- **代码落点**：`src/tools/git-tools.js` `getChangedFiles()` 新增 `isTempFile()` 过滤
- **完成证据**：`git-tools.js` 正则匹配 basename；`phase01-quality-test.js` `testTempFileFilter` 通过；`scripts/self-audit.js` 增加污染检测前置检查（530c6b7）
- **验收**：存在 `.tmp-audit-summary.json` 时，`audit-diff` 的 `changedFiles` 不包含它

### P0T2: 自定义测试脚本识别 — ✅ 完成
- **问题**：`package.json` 中 `test:*` / `test:all` 等自定义脚本未被识别为测试配置，`health.testConfig: false`，`audit-diff` focused 阶段命令缺失
- **代码落点**：`src/utils/stack-detector.js` `detectTestRunner()` 增加 `package.json` `scripts` 字段扫描（检测 `test` / `test:*` 前缀）
- **完成证据**：`phase01-quality-test.js` `testCustomTestScriptDetection` 通过；`audit-summary` 当前输出 `testConfig.found: true`（已从 `false` 变为 `true`）
- **验收**：`audit-summary` 输出 `testConfig.found: true, frameworks: ["custom-node-scripts"]`；`audit-diff` 的 `commands.focused` 不为空。已同步 `stack-detector.js` 逻辑，排除 `pretest`/`posttest` 生命周期钩子（56d38bc）

### P0T3: 文件角色分类修正 — ✅ 完成
- **问题**：文档（`AGENTS.md`、`README.md`）被分类为 `library`，`cli.js` 同时出现在 `entryPoints` 和 `orphans` 中
- **代码落点**：`src/utils/project-context.js` `inferFileRole()` 新增 `docs` 角色（`.md/.txt/.rst` + LICENSE/CHANGELOG/CONTRIBUTING）和扩展 `config` 模式；`dep-graph.js` `_collectEntryFiles()` 路径规范化
- **完成证据**：`phase01-quality-test.js` `testFileRoleDocs` + `testFileRoleConfig` + `testEntryFileNormalization` 全绿
- **验收**：`audit-diff` 中文档改动输出 `fileRole: docs, changeType: docs`；`audit-overview` 的 `orphans.modules` 不含 `cli.js`

### P0T4: 变更类型判断修正 — ✅ 完成
- **问题**：文档/配置改动被输出为 `changeType: code`，验证模板错配
- **代码落点**：`src/cli/audit-formatters.js` `classifyChangeType()` 增加 `fileRole === 'docs'` 分支
- **完成证据**：`phase01-quality-test.js` 通过；`audit-summary` 当前输出 `testRunner: "custom"`（T3 连带修复）
- **验收**：只改 `README.md` + `ROADMAP.md` 时，`audit-diff` 输出 `changeType: docs`

### P0T5: Diff 场景 test mapping 激活（内部函数改动追踪）— ✅ 完成
- **问题**：改内部辅助函数（如 `readGoMod`）时，`changedFunctionImpact.mode = "no-exported-function-change"`，`affectedTests` 为 0
- **代码落点**：`src/services/dep-graph/parsers.js` 新增 `functionRecords`（所有函数定义含 callCallees）；`src/services/dep-graph/function-impact.js` `getChangedFunctionImpact()` 增加 DFS 调用链追溯；`cli.js` 识别 `internal-function-call-chain` mode 以触发 `functionLevelAffectedTests`
- **改动量**：~80 行
- **完成证据**：`test/p0t5-internal-function-impact-test.js` 4 项全绿；`audit-diff` 改 `resolvers.js` 中 `readGoMod` 时，`functionLevelAffectedTests` 包含 `test/gors-resolver-test.js`
- **附带修复**：CJS `module.exports = { fn }` 导出识别（P3 同轮完成），使 `functionToDependents` 对本项目生效

---

## 收敛里程碑：从 0.8.0 到 0.8.2+

> 以下内容来自 `docs/plans/2026-05-05-two-week-convergence.md`，已融入主文档。

### Phase 0：基础止血（已完成）
P0T1–P0T5 全部交付，详见上方"基础能力（Phase 0-1）"章节。

### W1：可信度与命令正确性（已完成）
| 任务 | 状态 | 说明 |
|------|------|------|
| W1T1 Java dead-export 保守策略 | ✅ | 有 importer 的 Java AST 文件不再产生符号级 dead-export（v0.8.2） |
| W1T2 Gradle Checkstyle 命令 | ✅ | Gradle 项目使用 `gradlew checkstyleMain checkstyleTest`，不再混用 Maven 语法（v0.8.2） |
| W1T3 回归测试补全 | ⚠️ 部分 | Go/Rust 解析与命令质量已覆盖（`gors-resolver-test.js` + `w2t3-command-quality-test.js`）；Java dead-export / Gradle Checkstyle 专项目标测试待补 |
| W1T4 文档诚实化 | ✅ | AGENTS.md / ROADMAP.md / SKILL.md 能力矩阵已与 v0.8.2 对齐 |

### W2：自审可用性与工程收口（已完成）
| 任务 | 状态 | 说明 |
|------|------|------|
| W2T1 官方自审脚本 | ✅ | `scripts/self-audit.js` + `npm run self-audit`（44b1780） |
| W2T2 命令建议质量收口 | ✅ | Go/Rust config 改动触发 build/check；Java focused 测试按 `.java` 改动触发；`splitTargetsByStack` 纳入 `go.mod` / `Cargo.toml` |
| W2T3 JSON 消费链路稳定 | ✅ | `self-audit.js` 用 `spawnSync` 安全消费 CLI JSON，绕过 PowerShell 管道 UTF-16 问题 |
| W2T4 发布前总回归 | ✅ | `npm run test:all` 17→21 项全绿 |

---

## 从 0.8 到 1.0 的关键判断

> 骨架很好，但还在"证明我能造轮子"的阶段。变成产品需要"承认自己不是全能"的觉悟。

### 外部工具集成策略（做减法）

| 维度 | 策略 | 理由 |
|------|------|------|
| 依赖图 | **自研，不接外部** | 多语言统一是核心壁垒，pydeps/madge 都是单语言 |
| 风格/质量 | **自研 + Semgrep 可选后端** | 你管格式（紧凑标签行），Semgrep 管规则库。`npm install` 之外的可选依赖 |
| 安全/死循环 | **自研为主** | 启发式 + regex 已够用，bandit 可作为插件但不是必须 |
| 精确影响/污点分析 | **CodeQL 后端 + adapter** | 承认打不过。写 `adapters/codeql.js` 把 SARIF 翻译成你的标签行，AI 看到的是统一 `[RISK][HIGH] file:line` |
| 增量分析 | **自研，不接外部** | git diff 驱动 <200ms 热启动是护城河，外部工具反而没你轻量 |

### 技术栈评估

- **JS/TS AST**：`@babel/parser` 是对的，保持
- **Python AST**：当前用标准库 `ast`，建议评估 **tree-sitter**（更快、语言覆盖更广、native binding 和 `better-sqlite3` 不冲突）
- **Java AST**：`javalang` 够用，暂不替换

### 多语言扩展 ADR（已完成）

以下决策来自 `docs/plans/2026-04-28-java-and-polyglot-support.md`，已落地：

| 决策 | 内容 | 理由 |
|------|------|------|
| ADR-1：Java AST 解析器 | 选 `javalang`（Python），不用 tree-sitter | 与现有 Python AST 子进程模式一致；不污染 package.json |
| ADR-2：Kotlin/Go/Rust | 只做 regex 级（L2），不做 AST | 真实场景待验证；regex 已满足 80% audit-overview 需求 |
| ADR-3：语言插件注册表 | 本次不做，保留硬编码链 | 当前 6 种语言维护成本可接受；注册表重构 >3 天，与收敛目标冲突 |

---

## 未竟事项（按价值排序）

### P1：提升分析可信度
- [x] **Java/Go/Rust 语言级使用点解析**（投入：中 / 收益：高 / 风险：低）— `dep-graph.js` `_scanSymbolUsageInImporters()` 轻量扫描 importer 文件中的方法调用/字段访问，补充 importRecords 未 capture 的使用。消除 Java 实例调用 `foo.bar()`、Go `pkg.Func()` 等场景的符号级 dead-export 误报
- [x] **Go/Rust 包级解析器**（投入：中 / 收益：高 / 风险：中）— `go.mod` 包路径解析、`Cargo.toml` + module tree，替代仅相对 import
- [x] Java 方法级 dead-export 误报消除（实例调用不在 import 记录中）— 已通过 P1 使用点扫描解决，不再需要保守跳过

### P1.5：全局项目地图（audit-map）— ✅ 完成
- [x] **`audit-map` 命令**（投入：低 / 收益：高 / 风险：低）— 聚合 `tree`（目录骨架）+ `edges`（依赖拓扑）+ `issueOverlay`（问题标注），给 AI 全局视野。数据已全部存在，只需序列化输出
- [x] **Tree 输出**：按目录聚合 FileIndex 数据，标注 role（entry/library/test/config）
- [x] **Edges 输出**：序列化 DependencyGraph 的 import/export 关系
- [x] **IssueOverlay 输出**：叠加 unresolved / deadExports / cycles / orphans / hotspots
- **代码落点**：`src/cli/audit-formatters.js` `buildProjectMap()` + `cli.js` `audit-map` case
- **验收**：`node cli.js audit-map --cwd . --json --quiet` 输出目录聚合 tree / 65 edges / 3 deadExports / 9 orphans / 4 hotspots
- **已知 issue**：已修复（SESSION.md 2026-04-29 轮次）。当前实现包含 re-export 边、confidence 分级、目录聚合树、hotspots、workspaceRoot 正确传递。

### P2：提升命令可执行性
- [x] **构建/测试命令智能化**（投入：中 / 收益：高 / 风险：低）— Rust workspace 子 crate 已完成（`detectRustWorkspaceMembers` + `cargo test -p`）
- [ ] **Gradle 任务发现**（投入：高 / 收益：中）— 解析 `settings.gradle` 或运行 `gradle projects` 获取子项目，生成 `:subproject:test`
- [ ] **Go module path 聚合**（投入：中 / 收益：中）— 嵌套 `go.mod` 场景下 `go test ./dir` 可能不准，需检测子 module
- [x] mixed repo 命令精度提升 — `classifyChangeType()` 单一数据源重构（fileRole 优先）+ `getNodeCommands()` codeTargets 过滤（排除 json/cache 误入 focused tests）
- [ ] Go 验证命令按 module path 聚合（当前按目录聚合，子模块下可能不准）
- [ ] Rust 模块级测试过滤（需解析 `mod` 声明）
- [x] **CLI 命令完整性补全**（投入：低 / 收益：中 / 风险：低）— `stats` / `dependents` / `dependencies` 已暴露为独立 CLI 命令；Usage 文档已同步

### P3：提升输出可解释性
- [x] **CJS 符号解析补全**（投入：低 / 收益：高 / 风险：低）— `parsers.js` 识别 `module.exports = { fn }` 和 `exports.fn = ...` 结构，使 `symbolToDependents` 不再为空数组。落点：`dep-graph/parsers.js` + `symbol-impact.js` `buildFunctionToDependents` 同时参考 `functionRecords`
- [x] **内部函数改动→测试映射**（投入：中 / 收益：高 / 风险：低）— `getChangedFunctionImpact()` 追踪内部辅助函数的调用链，找到调用它的导出函数，再映射 dependents。落点：`src/services/dep-graph/function-impact.js`
- [x] **影响路径解释字段**（投入：低 / 收益：中 / 风险：低）— `getImpactRadius()` 扩展 `via`（路径链）+ `importedSymbols`（导入符号）+ `reason` 字段。落点：`src/services/dep-graph.js`
- [x] **变更影响解释链（聚合）**（投入：中 / 收益：高 / 风险：低）— `audit-formatters.js` `buildImpactExplanations()` 聚合可读因果链，`audit-diff` 返回 `impactExplanations`。如"因 `resolvers.js` 被 `dep-graph.js` import（resolveImport），故波及测试"。落点：`src/cli/audit-formatters.js` + `cli.js`
- [x] **耦合拆分建议去模板化**（投入：低 / 收益：中 / 风险：低）— `audit-overview` 的 `couplingSplitSuggestions` 已按 role + 出入度生成针对性建议（entry/utility/consumer/script/test/config）。落点：`src/tools/overview-tools.js` `generateCouplingSplitPlan()`（9198613）
- [x] **统一能力矩阵输出**（投入：低 / 收益：中 / 风险：低）— `audit-overview` JSON 已带 `languageSupport` 矩阵（level/confidence/files/astFiles）

### P4：技术债
- [x] **文件拆分：按语言/功能拆解超标文件**（投入：中 / 收益：中 / 风险：中）— `parsers.js` 976 行已拆为 `parsers/` 目录（shared + js + python + java + polyglot + index），均 < 500 行
  - `src/services/dep-graph/parsers.js`（876 行）→ 按语言拆为 `src/parsers/{javascript,python,java,kotlin,go,rust}.js` + `index.js` 统一导出。风险低，纯代码搬迁，接口不变。**建议优先执行。**
  - `src/cli/audit-formatters.js`（886 行）→ 按 formatter 拆为 `src/cli/formatters/{composite-risk,repo-summary,file-summary,audit-diff-summary,validation-advice,project-map}.js`。风险中低，需改 `cli.js` 和测试的 `require` 路径。
  - `src/services/dep-graph.js`（711 行）→ `DependencyGraph` class 方法较多，拆需子模块/mixin。风险中高，**建议等 P1（使用点解析）稳定后再动**，避免图逻辑变动时跨文件重构。
- [ ] Kotlin AST 级支持（当前 L2 regex；需处理 object/companion object/top-level fun）
- [ ] 大仓库性能专项优化（>10k 文件索引）— 详见 P5 三步走方案
- [ ] **插件化解析器注册表**（投入：高 / 收益：中 / 风险：高）— 轻量注册表替代 if-else 链，保持 CLI-only，不引入协议层

### P5：大项目体验优化（REPL + 缓存 + Watcher）

> 问题：小项目全量 JSON 输出可用，大项目（10k+ 文件）时 `audit-map`/`audit-overview` 的 edges 数组爆炸，`audit-diff` 输出数千行 JSON，且每次 CLI 调用都重建 dep-graph。
>
> 基础设施现状：`file-index.js` 已有 `fs.watch` + `pendingUpdates` debounce 骨架（`startWatching()`/`processPending()`），但只更新 fileMetadata，未接到 dep-graph；`cache.js` 只存了 `{mtime, size, hash}`，不存 parseResult。

#### Step 1：REPL / 精确查询模式（1-2 天，投入低/收益高）

新增 `node cli.js repl --cwd .`，启动一次，交互查询，按需输出：

```
> impact src/utils/path.js
impactCount: 14, dependents: [...]

> affected-tests src/services/dep-graph.js --max-depth 3
affectedTestCount: 8, tests: [...]

> dead-exports
deadExportCount: 0
```

- **改动**：`cli.js` 新增 `repl` case；新增 `src/cli/repl.js`（readline 循环 + 命令解析）
- **收益**：大项目不用每次等全量 JSON，只返回请求字段
- **验收**：启动后输入 `impact src/utils/path.js`，<100ms 返回精简结果

#### Step 2：缓存解析结果（1-2 天，解决冷启动慢）

扩展 `cache.js`，新增 `parseResults` Map（file -> {imports, exports, importRecords, exportRecords, functionRecords, parseMode, mtime}）：

```js
// dep-graph.js build() 增量逻辑
for (const file of files) {
  const cached = this.cache.getParseResult(file);
  const currentMtime = fs.statSync(file).mtimeMs;
  if (cached && cached.mtime === currentMtime) {
    this.graph.set(file, cached); // 文件未变，跳过解析
  } else {
    await this.analyzeFile(file);
    this.cache.setParseResult(file, this.graph.get(file));
  }
}
```

- **收益**：10k 文件仓库改 1 个文件后 rebuild，从"解析 10k 文件"变成"解析 1 个 + 读取 9999 个缓存"
- **验收**：第二次 `node cli.js audit-summary --cwd .` < 3s（10k 文件 fixture）

#### Step 3：激活 Watcher（在 Step 2 基础上，2-3 天）

`file-index.js` 已有 `fs.watch` + `pendingUpdates` debounce。只需：

1. `processPending()` 末尾触发 dep-graph 增量更新
2. `dep-graph.js` 新增 `updateFiles(filePaths)` 接口：
   - 重新解析变化文件
   - 增量更新 reverseGraph（删除旧 import 引用 -> 添加新引用）
   - 不重建全量 reverseGraph

- **收益**：文件保存后终端实时打印 "1 file updated, 14 dependents affected"
- **验收**：`node cli.js watch --cwd .` 后改一个文件，<500ms 完成增量更新

---

## 设计原则

1. **CLI-only** - 不引入 MCP/协议层
2. **先减少误报，再加功能** - 结果可信优先
3. **先识别主线，再做判断** - 混合仓库先过滤
4. **输出必须能指导动作** - 不是报告，是行动计划
5. **工程克制** - 函数 < 30 行，文件 < 500 行，拒绝过度抽象
6. **承认自己不是全能** - 不该造的轮子交给外部工具，自己专注增量分析和 AI 友好格式

---

## 成功标准

1. 对混合仓库结果稳定（不误报）
2. TS/Python/前端项目都能给出可信主线结论
3. 能从"哪里可能有问题"推进到"该怎么改、改完测什么"
4. symbol-level impact 可用
5. 大仓库性能可接受（<30s 索引，首次全量 <5min）
6. **可选外部工具后端**（Semgrep/CodeQL adapter 可插拔）

---

---

## 已归档计划

以下历史技术方案已完成并融入本文档，原始文件保留供追溯：

- `docs/plans/2026-04-28-java-and-polyglot-support.md` — Java AST 级支持与多语言扩展（已融入"技术栈评估 / ADR"）
- `docs/plans/2026-05-05-two-week-convergence.md` — 两周收敛计划（已融入"收敛里程碑"）

---

*Last updated: 2026-05-01（v0.9.12 issue 批量修复：框架感知 + regex 精度 + cycle 自循环 + 缓存副作用 + audit-file 存在性）*
