// @semantic
//
// JVM manifest v1 (L2-11 follow-up): readJvmDeps(root) merges third-party
// groupIds from pom.xml / build.gradle[.kts] / gradle/libs.versions.toml, and
// the JVM gate consults them in the two degraded scenes the zero-list gate
// cannot cover: an empty workspacePackages (gate off) and a coarse-prefix
// collision (com.company workspace vs com.company.sharedlib dependency).
// Safety direction: a workspace package as specific as the declared groupId
// always wins (reactor module present as source beats its own pom line), and
// "no manifest" or "no declared match" falls back to pre-v1 behavior.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
// 缓存隔离靠每个用例独立的 mkdtemp 目录（_jvmDepsCache 以 root 为 key），
// 同目录改写的 testMtimeCacheInvalidation 自己用 utimesSync 顶开 mtime 别名
// —— 都不需要 clearResolverCaches。
const { readJvmDeps } = require('../src/services/dep-graph/resolvers/base');
const { isExternalDependency } = require('../src/services/dep-graph/resolvers');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// readJvmDeps — extraction
// ---------------------------------------------------------------------------

function testPomExtraction() {
  const dir = makeTempDir('wb-jvm-pom-');
  try {
    fs.writeFileSync(path.join(dir, 'pom.xml'), `<?xml version="1.0"?>
<project>
  <groupId>com.example.own</groupId>
  <artifactId>app</artifactId>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.0</version>
  </parent>
  <dependencies>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>33.0.0-jre</version>
    </dependency>
    <!-- commented-out dependency must not count
    <dependency>
      <groupId>com.commented.out</groupId>
      <artifactId>ghost</artifactId>
    </dependency>
    -->
    <dependency>
      <groupId>\${some.property}</groupId>
      <artifactId>interpolated</artifactId>
    </dependency>
  </dependencies>
</project>
`, 'utf8');

    const deps = readJvmDeps(dir);
    assert(deps instanceof Set, 'pom.xml present → Set');
    assert(deps.has('org.springframework.boot'), 'parent groupId is third-party evidence');
    assert(deps.has('com.google.guava'), 'dependency groupId extracted');
    assert(!deps.has('com.example.own'), 'project own groupId must be excluded');
    assert(!deps.has('com.commented.out'), 'commented-out dependency must be excluded');
    assert(![...deps].some((g) => g.includes('$')), 'property placeholders name nothing concrete');
  } finally {
    cleanupTempDir(dir);
  }
}

function testGradleExtraction() {
  const dir = makeTempDir('wb-jvm-gradle-');
  try {
    fs.writeFileSync(path.join(dir, 'build.gradle'), `
plugins { id 'org.jetbrains.kotlin.jvm' }
group = 'com.example.own'
dependencies {
  implementation 'com.google.guava:guava:33.0.0-jre'
  testImplementation "org.junit.jupiter:junit-jupiter:5.10.0"
}
`, 'utf8');
    fs.writeFileSync(path.join(dir, 'build.gradle.kts'), `
dependencies {
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
`, 'utf8');

    const deps = readJvmDeps(dir);
    assert(deps.has('com.google.guava'), 'groovy single-quote coordinate');
    assert(deps.has('org.junit.jupiter'), 'groovy double-quote coordinate');
    assert(deps.has('com.squareup.okhttp3'), 'kotlin-dsl coordinate');
    assert(!deps.has('com.example.own'), 'gradle own group has no colon → never matched');
    assert(!deps.has('org.jetbrains.kotlin.jvm'), 'plugin id has no coordinate shape');
  } finally {
    cleanupTempDir(dir);
  }
}

function testVersionCatalogExtraction() {
  const dir = makeTempDir('wb-jvm-toml-');
  try {
    fs.mkdirSync(path.join(dir, 'gradle'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'gradle', 'libs.versions.toml'), `
[versions]
guava = "33.0.0-jre"

[libraries]
guava = { module = "com.google.guava:guava", version.ref = "guava" }
gson = "com.google.code.gson:gson:2.10.1" # trailing comment
not-a-dep = "just-a-string"

[plugins]
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version = "1.9.0" }
`, 'utf8');

    const deps = readJvmDeps(dir);
    assert(deps.has('com.google.guava'), 'module = "group:artifact" form');
    assert(deps.has('com.google.code.gson'), 'shorthand "group:artifact:version" form');
    assert(!deps.has('org.jetbrains.kotlin.jvm'), '[plugins] section never names a library');
  } finally {
    cleanupTempDir(dir);
  }
}

function testNoManifestReturnsNull() {
  const dir = makeTempDir('wb-jvm-none-');
  try {
    assert.strictEqual(readJvmDeps(dir), null, 'no manifest files → null (no evidence, gate step skipped)');
  } finally {
    cleanupTempDir(dir);
  }
}

function testMtimeCacheInvalidation() {
  const dir = makeTempDir('wb-jvm-cache-');
  try {
    const pomPath = path.join(dir, 'pom.xml');
    fs.writeFileSync(pomPath, '<project><dependencies></dependencies></project>', 'utf8');
    assert.strictEqual(readJvmDeps(dir).size, 0, 'empty pom → empty set (legitimate, not null)');

    fs.writeFileSync(pomPath, '<project><dependencies><dependency><groupId>com.added.later</groupId><artifactId>x</artifactId></dependency></dependencies></project>', 'utf8');
    // mtimeMs resolution can alias two writes inside the same tick — pin it.
    fs.utimesSync(pomPath, new Date(), new Date(Date.now() + 5000));
    assert(readJvmDeps(dir).has('com.added.later'), 'manifest rewrite must invalidate the cache');
  } finally {
    cleanupTempDir(dir);
  }
}

// ---------------------------------------------------------------------------
// Gate integration — _isExternalJvmPackage via isExternalDependency
// ---------------------------------------------------------------------------

function writeGuavaPom(dir) {
  fs.writeFileSync(path.join(dir, 'pom.xml'), `<project>
  <groupId>com.company</groupId>
  <dependencies>
    <dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId></dependency>
    <dependency><groupId>com.company.sharedlib</groupId><artifactId>shared</artifactId></dependency>
  </dependencies>
</project>`, 'utf8');
}

function testGateEmptyPackageSetUsesManifest() {
  const dir = makeTempDir('wb-jvm-gate-empty-');
  try {
    writeGuavaPom(dir);
    const ctx = { workspacePackages: new Set() };
    assert.strictEqual(
      isExternalDependency('com.google.common.collect.Lists', '.java', dir, ctx),
      true,
      'empty package set: declared groupId (via guava alias) → external'
    );
    assert.strictEqual(
      isExternalDependency('com.company.core.Foo', '.java', dir, ctx),
      false,
      'empty package set + no declared match → gate stays off (pre-v1 behavior)'
    );
  } finally {
    cleanupTempDir(dir);
  }
}

function testGateCollisionManifestOverridesCoarsePrefix() {
  const dir = makeTempDir('wb-jvm-gate-collide-');
  try {
    writeGuavaPom(dir);
    // Coarse workspace package com.company vs declared third-party
    // com.company.sharedlib — the zero-list prefix rule alone would call the
    // import internal and let symbol-table guess it.
    const ctx = { workspacePackages: new Set(['com.company']) };
    assert.strictEqual(
      isExternalDependency('com.company.sharedlib.Foo', '.java', dir, ctx),
      true,
      'declared groupId beats a coarser workspace prefix'
    );
  } finally {
    cleanupTempDir(dir);
  }
}

function testGateReactorModuleInternalWins() {
  const dir = makeTempDir('wb-jvm-gate-reactor-');
  try {
    writeGuavaPom(dir);
    // Same declared groupId, but the workspace actually hosts sources at that
    // package (multi-module reactor) — real files beat the pom line.
    const ctx = { workspacePackages: new Set(['com.company', 'com.company.sharedlib']) };
    assert.strictEqual(
      isExternalDependency('com.company.sharedlib.Foo', '.java', dir, ctx),
      false,
      'workspace package as specific as the declared groupId → internal wins'
    );
  } finally {
    cleanupTempDir(dir);
  }
}

function testGatePreV1BehaviorPreserved() {
  const dir = makeTempDir('wb-jvm-gate-legacy-');
  try {
    writeGuavaPom(dir);
    const ctx = { workspacePackages: new Set(['com.company.core']) };
    assert.strictEqual(
      isExternalDependency('org.springframework.boot.autoconfigure.SpringBootApplication', '.java', dir, ctx),
      true,
      'no intersection with workspace packages → external (zero-list rule intact)'
    );
    assert.strictEqual(
      isExternalDependency('com.company.core.Foo', '.java', dir, ctx),
      false,
      'workspace prefix intersection → internal (zero-list rule intact)'
    );

    // No manifest at all: declared = null, manifest step must be a no-op.
    const empty = makeTempDir('wb-jvm-gate-nomanifest-');
    try {
      const ctx2 = { workspacePackages: new Set(['com.company.core']) };
      assert.strictEqual(
        isExternalDependency('com.google.common.collect.Lists', '.java', empty, ctx2),
        true,
        'no manifest: non-intersecting import still external via zero-list rule'
      );
      const ctx3 = { workspacePackages: new Set() };
      assert.strictEqual(
        isExternalDependency('com.google.common.collect.Lists', '.java', empty, ctx3),
        false,
        'no manifest + empty package set → gate off (pre-v1 behavior)'
      );
    } finally {
      cleanupTempDir(empty);
    }
  } finally {
    cleanupTempDir(dir);
  }
}

function testGateJdkInternalPrefixes() {
  for (const spec of ['jdk.internal.misc.Unsafe', 'sun.misc.BASE64Decoder', 'com.sun.tools.javac.Main']) {
    assert.strictEqual(
      isExternalDependency(spec, '.java', null, null),
      true,
      `${spec} is JDK-internal territory`
    );
    assert.strictEqual(
      isExternalDependency(spec, '.kt', null, null),
      true,
      `${spec} is JDK-internal territory for Kotlin too`
    );
  }
}

function testGateUmbrellaGroupIdDoesNotShieldThirdParty() {
  // okhttp 实测钓出的 v1 回归（2026-08-02）：catalog 同时有裸伞形 groupId
  // com.squareup（kotlinpoet 就挂在伞下，合法声明）与 com.squareup.zstd；
  // maven-tests 模块的源码包 com.squareup.okhttp3.maventest 在同一伞下。
  // 匹配若取先撞上的伞、守卫若只问「pkg 在 g 之下」，伞下兄弟包会把第三方
  // zstd 误判 internal——pre-v1 零名单本判 external，manifest 层不得做差。
  const dir = makeTempDir('wb-jvm-gate-umbrella-');
  try {
    fs.mkdirSync(path.join(dir, 'gradle'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'gradle', 'libs.versions.toml'), `
[libraries]
kotlinpoet = { module = "com.squareup:kotlinpoet", version = "1.14.2" }
zstd = { module = "com.squareup.zstd:zstd-kmp-okio", version = "0.4.0" }
`, 'utf8');
    const ctx = { workspacePackages: new Set(['okhttp3', 'com.squareup.okhttp3.maventest']) };
    assert.strictEqual(
      isExternalDependency('com.squareup.zstd.okio.zstdCompress', '.kt', dir, ctx),
      true,
      'an umbrella sibling package must not shield a declared third-party import'
    );
  } finally {
    cleanupTempDir(dir);
  }
}

function testGateReactorFinerButNonCoveringPackageIsExternal() {
  // pkg 比 g 更细但不覆盖 base：源码在场的是 .impl 子包，而被 import 的
  // com.company.sharedlib.Foo 并不在工作区——internal 只会让符号表瞎猜。
  const dir = makeTempDir('wb-jvm-gate-noncover-');
  try {
    writeGuavaPom(dir);
    const ctx = { workspacePackages: new Set(['com.company.sharedlib.impl']) };
    assert.strictEqual(
      isExternalDependency('com.company.sharedlib.Foo', '.java', dir, ctx),
      true,
      'a finer package that does not cover the import must not claim it internal'
    );
  } finally {
    cleanupTempDir(dir);
  }
}

function testGateLongestMatchBeatsBareUmbrellaPackage() {
  // 覆盖守卫管不住的分叉角落：workspace 直接把代码放进裸伞包
  // com.squareup（比 okhttp 形状再上一层）。先撞伞的匹配会让 pkg === g 的
  // 守卫放行（internal），最长匹配取到 com.squareup.zstd 后伞包不再够细
  // ——declared 的具体声明才是 import 的真属主。
  const dir = makeTempDir('wb-jvm-gate-longest-');
  try {
    fs.mkdirSync(path.join(dir, 'gradle'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'gradle', 'libs.versions.toml'), `
[libraries]
kotlinpoet = { module = "com.squareup:kotlinpoet", version = "1.14.2" }
zstd = { module = "com.squareup.zstd:zstd-kmp-okio", version = "0.4.0" }
`, 'utf8');
    const ctx = { workspacePackages: new Set(['com.squareup']) };
    assert.strictEqual(
      isExternalDependency('com.squareup.zstd.okio.zstdCompress', '.kt', dir, ctx),
      true,
      'bare umbrella package must not outrank the specific declared groupId'
    );
  } finally {
    cleanupTempDir(dir);
  }
}

function main() {
  testPomExtraction();
  testGradleExtraction();
  testVersionCatalogExtraction();
  testNoManifestReturnsNull();
  testMtimeCacheInvalidation();
  testGateEmptyPackageSetUsesManifest();
  testGateCollisionManifestOverridesCoarsePrefix();
  testGateReactorModuleInternalWins();
  testGatePreV1BehaviorPreserved();
  testGateJdkInternalPrefixes();
  testGateUmbrellaGroupIdDoesNotShieldThirdParty();
  testGateReactorFinerButNonCoveringPackageIsExternal();
  testGateLongestMatchBeatsBareUmbrellaPackage();
  console.log('jvm-manifest-deps: 13/13 passed');
}

main();
