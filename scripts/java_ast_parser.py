#!/usr/bin/env python3
"""
Java AST Parser - Extract imports and exports from Java source code
Reads from stdin, outputs JSON to stdout
Uses javalang for AST parsing
"""

import sys
import json

try:
    import javalang
except ImportError:
    sys.stderr.write("javalang not installed")
    sys.exit(1)


def extract_decorators(method_node) -> list:
    """Return annotation names applied to a method (without the leading '@')."""
    decorators = []
    if hasattr(method_node, 'annotations') and method_node.annotations:
        for annotation in method_node.annotations:
            if hasattr(annotation, 'name') and annotation.name:
                decorators.append(annotation.name)
    return decorators


def compute_java_fingerprint(method_node) -> dict:
    if not hasattr(method_node, 'body') or not method_node.body:
        return {
            "paramCount": len(method_node.parameters) if hasattr(method_node, 'parameters') and method_node.parameters else 0,
            "isAsync": False,
            "isGenerator": False,
            "hasTryCatch": False,
            "branchCount": 0,
            "returnCount": 0,
            "maxArms": 0,
            "callCallees": []
        }
        
    branch_count = 0
    return_count = 0
    max_switch_arms = 0
    max_if_else_arms = 0
    has_try_catch = False
    seen_ifs = set()
    
    def walk(n):
        nonlocal branch_count, return_count, max_switch_arms, max_if_else_arms, has_try_catch
        if not n:
            return
        
        name = n.__class__.__name__
        if name in ('ClassDeclaration', 'InterfaceDeclaration', 'EnumDeclaration', 'AnnotationTypeDeclaration', 'AnonymousClassDeclaration'):
            return
        
        if name == 'IfStatement':
            if n not in seen_ifs:
                seen_ifs.add(n)
                curr = n
                while hasattr(curr, 'else_statement') and curr.else_statement and curr.else_statement.__class__.__name__ == 'IfStatement':
                    curr = curr.else_statement
                    seen_ifs.add(curr)
                
                arms = 1
                curr = n
                while hasattr(curr, 'else_statement') and curr.else_statement and curr.else_statement.__class__.__name__ == 'IfStatement':
                    arms += 1
                    curr = curr.else_statement
                if hasattr(curr, 'else_statement') and curr.else_statement:
                    arms += 1
                max_if_else_arms = max(max_if_else_arms, arms)
                
            branch_count += 1
            
        elif name == 'SwitchStatementCase':
            branch_count += 1
        elif name == 'TernaryExpression':
            branch_count += 1
        elif name in ('ForStatement', 'EnhancedForStatement', 'WhileStatement', 'DoStatement'):
            branch_count += 1
        elif name == 'CatchClause':
            branch_count += 1
            has_try_catch = True
        elif name == 'BinaryOperation':
            if hasattr(n, 'operator') and n.operator in ('&&', '||'):
                branch_count += 1
        elif name == 'ReturnStatement':
            return_count += 1
        elif name == 'SwitchStatement':
            if hasattr(n, 'cases') and n.cases:
                max_switch_arms = max(max_switch_arms, len(n.cases))
                
        if hasattr(n, 'children'):
            for child in n.children:
                if isinstance(child, list):
                    for c in child:
                        if hasattr(c, '__class__') and isinstance(c, javalang.tree.Node):
                            walk(c)
                elif isinstance(child, javalang.tree.Node):
                    walk(child)

    for stmt in method_node.body:
        walk(stmt)
        
    param_count = len(method_node.parameters) if hasattr(method_node, 'parameters') and method_node.parameters else 0
    return {
        "paramCount": param_count,
        "isAsync": False,
        "isGenerator": False,
        "hasTryCatch": has_try_catch,
        "branchCount": branch_count,
        "returnCount": return_count,
        "maxArms": max(max_switch_arms, max_if_else_arms),
        "callCallees": []
    }


def parse_java(source):
    tree = javalang.parse.parse(source)
    package = tree.package.name if tree.package else None

    imports = []
    import_records = []
    for imp in tree.imports:
        source_path = imp.path
        imported = []
        if imp.static and not imp.wildcard:
            parts = source_path.split(".")
            if len(parts) > 1:
                imported = [parts[-1]]
                source_path = ".".join(parts[:-1])
        if imp.wildcard:
            source_path += ".*"
        imports.append(source_path)
        import_records.append({
            "source": source_path,
            "imported": [] if imp.wildcard else imported if imp.static else [source_path.split(".")[-1]],
            "usesAllExports": imp.wildcard,
            "isStatic": imp.static
        })

    exports = []
    export_records = []
    function_records = []
    for path, node in tree:
        class_name = node.__class__.__name__
        if class_name == 'ClassDeclaration':
            exports.append(node.name)
            export_records.append({"name": node.name, "kind": "class"})
            for member in node.body or []:
                if isinstance(member, javalang.tree.MethodDeclaration) and "public" in member.modifiers:
                    exports.append(member.name)
                    fingerprint = compute_java_fingerprint(member)
                    decorators = extract_decorators(member)
                    export_records.append({"name": member.name, "kind": "function", "fingerprint": fingerprint})
                    function_records.append({
                        "name": member.name,
                        "kind": "function",
                        "lineStart": member.position.line if member.position else None,
                        "lineEnd": member.position.line if member.position else None,
                        "fingerprint": fingerprint,
                        "decorators": decorators
                    })
                if isinstance(member, javalang.tree.FieldDeclaration) and "public" in member.modifiers:
                    for declarator in member.declarators:
                        exports.append(declarator.name)
                        export_records.append({"name": declarator.name, "kind": "variable"})
        elif class_name == 'InterfaceDeclaration':
            exports.append(node.name)
            export_records.append({"name": node.name, "kind": "interface"})
            for member in node.body or []:
                if isinstance(member, javalang.tree.MethodDeclaration):
                    exports.append(member.name)
                    fingerprint = compute_java_fingerprint(member)
                    decorators = extract_decorators(member)
                    export_records.append({"name": member.name, "kind": "function", "fingerprint": fingerprint})
                    function_records.append({
                        "name": member.name,
                        "kind": "function",
                        "lineStart": member.position.line if member.position else None,
                        "lineEnd": member.position.line if member.position else None,
                        "fingerprint": fingerprint,
                        "decorators": decorators
                    })
        elif class_name == 'EnumDeclaration':
            exports.append(node.name)
            export_records.append({"name": node.name, "kind": "enum"})
        elif class_name == 'AnnotationTypeDeclaration':
            exports.append(node.name)
            export_records.append({"name": node.name, "kind": "annotation"})

    return {
        "imports": imports,
        "exports": list(dict.fromkeys(exports)),
        "exportRecords": export_records,
        "importRecords": import_records,
        "functionRecords": function_records,
        "package": package
    }


if __name__ == "__main__":
    try:
        if len(sys.argv) >= 3 and sys.argv[1] == '--file':
            with open(sys.argv[2], 'r', encoding='utf-8') as f:
                source = f.read()
        else:
            source = sys.stdin.read()
        if source.startswith('\ufeff'):
            source = source[1:]
        if not source.strip():
            print(json.dumps({"imports": [], "exports": [], "importRecords": [], "package": None}, separators=(',', ':')))
            sys.exit(0)
        result = parse_java(source)
        print(json.dumps(result, separators=(',', ':')))
    except Exception as e:
        sys.stderr.write(str(e))
        sys.exit(1)
