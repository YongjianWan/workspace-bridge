# workspace-bridge Roadmap

> 目标：把 `workspace-bridge` 从“可用的审计 CLI”推进成“能补足 AI 项目视角短板的工程脚手架”。

---

## 当前状态

当前已经具备：

- CLI-first 入口：
  - `audit-summary`
  - `audit-file`
- `workspace-audit` skill 可直接使用
- 语义识别层第一版：
  - `.workspace-bridge.json`
  - 目录角色识别（`active/reference/archive/generated`）
  - `audit-summary.scope` 主线/非主线输出
- 已处理的高频误报：
  - 前端静态资源导入 (`.json` / `.css`)
  - Python 相对导入
  - TypeScript ESM 源码里 `.js -> .ts/.tsx` 映射
  - 动态 `import(...)`
  - 多项目工作区 `--exclude`
- `deadExports` 第一版符号级精度：
  - 常见 JS/TS named import
  - default import
  - destructured `require(...)`

当前还不够的地方：

- 语义识别还只是目录/文件角色级，不够到“模块骨架”
- JS/TS 解析仍主要靠轻量规则，还没接现成 parser
- Python 解析还没切到标准 `ast` 能力
- Java / Spring Boot 还没有语言级解析策略
- 影响面还停留在文件级
- 测试建议还不够强
- Git 历史风险已接入第一版，但验证计划还不够强

---

## 设计原则

### 1. CLI-only

新增能力只进入 CLI。协议层已经删除，不再保留 MCP 兼容层。

### 2. 先减少误报，再增加功能

如果结果不可信，增加更多命令只会放大噪音。

### 3. 先识别主线，再做判断

在研究型仓库、混合仓库、monorepo 里，目录角色识别优先级高于死代码分析。

### 4. 输出必须能指导动作

最终输出不是“扫描报告”，而是：

- 哪些地方值得改
- 改完会影响谁
- 应该跑哪些测试
- 哪些结果只是候选，不该直接删

### 5. 多语言分层，不搞一锅粥

解析层按语言拆开：

- JS/TS：优先接现成 parser
- Python：优先走标准 `ast`
- Java：等 Spring Boot 场景真实到来再接，不提前过度工程

---

## Milestone 1：语义识别层

状态：基础版已落地，下一步是继续补入口/模块骨架识别，而不是重开一套。

### 目标

让工具先知道“项目骨架是什么”。

### 范围

1. 增加项目配置文件，例如 `.workspace-bridge.json`
2. 支持目录角色标注：
   - `active`
   - `reference`
   - `archive`
   - `generated`
3. 支持文件角色识别：
   - `entry`
   - `library`
   - `config`
   - `test`
   - `migration`
   - `script`
4. 支持主入口识别：
   - `package.json` 的 `main/bin/scripts`
   - `manage.py`
   - `vite.config.*`
   - 典型 server/bootstrap 入口

### 验收标准

- 对 `kimi-agent-evolution` 这类混合仓库，不加复杂手工参数也能稳定避开参考目录污染
- `audit-summary` 能输出“主线代码”和“非主线代码”的区分结果

---

## Milestone 2：导出使用精度

状态：已完成一版轻量级 JS/TS 符号判断，足够覆盖常见 import/export 语法；下一步不是继续堆 regex，而是接 parser adapter。

### 目标

把 `deadExports` 从“文件级高置信度候选”推进到“符号级更可信判断”。

### 范围

1. 抽 parser adapter 层
   - `javascript`
   - `python`
   - 预留 `java`
2. JS/TS 接 `@babel/parser`
3. 识别：
   - `export * from ...`
   - `export { x } from ...`
   - default export
   - namespace import
4. 区分：
   - 类型导入
   - 运行时导入
5. Python 侧增强：
   - `__all__`
   - package exports
   - `from x import *` 降级策略
   - 为后续 Python helper / `ast` 方案预留接口

### 语言策略

#### JS / TS

- 首选：`@babel/parser`
- 原因：接入成本低、生态成熟、足够支撑当前 import/export 精度需求

#### Python

- 方向：标准库 `ast`
- 现实：当前仓库是 Node CLI，先抽 adapter 接口，再决定是否用 Python helper 子进程承接

#### Java / Spring Boot

- 暂缓
- 原因：现在主要收益点仍在 Python + JS/TS 项目；Java parser 方案太重，不提前上

### 验收标准

- `deadExports` 在典型 TS 项目上明显少于当前版本误报
- Python 项目的 import/export 解析入口不再和 JS/TS 逻辑硬耦合
- 候选列表能更接近“真的可删”

---

## Milestone 3：影响面与测试映射

状态：`audit-diff`、历史风险、分阶段验证建议已进入第一版；下一步重点是把建议做得更像“执行计划”。

### 目标

让工具不仅知道“哪里有问题”，还知道“改它会影响谁”。

### 范围

1. 文件级影响面增强
2. symbol-level impact
3. 测试映射：
   - 文件 -> 测试
   - 模块 -> 测试
   - 直接相关测试 vs 间接覆盖测试
4. 强化 `audit-file`
5. 增加 `audit-diff`
6. 把验证建议升级为 staged plan：
   - `smoke`
   - `focused`
   - `full`

### `audit-diff` 输出目标

- 本次改动文件
- 影响模块
- 受影响测试
- 风险摘要
- 建议验证动作

状态：第一版已进入 CLI，当前已支持文件级聚合 + Git 历史风险权重；symbol-level impact 仍未完成。

### 验收标准

- 修改一个文件后，工具能给出更合理的测试建议
- `audit-file` 不只是依赖传播，而是能指导验证

---

## Milestone 4：Git 历史风险层

状态：第一版已完成，下一步是把历史风险和结构影响融合得更像工程判断，而不是平铺计数。

### 目标

补足静态结构看不到的“演化风险”。

### 范围

1. Git 热点文件识别
2. 高频改动模块
3. 易返工 / 易回滚区域
4. 影响面里加入历史风险权重

### 验收标准

- 同样的结构影响面，工具能区分“稳定模块”和“高波动模块”
- `summary.nextSteps` 开始包含历史风险提示

---

## Milestone 5：项目全景视图

### 目标

形成真正的“工程上帝视角”输出。

### 范围

1. 项目热区图
2. 模块稳定性评分
3. 耦合度 / 复杂度评分
4. orphan docs / orphan scripts / config drift 检测
5. 主线视图：
   - 入口
   - 核心模块
   - 风险热区
   - 遗留面

### 验收标准

- 一次命令能看清项目骨架
- 结果足以支撑重构、代码审计、测试建议和影响面判断

---

## 收口计划

1. 把根目录 `cli.js` 迁移到 `src/cli/`
2. 统一 CLI 输出格式和错误码
3. 继续弱化文档里的历史包袱，只保留 CLI + skill 叙事

---

## 推荐开发顺序

### P1 必做

1. `.workspace-bridge.json`
2. 目录/文件角色识别
3. parser adapter 层
4. JS/TS 接 `@babel/parser`

### P2 增强

5. Python 解析切向 `ast` 方案
6. 测试映射
7. symbol-level impact
8. 更强的验证建议计划

### P3 全景

9. Java / Spring Boot parser 评估（按需）
10. 热区图
11. 稳定性/耦合度评分
12. 主线全景视图

---

## 成功标准

当以下条件满足时，可以认为 `workspace-bridge` 已经从“工具”变成“脚手架”：

1. 对混合仓库结果稳定，不再大面积误报
2. 对 TS / Python / 前端项目都能给出可信主线结论
3. 能从“哪里可能有问题”推进到“该怎么改、改完测什么”
4. 输出能显著补足 AI 的局部视角短板
