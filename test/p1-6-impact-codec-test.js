#!/usr/bin/env node
// @semantic
/**
 * P1-6：precomputed_impact 持久化体积压缩（审查报告修复方向：路径压缩）。
 *
 * affectedTests / impactRadius 每条记录里全路径（含 via 链）反复出现，
 * Django 实测 precomputed_impact 占 194.6MB（整个库 413MB）。编解码器把
 * 路径换成行内字典索引 + 根前缀剥离，解码时字符串驻留，要求往返无损。
 */
const assert = require('assert');
const {
  createImpactEncoder,
  createImpactDecoder,
  V2_GZIP_PREFIX,
} = require('../src/services/dep-graph/impact-codec');

const ROOT_PREFIX = 'c:/proj/';

function sampleData() {
  const affectedTests = [
    { file: ROOT_PREFIX + 'src/a.py', distance: 1, source: 'graph', via: [ROOT_PREFIX + 'src/b.py'] },
    { file: ROOT_PREFIX + 'src/c.py', distance: 0, source: 'conftest', via: [] },
    { file: 'd:/elsewhere/x.py', distance: 2, source: 'graph', via: [ROOT_PREFIX + 'src/a.py', 'd:/elsewhere/x.py'] },
  ];
  const impactRadius = [
    { file: ROOT_PREFIX + 'src/b.py', level: 1, via: [ROOT_PREFIX + 'src/a.py'], importedSymbols: ['foo'] },
    { file: ROOT_PREFIX + 'src/d.py', level: 3, via: [], importedSymbols: [] },
  ];
  return { affectedTests, impactRadius };
}

function testRoundTrip() {
  const { affectedTests, impactRadius } = sampleData();
  const encode = createImpactEncoder(ROOT_PREFIX);
  const encoded = encode(affectedTests, impactRadius);
  assert.strictEqual(typeof encoded, 'string');
  assert(encoded.startsWith(V2_GZIP_PREFIX), 'encoded payload must carry the v2g marker');

  const decode = createImpactDecoder(ROOT_PREFIX);
  const decoded = decode(encoded);
  assert.deepStrictEqual(decoded.affectedTests, affectedTests, 'affectedTests round-trip must be lossless');
  assert.deepStrictEqual(decoded.impactRadius, impactRadius, 'impactRadius round-trip must be lossless');
}

function testDecodedPathsAreAbsoluteAgain() {
  const { affectedTests } = sampleData();
  const encode = createImpactEncoder(ROOT_PREFIX);
  const decode = createImpactDecoder(ROOT_PREFIX);
  const decoded = decode(encode(affectedTests, null));
  for (const t of decoded.affectedTests) {
    assert(t.file.startsWith(ROOT_PREFIX) || t.file.includes(':/'), `path must be restored to full form, got ${t.file}`);
    for (const v of t.via || []) {
      assert(v.includes(':/'), `via path must be restored to full form, got ${v}`);
    }
  }
}

function testInterningSharesStrings() {
  const shared = ROOT_PREFIX + 'src/shared.py';
  const affectedTests = Array.from({ length: 50 }, () => ({ file: shared, distance: 1, via: [shared] }));
  const decode = createImpactDecoder(ROOT_PREFIX);
  const decoded = decode(createImpactEncoder(ROOT_PREFIX)(affectedTests, null));
  assert.strictEqual(decoded.affectedTests[0].file, decoded.affectedTests[49].file, 'identical paths must share one string instance');
}

function testLegacyPassthrough() {
  const legacy = JSON.stringify([{ file: '/abs/x.py', distance: 1 }]);
  const decode = createImpactDecoder(ROOT_PREFIX);
  assert.strictEqual(decode(legacy), legacy, 'legacy JSON string must pass through untouched');
  assert.strictEqual(decode(null), null);
  assert.strictEqual(decode(undefined), undefined);
  const alreadyObject = { affectedTests: [], impactRadius: null };
  assert.strictEqual(decode(alreadyObject), alreadyObject, 'non-string payload passes through');
}

function testSizeReduction() {
  // 模拟 Django 形态：数百条记录、长根前缀、via 链重复引用同批路径。
  const longRoot = 'c:/users/somebody/desktop/随机小项目/eval/truth/repos/python/django/';
  const pool = Array.from({ length: 120 }, (_, i) => longRoot + 'django/contrib/app' + (i % 30) + '/models.py');
  const affectedTests = Array.from({ length: 800 }, (_, i) => ({
    file: pool[i % pool.length],
    distance: i % 7,
    source: 'graph',
    via: [pool[(i + 1) % pool.length], pool[(i + 2) % pool.length]],
  }));
  const impactRadius = Array.from({ length: 800 }, (_, i) => ({
    file: pool[(i * 3) % pool.length],
    level: i % 5,
    via: [pool[(i + 5) % pool.length]],
    importedSymbols: [],
  }));
  const naive = JSON.stringify({ affectedTests, impactRadius }).length;
  const encoded = createImpactEncoder(longRoot)(affectedTests, impactRadius).length;
  assert(
    encoded < naive * 0.3,
    `gzip+dict payload should be under 30% of the naive JSON size (encoded=${encoded}, naive=${naive})`
  );
}

function testCorruptedGzipReturnsNull() {
  const decode = createImpactDecoder(ROOT_PREFIX);
  assert.strictEqual(decode(V2_GZIP_PREFIX + '!!!not-base64!!!'), null, 'corrupted blob must decode to null, not throw');
}

function testNullRadiusSurvives() {
  const { affectedTests } = sampleData();
  const decode = createImpactDecoder(ROOT_PREFIX);
  const decoded = decode(createImpactEncoder(ROOT_PREFIX)(affectedTests, null));
  assert.strictEqual(decoded.impactRadius, null, 'null impactRadius must decode back to null, not []');
  const withRadius = decode(createImpactEncoder(ROOT_PREFIX)(affectedTests, []));
  assert.deepStrictEqual(withRadius.impactRadius, [], 'empty array radius must stay []');
}

function main() {
  testRoundTrip();
  testDecodedPathsAreAbsoluteAgain();
  testInterningSharesStrings();
  testLegacyPassthrough();
  testSizeReduction();
  testNullRadiusSurvives();
  testCorruptedGzipReturnsNull();
  console.log('p1-6-impact-codec-test: PASS');
}

main();
