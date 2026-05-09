/**
 * Scaffold detector tests — conservative fingerprinting for known templates.
 */
const assert = require('assert');
const { detectScaffold, SCAFFOLD_FINGERPRINTS } = require('../src/tools/scaffold-detector');

function testExactBasenameRuoYi() {
  const cases = [
    { path: '/project/src/main/java/com/ruoyi/common/core/domain/model/LoginUser.java', expect: 'ruoyi-java' },
    { path: 'LoginUser.java', expect: 'ruoyi-java' },
    { path: '/a/b/AbstractQuartzJob.java', expect: 'ruoyi-java' },
    { path: 'XssHttpServletRequestWrapper.java', expect: 'ruoyi-java' },
    { path: 'SysUser.java', expect: 'ruoyi-java' },
    { path: 'SensitiveJsonSerializer.java', expect: 'ruoyi-java' },
  ];
  for (const c of cases) {
    const result = detectScaffold(c.path);
    assert.ok(result, `expected match for ${c.path}`);
    assert.strictEqual(result.name, c.expect, `expected ${c.expect} for ${c.path}`);
    assert.strictEqual(result.reason, 'scaffold-ruoyi');
  }
  console.log('exact-basename-ruoyi: ok');
}

function testExactBasenameVueAdmin() {
  const cases = [
    { path: '/project/src/ruoyi.js', expect: 'vue-admin' },
    { path: 'ruoyi.js', expect: 'vue-admin' },
    { path: 'Permission.js', expect: 'vue-admin' },
    { path: 'validate.js', expect: 'vue-admin' },
  ];
  for (const c of cases) {
    const result = detectScaffold(c.path);
    assert.ok(result, `expected match for ${c.path}`);
    assert.strictEqual(result.name, c.expect);
    assert.strictEqual(result.reason, 'scaffold-vue-admin');
  }
  console.log('exact-basename-vue-admin: ok');
}

function testPathPatternRuoYi() {
  // StringUtils.java is generic; only scaffold when path contains "ruoyi"
  const scaffold = detectScaffold('/project/src/main/java/com/ruoyi/common/utils/StringUtils.java');
  assert.ok(scaffold, 'StringUtils under ruoyi path should match');
  assert.strictEqual(scaffold.name, 'ruoyi-java');

  const nonScaffold = detectScaffold('/project/src/main/java/org/apache/commons/lang3/StringUtils.java');
  assert.strictEqual(nonScaffold, null, 'StringUtils outside ruoyi path should NOT match');

  // Constants.java generic outside ruoyi
  const nonScaffold2 = detectScaffold('/project/src/main/java/com/example/Constants.java');
  assert.strictEqual(nonScaffold2, null);

  // Constants.java under ruoyi
  const scaffold2 = detectScaffold('/project/src/main/java/com/ruoyi/common/Constants.java');
  assert.ok(scaffold2);
  assert.strictEqual(scaffold2.name, 'ruoyi-java');

  console.log('path-pattern-ruoyi: ok');
}

function testPathPatternVueAdmin() {
  // ruoyi/ directory marker
  const scaffold = detectScaffold('/project/src/components/ruoyi/SvgIcon.vue');
  assert.ok(scaffold);
  assert.strictEqual(scaffold.name, 'vue-admin');

  const nonScaffold = detectScaffold('/project/src/components/SharedButton.vue');
  assert.strictEqual(nonScaffold, null);

  // generator/ directory marker
  const scaffold2 = detectScaffold('/project/src/views/tool/generator/index.js');
  assert.ok(scaffold2);
  assert.strictEqual(scaffold2.name, 'vue-admin');

  console.log('path-pattern-vue-admin: ok');
}

function testNonScaffoldNotMatched() {
  const cases = [
    '/project/src/utils/helper.js',
    '/project/src/main/java/com/example/UserService.java',
    '/project/src/main/java/com/example/UserController.java',
    '/project/src/views/Home.vue',
    '/project/src/components/Button.vue',
    'index.js',
    'utils.js',
    'HttpStatus.java', // outside ruoyi path
    'StringUtils.java', // outside ruoyi path
  ];
  for (const c of cases) {
    const result = detectScaffold(c);
    assert.strictEqual(result, null, `${c} should not match any scaffold`);
  }
  console.log('non-scaffold-not-matched: ok');
}

function testNullAndEmpty() {
  assert.strictEqual(detectScaffold(null), null);
  assert.strictEqual(detectScaffold(''), null);
  assert.strictEqual(detectScaffold(undefined), null);
  console.log('null-and-empty: ok');
}

function testFingerprintRegistryIntegrity() {
  // Every fingerprint must have required fields
  for (const fp of SCAFFOLD_FINGERPRINTS) {
    assert.ok(fp.name, 'fingerprint must have name');
    assert.ok(fp.reason, 'fingerprint must have reason');
    assert.ok(fp.description, 'fingerprint must have description');
    assert.ok(fp.exactBasenames instanceof Set, 'exactBasenames must be a Set');
    assert.ok(Array.isArray(fp.pathPatterns), 'pathPatterns must be an array');
    for (const pp of fp.pathPatterns) {
      assert.ok(pp.marker instanceof RegExp, 'pathPattern.marker must be a RegExp');
      assert.ok(pp.regex instanceof RegExp, 'pathPattern.regex must be a RegExp');
    }
  }
  console.log('fingerprint-registry-integrity: ok');
}

function main() {
  testExactBasenameRuoYi();
  testExactBasenameVueAdmin();
  testPathPatternRuoYi();
  testPathPatternVueAdmin();
  testNonScaffoldNotMatched();
  testNullAndEmpty();
  testFingerprintRegistryIntegrity();
  console.log('\nscaffold-detector-test: all ok');
}

main();
