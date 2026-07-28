# reference/ — 测量基准仓编制

外部开源项目的本地克隆（`--depth 1`），用作 resolver 精度基准（`scripts/resolver-precision.js`）
与 dogfood 样本。**不进父仓 git**（见本目录 `.gitignore`），可随时 `git pull` 更新或整个删掉重克。

选择标准：真实项目（非 fixture 合集）、有 manifest、中小型、相对知名、尽量活跃。

## 编制（13 仓 / 9 语言）

| 仓 | 语言 | 体量 | manifest | 闸状态 |
| --- | --- | --- | --- | --- |
| GitNexus | TS（另含 Java/Kotlin/Rust fixture，勿当 JVM 基准） | ~2000 ts | package.json | ✅ 有闸 |
| zod | TS | 372 ts | package.json | ✅ |
| execa | JS/TS | 446 js | package.json | ✅ |
| CodeGraphContext | Python | 284 py | pyproject.toml | ✅ |
| code-review-graph | Python | 153 py | pyproject.toml | ✅ |
| qartez-mcp | Rust | 233 rs | Cargo.toml（多 crate 工作区） | ✅ |
| cobra | Go | ~470 KB Go | go.mod | ✅ |
| spring-petclinic | Java | 135 KB Java | pom.xml | ❌ 无闸，先补闸再测 |
| okhttp | Kotlin | 4.1 MB Kotlin | Gradle | ❌ 同上 |
| cJSON | C | 712 KB C | — | ❌ 同上 |
| fmt | C++ | 2.5 MB C++ | — | ❌ 同上 |
| vue-realworld-example-app | Vue | 42 KB Vue | package.json | ❌ 同上 |
| realworld (sveltejs) | Svelte | 21 KB Svelte | package.json | ❌ 同上 |

## 纪律

- **没有闸的语言，precision 数据不可信**（假边混在命中数里）。无闸仓先入编、后补闸、再测量。
- 文档里引用的测量数字对应测量时的快照；`git pull` 更新后旧数字即成为历史口径，
  引用时注意日期（TECH_DEBT L2-10 判决表带数据新鲜度列）。
- GitNexus 仓内的 `.java`/`.kt`/`.rs` 文件是该工具的测试 fixture，不构成真实项目模块结构，
  JVM 精度基准只用 spring-petclinic / okhttp。

取数：`node scripts/resolver-precision.js reference/<repo> [...]`（逐个点名，勿用 `reference/*`
通配——本目录还混着文档类非仓文件）。
