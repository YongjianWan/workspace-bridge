# Wave 15：深度扩展 — 全面实施计划

> 三个子目标：**15-1 AST 轻量规则**、**15-3 ParseCache**、**15-4 增量更新终极协议（四层叠加）**。
> 15-2（框架检测 query 化）已交付，不再覆盖。

---

## User Review Required

> [!IMPORTANT]
> **15-1 的范围界定**：AST 轻量规则引擎只做**单文件方法级检查**（如"batch* 方法无 @Transactional"），不跨文件。这意味着只消费已有的 `functionRecords` + `exportRecords`，不引入新的 AST 遍历。是否同意这个边界？

> [!IMPORTANT]
> **15-4 Neighbor-aware 的副作用**：1-hop 扩展会增加 `updateFiles()` 的重解析文件数（从 k 变为 k + neighbors）。在大仓库上可能从"改 1 个文件重解析 1 个"变为"改 1 个文件重解析 5-20 个"。这是必要的正确性代价，但需要确认你接受这个性能 trade-off。

> [!WARNING]
> **执行顺序依赖**：15-3 ParseCache 必须先于 15-4 Neighbor-aware 落地。因为 Neighbor-aware 扩大了重解析集，ParseCache 的缓存命中能抵消这个代价（邻居文件如果内容没变，ParseCache 直接返回上次的 parse result，跳过磁盘 I/O 和 tree-sitter 解析）。

## Open Questions

> [!NOTE]
> 1. **15-1 规则配置格式**：AST 轻量规则用 JS 对象配置表还是外部 YAML？建议 JS 对象（与 14-1 security rules 保持一致，已有 `--config` 加载外部 JSON/YAML 的基础设施）。
> 2. **Shadow Candidate 范围**：GitNexus 枚举了 `.d.ts/.tsx/.ts/.jsx/.js/.mjs/.cjs` 7 种扩展名互相 shadow。workspace-bridge 是否需要覆盖 `.vue`/`.svelte` 的 shadow？建议暂不覆盖（Vue/Svelte SFC 的 import 解析逻辑已独立处理）。

---

## 15-1：AST 轻量规则引擎

### 设计理念

借鉴 qartez 的 `unused_excluded` 标记思路（在 parse 阶段标记 macro-generated/trait-impl 符号，而非 post-hoc 过滤）：规则在已有 `functionRecords`/`exportRecords` 上执行**单文件方法级匹配**，输出 `findings[]`。不引入新的 AST 遍历，不跨文件。

**核心原则**：结构分析 ≠ 语义分析。这些规则检查的是**结构模式**（方法命名 + 注解缺失 + 返回类型缺失），不是语义正确性。

### 参考借鉴

| 参考仓库 | 借鉴点 | 映射到本项目 |
|----------|--------|-------------|
| qartez `unused_excluded` | Parse 阶段标记特殊符号，而非事后过滤 | 规则基于已有 `functionRecords`，不新增 parse 开销 |
| qartez `fp_regression_*.rs` | 按误报类别命名回归测试 | 规则的 false-positive 用例按规则 ID 命名 |
| CRG Risk Scoring 5 维度 | `security_keyword` 维度 | 规则发现可注入 `composite-risk.js` 的 risk 维度 |

### Proposed Changes

#### [NEW] [ast-rules.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/dep-graph/ast-rules.js)

规则引擎核心：

```js
// 规则配置表（非 if-else 链，L2-4 边界消除）
const RULES = [
  {
    id: 'batch-no-transactional',
    language: ['java', 'kotlin'],
    match: (fn) => /^batch/i.test(fn.name) && !fn.decorators?.some(d => /Transactional/i.test(d)),
    severity: 'medium',
    message: (fn) => `${fn.name} lacks @Transactional annotation`,
  },
  {
    id: 'public-method-no-return-type',
    language: ['typescript'],
    match: (fn) => fn.isExported && !fn.returnType && fn.kind === 'function',
    severity: 'low',
    message: (fn) => `Exported function ${fn.name} has no return type annotation`,
  },
  // ... 可通过 --config 外部扩展
];

// 单文件检查入口
function checkFileRules(graphKey, info, rules = RULES) { ... }
// 全量检查入口
function checkAllRules(graph, rules = RULES) { ... }
```

**关键设计**：
- 规则是纯函数 `(functionRecord) => boolean`，零副作用
- 默认内置 3-5 条规则，通过 `--config` 可覆盖/扩展
- 输出结构与 `security-tools.js` 的 `findings[]` 对齐：`{ ruleId, file, symbol, severity, message }`

#### [MODIFY] [audit-assembler.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/tools/audit-assembler.js)

- `assembleAuditSummary()` 新增 `astRules` section
- 复用现有 `--severity` / `--category` 过滤逻辑

#### [MODIFY] [cli.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/cli.js) + formatters

- `audit-summary` JSON 输出新增 `astRuleFindings[]`
- human-readable formatter 新增 AST Rules section

---

## 15-3：ParseCache（跨调用缓存）

### 设计理念

**问题**：连续运行 `impact → affected-tests → audit-summary` 时，每次都重新 `readFile()` + tree-sitter parse 相同文件。ParseCache 缓存 parse 结果（不缓存 AST 树本身——太大），在 mtime 不变时直接返回。

**借鉴分析**：

| 参考仓库 | 做法 | 对 workspace-bridge 的适配 |
|----------|------|--------------------------|
| qartez [fingerprint.rs](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/reference/qartez-mcp/src/index/fingerprint.rs) | Workspace fingerprint（版本 + roots + ignore 内容哈希），cold start 秒级跳过全量索引 | 不适用——workspace-bridge 已有 SQLite `loadGraph()` 做 cold start 跳过 |
| qartez [mod.rs:414-423](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/reference/qartez-mcp/src/index/mod.rs#L414-L423) | `mtime_ns` 比对，unchanged 直接跳过（`FileIngestOutcome::Unchanged`） | **直接复用**——workspace-bridge 已在 `updateFiles()` L692 有 mtime 快速路径 |
| qartez `WatcherCadence` | PageRank 30s rate-limit + WAL TRUNCATE 60s rate-limit | 适用于 watch 模式（已有 `watch.js`），非 ParseCache 本身 |
| CGC [watcher.py:184-204](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/reference/CodeGraphContext/src/codegraphcontext/core/watcher.py#L184-L204) | `_update_imports_map_for_file()`：增量更新全局符号映射 | ParseCache 的失效逻辑参考 |

### 与现有代码的集成

当前 `parseFileOnly()` ([builder.js:222-275](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/dep-graph/builder.js#L222-L275)) 的流程：

```
readFile(filePath) → registry.findByExt → entry.parse(content) → return parsed
```

**改为**：

```
checkParseCache(filePath, mtime) → HIT: return cached
                                 → MISS: readFile → parse → populateCache → return
```

**不缓存什么**：
- 不缓存 tree-sitter AST 树对象（单文件 AST 几十 MB，100 文件就 OOM）
- 不缓存文件内容字符串（已有 `cache.js` 的 `parseResults` 存储 imports/exports）

**缓存什么**：
- `parseFileOnly()` 的完整返回值：`{ imports, exports, importRecords, exportRecords, functionRecords, parseMode, package }`
- Key: `normalizedPath`
- 失效条件: `mtime` 变化（fast path）或 `SHA-256 hash` 变化（slow path，防 mtime 精度问题）

### Proposed Changes

#### [MODIFY] [builder.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/dep-graph/builder.js)

1. **`constructor(depGraph)`**：新增 `this._parseCache = new Map()` 内存 LRU（`maxSize: 200`）
2. **`parseFileOnly(filePath)` L222-275**：
   ```
   // 1. 检查 parseCache
   const key = this.dg.normalizeFilePath(filePath);
   const meta = this.dg.cache.getFileMetadata(filePath);
   const cached = this._parseCache.get(key);
   if (cached && meta && cached.mtime === meta.mtime) {
     return cached.result;  // cache hit
   }
   
   // 2. cache miss: 原有逻辑
   const content = await readFile(filePath, 'utf8');
   // ... parse ...
   
   // 3. populate cache
   this._parseCache.set(key, { mtime: meta?.mtime, result: parsed });
   if (this._parseCache.size > 200) {
     // LRU eviction: delete oldest entry
     const oldest = this._parseCache.keys().next().value;
     this._parseCache.delete(oldest);
   }
   ```

3. **`build()`**：`this._parseCache.clear()` 在全量重构时清空
4. **`updateFiles()`**：不清空 cache（增量更新正是 cache 发挥作用的场景），但对已变更文件 `this._parseCache.delete(key)`

**与 `checkFileChanges()` 双路径的交互**：
- `cache.js` 的 `checkFileChanges()` 已有 fast path（mtime+size）和 slow path（SHA-256）
- ParseCache 的 mtime 检查与 `checkFileChanges()` 独立——ParseCache 是 **builder 内部**的热缓存，`checkFileChanges()` 是 **container pipeline** 的 staleness 检测
- 两者不冲突：container 判断"文件变了没"，ParseCache 判断"这个文件上次 parse 结果还能用不"

**watch 模式生命周期**：
- ParseCache 跟随 `GraphBuilder` 实例生命周期
- REPL/watch 模式下 `GraphBuilder` 是长活的 → cache 在整个 session 中有效
- CLI 单次运行 → cache 在 `build()` → `updateFiles()` 链中生效（"先 impact 再 affected-tests" 的连续调用在同一进程内共享 cache）

---

## 15-4：增量更新终极协议（四层叠加）

### 设计理念

当前 `updateFiles()` ([builder.js:620-858](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/dep-graph/builder.js#L620-L858)) 只处理直接变更文件。问题：

1. **文件 A import B，B 的 exports 变了** → A 的 `importRecords[].resolved` 可能指向错误的目标
2. **文件 C 是 barrel re-export** → C 改了 `export { foo } from './d'`，但 A（消费者）内容不变，A→B 的 stale 边残留
3. **新增文件 shadow 了已有文件** → `foo.ts` 新增后 `foo.js` 的消费者应该指向 `foo.ts`，但旧边残留

**四层叠加协议**：

```
L1 git diff      → 哪些文件物理变了
L2 SHA-256       → 排除内容未变的"假阳性"（mtime 变了但内容没变）
L3 Neighbor-aware → 1-hop 边界扩展 + Shadow Candidate 枚举
L4 WAL Cadence   → SQLite 写入节流（PASSIVE vs TRUNCATE）
```

### 参考借鉴

| 层级 | 参考仓库 | 核心代码 | 关键设计 |
|------|----------|----------|----------|
| L3 | GitNexus [shadow-candidates.ts](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/reference/GitNexus/gitnexus/src/core/incremental/shadow-candidates.ts) | `shadowCandidatesFor(added)` | 新增文件可能 shadow 旧文件：同 basename 不同 ext、bare-file vs directory-index |
| L3 | GitNexus [subgraph-extract.ts](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/reference/GitNexus/gitnexus/src/core/incremental/subgraph-extract.ts) | `computeEffectiveWriteSet()` | 单次遍历全部 edges，boundary-crossing 的 unchanged-side 文件拉入 write set |
| L3 | CGC [watcher.py:206-277](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/reference/CodeGraphContext/src/codegraphcontext/core/watcher.py#L206-L277) | `_handle_modification()` Step 1-7 | **query neighbors BEFORE delete**：先查 callers/inheritors，再 DETACH DELETE，再重解析 subset |
| L4 | qartez [watch.rs:87-141](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/reference/qartez-mcp/src/watch.rs#L87-L141) | `WatcherCadence` | PageRank 30s rate-limit + WAL TRUNCATE 60s rate-limit + batch counter backstop |
| L4 | qartez [watch.rs:303-316](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/reference/qartez-mcp/src/watch.rs#L303-L316) | 分层 checkpoint | 每次增量写 `PRAGMA wal_checkpoint(PASSIVE)`；定时 `TRUNCATE` |

### L1: Git Diff 过滤

**当前状态**：`container.js` 的 `_onFilesChanged()` 通过 `fileIndex` 的 pending queue 收集变更文件列表。这已经是隐式的 L1。

**改进**：在 `updateFiles()` 入口增加显式的 git diff 过滤。当 `--staged` 或 watch 模式触发时，只处理 `git diff --name-only` 报告的文件，而非 fileIndex 的全量 pending（fileIndex 的 chokidar 可能因 metadata 变化误报）。

### L2: SHA-256 过滤

**当前状态**：`updateFiles()` L692 已有 mtime 快速路径。但 mtime 有精度问题（FAT32 2s 精度、某些 CI 工具重写 mtime）。

**改进**：当 mtime 表明文件变了，但 `cache.fileMetadata.hash`（SHA-256）与上次相同时，跳过重解析。这对应 qartez 的 `FileIngestOutcome::Unchanged` 但用更强的内容哈希。

```js
// updateFiles() 现有 fast path 之后，新增 SHA-256 二次确认
const meta = this.dg.cache.getFileMetadata(filePath);
const oldHash = meta?.hash;
if (oldHash) {
  const newHash = computeFileHash(filePath);  // 复用 file-index.js 的 SHA-256
  if (newHash === oldHash) {
    skipped++;
    continue;  // 内容未变，mtime 误报
  }
}
```

### L3: Neighbor-aware 1-hop 扩展

**核心算法**（融合 GitNexus + CGC 两种方案的最佳实践）：

```
输入: changedFiles (git diff 报告的变更文件)
输出: effectiveUpdateSet (实际需要重解析的文件)

1. 对每个 changedFile:
   a. 查 reverseGraph 获取 1-hop dependents（谁 import 了我）
   b. 如果是新增文件：枚举 shadow candidates（同 basename 不同 ext + directory-index）
      → 对命中的 shadow 文件，也查其 dependents 纳入
   c. 记录扩展来源（for logging）

2. effectiveUpdateSet = changedFiles ∪ 1-hop-dependents ∪ shadow-affected

3. 对 effectiveUpdateSet 中的每个文件执行 parseFileOnly + resolveFileOnly
   → ParseCache 会命中未变文件的缓存（L2 SHA-256 过滤后进入 L3 的文件大多未变内容）
   → 只有 import resolution 需要重做（因为依赖目标可能变了）
```

**CGC 关键教训**：**必须在删除旧节点之前查询邻居**（[watcher.py:234-237](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/reference/CodeGraphContext/src/codegraphcontext/core/watcher.py#L234-L237)）。workspace-bridge 的 `_removeOldReverseEdges()` 在 graph.delete 之前调用，已满足此约束。

**GitNexus 关键教训**：`computeEffectiveWriteSet()` 是**单次遍历** edge list（[subgraph-extract.ts:113-121](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/reference/GitNexus/gitnexus/src/core/incremental/subgraph-extract.ts#L113-L121)），不是 per-file BFS。workspace-bridge 用 `reverseGraph.get(key)` 查 dependents 已是 O(1)，更高效。

### L4: WAL Cadence

**借鉴 qartez `WatcherCadence`**（[watch.rs:87-141](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/reference/qartez-mcp/src/watch.rs#L87-L141)）：

```js
// 新增 WalCadence 类（仅 watch/repl 模式生效）
class WalCadence {
  constructor() {
    this.lastTruncate = null;
    this.batchesSinceTruncate = 0;
  }
  
  // 每次 updateFiles 完成后调用
  tick() {
    this.batchesSinceTruncate++;
    const now = Date.now();
    const elapsed = this.lastTruncate ? now - this.lastTruncate : Infinity;
    
    if (elapsed >= 60_000 || this.batchesSinceTruncate >= 32) {
      // TRUNCATE checkpoint: 回收磁盘空间
      this.lastTruncate = now;
      this.batchesSinceTruncate = 0;
      return 'TRUNCATE';
    }
    // PASSIVE checkpoint: 不阻塞，只合并已完成的 pages
    return 'PASSIVE';
  }
}
```

**集成点**：`builder.js` `updateFiles()` 的 `finally` 块中，调用 `cache.walCheckpoint(cadence.tick())` 替代当前的无条件 `cache.save()`。

### Proposed Changes

#### [NEW] [shadow-candidates.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/dep-graph/shadow-candidates.js)

直接移植 GitNexus 的 `shadowCandidatesFor()`，适配 workspace-bridge 的扩展名集合：

```js
const SHADOW_EXTS = ['.d.ts', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'];

function shadowCandidatesFor(addedPath) {
  // (a) 同 basename 不同 ext
  // (b) bare-file beats directory-index
  // (c) directory-index beats bare-file
  // 返回去重的候选路径列表
}
```

#### [NEW] [wal-cadence.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/dep-graph/wal-cadence.js)

移植 qartez 的 `WatcherCadence` 核心逻辑（~40 行）。

#### [MODIFY] [builder.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/dep-graph/builder.js)

**`updateFiles(filePaths)` 重构**（最大改动）：

1. **L2 SHA-256 过滤**：在 mtime 快速路径之后，增加内容哈希二次确认
2. **L3 Neighbor-aware 扩展**：在 parse 循环之前，查 `reverseGraph` 获取 1-hop dependents，合并到 filePaths
3. **L3 Shadow Candidates**：对新增文件（`!oldInfo`），调用 `shadowCandidatesFor()` 枚举 shadow 目标的 dependents
4. **ParseCache 集成**：`parseFileOnly()` 走 cache，扩展的邻居文件如果内容没变会命中缓存
5. **L4 WAL Cadence**：`finally` 块中用 `WalCadence.tick()` 决定 checkpoint 类型

**代码级改动估算**：
- `parseFileOnly()`: +15 行（cache 检查 + 填充）
- `updateFiles()`: +40 行（L2 hash check + L3 neighbor expansion + L3 shadow + L4 cadence）
- 新文件: `shadow-candidates.js` ~50 行，`wal-cadence.js` ~30 行，`ast-rules.js` ~80 行

#### [MODIFY] [cache.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/cache.js)

- 新增 `walCheckpoint(mode)` 方法：执行 `PRAGMA wal_checkpoint(${mode})` 

#### [MODIFY] [graph-db.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/src/services/graph-db.js)

- 新增 `walCheckpoint(mode)` 底层方法

---

## 边界条件与风险

### 15-3 ParseCache 边界

| 边界 | 处理 |
|------|------|
| 文件被外部工具修改（mtime 未更新） | SHA-256 hash 变化时 cache miss，正确重解析 |
| REPL 长时间运行后内存压力 | LRU eviction（maxSize: 200），约 200 × 10KB = 2MB 内存 |
| 并发 watch + CLI | ParseCache 是 per-GraphBuilder 实例，无并发问题 |
| `build()` 全量重构 | 清空 cache，不复用上次的 parse 结果 |

### 15-4 Neighbor-aware 边界

| 边界 | 处理 |
|------|------|
| A→B→C 链式传播（2-hop） | 只做 1-hop。如果 B 被修改，C 不受影响（因为 B→C 的边在 B 的 `resolveFileOnly` 中重建） |
| 删除文件的邻居 | CGC 教训：先查 `reverseGraph.get(deleted)` 获取 dependents，再 delete。当前代码已满足 |
| 新增文件 shadow 旧文件 | GitNexus shadow-candidates 枚举 + 旧文件的 dependents 加入重解析集 |
| 大量文件同时变更（git merge） | ParseCache 会 miss，但 LRU 不影响正确性；性能退化到与当前一样 |
| Java 包级 wildcard import | 现有 `expandJavaPackageImportsIncremental()` 已处理，neighbor-aware 不干扰 |

### L4 WAL Cadence 边界

| 边界 | 处理 |
|------|------|
| CLI 单次运行（非 watch） | 不启用 cadence，保持现有 `cache.save()` 行为 |
| 进程崩溃丢失 WAL 数据 | SQLite WAL 模式保证 crash recovery，不丢数据 |
| Windows NTFS + Defender | qartez 已验证：PASSIVE 远快于 TRUNCATE（TRUNCATE 触发 fsync + Defender 扫描）|

---

## Test Suite

#### [NEW] [wave15-parse-cache-test.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/test/wave15-parse-cache-test.js)

ParseCache 单元测试：
- `testCacheHitOnUnchangedFile`: mtime 不变 → 返回缓存结果，不调用 `readFile`
- `testCacheMissOnMtimeChange`: mtime 变化 → 重新 parse，更新缓存
- `testCacheMissOnHashChange`: mtime 变但 hash 不同 → 重新 parse
- `testLruEviction`: 超过 maxSize 后最旧条目被淘汰
- `testCacheClearOnFullBuild`: `build()` 后 cache 为空
- `testCachePreservedOnUpdateFiles`: `updateFiles()` 不清空整体 cache

#### [NEW] [wave15-neighbor-aware-test.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/test/wave15-neighbor-aware-test.js)

Neighbor-aware 集成测试：
- `testDependentRelinkedAfterExportChange`: B 改了 exports → A（B 的 dependent）的边正确更新
- `testShadowCandidateOnNewFile`: 新增 `foo.ts` → `foo.js` 的消费者边正确迁移
- `testDeletedFileCleanup`: 删除 B → B 的 dependents 重解析后不再引用 B
- `testBarrelReexportChange`: C 从 `export from './b'` 改为 `export from './d'` → A 的边更新
- `testNoExpansionForIsolatedFile`: 修改无 dependents 的叶子文件 → effectiveSet 大小不变

#### [NEW] [wave15-shadow-candidates-test.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/test/wave15-shadow-candidates-test.js)

Shadow Candidates 单元测试：
- `testSameBasnameDifferentExt`: `foo.ts` → 枚举 `foo.js/foo.jsx/foo.tsx/...`
- `testBareFileShadowsDirectoryIndex`: `foo.ts` → 枚举 `foo/index.ts/index.js/...`
- `testDirectoryIndexShadowsBareFile`: `foo/index.ts` → 枚举 `foo.ts/foo.js/...`
- `testNonJsExtReturnsEmpty`: `foo.py` → 空数组（不适用 JS/TS shadow 规则）

#### [NEW] [wave15-wal-cadence-test.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/test/wave15-wal-cadence-test.js)

WAL Cadence 单元测试：
- `testFirstTickReturnsTruncate`: 首次 tick → TRUNCATE
- `testSubsequentTicksReturnPassive`: 后续 tick 在 60s 内 → PASSIVE
- `testTruncateAfterInterval`: 60s 后 tick → TRUNCATE
- `testBatchCounterBackstop`: 32 次 PASSIVE 后 → 强制 TRUNCATE

#### [NEW] [wave15-ast-rules-test.js](file:///c:/Users/sdses/Desktop/随机小项目/workspace-bridge/test/wave15-ast-rules-test.js)

AST 规则单元测试：
- `testBatchNoTransactionalFires`: `batch*` 方法无 `@Transactional` → finding
- `testBatchWithTransactionalSkipped`: 有注解 → 不触发
- `testCustomRuleViaConfig`: 外部配置注入自定义规则
- `testRuleLanguageFilter`: Java 规则不应用于 Python 文件

---

## Verification Plan

### Automated Tests
```bash
# 新增测试
node test/wave15-parse-cache-test.js
node test/wave15-neighbor-aware-test.js
node test/wave15-shadow-candidates-test.js
node test/wave15-wal-cadence-test.js
node test/wave15-ast-rules-test.js

# 回归
npm run test:fast    # 期望 95+5=100 PASS
npm run test:smoke   # 期望 98+5=103 PASS
```

### Manual Verification

1. **ParseCache 效果验证**：
   ```bash
   # 连续运行，第二次应显著快于第一次
   node cli.js impact --cwd . --file src/services/dep-graph/builder.js --json --quiet
   node cli.js affected-tests --cwd . --file src/services/dep-graph/builder.js --json --quiet
   ```

2. **Neighbor-aware 正确性验证**：
   ```bash
   # 修改一个被多文件 import 的模块后，检查 dependents 的边是否更新
   node cli.js audit-diff --cwd . --json --quiet
   ```

3. **WAL Cadence 验证**（watch 模式）：
   ```bash
   node cli.js watch --cwd .
   # 观察日志中 PASSIVE/TRUNCATE checkpoint 的交替出现
   ```

---

## 执行顺序

1. **15-3 ParseCache** → 最小改动，最大收益，为 15-4 铺路
2. **15-4 L1-L2**（git diff + SHA-256）→ 过滤层，减少无用重解析
3. **15-4 L3**（Neighbor-aware + Shadow Candidates）→ 正确性提升，依赖 ParseCache 抵消性能代价
4. **15-4 L4**（WAL Cadence）→ watch 模式优化
5. **15-1 AST 规则** → 独立功能，不依赖其他项
