# 代码复用发现机制

代码复用发现工具 - 检测相似函数克隆和未使用导出，帮助AI在生成新代码前发现现有实现。

## 功能特性

- **多语言支持**: TypeScript, JavaScript, Python, Go
- **多种相似度算法**: AST相似度、Token相似度、文本相似度、嵌入向量相似度
- **强制检索机制**: 在AI生成新函数前强制检索现有实现
- **Diff对比生成**: 生成统一格式和并排格式的diff
- **未使用导出检测**: 发现项目中未使用的导出函数和变量
- **可配置阈值**: 相似度阈值可配置（默认0.85）

## 快速开始

### Python版本

```bash
# 安装依赖
pip install -r requirements.txt

# 扫描项目
python reuse_detection.py scan ./my-project

# 指定相似度阈值
python reuse_detection.py scan ./my-project --threshold 0.8

# 生成Markdown报告
python reuse_detection.py scan ./my-project --format markdown --output report.md

# 生成JSON报告
python reuse_detection.py scan ./my-project --format json --output report.json

# 检查新函数是否应该复用
python reuse_detection.py check "function add(a, b) { return a + b; }" \
    --project ./my-project
```

### Node.js版本

```bash
# 安装依赖
npm install

# 扫描项目
node reuse-detection.js scan ./my-project

# 指定相似度阈值
node reuse-detection.js scan ./my-project --threshold 0.8

# 生成Markdown报告
node reuse-detection.js scan ./my-project --format markdown --output report.md

# 检查新函数
node reuse-detection.js check "function add(a,b){return a+b;}" \
    --project ./my-project
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `reuse_detection.py` | Python版本主脚本 |
| `reuse-detection.js` | Node.js版本主脚本 |
| `reuse_analysis.md` | 详细设计文档 |
| `tree-sitter-queries.scm` | Tree-sitter查询语句集合 |
| `reuse-config.yaml` | 配置文件示例 |
| `requirements.txt` | Python依赖列表 |
| `package.json` | Node.js依赖列表 |

## 核心算法

### 1. 强制检索算法

```
AI生成新函数
    │
    ▼
┌─────────────────┐
│ 1. 提取AST特征   │
│    - 函数签名    │
│    - 参数类型    │
│    - 返回类型    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. 生成特征向量  │
│    - AST Hash   │
│    - Token序列  │
│    - 嵌入向量   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. 向量数据库检索│
│    - Top-K查询  │
│    - 相似度排序  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. 相似度计算   │
│    - AST相似度  │
│    - 文本相似度 │
│    - 嵌入相似度 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 5. 阈值判断     │
│    ≥0.95? → 强制复用提示
│    ≥0.85? → 建议复用提示
│    <0.85? → 允许创建新函数
└─────────────────┘
```

### 2. 相似度计算方法

| 方法 | 权重 | 说明 |
|------|------|------|
| AST相似度 | 0.4 | 基于AST结构哈希的相似度 |
| Token相似度 | 0.3 | 基于Token序列的Jaccard相似度 |
| 文本相似度 | 0.3 | 基于编辑距离的相似度 |
| 嵌入相似度 | 0.0 | 基于语义向量的余弦相似度（可选） |

### 3. 阈值规则

| 相似度 | 行动 | 说明 |
|--------|------|------|
| ≥0.95 | 强制复用 | 发现几乎相同的函数，必须复用 |
| 0.85-0.95 | 建议复用 | 发现相似函数，建议复用或重构 |
| <0.85 | 允许创建 | 未发现相似函数，允许创建新函数 |

## 工具调研对比

| 工具 | 类型 | 支持语言 | 准确率(F1) | 推荐场景 |
|------|------|----------|------------|----------|
| jscpd | Token-based | 150+ | 0.45-0.60 | 快速预筛选 |
| Simian | Text/Line-based | Java/C/C++/C# | 0.25-0.35 | 简单重复检测 |
| ast-grep | AST-based | 20+ | 0.75-0.85 | 精确重构 |
| semgrep | AST+Pattern | 30+ | 0.70-0.80 | 安全规则 |
| NiCad | Text+AST | C/Java/Python | 0.85-0.95 | 高精度需求 |
| **本工具** | AST+Multi | TS/JS/Py/Go | 0.80-0.90 | AI复用检测 |

## 配置说明

编辑 `reuse-config.yaml` 自定义配置：

```yaml
similarity:
  threshold: 0.85              # 相似度阈值
  force_reuse_threshold: 0.95  # 强制复用阈值
  suggest_reuse_threshold: 0.85 # 建议复用阈值
  
languages:
  typescript:
    enabled: true
  python:
    enabled: true
  go:
    enabled: true

exclusions:
  directories:
    - node_modules
    - .git
    - __pycache__
```

## CHANGE_PROOF.md模板

在AI生成新函数前，需要在CHANGE_PROOF.md中记录：

```markdown
## 复用审查记录

### 新函数: `functionName`

**创建时间**: 2024-01-15 10:30

**检索结果**: 
- [x] 已检索符号地图
- [ ] 未检索符号地图

**相似函数发现**:
| 函数名 | 文件路径 | 相似度 | 决策 |
|--------|----------|--------|------|
| existingFunc | src/utils/helper.ts | 92% | 选择不复用 |

**不复用理由**: 
现有实现使用回调模式，新需求需要Promise模式，
重构成本高于重写。

**替代方案**:
计划将两个实现统一为async/await模式，
创建技术债务Issue #XXX跟踪。

**审查人**: @reviewer
```

## 输出示例

### 控制台输出

```
============================================================
代码复用分析结果
============================================================
扫描文件: 150
函数总数: 423
克隆对数: 28
未使用导出: 8

============================================================
TOP 10 克隆对:
============================================================

1. formatDate ↔ formatDateTime
   相似度: 97.23%
   位置: src/utils/date.ts:45
       ↔ src/helpers/formatters.ts:23

2. validateEmail ↔ validateUsername
   相似度: 89.45%
   位置: src/validation/email.ts:12
       ↔ src/validation/user.ts:34
```

### JSON输出

```json
{
  "summary": {
    "total_functions": 423,
    "clone_pairs": 28,
    "unused_exports": 8
  },
  "clone_pairs": [
    {
      "func1": {
        "name": "formatDate",
        "file": "src/utils/date.ts",
        "line": 45
      },
      "func2": {
        "name": "formatDateTime",
        "file": "src/helpers/formatters.ts",
        "line": 23
      },
      "similarity": {
        "combined": 0.9723,
        "ast": 0.95,
        "text": 0.98,
        "token": 0.99
      }
    }
  ]
}
```

## 依赖安装

### Python依赖

```bash
# 基础依赖（必需）
pip install tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-go

# 可选依赖（嵌入向量支持）
pip install sentence-transformers numpy

# 可选依赖（向量数据库）
pip install lancedb
```

### Node.js依赖

```bash
npm install tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-go tree-sitter-javascript
```

## 性能优化

1. **并行处理**: 使用多线程/多进程处理文件
2. **增量扫描**: 只扫描变更的文件
3. **缓存机制**: 缓存AST解析结果
4. **分层检索**: 先哈希匹配，再精确计算

## 许可证

MIT License
