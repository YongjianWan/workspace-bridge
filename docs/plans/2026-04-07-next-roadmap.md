# workspace-bridge 下一阶段 Roadmap（2026-04-07）

**目标：** 在不增加架构复杂度的前提下，继续提高 audit-diff 的测试映射精度与可执行验证可信度。
**架构：** 保持 CLI-only，围绕 dep-graph 的启发式映射做小步可回滚增强；每个改动都必须有回归测试和现有集成测试兜底。
**技术栈：** Node.js、@babel/parser、Python ast（现有能力复用）。

## 执行进度（2026-04-07）

- [x] M1 完成（语言与路径维度误报压制）
   - [x] 跨语言误匹配修复（JS 源不命中 Java 测试）
   - [x] Windows/Java 变体回归测试通过
- [x] M2 完成（召回率提升）
   - [x] 覆盖 JS/TS barrel re-export 链路
   - [x] 覆盖 Python tests/ 与 test_*.py 混合组织
   - [x] audit-diff 映射来源说明（graph/heuristic/function-level）
- [x] M3 完成
   - [x] topRiskActions 一致性断言测试
   - [x] CHANGE_PROOF 模板草案（docs/CHANGE_PROOF_TEMPLATE.md）
   - [x] 建议命中率前后对比报告（reports/roadmap-m3-mapping-hitrate-compare.json）

## 范围与非范围

### 范围

- 受影响测试映射（affected-tests）精度提升。
- mixed repo 下误报/漏报压降。
- audit-diff 验证建议可信度提升（基于更准的映射结果）。

### 非范围

- 不引入 MCP 协议层。
- 不引入向量检索、RAG 或强制复用闸。
- 不做大规模架构重写。

## 里程碑

### M1（本周）：语言与路径维度误报压制

**完成标准：**

- 已实现的跨语言误匹配修复稳定（JS 源不命中 Java 测试）。
- Windows/Java 变体回归测试稳定通过。

**任务：**

1. 继续补充同语言跨模块边界用例（monorepo package 边界）。
2. 对路径签名规则增加边界断言（同 stem 但不同模块根不可命中）。
3. 跑通 affected-tests / audit-diff / function-impact 回归链路。

### M2（下周）：召回率提升（在不回退精度前提下）

**完成标准：**

- 至少新增 3 个“当前漏报”的真实样例并修复。
- 新增规则不导致已有高优先回归失败。

**任务：**

1. 覆盖 JS/TS barrel re-export 链路对测试映射的影响。
2. 覆盖 Python 常见测试组织形式（tests/ 与 test_*.py 混合）。
3. 为 audit-diff 增加“映射来源说明”（graph/heuristic/function-level）。

### M3（两周内）：验证建议可执行性增强

**完成标准：**

- audit-diff 的 topRiskActions 与受影响测试一致性可被测试验证。
- 增加至少 1 个面向真实工作流的端到端 fixture。

**任务：**

1. 为 topRiskActions 增加一致性断言测试。
2. 增加 CHANGE_PROOF 风格输出草案（可选开关，不阻断主流程）。
3. 对比增强前后建议命中率（基于现有 benchmark fixture）。

## 执行顺序（建议）

1. 先做 M1 的边界回归补齐。
2. 再做 M2 的漏报修复。
3. 最后做 M3 的输出增强与一致性校验。

## 验证门禁

每次提交前至少执行：

- node test/affected-tests-heuristic-test.js
- node test/audit-diff-test.js
- node test/function-impact-test.js
- node test/analysis-test.js

涉及 overview 或格式化输出时追加：

- node test/overview-tools-test.js

## 风险与缓解

1. 规则增多导致维护成本上升。
   缓解：优先签名归一 + 语言家族两层规则，避免再叠 if 分支。
2. 提升召回时引入误报回潮。
   缓解：先加失败测试，再改实现；高优先负例长期保留。
3. mixed repo 样例覆盖不足。
   缓解：固定 3 组夹具（Node-only、Python-only、mixed）持续回归。

## 本阶段 Definition of Done

1. roadmap 内 M1 任务全部完成并有测试证据。
2. 关键回归链路全绿。
3. 不引入新的 unresolved / cycle 回归。
4. ROADMAP 主文档同步更新状态。
