# AI认知脚手架系统 - 核心算法设计文档

## 目录
1. [符号索引算法 (Symbol Indexing)](#1-符号索引算法)
2. [依赖图构建算法 (Dependency Graph)](#2-依赖图构建算法)
3. [PageRank中心性计算](#3-pagerank中心性计算)
4. [影响传播算法 (Impact Propagation)](#4-影响传播算法)
5. [死代码检测集成](#5-死代码检测集成)
6. [AST相似度算法](#6-ast相似度算法)

---

## 1. 符号索引算法

### 1.1 算法概述
基于Tree-sitter构建跨语言符号索引，支持TypeScript/Python/Go三种语言。

### 1.2 数据结构定义

```python
from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple, Optional, Any
from enum import Enum
import hashlib

class SymbolType(Enum):
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
    TYPESCRIPT = "typescript"
    PYTHON = "python"
    GO = "go"

@dataclass
class Location:
    file_path: str
    line_start: int
    line_end: int
    column_start: int
    column_end: int
    
    def to_tuple(self) -> Tuple[str, int, int]:
        return (self.file_path, self.line_start, self.column_start)

@dataclass
class Symbol:
    id: str                          # 唯一标识符: hash(file_path + name + line)
    name: str                        # 符号名称
    qualified_name: str              # 完整限定名 (e.g., "module.Class.method")
    symbol_type: SymbolType
    language: Language
    location: Location
    docstring: Optional[str] = None
    signature: Optional[str] = None  # 函数签名
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

@dataclass
class SymbolIndex:
    """全局符号索引 - Layer 1核心数据结构"""
    symbols: Dict[str, Symbol] = field(default_factory=dict)           # id -> Symbol
    name_index: Dict[str, Set[str]] = field(default_factory=dict)      # name -> Set[symbol_id]
    file_index: Dict[str, Set[str]] = field(default_factory=dict)      # file_path -> Set[symbol_id]
    type_index: Dict[SymbolType, Set[str]] = field(default_factory=dict)  # type -> Set[symbol_id]
    qualified_index: Dict[str, str] = field(default_factory=dict)      # qualified_name -> symbol_id
    
    def add_symbol(self, symbol: Symbol) -> None:
        """添加符号到索引"""
        self.symbols[symbol.id] = symbol
        
        # 更新名称索引
        if symbol.name not in self.name_index:
            self.name_index[symbol.name] = set()
        self.name_index[symbol.name].add(symbol.id)
        
        # 更新文件索引
        if symbol.location.file_path not in self.file_index:
            self.file_index[symbol.location.file_path] = set()
        self.file_index[symbol.location.file_path].add(symbol.id)
        
        # 更新类型索引
        if symbol.symbol_type not in self.type_index:
            self.type_index[symbol.symbol_type] = set()
        self.type_index[symbol.symbol_type].add(symbol.id)
        
        # 更新限定名索引
        self.qualified_index[symbol.qualified_name] = symbol.id
    
    def query_by_name(self, name: str) -> List[Symbol]:
        """按名称查询符号"""
        symbol_ids = self.name_index.get(name, set())
        return [self.symbols[sid] for sid in symbol_ids]
    
    def query_by_file(self, file_path: str) -> List[Symbol]:
        """按文件路径查询符号"""
        symbol_ids = self.file_index.get(file_path, set())
        return [self.symbols[sid] for sid in symbol_ids]
    
    def query_by_type(self, symbol_type: SymbolType) -> List[Symbol]:
        """按类型查询符号"""
        symbol_ids = self.type_index.get(symbol_type, set())
        return [self.symbols[sid] for sid in symbol_ids]
    
    def get_symbol(self, qualified_name: str) -> Optional[Symbol]:
        """通过限定名获取符号"""
        symbol_id = self.qualified_index.get(qualified_name)
        return self.symbols.get(symbol_id) if symbol_id else None
```

### 1.3 核心算法实现

```python
class TreeSitterSymbolExtractor:
    """基于Tree-sitter的符号提取器"""
    
    # Tree-sitter查询定义 (按语言)
    QUERIES = {
        Language.PYTHON: {
            SymbolType.FUNCTION: """
                (function_definition
                    name: (identifier) @name
                    parameters: (parameters) @params
                    body: (block) @body
                    (#not-has-parent? @name class_definition)
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
                (arrow_function
                    parameters: (formal_parameters) @params
                    body: (_) @body
                ) @arrow_func
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
            SymbolType.EXPORT: """
                (export_statement
                    (function_declaration
                        name: (identifier) @name
                    )
                ) @export_func
                (export_statement
                    (class_declaration
                        name: (type_identifier) @name
                    )
                ) @export_class
            """,
        },
        Language.GO: {
            SymbolType.FUNCTION: """
                (function_declaration
                    name: (identifier) @name
                    parameters: (parameter_list) @params
                    body: (block) @body
                ) @func
                (method_declaration
                    name: (field_identifier) @name
                    parameters: (parameter_list) @params
                    body: (block) @body
                ) @method
            """,
            SymbolType.CLASS: """
                (type_declaration
                    (type_spec
                        name: (type_identifier) @name
                        type: (struct_type)
                    )
                ) @struct
            """,
            SymbolType.INTERFACE: """
                (type_declaration
                    (type_spec
                        name: (type_identifier) @name
                        type: (interface_type)
                    )
                ) @interface
            """,
        }
    }
    
    def __init__(self):
        self.parsers = {}
        self.queries = {}
        self._init_parsers()
    
    def _init_parsers(self):
        """初始化各语言解析器"""
        try:
            from tree_sitter import Language as TSLanguage, Parser
            import tree_sitter_python as tspython
            import tree_sitter_typescript as tsts
            import tree_sitter_go as tsgo
            
            self.parsers[Language.PYTHON] = Parser(tspython.language())
            self.parsers[Language.TYPESCRIPT] = Parser(tsts.language_typescript())
            self.parsers[Language.GO] = Parser(tsgo.language())
            
            # 预编译查询
            for lang, queries in self.QUERIES.items():
                self.queries[lang] = {}
                for sym_type, query_str in queries.items():
                    self.queries[lang][sym_type] = self.parsers[lang].language().query(query_str)
        except ImportError:
            # Fallback: 使用模拟实现
            pass
    
    def detect_language(self, file_path: str) -> Optional[Language]:
        """根据文件扩展名检测语言"""
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
        """
        从源代码中提取所有符号
        
        Args:
            file_path: 文件路径
            source_code: 源代码内容
            
        Returns:
            List[Symbol]: 提取的符号列表
        """
        language = self.detect_language(file_path)
        if not language or language not in self.parsers:
            return []
        
        parser = self.parsers[language]
        tree = parser.parse(source_code.encode())
        root_node = tree.root_node
        
        symbols = []
        lines = source_code.split('\n')
        
        # 提取各类符号
        for symbol_type, query in self.queries.get(language, {}).items():
            captures = query.captures(root_node)
            
            for capture in captures:
                node, capture_name = capture
                if capture_name == 'name':
                    symbol = self._create_symbol(
                        node=node,
                        file_path=file_path,
                        source_code=source_code,
                        lines=lines,
                        symbol_type=symbol_type,
                        language=language
                    )
                    if symbol:
                        symbols.append(symbol)
        
        return symbols
    
    def _create_symbol(
        self,
        node: Any,
        file_path: str,
        source_code: str,
        lines: List[str],
        symbol_type: SymbolType,
        language: Language
    ) -> Optional[Symbol]:
        """从AST节点创建Symbol对象"""
        name = source_code[node.start_byte:node.end_byte]
        
        # 获取父节点以构建限定名
        parent = node.parent
        qualified_parts = [name]
        
        while parent:
            if parent.type in ['class_definition', 'class_declaration']:
                for child in parent.children:
                    if child.type == 'identifier' or child.type == 'type_identifier':
                        class_name = source_code[child.start_byte:child.end_byte]
                        qualified_parts.insert(0, class_name)
                        break
            elif parent.type == 'function_definition':
                break
            parent = parent.parent
        
        qualified_name = '.'.join(qualified_parts)
        
        # 提取文档字符串
        docstring = self._extract_docstring(node, source_code, lines)
        
        # 提取函数签名
        signature = None
        if symbol_type == SymbolType.FUNCTION:
            signature = self._extract_signature(node, source_code)
        
        return Symbol(
            id='',
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
            ),
            docstring=docstring,
            signature=signature
        )
    
    def _extract_docstring(self, node: Any, source_code: str, lines: List[str]) -> Optional[str]:
        """提取文档字符串"""
        # 查找body节点
        body_node = None
        for child in node.parent.children if node.parent else []:
            if child.type in ['block', 'statement_block', 'class_body']:
                body_node = child
                break
        
        if not body_node or not body_node.children:
            return None
        
        first_stmt = body_node.children[0]
        if first_stmt.type == 'expression_statement':
            expr = first_stmt.children[0] if first_stmt.children else None
            if expr and expr.type == 'string':
                doc_text = source_code[expr.start_byte:expr.end_byte]
                return doc_text.strip('"\'\'\'\"\"\"')
        
        return None
    
    def _extract_signature(self, node: Any, source_code: str) -> Optional[str]:
        """提取函数签名"""
        parent = node.parent
        if not parent:
            return None
        
        # 查找参数列表
        params_node = None
        return_node = None
        
        for child in parent.children:
            if child.type in ['parameters', 'formal_parameters', 'parameter_list']:
                params_node = child
            elif child.type == 'type_annotation' or child.type == 'return_type':
                return_node = child
        
        if params_node:
            params = source_code[params_node.start_byte:params_node.end_byte]
            ret_type = source_code[return_node.start_byte:return_node.end_byte] if return_node else ''
            return f"{params} -> {ret_type}" if ret_type else params
        
        return None
```

### 1.4 复杂度分析

| 操作 | 时间复杂度 | 空间复杂度 | 说明 |
|------|-----------|-----------|------|
| 添加符号 | O(1) | O(1) | 哈希表插入 |
| 按名称查询 | O(1) | O(k) | k为匹配符号数量 |
| 按文件查询 | O(1) | O(k) | k为文件内符号数量 |
| 按类型查询 | O(1) | O(k) | k为该类型符号数量 |
| 符号提取 | O(n) | O(s) | n为代码行数, s为符号数 |
| 全文索引构建 | O(F × n) | O(S) | F为文件数, S为总符号数 |

---

## 2. 依赖图构建算法

### 2.1 数据结构定义

```python
from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple, Optional
from enum import Enum

class DependencyType(Enum):
    IMPORT = "import"           # 导入依赖
    EXPORT = "export"           # 导出关系
    EXTENDS = "extends"         # 继承关系
    IMPLEMENTS = "implements"   # 实现关系
    CALLS = "calls"             # 函数调用
    USES = "uses"               # 使用关系
    CONTAINS = "contains"       # 包含关系

@dataclass
class DependencyEdge:
    """依赖边"""
    source: str                 # 源符号ID
    target: str                 # 目标符号ID
    dep_type: DependencyType
    location: Optional[Location] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class DependencyGraph:
    """依赖图 - 有向图结构"""
    nodes: Set[str] = field(default_factory=set)                      # 所有节点(symbol_id)
    edges: List[DependencyEdge] = field(default_factory=list)         # 所有边
    adjacency: Dict[str, Set[str]] = field(default_factory=dict)      # 邻接表: node -> {targets}
    reverse_adj: Dict[str, Set[str]] = field(default_factory=dict)    # 反向邻接表: node -> {sources}
    edge_index: Dict[Tuple[str, str], DependencyEdge] = field(default_factory=dict)  # (src, tgt) -> edge
    
    def add_node(self, node_id: str) -> None:
        """添加节点"""
        self.nodes.add(node_id)
        if node_id not in self.adjacency:
            self.adjacency[node_id] = set()
        if node_id not in self.reverse_adj:
            self.reverse_adj[node_id] = set()
    
    def add_edge(self, edge: DependencyEdge) -> None:
        """添加边"""
        self.add_node(edge.source)
        self.add_node(edge.target)
        
        self.edges.append(edge)
        self.adjacency[edge.source].add(edge.target)
        self.reverse_adj[edge.target].add(edge.source)
        self.edge_index[(edge.source, edge.target)] = edge
    
    def get_dependencies(self, node_id: str) -> Set[str]:
        """获取节点的直接依赖（出边）"""
        return self.adjacency.get(node_id, set())
    
    def get_dependents(self, node_id: str) -> Set[str]:
        """获取依赖该节点的节点（入边）"""
        return self.reverse_adj.get(node_id, set())
    
    def get_edge(self, source: str, target: str) -> Optional[DependencyEdge]:
        """获取特定边"""
        return self.edge_index.get((source, target))
```

### 2.2 核心算法实现

```python
class DependencyGraphBuilder:
    """依赖图构建器"""
    
    # 各语言的import查询
    IMPORT_QUERIES = {
        Language.PYTHON: """
            (import_statement
                (dotted_name) @import_name
            )
            (import_from_statement
                module_name: (dotted_name) @from_module
                name: (dotted_name) @import_name
            )
            (import_from_statement
                module_name: (relative_import) @from_module
                name: (dotted_name) @import_name
            )
        """,
        Language.TYPESCRIPT: """
            (import_statement
                source: (string) @source
                (import_clause
                    [(identifier) @default_import
                     (named_imports
                        (import_specifier
                            name: (identifier) @named_import
                        )
                     )
                    ]
                )
            )
            (export_statement
                (export_clause
                    (export_specifier
                        name: (identifier) @export_name
                    )
                )
            )
            (call_expression
                function: (identifier) @require_call
                (#eq? @require_call "require")
                arguments: (arguments
                    (string) @require_source
                )
            )
        """,
        Language.GO: """
            (import_declaration
                (import_spec
                    path: (interpreted_string_literal) @import_path
                    name: (package_identifier)? @import_alias
                )
            )
            (package_clause
                name: (package_identifier) @package_name
            )
        """
    }
    
    def __init__(self, symbol_index: SymbolIndex):
        self.symbol_index = symbol_index
        self.extractor = TreeSitterSymbolExtractor()
        self.graph = DependencyGraph()
        self.module_resolver = ModuleResolver()
    
    def build_graph(self, file_paths: List[str]) -> DependencyGraph:
        """
        构建完整依赖图
        
        Args:
            file_paths: 项目中的所有文件路径
            
        Returns:
            DependencyGraph: 构建好的依赖图
        """
        # 第一阶段：解析所有文件并提取符号
        for file_path in file_paths:
            self._process_file(file_path)
        
        # 第二阶段：解析import/export关系
        for file_path in file_paths:
            self._resolve_imports(file_path)
        
        # 第三阶段：解析函数调用关系
        for file_path in file_paths:
            self._resolve_calls(file_path)
        
        return self.graph
    
    def _process_file(self, file_path: str) -> None:
        """处理单个文件，提取符号并添加到图"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                source_code = f.read()
            
            # 提取符号
            symbols = self.extractor.extract_symbols(file_path, source_code)
            
            # 添加符号到索引和图
            for symbol in symbols:
                self.symbol_index.add_symbol(symbol)
                self.graph.add_node(symbol.id)
                
                # 如果是导出符号，添加EXPORT边
                if symbol.is_exported:
                    file_node_id = f"file:{file_path}"
                    self.graph.add_node(file_node_id)
                    self.graph.add_edge(DependencyEdge(
                        source=file_node_id,
                        target=symbol.id,
                        dep_type=DependencyType.EXPORT
                    ))
        
        except Exception as e:
            print(f"Error processing {file_path}: {e}")
    
    def _resolve_imports(self, file_path: str) -> None:
        """解析文件中的import关系"""
        language = self.extractor.detect_language(file_path)
        if not language:
            return
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                source_code = f.read()
            
            parser = self.extractor.parsers.get(language)
            if not parser:
                return
            
            tree = parser.parse(source_code.encode())
            query_str = self.IMPORT_QUERIES.get(language, "")
            if not query_str:
                return
            
            query = parser.language().query(query_str)
            captures = query.captures(tree.root_node)
            
            file_node_id = f"file:{file_path}"
            
            for capture in captures:
                node, capture_name = capture
                
                if capture_name in ['import_name', 'from_module', 'source', 'require_source']:
                    import_path = source_code[node.start_byte:node.end_byte]
                    import_path = import_path.strip('"\'')
                    
                    # 解析模块路径
                    resolved = self.module_resolver.resolve(
                        import_path, 
                        file_path, 
                        language
                    )
                    
                    if resolved:
                        # 添加IMPORT边
                        self.graph.add_edge(DependencyEdge(
                            source=file_node_id,
                            target=f"file:{resolved}",
                            dep_type=DependencyType.IMPORT,
                            location=Location(
                                file_path=file_path,
                                line_start=node.start_point[0] + 1,
                                line_end=node.end_point[0] + 1,
                                column_start=node.start_point[1],
                                column_end=node.end_point[1]
                            ),
                            metadata={'import_path': import_path}
                        ))
        
        except Exception as e:
            print(f"Error resolving imports in {file_path}: {e}")
    
    def _resolve_calls(self, file_path: str) -> None:
        """解析函数调用关系"""
        # 获取文件中的所有符号
        symbols = self.symbol_index.query_by_file(file_path)
        
        for symbol in symbols:
            if symbol.symbol_type == SymbolType.FUNCTION:
                self._analyze_function_calls(symbol, file_path)
    
    def _analyze_function_calls(self, symbol: Symbol, file_path: str) -> None:
        """分析函数体内的调用关系"""
        # 读取函数所在文件
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # 提取函数体
            func_body = '\n'.join(
                lines[symbol.location.line_start - 1:symbol.location.line_end]
            )
            
            # 解析函数调用
            calls = self._extract_calls_from_body(func_body, symbol.language)
            
            for call in calls:
                # 查找被调用函数的符号
                target_symbols = self.symbol_index.query_by_name(call)
                
                for target in target_symbols:
                    self.graph.add_edge(DependencyEdge(
                        source=symbol.id,
                        target=target.id,
                        dep_type=DependencyType.CALLS
                    ))
        
        except Exception as e:
            print(f"Error analyzing calls in {symbol.name}: {e}")
    
    def _extract_calls_from_body(self, body: str, language: Language) -> Set[str]:
        """从函数体中提取调用"""
        calls = set()
        
        # 简化的调用提取（实际实现需要完整的AST解析）
        if language == Language.PYTHON:
            # 匹配 function_name(
            import re
            pattern = r'([a-zA-Z_][a-zA-Z0-9_]*)\s*\('
            calls.update(re.findall(pattern, body))
        
        elif language == Language.TYPESCRIPT:
            pattern = r'([a-zA-Z_][a-zA-Z0-9_]*)\s*\(|\.(\w+)\s*\('
            matches = re.findall(pattern, body)
            for m in matches:
                calls.add(m[0] or m[1])
        
        elif language == Language.GO:
            pattern = r'([a-zA-Z_][a-zA-Z0-9_]*)\s*\('
            calls.update(re.findall(pattern, body))
        
        return calls


class ModuleResolver:
    """模块解析器 - 处理相对/绝对导入路径"""
    
    def resolve(self, import_path: str, from_file: str, language: Language) -> Optional[str]:
        """
        解析导入路径为实际文件路径
        
        Args:
            import_path: 导入路径 (e.g., "./utils", "lodash", "src/lib/helper")
            from_file: 导入源文件路径
            language: 编程语言
            
        Returns:
            Optional[str]: 解析后的文件路径，或None
        """
        import os
        
        base_dir = os.path.dirname(from_file)
        
        if language == Language.PYTHON:
            return self._resolve_python(import_path, base_dir)
        elif language == Language.TYPESCRIPT:
            return self._resolve_typescript(import_path, base_dir)
        elif language == Language.GO:
            return self._resolve_go(import_path, base_dir)
        
        return None
    
    def _resolve_python(self, import_path: str, base_dir: str) -> Optional[str]:
        """解析Python导入"""
        import os
        
        # 处理相对导入
        if import_path.startswith('.'):
            parts = import_path.split('.')
            path = base_dir
            for part in parts:
                if part == '':
                    path = os.path.dirname(path)
                else:
                    path = os.path.join(path, part)
            
            # 尝试不同的文件形式
            for ext in ['.py', '/__init__.py']:
                full_path = path + ext
                if os.path.exists(full_path):
                    return full_path
        
        # 处理绝对导入（简化版）
        parts = import_path.split('.')
        path = os.path.join(base_dir, *parts)
        
        for ext in ['.py', '/__init__.py']:
            full_path = path + ext
            if os.path.exists(full_path):
                return full_path
        
        return None
    
    def _resolve_typescript(self, import_path: str, base_dir: str) -> Optional[str]:
        """解析TypeScript导入"""
        import os
        
        # 处理相对导入
        if import_path.startswith('.') or import_path.startswith('/'):
            if import_path.startswith('/'):
                path = import_path[1:]
            else:
                path = os.path.normpath(os.path.join(base_dir, import_path))
            
            # 尝试不同的扩展名
            for ext in ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']:
                full_path = path + ext
                if os.path.exists(full_path):
                    return full_path
        
        return None
    
    def _resolve_go(self, import_path: str, base_dir: str) -> Optional[str]:
        """解析Go导入"""
        import os
        
        # 处理相对导入
        if import_path.startswith('.'):
            path = os.path.normpath(os.path.join(base_dir, import_path))
            
            for ext in ['', '.go', '/index.go']:
                full_path = path + ext
                if os.path.exists(full_path):
                    return full_path
        
        return None
```

### 2.3 复杂度分析

| 操作 | 时间复杂度 | 空间复杂度 | 说明 |
|------|-----------|-----------|------|
| 添加节点 | O(1) | O(1) | 集合操作 |
| 添加边 | O(1) | O(1) | 哈希表操作 |
| 获取依赖 | O(1) | O(d) | d为依赖数量 |
| 获取被依赖 | O(1) | O(d) | d为被依赖数量 |
| 构建完整图 | O(F × n) | O(V + E) | F文件数, V节点数, E边数 |
| 模块解析 | O(p) | O(1) | p为路径深度 |

---

## 3. PageRank中心性计算

### 3.1 算法概述
使用PageRank算法识别代码库中的核心节点（被大量文件依赖的模块）。

### 3.2 核心算法实现

```python
import numpy as np
from typing import Dict, List, Tuple
from collections import defaultdict

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
        """
        计算PageRank中心性
        
        Args:
            graph: 依赖图
            weight_by_type: 按依赖类型加权 (默认所有类型权重为1.0)
            
        Returns:
            Dict[str, float]: 节点ID -> PageRank值
        """
        nodes = list(graph.nodes)
        n = len(nodes)
        
        if n == 0:
            return {}
        
        # 构建转移矩阵
        transition_matrix = self._build_transition_matrix(
            graph, nodes, weight_by_type
        )
        
        # 初始化PageRank值
        pagerank = np.ones(n) / n
        
        # 迭代计算
        for iteration in range(self.max_iterations):
            new_pagerank = (
                (1 - self.damping_factor) / n +
                self.damping_factor * transition_matrix.T @ pagerank
            )
            
            # 检查收敛
            diff = np.linalg.norm(new_pagerank - pagerank, 1)
            pagerank = new_pagerank
            
            if diff < self.tolerance:
                break
        
        # 归一化
        pagerank = pagerank / np.sum(pagerank)
        
        # 返回结果
        return {node: float(score) for node, score in zip(nodes, pagerank)}
    
    def _build_transition_matrix(
        self,
        graph: DependencyGraph,
        nodes: List[str],
        weight_by_type: Optional[Dict[DependencyType, float]]
    ) -> np.ndarray:
        """构建转移矩阵"""
        n = len(nodes)
        node_index = {node: i for i, node in enumerate(nodes)}
        
        # 初始化矩阵
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
        
        # 填充矩阵
        for edge in graph.edges:
            if edge.source in node_index and edge.target in node_index:
                i = node_index[edge.source]
                j = node_index[edge.target]
                weight = default_weights.get(edge.dep_type, 1.0)
                matrix[i, j] += weight
        
        # 归一化行（处理dead ends）
        for i in range(n):
            row_sum = np.sum(matrix[i, :])
            if row_sum > 0:
                matrix[i, :] /= row_sum
            else:
                # Dead end: 均匀分布
                matrix[i, :] = 1.0 / n
        
        return matrix
    
    def identify_core_nodes(
        self,
        pagerank_scores: Dict[str, float],
        graph: DependencyGraph,
        threshold_ratio: float = 0.1,
        min_dependents: int = 10
    ) -> List[Tuple[str, float, int]]:
        """
        识别核心节点
        
        Args:
            pagerank_scores: PageRank分数
            graph: 依赖图
            threshold_ratio: 前X%的节点被视为核心
            min_dependents: 最少被依赖数量
            
        Returns:
            List[Tuple[str, float, int]]: (节点ID, PageRank值, 被依赖数)
        """
        # 计算被依赖数量
        dependent_counts = {
            node: len(graph.get_dependents(node))
            for node in pagerank_scores.keys()
        }
        
        # 筛选核心节点
        core_nodes = [
            (node, score, dependent_counts[node])
            for node, score in pagerank_scores.items()
            if dependent_counts[node] >= min_dependents
        ]
        
        # 按PageRank排序
        core_nodes.sort(key=lambda x: x[1], reverse=True)
        
        # 取前threshold_ratio
        cutoff = max(1, int(len(core_nodes) * threshold_ratio))
        return core_nodes[:cutoff]


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
        """
        对节点进行风险分级
        
        Returns:
            Tuple[str, Dict]: (风险等级, 详细信息)
        
        风险等级:
        - 🔴 核心节点: 被 >10 个文件依赖
        - 🟡 普通节点: 被 3-10 个文件依赖
        - 🟢 叶子节点: 被 <3 个文件依赖
        """
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
```

### 3.3 复杂度分析

| 操作 | 时间复杂度 | 空间复杂度 | 说明 |
|------|-----------|-----------|------|
| 构建转移矩阵 | O(E) | O(V²) | E边数, V节点数 |
| PageRank迭代 | O(k × V²) | O(V²) | k迭代次数 |
| 识别核心节点 | O(V log V) | O(V) | 排序操作 |
| 风险分级 | O(1) | O(1) | 单次查询 |

**优化**: 使用稀疏矩阵可将空间复杂度降至O(E)，时间复杂度降至O(k × E)。

---

## 4. 影响传播算法

### 4.1 算法概述
计算修改的二级传递效应，包括直接影响和间接影响。

### 4.2 核心算法实现

```python
from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple, Optional
from collections import deque, defaultdict
from enum import Enum

class ImpactLevel(Enum):
    DIRECT = 1      # 直接影响
    INDIRECT = 2    # 间接影响（二级）
    TRANSITIVE = 3  # 传递影响（三级及以上）

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
        """获取所有受影响的节点"""
        return self.direct_impacts | self.indirect_impacts | self.transitive_impacts
    
    def get_risk_summary(self) -> Dict[str, int]:
        """获取风险摘要"""
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
        """
        分析修改的影响传播
        
        Args:
            modified_nodes: 被修改的节点ID列表
            max_depth: 最大传播深度
            
        Returns:
            Dict[str, ImpactResult]: 每个修改节点的影响结果
        """
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
        """分析单个节点的影响"""
        result = ImpactResult(source_node=source_node)
        
        # BFS遍历
        visited = {source_node}
        queue = deque([(source_node, 0, [source_node])])  # (node, depth, path)
        
        while queue:
            current, depth, path = queue.popleft()
            
            if depth >= max_depth:
                continue
            
            # 获取依赖当前节点的节点（反向传播）
            dependents = self.graph.get_dependents(current)
            
            for dependent in dependents:
                if dependent in visited:
                    continue
                
                visited.add(dependent)
                new_path = path + [dependent]
                
                # 分类影响级别
                if depth == 0:
                    result.direct_impacts.add(dependent)
                elif depth == 1:
                    result.indirect_impacts.add(dependent)
                else:
                    result.transitive_impacts.add(dependent)
                
                # 记录影响路径
                if dependent not in result.impact_paths:
                    result.impact_paths[dependent] = []
                result.impact_paths[dependent].append(new_path)
                
                # 计算影响分数
                impact_score = self._calculate_impact_score(
                    source_node, dependent, depth, new_path
                )
                result.impact_scores[dependent] = impact_score
                
                # 继续BFS
                queue.append((dependent, depth + 1, new_path))
        
        return result
    
    def _calculate_impact_score(
        self,
        source: str,
        target: str,
        depth: int,
        path: List[str]
    ) -> float:
        """
        计算影响分数
        
        分数 = PageRank(源) × PageRank(目标) × decay^depth × path_weight
        """
        source_pr = self.pagerank_scores.get(source, 0.0)
        target_pr = self.pagerank_scores.get(target, 0.0)
        
        # 深度衰减
        depth_decay = self.decay_factor ** depth
        
        # 路径权重（路径越短权重越高）
        path_weight = 1.0 / len(path)
        
        # 边权重
        edge_weight = 1.0
        for i in range(len(path) - 1):
            edge = self.graph.get_edge(path[i], path[i + 1])
            if edge:
                edge_weight *= self._get_edge_weight(edge)
        
        return source_pr * target_pr * depth_decay * path_weight * edge_weight
    
    def _get_edge_weight(self, edge: DependencyEdge) -> float:
        """获取边的权重"""
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
            
            # 识别高风险节点
            for impacted, score in result.impact_scores.items():
                if score > 0.5:  # 高风险阈值
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
        
        # 按分数排序高风险节点
        report['high_risk_nodes'].sort(key=lambda x: x['score'], reverse=True)
        
        return report
```

### 4.3 复杂度分析

| 操作 | 时间复杂度 | 空间复杂度 | 说明 |
|------|-----------|-----------|------|
| 单节点影响分析 | O(V + E) | O(V) | BFS遍历 |
| 多节点影响分析 | O(k × (V + E)) | O(k × V) | k为修改节点数 |
| 影响分数计算 | O(p) | O(1) | p为路径长度 |
| 生成报告 | O(k × V log V) | O(k × V) | 排序操作 |

---

## 5. 死代码检测集成

### 5.1 算法概述
集成vulture（Python）、ts-prune（TypeScript）和unused（Go）进行死代码检测。

### 5.2 核心算法实现

```python
import subprocess
import json
import re
from dataclasses import dataclass, field
from typing import Dict, List, Set, Optional, Callable
from enum import Enum
import os

class DeadCodeTool(Enum):
    VULTURE = "vulture"
    TS_PRUNE = "ts-prune"
    UNUSED = "unused"
    CUSTOM = "custom"

@dataclass
class DeadCodeItem:
    """死代码项"""
    symbol_name: str
    file_path: str
    line_number: int
    symbol_type: str  # function, class, variable, import, etc.
    confidence: float  # 置信度 0-1
    tool: DeadCodeTool
    message: str
    suggestion: Optional[str] = None

@dataclass
class DeadCodeReport:
    """死代码检测报告"""
    items: List[DeadCodeItem] = field(default_factory=list)
    statistics: Dict[str, int] = field(default_factory=dict)
    
    def by_file(self) -> Dict[str, List[DeadCodeItem]]:
        """按文件分组"""
        result = defaultdict(list)
        for item in self.items:
            result[item.file_path].append(item)
        return dict(result)
    
    def by_type(self) -> Dict[str, List[DeadCodeItem]]:
        """按类型分组"""
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
        """使用vulture检测Python死代码"""
        report = DeadCodeReport()
        
        try:
            # 运行vulture
            result = subprocess.run(
                ['vulture', self.project_path, '--min-confidence', '80', '--json'],
                capture_output=True,
                text=True,
                timeout=300
            )
            
            if result.returncode == 0 or result.stdout:
                # 解析JSON输出
                try:
                    data = json.loads(result.stdout)
                    for item in data:
                        dead_item = DeadCodeItem(
                            symbol_name=item.get('name', 'unknown'),
                            file_path=item.get('path', ''),
                            line_number=item.get('line', 0),
                            symbol_type=self._map_vulture_type(item.get('type', '')),
                            confidence=item.get('confidence', 80) / 100.0,
                            tool=DeadCodeTool.VULTURE,
                            message=item.get('message', '')
                        )
                        report.items.append(dead_item)
                except json.JSONDecodeError:
                    # 解析文本输出
                    report = self._parse_vulture_text(result.stdout)
        
        except FileNotFoundError:
            # vulture未安装，使用备用方法
            report = self._fallback_python_detection()
        
        except subprocess.TimeoutExpired:
            print("Vulture detection timed out")
        
        # 更新统计
        report.statistics = {
            'total': len(report.items),
            'by_confidence': {
                'high': len([i for i in report.items if i.confidence >= 0.9]),
                'medium': len([i for i in report.items if 0.7 <= i.confidence < 0.9]),
                'low': len([i for i in report.items if i.confidence < 0.7])
            }
        }
        
        return report
    
    def _parse_vulture_text(self, output: str) -> DeadCodeReport:
        """解析vulture的文本输出"""
        report = DeadCodeReport()
        
        # 解析格式: file_path:line: symbol_type symbol_name (confidence%)
        pattern = r'^(.*?):(\d+):\s*(\w+)\s+(\w+)\s*\((\d+)%\)$'
        
        for line in output.strip().split('\n'):
            match = re.match(pattern, line)
            if match:
                file_path, line_num, sym_type, sym_name, confidence = match.groups()
                report.items.append(DeadCodeItem(
                    symbol_name=sym_name,
                    file_path=file_path,
                    line_number=int(line_num),
                    symbol_type=self._map_vulture_type(sym_type),
                    confidence=int(confidence) / 100.0,
                    tool=DeadCodeTool.VULTURE,
                    message=f"Unused {sym_type}: {sym_name}"
                ))
        
        return report
    
    def _map_vulture_type(self, vulture_type: str) -> str:
        """映射vulture类型到统一类型"""
        mapping = {
            'function': 'function',
            'method': 'function',
            'class': 'class',
            'variable': 'variable',
            'attribute': 'attribute',
            'import': 'import',
            'property': 'property',
        }
        return mapping.get(vulture_type.lower(), 'unknown')
    
    def _fallback_python_detection(self) -> DeadCodeReport:
        """Python死代码检测的备用方法"""
        report = DeadCodeReport()
        
        # 使用AST分析检测未使用的导入
        import ast
        
        for root, dirs, files in os.walk(self.project_path):
            for file in files:
                if file.endswith('.py'):
                    file_path = os.path.join(root, file)
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            source = f.read()
                        
                        tree = ast.parse(source)
                        
                        # 收集所有导入
                        imports = {}
                        used_names = set()
                        
                        for node in ast.walk(tree):
                            if isinstance(node, (ast.Import, ast.ImportFrom)):
                                for alias in node.names:
                                    name = alias.asname if alias.asname else alias.name
                                    imports[name] = {
                                        'node': node,
                                        'line': node.lineno
                                    }
                            elif isinstance(node, ast.Name):
                                used_names.add(node.id)
                        
                        # 检测未使用的导入
                        for name, info in imports.items():
                            if name not in used_names:
                                report.items.append(DeadCodeItem(
                                    symbol_name=name,
                                    file_path=file_path,
                                    line_number=info['line'],
                                    symbol_type='import',
                                    confidence=0.8,
                                    tool=DeadCodeTool.CUSTOM,
                                    message=f"Potentially unused import: {name}",
                                    suggestion=f"Remove import: {name}"
                                ))
                    
                    except Exception as e:
                        print(f"Error analyzing {file_path}: {e}")
        
        return report
    
    def _detect_typescript(self) -> DeadCodeReport:
        """使用ts-prune检测TypeScript死代码"""
        report = DeadCodeReport()
        
        try:
            # 运行ts-prune
            result = subprocess.run(
                ['ts-prune', '-p', os.path.join(self.project_path, 'tsconfig.json')],
                capture_output=True,
                text=True,
                timeout=300,
                cwd=self.project_path
            )
            
            if result.returncode == 0 or result.stdout:
                # 解析ts-prune输出
                # 格式: file_path:line - symbol_name (type)
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
                            message=f"Potentially unused {sym_type}: {sym_name}",
                            suggestion=f"Consider removing or exporting {sym_name}"
                        ))
        
        except FileNotFoundError:
            print("ts-prune not found, using fallback detection")
            report = self._fallback_typescript_detection()
        
        except subprocess.TimeoutExpired:
            print("ts-prune detection timed out")
        
        return report
    
    def _fallback_typescript_detection(self) -> DeadCodeReport:
        """TypeScript死代码检测的备用方法"""
        report = DeadCodeReport()
        
        # 简单的正则表达式检测
        export_pattern = r'export\s+(?:const|let|var|function|class|interface|type)\s+(\w+)'
        
        for root, dirs, files in os.walk(self.project_path):
            for file in files:
                if file.endswith(('.ts', '.tsx')):
                    file_path = os.path.join(root, file)
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                        
                        # 查找所有导出
                        exports = re.findall(export_pattern, content)
                        
                        # 检查导出是否被其他文件使用（简化版）
                        for export in exports:
                            # 这里需要更复杂的跨文件分析
                            # 简化版本：标记所有导出为潜在死代码
                            if not export.startswith('_'):
                                report.items.append(DeadCodeItem(
                                    symbol_name=export,
                                    file_path=file_path,
                                    line_number=0,
                                    symbol_type='export',
                                    confidence=0.5,
                                    tool=DeadCodeTool.CUSTOM,
                                    message=f"Potentially unused export: {export}",
                                    suggestion="Verify usage before removing"
                                ))
                    
                    except Exception as e:
                        print(f"Error analyzing {file_path}: {e}")
        
        return report
    
    def _detect_go(self) -> DeadCodeReport:
        """使用unused检测Go死代码"""
        report = DeadCodeReport()
        
        try:
            # 运行unused (golang.org/x/tools/cmd/unused)
            result = subprocess.run(
                ['unused', './...'],
                capture_output=True,
                text=True,
                timeout=300,
                cwd=self.project_path
            )
            
            if result.returncode == 0 or result.stdout:
                # 解析unused输出
                # 格式: file_path:line:col: symbol_name (type)
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
                            message=f"Unused {sym_type}: {sym_name}",
                            suggestion=f"Remove unused {sym_type}"
                        ))
        
        except FileNotFoundError:
            print("unused not found, using fallback detection")
            report = self._fallback_go_detection()
        
        except subprocess.TimeoutExpired:
            print("unused detection timed out")
        
        return report
    
    def _fallback_go_detection(self) -> DeadCodeReport:
        """Go死代码检测的备用方法"""
        report = DeadCodeReport()
        
        # 简单的正则表达式检测未使用的函数
        func_pattern = r'^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\('
        
        for root, dirs, files in os.walk(self.project_path):
            for file in files:
                if file.endswith('.go'):
                    file_path = os.path.join(root, file)
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            lines = f.readlines()
                        
                        for i, line in enumerate(lines):
                            match = re.match(func_pattern, line)
                            if match:
                                func_name = match.group(1)
                                # 检查是否为小写（未导出）
                                if func_name[0].islower():
                                    report.items.append(DeadCodeItem(
                                        symbol_name=func_name,
                                        file_path=file_path,
                                        line_number=i + 1,
                                        symbol_type='function',
                                        confidence=0.4,
                                        tool=DeadCodeTool.CUSTOM,
                                        message=f"Potentially unused function: {func_name}",
                                        suggestion="Verify usage before removing"
                                    ))
                    
                    except Exception as e:
                        print(f"Error analyzing {file_path}: {e}")
        
        return report
    
    def integrate_with_symbol_index(
        self,
        symbol_index: SymbolIndex,
        reports: Dict[Language, DeadCodeReport]
    ) -> List[Dict[str, Any]]:
        """
        将死代码检测结果与符号索引集成
        
        Returns:
            List[Dict]: 带符号信息的死代码列表
        """
        integrated = []
        
        for language, report in reports.items():
            for item in report.items:
                # 在符号索引中查找对应符号
                symbols = symbol_index.query_by_name(item.symbol_name)
                
                # 匹配文件路径
                matching_symbol = None
                for sym in symbols:
                    if sym.location.file_path == item.file_path:
                        matching_symbol = sym
                        break
                
                integrated.append({
                    'dead_code': item,
                    'symbol': matching_symbol,
                    'removal_risk': self._assess_removal_risk(item, matching_symbol)
                })
        
        return integrated
    
    def _assess_removal_risk(
        self,
        item: DeadCodeItem,
        symbol: Optional[Symbol]
    ) -> str:
        """评估删除风险"""
        if not symbol:
            return "unknown"
        
        if item.confidence >= 0.9:
            return "low"
        elif item.confidence >= 0.7:
            return "medium"
        else:
            return "high"
```

### 5.3 复杂度分析

| 操作 | 时间复杂度 | 空间复杂度 | 说明 |
|------|-----------|-----------|------|
| Python检测 | O(F × n) | O(s) | F文件数, n行数, s符号数 |
| TypeScript检测 | O(F × n) | O(s) | 同上 |
| Go检测 | O(F × n) | O(s) | 同上 |
| 集成分析 | O(d × s) | O(d) | d为死代码项数 |

---

## 6. AST相似度算法

### 6.1 算法概述
基于Tree-sitter提取函数AST特征向量，计算相似度（阈值0.85触发复用提示）。

### 6.2 核心算法实现

```python
import numpy as np
from collections import defaultdict, Counter
from typing import Dict, List, Set, Tuple, Optional
from dataclasses import dataclass, field
import hashlib

@dataclass
class ASTFeatures:
    """AST特征向量"""
    node_types: Dict[str, int] = field(default_factory=dict)      # 节点类型计数
    node_depths: List[int] = field(default_factory=list)          # 节点深度分布
    subtree_hashes: Set[str] = field(default_factory=set)         # 子树哈希
    token_sequence: List[str] = field(default_factory=list)       # 标记序列
    structural_vector: np.ndarray = field(default_factory=lambda: np.array([]))
    
    def to_vector(self) -> np.ndarray:
        """转换为特征向量"""
        if len(self.structural_vector) > 0:
            return self.structural_vector
        
        # 组合特征
        features = []
        
        # 节点类型频率
        type_counts = list(self.node_types.values())
        features.extend(type_counts)
        
        # 深度统计
        if self.node_depths:
            features.extend([
                np.mean(self.node_depths),
                np.std(self.node_depths),
                max(self.node_depths),
                len(self.node_depths)
            ])
        
        # 子树哈希数量
        features.append(len(self.subtree_hashes))
        
        return np.array(features, dtype=np.float32)


@dataclass
class SimilarityResult:
    """相似度计算结果"""
    func1: str                      # 函数1限定名
    func2: str                      # 函数2限定名
    similarity: float               # 相似度分数 (0-1)
    is_duplicate: bool              # 是否超过阈值
    common_subtrees: List[str]      # 共同子树
    diff_locations: List[Tuple[int, int]]  # 差异位置


class ASTSimilarityAnalyzer:
    """AST相似度分析器"""
    
    SIMILARITY_THRESHOLD = 0.85
    
    # 重要节点类型（用于相似度计算）
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
        """
        分析目标函数与候选函数的相似度
        
        Args:
            target_function: 目标函数限定名
            candidate_functions: 候选函数列表（None则检查所有函数）
            
        Returns:
            List[SimilarityResult]: 相似度结果列表
        """
        # 获取目标函数
        target_sym = self.symbol_index.get_symbol(target_function)
        if not target_sym or target_sym.symbol_type != SymbolType.FUNCTION:
            return []
        
        # 获取目标函数特征
        target_features = self._extract_function_features(target_sym)
        if not target_features:
            return []
        
        # 确定候选函数
        if candidate_functions is None:
            candidate_functions = [
                sym.qualified_name
                for sym in self.symbol_index.query_by_type(SymbolType.FUNCTION)
                if sym.qualified_name != target_function
            ]
        
        # 计算相似度
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
            
            result = SimilarityResult(
                func1=target_function,
                func2=candidate_name,
                similarity=similarity,
                is_duplicate=similarity >= self.SIMILARITY_THRESHOLD,
                common_subtrees=common_subtrees,
                diff_locations=diff_locations
            )
            
            results.append(result)
        
        # 按相似度排序
        results.sort(key=lambda x: x.similarity, reverse=True)
        
        return results
    
    def _extract_function_features(self, symbol: Symbol) -> Optional[ASTFeatures]:
        """提取函数的AST特征"""
        # 检查缓存
        if symbol.id in self.feature_cache:
            return self.feature_cache[symbol.id]
        
        # 读取函数源代码
        try:
            with open(symbol.location.file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # 提取函数体
            func_body = '\n'.join(
                lines[symbol.location.line_start - 1:symbol.location.line_end]
            )
            
            # 解析AST
            language = symbol.language
            parser = self.extractor.parsers.get(language)
            if not parser:
                return None
            
            tree = parser.parse(func_body.encode())
            root_node = tree.root_node
            
            # 提取特征
            features = self._extract_features_from_node(root_node, func_body)
            
            # 缓存
            self.feature_cache[symbol.id] = features
            
            return features
        
        except Exception as e:
            print(f"Error extracting features for {symbol.qualified_name}: {e}")
            return None
    
    def _extract_features_from_node(
        self,
        node: Any,
        source_code: str,
        depth: int = 0
    ) -> ASTFeatures:
        """从AST节点提取特征"""
        features = ASTFeatures()
        
        def traverse(n: Any, d: int):
            if not n:
                return
            
            # 节点类型计数
            node_type = n.type
            features.node_types[node_type] = features.node_types.get(node_type, 0) + 1
            
            # 节点深度
            features.node_depths.append(d)
            
            # 子树哈希（用于结构比较）
            if node_type in self.IMPORTANT_NODE_TYPES:
                subtree_hash = self._compute_subtree_hash(n, source_code)
                features.subtree_hashes.add(subtree_hash)
            
            # 标记序列
            if n.type in ['identifier', 'type_identifier', 'string', 'number']:
                token = source_code[n.start_byte:n.end_byte]
                features.token_sequence.append(token)
            
            # 递归遍历子节点
            for child in n.children:
                traverse(child, d + 1)
        
        traverse(node, depth)
        
        # 构建结构向量
        features.structural_vector = self._build_structural_vector(features)
        
        return features
    
    def _compute_subtree_hash(self, node: Any, source_code: str) -> str:
        """计算子树哈希"""
        # 简化表示：节点类型 + 子节点类型序列
        child_types = [child.type for child in node.children]
        representation = f"{node.type}:[{','.join(child_types)}]"
        return hashlib.md5(representation.encode()).hexdigest()[:16]
    
    def _build_structural_vector(self, features: ASTFeatures) -> np.ndarray:
        """构建结构特征向量"""
        # 节点类型直方图（标准化）
        type_vector = np.zeros(len(self.IMPORTANT_NODE_TYPES))
        type_list = sorted(self.IMPORTANT_NODE_TYPES)
        
        for i, node_type in enumerate(type_list):
            type_vector[i] = features.node_types.get(node_type, 0)
        
        # 标准化
        if np.sum(type_vector) > 0:
            type_vector = type_vector / np.sum(type_vector)
        
        # 深度统计
        depth_stats = np.array([
            np.mean(features.node_depths) if features.node_depths else 0,
            np.std(features.node_depths) if features.node_depths else 0,
            max(features.node_depths) if features.node_depths else 0,
            len(features.node_depths)
        ])
        
        # 子树哈希数量（标准化）
        subtree_count = np.array([len(features.subtree_hashes)])
        
        return np.concatenate([type_vector, depth_stats, subtree_count])
    
    def _calculate_similarity(
        self,
        features1: ASTFeatures,
        features2: ASTFeatures
    ) -> Tuple[float, List[str], List[Tuple[int, int]]]:
        """
        计算两个函数特征的相似度
        
        Returns:
            Tuple: (相似度分数, 共同子树, 差异位置)
        """
        # 1. 结构相似度（余弦相似度）
        vec1 = features1.to_vector()
        vec2 = features2.to_vector()
        
        # 确保向量长度相同
        max_len = max(len(vec1), len(vec2))
        vec1 = np.pad(vec1, (0, max_len - len(vec1)))
        vec2 = np.pad(vec2, (0, max_len - len(vec2)))
        
        cosine_sim = self._cosine_similarity(vec1, vec2)
        
        # 2. 子树相似度（Jaccard）
        subtree_sim = self._jaccard_similarity(
            features1.subtree_hashes,
            features2.subtree_hashes
        )
        
        # 3. 标记序列相似度（编辑距离近似）
        token_sim = self._token_sequence_similarity(
            features1.token_sequence,
            features2.token_sequence
        )
        
        # 4. 综合相似度（加权平均）
        weights = [0.4, 0.4, 0.2]  # 结构、子树、标记
        similarity = (
            weights[0] * cosine_sim +
            weights[1] * subtree_sim +
            weights[2] * token_sim
        )
        
        # 找出共同子树
        common_subtrees = list(
            features1.subtree_hashes & features2.subtree_hashes
        )
        
        # 找出差异位置（简化版）
        diff_locations = []
        if similarity < 1.0:
            # 基于深度分布找差异
            depth_diff = abs(
                np.mean(features1.node_depths) - np.mean(features2.node_depths)
            )
            if depth_diff > 2:
                diff_locations.append((0, int(depth_diff)))
        
        return similarity, common_subtrees, diff_locations
    
    def _cosine_similarity(self, vec1: np.ndarray, vec2: np.ndarray) -> float:
        """计算余弦相似度"""
        norm1 = np.linalg.norm(vec1)
        norm2 = np.linalg.norm(vec2)
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        return float(np.dot(vec1, vec2) / (norm1 * norm2))
    
    def _jaccard_similarity(self, set1: Set[str], set2: Set[str]) -> float:
        """计算Jaccard相似度"""
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
        """计算标记序列相似度（基于最长公共子序列）"""
        if not seq1 and not seq2:
            return 1.0
        
        if not seq1 or not seq2:
            return 0.0
        
        # 简化的LCS近似
        set1 = set(seq1)
        set2 = set(seq2)
        
        common = len(set1 & set2)
        total = len(set1 | set2)
        
        return common / total if total > 0 else 0.0
    
    def find_duplicate_functions(
        self,
        min_similarity: float = 0.85
    ) -> List[Tuple[str, str, float]]:
        """
        查找项目中所有重复函数
        
        Args:
            min_similarity: 最小相似度阈值
            
        Returns:
            List[Tuple]: (函数1, 函数2, 相似度)
        """
        duplicates = []
        
        # 获取所有函数
        all_functions = self.symbol_index.query_by_type(SymbolType.FUNCTION)
        
        # 两两比较
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
        
        # 按相似度排序
        duplicates.sort(key=lambda x: x[2], reverse=True)
        
        return duplicates
    
    def generate_reuse_suggestion(
        self,
        similarity_result: SimilarityResult
    ) -> Dict[str, Any]:
        """生成复用建议"""
        if not similarity_result.is_duplicate:
            return {'should_reuse': False}
        
        func1 = self.symbol_index.get_symbol(similarity_result.func1)
        func2 = self.symbol_index.get_symbol(similarity_result.func2)
        
        suggestion = {
            'should_reuse': True,
            'similarity': similarity_result.similarity,
            'existing_function': similarity_result.func2,
            'new_function': similarity_result.func1,
            'existing_location': func2.location if func2 else None,
            'common_patterns': similarity_result.common_subtrees[:5],
            'recommendation': f"Consider reusing '{similarity_result.func2}' instead of creating '{similarity_result.func1}'",
            'refactor_suggestion': self._generate_refactor_suggestion(
                similarity_result
            )
        }
        
        return suggestion
    
    def _generate_refactor_suggestion(
        self,
        result: SimilarityResult
    ) -> str:
        """生成重构建议"""
        if result.similarity >= 0.95:
            return "Functions are nearly identical. Consider extracting common logic into a shared utility."
        elif result.similarity >= 0.90:
            return "High similarity detected. Review if the functions can be unified with parameterization."
        else:
            return "Moderate similarity. Consider if common patterns can be extracted."
```

### 6.3 复杂度分析

| 操作 | 时间复杂度 | 空间复杂度 | 说明 |
|------|-----------|-----------|------|
| 特征提取 | O(n) | O(n) | n为AST节点数 |
| 相似度计算 | O(d) | O(1) | d为向量维度 |
| 单函数比较 | O(m × d) | O(m) | m为候选函数数 |
| 全项目检测 | O(k² × d) | O(k) | k为函数总数 |

**优化**: 使用LSH（局部敏感哈希）可将全项目检测优化至O(k log k)。

---

## 7. 算法集成与使用示例

### 7.1 完整工作流

```python
class CognitiveScaffoldingSystem:
    """认知脚手架系统主类"""
    
    def __init__(self, project_path: str):
        self.project_path = project_path
        self.symbol_index = SymbolIndex()
        self.graph = DependencyGraph()
        self.pagerank_scores: Dict[str, float] = {}
    
    def initialize(self) -> None:
        """初始化系统"""
        # 1. 扫描项目文件
        file_paths = self._scan_project_files()
        
        # 2. 构建符号索引
        extractor = TreeSitterSymbolExtractor()
        for file_path in file_paths:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    source = f.read()
                symbols = extractor.extract_symbols(file_path, source)
                for symbol in symbols:
                    self.symbol_index.add_symbol(symbol)
            except Exception as e:
                print(f"Error indexing {file_path}: {e}")
        
        # 3. 构建依赖图
        builder = DependencyGraphBuilder(self.symbol_index)
        self.graph = builder.build_graph(file_paths)
        
        # 4. 计算PageRank
        calculator = PageRankCalculator()
        self.pagerank_scores = calculator.calculate(self.graph)
    
    def analyze_modification(
        self,
        modified_files: List[str]
    ) -> Dict[str, Any]:
        """分析修改影响"""
        # 获取修改的符号
        modified_symbols = []
        for file_path in modified_files:
            symbols = self.symbol_index.query_by_file(file_path)
            modified_symbols.extend([s.id for s in symbols])
        
        # 分析影响传播
        analyzer = ImpactPropagationAnalyzer(
            self.graph, self.pagerank_scores
        )
        impact_results = analyzer.analyze_impact(modified_symbols)
        
        # 生成报告
        report = analyzer.generate_impact_report(impact_results)
        
        # 风险分级
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
    
    def check_code_reuse(
        self,
        function_name: str
    ) -> List[Dict[str, Any]]:
        """检查代码复用机会"""
        analyzer = ASTSimilarityAnalyzer(self.symbol_index)
        results = analyzer.analyze_function_similarity(function_name)
        
        suggestions = []
        for result in results:
            if result.is_duplicate:
                suggestion = analyzer.generate_reuse_suggestion(result)
                suggestions.append(suggestion)
        
        return suggestions
    
    def detect_dead_code(self) -> Dict[Language, DeadCodeReport]:
        """检测死代码"""
        detector = DeadCodeDetector(self.project_path)
        reports = detector.detect_all()
        
        # 集成符号索引
        for language, report in reports.items():
            integrated = detector.integrate_with_symbol_index(
                self.symbol_index, {language: report}
            )
            print(f"{language.value}: Found {len(integrated)} dead code items")
        
        return reports
    
    def _scan_project_files(self) -> List[str]:
        """扫描项目文件"""
        import os
        
        file_paths = []
        extensions = {'.py', '.ts', '.tsx', '.go'}
        
        for root, dirs, files in os.walk(self.project_path):
            # 排除常见目录
            dirs[:] = [d for d in dirs if d not in {
                'node_modules', '.git', '__pycache__', 
                'venv', '.venv', 'dist', 'build'
            }]
            
            for file in files:
                if any(file.endswith(ext) for ext in extensions):
                    file_paths.append(os.path.join(root, file))
        
        return file_paths
```

### 7.2 使用示例

```python
# 初始化系统
system = CognitiveScaffoldingSystem("/path/to/project")
system.initialize()

# 分析修改影响
modified_files = ["src/utils/helper.ts", "src/api/user.ts"]
impact = system.analyze_modification(modified_files)
print(f"Total affected: {impact['impact_report']['summary']['total_affected']}")

# 检查代码复用
suggestions = system.check_code_reuse("src/components/Button.tsx:handleClick")
for suggestion in suggestions:
    if suggestion['should_reuse']:
        print(f"Reuse suggestion: {suggestion['recommendation']}")

# 检测死代码
dead_code = system.detect_dead_code()
```

---

## 8. 总结

### 8.1 算法复杂度汇总

| 算法 | 时间复杂度 | 空间复杂度 | 关键优化 |
|------|-----------|-----------|----------|
| 符号索引 | O(F × n) | O(S) | 多索引哈希表 |
| 依赖图构建 | O(F × n + E) | O(V + E) | 邻接表存储 |
| PageRank | O(k × V²) | O(V²) | 稀疏矩阵优化 |
| 影响传播 | O(k × (V + E)) | O(k × V) | BFS剪枝 |
| 死代码检测 | O(F × n) | O(s) | 多工具并行 |
| AST相似度 | O(k² × d) | O(k) | LSH加速 |

### 8.2 多语言支持方案

| 语言 | 解析器 | 导入解析 | 死代码工具 |
|------|--------|----------|-----------|
| Python | tree-sitter-python | AST分析 | vulture |
| TypeScript | tree-sitter-typescript | import语句解析 | ts-prune |
| Go | tree-sitter-go | import声明解析 | unused |

### 8.3 部署建议

1. **增量更新**: 仅重新分析修改的文件，而非全量重建
2. **缓存机制**: 缓存AST解析结果和特征向量
3. **并行处理**: 使用多线程并行处理多个文件
4. **内存优化**: 使用生成器处理大型代码库
