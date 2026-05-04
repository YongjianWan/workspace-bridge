#!/usr/bin/env python3
"""
Python AST Parser - Extract imports and exports from Python source code
Reads from stdin, outputs JSON to stdout
"""

import ast
import json
import sys
from typing import Any


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
            export_records.append({
                "name": node.name,
                "kind": "function",
                "lineStart": node.lineno,
                "lineEnd": getattr(node, 'end_lineno', node.lineno)
            })
            function_records.append({
                "name": node.name,
                "kind": "function",
                "lineStart": node.lineno,
                "lineEnd": getattr(node, 'end_lineno', node.lineno)
            })
        
        # Also collect async function definitions
        elif isinstance(node, ast.AsyncFunctionDef) and not node.name.startswith('_'):
            exports.append(node.name)
            export_records.append({
                "name": node.name,
                "kind": "function",
                "lineStart": node.lineno,
                "lineEnd": getattr(node, 'end_lineno', node.lineno)
            })
            function_records.append({
                "name": node.name,
                "kind": "function",
                "lineStart": node.lineno,
                "lineEnd": getattr(node, 'end_lineno', node.lineno)
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
    """Main entry point - read from stdin, write JSON to stdout."""
    try:
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
