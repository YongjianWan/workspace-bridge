# workspace-bridge Roadmap

> 目标：把 `workspace-bridge` 从"可用的审计 CLI"推进成"能补足 AI 项目视角短板的工程脚手架"。

---

## 当前状态 (v0.8.0)

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
- ✅ 分阶段验证计划（smoke/focused/full）
- ✅ 具体命令生成（可直接粘贴执行）
- ✅ Git 历史风险权重

**测试与验证**
- ✅ 真实项目验证（kimi-agent-evolution、my-factory-system、pm-growth-graph）
- ✅ 自动化测试覆盖核心功能

### 已知限制 ⚠️

| 问题 | 影响 | 缓解措施 |
|------|------|----------|
| 混合仓库误判 | prototypes/reference 被视为主线 | 使用 `.workspace-bridge.json` 标注 |
| Python 技术栈识别不准 | Django 项目识别为 npm | 待完善检测逻辑 |
| 大仓库性能 | 10k+ 文件索引慢 | 首次索引后缓存加速 |
| 孤儿检测假阳性 | 入口文件未被识别 | 人工审查 orphans.samples |

---

## 下一阶段规划

### P1: 稳定性与 polish（v0.8.x）

**代码质量**
- [ ] 重构 `overview-tools.js` - 拆分 146 行大函数
- [ ] 补充自动化测试 - `overview-tools` 专项测试
- [ ] 性能压测 - 大仓库（500+ 文件）性能基准

**功能完善**
- [ ] 改进 Python 技术栈检测 - 识别 Django/Flask/FastAPI
- [ ] 自动入口识别增强 - 框架配置文件（vite.config、manage.py 等）
- [ ] 混合仓库智能识别 - 自动检测 prototypes/examples 目录

### P2: 深度分析（v0.9.x）

**symbol-level impact**
- [ ] 函数级影响分析（依赖 AST）
- [ ] 变更影响具体函数而非整个文件
- [ ] 精确测试映射（测试具体覆盖哪些函数）

**代码相似度（克制地借鉴 reference）**
- [ ] AST 相似度检测（提示，不强制）
- [ ] 发现相似函数时给出参考实现
- [ ] 可选功能，非核心路径

### P3: 全景增强（v1.0.x）

**项目热区图可视化**
- [ ] 生成热区数据文件（供外部工具可视化）
- [ ] 模块稳定性趋势（跨时间分析）

**架构建议**
- [ ] 循环依赖重构建议
- [ ] 过度耦合模块拆分提示

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

v1.0.0 达成条件：
1. 对混合仓库结果稳定（不误报）
2. TS/Python/前端项目都能给出可信主线结论
3. 能从"哪里可能有问题"推进到"该怎么改、改完测什么"
4. symbol-level impact 可用
5. 大仓库性能可接受（<30s 索引）

---

*Last updated: 2026-04-01*
