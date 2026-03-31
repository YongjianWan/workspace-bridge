# AI认知脚手架系统 - 完整架构文档

> **版本**: 1.0.0  
> **文档类型**: 可部署架构规范  
> **覆盖语言**: TypeScript, Python, Go, Rust  
> **设计目标**: 构建强制性上下文注入系统，让AI在生成/修改代码前无法回避全局影响分析

---

## 目录

1. [架构总览](#1-架构总览)
2. [Layer 1: 全局符号地图](#2-layer-1-全局符号地图)
3. [Layer 2: 复用审查闸](#3-layer-2-复用审查闸)
4. [Layer 3: 影响预测引擎](#4-layer-3-影响预测引擎)
5. [Layer 4: 脚手架CLI](#5-layer-4-脚手架cli)
6. [核心算法](#6-核心算法)
7. [红蓝对抗验证](#7-红蓝对抗验证)
8. [部署指南](#8-部署指南)

---

## 1. 架构总览

### 1.1 四层架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Layer 4: 脚手架CLI (强制入口)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ ai-scaffold  │  │   Context    │  │   CHANGE_    │  │     Git      │    │
│  │    CLI       │  │   Package    │  │   PROOF.md   │  │  Integration │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Layer 3: 影响预测引擎                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   PageRank   │  │    Risk      │  │    Dead      │  │    Test      │    │
│  │  Calculator  │  │  Classifier  │  │Code Detector │  │   Impact     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Layer 2: 复用审查闸                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │    RAG       │  │     AST      │  │    Reuse     │  │    Proof     │    │
│  │  Retriever   │  │   Similarity │  │    Gate      │  │  Generator   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Layer 1: 全局符号地图                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │    Symbol    │  │  Dependency  │  │    Symbol    │  │    Query     │    │
│  │   Indexer    │  │    Graph     │  │    Store     │  │     API      │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 数据流时序

```
User → CLI → L1(查询符号地图) → 构建context.zip → 注入AI Prompt
                                            ↓
AI生成代码 → L2(复用检查) → L3(影响分析) → 生成CHANGE_PROOF.md → Git PR
```

### 1.3 核心矛盾拆解

| 问题类型 | 定义 | 脚手架对策 |
|---------|------|-----------|
| **文件生成癖** | 遇到逻辑就新建文件，不考虑复用 | Layer 2: 相似度>0.85强制复用提示 |
| **副作用盲视** | 修改文件时不考虑依赖关系 | Layer 3: PageRank中心性分析 |
| **抽象遗忘症** | 忘记之前写的helper函数 | Layer 1: 全局符号地图 + RAG检索 |

---

## 2. Layer 1: 全局符号地图

### 2.1 JSON Schema定义

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "GlobalSymbolMap",
  "type": "object",
  "required": ["version", "project_id", "generated_at", "symbols"],
  
  "properties": {
    "version": { "type": "string", "default": "1.0.0" },
    "project_id": { "type": "string" },
    "generated_at": { "type": "string", "format": "date-time" },
    
    "symbols": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "type", "language", "location"],
        "properties": {
          "id": { 
            "type": "string",
            "description": "全局唯一标识: file_path#symbol_name",
            "example": "src/services/user.ts#validateUser"
          },
          "name": { "type": "string" },
          "type": {
            "enum": ["function", "method", "class", "interface", "type", 
                     "variable", "constant", "enum", "module", "struct"]
          },
          "language": {
            "enum": ["typescript", "python", "go", "rust", "javascript"]
          },
          "location": {
            "type": "object",
            "required": ["file_path", "line_range"],
            "properties": {
              "file_path": { "type": "string" },
              "line_range": { "type": "array", "minItems": 2, "maxItems": 2 },
              "column_range": { "type": "array", "minItems": 2, "maxItems": 2 }
            }
          },
          "dependencies": { "type": "array", "items": { "type": "string" } },
          "dependents": { "type": "array", "items": { "type": "string" } },
          "last_modified": { "type": "string", "format": "date-time" },
          "dead_flag": { "type": "boolean", "default": false },
          "reuse_count": { "type": "integer", "default": 0 },
          "signature": { "type": "string" },
          "docstring": { "type": "string" }
        }
      }
    }
  }
}
```

### 2.2 技术选型

| 组件 | 技术 | 版本 |
|------|------|------|
| AST解析 | Tree-sitter | 0.20.8+ |
| 索引格式 | SCIP (Sourcegraph Code Intelligence Protocol) | 0.1.0+ |
| 存储 | SQLite (本地) / Redis (团队) | 3.40+ / 7.0+ |
| 查询接口 | GraphQL / REST | - |

### 2.3 强制注入规则

AI每次修改前，必须查询符号地图并列出：
1. **直接影响**: 目标文件内的所有symbol
2. **一级传递**: 直接依赖目标文件的symbol
3. **二级传递**: 依赖一级传递symbol的symbol

---

## 3. Layer 2: 复用审查闸

### 3.1 拦截规则

```yaml
reuse_gate_rules:
  - rule_id: RG-001
    name: "新建文件检查"
    condition: "AI请求创建新文件"
    action: "强制查询符号地图，确认无现有实现"
    
  - rule_id: RG-002
    name: "相似度阈值检查"
    condition: "AST相似度 > 0.85"
    action: "强制复用提示，要求说明不复用理由"
    
  - rule_id: RG-003
    name: "死代码引用检查"
    condition: "引用dead_flag=true的symbol"
    action: "拦截并提示使用替代实现"
    
  - rule_id: RG-004
    name: "函数克隆检测"
    condition: "检测到Type-2/Type-3代码克隆"
    action: "生成diff对比，建议提取公共函数"
    
  - rule_id: RG-005
    name: "CHANGE_PROOF必填"
    condition: "所有新建/修改操作"
    action: "必须填写不复用理由（如适用）"
```

### 3.2 CHANGE_PROOF.md模板

```markdown
# Change Proof - [变更描述]

## Layer 1: 符号地图查询结果
- 受影响文件: [list]
- 受影响symbol: [list]
- 二级传递影响: [list]

## Layer 2: 复用审查
- [ ] 我检索了符号地图，确认没有现有实现
- [ ] 我选择不复用 [src/utils/x.ts] 的理由是: [说明]
- 相似度检测报告: [link]

## Layer 3: 影响分析
- PageRank分数: [0-1]
- 风险等级: 🔴 核心 / 🟡 普通 / 🟢 叶子
- 下游测试清单: [list]

## 变更内容
- 修改文件: [list]
- 新增文件: [list]
- 删除文件: [list]
```

---

## 4. Layer 3: 影响预测引擎

### 4.1 PageRank中心性计算

```python
def calculate_pagerank(graph: DependencyGraph, damping: float = 0.85, 
                       tolerance: float = 1e-8, max_iter: int = 100) -> Dict[str, float]:
    """
    计算依赖图的PageRank中心性
    
    Args:
        graph: 依赖有向图 (文件 -> 被依赖文件列表)
        damping: 阻尼系数 (默认0.85)
        tolerance: 收敛容差
        max_iter: 最大迭代次数
    
    Returns:
        Dict[file_path, pagerank_score]
    """
    n = len(graph.nodes)
    scores = {node: 1.0 / n for node in graph.nodes}
    
    for _ in range(max_iter):
        new_scores = {}
        for node in graph.nodes:
            rank = (1 - damping) / n
            for predecessor in graph.get_predecessors(node):
                out_degree = len(graph.get_successors(predecessor))
                if out_degree > 0:
                    rank += damping * scores[predecessor] / out_degree
            new_scores[node] = rank
        
        # 检查收敛
        diff = sum(abs(new_scores[n] - scores[n]) for n in graph.nodes)
        scores = new_scores
        if diff < tolerance:
            break
    
    return scores
```

### 4.2 风险分级

| 等级 | 条件 | 处理要求 |
|------|------|---------|
| 🔴 核心节点 | 被>10个文件依赖 或 PageRank>0.15 | 必须附带下游影响测试清单 |
| 🟠 高影响 | 被5-10个文件依赖 或 PageRank>0.08 | 建议检查间接依赖 |
| 🟡 普通节点 | 被3-5个文件依赖 | 需检查直接依赖 |
| 🟢 叶子节点 | 被<3个文件依赖 | 自由修改 |

### 4.3 死代码检测集成

| 语言 | 工具 | 命令 |
|------|------|------|
| TypeScript | ts-prune | `npx ts-prune -p tsconfig.json` |
| Python | vulture | `vulture src/ --min-confidence 80` |
| Go | unused | `unused ./...` |
| Rust | cargo-udeps | `cargo +nightly udeps` |

---

## 5. Layer 4: 脚手架CLI

### 5.1 命令设计

```bash
# 核心命令
ai-scaffold generate -r "添加用户认证" -t src/auth.py -t src/models.py
ai-scaffold impact -f src/core.py --change-type modify
ai-scaffold reuse -f src/new_feature.py
ai-scaffold context -f src/api.ts --depth 2
ai-scaffold validate -p ./CHANGE_PROOF.md
ai-scaffold status

# 参数说明
--context-depth, -d     依赖层级深度 (默认: 2)
--risk-threshold, -r    风险阈值 (low/medium/high/critical)
--language, -l          目标语言 (python/javascript/typescript/go/rust)
--proof-output, -p      CHANGE_PROOF.md输出路径
--dry-run               试运行模式
--skip-git              跳过git操作
```

### 5.2 CLI入口代码 (Python)

```python
#!/usr/bin/env python3
"""ai-scaffold: AI认知脚手架CLI工具"""

import click
from rich.console import Console

console = Console()

@click.group()
@click.version_option(version="1.0.0")
def cli():
    """AI认知脚手架 - 强制性上下文注入系统"""
    pass

@cli.command()
@click.option("-r", "--request", required=True, help="用户请求描述")
@click.option("-t", "--target", multiple=True, required=True, help="目标文件")
@click.option("-d", "--context-depth", default=2, help="依赖层级深度")
@click.option("--risk-threshold", default="medium", 
              type=click.Choice(["low", "medium", "high", "critical"]))
@click.option("--proof-output", default="CHANGE_PROOF.md")
@click.option("--dry-run", is_flag=True)
def generate(request, target, context_depth, risk_threshold, proof_output, dry_run):
    """完整代码生成工作流"""
    
    # Step 1: 查询Layer 1生成上下文包
    context = build_context_package(target, context_depth)
    
    # Step 2: 注入system prompt
    system_prompt = inject_context(context)
    
    # Step 3: AI生成代码
    generated = ai_generate(request, system_prompt)
    
    # Step 4: Layer 2复用检查
    reuse_result = check_reuse(generated)
    if reuse_result.similarity > 0.85:
        console.print("[yellow]警告: 检测到高相似度代码，建议复用[/yellow]")
    
    # Step 5: Layer 3影响分析
    impact = analyze_impact(target, generated)
    if impact.risk_level == "critical":
        console.print("[red]核心节点修改，需要下游测试清单[/red]")
        if not click.confirm("是否继续?"):
            return
    
    # Step 6: 生成CHANGE_PROOF.md
    proof = generate_proof(request, context, generated, reuse_result, impact)
    save_proof(proof, proof_output)
    
    # Step 7: Git提交
    if not dry_run:
        commit_changes(proof_output)

if __name__ == "__main__":
    cli()
```

---

## 6. 核心算法

### 6.1 符号索引算法 (Tree-sitter)

```python
class TreeSitterSymbolExtractor:
    """基于Tree-sitter的符号提取器"""
    
    QUERIES = {
        "typescript": {
            "function": """
                (function_declaration
                    name: (identifier) @name
                    parameters: (formal_parameters) @params
                    body: (statement_block) @body) @func
            """,
            "class": """
                (class_declaration
                    name: (type_identifier) @name
                    body: (class_body) @body) @class
            """
        },
        "python": {
            "function": """
                (function_definition
                    name: (identifier) @name
                    parameters: (parameters) @params
                    body: (block) @body) @func
            """,
            "class": """
                (class_definition
                    name: (identifier) @name
                    body: (block) @body) @class
            """
        },
        "go": {
            "function": """
                (function_declaration
                    name: (identifier) @name
                    parameters: (parameter_list) @params
                    body: (block) @body) @func
            """,
            "struct": """
                (type_declaration
                    (type_spec
                        name: (type_identifier) @name
                        type: (struct_type) @body)) @struct
            """
        }
    }
    
    def extract_symbols(self, file_path: str, language: str) -> List[Symbol]:
        """从文件提取符号"""
        parser = Parser()
        parser.set_language(self.get_language(language))
        
        with open(file_path, 'r') as f:
            source = f.read()
        
        tree = parser.parse(source.encode())
        query = Query(self.get_language(language), self.QUERIES[language])
        
        symbols = []
        for match in query.matches(tree.root_node):
            symbol = self._parse_match(match, file_path, source)
            symbols.append(symbol)
        
        return symbols
```

### 6.2 AST相似度算法

```python
class ASTSimilarityCalculator:
    """基于AST特征向量的相似度计算"""
    
    THRESHOLD = 0.85  # 强制复用提示阈值
    
    def calculate_similarity(self, func1: FunctionInfo, func2: FunctionInfo) -> float:
        """计算两个函数的AST相似度"""
        
        # 1. 结构相似度 (Tree Edit Distance)
        struct_sim = self._tree_edit_distance(func1.ast, func2.ast)
        
        # 2. 语义相似度 (CodeBERT嵌入)
        semantic_sim = self._semantic_similarity(func1.content, func2.content)
        
        # 3. 控制流相似度 (CFG)
        cfg_sim = self._cfg_similarity(func1.cfg, func2.cfg)
        
        # 加权综合
        similarity = (0.4 * struct_sim + 
                     0.4 * semantic_sim + 
                     0.2 * cfg_sim)
        
        return similarity
    
    def _tree_edit_distance(self, ast1, ast2) -> float:
        """计算AST树编辑距离相似度"""
        distance = zss.distance(ast1, ast2)
        max_nodes = max(ast1.node_count, ast2.node_count)
        return 1.0 - (distance / max_nodes) if max_nodes > 0 else 1.0
    
    def _semantic_similarity(self, code1: str, code2: str) -> float:
        """使用CodeBERT计算语义相似度"""
        embedding1 = self.codebert.encode(code1)
        embedding2 = self.codebert.encode(code2)
        return cosine_similarity(embedding1, embedding2)
```

### 6.3 影响传播算法

```python
def calculate_impact_scope(symbol_map: SymbolMap, 
                           modified_symbols: List[str],
                           max_depth: int = 2) -> ImpactScope:
    """
    计算修改的影响范围（直接影响 + 二级传递）
    
    Args:
        symbol_map: 全局符号地图
        modified_symbols: 被修改的symbol ID列表
        max_depth: 最大传播深度
    
    Returns:
        ImpactScope: 影响范围对象
    """
    direct_impact = set()
    indirect_impact = set()
    
    # 直接影响: 被修改symbol的dependents
    for symbol_id in modified_symbols:
        symbol = symbol_map.get_symbol(symbol_id)
        direct_impact.update(symbol.dependents)
    
    # 间接影响: 二级传递
    current_level = direct_impact
    for depth in range(1, max_depth):
        next_level = set()
        for symbol_id in current_level:
            symbol = symbol_map.get_symbol(symbol_id)
            if symbol:
                next_level.update(symbol.dependents)
        indirect_impact.update(next_level)
        current_level = next_level
    
    return ImpactScope(
        direct=sorted(direct_impact),
        indirect=sorted(indirect_impact - direct_impact),
        total_files=len(set(
            symbol_map.get_symbol(s).file_path 
            for s in direct_impact | indirect_impact
        ))
    )
```

---

## 7. 红蓝对抗验证

### 7.1 10个攻击场景

| 场景ID | 名称 | 攻击类型 | 风险等级 |
|--------|------|---------|---------|
| RB-001 | 工具函数重复生成 | 文件生成癖 | 🔴 高 |
| RB-002 | 组件重复创建 | 文件生成癖 | 🔴 高 |
| RB-003 | 修改导出导致依赖断裂 | 副作用盲视 | 🔴 高 |
| RB-004 | 删除被引用的函数 | 副作用盲视 | 🔴 高 |
| RB-005 | 修改函数签名未更新调用方 | 副作用盲视 | 🟠 中 |
| RB-006 | 重复实现已存在的Hook | 抽象遗忘症 | 🟠 中 |
| RB-007 | 忘记已有常量定义 | 抽象遗忘症 | 🟡 低 |
| RB-008 | 修改默认导出破坏批量导入 | 副作用盲视 | 🔴 高 |
| RB-009 | 重复创建相同功能的中间件 | 抽象遗忘症 | 🟠 中 |
| RB-010 | 修改文件路径未更新所有引用 | 副作用盲视 | 🔴 高 |

### 7.2 量化指标

| 指标 | 目标值 | 计算公式 |
|------|--------|---------|
| 文件重复生成拦截率 | >90% | 被拦截次数 / 总尝试次数 × 100% |
| 副作用遗漏拦截率 | >85% | 被拦截次数 / 总尝试次数 × 100% |
| 死代码误用拦截率 | 100% | 被拦截次数 / 总尝试次数 × 100% |
| 误拦截率 | <5% | 误报次数 / 总拦截次数 × 100% |

### 7.3 失败案例分析模板

```markdown
## 失败案例: [场景ID]

### 基本信息
- 测试日期: [YYYY-MM-DD]
- 脚手架版本: [x.x.x]
- 测试人员: [name]

### 场景描述
[简述攻击场景]

### 预期行为
[脚手架应该如何拦截]

### 实际行为
[实际发生了什么]

### 根因分析
[为什么拦截失败]

### 修复建议
[如何修复]
```

---

## 8. 部署指南

### 8.1 安装依赖

```bash
# Python依赖
pip install tree-sitter tree-sitter-python tree-sitter-typescript tree-sitter-go
pip install click rich chromadb sentence-transformers

# Node.js依赖 (可选)
npm install -g ts-prune jscpd ast-grep

# Go工具 (可选)
go install github.com/dominikh/go-tools/cmd/unused@latest
```

### 8.2 项目初始化

```bash
# 初始化脚手架
ai-scaffold init

# 构建符号地图
ai-scaffold index --language typescript --language python

# 查看状态
ai-scaffold status
```

### 8.3 日常使用

```bash
# 生成代码（完整工作流）
ai-scaffold generate -r "添加用户认证" -t src/auth.py

# 影响分析
ai-scaffold impact -f src/core.py

# 复用检查
ai-scaffold reuse -f src/new_feature.py
```

---

## 生成文件清单

| 文件路径 | 说明 |
|----------|------|
| `/mnt/okcomputer/output/architecture_design.md` | 完整架构设计文档 (71KB) |
| `/mnt/okcomputer/output/core_algorithms.md` | 核心算法设计文档 (83KB) |
| `/mnt/okcomputer/output/core_algorithms.py` | 可运行算法实现 (67KB) |
| `/mnt/okcomputer/output/cli_tool.py` | CLI工具完整代码 (72KB) |
| `/mnt/okcomputer/output/reuse_detection.py` | 复用检测脚本 (45KB) |
| `/mnt/okcomputer/output/red_blue_test_cases.md` | 红蓝对抗测试用例 (33KB) |
| `/mnt/okcomputer/output/tree-sitter-queries.scm` | Tree-sitter查询语句 (10KB) |

---

*文档生成时间: 2026-03-31*  
*版本: 1.0.0*
