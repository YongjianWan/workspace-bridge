#!/usr/bin/env python3
"""
代码复用发现机制 - Code Reuse Detection System
===============================================
功能：扫描项目代码，检测相似函数克隆和未使用导出，输出建议复用列表

作者：AI Code Analysis Expert
版本：1.0.0
"""

import os
import sys
import json
import hashlib
import difflib
from pathlib import Path
from typing import List, Dict, Tuple, Optional, Set, Any
from dataclasses import dataclass, field
from collections import defaultdict
import argparse

# Tree-sitter imports
try:
    from tree_sitter import Language, Parser, Query, QueryCursor, Node
    TREE_SITTER_AVAILABLE = True
except ImportError:
    TREE_SITTER_AVAILABLE = False
    print("Warning: tree-sitter not installed. Install with: pip install tree-sitter")

# Language bindings
try:
    import tree_sitter_typescript as ts_typescript
    import tree_sitter_python as ts_python
    import tree_sitter_go as ts_go
    import tree_sitter_javascript as ts_javascript
    LANG_BINDINGS_AVAILABLE = True
except ImportError:
    LANG_BINDINGS_AVAILABLE = False
    print("Warning: Language bindings not installed.")

# Embedding similarity (optional)
try:
    from sentence_transformers import SentenceTransformer
    EMBEDDING_AVAILABLE = True
except ImportError:
    EMBEDDING_AVAILABLE = False


# =============================================================================
# 数据模型
# =============================================================================

@dataclass
class FunctionInfo:
    """函数信息数据结构"""
    name: str
    file_path: str
    start_line: int
    end_line: int
    start_byte: int
    end_byte: int
    content: str
    normalized_content: str
    ast_hash: str
    language: str
    parameters: List[str] = field(default_factory=list)
    return_type: Optional[str] = None
    docstring: Optional[str] = None
    is_exported: bool = False
    is_async: bool = False

@dataclass
class ClonePair:
    """克隆对数据结构"""
    func1: FunctionInfo
    func2: FunctionInfo
    similarity: float
    similarity_type: str  # 'ast', 'text', 'token', 'embedding'
    diff: List[str] = field(default_factory=list)

@dataclass
class UnusedExport:
    """未使用导出数据结构"""
    name: str
    file_path: str
    export_type: str  # 'function', 'class', 'variable', 'interface'
    line_number: int
    content: str

@dataclass
class ReuseSuggestion:
    """复用建议数据结构"""
    new_function_name: str
    similar_functions: List[ClonePair]
    confidence: float
    action: str  # 'reuse', 'refactor', 'ignore'
    reason: str


# =============================================================================
# 语言配置
# =============================================================================

LANGUAGE_CONFIG = {
    'typescript': {
        'extensions': ['.ts', '.tsx'],
        'function_query': '''
            (function_declaration
                name: (identifier)? @func.name
                parameters: (formal_parameters) @func.params
                return_type: (type_annotation)? @func.return
                body: (statement_block) @func.body) @func.def
            
            (method_definition
                name: (property_identifier)? @func.name
                parameters: (formal_parameters) @func.params
                return_type: (type_annotation)? @func.return
                body: (statement_block) @func.body) @func.def
            
            (arrow_function
                parameters: (formal_parameters)? @func.params
                body: (_) @func.body) @func.def
            
            (export_statement
                (function_declaration
                    name: (identifier) @func.name) @func.def) @func.export
        ''',
        'export_query': '''
            (export_statement
                (function_declaration name: (identifier) @export.name)
                (class_declaration name: (type_identifier) @export.name)
                (interface_declaration name: (type_identifier) @export.name)
                (type_alias_declaration name: (type_identifier) @export.name)
                (variable_declaration (variable_declarator name: (identifier) @export.name))
            ) @export.stmt
        ''',
        'import_query': '''
            (import_statement
                (import_clause (identifier)? @import.name)
                (import_clause (named_imports (import_specifier (identifier) @import.name)))
                source: (string) @import.source
            ) @import.stmt
        '''
    },
    'javascript': {
        'extensions': ['.js', '.jsx', '.mjs'],
        'function_query': '''
            (function_declaration
                name: (identifier)? @func.name
                parameters: (formal_parameters) @func.params
                body: (statement_block) @func.body) @func.def
            
            (method_definition
                name: (property_identifier)? @func.name
                parameters: (formal_parameters) @func.params
                body: (statement_block) @func.body) @func.def
            
            (arrow_function
                parameters: (formal_parameters)? @func.params
                body: (_) @func.body) @func.def
            
            (export_statement
                (function_declaration name: (identifier) @func.name) @func.def) @func.export
        ''',
        'export_query': '''
            (export_statement
                declaration: (_ name: (identifier) @export.name)
            ) @export.stmt
        ''',
        'import_query': '''
            (import_statement
                (import_clause (identifier)? @import.name)
                (import_clause (named_imports (import_specifier (identifier) @import.name)))
            ) @import.stmt
        '''
    },
    'python': {
        'extensions': ['.py'],
        'function_query': '''
            (function_definition
                name: (identifier) @func.name
                parameters: (parameters) @func.params
                return_type: (type)? @func.return
                body: (block) @func.body) @func.def
            
            (async_function_definition
                name: (identifier) @func.name
                parameters: (parameters) @func.params
                return_type: (type)? @func.return
                body: (block) @func.body) @func.def
        ''',
        'export_query': '''
            (expression_statement
                (assignment
                    left: (identifier) @export.name
                    right: (_)
                )) @export.stmt
            
            (class_definition
                name: (identifier) @export.name) @export.stmt
        ''',
        'import_query': '''
            (import_statement
                name: (dotted_name (identifier) @import.name)
                (import_from_statement
                    module: (dotted_name)?
                    name: (dotted_name (identifier) @import.name))
            ) @import.stmt
        '''
    },
    'go': {
        'extensions': ['.go'],
        'function_query': '''
            (function_declaration
                name: (identifier) @func.name
                parameters: (parameter_list) @func.params
                result: (_)? @func.return
                body: (block) @func.body) @func.def
            
            (method_declaration
                name: (field_identifier) @func.name
                parameters: (parameter_list) @func.params
                result: (_)? @func.return
                body: (block) @func.body) @func.def
        ''',
        'export_query': '''
            (function_declaration
                name: (identifier) @export.name) @export.stmt
            
            (type_declaration
                (type_spec name: (type_identifier) @export.name)) @export.stmt
            
            (var_declaration
                (var_spec name: (identifier) @export.name)) @export.stmt
        ''',
        'import_query': '''
            (import_spec
                path: (interpreted_string_literal) @import.path
                name: (identifier)? @import.name) @import.stmt
        '''
    }
}


# =============================================================================
# AST解析器
# =============================================================================

class ASTParser:
    """AST解析器 - 使用Tree-sitter解析代码"""
    
    def __init__(self):
        self.parsers: Dict[str, Parser] = {}
        self.languages: Dict[str, Language] = {}
        self._init_languages()
    
    def _init_languages(self):
        """初始化语言解析器"""
        if not LANG_BINDINGS_AVAILABLE:
            return
        
        language_bindings = {
            'typescript': ts_typescript,
            'javascript': ts_javascript,
            'python': ts_python,
            'go': ts_go
        }
        
        for lang_name, binding in language_bindings.items():
            try:
                self.languages[lang_name] = Language(binding.language())
                parser = Parser(self.languages[lang_name])
                self.parsers[lang_name] = parser
            except Exception as e:
                print(f"Warning: Failed to initialize {lang_name} parser: {e}")
    
    def detect_language(self, file_path: str) -> Optional[str]:
        """根据文件扩展名检测语言"""
        ext = Path(file_path).suffix.lower()
        for lang, config in LANGUAGE_CONFIG.items():
            if ext in config['extensions']:
                return lang
        return None
    
    def parse_file(self, file_path: str) -> Optional[Tuple[Any, str]]:
        """解析文件，返回AST树和语言"""
        lang = self.detect_language(file_path)
        if not lang or lang not in self.parsers:
            return None
        
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            
            tree = self.parsers[lang].parse(bytes(content, 'utf8'))
            return tree, lang
        except Exception as e:
            print(f"Error parsing {file_path}: {e}")
            return None
    
    def extract_functions(self, file_path: str) -> List[FunctionInfo]:
        """从文件中提取所有函数定义"""
        result = self.parse_file(file_path)
        if not result:
            return []
        
        tree, lang = result
        config = LANGUAGE_CONFIG[lang]
        query_str = config['function_query']
        
        try:
            query = Query(self.languages[lang], query_str)
        except Exception as e:
            print(f"Error creating query for {lang}: {e}")
            return []
        
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        content_bytes = bytes(content, 'utf8')
        
        functions = []
        cursor = QueryCursor(query)
        captures = cursor.matches(tree.root_node)
        
        for match in captures:
            try:
                func_info = self._process_function_match(
                    match, content_bytes, file_path, lang
                )
                if func_info:
                    functions.append(func_info)
            except Exception as e:
                continue
        
        return functions
    
    def _process_function_match(self, match, content_bytes: bytes, 
                                 file_path: str, lang: str) -> Optional[FunctionInfo]:
        """处理函数匹配结果"""
        captures = match[1] if isinstance(match, tuple) else match.captures
        
        func_node = None
        name = "anonymous"
        params = []
        return_type = None
        is_exported = False
        is_async = False
        
        for capture in captures:
            if isinstance(capture, tuple):
                node, capture_name = capture
            else:
                node = capture.node
                capture_name = capture.name
            
            if capture_name == 'func.def':
                func_node = node
            elif capture_name == 'func.name':
                name = content_bytes[node.start_byte:node.end_byte].decode('utf8')
            elif capture_name == 'func.params':
                params_text = content_bytes[node.start_byte:node.end_byte].decode('utf8')
                params = self._extract_params(params_text)
            elif capture_name == 'func.return':
                return_type = content_bytes[node.start_byte:node.end_byte].decode('utf8')
            elif capture_name == 'func.export':
                is_exported = True
        
        if not func_node:
            return None
        
        func_content = content_bytes[func_node.start_byte:func_node.end_byte].decode('utf8')
        normalized = self._normalize_function(func_content, lang)
        ast_hash = hashlib.md5(normalized.encode()).hexdigest()
        
        # 检测async
        if 'async ' in func_content[:50] or lang == 'python' and func_content.strip().startswith('async '):
            is_async = True
        
        return FunctionInfo(
            name=name,
            file_path=file_path,
            start_line=func_node.start_point[0] + 1,
            end_line=func_node.end_point[0] + 1,
            start_byte=func_node.start_byte,
            end_byte=func_node.end_byte,
            content=func_content,
            normalized_content=normalized,
            ast_hash=ast_hash,
            language=lang,
            parameters=params,
            return_type=return_type,
            is_exported=is_exported,
            is_async=is_async
        )
    
    def _extract_params(self, params_text: str) -> List[str]:
        """提取参数列表"""
        # 简化处理，移除括号和空格
        params_text = params_text.strip('()')
        if not params_text:
            return []
        return [p.strip().split(':')[0].split('=')[0].strip() 
                for p in params_text.split(',') if p.strip()]
    
    def _normalize_function(self, content: str, lang: str) -> str:
        """规范化函数内容用于比较"""
        import re
        
        # 移除注释
        if lang in ['typescript', 'javascript']:
            content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
            content = re.sub(r'//.*?$', '', content, flags=re.MULTILINE)
        elif lang == 'python':
            content = re.sub(r'""".*?"""', '', content, flags=re.DOTALL)
            content = re.sub(r"'''.*?'''", '', content, flags=re.DOTALL)
            content = re.sub(r'#.*?$', '', content, flags=re.MULTILINE)
        elif lang == 'go':
            content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
            content = re.sub(r'//.*?$', '', content, flags=re.MULTILINE)
        
        # 规范化空白字符
        content = re.sub(r'\s+', ' ', content)
        
        # 规范化标识符（替换变量名为通用名称）
        content = self._normalize_identifiers(content, lang)
        
        return content.strip()
    
    def _normalize_identifiers(self, content: str, lang: str) -> str:
        """规范化标识符名称"""
        import re
        
        # 简单的规范化：将标识符替换为占位符
        # 这是一个简化版本，实际应用中可能需要更复杂的处理
        words = re.findall(r'\b[a-zA-Z_][a-zA-Z0-9_]*\b', content)
        
        # 保留关键字
        keywords = self._get_keywords(lang)
        
        var_counter = 0
        seen_vars = {}
        
        def replace_var(match):
            nonlocal var_counter
            word = match.group(0)
            if word in keywords:
                return word
            if word not in seen_vars:
                seen_vars[word] = f'VAR{var_counter}'
                var_counter += 1
            return seen_vars[word]
        
        return re.sub(r'\b[a-zA-Z_][a-zA-Z0-9_]*\b', replace_var, content)
    
    def _get_keywords(self, lang: str) -> Set[str]:
        """获取语言关键字"""
        keywords = {
            'typescript': {'function', 'const', 'let', 'var', 'return', 'if', 'else', 
                          'for', 'while', 'class', 'interface', 'type', 'export', 
                          'import', 'from', 'async', 'await', 'try', 'catch', 'throw'},
            'javascript': {'function', 'const', 'let', 'var', 'return', 'if', 'else',
                          'for', 'while', 'class', 'export', 'import', 'from',
                          'async', 'await', 'try', 'catch', 'throw'},
            'python': {'def', 'return', 'if', 'else', 'elif', 'for', 'while', 'class',
                      'import', 'from', 'as', 'try', 'except', 'raise', 'async', 'await',
                      'with', 'pass', 'break', 'continue'},
            'go': {'func', 'return', 'if', 'else', 'for', 'range', 'type', 'struct',
                   'interface', 'import', 'package', 'var', 'const', 'defer', 'go',
                   'chan', 'select', 'switch', 'case', 'default'}
        }
        return keywords.get(lang, set())


# =============================================================================
# 相似度计算
# =============================================================================

class SimilarityCalculator:
    """相似度计算器"""
    
    def __init__(self, use_embedding: bool = False):
        self.use_embedding = use_embedding and EMBEDDING_AVAILABLE
        self.embedding_model = None
        
        if self.use_embedding:
            try:
                self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
            except Exception as e:
                print(f"Warning: Failed to load embedding model: {e}")
                self.use_embedding = False
    
    def calculate_similarity(self, func1: FunctionInfo, func2: FunctionInfo,
                            method: str = 'combined') -> Tuple[float, str]:
        """计算两个函数的相似度"""
        
        if method == 'ast':
            return self._ast_similarity(func1, func2), 'ast'
        elif method == 'text':
            return self._text_similarity(func1, func2), 'text'
        elif method == 'token':
            return self._token_similarity(func1, func2), 'token'
        elif method == 'embedding':
            return self._embedding_similarity(func1, func2), 'embedding'
        else:  # combined
            return self._combined_similarity(func1, func2)
    
    def _ast_similarity(self, func1: FunctionInfo, func2: FunctionInfo) -> float:
        """基于AST哈希的相似度"""
        if func1.ast_hash == func2.ast_hash:
            return 1.0
        
        # 使用规范化内容的相似度
        return difflib.SequenceMatcher(
            None, func1.normalized_content, func2.normalized_content
        ).ratio()
    
    def _text_similarity(self, func1: FunctionInfo, func2: FunctionInfo) -> float:
        """基于原始文本的相似度"""
        return difflib.SequenceMatcher(
            None, func1.content, func2.content
        ).ratio()
    
    def _token_similarity(self, func1: FunctionInfo, func2: FunctionInfo) -> float:
        """基于token的相似度"""
        import re
        
        # 简单的token化
        def tokenize(text: str) -> List[str]:
            # 保留标识符、字符串、数字
            pattern = r'"[^"]*"|\b[a-zA-Z_][a-zA-Z0-9_]*\b|\b\d+\b|[{}();,=+\-*/<>!&|]+'
            return re.findall(pattern, text)
        
        tokens1 = tokenize(func1.content)
        tokens2 = tokenize(func2.content)
        
        if not tokens1 or not tokens2:
            return 0.0
        
        # 使用集合计算Jaccard相似度
        set1, set2 = set(tokens1), set(tokens2)
        intersection = len(set1 & set2)
        union = len(set1 | set2)
        
        return intersection / union if union > 0 else 0.0
    
    def _embedding_similarity(self, func1: FunctionInfo, func2: FunctionInfo) -> float:
        """基于嵌入向量的相似度"""
        if not self.use_embedding or not self.embedding_model:
            return self._text_similarity(func1, func2)
        
        try:
            emb1 = self.embedding_model.encode([func1.content])[0]
            emb2 = self.embedding_model.encode([func2.content])[0]
            
            # 余弦相似度
            import numpy as np
            dot = np.dot(emb1, emb2)
            norm1 = np.linalg.norm(emb1)
            norm2 = np.linalg.norm(emb2)
            
            return float(dot / (norm1 * norm2)) if norm1 > 0 and norm2 > 0 else 0.0
        except Exception:
            return self._text_similarity(func1, func2)
    
    def _combined_similarity(self, func1: FunctionInfo, func2: FunctionInfo) -> Tuple[float, str]:
        """组合多种相似度方法"""
        ast_sim = self._ast_similarity(func1, func2)
        text_sim = self._text_similarity(func1, func2)
        token_sim = self._token_similarity(func1, func2)
        
        # 加权平均
        combined = ast_sim * 0.4 + text_sim * 0.3 + token_sim * 0.3
        
        # 如果AST相似度很高，优先考虑
        if ast_sim > 0.9:
            return ast_sim, 'ast'
        
        return combined, 'combined'


# =============================================================================
# 克隆检测器
# =============================================================================

class CloneDetector:
    """代码克隆检测器"""
    
    def __init__(self, similarity_threshold: float = 0.85,
                 use_embedding: bool = False):
        self.similarity_threshold = similarity_threshold
        self.calculator = SimilarityCalculator(use_embedding)
        self.functions: List[FunctionInfo] = []
        self.clone_pairs: List[ClonePair] = []
    
    def add_functions(self, functions: List[FunctionInfo]):
        """添加函数到检测池"""
        self.functions.extend(functions)
    
    def detect_clones(self) -> List[ClonePair]:
        """检测所有克隆对"""
        self.clone_pairs = []
        
        # 按AST哈希分组进行快速预筛选
        hash_groups = defaultdict(list)
        for func in self.functions:
            hash_groups[func.ast_hash[:16]].append(func)
        
        # 只在相同哈希组内比较
        for hash_prefix, group in hash_groups.items():
            if len(group) < 2:
                continue
            
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    func1, func2 = group[i], group[j]
                    
                    # 跳过同一文件内的函数（通常是重载）
                    if func1.file_path == func2.file_path and func1.name == func2.name:
                        continue
                    
                    similarity, sim_type = self.calculator.calculate_similarity(
                        func1, func2, 'combined'
                    )
                    
                    if similarity >= self.similarity_threshold:
                        diff = self._generate_diff(func1, func2)
                        self.clone_pairs.append(ClonePair(
                            func1=func1,
                            func2=func2,
                            similarity=similarity,
                            similarity_type=sim_type,
                            diff=diff
                        ))
        
        # 按相似度排序
        self.clone_pairs.sort(key=lambda x: x.similarity, reverse=True)
        return self.clone_pairs
    
    def _generate_diff(self, func1: FunctionInfo, func2: FunctionInfo) -> List[str]:
        """生成两个函数的diff"""
        lines1 = func1.content.splitlines(keepends=True)
        lines2 = func2.content.splitlines(keepends=True)
        
        diff = list(difflib.unified_diff(
            lines1, lines2,
            fromfile=f"{func1.name} ({func1.file_path}:{func1.start_line})",
            tofile=f"{func2.name} ({func2.file_path}:{func2.start_line})",
            lineterm=''
        ))
        
        return diff[:50]  # 限制diff长度
    
    def get_suggestions_for_new_function(self, new_func: FunctionInfo,
                                          top_k: int = 3) -> List[ReuseSuggestion]:
        """为新函数获取复用建议"""
        similarities = []
        
        for existing_func in self.functions:
            if existing_func.file_path == new_func.file_path:
                continue
            
            similarity, sim_type = self.calculator.calculate_similarity(
                new_func, existing_func, 'combined'
            )
            
            if similarity >= self.similarity_threshold:
                diff = self._generate_diff(new_func, existing_func)
                similarities.append(ClonePair(
                    func1=new_func,
                    func2=existing_func,
                    similarity=similarity,
                    similarity_type=sim_type,
                    diff=diff
                ))
        
        similarities.sort(key=lambda x: x.similarity, reverse=True)
        
        if not similarities:
            return [ReuseSuggestion(
                new_function_name=new_func.name,
                similar_functions=[],
                confidence=0.0,
                action='create_new',
                reason='No similar functions found in codebase'
            )]
        
        # 根据相似度决定行动
        top_similar = similarities[:top_k]
        max_sim = top_similar[0].similarity
        
        if max_sim >= 0.95:
            action = 'reuse'
            reason = f'Found nearly identical function (similarity: {max_sim:.2%})'
        elif max_sim >= 0.85:
            action = 'refactor'
            reason = f'Found similar function that could be refactored (similarity: {max_sim:.2%})'
        else:
            action = 'consider'
            reason = f'Found somewhat similar functions (similarity: {max_sim:.2%})'
        
        return [ReuseSuggestion(
            new_function_name=new_func.name,
            similar_functions=top_similar,
            confidence=max_sim,
            action=action,
            reason=reason
        )]


# =============================================================================
# 未使用导出检测器
# =============================================================================

class UnusedExportDetector:
    """未使用导出检测器"""
    
    def __init__(self, parser: ASTParser):
        self.parser = parser
        self.exports: Dict[str, List[Dict]] = defaultdict(list)
        self.imports: Dict[str, Set[str]] = defaultdict(set)
    
    def scan_project(self, project_path: str) -> List[UnusedExport]:
        """扫描项目检测未使用导出"""
        self.exports.clear()
        self.imports.clear()
        
        # 收集所有导出和导入
        for root, _, files in os.walk(project_path):
            for file in files:
                file_path = os.path.join(root, file)
                self._analyze_file(file_path)
        
        # 检测未使用的导出
        unused = []
        for file_path, exports in self.exports.items():
            for export in exports:
                if not self._is_export_used(export):
                    unused.append(UnusedExport(
                        name=export['name'],
                        file_path=file_path,
                        export_type=export['type'],
                        line_number=export['line'],
                        content=export.get('content', '')
                    ))
        
        return unused
    
    def _analyze_file(self, file_path: str):
        """分析单个文件"""
        result = self.parser.parse_file(file_path)
        if not result:
            return
        
        tree, lang = result
        config = LANGUAGE_CONFIG[lang]
        
        # 解析导出
        try:
            export_query = Query(self.parser.languages[lang], config['export_query'])
            cursor = QueryCursor(export_query)
            
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            content_bytes = bytes(content, 'utf8')
            
            for match in cursor.matches(tree.root_node):
                self._process_export_match(match, file_path, content_bytes, lang)
        except Exception as e:
            pass
        
        # 解析导入
        try:
            import_query = Query(self.parser.languages[lang], config['import_query'])
            cursor = QueryCursor(import_query)
            
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            content_bytes = bytes(content, 'utf8')
            
            for match in cursor.matches(tree.root_node):
                self._process_import_match(match, file_path, content_bytes)
        except Exception as e:
            pass
    
    def _process_export_match(self, match, file_path: str, content_bytes: bytes, lang: str):
        """处理导出匹配"""
        captures = match[1] if isinstance(match, tuple) else match.captures
        
        for capture in captures:
            if isinstance(capture, tuple):
                node, capture_name = capture
            else:
                node = capture.node
                capture_name = capture.name
            
            if capture_name == 'export.name':
                name = content_bytes[node.start_byte:node.end_byte].decode('utf8')
                
                # 推断类型
                export_type = self._infer_export_type(node, content_bytes, lang)
                
                self.exports[file_path].append({
                    'name': name,
                    'type': export_type,
                    'line': node.start_point[0] + 1,
                    'content': content_bytes[node.start_byte:node.end_byte].decode('utf8')
                })
    
    def _process_import_match(self, match, file_path: str, content_bytes: bytes):
        """处理导入匹配"""
        captures = match[1] if isinstance(match, tuple) else match.captures
        
        for capture in captures:
            if isinstance(capture, tuple):
                node, capture_name = capture
            else:
                node = capture.node
                capture_name = capture.name
            
            if capture_name == 'import.name':
                name = content_bytes[node.start_byte:node.end_byte].decode('utf8')
                self.imports[file_path].add(name)
    
    def _infer_export_type(self, node, content_bytes: bytes, lang: str) -> str:
        """推断导出类型"""
        parent = node.parent
        if not parent:
            return 'unknown'
        
        parent_type = parent.type
        
        if 'function' in parent_type:
            return 'function'
        elif 'class' in parent_type:
            return 'class'
        elif 'interface' in parent_type:
            return 'interface'
        elif 'type' in parent_type:
            return 'type'
        elif 'variable' in parent_type or 'var' in parent_type:
            return 'variable'
        
        return 'unknown'
    
    def _is_export_used(self, export: Dict) -> bool:
        """检查导出是否被使用"""
        export_name = export['name']
        
        # 检查所有导入中是否使用了该导出
        for file_imports in self.imports.values():
            if export_name in file_imports:
                return True
        
        # 检查同一文件内的使用
        # 这里简化处理，实际应该分析AST
        return False


# =============================================================================
# 主分析器
# =============================================================================

class ReuseAnalyzer:
    """代码复用分析器主类"""
    
    def __init__(self, similarity_threshold: float = 0.85,
                 use_embedding: bool = False):
        self.parser = ASTParser()
        self.clone_detector = CloneDetector(similarity_threshold, use_embedding)
        self.unused_detector = UnusedExportDetector(self.parser)
        self.similarity_threshold = similarity_threshold
    
    def analyze_project(self, project_path: str) -> Dict:
        """分析整个项目"""
        print(f"Analyzing project: {project_path}")
        
        # 收集所有函数
        all_functions = []
        file_count = 0
        
        for root, _, files in os.walk(project_path):
            # 跳过node_modules等目录
            if 'node_modules' in root or '.git' in root or '__pycache__' in root:
                continue
            
            for file in files:
                file_path = os.path.join(root, file)
                lang = self.parser.detect_language(file_path)
                if lang:
                    functions = self.parser.extract_functions(file_path)
                    all_functions.extend(functions)
                    file_count += 1
        
        print(f"Scanned {file_count} files, found {len(all_functions)} functions")
        
        # 检测克隆
        self.clone_detector.add_functions(all_functions)
        clones = self.clone_detector.detect_clones()
        
        # 检测未使用导出
        unused_exports = self.unused_detector.scan_project(project_path)
        
        return {
            'total_functions': len(all_functions),
            'files_scanned': file_count,
            'clone_pairs': clones,
            'unused_exports': unused_exports,
            'clone_summary': self._summarize_clones(clones),
            'reuse_opportunities': self._identify_reuse_opportunities(clones)
        }
    
    def _summarize_clones(self, clones: List[ClonePair]) -> Dict:
        """汇总克隆信息"""
        if not clones:
            return {'count': 0, 'high_similarity': 0, 'medium_similarity': 0}
        
        high_sim = sum(1 for c in clones if c.similarity >= 0.9)
        medium_sim = sum(1 for c in clones if 0.85 <= c.similarity < 0.9)
        
        return {
            'count': len(clones),
            'high_similarity': high_sim,
            'medium_similarity': medium_sim,
            'average_similarity': sum(c.similarity for c in clones) / len(clones)
        }
    
    def _identify_reuse_opportunities(self, clones: List[ClonePair]) -> List[Dict]:
        """识别复用机会"""
        opportunities = []
        
        # 按文件分组克隆
        file_clones = defaultdict(list)
        for clone in clones:
            file_clones[clone.func1.file_path].append(clone)
        
        for file_path, file_clone_list in file_clones.items():
            if len(file_clone_list) >= 2:
                opportunities.append({
                    'file': file_path,
                    'type': 'multiple_similar_functions',
                    'count': len(file_clone_list),
                    'suggestion': 'Consider extracting common logic into shared utility'
                })
        
        return opportunities
    
    def check_new_function(self, function_code: str, file_path: str = '') -> Dict:
        """检查新函数是否应该复用现有实现"""
        # 创建一个临时函数信息
        temp_func = FunctionInfo(
            name='__new_function__',
            file_path=file_path or '__temp__',
            start_line=1,
            end_line=len(function_code.splitlines()),
            start_byte=0,
            end_byte=len(function_code),
            content=function_code,
            normalized_content=function_code,
            ast_hash=hashlib.md5(function_code.encode()).hexdigest(),
            language='unknown'
        )
        
        suggestions = self.clone_detector.get_suggestions_for_new_function(temp_func)
        
        return {
            'should_reuse': any(s.action in ['reuse', 'refactor'] for s in suggestions),
            'suggestions': [
                {
                    'action': s.action,
                    'confidence': s.confidence,
                    'reason': s.reason,
                    'similar_functions': [
                        {
                            'name': cp.func2.name,
                            'file': cp.func2.file_path,
                            'line': cp.func2.start_line,
                            'similarity': cp.similarity,
                            'similarity_type': cp.similarity_type
                        }
                        for cp in s.similar_functions[:3]
                    ]
                }
                for s in suggestions
            ]
        }


# =============================================================================
# 报告生成
# =============================================================================

class ReportGenerator:
    """报告生成器"""
    
    @staticmethod
    def generate_markdown_report(results: Dict, output_path: str):
        """生成Markdown格式报告"""
        lines = []
        
        lines.append("# 代码复用分析报告\n")
        lines.append(f"**扫描文件数**: {results['files_scanned']}\n")
        lines.append(f"**函数总数**: {results['total_functions']}\n")
        lines.append(f"**克隆对数**: {results['clone_summary']['count']}\n")
        lines.append("\n---\n")
        
        # 克隆摘要
        lines.append("## 克隆摘要\n")
        summary = results['clone_summary']
        lines.append(f"- 总克隆对: {summary['count']}\n")
        lines.append(f"- 高相似度(≥90%): {summary['high_similarity']}\n")
        lines.append(f"- 中等相似度(85-90%): {summary['medium_similarity']}\n")
        if summary['count'] > 0:
            lines.append(f"- 平均相似度: {summary['average_similarity']:.2%}\n")
        lines.append("\n")
        
        # 详细克隆对
        lines.append("## 详细克隆对\n")
        for i, clone in enumerate(results['clone_pairs'][:20], 1):
            lines.append(f"### {i}. {clone.func1.name} ↔ {clone.func2.name}\n")
            lines.append(f"- **相似度**: {clone.similarity:.2%} ({clone.similarity_type})\n")
            lines.append(f"- **文件1**: `{clone.func1.file_path}:{clone.func1.start_line}`\n")
            lines.append(f"- **文件2**: `{clone.func2.file_path}:{clone.func2.start_line}`\n")
            
            if clone.diff:
                lines.append("\n**Diff预览**:\n")
                lines.append("```diff\n")
                lines.extend(clone.diff[:15])
                lines.append("\n```\n")
            lines.append("\n")
        
        # 未使用导出
        lines.append("## 未使用导出\n")
        if results['unused_exports']:
            lines.append(f"发现 {len(results['unused_exports'])} 个未使用导出:\n\n")
            for exp in results['unused_exports'][:20]:
                lines.append(f"- `{exp.name}` ({exp.export_type}) in `{exp.file_path}:{exp.line_number}`\n")
        else:
            lines.append("未发现未使用导出\n")
        lines.append("\n")
        
        # 复用机会
        lines.append("## 复用机会\n")
        if results['reuse_opportunities']:
            for opp in results['reuse_opportunities']:
                lines.append(f"- **{opp['file']}**: {opp['suggestion']} ({opp['count']} similar functions)\n")
        else:
            lines.append("未发现明显复用机会\n")
        
        # 写入文件
        with open(output_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)
        
        print(f"Report saved to: {output_path}")
    
    @staticmethod
    def generate_json_report(results: Dict, output_path: str):
        """生成JSON格式报告"""
        # 序列化数据
        serializable = {
            'files_scanned': results['files_scanned'],
            'total_functions': results['total_functions'],
            'clone_summary': results['clone_summary'],
            'clone_pairs': [
                {
                    'func1': {
                        'name': c.func1.name,
                        'file': c.func1.file_path,
                        'line': c.func1.start_line,
                        'language': c.func1.language
                    },
                    'func2': {
                        'name': c.func2.name,
                        'file': c.func2.file_path,
                        'line': c.func2.start_line,
                        'language': c.func2.language
                    },
                    'similarity': c.similarity,
                    'similarity_type': c.similarity_type
                }
                for c in results['clone_pairs']
            ],
            'unused_exports': [
                {
                    'name': e.name,
                    'file': e.file_path,
                    'type': e.export_type,
                    'line': e.line_number
                }
                for e in results['unused_exports']
            ],
            'reuse_opportunities': results['reuse_opportunities']
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(serializable, f, indent=2, ensure_ascii=False)
        
        print(f"JSON report saved to: {output_path}")


# =============================================================================
# CLI入口
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='代码复用发现工具 - 检测相似函数和未使用导出',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s scan ./my-project
  %(prog)s scan ./my-project --threshold 0.8 --format json
  %(prog)s check "function add(a, b) { return a + b; }" --project ./my-project
        """
    )
    
    subparsers = parser.add_subparsers(dest='command', help='可用命令')
    
    # scan命令
    scan_parser = subparsers.add_parser('scan', help='扫描项目代码')
    scan_parser.add_argument('path', help='项目路径')
    scan_parser.add_argument('-t', '--threshold', type=float, default=0.85,
                            help='相似度阈值 (默认: 0.85)')
    scan_parser.add_argument('-f', '--format', choices=['markdown', 'json', 'console'],
                            default='console', help='输出格式')
    scan_parser.add_argument('-o', '--output', help='输出文件路径')
    scan_parser.add_argument('--embedding', action='store_true',
                            help='使用嵌入向量增强相似度计算')
    
    # check命令
    check_parser = subparsers.add_parser('check', help='检查新函数是否应该复用')
    check_parser.add_argument('code', help='函数代码')
    check_parser.add_argument('-p', '--project', required=True, help='项目路径')
    check_parser.add_argument('-t', '--threshold', type=float, default=0.85,
                             help='相似度阈值 (默认: 0.85)')
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return
    
    if args.command == 'scan':
        analyzer = ReuseAnalyzer(
            similarity_threshold=args.threshold,
            use_embedding=args.embedding
        )
        results = analyzer.analyze_project(args.path)
        
        if args.format == 'markdown' or args.output:
            output_path = args.output or 'reuse_report.md'
            ReportGenerator.generate_markdown_report(results, output_path)
        elif args.format == 'json':
            output_path = args.output or 'reuse_report.json'
            ReportGenerator.generate_json_report(results, output_path)
        else:
            # Console output
            print(f"\n{'='*60}")
            print("代码复用分析结果")
            print(f"{'='*60}")
            print(f"扫描文件: {results['files_scanned']}")
            print(f"函数总数: {results['total_functions']}")
            print(f"克隆对数: {results['clone_summary']['count']}")
            print(f"未使用导出: {len(results['unused_exports'])}")
            
            if results['clone_pairs']:
                print(f"\n{'='*60}")
                print("TOP 10 克隆对:")
                print(f"{'='*60}")
                for i, clone in enumerate(results['clone_pairs'][:10], 1):
                    print(f"\n{i}. {clone.func1.name} ↔ {clone.func2.name}")
                    print(f"   相似度: {clone.similarity:.2%}")
                    print(f"   位置: {clone.func1.file_path}:{clone.func1.start_line}")
                    print(f"       ↔ {clone.func2.file_path}:{clone.func2.start_line}")
    
    elif args.command == 'check':
        analyzer = ReuseAnalyzer(similarity_threshold=args.threshold)
        # 先分析项目
        analyzer.analyze_project(args.project)
        
        # 检查新函数
        result = analyzer.check_new_function(args.code)
        
        print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
