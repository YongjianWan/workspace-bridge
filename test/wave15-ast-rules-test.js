#!/usr/bin/env node
// @contract — AST Rules Engine validation

const assert = require('assert');
const { checkFileRules, checkAllRules, RULES, EXT_TO_LANGUAGE } = require('../src/services/dep-graph/ast-rules');
const { parseJava } = require('../src/services/dep-graph/parsers');
const { parseKotlin } = require('../src/services/dep-graph/parsers/kotlin-ast');
const { parseJavaScript } = require('../src/services/dep-graph/parsers/js.js');

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
        name: 'myFunc',
        isExported: true,
        kind: 'function',
        // no returnType
      }
    ]
  };

  // 1. Test built-in typescript rule: public-method-no-return-type
  const findings1 = checkFileRules('index.ts', info);
  assert.strictEqual(findings1.length, 1, 'TS exported function with no return type should trigger built-in rule');
  assert.strictEqual(findings1[0].symbol, 'myFunc');

  // 2. Test custom rules input
  const customRules = [
    {
      id: 'custom-no-foo',
      language: ['typescript'],
      match: (fn) => fn.name.includes('Func'),
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
  assert.ok(findings[0].id.includes('public-method-no-return-type'));
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
  testJavaBatchNoTransactionalE2E,
  testKotlinBatchNoTransactionalE2E,
  testTypeScriptPublicMethodNoReturnTypeE2E,
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
