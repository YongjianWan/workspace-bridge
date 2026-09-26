# workspace-bridge Roadmap

目标：给本地 AI coding agent 提供可信的跨文件结构与变更验证建议。当前能力和工程约束见 [AGENTS.md](./AGENTS.md)，已完成事项只在 [CHANGELOG.md](./CHANGELOG.md)。

## 近期优先级

1. **真值评测**：按 [eval/README.md](./eval/README.md) 的固定版本重测 affected-tests、dead-exports、缓存性能。自动复现门禁通过后仍需验证真实仓库精确率和召回率。
2. **减少错误动作**：处理 [审查待处理项](./docs/workspace-bridge-审查报告.md) 中的 P0 误报、测试文件识别和验证命令选择。结果不确定时降置信度或显式警告。
3. **控制输出与资源成本**：测量大仓库缓存体积、冷启动和 JSON 输出大小，再决定是否调整图存储与默认输出。

## 当前已知限制

- 混合仓库的自定义目录角色需要 `.workspace-bridge.json` 标注；无配置时主线识别仍可能误报。
- 跨仓库 `api-contracts` 只适合路径级检查，字段级契约和 OpenAPI 生成客户端仍待验证。
- `--check-regression` 比较结构计数，不能代替内容级代码审查。
- 静态图不能可靠覆盖运行时注册、动态 `require`、依赖注入及 Vue kebab-case 组件绑定。此类结果必须保守标置信度。
- 超过 1 万文件的仓库、Windows 特有路径与打包行为仍缺系统评测。开放项见 [审查待处理项](./docs/workspace-bridge-审查报告.md)。

## 长期方向（先验证收益）

- 用包、模块、头文件与实现文件等“模块单位”补足纯文件节点模型；以真实仓库错边减少量验收。
- 评估可选 LSP 高精度查询，比较准确率、启动成本和维护负担，不作为默认依赖。
- 建立每个高频 CLI 命令的性能与结果回归基准，并评估便携预索引快照。
- 评估消除 `parse_results`、内存 `parseResults` 与图 Map 的重复存储；只有在真实大仓库测到内存和启动收益后才动数据层。

## 暂不做

- MCP 协议层、字段级数据流追踪、完整 call graph、把运行时语义猜测加入默认依赖图。项目坚持 CLI-only 和“结构分析不冒充语义分析”。
