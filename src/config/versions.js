/**
 * Schema and cache version constants.
 */
// CLI/API schema version. Increment when JSON output structure changes.
const SCHEMA_VERSION = '1.2.0';

// Cache schema version. Increment when persistent cache structure changes.
// Both WorkspaceCache (JSON fallback) and GraphDB (SQLite) must use the same version.
// v5: L1-3 — tier3 same-package edges no longer count as export usage;
//     persisted deadExports aggregates computed under v4 semantics are stale.
// v6: test_map precompute depth unified with query default (3 → CONFIG.DEFAULT_MAX_DEPTH);
//     maps stored under v5 miss import rows at distance 4-5 and carry sentinel 4.
//     analysis_snapshots rows now carry a per-row cache_version stamp; unstamped
//     (pre-v6) snapshots are rejected on load instead of short-circuiting overview.
// v7: Pre-scan Global Symbol Mapping (Pilot). export_records stores top-level declarations with isExported: false.
// v8: review fix — restores the CJS ObjectMethod export branch (v7-era caches
//     miss shorthand-method exports and carry duplicate ObjectProperty records).
// v9: symbol-table resolution no longer guesses at specifiers npm owns. v8-era
//     caches persist those fabricated edges (209 of this repo's own 1219, all
//     from `require('path')` hitting a re-exported `path` binding) and would
//     serve them as fresh.
// v10: 外部依赖闸扩到 Rust（std/core/alloc 前缀 + Cargo.toml 声明的 crate）。
//      v9 缓存里存着 reference/qartez-mcp 那 48 条 std::/rmcp::/tokio:: 假边。
// v11: 外部依赖闸扩到 Python（标准库根段 + requirements.txt/pyproject.toml
//      声明的包，PEP 503 归一 + 常见包名/导入名别名）。v10 缓存里 Python 仓
//      的 symbol-table 边可能混着 import requests → 本地同名模块的假边。
// v12: 外部依赖闸扩到 Go。Go import 永远带完整路径，归属是确定的：module
//      路径之外的一切（dotted 首段 = 外部模块，无点首段 = 标准库）不再猜。
// v13: L2-12 清零——super:: 模块算术修正（非 mod 文件首个 super 不爬升）+
//      crate:: 锚定最近 Cargo.toml。qartez-mcp 实测 153 条 symbol-table 边
//      转 tier1，另 82 条原先连猜都猜不出的 import 首次成边。
// v14: L1-4 修复——C/C++ 首次产边（tryCppInclude：引号形式相对包含文件 +
//      include/src 回退；尖括号形式不解析不猜）。旧缓存里 C/C++ 仓是 0 边，
//      且混仓里 C/C++ 部分静默丢边，必须作废重建。
// v15: 外部依赖闸补 Svelte 腿——.svelte 进 JS_FAMILY_EXTENSIONS。SvelteKit
//      项目里 svelte/store 等导入此前会被猜向本地同名符号。
// v16: 外部闸接上 registry 的 isBuiltIn 声明——java./javax./kotlin. 标准库
//      前缀不再被猜向本地同名类（L2-11 JVM 腿的内建半、L3-6 清零）。
// v17: Python 标准库名单补漏——__future__ / tomllib / zoneinfo（L2-11 缺口 B）。
//      v16 缓存里 Python 仓可能有 from __future__ import ... 猜向本地
//      同名符号的假边；CodeGraphContext 实测 70 条丢弃里 __future__ 占约一半。
// v18: JS 外部闸读 manifest 链（L2-11 缺口 A）——从导入方文件向上到工作区根
//      逐层读 package.json（含 node_modules 探测），不再只读根的。v17 缓存在
//      monorepo 仓（zod 型）存着子包 deps 的假丢弃与潜在假边。
// v19: JVM 零名单闸（L2-11 缺口 C）——仓内包前缀集合之外的一切 = 外部
//      （java./javax./kotlin. 标准库仍走 registry isBuiltIn）。v18 缓存里
//      JVM 仓存着第三方假边（okhttp 实测 83 条：org.junit/assertk/okio 等
//      猜向本地同名类）与第三方 import 的假丢弃（spring-petclinic 362 条）。
// v20: Rust crate 名归一 + member manifest（L2-16）——own-crate 路径
//      （`qartez_mcp::…`，[lib] name 优先、[package] name 按 Cargo 规则
//      '-'→'_'）按 crate:: 同构解析；外部闸读导入方所属 crate 的最近
//      Cargo.toml。v19 缓存里 Rust 仓存着 own-crate 的假丢弃与符号表假命中
//      （qartez-mcp 152 条丢弃 / 167 条 symbol-table，同一缺口两侧），及
//      member manifest 声明依赖的假丢弃（axum/tower/http 等）。
// v21: Rust parser 花括号列表关键字前缀（L2-18）——tree-sitter 把列表前缀的
//      super/self/crate 发成独立节点类型，旧抽取只认 identifier 系，把
//      `use super::{a,b}` 抽成 `::a`。同刀补齐列表内嵌套 scoped 项
//      （`use crate::{config::X}`）与 reexport 名单的嵌套项。v20 缓存里
//      Rust 仓存着 22 条 `::ident` 假丢弃（qartez-mcp 实测）。
// v22: Rust 裸首段 use 按当前模块作用域解析（L2-19）——tryRustScoped：
//      2018+ `use grounding::X` 首段 = 当前模块的子模块（mod.rs/lib.rs/
//      main.rs 的子模块在旁侧目录，其他文件的在 <stem>/ 下）。v21 缓存里
//      Rust 仓存着 12 条裸首段假丢弃（qartez-mcp 实测）。
// v23: Python PEP 420 namespace 包（L2-17）——`from PKG import X` 中 PKG
//      是无 __init__.py 的目录时，X 绑定子模块 PKG/X（tryPythonAbsolute/
//      tryPythonRelative 双侧，builder 把 record.imported 穿进 extraCtx）。
//      v22 缓存里 Python 仓存着 namespace 假丢弃（CodeGraphContext 实测
//      6 条 codegraphcontext.* + 2 条相对导入点号形状）。
// v24: Python absolute 两遍搜索——namespace 兜底是对全部 searchRoots 的兜底，
//      不是逐 root 短路：v23 下单循环让前位 root 的弱证据（恰好持有同名文件
//      的 namespace 目录）压过后位 root 的真 __init__.py（src-layout 仓根
//      残留同名目录即此形状）。v23 缓存里此类仓存着指错目标的 tier1 边。
// v25: JVM 源根发现支持 KMP/非标 Gradle 布局 + 成员导入逐段剥尾（L2-14）——
//      扫描 src/<sourceSet>/{kotlin,java}（sourceSet 名任意，按叶名识别）；
//      tryJava 对越过类名的指定符（Companion 成员 / 嵌套类）剥尾到首个命中。
//      v24 缓存里 KMP 仓（okhttp 型）存着大量 symbol-table 兜底边与假丢弃，
//      结构解析覆盖后这些应变成 java-package tier1 边（实测 st 937→111）。
// v26: JVM 多模块源根扫描下潜到二层——`samples/` 这类自身无 src 的纯容器目录
//      持有平级模块，止步 root+1 会把它们整批漏掉。v25 缓存里这些仓存着由
//      symbol-table 兜底的 tier2 边（okhttp 实测 10 条，类名与文件名精确相等，
//      纯结构缺口），结构解析补齐后应变成 java-package tier1 边。
// v27: T6 — JS 家族（含 vue/svelte）与 Python 链摘掉 symbol-table 兜底
//      （六仓实测零真产出，判决见 CHANGELOG）。v26 缓存里 JS/Python 仓的
//      symbol-table tier2 边（闸漏时猜出来的）应变成 droppedImports 记账。
const CACHE_VERSION = 27;

module.exports = { SCHEMA_VERSION, CACHE_VERSION };
