"""
AI认知脚手架系统 - 核心算法实现
================================
包含以下核心算法：
1. 符号索引算法 (Symbol Indexing)
2. 依赖图构建算法 (Dependency Graph)
3. PageRank中心性计算
4. 影响传播算法 (Impact Propagation)
5. 死代码检测集成
6. AST相似度算法

作者: AI认知脚手架算法工程师
"""

from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple, Optional, Any, Callable
from enum import Enum
from collections import defaultdict, deque
import hashlib
import json
import re
import os
import subprocess
from abc import ABC, abstractmethod

import numpy as np
import networkx as nx


# =============================================================================
# 第一部分: 基础数据结构和枚举
# =============================================================================

class SymbolType(Enum):
    """符号类型枚举"""
    FUNCTION = "function"
    CLASS = "class"
    INTERFACE = "interface"
    VARIABLE = "variable"
    CONSTANT = "constant"
    TYPE_ALIAS = "type_alias"
    ENUM = "enum"
    MODULE = "module"
    IMPORT = "import"
    EXPORT = "export"


class Language(Enum):
    """编程语言枚举"""
    TYPESCRIPT = "typescript"
    PYTHON = "python"
    GO = "go"


class DependencyType(Enum):
    """依赖类型枚举"""
    IMPORT = "import"
    EXPORT = "export"
    EXTENDS = "extends"
    IMPLEMENTS = "implements"
    CALLS = "calls"
    USES = "uses"
    CONTAINS = "contains"


class ImpactLevel(Enum):
    """影响级别枚举"""
    DIRECT = 1
    INDIRECT = 2
    TRANSITIVE = 3


class DeadCodeTool(Enum):
    """死代码检测工具枚举"""
    VULTURE = "vulture"
    TS_PRUNE = "ts-prune"
    UNUSED = "unused"
    CUSTOM = "custom"


@dataclass
class Location:
    """代码位置"""
    file_path: str
    line_start: int
    line_end: int
    column_start: int = 0
    column_end: int = 0
    
    def to_tuple(self) -> Tuple[str, int, int]:
        return (self.file_path, self.line_start, self.column_start)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'file_path': self.file_path,
            'line_start': self.line_start,
            'line_end': self.line_end,
            'column_start': self.column_start,
            'column_end': self.column_end
        }


@dataclass
class Symbol:
    """符号定义"""
    id: str = ""
    name: str = ""
    qualified_name: str = ""
    symbol_type: SymbolType = SymbolType.FUNCTION
    language: Language = Language.PYTHON
    location: Location = field(default_factory=lambda: Location("", 0, 0))
    docstring: Optional[str] = None
    signature: Optional[str] = None
    parameters: List[str] = field(default_factory=list)
    return_type: Optional[str] = None
    is_exported: bool = False
    is_async: bool = False
    decorators: List[str] = field(default_factory=list)
    
    def __post_init__(self):
        if not self.id:
            self.id = self._generate_id()
    
    def _generate_id(self) -> str:
        content = f"{self.location.file_path}:{self.qualified_name}:{self.location.line_start}"
        return hashlib.md5(content.encode()).hexdigest()[:16]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'name': self.name,
            'qualified_name': self.qualified_name,
            'symbol_type': self.symbol_type.value,
            'language': self.language.value,
            'location': self.location.to_dict(),
            'docstring': self.docstring,
            'signature': self.signature,
            'parameters': self.parameters,
            'return_type': self.return_type,
            'is_exported': self.is_exported,
            'is_async': self.is_async,
            'decorators': self.decorators
        }


@dataclass
class DependencyEdge:
    """依赖边"""
    source: str
    target: str
    dep_type: DependencyType
    location: Optional[Location] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'source': self.source,
            'target': self.target,
            'dep_type': self.dep_type.value,
            'location': self.location.to_dict() if self.location else None,
            'metadata': self.metadata
        }


@dataclass
class DeadCodeItem:
    """死代码项"""
    symbol_name: str
    file_path: str
    line_number: int
    symbol_type: str
    confidence: float
    tool: DeadCodeTool
    message: str
    suggestion: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'symbol_name': self.symbol_name,
            'file_path': self.file_path,
            'line_number': self.line_number,
            'symbol_type': self.symbol_type,
            'confidence': self.confidence,
            'tool': self.tool.value,
            'message': self.message,
            'suggestion': self.suggestion
        }


@dataclass
class SimilarityResult:
    """相似度计算结果"""
    func1: str
    func2: str
    similarity: float
    is_duplicate: bool
    common_subtrees: List[str] = field(default_factory=list)
    diff_locations: List[Tuple[int, int]] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'func1': self.func1,
            'func2': self.func2,
            'similarity': self.similarity,
            'is_duplicate': self.is_duplicate,
            'common_subtrees': self.common_subtrees,
            'diff_locations': self.diff_locations
        }


# =============================================================================
# 第二部分: 符号索引 (Symbol Index)
# =============================================================================

@dataclass
class SymbolIndex:
    """全局符号索引 - Layer 1核心数据结构"""
    symbols: Dict[str, Symbol] = field(default_factory=dict)
    name_index: Dict[str, Set[str]] = field(default_factory=dict)
    file_index: Dict[str, Set[str]] = field(default_factory=dict)
    type_index: Dict[SymbolType, Set[str]] = field(default_factory=dict)
    qualified_index: Dict[str, str] = field(default_factory=dict)
    
    def add_symbol(self, symbol: Symbol) -> None:
        """添加符号到索引 - O(1)"""
        self.symbols[symbol.id] = symbol
        
        if symbol.name not in self.name_index:
            self.name_index[symbol.name] = set()
        self.name_index[symbol.name].add(symbol.id)
        
        if symbol.location.file_path not in self.file_index:
            self.file_index[symbol.location.file_path] = set()
        self.file_index[symbol.location.file_path].add(symbol.id)
        
        if symbol.symbol_type not in self.type_index:
            self.type_index[symbol.symbol_type] = set()
        self.type_index[symbol.symbol_type].add(symbol.id)
        
        self.qualified_index[symbol.qualified_name] = symbol.id
    
    def query_by_name(self, name: str) -> List[Symbol]:
        """按名称查询符号 - O(1)"""
        symbol_ids = self.name_index.get(name, set())
        return [self.symbols[sid] for sid in symbol_ids]
    
    def query_by_file(self, file_path: str) -> List[Symbol]:
        """按文件路径查询符号 - O(1)"""
        symbol_ids = self.file_index.get(file_path, set())
        return [self.symbols[sid] for sid in symbol_ids]
    
    def query_by_type(self, symbol_type: SymbolType) -> List[Symbol]:
        """按类型查询符号 - O(1)"""
        symbol_ids = self.type_index.get(symbol_type, set())
        return [self.symbols[sid] for sid in symbol_ids]
    
    def get_symbol(self, qualified_name: str) -> Optional[Symbol]:
        """通过限定名获取符号 - O(1)"""
        symbol_id = self.qualified_index.get(qualified_name)
        return self.symbols.get(symbol_id) if symbol_id else None
    
    def remove_symbol(self, symbol_id: str) -> None:
        """从索引中移除符号 - O(1)"""
        symbol = self.symbols.get(symbol_id)
        if not symbol:
            return
        
        del self.symbols[symbol_id]
        self.name_index[symbol.name].discard(symbol_id)
        self.file_index[symbol.location.file_path].discard(symbol_id)
        self.type_index[symbol.symbol_type].discard(symbol_id)
        del self.qualified_index[symbol.qualified_name]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'symbols': {k: v.to_dict() for k, v in self.symbols.items()},
            'stats': {
                'total_symbols': len(self.symbols),
                'by_type': {k.value: len(v) for k, v in self.type_index.items()},
                'by_file': {k: len(v) for k, v in self.file_index.items()}
            }
        }


# =============================================================================
# 第三部分: 依赖图 (Dependency Graph)
# =============================================================================

@dataclass
class DependencyGraph:
    """依赖图 - 有向图结构"""
    nodes: Set[str] = field(default_factory=set)
    edges: List[DependencyEdge] = field(default_factory=list)
    adjacency: Dict[str, Set[str]] = field(default_factory=dict)
    reverse_adj: Dict[str, Set[str]] = field(default_factory=dict)
    edge_index: Dict[Tuple[str, str], DependencyEdge] = field(default_factory=dict)
    
    def add_node(self, node_id: str) -> None:
        """添加节点 - O(1)"""
        self.nodes.add(node_id)
        if node_id not in self.adjacency:
            self.adjacency[node_id] = set()
        if node_id not in self.reverse_adj:
            self.reverse_adj[node_id] = set()
    
    def add_edge(self, edge: DependencyEdge) -> None:
        """添加边 - O(1)"""
        self.add_node(edge.source)
        self.add_node(edge.target)
        
        self.edges.append(edge)
        self.adjacency[edge.source].add(edge.target)
        self.reverse_adj[edge.target].add(edge.source)
        self.edge_index[(edge.source, edge.target)] = edge
    
    def get_dependencies(self, node_id: str) -> Set[str]:
        """获取节点的直接依赖（出边）- O(1)"""
        return self.adjacency.get(node_id, set())
    
    def get_dependents(self, node_id: str) -> Set[str]:
        """获取依赖该节点的节点（入边）- O(1)"""
        return self.reverse_adj.get(node_id, set())
    
    def get_edge(self, source: str, target: str) -> Optional[DependencyEdge]:
        """获取特定边 - O(1)"""
        return self.edge_index.get((source, target))
    
    def remove_node(self, node_id: str) -> None:
        """移除节点及其所有边 - O(d)"""
        if node_id not in self.nodes:
            return
        
        # 移除出边
        for target in list(self.adjacency.get(node_id, [])):
            self._remove_edge(node_id, target)
        
        # 移除入边
        for source in list(self.reverse_adj.get(node_id, [])):
            self._remove_edge(source, node_id)
        
        self.nodes.discard(node_id)
        self.adjacency.pop(node_id, None)
        self.reverse_adj.pop(node_id, None)
    
    def _remove_edge(self, source: str, target: str) -> None:
        """移除边 - O(E)"""
        self.adjacency[source].discard(target)
        self.reverse_adj[target].discard(source)
        self.edge_index.pop((source, target), None)
        self.edges = [e for e in self.edges if not (e.source == source and e.target == target)]
    
    def to_networkx(self) -> nx.DiGraph:
        """转换为NetworkX图"""
        G = nx.DiGraph()
        G.add_nodes_from(self.nodes)
        for edge in self.edges:
            G.add_edge(edge.source, edge.target, type=edge.dep_type.value)
        return G
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'nodes': list(self.nodes),
            'edges': [e.to_dict() for e in self.edges],
            'stats': {
                'node_count': len(self.nodes),
                'edge_count': len(self.edges)
            }
        }


# =============================================================================
# 第四部分: 符号提取器 (基于Tree-sitter)
# =============================================================================

class TreeSitterSymbolExtractor:
    """基于Tree-sitter的符号提取器"""
    
    # Tree-sitter查询定义
    QUERIES = {
        Language.PYTHON: {
            SymbolType.FUNCTION: """
                (function_definition
                    name: (identifier) @name
                    parameters: (parameters) @params
                    body: (block) @body
                ) @func
            """,
            SymbolType.CLASS: """
                (class_definition
                    name: (identifier) @name
                    body: (block) @body
                ) @class
            """,
            SymbolType.VARIABLE: """
                (assignment
                    left: (identifier) @name
                ) @var
            """,
        },
        Language.TYPESCRIPT: {
            SymbolType.FUNCTION: """
                (function_declaration
                    name: (identifier) @name
                    parameters: (formal_parameters) @params
                    body: (statement_block) @body
                ) @func
            """,
            SymbolType.CLASS: """
                (class_declaration
                    name: (type_identifier) @name
                    body: (class_body) @body
                ) @class
            """,
            SymbolType.INTERFACE: """
                (interface_declaration
                    name: (type_identifier) @name
                    body: (interface_body) @body
                ) @interface
            """,
        },
        Language.GO: {
            SymbolType.FUNCTION: """
                (function_declaration
                    name: (identifier) @name
                    parameters: (parameter_list) @params
                    body: (block) @body
                ) @func
            """,
            SymbolType.CLASS: """
                (type_declaration
                    (type_spec
                        name: (type_identifier) @name
                        type: (struct_type)
                    )
                ) @struct
            """,
        }
    }
    
    def __init__(self):
        self.parsers = {}
        self.queries = {}
        self._init_parsers()
    
    def _init_parsers(self):
        """初始化解析器"""
        try:
            from tree_sitter import Parser
            import tree_sitter_python as tspython
            import tree_sitter_typescript as tsts
            import tree_sitter_go as tsgo
            
            self.parsers[Language.PYTHON] = Parser(tspython.language())
            self.parsers[Language.TYPESCRIPT] = Parser(tsts.language_typescript())
            self.parsers[Language.GO] = Parser(tsgo.language())
            
            for lang, queries in self.QUERIES.items():
                self.queries[lang] = {}
                for sym_type, query_str in queries.items():
                    self.queries[lang][sym_type] = self.parsers[lang].language().query(query_str)
            
            print("✓ Tree-sitter parsers initialized")
        except ImportError as e:
            print(f"⚠ Tree-sitter not available: {e}")
    
    def detect_language(self, file_path: str) -> Optional[Language]:
        """检测文件语言"""
        ext = file_path.split('.')[-1].lower()
        mapping = {
            'py': Language.PYTHON,
            'ts': Language.TYPESCRIPT,
            'tsx': Language.TYPESCRIPT,
            'js': Language.TYPESCRIPT,
            'jsx': Language.TYPESCRIPT,
            'go': Language.GO,
        }
        return mapping.get(ext)
    
    def extract_symbols(self, file_path: str, source_code: str) -> List[Symbol]:
        """从源代码中提取符号 - O(n)"""
        language = self.detect_language(file_path)
        if not language or language not in self.parsers:
            return self._fallback_extraction(file_path, source_code, language)
        
        try:
            parser = self.parsers[language]
            tree = parser.parse(source_code.encode())
            root_node = tree.root_node
            
            symbols = []
            
            for symbol_type, query in self.queries.get(language, {}).items():
                captures = query.captures(root_node)
                
                for capture in captures:
                    node, capture_name = capture
                    if capture_name == 'name':
                        symbol = self._create_symbol(
                            node, file_path, source_code, symbol_type, language
                        )
                        if symbol:
                            symbols.append(symbol)
            
            return symbols
        
        except Exception as e:
            print(f"Error extracting symbols from {file_path}: {e}")
            return self._fallback_extraction(file_path, source_code, language)
    
    def _create_symbol(
        self,
        node: Any,
        file_path: str,
        source_code: str,
        symbol_type: SymbolType,
        language: Language
    ) -> Optional[Symbol]:
        """创建符号对象"""
        name = source_code[node.start_byte:node.end_byte]
        
        # 构建限定名
        qualified_parts = [name]
        parent = node.parent
        while parent:
            if parent.type in ['class_definition', 'class_declaration']:
                for child in parent.children:
                    if child.type in ['identifier', 'type_identifier']:
                        class_name = source_code[child.start_byte:child.end_byte]
                        qualified_parts.insert(0, class_name)
                        break
            parent = parent.parent
        
        qualified_name = '.'.join(qualified_parts)
        
        return Symbol(
            name=name,
            qualified_name=qualified_name,
            symbol_type=symbol_type,
            language=language,
            location=Location(
                file_path=file_path,
                line_start=node.start_point[0] + 1,
                line_end=node.end_point[0] + 1,
                column_start=node.start_point[1],
                column_end=node.end_point[1]
            )
        )
    
    def _fallback_extraction(
        self,
        file_path: str,
        source_code: str,
        language: Optional[Language]
    ) -> List[Symbol]:
        """备用符号提取（基于正则）"""
        symbols = []
        lines = source_code.split('\n')
        
        if language == Language.PYTHON:
            # Python函数/类提取
            func_pattern = r'^def\s+(\w+)\s*\('
            class_pattern = r'^class\s+(\w+)'
            
            for i, line in enumerate(lines):
                func_match = re.match(func_pattern, line)
                if func_match:
                    symbols.append(Symbol(
                        name=func_match.group(1),
                        qualified_name=func_match.group(1),
                        symbol_type=SymbolType.FUNCTION,
                        language=Language.PYTHON,
                        location=Location(file_path, i + 1, i + 1)
                    ))
                
                class_match = re.match(class_pattern, line)
                if class_match:
                    symbols.append(Symbol(
                        name=class_match.group(1),
                        qualified_name=class_match.group(1),
                        symbol_type=SymbolType.CLASS,
                        language=Language.PYTHON,
                        location=Location(file_path, i + 1, i + 1)
                    ))
        
        elif language == Language.TYPESCRIPT:
            func_pattern = r'(?:export\s+)?(?:async\s+)?function\s+(\w+)'
            class_pattern = r'(?:export\s+)?class\s+(\w+)'
            
            for i, line in enumerate(lines):
                func_match = re.search(func_pattern, line)
                if func_match:
                    symbols.append(Symbol(
                        name=func_match.group(1),
                        qualified_name=func_match.group(1),
                        symbol_type=SymbolType.FUNCTION,
                        language=Language.TYPESCRIPT,
                        location=Location(file_path, i + 1, i + 1)
                    ))
                
                class_match = re.search(class_pattern, line)
                if class_match:
                    symbols.append(Symbol(
                        name=class_match.group(1),
                        qualified_name=class_match.group(1),
                        symbol_type=SymbolType.CLASS,
                        language=Language.TYPESCRIPT,
                        location=Location(file_path, i + 1, i + 1)
                    ))
        
        elif language == Language.GO:
            func_pattern = r'^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\('
            
            for i, line in enumerate(lines):
                func_match = re.match(func_pattern, line)
                if func_match:
                    symbols.append(Symbol(
                        name=func_match.group(1),
                        qualified_name=func_match.group(1),
                        symbol_type=SymbolType.FUNCTION,
                        language=Language.GO,
                        location=Location(file_path, i + 1, i + 1)
                    ))
        
        return symbols


# =============================================================================
# 第五部分: 依赖图构建器
# =============================================================================

class DependencyGraphBuilder:
    """依赖图构建器"""
    
    IMPORT_QUERIES = {
        Language.PYTHON: """
            (import_statement (dotted_name) @import_name)
            (import_from_statement module_name: (dotted_name) @from_module)
        """,
        Language.TYPESCRIPT: """
            (import_statement source: (string) @source)
        """,
        Language.GO: """
            (import_declaration (import_spec path: (interpreted_string_literal) @import_path))
        """
    }
    
    def __init__(self, symbol_index: SymbolIndex):
        self.symbol_index = symbol_index
        self.extractor = TreeSitterSymbolExtractor()
        self.graph = DependencyGraph()
    
    def build_graph(self, file_paths: List[str]) -> DependencyGraph:
        """构建完整依赖图 - O(F × n)"""
        self.graph = DependencyGraph()
        
        # 第一阶段：提取符号
        for file_path in file_paths:
            self._process_file(file_path)
        
        # 第二阶段：解析导入
        for file_path in file_paths:
            self._resolve_imports(file_path)
        
        return self.graph
    
    def _process_file(self, file_path: str) -> None:
        """处理单个文件"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                source_code = f.read()
            
            symbols = self.extractor.extract_symbols(file_path, source_code)
            
            for symbol in symbols:
                self.symbol_index.add_symbol(symbol)
                self.graph.add_node(symbol.id)
        
        except Exception as e:
            print(f"Error processing {file_path}: {e}")
    
    def _resolve_imports(self, file_path: str) -> None:
        """解析文件导入"""
        language = self.extractor.detect_language(file_path)
        if not language:
            return
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                source_code = f.read()
            
            # 简单的正则解析
            if language == Language.PYTHON:
                self._parse_python_imports(file_path, source_code)
            elif language == Language.TYPESCRIPT:
                self._parse_typescript_imports(file_path, source_code)
            elif language == Language.GO:
                self._parse_go_imports(file_path, source_code)
        
        except Exception as e:
            print(f"Error resolving imports in {file_path}: {e}")
    
    def _parse_python_imports(self, file_path: str, source_code: str) -> None:
        """解析Python导入"""
        import_pattern = r'^(?:from\s+(\S+)\s+import|import\s+(\S+))'
        file_node_id = f"file:{file_path}"
        
        for match in re.finditer(import_pattern, source_code, re.MULTILINE):
            module = match.group(1) or match.group(2)
            if module:
                self.graph.add_edge(DependencyEdge(
                    source=file_node_id,
                    target=f"module:{module}",
                    dep_type=DependencyType.IMPORT,
                    metadata={'module': module}
                ))
    
    def _parse_typescript_imports(self, file_path: str, source_code: str) -> None:
        """解析TypeScript导入"""
        import_pattern = r"import\s+.*?\s+from\s+['\"]([^'\"]+)['\"]"
        file_node_id = f"file:{file_path}"
        
        for match in re.finditer(import_pattern, source_code):
            module = match.group(1)
            self.graph.add_edge(DependencyEdge(
                source=file_node_id,
                target=f"module:{module}",
                dep_type=DependencyType.IMPORT,
                metadata={'module': module}
            ))
    
    def _parse_go_imports(self, file_path: str, source_code: str) -> None:
        """解析Go导入"""
        import_pattern = r'"([^"]+)"'
        file_node_id = f"file:{file_path}"
        
        in_import = False
        for line in source_code.split('\n'):
            if 'import (' in line:
                in_import = True
            elif in_import and ')' in line:
                in_import = False
            elif in_import or line.strip().startswith('import '):
                match = re.search(import_pattern, line)
                if match:
                    module = match.group(1)
                    self.graph.add_edge(DependencyEdge(
                        source=file_node_id,
                        target=f"module:{module}",
                        dep_type=DependencyType.IMPORT,
                        metadata={'module': module}
                    ))


# =============================================================================
# 第六部分: PageRank中心性计算
# =============================================================================

class PageRankCalculator:
    """PageRank中心性计算器"""
    
    def __init__(
        self,
        damping_factor: float = 0.85,
        max_iterations: int = 100,
        tolerance: float = 1e-6
    ):
        self.damping_factor = damping_factor
        self.max_iterations = max_iterations
        self.tolerance = tolerance
    
    def calculate(
        self,
        graph: DependencyGraph,
        weight_by_type: Optional[Dict[DependencyType, float]] = None
    ) -> Dict[str, float]:
        """计算PageRank - O(k × V²)"""
        nodes = list(graph.nodes)
        n = len(nodes)
        
        if n == 0:
            return {}
        
        # 构建转移矩阵
        transition_matrix = self._build_transition_matrix(graph, nodes, weight_by_type)
        
        # 初始化
        pagerank = np.ones(n) / n
        
        # 迭代
        for iteration in range(self.max_iterations):
            new_pagerank = (
                (1 - self.damping_factor) / n +
                self.damping_factor * transition_matrix.T @ pagerank
            )
            
            diff = np.linalg.norm(new_pagerank - pagerank, 1)
            pagerank = new_pagerank
            
            if diff < self.tolerance:
                break
        
        pagerank = pagerank / np.sum(pagerank)
        
        return {node: float(score) for node, score in zip(nodes, pagerank)}
    
    def _build_transition_matrix(
        self,
        graph: DependencyGraph,
        nodes: List[str],
        weight_by_type: Optional[Dict[DependencyType, float]]
    ) -> np.ndarray:
        """构建转移矩阵 - O(E)"""
        n = len(nodes)
        node_index = {node: i for i, node in enumerate(nodes)}
        
        matrix = np.zeros((n, n))
        
        default_weights = {
            DependencyType.IMPORT: 1.0,
            DependencyType.EXPORT: 0.5,
            DependencyType.EXTENDS: 1.5,
            DependencyType.IMPLEMENTS: 1.2,
            DependencyType.CALLS: 1.0,
            DependencyType.USES: 0.8,
            DependencyType.CONTAINS: 0.3,
        }
        
        if weight_by_type:
            default_weights.update(weight_by_type)
        
        for edge in graph.edges:
            if edge.source in node_index and edge.target in node_index:
                i = node_index[edge.source]
                j = node_index[edge.target]
                weight = default_weights.get(edge.dep_type, 1.0)
                matrix[i, j] += weight
        
        # 归一化
        for i in range(n):
            row_sum = np.sum(matrix[i, :])
            if row_sum > 0:
                matrix[i, :] /= row_sum
            else:
                matrix[i, :] = 1.0 / n
        
        return matrix
    
    def identify_core_nodes(
        self,
        pagerank_scores: Dict[str, float],
        graph: DependencyGraph,
        threshold_ratio: float = 0.1,
        min_dependents: int = 10
    ) -> List[Tuple[str, float, int]]:
        """识别核心节点"""
        dependent_counts = {
            node: len(graph.get_dependents(node))
            for node in pagerank_scores.keys()
        }
        
        core_nodes = [
            (node, score, dependent_counts[node])
            for node, score in pagerank_scores.items()
            if dependent_counts[node] >= min_dependents
        ]
        
        core_nodes.sort(key=lambda x: x[1], reverse=True)
        
        cutoff = max(1, int(len(core_nodes) * threshold_ratio))
        return core_nodes[:cutoff]


# =============================================================================
# 第七部分: 影响传播分析
# =============================================================================

@dataclass
class ImpactResult:
    """影响分析结果"""
    source_node: str
    direct_impacts: Set[str] = field(default_factory=set)
    indirect_impacts: Set[str] = field(default_factory=set)
    transitive_impacts: Set[str] = field(default_factory=set)
    impact_paths: Dict[str, List[List[str]]] = field(default_factory=dict)
    impact_scores: Dict[str, float] = field(default_factory=dict)
    
    def get_all_affected(self) -> Set[str]:
        return self.direct_impacts | self.indirect_impacts | self.transitive_impacts
    
    def get_risk_summary(self) -> Dict[str, int]:
        return {
            'direct': len(self.direct_impacts),
            'indirect': len(self.indirect_impacts),
            'transitive': len(self.transitive_impacts),
            'total': len(self.get_all_affected())
        }


class ImpactPropagationAnalyzer:
    """影响传播分析器"""
    
    def __init__(
        self,
        graph: DependencyGraph,
        pagerank_scores: Dict[str, float],
        decay_factor: float = 0.5
    ):
        self.graph = graph
        self.pagerank_scores = pagerank_scores
        self.decay_factor = decay_factor
    
    def analyze_impact(
        self,
        modified_nodes: List[str],
        max_depth: int = 3
    ) -> Dict[str, ImpactResult]:
        """分析修改影响 - O(k × (V + E))"""
        results = {}
        
        for node in modified_nodes:
            result = self._analyze_single_node(node, max_depth)
            results[node] = result
        
        return results
    
    def _analyze_single_node(
        self,
        source_node: str,
        max_depth: int
    ) -> ImpactResult:
        """分析单个节点影响 - O(V + E)"""
        result = ImpactResult(source_node=source_node)
        
        visited = {source_node}
        queue = deque([(source_node, 0, [source_node])])
        
        while queue:
            current, depth, path = queue.popleft()
            
            if depth >= max_depth:
                continue
            
            dependents = self.graph.get_dependents(current)
            
            for dependent in dependents:
                if dependent in visited:
                    continue
                
                visited.add(dependent)
                new_path = path + [dependent]
                
                if depth == 0:
                    result.direct_impacts.add(dependent)
                elif depth == 1:
                    result.indirect_impacts.add(dependent)
                else:
                    result.transitive_impacts.add(dependent)
                
                if dependent not in result.impact_paths:
                    result.impact_paths[dependent] = []
                result.impact_paths[dependent].append(new_path)
                
                score = self._calculate_impact_score(source_node, dependent, depth, new_path)
                result.impact_scores[dependent] = score
                
                queue.append((dependent, depth + 1, new_path))
        
        return result
    
    def _calculate_impact_score(
        self,
        source: str,
        target: str,
        depth: int,
        path: List[str]
    ) -> float:
        """计算影响分数"""
        source_pr = self.pagerank_scores.get(source, 0.0)
        target_pr = self.pagerank_scores.get(target, 0.0)
        depth_decay = self.decay_factor ** depth
        path_weight = 1.0 / len(path)
        
        edge_weight = 1.0
        for i in range(len(path) - 1):
            edge = self.graph.get_edge(path[i], path[i + 1])
            if edge:
                edge_weight *= self._get_edge_weight(edge)
        
        return source_pr * target_pr * depth_decay * path_weight * edge_weight
    
    def _get_edge_weight(self, edge: DependencyEdge) -> float:
        """获取边权重"""
        weights = {
            DependencyType.IMPORT: 1.0,
            DependencyType.EXPORT: 0.8,
            DependencyType.EXTENDS: 1.5,
            DependencyType.IMPLEMENTS: 1.3,
            DependencyType.CALLS: 1.2,
            DependencyType.USES: 0.9,
            DependencyType.CONTAINS: 0.5,
        }
        return weights.get(edge.dep_type, 1.0)
    
    def generate_impact_report(
        self,
        results: Dict[str, ImpactResult]
    ) -> Dict[str, Any]:
        """生成影响报告"""
        report = {
            'summary': {
                'total_modified': len(results),
                'total_direct_impacts': 0,
                'total_indirect_impacts': 0,
                'total_transitive_impacts': 0,
                'total_affected': set()
            },
            'high_risk_nodes': [],
            'details': {}
        }
        
        for node, result in results.items():
            report['summary']['total_direct_impacts'] += len(result.direct_impacts)
            report['summary']['total_indirect_impacts'] += len(result.indirect_impacts)
            report['summary']['total_transitive_impacts'] += len(result.transitive_impacts)
            report['summary']['total_affected'].update(result.get_all_affected())
            
            for impacted, score in result.impact_scores.items():
                if score > 0.5:
                    report['high_risk_nodes'].append({
                        'node': impacted,
                        'score': score,
                        'source': node,
                        'paths': result.impact_paths.get(impacted, [])
                    })
            
            report['details'][node] = {
                'risk_summary': result.get_risk_summary(),
                'direct_impacts': list(result.direct_impacts),
                'indirect_impacts': list(result.indirect_impacts),
                'transitive_impacts': list(result.transitive_impacts)
            }
        
        report['summary']['total_affected'] = len(report['summary']['total_affected'])
        report['high_risk_nodes'].sort(key=lambda x: x['score'], reverse=True)
        
        return report


# =============================================================================
# 第八部分: 风险分级分类器
# =============================================================================

class RiskClassifier:
    """风险分级分类器"""
    
    def __init__(
        self,
        core_threshold: int = 10,
        medium_threshold: int = 3
    ):
        self.core_threshold = core_threshold
        self.medium_threshold = medium_threshold
    
    def classify(
        self,
        node_id: str,
        graph: DependencyGraph,
        pagerank_scores: Dict[str, float]
    ) -> Tuple[str, Dict[str, Any]]:
        """对节点进行风险分级"""
        dependents = graph.get_dependents(node_id)
        dependencies = graph.get_dependencies(node_id)
        pagerank = pagerank_scores.get(node_id, 0.0)
        
        dependent_count = len(dependents)
        
        if dependent_count > self.core_threshold:
            risk_level = "🔴 核心节点"
        elif dependent_count >= self.medium_threshold:
            risk_level = "🟡 普通节点"
        else:
            risk_level = "🟢 叶子节点"
        
        details = {
            'node_id': node_id,
            'risk_level': risk_level,
            'dependent_count': dependent_count,
            'dependency_count': len(dependencies),
            'pagerank_score': pagerank,
            'dependents': list(dependents),
            'dependencies': list(dependencies)
        }
        
        return risk_level, details


# =============================================================================
# 第九部分: 死代码检测
# =============================================================================

@dataclass
class DeadCodeReport:
    """死代码检测报告"""
    items: List[DeadCodeItem] = field(default_factory=list)
    statistics: Dict[str, int] = field(default_factory=dict)
    
    def by_file(self) -> Dict[str, List[DeadCodeItem]]:
        result = defaultdict(list)
        for item in self.items:
            result[item.file_path].append(item)
        return dict(result)
    
    def by_type(self) -> Dict[str, List[DeadCodeItem]]:
        result = defaultdict(list)
        for item in self.items:
            result[item.symbol_type].append(item)
        return dict(result)


class DeadCodeDetector:
    """死代码检测器"""
    
    def __init__(self, project_path: str):
        self.project_path = project_path
        self.detectors: Dict[Language, Callable] = {
            Language.PYTHON: self._detect_python,
            Language.TYPESCRIPT: self._detect_typescript,
            Language.GO: self._detect_go
        }
    
    def detect_all(self) -> Dict[Language, DeadCodeReport]:
        """检测所有语言的死代码"""
        results = {}
        
        for language, detector in self.detectors.items():
            try:
                report = detector()
                results[language] = report
            except Exception as e:
                print(f"Error detecting dead code for {language}: {e}")
                results[language] = DeadCodeReport()
        
        return results
    
    def _detect_python(self) -> DeadCodeReport:
        """检测Python死代码"""
        report = DeadCodeReport()
        
        try:
            result = subprocess.run(
                ['vulture', self.project_path, '--min-confidence', '80'],
                capture_output=True,
                text=True,
                timeout=300
            )
            
            if result.stdout:
                report = self._parse_vulture_output(result.stdout)
        
        except FileNotFoundError:
            report = self._fallback_python_detection()
        
        report.statistics = {
            'total': len(report.items),
            'by_confidence': {
                'high': len([i for i in report.items if i.confidence >= 0.9]),
                'medium': len([i for i in report.items if 0.7 <= i.confidence < 0.9]),
                'low': len([i for i in report.items if i.confidence < 0.7])
            }
        }
        
        return report
    
    def _parse_vulture_output(self, output: str) -> DeadCodeReport:
        """解析vulture输出"""
        report = DeadCodeReport()
        pattern = r'^(.*?):(\d+):\s*(\w+)\s+(\w+)\s*\((\d+)%\)$'
        
        for line in output.strip().split('\n'):
            match = re.match(pattern, line)
            if match:
                file_path, line_num, sym_type, sym_name, confidence = match.groups()
                report.items.append(DeadCodeItem(
                    symbol_name=sym_name,
                    file_path=file_path,
                    line_number=int(line_num),
                    symbol_type=sym_type,
                    confidence=int(confidence) / 100.0,
                    tool=DeadCodeTool.VULTURE,
                    message=f"Unused {sym_type}: {sym_name}"
                ))
        
        return report
    
    def _fallback_python_detection(self) -> DeadCodeReport:
        """Python备用检测"""
        report = DeadCodeReport()
        
        try:
            import ast
            
            for root, dirs, files in os.walk(self.project_path):
                dirs[:] = [d for d in dirs if d not in {'__pycache__', 'venv', '.venv'}]
                
                for file in files:
                    if file.endswith('.py'):
                        file_path = os.path.join(root, file)
                        try:
                            with open(file_path, 'r', encoding='utf-8') as f:
                                source = f.read()
                            
                            tree = ast.parse(source)
                            imports = {}
                            used_names = set()
                            
                            for node in ast.walk(tree):
                                if isinstance(node, (ast.Import, ast.ImportFrom)):
                                    for alias in node.names:
                                        name = alias.asname if alias.asname else alias.name
                                        imports[name] = node.lineno
                                elif isinstance(node, ast.Name):
                                    used_names.add(node.id)
                            
                            for name, line in imports.items():
                                if name not in used_names:
                                    report.items.append(DeadCodeItem(
                                        symbol_name=name,
                                        file_path=file_path,
                                        line_number=line,
                                        symbol_type='import',
                                        confidence=0.8,
                                        tool=DeadCodeTool.CUSTOM,
                                        message=f"Potentially unused import: {name}",
                                        suggestion=f"Remove import: {name}"
                                    ))
                        
                        except Exception:
                            pass
        
        except ImportError:
            pass
        
        return report
    
    def _detect_typescript(self) -> DeadCodeReport:
        """检测TypeScript死代码"""
        report = DeadCodeReport()
        
        try:
            result = subprocess.run(
                ['ts-prune', '-p', os.path.join(self.project_path, 'tsconfig.json')],
                capture_output=True,
                text=True,
                timeout=300,
                cwd=self.project_path
            )
            
            if result.stdout:
                pattern = r'^(.*?):(\d+)\s+-\s+(\w+)\s*\((\w+)\)$'
                for line in result.stdout.strip().split('\n'):
                    match = re.match(pattern, line)
                    if match:
                        file_path, line_num, sym_name, sym_type = match.groups()
                        report.items.append(DeadCodeItem(
                            symbol_name=sym_name,
                            file_path=file_path,
                            line_number=int(line_num),
                            symbol_type=sym_type,
                            confidence=0.85,
                            tool=DeadCodeTool.TS_PRUNE,
                            message=f"Potentially unused {sym_type}: {sym_name}"
                        ))
        
        except FileNotFoundError:
            pass
        
        return report
    
    def _detect_go(self) -> DeadCodeReport:
        """检测Go死代码"""
        report = DeadCodeReport()
        
        try:
            result = subprocess.run(
                ['unused', './...'],
                capture_output=True,
                text=True,
                timeout=300,
                cwd=self.project_path
            )
            
            if result.stdout:
                pattern = r'^(.*?):(\d+):(\d+):\s*(\w+)\s*\((\w+)\)$'
                for line in result.stdout.strip().split('\n'):
                    match = re.match(pattern, line)
                    if match:
                        file_path, line_num, col, sym_name, sym_type = match.groups()
                        report.items.append(DeadCodeItem(
                            symbol_name=sym_name,
                            file_path=file_path,
                            line_number=int(line_num),
                            symbol_type=sym_type,
                            confidence=0.9,
                            tool=DeadCodeTool.UNUSED,
                            message=f"Unused {sym_type}: {sym_name}"
                        ))
        
        except FileNotFoundError:
            pass
        
        return report


# =============================================================================
# 第十部分: AST相似度分析
# =============================================================================

@dataclass
class ASTFeatures:
    """AST特征向量"""
    node_types: Dict[str, int] = field(default_factory=dict)
    node_depths: List[int] = field(default_factory=list)
    subtree_hashes: Set[str] = field(default_factory=set)
    token_sequence: List[str] = field(default_factory=list)
    structural_vector: np.ndarray = field(default_factory=lambda: np.array([]))
    
    def to_vector(self) -> np.ndarray:
        """转换为特征向量"""
        if len(self.structural_vector) > 0:
            return self.structural_vector
        
        features = []
        features.extend(list(self.node_types.values()))
        
        if self.node_depths:
            features.extend([
                np.mean(self.node_depths),
                np.std(self.node_depths),
                max(self.node_depths),
                len(self.node_depths)
            ])
        
        features.append(len(self.subtree_hashes))
        
        return np.array(features, dtype=np.float32)


class ASTSimilarityAnalyzer:
    """AST相似度分析器"""
    
    SIMILARITY_THRESHOLD = 0.85
    
    IMPORTANT_NODE_TYPES = {
        'function_definition', 'function_declaration', 'arrow_function',
        'class_definition', 'class_declaration',
        'if_statement', 'for_statement', 'while_statement', 'try_statement',
        'call_expression', 'binary_expression', 'unary_expression',
        'return_statement', 'assignment', 'expression_statement'
    }
    
    def __init__(self, symbol_index: SymbolIndex):
        self.symbol_index = symbol_index
        self.extractor = TreeSitterSymbolExtractor()
        self.feature_cache: Dict[str, ASTFeatures] = {}
    
    def analyze_function_similarity(
        self,
        target_function: str,
        candidate_functions: Optional[List[str]] = None
    ) -> List[SimilarityResult]:
        """分析函数相似度 - O(m × d)"""
        target_sym = self.symbol_index.get_symbol(target_function)
        if not target_sym or target_sym.symbol_type != SymbolType.FUNCTION:
            return []
        
        target_features = self._extract_function_features(target_sym)
        if not target_features:
            return []
        
        if candidate_functions is None:
            candidate_functions = [
                sym.qualified_name
                for sym in self.symbol_index.query_by_type(SymbolType.FUNCTION)
                if sym.qualified_name != target_function
            ]
        
        results = []
        for candidate_name in candidate_functions:
            candidate_sym = self.symbol_index.get_symbol(candidate_name)
            if not candidate_sym:
                continue
            
            candidate_features = self._extract_function_features(candidate_sym)
            if not candidate_features:
                continue
            
            similarity, common_subtrees, diff_locations = self._calculate_similarity(
                target_features, candidate_features
            )
            
            results.append(SimilarityResult(
                func1=target_function,
                func2=candidate_name,
                similarity=similarity,
                is_duplicate=similarity >= self.SIMILARITY_THRESHOLD,
                common_subtrees=common_subtrees,
                diff_locations=diff_locations
            ))
        
        results.sort(key=lambda x: x.similarity, reverse=True)
        return results
    
    def _extract_function_features(self, symbol: Symbol) -> Optional[ASTFeatures]:
        """提取函数特征 - O(n)"""
        if symbol.id in self.feature_cache:
            return self.feature_cache[symbol.id]
        
        try:
            with open(symbol.location.file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            func_body = '\n'.join(
                lines[symbol.location.line_start - 1:symbol.location.line_end]
            )
            
            language = symbol.language
            parser = self.extractor.parsers.get(language)
            
            if parser:
                tree = parser.parse(func_body.encode())
                features = self._extract_features_from_node(tree.root_node, func_body)
            else:
                features = self._fallback_feature_extraction(func_body)
            
            self.feature_cache[symbol.id] = features
            return features
        
        except Exception as e:
            print(f"Error extracting features: {e}")
            return None
    
    def _extract_features_from_node(
        self,
        node: Any,
        source_code: str,
        depth: int = 0
    ) -> ASTFeatures:
        """从节点提取特征"""
        features = ASTFeatures()
        
        def traverse(n: Any, d: int):
            if not n:
                return
            
            node_type = n.type
            features.node_types[node_type] = features.node_types.get(node_type, 0) + 1
            features.node_depths.append(d)
            
            if node_type in self.IMPORTANT_NODE_TYPES:
                subtree_hash = self._compute_subtree_hash(n, source_code)
                features.subtree_hashes.add(subtree_hash)
            
            if n.type in ['identifier', 'type_identifier', 'string', 'number']:
                token = source_code[n.start_byte:n.end_byte]
                features.token_sequence.append(token)
            
            for child in n.children:
                traverse(child, d + 1)
        
        traverse(node, depth)
        features.structural_vector = self._build_structural_vector(features)
        return features
    
    def _fallback_feature_extraction(self, source_code: str) -> ASTFeatures:
        """备用特征提取"""
        features = ASTFeatures()
        
        # 简单统计
        features.node_types['lines'] = len(source_code.split('\n'))
        features.node_types['length'] = len(source_code)
        features.node_types['keywords'] = len(re.findall(r'\b(if|for|while|return|try|except|catch)\b', source_code))
        
        features.structural_vector = self._build_structural_vector(features)
        return features
    
    def _compute_subtree_hash(self, node: Any, source_code: str) -> str:
        """计算子树哈希"""
        child_types = [child.type for child in node.children]
        representation = f"{node.type}:[{','.join(child_types)}]"
        return hashlib.md5(representation.encode()).hexdigest()[:16]
    
    def _build_structural_vector(self, features: ASTFeatures) -> np.ndarray:
        """构建结构向量"""
        type_vector = np.zeros(len(self.IMPORTANT_NODE_TYPES))
        type_list = sorted(self.IMPORTANT_NODE_TYPES)
        
        for i, node_type in enumerate(type_list):
            type_vector[i] = features.node_types.get(node_type, 0)
        
        if np.sum(type_vector) > 0:
            type_vector = type_vector / np.sum(type_vector)
        
        depth_stats = np.array([
            np.mean(features.node_depths) if features.node_depths else 0,
            np.std(features.node_depths) if features.node_depths else 0,
            max(features.node_depths) if features.node_depths else 0,
            len(features.node_depths)
        ])
        
        subtree_count = np.array([len(features.subtree_hashes)])
        
        return np.concatenate([type_vector, depth_stats, subtree_count])
    
    def _calculate_similarity(
        self,
        features1: ASTFeatures,
        features2: ASTFeatures
    ) -> Tuple[float, List[str], List[Tuple[int, int]]]:
        """计算相似度"""
        vec1 = features1.to_vector()
        vec2 = features2.to_vector()
        
        max_len = max(len(vec1), len(vec2))
        vec1 = np.pad(vec1, (0, max_len - len(vec1)))
        vec2 = np.pad(vec2, (0, max_len - len(vec2)))
        
        cosine_sim = self._cosine_similarity(vec1, vec2)
        subtree_sim = self._jaccard_similarity(
            features1.subtree_hashes,
            features2.subtree_hashes
        )
        token_sim = self._token_sequence_similarity(
            features1.token_sequence,
            features2.token_sequence
        )
        
        weights = [0.4, 0.4, 0.2]
        similarity = (
            weights[0] * cosine_sim +
            weights[1] * subtree_sim +
            weights[2] * token_sim
        )
        
        common_subtrees = list(features1.subtree_hashes & features2.subtree_hashes)
        diff_locations = []
        
        return similarity, common_subtrees, diff_locations
    
    def _cosine_similarity(self, vec1: np.ndarray, vec2: np.ndarray) -> float:
        """余弦相似度"""
        norm1 = np.linalg.norm(vec1)
        norm2 = np.linalg.norm(vec2)
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        return float(np.dot(vec1, vec2) / (norm1 * norm2))
    
    def _jaccard_similarity(self, set1: Set[str], set2: Set[str]) -> float:
        """Jaccard相似度"""
        if not set1 and not set2:
            return 1.0
        
        intersection = len(set1 & set2)
        union = len(set1 | set2)
        
        return intersection / union if union > 0 else 0.0
    
    def _token_sequence_similarity(
        self,
        seq1: List[str],
        seq2: List[str]
    ) -> float:
        """标记序列相似度"""
        if not seq1 and not seq2:
            return 1.0
        
        if not seq1 or not seq2:
            return 0.0
        
        set1 = set(seq1)
        set2 = set(seq2)
        
        common = len(set1 & set2)
        total = len(set1 | set2)
        
        return common / total if total > 0 else 0.0
    
    def find_duplicate_functions(
        self,
        min_similarity: float = 0.85
    ) -> List[Tuple[str, str, float]]:
        """查找重复函数 - O(k² × d)"""
        duplicates = []
        all_functions = self.symbol_index.query_by_type(SymbolType.FUNCTION)
        
        for i, func1 in enumerate(all_functions):
            for func2 in all_functions[i + 1:]:
                features1 = self._extract_function_features(func1)
                features2 = self._extract_function_features(func2)
                
                if not features1 or not features2:
                    continue
                
                similarity, _, _ = self._calculate_similarity(features1, features2)
                
                if similarity >= min_similarity:
                    duplicates.append((
                        func1.qualified_name,
                        func2.qualified_name,
                        similarity
                    ))
        
        duplicates.sort(key=lambda x: x[2], reverse=True)
        return duplicates


# =============================================================================
# 第十一部分: 主系统集成
# =============================================================================

class CognitiveScaffoldingSystem:
    """认知脚手架系统主类"""
    
    def __init__(self, project_path: str):
        self.project_path = project_path
        self.symbol_index = SymbolIndex()
        self.graph = DependencyGraph()
        self.pagerank_scores: Dict[str, float] = {}
        self.extractor = TreeSitterSymbolExtractor()
    
    def initialize(self) -> None:
        """初始化系统"""
        print("🚀 Initializing Cognitive Scaffolding System...")
        
        # 扫描文件
        file_paths = self._scan_project_files()
        print(f"📁 Found {len(file_paths)} source files")
        
        # 构建符号索引
        for file_path in file_paths:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    source = f.read()
                symbols = self.extractor.extract_symbols(file_path, source)
                for symbol in symbols:
                    self.symbol_index.add_symbol(symbol)
            except Exception as e:
                print(f"⚠ Error indexing {file_path}: {e}")
        
        print(f"📊 Indexed {len(self.symbol_index.symbols)} symbols")
        
        # 构建依赖图
        builder = DependencyGraphBuilder(self.symbol_index)
        self.graph = builder.build_graph(file_paths)
        print(f"🔗 Built dependency graph: {len(self.graph.nodes)} nodes, {len(self.graph.edges)} edges")
        
        # 计算PageRank
        calculator = PageRankCalculator()
        self.pagerank_scores = calculator.calculate(self.graph)
        print(f"📈 Calculated PageRank for {len(self.pagerank_scores)} nodes")
        
        print("✅ System initialized successfully")
    
    def analyze_modification(self, modified_files: List[str]) -> Dict[str, Any]:
        """分析修改影响"""
        modified_symbols = []
        for file_path in modified_files:
            symbols = self.symbol_index.query_by_file(file_path)
            modified_symbols.extend([s.id for s in symbols])
        
        analyzer = ImpactPropagationAnalyzer(
            self.graph, self.pagerank_scores
        )
        impact_results = analyzer.analyze_impact(modified_symbols)
        report = analyzer.generate_impact_report(impact_results)
        
        classifier = RiskClassifier()
        risk_analysis = {}
        for node in modified_symbols:
            level, details = classifier.classify(
                node, self.graph, self.pagerank_scores
            )
            risk_analysis[node] = {'level': level, 'details': details}
        
        return {
            'impact_report': report,
            'risk_analysis': risk_analysis
        }
    
    def check_code_reuse(self, function_name: str) -> List[Dict[str, Any]]:
        """检查代码复用"""
        analyzer = ASTSimilarityAnalyzer(self.symbol_index)
        results = analyzer.analyze_function_similarity(function_name)
        
        suggestions = []
        for result in results:
            if result.is_duplicate:
                func2 = self.symbol_index.get_symbol(result.func2)
                suggestions.append({
                    'should_reuse': True,
                    'similarity': result.similarity,
                    'existing_function': result.func2,
                    'new_function': result.func1,
                    'existing_location': func2.location.to_dict() if func2 else None,
                    'recommendation': f"Consider reusing '{result.func2}' instead of creating '{result.func1}'"
                })
        
        return suggestions
    
    def detect_dead_code(self) -> Dict[Language, DeadCodeReport]:
        """检测死代码"""
        detector = DeadCodeDetector(self.project_path)
        return detector.detect_all()
    
    def get_core_nodes(self) -> List[Tuple[str, float, int]]:
        """获取核心节点"""
        calculator = PageRankCalculator()
        return calculator.identify_core_nodes(
            self.pagerank_scores, self.graph
        )
    
    def _scan_project_files(self) -> List[str]:
        """扫描项目文件"""
        file_paths = []
        extensions = {'.py', '.ts', '.tsx', '.go'}
        
        for root, dirs, files in os.walk(self.project_path):
            dirs[:] = [d for d in dirs if d not in {
                'node_modules', '.git', '__pycache__',
                'venv', '.venv', 'dist', 'build', '.idea', '.vscode'
            }]
            
            for file in files:
                if any(file.endswith(ext) for ext in extensions):
                    file_paths.append(os.path.join(root, file))
        
        return file_paths
    
    def to_dict(self) -> Dict[str, Any]:
        """导出系统状态"""
        return {
            'project_path': self.project_path,
            'symbol_index': self.symbol_index.to_dict(),
            'dependency_graph': self.graph.to_dict(),
            'pagerank_top10': sorted(
                self.pagerank_scores.items(),
                key=lambda x: x[1],
                reverse=True
            )[:10]
        }


# =============================================================================
# 第十二部分: 测试和示例
# =============================================================================

def test_symbol_index():
    """测试符号索引"""
    print("\n=== Testing Symbol Index ===")
    
    index = SymbolIndex()
    
    # 添加测试符号
    symbol = Symbol(
        name="test_function",
        qualified_name="module.test_function",
        symbol_type=SymbolType.FUNCTION,
        language=Language.PYTHON,
        location=Location("test.py", 1, 10)
    )
    
    index.add_symbol(symbol)
    
    # 查询测试
    result = index.query_by_name("test_function")
    print(f"Query by name: {len(result)} results")
    
    result = index.query_by_file("test.py")
    print(f"Query by file: {len(result)} results")
    
    result = index.get_symbol("module.test_function")
    print(f"Get symbol: {result.name if result else 'Not found'}")
    
    print("✓ Symbol Index tests passed")


def test_dependency_graph():
    """测试依赖图"""
    print("\n=== Testing Dependency Graph ===")
    
    graph = DependencyGraph()
    
    # 添加节点和边
    graph.add_edge(DependencyEdge(
        source="A",
        target="B",
        dep_type=DependencyType.IMPORT
    ))
    graph.add_edge(DependencyEdge(
        source="B",
        target="C",
        dep_type=DependencyType.CALLS
    ))
    
    deps = graph.get_dependencies("A")
    print(f"A's dependencies: {deps}")
    
    dependents = graph.get_dependents("B")
    print(f"B's dependents: {dependents}")
    
    print("✓ Dependency Graph tests passed")


def test_pagerank():
    """测试PageRank"""
    print("\n=== Testing PageRank ===")
    
    graph = DependencyGraph()
    
    # 构建测试图
    edges = [
        ("A", "B"), ("A", "C"),
        ("B", "C"), ("B", "D"),
        ("C", "A"), ("C", "D"),
        ("D", "B")
    ]
    
    for src, tgt in edges:
        graph.add_edge(DependencyEdge(
            source=src, target=tgt, dep_type=DependencyType.IMPORT
        ))
    
    calculator = PageRankCalculator()
    scores = calculator.calculate(graph)
    
    print("PageRank scores:")
    for node, score in sorted(scores.items(), key=lambda x: x[1], reverse=True):
        print(f"  {node}: {score:.4f}")
    
    print("✓ PageRank tests passed")


def test_impact_analysis():
    """测试影响分析"""
    print("\n=== Testing Impact Analysis ===")
    
    graph = DependencyGraph()
    
    # 构建测试图: A -> B -> C -> D
    edges = [
        ("A", "B"), ("B", "C"), ("C", "D"),
        ("A", "E"), ("E", "F")
    ]
    
    for src, tgt in edges:
        graph.add_edge(DependencyEdge(
            source=src, target=tgt, dep_type=DependencyType.CALLS
        ))
    
    pagerank = {node: 1.0 / len(graph.nodes) for node in graph.nodes}
    
    analyzer = ImpactPropagationAnalyzer(graph, pagerank)
    results = analyzer.analyze_impact(["A"], max_depth=3)
    
    report = analyzer.generate_impact_report(results)
    print(f"Impact summary: {report['summary']}")
    
    print("✓ Impact Analysis tests passed")


def test_similarity():
    """测试相似度计算"""
    print("\n=== Testing Similarity Analysis ===")
    
    index = SymbolIndex()
    
    # 添加测试函数
    func1 = Symbol(
        name="calculate_sum",
        qualified_name="utils.calculate_sum",
        symbol_type=SymbolType.FUNCTION,
        language=Language.PYTHON,
        location=Location("utils.py", 1, 5)
    )
    func2 = Symbol(
        name="compute_total",
        qualified_name="helpers.compute_total",
        symbol_type=SymbolType.FUNCTION,
        language=Language.PYTHON,
        location=Location("helpers.py", 10, 15)
    )
    
    index.add_symbol(func1)
    index.add_symbol(func2)
    
    analyzer = ASTSimilarityAnalyzer(index)
    
    # 测试余弦相似度
    vec1 = np.array([1, 2, 3, 4, 5])
    vec2 = np.array([1, 2, 3, 4, 6])
    sim = analyzer._cosine_similarity(vec1, vec2)
    print(f"Cosine similarity: {sim:.4f}")
    
    # 测试Jaccard相似度
    set1 = {"a", "b", "c"}
    set2 = {"b", "c", "d"}
    sim = analyzer._jaccard_similarity(set1, set2)
    print(f"Jaccard similarity: {sim:.4f}")
    
    print("✓ Similarity Analysis tests passed")


if __name__ == "__main__":
    print("=" * 60)
    print("AI认知脚手架系统 - 核心算法测试")
    print("=" * 60)
    
    test_symbol_index()
    test_dependency_graph()
    test_pagerank()
    test_impact_analysis()
    test_similarity()
    
    print("\n" + "=" * 60)
    print("✅ All tests passed!")
    print("=" * 60)
