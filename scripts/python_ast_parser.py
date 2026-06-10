#!/usr/bin/env python3
"""
Python AST Parser - Extract imports and exports from Python source code
Reads from stdin, outputs JSON to stdout
"""

import ast
import json
import sys
from typing import Any


def count_python_if_else_arms(node: ast.If, seen_ifs: set) -> tuple[int, int]:
    ifNodeCount = 1
    curr = node
    while curr.orelse and len(curr.orelse) == 1 and isinstance(curr.orelse[0], ast.If):
        next_if = curr.orelse[0]
        seen_ifs.add(next_if)
        ifNodeCount += 1
        curr = next_if
    
    has_else = 0
    if curr.orelse:
        if len(curr.orelse) > 1 or not isinstance(curr.orelse[0], ast.If):
            has_else = 1
    return ifNodeCount, ifNodeCount + has_else


def compute_function_fingerprint(func_node: ast.AST) -> dict[str, Any]:
    branch_count = 0
    return_count = 0
    max_switch_arms = 0
    max_if_else_arms = 0
    has_try_catch = False
    seen_ifs = set()
    
    stack = list(func_node.body)
    while stack:
        node = stack.pop()
        if node is None:
            continue
        
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
            
        if hasattr(ast, 'Match') and isinstance(node, ast.Match):
            max_switch_arms = max(max_switch_arms, len(node.cases))
        
        elif isinstance(node, ast.If):
            if node not in seen_ifs:
                ifNodeCount, arms = count_python_if_else_arms(node, seen_ifs)
                branch_count += ifNodeCount
                max_if_else_arms = max(max_if_else_arms, arms)
                
        elif isinstance(node, (ast.For, ast.While, ast.ExceptHandler, ast.IfExp)):
            branch_count += 1
            if isinstance(node, ast.ExceptHandler):
                has_try_catch = True
                
        elif isinstance(node, ast.Try):
            has_try_catch = True
            
        elif hasattr(ast, 'match_case') and isinstance(node, ast.match_case):
            branch_count += 1
            
        elif isinstance(node, ast.BoolOp):
            branch_count += len(node.values) - 1
            
        elif isinstance(node, ast.Return):
            return_count += 1
            
        for child in ast.iter_child_nodes(node):
            stack.append(child)
            
    param_count = 0
    if hasattr(func_node, 'args') and func_node.args:
        param_count = len(func_node.args.args)
        if hasattr(func_node.args, 'kwonlyargs'):
            param_count += len(func_node.args.kwonlyargs)
        if func_node.args.vararg:
            param_count += 1
        if func_node.args.kwarg:
            param_count += 1
            
    return {
        "paramCount": param_count,
        "isAsync": isinstance(func_node, ast.AsyncFunctionDef),
        "isGenerator": False,
        "hasTryCatch": has_try_catch,
        "branchCount": branch_count,
        "returnCount": return_count,
        "maxArms": max(max_switch_arms, max_if_else_arms),
        "callCallees": []
    }


def parse_code(source: str) -> dict[str, Any]:
    """
    Parse Python source code and extract imports and exports.
    
    Returns:
        {
            "imports": ["module.name", ...],
            "exports": ["ClassName", "function_name", ...],
            "importRecords": [
                {
                    "source": "module.name",
                    "imported": ["symbol1", "symbol2"],
                    "usesAllExports": false
                },
                ...
            ],
            "exportRecords": [
                {
                    "name": "ClassName",
                    "kind": "class",
                    "lineStart": 1,
                    "lineEnd": 5
                },
                ...
            ],
            "functionRecords": [
                {
                    "name": "function_name",
                    "kind": "function",
                    "lineStart": 10,
                    "lineEnd": 15
                },
                ...
            ]
        }
    """
    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        # Return empty result on syntax error
        return {
            "imports": [],
            "exports": [],
            "importRecords": [],
            "exportRecords": [],
            "functionRecords": [],
            "error": f"Syntax error: {e}"
        }
    
    imports = []
    exports = []
    import_records = []
    export_records = []
    function_records = []
    all_export_names = None  # Will be set if __all__ is defined
    
    # First pass: find __all__ assignment and module-level class/function definitions
    # Use tree.body instead of ast.walk() to avoid treating nested definitions as module-level
    for node in tree.body:
        # Check for __all__ assignment
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == '__all__':
                    # Extract __all__ value
                    all_export_names = extract_all_exports(node.value)
        
        # Collect module-level class definitions (not starting with _)
        elif isinstance(node, ast.ClassDef) and not node.name.startswith('_'):
            exports.append(node.name)
            export_records.append({
                "name": node.name,
                "kind": "class",
                "lineStart": node.lineno,
                "lineEnd": getattr(node, 'end_lineno', node.lineno)
            })
        
        # Collect module-level function definitions (not starting with _)
        elif isinstance(node, ast.FunctionDef) and not node.name.startswith('_'):
            exports.append(node.name)
            fingerprint = compute_function_fingerprint(node)
            export_records.append({
                "name": node.name,
                "kind": "function",
                "lineStart": node.lineno,
                "lineEnd": getattr(node, 'end_lineno', node.lineno),
                "fingerprint": fingerprint
            })
            function_records.append({
                "name": node.name,
                "kind": "function",
                "lineStart": node.lineno,
                "lineEnd": getattr(node, 'end_lineno', node.lineno),
                "fingerprint": fingerprint
            })
        
        # Also collect async function definitions
        elif isinstance(node, ast.AsyncFunctionDef) and not node.name.startswith('_'):
            exports.append(node.name)
            fingerprint = compute_function_fingerprint(node)
            export_records.append({
                "name": node.name,
                "kind": "function",
                "lineStart": node.lineno,
                "lineEnd": getattr(node, 'end_lineno', node.lineno),
                "fingerprint": fingerprint
            })
            function_records.append({
                "name": node.name,
                "kind": "function",
                "lineStart": node.lineno,
                "lineEnd": getattr(node, 'end_lineno', node.lineno),
                "fingerprint": fingerprint
            })
    
    # Second pass: collect imports (walk entire tree since imports can be nested)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            # Handle: import x, import x.y, import x as y
            for alias in node.names:
                module_name = alias.name
                imports.append(module_name)
                
                # For "import x" style, we don't know what symbols are imported
                # Mark as usesAllExports since it's "import *" equivalent at module level
                import_records.append({
                    "source": module_name,
                    "imported": [],
                    "usesAllExports": True
                })
        
        elif isinstance(node, ast.ImportFrom):
            # Handle: from x import y, from x import y as z, from .x import y
            module = node.module or ''
            
            # Handle relative imports (from .x import y)
            if node.level > 0:
                # Convert relative import to dot notation
                module = '.' * node.level + module
            
            imports.append(module)
            
            # Collect imported symbols
            imported_names = []
            uses_all_exports = False
            
            for alias in node.names:
                if alias.name == '*':
                    uses_all_exports = True
                else:
                    imported_names.append(alias.name)
            
            import_records.append({
                "source": module,
                "imported": imported_names,
                "usesAllExports": uses_all_exports
            })
    
    # If __all__ is defined, use it as the definitive list of exports
    # Note: exportRecords/functionRecords remain based on actual definitions,
    # but the exports list is overridden by __all__
    if all_export_names is not None:
        exports = all_export_names
    
    # Remove duplicates while preserving order
    seen_imports = set()
    unique_imports = []
    for imp in imports:
        if imp not in seen_imports:
            seen_imports.add(imp)
            unique_imports.append(imp)
    
    seen_exports = set()
    unique_exports = []
    for exp in exports:
        if exp not in seen_exports:
            seen_exports.add(exp)
            unique_exports.append(exp)
    
    # Remove duplicate import records (same source)
    seen_sources = set()
    unique_import_records = []
    for record in import_records:
        if record["source"] not in seen_sources:
            seen_sources.add(record["source"])
            unique_import_records.append(record)
    
    return {
        "imports": unique_imports,
        "exports": unique_exports,
        "importRecords": unique_import_records,
        "exportRecords": export_records,
        "functionRecords": function_records
    }


def extract_all_exports(node: ast.AST) -> list[str]:
    """
    Extract export names from __all__ list/tuple.
    
    Args:
        node: The AST node representing __all__ value
        
    Returns:
        List of export names
    """
    exports = []
    
    if isinstance(node, (ast.List, ast.Tuple)):
        for element in node.elts:
            if isinstance(element, ast.Constant) and isinstance(element.value, str):
                exports.append(element.value)
            elif isinstance(element, ast.Str):  # Python < 3.8 compatibility
                exports.append(element.s)
    
    return exports


def main():
    """Main entry point - read from file or stdin, write JSON to stdout."""
    try:
        if len(sys.argv) >= 3 and sys.argv[1] == '--file':
            with open(sys.argv[2], 'r', encoding='utf-8') as f:
                source = f.read()
        else:
            # Read from stdin and handle BOM (Byte Order Mark) for Windows compatibility
            source = sys.stdin.read()
        # Remove UTF-8 BOM if present
        if source.startswith('\ufeff'):
            source = source[1:]
        result = parse_code(source)
        print(json.dumps(result, indent=2))
    except Exception as e:
        # On any error, return valid JSON with error info
        error_result = {
            "imports": [],
            "exports": [],
            "importRecords": [],
            "exportRecords": [],
            "functionRecords": [],
            "error": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == '__main__':
    main()
