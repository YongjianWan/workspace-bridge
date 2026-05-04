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


def parse_java(source):
    tree = javalang.parse.parse(source)
    package = tree.package.name if tree.package else None

    imports = []
    import_records = []
    for imp in tree.imports:
        source_path = imp.path
        imported = []
        if imp.static and not imp.wildcard:
            # static import of a specific member: source is package path, imported is member name
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
    function_records = []
    for path, node in tree:
        if isinstance(node, javalang.tree.ClassDeclaration):
            exports.append(node.name)
            for member in node.body or []:
                if isinstance(member, javalang.tree.MethodDeclaration) and "public" in member.modifiers:
                    exports.append(member.name)
                    function_records.append({
                        "name": member.name,
                        "kind": "function",
                        "lineStart": member.position.line if member.position else None,
                        "lineEnd": member.position.line if member.position else None,
                    })
                if isinstance(member, javalang.tree.FieldDeclaration) and "public" in member.modifiers:
                    for declarator in member.declarators:
                        exports.append(declarator.name)
        elif isinstance(node, javalang.tree.InterfaceDeclaration):
            exports.append(node.name)
            for member in node.body or []:
                if isinstance(member, javalang.tree.MethodDeclaration):
                    exports.append(member.name)
                    function_records.append({
                        "name": member.name,
                        "kind": "function",
                        "lineStart": member.position.line if member.position else None,
                        "lineEnd": member.position.line if member.position else None,
                    })
        elif isinstance(node, javalang.tree.EnumDeclaration):
            exports.append(node.name)

    return {
        "imports": imports,
        "exports": list(dict.fromkeys(exports)),
        "importRecords": import_records,
        "functionRecords": function_records,
        "package": package
    }


if __name__ == "__main__":
    try:
        source = sys.stdin.read()
        if not source.strip():
            print(json.dumps({"imports": [], "exports": [], "importRecords": [], "package": None}, separators=(',', ':')))
            sys.exit(0)
        result = parse_java(source)
        print(json.dumps(result, separators=(',', ':')))
    except Exception as e:
        sys.stderr.write(str(e))
        sys.exit(1)
