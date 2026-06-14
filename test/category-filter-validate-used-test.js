#!/usr/bin/env node
// @contract — category-filter.validateCategories must be used by validate-args category validation

const assert = require('assert');
const { parseCliArgs } = require('../src/cli/validate-args');
const { validateCategories } = require('../src/tools/category-filter');

function testValidateCategoriesExported() {
  assert.strictEqual(typeof validateCategories, 'function', 'validateCategories should be exported');
}

function testValidateCategoriesBehavior() {
  assert.deepStrictEqual(validateCategories(''), { valid: true, requested: [], invalid: [] });
  assert.deepStrictEqual(validateCategories(null), { valid: true, requested: [], invalid: [] });

  const single = validateCategories('dead-exports');
  assert.strictEqual(single.valid, true);
  assert.deepStrictEqual(single.requested, ['dead-exports']);
  assert.deepStrictEqual(single.invalid, []);

  const multi = validateCategories('dead-exports,smells');
  assert.strictEqual(multi.valid, true);
  assert.deepStrictEqual(multi.requested, ['dead-exports', 'smells']);

  const bad = validateCategories('invalid,dead-exports,nope');
  assert.strictEqual(bad.valid, false);
  assert.deepStrictEqual(bad.requested, ['invalid', 'dead-exports', 'nope']);
  assert.deepStrictEqual(bad.invalid, ['invalid', 'nope']);
}

function testValidateArgsUsesCategoryFilter() {
  // validate-args.js should require category-filter so that category validation
  // does not duplicate the category set maintained in category-filter.js.
  const validateArgsModule = require.cache[require.resolve('../src/cli/validate-args')];
  const children = validateArgsModule?.children?.map((c) => c.filename) || [];
  assert.ok(
    children.includes(require.resolve('../src/tools/category-filter')),
    'validate-args should depend on category-filter for category validation'
  );
}

function testInvalidCategoryStillRejected() {
  try {
    parseCliArgs(['node', 'cli.js', '--category', 'invalid']);
    assert.fail('Expected invalid category to throw');
  } catch (err) {
    assert.strictEqual(err.code, 'VALIDATION_ERROR');
    assert.ok(err.message.includes('Invalid --category value'), err.message);
  }
}

function testValidCategoryAccepted() {
  const parsed = parseCliArgs(['node', 'cli.js', '--category', 'dead-exports,smells']);
  assert.strictEqual(parsed.category, 'dead-exports,smells');
}

function main() {
  const tests = [
    testValidateCategoriesExported,
    testValidateCategoriesBehavior,
    testValidateArgsUsesCategoryFilter,
    testInvalidCategoryStillRejected,
    testValidCategoryAccepted,
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
}

main();
