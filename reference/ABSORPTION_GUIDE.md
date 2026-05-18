# Reference 代码吸收指南

> 对 `code-review-graph` / `qartez-mcp` / `CodeGraphContext` / `GitNexus` 四项目的深度代码考古总结。
> 评估日期：2026-05-18。用于 workspace-bridge 后续性能优化、算法升级和代码复用。
>
> **原则**：只吸收与 CLI-only + 轻量定位兼容的模式；重型依赖（ONNX/图数据库/常驻进程）明确拒绝。

---

## 总览：按 ROI 排序的优先行动清单

| 优先级 | 模式 | 来源 | 目标文件 | 成本 | 预期收益 |
|--------|------|------|----------|------|----------|
| **P0** | SHA-256 增量跳过 + Dependent 扩展 | CRG | `cache.js` / `file-index.js` | 低 | 减少 50%+ 无效重解析 |
| **P0** | 递归 CTE Impact 查询 | CRG | `graph-db.js` | 中 | 大图 impact <200ms |
| **P0** | Neighbor-aware 增量更新 | CGC | `dep-graph.js` / `graph-db.js` | 中 | audit-diff 增量 <50ms |
| **P0** | WAL Cadence 节流策略 | qartez | `graph-db.js` / `cache.js` | 低 | SQLite 写入治理 |
| **P0** | Diff Impact Convergence + Omissions | qartez | `audit-diff` / `cochange-tools.js` | 低 | 变更风险排序 |
| **P1** | Risk / Criticality 多因子评分 | CRG | `overview-tools.js` / `audit-diff` | 低 | 统一风险度量 |
| **P1** | Hotspot Health Halflife 归一化 | qartez | `overview-tools.js` | 低 | 消除裸数字加权 |
| **P1** | 语言 Provider 注册表 | GitNexus | `parsers/` / `resolvers.js` | 中 | 新增语言成本降 70% |
| **P1** | 导入解析策略链 | GitNexus | `resolvers.js` | 低 | 解析规则优先级显式化 |
| **P1** | 导出检测语言化 | GitNexus | `dead-exports` | 低 | Java/Go/Python 误报率下降 |
| **P1** | Confidence Tier + Diagnostics | CGC | `resolvers.js` / `dead-exports` | 中 | 诚实记录不确定性 |
| **P1** | Pre-scan 全局符号映射 | CGC | `file-index.js` | 低 | import 解析准确率提升 |
| **P1** | Schema 迁移框架 | CRG+qartez | `graph-db.js` / `cache.js` | 低 | 支撑 SQLite 演进 |
| **P2** | 知识图双索引 | GitNexus | `dep-graph.js` | 中 | 删除/查询加速 |
| **P2** | 符号级 PageRank | qartez | `symbol-impact.js` | 高 | 符号级热点排序 |
| **P2** | 框架感知 Extractor + entryPointMultiplier | GitNexus | `framework-patterns.js` | 中 | hotspot 排序更可信 |
| **P2** | Tree-sitter Scanner 插件化 | GitNexus | `framework-patterns.js` | 低 | 框架检测准确率 > regex |
| **P2** | Two-pass 节点/边分离 | CGC | `dep-graph.js` | 低 | 消除构建期 race |
| **P2** | `_sanitize_name` Prompt 注入防御 | CRG | `formatters/` / `cli.js` | 极低 | 消除安全风险 |
| **P2** | 批量查询 999 变量限制 | CRG | `graph-db.js` | 极低 | 防 SQLite 溢出 |
| **P3** | Hybrid Search RRF | CRG | 未来扩展 | 高 | 语义搜索基础设施 |
| **P3** | Shape Hash / 克隆检测 | qartez | 未来扩展 | 低 | 近似重复代码检测 |
| **P3** | 跨进程锁 | qartez | 未来 watch 模式 | 低 | 多实例安全 |
| **—** | ONNX 语义搜索 | qartez | — | — | **明确拒绝** |
| **—** | 多后端图数据库 | CGC | — | — | **明确拒绝** |
| **—** | MCP 协议层 | 全部 | — | — | **明确拒绝** |
| **—** | 常驻进程 / Daemon | CRG+qartez | — | — | **明确拒绝** |

> **缩写**：CRG = code-review-graph，CGC = CodeGraphContext，GN = GitNexus，QZ = qartez-mcp

---

## 一、缓存与增量更新（最高 ROI）

### 1.1 SHA-256 内容哈希精确增量（code-review-graph）

**来源文件**：`code_review_graph/incremental.py:incremental_update()`

**核心逻辑**（已部分移植到 w-b，但缺少 Dependent 扩展）：

```python
# 1. git diff 找变更文件
changed = git_diff(...)
# 2. 找到依赖变更文件的下游文件
dependents = find_dependents(changed)  # ← w-b 缺少此步
# 3. 对 changed ∪ dependents 逐个 SHA-256 校验
for f in changed | dependents:
    raw = f.read_bytes()
    fhash = hashlib.sha256(raw).hexdigest()
    existing = store.get_nodes_by_file(str(f))
    if existing and existing[0].file_hash == fhash:
        continue  # 真正未变，跳过重解析
    # 4. 否则重新解析
    parse_and_update(f)
# 5. 删除不存在的文件数据
prune_deleted_files(store)
```

**workspace-bridge 现状**：
- ✅ `file-index.js` 已计算 SHA-256 存入 `fileMetadata.hash`
- ✅ `cache.js` `checkFileChanges()` 有 fast（mtime+size）+ slow（SHA-256）双路径
- ❌ **缺少 `find_dependents` 扩展**：A 变更后，被 A import 的 B 虽被标记为 dependent，但 B 内容未变时仍会重解析

**行动**：在 `cache.js` / `dep-graph.js` 的增量路径中加入 "变更文件 + 下游依赖文件" 的 SHA-256 校验，避免 dependent 文件的无效重解析。

---

### 1.2 Neighbor-aware 增量更新（CodeGraphContext）

**来源文件**：`src/codegraphcontext/core/watcher.py:_handle_modification()`

**核心逻辑** — 文件变更时的 7 步精确增量：

```python
# 1. 变更前先查邻居（CALLS/INHERITS 指向该文件的所有 caller/inheritor）
caller_paths = graph_builder.get_caller_file_paths(changed)
inheritor_paths = graph_builder.get_inheritance_neighbor_paths(changed)
affected = {changed} | caller_paths | inheritor_paths

# 2. O(1) 更新 imports_map（仅重新扫描变更文件）
# 3. DETACH DELETE 变更文件（连带出/入边）
# 4. 清理 caller/inheritor 的出边
# 5. 重新解析受影响子集
# 6. 批量获取 file_class_lookup（避免全量重解析）
# 7. 仅对子集重建 CALLS/INHERITS
```

**复用价值**：**极高**。workspace-bridge `audit-diff` 是主战场，当前增量能力有限。此模式可直接移植到内存图：先查询哪些文件 import/call 了变更文件，仅重解析这些文件并重建边。

**对应 w-b 文件**：`dep-graph.js` / `graph-db.js` / `incremental-diff.js`

**工作量**：1–2 天

---

### 1.3 WAL Cadence 节流策略（qartez-mcp）

**来源文件**：`src/watch.rs`

**核心策略**：

```rust
const PAGERANK_MIN_INTERVAL_MS: u64 = 30_000;
const WAL_TRUNCATE_MIN_INTERVAL_MS: u64 = 60_000;

fn tick(&mut self, now) -> CadenceDecision {
    let run_pagerank = time_due(30s) || batches >= 32;
    let run_truncate = time_due(60s);
    let checkpoint_sql = if run_truncate {
        "PRAGMA wal_checkpoint(TRUNCATE);"
    } else {
        "PRAGMA wal_checkpoint(PASSIVE);"
    };
}
```

**设计理由**：
- Windows 上 TRUNCATE 触发 NTFS fsync + Defender 扫描，单次可达数百毫秒
- PASSIVE 不阻塞读者，允许 WAL 暂时膨胀
- PageRank 全图迭代每 save 跑一次在大仓库不可接受

**workspace-bridge 现状**：`graph-db.js` 仅 `PRAGMA journal_mode = WAL`，**无任何 checkpoint 策略**。

**行动**：在 `GraphDB` 或 `Cache` 层加入 `Cadence` 状态机（~50 行 JS），定时 PASSIVE + 周期性 TRUNCATE。

---

### 1.4 DependentList 截断信号（code-review-graph）

**来源文件**：`code_review_graph/incremental.py:DependentList`

**核心逻辑**：

```python
class DependentList(list):
    truncated: bool
    def __init__(self, items, *, truncated=False):
        super().__init__(items)
        self.truncated = truncated
```

**复用价值**：高。workspace-bridge 的 `impact` / `affected-tests` 在大型单体项目中可能爆炸，需要类似的**诚实截断**机制。

**移植成本**：极低。给现有数组包装 `truncated` 布尔字段即可。

---

## 二、图查询与影响分析

### 2.1 递归 CTE Impact 查询（code-review-graph）

**来源文件**：`code_review_graph/graph.py:get_impact_radius_sql()`

**核心 SQL**：

```sql
WITH RECURSIVE impacted(node_qn, depth) AS (
    SELECT qn, 0 FROM _impact_seeds
    UNION
    SELECT e.target_qualified, i.depth + 1
    FROM impacted i
    JOIN edges e ON e.source_qualified = i.node_qn
    WHERE i.depth < ?
    UNION
    SELECT e.source_qualified, i.depth + 1
    FROM impacted i
    JOIN edges e ON e.target_qualified = i.node_qn
    WHERE i.depth < ?
)
SELECT DISTINCT node_qn, MIN(depth) AS min_depth
FROM impacted
GROUP BY node_qn
LIMIT ?
```

**关键设计**：
- 双向遍历（source→target + target→source）
- `_impact_seeds` 临时表绕过 SQLite 999 变量限制（batch 450）
- 在数据库内完成查询，避免全图物化到内存

**workspace-bridge 现状**：impact 是纯内存 BFS（`dep-graph.js` `GraphAnalyzer`）。对于大型仓库，BFS 遍历仍需大量 JS 对象访问。

**行动**：若 `graph-db.js` 从纯 Map 扩展为支持 CTE 查询的 SQLite schema，递归 CTE 是更高效的 impact 查询方式。

---

### 2.2 符号级影响半径（qartez-mcp）

**来源文件**：`src/index/mod.rs`（引用解析）、`src/server/tools/impact.rs`

**核心设计**：

```
引用解析 6 级优先级：
P1. Qualifier match         (Foo::new → impl Foo { fn new })
P2. Receiver-type hint      (typed local → method on that type)
P3. Same-impl-block         (self.bar() → same impl 内其他方法)
P4. Same-file
P5. Imported-file
P6. Unique-global           (全局唯一同名符号)
```

每个优先级内有 kind 兼容性过滤：
- `Call` → 只匹配 function/method/class/struct/enum/interface/trait/type
- `TypeRef` → 只匹配类型类符号
- `Use` → 不过滤（保守保留）

**workspace-bridge 现状**：有 `symbol-impact.js`（基于 `exportRecords`/`functionRecords`），但**没有符号级调用图（call graph），impact 只到文件级**。

**复用价值**：**高**。这是 workspace-bridge 与 qartez 最大的能力差距。

**移植成本**：**高**。需：① AST 提取引用点 ② 跨文件符号解析 ③ 存储 `symbol_refs`。以现有 tree-sitter WASM 基础，约 1–2 周。

---

### 2.3 四信号融合评分（qartez-mcp）

**来源文件**：`src/server/tools/hotspots.rs`、`src/server/tools/diff_impact.rs`

**A. Hotspot Score（结构性热度）**：

```rust
score = max_cc * coupling(pagerank) * (1 + churn)

// 健康度（0-10）— 用 halflife 统一异构量纲
cc_h       = 10 / (1 + max_cc / 10.0)       // halflife=10 (PMD 常规阈值)
coupling_h = 10 / (1 + coupling * 50.0)    // halflife=0.02 (top ~5%)
churn_h    = 10 / (1 + churn / 8.0)        // halflife=8 (适中活跃度)
health = (cc_h + coupling_h + churn_h) / 3.0
```

**B. Diff Risk（变更风险）**：

```rust
risk = ((10.0 - health)
        + boundary_violations.min(3) * 0.5
        + if !has_test { 1.5 } else { 0.0 })
       .clamp(0.0, 10.0)
```

**关键洞察**：
- `10/(1+x/halflife)` 统一三个异构量纲，避免裸数字魔法
- **Convergence points**：被 2+ 个变更同时影响的文件（高冲突风险）— 独立信号，不混入分数
- **Co-change omissions**：历史上同变但未在本次 diff 中的文件 — 单独列出

**workspace-bridge 现状**：`overview-tools.js` `calculateHotspotScore` 使用规则表加权，PageRank 只做事后 boost。**未使用 halflife 归一化**。

**行动**：
1. 用 `10/(1+x/halflife)` 替换现有裸数字加权（~20 行）
2. 将 convergence/omissions 概念注入 `audit-diff` 输出（利用已有 co-change 数据）

---

### 2.4 知识图双索引（GitNexus）

**来源文件**：`gitnexus/src/core/graph/graph.ts`

**核心结构**：

```typescript
const nodeMap = new Map<string, GraphNode>();
const relationshipMap = new Map<string, GraphRelationship>();
// 索引1: 按类型分桶，遍历从 O(N) 降为 O(该类型数量)
const relationshipsByType = new Map<RelationshipType, Map<string, GraphRelationship>>();
// 索引2: 节点 → 关联边ID，删除节点时无需全图扫描
const edgeIdsByNode = new Map<string, Set<string>>();
// 索引3: 文件路径 → 节点ID，按文件批量删除时直接定位
const nodeIdsByFile = new Map<string, Set<string>>();

// 所有变更走统一辅助函数
const writeRel = (rel: GraphRelationship): void => {
    relationshipMap.set(rel.id, rel);
    let typeBucket = relationshipsByType.get(rel.type);
    if (!typeBucket) {
        typeBucket = new Map();
        relationshipsByType.set(rel.type, typeBucket);
    }
    typeBucket.set(rel.id, rel);
    addToBucket(edgeIdsByNode, rel.sourceId, rel.id);
    if (rel.targetId !== rel.sourceId) {
        addToBucket(edgeIdsByNode, rel.targetId, rel.id);
    }
};
```

**复用价值**：高。`dep-graph.js` 内存图可借鉴此三重索引：
- `relationshipsByType` → 加速框架模式检测和 MRO 遍历
- `edgeIdsByNode` → 删除节点从 O(全图边数) 降至 O(关联边数)
- `nodeIdsByFile` → `audit-diff` 按文件删除/更新节点至关重要

---

## 三、评分模型与策展输出

### 3.1 Risk / Criticality 多因子评分（code-review-graph）

**来源文件**：`code_review_graph/flows.py:compute_criticality()`、`changes.py:compute_risk_score()`

**Criticality（5 因子加权）**：

```python
criticality = (
    file_spread * 0.30
    + external_score * 0.20
    + security_score * 0.25
    + test_gap * 0.15
    + depth_score * 0.10
)
```

**Risk Score（5 维度累加 + cap）**：

```python
score += min(flow_participation, 0.25)
score += min(community_crossing, 0.15)
score += 0.30 - (min(test_count / 5.0, 1.0) * 0.25)  # test coverage
score += min(caller_count / 20.0, 0.10)              # caller count
score += 0.20 if security_sensitive else 0.0
```

**复用价值**：高。workspace-bridge 目前无统一 risk scoring，各命令自行判断。引入此模型可为 `audit-diff` 提供**跨文件变更的风险排序**。

**移植成本**：低。纯算法，无外部依赖。

---

### 3.2 Token 削减三层协议（code-review-graph）

**核心洞察**：8.2× token 削减不靠魔法压缩，靠**交互协议设计**：

```
Layer 1: get_minimal_context (~100 tokens) — 入口层强制极简
Layer 2: compact_response (key_entities ≤10, communities ≤5) — 标准截断
Layer 3: Prompt 强制递进 (minimal → standard → verbose) — 协议层控制
```

**关键代码**：

```python
# prompts.py — 所有 prompt 强制规定
default_detail_level = "minimal"
_TOKEN_EFFICIENCY_PREAMBLE = """\
1. ALWAYS call `get_minimal_context` first...
2. Use `detail_level="minimal"` unless insufficient.
3. Only escalate to `standard` or `verbose` for specific entities.
"""
```

**workspace-bridge 现状**：`--depth surface` 已部分实现，但 SKILL.md 仍厚（~264 行），因为 CLI 出口质量不足。

**行动**：
1. `audit-summary` 输出进一步变薄（参考 `get_minimal_context` 的 ~100 token 结构）
2. 在 `SKILL.md` 中写入类似的"先 minimal → 再钻取"调用约定
3. 给所有 JSON 输出加统一 `compact_response` 截断（key_entities ≤10, nextSteps ≤3）

---

### 3.3 Confidence Tier + Diagnostics（CodeGraphContext）

**来源文件**：`src/codegraphcontext/tools/indexing/resolution/calls.py`

**9 级置信度系统**：

```python
_TIER_CONFIDENCE = {
    1: 1.00,  # explicit this/self/super receiver
    2: 0.95,  # local function / same file
    3: 0.88,  # inferred receiver type + FQN import
    4: 0.72,  # inferred receiver type + short-name fallback
    5: 0.90,  # unique short name / same-package
    6: 0.85,  # qualified / wildcard import
    7: 0.70,  # FQN path-substring match
    8: 0.25,  # alphabetical-first of multiple candidates
    9: 0.08,  # same-file fallback for unresolved obj.method()
}
```

**解析时还进行**：
- **Arity 匹配**：根据参数个数筛选候选
- **继承层次 BFS**：沿 `INHERITS` 链向上查找方法
- **Diagnostics 收集**：记录 `record_skip(reason, tier, caller, callee)`

**workspace-bridge 现状**：`resolvers.js` 是基于 import 路径的字符串匹配，无显式置信度分层。

**复用价值**：高。引入 tier 系统可：
1. 让 dead-exports 更诚实（低置信度边不参与判断）
2. 为 `impact` 提供"影响可信度"标注
3. diagnostics 帮助用户理解"为什么某个 import 未解析"

---

## 四、解析器架构

### 4.1 语言 Provider 注册表（GitNexus）

**来源文件**：`gitnexus/src/core/ingestion/language-provider.ts`、`languages/index.ts`

**核心设计**：

```typescript
interface LanguageProviderConfig {
    readonly id: SupportedLanguages;
    readonly extensions: readonly string[];
    readonly treeSitterQueries: string;
    readonly typeConfig: LanguageTypeConfig;
    readonly exportChecker: ExportChecker;
    readonly importResolver: ImportResolverFn;
    readonly callExtractor?: CallExtractor;
    readonly heritageExtractor?: HeritageExtractor;
    // ... 30+ 可选钩子
}

export const providers = {
    [SupportedLanguages.TypeScript]: typescriptProvider,
    [SupportedLanguages.Python]: pythonProvider,
    // ... 16 种
} satisfies Record<SupportedLanguages, LanguageProvider>;
```

**复用价值**：高。workspace-bridge 已有 `parsers/` 但缺乏统一契约。引入后可将 `parserAvailability`、`import 解析`、`导出检测`、`内置符号过滤`统一到一个语言配置对象。

**移植成本**：中。现有 `registry.js` + `shared.js` 可作为迁移基础。

---

### 4.2 导入解析策略链（GitNexus）

**来源文件**：`gitnexus/src/core/ingestion/import-resolvers/configs/typescript-javascript.ts`

**核心逻辑**：

```typescript
export const typescriptImportConfig: ImportResolutionConfig = {
    language: SupportedLanguages.TypeScript,
    strategies: [
        resolveRelativeImport,      // './foo' → 'src/foo.ts'
        resolveTsconfigAlias,       // '@/components' → 'src/components'
        resolveNodeModule,          // 'lodash' → null (external)
        resolvePackageJsonMain,     // 'my-lib' → 'my-lib/dist/index.js'
    ],
};

export function createImportResolver(config: ImportResolutionConfig): ImportResolverFn {
    return (rawImportPath, filePath, ctx) => {
        for (const strategy of config.strategies) {
            const result = strategy(rawImportPath, filePath, ctx);
            if (result) return result;
        }
        return null;
    };
}
```

**复用价值**：高。`resolvers.js` 目前混合在单个函数中。策略链可：
- 使 TS path alias、Go module、Python relative import 优先级显式化
- 新增语言只需声明策略列表
- `resolveCache`（Memoization）大幅减少重复 I/O

**移植成本**：低。策略链在 JS 中就是 `for (const s of strategies)`。

---

### 4.3 导出检测语言化（GitNexus）

**来源文件**：`gitnexus/src/core/ingestion/export-detection.ts`

**核心设计**：每个语言一个 `ExportChecker = (node, name) => boolean` 纯函数。

```typescript
export const pythonExportChecker: ExportChecker = (_node, name) => !name.startsWith('_');

export const goExportChecker: ExportChecker = (_node, name) => {
    const first = name[0];
    return first === first.toUpperCase() && first !== first.toLowerCase();
};

export const javaExportChecker: ExportChecker = (node, _name) => {
    // 扫描 sibling modifiers 找 public
};

export const rustExportChecker: ExportChecker = (node, _name) => {
    // 扫描 visibility_modifier 找 pub
};
```

**复用价值**：高。workspace-bridge `dead-exports` 对 Java（Spring DI 误报率极高）、Go、Python 缺乏准确导出检测。

**移植成本**：低。纯函数，独立成模块即可。

---

### 4.4 Pre-scan 全局符号映射（CodeGraphContext）

**来源文件**：`src/codegraphcontext/tools/languages/python.py:pre_scan_python()`

**核心逻辑**：详细解析前，先快速扫描所有文件的类/函数定义，构建全局 `imports_map = {symbol_name: [file_path, ...]}`。

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

**复用价值**：高。在 `dep-graph.js` 构建前，先全局扫描导出符号，可显著提升 import 解析准确率（特别是无显式 import 的同类文件符号）。

**移植成本**：低。约 0.5–1 天。

---

### 4.5 Tree-sitter Scanner 插件化（GitNexus）

**来源文件**：`gitnexus/src/core/group/extractors/tree-sitter-scanner.ts`

**核心设计**：语言无关的 tree-sitter 查询编译/执行基础设施。

```typescript
export interface PatternSpec<TMeta> {
    query: string;
    meta: TMeta;
}
export interface LanguagePatterns<TMeta> {
    name: string;
    language: unknown;
    patterns: PatternSpec<TMeta>[];
}
export function compilePatterns<TMeta>(bundle: LanguagePatterns<TMeta>): CompiledPatterns<TMeta> {
    for (const spec of bundle.patterns) {
        const query = new Parser.Query(bundle.language, spec.query);
        compiled.push({ query, meta: spec.meta });
    }
}
```

**复用价值**：高。workspace-bridge `framework-patterns.js` 目前用硬编码 regex。引入 `compilePatterns` + `runCompiledPatterns` 后，框架检测准确率高于 regex，新增框架只需一个 query 文件。

**移植成本**：低。`web-tree-sitter` 的 Query API 与原生兼容。

---

### 4.6 Two-pass 节点/边分离（CodeGraphContext）

**来源文件**：`src/codegraphcontext/tools/indexing/pipeline.py`

**核心逻辑**：

```python
# Pass 1: 遍历所有文件，写 Node 和 CONTAINS/IMPORTS 边
for file in files:
    file_data = parse_file(...)
    writer.add_file_to_graph(file_data, ...)

# Pass 2: 所有节点已就位，再建跨文件边
inheritance_batch = build_inheritance_and_csharp_files(all_file_data, imports_map)
writer.write_inheritance_links(inheritance_batch, ...)
resolved_calls = build_function_call_groups(all_file_data, imports_map, ...)
writer.write_function_call_groups(*resolved_calls)

# Pass 3: 特殊后处理（C++ .h/.cpp 分离）
writer.write_cpp_class_function_links(...)
```

**复用价值**：高。workspace-bridge `dep-graph.js` 本质也是两阶段，但 CGC 将其显式化并推广到所有跨文件关系。建议将 `GraphBuilder` / `GraphAnalyzer` 职责边界清晰化为"节点构建期"和"边链接期"。

**移植成本**：低。理念复用，几乎零代码改动。

---

## 五、工程健壮性

### 5.1 Schema 迁移框架（code-review-graph + qartez）

**来源文件**：
- CRG: `code_review_graph/migrations.py`
- qartez: `src/storage/schema.rs`

**CRG 模式** — 版本化注册表 + idempotent 执行：

```python
MIGRATIONS: dict[int, Callable[[sqlite3.Connection], None]] = {
    2: _migrate_v2, 3: _migrate_v3, ...
}

def run_migrations(conn):
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for version, migration in MIGRATIONS.items():
        if version > current:
            migration(conn)
            conn.execute(f"PRAGMA user_version = {version}")
```

**qartez 模式** — 向前兼容 ALTER TABLE，"duplicate column" 静默忽略：

```rust
fn try_add_column(conn, sql) {
    match conn.execute(sql) {
        Ok(_) => Ok(()),
        Err(e) if e.to_string().contains("duplicate column name") => Ok(()),
        Err(e) => Err(e),
    }
}
```

**workspace-bridge 现状**：`graph-db.js` 只有手工 `_migrate()`，无系统化框架。

**行动**：统一为 `MIGRATIONS` 注册表模式，支撑 SQLite 持久化演进。

---

### 5.2 `_sanitize_name` Prompt 注入防御（code-review-graph）

**来源文件**：`code_review_graph/graph.py:_sanitize_name()`

**核心逻辑**：

```python
def _sanitize_name(s: str) -> str:
    cleaned = "".join(ch for ch in s if ch in ("\t", "\n") or ord(ch) >= 0x20)
    return cleaned[:256]
```

**复用价值**：高。workspace-bridge JSON 输出包含符号名，应增加此过滤，防止源代码中的恶意标识符（如 `IGNORE_ALL_PREVIOUS_INSTRUCTIONS`）注入 prompt。

**移植成本**：极低。

---

### 5.3 批量查询 999 变量限制（code-review-graph）

**来源文件**：`code_review_graph/graph.py:_batch_get_nodes()`

**核心逻辑**：

```python
batch_size = 450
for i in range(0, len(qns), batch_size):
    batch = qns[i:i + batch_size]
    placeholders = ",".join("?" for _ in batch)
    rows = self._conn.execute(
        f"SELECT * FROM nodes WHERE qualified_name IN ({placeholders})", batch
    )
```

**复用价值**：高。workspace-bridge 的 SQLite 查询若有批量 IN，同样会踩 999 限制。

**移植成本**：极低。

---

### 5.4 跨进程锁（qartez-mcp）

**来源文件**：`src/lock.rs`

**核心设计**：
- `fs4` OS-level `flock` + PID sidecar 文件（Windows 兼容）
- `try_acquire_briefly(2s)` 供 watcher 使用
- `acquire(30s)` 供全量索引使用
- 失败时报告 holder PID

**复用价值**：中。workspace-bridge 目前单进程，但若未来引入 watch 模式或多实例 CLI，这是基础设施。

---

## 六、明确拒绝（与定位冲突）

| 技术 | 来源 | 拒绝理由 |
|------|------|----------|
| **ONNX 语义搜索** | qartez | ~50MB 模型依赖，与轻量 CLI 定位冲突。AGENTS.md 已明确拒绝 |
| **多后端图数据库** | CGC | KuzuDB/Neo4j/FalkorDB 与轻量 CLI 冲突。内存 Map + SQLite 已满足需求 |
| **MCP 协议层** | 全部 | workspace-bridge 核心差异化是 CLI-only，拒绝 MCP tool 膨胀 |
| **常驻进程 / Daemon** | CRG+qartez | 违反 CLI-only 原则。git-diff 驱动 (<200ms) 已足够 |
| **VS Code 扩展** | CGC | 当前方向 CLI-only，可作为未来蓝图但不立即投入 |
| **向量嵌入解析** | CGC | 需 embedding 基础设施，与轻量定位冲突 |

---

## 附录 A：各项目核心文件速查

### code-review-graph（Python, ~15k 行）

| 能力 | 文件 | 行数 |
|------|------|------|
| Token 削减 / 极简上下文 | `tools/context.py`, `tools/_common.py` | ~200 |
| SHA-256 增量 | `incremental.py` | ~300 |
| 递归 CTE impact | `graph.py:get_impact_radius_sql` | ~544 |
| 预计算聚合 | `tools/build.py:_compute_summaries` | ~200 |
| Risk/Criticality 评分 | `flows.py`, `changes.py` | ~400 |
| Parser 注册表 / 24 语言 | `parser.py`, `registry.py` | ~800 |
| Schema 迁移 | `migrations.py` | ~200 |
| Hybrid Search RRF | `search.py` | ~300 |
| 平台自动检测 | `skills.py` | ~400 |

### qartez-mcp（Rust, ~15k 行）

| 能力 | 文件 | 行数 |
|------|------|------|
| PageRank warm-start | `src/graph/pagerank.rs` | ~544 |
| Hotspot / Diff Risk 评分 | `src/server/tools/hotspots.rs`, `diff_impact.rs` | ~600 |
| Co-change 分析 | `src/git/cochange.rs` | ~544 |
| 符号级影响 | `src/index/mod.rs`, `src/server/tools/impact.rs` | ~900 |
| WAL Cadence | `src/watch.rs` | ~977 |
| Modification guard | `src/guard.rs` | ~641 |
| 架构边界 | `src/graph/boundaries.rs` | ~731 |
| ONNX 语义搜索 | `src/embeddings.rs` | ~485 |

### CodeGraphContext（Python, ~20k+ 行）

| 能力 | 文件 |
|------|------|
| Neighbor-aware 增量 | `core/watcher.py:_handle_modification` |
| Two-pass 分离 | `tools/indexing/pipeline.py` |
| Confidence Tier | `tools/indexing/resolution/calls.py` |
| Pre-scan | `tools/languages/python.py:pre_scan_python` |
| 多后端适配 | `core/database_*.py` |
| VS Code 扩展 | `extensions/vscode/src/extension.ts` |

### GitNexus（TypeScript, ~8k 行）

| 能力 | 文件 |
|------|------|
| 语言 Provider 注册表 | `core/ingestion/language-provider.ts` |
| 知识图双索引 | `core/graph/graph.ts` |
| 导入解析策略链 | `core/ingestion/import-resolvers/configs/*.ts` |
| 导出检测语言化 | `core/ingestion/export-detection.ts` |
| Tree-sitter Scanner | `core/group/extractors/tree-sitter-scanner.ts` |
| 框架感知 Extractor | `core/ingestion/framework-detection.ts` |
| 注册调度表 | `core/ingestion/model/registration-table.ts` |
| Worker Pool | `core/ingestion/workers/worker-pool.ts` |

---

## 附录 B：最大启示

1. **Token 削减 = 协议设计，不是压缩算法**。code-review-graph 的 8.2× 来自三层协议（minimal context → compact response → prompt 递进）+ 两阶段增量（git diff → SHA-256 过滤）。

2. **诚实比准确更重要**。CodeGraphContext 的 `confidence_label`（EXTRACTED/INFERRED/AMBIGUOUS）和 qartez 的 convergence/omissions 独立信号，都是"承认不确定"的设计。这与 workspace-bridge AGENTS.md "保守判断"原则完全一致。

3. **预计算是 O(N)→O(1) 的唯一路径**。code-review-graph 的 `_compute_summaries` 用 GROUP BY aggregate query 替代逐节点查询；qartez 的 co-change 预计算表替代实时 walk。workspace-bridge 的 `audit-summary` 和 `overview-tools.js` 应优先走此路线。

4. **策略链 > 巨型 switch**。GitNexus 的导入解析策略链和 CRG 的 parser 类型映射表证明：新增语言/规则时，"声明式配置"的心智负担远低于"修改核心文件的 if-else"。

---

*本指南由 4 个并行 explore agent 深度挖掘后综合整理。如需对某个具体模式做 POC 验证或代码移植，可针对对应项目启动 focused 子任务。*
