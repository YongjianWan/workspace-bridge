# workspace-bridge 文档导航

> `docs/` 目录只存放参考材料与导航页，**不维护第二套项目状态**。  
> 当前项目状态、开发原则与 agent 指南的唯一事实源见 [`AGENTS.md`](../AGENTS.md)。

---

## 项目入口

| 文档 | 职责 | 读者 |
|------|------|------|
| [`../AGENTS.md`](../AGENTS.md) | **项目状态唯一事实源**：开发原则、架构分层、当前能力、验证流程、agent 决策边界 | AI agent / 维护者 |
| [`../README.md`](../README.md) | 人类快速入口：一句话定位、安装、核心命令、配置示例 | 人类用户 |

## 规划与状态

| 文档 | 职责 |
|------|------|
| [`../ROADMAP.md`](../ROADMAP.md) | 长期路线、已知限制（当前待处理）、未竟事项、性能瓶颈与用户体验缺口 |
| [`../SESSION.md`](../SESSION.md) | **本轮会话上下文**：做了什么、下一步候选方向、关键落点、实战基地 |
| [`./TECH_DEBT.md`](./TECH_DEBT.md) | 当前活跃技术债务（L1/L2/架构/L3） |

## 历史与审计

| 文档 | 职责 |
|------|------|
| [`../CHANGELOG.md`](../CHANGELOG.md) | 按版本归档的历史变更、bug 修复、功能交付与架构决策记录 |
| [`./code_review.md`](./code_review.md) | **历史审查报告**（2026-06-13）。P0–P2 缺陷已修复并归档至 CHANGELOG；P3 限制中的活跃项以 ROADMAP.md §已知限制为准，本报告仅作历史参考 |
| [`./dogfood.md`](./dogfood.md) | 22 条命令的 dogfood 实测分析，包含命令价值评估与已知实现缺陷 |

## 检查清单

| 文档 | 职责 |
|------|------|
| [`./checklist.md`](./checklist.md) | 全量审计 checklist，覆盖项目状态、架构边界、数据一致性、异常安全、CLI/输出契约、策展可信度、测试体系 |

## 架构记录

| 文档 | 职责 |
|------|------|
| [`./architecture/REFACTOR-2026-05-data-orchestration-output.md`](./architecture/REFACTOR-2026-05-data-orchestration-output.md) | 数据层 / 编排层 / 输出层重构的架构决策与剩余项（D6） |

---

> **文档维护铁律**：活跃文档只存当前状态；历史信息进 CHANGELOG；修复即删，不保留"已修复"的详细背景。
