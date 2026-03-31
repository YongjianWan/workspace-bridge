#!/usr/bin/env node
/**
 * reuse-detection.js - Node.js版本的代码复用检测工具
 * =====================================================
 * 功能：扫描项目代码，检测相似函数克隆
 * 
 * 安装依赖:
 *   npm install tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-go
 * 
 * 使用方法:
 *   node reuse-detection.js scan ./my-project
 *   node reuse-detection.js scan ./my-project --threshold 0.8
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Tree-sitter imports
let Parser, TypeScript, Python, Go, JavaScript;

try {
    Parser = require('tree-sitter');
    TypeScript = require('tree-sitter-typescript').typescript;
    Python = require('tree-sitter-python');
    Go = require('tree-sitter-go');
    JavaScript = require('tree-sitter-javascript');
} catch (e) {
    console.error('Error: Missing dependencies. Install with:');
    console.error('  npm install tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-go tree-sitter-javascript');
    process.exit(1);
}

// =============================================================================
// 语言配置
// =============================================================================

const LANGUAGE_CONFIG = {
    typescript: {
        extensions: ['.ts', '.tsx'],
        parser: TypeScript,
        functionQuery: `
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
        `,
        exportQuery: `
            (export_statement
                declaration: [
                    (function_declaration name: (identifier) @export.name)
                    (class_declaration name: (type_identifier) @export.name)
                    (interface_declaration name: (type_identifier) @export.name)
                ]) @export.stmt
        `,
        importQuery: `
            (import_statement
                (import_clause
                    (identifier)? @import.default
                    (named_imports (import_specifier (identifier) @import.name)))
                source: (string) @import.source) @import.stmt
        `
    },
    javascript: {
        extensions: ['.js', '.jsx', '.mjs'],
        parser: JavaScript,
        functionQuery: `
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
        `,
        exportQuery: `
            (export_statement
                declaration: (function_declaration name: (identifier) @export.name)) @export.stmt
        `,
        importQuery: `
            (import_statement
                (import_clause (identifier)? @import.name)
                source: (string) @import.source) @import.stmt
        `
    },
    python: {
        extensions: ['.py'],
        parser: Python,
        functionQuery: `
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
        `,
        exportQuery: `
            (expression_statement
                (assignment left: (identifier) @export.name)) @export.stmt
        `,
        importQuery: `
            (import_statement name: (dotted_name (identifier) @import.name)) @import.stmt
            (import_from_statement name: (dotted_name (identifier) @import.name)) @import.stmt
        `
    },
    go: {
        extensions: ['.go'],
        parser: Go,
        functionQuery: `
            (function_declaration
                name: (identifier) @func.name
                parameters: (parameter_list) @func.params
                result: (_)? @func.return
                body: (block) @func.body) @func.def
            
            (method_declaration
                receiver: (parameter_list) @method.receiver
                name: (field_identifier) @method.name
                parameters: (parameter_list) @method.params
                result: (_)? @method.return
                body: (block) @method.body) @method.def
        `,
        exportQuery: `
            (function_declaration
                name: (identifier) @export.name) @export.stmt
        `,
        importQuery: `
            (import_spec
                path: (interpreted_string_literal) @import.path
                name: (identifier)? @import.name) @import.spec
        `
    }
};

// =============================================================================
// AST解析器
// =============================================================================

class ASTParser {
    constructor() {
        this.parsers = {};
        this._initParsers();
    }

    _initParsers() {
        for (const [lang, config] of Object.entries(LANGUAGE_CONFIG)) {
            try {
                const parser = new Parser();
                parser.setLanguage(config.parser);
                this.parsers[lang] = parser;
            } catch (e) {
                console.warn(`Warning: Failed to initialize ${lang} parser: ${e.message}`);
            }
        }
    }

    detectLanguage(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        for (const [lang, config] of Object.entries(LANGUAGE_CONFIG)) {
            if (config.extensions.includes(ext)) {
                return lang;
            }
        }
        return null;
    }

    parseFile(filePath) {
        const lang = this.detectLanguage(filePath);
        if (!lang || !this.parsers[lang]) {
            return null;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const tree = this.parsers[lang].parse(content);
            return { tree, lang, content };
        } catch (e) {
            console.error(`Error parsing ${filePath}: ${e.message}`);
            return null;
        }
    }

    extractFunctions(filePath) {
        const result = this.parseFile(filePath);
        if (!result) return [];

        const { tree, lang, content } = result;
        const config = LANGUAGE_CONFIG[lang];
        
        if (!config.functionQuery) return [];

        const functions = [];
        
        try {
            const query = new Parser.Query(config.parser, config.functionQuery);
            const matches = query.matches(tree.rootNode);

            for (const match of matches) {
                const captureMap = {};
                for (const capture of match.captures) {
                    captureMap[capture.name] = capture.node;
                }

                if (captureMap['func.def']) {
                    const funcNode = captureMap['func.def'];
                    const nameNode = captureMap['func.name'];
                    const paramsNode = captureMap['func.params'];
                    const bodyNode = captureMap['func.body'];
                    const returnNode = captureMap['func.return'];

                    const funcInfo = {
                        name: nameNode ? content.slice(nameNode.startIndex, nameNode.endIndex) : 'anonymous',
                        params: paramsNode ? content.slice(paramsNode.startIndex, paramsNode.endIndex) : '',
                        body: bodyNode ? content.slice(bodyNode.startIndex, bodyNode.endIndex) : '',
                        returnType: returnNode ? content.slice(returnNode.startIndex, returnNode.endIndex) : null,
                        startLine: funcNode.startPosition.row + 1,
                        endLine: funcNode.endPosition.row + 1,
                        startIndex: funcNode.startIndex,
                        endIndex: funcNode.endIndex,
                        content: content.slice(funcNode.startIndex, funcNode.endIndex),
                        filePath: filePath,
                        language: lang,
                        isAsync: content.slice(funcNode.startIndex, funcNode.startIndex + 10).includes('async')
                    };

                    funcInfo.normalizedContent = this._normalizeFunction(funcInfo.content, lang);
                    funcInfo.astHash = this._computeHash(funcInfo.normalizedContent);

                    functions.push(funcInfo);
                }
            }
        } catch (e) {
            console.error(`Error querying ${filePath}: ${e.message}`);
        }

        return functions;
    }

    _normalizeFunction(content, lang) {
        // 移除注释
        let normalized = content;
        
        if (lang === 'typescript' || lang === 'javascript') {
            normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, '');
            normalized = normalized.replace(/\/\/.*$/gm, '');
        } else if (lang === 'python') {
            normalized = normalized.replace(/"""[\s\S]*?"""/g, '');
            normalized = normalized.replace(/'''[\s\S]*?'''/g, '');
            normalized = normalized.replace(/#.*$/gm, '');
        } else if (lang === 'go') {
            normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, '');
            normalized = normalized.replace(/\/\/.*$/gm, '');
        }

        // 规范化空白
        normalized = normalized.replace(/\s+/g, ' ').trim();

        return normalized;
    }

    _computeHash(content) {
        return crypto.createHash('md5').update(content).digest('hex');
    }
}

// =============================================================================
// 相似度计算器
// =============================================================================

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
        if (func1.astHash === func2.astHash) return 1.0;
        
        return 1 - this.levenshteinDistance(
            func1.normalizedContent.replace(/\s/g, ''),
            func2.normalizedContent.replace(/\s/g, '')
        ) / Math.max(func1.normalizedContent.length, func2.normalizedContent.length);
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
        
        return union.size === 0 ? 0 : intersection.size / union.size;
    }

    tokenize(code) {
        const matches = code.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b|"[^"]*"|'[^']*'|\d+|[{}();,=+\-*/<>!&|]+/g);
        return matches || [];
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
}

// =============================================================================
// Diff生成器
// =============================================================================

class DiffGenerator {
    generateUnifiedDiff(func1, func2) {
        const lines1 = func1.content.split('\n');
        const lines2 = func2.content.split('\n');
        
        const diff = this.unifiedDiff(
            lines1,
            lines2,
            `${func1.name} (${func1.filePath}:${func1.startLine})`,
            `${func2.name} (${func2.filePath}:${func2.startLine})`
        );
        
        return diff.slice(0, 50); // 限制长度
    }

    unifiedDiff(oldLines, newLines, oldHeader, newHeader) {
        const diff = [];
        const matches = this.findMatches(oldLines, newLines);
        
        let oldIndex = 0;
        let newIndex = 0;
        
        diff.push(`--- ${oldHeader}`);
        diff.push(`+++ ${newHeader}`);
        
        for (const match of matches) {
            // 输出删除的行
            while (oldIndex < match.oldStart) {
                diff.push(`-${oldLines[oldIndex]}`);
                oldIndex++;
            }
            
            // 输出行
            while (newIndex < match.newStart) {
                diff.push(`+${newLines[newIndex]}`);
                newIndex++;
            }
            
            // 输出匹配的行
            for (let i = 0; i < match.length; i++) {
                diff.push(` ${oldLines[oldIndex]}`);
                oldIndex++;
                newIndex++;
            }
        }
        
        // 输出剩余的行
        while (oldIndex < oldLines.length) {
            diff.push(`-${oldLines[oldIndex]}`);
            oldIndex++;
        }
        
        while (newIndex < newLines.length) {
            diff.push(`+${newLines[newIndex]}`);
            newIndex++;
        }
        
        return diff;
    }

    findMatches(oldLines, newLines) {
        const matches = [];
        const lcs = this.computeLCS(oldLines, newLines);
        
        let oldIndex = 0;
        let newIndex = 0;
        
        for (const op of lcs) {
            if (op.type === 'match') {
                matches.push({
                    oldStart: op.oldIndex,
                    newStart: op.newIndex,
                    length: op.length
                });
            }
        }
        
        return matches;
    }

    computeLCS(oldLines, newLines) {
        const m = oldLines.length;
        const n = newLines.length;
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
        
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (oldLines[i - 1] === newLines[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        
        const operations = [];
        let i = m, j = n;
        
        while (i > 0 && j > 0) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                operations.unshift({ type: 'match', oldIndex: i - 1, newIndex: j - 1, length: 1 });
                i--;
                j--;
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                operations.unshift({ type: 'delete', oldIndex: i - 1 });
                i--;
            } else {
                operations.unshift({ type: 'insert', newIndex: j - 1 });
                j--;
            }
        }
        
        return operations;
    }
}

// =============================================================================
// 克隆检测器
// =============================================================================

class CloneDetector {
    constructor(threshold = 0.85) {
        this.threshold = threshold;
        this.parser = new ASTParser();
        this.calculator = new SimilarityCalculator();
        this.diffGenerator = new DiffGenerator();
        this.functions = [];
        this.clonePairs = [];
    }

    scanProject(projectPath) {
        const files = this.getSourceFiles(projectPath);
        console.log(`Scanning ${files.length} files...`);

        for (const file of files) {
            const functions = this.parser.extractFunctions(file);
            this.functions.push(...functions);
        }

        console.log(`Found ${this.functions.length} functions`);
        return this.detectClones();
    }

    getSourceFiles(projectPath) {
        const files = [];
        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go'];
        
        const scanDir = (dir) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    
                    if (entry.isDirectory()) {
                        // 跳过特定目录
                        if (entry.name.startsWith('.') || 
                            entry.name === 'node_modules' ||
                            entry.name === '__pycache__' ||
                            entry.name === 'dist' ||
                            entry.name === 'build') {
                            continue;
                        }
                        scanDir(fullPath);
                    } else if (entry.isFile() && 
                              extensions.some(ext => entry.name.endsWith(ext))) {
                        files.push(fullPath);
                    }
                }
            } catch (e) {
                console.error(`Error scanning ${dir}: ${e.message}`);
            }
        };

        scanDir(projectPath);
        return files;
    }

    detectClones() {
        this.clonePairs = [];
        
        // 按AST哈希分组进行快速预筛选
        const hashGroups = {};
        for (const func of this.functions) {
            const prefix = func.astHash.substring(0, 16);
            if (!hashGroups[prefix]) hashGroups[prefix] = [];
            hashGroups[prefix].push(func);
        }
        
        // 在相同哈希组内比较
        for (const group of Object.values(hashGroups)) {
            if (group.length < 2) continue;
            
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const func1 = group[i];
                    const func2 = group[j];
                    
                    // 跳过同一文件的同名函数（通常是重载）
                    if (func1.filePath === func2.filePath && func1.name === func2.name) {
                        continue;
                    }
                    
                    const similarity = this.calculator.calculateSimilarity(func1, func2);
                    
                    if (similarity.combined >= this.threshold) {
                        const diff = this.diffGenerator.generateUnifiedDiff(func1, func2);
                        
                        this.clonePairs.push({
                            func1,
                            func2,
                            similarity,
                            diff
                        });
                    }
                }
            }
        }
        
        // 按相似度排序
        this.clonePairs.sort((a, b) => b.similarity.combined - a.similarity.combined);
        
        return this.clonePairs;
    }

    checkNewFunction(functionCode, filePath = '') {
        // 创建临时函数信息
        const tempFunc = {
            name: '__new_function__',
            filePath: filePath || '__temp__',
            startLine: 1,
            endLine: functionCode.split('\n').length,
            content: functionCode,
            normalizedContent: functionCode.replace(/\s+/g, ' ').trim(),
            astHash: crypto.createHash('md5').update(functionCode).digest('hex'),
            language: 'unknown'
        };

        const similarities = [];
        
        for (const existingFunc of this.functions) {
            const similarity = this.calculator.calculateSimilarity(tempFunc, existingFunc);
            
            if (similarity.combined >= this.threshold) {
                similarities.push({
                    func: existingFunc,
                    similarity
                });
            }
        }
        
        similarities.sort((a, b) => b.similarity.combined - a.similarity.combined);
        
        const topMatches = similarities.slice(0, 3);
        
        if (topMatches.length === 0) {
            return {
                shouldReuse: false,
                action: 'create_new',
                reason: 'No similar functions found in codebase',
                matches: []
            };
        }
        
        const bestMatch = topMatches[0];
        const bestScore = bestMatch.similarity.combined;
        
        let action, reason;
        
        if (bestScore >= 0.95) {
            action = 'force_reuse';
            reason = `Found nearly identical function '${bestMatch.func.name}' with ${(bestScore * 100).toFixed(2)}% similarity`;
        } else if (bestScore >= 0.85) {
            action = 'suggest_reuse';
            reason = `Found similar function '${bestMatch.func.name}' with ${(bestScore * 100).toFixed(2)}% similarity`;
        } else {
            action = 'consider';
            reason = `Found somewhat similar functions with ${(bestScore * 100).toFixed(2)}% similarity`;
        }
        
        return {
            shouldReuse: action === 'force_reuse' || action === 'suggest_reuse',
            action,
            reason,
            matches: topMatches.map(m => ({
                name: m.func.name,
                file: m.func.filePath,
                line: m.func.startLine,
                similarity: m.similarity.combined,
                similarityBreakdown: m.similarity
            }))
        };
    }

    generateReport(outputPath) {
        const lines = [
            '# 代码复用分析报告\n\n',
            `**扫描时间**: ${new Date().toISOString()}\n`,
            `**总函数数**: ${this.functions.length}\n`,
            `**克隆对数**: ${this.clonePairs.length}\n`,
            `**相似度阈值**: ${this.threshold}\n\n`,
            '---\n\n',
            '## 克隆摘要\n\n'
        ];

        if (this.clonePairs.length === 0) {
            lines.push('未发现代码克隆。\n\n');
        } else {
            const highSim = this.clonePairs.filter(c => c.similarity.combined >= 0.9).length;
            const mediumSim = this.clonePairs.filter(c => c.similarity.combined >= 0.85 && c.similarity.combined < 0.9).length;
            
            lines.push(`- 高相似度 (≥90%): ${highSim}\n`);
            lines.push(`- 中等相似度 (85-90%): ${mediumSim}\n`);
            lines.push(`- 平均相似度: ${(this.clonePairs.reduce((sum, c) => sum + c.similarity.combined, 0) / this.clonePairs.length * 100).toFixed(2)}%\n\n`);
        }

        lines.push('## 详细克隆对\n\n');
        
        for (let i = 0; i < Math.min(this.clonePairs.length, 20); i++) {
            const clone = this.clonePairs[i];
            lines.push(`### ${i + 1}. ${clone.func1.name} ↔ ${clone.func2.name}\n\n`);
            lines.push(`- **相似度**: ${(clone.similarity.combined * 100).toFixed(2)}%\n`);
            lines.push(`  - AST相似度: ${(clone.similarity.ast * 100).toFixed(2)}%\n`);
            lines.push(`  - 文本相似度: ${(clone.similarity.text * 100).toFixed(2)}%\n`);
            lines.push(`  - Token相似度: ${(clone.similarity.token * 100).toFixed(2)}%\n`);
            lines.push(`- **文件1**: \`${clone.func1.filePath}:${clone.func1.startLine}\`\n`);
            lines.push(`- **文件2**: \`${clone.func2.filePath}:${clone.func2.startLine}\`\n`);
            lines.push(`- **语言**: ${clone.func1.language} / ${clone.func2.language}\n\n`);
            
            if (clone.diff && clone.diff.length > 0) {
                lines.push('**Diff预览**:\n\n');
                lines.push('```diff\n');
                lines.push(clone.diff.slice(0, 20).join('\n'));
                lines.push('\n```\n\n');
            }
        }

        fs.writeFileSync(outputPath, lines.join(''), 'utf-8');
        console.log(`\nReport saved to: ${outputPath}`);
    }

    generateJsonReport(outputPath) {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalFunctions: this.functions.length,
                clonePairs: this.clonePairs.length,
                threshold: this.threshold
            },
            clonePairs: this.clonePairs.map(c => ({
                func1: {
                    name: c.func1.name,
                    file: c.func1.filePath,
                    line: c.func1.startLine,
                    language: c.func1.language
                },
                func2: {
                    name: c.func2.name,
                    file: c.func2.filePath,
                    line: c.func2.startLine,
                    language: c.func2.language
                },
                similarity: c.similarity
            }))
        };

        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
        console.log(`\nJSON report saved to: ${outputPath}`);
    }
}

// =============================================================================
// CLI
// =============================================================================

function printUsage() {
    console.log(`
代码复用检测工具 - Node.js版本
==============================

用法:
  node reuse-detection.js scan <project-path> [options]
  node reuse-detection.js check <function-code> --project <project-path> [options]

命令:
  scan    扫描整个项目
  check   检查单个函数是否应该复用现有实现

选项:
  --threshold <number>  相似度阈值 (默认: 0.85)
  --format <format>     输出格式: markdown, json, console (默认: console)
  --output <path>       输出文件路径
  --project <path>      项目路径 (check命令必需)

示例:
  node reuse-detection.js scan ./my-project
  node reuse-detection.js scan ./my-project --threshold 0.8 --format markdown
  node reuse-detection.js check "function add(a,b){return a+b;}" --project ./my-project
`);
}

function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        printUsage();
        process.exit(1);
    }

    const command = args[0];
    
    if (command === 'scan') {
        const projectPath = args[1];
        
        // 解析选项
        const thresholdIdx = args.indexOf('--threshold');
        const threshold = thresholdIdx >= 0 ? parseFloat(args[thresholdIdx + 1]) : 0.85;
        
        const formatIdx = args.indexOf('--format');
        const format = formatIdx >= 0 ? args[formatIdx + 1] : 'console';
        
        const outputIdx = args.indexOf('--output');
        const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : null;
        
        // 执行扫描
        const detector = new CloneDetector(threshold);
        const clones = detector.scanProject(projectPath);
        
        // 输出结果
        if (format === 'markdown' || (format === 'console' && outputPath)) {
            detector.generateReport(outputPath || 'reuse_report.md');
        } else if (format === 'json') {
            detector.generateJsonReport(outputPath || 'reuse_report.json');
        } else {
            // Console output
            console.log(`\n${'='.repeat(60)}`);
            console.log('代码复用分析结果');
            console.log(`${'='.repeat(60)}`);
            console.log(`总函数数: ${detector.functions.length}`);
            console.log(`克隆对数: ${clones.length}`);
            
            if (clones.length > 0) {
                console.log(`\n${'='.repeat(60)}`);
                console.log('TOP 10 克隆对:');
                console.log(`${'='.repeat(60)}`);
                
                for (let i = 0; i < Math.min(clones.length, 10); i++) {
                    const c = clones[i];
                    console.log(`\n${i + 1}. ${c.func1.name} ↔ ${c.func2.name}`);
                    console.log(`   相似度: ${(c.similarity.combined * 100).toFixed(2)}%`);
                    console.log(`   AST: ${(c.similarity.ast * 100).toFixed(2)}% | Text: ${(c.similarity.text * 100).toFixed(2)}% | Token: ${(c.similarity.token * 100).toFixed(2)}%`);
                    console.log(`   位置: ${c.func1.filePath}:${c.func1.startLine}`);
                    console.log(`       ↔ ${c.func2.filePath}:${c.func2.startLine}`);
                }
            }
        }
    } else if (command === 'check') {
        const functionCode = args[1];
        
        const projectIdx = args.indexOf('--project');
        if (projectIdx < 0) {
            console.error('Error: --project is required for check command');
            process.exit(1);
        }
        const projectPath = args[projectIdx + 1];
        
        const thresholdIdx = args.indexOf('--threshold');
        const threshold = thresholdIdx >= 0 ? parseFloat(args[thresholdIdx + 1]) : 0.85;
        
        // 先扫描项目
        const detector = new CloneDetector(threshold);
        detector.scanProject(projectPath);
        
        // 检查新函数
        const result = detector.checkNewFunction(functionCode);
        
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
}

main();
