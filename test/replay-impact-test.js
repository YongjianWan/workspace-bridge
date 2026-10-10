#!/usr/bin/env node
// @semantic
/**
 * @slow
 * ROADMAP 5.4 T0.1：eval/replay-impact.js 回放口径（5.2 v1）语义测试。
 *
 * 三层断言：
 *   1) 纯函数 —— 直接调契约导出，核对 5.2 各口径点的精确数值；
 *   2) 夹具 —— 临时目录里用真实 git 生成 4 个提交（新增/删除/重命名/
 *      后置共改 + 笨基线历史截断反例），先用 git log --no-renames 自测
 *      提交与文件集合，再喂给 selectSamples / buildNaiveBaseline；
 *   3) 流水线 —— runReplay 产出的 runs.jsonl / summary.json / summary.md /
 *      sample.json 逐字段核对；验收②另与单独运行
 *      `node cli.js impact --cwd <P> --file <f> --json` 的 impact[].file 对照；
 *   4) --target 模式 —— 经 WB_REPLAY_TRUTH 测试缝把 targets.json 与产出目录
 *      重定向到临时目录后 spawn CLI，覆盖缺失/坏 JSON/未知代号三态错误、
 *      cutoff 首写与沿用、四件套产出，并断言真实 eval/truth 未被触碰。
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO_ROOT, runCli, makeTempDir, cleanupTempDir } = require('./test-helpers');
const {
  isStatFile,
  stemName,
  selectSamples,
  sampleIndices,
  recallOf,
  twoLevelAverage,
  buildNaiveBaseline,
  buildMergedList,
  computeStructuralCeiling,
  classifyEdgeType,
  computeToolOutputs,
  runReplay,
} = require('../eval/replay-impact.js');

/* -------------------------------------------------------------------------- */
/* 基础设施                                                                    */
/* -------------------------------------------------------------------------- */

function git(dir, args, env = {}) {
  const res = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env },
  });
  assert.strictEqual(
    res.status,
    0,
    `git ${args.join(' ')} failed (${res.status}): ${res.error ? res.error.message : ''}\n${res.stderr || ''}`.slice(0, 800)
  );
  return res.stdout;
}

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

const sorted = (arr) => [...arr].sort();
const asHash = (x) => (typeof x === 'string' ? x : x && x.hash);

/* -------------------------------------------------------------------------- */
/* 夹具：4 个提交的小 git 仓库                                                  */
/* -------------------------------------------------------------------------- */

const C1 = '2026-01-01T00:00:00+00:00';
const C2 = '2026-01-02T00:00:00+00:00';
const C3 = '2026-01-03T00:00:00+00:00';
const C4 = '2026-01-04T00:00:00+00:00';

function fixtureCommit(dir, msg, iso) {
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg], {
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  });
}

function buildFixture(dir) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'replay-test@example.com']);
  git(dir, ['config', 'user.name', 'Replay Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);

  // c1：5 个统计文件 + 1 个非统计文件，全部为新增（无输入，不可用）
  writeFile(dir, 'src/api.js', "const util = require('./util.js');\nconst legacy = require('./legacy.js');\nfunction run(v) { return util.fmt(v); }\nmodule.exports = { run, legacy };\n");
  writeFile(dir, 'src/util.js', "function fmt(v) { return String(v); }\nmodule.exports = { fmt };\n");
  writeFile(dir, 'src/legacy.js', "module.exports = { tag: 'legacy' };\n");
  writeFile(dir, 'src/user.js', "module.exports = { name: 'user' };\n");
  writeFile(dir, 'src/orphan.js', "module.exports = { orphan: true };\n");
  writeFile(dir, 'notes.md', '# notes (non-stat file)\n');
  fixtureCommit(dir, 'c1', C1);

  // c2：改 api/util/legacy + 新增 extra —— 第一个可用提交，恰好 3 个输入
  writeFile(dir, 'src/api.js', "const util = require('./util.js');\nconst legacy = require('./legacy.js');\nconst extra = require('./extra.js');\nfunction run(v) { return util.fmt(v) + extra.tag; }\nmodule.exports = { run, legacy };\n");
  writeFile(dir, 'src/util.js', "function fmt(v) { return String(v).trim(); }\nmodule.exports = { fmt };\n");
  writeFile(dir, 'src/legacy.js', "module.exports = { tag: 'legacy-v2' };\n");
  writeFile(dir, 'src/extra.js', "module.exports = { tag: '+extra' };\n");
  fixtureCommit(dir, 'c2', C2);

  // c3：改 user + 改 extra（user×extra 的共改只在本次出现）+ 删 orphan
  writeFile(dir, 'src/user.js', "module.exports = { name: 'user-v2' };\n");
  writeFile(dir, 'src/extra.js', "module.exports = { tag: '+extra-v2' };\n");
  git(dir, ['rm', '-q', 'src/orphan.js']);
  fixtureCommit(dir, 'c3', C3);

  // c4：重命名 util → helpers（--no-renames 视角 = 删旧 + 增新）+ 改 api 修正引用
  git(dir, ['mv', 'src/util.js', 'src/helpers.js']);
  writeFile(dir, 'src/api.js', "const helpers = require('./helpers.js');\nconst legacy = require('./legacy.js');\nconst extra = require('./extra.js');\nfunction run(v) { return helpers.fmt(v) + extra.tag; }\nmodule.exports = { run, legacy };\n");
  fixtureCommit(dir, 'c4', C4);

  return { dir };
}

/** 用 git log --no-renames --name-status 解析提交（按提交时间正序）。 */
function listCommits(dir) {
  const out = git(dir, ['log', '--reverse', '--no-renames', '--name-status', '--format=%x1e%H%x1f%ct%x1f%P']);
  const commits = [];
  for (const rec of out.split('\x1e').filter((s) => s.trim() !== '')) {
    const lines = rec.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    const [hash, ct, parents] = lines[0].split('\x1f');
    const files = lines.slice(1).map((l) => {
      const [status, p] = l.split('\t');
      return { path: p, status };
    });
    commits.push({
      hash,
      ts: Number(ct),
      isMerge: parents.split(' ').filter(Boolean).length > 1,
      files,
    });
  }
  return commits;
}

/** 5.2 输入口径：C 中状态为 M 或 D 的统计文件。 */
function inputsOf(commit) {
  return commit.files
    .filter((f) => (f.status === 'M' || f.status === 'D') && isStatFile(f.path))
    .map((f) => f.path);
}

/** 5.2 真值口径：同提交中除输入外的统计文件，去掉新增（A）。 */
function truthOf(commit, input) {
  return commit.files
    .filter((f) => f.path !== input && f.status !== 'A' && isStatFile(f.path))
    .map((f) => f.path);
}

function addedCountOf(commit) {
  return commit.files.filter((f) => f.status === 'A' && isStatFile(f.path)).length;
}

/**
 * 笨基线历史口径：P 及更早的非合并提交（git log cutoff 即含 cutoff 及祖先），
 * 剔除统计文件超过 20 个的提交，统计与 input 同提交改过的次数。
 */
function coChangeCountsAt(dir, cutoffHash, input) {
  const out = git(dir, ['log', '--no-merges', '--no-renames', '--name-status', '--format=%x1e%H', cutoffHash]);
  const counts = new Map();
  for (const rec of out.split('\x1e').filter((s) => s.trim() !== '')) {
    const lines = rec.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    const paths = lines.slice(1).map((l) => l.split('\t')[1]).filter((p) => p && isStatFile(p));
    if (paths.length > 20) continue;
    if (!paths.includes(input)) continue;
    for (const p of paths) {
      if (p !== input) counts.set(p, (counts.get(p) || 0) + 1);
    }
  }
  return counts;
}

function pFilesAt(dir, commitHash) {
  return git(dir, ['ls-tree', '-r', '--name-only', commitHash])
    .split('\n')
    .map((l) => l.trim())
    .filter((p) => p && isStatFile(p));
}

function parseRuns(outDir) {
  const text = fs.readFileSync(path.join(outDir, 'runs.jsonl'), 'utf8');
  return text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}

function deepKeyValues(obj, out = []) {
  if (Array.isArray(obj)) obj.forEach((v) => deepKeyValues(v, out));
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      out.push([k, v]);
      deepKeyValues(v, out);
    }
  }
  return out;
}

function deepStrings(obj, out = []) {
  if (typeof obj === 'string') out.push(obj);
  else if (Array.isArray(obj)) obj.forEach((v) => deepStrings(v, out));
  else if (obj && typeof obj === 'object') Object.values(obj).forEach((v) => deepStrings(v, out));
  return out;
}

const toRel = (root, p) => {
  let s = String(p);
  if (path.isAbsolute(s)) s = path.relative(root, s);
  return s.replace(/\\/g, '/').replace(/^\.\//, '');
};

/* -------------------------------------------------------------------------- */
/* 1) 纯函数：统计文件与主干名                                                  */
/* -------------------------------------------------------------------------- */

function testIsStatFile() {
  const stat = ['src/a.js', 'src/a.jsx', 'src/a.ts', 'src/a.tsx', 'src/a.vue', 'src/a.py', 'src/a.xml', 'src/x.d.ts'];
  for (const p of stat) assert.strictEqual(isStatFile(p), true, `${p} 应是统计文件`);
  const nonStat = [
    'src/a.mjs', 'src/a.cjs', 'README.md', 'ci.yml',
    'pom.xml', 'src/pom.xml', 'package.json', 'package-lock.json', 'sub/package.json',
    'node_modules/x/y.js', 'src/dist/a.js', 'target/A.java', 'build/z.js', 'app/dist/b.js',
  ];
  for (const p of nonStat) assert.strictEqual(isStatFile(p), false, `${p} 不应计入统计文件`);
  console.log('[ok] isStatFile 统计文件口径');
}

function testStemName() {
  assert.strictEqual(stemName('src/UserServiceImpl.js'), 'User');
  assert.strictEqual(stemName('src/UserMapper.xml'), 'User');
  assert.strictEqual(stemName('src/UserApi.js'), 'User');
  // 反复剥离直到去不动
  assert.strictEqual(stemName('src/OrderRequestReq.js'), 'Order');
  // 区分大小写：小写 query 不是 Query 后缀
  assert.strictEqual(stemName('src/query.js'), 'query');
  // 去完为空时回退为去扩展名的原名
  assert.strictEqual(stemName('ServiceImpl.js'), 'ServiceImpl');
  // 扩展名按最后一个点切；无扩展名原样返回
  assert.strictEqual(stemName('src/a.b.js'), 'a.b');
  assert.strictEqual(stemName('Makefile'), 'Makefile');
  console.log('[ok] stemName 主干名规则');
}

/* -------------------------------------------------------------------------- */
/* 2) 纯函数：召回率、两级平均、边类型、抽样公式                                  */
/* -------------------------------------------------------------------------- */

function testRecallOf() {
  assert.strictEqual(recallOf(['a', 'b', 'c', 'd'], ['b', 'd', 'x']), 0.5);
  assert.strictEqual(recallOf(['a', 'b'], ['a', 'b']), 1);
  assert.strictEqual(recallOf(['a', 'b'], ['x']), 0);
  assert.strictEqual(recallOf(['a', 'b', 'c'], []), 0);
  console.log('[ok] recallOf 单次召回率');
}

function testTwoLevelAverage() {
  // 提交内平均 → 提交间平均：mean(0.5, 2.5/3) = 2/3
  assert.ok(Math.abs(twoLevelAverage([[1, 0], [1, 1, 0.5]]) - 2 / 3) < 1e-9, '两级平均应为 2/3');
  assert.strictEqual(twoLevelAverage([[1], [0.5]]), 0.75);
  assert.strictEqual(twoLevelAverage([[0.4]]), 0.4);
  // 提交内样本数不同：每个提交权重相同
  assert.strictEqual(twoLevelAverage([[1, 0, 1], [1, 0, 1]]), 2 / 3);
  console.log('[ok] twoLevelAverage 两级平均');
}

function testClassifyEdgeType() {
  assert.deepStrictEqual(classifyEdgeType('src/UserService.java', 'src/OrderDao.java'), ['Java→Java']);
  // mapper 目录或 Mapper.xml 文件名，二者任一即可
  assert.deepStrictEqual(classifyEdgeType('src/UserService.java', 'src/mapper/UserMapper.xml'), ['Java→Mapper XML']);
  assert.deepStrictEqual(classifyEdgeType('src/UserService.java', 'src/xml/UserMapper.xml'), ['Java→Mapper XML']);
  assert.deepStrictEqual(classifyEdgeType('src/mapper/UserMapper.xml', 'src/UserService.java'), ['Mapper XML→Java']);
  // 不是 mapper 的 xml 没有归属类型
  assert.deepStrictEqual(classifyEdgeType('src/UserService.java', 'src/config.xml'), []);
  // 类型可重叠：entity 目录下的 java → 以 VO 结尾的 java 同时命中两类
  assert.deepStrictEqual(
    sorted(classifyEdgeType('src/entity/User.java', 'src/dto/UserVO.java')),
    sorted(['Java→Java', '实体→VO/DTO'])
  );
  assert.deepStrictEqual(
    sorted(classifyEdgeType('src/model/Order.java', 'src/OrderVO.java')),
    sorted(['Java→Java', '实体→VO/DTO'])
  );
  // 实体→VO/DTO 要求两边都是 java，且真值类名以 VO/Vo/DTO/Dto 结尾
  assert.deepStrictEqual(classifyEdgeType('src/entity/User.java', 'src/UserService.java'), ['Java→Java']);
  assert.deepStrictEqual(classifyEdgeType('src/App.vue', 'src/main.ts'), ['前端内部']);
  assert.deepStrictEqual(classifyEdgeType('src/a.py', 'src/b.py'), ['Python→Python']);
  assert.deepStrictEqual(classifyEdgeType('src/App.vue', 'src/util.py'), []);
  console.log('[ok] classifyEdgeType 边类型');
}

function testSampleIndices() {
  assert.deepStrictEqual(sampleIndices(10, 4), [1, 3, 6, 8]);
  assert.deepStrictEqual(sampleIndices(6, 3), [1, 3, 5]);
  const s = sampleIndices(112, 60);
  assert.strictEqual(s.length, 60);
  for (let i = 0; i < 60; i++) {
    assert.strictEqual(s[i], Math.floor((i * 112) / 60) + 1, `i=${i} 应为 ⌊i×N÷K⌋+1`);
  }
  assert.strictEqual(s[0], 1);
  assert.strictEqual(s[59], 111); // ⌊59×112÷60⌋+1
  console.log('[ok] sampleIndices 抽样公式');
}

/* -------------------------------------------------------------------------- */
/* 3) 纯函数：留出任务池（合成提交）                                             */
/* -------------------------------------------------------------------------- */

function testSelectSamplesSynthetic() {
  const mk2 = () => [{ path: 'a.js', status: 'M' }, { path: 'b.js', status: 'M' }];
  const mkN = (n) => Array.from({ length: n }, (_, i) => ({ path: `f${i}.js`, status: 'M' }));
  const commits = [
    // 2 个统计文件（+1 非统计）→ 可用
    { hash: 'c100', ts: 100, isMerge: false, files: [...mk2(), { path: 'notes.md', status: 'M' }] },
    // 合并提交排除
    { hash: 'c200', ts: 200, isMerge: true, files: mk2() },
    // 只有 1 个统计文件（pom.xml/notes.md 不计）→ 排除
    { hash: 'c300', ts: 300, isMerge: false, files: [{ path: 'x.js', status: 'M' }, { path: 'notes.md', status: 'M' }, { path: 'pom.xml', status: 'M' }] },
    // 可用
    { hash: 'c400', ts: 400, isMerge: false, files: [{ path: 'x.js', status: 'M' }, { path: 'y.js', status: 'M' }] },
    // 全是新增：没有 M/D 输入 → 排除
    { hash: 'c500', ts: 500, isMerge: false, files: [{ path: 'x.js', status: 'A' }, { path: 'y.js', status: 'A' }] },
    // 21 个统计文件 → 排除
    { hash: 'c600', ts: 600, isMerge: false, files: mkN(21) },
    // 20 个统计文件（上边界）→ 可用
    { hash: 'c700', ts: 700, isMerge: false, files: mkN(20) },
    // 同一时间：按提交哈希字母序排先后
    { hash: 't800a', ts: 800, isMerge: false, files: mk2() },
    { hash: 't800b', ts: 800, isMerge: false, files: mk2() },
  ];

  const all = selectSamples(commits, { holdout: 0 });
  assert.deepStrictEqual(all.usable.map(asHash), ['c100', 'c400', 'c700', 't800a', 't800b']);
  assert.deepStrictEqual(all.holdoutPool.map(asHash), []);
  // 默认 holdout=0
  assert.deepStrictEqual(selectSamples(commits, {}).usable.map(asHash), ['c100', 'c400', 'c700', 't800a', 't800b']);

  // 最新 1 个留出：同 ts 比哈希，t800b 晚于 t800a
  const h1 = selectSamples(commits, { holdout: 1 });
  assert.deepStrictEqual(h1.usable.map(asHash), ['c100', 'c400', 'c700', 't800a']);
  assert.deepStrictEqual(h1.holdoutPool.map(asHash), ['t800b']);

  const h2 = selectSamples(commits, { holdout: 2 });
  assert.deepStrictEqual(h2.usable.map(asHash), ['c100', 'c400', 'c700']);
  assert.deepStrictEqual(h2.holdoutPool.map(asHash), ['t800a', 't800b']);
  console.log('[ok] selectSamples 样本与留出任务池（合成）');
}

/* -------------------------------------------------------------------------- */
/* 4) 纯函数：结构上限                                                          */
/* -------------------------------------------------------------------------- */

function testStructuralCeiling() {
  // a → b → c → (d, hub)，hub 被 50 个文件引用：可作终点不可作中转；
  // hidden 只经 hub 可达 → 不进 reach；e 在第 4 步 → 不进 reach。
  const dependentsHub = ['c.js', ...Array.from({ length: 49 }, (_, i) => `x${i}.js`)];
  const deps = new Map([
    ['a.js', ['b.js']],
    ['b.js', ['c.js']],
    ['c.js', ['d.js', 'hub.js']],
    ['hub.js', ['hidden.js']],
    ['d.js', ['e.js']],
  ]);
  const dependents = new Map([
    ['b.js', ['a.js']],
    ['c.js', ['b.js']],
    ['d.js', ['c.js']],
    ['hub.js', dependentsHub],
    ['hidden.js', ['hub.js']],
    ['e.js', ['d.js']],
  ]);

  const r1 = computeStructuralCeiling({ deps, dependents, input: 'a.js' });
  assert.deepStrictEqual(sorted(r1.reach), ['b.js', 'c.js', 'd.js', 'hub.js']);
  assert.ok(!r1.reach.includes('a.js'), 'reach 不应包含输入自身');
  assert.ok(!r1.reach.includes('hidden.js'), '公共文件不可作中转');
  assert.ok(!r1.reach.includes('e.js'), '第 4 步的文件不在 3 步上限内');

  // hubThreshold 显式覆盖：阈值降到 1 时 b 也是公共文件 → 只有终点没有中转
  const r2 = computeStructuralCeiling({ deps, dependents, input: 'a.js', hubThreshold: 1 });
  assert.deepStrictEqual(r2.reach, ['b.js']);

  // 无公共文件的直线依赖：3 步边界
  const deps2 = new Map([
    ['a.js', ['b.js']],
    ['b.js', ['c.js']],
    ['c.js', ['d.js']],
    ['d.js', ['e.js']],
  ]);
  const dependents2 = new Map([
    ['b.js', ['a.js']],
    ['c.js', ['b.js']],
    ['d.js', ['c.js']],
    ['e.js', ['d.js']],
  ]);
  const r3 = computeStructuralCeiling({ deps: deps2, dependents: dependents2, input: 'a.js' });
  assert.deepStrictEqual(sorted(r3.reach), ['b.js', 'c.js', 'd.js']);
  console.log('[ok] computeStructuralCeiling 结构上限');
}

/* -------------------------------------------------------------------------- */
/* 5) 纯函数：笨基线（篇幅对齐 + 主干名分组排序）                                 */
/* -------------------------------------------------------------------------- */

function testNaiveBaselineCrafted() {
  const pFiles = ['src/UserServiceImpl.js', 'src/UserMapper.js', 'src/UserController.js', 'src/AdminService.js', 'src/user.js'];
  const coChangeCounts = new Map([
    ['src/UserController.js', 3],
    ['src/AdminService.js', 5],
    ['src/user.js', 4],
    ['src/Gone.js', 9], // 不在 P 中 → 不作候选
  ]);
  const base = { coChangeCounts, pFiles, input: 'src/UserServiceImpl.js' };

  const out = buildNaiveBaseline({ ...base, k: 10 });
  assert.deepStrictEqual(out, [
    'src/UserController.js', // 主干名 User 组，组内次数降序（3）
    'src/UserMapper.js', // 主干名 User 组，次数 0
    'src/AdminService.js', // 非同主干组按次数降序（5）
    'src/user.js', // 次数 4；stem 'user' ≠ 'User'（区分大小写），不属于主干名组
  ]);
  assert.ok(!out.includes('src/Gone.js'), '不在 P 中的文件不应成为候选');
  assert.ok(!out.includes('src/UserServiceImpl.js'), '不应包含输入自身');

  // 篇幅对齐：k 即工具输出个数，候选不足时给全部
  assert.deepStrictEqual(buildNaiveBaseline({ ...base, k: 2 }), ['src/UserController.js', 'src/UserMapper.js']);
  assert.deepStrictEqual(buildNaiveBaseline({ ...base, k: 0 }), []);
  assert.strictEqual(buildNaiveBaseline({ ...base, k: 100 }).length, 4);
  console.log('[ok] buildNaiveBaseline 主干名分组、排序与篇幅对齐');
}

/* -------------------------------------------------------------------------- */
/* 6) 纯函数：合并列表                                                          */
/* -------------------------------------------------------------------------- */

function testMergedList() {
  // 交替取：t1 a、b1 b、t2 b（已出现，跳过）、b2 d、t3 c → 取满 k=4
  assert.deepStrictEqual(buildMergedList(['a', 'b', 'c'], ['b', 'd', 'e'], 4), ['a', 'b', 'd', 'c']);
  // 工具为空 → 全部来自笨基线
  assert.deepStrictEqual(buildMergedList([], ['x', 'y'], 15), ['x', 'y']);
  assert.deepStrictEqual(buildMergedList(['a', 'b'], [], 2), ['a', 'b']);
  // 一边先取完：交替继续到两边取完，总数不超过 k → a(工具)、c(基线)、b(工具)
  assert.deepStrictEqual(buildMergedList(['a', 'b'], ['c'], 5), ['a', 'c', 'b']);
  console.log('[ok] buildMergedList 合并列表');
}

/* -------------------------------------------------------------------------- */
/* 7) 夹具自测：git log --name-status 核对提交与文件集合                          */
/* -------------------------------------------------------------------------- */

function testFixtureSelfCheck(fixture) {
  const commits = listCommits(fixture.dir);
  assert.strictEqual(commits.length, 4, '夹具应有 4 个提交');
  assert.ok(commits.every((c) => !c.isMerge), '夹具不含合并提交');
  for (let i = 1; i < commits.length; i++) {
    assert.ok(commits[i].ts > commits[i - 1].ts, '提交时间应严格递增');
  }
  const t0 = Date.parse(C1) / 1000;
  commits.forEach((c, i) => assert.strictEqual(c.ts, t0 + i * 86400, `提交 ${i} 的 %ct 应为设定时间`));

  const statusMap = (c) => Object.fromEntries(c.files.map((f) => [f.path, f.status]));
  assert.deepStrictEqual(statusMap(commits[0]), {
    'notes.md': 'A',
    'src/api.js': 'A',
    'src/legacy.js': 'A',
    'src/orphan.js': 'A',
    'src/user.js': 'A',
    'src/util.js': 'A',
  });
  assert.deepStrictEqual(statusMap(commits[1]), {
    'src/api.js': 'M',
    'src/extra.js': 'A',
    'src/legacy.js': 'M',
    'src/util.js': 'M',
  });
  assert.deepStrictEqual(statusMap(commits[2]), {
    'src/extra.js': 'M',
    'src/orphan.js': 'D',
    'src/user.js': 'M',
  });
  // 重命名按 --no-renames 语义：删旧 + 增新（无 R 状态）
  assert.deepStrictEqual(statusMap(commits[3]), {
    'src/api.js': 'M',
    'src/helpers.js': 'A',
    'src/util.js': 'D',
  });
  assert.ok(commits.every((c) => c.files.every((f) => ['A', 'M', 'D'].includes(f.status))), 'no-renames 视角只有 A/M/D');

  // 输入 / 真值 / 新增数（5.2 口径在夹具上的落地）
  assert.deepStrictEqual(inputsOf(commits[0]), [], 'c1 全是新增，没有输入（不可用）');
  assert.strictEqual(addedCountOf(commits[0]), 5, 'notes.md 不计入新增统计文件');
  assert.deepStrictEqual(sorted(inputsOf(commits[1])), ['src/api.js', 'src/legacy.js', 'src/util.js']);
  assert.deepStrictEqual(truthOf(commits[1], 'src/api.js'), ['src/legacy.js', 'src/util.js']); // extra 作为新增被排除
  assert.strictEqual(addedCountOf(commits[1]), 1);
  assert.deepStrictEqual(sorted(inputsOf(commits[2])), ['src/extra.js', 'src/orphan.js', 'src/user.js']);
  assert.deepStrictEqual(truthOf(commits[2], 'src/orphan.js'), ['src/extra.js', 'src/user.js']);
  assert.strictEqual(addedCountOf(commits[2]), 0);
  assert.deepStrictEqual(sorted(inputsOf(commits[3])), ['src/api.js', 'src/util.js']);
  assert.deepStrictEqual(truthOf(commits[3], 'src/util.js'), ['src/api.js']); // 重命名目标 helpers.js 是新增，被排除
  assert.deepStrictEqual(truthOf(commits[3], 'src/api.js'), ['src/util.js']);
  assert.strictEqual(addedCountOf(commits[3]), 1);

  fixture.commits = commits;
  console.log('[ok] 夹具自测：提交、状态、输入与真值');
}

/* -------------------------------------------------------------------------- */
/* 8) 留出任务池（真实夹具提交）                                                 */
/* -------------------------------------------------------------------------- */

function testSelectSamplesFixture(fixture) {
  const c = fixture.commits;
  const usableHashes = [c[1].hash, c[2].hash, c[3].hash];

  const none = selectSamples(c, { holdout: 0 });
  assert.deepStrictEqual(none.usable.map(asHash), usableHashes, 'c1 因无输入不可用，其余 3 个可用');
  assert.deepStrictEqual(none.holdoutPool.map(asHash), []);

  const h1 = selectSamples(c, { holdout: 1 });
  assert.deepStrictEqual(h1.usable.map(asHash), [c[1].hash, c[2].hash]);
  assert.deepStrictEqual(h1.holdoutPool.map(asHash), [c[3].hash], '最新可用提交留出');
  console.log('[ok] selectSamples 真实夹具的留出任务池');
}

/* -------------------------------------------------------------------------- */
/* 9) 笨基线历史截断反例：只用 P 及更早的共改                                     */
/* -------------------------------------------------------------------------- */

function testBaselineHistoryCutoff(fixture) {
  const c = fixture.commits;
  const input = 'src/user.js';
  const pFiles = pFilesAt(fixture.dir, c[1].hash); // 回放 c3 时 P = c2

  // 正确口径：历史只到 P=c2 —— user×extra 的第一次共改发生在 c3，不可见
  const countsAtP = coChangeCountsAt(fixture.dir, c[1].hash, input);
  const atP = buildNaiveBaseline({ coChangeCounts: countsAtP, pFiles, input, k: 10 });
  assert.deepStrictEqual(atP, ['src/api.js', 'src/legacy.js', 'src/orphan.js', 'src/util.js']);
  assert.ok(!atP.includes('src/extra.js'), '反例：只看 P 及更早历史时，不能凭 c3 才出现的共改把 extra 推进来');

  // 对照：错误地把 c3 也计入历史 → extra 出现且 orphan 升到首位
  const countsWithC = coChangeCountsAt(fixture.dir, c[2].hash, input);
  const withC = buildNaiveBaseline({ coChangeCounts: countsWithC, pFiles, input, k: 10 });
  assert.deepStrictEqual(withC, ['src/orphan.js', 'src/api.js', 'src/extra.js', 'src/legacy.js', 'src/util.js']);
  assert.ok(withC.includes('src/extra.js'), '历史包含 c3 后 extra 必须出现 —— 两个口径结果必须不同');
  console.log('[ok] buildNaiveBaseline 只用 P 及更早历史（反例）');
}

/* -------------------------------------------------------------------------- */
/* 10) 流水线：runReplay 产出与逐行口径核对                                       */
/* -------------------------------------------------------------------------- */

// 每行期望：ci = fixture.commits 下标；truth 用集合比较；tool/base/merged 按序比较；
// ceil 用集合比较（reach 顺序不构成口径）。tool/impactCount 已用真实 CLI 在 P 上核对。
// T1.3 翻默认后工具默认 direction=all（双向 BFS + 同层邻居，stopAtEntry 仍开），
// tool/impactCount/merged（merged 的 k = tool 长度）已按新默认重算。
const EXPECT_LINES = [
  // —— c2（P = c1）——
  {
    ci: 1, input: 'src/api.js',
    truth: ['src/legacy.js', 'src/util.js'], added: 1,
    tool: ['src/util.js', 'src/legacy.js'], impactCount: 2,
    base: ['src/legacy.js', 'src/orphan.js'],
    merged: ['src/util.js', 'src/legacy.js'],
    ceil: ['src/legacy.js', 'src/util.js'],
  },
  {
    ci: 1, input: 'src/legacy.js',
    truth: ['src/api.js', 'src/util.js'], added: 1,
    tool: ['src/api.js', 'src/util.js'], impactCount: 2,
    base: ['src/api.js', 'src/orphan.js'], merged: ['src/api.js', 'src/util.js'],
    ceil: ['src/api.js', 'src/util.js'],
  },
  {
    ci: 1, input: 'src/util.js',
    truth: ['src/api.js', 'src/legacy.js'], added: 1,
    tool: ['src/api.js', 'src/legacy.js'], impactCount: 2,
    base: ['src/api.js', 'src/legacy.js'], merged: ['src/api.js', 'src/legacy.js'],
    ceil: ['src/api.js', 'src/legacy.js'],
  },
  // —— c3（P = c2）——
  {
    ci: 2, input: 'src/user.js',
    truth: ['src/extra.js', 'src/orphan.js'], added: 0,
    tool: [], impactCount: 0,
    base: ['src/api.js', 'src/legacy.js', 'src/orphan.js', 'src/util.js'],
    merged: ['src/api.js', 'src/legacy.js', 'src/orphan.js', 'src/util.js'],
    ceil: [],
  },
  {
    ci: 2, input: 'src/extra.js',
    truth: ['src/orphan.js', 'src/user.js'], added: 0,
    tool: ['src/api.js', 'src/util.js', 'src/legacy.js'], impactCount: 3,
    base: ['src/api.js', 'src/legacy.js', 'src/util.js'], merged: ['src/api.js', 'src/util.js', 'src/legacy.js'],
    ceil: ['src/api.js', 'src/legacy.js', 'src/util.js'],
  },
  {
    ci: 2, input: 'src/orphan.js',
    truth: ['src/extra.js', 'src/user.js'], added: 0,
    tool: [], impactCount: 0,
    base: ['src/api.js', 'src/legacy.js', 'src/user.js', 'src/util.js'],
    merged: ['src/api.js', 'src/legacy.js', 'src/user.js', 'src/util.js'],
    ceil: [],
  },
  // —— c4（P = c3，重命名提交）——
  {
    ci: 3, input: 'src/api.js',
    truth: ['src/util.js'], added: 1,
    tool: ['src/util.js', 'src/legacy.js', 'src/extra.js'], impactCount: 3,
    base: ['src/legacy.js', 'src/util.js', 'src/extra.js'],
    merged: ['src/util.js', 'src/legacy.js', 'src/extra.js'],
    ceil: ['src/extra.js', 'src/legacy.js', 'src/util.js'],
  },
  {
    ci: 3, input: 'src/util.js',
    truth: ['src/api.js'], added: 1,
    tool: ['src/api.js', 'src/legacy.js', 'src/extra.js'], impactCount: 3,
    base: ['src/api.js', 'src/legacy.js', 'src/extra.js'], merged: ['src/api.js', 'src/legacy.js', 'src/extra.js'],
    ceil: ['src/api.js', 'src/extra.js', 'src/legacy.js'],
  },
];

function assertRunsAgainstExpectation(runs, fixture) {
  const commits = fixture.commits;
  assert.strictEqual(runs.length, EXPECT_LINES.length, `runs.jsonl 应有 ${EXPECT_LINES.length} 行输入`);

  // 按提交分组处理且提交按时间正序（5.3 第 3 条）；提交内输入顺序不构成口径
  const groups = [];
  for (const r of runs) {
    const last = groups[groups.length - 1];
    if (!last || last.commit !== r.commit) groups.push({ commit: r.commit, count: 1 });
    else last.count += 1;
  }
  assert.deepStrictEqual(
    groups.map((g) => g.commit),
    [commits[1].hash, commits[2].hash, commits[3].hash],
    '可用提交应按时间正序分组处理（c1 无输入不参与）'
  );
  assert.deepStrictEqual(groups.map((g) => g.count), [3, 3, 2], '每个可用提交的输入数');

  const byKey = new Map(runs.map((r) => [`${r.commit}\n${r.input}`, r]));
  assert.strictEqual(byKey.size, runs.length, '每个 (commit, input) 只应有一行');

  for (const exp of EXPECT_LINES) {
    const c = commits[exp.ci];
    const line = byKey.get(`${c.hash}\n${exp.input}`);
    assert.ok(line, `缺少 ${c.hash.slice(0, 7)} ${exp.input} 的运行记录`);
    const tag = `${c.hash.slice(0, 7)} ${exp.input}: `;

    // 父子链路与字段
    assert.strictEqual(line.parent, commits[exp.ci - 1].hash, tag + 'parent 应为上一个提交');
    assert.ok(typeof line.durationMs === 'number' && Number.isFinite(line.durationMs) && line.durationMs >= 0, tag + 'durationMs 应为非负数');
    assert.ok(Array.isArray(line.warnings), tag + 'warnings 应为数组');
    assert.ok(line.error == null, tag + '夹具运行不应有 error');

    // 输入只能是 M/D（5.2 输入口径）
    const status = c.files.find((f) => f.path === exp.input).status;
    assert.ok(status === 'M' || status === 'D', tag + '输入必须是 M 或 D 状态');

    // 新增文件排除：真值不含新增，新增数单独记录
    assert.strictEqual(line.addedCount, exp.added, tag + 'addedCount');
    assert.deepStrictEqual(sorted(line.truth), sorted(exp.truth), tag + '真值（已排除新增文件）');
    assert.ok(!line.truth.includes(exp.input), tag + '真值不含输入自身');
    const addedPaths = c.files.filter((f) => f.status === 'A' && isStatFile(f.path)).map((f) => f.path);
    for (const p of addedPaths) assert.ok(!line.truth.includes(p), tag + `新增文件 ${p} 不得进入真值`);

    // 工具只用 P 及更早：输出只能是 P 中存在的文件，且绝不含 C 中新增的文件
    assert.deepStrictEqual(line.toolList, exp.tool, tag + '工具输出（= 在 P 上运行 impact 的结果）');
    assert.strictEqual(line.impactCount, exp.impactCount, tag + 'impactCount');
    assert.strictEqual(line.truncated, line.impactCount > line.toolList.length, tag + 'truncated 应反映 impactCount 是否被截断');
    for (const p of addedPaths) assert.ok(!line.toolList.includes(p), tag + `工具不得报出 C 中新增的 ${p}`);

    // 笨基线：候选只取 P 中存在的统计文件、不含输入；篇幅对齐（工具为空时 15）
    assert.deepStrictEqual(line.baselineList, exp.base, tag + '笨基线列表（P 及更早历史 + 主干名）');
    const limit = line.toolList.length > 0 ? line.toolList.length : 15;
    assert.ok(line.baselineList.length <= limit, tag + `笨基线篇幅应对齐工具（≤ ${limit}）`);
    for (const p of line.baselineList) {
      assert.ok(isStatFile(p), tag + `笨基线候选 ${p} 应是统计文件`);
      assert.notStrictEqual(p, exp.input, tag + '笨基线不含输入自身');
    }

    // 合并列表：无重复、是两边并集的子序列、不超过 k；首元素来自工具（工具非空时）
    assert.deepStrictEqual(line.mergedList, exp.merged, tag + '合并列表（交替取、去重）');
    assert.strictEqual(new Set(line.mergedList).size, line.mergedList.length, tag + '合并列表不应有重复');
    for (const p of line.mergedList) {
      assert.ok(line.toolList.includes(p) || line.baselineList.includes(p), tag + `合并元素 ${p} 必须来自工具或笨基线`);
    }
    assert.ok(line.mergedList.length <= limit, tag + '合并列表不超过 k');
    if (line.toolList.length > 0) assert.strictEqual(line.mergedList[0], line.toolList[0], tag + '合并列表首元素应来自工具');
    else if (line.baselineList.length > 0) assert.strictEqual(line.mergedList[0], line.baselineList[0], tag + '工具为空时合并列表首元素应来自笨基线');

    // 结构上限：reach 在 P 的图上、不含输入自身
    assert.deepStrictEqual(sorted(line.ceilingList), sorted(exp.ceil), tag + '结构上限可达集合');
    assert.ok(!line.ceilingList.includes(exp.input), tag + 'reach 不含输入自身');
    for (const p of line.ceilingList) assert.ok(!addedPaths.includes(p), tag + 'reach 不含 C 中新增的文件');
  }

  // 反例（5.2 笨基线历史范围）在流水线上的落点
  const userLine = byKey.get(`${commits[2].hash}\nsrc/user.js`);
  assert.ok(!userLine.baselineList.includes('src/extra.js'), '流水线：c3 的共改不得回流进基线历史');
}

async function testRunReplayPipeline(fixture, outDir) {
  const commits = fixture.commits;
  const summary = await runReplay({
    repoPath: fixture.dir,
    name: 'wb-fixture',
    holdout: 0,
    sample: 'all',
    outDir,
  });
  assert.ok(summary && typeof summary === 'object', 'runReplay 应返回 summary 对象');

  // —— runs.jsonl ——
  const runs = parseRuns(outDir);
  assertRunsAgainstExpectation(runs, fixture);

  // 处理的提交集合 = selectSamples(holdout=0) 的可用提交
  const usable = selectSamples(commits, { holdout: 0 }).usable.map(asHash);
  assert.deepStrictEqual([...new Set(runs.map((r) => r.commit))].sort(), [...usable].sort(), '回放提交集合应等于可用提交');

  // —— summary.json：口径版本 v1、本仓库提交号、工作区脏标记 ——
  const summaryJson = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8'));
  const strings = deepStrings(summaryJson);
  const entries = deepKeyValues(summaryJson);
  const hasV1 = strings.some((s) => s.includes('v1'))
    || entries.some(([k, v]) => /version|spec|口径/i.test(k) && (v === 1 || v === '1' || v === 'v1'));
  assert.ok(hasV1, 'summary.json 应记录口径版本 v1');
  const head = git(REPO_ROOT, ['rev-parse', 'HEAD']).trim();
  const summaryText = fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8');
  // 完整哈希或短哈希（rev-parse --short 是前缀）都算记录了本仓库提交号
  assert.ok(summaryText.includes(head.slice(0, 7)), 'summary.json 应记录本仓库提交号');
  assert.ok(
    entries.some(([k, v]) => typeof v === 'boolean' && /dirty|clean/i.test(k)),
    'summary.json 应有工作区是否脏的布尔标记'
  );

  // —— summary.md：一张对比表 ——
  const md = fs.readFileSync(path.join(outDir, 'summary.md'), 'utf8');
  assert.ok(md.length > 0 && md.includes('|'), 'summary.md 应包含 markdown 表格');

  // —— sample.json：sample 决策 + 可用提交哈希列表 ——
  const sampleText = fs.readFileSync(path.join(outDir, 'sample.json'), 'utf8');
  for (const h of usable) assert.ok(sampleText.includes(h.slice(0, 12)), `sample.json 应包含提交哈希 ${h.slice(0, 12)}…`);
  assert.ok(deepStrings(JSON.parse(sampleText)).some((s) => s === 'all'), "sample='all' 的决策应被记录");

  return runs;
}

/* -------------------------------------------------------------------------- */
/* 11) sample.json 已存在时沿用不重选                                            */
/* -------------------------------------------------------------------------- */

async function testSampleJsonReuse(fixture, outDir, run1Runs) {
  const before = fs.readFileSync(path.join(outDir, 'sample.json'), 'utf8');
  await runReplay({
    repoPath: fixture.dir,
    name: 'wb-fixture',
    holdout: 0,
    sample: 2, // 若不沿用会只抽 2 个提交
    outDir,
  });
  const after = fs.readFileSync(path.join(outDir, 'sample.json'), 'utf8');
  assert.strictEqual(after, before, 'outDir 已有 sample.json 时应沿用，不得重选');

  const runs2 = parseRuns(outDir);
  const key = (r) => `${r.commit}|${r.input}`;
  assert.deepStrictEqual(
    runs2.map(key).sort(),
    run1Runs.map(key).sort(),
    '沿用 sample.json 后处理的 (commit, input) 集合应与首次一致'
  );
  console.log('[ok] runReplay sample.json 沿用不重选');
}

/* -------------------------------------------------------------------------- */
/* 12) 验收②：进程内工具输出 vs 单独 CLI impact                                  */
/* -------------------------------------------------------------------------- */

async function testToolVsCliParity(fixture, pDir, root) {
  const commits = fixture.commits;
  git(root, ['clone', '--no-hardlinks', fixture.dir, pDir]);
  git(pDir, ['checkout', '-q', commits[0].hash]); // 第一个提交 = c1（时间最早）
  // 第一个“可用”提交 c2 的前 3 个输入（恰好 3 个）
  const inputs = inputsOf(commits[1]).slice(0, 3);
  assert.strictEqual(inputs.length, 3, '夹具第一个可用提交应有至少 3 个输入');

  // 在 P（=c1 检出目录）上计算进程内工具输出
  const inProcessRaw = computeToolOutputs(pDir, inputs);
  const inProcess = inProcessRaw && typeof inProcessRaw.then === 'function' ? await inProcessRaw : inProcessRaw;
  assert.ok(inProcess && typeof inProcess === 'object', 'computeToolOutputs 应返回 { input: string[] }');

  // 真值：用真实 CLI 在同一目录逐个核对（相对路径统一后比较）。
  // T1.3 翻默认后 CLI impact 默认 direction=all（双向 + 同层邻居），期望值按夹具依赖结构重算。
  const EXPECT_TOOL = {
    'src/api.js': ['src/util.js', 'src/legacy.js'], // api 的 dependencies（c1 里没人引用 api）
    'src/legacy.js': ['src/api.js', 'src/util.js'], // dependent api + 经 api 的同层邻居 util
    'src/util.js': ['src/api.js', 'src/legacy.js'], // dependent api + 经 api 的同层邻居 legacy
  };
  for (const input of inputs) {
    const res = runCli(['impact', '--cwd', pDir, '--file', input, '--json', '--quiet']);
    const cliList = (res.impact || []).map((i) => toRel(pDir, i.file));
    const inList = (inProcess[input] || []).map((f) => toRel(pDir, f));
    assert.deepStrictEqual(cliList, EXPECT_TOOL[input], `CLI impact(${input}) 应与夹具依赖结构一致`);
    assert.deepStrictEqual(inList, cliList, `进程内 computeToolOutputs(${input}) 应与 CLI impact 一致`);
  }
  console.log('[ok] 验收②：进程内工具输出与 CLI impact 一致');
}

/* -------------------------------------------------------------------------- */
/* 13) --target 模式：WB_REPLAY_TRUTH 测试缝（三态错误 + cutoff 写入与沿用）     */
/* -------------------------------------------------------------------------- */

const REPLAY_SCRIPT = path.join(REPO_ROOT, 'eval', 'replay-impact.js');
const REAL_TARGETS_FILE = path.join(REPO_ROOT, 'eval', 'truth', 'targets.json');

/** 真实 eval/truth/targets.json 的存在状态与内容哈希（卫生基线）。 */
function snapshotRealTargets() {
  if (!fs.existsSync(REAL_TARGETS_FILE)) return { exists: false, sha256: null };
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(REAL_TARGETS_FILE)).digest('hex');
  return { exists: true, sha256 };
}

/** 以 seam 指向 truthDir 运行 `node eval/replay-impact.js <args>`。 */
function runReplayTarget(truthDir, args) {
  return spawnSync('node', [REPLAY_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, WB_REPLAY_TRUTH: truthDir },
  });
}

function testTargetMode(fixture, root) {
  const truthDir = path.join(root, 'truth-seam');
  fs.mkdirSync(truthDir, { recursive: true });
  const targetsFile = path.join(truthDir, 'targets.json');

  // 1) 临时 truth 下无 targets.json → 退出码 1，stderr 指到 seam 根下的文件
  let res = runReplayTarget(truthDir, ['--target', 'J1']);
  assert.strictEqual(res.status, 1, `缺 targets.json 应退出 1，实际 ${res.status}\n${res.stderr}`);
  assert.ok(String(res.stderr).includes('targets.json'), `stderr 应提到 targets.json：${res.stderr}`);
  assert.ok(
    String(res.stderr).includes(truthDir),
    `stderr 应指向 seam 根下的 targets.json（证明没落到真实 eval/truth）：${res.stderr}`
  );

  // 2) targets.json 写坏 JSON → 退出码 1，stderr 提到解析失败
  fs.writeFileSync(targetsFile, '{ this is not json', 'utf8');
  res = runReplayTarget(truthDir, ['--target', 'J1']);
  assert.strictEqual(res.status, 1, `坏 JSON 应退出 1，实际 ${res.status}\n${res.stderr}`);
  assert.ok(String(res.stderr).includes('解析失败'), `stderr 应提到解析失败：${res.stderr}`);

  // 3) 没有目标代号 → 退出码 1，stderr 列出已有代号
  fs.writeFileSync(targetsFile, JSON.stringify({ F1: { path: fixture.dir } }, null, 2) + '\n', 'utf8');
  res = runReplayTarget(truthDir, ['--target', 'J1']);
  assert.strictEqual(res.status, 1, `未知代号应退出 1，实际 ${res.status}\n${res.stderr}`);
  assert.ok(String(res.stderr).includes('"J1"'), `stderr 应提到请求的代号 J1：${res.stderr}`);
  assert.ok(String(res.stderr).includes('F1'), `stderr 应列出已有代号 F1：${res.stderr}`);

  // 4) 正常路径：cutoff 留空 → 首跑把夹具 HEAD 记进 targets.json，产出四件套
  const head = git(fixture.dir, ['rev-parse', 'HEAD']).trim();
  fs.writeFileSync(
    targetsFile,
    JSON.stringify({ FX1: { path: fixture.dir, type: 'js-ts', cutoff: '' } }, null, 2) + '\n',
    'utf8'
  );

  console.log('[run] --target 首跑（max-commits=1）…');
  res = runReplayTarget(truthDir, ['--target', 'FX1', '--max-commits', '1']);
  assert.strictEqual(
    res.status,
    0,
    `--target 正常路径应退出 0，实际 ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`
  );
  assert.ok(String(res.stderr).includes('已记录'), `首跑应在 stderr 记录 cutoff：${res.stderr}`);

  const targetsAfterFirst = fs.readFileSync(targetsFile, 'utf8');
  const parsed = JSON.parse(targetsAfterFirst);
  assert.strictEqual(parsed.FX1.cutoff, head, 'cutoff 应写成夹具当前 HEAD（git rev-parse HEAD 全值）');
  assert.strictEqual(parsed.FX1.path, fixture.dir, 'path 字段不得被改写');

  const outDir = path.join(truthDir, 'replay', 'FX1');
  for (const f of ['runs.jsonl', 'summary.json', 'summary.md', 'sample.json']) {
    assert.ok(fs.existsSync(path.join(outDir, f)), `应产出 ${f} 到 ${outDir}`);
  }
  const runs = parseRuns(outDir);
  assert.strictEqual(runs.length, 2, '--max-commits 1 应只回放 c4（2 个输入）');
  assert.deepStrictEqual(
    [...new Set(runs.map((r) => r.commit))],
    [fixture.commits[3].hash],
    '应回放时间上最新的可用提交 c4'
  );
  assert.ok(
    runs.every((r) => r.error == null),
    `夹具回放不应有 error：${runs.filter((r) => r.error).map((r) => r.error).join('; ')}`
  );
  const summaryJson = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8'));
  assert.strictEqual(summaryJson.cutoff, head, 'summary.json 的 cutoff 应与 targets.json 一致');
  assert.strictEqual(summaryJson.totals.commits, 1, 'summary 应只统计 1 个提交');
  assert.strictEqual(summaryJson.totals.errors, 0, 'summary 不应有出错输入');

  // 5) 同命令再跑一次 → cutoff 沿用不重写（整文件字节比较）
  console.log('[run] --target 二跑（cutoff 沿用）…');
  res = runReplayTarget(truthDir, ['--target', 'FX1', '--max-commits', '1']);
  assert.strictEqual(res.status, 0, `--target 二跑应退出 0，实际 ${res.status}\nstderr: ${res.stderr}`);
  assert.ok(!String(res.stderr).includes('已记录'), 'cutoff 已存在时不应再次记录');
  const targetsAfterSecond = fs.readFileSync(targetsFile, 'utf8');
  assert.strictEqual(targetsAfterSecond, targetsAfterFirst, '二跑不得改写 targets.json（cutoff 沿用不重写）');

  console.log('[ok] --target 模式：三态错误、cutoff 首写与沿用、四件套产出');
}

/* -------------------------------------------------------------------------- */
/* main                                                                        */
/* -------------------------------------------------------------------------- */

async function main() {
  const root = makeTempDir('wb-replay-test-');
  if (!process.env.WB_TEST_CACHE_DIR) {
    // 独立运行时不污染用户缓存目录；runner 已提供时沿用
    process.env.WB_TEST_CACHE_DIR = path.join(root, 'cache-root');
  }
  try {
    const realTargetsBefore = snapshotRealTargets();
    testIsStatFile();
    testStemName();
    testRecallOf();
    testTwoLevelAverage();
    testClassifyEdgeType();
    testSampleIndices();
    testSelectSamplesSynthetic();
    testStructuralCeiling();
    testNaiveBaselineCrafted();
    testMergedList();

    const fixture = buildFixture(path.join(root, 'fx'));
    testFixtureSelfCheck(fixture);
    testSelectSamplesFixture(fixture);
    testBaselineHistoryCutoff(fixture);

    const out1 = path.join(root, 'out1');
    console.log('[run] runReplay #1（sample=all）…');
    const runs1 = await testRunReplayPipeline(fixture, out1);

    console.log('[run] runReplay #2（sample=2，应沿用 sample.json）…');
    await testSampleJsonReuse(fixture, out1, runs1);

    console.log('[run] 验收②：CLI 对照…');
    await testToolVsCliParity(fixture, path.join(root, 'p1'), root);

    console.log('[run] --target 模式（WB_REPLAY_TRUTH seam）…');
    testTargetMode(fixture, root);
    assert.deepStrictEqual(
      snapshotRealTargets(),
      realTargetsBefore,
      '测试前后真实 eval/truth/targets.json 必须完全一致（存在状态与内容哈希）'
    );
    console.log('[ok] 卫生：真实 eval/truth/targets.json 未被触碰');

    console.log('replay-impact-test.js: all passed');
  } finally {
    cleanupTempDir(root);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
