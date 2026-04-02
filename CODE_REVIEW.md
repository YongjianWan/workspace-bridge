# workspace-bridge 代码审查总览（执行版）

**范围**: 最近约 40 个提交（Phase 1 到 P2-1）  
**更新时间**: 2026-04-02  
**用途**: 总览级审查结论 + 可执行优先级，不记录过期待办。

---

## 1) 当前结论

- 架构方向是对的：CLI-only、模块化拆分、函数级分析落地。
- 质量趋势在变好：早期粗糙 -> M5重构 -> P2阶段稳定。
- 当前主要风险不在“功能缺失”，而在“工程一致性”：路径统一、错误处理统一、核心链路回归测试。

---

## 2) 审查状态面板

### 已完成（DONE）

1. `changedFunctions` 去重（函数级复用提示/测试映射）。
2. function-level test mapping 的 `via` 补充 `filePath#function`。
3. `symbol-impact` 降级分支结构对齐（含 `functionToDependents` 等字段）。

验证命令：

```bash
npm run test:audit-diff
npm run test:functionality
npm run test:analysis
```

### 待处理（OPEN）

1. 路径处理统一（全仓只保留一个规范化入口）。
2. 核心链路集成回归测试补齐（跨服务）。
3. Diagnostics checker 探测缓存。
4. 错误处理策略统一（禁止空 catch、统一错误输出结构）。

### 待复验（VERIFY）

1. 非 ASCII 路径/import 乱码问题（历史记录存在，需最新代码复验）。
2. mixed repo 组合下状态分支覆盖度（重点看 overview + audit-diff）。

---

## 3) 优先级任务清单

### P0（先做）

#### P0-1 路径处理统一

- 目标: 统一 key 生成，消灭路径格式分裂导致的缓存 miss/查询漏报。
- 涉及: `src/utils/path.js`, `src/services/file-index.js`, `src/services/dep-graph.js`, `src/tools/*`。
- 验收:
  1. 同一文件绝对/相对/反斜杠输入结果一致。
  2. Windows 大小写差异不造成重复索引或空查询。

#### P0-2 核心链路集成测试

- 目标: 固化“初始化 -> 索引 -> impact -> affected-tests -> audit-diff”全流程。
- 涉及: `test/functionality-test.js`, `test/analysis-test.js`, 新增 `test/integration-core-test.js`。
- 验收:
  1. 历史关键 bug 对应 case 常驻。
  2. PR 默认执行该测试组。

#### P0-3 非 ASCII 复验与修复

- 目标: 确认并修复中文路径/import 在 JS/TS/Python 链路的编码边界问题。
- 验收:
  1. 无乱码 symbol/path。
  2. unresolved 无伪误报。

---

### P1（随后）

#### P1-1 Diagnostics checker 缓存

- 目标: 减少重复 shell 探测开销。
- 验收: 同一会话重复调用不重复探测，行为保持一致。

#### P1-2 错误处理统一

- 目标: 统一抛错/返回策略，输出可定位。
- 验收: 同类错误格式一致，JSON 结果含 reason code。

#### P1-3 EditorState 去留决策

- 目标: 明确是否继续维护；不再维持“半实现状态”。
- 验收: 主链路完全不依赖 EditorState。

---

### P2（中期）

1. AST/regex fallback 收敛与行为一致性。
2. 缓存一致性模型增强（不仅靠 mtime+size）。
3. 性能基线和回归门槛（audit-summary/audit-diff）。

---

## 4) 风险点复核

### `buildCompositeRisk` 权重

- 当前评价: 可用，但仍需真实项目样本校正。
- 处理方式: 先观测再调参，避免拍脑袋改权重。

### `mapWithConcurrency` 错误隔离

- 当前评价: 是真实风险点。
- 处理方式: mapper 级别错误隔离 + 局部降级，不让单点失败击穿整体输出。

### `normalizeStem` 边界

- 当前评价: 需加用例复验（`contest.js` 等词尾误伤场景）。
- 处理方式: 先补测试，再改正则。

---

## 5) 执行建议

1. 先按 `P0-1 -> P0-2 -> P0-3` 顺序推进。
2. 每个任务单独 PR，避免混改。
3. 这个文档只保留“当前状态”，历史细节放到批次报告，不在这里重复展开。

---

*备注*: 详细历史证据在 `BATCH5_CODE_REVIEW.md`，本文件只做总览与执行面板。
