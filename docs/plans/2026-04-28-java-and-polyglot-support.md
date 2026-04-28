# 技术方案：Java AST 级支持与多语言扩展

> 状态：已完成
> 完成日期：2026-04-28
> 版本：v0.8.2

---

## 目标

消除 ROADMAP/CHANGELOG 与源码的 gap；将 Java 从 regex 提升到与 Python 同级；为 Kotlin/Go/Rust 建立 L2（regex 级）基础。

---

## 决策记录（ADR）

### ADR-1：Java AST 解析器用 javalang（Python），不用 tree-sitter

- **选项**：A. javalang（Python pip）/ B. tree-sitter-java（Node native）/ C. 手写 tokenizer
- **决策**：选 A。
- **理由**：与现有 Python AST 子进程模式一致；javalang 成熟且支持 Java 8~17；不污染 package.json。

### ADR-2：Kotlin/Go/Rust 只做 regex 级，不做 AST

- **决策**：只做 regex 提取 import/export + 文件索引 + 技术栈检测。
- **理由**：真实用户场景待验证；Go/Rust 模块系统差异大，AST 投入过高；regex 已满足 80% audit-overview 需求。

### ADR-3：不做语言插件注册表（本次）

- **决策**：保留硬编码链，不引入注册表抽象。
- **理由**：当前 6 种语言硬编码维护成本可接受；注册表重构需改动 5+ 文件，>3 天工作量，与"2~3 天交付"目标冲突。

---

## 验收结论

- `scripts/java_ast_parser.py`（javalang）已接入，AST 优先、regex 保底
- Kotlin/Go/Rust regex 解析器 + 文件索引 + 技术栈检测 + 验证命令生成已完成
- 多模块 Java source root 自动发现（`module-a/src/main/java` 及 `src/main/kotlin`）
- 3 个硬 bug 已修复（static import、接口方法、Kotlin resolver）
- `npm run test:all` 全绿
- 文档已诚实化（ROADMAP/CHANGELOG/SKILL.md 能力矩阵更新）

---

*完整实现细节见源码与 CHANGELOG [0.8.2]。*
