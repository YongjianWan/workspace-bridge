# workspace-bridge Roadmap

> 目标：把 `workspace-bridge` 从"可用的审计 CLI"推进成"能补足 AI 项目视角短板的工程脚手架"。

---

## 当前状态

### 已完成功能 ✅

**CLI 聚合命令**

- ✅ `audit-summary` - 项目整体健康度扫描
- ✅ `audit-file` - 单文件影响面分析
- ✅ `audit-diff` - 当前改动验证建议（含技术栈检测、分阶段命令）
- ✅ `audit-overview` - 项目全景视图（热区、稳定性、孤儿检测）

**解析层**

- ✅ JS/TS AST 解析（@babel/parser）
- ✅ Python AST 解析（标准库 ast）
- ✅ 精确 import/export 识别
- ✅ 失败自动回退到 regex

**语义识别**

- ✅ 目录角色识别（active/reference/archive/generated）
- ✅ 文件角色识别（entry/library/config/test/migration/script）
- ✅ `.workspace-bridge.json` 配置支持
- ✅ `--exclude` 命令行排除

**验证建议**

- ✅ 技术栈自动检测（packageManager/testRunner/linters/typeChecker）
- ✅ mixed repo 技术栈分层识别（python-first / node-first / mixed）
- ✅ mixed repo 分层命令生成（Node / Python）
- ✅ Java 技术栈检测与命令生成（Maven / Gradle）
- ✅ 分阶段验证计划（smoke/focused/full）
- ✅ 具体命令生成（可直接粘贴执行）
- ✅ Git 历史风险权重
- ✅ `compositeRisk` 融合判断（结构影响 + 测试映射 + 历史风险）
- ✅ `topRiskAction` / `topRiskCommand`（CLI 人类可读可执行建议）
- ✅ Top 风险证据链（impact/tests/history/symbolMode）
- ✅ `summary.topCompositeRisks` 机器可读风险排序
- ✅ `symbolToDependents`（导出符号到依赖文件映射）
- ✅ `audit-overview` 聚合统计（hotspotsByRisk / stabilityCounts）
- ✅ `audit-diff` historyRisk 限并发采集（大改动集性能优化）
- ✅ test mapping 命名启发式兜底（无显式 import 场景）
- ✅ Python framework 检测增强（Django/FastAPI/Flask）
- ✅ 混合仓库目录智能识别（自动降权 prototypes/examples 为 reference）
- ✅ 自动入口识别增强（framework/config 入口：manage.py、vite.config.*）
- ✅ 500+ 文件性能基准脚本（cold/hot/incremental，含 tree 与阈值）
- ✅ function-level affected tests baseline（JS/TS：changed function -> likely tests）
- ✅ compositeRisk 接入函数级信号（changedFunctionImpact）
- ✅ 复用提示升级（结构+命名混合相似度 baseline）

**诊断执行**

- ✅ Windows npm/npx 兼容（`npm.cmd` + `cmd.exe` shim）
- ✅ quick 兜底检查（避免 `checksRun=0` 空结果）

**测试与验证**

- ✅ 真实项目验证（kimi-agent-evolution、my-factory-system、pm-growth-graph）
- ✅ 自动化测试覆盖核心功能

### 已知限制 ⚠️

| 问题                  | 影响                            | 缓解措施                             |
| --------------------- | ------------------------------- | ------------------------------------ |
| 混合仓库误判          | prototypes/reference 被视为主线 | 使用 `.workspace-bridge.json` 标注 |
| mixed repo 技术栈启发式 | Node/Python 共存时命令可能不够精确 | 持续改进 stack-detector              |
| 大仓库性能            | 10k+ 文件索引慢                 | 首次索引后缓存加速                   |
| 孤儿检测假阳性        | 入口文件未被识别                | 人工审查 orphans.samples             |

---

## 下一阶段规划

## 生命周期 Roadmap

### Phase 0: Core CLI 基座
- CLI-only 入口
- cache / file-index / dep-graph 跑通
- `audit-summary` / `audit-file` 成型

### Phase 1: 可信分析
- 目录/文件角色识别
- JS/TS AST
- Python AST
- `dead-exports` / unresolved / cycles 稳定

### Phase 2: 变更验证
- `audit-diff`
- historyRisk
- 分阶段验证计划
- mixed repo 技术栈分层命令

### Phase 3: 项目全景
- `audit-overview`
- 热区
- 稳定性
- 孤儿文件
- 核心模块识别

### Phase 4: 深度分析
- symbol-level impact（已实现 baseline：JS/TS + Python + Java，AST 失败回退 file-level）
- 函数级影响 baseline（已实现：JS/TS 导出函数映射到 dependents）
- 更精确的 test mapping
- mixed repo 命令精度提升

### Phase 5: 长期演进
- overview 可视化输出
- 架构重构建议
- 大仓库性能专项优化

### P1: 稳定性与 polish

**代码质量**

- [x] 重构 `overview-tools.js` - 拆分大函数
- [x] 补充自动化测试 - `overview-tools` 专项测试
- [x] 性能压测 - 大仓库（500+ 文件）性能基准

**功能完善**

- [x] 改进 Python 技术栈检测 - 识别 Django/Flask/FastAPI
- [x] 自动入口识别增强 - 框架配置文件（vite.config、manage.py 等）
- [x] 混合仓库智能识别 - 自动检测 prototypes/examples 目录

### P2: 深度分析

**symbol-level impact**

- [x] 跨文件 symbol-level impact baseline（JS/TS + Python + Java）
- [x] 函数级影响分析 baseline（JS/TS 导出函数）
- [x] 变更影响具体函数而非整个文件 baseline（JS/TS：基于 diff 行号）
- [x] 精确测试映射（测试具体覆盖哪些函数，当前为启发式 baseline）`完成于 2026-04-02，commit: 1f5cadf`

**代码相似度（克制地借鉴 reference）**

- [x] AST 相似度检测 baseline（结构+命名，提示，不强制）
- [x] 发现相似函数时给出参考实现（reuseHints suggestions）
- [x] 可选功能，非核心路径 `完成于 2026-04-02，commit: 494699d`

### P3: 全景增强

**项目热区图可视化**

- [x] 生成热区数据文件（供外部工具可视化） `完成于 2026-04-02，commit: be9ba31`
- [x] 模块稳定性趋势（跨时间分析） `完成于 2026-04-02，commit: 38cf70f`

**架构建议**

- [x] 循环依赖重构建议 `完成于 2026-04-02，commit: b7a0f1a`
- [x] 过度耦合模块拆分提示 `完成于 2026-04-02，commit: 1e8127c`

### P5: 长期演进

- [x] overview 可视化输出 `完成于 2026-04-03，commit: 383d6d6`

### P6: Skill 标准化

- [x] workspace-audit 标准化 v1（随机路径可用 + 启动 preflight + 标准输出契约） `完成于 2026-04-03，commit: d11288d`
- [x] 全局安装/回退策略脚本化（`workspace-bridge-cli` 不可用时自动降级到 `node <repo>/cli.js`） `完成于 2026-04-03，commit: ceaba86`
- [x] benchmark compare 阈值策略重构（相对基线 + 波动容忍，去掉固定 500ms 噪音）

---

## 设计原则（保持）

1. **CLI-only** - 不引入 MCP/协议层
2. **先减少误报，再增加功能** - 结果可信优先
3. **先识别主线，再做判断** - 混合仓库先过滤
4. **输出必须能指导动作** - 不是报告，是行动计划
5. **工程克制** - 函数 < 30 行，拒绝过度抽象

---

## Reference 借鉴策略

**不采用的**：

- 四层强制架构（过度工程）
- RAG + 嵌入向量（太重）
- 强制复用闸（违背 CLI 定位）

**可能借鉴的**：

- AST 相似度算法（克制实现，仅提示）
- CHANGE_PROOF.md 模板（增强报告格式）

**保持差异**：

- workspace-bridge = 轻量建议工具
- reference = 重型强制脚手架
- 两者定位不同，不硬融合

---

## 成功标准

达成条件：

1. 对混合仓库结果稳定（不误报）
2. TS/Python/前端项目都能给出可信主线结论
3. 能从"哪里可能有问题"推进到"该怎么改、改完测什么"
4. symbol-level impact 可用
5. 大仓库性能可接受（<30s 索引）

---

## 当前执行计划（2026-04-07）

- 见 [docs/plans/2026-04-07-next-roadmap.md](docs/plans/2026-04-07-next-roadmap.md)
- 当前状态：M1-M3 已完成（误报压制、召回增强、验证一致性）
- 执行门禁：`affected-tests-heuristic-test`、`audit-diff-test`、`function-impact-test`、`analysis-test`

---

*Last updated: 2026-04-07*
