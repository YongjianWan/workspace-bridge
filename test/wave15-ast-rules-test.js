#!/usr/bin/env node
// @contract — AST Rules Engine validation

const assert = require('assert');
const path = require('path');
const { checkFileRules, checkAllRules, RULES, EXT_TO_LANGUAGE } = require('../src/services/dep-graph/ast-rules');
const { parseJava } = require('../src/services/dep-graph/parsers');
const { parseKotlin } = require('../src/services/dep-graph/parsers/kotlin-ast');
const { parseJavaScript } = require('../src/services/dep-graph/parsers/js.js');
const { parsePython } = require('../src/services/dep-graph/parsers/python.js');
const { parseGo } = require('../src/services/dep-graph/parsers/go-ast.js');
const { parseRust } = require('../src/services/dep-graph/parsers/rust-ast.js');
const { parseCppAst } = require('../src/services/dep-graph/parsers/cpp-ast.js');

function testBatchNoTransactionalFires() {
  const info = {
    originalPath: 'src/main/java/com/example/MyService.java',
    functionRecords: [
      {
        name: 'batchUpdateUser',
        decorators: [], // No @Transactional decorator
      }
    ]
  };

  const findings = checkFileRules('MyService.java', info);
  assert.strictEqual(findings.length, 1, 'Expected 1 finding for batch method lacking @Transactional');
  assert.strictEqual(findings[0].symbol, 'batchUpdateUser');
  assert.strictEqual(findings[0].severity, 'medium');
  assert.ok(findings[0].message.includes('lacks @Transactional'));
}

function testBatchWithTransactionalSkipped() {
  const info = {
    originalPath: 'src/main/java/com/example/MyService.java',
    functionRecords: [
      {
        name: 'batchUpdateUser',
        decorators: ['Transactional'], // With @Transactional decorator
      },
      {
        name: 'batchDeleteUser',
        decorators: ['@Transactional(readOnly = false)'],
      }
    ]
  };

  const findings = checkFileRules('MyService.java', info);
  assert.strictEqual(findings.length, 0, 'Expected 0 findings for batch methods with @Transactional');
}

function testRuleLanguageFilter() {
  // Java rule should not apply to Python file
  const info = {
    originalPath: 'src/main/python/my_script.py',
    functionRecords: [
      {
        name: 'batch_update',
        decorators: [],
      }
    ]
  };

  const findings = checkFileRules('my_script.py', info);
  assert.strictEqual(findings.length, 0, 'Java rule should not fire on python file');
}

function testCustomRuleViaConfig() {
  const info = {
    originalPath: 'src/main/ts/index.ts',
    functionRecords: [
      {
        name: 'typedFunc',
        isExported: true,
        kind: 'function',
        returnType: 'number',
      },
      {
        name: 'myFunc',
        isExported: true,
        kind: 'function',
        // no returnType; file has TS evidence via typedFunc
      }
    ]
  };

  // 1. Test built-in typescript rule: exported-function-no-return-type
  const findings1 = checkFileRules('index.ts', info);
  assert.strictEqual(findings1.length, 1, 'TS exported function with no return type should trigger built-in rule');
  assert.strictEqual(findings1[0].symbol, 'myFunc');
  assert.ok(findings1[0].id.includes('exported-function-no-return-type'), findings1[0].id);

  // 2. Test custom rules input
  const customRules = [
    {
      id: 'custom-no-foo',
      language: ['typescript'],
      match: (fn) => fn.name === 'myFunc',
      severity: 'high',
      message: (fn) => `${fn.name} matches custom pattern`,
    }
  ];

  const findings2 = checkFileRules('index.ts', info, customRules);
  // Should trigger both TS returnType rule and our custom rule
  assert.strictEqual(findings2.length, 2, 'Expected 2 findings (1 built-in, 1 custom)');
  const customFinding = findings2.find(f => f.id.includes('custom-no-foo'));
  assert.ok(customFinding);
  assert.strictEqual(customFinding.severity, 'high');
}

function testExtensionToLanguageConfigTable() {
  assert.strictEqual(EXT_TO_LANGUAGE['.java'], 'java');
  assert.strictEqual(EXT_TO_LANGUAGE['.kt'], 'kotlin');
  assert.strictEqual(EXT_TO_LANGUAGE['.ts'], 'typescript');
  assert.strictEqual(EXT_TO_LANGUAGE['.tsx'], 'typescript');

  assert.strictEqual(EXT_TO_LANGUAGE['.py'], 'python');
  assert.strictEqual(EXT_TO_LANGUAGE['.go'], 'go');
  assert.strictEqual(EXT_TO_LANGUAGE['.rs'], 'rust');
  assert.strictEqual(EXT_TO_LANGUAGE['.c'], 'cpp');
  assert.strictEqual(EXT_TO_LANGUAGE['.cpp'], 'cpp');
  assert.strictEqual(EXT_TO_LANGUAGE['.vue'], 'vue');
  assert.strictEqual(EXT_TO_LANGUAGE['.svelte'], 'svelte');

  // JS-family extensions added for cross-language rules
  assert.strictEqual(EXT_TO_LANGUAGE['.js'], 'javascript');
  assert.strictEqual(EXT_TO_LANGUAGE['.jsx'], 'javascript');
  assert.strictEqual(EXT_TO_LANGUAGE['.mjs'], 'javascript');
  assert.strictEqual(EXT_TO_LANGUAGE['.cjs'], 'javascript');
  assert.strictEqual(EXT_TO_LANGUAGE['.mts'], 'typescript');
  assert.strictEqual(EXT_TO_LANGUAGE['.cts'], 'typescript');
  assert.strictEqual(EXT_TO_LANGUAGE['.cc'], 'cpp');
  assert.strictEqual(EXT_TO_LANGUAGE['.h'], 'cpp');
  assert.strictEqual(EXT_TO_LANGUAGE['.hpp'], 'cpp');
}

function testNewLanguageMappingsFireCustomRules() {
  const customRule = {
    id: 'parity-smoke-test',
    language: ['python', 'go', 'rust', 'cpp', 'vue', 'svelte'],
    match: (fn) => fn.name === 'paritySmoke',
    severity: 'info',
    message: (fn) => `${fn.name} matched`,
  };

  const cases = [
    { ext: '.py', path: 'src/main.py' },
    { ext: '.go', path: 'src/main.go' },
    { ext: '.rs', path: 'src/main.rs' },
    { ext: '.c', path: 'src/main.c' },
    { ext: '.cpp', path: 'src/main.cpp' },
    { ext: '.vue', path: 'src/main.vue' },
    { ext: '.svelte', path: 'src/main.svelte' },
  ];

  for (const { path: originalPath } of cases) {
    const info = {
      originalPath,
      functionRecords: [{ name: 'paritySmoke' }],
    };
    const findings = checkFileRules(originalPath, info, [customRule]);
    assert.strictEqual(findings.length, 1, `Expected custom rule to fire for ${originalPath}`);
    assert.strictEqual(findings[0].symbol, 'paritySmoke');
  }
}

function testCheckAllRules() {
  const graph = new Map([
    [
      'file1.java',
      {
        originalPath: 'file1.java',
        functionRecords: [
          { name: 'batchRun', decorators: [] }
        ]
      }
    ],
    [
      'file2.ts',
      {
        originalPath: 'file2.ts',
        functionRecords: [
          { name: 'doSomething', isExported: true, returnType: 'void', kind: 'function' }
        ]
      }
    ]
  ]);

  const findings = checkAllRules(graph);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].symbol, 'batchRun');
}

/* -------------------------------------------------------------------------- */
// Cross-language rule unit tests
/* -------------------------------------------------------------------------- */

function testJsNoReturnTypeFiresWhenFileUsesTypes() {
  const info = {
    originalPath: 'utils.ts',
    functionRecords: [
      { name: 'typed', isExported: true, kind: 'function', returnType: 'number' },
      { name: 'untyped', isExported: true, kind: 'function' },
      { name: 'internal', isExported: false, kind: 'function' },
    ],
  };
  const findings = checkFileRules('utils.ts', info);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].symbol, 'untyped');
  assert.ok(findings[0].id.includes('exported-function-no-return-type'));
}

function testJsNoReturnTypeSkippedInPlainJs() {
  const info = {
    originalPath: 'utils.js',
    functionRecords: [
      { name: 'untyped', isExported: true, kind: 'function' },
    ],
  };
  const findings = checkFileRules('utils.js', info);
  assert.strictEqual(findings.length, 0, 'plain JS file with no TS evidence should not fire');
}

function testPythonNoTypeHintsFires() {
  const info = {
    originalPath: 'service.py',
    functionRecords: [
      {
        name: 'process',
        isExported: true,
        kind: 'function',
        fingerprint: { paramCount: 2 },
        returnType: null,
        hasParameterTypeHints: false,
      },
    ],
  };
  const findings = checkFileRules('service.py', info);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].symbol, 'process');
  assert.ok(findings[0].id.includes('public-function-no-type-hints'));
}

function testPythonNoTypeHintsSkippedWhenHintsPresent() {
  const info = {
    originalPath: 'service.py',
    functionRecords: [
      {
        name: 'process',
        isExported: true,
        kind: 'function',
        fingerprint: { paramCount: 2 },
        returnType: null,
        hasParameterTypeHints: true,
      },
    ],
  };
  const findings = checkFileRules('service.py', info);
  assert.strictEqual(findings.length, 0, 'function with parameter hints should not fire');
}

function testPythonNoTypeHintsSkippedWhenNoParams() {
  const info = {
    originalPath: 'service.py',
    functionRecords: [
      {
        name: 'process',
        isExported: true,
        kind: 'function',
        fingerprint: { paramCount: 0 },
        returnType: null,
        hasParameterTypeHints: false,
      },
    ],
  };
  const findings = checkFileRules('service.py', info);
  assert.strictEqual(findings.length, 0, 'parameter-less function should not fire');
}

function testGoMissingErrorReturnFiresForMutator() {
  const info = {
    originalPath: 'service.go',
    functionRecords: [
      { name: 'CreateUser', isExported: true, kind: 'function' },
    ],
  };
  const findings = checkFileRules('service.go', info);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].symbol, 'CreateUser');
  assert.ok(findings[0].id.includes('exported-function-missing-error-return'));
}

function testGoMissingErrorReturnSkippedForNonMutatorWithReturn() {
  const info = {
    originalPath: 'service.go',
    functionRecords: [
      { name: 'GetUser', isExported: true, kind: 'function', returnType: '*User' },
    ],
  };
  const findings = checkFileRules('service.go', info);
  assert.strictEqual(findings.length, 0, 'non-mutating helper with return type should not fire');
}

function testGoMissingErrorReturnSkippedWhenErrorPresent() {
  const info = {
    originalPath: 'service.go',
    functionRecords: [
      { name: 'CreateUser', isExported: true, kind: 'function', returnType: '(*User, error)' },
      { name: 'String', isExported: true, kind: 'function' },
    ],
  };
  const findings = checkFileRules('service.go', info);
  assert.strictEqual(findings.length, 0);
}

function testRustNoReturnTypeFires() {
  const info = {
    originalPath: 'lib.rs',
    functionRecords: [
      { name: 'run', isExported: true, kind: 'function', returnType: null },
    ],
  };
  const findings = checkFileRules('lib.rs', info);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].symbol, 'run');
  assert.ok(findings[0].id.includes('public-function-no-return-type'));
}

function testRustNoReturnTypeSkippedWhenPresent() {
  const info = {
    originalPath: 'lib.rs',
    functionRecords: [
      { name: 'run', isExported: true, kind: 'function', returnType: 'Result<(), Error>' },
      { name: 'internal', isExported: false, kind: 'function' },
    ],
  };
  const findings = checkFileRules('lib.rs', info);
  assert.strictEqual(findings.length, 0);
}

function testCppNoReturnTypeFires() {
  const info = {
    originalPath: 'api.h',
    functionRecords: [
      { name: 'init', isExported: true, kind: 'function', returnType: null },
      { name: 'Helper', isExported: false, kind: 'function', returnType: null },
    ],
  };
  const findings = checkFileRules('api.h', info);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].symbol, 'init');
  assert.ok(findings[0].id.includes('exported-function-no-return-type'));
}

function testCppNoReturnTypeSkippedWhenPresent() {
  const info = {
    originalPath: 'api.cpp',
    functionRecords: [
      { name: 'init', isExported: true, kind: 'function', returnType: 'int' },
    ],
  };
  const findings = checkFileRules('api.cpp', info);
  assert.strictEqual(findings.length, 0);
}

function testMultiLanguageCheckAllRulesFindsThreeLanguages() {
  const graph = new Map([
    [
      'service.java',
      {
        originalPath: 'service.java',
        functionRecords: [{ name: 'batchRun', decorators: [] }],
      }
    ],
    [
      'service.go',
      {
        originalPath: 'service.go',
        functionRecords: [{ name: 'CreateUser', isExported: true, kind: 'function' }],
      }
    ],
    [
      'lib.rs',
      {
        originalPath: 'lib.rs',
        functionRecords: [{ name: 'run', isExported: true, kind: 'function', returnType: null }],
      }
    ],
    [
      'service.py',
      {
        originalPath: 'service.py',
        functionRecords: [
          {
            name: 'process',
            isExported: true,
            kind: 'function',
            fingerprint: { paramCount: 1 },
            returnType: null,
            hasParameterTypeHints: false,
          },
        ],
      }
    ],
  ]);

  const findings = checkAllRules(graph);
  assert.ok(findings.length >= 3, `Expected at least 3 findings, got ${findings.length}`);
  const ruleIds = new Set(findings.map((f) => f.id.split(':')[1]));
  const languages = new Set(findings.map((f) => EXT_TO_LANGUAGE[path.extname(f.file)]));
  assert.ok(languages.size >= 3, `Expected findings from >=3 languages, got ${[...languages].join(', ')}`);
  assert.ok(ruleIds.has('batch-no-transactional'));
  assert.ok(ruleIds.has('exported-function-missing-error-return'));
}

/* -------------------------------------------------------------------------- */
// E2E tests via real parsers
/* -------------------------------------------------------------------------- */

async function testJavaBatchNoTransactionalE2E() {
  const source = `
public class MyService {
    @Transactional
    public void batchUpdateUser() {}

    public void batchDeleteUser() {}
}
`;
  const parsed = await parseJava(source);
  const info = {
    originalPath: 'src/main/java/com/example/MyService.java',
    functionRecords: parsed.functionRecords,
  };

  const findings = checkFileRules('MyService.java', info);
  assert.strictEqual(findings.length, 1, 'Expected 1 finding for un-annotated batch method');
  assert.strictEqual(findings[0].symbol, 'batchDeleteUser');
  assert.ok(findings[0].message.includes('lacks @Transactional'));
}

async function testKotlinBatchNoTransactionalE2E() {
  const source = `
class MyService {
    @Transactional
    fun batchUpdateUser() {}

    fun batchDeleteUser() {}
}
`;
  const parsed = await parseKotlin(source);
  const info = {
    originalPath: 'src/main/kotlin/com/example/MyService.kt',
    functionRecords: parsed.functionRecords,
  };

  const findings = checkFileRules('MyService.kt', info);
  assert.strictEqual(findings.length, 1, 'Expected 1 finding for un-annotated Kotlin batch method');
  assert.strictEqual(findings[0].symbol, 'batchDeleteUser');
  assert.ok(findings[0].message.includes('lacks @Transactional'));
}

function testTypeScriptPublicMethodNoReturnTypeE2E() {
  const source = `
export function compute(): number { return 1; }
export function infer() { return 1; }
function internal() {}
`;
  const parsed = parseJavaScript(source, 'src/utils.ts');
  const info = {
    originalPath: 'src/utils.ts',
    functionRecords: parsed.functionRecords,
  };

  const findings = checkFileRules('utils.ts', info);
  assert.strictEqual(findings.length, 1, 'Expected 1 finding for exported TS function without return type');
  assert.strictEqual(findings[0].symbol, 'infer');
  assert.ok(findings[0].id.includes('exported-function-no-return-type'));
}

function testJavaScriptNoReturnTypeSkippedInPlainJsE2E() {
  const source = `
export function compute() { return 1; }
export function infer() { return 1; }
`;
  const parsed = parseJavaScript(source, 'src/utils.js');
  const info = {
    originalPath: 'src/utils.js',
    functionRecords: parsed.functionRecords,
  };

  const findings = checkFileRules('utils.js', info);
  assert.strictEqual(findings.length, 0, 'Plain JS files should not fire return-type rule');
}

function testJavaScriptParameterTypeOnlyTriggersE2E() {
  const source = `
export function compute(x: number) { return x; }
`;
  const parsed = parseJavaScript(source, 'src/utils.ts');
  const info = {
    originalPath: 'src/utils.ts',
    functionRecords: parsed.functionRecords,
  };

  const findings = checkFileRules('utils.ts', info);
  assert.strictEqual(findings.length, 1, 'Expected 1 finding for exported TS function with only parameter type hints');
  assert.strictEqual(findings[0].symbol, 'compute');
  assert.ok(findings[0].id.includes('exported-function-no-return-type'));
}

function testVueNoReturnTypeE2E() {
  const source = `
<script setup lang="ts">
export function compute(): number { return 1; }
export function infer() { return 1; }
</script>
`;
  const parsed = parseJavaScript(source, 'src/utils.vue');
  const info = {
    originalPath: 'src/utils.vue',
    functionRecords: parsed.functionRecords,
  };

  const findings = checkFileRules('utils.vue', info);
  assert.strictEqual(findings.length, 1, 'Expected 1 finding for exported Vue/TS function without return type');
  assert.strictEqual(findings[0].symbol, 'infer');
}

function testSvelteNoReturnTypeE2E() {
  const source = `
<script lang="ts">
export function compute(): number { return 1; }
export function infer() { return 1; }
</script>
`;
  const parsed = parseJavaScript(source, 'src/utils.svelte');
  const info = {
    originalPath: 'src/utils.svelte',
    functionRecords: parsed.functionRecords,
  };

  const findings = checkFileRules('utils.svelte', info);
  assert.strictEqual(findings.length, 1, 'Expected 1 finding for exported Svelte/TS function without return type');
  assert.strictEqual(findings[0].symbol, 'infer');
}

async function testPythonNoTypeHintsE2E() {
  const source = `
def process(a, b):
    pass

def typed(x: int) -> str:
    return ""

def no_params():
    pass
`;
  const parsed = await parsePython(source);
  const info = {
    originalPath: 'src/service.py',
    functionRecords: parsed.functionRecords,
  };

  const findings = checkFileRules('service.py', info);
  assert.strictEqual(findings.length, 1, 'Expected 1 finding for untyped public function with params');
  assert.strictEqual(findings[0].symbol, 'process');
  assert.ok(findings[0].id.includes('public-function-no-type-hints'));
}

async function testPythonTypeCommentSkippedE2E() {
  const source = `
def typed_by_comment(x):  # type: (int) -> None
    pass
`;
  const parsed = await parsePython(source);
  const info = {
    originalPath: 'src/service.py',
    functionRecords: parsed.functionRecords,
  };

  const findings = checkFileRules('service.py', info);
  assert.strictEqual(findings.length, 0, 'type comments should count as type hints');
}

async function testGoMissingErrorReturnE2E() {
  const source = `
package service

func CreateUser(name string) *User { return nil }
func GetUser(id string) (*User, error) { return nil, nil }
func String() string { return "" }
`;
  const parsed = await parseGo(source);
  const info = {
    originalPath: 'src/service.go',
    functionRecords: parsed.functionRecords,
  };

  const findings = checkFileRules('service.go', info);
  assert.strictEqual(findings.length, 1, 'Expected 1 finding for mutator missing error');
  assert.strictEqual(findings[0].symbol, 'CreateUser');
  assert.ok(findings[0].id.includes('exported-function-missing-error-return'));
}

async function testRustNoReturnTypeE2E() {
  const source = `
pub fn run() {}
pub fn typed() -> i32 { 1 }
fn internal() {}
`;
  const parsed = await parseRust(source);
  const info = {
    originalPath: 'src/lib.rs',
    functionRecords: parsed.functionRecords,
  };

  const findings = checkFileRules('lib.rs', info);
  assert.strictEqual(findings.length, 1, 'Expected 1 finding for public Rust function without return type');
  assert.strictEqual(findings[0].symbol, 'run');
  assert.ok(findings[0].id.includes('public-function-no-return-type'));
}

async function testCppNoReturnTypeE2E() {
  const source = `
publicFunc() { return 1; }
int typedFunc() { return 1; }
static void internalFunc() {}
`;
  const parsed = await parseCppAst(source, 'api.c');
  const info = {
    originalPath: 'api.c',
    functionRecords: parsed.functionRecords,
  };

  const findings = checkFileRules('api.c', info);
  assert.strictEqual(findings.length, 1, 'Expected 1 finding for exported C function without return type');
  assert.strictEqual(findings[0].symbol, 'publicFunc');
  assert.ok(findings[0].id.includes('exported-function-no-return-type'));
}

/* -------------------------------------------------------------------------- */
// Runner
/* -------------------------------------------------------------------------- */
const tests = [
  testBatchNoTransactionalFires,
  testBatchWithTransactionalSkipped,
  testRuleLanguageFilter,
  testCustomRuleViaConfig,
  testExtensionToLanguageConfigTable,
  testNewLanguageMappingsFireCustomRules,
  testCheckAllRules,
  testJsNoReturnTypeFiresWhenFileUsesTypes,
  testJsNoReturnTypeSkippedInPlainJs,
  testPythonNoTypeHintsFires,
  testPythonNoTypeHintsSkippedWhenHintsPresent,
  testPythonNoTypeHintsSkippedWhenNoParams,
  testGoMissingErrorReturnFiresForMutator,
  testGoMissingErrorReturnSkippedForNonMutatorWithReturn,
  testGoMissingErrorReturnSkippedWhenErrorPresent,
  testRustNoReturnTypeFires,
  testRustNoReturnTypeSkippedWhenPresent,
  testCppNoReturnTypeFires,
  testCppNoReturnTypeSkippedWhenPresent,
  testMultiLanguageCheckAllRulesFindsThreeLanguages,
  testJavaBatchNoTransactionalE2E,
  testKotlinBatchNoTransactionalE2E,
  testTypeScriptPublicMethodNoReturnTypeE2E,
  testJavaScriptNoReturnTypeSkippedInPlainJsE2E,
  testJavaScriptParameterTypeOnlyTriggersE2E,
  testVueNoReturnTypeE2E,
  testSvelteNoReturnTypeE2E,
  testPythonNoTypeHintsE2E,
  testPythonTypeCommentSkippedE2E,
  testGoMissingErrorReturnE2E,
  testRustNoReturnTypeE2E,
  testCppNoReturnTypeE2E,
];

(async () => {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      passed++;
      console.log(`  PASS ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${t.name}: ${err.message}`);
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  if (failed > 0) process.exit(1);
  else process.exit(0);
})();
