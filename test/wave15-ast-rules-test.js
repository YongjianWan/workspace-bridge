#!/usr/bin/env node
// @contract — AST Rules Engine validation

const assert = require('assert');
const { checkFileRules, checkAllRules, RULES } = require('../src/services/dep-graph/ast-rules');

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
// Runner
/* -------------------------------------------------------------------------- */
const tests = [
  testBatchNoTransactionalFires,
  testBatchWithTransactionalSkipped,
  testRuleLanguageFilter,
  testCustomRuleViaConfig,
  testCheckAllRules,
];

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t();
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
