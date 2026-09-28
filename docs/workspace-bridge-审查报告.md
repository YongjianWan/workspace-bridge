# workspace-bridge 审查待处理项

- 当前开放问题以第 4 节为准；已修复内容见 [CHANGELOG.md](../CHANGELOG.md)。
- 验证环境与命令见 [SESSION.md](../SESSION.md)。
- 问题证据使用第 1 节的固定仓库和 `test/` 下的复现用例。

---

## 0. 使用与验收

- 活跃问题见第 4 节；已完成的修复经过只查 [CHANGELOG.md](../CHANGELOG.md)。
- `test/wb-repro.js` 是自动复现门禁，`node test/wb-repro.js cli.js [用例ID ...]`；`node eval/score.js` 使用固定语料和实时查询评测 affected-tests。脚本通过不能替代第 4 节的手工验收。
- 修问题时先复现，修完跑对应测试、全量复现门禁和项目回归。不要为了通过而改动复现用例的正确行为定义；若定义有争议，先确认。
## 1. 固定评测仓库

下表版本用于复测当前开放问题。评测工具用法见 [eval/README.md](../eval/README.md)。

| 仓库 | 语言 | 版本 | 用途 |
|---|---|---|---|
| https://github.com/Enishiya770/NeEEvA | Python + C# | `0e2cea7ad2` | 最初的扫描对象 |
| https://github.com/DaveGamble/cJSON | C | `6d9f2443ab` | 死代码误报 |
| https://github.com/fastapi/full-stack-fastapi-template | Python + TS | `cb740b656d` | 死代码、api-contracts、语言开关 |
| https://github.com/charmbracelet/glow | Go | `6b365eea95` | 死代码、Go 包模型 |
| https://github.com/sharkdp/hexyl | Rust | `6ecc29b9c8` | 死代码、Rust 模块树 |
| https://github.com/spring-projects/spring-petclinic | Java | `818c4136ea` | 死代码、同包完全图 |
| https://github.com/antfu-collective/vitesse | TS + Vue | `8a01bc9283` | 死代码 |
| https://github.com/tiangolo/typer | Python | `a80f6e5ecd` | affected-tests 精确率/召回率、环检测 |
| https://github.com/django/django | Python | `a013c821ea` | 性能、缓存体积、验证命令 |

这 9 个仓库已按上表版本收进 [eval/corpus.json](../eval/corpus.json)，另按语言补充了 9 个，共 18 个；接入 nightly CI 尚未做（方案见 eval/README.md「CI 建议」）。

---

## 2. 当前判断与方向

自动复现门禁不能证明真实仓库的精确率和召回率。开放风险集中在死代码误报、affected-tests、验证命令、输出规模和跨语言边界，详见第 4 节。

- **能力分级**：按语言与功能分别声明可用范围和置信度；遇到未覆盖语法或框架时显式降级。
- **真值评测**：用固定仓库、人工标注和 coverage 结果验收改动；`test/wb-repro.js` 负责守住已经复现的行为。
- **模块单位抽象**：评估包、头文件与实现文件、测试 fixture 等超出单文件依赖图的单位；先以开放问题为依据验证收益。
- **LSP 高精度模式**：仅作为待验证方向，先比较准确率、启动成本与维护负担，再决定是否接入。
## 3. 当前语言验证重点

| 语言 | 仍需验证或修复的点 |
|---|---|
| JS/TS | 无插值模板字符串动态导入（P1-13）；生成客户端的 API 契约识别（P1-14） |
| Python | affected-tests 精确率的剩余噪声是图可达性过度预测：typer 精确率 0.60、召回率 0.98，误报全是真实测试文件，只有符号级映射能再压（未立项） |
| C/C++ | 孤儿检测里无配对头的独立程序（`test.c` 带 `main`、fuzzer 入口）仍被判孤儿 |
| Java、Kotlin、Go、Rust、Vue、Svelte | 本表没有未解决的语言专属复现；仍须用固定仓库复测，不能据此宣称完整语义覆盖 |

语言注册与 AST 能力的当前说明见 [AGENTS.md](../AGENTS.md)，真实仓库结果见第 5 节。
## 4. 问题清单

### P0：会让 agent 做出错误动作

当前无开放项。

### P1：可信度和可用性

| ID | 当前问题 | 下一步验证 |
|---|---|---|
| P1-14 | `api-contracts` 对生成客户端代码的 `client.post`、`__request` 等调用模式覆盖不足，可能漏报前后端契约关联。 | 在固定前后端夹具中分别加入两种调用，先复现漏报，再扩充匹配并验证误报。 |

### P2：工程卫生

| ID | 问题 | 验证 |
|---|---|---|
| P2-3 | 有测试在断言源码文本（比如"不能出现 `?.`"），这其实是 lint 规则。已确认：`test/wave5-boundary-hardening-test.js`、`test/content-signature-trust-test.js`；粗算上限约 12 个 | 打开这两个文件看写法，再全局搜同样模式 |
| P2-6 | `guard` 检查没通过和运行出错都返回 1，CI 分不清 | 给"没通过"单独一个退出码 |
| R-3 | `gitignore.js` 在子目录分析时的仓库根判定待复核。 | 用子目录作为 `--cwd` 运行 `git rev-parse` 与忽略规则复现，核对输出根目录。 |
| R-4 | submodule 路径可能让 `git check-ignore` 返回 128，导致忽略判断不完整。 | 在含 submodule 的固定夹具中复现退出码及工具警告，再决定降级或路径处理。 |
| P2-7 | 开发依赖漏洞：`tar`（critical）、`brace-expansion`（high），影响构建和发布流水线 | `npm audit` |
| P2-8 | 仓库里提交了 `.claude/settings.local.json`；`reference/` 有 430KB zip 和 docx | `git ls-files .claude reference` |
| P2-9 | `diagnostics --mode full`、`stats --format markdown` 和已 deprecated 的 `health` 命令价值存疑。 | [手工] 分别执行命令，核对 `checksRun`、Markdown 内容与 `audit-summary.health` 是否重复；空转命令删除或合并，损坏格式修复后再决定保留。 |
| P2-10 | 语言注册抽象泄漏：Kotlin 的逻辑散在 20 个文件（ast-rules、framework-patterns、orphan-detector、test-detector、overview-assembler 等） | `grep -rln "\.kt\b\|'kotlin'" src \| wc -l`。在加 C# 之前处理 |
| P2-11 | 测试中的 git 操作可能修改仓库级提交身份。 | [手工] 检查测试前后 `git config --local --get user.name` 与 `user.email` | 测试 git 操作限制在临时仓库，身份通过环境变量注入。 |
| P2-12 | 文档仍可能重复记录状态和历史，增加维护成本。 | [手工] 核对 AGENTS、SESSION、ROADMAP、TECH_DEBT、审查清单是否只存当前信息 | 完成项只留 CHANGELOG；活跃文档修复即删。 |

---

## 5. 真实仓库验收入口

- `dead-exports`：以 [eval/labels/](../eval/labels/) 的人工标注逐条核对 high 级告警，特别检查公开 API、auto-import、宏和动态注册。
- `affected-tests`：按 [eval/README.md](../eval/README.md) 的 typer coverage 真值计算精确率与召回率，记录漏报文件及其真实测试集。
- 缓存与启动性能：固定 Django `a013c821ea`、Windows/Node 25.6.0、独立空缓存各跑一次 `node cli.js audit-overview --cwd <django> --cache-dir <temp> --json --quiet`：冷 56.5 秒、暖 19.8 秒，缓存 11.3 MB；两次均为 2977 文件、覆盖率 1、fallback 3、unresolved 1、dropped 4、warnings 2。本轮未测 RSS 峰值，耗时为单次数据，不当作稳定性能结论。
## 6. 没有覆盖到的（需要在工作电脑上确认）

**Windows 特有边界（仍需专项验证）**

1. 路径大小写：`--file SRC\Main.py` 和 `src/main.py` 能否认成同一个文件
2. 反斜杠、盘符大小写（`C:\` / `c:\`）、UNC 路径、超过 260 字符的路径
3. CRLF 换行（`core.autocrlf=true`）
4. 缓存目录在 OneDrive 等同步盘里时 SQLite WAL 是否正常
5. `setup-global-cli.ps1` 在受限执行策略下能否运行
6. 在 Windows 上跑 `node test/wb-repro.js cli.js`，再针对上面的路径与文件系统边界补专项用例；门禁通过不代表这些边界已覆盖。

**其他**

7. `pkg` 打包的二进制（package.json 里配了，没打包测试）
8. 超过 1 万个文件的仓库（最大只测到 Django 约 3000 个）
9. `audit-overview --with-history` 的热点、知识风险、稳定性趋势：只确认了能跑、作者统计与 `git blame` 一致，没评估分数本身是否有意义
10. `guard`、`tree`、`affected-routes`、`audit-boundaries`、`audit-smells`、`audit-map` 的数值正确性没有逐个核对（它们依赖图的正确性，应在真实仓库上核对）
11. `scripts/workflow-loop.js` 对含 shell 元字符的命令用 `shell: true` 执行，命令来自用户自己的 `.workflow-task.json`，设计上可以接受，没深入审查

---

## 7. 当前修复顺序和验收

1. 先复现并处理 P1-14 的生成客户端调用漏报，再处理 R-3、R-4 的 gitignore 边界；缓存暖启动成本见 TECH_DEBT.md L3-15。
2. 其余开放项按第 4 节逐条复现；每完成一项，就从活跃清单删除，并在 CHANGELOG 记录改动、原因和验证。

每轮收工执行 `node test/wb-repro.js cli.js`、`npm run test:fast`；涉及真实仓库结果时按 [eval/README.md](../eval/README.md) 复测。
