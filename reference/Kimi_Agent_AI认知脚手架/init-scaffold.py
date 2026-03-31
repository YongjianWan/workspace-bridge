#!/usr/bin/env python3
"""
AI认知脚手架 - 项目初始化脚本

此脚本用于在项目中初始化AI脚手架所需的目录结构和配置文件。
"""

import os
import json
from pathlib import Path


def init_scaffold(project_root: str = ".") -> None:
    """初始化AI脚手架项目结构"""
    
    root = Path(project_root)
    
    # 创建目录结构
    dirs = [
        root / ".ai-scaffold",
        root / ".ai-scaffold" / "adr",
        root / ".ai-scaffold" / "cache",
    ]
    
    for dir_path in dirs:
        dir_path.mkdir(parents=True, exist_ok=True)
        print(f"✓ 创建目录: {dir_path}")
    
    # 创建符号地图模板
    symbol_map_path = root / ".ai-scaffold" / "symbol-map.json"
    if not symbol_map_path.exists():
        symbol_map_template = {
            "_meta": {
                "version": "1.0.0",
                "description": "符号地图 - 记录项目中所有符号的依赖关系",
                "last_updated": ""
            },
            "example_function": {
                "type": "function",
                "file_path": "src/example.py",
                "line_start": 1,
                "line_end": 10,
                "dependencies": [],
                "dependents": [],
                "exports": ["example_function"],
                "imports": []
            }
        }
        
        with open(symbol_map_path, 'w', encoding='utf-8') as f:
            json.dump(symbol_map_template, f, indent=2, ensure_ascii=False)
        print(f"✓ 创建符号地图模板: {symbol_map_path}")
    
    # 创建ADR模板
    adr_template_path = root / ".ai-scaffold" / "adr" / "000-template.md"
    if not adr_template_path.exists():
        adr_template = """# ADR-XXX: 标题

## 状态

- 提案中 / 已接受 / 已弃用 / 已取代

## 背景

描述决策的背景和动机。

## 决策

描述具体的决策内容。

## 后果

### 正面

- 正面影响1
- 正面影响2

### 负面

- 负面影响1
- 负面影响2

## 相关

- 相关ADR链接
- 相关文档链接
"""
        
        with open(adr_template_path, 'w', encoding='utf-8') as f:
            f.write(adr_template)
        print(f"✓ 创建ADR模板: {adr_template_path}")
    
    # 创建.gitignore
    gitignore_path = root / ".ai-scaffold" / ".gitignore"
    if not gitignore_path.exists():
        gitignore_content = """# AI脚手架缓存
cache/
*.zip
*.tmp

# 日志
*.log
"""
        
        with open(gitignore_path, 'w', encoding='utf-8') as f:
            f.write(gitignore_content)
        print(f"✓ 创建.gitignore: {gitignore_path}")
    
    # 创建README
    readme_path = root / ".ai-scaffold" / "README.md"
    if not readme_path.exists():
        readme_content = """# AI认知脚手架配置

此目录包含AI认知脚手架的配置和数据文件。

## 文件说明

- `symbol-map.json`: 符号地图，记录项目中所有符号的依赖关系
- `adr/`: 架构决策记录目录
- `cache/`: 缓存目录

## 使用说明

1. 维护 `symbol-map.json` 以反映最新的代码结构
2. 在 `adr/` 目录中添加架构决策记录
3. 运行 `ai-scaffold` 命令进行代码生成

## 符号地图更新

可以使用以下工具更新符号地图：
- 手动编辑
- 使用代码分析工具自动生成
- 使用IDE插件
"""
        
        with open(readme_path, 'w', encoding='utf-8') as f:
            f.write(readme_content)
        print(f"✓ 创建README: {readme_path}")
    
    print("\n" + "="*50)
    print("AI认知脚手架初始化完成!")
    print("="*50)
    print("\n下一步:")
    print("1. 编辑 .ai-scaffold/symbol-map.json 添加你的项目符号")
    print("2. 在 .ai-scaffold/adr/ 目录中添加架构决策记录")
    print("3. 运行: ai-scaffold generate -r '你的请求' -t '目标文件'")


if __name__ == "__main__":
    import sys
    
    project_root = sys.argv[1] if len(sys.argv) > 1 else "."
    init_scaffold(project_root)
