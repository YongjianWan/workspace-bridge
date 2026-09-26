# workspace-bridge 审查待处理项

- 当前开放问题以第 4 节为准；已修复内容见 [CHANGELOG.md](../CHANGELOG.md)。
- 验证环境与命令见 [SESSION.md](../SESSION.md)。
- 问题证据使用第 1 节的固定仓库和 `test/` 下的复现用例。

---

## 0. 使用与验收

- 活跃问题见第 4 节；已完成的修复经过只查 [CHANGELOG.md](../CHANGELOG.md)。
- `test/wb-repro.js` 是自动复现门禁，`node test/wb-repro.js cli.js [用例ID ...]`；`test/eval_affected_tests.py` 是 affected-tests 真值评测。脚本通过不能替代第 4 节的手工验收。
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
| Python | affected-tests 精确率、测试文件识别、Django runner（P0-11/12/14） |
| C/C++ | 头文件与实现文件配对、宏误判为导出（P1-12） |
| Java、Kotlin、Go、Rust、Vue、Svelte | 本表没有未解决的语言专属复现；仍须用固定仓库复测，不能据此宣称完整语义覆盖 |

语言注册与 AST 能力的当前说明见 [AGENTS.md](../AGENTS.md)，真实仓库结果见第 5 节。
## 4. 问题清单

### P0：会让 agent 做出错误动作

| ID | 问题 | 验证 | 根因位置 | 修复方向 |
|---|---|---|---|---|
| P0-6 | `dead-exports` 的 high 级误报仍覆盖 `import.meta.glob`、auto-import、配置文件、库公开 API 和 C 宏等形态。 | [手工] 用 `eval/labels/` 的 27 条真值复核各语言告警 | 静态引用模型未覆盖动态注册与公开 API | 按能力覆盖降低置信度；未核准的公开 API 不给 high。 |
| P0-11 | affected-tests 的测试集仍需用固定仓库真值复测；旧数字不能证明当前精确率或召回率。 | [手工] 按 `eval/README.md` 运行 typer coverage 真值评测 | 当前影响映射的真实误报与漏报分布未测 | 记录精确率、召回率和漏报文件，再决定是否引入符号级映射。 |
| P0-12 | 受影响测试里混进非测试文件：typer 里 `typer/testing.py`（库代码）、`tests/atomic_write_example.py` 被当成测试；Django 里 `tests/**/models.py` 被放进 pytest 命令 | [手工] 看 typer 上 `affected-tests --file typer/models.py` 的输出 | 测试文件判断太宽：路径里有 test 就算 | 按 runner 的规则识别（pytest 的 `test_*.py` / `*_test.py`，Django 的 `tests.py` 等） |
| P0-14 | 验证建议给了错误的 runner：Django 仓库建议 `pytest ...`（实际用 `tests/runtests.py`） | [手工] `audit-file --cwd <django> --file django/db/models/query.py --quiet` | `utils/stack-detectors/commands.js` | 识别不出 runner 时不要给具体命令 |

### P1：可信度和可用性

| ID | 问题 | 验证 | 修复方向 |
|---|---|---|---|
| P1-4 | `package.json` 声明 `node >=22.5.0`，但 `node:sqlite` 在 22.13 之前不能直接用（22.5.0 和 22.12.0 实测 `ERR_UNKNOWN_BUILTIN_MODULE`）。工具不会报错，但缓存目录是空的，每次都是冷启动，没有任何提示。CI 只测最新的 22.x 和 24 | [手工] 下载 Node 22.12.0 跑两次 audit-overview，看 `.workspace-bridge/` 是否为空 | engines 改为 `>=22.13.0`；sqlite 不可用时打警告；CI 加最低版本 |
| P1-5 | Agent 默认 JSON 输出可能过大，且列表截断时需要显式告知；具体体积需在固定仓库重测。 | [手工] 对比 `audit-overview`、`audit-file`、`impact` 的 `--json` 与 `--format ai` 字节数 | 默认输出按 token 预算裁剪，并标明截断数量。 |
| P1-6 | 大仓库缓存体积和冷启动资源成本可能过高，当前量级需重新测量。 | [手工] 在固定 Django 版本上测缓存 DB 各表、冷暖启动和峰值内存 | 先定位最大表与重复存储，再决定按需计算或路径压缩。 |
| P1-7 | 图构建之外的冷启动耗时缺 profile，不能直接归因于缓存写入。 | [手工] 固定环境运行 `--cpu-prof` 并拆分阶段耗时 | 先测量，再根据 P1-6 的结果优化。 |
| P1-12 | C：`.h` 和 `.c` 不配对（cJSON 的 `cJSON_Utils.c` 被判成孤儿）；`#define true` 这类宏被当成导出 | [手工] 在 cJSON 上跑 audit-overview | 同名 `.h`/`.c` 建隐式边；宏不作为导出 |
| P1-13 | 模板字符串写的动态导入（`` import(`./x`) ``，无插值）识别不了，还被误报死代码 | [手工] 在 TS 文件里写 `` const f = () => import(`./lazy`) `` | 无插值的模板字符串按普通字符串处理 |
| P1-14 | api-contracts 不认 OpenAPI 生成的客户端（`url: '/api/v1/...'`）。full-stack-fastapi-template 识别到 0 个前端调用，却报"19 个后端路由没人调"并标 `hasFindings: true` | [手工] `api-contracts --cwd fsft --frontend <绝对路径>/frontend --backend <绝对路径>/backend` | 支持 `{ url, method }` 对象；前端调用为 0 时报"没识别到调用"，不报发现 |
| P1-16 | 热点排序遇到同分时顺序不固定，冷启动时"优先审查的热区文件"建议每次可能不同 | [手工] 删缓存跑两次 typer 的 audit-overview，比较 `summary.recommendations` | 排序加文件路径作第二排序键 |
| P1-17 | 多处静默截断：死导出的 `exports` 截断在 100 个；affected-tests JSON 截断在 50 个（typer 实际 214 个），截断顺序不明；`cycles` 列 20 个、计数写 26；`query` 会截断长字符串 | [手工] | 截断统一显式标注 `truncated` 和总数，说明排序依据 |

### P2：工程卫生

| ID | 问题 | 验证 |
|---|---|---|
| P2-3 | 有测试在断言源码文本（比如"不能出现 `?.`"），这其实是 lint 规则。已确认：`test/wave5-boundary-hardening-test.js`、`test/content-signature-trust-test.js`；粗算上限约 12 个 | 打开这两个文件看写法，再全局搜同样模式 |
| P2-4 | `audit-diff` 把改了 10 个 src 文件的提交判成 `changeType: tests`；`src/tools/*.js` 被归类成 `script` | 在提交 `416806e` 上跑 `audit-diff --commits 416806e~1..416806e` |
| P2-5 | `--frontend`/`--backend` 相对于进程当前目录解析，`--file` 相对于 `--cwd` 解析 | 在仓库外跑 api-contracts |
| P2-6 | `guard` 检查没通过和运行出错都返回 1，CI 分不清 | 给"没通过"单独一个退出码 |
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
- 缓存与启动性能：在第 1 节固定版本的 Django 上分别测冷启动、暖启动、缓存体积和内存峰值，保留命令与机器环境。旧审查数字只在 CHANGELOG 留档。
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

1. 先在固定仓库重跑真值评测，确认 P0-6/P0-11 的误报与受影响测试数字；缺少新测量时不沿用旧分数宣称改善。
2. 优先处理 P0-6、P0-11/12/14 的错误动作，再处理缓存性能与输出可用性（P1-4/5/6/7/14/16/17）。
3. 其余开放项按第 4 节逐条复现；每完成一项，就从活跃清单删除，并在 CHANGELOG 记录改动、原因和验证。

每轮收工执行 `node test/wb-repro.js cli.js`、`npm run test:fast`；涉及真实仓库结果时按 [eval/README.md](../eval/README.md) 复测。
