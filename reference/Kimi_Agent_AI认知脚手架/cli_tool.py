#!/usr/bin/env python3
"""
ai-scaffold: AI认知脚手架CLI工具

这是一个强制入口CLI工具，用于替代AI直接操作git，确保代码修改经过完整的
上下文注入、复用检查、影响分析和证明生成流程。

核心工作流:
1. 接收用户请求
2. 查询符号地图生成上下文包
3. 注入system prompt
4. 调用AI生成代码
5. 复用检查(Layer 2)
6. 影响分析(Layer 3)
7. 生成CHANGE_PROOF.md
8. 提交PR

作者: AI认知脚手架系统
版本: 1.0.0
"""

import os
import sys
import json
import hashlib
import subprocess
import tempfile
import zipfile
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any, Tuple, Set
from datetime import datetime
from enum import Enum
import logging
import re

import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.tree import Tree
from rich import box


# =============================================================================
# 常量定义
# =============================================================================

VERSION = "1.0.0"
DEFAULT_CONTEXT_DEPTH = 2
DEFAULT_RISK_THRESHOLD = "medium"
DEFAULT_PROOF_OUTPUT = "CHANGE_PROOF.md"
SYMBOL_MAP_FILE = ".ai-scaffold/symbol-map.json"
ADR_DIR = ".ai-scaffold/adr"
CONTEXT_CACHE_DIR = ".ai-scaffold/cache"

console = Console()


# =============================================================================
# 枚举类型
# =============================================================================

class RiskLevel(Enum):
    """风险等级枚举"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class ChangeType(Enum):
    """变更类型枚举"""
    CREATE = "create"
    MODIFY = "modify"
    DELETE = "delete"
    REFACTOR = "refactor"

class ValidationStatus(Enum):
    """验证状态枚举"""
    PASSED = "passed"
    WARNING = "warning"
    FAILED = "failed"
    PENDING = "pending"


# =============================================================================
# 数据类定义
# =============================================================================

@dataclass
class SymbolInfo:
    """符号信息数据类"""
    name: str
    type: str  # function, class, variable, etc.
    file_path: str
    line_start: int
    line_end: int
    dependencies: List[str] = field(default_factory=list)
    dependents: List[str] = field(default_factory=list)
    exports: List[str] = field(default_factory=list)
    imports: List[str] = field(default_factory=list)
    signature: Optional[str] = None
    parameters: List[str] = field(default_factory=list)
    return_type: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

@dataclass
class ContextPackage:
    """上下文包数据类"""
    request_id: str
    timestamp: str
    target_files: List[str]
    related_symbols: List[SymbolInfo]
    adr_references: List[Dict[str, Any]]
    test_cases: List[str]
    dependency_graph: Dict[str, List[str]]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "request_id": self.request_id,
            "timestamp": self.timestamp,
            "target_files": self.target_files,
            "related_symbols": [s.to_dict() for s in self.related_symbols],
            "adr_references": self.adr_references,
            "test_cases": self.test_cases,
            "dependency_graph": self.dependency_graph
        }

@dataclass
class ReuseCandidate:
    """复用候选数据类"""
    existing_symbol: str
    existing_file: str
    similarity_score: float
    suggestion: str

@dataclass
class ImpactAnalysis:
    """影响分析结果数据类"""
    affected_files: List[str]
    affected_symbols: List[str]
    breaking_changes: List[str]
    test_impact: List[str]
    risk_level: RiskLevel
    risk_description: str
    mitigation_suggestions: List[str]

@dataclass
class ValidationResult:
    """验证结果数据类"""
    status: ValidationStatus
    checks: Dict[str, Any]
    errors: List[str]
    warnings: List[str]

@dataclass
class ChangeProof:
    """变更证明数据类"""
    request_description: str
    context_package: ContextPackage
    generated_code: Dict[str, str]
    reuse_check: List[ReuseCandidate]
    impact_analysis: ImpactAnalysis
    validation_result: ValidationResult
    git_commit_hash: Optional[str] = None
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


# =============================================================================
# 日志配置
# =============================================================================

def setup_logging(verbose: bool = False, log_file: Optional[str] = None) -> logging.Logger:
    """配置日志系统"""
    logger = logging.getLogger("ai-scaffold")
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    
    # 清除现有处理器
    logger.handlers = []
    
    # 控制台处理器
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.DEBUG if verbose else logging.INFO)
    console_format = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%H:%M:%S'
    )
    console_handler.setFormatter(console_format)
    logger.addHandler(console_handler)
    
    # 文件处理器
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(logging.DEBUG)
        file_format = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s'
        )
        file_handler.setFormatter(file_format)
        logger.addHandler(file_handler)
    
    return logger


# =============================================================================
# 符号地图管理器
# =============================================================================

class SymbolMapManager:
    """符号地图管理器 - 负责查询和维护代码符号地图"""
    
    def __init__(self, project_root: str, logger: logging.Logger):
        self.project_root = Path(project_root)
        self.symbol_map_path = self.project_root / SYMBOL_MAP_FILE
        self.logger = logger
        self._symbol_cache: Dict[str, SymbolInfo] = {}
        
    def load_symbol_map(self) -> Dict[str, Any]:
        """加载符号地图"""
        if not self.symbol_map_path.exists():
            self.logger.warning(f"符号地图不存在: {self.symbol_map_path}")
            return {}
        
        try:
            with open(self.symbol_map_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            self.logger.error(f"加载符号地图失败: {e}")
            return {}
    
    def query_symbol(self, symbol_name: str) -> Optional[SymbolInfo]:
        """查询单个符号信息"""
        symbol_map = self.load_symbol_map()
        
        if symbol_name in symbol_map:
            data = symbol_map[symbol_name]
            return SymbolInfo(
                name=symbol_name,
                type=data.get("type", "unknown"),
                file_path=data.get("file_path", ""),
                line_start=data.get("line_start", 0),
                line_end=data.get("line_end", 0),
                dependencies=data.get("dependencies", []),
                dependents=data.get("dependents", []),
                exports=data.get("exports", []),
                imports=data.get("imports", []),
                signature=data.get("signature"),
                parameters=data.get("parameters", []),
                return_type=data.get("return_type")
            )
        return None
    
    def find_related_symbols(
        self, 
        target_files: List[str], 
        depth: int = 2
    ) -> List[SymbolInfo]:
        """查找与目标文件相关的符号（支持递归深度）"""
        self.logger.info(f"查找相关符号，深度={depth}, 目标文件={target_files}")
        
        symbol_map = self.load_symbol_map()
        related_symbols: Set[str] = set()
        result: List[SymbolInfo] = []
        
        # 第一层：直接相关的符号
        current_level = set()
        for symbol_name, data in symbol_map.items():
            if any(f in data.get("file_path", "") for f in target_files):
                current_level.add(symbol_name)
                related_symbols.add(symbol_name)
        
        # 递归查找依赖
        for _ in range(depth - 1):
            next_level = set()
            for symbol_name in current_level:
                data = symbol_map.get(symbol_name, {})
                # 添加依赖
                for dep in data.get("dependencies", []):
                    if dep not in related_symbols:
                        next_level.add(dep)
                        related_symbols.add(dep)
                # 添加被依赖
                for dep in data.get("dependents", []):
                    if dep not in related_symbols:
                        next_level.add(dep)
                        related_symbols.add(dep)
            current_level = next_level
        
        # 构建结果
        for symbol_name in related_symbols:
            symbol_info = self.query_symbol(symbol_name)
            if symbol_info:
                result.append(symbol_info)
        
        self.logger.info(f"找到 {len(result)} 个相关符号")
        return result
    
    def build_dependency_graph(self, symbols: List[SymbolInfo]) -> Dict[str, List[str]]:
        """构建依赖图"""
        graph = {}
        for symbol in symbols:
            graph[symbol.name] = symbol.dependencies + symbol.dependents
        return graph


# =============================================================================
# 上下文包生成器
# =============================================================================

class ContextPackageBuilder:
    """上下文包构建器 - 负责生成上下文包"""
    
    def __init__(self, project_root: str, logger: logging.Logger):
        self.project_root = Path(project_root)
        self.logger = logger
        self.symbol_manager = SymbolMapManager(project_root, logger)
        
    def build_context_package(
        self,
        target_files: List[str],
        context_depth: int = 2
    ) -> ContextPackage:
        """构建上下文包"""
        self.logger.info(f"开始构建上下文包，目标文件: {target_files}")
        
        request_id = self._generate_request_id()
        timestamp = datetime.now().isoformat()
        
        # 1. 查找相关符号
        related_symbols = self.symbol_manager.find_related_symbols(
            target_files, context_depth
        )
        
        # 2. 查找相关ADR
        adr_references = self._find_related_adrs(target_files)
        
        # 3. 查找测试用例
        test_cases = self._find_test_cases(target_files)
        
        # 4. 构建依赖图
        dependency_graph = self.symbol_manager.build_dependency_graph(related_symbols)
        
        package = ContextPackage(
            request_id=request_id,
            timestamp=timestamp,
            target_files=target_files,
            related_symbols=related_symbols,
            adr_references=adr_references,
            test_cases=test_cases,
            dependency_graph=dependency_graph
        )
        
        self.logger.info(f"上下文包构建完成: {request_id}")
        return package
    
    def export_context_package(
        self, 
        package: ContextPackage, 
        output_path: str
    ) -> str:
        """导出上下文包为zip文件"""
        self.logger.info(f"导出上下文包到: {output_path}")
        
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            
            # 写入元数据
            metadata_path = tmp_path / "metadata.json"
            with open(metadata_path, 'w', encoding='utf-8') as f:
                json.dump(package.to_dict(), f, indent=2, ensure_ascii=False)
            
            # 复制相关文件
            files_dir = tmp_path / "files"
            files_dir.mkdir()
            
            for symbol in package.related_symbols:
                src_path = self.project_root / symbol.file_path
                if src_path.exists():
                    dst_path = files_dir / symbol.file_path.replace('/', '_')
                    try:
                        with open(src_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                        with open(dst_path, 'w', encoding='utf-8') as f:
                            f.write(content)
                    except Exception as e:
                        self.logger.warning(f"复制文件失败 {src_path}: {e}")
            
            # 创建zip
            with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for file_path in tmp_path.rglob('*'):
                    if file_path.is_file():
                        arcname = str(file_path.relative_to(tmp_path))
                        zf.write(file_path, arcname)
        
        self.logger.info(f"上下文包导出完成: {output_path}")
        return output_path
    
    def generate_system_prompt(self, package: ContextPackage) -> str:
        """生成注入AI的system prompt"""
        prompt_parts = [
            "# AI认知脚手架 - 系统提示",
            "",
            "## 上下文信息",
            f"- 请求ID: {package.request_id}",
            f"- 时间戳: {package.timestamp}",
            "",
            "## 目标文件",
        ]
        
        for f in package.target_files:
            prompt_parts.append(f"- {f}")
        
        prompt_parts.extend([
            "",
            "## 相关符号",
        ])
        
        for symbol in package.related_symbols[:20]:  # 限制数量避免过长
            prompt_parts.append(f"- `{symbol.name}` ({symbol.type}) in {symbol.file_path}")
        
        if len(package.related_symbols) > 20:
            prompt_parts.append(f"- ... 还有 {len(package.related_symbols) - 20} 个符号")
        
        prompt_parts.extend([
            "",
            "## 架构决策记录(ADR)",
        ])
        
        for adr in package.adr_references:
            prompt_parts.append(f"- {adr.get('title', 'Unknown')}: {adr.get('summary', '')}")
        
        prompt_parts.extend([
            "",
            "## 依赖关系",
            "```",
        ])
        
        for symbol_name, deps in list(package.dependency_graph.items())[:10]:
            if deps:
                prompt_parts.append(f"{symbol_name} -> {', '.join(deps[:5])}")
        
        prompt_parts.extend([
            "```",
            "",
            "## 约束规则",
            "1. 禁止生成已存在的相似函数 - 先检查复用候选",
            "2. 修改文件前必须检查其被哪些文件导入",
            "3. 优先使用已存在的helper函数",
            "4. 所有修改必须通过影响分析",
            "",
            "## 输出格式",
            "请按以下格式输出代码:",
            "```",
            "### 文件: <filepath>",
            "```<language>",
            "<code>",
            "```",
            "```",
        ])
        
        return '\n'.join(prompt_parts)
    
    def _generate_request_id(self) -> str:
        """生成请求ID"""
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        random_suffix = hashlib.md5(
            os.urandom(16)
        ).hexdigest()[:8]
        return f"req-{timestamp}-{random_suffix}"
    
    def _find_related_adrs(self, target_files: List[str]) -> List[Dict[str, Any]]:
        """查找相关的ADR记录"""
        adr_dir = self.project_root / ADR_DIR
        if not adr_dir.exists():
            return []
        
        adrs = []
        for adr_file in adr_dir.glob("*.md"):
            try:
                with open(adr_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # 简单解析ADR
                title = self._extract_adr_title(content)
                summary = self._extract_adr_summary(content)
                
                # 检查是否与目标文件相关
                if any(f in content for f in target_files):
                    adrs.append({
                        "file": str(adr_file),
                        "title": title,
                        "summary": summary
                    })
            except Exception as e:
                self.logger.warning(f"读取ADR失败 {adr_file}: {e}")
        
        return adrs
    
    def _find_test_cases(self, target_files: List[str]) -> List[str]:
        """查找相关的测试用例"""
        test_patterns = [
            "test_*.py",
            "*_test.py",
            "*.test.js",
            "*.spec.js",
            "*.test.ts",
            "*.spec.ts",
        ]
        
        test_cases = []
        test_dirs = [
            self.project_root / "tests",
            self.project_root / "test",
            self.project_root / "__tests__",
        ]
        
        for test_dir in test_dirs:
            if test_dir.exists():
                for pattern in test_patterns:
                    for test_file in test_dir.rglob(pattern):
                        test_cases.append(str(test_file.relative_to(self.project_root)))
        
        return test_cases[:20]  # 限制数量
    
    def _extract_adr_title(self, content: str) -> str:
        """提取ADR标题"""
        match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
        return match.group(1) if match else "Unknown ADR"
    
    def _extract_adr_summary(self, content: str) -> str:
        """提取ADR摘要"""
        lines = content.split('\n')
        for i, line in enumerate(lines):
            if '## 决策' in line or '## Decision' in line:
                if i + 1 < len(lines):
                    return lines[i + 1].strip()[:100]
        return ""


# =============================================================================
# 复用检查器 (Layer 2)
# =============================================================================

class ReuseChecker:
    """复用检查器 - Layer 2: 防止重复代码生成"""
    
    def __init__(self, project_root: str, logger: logging.Logger):
        self.project_root = Path(project_root)
        self.logger = logger
        self.symbol_manager = SymbolMapManager(project_root, logger)
        
    def check_reuse(
        self,
        proposed_code: str,
        target_language: str,
        similarity_threshold: float = 0.7
    ) -> List[ReuseCandidate]:
        """检查代码复用可能性"""
        self.logger.info("开始复用检查")
        
        candidates = []
        symbol_map = self.symbol_manager.load_symbol_map()
        
        proposed_profile = self._build_code_profile(proposed_code, target_language)
        
        # 提取提议代码中的函数/类名
        proposed_symbols = self._extract_symbols(proposed_code, target_language)
        
        for symbol_name in proposed_symbols:
            # 检查是否已存在相似符号
            for existing_name, existing_data in symbol_map.items():
                similarity = self._calculate_similarity(
                    symbol_name,
                    existing_name,
                    proposed_profile,
                    existing_data
                )
                
                if similarity >= similarity_threshold:
                    candidate = ReuseCandidate(
                        existing_symbol=existing_name,
                        existing_file=existing_data.get("file_path", ""),
                        similarity_score=similarity,
                        suggestion=self._generate_reuse_suggestion(
                            symbol_name, existing_name, existing_data
                        )
                    )
                    candidates.append(candidate)
                    self.logger.info(
                        f"发现复用候选: {symbol_name} -> {existing_name} "
                        f"(相似度: {similarity:.2f})"
                    )
        
        # 按相似度排序
        candidates.sort(key=lambda x: x.similarity_score, reverse=True)
        
        self.logger.info(f"复用检查完成，发现 {len(candidates)} 个候选")
        return candidates
    
    def _extract_symbols(self, code: str, language: str) -> List[str]:
        """从代码中提取符号名"""
        symbols = []
        
        if language in ['python', 'py']:
            # Python: 函数和类定义
            func_pattern = r'^def\s+(\w+)\s*\('
            class_pattern = r'^class\s+(\w+)\s*[\(:]'
        elif language in ['javascript', 'js', 'typescript', 'ts']:
            # JS/TS: 函数和类定义
            func_pattern = r'(?:function|const|let|var)\s+(\w+)\s*[=:].*\{|\(\s*\)'
            class_pattern = r'class\s+(\w+)\s*\{'
        else:
            return symbols
        
        for pattern in [func_pattern, class_pattern]:
            matches = re.finditer(pattern, code, re.MULTILINE)
            for match in matches:
                symbols.append(match.group(1))
        
        return symbols
    
    def _calculate_similarity(
        self,
        proposed_name: str,
        existing_name: str,
        proposed_profile: Dict[str, Any],
        existing_data: Dict[str, Any]
    ) -> float:
        """计算综合相似度
        
        修复点:
        - 不再只靠名称编辑距离
        - 对 hook / storage / validator / formatter 这类模式加语义权重
        """
        from difflib import SequenceMatcher
        
        normalized_proposed = proposed_name.lower()
        normalized_existing = existing_name.lower()
        name_similarity = SequenceMatcher(None, normalized_proposed, normalized_existing).ratio()
        
        semantic_tags_existing = self._extract_semantic_tags(
            existing_name,
            existing_data.get("signature", ""),
            existing_data.get("file_path", ""),
            existing_data.get("imports", []),
            existing_data.get("dependencies", [])
        )
        semantic_tags_proposed = proposed_profile["semantic_tags"]
        
        shared_tags = semantic_tags_existing & semantic_tags_proposed
        semantic_similarity = 0.0
        if semantic_tags_existing or semantic_tags_proposed:
            semantic_similarity = len(shared_tags) / len(semantic_tags_existing | semantic_tags_proposed)
        
        hook_bonus = 0.0
        if proposed_profile["is_hook"] and normalized_existing.startswith("use"):
            hook_bonus += 0.15
            if "storage" in shared_tags:
                hook_bonus += 0.15
        
        signature_hint_bonus = 0.0
        existing_params = existing_data.get("parameters", [])
        if proposed_profile["parameter_count"] > 0 and existing_params:
            if abs(proposed_profile["parameter_count"] - len(existing_params)) <= 1:
                signature_hint_bonus += 0.1
        
        score = (
            0.45 * name_similarity +
            0.40 * semantic_similarity +
            hook_bonus +
            signature_hint_bonus
        )
        return min(score, 1.0)

    def _build_code_profile(self, code: str, language: str) -> Dict[str, Any]:
        """从提议代码中提取轻量语义画像"""
        symbols = self._extract_symbols(code, language)
        primary_name = symbols[0] if symbols else ""
        params = self._extract_parameter_list(code, language)
        semantic_tags = self._extract_semantic_tags(
            primary_name,
            code,
            "",
            [],
            []
        )
        return {
            "primary_name": primary_name,
            "parameter_count": len(params),
            "parameters": params,
            "semantic_tags": semantic_tags,
            "is_hook": primary_name.startswith("use"),
        }

    def _extract_parameter_list(self, code: str, language: str) -> List[str]:
        """提取函数参数名"""
        if language in ['python', 'py']:
            match = re.search(r'def\s+\w+\s*\(([^)]*)\)', code)
        else:
            match = (
                re.search(r'function\s+\w+\s*\(([^)]*)\)', code) or
                re.search(r'(?:const|let|var)\s+\w+\s*=\s*\(([^)]*)\)\s*=>', code)
            )
        if not match:
            return []
        return [part.strip().split(':')[0].split('=')[0].strip() for part in match.group(1).split(',') if part.strip()]

    def _extract_semantic_tags(
        self,
        symbol_name: str,
        text_blob: str,
        file_path: str,
        imports: List[str],
        dependencies: List[str]
    ) -> Set[str]:
        """提取语义标签，修复 hook / storage / validator 模式识别不足"""
        haystack = " ".join([
            symbol_name or "",
            text_blob or "",
            file_path or "",
            " ".join(imports or []),
            " ".join(dependencies or []),
        ]).lower()
        
        tag_patterns = {
            "hook": [r'\buse[A-Z_]\w*', r'\buse[A-Z]\w*', r'\bhook\b'],
            "storage": [r'localstorage', r'sessionstorage', r'\bstorage\b', r'\bcache\b', r'persist'],
            "validation": [r'\bvalidate', r'\bvalidator', r'\bschema\b', r'\brule'],
            "formatting": [r'\bformat', r'formatter', r'serialize', r'normalize'],
            "auth": [r'\bauth', r'\btoken', r'\bjwt', r'\blogin', r'\bpassword'],
            "api": [r'\bfetch', r'\brequest', r'\bapi\b', r'\bhttp', r'\bclient'],
            "middleware": [r'\bmiddleware\b', r'\bguard\b', r'\binterceptor\b'],
        }
        
        tags = set()
        for tag, patterns in tag_patterns.items():
            if any(re.search(pattern, haystack, re.IGNORECASE) for pattern in patterns):
                tags.add(tag)
        
        if symbol_name.startswith("use"):
            tags.add("hook")
        if "localstorage" in haystack or "sessionstorage" in haystack:
            tags.add("storage")
        
        return tags
    
    def _generate_reuse_suggestion(
        self,
        proposed: str,
        existing: str,
        existing_data: Dict[str, Any]
    ) -> str:
        """生成复用建议"""
        return (
            f"考虑复用现有的 `{existing}` (在 {existing_data.get('file_path')})。"
            f"如果功能不完全匹配，考虑扩展现有函数而不是创建新的。"
        )


# =============================================================================
# 影响分析器 (Layer 3)
# =============================================================================

class ImpactAnalyzer:
    """影响分析器 - Layer 3: 分析代码变更的影响范围"""
    
    def __init__(self, project_root: str, logger: logging.Logger):
        self.project_root = Path(project_root)
        self.logger = logger
        self.symbol_manager = SymbolMapManager(project_root, logger)
        
    def analyze_impact(
        self,
        modified_files: List[str],
        change_type: ChangeType,
        risk_threshold: RiskLevel = RiskLevel.MEDIUM
    ) -> ImpactAnalysis:
        """分析变更影响"""
        self.logger.info(f"开始影响分析: {change_type.value}")
        
        affected_files = set()
        affected_symbols = set()
        breaking_changes = []
        test_impact = []
        
        symbol_map = self.symbol_manager.load_symbol_map()
        
        for file_path in modified_files:
            # 查找文件中定义的符号
            file_symbols = self._get_symbols_in_file(file_path, symbol_map)
            current_signatures = self._extract_current_signatures(file_path)
            
            for symbol_name in file_symbols:
                symbol_info = self.symbol_manager.query_symbol(symbol_name)
                if not symbol_info:
                    continue
                
                affected_symbols.add(symbol_name)
                
                # 检查被依赖的符号（影响范围）
                for dependent in symbol_info.dependents:
                    affected_symbols.add(dependent)
                    dep_info = self.symbol_manager.query_symbol(dependent)
                    if dep_info:
                        affected_files.add(dep_info.file_path)
                        
                        # 检查是否为破坏性变更
                        if change_type in [ChangeType.DELETE, ChangeType.MODIFY]:
                            breaking_changes.append(
                                f"{symbol_name} 的变更可能影响 {dependent}"
                            )
                
                if change_type == ChangeType.MODIFY:
                    signature_change = self._detect_signature_change(
                        symbol_name,
                        symbol_info,
                        current_signatures.get(symbol_name)
                    )
                    if signature_change:
                        breaking_changes.append(signature_change)
                
                # 检查测试影响
                test_files = self._find_related_tests(file_path, symbol_name)
                test_impact.extend(test_files)
        
        # 确定风险等级
        risk_level = self._calculate_risk_level(
            len(affected_files),
            len(breaking_changes),
            len(test_impact),
            change_type
        )
        
        # 生成风险描述
        risk_description = self._generate_risk_description(
            risk_level,
            len(affected_files),
            len(breaking_changes),
            len(test_impact)
        )
        
        # 生成缓解建议
        mitigation_suggestions = self._generate_mitigation_suggestions(
            risk_level,
            breaking_changes,
            test_impact
        )
        
        analysis = ImpactAnalysis(
            affected_files=list(affected_files),
            affected_symbols=list(affected_symbols),
            breaking_changes=breaking_changes,
            test_impact=list(set(test_impact)),
            risk_level=risk_level,
            risk_description=risk_description,
            mitigation_suggestions=mitigation_suggestions
        )
        
        self.logger.info(f"影响分析完成，风险等级: {risk_level.value}")
        return analysis

    def _extract_current_signatures(self, file_path: str) -> Dict[str, Dict[str, Any]]:
        """从当前文件提取轻量签名信息"""
        full_path = self.project_root / file_path
        if not full_path.exists():
            return {}
        
        try:
            content = full_path.read_text(encoding='utf-8')
        except Exception:
            return {}
        
        signatures = {}
        
        python_pattern = re.compile(r'def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?:', re.MULTILINE)
        js_pattern = re.compile(
            r'(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|'
            r'(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>',
            re.MULTILINE
        )
        
        for match in python_pattern.finditer(content):
            name = match.group(1)
            params = [p.strip().split(':')[0].split('=')[0].strip() for p in match.group(2).split(',') if p.strip()]
            signatures[name] = {
                "signature": match.group(0).strip(),
                "parameter_count": len(params),
                "parameters": params,
                "return_type": match.group(3).strip() if match.group(3) else None,
            }
        
        for match in js_pattern.finditer(content):
            name = match.group(1) or match.group(3)
            raw_params = match.group(2) if match.group(1) else match.group(4)
            params = [p.strip().split(':')[0].split('=')[0].strip() for p in raw_params.split(',') if p.strip()]
            if not name:
                continue
            signatures[name] = {
                "signature": match.group(0).strip(),
                "parameter_count": len(params),
                "parameters": params,
                "return_type": None,
            }
        
        return signatures

    def _detect_signature_change(
        self,
        symbol_name: str,
        symbol_info: SymbolInfo,
        current_signature: Optional[Dict[str, Any]]
    ) -> Optional[str]:
        """检测函数签名变化
        
        修复点:
        - 捕捉参数数量变化
        - 捕捉签名文本变化
        - 为 RB-005 这类场景输出更明确的 breaking change 提示
        """
        if not current_signature:
            return None
        
        previous_params = symbol_info.parameters or []
        current_params = current_signature.get("parameters", [])
        previous_signature = (symbol_info.signature or "").strip()
        current_signature_text = (current_signature.get("signature") or "").strip()
        
        if previous_params and len(previous_params) != len(current_params):
            return (
                f"{symbol_name} 的参数数量从 {len(previous_params)} 变为 {len(current_params)}，"
                f"调用方可能需要同步更新"
            )
        
        if previous_signature and current_signature_text and previous_signature != current_signature_text:
            return f"{symbol_name} 的函数签名已变化，返回值或参数契约可能不兼容"
        
        previous_return = (symbol_info.return_type or "").strip()
        current_return = (current_signature.get("return_type") or "").strip()
        if previous_return and current_return and previous_return != current_return:
            return f"{symbol_name} 的返回类型从 {previous_return} 变为 {current_return}，调用方逻辑可能失效"
        
        return None
    
    def _get_symbols_in_file(
        self, 
        file_path: str, 
        symbol_map: Dict[str, Any]
    ) -> List[str]:
        """获取文件中定义的所有符号"""
        symbols = []
        for name, data in symbol_map.items():
            if data.get("file_path") == file_path:
                symbols.append(name)
        return symbols
    
    def _find_related_tests(self, file_path: str, symbol_name: str) -> List[str]:
        """查找相关的测试文件"""
        test_files = []
        
        # 简单的测试文件匹配逻辑
        test_dirs = [
            self.project_root / "tests",
            self.project_root / "test",
        ]
        
        for test_dir in test_dirs:
            if test_dir.exists():
                for test_file in test_dir.rglob("*"):
                    if test_file.is_file():
                        try:
                            with open(test_file, 'r', encoding='utf-8') as f:
                                content = f.read()
                            if symbol_name in content:
                                test_files.append(str(test_file.relative_to(self.project_root)))
                        except:
                            pass
        
        return test_files
    
    def _calculate_risk_level(
        self,
        affected_files_count: int,
        breaking_changes_count: int,
        test_impact_count: int,
        change_type: ChangeType
    ) -> RiskLevel:
        """计算风险等级"""
        score = 0
        
        # 基于影响文件数
        if affected_files_count > 10:
            score += 3
        elif affected_files_count > 5:
            score += 2
        elif affected_files_count > 0:
            score += 1
        
        # 基于破坏性变更
        score += breaking_changes_count * 2
        
        # 基于测试影响
        if test_impact_count > 5:
            score += 2
        elif test_impact_count > 0:
            score += 1
        
        # 基于变更类型
        if change_type == ChangeType.DELETE:
            score += 2
        elif change_type == ChangeType.MODIFY:
            score += 1
        
        # 确定等级
        if score >= 7:
            return RiskLevel.CRITICAL
        elif score >= 5:
            return RiskLevel.HIGH
        elif score >= 3:
            return RiskLevel.MEDIUM
        else:
            return RiskLevel.LOW
    
    def _generate_risk_description(
        self,
        risk_level: RiskLevel,
        affected_files: int,
        breaking_changes: int,
        test_impact: int
    ) -> str:
        """生成风险描述"""
        descriptions = {
            RiskLevel.LOW: "低风险变更，影响范围有限",
            RiskLevel.MEDIUM: "中等风险变更，需要仔细测试",
            RiskLevel.HIGH: "高风险变更，可能影响多个模块",
            RiskLevel.CRITICAL: "极高风险变更，需要全面回归测试"
        }
        
        base_desc = descriptions.get(risk_level, "未知风险")
        return (
            f"{base_desc}。影响 {affected_files} 个文件，"
            f"包含 {breaking_changes} 个潜在破坏性变更，"
            f"影响 {test_impact} 个测试文件。"
        )
    
    def _generate_mitigation_suggestions(
        self,
        risk_level: RiskLevel,
        breaking_changes: List[str],
        test_impact: List[str]
    ) -> List[str]:
        """生成缓解建议"""
        suggestions = []
        
        if risk_level in [RiskLevel.HIGH, RiskLevel.CRITICAL]:
            suggestions.append("建议分阶段发布，先在小范围验证")
            suggestions.append("需要完整的回归测试")
        
        if breaking_changes:
            suggestions.append("检查所有破坏性变更的影响范围")
            suggestions.append("考虑向后兼容性")
        
        if test_impact:
            suggestions.append(f"运行相关测试: {', '.join(test_impact[:3])}")
        
        suggestions.append("更新相关文档")
        
        return suggestions


# =============================================================================
# 验证器
# =============================================================================

class CodeValidator:
    """代码验证器 - 验证生成的代码"""
    
    def __init__(self, project_root: str, logger: logging.Logger):
        self.project_root = Path(project_root)
        self.logger = logger
        
    def validate(
        self,
        generated_code: Dict[str, str],
        language: str
    ) -> ValidationResult:
        """验证生成的代码"""
        self.logger.info("开始代码验证")
        
        checks = {}
        errors = []
        warnings = []
        
        for file_path, code in generated_code.items():
            file_checks = {}
            
            # 语法检查
            syntax_valid, syntax_error = self._check_syntax(code, language)
            file_checks['syntax'] = syntax_valid
            if not syntax_valid:
                errors.append(f"{file_path}: 语法错误 - {syntax_error}")
            
            # 导入检查
            imports_valid, import_errors = self._check_imports(code, language)
            file_checks['imports'] = imports_valid
            if not imports_valid:
                warnings.extend([f"{file_path}: {e}" for e in import_errors])
            
            # 风格检查
            style_valid, style_warnings = self._check_style(code, language)
            file_checks['style'] = style_valid
            warnings.extend([f"{file_path}: {w}" for w in style_warnings])
            
            checks[file_path] = file_checks
        
        # 确定状态
        if errors:
            status = ValidationStatus.FAILED
        elif warnings:
            status = ValidationStatus.WARNING
        else:
            status = ValidationStatus.PASSED
        
        result = ValidationResult(
            status=status,
            checks=checks,
            errors=errors,
            warnings=warnings
        )
        
        self.logger.info(f"验证完成: {status.value}")
        return result
    
    def _check_syntax(self, code: str, language: str) -> Tuple[bool, str]:
        """检查语法"""
        if language in ['python', 'py']:
            import ast
            try:
                ast.parse(code)
                return True, ""
            except SyntaxError as e:
                return False, str(e)
        elif language in ['javascript', 'js']:
            # 使用简单的括号匹配检查
            return self._basic_js_syntax_check(code)
        return True, ""
    
    def _basic_js_syntax_check(self, code: str) -> Tuple[bool, str]:
        """基本的JS语法检查"""
        open_braces = code.count('{')
        close_braces = code.count('}')
        open_parens = code.count('(')
        close_parens = code.count(')')
        
        if open_braces != close_braces:
            return False, f"括号不匹配: {{ {open_braces} vs }} {close_braces}"
        if open_parens != close_parens:
            return False, f"圆括号不匹配: ( {open_parens} vs ) {close_parens}"
        
        return True, ""
    
    def _check_imports(self, code: str, language: str) -> Tuple[bool, List[str]]:
        """检查导入"""
        errors = []
        
        if language in ['python', 'py']:
            # 提取导入语句
            import_pattern = r'^(?:from|import)\s+(\S+)'
            for match in re.finditer(import_pattern, code, re.MULTILINE):
                module = match.group(1).split('.')[0]
                # 检查模块是否存在（简化检查）
                if module not in ['os', 'sys', 'json', 're', 'typing', 'pathlib']:
                    # 这里应该检查项目内模块
                    pass
        
        return len(errors) == 0, errors
    
    def _check_style(self, code: str, language: str) -> Tuple[bool, List[str]]:
        """检查代码风格"""
        warnings = []
        
        # 检查行长度
        for i, line in enumerate(code.split('\n'), 1):
            if len(line) > 100:
                warnings.append(f"第{i}行超过100字符")
        
        # 检查函数长度
        if language in ['python', 'py']:
            func_pattern = r'^def\s+\w+\s*\([^)]*\):'
            func_starts = list(re.finditer(func_pattern, code, re.MULTILINE))
            if len(func_starts) > 10:
                warnings.append("文件包含过多函数，考虑拆分")
        
        return len(warnings) == 0, warnings


# =============================================================================
# CHANGE_PROOF.md 生成器
# =============================================================================

class ChangeProofGenerator:
    """变更证明生成器 - 生成CHANGE_PROOF.md文档"""
    
    def __init__(self, logger: logging.Logger):
        self.logger = logger
        
    def generate(
        self,
        proof: ChangeProof,
        output_path: str
    ) -> str:
        """生成CHANGE_PROOF.md文件"""
        self.logger.info(f"生成CHANGE_PROOF.md: {output_path}")
        
        content = self._generate_markdown(proof)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        self.logger.info(f"CHANGE_PROOF.md生成完成: {output_path}")
        return output_path
    
    def _generate_markdown(self, proof: ChangeProof) -> str:
        """生成Markdown内容"""
        lines = [
            "# AI认知脚手架 - 变更证明文档",
            "",
            f"> **请求ID**: {proof.context_package.request_id}",
            f"> **生成时间**: {proof.timestamp}",
            f"> **Git Commit**: {proof.git_commit_hash or 'N/A'}",
            "",
            "---",
            "",
            "## 1. 变更请求描述",
            "",
            proof.request_description,
            "",
            "---",
            "",
            "## 2. 上下文信息",
            "",
            "### 2.1 目标文件",
            "",
        ]
        
        for f in proof.context_package.target_files:
            lines.append(f"- `{f}`")
        
        lines.extend([
            "",
            "### 2.2 相关符号",
            "",
            "| 符号名 | 类型 | 文件路径 | 行号 |",
            "|--------|------|----------|------|",
        ])
        
        for symbol in proof.context_package.related_symbols[:20]:
            lines.append(
                f"| `{symbol.name}` | {symbol.type} | `{symbol.file_path}` | "
                f"{symbol.line_start}-{symbol.line_end} |"
            )
        
        lines.extend([
            "",
            "### 2.3 架构决策记录(ADR)",
            "",
        ])
        
        if proof.context_package.adr_references:
            for adr in proof.context_package.adr_references:
                lines.append(f"- **{adr.get('title', 'Unknown')}**: {adr.get('summary', '')}")
        else:
            lines.append("_无相关ADR_")
        
        lines.extend([
            "",
            "---",
            "",
            "## 3. 复用检查 (Layer 2)",
            "",
        ])
        
        if proof.reuse_check:
            lines.extend([
                "### 3.1 复用候选列表",
                "",
                "| 现有符号 | 文件路径 | 相似度 | 建议 |",
                "|----------|----------|--------|------|",
            ])
            
            for candidate in proof.reuse_check:
                lines.append(
                    f"| `{candidate.existing_symbol}` | `{candidate.existing_file}` | "
                    f"{candidate.similarity_score:.2%} | {candidate.suggestion} |"
                )
            
            lines.extend([
                "",
                "> **警告**: 发现复用候选，请考虑复用现有代码而不是创建新代码。",
            ])
        else:
            lines.append("_未发现复用候选_")
        
        lines.extend([
            "",
            "---",
            "",
            "## 4. 影响分析 (Layer 3)",
            "",
            f"### 4.1 风险等级: {proof.impact_analysis.risk_level.value.upper()}",
            "",
            f"**风险描述**: {proof.impact_analysis.risk_description}",
            "",
            "### 4.2 受影响文件",
            "",
        ])
        
        for f in proof.impact_analysis.affected_files:
            lines.append(f"- `{f}`")
        
        lines.extend([
            "",
            "### 4.3 受影响符号",
            "",
        ])
        
        for s in proof.impact_analysis.affected_symbols:
            lines.append(f"- `{s}`")
        
        lines.extend([
            "",
            "### 4.4 潜在破坏性变更",
            "",
        ])
        
        if proof.impact_analysis.breaking_changes:
            for change in proof.impact_analysis.breaking_changes:
                lines.append(f"- ⚠️ {change}")
        else:
            lines.append("_无破坏性变更_")
        
        lines.extend([
            "",
            "### 4.5 测试影响",
            "",
        ])
        
        if proof.impact_analysis.test_impact:
            for test in proof.impact_analysis.test_impact:
                lines.append(f"- `{test}`")
        else:
            lines.append("_无测试影响_")
        
        lines.extend([
            "",
            "### 4.6 缓解建议",
            "",
        ])
        
        for suggestion in proof.impact_analysis.mitigation_suggestions:
            lines.append(f"- {suggestion}")
        
        lines.extend([
            "",
            "---",
            "",
            "## 5. 验证结果",
            "",
            f"**状态**: {proof.validation_result.status.value.upper()}",
            "",
        ])
        
        if proof.validation_result.errors:
            lines.extend([
                "### 5.1 错误",
                "",
            ])
            for error in proof.validation_result.errors:
                lines.append(f"- ❌ {error}")
            lines.append("")
        
        if proof.validation_result.warnings:
            lines.extend([
                "### 5.2 警告",
                "",
            ])
            for warning in proof.validation_result.warnings:
                lines.append(f"- ⚠️ {warning}")
            lines.append("")
        
        lines.extend([
            "---",
            "",
            "## 6. 生成的代码",
            "",
            "<details>",
            "<summary>点击查看生成的代码</summary>",
            "",
        ])
        
        for file_path, code in proof.generated_code.items():
            ext = file_path.split('.')[-1] if '.' in file_path else ''
            lines.extend([
                f"### {file_path}",
                "",
                f"```{ext}",
                code,
                "```",
                "",
            ])
        
        lines.extend([
            "</details>",
            "",
            "---",
            "",
            "## 7. 审批记录",
            "",
            "| 检查项 | 状态 | 检查人 | 时间 |",
            "|--------|------|--------|------|",
            "| 复用检查 | ⬜ | | |",
            "| 影响分析 | ⬜ | | |",
            "| 代码验证 | ⬜ | | |",
            "| 测试通过 | ⬜ | | |",
            "| 文档更新 | ⬜ | | |",
            "",
            "---",
            "",
            "*此文档由AI认知脚手架系统自动生成*",
        ])
        
        return '\n'.join(lines)


# =============================================================================
# Git集成管理器
# =============================================================================

class GitIntegration:
    """Git集成管理器 - 替代AI直接操作git"""
    
    def __init__(self, project_root: str, logger: logging.Logger):
        self.project_root = Path(project_root)
        self.logger = logger
        
    def _run_git_command(self, args: List[str]) -> Tuple[bool, str, str]:
        """运行git命令"""
        try:
            result = subprocess.run(
                ['git'] + args,
                cwd=self.project_root,
                capture_output=True,
                text=True,
                check=False
            )
            return result.returncode == 0, result.stdout, result.stderr
        except Exception as e:
            return False, "", str(e)
    
    def is_git_repo(self) -> bool:
        """检查是否为git仓库"""
        success, _, _ = self._run_git_command(['rev-parse', '--git-dir'])
        return success
    
    def get_current_branch(self) -> Optional[str]:
        """获取当前分支"""
        success, stdout, _ = self._run_git_command(['branch', '--show-current'])
        if success:
            return stdout.strip()
        return None
    
    def create_branch(self, branch_name: str, base_branch: str = "main") -> bool:
        """创建新分支"""
        self.logger.info(f"创建分支: {branch_name} (基于 {base_branch})")
        
        # 先切换到基础分支
        success, _, stderr = self._run_git_command(['checkout', base_branch])
        if not success:
            self.logger.error(f"切换分支失败: {stderr}")
            return False
        
        # 拉取最新代码
        success, _, stderr = self._run_git_command(['pull', 'origin', base_branch])
        if not success:
            self.logger.warning(f"拉取代码失败: {stderr}")
        
        # 创建新分支
        success, _, stderr = self._run_git_command(['checkout', '-b', branch_name])
        if not success:
            self.logger.error(f"创建分支失败: {stderr}")
            return False
        
        self.logger.info(f"分支创建成功: {branch_name}")
        return True
    
    def stage_files(self, files: List[str]) -> bool:
        """暂存文件"""
        self.logger.info(f"暂存文件: {files}")
        
        for file_path in files:
            full_path = self.project_root / file_path
            if full_path.exists():
                success, _, stderr = self._run_git_command(['add', file_path])
                if not success:
                    self.logger.error(f"暂存文件失败 {file_path}: {stderr}")
                    return False
            else:
                self.logger.warning(f"文件不存在: {file_path}")
        
        return True
    
    def commit(self, message: str, files: Optional[List[str]] = None) -> Optional[str]:
        """提交变更"""
        self.logger.info(f"提交变更: {message[:50]}...")
        
        # 暂存文件
        if files:
            if not self.stage_files(files):
                return None
        
        # 提交
        success, stdout, stderr = self._run_git_command(['commit', '-m', message])
        if not success:
            self.logger.error(f"提交失败: {stderr}")
            return None
        
        # 获取commit hash
        success, stdout, _ = self._run_git_command(['rev-parse', 'HEAD'])
        if success:
            commit_hash = stdout.strip()
            self.logger.info(f"提交成功: {commit_hash[:8]}")
            return commit_hash
        
        return None
    
    def push(self, branch_name: Optional[str] = None) -> bool:
        """推送到远程"""
        if not branch_name:
            branch_name = self.get_current_branch()
        
        if not branch_name:
            self.logger.error("无法确定分支名")
            return False
        
        self.logger.info(f"推送到远程: {branch_name}")
        
        success, _, stderr = self._run_git_command(['push', 'origin', branch_name])
        if not success:
            self.logger.error(f"推送失败: {stderr}")
            return False
        
        self.logger.info("推送成功")
        return True
    
    def create_pr(
        self,
        title: str,
        body: str,
        base_branch: str = "main"
    ) -> Optional[str]:
        """创建Pull Request"""
        self.logger.info(f"创建PR: {title}")
        
        # 检查是否有gh CLI
        try:
            result = subprocess.run(
                ['gh', 'pr', 'create', '--title', title, '--body', body, '--base', base_branch],
                cwd=self.project_root,
                capture_output=True,
                text=True,
                check=False
            )
            
            if result.returncode == 0:
                # 提取PR URL
                pr_url = result.stdout.strip()
                self.logger.info(f"PR创建成功: {pr_url}")
                return pr_url
            else:
                self.logger.error(f"创建PR失败: {result.stderr}")
                return None
        except FileNotFoundError:
            self.logger.error("未找到gh CLI，请安装GitHub CLI")
            return None
    
    def get_diff(self) -> str:
        """获取当前变更的diff"""
        success, stdout, _ = self._run_git_command(['diff', '--cached'])
        if success:
            return stdout
        return ""
    
    def get_status(self) -> Dict[str, List[str]]:
        """获取git状态"""
        status = {
            'staged': [],
            'unstaged': [],
            'untracked': []
        }
        
        success, stdout, _ = self._run_git_command(['status', '--porcelain'])
        if not success:
            return status
        
        for line in stdout.strip().split('\n'):
            if not line:
                continue
            
            status_code = line[:2]
            file_path = line[3:].strip()
            
            if status_code[0] in 'MADRC':
                status['staged'].append(file_path)
            if status_code[1] in 'MD':
                status['unstaged'].append(file_path)
            if status_code == '??':
                status['untracked'].append(file_path)
        
        return status


# =============================================================================
# AI代码生成器 (模拟)
# =============================================================================

class AICodeGenerator:
    """AI代码生成器 - 模拟AI生成代码的过程"""
    
    def __init__(self, logger: logging.Logger):
        self.logger = logger
        
    def generate(
        self,
        request: str,
        system_prompt: str,
        target_files: List[str]
    ) -> Dict[str, str]:
        """生成代码（模拟）"""
        self.logger.info("调用AI生成代码")
        
        # 这里应该调用实际的AI API
        # 目前返回模拟结果
        generated = {}
        
        for file_path in target_files:
            ext = file_path.split('.')[-1] if '.' in file_path else 'txt'
            
            if ext in ['py', 'python']:
                generated[file_path] = self._generate_python_stub(file_path, request)
            elif ext in ['js', 'javascript']:
                generated[file_path] = self._generate_js_stub(file_path, request)
            elif ext in ['ts', 'typescript']:
                generated[file_path] = self._generate_ts_stub(file_path, request)
            else:
                generated[file_path] = f"# TODO: Implement {request}\n"
        
        self.logger.info(f"生成完成: {len(generated)} 个文件")
        return generated
    
    def _generate_python_stub(self, file_path: str, request: str) -> str:
        """生成Python代码存根"""
        module_name = file_path.replace('/', '_').replace('.py', '')
        return f'''"""
{module_name} - {request}

Auto-generated by AI Scaffold
"""

from typing import Any, Optional, List, Dict
import logging

logger = logging.getLogger(__name__)


def main():
    """主函数"""
    # TODO: Implement based on request: {request}
    pass


if __name__ == "__main__":
    main()
'''
    
    def _generate_js_stub(self, file_path: str, request: str) -> str:
        """生成JS代码存根"""
        return f'''/**
 * {file_path} - {request}
 * 
 * Auto-generated by AI Scaffold
 */

const logger = console;

/**
 * Main function
 */
function main() {{
    // TODO: Implement based on request: {request}
}}

module.exports = {{ main }};
'''
    
    def _generate_ts_stub(self, file_path: str, request: str) -> str:
        """生成TS代码存根"""
        return f'''/**
 * {file_path} - {request}
 * 
 * Auto-generated by AI Scaffold
 */

interface Config {{
    // TODO: Define configuration
}}

const logger = console;

/**
 * Main function
 */
function main(): void {{
    // TODO: Implement based on request: {request}
}}

export {{ main, Config }};
'''


# =============================================================================
# 主CLI命令
# =============================================================================

@click.group()
@click.version_option(version=VERSION, prog_name="ai-scaffold")
@click.option('--verbose', '-v', is_flag=True, help='启用详细日志')
@click.option('--log-file', type=click.Path(), help='日志文件路径')
@click.pass_context
def cli(ctx, verbose, log_file):
    """
    AI认知脚手架CLI工具
    
    强制入口CLI工具，确保AI代码修改经过完整的上下文注入、复用检查、
    影响分析和证明生成流程。
    
    示例:
        ai-scaffold generate --request "添加用户认证功能" --target src/auth.py
        ai-scaffold validate --file src/new_feature.py
        ai-scaffold impact --file src/core.py --change-type modify
    """
    ctx.ensure_object(dict)
    ctx.obj['verbose'] = verbose
    ctx.obj['log_file'] = log_file
    ctx.obj['logger'] = setup_logging(verbose, log_file)


@cli.command()
@click.option(
    '--request', '-r',
    required=True,
    help='用户请求描述'
)
@click.option(
    '--target', '-t',
    multiple=True,
    required=True,
    help='目标文件路径（可多次指定）'
)
@click.option(
    '--context-depth', '-d',
    default=DEFAULT_CONTEXT_DEPTH,
    type=int,
    help=f'上下文依赖层级深度 (默认: {DEFAULT_CONTEXT_DEPTH})'
)
@click.option(
    '--risk-threshold',
    default=DEFAULT_RISK_THRESHOLD,
    type=click.Choice(['low', 'medium', 'high', 'critical']),
    help=f'风险阈值 (默认: {DEFAULT_RISK_THRESHOLD})'
)
@click.option(
    '--language', '-l',
    default='python',
    type=click.Choice(['python', 'javascript', 'typescript']),
    help='目标编程语言 (默认: python)'
)
@click.option(
    '--proof-output', '-o',
    default=DEFAULT_PROOF_OUTPUT,
    help=f'CHANGE_PROOF.md输出路径 (默认: {DEFAULT_PROOF_OUTPUT})'
)
@click.option(
    '--branch-prefix',
    default='ai-scaffold',
    help='分支名前缀 (默认: ai-scaffold)'
)
@click.option(
    '--skip-git',
    is_flag=True,
    help='跳过git操作'
)
@click.option(
    '--dry-run',
    is_flag=True,
    help='试运行模式，不实际生成文件'
)
@click.pass_context
def generate(
    ctx,
    request,
    target,
    context_depth,
    risk_threshold,
    language,
    proof_output,
    branch_prefix,
    skip_git,
    dry_run
):
    """
    生成代码并执行完整的工作流
    
    这是主要的代码生成命令，会执行完整的上下文注入、复用检查、
    影响分析和证明生成流程。
    
    示例:
        ai-scaffold generate -r "添加用户认证" -t src/auth.py -t src/models.py
    """
    logger = ctx.obj['logger']
    project_root = os.getcwd()
    
    console.print(Panel.fit(
        f"[bold blue]AI认知脚手架 - 代码生成[/bold blue]\n"
        f"请求: {request}\n"
        f"目标: {', '.join(target)}\n"
        f"语言: {language}",
        title=f"v{VERSION}"
    ))
    
    # 初始化组件
    context_builder = ContextPackageBuilder(project_root, logger)
    reuse_checker = ReuseChecker(project_root, logger)
    impact_analyzer = ImpactAnalyzer(project_root, logger)
    code_validator = CodeValidator(project_root, logger)
    proof_generator = ChangeProofGenerator(logger)
    ai_generator = AICodeGenerator(logger)
    
    if not skip_git:
        git = GitIntegration(project_root, logger)
        if not git.is_git_repo():
            console.print("[red]错误: 当前目录不是git仓库[/red]")
            sys.exit(1)
    
    # 步骤1: 构建上下文包
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console
    ) as progress:
        task = progress.add_task("构建上下文包...", total=None)
        
        target_files = list(target)
        context_package = context_builder.build_context_package(
            target_files, context_depth
        )
        
        # 生成system prompt
        system_prompt = context_builder.generate_system_prompt(context_package)
        
        progress.update(task, completed=True)
    
    console.print(f"[green]✓[/green] 上下文包构建完成: {context_package.request_id}")
    
    # 步骤2: 调用AI生成代码
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console
    ) as progress:
        task = progress.add_task("AI生成代码...", total=None)
        
        generated_code = ai_generator.generate(
            request, system_prompt, target_files
        )
        
        progress.update(task, completed=True)
    
    console.print(f"[green]✓[/green] 代码生成完成: {len(generated_code)} 个文件")
    
    # 步骤3: 复用检查 (Layer 2)
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console
    ) as progress:
        task = progress.add_task("执行复用检查...", total=None)
        
        all_code = '\n'.join(generated_code.values())
        reuse_candidates = reuse_checker.check_reuse(all_code, language)
        
        progress.update(task, completed=True)
    
    if reuse_candidates:
        console.print(f"[yellow]⚠[/yellow] 发现 {len(reuse_candidates)} 个复用候选")
        for candidate in reuse_candidates[:3]:
            console.print(f"  - {candidate.existing_symbol} (相似度: {candidate.similarity_score:.2%})")
    else:
        console.print("[green]✓[/green] 未发现复用候选")
    
    # 步骤4: 影响分析 (Layer 3)
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console
    ) as progress:
        task = progress.add_task("执行影响分析...", total=None)
        
        change_type = ChangeType.MODIFY  # 默认为修改
        impact_analysis = impact_analyzer.analyze_impact(
            target_files, change_type, RiskLevel(risk_threshold)
        )
        
        progress.update(task, completed=True)
    
    console.print(f"[green]✓[/green] 影响分析完成")
    console.print(f"  - 风险等级: [bold]{impact_analysis.risk_level.value.upper()}[/bold]")
    console.print(f"  - 受影响文件: {len(impact_analysis.affected_files)} 个")
    console.print(f"  - 破坏性变更: {len(impact_analysis.breaking_changes)} 个")
    
    # 检查风险阈值
    risk_levels = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL]
    current_risk_index = risk_levels.index(impact_analysis.risk_level)
    threshold_index = risk_levels.index(RiskLevel(risk_threshold))
    
    if current_risk_index > threshold_index:
        console.print(f"[red]错误: 风险等级 {impact_analysis.risk_level.value} 超过阈值 {risk_threshold}[/red]")
        console.print("[yellow]建议: 降低变更范围或提高风险阈值[/yellow]")
        
        if not click.confirm("是否继续?"):
            sys.exit(1)
    
    # 步骤5: 代码验证
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console
    ) as progress:
        task = progress.add_task("验证代码...", total=None)
        
        validation_result = code_validator.validate(generated_code, language)
        
        progress.update(task, completed=True)
    
    if validation_result.status == ValidationStatus.FAILED:
        console.print(f"[red]✗[/red] 代码验证失败")
        for error in validation_result.errors:
            console.print(f"  - {error}")
        sys.exit(1)
    elif validation_result.status == ValidationStatus.WARNING:
        console.print(f"[yellow]⚠[/yellow] 代码验证通过，但有警告")
        for warning in validation_result.warnings[:5]:
            console.print(f"  - {warning}")
    else:
        console.print("[green]✓[/green] 代码验证通过")
    
    # 步骤6: 生成CHANGE_PROOF.md
    change_proof = ChangeProof(
        request_description=request,
        context_package=context_package,
        generated_code=generated_code,
        reuse_check=reuse_candidates,
        impact_analysis=impact_analysis,
        validation_result=validation_result
    )
    
    proof_path = proof_generator.generate(change_proof, proof_output)
    console.print(f"[green]✓[/green] CHANGE_PROOF.md生成完成: {proof_path}")
    
    # 步骤7: Git操作
    if not skip_git and not dry_run:
        git = GitIntegration(project_root, logger)
        
        # 创建分支
        branch_name = f"{branch_prefix}/{context_package.request_id}"
        if not git.create_branch(branch_name):
            console.print("[red]错误: 创建分支失败[/red]")
            sys.exit(1)
        
        console.print(f"[green]✓[/green] 创建分支: {branch_name}")
        
        # 写入生成的文件
        for file_path, code in generated_code.items():
            full_path = Path(project_root) / file_path
            full_path.parent.mkdir(parents=True, exist_ok=True)
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(code)
        
        # 提交CHANGE_PROOF.md
        all_files = list(generated_code.keys()) + [proof_output]
        
        commit_message = f"""[AI-Scaffold] {request[:50]}

Request ID: {context_package.request_id}
Risk Level: {impact_analysis.risk_level.value}
Affected Files: {len(impact_analysis.affected_files)}

Auto-generated by AI Scaffold v{VERSION}
"""
        
        commit_hash = git.commit(commit_message, all_files)
        if not commit_hash:
            console.print("[red]错误: 提交失败[/red]")
            sys.exit(1)
        
        console.print(f"[green]✓[/green] 提交成功: {commit_hash[:8]}")
        
        # 推送
        if git.push(branch_name):
            console.print(f"[green]✓[/green] 推送成功")
        
        # 更新proof中的commit hash
        change_proof.git_commit_hash = commit_hash
        proof_generator.generate(change_proof, proof_output)
        git.commit("[AI-Scaffold] Update CHANGE_PROOF.md with commit hash", [proof_output])
    
    # 完成
    console.print(Panel.fit(
        f"[bold green]✓ 代码生成完成[/bold green]\n\n"
        f"请求ID: {context_package.request_id}\n"
        f"风险等级: {impact_analysis.risk_level.value.upper()}\n"
        f"生成文件: {len(generated_code)} 个\n"
        f"证明文档: {proof_output}",
        title="完成"
    ))


@cli.command()
@click.option(
    '--file', '-f',
    multiple=True,
    required=True,
    help='要分析的文件路径'
)
@click.option(
    '--change-type',
    default='modify',
    type=click.Choice(['create', 'modify', 'delete', 'refactor']),
    help='变更类型 (默认: modify)'
)
@click.option(
    '--depth', '-d',
    default=2,
    type=int,
    help='依赖分析深度 (默认: 2)'
)
@click.pass_context
def impact(ctx, file, change_type, depth):
    """
    分析文件变更的影响范围
    
    示例:
        ai-scaffold impact -f src/core.py --change-type modify
    """
    logger = ctx.obj['logger']
    project_root = os.getcwd()
    
    console.print(Panel.fit(
        f"[bold blue]影响分析[/bold blue]\n"
        f"文件: {', '.join(file)}\n"
        f"变更类型: {change_type}",
        title="Layer 3"
    ))
    
    # 初始化组件
    context_builder = ContextPackageBuilder(project_root, logger)
    impact_analyzer = ImpactAnalyzer(project_root, logger)
    
    # 构建上下文
    target_files = list(file)
    context_package = context_builder.build_context_package(target_files, depth)
    
    # 执行影响分析
    analysis = impact_analyzer.analyze_impact(
        target_files,
        ChangeType(change_type),
        RiskLevel.MEDIUM
    )
    
    # 显示结果
    console.print("\n[bold]分析结果:[/bold]")
    
    # 风险等级
    risk_color = {
        RiskLevel.LOW: 'green',
        RiskLevel.MEDIUM: 'yellow',
        RiskLevel.HIGH: 'red',
        RiskLevel.CRITICAL: 'red'
    }
    console.print(f"风险等级: [{risk_color[analysis.risk_level]}]{analysis.risk_level.value.upper()}[/{risk_color[analysis.risk_level]}]")
    
    # 受影响文件
    console.print(f"\n[bold]受影响文件 ({len(analysis.affected_files)}):[/bold]")
    tree = Tree("📁 项目")
    for f in analysis.affected_files[:20]:
        tree.add(f"📄 {f}")
    if len(analysis.affected_files) > 20:
        tree.add(f"... 还有 {len(analysis.affected_files) - 20} 个文件")
    console.print(tree)
    
    # 破坏性变更
    if analysis.breaking_changes:
        console.print(f"\n[bold red]破坏性变更 ({len(analysis.breaking_changes)}):[/bold red]")
        for change in analysis.breaking_changes[:10]:
            console.print(f"  ⚠️ {change}")
    
    # 缓解建议
    console.print(f"\n[bold]缓解建议:[/bold]")
    for suggestion in analysis.mitigation_suggestions:
        console.print(f"  💡 {suggestion}")


@cli.command()
@click.option(
    '--file', '-f',
    multiple=True,
    required=True,
    help='要验证的文件路径'
)
@click.option(
    '--language', '-l',
    default='python',
    type=click.Choice(['python', 'javascript', 'typescript']),
    help='编程语言'
)
@click.pass_context
def validate(ctx, file, language):
    """
    验证代码文件
    
    示例:
        ai-scaffold validate -f src/new_feature.py
    """
    logger = ctx.obj['logger']
    project_root = os.getcwd()
    
    console.print(Panel.fit(
        f"[bold blue]代码验证[/bold blue]\n"
        f"文件: {', '.join(file)}",
        title="验证"
    ))
    
    # 读取文件
    code_files = {}
    for f in file:
        file_path = Path(project_root) / f
        if file_path.exists():
            with open(file_path, 'r', encoding='utf-8') as fp:
                code_files[f] = fp.read()
        else:
            console.print(f"[red]文件不存在: {f}[/red]")
    
    if not code_files:
        console.print("[red]没有可验证的文件[/red]")
        sys.exit(1)
    
    # 执行验证
    validator = CodeValidator(project_root, logger)
    result = validator.validate(code_files, language)
    
    # 显示结果
    status_colors = {
        ValidationStatus.PASSED: 'green',
        ValidationStatus.WARNING: 'yellow',
        ValidationStatus.FAILED: 'red'
    }
    
    console.print(f"\n验证状态: [{status_colors[result.status]}]{result.status.value.upper()}[/{status_colors[result.status]}]")
    
    if result.errors:
        console.print("\n[bold red]错误:[/bold red]")
        for error in result.errors:
            console.print(f"  ❌ {error}")
    
    if result.warnings:
        console.print("\n[bold yellow]警告:[/bold yellow]")
        for warning in result.warnings[:10]:
            console.print(f"  ⚠️ {warning}")
    
    if result.status == ValidationStatus.FAILED:
        sys.exit(1)


@cli.command()
@click.option(
    '--file', '-f',
    required=True,
    help='代码文件路径'
)
@click.option(
    '--language', '-l',
    default='python',
    type=click.Choice(['python', 'javascript', 'typescript']),
    help='编程语言'
)
@click.option(
    '--threshold',
    default=0.7,
    type=float,
    help='相似度阈值 (默认: 0.7)'
)
@click.pass_context
def reuse(ctx, file, language, threshold):
    """
    检查代码复用可能性
    
    示例:
        ai-scaffold reuse -f src/new_feature.py
    """
    logger = ctx.obj['logger']
    project_root = os.getcwd()
    
    console.print(Panel.fit(
        f"[bold blue]复用检查[/bold blue]\n"
        f"文件: {file}",
        title="Layer 2"
    ))
    
    # 读取文件
    file_path = Path(project_root) / file
    if not file_path.exists():
        console.print(f"[red]文件不存在: {file}[/red]")
        sys.exit(1)
    
    with open(file_path, 'r', encoding='utf-8') as f:
        code = f.read()
    
    # 执行复用检查
    checker = ReuseChecker(project_root, logger)
    candidates = checker.check_reuse(code, language, threshold)
    
    # 显示结果
    if candidates:
        console.print(f"\n[bold]发现 {len(candidates)} 个复用候选:[/bold]")
        
        table = Table(show_header=True, box=box.ROUNDED)
        table.add_column("现有符号", style="cyan")
        table.add_column("文件路径", style="green")
        table.add_column("相似度", style="magenta")
        table.add_column("建议", style="yellow")
        
        for candidate in candidates:
            similarity_str = f"{candidate.similarity_score:.2%}"
            table.add_row(
                candidate.existing_symbol,
                candidate.existing_file,
                similarity_str,
                candidate.suggestion
            )
        
        console.print(table)
    else:
        console.print("\n[green]✓[/green] 未发现复用候选")


@cli.command()
@click.option(
    '--target', '-t',
    multiple=True,
    required=True,
    help='目标文件路径'
)
@click.option(
    '--depth', '-d',
    default=2,
    type=int,
    help='依赖层级深度 (默认: 2)'
)
@click.option(
    '--output', '-o',
    help='输出zip文件路径'
)
@click.pass_context
def context(ctx, target, depth, output):
    """
    生成上下文包
    
    示例:
        ai-scaffold context -t src/auth.py -t src/models.py -o context.zip
    """
    logger = ctx.obj['logger']
    project_root = os.getcwd()
    
    console.print(Panel.fit(
        f"[bold blue]上下文包生成[/bold blue]\n"
        f"目标: {', '.join(target)}\n"
        f"深度: {depth}",
        title="Layer 1"
    ))
    
    # 构建上下文包
    builder = ContextPackageBuilder(project_root, logger)
    target_files = list(target)
    package = builder.build_context_package(target_files, depth)
    
    # 显示信息
    console.print(f"\n[bold]上下文包信息:[/bold]")
    console.print(f"  请求ID: {package.request_id}")
    console.print(f"  相关符号: {len(package.related_symbols)} 个")
    console.print(f"  ADR引用: {len(package.adr_references)} 个")
    console.print(f"  测试用例: {len(package.test_cases)} 个")
    
    # 显示依赖图
    console.print(f"\n[bold]依赖图:[/bold]")
    tree = Tree("📊 依赖关系")
    for symbol_name, deps in list(package.dependency_graph.items())[:10]:
        if deps:
            node = tree.add(f"🔗 {symbol_name}")
            for dep in deps[:5]:
                node.add(f"→ {dep}")
    console.print(tree)
    
    # 导出或显示system prompt
    if output:
        builder.export_context_package(package, output)
        console.print(f"\n[green]✓[/green] 上下文包已导出: {output}")
    else:
        # 显示system prompt
        system_prompt = builder.generate_system_prompt(package)
        console.print(f"\n[bold]System Prompt:[/bold]")
        console.print(Panel(system_prompt[:2000] + "..." if len(system_prompt) > 2000 else system_prompt))


@cli.command()
@click.pass_context
def status(ctx):
    """
    显示当前项目状态
    """
    logger = ctx.obj['logger']
    project_root = os.getcwd()
    
    console.print(Panel.fit(
        "[bold blue]项目状态[/bold blue]",
        title="AI Scaffold"
    ))
    
    # Git状态
    git = GitIntegration(project_root, logger)
    if git.is_git_repo():
        current_branch = git.get_current_branch()
        git_status = git.get_status()
        
        console.print(f"\n[bold]Git状态:[/bold]")
        console.print(f"  当前分支: {current_branch}")
        console.print(f"  已暂存: {len(git_status['staged'])} 个文件")
        console.print(f"  未暂存: {len(git_status['unstaged'])} 个文件")
        console.print(f"  未跟踪: {len(git_status['untracked'])} 个文件")
    else:
        console.print("\n[yellow]⚠ 不是git仓库[/yellow]")
    
    # 符号地图状态
    symbol_map_path = Path(project_root) / SYMBOL_MAP_FILE
    if symbol_map_path.exists():
        try:
            with open(symbol_map_path, 'r') as f:
                symbol_map = json.load(f)
            console.print(f"\n[bold]符号地图:[/bold]")
            console.print(f"  符号数量: {len(symbol_map)}")
            console.print(f"  最后更新: {datetime.fromtimestamp(symbol_map_path.stat().st_mtime).strftime('%Y-%m-%d %H:%M:%S')}")
        except:
            console.print("\n[yellow]⚠ 符号地图读取失败[/yellow]")
    else:
        console.print(f"\n[yellow]⚠ 符号地图不存在: {SYMBOL_MAP_FILE}[/yellow]")
    
    # ADR状态
    adr_dir = Path(project_root) / ADR_DIR
    if adr_dir.exists():
        adr_count = len(list(adr_dir.glob("*.md")))
        console.print(f"\n[bold]架构决策记录:[/bold]")
        console.print(f"  ADR数量: {adr_count}")
    else:
        console.print(f"\n[yellow]⚠ ADR目录不存在: {ADR_DIR}[/yellow]")


# =============================================================================
# 入口点
# =============================================================================

def main():
    """CLI入口点"""
    try:
        cli()
    except KeyboardInterrupt:
        console.print("\n[yellow]操作已取消[/yellow]")
        sys.exit(130)
    except Exception as e:
        console.print(f"\n[red]错误: {e}[/red]")
        sys.exit(1)


if __name__ == '__main__':
    main()
