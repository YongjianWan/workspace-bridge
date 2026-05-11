#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectMavenModules, detectStack } = require('../src/utils/stack-detectors/detect');

// ============================================================================
// Test: detectMavenModules — single module
// ============================================================================
function testDetectMavenModulesSingle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-maven-single-'));
  fs.writeFileSync(
    path.join(dir, 'pom.xml'),
    '<?xml version="1.0"?><project><modules><module>core</module></modules></project>',
    'utf8'
  );
  fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'core', 'pom.xml'), '<?xml version="1.0"?><project/>', 'utf8');

  const result = detectMavenModules(dir);
  assert(Array.isArray(result), 'should return array for valid multi-module');
  assert.strictEqual(result.length, 1, 'should detect one module');
  assert.strictEqual(result[0].name, 'core', 'module name should be directory name');
  assert.strictEqual(result[0].dir, 'core', 'module dir should match');

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// Test: detectMavenModules — multiple modules
// ============================================================================
function testDetectMavenModulesMultiple() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-maven-multi-'));
  fs.writeFileSync(
    path.join(dir, 'pom.xml'),
    '<?xml version="1.0"?><project><modules><module>app</module><module>lib</module></modules></project>',
    'utf8'
  );
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'pom.xml'), '<?xml version="1.0"?><project/>', 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'pom.xml'), '<?xml version="1.0"?><project/>', 'utf8');

  const result = detectMavenModules(dir);
  assert.strictEqual(result.length, 2, 'should detect two modules');
  assert(result.some((m) => m.name === 'app'), 'should include app module');
  assert(result.some((m) => m.name === 'lib'), 'should include lib module');

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// Test: detectMavenModules — no modules element
// ============================================================================
function testDetectMavenModulesNoModules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-maven-none-'));
  fs.writeFileSync(
    path.join(dir, 'pom.xml'),
    '<?xml version="1.0"?><project><artifactId>single</artifactId></project>',
    'utf8'
  );

  const result = detectMavenModules(dir);
  assert.strictEqual(result, null, 'should return null when no modules');

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// Test: detectMavenModules — submodule missing pom.xml filtered out
// ============================================================================
function testDetectMavenModulesMissingSubPom() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-maven-miss-'));
  fs.writeFileSync(
    path.join(dir, 'pom.xml'),
    '<?xml version="1.0"?><project><modules><module>valid</module><module>ghost</module></modules></project>',
    'utf8'
  );
  fs.mkdirSync(path.join(dir, 'valid'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'valid', 'pom.xml'), '<?xml version="1.0"?><project/>', 'utf8');
  // ghost/ exists but no pom.xml
  fs.mkdirSync(path.join(dir, 'ghost'), { recursive: true });

  const result = detectMavenModules(dir);
  assert.strictEqual(result.length, 1, 'should filter out module without pom.xml');
  assert.strictEqual(result[0].name, 'valid', 'only valid module should remain');

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// Test: detectStack — Maven multi-module injects modules into java stack
// ============================================================================
function testDetectStackMavenModules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-maven-stack-'));
  fs.writeFileSync(
    path.join(dir, 'pom.xml'),
    '<?xml version="1.0"?><project><modules><module>api</module><module>service</module></modules></project>',
    'utf8'
  );
  fs.mkdirSync(path.join(dir, 'api'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'service'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'api', 'pom.xml'), '<?xml version="1.0"?><project/>', 'utf8');
  fs.writeFileSync(path.join(dir, 'service', 'pom.xml'), '<?xml version="1.0"?><project/>', 'utf8');

  const stack = detectStack(dir);
  assert(stack.java, 'should detect java stack');
  assert.strictEqual(stack.java.buildTool, 'maven', 'buildTool should be maven');
  assert(Array.isArray(stack.java.modules), 'java.modules should be array');
  assert.strictEqual(stack.java.modules.length, 2, 'should have two modules');
  assert(stack.java.modules.some((m) => m.name === 'api'), 'should include api module');
  assert(stack.java.modules.some((m) => m.name === 'service'), 'should include service module');
  // Backward compatibility: subprojects alias
  assert.deepStrictEqual(stack.java.subprojects, stack.java.modules, 'subprojects should alias modules');

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// Test: generateCommands — Maven multi-module produces -pl commands
// ============================================================================
function testMavenModuleCommands() {
  const { generateCommands } = require('../src/utils/stack-detectors/commands');
  const mavenStack = {
    profile: 'java-first',
    packageManager: 'maven',
    java: {
      enabled: true,
      buildTool: 'maven',
      buildCommand: 'mvn',
      linters: [],
      modules: [
        { name: 'app', dir: 'app' },
        { name: 'lib', dir: 'lib' },
      ],
    },
  };

  const single = generateCommands(mavenStack, 'code', ['app/src/main/java/App.java']);
  const compileCheck = single.smoke.find((c) => c.name === 'java-compile-check');
  assert(compileCheck, 'Maven multi-module should have compile check');
  assert(compileCheck.cmd.includes('-pl app'), `Maven compile should target module: ${compileCheck.cmd}`);
  assert(compileCheck.cmd.includes('-am'), `Maven compile should include -am: ${compileCheck.cmd}`);
  assert(!compileCheck.cmd.includes('lib'), `Maven compile should not target unaffected module: ${compileCheck.cmd}`);

  const focusedTest = single.focused.find((c) => c.name === 'java-focused-tests');
  assert(focusedTest, 'Maven multi-module should have focused tests');
  assert(focusedTest.cmd.includes('-pl app'), `Maven focused test should target module: ${focusedTest.cmd}`);

  const multi = generateCommands(mavenStack, 'code', ['app/src/main/java/App.java', 'lib/src/main/java/Lib.java']);
  const multiCompile = multi.smoke.find((c) => c.name === 'java-compile-check');
  assert(multiCompile.cmd.includes('-pl app,lib') || multiCompile.cmd.includes('-pl lib,app'), `Multi-module compile should include both: ${multiCompile.cmd}`);

  // Single-module fallback (no modules)
  const singleStack = {
    profile: 'java-first',
    packageManager: 'maven',
    java: {
      enabled: true,
      buildTool: 'maven',
      buildCommand: 'mvn',
      linters: [],
    },
  };
  const singleFallback = generateCommands(singleStack, 'code', ['src/main/java/App.java']);
  const fallbackCompile = singleFallback.smoke.find((c) => c.name === 'java-compile-check');
  assert(!fallbackCompile.cmd.includes('-pl'), `Single-module Maven should not have -pl: ${fallbackCompile.cmd}`);
}

function main() {
  testDetectMavenModulesSingle();
  testDetectMavenModulesMultiple();
  testDetectMavenModulesNoModules();
  testDetectMavenModulesMissingSubPom();
  testDetectStackMavenModules();
  testMavenModuleCommands();

  console.log('maven-module-detection-test: all 6 passed');
}

main();
