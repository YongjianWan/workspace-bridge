# workspace-bridge Roadmap

> 目标：把 `workspace-bridge` 从"可用的审计 CLI"推进成"能补足 AI 项目视角短板的工程脚手架"。
> 
> 历史版本见 [CHANGELOG.md](./CHANGELOG.md)；历史技术方案见 [docs/plans/](./docs/plans/)。

---

## 已知限制

| 问题 | 影响 | 缓解措施 |
|------|------|----------|
| 临时文件污染 | `.tmp-*`、缓存临时文件被纳入 `audit-diff` | 清理工作区；后续加过滤规则 |
| 测试配置盲区 | `package.json` 自定义 `test:*` 脚本未被识别为测试框架 | 手动确认 `scripts.test` 存在即可运行 |
| 文件角色误判 | 文档（`AGENTS.md`、`README.md`）被分类为 `library`，导致 `changeType: code` | 人工判断真实变更类型 |
| 混合仓库误判 | prototypes/reference 被视为主线 | 使用 `.workspace-bridge.json` 标注 |
| mixed repo 技术栈启发式 | Node/Python 共存时命令可能不够精确 | 持续改进 stack-detector |
| 大仓库性能 | 10k+ 文件索引慢 | 首次索引后缓存加速 |
| 孤儿检测假阳性 | 入口文件未被识别 | 人工审查 orphans.samples |

---

## 基础能力（Phase 0-1）—— 先止血，再增功能
按 AGENTS.md 原则"先减少误报，再加功能"，以下问题当前最伤害输出可信度，优先于多语言深度。

- [ ] **临时文件/缓存过滤**（投入：低 / 收益：高 / 风险：低）— `.tmp-*`、`.workspace-bridge-cache.json.tmp-*` 不应进入 `audit-diff` 分析，避免 severity 虚高
- [ ] **文件角色分类修正**（投入：低 / 收益：高 / 风险：低）— `AGENTS.md`/`README.md` 等文档不应分类为 `library`；`cli.js` 不应同时出现在 `entryPoints` 和 `orphans` 中
- [ ] **自定义测试脚本识别**（投入：低 / 收益：高 / 风险：低）— `package.json` 中 `test:*` / `test:all` 等自定义脚本应被识别为测试配置，解决 `testConfig: false` 误报和 `audit-diff` focused 阶段命令缺失
- [ ] **变更类型判断修正**（投入：低 / 收益：高 / 风险：低）— 文档/配置改动应正确输出 `changeType: docs/config`，匹配对应的验证模板
- [ ] **Diff 场景 test mapping 激活**（投入：中 / 收益：高 / 风险：低）— 脚本/服务文件改动时，`affectedTests` 不应恒为 0

---

## 未竟事项（按价值排序）

### P1：提升分析可信度
- [ ] **Java/Go/Rust 语言级使用点解析**（投入：中 / 收益：高 / 风险：低）— 轻量扫描符号使用，消除 dead-export 系统性误报
- [x] **Go/Rust 包级解析器**（投入：中 / 收益：高 / 风险：中）— `go.mod` 包路径解析、`Cargo.toml` + module tree，替代仅相对 import
- [x] Java 方法级 dead-export 误报消除（实例调用不在 import 记录中）— 已通过 AST 保守策略缓解

### P1.5：全局项目地图（audit-map）
- [ ] **`audit-map` 命令**（投入：低 / 收益：高 / 风险：低）— 聚合 `tree`（目录骨架）+ `edges`（依赖拓扑）+ `issueOverlay`（问题标注），给 AI 全局视野。数据已全部存在，只需序列化输出
- [ ] **Tree 输出**：按目录聚合 FileIndex 数据，标注 role（entry/library/test/config）
- [ ] **Edges 输出**：序列化 DependencyGraph 的 import/export 关系
- [ ] **IssueOverlay 输出**：叠加 unresolved / deadExports / cycles / orphans / hotspots

### P2：提升命令可执行性
- [ ] **构建/测试命令智能化**（投入：中 / 收益：高 / 风险：低）— 基于真实配置生成命令（Gradle 任务发现、Go package 聚合、Rust workspace 子 crate）
- [ ] mixed repo 命令精度提升（自定义脚本识别）
- [ ] Go 验证命令按 module path 聚合（当前按目录聚合，子模块下可能不准）
- [ ] Rust 模块级测试过滤（需解析 `mod` 声明）
- [ ] **CLI 命令完整性补全**（投入：低 / 收益：中 / 风险：低）— 底层 `dep-tools` 的 `stats` / `dependents` / `dependencies` operation 未暴露为 CLI 命令；`searchCode`（symbol 搜索）也未暴露。评估后补充有价值的独立命令

### P3：提升输出可解释性
- [ ] **变更影响解释链**（投入：中 / 收益：高 / 风险：低）— 明确告知用户"因哪些 import/usage 推导出影响"，用于审核和调试误报
- [ ] **统一能力矩阵输出**（投入：低 / 收益：中 / 风险：低）— CLI JSON 直接带 language support matrix + confidence 解释，减少文档追赶成本

### P4：技术债
- [ ] Kotlin AST 级支持（当前 L2 regex；需处理 object/companion object/top-level fun）
- [ ] 大仓库性能专项优化（>10k 文件索引）
- [ ] **插件化解析器注册表**（投入：高 / 收益：中 / 风险：高）— 轻量注册表替代 if-else 链，保持 CLI-only，不引入协议层

---

## 设计原则

1. **CLI-only** - 不引入 MCP/协议层
2. **先减少误报，再增加功能** - 结果可信优先
3. **先识别主线，再做判断** - 混合仓库先过滤
4. **输出必须能指导动作** - 不是报告，是行动计划
5. **工程克制** - 函数 < 30 行，拒绝过度抽象

---

## 成功标准

1. 对混合仓库结果稳定（不误报）
2. TS/Python/前端项目都能给出可信主线结论
3. 能从"哪里可能有问题"推进到"该怎么改、改完测什么"
4. symbol-level impact 可用
5. 大仓库性能可接受（<30s 索引）

---

*Last updated: 2026-04-28*
