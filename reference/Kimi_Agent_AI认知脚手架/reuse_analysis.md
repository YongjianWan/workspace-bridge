# 代码复用发现机制设计文档

## 目录
1. [工具调研报告](#1-工具调研报告)
2. [Tree-sitter查询语句设计](#2-tree-sitter查询语句设计)
3. [强制检索算法](#3-强制检索算法)
4. [Diff对比生成算法](#4-diff对比生成算法)
5. [Python/Node脚本原型](#5-pythonnode脚本原型)
6. [多语言AST提取方案](#6-多语言ast提取方案)

---

## 1. 工具调研报告

### 1.1 克隆检测工具对比

| 工具 | 类型 | 支持语言 | 准确率(F1) | 速度 | 推荐场景 |
|------|------|----------|------------|------|----------|
| **jscpd** | Token-based | 150+ | 0.45-0.60 | 快 | 快速预筛选 |
| **Simian** | Text/Line-based | Java/C/C++/C# | 0.25-0.35 | 极快 | 简单重复检测 |
| **ast-grep** | AST-based | 20+ | 0.75-0.85 | 快 | 精确重构 |
| **semgrep** | AST+Pattern | 30+ | 0.70-0.80 | 中等 | 安全规则 |
| **NiCad** | Text+AST | C/Java/Python | 0.85-0.95 | 慢 | 高精度需求 |
| **Deckard** | Vector-based | C/Java | 0.80-0.90 | 中等 | Type-3克隆 |

### 1.2 学术研究基准测试结果

根据ICSE 2023和IWSC 2020的研究数据：

**BigCloneBench测试结果：**
```
工具          Precision    Recall    F1-Score
NiCad         95%          88%       0.91
CCFinderX     82%          75%       0.78
Deckard       78%          85%       0.81
Simian        65%          45%       0.53
jscpd         55%          50%       0.52
```

**SemanticCloneBench测试结果（语义克隆）：**
```
工具          Precision    Recall    F1-Score
NetSim        70%          85%       0.77
Mecc          80%          25%       0.38
CCCD          45%          60%       0.51
Simian        60%          15%       0.24
```

### 1.3 推荐的主力工具组合

**Layer 1: 快速预筛选**
- **jscpd**: 用于大规模代码库的快速扫描
- 配置: 最小token数=50，相似度阈值=0.7

**Layer 2: 精确AST匹配**
- **ast-grep**: 用于精确的代码重构和复用检测
- 优势: Rust编写，多线程处理，tree-sitter解析

**Layer 3: 语义相似度**
- **自定义Tree-sitter + Embedding**: 用于语义级克隆检测
- 相似度阈值: 0.85（强制复用提示阈值）

---

## 2. Tree-sitter查询语句设计

### 2.1 检测"相似函数克隆"的查询语句

#### TypeScript/JavaScript
```scheme
; 函数声明匹配
(function_declaration
    name: (identifier)? @func.name
    parameters: (formal_parameters) @func.params
    return_type: (type_annotation)? @func.return
    body: (statement_block) @func.body) @func.def

; 方法定义匹配
(method_definition
    name: (property_identifier)? @func.name
    parameters: (formal_parameters) @func.params
    return_type: (type_annotation)? @func.return
    body: (statement_block) @func.body) @func.def

; 箭头函数匹配
(arrow_function
    parameters: (formal_parameters)? @func.params
    body: (_) @func.body) @func.def

; 导出函数匹配
(export_statement
    (function_declaration
        name: (identifier) @func.name) @func.def) @func.export

; 类方法匹配
(class_declaration
    name: (type_identifier) @class.name
    body: (class_body
        (method_definition
            name: (property_identifier) @method.name
            parameters: (formal_parameters) @method.params) @method.def)*)
```

#### Python
```scheme
; 普通函数定义
(function_definition
    name: (identifier) @func.name
    parameters: (parameters) @func.params
    return_type: (type)? @func.return
    body: (block) @func.body) @func.def

; 异步函数定义
(async_function_definition
    name: (identifier) @func.name
    parameters: (parameters) @func.params
    return_type: (type)? @func.return
    body: (block) @func.body) @func.def

; 类方法定义
(class_definition
    name: (identifier) @class.name
    body: (block
        (function_definition
            name: (identifier) @method.name
            parameters: (parameters) @method.params) @method.def)*)

; Lambda表达式
(lambda
    parameters: (lambda_parameters)? @lambda.params
    body: (_) @lambda.body) @lambda.def
```

#### Go
```scheme
; 函数声明
(function_declaration
    name: (identifier) @func.name
    parameters: (parameter_list) @func.params
    result: (_)? @func.return
    body: (block) @func.body) @func.def

; 方法声明（带接收器）
(method_declaration
    receiver: (parameter_list) @method.receiver
    name: (field_identifier) @method.name
    parameters: (parameter_list) @method.params
    result: (_)? @method.return
    body: (block) @method.body) @method.def

; 接口方法
(interface_type
    (method_spec
        name: (field_identifier) @interface.method.name
        parameters: (parameter_list) @interface.method.params) @interface.method.def)
```

### 2.2 检测"未使用导出"的查询语句

#### TypeScript
```scheme
; 导出声明匹配
(export_statement
    declaration: [
        (function_declaration name: (identifier) @export.name)
        (class_declaration name: (type_identifier) @export.name)
        (interface_declaration name: (type_identifier) @export.name)
        (type_alias_declaration name: (type_identifier) @export.name)
        (enum_declaration name: (identifier) @export.name)
        (variable_declaration 
            (variable_declarator name: (identifier) @export.name))
    ]) @export.stmt

; 命名导出匹配
(export_specifier
    name: (identifier) @export.spec.name) @export.spec

; 导入声明匹配（用于交叉引用）
(import_statement
    (import_clause
        (identifier)? @import.default
        (named_imports
            (import_specifier
                name: (identifier) @import.name))) @import.clause
    source: (string) @import.source) @import.stmt

; 从特定模块导入
(import_statement
    (import_clause (identifier) @import.default)
    source: (string) @import.source) @import.stmt
```

#### Python
```scheme
; 模块级变量（潜在导出）
(module
    (expression_statement
        (assignment
            left: (identifier) @module.var.name
            right: (_) @module.var.value)) @module.var.def)

; 类定义（潜在导出）
(class_definition
    name: (identifier) @class.name) @class.def

; 函数定义（潜在导出）
(function_definition
    name: (identifier) @function.name) @function.def

; __all__ 显式导出
(expression_statement
    (assignment
        left: (identifier) @all.name (#eq? @all.name "__all__")
        right: (list (_) @all.item))) @all.def

; 导入语句
(import_statement
    name: (dotted_name (identifier) @import.name)) @import.stmt

(import_from_statement
    module: (dotted_name)? @import.module
    name: (dotted_name (identifier) @import.name)) @import.stmt
```

#### Go
```scheme
; 导出函数（大写字母开头）
(function_declaration
    name: (identifier) @export.func.name
    (#match? @export.func.name "^[A-Z]")) @export.func.def

; 导出类型
(type_declaration
    (type_spec
        name: (type_identifier) @export.type.name
        (#match? @export.type.name "^[A-Z]"))) @export.type.def

; 导出变量/常量
(var_declaration
    (var_spec
        name: (identifier) @export.var.name
        (#match? @export.var.name "^[A-Z]"))) @export.var.def

(const_declaration
    (const_spec
        name: (identifier) @export.const.name
        (#match? @export.const.name "^[A-Z]"))) @export.const.def

; 导入语句
(import_spec
    path: (interpreted_string_literal) @import.path
    name: (identifier)? @import.name) @import.spec
```

### 2.3 高级克隆检测查询

#### 检测相似循环结构
```scheme
; TypeScript/JavaScript - 相似for循环
(for_statement
    initializer: (_) @loop.init
    condition: (_) @loop.cond
    increment: (_) @loop.inc
    body: (statement_block) @loop.body) @loop.def

; Python - 相似for循环
(for_statement
    left: (_) @loop.target
    right: (_) @loop.iter
    body: (block) @loop.body) @loop.def

; 检测相似try-catch块
(try_statement
    body: (block) @try.body
    handler: (catch_clause
        body: (block) @catch.body)) @try.def
```

---

## 3. 强制检索算法

### 3.1 算法流程图

```
AI生成新函数
    │
    ▼
┌─────────────────┐
│ 1. 提取AST特征   │
│    - 函数签名    │
│    - 参数类型    │
│    - 返回类型    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. 生成特征向量  │
│    - AST Hash   │
│    - Token序列  │
│    - 嵌入向量   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. 向量数据库检索│
│    - Top-K查询  │
│    - 相似度排序  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. 相似度计算   │
│    - AST相似度  │
│    - 文本相似度 │
│    - 嵌入相似度 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 5. 阈值判断     │
│    ≥0.95? → 强制复用提示
│    ≥0.85? → 建议复用提示
│    <0.85? → 允许创建新函数
└─────────────────┘
```

### 3.2 核心算法实现

```python
class ForcedRetrievalAlgorithm:
    """强制检索算法 - 在AI生成新函数前检索现有实现"""
    
    THRESHOLD_FORCE_REUSE = 0.95   # 强制复用阈值
    THRESHOLD_SUGGEST_REUSE = 0.85  # 建议复用阈值
    
    def __init__(self, vector_db, ast_parser):
        self.vector_db = vector_db
        self.parser = ast_parser
        self.similarity_calc = SimilarityCalculator()
    
    def pre_generation_check(self, new_function_code: str, 
                             project_context: dict) -> dict:
        """
        在AI生成新函数前执行强制检索
        
        Returns:
            {
                'can_proceed': bool,
                'action': str,  # 'force_reuse', 'suggest_reuse', 'allow_create'
                'similar_functions': List[SimilarFunction],
                'diff': str,
                'reason': str
            }
        """
        # Step 1: 提取AST特征
        ast_features = self._extract_ast_features(new_function_code)
        
        # Step 2: 多维度检索
        candidates = self._multi_stage_retrieval(ast_features)
        
        # Step 3: 精确相似度计算
        similarities = []
        for candidate in candidates:
            sim_score = self._calculate_similarity(
                new_function_code, 
                candidate,
                methods=['ast', 'token', 'embedding']
            )
            similarities.append((candidate, sim_score))
        
        # Step 4: 排序并选择Top-K
        similarities.sort(key=lambda x: x[1]['combined'], reverse=True)
        top_candidates = similarities[:3]
        
        # Step 5: 阈值判断和决策
        if not top_candidates:
            return self._allow_create("No similar functions found")
        
        best_match = top_candidates[0]
        best_score = best_match[1]['combined']
        
        if best_score >= self.THRESHOLD_FORCE_REUSE:
            return self._force_reuse(best_match, top_candidates)
        elif best_score >= self.THRESHOLD_SUGGEST_REUSE:
            return self._suggest_reuse(best_match, top_candidates)
        else:
            return self._allow_create(
                f"Best similarity {best_score:.2%} below threshold"
            )
    
    def _extract_ast_features(self, code: str) -> dict:
        """提取AST特征向量"""
        tree = self.parser.parse(code)
        
        features = {
            'ast_hash': self._compute_ast_hash(tree),
            'signature_hash': self._compute_signature_hash(tree),
            'token_sequence': self._extract_token_sequence(tree),
            'structure_vector': self._compute_structure_vector(tree),
            'embedding': self._compute_embedding(code)
        }
        
        return features
    
    def _multi_stage_retrieval(self, features: dict) -> List[dict]:
        """多阶段检索策略"""
        candidates = set()
        
        # Stage 1: AST哈希精确匹配（O(1)）
        exact_matches = self.vector_db.get_by_ast_hash(features['ast_hash'])
        candidates.update(exact_matches)
        
        # Stage 2: 签名哈希匹配（快速筛选）
        signature_matches = self.vector_db.get_by_signature_hash(
            features['signature_hash']
        )
        candidates.update(signature_matches)
        
        # Stage 3: 向量相似度检索（Top-20）
        vector_matches = self.vector_db.similarity_search(
            features['embedding'],
            top_k=20
        )
        candidates.update(vector_matches)
        
        return list(candidates)
    
    def _calculate_similarity(self, code1: str, code2: dict, 
                              methods: List[str]) -> dict:
        """多维度相似度计算"""
        results = {}
        
        if 'ast' in methods:
            results['ast'] = self.similarity_calc.ast_similarity(code1, code2)
        
        if 'token' in methods:
            results['token'] = self.similarity_calc.token_similarity(code1, code2)
        
        if 'embedding' in methods:
            results['embedding'] = self.similarity_calc.embedding_similarity(
                code1, code2
            )
        
        # 加权组合
        weights = {'ast': 0.4, 'token': 0.3, 'embedding': 0.3}
        results['combined'] = sum(
            results.get(m, 0) * weights.get(m, 0) for m in methods
        )
        
        return results
    
    def _force_reuse(self, best_match: tuple, 
                     all_candidates: List[tuple]) -> dict:
        """生成强制复用响应"""
        func, scores = best_match
        diff = self._generate_diff(func['content'], func['content'])
        
        return {
            'can_proceed': False,
            'action': 'force_reuse',
            'similar_functions': [c[0] for c in all_candidates],
            'diff': diff,
            'reason': f"Found nearly identical function '{func['name']}' "
                     f"with {scores['combined']:.2%} similarity. "
                     f"You MUST reuse the existing implementation.",
            'required_action': 'Update CHANGE_PROOF.md with reuse justification'
        }
    
    def _suggest_reuse(self, best_match: tuple,
                       all_candidates: List[tuple]) -> dict:
        """生成建议复用响应"""
        func, scores = best_match
        
        return {
            'can_proceed': True,
            'action': 'suggest_reuse',
            'similar_functions': [c[0] for c in all_candidates],
            'diff': self._generate_diff(func['content'], func['content']),
            'reason': f"Found similar function '{func['name']}' "
                     f"with {scores['combined']:.2%} similarity.",
            'required_action': 'Document in CHANGE_PROOF.md why you choose '
                              'NOT to reuse or how you plan to refactor'
        }
    
    def _allow_create(self, reason: str) -> dict:
        """生成允许创建响应"""
        return {
            'can_proceed': True,
            'action': 'allow_create',
            'similar_functions': [],
            'diff': '',
            'reason': reason,
            'required_action': 'Document in CHANGE_PROOF.md that no similar '
                              'functions were found after symbol map search'
        }
```

### 3.3 CHANGE_PROOF.md模板

```markdown
## 复用审查记录

### 新函数: `functionName`

**创建时间**: YYYY-MM-DD HH:MM

**检索结果**: 
- [x] 已检索符号地图
- [ ] 未检索符号地图

**相似函数发现**:
| 函数名 | 文件路径 | 相似度 | 决策 |
|--------|----------|--------|------|
| existingFunc | src/utils/helper.ts | 92% | 选择不复用 |

**不复用理由**: 
<!-- 如果相似度≥0.85，必须填写 -->
现有实现使用回调模式，新需求需要Promise模式，
重构成本高于重写。

**替代方案**:
计划将两个实现统一为async/await模式，
创建技术债务Issue #XXX跟踪。

**审查人**: @reviewer
```

---

## 4. Diff对比生成算法

### 4.1 算法实现

```python
import difflib
from typing import List, Tuple

class DiffGenerator:
    """Diff对比生成器"""
    
    def generate_unified_diff(
        self,
        original: str,
        modified: str,
        original_path: str = "a/file.ts",
        modified_path: str = "b/file.ts",
        context_lines: int = 3
    ) -> str:
        """生成统一格式diff"""
        
        original_lines = original.splitlines(keepends=True)
        modified_lines = modified.splitlines(keepends=True)
        
        # 确保每行以换行符结尾
        original_lines = [
            line if line.endswith('\n') else line + '\n'
            for line in original_lines
        ]
        modified_lines = [
            line if line.endswith('\n') else line + '\n'
            for line in modified_lines
        ]
        
        diff = difflib.unified_diff(
            original_lines,
            modified_lines,
            fromfile=original_path,
            tofile=modified_path,
            n=context_lines,
            lineterm=''
        )
        
        return ''.join(diff)
    
    def generate_structural_diff(
        self,
        func1: FunctionInfo,
        func2: FunctionInfo
    ) -> dict:
        """生成结构化diff（AST级别）"""
        
        diff = {
            'signature_diff': self._compare_signatures(func1, func2),
            'body_diff': self._compare_bodies(func1, func2),
            'param_diff': self._compare_parameters(func1, func2),
            'return_diff': self._compare_return_types(func1, func2)
        }
        
        return diff
    
    def _compare_signatures(self, func1: FunctionInfo, 
                            func2: FunctionInfo) -> dict:
        """比较函数签名"""
        return {
            'name_same': func1.name == func2.name,
            'param_count_same': len(func1.parameters) == len(func2.parameters),
            'param_names_diff': set(func1.parameters) ^ set(func2.parameters),
            'async_same': func1.is_async == func2.is_async
        }
    
    def _compare_bodies(self, func1: FunctionInfo,
                        func2: FunctionInfo) -> List[str]:
        """比较函数体"""
        # 使用SequenceMatcher找出差异块
        sm = difflib.SequenceMatcher(
            None,
            func1.normalized_content,
            func2.normalized_content
        )
        
        differences = []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag != 'equal':
                differences.append({
                    'type': tag,  # 'replace', 'delete', 'insert'
                    'original': func1.normalized_content[i1:i2],
                    'modified': func2.normalized_content[j1:j2]
                })
        
        return differences
    
    def generate_side_by_side_diff(
        self,
        original: str,
        modified: str,
        line_numbers: bool = True
    ) -> List[dict]:
        """生成并排对比格式"""
        
        original_lines = original.splitlines()
        modified_lines = modified.splitlines()
        
        sm = difflib.SequenceMatcher(None, original_lines, modified_lines)
        
        result = []
        orig_line_num = 1
        mod_line_num = 1
        
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == 'equal':
                for i in range(i1, i2):
                    result.append({
                        'type': 'equal',
                        'left': {
                            'line_num': orig_line_num if line_numbers else None,
                            'content': original_lines[i]
                        },
                        'right': {
                            'line_num': mod_line_num if line_numbers else None,
                            'content': modified_lines[j1 + (i - i1)]
                        }
                    })
                    orig_line_num += 1
                    mod_line_num += 1
            
            elif tag == 'delete':
                for i in range(i1, i2):
                    result.append({
                        'type': 'delete',
                        'left': {
                            'line_num': orig_line_num if line_numbers else None,
                            'content': original_lines[i]
                        },
                        'right': {'line_num': None, 'content': ''}
                    })
                    orig_line_num += 1
            
            elif tag == 'insert':
                for j in range(j1, j2):
                    result.append({
                        'type': 'insert',
                        'left': {'line_num': None, 'content': ''},
                        'right': {
                            'line_num': mod_line_num if line_numbers else None,
                            'content': modified_lines[j]
                        }
                    })
                    mod_line_num += 1
            
            elif tag == 'replace':
                max_len = max(i2 - i1, j2 - j1)
                for k in range(max_len):
                    left_content = original_lines[i1 + k] if i1 + k < i2 else ''
                    right_content = modified_lines[j1 + k] if j1 + k < j2 else ''
                    
                    result.append({
                        'type': 'replace',
                        'left': {
                            'line_num': orig_line_num if line_numbers else None,
                            'content': left_content
                        },
                        'right': {
                            'line_num': mod_line_num if line_numbers else None,
                            'content': right_content
                        }
                    })
                    
                    if left_content:
                        orig_line_num += 1
                    if right_content:
                        mod_line_num += 1
        
        return result
    
    def highlight_differences(self, text1: str, text2: str) -> Tuple[str, str]:
        """高亮显示文本差异（行内）"""
        
        sm = difflib.SequenceMatcher(None, text1, text2)
        
        highlighted1 = []
        highlighted2 = []
        
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            segment1 = text1[i1:i2]
            segment2 = text2[j1:j2]
            
            if tag == 'equal':
                highlighted1.append(segment1)
                highlighted2.append(segment2)
            elif tag == 'delete':
                highlighted1.append(f"\033[91m{segment1}\033[0m")  # 红色
            elif tag == 'insert':
                highlighted2.append(f"\033[92m{segment2}\033[0m")  # 绿色
            elif tag == 'replace':
                highlighted1.append(f"\033[93m{segment1}\033[0m")  # 黄色
                highlighted2.append(f"\033[93m{segment2}\033[0m")
        
        return ''.join(highlighted1), ''.join(highlighted2)
```

### 4.2 Diff输出格式示例

**统一格式 (Unified Diff)**:
```diff
--- src/utils/oldHelper.ts:15
+++ src/utils/newHelper.ts:23
@@ -1,10 +1,10 @@
-function processData(data: any[]): Result[] {
+async function processData(data: unknown[]): Promise<Result[]> {
-    return data.map(item => {
+    const results = await Promise.all(data.map(async item => {
         const processed = transform(item);
-        return validate(processed);
-    });
+        return await validateAsync(processed);
+    }));
+    return results.filter(r => r !== null);
 }
```

**并排格式 (Side-by-Side)**:
```
  15│function processData(data: any[]): Result[] {    │  23│async function processData(data: unknown[]): Promise<Result[]> {
  16│    return data.map(item => {                     │  24│    const results = await Promise.all(data.map(async item => {
  17│        const processed = transform(item);        │  25│        const processed = transform(item);
  18│        return validate(processed);               │  26│        return await validateAsync(processed);
  19│    });                                           │  27│    }));
     │                                                  │  28│    return results.filter(r => r !== null);
  20│}                                                 │  29│}
```

---

## 5. Python/Node脚本原型

### 5.1 Python脚本使用说明

**安装依赖**:
```bash
# 基础依赖
pip install tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-go

# 可选：嵌入向量支持
pip install sentence-transformers

# 可选：向量数据库
pip install lancedb numpy
```

**运行脚本**:
```bash
# 扫描整个项目
python reuse_detection.py scan ./my-project

# 指定相似度阈值
python reuse_detection.py scan ./my-project --threshold 0.8

# 生成Markdown报告
python reuse_detection.py scan ./my-project --format markdown --output report.md

# 生成JSON报告
python reuse_detection.py scan ./my-project --format json --output report.json

# 检查新函数是否应该复用
python reuse_detection.py check "function add(a, b) { return a + b; }" \
    --project ./my-project
```

### 5.2 Node.js脚本原型

```javascript
#!/usr/bin/env node
/**
 * reuse-detection.js - Node.js版本的代码复用检测工具
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 使用tree-sitter-wasm进行解析
const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript').typescript;
const Python = require('tree-sitter-python');
const Go = require('tree-sitter-go');

class ASTParser {
    constructor() {
        this.parsers = {
            typescript: new Parser().setLanguage(TypeScript),
            python: new Parser().setLanguage(Python),
            go: new Parser().setLanguage(Go)
        };
    }

    detectLanguage(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const langMap = {
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.py': 'python',
            '.go': 'go'
        };
        return langMap[ext];
    }

    parseFile(filePath) {
        const lang = this.detectLanguage(filePath);
        if (!lang || !this.parsers[lang]) return null;

        const content = fs.readFileSync(filePath, 'utf-8');
        const tree = this.parsers[lang].parse(content);
        
        return { tree, lang, content };
    }

    extractFunctions(filePath) {
        const result = this.parseFile(filePath);
        if (!result) return [];

        const { tree, lang, content } = result;
        const functions = [];

        // Tree-sitter查询
        const queries = {
            typescript: `
                (function_declaration
                    name: (identifier)? @name
                    parameters: (formal_parameters) @params
                    body: (statement_block) @body) @func
            `,
            python: `
                (function_definition
                    name: (identifier) @name
                    parameters: (parameters) @params
                    body: (block) @body) @func
            `,
            go: `
                (function_declaration
                    name: (identifier) @name
                    parameters: (parameter_list) @params
                    body: (block) @body) @func
            `
        };

        const query = new Parser.Query(this.parsers[lang].getLanguage(), queries[lang]);
        const matches = query.matches(tree.rootNode);

        for (const match of matches) {
            const captureMap = {};
            for (const capture of match.captures) {
                captureMap[capture.name] = capture.node;
            }

            if (captureMap.func) {
                functions.push({
                    name: captureMap.name ? content.slice(
                        captureMap.name.startIndex, 
                        captureMap.name.endIndex
                    ) : 'anonymous',
                    params: captureMap.params ? content.slice(
                        captureMap.params.startIndex,
                        captureMap.params.endIndex
                    ) : '',
                    body: captureMap.body ? content.slice(
                        captureMap.body.startIndex,
                        captureMap.body.endIndex
                    ) : '',
                    startLine: captureMap.func.startPosition.row + 1,
                    endLine: captureMap.func.endPosition.row + 1,
                    content: content.slice(
                        captureMap.func.startIndex,
                        captureMap.func.endIndex
                    )
                });
            }
        }

        return functions;
    }
}

class SimilarityCalculator {
    calculateSimilarity(func1, func2) {
        const astSim = this.astSimilarity(func1, func2);
        const textSim = this.textSimilarity(func1, func2);
        const tokenSim = this.tokenSimilarity(func1, func2);

        return {
            ast: astSim,
            text: textSim,
            token: tokenSim,
            combined: astSim * 0.4 + textSim * 0.3 + tokenSim * 0.3
        };
    }

    astSimilarity(func1, func2) {
        // 简化的AST相似度：比较结构特征
        const hash1 = this.hashString(func1.content.replace(/\s+/g, ' '));
        const hash2 = this.hashString(func2.content.replace(/\s+/g, ' '));
        
        if (hash1 === hash2) return 1.0;
        
        // 使用编辑距离
        return 1 - this.levenshteinDistance(
            func1.content.replace(/\s+/g, ''),
            func2.content.replace(/\s+/g, '')
        ) / Math.max(func1.content.length, func2.content.length);
    }

    textSimilarity(func1, func2) {
        const longer = Math.max(func1.content.length, func2.content.length);
        if (longer === 0) return 1.0;
        
        const distance = this.levenshteinDistance(func1.content, func2.content);
        return (longer - distance) / longer;
    }

    tokenSimilarity(func1, func2) {
        const tokens1 = this.tokenize(func1.content);
        const tokens2 = this.tokenize(func2.content);
        
        const set1 = new Set(tokens1);
        const set2 = new Set(tokens2);
        
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);
        
        return intersection.size / union.size;
    }

    tokenize(code) {
        return code.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b|"[^"]*"|\d+|[{}();,=+\-*/<>!&|]+/g) || [];
    }

    levenshteinDistance(str1, str2) {
        const matrix = [];
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        return matrix[str2.length][str1.length];
    }

    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    }
}

class CloneDetector {
    constructor(threshold = 0.85) {
        this.threshold = threshold;
        this.parser = new ASTParser();
        this.calculator = new SimilarityCalculator();
        this.functions = [];
    }

    scanProject(projectPath) {
        const files = this.getSourceFiles(projectPath);
        console.log(`Scanning ${files.length} files...`);

        for (const file of files) {
            const functions = this.parser.extractFunctions(file);
            this.functions.push(...functions.map(f => ({ ...f, file })));
        }

        console.log(`Found ${this.functions.length} functions`);
        return this.detectClones();
    }

    getSourceFiles(projectPath) {
        const files = [];
        const extensions = ['.ts', '.tsx', '.py', '.go'];
        
        const scanDir = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory() && 
                    !entry.name.startsWith('.') && 
                    entry.name !== 'node_modules') {
                    scanDir(fullPath);
                } else if (entry.isFile() && 
                          extensions.some(ext => entry.name.endsWith(ext))) {
                    files.push(fullPath);
                }
            }
        };

        scanDir(projectPath);
        return files;
    }

    detectClones() {
        const clones = [];
        
        for (let i = 0; i < this.functions.length; i++) {
            for (let j = i + 1; j < this.functions.length; j++) {
                const func1 = this.functions[i];
                const func2 = this.functions[j];

                const similarity = this.calculator.calculateSimilarity(func1, func2);

                if (similarity.combined >= this.threshold) {
                    clones.push({
                        func1,
                        func2,
                        similarity
                    });
                }
            }
        }

        clones.sort((a, b) => b.similarity.combined - a.similarity.combined);
        return clones;
    }

    generateReport(clones, outputPath) {
        const lines = [
            '# 代码复用分析报告\n',
            `**总函数数**: ${this.functions.length}\n`,
            `**克隆对数**: ${clones.length}\n\n`,
            '## 克隆详情\n'
        ];

        for (let i = 0; i < Math.min(clones.length, 20); i++) {
            const clone = clones[i];
            lines.push(`### ${i + 1}. ${clone.func1.name} ↔ ${clone.func2.name}\n`);
            lines.push(`- **相似度**: ${(clone.similarity.combined * 100).toFixed(2)}%\n`);
            lines.push(`- **文件1**: \`${clone.func1.file}:${clone.func1.startLine}\`\n`);
            lines.push(`- **文件2**: \`${clone.func2.file}:${clone.func2.startLine}\`\n\n`);
        }

        fs.writeFileSync(outputPath, lines.join(''), 'utf-8');
        console.log(`Report saved to ${outputPath}`);
    }
}

// CLI
function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 2 || args[0] !== 'scan') {
        console.log('Usage: node reuse-detection.js scan <project-path> [--threshold 0.85]');
        process.exit(1);
    }

    const projectPath = args[1];
    const thresholdArg = args.indexOf('--threshold');
    const threshold = thresholdArg >= 0 ? parseFloat(args[thresholdArg + 1]) : 0.85;

    const detector = new CloneDetector(threshold);
    const clones = detector.scanProject(projectPath);

    console.log(`\nFound ${clones.length} clone pairs`);
    
    if (clones.length > 0) {
        console.log('\nTop 10 clones:');
        for (let i = 0; i < Math.min(clones.length, 10); i++) {
            const c = clones[i];
            console.log(`${i + 1}. ${c.func1.name} ↔ ${c.func2.name} (${(c.similarity.combined * 100).toFixed(2)}%)`);
        }

        detector.generateReport(clones, 'reuse_report.md');
    }
}

main();
```

### 5.3 建议复用列表输出格式

```json
{
  "analysis_timestamp": "2024-01-15T10:30:00Z",
  "project_path": "/path/to/project",
  "summary": {
    "total_files": 150,
    "total_functions": 423,
    "clone_pairs_found": 28,
    "high_similarity_clones": 12,
    "unused_exports": 8
  },
  "clone_pairs": [
    {
      "rank": 1,
      "similarity": 0.97,
      "similarity_type": "ast",
      "function_a": {
        "name": "formatDate",
        "file": "src/utils/date.ts",
        "line": 45,
        "language": "typescript"
      },
      "function_b": {
        "name": "formatDateTime",
        "file": "src/helpers/formatters.ts", 
        "line": 23,
        "language": "typescript"
      },
      "suggestion": "这两个函数有97%的相似度，建议提取公共逻辑到共享模块",
      "recommended_action": "refactor",
      "diff_preview": "..."
    }
  ],
  "unused_exports": [
    {
      "name": "legacyHelper",
      "type": "function",
      "file": "src/utils/legacy.ts",
      "line": 12,
      "recommendation": "考虑删除或标记为deprecated"
    }
  ],
  "reuse_opportunities": [
    {
      "category": "date_formatting",
      "affected_files": ["src/utils/date.ts", "src/helpers/formatters.ts"],
      "suggestion": "统一日期格式化函数",
      "estimated_lines_saved": 45
    }
  ]
}
```

---

## 6. 多语言AST提取方案

### 6.1 语言支持矩阵

| 语言 | Parser | 函数节点类型 | 方法节点类型 | 导出检测 | 导入检测 |
|------|--------|-------------|-------------|---------|---------|
| TypeScript | tree-sitter-typescript | function_declaration | method_definition | ✅ | ✅ |
| JavaScript | tree-sitter-javascript | function_declaration | method_definition | ✅ | ✅ |
| Python | tree-sitter-python | function_definition | method_definition | ⚠️ | ✅ |
| Go | tree-sitter-go | function_declaration | method_declaration | ✅ | ✅ |
| Java | tree-sitter-java | method_declaration | method_declaration | ✅ | ✅ |
| Rust | tree-sitter-rust | function_item | impl_item | ✅ | ✅ |

### 6.2 TypeScript AST提取

```python
# TypeScript函数提取配置
TYPESCRIPT_CONFIG = {
    'parser': 'tree-sitter-typescript',
    'function_queries': {
        'function_declaration': '''
            (function_declaration
                name: (identifier) @func.name
                parameters: (formal_parameters) @func.params
                return_type: (type_annotation)? @func.return
                body: (statement_block) @func.body) @func.def
        ''',
        'arrow_function': '''
            (arrow_function
                parameters: (formal_parameters)? @func.params
                body: (_) @func.body) @func.def
        ''',
        'method_definition': '''
            (method_definition
                name: (property_identifier) @func.name
                parameters: (formal_parameters) @func.params
                return_type: (type_annotation)? @func.return
                body: (statement_block) @func.body) @func.def
        ''',
        'class_method': '''
            (class_declaration
                name: (type_identifier) @class.name
                body: (class_body
                    (method_definition
                        name: (property_identifier) @method.name
                        parameters: (formal_parameters) @method.params
                        body: (statement_block) @method.body) @method.def))
        '''
    },
    'export_detection': {
        'export_keyword': 'export',
        'export_statement': 'export_statement',
        'default_export': 'export default'
    },
    'import_detection': {
        'import_statement': 'import_statement',
        'import_clause': 'import_clause',
        'named_imports': 'named_imports'
    }
}
```

### 6.3 Python AST提取

```python
# Python函数提取配置
PYTHON_CONFIG = {
    'parser': 'tree-sitter-python',
    'function_queries': {
        'function_definition': '''
            (function_definition
                name: (identifier) @func.name
                parameters: (parameters) @func.params
                return_type: (type)? @func.return
                body: (block) @func.body) @func.def
        ''',
        'async_function': '''
            (async_function_definition
                name: (identifier) @func.name
                parameters: (parameters) @func.params
                return_type: (type)? @func.return
                body: (block) @func.body) @func.def
        ''',
        'class_method': '''
            (class_definition
                name: (identifier) @class.name
                body: (block
                    (function_definition
                        name: (identifier) @method.name
                        parameters: (parameters) @method.params
                        body: (block) @method.body) @method.def))
        ''',
        'lambda': '''
            (lambda
                parameters: (lambda_parameters)? @lambda.params
                body: (_) @lambda.body) @lambda.def
        '''
    },
    'export_detection': {
        # Python没有显式导出，使用__all__或模块级变量
        'all_variable': '__all__',
        'module_level': True
    },
    'import_detection': {
        'import_statement': 'import_statement',
        'from_import': 'import_from_statement'
    }
}
```

### 6.4 Go AST提取

```python
# Go函数提取配置
GO_CONFIG = {
    'parser': 'tree-sitter-go',
    'function_queries': {
        'function_declaration': '''
            (function_declaration
                name: (identifier) @func.name
                parameters: (parameter_list) @func.params
                result: (_)? @func.return
                body: (block) @func.body) @func.def
        ''',
        'method_declaration': '''
            (method_declaration
                receiver: (parameter_list) @method.receiver
                name: (field_identifier) @method.name
                parameters: (parameter_list) @method.params
                result: (_)? @method.return
                body: (block) @method.body) @method.def
        ''',
        'interface_method': '''
            (interface_type
                (method_spec
                    name: (field_identifier) @interface.method.name
                    parameters: (parameter_list) @interface.method.params
                    result: (_)? @interface.method.return) @interface.method.def)
        '''
    },
    'export_detection': {
        # Go使用首字母大写表示导出
        'exported_pattern': '^[A-Z]',
        'check_case': True
    },
    'import_detection': {
        'import_declaration': 'import_declaration',
        'import_spec': 'import_spec'
    }
}
```

### 6.5 通用AST提取器

```python
class MultiLanguageASTExtractor:
    """多语言AST提取器"""
    
    LANGUAGE_CONFIGS = {
        'typescript': TYPESCRIPT_CONFIG,
        'javascript': TYPESCRIPT_CONFIG,  # JavaScript是TypeScript的子集
        'python': PYTHON_CONFIG,
        'go': GO_CONFIG
    }
    
    def __init__(self):
        self.parsers = {}
        self._init_parsers()
    
    def _init_parsers(self):
        """初始化所有语言解析器"""
        import tree_sitter_typescript as ts_ts
        import tree_sitter_python as ts_py
        import tree_sitter_go as ts_go
        
        self.languages = {
            'typescript': Language(ts_ts.language()),
            'python': Language(ts_py.language()),
            'go': Language(ts_go.language())
        }
        
        for lang, language in self.languages.items():
            parser = Parser(language)
            self.parsers[lang] = parser
    
    def extract_from_file(self, file_path: str) -> Dict[str, Any]:
        """从文件提取AST信息"""
        lang = self._detect_language(file_path)
        if not lang:
            return {}
        
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        tree = self.parsers[lang].parse(bytes(content, 'utf8'))
        config = self.LANGUAGE_CONFIGS[lang]
        
        result = {
            'language': lang,
            'file_path': file_path,
            'functions': [],
            'classes': [],
            'exports': [],
            'imports': []
        }
        
        # 提取函数
        for query_name, query_str in config['function_queries'].items():
            functions = self._extract_with_query(
                tree, content, self.languages[lang], query_str
            )
            for func in functions:
                func['query_type'] = query_name
                result['functions'].append(func)
        
        return result
    
    def _detect_language(self, file_path: str) -> Optional[str]:
        """检测文件语言"""
        ext = Path(file_path).suffix.lower()
        ext_map = {
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.py': 'python',
            '.go': 'go'
        }
        return ext_map.get(ext)
    
    def _extract_with_query(self, tree, content: str, 
                           language: Language, query_str: str) -> List[Dict]:
        """使用查询提取节点"""
        query = Query(language, query_str)
        cursor = QueryCursor(query)
        
        results = []
        content_bytes = bytes(content, 'utf8')
        
        for match in cursor.matches(tree.root_node):
            captures = {}
            for capture in match.captures:
                node = capture.node
                capture_name = capture.name
                captures[capture_name] = {
                    'text': content_bytes[node.start_byte:node.end_byte].decode('utf8'),
                    'start_line': node.start_point[0] + 1,
                    'end_line': node.end_point[0] + 1,
                    'start_byte': node.start_byte,
                    'end_byte': node.end_byte
                }
            
            if captures:
                results.append(captures)
        
        return results
```

---

## 附录A: 安装和配置

### A.1 完整依赖列表

```txt
# requirements.txt
tree-sitter>=0.20.0
tree-sitter-typescript>=0.20.0
tree-sitter-python>=0.20.0
tree-sitter-go>=0.19.0
tree-sitter-javascript>=0.20.0

# 可选依赖
sentence-transformers>=2.2.0
numpy>=1.21.0
lancedb>=0.3.0
```

```json
// package.json (Node.js版本)
{
  "name": "reuse-detection",
  "version": "1.0.0",
  "dependencies": {
    "tree-sitter": "^0.20.0",
    "tree-sitter-typescript": "^0.20.0",
    "tree-sitter-python": "^0.20.0",
    "tree-sitter-go": "^0.19.0"
  }
}
```

### A.2 工具配置示例

```yaml
# reuse-config.yaml
similarity:
  threshold: 0.85
  methods:
    - ast
    - token
    - embedding
  weights:
    ast: 0.4
    token: 0.3
    embedding: 0.3

languages:
  typescript:
    extensions: ['.ts', '.tsx']
    enabled: true
  python:
    extensions: ['.py']
    enabled: true
  go:
    extensions: ['.go']
    enabled: true

exclusions:
  directories:
    - node_modules
    - .git
    - __pycache__
    - dist
    - build
  files:
    - '*.test.ts'
    - '*.spec.ts'
    - '*.min.js'

output:
  format: markdown
  max_clones: 50
  include_diff: true
  diff_context_lines: 3
```

---

## 附录B: 性能优化建议

1. **并行处理**: 使用多线程/多进程处理文件
2. **增量扫描**: 只扫描变更的文件
3. **缓存机制**: 缓存AST解析结果
4. **向量索引**: 使用FAISS或Annoy加速相似度搜索
5. **分层检索**: 先哈希匹配，再精确计算
