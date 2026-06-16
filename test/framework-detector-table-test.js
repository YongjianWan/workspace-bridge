#!/usr/bin/env node
// @semantic

const assert = require('assert');
const { FRAMEWORK_RULES, detectFrameworkFromPath, ENTRY_WEIGHT } = require('../src/utils/project-context');

function testFrameworkRulesExported() {
  assert(Array.isArray(FRAMEWORK_RULES), 'FRAMEWORK_RULES should be exported as an array');
  assert(FRAMEWORK_RULES.length > 0, 'FRAMEWORK_RULES should not be empty');
  for (const language of FRAMEWORK_RULES) {
    assert(Array.isArray(language.rules), 'each language block must contain a rules array');
    assert(
      language.rules.every((r) => Array.isArray(r) && r.length === 2 && typeof r[0] === 'function' && r[1] && typeof r[1] === 'object'),
      'each rule must be a [function, resultObject] tuple'
    );
  }
}

function testDetectFrameworkBehaviorPreserved() {
  // JS/TS
  assert.deepStrictEqual(
    detectFrameworkFromPath('src/app/page.tsx'),
    { framework: 'nextjs-app', reason: 'nextjs-app-page', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH }
  );
  assert.deepStrictEqual(
    detectFrameworkFromPath('src/pages/about.tsx'),
    { framework: 'nextjs-pages', reason: 'nextjs-page', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH }
  );
  assert.strictEqual(detectFrameworkFromPath('src/components/Button.tsx').framework, 'react');

  // Python
  assert.deepStrictEqual(
    detectFrameworkFromPath('blog/views.py'),
    { framework: 'django', reason: 'django-views', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH }
  );
  assert.deepStrictEqual(
    detectFrameworkFromPath('api/routers/users.py'),
    { framework: 'fastapi', reason: 'api-routers', isEntry: true, entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH }
  );

  // Java
  assert.deepStrictEqual(
    detectFrameworkFromPath('src/main/java/com/example/controller/UserController.java'),
    { framework: 'spring', reason: 'spring-controller', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH }
  );
  assert.deepStrictEqual(
    detectFrameworkFromPath('src/main/java/com/example/UserController.java'),
    { framework: 'spring', reason: 'spring-controller-file', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH }
  );

  // Vue
  assert.deepStrictEqual(
    detectFrameworkFromPath('src/pages/Home.vue'),
    { framework: 'vue-router', reason: 'vue-page', isEntry: true, entryPointWeight: ENTRY_WEIGHT.HIGH }
  );

  // Unknown / unsupported
  assert.strictEqual(detectFrameworkFromPath('README.md'), null);
  assert.strictEqual(detectFrameworkFromPath('unknown.xyz'), null);
}

function testFrameworkRulesMutuallyExclusiveWithinLanguage() {
  // The first matching rule wins; verify a path with multiple possible matches
  // returns the higher-priority (earlier) result.
  const appPage = detectFrameworkFromPath('app/page.tsx');
  assert.strictEqual(appPage.framework, 'nextjs-app', '/app/page.tsx should match before generic routes');

  const pagesApi = detectFrameworkFromPath('pages/api/users.ts');
  assert.strictEqual(pagesApi.framework, 'nextjs-api', '/pages/api/ should match before /pages/');
}

function main() {
  testFrameworkRulesExported();
  testDetectFrameworkBehaviorPreserved();
  testFrameworkRulesMutuallyExclusiveWithinLanguage();
  console.log('framework-detector-table-test.js: all passed');
}

main();
