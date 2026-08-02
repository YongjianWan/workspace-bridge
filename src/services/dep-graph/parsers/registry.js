/**
 * Language registry — single source of truth for all 9 supported languages.
 *
 * Design reference: GitNexus language registration pattern (AGENTS.md §Reference).
 */

const { defineLanguage, LanguageRegistry } = require('./registry-core');
const { parsePython } = require('./python');
const { parseJavaScript } = require('./js');
const { parseJava } = require('./java');
const { parseGo } = require('./go-ast');
const { parseRust } = require('./rust-ast');
const { parseKotlin } = require('./kotlin-ast');
const { parseVue } = require('./vue');
const { parseCppAst } = require('./cpp-ast');
const { parseSvelte } = require('./svelte');

// Import strategies directly from resolvers to populate resolveStrategies
const { tryAlias, tryRelativeWithExtensions } = require('../resolvers/javascript');
const { tryPythonRelative, tryPythonAbsolute } = require('../resolvers/python');
const { tryJava } = require('../resolvers/java');
const { tryGoRelative, tryGoModule } = require('../resolvers/go');
const { tryRustCrate, tryRustSuper, tryRustScoped } = require('../resolvers/rust');
const { tryCppInclude, CPP_BUILTINS } = require('../resolvers/cpp');

const registry = new LanguageRegistry();

// -----------------------------------------------------------------------------
// Built-in standard library definitions
// -----------------------------------------------------------------------------
// Python and Go have no isBuiltIn declaration: both languages own a structural
// zero-list gate (sys.stdlib_module_names via resolvers/python-stdlib.js;
// go.mod module path via _isExternalGoModule), so a hand-copied name list here
// was dead config — the gated fallback in resolvers.js never reaches gated
// languages (deleted 2026-08-01, L3-15).

// CPP_BUILTINS lives in resolvers/cpp.js (single home, imported above) —
// the resolver gate and this isBuiltIn declaration share the same list.

// JVM stdlib prefixes — one home for both JVM languages' isBuiltIn (the
// resolver gate consults lang.isBuiltIn). jdk.*/sun.*/com.sun.* are
// JDK-internal territory exactly like java.*. kotlinx.* is deliberately NOT
// here: it is a published library (org.jetbrains.kotlinx), owned by the
// manifest gate, not the runtime.
const JVM_STDLIB_PREFIXES = ['java.', 'javax.', 'jdk.', 'sun.', 'com.sun.'];
const isJvmStdlibImport = (imp) => JVM_STDLIB_PREFIXES.some((p) => imp.startsWith(p));

// -----------------------------------------------------------------------------
// Language Registrations
// -----------------------------------------------------------------------------

registry.register(defineLanguage({
  language: 'javascript',
  extensions: ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.mts', '.cts'],
  parse: parseJavaScript,
  async: false,
  needsFilePath: true,
  filePatterns: ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx', '**/*.mjs', '**/*.cjs', '**/*.mts', '**/*.cts'],
  condition: (workspace) => workspace.hasPackageJson,
  isBuiltIn: (imp) => imp.startsWith('node:') || require('module').builtinModules.includes(imp),
  resolveStrategies: [tryAlias, tryRelativeWithExtensions],
  // T6 (2026-07-31): zero true-positive symbol-table edges in four measured
  // JS/TS repos (5528 edges total); failure mode is zero-tolerance to export
  // hygiene (one sloppy re-export → 212 fabricated edges).
  symbolTableFallback: false,
  extractSymbols: (content) => {
    const symbols = [];
    content.split('\n').forEach((line, idx) => {
      const classMatch = line.match(/(?:export\s+)?(?:default\s+)?class\s+(\w+)/);
      const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      const constMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*=/);
      if (classMatch) {
        symbols.push({ name: classMatch[1], type: 'class', line: idx + 1, signature: line.trim() });
      } else if (funcMatch) {
        symbols.push({ name: funcMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
      } else if (constMatch) {
        symbols.push({ name: constMatch[1], type: 'constant', line: idx + 1, signature: line.trim() });
      }
    });
    return symbols;
  }
}));

registry.register(defineLanguage({
  language: 'python',
  extensions: ['.py'],
  parse: parsePython,
  async: true,
  needsWorkspaceRoot: true,
  filePatterns: ['**/*.py'],
  condition: (workspace) => workspace.hasPythonFiles || workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy,
  resolveStrategies: [tryPythonRelative, tryPythonAbsolute],
  // T6 (2026-07-31): zero true-positive symbol-table edges in two measured
  // Python repos (924 edges total); tryPythonAbsolute already covers the
  // structural cases.
  symbolTableFallback: false,
  extractSymbols: (content) => {
    const symbols = [];
    content.split('\n').forEach((line, idx) => {
      const classMatch = line.match(/^class\s+(\w+)/);
      const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)/);
      if (classMatch) {
        symbols.push({ name: classMatch[1], type: 'class', line: idx + 1, signature: line.trim() });
      } else if (funcMatch) {
        symbols.push({ name: funcMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
      }
    });
    return symbols;
  }
}));

registry.register(defineLanguage({
  language: 'java',
  extensions: ['.java'],
  parse: parseJava,
  async: true,
  needsWorkspaceRoot: true,
  filePatterns: ['**/*.java'],
  condition: (workspace) => workspace.hasJava,
  isBuiltIn: (imp) => isJvmStdlibImport(imp),
  resolveStrategies: [tryJava],
  extractSymbols: (content) => {
    const symbols = [];
    content.split('\n').forEach((line, idx) => {
      const typeMatch = line.match(/\b(?:public\s+)?(?:abstract\s+|final\s+)?(class|interface|enum|record)\s+(\w+)/);
      if (typeMatch) {
        symbols.push({ name: typeMatch[2], type: typeMatch[1], line: idx + 1, signature: line.trim() });
      }
      const methodMatch = line.match(/\bpublic\s+(?:static\s+)?(?:[\w<>,[\]\s]+)\s+(\w+)\s*\(/);
      if (methodMatch) {
        symbols.push({ name: methodMatch[1], type: 'method', line: idx + 1, signature: line.trim() });
      }
    });
    return symbols;
  }
}));

registry.register(defineLanguage({
  language: 'kotlin',
  extensions: ['.kt'],
  parse: parseKotlin,
  async: true,
  filePatterns: ['**/*.kt'],
  condition: (workspace) => workspace.hasJava,
  isBuiltIn: (imp) => isJvmStdlibImport(imp) || imp.startsWith('kotlin.'),
  resolveStrategies: [tryJava],
  extractSymbols: (content) => {
    const symbols = [];
    content.split('\n').forEach((line, idx) => {
      const typeMatch = line.match(/\b(?:public\s+)?(?:abstract\s+|open\s+|data\s+)?(class|interface|object|enum)\s+(\w+)/);
      if (typeMatch) {
        symbols.push({ name: typeMatch[2], type: typeMatch[1], line: idx + 1, signature: line.trim() });
      }
      const funMatch = line.match(/\bfun\s+(\w+)\s*\(/);
      if (funMatch) {
        symbols.push({ name: funMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
      }
    });
    return symbols;
  }
}));

registry.register(defineLanguage({
  language: 'go',
  extensions: ['.go'],
  parse: parseGo,
  async: true,
  filePatterns: ['**/*.go'],
  condition: (workspace) => workspace.hasGo,
  resolveStrategies: [tryGoRelative, tryGoModule],
  extractSymbols: (content) => {
    const symbols = [];
    content.split('\n').forEach((line, idx) => {
      const typeMatch = line.match(/\btype\s+(\w+)/);
      const funcMatch = line.match(/\bfunc\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/);
      if (typeMatch) {
        symbols.push({ name: typeMatch[1], type: 'type', line: idx + 1, signature: line.trim() });
      } else if (funcMatch) {
        symbols.push({ name: funcMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
      }
    });
    return symbols;
  }
}));

registry.register(defineLanguage({
  language: 'rust',
  extensions: ['.rs'],
  parse: parseRust,
  async: true,
  filePatterns: ['**/*.rs'],
  condition: (workspace) => workspace.hasRust,
  isBuiltIn: (imp) => imp === 'std' || imp === 'core' || imp === 'alloc',
  resolveStrategies: [tryRustCrate, tryRustSuper, tryRustScoped],
  extractSymbols: (content) => {
    const symbols = [];
    content.split('\n').forEach((line, idx) => {
      const fnMatch = line.match(/\bfn\s+(\w+)\s*\(/);
      const structMatch = line.match(/\bstruct\s+(\w+)/);
      if (fnMatch) {
        symbols.push({ name: fnMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
      } else if (structMatch) {
        symbols.push({ name: structMatch[1], type: 'struct', line: idx + 1, signature: line.trim() });
      }
    });
    return symbols;
  }
}));

registry.register(defineLanguage({
  language: 'vue',
  extensions: ['.vue'],
  parse: parseVue,
  async: false,
  needsFilePath: true,
  filePatterns: ['**/*.vue'],
  condition: (workspace) => workspace.hasPackageJson,
  isBuiltIn: () => false,
  resolveStrategies: [tryAlias, tryRelativeWithExtensions],
  // T6: JS family — same gate, same failure mode as javascript (script block
  // IS JS/TS). No direct vue measurement; droppedImports accounting covers.
  symbolTableFallback: false,
  extractSymbols: (content) => {
    // Vue delegates to JS/TS script block or empty
    const symbols = [];
    const scriptBlock = content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    if (scriptBlock) {
      const scriptContent = scriptBlock[1];
      scriptContent.split('\n').forEach((line, idx) => {
        const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
        const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
        const constMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*=/);
        if (classMatch) {
          symbols.push({ name: classMatch[1], type: 'class', line: idx + 1, signature: line.trim() });
        } else if (funcMatch) {
          symbols.push({ name: funcMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
        } else if (constMatch) {
          symbols.push({ name: constMatch[1], type: 'constant', line: idx + 1, signature: line.trim() });
        }
      });
    }
    return symbols;
  }
}));

registry.register(defineLanguage({
  language: 'cpp',
  extensions: ['.c', '.cpp', '.cc', '.h', '.hpp'],
  parse: parseCppAst,
  async: true,
  needsFilePath: true,
  filePatterns: ['**/*.c', '**/*.cpp', '**/*.cc', '**/*.h', '**/*.hpp'],
  condition: (workspace) => workspace.hasCpp,
  isBuiltIn: (imp) => CPP_BUILTINS.has(imp),
  // tryCppInclude owns quote-form relative semantics; tryRelativeWithExtensions
  // stays for the rare explicit './x.h'. tryAlias (tsconfig paths) is gone —
  // it never meant anything for C/C++ (L1-4).
  resolveStrategies: [tryCppInclude, tryRelativeWithExtensions],
  extractSymbols: () => [] // C++ uses AST-only symbol extraction
}));

registry.register(defineLanguage({
  language: 'svelte',
  extensions: ['.svelte'],
  parse: parseSvelte,
  async: false,
  needsFilePath: true,
  filePatterns: ['**/*.svelte'],
  condition: (workspace) => workspace.hasPackageJson,
  isBuiltIn: () => false,
  resolveStrategies: [tryAlias, tryRelativeWithExtensions],
  // T6: JS family — same gate, same failure mode as javascript (script block
  // IS JS/TS). No direct svelte measurement; droppedImports accounting covers.
  symbolTableFallback: false,
  extractSymbols: (content) => {
    const symbols = [];
    const scriptBlock = content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    if (scriptBlock) {
      const scriptContent = scriptBlock[1];
      scriptContent.split('\n').forEach((line, idx) => {
        const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
        const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
        const constMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*=/);
        if (classMatch) {
          symbols.push({ name: classMatch[1], type: 'class', line: idx + 1, signature: line.trim() });
        } else if (funcMatch) {
          symbols.push({ name: funcMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
        } else if (constMatch) {
          symbols.push({ name: constMatch[1], type: 'constant', line: idx + 1, signature: line.trim() });
        }
      });
    }
    return symbols;
  }
}));

module.exports = { registry, defineLanguage, LanguageRegistry };
