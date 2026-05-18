# Reference 代码吸收指南（第二轮）

> 对 `code-review-graph` / `qartez-mcp` / `CodeGraphContext` / `GitNexus` 的**剩余算法、AST/Query 工程、测试架构、CLI UX、可观测性**的深度探索总结。
> 评估日期：2026-05-19。与 [ABSORPTION_GUIDE.md](./ABSORPTION_GUIDE.md) 互补，聚焦第一轮未覆盖的方向。
>
> **原则**：只吸收与 CLI-only + 轻量定位兼容的模式；重型依赖（ONNX/图数据库/常驻进程）明确拒绝。

---

## 总览：按 ROI 排序的第二轮行动清单

| 优先级 | 模式 | 来源 | 目标文件 | 成本 | 预期收益 |
|--------|------|------|----------|------|----------|
| **P0** | 死代码过滤链（15+ 条排除规则） | CRG | `dead-exports` | 中 | 误报率大幅下降 |
| **P0** | 安全规则引擎（层次 A 配置化 + 层次 B AST 轻量） | qartez | `security-tools.js` | 低 | 可扩展的安全审计 |
| **P0** | 架构边界检测（glob 规则引擎） | qartez | 新增 `audit-boundaries` | 低 | 架构违规检测 |
| **P0** | Query 错误恢复（per-file try/catch） | GitNexus | `parsers/*.js` | 极低 | 分析流程不中断 |
| **P0** | PhaseTimer 多阶段计时 | GitNexus | `container.js` / `cli.js` | 极低 | 性能瓶颈可观测 |
| **P1** | 数据流追踪（入口点 + BFS + Criticality） | CRG | `dep-graph.js` / `impact` | 中 | 路径级影响分析 |
| **P1** | 社区检测 + Cohesion Batch O(edges) | CRG | `audit-overview` | 中 | 模块级耦合洞察 |
| **P1** | Tree-sitter Query 分层捕获协议 | GitNexus | `parsers/` | 中-high | 跨语言统一解析输出 |
| **P1** | AST Tree 缓存 + WASM delete | GitNexus | `tree-sitter.js` | 低 | 消除 WASM 内存泄漏 |
| **P1** | 测试间隙多层覆盖信号 | qartez | `affected-tests` | 低 | 测试映射准确率提升 |
| **P1** | CLI 错误分类 + 可操作建议 | GitNexus/qartez | `cli.js` | 低 | 用户体验提升 |
| **P1** | 回归测试档案（fp_regression_*.js） | qartez | `test/` | 低 | 误报不复发 |
| **P2** | 代码异味检测（God Function / flat_dispatcher） | qartez | 新增 `audit-smells` | 中 | 代码质量信号 |
| **P2** | Pre-scan 全局符号映射 | CGC | `file-index.js` | 中 | import 解析准确率提升 |
| **P2** | SQLite pragma 调优（WAL + mmap + temp_store） | qartez | `graph-db.js` | 极低 | 查询性能提升 |
| **P2** | Token Budget 裁剪 | qartez | `formatters/` | 低 | 大文件输出可控 |
| **P2** | 路径参数安全清洗 | qartez | `cli.js` / `path.js` | 低 | 防路径注入 |
| **P3** | 代码克隆检测（Shape Hash） | qartez | 未来扩展 | 中 | 近似重复代码检测 |
| **P3** | Worker Pool 并行解析 | GitNexus | `file-index.js` | 中-high | 大项目解析加速 |
| **P3** | 项目根自动发现 + Workspace 扩展 | qartez | `path.js` | 中 | Monorepo 支持 |
| **P3** | 4-Tier Progressive Disclosure | qartez | `cli.js` / `SKILL.md` | 低 | 命令分层清晰 |
| **—** | Daemon / 常驻进程 | CRG/qartez | — | — | **明确拒绝** |
| **—** | 重构写操作（rename/move/safe_delete） | qartez | — | — | **明确拒绝**（只读 CLI） |

---

## 一、算法深化（第一轮未覆盖的模块）

### 1.1 死代码过滤链 — 极度防御性排除（code-review-graph）

**来源文件**：`code_review_graph/refactor.py:find_dead_code()`（240–567 行）

**核心逻辑**：15+ 条按顺序执行的排除规则，业界最成熟的静态死代码过滤策略：

```python
def find_dead_code(store, include_tests=False):
    candidates = store.get_all_exported_symbols()
    
    # 1. 测试文件/节点
    candidates = [c for c in candidates if not is_test_path(c.file_path)]
    # 2. .d.ts 环境声明
    candidates = [c for c in candidates if not c.file_path.endswith('.d.ts')]
    # 3. dunder 方法 (__x__)
    candidates = [c for c in candidates if not _DUNDER_RE.match(c.name)]
    # 4. JS/TS constructor
    candidates = [c for c in candidates if c.name != 'constructor']
    # 5. mock/stub 变量
    candidates = [c for c in candidates if not _MOCK_NAME_RE.match(c.name)]
    # 6. 框架装饰器/命名入口点
    candidates = [c for c in candidates if not _has_framework_decorator(c)]
    # 7. 类型注解引用的 Class
    candidates = [c for c in candidates if not _is_type_reference(c)]
    # 8. Angular/NestJS 装饰器 Class
    candidates = [c for c in candidates if not _is_framework_controller(c)]
    # 9. ORM/Pydantic/CDK 基类继承
    candidates = [c for c in candidates if not _inherits_framework_base(c)]
    # 10. @property/@abstractmethod/@classmethod/@staticmethod/@dataclass
    candidates = [c for c in candidates if not _has_special_decorator(c)]
    # 11. 覆盖基类 abstractmethod 的方法
    candidates = [c for c in candidates if not _overrides_abstract(c)]
    # 12. Plausible caller 启发式
    candidates = [c for c in candidates if _is_plausible_caller(c, import_graph)]
    # 支持 2-hop barrel 文件传递（consumer → index.ts → utils.ts）
```

**关键洞察**：
- `_is_plausible_caller`：裸名 CALLS 边只有在"同文件"或"importer 链可达"时才算有效调用
- 2-hop barrel 文件传递：通过 `index.ts` 等 barrel 文件间接引用也算有效
- `REFERENCES` 边：函数作为值被引用（如 map dispatch、回调注册）也保留

**workspace-bridge 现状**：`dead-exports` 误报率极高（AGENTS.md 已承认），尤其 Java Spring DI 类、Go exported 函数、Python `__init__.py` 符号。

**行动**：将过滤链翻译为 `dead-exports` 的后处理过滤器，优先级高于新增语言支持。

---

### 1.2 数据流追踪 — 入口点 + BFS + Criticality（code-review-graph）

**来源文件**：`code_review_graph/flows.py`

**A. 入口点检测（三因子 OR）**：

```python
def detect_entry_points(store):
    called_qnames = store.get_all_call_targets()
    for node in candidate_nodes:
        # 1. 真根：无 incoming CALLS
        if node.qualified_name not in called_qnames: is_entry = True
        # 2. 框架装饰器（68 行覆盖 20+ 框架的正则表）
        if _has_framework_decorator(node): is_entry = True
        # 3. 命名约定（main、test_、on_、handle_、upgrade/downgrade、ngOnInit）
        if _matches_entry_name(node): is_entry = True
```

**B. 前向 BFS 追踪**：

```python
def _trace_single_flow(adj, entry_point, max_depth=15):
    visited = {entry_point.qualified_name}
    queue = deque([(entry_point.qualified_name, 0)])
    while queue:
        current_qn, depth = queue.popleft()
        for target_qn in calls_out.get(current_qn, ()):
            if target_qn in visited: continue
            visited.add(target_qn)
            queue.append((target_qn, depth + 1))
    if len(path_ids) < 2: return None  # 过滤单节点 trivial flow
```

**C. Criticality 五维评分**（已在 ABSORPTION_GUIDE 中记录，此处补充增量更新协议）：

```python
# 增量流追踪：文件变更时只重算受影响流
def incremental_trace_flows(store, changed_files):
    # 1. 通过 flow_memberships JOIN nodes 找受影响的 flow IDs
    affected_flow_ids = store.get_affected_flow_ids(changed_files)
    # 2. 删除 affected flows
    store.delete_flows(affected_flow_ids)
    # 3. 重新检测 entry points（只保留 changed_files 中的或旧的）
    # 4. BFS 重追踪，INSERT 新 flows（不清无关 flows）
```

**复用价值**：**高**。workspace-bridge `impact` 只回答"谁依赖我"，不回答"从入口点出发会经过哪些路径"。`_FRAMEWORK_DECORATOR_PATTERNS`（68 行）是极高 ROI 的资产，可直接翻译为 JS 正则数组。

---

### 1.3 社区检测 + Cohesion Batch O(edges)（code-review-graph）

**来源文件**：`code_review_graph/communities.py`

**A. Leiden 算法封装**（igraph 可选依赖）：

```python
def _detect_leiden(nodes, edges, min_size):
    # 分辨率随图规模对数衰减，避免 30k+ 节点产生数千碎片
    resolution = max(0.05, 1.0 / math.log10(max(n_nodes, 10)))
    partition = g.community_leiden(
        objective_function="modularity",
        weights="weight",
        resolution=resolution,
        n_iterations=2,  # 刻意限制为 2，避免子社区分裂指数爆炸
    )
```

**B. 批量内聚度计算 `_compute_cohesion_batch`**（O(edges) 优化）：

```python
def _compute_cohesion_batch(community_member_qns, all_edges):
    qn_to_idx = {}
    for idx, members in enumerate(community_member_qns):
        for qn in members:
            qn_to_idx[qn] = idx
    internal = [0] * n
    external = [0] * n
    for e in all_edges:
        sc = qn_to_idx.get(e.source_qualified)
        tc = qn_to_idx.get(e.target_qualified)
        if sc == tc and sc is not None:
            internal[sc] += 1
        else:
            if sc is not None: external[sc] += 1
            if tc is not None: external[tc] += 1
    return [internal[i] / (internal[i] + external[i]) for i in range(n)]
```

**C. 目录 Fallback 分组**（igraph 不可用时）：
按文件路径最长公共前缀后的目录深度自适应分组，迭代增加深度直到产生 10–200 个 qualifying groups。

**复用价值**：高。`audit-overview` 目前只有 hotspot 和 cycle，缺少"模块/社区级耦合洞察"。`_compute_cohesion_batch` 可直接移植到 `dep-graph.js` 的内存 Map。

---

### 1.4 架构边界检测（qartez-mcp）

**来源文件**：`src/graph/boundaries.rs`

**核心逻辑**：

```rust
pub struct BoundaryRule {
    pub from: String,   // 源路径 glob
    pub deny: Vec<String>,  // 禁止导入的目标路径 glob 列表
    pub allow: Vec<String>, // 跨域例外列表（覆盖 deny）
}

pub fn check_boundaries(config, files, edges) -> Vec<Violation> {
    // 遍历所有文件级 import edge，按规则顺序匹配
    // allow 覆盖 deny，输出确定性排序的违规列表
}
```

**自动生成 starter config**：基于 Leiden 聚类结果，对每个集群找出最长公共目录前缀（≥2 层），生成 `from = "prefix/**"` 规则；`deny` 列表包含"当前 edge 图中不存在跨集群连接"的其他集群前缀——即"冻结现有架构"。

**workspace-bridge 行动**：读取 `.workspace-bridge/boundaries.json`，用 `minimatch` 匹配路径，遍历 import edges 做违规检测。自动生成可用目录层级聚类（无需 Leiden）。

---

### 1.5 安全规则引擎（qartez-mcp）

**来源文件**：`src/server/tools/security.rs` + `src/graph/security.rs`

**核心架构**：

```rust
// 层次 A：配置化规则
pub struct SecurityRule {
    pub id: String,           // "SEC001"
    pub name: String,
    pub severity: Severity,
    pub category: String,     // "secrets"/"injection"/"crypto"
    pub pattern: Pattern,     // BodyRegex | SymbolName | SignatureRegex
    pub languages: Vec<String>,
}

// 层次 B：AST 轻量辅助（#[cfg(test)] 块检测）

// 风险分 = severity_weight * pagerank * (1 + is_exported)
// 高影响力文件的漏洞优先展示
```

**高级降噪机制**（误报控制精华）：

| 规则 ID | 白名单逻辑 |
|---------|-----------|
| SEC001 (hardcoded-secret) | 值是环境变量间接引用（`$VAR`、`process.env`）则放行 |
| SEC004 (command-injection) | `Command::new("git")` 且 args 链无 `format!` 则放行 |
| SEC007 (insecure-http) | `localhost`、`127.x`、单标签内网名则放行 |
| SEC008 (unsafe-block) | 有白名单注释则放行 |

- **Assert defense 过滤**：测试函数内的 `.is_err()`、`.unwrap_err()` 匹配到的攻击 payload 视为防御性测试
- **Self-skip**：扫描器自动跳过自身文件（避免正则字面量自引用 noise）

**TOML 自定义配置**：

```toml
disable = ["SEC009", "SEC012"]
[[rule]]
id = "SEC014"
name = "custom-rule"
severity = "high"
category = "compliance"
pattern = "(?i)TODO.*audit"
```

**workspace-bridge 现状**：AGENTS.md 已明确"规则引擎（层次 A 配置化 + 层次 B AST 轻量）是未来的自研扩展方向"。qartez 的 `SecurityRule` + `CompiledRule` + `is_match_allowlisted` 架构正是该方向的完整参考。

---

### 1.6 代码异味检测（qartez-mcp）

**来源文件**：`src/server/tools/smells.rs`

**三种可配置异味**：

1. **God Function**：CC ≥ threshold AND 行数 ≥ threshold。进一步区分为 **flat_dispatcher**（平铺 match/switch 表）：
   ```rust
   const FLAT_DISPATCHER_MIN_ARMS: u32 = 6;
   const FLAT_DISPATCHER_CC_SLACK: u32 = 5;
   const FLAT_DISPATCHER_ARM_FRACTION: f64 = 0.4;
   // 路径1（紧）：arms ≥ 6 && cc ≤ arms + 5
   // 路径2（主导）：arms ≥ 12 && arms ≥ cc * 0.4
   ```

2. **Long Parameters**：`count_signature_params(sig)` 正确处理嵌套泛型 `<>` 和嵌套括号：
   ```rust
   fn count_signature_params(sig: &str) -> usize {
       // 找到匹配括号对，再按逗号分割，跳过 angle bracket 和 paren 深度 > 0 的逗号
   }
   ```

3. **Feature Envy**：多层降噪，包括 **Trait dispatch 抑制**——若方法名在 ≥3 个类型上实现，视为 trait 方法，不判定为 envy。

**复用价值**：高。`count_signature_params` 可直接用于签名展示。flat_dispatcher 分类对"何时不建议 Extract Method"极有价值。

---

### 1.7 测试间隙多层覆盖信号（qartez-mcp）

**来源文件**：`src/server/tools/test_gaps.rs`

**四层覆盖信号**：

```rust
pub struct FileCoverage {
    pub direct_test_paths: Vec<String>,      // import edge 指向
    pub inline_rust_tests: bool,             // 源文件自身含 #[cfg(test)]
    pub stem_mentioned_in_tests: Vec<String>, // FTS body fallback
}
```

1. **Import edge**：test 文件通过 import edge 指向 source 文件
2. **Inline tests**：源文件自身含测试块
3. **FTS body fallback**：当 import edge 无法解析时，回退到全文搜索测试文件 body 是否提及 source 文件的模块 stem
4. **Dispatcher regex 增强**：`call_tool_by_name\(\s*"([A-Za-z_][A-Za-z0-9_]*)"` 匹配测试中的字符串工具名，映射回源文件

**workspace-bridge 行动**：`affected-tests` 可引入 FTS body fallback 和 dispatcher regex，降低"测试文件通过字符串引用源文件导致的漏报"。

---

### 1.8 趋势分析（qartez-mcp）

**来源文件**：`src/git/trend.rs`

**核心逻辑**：用 `git log` walk 找出最近 N 个触及某文件的 commit；对每个 commit 检出文件内容，用 tree-sitter 重新解析并记录各符号的 CC 和行数。

```rust
pub struct SymbolTrend {
    pub symbol_name: String,
    pub points: Vec<TrendPoint>,  // 按时间顺序
}
pub struct TrendPoint {
    pub commit_sha: String,
    pub commit_summary: String,
    pub complexity: u32,
    pub line_count: u32,
}
```

输出分类：`GROWING / SHRINKING / STABLE`（阈值 ±10%），并做 token-budget 截断。

**复用价值**：中。workspace-bridge 已有 git 历史接入（co-change），趋势分析是自然的延伸。"哪个函数在过去一个月 CC 暴涨"极具行动指导价值。

---

## 二、AST / Query 工程

### 2.1 Tree-sitter Query 分层捕获协议（GitNexus）

**来源文件**：`gitnexus/src/core/ingestion/languages/typescript/query.ts`（897 行）

**核心设计**：

```typescript
// 跨语言捕获命名约定：@scope.* → @declaration.* → @import.* → @type-binding.* → @reference.*
const TYPESCRIPT_SCOPE_QUERY = `
  (method_definition
    name: (property_identifier) @declaration.name
  ) @declaration.method
  
  (import_statement
    source: (string) @import.source
  ) @import.statement
  
  // ... 120+ 个模式
`;
```

**关键设计决策**：
- **锚点与辅助捕获分离**：`@declaration.method` 是锚点（决定匹配范围），`@declaration.name` 是辅助捕获（提取名称）
- **TSX 查询后缀拼接**：`TSX_JSX_QUERY_SUFFIX` 动态扩展基础查询，`.ts` 和 `.tsx` 共用 90% 模式
- **懒加载单例**：`getTsParser()` 和 `getTsScopeQuery()` 缓存 `Parser` 和 `Query` 实例

**workspace-bridge 现状**：w-b 当前使用 regex + 手动 AST visitor（`js.js` 用 babel parser），没有统一的跨语言查询层。

**行动**：引入「分层捕获协议」让 9 种语言解析输出统一为 `CaptureMatch[]`，大幅降低 `dep-graph.js` 的 language-specific 分支。成本：每种语言约 50–150 行 query。

---

### 2.2 Query + Visitor 混合策略（GitNexus）

**来源文件**：`gitnexus/src/core/ingestion/languages/typescript/captures.ts`

**核心原则**：

| 技术 | 适用域 | 原因 |
|------|--------|------|
| **Query** | 固定 AST 形状的模式匹配、批量提取同类节点 | C 核心执行，O(树大小)，高度优化 |
| **Visitor** | 需父/兄弟节点上下文、遍历合成新捕获、计算派生属性 | 灵活性更高，但速度取决于遍历实现 |

**混合示例**：
- 80% 结构（scope、declaration、import、reference）由 query 提取
- object destructuring (`const { field } = rhs`)、for-of Map tuple bindings、instanceof narrowing 等由 visitor 合成额外 `CaptureMatch`
- 合成捕获通过 `syntheticCapture()` 生成，与 query 捕获保持同样接口

**不应移植的模式**：CRG 的纯 Visitor 6829 行模式——与 w-b「减少语言特定代码」的 L2-7 品味标准冲突。

---

### 2.3 Query 错误恢复（GitNexus）

**来源文件**：`gitnexus/src/core/ingestion/parsing-processor.ts`

**核心逻辑**：每个文件的 query 编译和执行都包在 `try/catch` 里：

```typescript
try {
    query = new Parser.Query(language, queryString);
    matches = query.matches(tree.rootNode);
} catch (queryError) {
    console.warn(`Query error for ${file.path}:`, queryError);
    continue;  // 单文件失败不阻断整体扫描
}
```

**复用价值**：高。w-b 当前 parser 如果 throw 会直接中断整个分析流程。

**移植成本**：极低。只需在 `parsers/*.js` 的 parse 循环中添加 `try/catch continue`。

---

### 2.4 AST Tree 缓存 + WASM 单所有权（GitNexus）

**来源文件**：`gitnexus/src/core/ingestion/ast-cache.ts`

**核心设计**：

```typescript
const cache = new LRUCache<string, Parser.Tree>({
    max: 50,
    dispose: (tree) => {
        try {
            (tree as unknown as { delete?: () => void }).delete?.();
        } catch (e) {
            console.warn('Failed to delete tree from WASM memory', e);
        }
    },
});
```

**关键洞察**：
- 明确区分 **native tree-sitter**（GC 管理，delete 是 no-op）和 **web-tree-sitter**（需手动 `tree.delete()`）
- 「单所有权不变量」：一个 `Parser.Tree` 引用最多只能存在于一个会 dispose 的 cache 中
- 跨 phase cache（`scopeTreeCache`）和 chunk-local cache（`astCache`）不能同时 dispose 同一个 Tree 引用

**workspace-bridge 现状**：`tree-sitter.js` 的 `languageCache` 有 LRU eviction 并调用 `oldLang.delete()`，但**没有对 Tree 对象做生命周期管理**。

**行动**：在 `tree-sitter.js` 中引入 `LRUCache` 管理 `Tree` 对象，并确保 `delete()` 被调用。

---

### 2.5 可选语言降级加载（GitNexus）

**来源文件**：`gitnexus/src/core/tree-sitter/parser-loader.ts`

**核心逻辑**：C grammar 因历史 ABI 不兼容被标记为 `optional: true`，加载失败时记录 error 但不抛出，其他语言继续正常工作。

```typescript
if (severity === 'error' && optional) {
    console.error(`Failed to load ${language}, but it's optional. Continuing...`);
    return null;
}
```

**workspace-bridge 行动**：在 `registry.js` 的 `condition` 检查基础上，增加 `try/catch` 包装每个 parser 的初始化，避免单一语言加载失败导致整个分析崩溃。

---

### 2.6 Pre-scan 全局符号映射（CodeGraphContext）

**来源文件**：`src/codegraphcontext/tools/languages/python.py:pre_scan_python()`

**核心逻辑**：正式解析前，先对所有文件做一次轻量扫描，只提取顶层定义名：

```python
def pre_scan_python(files, parser_wrapper) -> dict:
    imports_map = {}
    query = "(class_definition name: (identifier) @name) (function_definition name: (identifier) @name)"
    for path in files:
        tree = parser_wrapper.parser.parse(...)
        for capture, _ in execute_query(...):
            name = capture.text.decode('utf-8')
            imports_map.setdefault(name, []).append(str(path.resolve()))
    return imports_map
```

**复用价值**：高。w-b `resolvers.js` 解析 import 路径时，对于未解析的符号缺乏「全局符号表」辅助。引入 pre-scan 可显著提升 Python/Java/Go 等语言的跨文件解析准确率。

**行动**：在 `dep-graph.js` 构建流程中加入「Phase 0: Pre-scan」，对每个语言先用一个轻量 query 提取顶层定义名，存入 SQLite cache。

---

### 2.7 tree-sitter 原生增量解析的「零利用」现状

**发现**：四个项目中**没有任何一个**使用 tree-sitter 的原生增量编辑解析（`tree.edit()` + `parser.parse(oldTree)`）。

**原因**：
- CRG/CGC：文件粒度分析，全量重解析成本已足够低（<200ms/千文件）
- GitNexus：worker pool 并行解析 + chunk 策略（20MB/chunk），全量重解析被掩盖
- 增量编辑 API 需要精确的 byte-range edit 描述，从 git diff 获取变更需额外的 diff-to-edit 转换层

**结论**：w-b 的 CLI 场景是「一次性分析整个工作区」，不是「IDE 实时编辑」。tree-sitter 增量解析的 ROI 在 CLI 场景下很低，**不应投入**。

---

## 三、工程架构

### 3.1 测试策略

#### A. Fixture 工厂 + 真实子项目矩阵（CodeGraphContext / CRG）

**CGC 模式**：`tests/fixtures/sample_projects/` 下 20+ 个真实语言子项目，每个都是完整可编译的最小项目。

**CRG 模式**：内存中图数据库 + 程序化 seed，在 `setup_method` 中手动构建多层架构的图。

**qartez 模式**：纯代码内联 fixture + `Connection::open_in_memory()` + `tempfile::TempDir`。

```rust
fn setup() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    schema::create_schema(&conn).unwrap();
    conn
}
fn make_commit(repo, dir, files, message) {
    // 写文件 → add → write tree → commit
}
```

**workspace-bridge 行动**：
1. 多用内存 SQLite + 工厂函数，减少对真实 git 仓库的依赖
2. 建立 `test/fixtures/sample_projects/` 目录，为 9 种语言各维护一个最小项目
3. git 相关测试用临时仓库 + 辅助函数快速构造历史

---

#### B. 回归测试档案（qartez `fp_regression_*.rs`）

**核心模式**：每次误报修复固化为独立回归测试文件，命名 `fp_regression_<日期>_<主题>.rs`。

```rust
// 注释详细说明：错误现象、根因、修复方式
// populate_unused_exports checks BOTH file-level edges AND symbol_refs.
// But get_unused_exports_page fallback only checks file-level edges,
// MISSING the symbol_refs condition.
#[test]
fn test_unused_exports_fallback_must_respect_symbol_refs() { ... }
```

**workspace-bridge 行动**：建立 `test/regression-<issue>-<描述>.js` 命名规范，AGENTS.md 规定"修复误报必须先写回归测试"。

---

#### C. 全命令覆盖的 CLI 集成测试（qartez）

**核心模式**：对每个 CLI 子命令调用 `cli_runner::run` 验证不 panic，并特别测试**参数对齐**——防止 CLI 参数与内部工具函数参数漂移。

```rust
#[test]
fn cli_clones_accepts_min_lines_limit_offset() {
    let cmd = Command::Clones { min_lines: Some(5), limit: Some(3), offset: Some(1), ... };
    assert!(cli_runner::run(&config, &cmd, OutputFormat::Compact).is_ok());
}
```

**workspace-bridge 行动**：w-b 需要把 `cli.js` 中命令处理逻辑抽出可测试的 `runCommand(config, command)` 入口（当前与 `process.argv` 解析耦合较深）。

---

#### D. 测试分层（CodeGraphContext）

```
unit/           → 单个 parser、单个工具函数
integration/    → CLI 命令组合、MCP server 响应
e2e/            → 完整用户旅程（subprocess 调用真实 CLI）
perf/           → mock 1000 个文件测循环 overhead
```

**workspace-bridge 现状**：单元测试 97 文件（83%），集成测试 24 文件（20%），E2E 仅 3 文件（3%）。

**行动**：增加 E2E 测试（`child_process.spawn('node', ['cli.js', ...])`），标记 `@slow` 或放入 `test/slow/` 目录。

---

### 3.2 并发与性能模型

#### A. Worker Pool 的"作业拆分 + 超时回退 + Worker 替换"（GitNexus）

**来源文件**：`gitnexus/src/core/ingestion/workers/worker-pool.ts`

**三层防御**：
1. **子批次拆分**：按 `maxItems`（1500）和 `maxBytes`（8MB）限制分块
2. **空闲超时 + 指数退避**：超时后二分拆分作业重新排队；单文件超时则重试
3. **Worker 替换**：超时后认为 worker stuck，终止旧 worker 并 spawn 新 worker

```typescript
const requeueAfterTimeout = (workerIndex, job, lastProgress): boolean => {
    if (job.items.length > 1) {
        const midpoint = Math.ceil(job.items.length / 2);
        jobs.unshift(first, second);
        return true;
    }
    if (nextAttempt <= maxTimeoutRetries) {
        jobs.unshift({ ...job, attempt: nextAttempt, timeoutMs: nextTimeout });
        return true;
    }
    return false; // 最终失败
};
```

**复用价值**：高。w-b 当前是单线程 CLI，大型仓库解析显著拖慢。

**移植成本**：中-高。Node.js `worker_threads` + tree-sitter WASM 的跨线程序列化需要验证。

---

#### B. Async Handler + Sync DB Mutex（qartez）

**核心设计**：async handler 可并发进入，但 SQLite 连接被 `Arc<Mutex<Connection>>` 包裹，DB 操作内部序列化。文件 watcher 被赋予**独立的数据库连接**。

**workspace-bridge 行动**：w-b 使用 `better-sqlite3`（sync API），若引入 watcher 或并发写，需要额外一个连接实例。

---

#### C. Process vs Thread 自适应选择（CRG）

```python
def _select_executor_kind():
    explicit = os.environ.get("CRG_PARSE_EXECUTOR", "").strip().lower()
    if explicit in ("process", "thread"): return explicit
    if sys.platform == "win32" and not sys.stdin.isatty():
        return "thread"  # Windows + stdio → thread 避免 zombie
    return "process"
```

**workspace-bridge 行动**：若引入并行解析，在配置中增加此启发式。

---

### 3.3 CLI UX 设计模式

#### A. 4-Tier Progressive Disclosure（qartez）

```
Tier Core（8 个）     → map/find/grep/read/outline/impact/deps/stats
Tier Analysis（19 个）→ refs/calls/cochange/context/unused/clones/smells...
Tier Refactor（7 个） → rename/move/safe_delete...
Tier Meta（6 个）     → project/wiki/workspace/maintenance...
```

**workspace-bridge 行动**：w-b 已有 `--help` L1/L2/L3/L4 分层，但可进一步在 `SKILL.md` 和文档中显式标注每个命令的层级和"何时使用"。

---

#### B. 错误消息的"可操作建议"模式（GitNexus / qartez）

**GitNexus**：根据错误关键词给出具体建议：

```typescript
if (msg.includes('Maximum call stack size exceeded') || msg.includes('heap out of memory')) {
    console.error('  This error typically occurs on very large repositories.');
    console.error('  Suggestions:');
    console.error('    1. Add large vendored/generated directories to .gitignore');
    console.error('    2. Increase Node.js heap: NODE_OPTIONS="--max-old-space-size=16384"');
}
```

**qartez**：锁错误直接告诉用户被哪个 PID 持有：

```rust
#[error("Another qartez process is indexing this repo (held by PID {holder_pid_display}). Try again or stop the other process.")]
```

**workspace-bridge 行动**：在 `cli.js` 的 catch 块中增加错误分类和提示模板。

---

#### C. 进度条 + 阶段报告 + 耗时显示（GitNexus）

```typescript
const updateBar = (value: number, phaseLabel: string) => {
    const elapsed = Math.round((Date.now() - phaseStart) / 1000);
    const display = elapsed >= 3 ? `${phaseLabel} (${elapsed}s)` : phaseLabel;
    bar.update(value, { phase: display });
};
```

**workspace-bridge 行动**：大型仓库分析（>10s）时，用户不知道是在工作还是卡住了。Node.js 有 `cli-progress` 或 `ora` 可直接使用。

---

#### D. 路径参数安全清洗（qartez）

**核心逻辑**：处理 MCP 客户端常见的"包裹语法"：

```rust
fn normalize_user_path_arg(raw: &str) -> String {
    // Strip bracket wrappers: [file_path=...], [path=...], [file=...]
    // Strip matching quote/backtick layers
}
fn safe_resolve(user_path: &str) -> Result<PathBuf, String> {
    // 拒绝绝对路径
    // 拒绝 depth < 0 的 traversal
}
```

**workspace-bridge 行动**：`--file` 参数解析较原始，已被报告过路径注入相关问题。

---

### 3.4 缓存架构

#### A. Per-File 多级惰性解析缓存（qartez）

**来源文件**：`qartez-mcp/src/server/cache.rs`

```rust
pub struct ParseEntry {
    pub mtime_ns: i64,
    pub source: Option<Arc<String>>,       // 原始文本
    pub tree: Option<Arc<tree_sitter::Tree>>, // AST
    pub calls: Option<Arc<Vec<(String, usize)>>>, // 调用站点
    pub idents: Option<Arc<IdentMap>>,     // 标识符映射
}
```

每项都按 `mtime_ns` 做失效判断。`source` 无需 parse，`tree` parse 一次，`idents`/`calls` AST walk 一次。

**workspace-bridge 行动**：w-b 当前每次运行都重新解析所有文件，没有跨调用的缓存。对于"先 impact 再 affected-tests 再 audit-summary"的连续查询场景浪费严重。

---

#### B. SQLite 作为统一缓存层 + 生产级 Pragma（qartez）

```rust
conn.execute_batch(
    "PRAGMA journal_mode = WAL;
     PRAGMA foreign_keys = ON;
     PRAGMA synchronous = NORMAL;
     PRAGMA cache_size = -64000;
     PRAGMA busy_timeout = 5000;
     PRAGMA temp_store = MEMORY;
     PRAGMA mmap_size = 268435456;"
)?;
```

**workspace-bridge 行动**：w-b 也使用 SQLite（`better-sqlite3`），但当前 pragma 配置较简单。追加上述 pragma 可提升查询性能。

---

### 3.5 可观测性与诊断

#### A. PhaseTimer — 多阶段性能计时（GitNexus）

**来源文件**：`gitnexus/src/core/search/phase-timer.ts`

```typescript
export class PhaseTimer {
    start(phase: string): void { ... }
    stop(): void { ... }
    mark(phase: string, durationMs: number): void { ... }
    async time<T>(phase: string, promise: Promise<T>): Promise<T> { ... }
    summary(): Record<string, number> { ... }
}
```

支持三种用法：顺序阶段、并发阶段（Promise.all）、预测量。

**workspace-bridge 行动**：w-b 当前缺乏细粒度性能指标，无法回答"瓶颈在 parse、resolve 还是 graph build"。引入 `PhaseTimer`（~100 行 JS）即可。

---

#### B. Token Budget 估算与内容裁剪（qartez）

```rust
pub fn estimate_tokens(text: &str) -> usize {
    text.chars().count() / 3  // ~3 chars/token
}

pub fn elide_file_source(...) -> Option<String> {
    // 函数体 → 签名 + {⋯}
    // 长类 → 前 2 行 + ⋯ + 最后 1 行
    if estimate_tokens(&out) > token_budget_remaining { out.push_str("⋯\n"); break; }
}
```

**workspace-bridge 行动**：w-b 的 JSON 输出在大型文件中可能过于庞大，特别是 `--json` 模式下的 `audit-file` 返回完整源代码。

---

#### C. Fatal Handler + 真实 stderr 保留（GitNexus）

```typescript
const realStderrWrite = process.stderr.write.bind(process.stderr);

const installFatalHandlers = (): void => {
    process.on('unhandledRejection', (err) => {
        writeFatalToStderr('Analysis failed (unhandled rejection)', err);
        process.exit(1);
    });
};
```

**workspace-bridge 行动**：w-b 的 CLI 也有 async 路径，未捕获的异常可能导致静默退出。

---

#### D. Benchmark 结构化报告 + 回归检查（qartez）

**来源文件**：`qartez-mcp/src/benchmark/report.rs`

```rust
pub struct BenchmarkReport {
    pub generated_at_unix: u64,
    pub git_sha: Option<String>,
    pub scenarios: Vec<ScenarioReport>,
}
```

包含：token 节省率、延迟、精确度/召回、LLM-judge 质量评分（5 轴）、回归检查（对比 baseline flag 退化）。

**workspace-bridge 行动**：w-b 有 `benchmark/` 目录但较简单。qartez 的"per-tool benchmark + 对照实验（有工具 vs 无工具）"模式可作为下一阶段质量基础设施。

---

## 四、配置管理

### 4.1 项目根自动发现 + Workspace 扩展（qartez）

**来源文件**：`qartez-mcp/src/config.rs`

```rust
const PROJECT_MARKERS: &[&str] = &[
    ".git", "Cargo.toml", "package.json", "go.mod", "pyproject.toml",
];

fn detect_workspace_members(root: &Path) -> (Vec<PathBuf>, HashMap<PathBuf, String>) {
    members.extend(detect_npm_workspace(root));
    members.extend(detect_cargo_workspace(root));
    members.extend(detect_go_workspace(root));
    (members, aliases)
}
```

**workspace-bridge 行动**：w-b 当前项目根发现较简单（主要靠 `--cwd`），对 monorepo 的支持不够智能。

---

### 4.2 配置层叠与来源追溯（CodeGraphContext）

**优先级（高到低）**：
1. Runtime environment variables
2. Local `.env` in project directory
3. Global `~/.codegraphcontext/.env`
4. Local `mcp.json` env vars

**冲突报告**：

```python
default_db_sources = list(key_defined_in.get("DEFAULT_DATABASE", []))
if len(default_db_sources) > 1:
    console.print(f"DEFAULT_DATABASE defined in multiple sources: {', '.join(default_db_sources)}; using: {winners}")
```

**workspace-bridge 行动**：w-b 当前配置主要来自 `.workspace-bridge.json` 和 CLI 参数，缺少环境变量层和"来源报告"。

---

## 附录：跨项目共识与反共识

### 四个项目的共同选择

| 决策 | 共识程度 | 说明 |
|------|---------|------|
| **tree-sitter 作为 parser 基础设施** | 4/4 | 全部使用 tree-sitter（WASM 或 native） |
| **SQLite 作为缓存/持久化层** | 3/4 | CRG、qartez、CGC 都用；GitNexus 用内存 Map |
| **Git diff 驱动增量更新** | 4/4 | 无例外 |
| **不做 tree-sitter 原生增量解析** | 4/4 | CLI 场景 ROI 为负 |
| **WAL 模式** | 3/4 | qartez、CRG、CGC 都用 |
| **per-file error boundary** | 3/4 | GitNexus、CRG、CGC 都有；qartez 用 Rust 的 Result |

### 四个项目的分歧

| 分歧点 | 选择 A | 选择 B | w-b 应选 |
|--------|--------|--------|---------|
| **图存储** | SQLite（CRG/qartez） | 图数据库（CGC） | ✅ SQLite（已选） |
| **解析模式** | Query 为主（GitNexus/CGC） | Visitor 为主（CRG） | ✅ 混合（Query 70% + Visitor 30%） |
| **并发** | Worker Pool（GitNexus） | 单线程顺序（CRG/qartez CLI） | 当前单线程，未来 Worker Pool |
| **进程形态** | Daemon（CRG/qartez） | CLI-only（w-b） | ✅ CLI-only（已选） |
| **输出格式** | JSON（qartez/MCP） | Markdown/HTML（CRG wiki） | ✅ 两者都支持（已选） |

---

*本指南与 [ABSORPTION_GUIDE.md](./ABSORPTION_GUIDE.md) 共同构成对 reference/ 四项目的完整代码考古。如需对某个具体模式做 POC 验证或代码移植，可针对对应项目启动 focused 子任务。*
