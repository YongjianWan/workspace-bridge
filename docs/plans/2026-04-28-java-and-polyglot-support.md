# 技术方案：Java AST 级支持与多语言扩展

> 状态：已决策，待执行  
> 版本：v1.0（修订版）  
> 基于源码审计日期：2026-04-28  
> 目标：消除 ROADMAP/CHANGELOG 与源码的 gap；将 Java 从 regex 提升到与 Python 同级；为 Kotlin/Go/Rust 建立 L2（regex 级）基础。

---

## 一、执行原则

1. **不改架构，只补能力**。当前代码结构 6.5/10，够用但不优雅。本次计划**不做"插件注册表"大重构**（那是后续拿到 8 分的长期工程），只在现有硬编码链上扩展，保持改动可预测、可回滚。
2. **AST 优先，regex 保底**。任何新增解析器必须有 AST → regex 两级降级，避免单个文件搞崩全图。
3. **零新增 Node 依赖**。Java AST 走外部 Python 子进程（与 Python AST 模式一致），不在 `package.json` 增加任何包。
4. **诚实标记置信度**。解析模式为 regex 的结果必须带 `confidence: 'medium'` 或 `'low'`，不误导下游判断。

---

## 二、现状诊断（源码级，已确认）

| 文件 | 行号 | 现状 | 影响 |
|------|------|------|------|
| `src/services/dep-graph/parsers.js` | 632-660 | `parseJava()` 仅 28 行 regex，无 AST | 无法做符号级死导出、无法识别同包隐式依赖 |
| `src/services/dep-graph/resolvers.js` | 111-130 | `resolveJavaImport()` 只搜 5 个固定目录 | 多模块 Maven/Gradle 项目大面积 import 解析失败 |
| `src/services/file-index.js` | 325-333 | `extractSymbols()` 仅提取顶层类型 | 方法级影响分析完全缺失 |
| `src/utils/stack-detector.js` | 136-175 | `linters.java` / `typeCheckers.java` 为空 | `audit-diff` 的 smoke 阶段不会生成 Java 质量检查命令 |

**文档谎言：** ROADMAP.md Phase 4 和 CHANGELOG [0.8.0] 声称 "Java symbol-level impact 已实现"，实际没有。本次方案包含文档修正。

---

## 三、方案详情

### 3.1 数据流与接口契约

```
┌─────────────────────────┐     stdin      ┌──────────────────────────┐
│  scripts/java_ast_      │ ─────────────→ │  Python + javalang       │
│  parser.py (Node spawn) │ ←───────────── │  (pip install javalang)  │
└─────────────────────────┘     stdout     └──────────────────────────┘
           │
           ▼ JSON
┌─────────────────────────┐
│  parsers.js             │
│  parseJavaAST(content)  │  → 成功: { imports, exports, importRecords,
│  (子进程通信，30s超时)    │            package, parseMode: 'ast' }
│                         │  → 失败: resolve(null)，外层回退到 regex
└─────────────────────────┘
           │
           ▼
┌─────────────────────────┐
│  dep-graph.js           │
│  analyzeFile()          │  → graph.set(file, { imports, exports,
│                         │            importRecords, exportRecords,
│                         │            parseMode, confidence })
└─────────────────────────┘
```

**统一 JSON 输出契约（javalang AST 解析器）：**

```json
{
  "imports": ["com.example.Foo", "java.util.List"],
  "exports": ["MyClass", "myMethod", "myField"],
  "importRecords": [
    {
      "source": "com.example.Foo",
      "imported": ["Foo"],
      "usesAllExports": false
    },
    {
      "source": "java.util.*",
      "imported": [],
      "usesAllExports": true
    }
  ],
  "package": "com.example.service"
}
```

注意：
- `exports` 包含**类名 + public 方法名 + public 字段名**
- `package` 用于后续 resolver 做同包隐式依赖校验（本次不做，预留字段）
- 若文件无 `package` 声明，`package` 为 `null`

### 3.2 Phase A：Java 深度支持（最高优先级，预估 2 天）

#### A1. 新建 `scripts/java_ast_parser.py`

**技术决策（已确定）：**
- 使用 `javalang`（`pip install javalang`）作为 AST 解析引擎
- 脚本头部检测 `import javalang`，若缺失则向 stderr 输出 `"javalang not installed"` 并 exit(1)
- Node 层（`parseJavaAST`）检测到 exit code ≠ 0 时自动回退到 regex，**用户无感知**

**核心实现逻辑：**

```python
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
        if imp.static:
            source_path = "static " + source_path
        if imp.wildcard:
            source_path += ".*"
        imports.append(source_path)
        import_records.append({
            "source": source_path,
            "imported": [] if imp.wildcard else [source_path.split(".")[-1]],
            "usesAllExports": imp.wildcard
        })

    exports = []
    # 遍历顶层类型
    for path, node in tree:
        if isinstance(node, javalang.tree.ClassDeclaration):
            exports.append(node.name)
            # public 方法
            for member in node.body or []:
                if isinstance(member, javalang.tree.MethodDeclaration) and "public" in member.modifiers:
                    exports.append(member.name)
                if isinstance(member, javalang.tree.FieldDeclaration) and "public" in member.modifiers:
                    for declarator in member.declarators:
                        exports.append(declarator.name)
        elif isinstance(node, javalang.tree.InterfaceDeclaration):
            exports.append(node.name)
        elif isinstance(node, javalang.tree.EnumDeclaration):
            exports.append(node.name)

    return {
        "imports": imports,
        "exports": list(dict.fromkeys(exports)),  # 去重，保序
        "importRecords": import_records,
        "package": package
    }

if __name__ == "__main__":
    source = sys.stdin.read()
    result = parse_java(source)
    print(json.dumps(result, separators=(',', ':')))
```

**边界情况处理：**
- `javalang.parse.parse()` 抛出异常（语法不完整）→ 向 stderr 写错误，exit(1)
- 输入为空 → 返回 `{ "imports": [], "exports": [], "importRecords": [], "package": null }`
- 匿名类/内部类的方法**不提取**（只提取文件级符号，与 JS/TS 当前策略对齐）

#### A2. 修改 `src/services/dep-graph/parsers.js`

**改动点 1：新增 `parseJavaAST(content)`**

完全复制 `parsePythonAST()`（第 146-218 行）的模板，修改以下参数：
- `scriptPath` → `'scripts/java_ast_parser.py'`
- `pythonCmd` → 复用同一变量（Win 用 `python`，其他用 `python3`）
- `timeout` → 复用 `TIMEOUTS.PYTHON_AST_PARSE_MS`（30s），不新增常量

**改动点 2：修改 `parseJava(content)` → `async function parseJava(content)`**

```javascript
async function parseJava(content) {
  const astResult = await parseJavaAST(content);
  if (astResult) {
    return {
      imports: uniqueNames(astResult.imports),
      exports: uniqueNames(astResult.exports),
      importRecords: (astResult.importRecords || []).map((record) =>
        createImportRecord(record.source, {
          imported: record.imported,
          usesAllExports: record.usesAllExports,
        })
      ),
      exportRecords: uniqueNames(astResult.exports).map((name) =>
        createExportRecord(name, { kind: 'symbol' })
      ),
      parseMode: 'ast',
    };
  }
  // 回退到现有 regex
  const regexResult = parseJavaWithRegex(content);
  return { ...regexResult, parseMode: 'regex' };
}
```

注意：
- `exportRecords` 的 `kind` 统一为 `'symbol'`（Java AST 目前不做 JS/TS 那样的 function/class/variable 细分，简化处理）
- 原有 regex 逻辑抽取为 `parseJavaWithRegex(content)`，不要删除

**改动点 3：`module.exports`**

导出不变（`parseJava` 已存在于 exports 中）。

#### A3. 修改 `src/services/dep-graph.js`

**第 283 行：**

```javascript
// 修改前
({ imports, exports, importRecords, exportRecords, parseMode } = parseJava(content));

// 修改后
({ imports, exports, importRecords, exportRecords, parseMode } = await parseJava(content));
```

**第 300-306 行（graph.set 处）：增加 confidence 字段**

```javascript
this.graph.set(graphKey, {
  imports: resolvedImports,
  exports,
  importRecords: resolvedImportRecords,
  exportRecords: exportRecords.length > 0 ? exportRecords : exports.map((name) => ({ name })),
  parseMode,
  confidence: parseMode === 'ast' ? 'high' : 'medium',
});
```

#### A4. 增强 `resolveJavaImport()` —— 多模块 source root 发现

**文件：** `src/services/dep-graph/resolvers.js`

**新增缓存函数（放在文件顶部，module.exports 之前）：**

```javascript
let _javaSourceRootsCache = new Map(); // root -> string[]

function discoverJavaSourceRoots(root) {
  if (_javaSourceRootsCache.has(root)) {
    return _javaSourceRootsCache.get(root);
  }

  const roots = [root, path.join(root, 'src'), path.join(root, 'app')];

  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(root, entry.name);
      for (const srcDir of ['src/main/java', 'src/test/java']) {
        const candidate = path.join(sub, srcDir);
        if (fs.existsSync(candidate)) {
          roots.push(candidate);
        }
      }
    }
  } catch (e) {
    // root 不可读，忽略
  }

  _javaSourceRootsCache.set(root, roots);
  return roots;
}
```

**修改 `resolveJavaImport()`：**

```javascript
function resolveJavaImport(importPath, root) {
  if (!importPath || importPath.endsWith('.*')) {
    return null;
  }
  const relative = importPath.split('.').join(path.sep);
  const candidates = discoverJavaSourceRoots(root).map((r) => path.join(r, relative));

  for (const base of candidates) {
    const fullPath = `${base}.java`;
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}
```

**兼容性说明：**
- 单模块项目（`src/main/java` 直接在 root 下）的行为**不变**
- 多模块项目（`module-a/src/main/java`）新增支持
- 若 `root` 下子目录极多（>100），`readdirSync` 可能慢——但这是在 build 阶段一次性调用，可接受

#### A5. 增强 `extractSymbols()` —— Java 方法级符号

**文件：** `src/services/file-index.js`，第 325-333 行替换为：

```javascript
} else if (ext === '.java') {
  lines.forEach((line, idx) => {
    const typeMatch = line.match(/\b(?:public\s+)?(?:abstract\s+|final\s+)?(class|interface|enum|record)\s+(\w+)/);
    if (typeMatch) {
      symbols.push({ name: typeMatch[2], type: typeMatch[1], line: idx + 1, signature: line.trim() });
    }
    // public 方法（简化匹配，不处理泛型签名中的括号）
    const methodMatch = line.match(/\bpublic\s+(?:static\s+)?(?:[\w<>,\[\]\s]+)\s+(\w+)\s*\(/);
    if (methodMatch) {
      symbols.push({ name: methodMatch[1], type: 'method', line: idx + 1, signature: line.trim() });
    }
  });
}
```

**已知限制（接受）：**
- 重载方法会产生重复 symbol 名 → FileIndex 的 symbol 索引会记录同一文件多行，这是正确行为
- 构造函数 `public Foo()` 会被匹配为 method → symbol name 为 `Foo`，与类名重复 → 也接受，因为 symbol 索引允许同名多位置

#### A6. 增强 `stack-detector.js` —— Java 生态检测

**文件：** `src/utils/stack-detector.js`

**在 `detectLinters()` 中增加 Java 分支（第 136-158 行之间）：**

```javascript
// Java linters
if (pathExists(path.join(root, 'checkstyle.xml')) ||
    pathExists(path.join(root, 'config/checkstyle/checkstyle.xml'))) {
  linters.java.push('checkstyle');
}
const buildGradleText = readTextIfExists(path.join(root, 'build.gradle')) +
  readTextIfExists(path.join(root, 'build.gradle.kts')) +
  readTextIfExists(path.join(root, 'pom.xml'));
if (/\bspotbugs\b/.test(buildGradleText)) linters.java.push('spotbugs');
if (/\bpmd\b/.test(buildGradleText)) linters.java.push('pmd');
if (/\berrorprone\b/.test(buildGradleText)) linters.java.push('errorprone');
if (/\bjacoco\b/.test(buildGradleText)) linters.java.push('jacoco');
```

**在 `getJavaCommands()` 中增加 smoke 命令（第 303-326 行）：**

```javascript
// 在 smoke 阶段，buildTool 判断之后插入：
if (javaStack.linters.includes('checkstyle')) {
  commands.smoke.push({
    name: 'java-checkstyle',
    description: 'Run Checkstyle',
    cmd: `${javaCmd} checkstyle:check`,
  });
}
```

其他 linter（spotbugs/pmd）的 Maven/Gradle 插件命令较复杂，且运行慢，**暂不加入 commands**，只在 `stack` 输出中标记检测到，供用户参考。

### 3.3 Phase B：Kotlin/Go/Rust L2 支持（次优先级，预估 1.5 天）

**决策（已确定）：**
- Kotlin：独立 regex 解析器，不复用 Java（Kotlin 有 `object`、`companion object`、`top-level fun` 等独特语法）
- Go/Rust：regex 解析 + 路径解析空实现（只处理同目录相对 import，不解析跨包）

#### B1. 文件索引扩展

**文件：** `src/services/file-index.js`

**`getFilePatterns()`（第 82-94 行）：**

```javascript
getFilePatterns() {
  const patterns = [];
  if (this.workspace.hasPackageJson) {
    patterns.push('**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx');
  }
  if (this.workspace.hasRequirements || this.workspace.hasPyproject || this.workspace.hasManagePy) {
    patterns.push('**/*.py');
  }
  if (this.workspace.hasJava) {
    patterns.push('**/*.java', '**/*.kt'); // 增加 Kotlin
  }
  // 新增 Go/Rust 独立检测
  if (this.workspace.hasGo) {
    patterns.push('**/*.go');
  }
  if (this.workspace.hasRust) {
    patterns.push('**/*.rs');
  }
  return patterns.length > 0 ? patterns : ['**/*.js', '**/*.py', '**/*.java'];
}
```

注意：`detectWorkspace()`（`src/utils/path.js`）需要新增 `hasGo` / `hasRust` 检测（见 B4）。

**`extractSymbols()` 新增分支：**

```javascript
} else if (ext === '.kt') {
  lines.forEach((line, idx) => {
    const typeMatch = line.match(/\b(?:public\s+)?(?:abstract\s+|open\s+|data\s+)?(class|interface|object|enum)\s+(\w+)/);
    if (typeMatch) {
      symbols.push({ name: typeMatch[2], type: typeMatch[1], line: idx + 1, signature: line.trim() });
    }
    const funMatch = line.match(/\bfun\s+(\w+)\s*\(/);
    if (funMatch) {
      symbols.push({ name: funMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
    }
  });
} else if (ext === '.go') {
  lines.forEach((line, idx) => {
    const typeMatch = line.match(/\btype\s+(\w+)/);
    const funcMatch = line.match(/\bfunc\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/);
    if (typeMatch) {
      symbols.push({ name: typeMatch[1], type: 'type', line: idx + 1, signature: line.trim() });
    } else if (funcMatch) {
      symbols.push({ name: funcMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
    }
  });
} else if (ext === '.rs') {
  lines.forEach((line, idx) => {
    const fnMatch = line.match(/\bfn\s+(\w+)\s*\(/);
    const structMatch = line.match(/\bstruct\s+(\w+)/);
    if (fnMatch) {
      symbols.push({ name: fnMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
    } else if (structMatch) {
      symbols.push({ name: structMatch[1], type: 'struct', line: idx + 1, signature: line.trim() });
    }
  });
}
```

#### B2. 解析器扩展

**文件：** `src/services/dep-graph/parsers.js`

新增三个函数（放在 `parseJava` 之后，`module.exports` 之前）：

```javascript
function parseKotlin(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  const importRegex = /^\s*import\s+([\w.]+)(?:\.\*)?\s*(?:as\s+\w+)?/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const source = match[1] + (match[0].includes('.*') ? '.*' : '');
    const isWildcard = source.endsWith('.*');
    imports.push(source);
    importRecords.push(createImportRecord(source, {
      imported: isWildcard ? [] : [source.split('.').pop()],
      usesAllExports: isWildcard,
    }));
  }

  const exportRegex = /\b(?:public\s+)?(?:abstract\s+|open\s+|data\s+)?(?:class|interface|object|enum)\s+([A-Za-z_]\w*)/g;
  while ((match = exportRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'class' }));
  }

  const funRegex = /\bfun\s+([A-Za-z_]\w*)\s*\(/g;
  while ((match = funRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    parseMode: 'regex',
  };
}

function parseGo(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  // 处理 import "xxx" 和 import ( "xxx" "yyy" )
  const singleImport = /^\s*import\s+"([^"]+)"/gm;
  let match;
  while ((match = singleImport.exec(content)) !== null) {
    imports.push(match[1]);
    importRecords.push(createImportRecord(match[1], { usesAllExports: true }));
  }

  const blockImport = /^\s*import\s+\(([\s\S]*?)\)/m;
  const blockMatch = content.match(blockImport);
  if (blockMatch) {
    const inner = blockMatch[1];
    const innerRegex = /"([^"]+)"/g;
    while ((match = innerRegex.exec(inner)) !== null) {
      imports.push(match[1]);
      importRecords.push(createImportRecord(match[1], { usesAllExports: true }));
    }
  }

  // Go: exported = capitalized names
  const typeRegex = /\btype\s+([A-Z]\w*)/g;
  while ((match = typeRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'type' }));
  }
  const funcRegex = /\bfunc\s+(?:\([^)]*\)\s+)?([A-Z]\w*)\s*\(/g;
  while ((match = funcRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    parseMode: 'regex',
  };
}

function parseRust(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  const useRegex = /^\s*use\s+([\w:]+)\s*;/gm;
  let match;
  while ((match = useRegex.exec(content)) !== null) {
    imports.push(match[1]);
    importRecords.push(createImportRecord(match[1], { usesAllExports: match[1].endsWith('::*') }));
  }

  const fnRegex = /\bpub\s+(?:async\s+)?fn\s+(\w+)/g;
  while ((match = fnRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
  }
  const structRegex = /\bpub\s+struct\s+(\w+)/g;
  while ((match = structRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'struct' }));
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    parseMode: 'regex',
  };
}
```

**`module.exports` 更新：**

```javascript
module.exports = {
  createImportRecord,
  parsePython,
  parseJavaScript,
  parseJava,
  parseKotlin,
  parseGo,
  parseRust,
};
```

#### B3. 路径解析扩展

**文件：** `src/services/dep-graph/resolvers.js`

在 `resolveImport()` 中新增：

```javascript
function resolveImport(fromFile, importPath, ext, root) {
  if (ext === '.py') {
    return resolvePythonImport(fromFile, importPath, root);
  }
  if (ext === '.java') {
    return resolveJavaImport(importPath, root);
  }
  if (ext === '.kt') {
    return resolveJavaImport(importPath, root); // Kotlin 与 Java 同包结构
  }
  if (ext === '.go') {
    return resolveGoImport(fromFile, importPath, root);
  }
  if (ext === '.rs') {
    return resolveRustImport(fromFile, importPath, root);
  }
  return resolveJavaScriptImport(fromFile, importPath);
}
```

**新增空实现（预留）：**

```javascript
function resolveGoImport(fromFile, importPath, root) {
  // Phase B 仅处理同目录相对 import
  if (importPath.startsWith('.')) {
    const fromDir = path.dirname(fromFile);
    const resolved = path.resolve(fromDir, importPath);
    if (fs.existsSync(resolved)) return resolved;
    if (fs.existsSync(`${resolved}.go`)) return `${resolved}.go`;
  }
  // 跨包 import 需要解析 go.mod，暂不实现
  return null;
}

function resolveRustImport(fromFile, importPath, root) {
  // Phase B 仅处理同 crate 的 mod 引用
  if (!importPath.startsWith('crate::') && !importPath.startsWith('super::')) {
    return null;
  }
  // 简化：不做实际路径解析
  return null;
}
```

#### B4. 技术栈检测扩展

**文件：** `src/utils/stack-detector.js`

**新增检测函数（放在 `hasJavaProject` 之后）：**

```javascript
function hasGoProject(root) {
  return pathExists(path.join(root, 'go.mod'));
}

function hasRustProject(root) {
  return pathExists(path.join(root, 'Cargo.toml'));
}
```

**修改 `detectStack()`：**

```javascript
const hasGo = hasGoProject(root);
const hasRust = hasRustProject(root);
// ...
let profile = 'unknown';
const activeStacks = [hasNode, hasPython, hasJava, hasGo, hasRust].filter(Boolean).length;
// ...
else if (hasGo) profile = 'go-first';
else if (hasRust) profile = 'rust-first';
// ...
return {
  // ... 原有字段
  go: hasGo ? { enabled: true, packageManager: 'go modules', testRunner: 'go test' } : null,
  rust: hasRust ? { enabled: true, packageManager: 'cargo', testRunner: 'cargo test' } : null,
};
```

**修改 `generateCommands()`：**

```javascript
const goTargets = targets.filter((file) => /\.go$/.test(file));
const rustTargets = targets.filter((file) => /\.rs$/.test(file));

function getGoCommands(goStack, changeType, targets) {
  if (!goStack?.enabled) return { smoke: [], focused: [], full: [] };
  if (changeType !== 'code' && changeType !== 'tests') return { smoke: [], focused: [], full: [] };
  const commands = { smoke: [], focused: [], full: [] };
  commands.smoke.push({ name: 'go-build', description: 'Go build check', cmd: 'go build ./...' });
  if (targets.length > 0) {
    commands.focused.push({ name: 'go-focused-tests', description: 'Run affected Go tests', cmd: `go test ${targets.join(' ')}` });
  }
  commands.full.push({ name: 'go-all-tests', description: 'Run all Go tests', cmd: 'go test ./...' });
  return commands;
}

function getRustCommands(rustStack, changeType, targets) {
  if (!rustStack?.enabled) return { smoke: [], focused: [], full: [] };
  if (changeType !== 'code' && changeType !== 'tests') return { smoke: [], focused: [], full: [] };
  const commands = { smoke: [], focused: [], full: [] };
  commands.smoke.push({ name: 'rust-check', description: 'Rust check', cmd: 'cargo check' });
  commands.full.push({ name: 'rust-all-tests', description: 'Run all Rust tests', cmd: 'cargo test' });
  return commands;
}

// mergeCommandSets 中增加：
const merged = mergeCommandSets(nodeCommands, pythonCommands, javaCommands, goCommands, rustCommands);
```

#### B5. 依赖图路由扩展

**文件：** `src/services/dep-graph.js`

在 `analyzeFile()`（第 275-285 行）中增加：

```javascript
} else if (ext === '.java') {
  ({ imports, exports, importRecords, exportRecords, parseMode } = await parseJava(content));
} else if (ext === '.kt') {
  ({ imports, exports, importRecords, exportRecords, parseMode } = parseKotlin(content));
} else if (ext === '.go') {
  ({ imports, exports, importRecords, exportRecords, parseMode } = parseGo(content));
} else if (ext === '.rs') {
  ({ imports, exports, importRecords, exportRecords, parseMode } = parseRust(content));
}
```

注意：`parseJava` 已改为 async，其他三个保持 sync。

#### B6. 测试启发式扩展

**文件：** `src/services/dep-graph.js`

**`isTestLikeFile()`（第 153-169 行）：**

```javascript
isTestLikeFile(filePath) {
  const normalized = normalizePathKey(filePath);
  const base = path.basename(normalized);
  return (
    // ... 原有条件
    /_test\.go$/.test(base) ||           // Go
    /(Tests?|Test)\.kt$/i.test(base)     // Kotlin
  );
}
```

**`normalizeHeuristicName()`（第 46-55 行）：**

```javascript
if (ext === '.java') {
  return base.replace(/(?:Tests?|Specs?|TestCases?|ITs?)$/, '').toLowerCase();
}
if (ext === '.kt') {
  return base.replace(/(?:Tests?|Test)$/, '').toLowerCase();
}
```

**`getHeuristicLanguageFamily()`（第 77-89 行）：**

```javascript
if (ext === '.kt') {
  return 'java-family';
}
if (ext === '.go') {
  return 'go-family';
}
if (ext === '.rs') {
  return 'rust-family';
}
```

**`HEURISTIC_ROOT_SEGMENTS`（第 39-44 行）：**

```javascript
const HEURISTIC_ROOT_SEGMENTS = new Set([
  'src', 'app', 'lib', 'source', 'sources',
  'test', 'tests', '__tests__', 'spec', 'specs',
  'main', 'java', 'python', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'packages', 'package',
  'kotlin', 'go', 'rust',
]);
```

### 3.4 Phase C：置信度标记与文档修正（半天）

#### C1. 解析模式置信度

已在 **A3** 中完成：`analyzeFile()` 输出 `confidence: parseMode === 'ast' ? 'high' : 'medium'`。

**补充：`findDeadExports()` 中的 confidence 降级**

文件：`src/services/dep-graph.js`，第 507-510 行：

```javascript
const unused = info.exports.filter((name) => !usedNames.has(name));
if (unused.length > 0) {
  const confidence = info.parseMode === 'ast' ? 'medium' : 'low';
  deadExports.push({ file: filePath, exports: unused, confidence });
}
```

#### C2. 诚实化文档

| 文件 | 修改位置 | 修改内容 |
|------|----------|----------|
| `ROADMAP.md` | Phase 4 | "symbol-level impact（已实现 baseline：JS/TS + Python + Java）" → "symbol-level impact（JS/TS + Python 已实现 AST 级；Java 为 regex 级，AST 支持在 P4-A 计划中）" |
| `CHANGELOG.md` | [0.8.0] | 相同表述同步修正 |
| `SKILL.md` | Known Limitations 后 | 新增 "Language Support Matrix" 表格（见下文） |

**SKILL.md 新增内容：**

```markdown
### Language Support Matrix

| Language | Dependency Graph | Symbol Impact | Dead Exports | Test Mapping | Stack Commands |
|----------|------------------|---------------|--------------|--------------|----------------|
| JS/TS    | ✅ Full AST      | ✅ Symbol-level | ✅ Symbol-level | ✅ Graph + Heuristic | ✅ Full |
| Python   | ✅ Full AST      | ✅ Module-level | ✅ `__all__` aware | ✅ Graph + Heuristic | ✅ Full |
| Java     | ⚠️ Regex only    | ❌ File-level   | ❌ File-level   | ⚠️ Heuristic only   | ✅ Basic |
| Kotlin   | ❌ Not indexed   | ❌ N/A          | ❌ N/A          | ❌ N/A              | ⚠️ Gradle only |
| Go       | ❌ Not indexed   | ❌ N/A          | ❌ N/A          | ❌ N/A              | ❌ None |
| Rust     | ❌ Not indexed   | ❌ N/A          | ❌ N/A          | ❌ N/A              | ❌ None |
```

---

## 四、时间线与里程碑

| 日期 | 任务 | 验收标准 | 回滚策略 |
|------|------|----------|----------|
| Day 1 上午 | A1: `java_ast_parser.py` + A2: `parsers.js` | `node -e "require('./src/services/dep-graph/parsers').parseJava('import x.y.Z; public class A {}')"` 返回 `parseMode: 'ast'` | 若 javalang 不可用，确保 regex 回退仍然工作 |
| Day 1 下午 | A3: `dep-graph.js` await + confidence + A4: `resolvers.js` 多模块 | 在含 `module-a/src/main/java` 的项目中跑 `audit-summary`，import 解析无大面积失败 | 回退 `resolveJavaImport` 到旧版本 |
| Day 2 上午 | A5: `file-index.js` 方法符号 + A6: `stack-detector.js` Java 生态 | `audit-file --file X.java` 的 `symbolImpact` 包含方法名 | 删除新增 regex 即可 |
| Day 2 下午 | B1-B6: Kotlin/Go/Rust 基础支持 | `audit-summary` 在 Go/Rust 项目中能识别文件并给出孤儿检测结果 | 删除新增分支即可 |
| Day 3 上午 | C2: 文档修正 + 全量测试回归 | `npm test` 全绿，ROADMAP/CHANGELOG/SKILL.md 已更新 | git revert |

---

## 五、测试策略

### 5.1 新增单元测试

**`test/java-parsers-test.js`（新建）：**

```javascript
const assert = require('assert');
const { parseJava } = require('../src/services/dep-graph/parsers');

async function testJavaAST() {
  const source = `
package com.example;
import java.util.List;
import static org.junit.Assert.assertEquals;

public class Foo {
  public void bar() {}
  public int baz;
}
`;
  const result = await parseJava(source);
  assert.strictEqual(result.parseMode, 'ast', 'Should use AST when javalang available');
  assert(result.imports.includes('java.util.List'));
  assert(result.imports.includes('static org.junit.Assert.assertEquals'));
  assert(result.exports.includes('Foo'));
  assert(result.exports.includes('bar'));
  assert(result.exports.includes('baz'));
}

async function testJavaFallback() {
  // 传入非法 Java 语法，触发 javalang 异常，验证 regex 回退
  const result = await parseJava('this is not java');
  assert.strictEqual(result.parseMode, 'regex');
}

(async () => {
  await testJavaAST();
  await testJavaFallback();
  console.log('java-parsers-test: OK');
})();
```

**`test/java-resolver-test.js`（新建）：**

```javascript
const fs = require('fs');
const path = require('path');
const { resolveJavaImport } = require('../src/services/dep-graph/resolvers');

function testMultiModuleResolver() {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wb-java-test-'));
  fs.mkdirSync(path.join(tmpDir, 'module-a', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'module-a', 'src', 'main', 'java', 'com', 'example', 'Foo.java'), '');

  const resolved = resolveJavaImport('com.example.Foo', tmpDir);
  assert(resolved && resolved.includes('module-a'), `Expected multi-module resolve, got ${resolved}`);

  // 清理
  fs.rmSync(tmpDir, { recursive: true });
}

testMultiModuleResolver();
console.log('java-resolver-test: OK');
```

### 5.2 回归测试

```bash
npm run test:analysis
npm run test:audit-diff
npm run test:functionality
```

**关键检查点：**
- `test/functionality-test.js` 中的 Java polyglot 测试不挂
- `test/affected-tests-heuristic-test.js` 中的 Java 命名规范测试不挂
- `audit-diff` 的 JSON 输出schema不变（新增字段 `confidence` 是允许的，不破坏现有 consumers）

### 5.3 真实项目验证

选一个 Spring Boot 项目（如 [spring-projects/spring-petclinic](https://github.com/spring-projects/spring-petclinic)）：

```bash
node cli.js audit-summary --cwd <project> --json --quiet | jq '.deadExports.deadExportCount'
node cli.js audit-file --cwd <project> --file src/main/java/.../OwnerController.java --json --quiet | jq '.impact.impactCount'
```

**验收：**
1. `deadExports` 中 parseMode 为 ast 的文件confidence为 high，regex 为 medium
2. 多模块项目无大面积 unresolved
3. 运行时间不比改前慢 >20%

---

## 六、风险与回滚

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| javalang 安装失败导致所有 Java 解析降级为 regex | 中 | Java 分析质量无提升 | 脚本头部检测 + Node 层自动回退，用户无感知 |
| `parseJava` 改为 async 后，dep-graph.js 中某处遗漏 await | 低 | Promise 对象被当数组用，运行时异常 | 全局搜索 `parseJava(`，确保所有调用点有 await；TypeScript 可避免此类问题 |
| 多模块 source root 扫描导致大目录性能下降 | 低 | 索引变慢 | 只在 resolve 时扫描，不重复；缓存结果 |
| Kotlin/Go/Rust regex 误报率高 | 中 | 孤儿检测/死导出不准 | 明确标记 parseMode: 'regex' + confidence: 'medium'，不误导用户 |

**回滚策略：**
- 任何子任务失败，git revert 对应 commit 即可
- 旧 regex 逻辑全部保留，AST 解析是"叠加"而非"替换"

---

## 七、决策记录（ADR）

### ADR-1：Java AST 解析器用 javalang（Python），不用 tree-sitter

**背景：** Java AST 需要精确解析注释、泛型、注解、lambda 等复杂语法。
**选项：**
- A. `javalang`（Python pip）：与现有 Python AST 子进程模式一致，开发快
- B. tree-sitter-java（Node native）：需新增 npm 依赖 + native 编译，与 AGENTS.md "工程克制"冲突
- C. 手写 tokenizer（Python stdlib）：零依赖但工作量大，维护成本高

**决策：** 选 A。
**理由：**
1. 与 `python_ast_parser.py` 的子进程模式完全一致，Node 侧代码可复制粘贴
2. javalang 是成熟库，能处理 Java 8~17 语法
3. 新增依赖在 Python 侧，不污染 `package.json`

### ADR-2：Kotlin/Go/Rust 只做 regex 级，不做 AST

**背景：** 新语言扩展需要控制投入。
**决策：** 只做 regex 提取 import/export + 文件索引 + 技术栈检测。
**理由：**
1. 这些语言的真实用户场景还不明确，先验证"能否被发现"
2. Go/Rust 的模块系统与 JS/Python/Java 差异大，AST 级解析投入过高
3. regex 级已能提供孤儿检测和基础依赖图，满足 80% 的 audit-overview 需求

### ADR-3：不做语言插件注册表（本次）

**背景：** 架构评估指出硬编码 if-else 链是扩展瓶颈。
**决策：** 本次计划保留硬编码链，不引入注册表抽象。
**理由：**
1. 当前只有 3 种实质语言 + 3 种新语言，硬编码的维护成本还可接受
2. 引入注册表需要重构 parsers.js/resolvers.js/file-index.js/dep-graph.js/stack-detector.js 五个文件，工作量 >3 天，与本计划"2~3 天交付 Java AST"的目标冲突
3. 注册表重构作为后续独立项目（ROADMAP Phase 5+）

---

## 八、文件改动清单（最终版）

| 优先级 | 文件 | 改动类型 | 预估行数 | 所属 Phase |
|--------|------|----------|----------|------------|
| P0 | `scripts/java_ast_parser.py` | 新增 | ~120 | A1 |
| P0 | `src/services/dep-graph/parsers.js` | 改 | +80 | A2, B2 |
| P0 | `src/services/dep-graph.js` | 改 | +10 | A3, B5, C1 |
| P0 | `src/services/dep-graph/resolvers.js` | 改 | +40 | A4, B3 |
| P0 | `src/services/file-index.js` | 改 | +40 | A5, B1 |
| P0 | `src/utils/stack-detector.js` | 改 | +50 | A6, B4 |
| P0 | `src/utils/path.js` | 改 | +10 | B1 (hasGo/hasRust) |
| P1 | `test/java-parsers-test.js` | 新增 | ~60 | 测试 |
| P1 | `test/java-resolver-test.js` | 新增 | ~40 | 测试 |
| P2 | `ROADMAP.md` | 改 | ~5 | C2 |
| P2 | `CHANGELOG.md` | 改 | ~5 | C2 |
| P2 | `skills/workspace-audit/SKILL.md` | 改 | +25 | C2 |

**总计：** 约 480 行新增/修改，3 个新文件。

---

*方案版本：v1.0*  
*状态：已决策，可立即执行*  
*下一步动作：安装 javalang (`pip install javalang`)，开始编写 `scripts/java_ast_parser.py`*
