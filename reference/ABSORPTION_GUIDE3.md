# Reference 代码吸收指南（第三轮）— 交叉创新

> 对 `code-review-graph` / `qartez-mcp` / `CodeGraphContext` / `GitNexus` 四项目的**交叉组合创新点**的深度探索总结。
> 评估日期：2026-05-19。与 [ABSORPTION_GUIDE.md](./ABSORPTION_GUIDE.md)（第一轮：核心算法+解析器+工程架构）和 [ABSORPTION_GUIDE2.md](./ABSORPTION_GUIDE2.md)（第二轮：算法深化+AST工程+测试架构）互补。
>
> **原则**：只吸收与 CLI-only + 轻量定位兼容的模式；单项目已覆盖的不重复。

---

## 总览：交叉创新矩阵

| 交叉编号 | 组合 | 来源 A | 来源 B | 交叉产物 | w-b 适配性 | 文档位置 |
|----------|------|--------|--------|----------|-----------|----------|
| **X1** | 自适应架构边界 | CRG 社区检测 (Leiden) | qartez 边界规则引擎 | 自动聚类 → 生成 glob 规则 → 检测违规 | ✅ 极高 | §1 |
| **X2** | 端到端请求路径 | CRG 数据流追踪 (Flow) | GitNexus 路由映射 (Route Map) | HTTP 入口 → Service 调用链 → DB 查询点 | ✅ 极高 | §2 |
| **X3** | 增量更新终极协议 | CRG SHA-256 增量 | CGC Neighbor-aware + qartez WAL Cadence | git diff → SHA 过滤 → 邻居更新 → WAL 节流 | ✅ 高 | §3 |
| **X4** | 安全热点排序 | qartez 安全规则引擎 | CRG Risk/Criticality 评分 | 漏洞 × 入口点暴露 × 耦合度 = 真实风险分 | ✅ 高 | §4 |
| **X5** | 符号解析置信飞轮 | CGC Pre-scan 全局映射 | GitNexus Query 分层协议 | Pre-scan 粗定位 → Query 精确捕获 → Tier 置信标注 | ✅ 中 | §5 |
| **X6** | 测试影响穿透 | CRG Co-change omissions | qartez 测试间隙多层信号 | "历史上同变但未改" + "字符串引用但未 import" | ✅ 中 | §6 |

---

## 一、自适应架构边界（X1：CRG × qartez）

### 1.1 单项目能力

**CRG 社区检测**（`communities.py`）：
- Leiden 算法封装，分辨率随图规模对数衰减
- `_compute_cohesion_batch`：O(edges) 批量内聚度计算
- igraph 不可用时按目录最长公共前缀 fallback 分组

**qartez 边界规则**（`src/graph/boundaries.rs`）：
- `BoundaryRule { from: glob, deny: [glob], allow: [glob] }`
- `check_boundaries`：预编译 glob → 遍历边 → allow 覆盖 deny
- `suggest_boundaries`：从 Leiden 聚类自动生成 starter 配置（"已有边不禁用"的保守策略）

### 1.2 交叉后

```
Step 1: CRG Leiden 自动聚类 → 生成目录前缀规则
        例：cluster-1 = src/auth/**, cluster-2 = src/payment/**
Step 2: 将"现有跨集群 import 边"冻结为 allow 列表
Step 3: 新增跨集群边触发边界违规 → 但已有 allow 的放行
Step 4: 想新增跨集群调用？必须显式改 .workspace-bridge/boundaries.json
```

**关键洞察**：qartez 明确选择**目录 glob** 而非 cluster ID 作为规则锚点，因为"cluster 在重索引时会变化，而目录结构变化是有意为之"。

### 1.3 w-b 行动

新增 `audit-boundaries` 命令：
- 读取 `.workspace-bridge.json` 中可选的 `boundaries[]` 字段
- 用 `minimatch` 匹配路径，遍历 import edges 做违规检测
- 无配置时，用目录层级聚类（2 层前缀）自动生成建议规则

---

## 二、端到端请求路径（X2：CRG × GitNexus）

### 2.1 单项目能力

**CRG 数据流追踪**（`flows.py`）：
- Entry point 三因子检测：无 incoming CALLS / 框架装饰器 / 命名约定
- `_trace_single_flow`：前向 BFS，max_depth=15，过滤单节点 trivial flow
- `_FRAMEWORK_DECORATOR_PATTERNS`：68 行覆盖 20+ 框架的正则表

**GitNexus 路由映射**（`pipeline-phases/routes.ts` + `api_impact`）：
- Route 节点 schema：`{ name(URL), filePath, responseKeys, errorKeys, middleware }`
- `HANDLES_ROUTE` 边：`File → Route`，confidence=1.0
- `api_impact`：改 handler 前报告影响哪些 API route
- 框架插件化：`HttpLanguagePlugin` 接口 + 扩展名注册表

### 2.2 交叉后

```
HTTP Route (GitNexus 提取)
    ↓ CALLS
Controller Method (CRG entry point)
    ↓ CALLS
Service Method
    ↓ CALLS
Repository / DB Query (GitNexus ORM 提取)
```

这是**单个参考项目都没有的垂直穿透能力**：
- CRG 有 flow tracing 但不知道哪些是 HTTP 路由
- GitNexus 有 route map 但不追踪内部调用链

### 2.3 w-b 行动

**L1 解析层**：`framework-patterns.js` 新增 `extractRoutesFromContent(filePath, content)`

```js
function extractRoutesFromContent(filePath, content) {
  const routes = [];
  // Express: app.get('/path', handler)
  const expressRe = /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  // Spring: @GetMapping("/path")
  const springRe = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\s*\(\s*["`]([^"`\)]*)["`]/gi;
  // FastAPI: @app.get("/path")
  const fastapiRe = /@(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*["`]([^"`]+)["`]\s*\)/gi;
  // ... 覆盖 9 种语言的主要 Web 框架
  return routes; // { framework, method, path, line }[]
}
```

**L2 存储层**：`dep-graph.js` `GraphBuilder.analyzeFile()` 在 graph node 中增加 `routes`

**L3 查询层**：`dep-graph.js` `GraphQuery.getImpactRadius()` 在 BFS `onVisit` 中附加 `affectedRoutes`

**L4 格式化层**：`human-formatters.js` 的 `case 'impact'` 渲染 `[GET] /users`

**预期输出**：
```json
{
  "impactCount": 3,
  "impact": [
    { "file": "src/controllers/user.js", "level": 1,
      "affectedRoutes": [{"method":"get","path":"/api/users","framework":"express"}] }
  ]
}
```

---

## 三、增量更新终极协议（X3：CRG × CGC × qartez）

### 3.1 单项目能力

**CRG SHA-256 增量**：git diff → `find_dependents(changed)` → 逐个 SHA-256 校验 → 跳过未变 dependent

**CGC Neighbor-aware**：变更前查 caller/inheritor → DETACH DELETE 变更文件 → 清理 caller 出边 → 仅重解析受影响子集

**qartez WAL Cadence**：`PASSIVE` checkpoint 每写批次 → `TRUNCATE` 每 60s；PageRank warm-start 每 30s 或 32 batches

### 3.2 交叉后：四层增量叠加

| 层级 | 来源 | 作用 | 时间量级 |
|------|------|------|----------|
| L1 git diff | 全部 | 找出变更文件 | 10ms |
| L2 SHA-256 过滤 | CRG | 排除内容未变的 dependent | 50ms |
| L3 Neighbor-aware | CGC | 只重解析 caller/inheritor | 100ms |
| L4 WAL Cadence | qartez | SQLite 写入不阻塞 + WAL 截断 | 后台 |

**单独实现任何一层都有漏洞**：
- 只有 L1：改一个 util，100 个 import 它的文件全重解析
- 只有 L1+L2：dependent 文件内容没变，但其 caller 的边已失效
- 只有 L1+L2+L3：频繁小改导致 WAL 膨胀，Windows 上 TRUNCATE 卡顿

### 3.3 w-b 行动

`cache.js` + `graph-db.js` 的演进路线图，按层渐进：
- P0：加入 `find_dependents` SHA-256 扩展（~30 行）
- P1：引入 Neighbor-aware 增量更新（~100 行）
- P2：加入 WAL Cadence 状态机（~50 行）

---

## 四、安全热点排序（X4：qartez × CRG × GitNexus）

### 4.1 单项目能力

**qartez 安全规则引擎**：13 条内置规则（OWASP），`severity_weight × file_pagerank × (1 + is_exported)` 排序，集中式白名单分派表

**CRG Risk/Criticality**：5 因子加权（file_spread, external_score, security_score, test_gap, depth_score）

**GitNexus entryPointMultiplier**：入口点文件 hotspot 评分加权 1.5x–3.0x

### 4.2 交叉后

```
qartez: SEC001 (hardcoded secret) 命中 src/auth/token.js
GitNexus: token.js 是 entryPoint (路由处理器) → entryPointWeight = 3.0
CRG: token.js 的 PageRank 是 top 5%
        ↓
CRG Risk Score: security_score(0.25) + entry_point_boost(0.20) + high_coupling(0.15) = 6.0/10
```

### 4.3 w-b 行动

`security-tools.js` 当前是硬编码规则。引入 qartez 的**集中式白名单分派表** + **Assert Defense 机制**：
- `is_match_allowlisted(ruleId, match, filePath, symbolName)` — 每个规则独立白名单函数
- Assert Defense：测试函数内 `.unwrap_err()` / `expect(error)` 匹配到的 payload 视为防御性测试，抑制误报
- 风险分 = `severity_weight × pageRank × (1 + isExported)`

---

## 五、符号解析置信飞轮（X5：CGC × GitNexus × CRG）

### 5.1 单项目能力

**CGC Pre-scan**：正式解析前，轻量 query 提取所有文件顶层定义名 → `imports_map = {symbol_name: [file_path]}`

**GitNexus Query 分层捕获协议**：`@declaration.* → @import.* → @type-binding.* → @reference.*`，锚点与辅助捕获分离

**CRG Confidence Tier**：9 级置信度（explicit this/self → local → FQN import → short-name fallback → ...）

### 5.2 交叉后

```
Phase 0: CGC Pre-scan 粗定位
         "hash_password" → [src/utils/password.py, src/legacy/hash.py]
Phase 1: GitNexus Query 精确捕获
         调用点: `hash_password(password)` → receiver type = None (free call)
Phase 2: CRG Tier 置信标注
         same-file → Tier 2 (0.95)
         imported + FQN → Tier 3 (0.88)
         unique short name → Tier 5 (0.90)
         alphabetical-first of multiple → Tier 8 (0.25)
```

### 5.3 w-b 行动

`resolvers.js` 当前是基于 import 路径的字符串匹配。引入 tier 系统：
1. Pre-scan 阶段：对所有文件跑轻量 query，构建全局 `symbol → [file]` 映射
2. 解析阶段：对每个未解析符号，查 pre-scan 映射 → 按 tier 规则排序候选
3. 输出：每条边附 `confidence` + `tier` + `resolutionMethod`

---

## 六、测试影响穿透（X6：CRG × qartez）

### 6.1 单项目能力

**CRG Co-change omissions**：历史上同变但未在本次 diff 中的文件，单独列出

**qartez 测试间隙四层信号**：
1. Import edge（测试 import 源文件）
2. Inline tests（`#[cfg(test)]`）
3. FTS body fallback（测试文件 body 提及源文件 module stem）
4. Dispatcher regex（`call_tool_by_name("tool_name")` 字符串分发）

### 6.2 交叉后

```
CRG: "src/auth.js 历史上同变的文件有 test/auth.test.js"
qartez: "test/auth.js 没有 import src/auth.js，
         但 FTS body 提及 'authenticate'，
         且 dispatcher regex 匹配到 call_tool_by_name('authenticate')"
        ↓
affected-tests: 即使无 import 边，也提示"测试可能通过字符串引用"
```

### 6.3 w-b 行动

`affected-tests` 引入 qartez 的**Dispatcher Regex** + **FTS Stem Mention** 回退：
- Dispatcher regex：`call_tool_by_name\(\s*"([A-Za-z_][A-Za-z0-9_]*)"` 捕获工具名分发
- Stem mention：搜索测试文件内容是否包含源文件的模块 stem（如 `auth` → `auth.test.js`）
- 已有 import 边的不再重复计数（`seen` set 去重）

---

## 七、单项目未被覆盖的高价值模式（qartez 独占）

### 7.1 Bus Factor / 知识分布

**来源**：`qartez/src/git/knowledge.rs`

- 逐文件 `git blame` + `mailmap` 作者去重
- Bus factor = 覆盖 >50% 代码行所需的最少作者数（`div_ceil(2)`）
- Module 级 rollup：按父目录聚合，统计 `single_author_files`

**w-b 适用性**：`audit-overview` 新增 `knowledgeRisk` 维度，标识"只有一个人懂的文件"。

### 7.2 复杂度趋势分析

**来源**：`qartez/src/git/trend.rs`

- `git revwalk` 拓扑+时间排序遍历 commit
- 对每个 commit 检出文件内容，tree-sitter 重新解析，记录各符号 CC 和行数
- 输出：`GROWING / SHRINKING / STABLE`（阈值 ±10%）

**w-b 适用性**：`health-tools.js` 扩展长期趋势（"哪个函数过去一个月 CC 暴涨"）。

### 7.3 Flat Dispatcher 分类

**来源**：`qartez/src/server/tools/smells.rs`

- **Path 1 (Tight)**：`arms >= 6` 且 `cc <= arms + 5` — 典型平铺 match/switch
- **Path 2 (Dominant)**：`arms >= 12` 且 `arms >= cc × 0.4`
- `count_match_arms`：行级代理，扫描 `=>` 箭头，跟踪字符串状态排除误报

**w-b 适用性**：对 JS `switch(action.type)` / Python `if-elif` 链同理适用。

---

## 八、行动清单（按 ROI 排序）

| 优先级 | 交叉/模式 | 目标文件 | 成本 | 预期收益 |
|--------|-----------|----------|------|----------|
| **P0** | X2 端到端请求路径（路由提取） | `framework-patterns.js` / `dep-graph.js` | 低 | impact 输出增加 affectedRoutes，改 handler 知道影响哪些 API |
| **P0** | X4 安全白名单分派表 + Assert Defense | `security-tools.js` | 低 | 安全审计误报率大幅下降 |
| **P1** | X1 自适应架构边界 | 新增 `audit-boundaries` | 中 | Monorepo 跨包违规检测 |
| **P1** | X6 测试间隙穿透（Dispatcher Regex） | `affected-tests` | 低 | 测试映射覆盖率提升 |
| **P1** | 7.1 Bus Factor | `overview-tools.js` | 低 | 识别知识孤岛 |
| **P2** | X3 增量更新终极协议 | `cache.js` / `graph-db.js` | 中 | 大图增量 <50ms |
| **P2** | X5 符号解析置信飞轮 | `resolvers.js` / `file-index.js` | 中 | import 解析准确率提升 |
| **P2** | 7.2 复杂度趋势 | `health-tools.js` | 中 | 长期代码健康信号 |
| **P3** | 7.3 Flat Dispatcher | 新增 `audit-smells` | 中 | 代码质量信号 |

---

## 附录：各项目剩余可探索文件清单

若未来需要继续深挖，以下文件仍未被三轮指南覆盖：

### code-review-graph
- `tools/context.py` — Token 削减的极简上下文实现细节
- `tools/build.py:_compute_summaries` — 预计算聚合查询
- `skills.py` — 平台自动检测（400 行）

### qartez-mcp
- `src/server/cache.rs` — ParseCache LRU 细节
- `src/server/tiers.rs` — Progressive Disclosure 工具分层
- `src/benchmark/report.rs` — 结构化 Benchmark 报告 + 回归检查

### CodeGraphContext
- `core/cgcignore.py` — 自定义忽略规则引擎
- `cli/setup_wizard.py` — 交互式设置向导（992 行）
- `core/cgc_bundle.py` — `.cgc` 格式导出/导入（858 行）

### GitNexus
- `docs/guides/microservices-grpc.md` — 微服务+gRPC 跨服务影响分析
- `src/core/group/cross-impact.ts` — Contract Bridge 跨包影响传播
- `src/core/ingestion/pipeline-phases/orm.ts` — ORM 查询边提取

---

*本指南由 4 个并行 explore agent 深度挖掘后，由中枢 agent 综合整理。如需对某个具体交叉方向做 POC 验证或代码移植，可针对对应组合启动 focused 子任务。*
