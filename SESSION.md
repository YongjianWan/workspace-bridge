# SESSION.md

> 新会话启动指南。通用项目信息见 [AGENTS.md](./AGENTS.md)，历史变更见 [CHANGELOG.md](./CHANGELOG.md)，长期路线见 [ROADMAP.md](./ROADMAP.md)。
>
> **定位：个人项目，写得开心最重要。功能按需扩展，不自我设限。**

---

## 本轮会话 (2026-09-25 房务轮：push + 串围标仓清理 + SESSION 历史归档）

### 本轮完成

1. workspace-bridge 侧房务：`scratch-gitnexus-summary.json` 删除（AGENTS 陷阱表点名的实验脚本残留）；本地 8 笔未 push 全部推送（`30881ba..7f2fd72`）。
2. 串围标仓（`神思/project/串围标智能体`）按其 AGENTS.md §二.15「确需删除由人发起」（Aiden 拍板）：`nul` 垃圾文件（46B）删除；14 个 `data/` 消失文件 `git checkout -- data/` 还原（只创建不删除）；`data/_recover-20260915/__pycache__/` 删除。
3. SESSION 历史归档：按「历史只进 CHANGELOG」原则，2026-07 时代五个存档块（路线 A-F 战略讨论 / 参考仓库探索四仓摘要 / Route B 验证详表 / 候选方向收口 / 架构判断校准记录）逐块核实等价覆盖后从 SESSION 删除，收编记录见 CHANGELOG [Unreleased] 2026-09-25 首条。框架检测矩阵留在本文档——它是能力快照不是历史。

### 下一轮入口

1. **串围标仓两笔挂账**：requirements 两处声明（`requirements-dev.txt` +`numpy` / pdf-toc-extraction-v2 +`opencv-python`，diff 已过目合理）等 Aiden 提交口令，按 §二.14 显式路径提交；`.git` 1.6G 历史瘦身方案备好（filter-repo 剥 `data/` 产物 + 双远端 force push）但**建议暂缓**——历史重写不可逆，intranet 远端依赖未确认前不动。
2. L3-4 扩展名分支 / L3-11 双 freshness 分歧 / L3-12·13 测试基建 / L3-8 同族 65 处——全部触发式，改到再修，见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)。
3. 双胞胎 sys.path 平手案例：不立案不排期（已结）。

---

## 上一轮会话（2026-09-24 五轮，L3-8 点名实例收口 + 「修复即删」清理二轮）——详见 CHANGELOG [Unreleased] 同日条目

---

## 上一轮会话（2026-09-24 四轮，TECH_DEBT 销账清理 + L2-23 findWorkspaceRoot 定根语义）——详见 CHANGELOG [Unreleased] 同日条目

---

## 上一轮会话（2026-09-24 三轮，双胞胎就近消歧批）——详见 CHANGELOG [Unreleased] 同日条目

---

## 上一轮会话（2026-09-24 二轮，Python 解析缺口批：module-index + manifest 链 + fitz 别名）——详见 CHANGELOG [Unreleased] 同日第二条

---

## 上一轮会话（2026-08-28，L3-10 纯 C 探测 + L3-16 tsconfig extends 继承 + L3-12/13 测试分层优化）——详情见 CHANGELOG 2026-08-28 条目与 git `36b76a4`

---

## 新会话启动检查表（确认状态即可，不用跑 runner）

> **定位**：workspace-bridge 是**AI 的代码脚手架**，不是人类审计工具。CLI 负责策展（预组装、去噪、按优先级排序），skill 负责驾驶手册（什么时候用/不用/标准工作流）。
>
> **🔴 开工前不读 CHANGELOG.md**。确定现状只需读本文档 + AGENTS.md + TECH_DEBT.md + 下方 1 条基线命令。CHANGELOG 是历史存档，读它不能替代读活跃文档。
>
> 收工时已跑 `npm run test:fast` 并确认 fast 层全绿，开工无需重跑。全量 runner 状态见下方「基线状态」。直接读取下方「基线状态」确认当前文档记录是否仍成立。
>
> 开发迭代推荐 `npm run test:fast`（~20s，177 个 fast 层测试，2026-09-24 实测），比全量 runner（~5min）快 15×。

```bash
# 1. 快速自审（1 秒确认，不用等 runner，不读 CHANGELOG）
node cli.js audit-overview --cwd . --json --quiet
# 期望（2026-09-24 实测，顶层字段）：hotspots.length>0, knowledgeRisk.disabledReason='history-not-enabled'（默认）, orphans.counts.total>=0, deadExports.deadExportsCount>=0, unresolved.unresolvedCount=0, cycles.cyclesCount>=0, analysisCoverage.totalFiles≈473, analysisCoverage.coverageRatio=1
```

**如果 audit-overview 异常 → 再跑 `node test/runner.js` 定位失败测试；否则直接开工。**

> 历史变更见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

## 新会话默认动作（如果用户未指定方向）

1. **读取基线状态**（30 秒）：确认 `audit-overview` 输出正常（hotspots / knowledgeRisk / deadExports / unresolved / cycles）
2. **查看当前活跃债务**：[docs/TECH_DEBT.md](./docs/TECH_DEBT.md)（2026-09-24：活跃债务 5 项 = L3-4 / L3-8〔纪律〕/ L3-11 / L3-12 / L3-13；L1=0 / L2=0 / 架构债务=0，明细以 TECH_DEBT 总览表为准）

---

## 基线状态

- 测试：**全量 runner 277 选 274**（2026-09-24；红 = wave15 两条已知 libuv 基线 `3221226505`〔单独跑断言全过〕+ `git-environment-probe-test` 超时边缘 flaky〔常态 150~180s 骑 runner 180s 上限，单独复跑 136s 全过，有 2026-08-28 同款前科〕）；`npm run test:fast` **177 选 175 过 + 2 已知 libuv flaky**（2026-09-24；同两条 wave15）。回归判据：与该基线对照无新增红。开发迭代首选 `npm run test:fast`。
- CI：**GitHub Actions `Test` workflow 在 Node 22/24 矩阵上全部通过**（`test:fast` + `test:smoke`）；新增独立 `coverage` job 跑 `npm run test:coverage:check`（门槛：lines/statements ≥72%，functions ≥70%，branches ≥68%）。
- 版本：**v2.1.0**（以 `package.json` 为准）
- 分支：`main`
- 自身项目规模：473 文件（以 `audit-overview` 实测为准，2026-09-24）
- 结构性指标（2026-09-24 实测）：deadExports=4，cycles=0，unresolved=0，orphans=0；overview 维度：hotspots=10，knowledgeRisk 默认 `disabledReason: 'history-not-enabled'`，`--with-history` 启用
- 架构债务：**活跃债务全部清零**（2026-07-23，L1-3 于本日关闭，详见 [docs/TECH_DEBT.md](./docs/TECH_DEBT.md)）。
- 语言覆盖：9 种（JS/TS、Python、Java、Kotlin、Go、Rust、C/C++、Vue、Svelte）
- AST 覆盖：**9/9 语言全部 AST**，自身项目 coverageRatio=1.00
- Schema 冻结：**核心子集 `{ ok, error, severity, summary }` + `schemaVersion: "1.2.0"` 已冻结**
- 缓存：**SQLite 持久化**（`os.tmpdir()/workspace-bridge/<hash>/cache.db`），项目间隔离（按 workspaceRoot md5 hash 分目录），支持 `--cache-dir` 覆盖
- **SHA-256 内容哈希**：`file-index.js` 解析时计算 SHA-256 存入 `fileMetadata.hash`；`cache.js` `checkFileChanges()` 双路径（fast: mtime+size / slow: SHA-256 精确校验）
- **Co-change**：`impact` 命令已输出 `coChanges[]`；`git -C` 方案解决 Windows 中文路径兼容；性能 ~20s→76ms

**历史交付**：路线 A–J 全部完成；阶段 1/2/3 全部完成；Wave 1-15 全部完成；L2 债务清零；产品债务清零。详见 [CHANGELOG.md](./CHANGELOG.md) [Unreleased]。

---

### 多语言框架检测与路由提取支持矩阵（能力快照，非历史；有框架新增/退役时更新）

| 语言   | 框架                              | 框架检测方式                                                                             | 已有 route-extraction query？                                                 |
| :----- | :-------------------------------- | :--------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| JS/TS  | NestJS                            | regex (`AST_PATTERNS`)                                                                 | ✅`js-nestjs.js`                                                            |
|        | Vue / Vue-router                  | ✅ AST-Query (`js-vue.js`)                                                             | ❌                                                                            |
|        | Nuxt                              | 路径推断 + route query                                                                   | ✅`js-nuxt.js`                                                              |
|        | SvelteKit                         | 路径推断 + route query                                                                   | ✅`js-sveltekit.js`                                                         |
| Python | Django / FastAPI / Flask / Celery | ✅ AST-Query (`py-django.js` / `py-fastapi.js` / `py-flask.js` / `py-celery.js`) | ✅ Django / FastAPI (`py-django.js` / `py-fastapi.js`); ❌ Flask / Celery |
| Java   | Spring / Spring Boot              | ✅ AST-Query (`java-spring.js` / `java-spring-boot.js`)                              | ✅`java-spring.js`                                                          |
|        | Quartz                            | regex                                                                                    | ❌                                                                            |
|        | MyBatis                           | regex                                                                                    | ❌                                                                            |
| Kotlin | Spring-Kotlin                     | ✅ AST-Query (`kt-spring.js`)                                                          | ❌（复用 Java route）                                                         |
|        | Ktor                              | ✅ AST-Query (`kt-ktor.js`)                                                          | ❌                                                                            |
| Go     | Gin                               | ✅ AST-Query (`go-gin.js`)                                                             | ✅`go-gin.js`                                                               |
|        | Echo                              | ✅ AST-Query (`go-echo.js`)                                                             | ❌                                                                            |
|        | Fiber                             | ✅ AST-Query (`go-fiber.js`)                                                             | ✅`go-fiber.js`                                                             |
| Rust   | Actix-web                         | ✅ AST-Query (`rs-actix.js`)                                                           | ✅`rs-actix.js`                                                             |
|        | Axum                              | ✅ AST-Query (`rs-axum.js`)                                                           | ✅`rs-axum.js`                                                              |
|        | Rocket                            | ✅ AST-Query (`rs-rocket.js`)                                                           | ❌                                                                            |
| C/C++  | 无特定框架标签                    | 纯路径推断                                                                               | ❌                                                                            |
| Svelte | Svelte / SvelteKit                | ✅ AST-Query (`js-svelte.js`)                                                          | ✅`js-sveltekit.js`                                                         |
| Vue    | Vue 组件 / Vue-router             | ✅ AST-Query (`js-vue.js`)                                                          | ❌                                                                            |

---

## 修复流程

详见 [AGENTS.md §验证与调试](./AGENTS.md#验证与调试） 与 §Agent 认知边界。

---

## 实战基地

> `C:\Users\sdses\Desktop\神思\code` 是 workspace-bridge 的实战基地，内含四个仓库，用于功能验证与实战演练。

---

*Last updated: 2026-09-25（本轮上下文见文首「本轮会话」；2026-07 时代历史存档已按「历史只进 CHANGELOG」收编，见 CHANGELOG [Unreleased] 2026-09-25 首条。基线状态数字仍按 2026-09-24 实测。）*
