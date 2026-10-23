#!/usr/bin/env node
// @semantic
/**
 * @slow
 * eval/agent-ab.js（docs/experiments/agent-offline-ab.md 口径 v1）语义测试。
 *
 *   1) 纯函数 —— 输入排序、路径归一与打分、JSON 抽取、越界访问、参数、bootstrap、样本量、判定；
 *   2) 夹具流水线 —— 临时 git 仓库 4 个提交，经 WB_AGENT_AB_TRUTH / WB_AGENT_AB_WORK 测试缝跑
 *      plan → prepare → run（桩 agent，不调用付费模型）→ score，核对历史截断、工作区状态、
 *      B 组提示词带 impact 输出、无效重跑一次、断点续跑、预算停止与两级平均；
 *   3) CLI —— 冻结的 plan 拒绝覆盖、参数错误的退出码，并断言真实 eval/truth 未被触碰。
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO_ROOT, makeTempDir, cleanupTempDir } = require('./test-helpers');
const ab = require('../eval/agent-ab.js');
const { listCommits } = require('../eval/replay-impact.js');

const SCRIPT = path.join(REPO_ROOT, 'eval', 'agent-ab.js');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

/* -------------------------------------------------------------------------- */
/* 1) 纯函数                                                                    */
/* -------------------------------------------------------------------------- */

function testRankInputs() {
  const commit = {
    hash: 'abc123',
    files: [
      { path: 'src/a.js', status: 'M' },
      { path: 'src/b.js', status: 'M' },
      { path: 'src/new.js', status: 'A' },
      { path: 'README.md', status: 'M' },
      { path: 'src/gone.js', status: 'D' },
    ],
  };
  const all = ab.rankInputs(commit, Infinity);
  const expectedOrder = ['src/a.js', 'src/b.js'].sort((x, y) => (sha256(`abc123:${x}`) < sha256(`abc123:${y}`) ? -1 : 1));
  assert.deepStrictEqual(all.map((x) => x.path), expectedOrder, '只取 M 状态统计文件，按 sha256(哈希:路径) 升序');
  const a = all.find((x) => x.path === 'src/a.js');
  assert.deepStrictEqual(a.truth, ['src/b.js', 'src/gone.js'], '真值 = 其他非新增统计文件（含删除，去掉新增与非统计文件）');
  assert.strictEqual(ab.rankInputs(commit, 1).length, 1, 'm 封顶');

  const lonely = { hash: 'x', files: [{ path: 'src/a.js', status: 'M' }, { path: 'src/n.js', status: 'A' }] };
  assert.deepStrictEqual(ab.rankInputs(lonely, 3), [], '真值为空的输入不取');
  console.log('[ok] rankInputs');
}

function testScoreList() {
  const ws = path.resolve(makeTempDirName(), 'ws');
  const ctx = {
    workspace: ws,
    input: 'src/a.js',
    truth: ['src/b.js', 'src/c.js'],
    allChanged: ['src/a.js', 'src/b.js', 'src/c.js', 'docs/x.yml'],
    tracked: new Set(['src/a.js', 'src/b.js', 'src/c.js', 'README.md', 'docs/x.yml']),
  };
  const s = ab.scoreList([
    'SRC\\B.JS',                       // 大小写与反斜杠 → src/b.js，命中
    './src/a.js',                      // 输入本身，忽略
    path.join(ws, 'src', 'c.js'),      // 工作区内绝对路径 → src/c.js，命中
    'src/b.js',                        // 重复，去掉
    'docs/x.yml',                      // 同提交改过的非统计文件，中性
    'src/nope.js',                     // 仓库里不存在，算多报并单独计数
    'README.md',                       // 多报
  ], ctx);
  assert.deepStrictEqual(s.files, ['src/b.js', 'src/c.js', 'docs/x.yml', 'src/nope.js', 'README.md']);
  assert.strictEqual(s.hits, 2);
  assert.strictEqual(s.neutral, 1);
  assert.strictEqual(s.fp, 2);
  assert.strictEqual(s.missing, 1);
  close(s.recall, 1, 'recall');
  close(s.precision, 0.5, '精确率分母不含中性文件');
  assert.strictEqual(s.overLimit, false);

  const many = Array.from({ length: 20 }, (_, i) => `src/f${String(i).padStart(2, '0')}.js`);
  const capped = ab.scoreList([...many.slice(0, 6), 'src/b.js', ...many.slice(6)], ctx);
  assert.strictEqual(capped.files.length, 15, '最多 15 个');
  assert.strictEqual(capped.overLimit, true);
  close(capped.recall, 0.5, '第 7 位的命中仍计入召回');
  close(capped.recallAt5, 0, '前 5 召回只看前 5 个');

  const empty = ab.scoreList(['./src/a.js'], ctx);
  assert.strictEqual(empty.precision, null, '空列表不计精确率');
  close(empty.recall, 0, '空列表召回为 0');
  console.log('[ok] scoreList');
}

function makeTempDirName() {
  return path.join(require('os').tmpdir(), 'wb-agent-ab-unit');
}

function testExtractFilesJson() {
  assert.deepStrictEqual(ab.extractFilesJson('结论如下 {"files":["a.js"]}'), ['a.js']);
  assert.deepStrictEqual(ab.extractFilesJson('```json\n{"files": ["a.js", "b.js"]}\n```\n以上。'), ['a.js', 'b.js'], '代码围栏与尾随说明');
  assert.deepStrictEqual(ab.extractFilesJson('{"files":["old.js"]} 改为 {"files":["new.js"]}'), ['new.js'], '取最后一个');
  assert.deepStrictEqual(ab.extractFilesJson('{"files":["x}y.js", 3]}'), ['x}y.js'], '字符串里的括号不打断，非字符串项丢弃');
  assert.deepStrictEqual(ab.extractFilesJson('{"files":["a.js"]} 然后 {"note": 1}'), ['a.js'], '最后一个对象没有 files 时往前找');
  assert.strictEqual(ab.extractFilesJson('没有 JSON'), null);
  assert.strictEqual(ab.extractFilesJson('{"files": "a.js"}'), null, 'files 不是数组');
  assert.strictEqual(ab.extractFilesJson('{broken'), null);
  console.log('[ok] extractFilesJson');
}

function testOutsideAccesses() {
  const ws = path.resolve(makeTempDirName(), 'ws');
  const outside = path.resolve(makeTempDirName(), 'other', 'secret.java');
  const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  const result = (id, isError) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] } });
  const events = [
    use('1', 'Read', { file_path: 'src/a.js' }),
    use('2', 'Read', { file_path: path.join(ws, 'src', 'b.js') }),
    use('3', 'Read', { file_path: outside }), result('3', false),
    use('4', 'Grep', { pattern: 'x', path: outside }), result('4', true),
    use('5', 'Glob', { pattern: '*.java', path: '..' }),
    use('6', 'Bash', { command: `grep -rn Foo "${path.dirname(outside)}"` }),
    use('7', 'Bash', { command: `git -C "${ws}" log --oneline -5 && ls ${path.join(ws, 'src')}` }),
  ];
  assert.deepStrictEqual(ab.outsideAccesses(events, ws), [`Read:${outside}`, 'Glob:..', `Bash:${path.dirname(outside)}`],
    '只记成功读到工作区外的调用，Bash 命令里的绝对路径也查');

  // 两种平台的写法在任何系统上都测，CI 的 ubuntu 和 windows 走的是不同分支。
  assert.deepStrictEqual(ab.absPathsInCommand('grep -rn x "C:\\other\\dir" && ls /c/Users/x', 'win32'), ['C:\\other\\dir', 'c:/Users/x']);
  assert.deepStrictEqual(ab.absPathsInCommand('grep -rn x src/a/b.js > /dev/null', 'win32'), [], '相对路径里的 /a/ 不是盘符');
  assert.deepStrictEqual(ab.absPathsInCommand('grep -rn Foo "/tmp/other" --include=/opt/x', 'linux'), ['/tmp/other', '/opt/x'], '引号和 = 后的绝对路径也认');
  assert.deepStrictEqual(ab.absPathsInCommand('ls src/a/b; cat /dev/null', 'linux'), []);
  console.log('[ok] outsideAccesses');
}

function testInfraFailure() {
  assert.strictEqual(ab.infraFailure({ error: { code: 'ENOENT' } }, null), 'spawn-ENOENT', '找不到 claude');
  assert.strictEqual(ab.infraFailure({ status: 1 }, null), 'no-result-exit-1', '没有结果事件');
  assert.strictEqual(ab.infraFailure({ status: 1 }, { is_error: true, total_cost_usd: 0, terminal_reason: 'api_error' }), 'api-error-api_error', '没登录：出错且没花钱');
  assert.strictEqual(ab.infraFailure({ status: 1 }, { is_error: true, total_cost_usd: 0.4 }), null, '花了钱再出错，按无效运行计');
  assert.strictEqual(ab.infraFailure({ error: { code: 'ETIMEDOUT' }, status: null }, null), null, '超时按无效运行计');
  assert.strictEqual(ab.infraFailure({ status: 0 }, { is_error: false, total_cost_usd: 0 }), null, '桩 agent 不花钱但成功');
  console.log('[ok] infraFailure');
}

function testAgentArgsAndOrder() {
  const base = ab.buildAgentArgs({ compile: { allowed: false } }, {});
  assert.ok(base.includes('--bare'), '默认 --bare，不加载用户 CLAUDE.md、记忆与 skill');
  assert.deepStrictEqual(base.slice(base.indexOf('--model'), base.indexOf('--model') + 4), ['--model', 'claude-opus-5-5', '--effort', 'medium']);
  assert.ok(base.includes('Bash(git log:*)') && base.includes('Bash(git show:*)'), '只读 git 放行');
  assert.ok(base.includes('Bash(grep:*)') && base.includes('Bash(find:*)'), '--bare 下没有 Grep/Glob 工具，只读搜索命令放行');
  assert.ok(!base.some((a) => a.includes('mvn')), '没有编译许可时不放行 mvn');
  assert.strictEqual(base[base.indexOf('--permission-prompts') + 1], 'none', '未放行的调用自动拒绝');
  const compiled = ab.buildAgentArgs({ compile: { allowed: true } }, { noBare: true });
  assert.ok(compiled.includes('Bash(mvn -o -q -DskipTests compile)'));
  assert.ok(!compiled.includes('--bare'));

  const orders = Array.from({ length: 20 }, (_, i) => ab.conditionOrder(`T-${i}`, 1).join(''));
  assert.ok(orders.includes('AB') && orders.includes('BA'), 'A、B 先后交错');
  assert.deepStrictEqual(ab.conditionOrder('T-1', 2), ab.conditionOrder('T-1', 2), '顺序可复现');
  console.log('[ok] buildAgentArgs / conditionOrder');
}

function testStatistics() {
  const ci = ab.bootstrapCI([0.1, 0.2, 0.3, 0.4]);
  assert.deepStrictEqual(ab.bootstrapCI([0.1, 0.2, 0.3, 0.4]), ci, '固定种子，可复现');
  assert.ok(ci[0] <= 0.25 && ci[1] >= 0.25 && ci[0] < ci[1], '区间包住均值');
  const flat = ab.bootstrapCI([0.2, 0.2, 0.2]);
  close(flat[0], 0.2, '常数样本的下界');
  close(flat[1], 0.2, '常数样本的上界');

  // 文档第 6 节：σ_c=23pp、σ_in=24pp、m=3；σ_run ≤ 12pp 时 k=1，否则 k=2。
  const low = ab.sampleSizeFor(0.10);
  assert.strictEqual(low.k, 1);
  close(Number(low.sd.toFixed(4)), 0.2807, 'σ_run=10pp 的 SD');
  assert.strictEqual(low.n, 28);
  const high = ab.sampleSizeFor(0.15);
  assert.strictEqual(high.k, 2);
  assert.strictEqual(high.n, 28);
  assert.strictEqual(ab.sampleSizeFor(0.30).n, 36, '运行波动越大，需要的提交越多');

  assert.strictEqual(ab.decide(0.06, [0.01, 0.11], 1), '有增量');
  assert.strictEqual(ab.decide(0.06, [0.01, 0.11], 3.5), '不确定', '多报超线');
  assert.strictEqual(ab.decide(0.05, [0, 0.1], 0), '不确定', '下界必须大于 0');
  assert.strictEqual(ab.decide(0.01, [-0.02, 0.0499], 0), '无增量');
  assert.strictEqual(ab.decide(0.04, [-0.01, 0.09], 0), '不确定');
  console.log('[ok] bootstrapCI / sampleSizeFor / decide');
}

/* -------------------------------------------------------------------------- */
/* 2) 夹具流水线                                                                */
/* -------------------------------------------------------------------------- */

function git(dir, args, env = {}) {
  const res = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env },
  });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

function commitAll(repo, message, day) {
  const date = `2026-01-0${day}T10:00:00+0000`;
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message],
    { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function writeFile(root, rel, content) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

/** c1 建项目；c2 改 a、b 并新增 d；c3 改 c、a 和 README；c4 改 a、b、c。 */
function buildFixture(root) {
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q']);
  writeFile(repo, 'src/a.js', "const b = require('./b');\nmodule.exports = () => b();\n");
  writeFile(repo, 'src/b.js', 'module.exports = () => 1;\n');
  writeFile(repo, 'src/c.js', "const a = require('./a');\nmodule.exports = () => a();\n");
  writeFile(repo, 'README.md', '# fixture\n');
  const c1 = commitAll(repo, 'init', 1);
  writeFile(repo, 'src/a.js', "const b = require('./b');\nmodule.exports = () => b() + 1;\n");
  writeFile(repo, 'src/b.js', 'module.exports = () => 2;\n');
  writeFile(repo, 'src/d.js', 'module.exports = 4;\n');
  const c2 = commitAll(repo, 'c2', 2);
  writeFile(repo, 'src/c.js', "const a = require('./a');\nmodule.exports = () => a() * 2;\n");
  writeFile(repo, 'src/a.js', "const b = require('./b');\nmodule.exports = () => b() + 3;\n");
  writeFile(repo, 'README.md', '# fixture v2\n');
  const c3 = commitAll(repo, 'c3', 3);
  writeFile(repo, 'src/a.js', "const b = require('./b');\nmodule.exports = () => b() + 5;\n");
  writeFile(repo, 'src/b.js', 'module.exports = () => 5;\n');
  writeFile(repo, 'src/c.js', "const a = require('./a');\nmodule.exports = () => a() * 5;\n");
  const c4 = commitAll(repo, 'c4', 4);
  return { repo, c1, c2, c3, c4 };
}

function testSampleSelection(fx) {
  const fresh = ab.freshCommits('T1', { path: fx.repo, cutoff: fx.c1 }, []);
  assert.deepStrictEqual(fresh.map((c) => c.hash), [fx.c2, fx.c3, fx.c4], 'cutoff 之后的可用提交');
  const pilot = ab.pilotCommits('T1', { path: fx.repo, cutoff: fx.c4 });
  assert.deepStrictEqual(pilot.map((c) => c.hash), [fx.c4], '预实验只要统计文件 ≥ 3 且有 ≥ 2 个 M 输入的提交');
  const c4 = listCommits(fx.repo, fx.c4).find((c) => c.hash === fx.c4);
  assert.strictEqual(ab.rankInputs(c4, 2).length, 2);
  console.log('[ok] freshCommits / pilotCommits');
}

const STUB = `
const fs = require('fs');
const path = require('path');
const prompt = fs.readFileSync(0, 'utf8');
const dir = process.env.AB_STUB_DIR;
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), baseUrl: process.env.ANTHROPIC_BASE_URL || null }) + '\\n');
const emit = (text) => {
  console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.01, num_turns: 2, usage: { input_tokens: 10, output_tokens: 5 } }));
};
const first = path.join(dir, 'first-done');
if (!fs.existsSync(first)) { fs.writeFileSync(first, '1'); emit('没找到需要一起改的文件。'); process.exit(0); }
const marker = '依赖分析工具';
if (prompt.includes(marker)) {
  const json = prompt.slice(prompt.indexOf('\`\`\`json') + 7, prompt.lastIndexOf('\`\`\`'));
  const list = JSON.parse(json).impact.map((x) => x.file);
  // impact 给的是绝对路径：第一个原样交回，其余换成相对路径，两种写法都要能归一。
  const files = list.map((f, i) => (i === 0 ? f : path.relative(process.cwd(), f))).concat(['src/nope.js']);
  emit('结论 ' + JSON.stringify({ files }));
} else {
  emit('{"files": ["./SRC/A.JS", "README.md"]}');
}
`;

// 2026-10-23 实测没凭据时 claude -p 的结果事件：exit 1、is_error、花费 0。
const NOT_LOGGED_IN_STUB = `
console.log(JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'none' }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, num_turns: 1, total_cost_usd: 0, terminal_reason: 'api_error', result: 'Not logged in · Please run /login' }));
process.exit(1);
`;

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return fn(); } finally {
    for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

function testPipeline(fx, root) {
  const truth = path.join(root, 'truth');
  const work = path.join(root, 'work');
  const stubDir = path.join(root, 'stub');
  fs.mkdirSync(stubDir, { recursive: true });
  fs.writeFileSync(path.join(stubDir, 'agent.js'), STUB);
  fs.mkdirSync(truth, { recursive: true });
  fs.writeFileSync(path.join(truth, 'targets.json'), JSON.stringify({ T1: { path: fx.repo, type: 'js', cutoff: fx.c2 } }));
  const name = 'fixture';
  const out = path.join(truth, 'agent-ab', name);
  const env = { WB_AGENT_AB_TRUTH: truth, WB_AGENT_AB_WORK: work, AB_STUB_DIR: stubDir, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' };

  withEnv(env, () => {
    ab.main(['plan', '--phase', 'formal', '--name', name, '--m', '2']);
    const plan = JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8'));
    assert.deepStrictEqual(plan.commits.map((c) => c.hash), [fx.c3, fx.c4]);
    assert.strictEqual(plan.heads.T1, fx.c4, '记录冻结时原仓库 HEAD');
    assert.ok(plan.commits[0].allChanged.includes('README.md'), '保留同提交的非统计文件，打分时算中性');

    ab.main(['prepare', '--name', name, '--no-compile']);
    const tasks = JSON.parse(fs.readFileSync(path.join(out, 'tasks.json'), 'utf8'));
    assert.strictEqual(tasks.trials.length, 4);
    for (const t of tasks.trials) {
      const ws = t.workspace;
      assert.strictEqual(git(ws, ['rev-parse', 'HEAD']).trim(), t.parent, '工作区停在父提交');
      const order = [fx.c1, fx.c2, fx.c3, fx.c4];
      for (const later of order.slice(order.indexOf(t.commit))) {
        const r = spawnSync('git', ['-C', ws, 'cat-file', '-e', `${later}^{commit}`], { encoding: 'utf8', timeout: 60000 });
        assert.notStrictEqual(r.status, 0, `提交 C 及之后的提交不可达：${later.slice(0, 7)}`);
      }
      assert.strictEqual(spawnSync('git', ['-C', ws, 'cat-file', '-e', `${t.parent}^{commit}`], { timeout: 60000 }).status, 0, '父提交保留');
      assert.strictEqual(git(ws, ['remote']).trim(), '', '没有 origin');
      assert.strictEqual(git(ws, ['status', '--porcelain', '--untracked-files=no']).trim(), `M ${t.input}`, '只有输入文件是未提交改动');
      assert.strictEqual(fs.readFileSync(path.join(ws, t.input), 'utf8'), git(fx.repo, ['show', `${t.commit}:${t.input}`]), '输入文件是提交 C 里的内容');
      assert.strictEqual(t.impactExit, 0, `impact 退出码 ${t.impactExit}`);
      const promptA = fs.readFileSync(path.join(out, 'prompts', `${t.id}.A.txt`), 'utf8');
      const promptB = fs.readFileSync(path.join(out, 'prompts', `${t.id}.B.txt`), 'utf8');
      const impactRaw = fs.readFileSync(path.join(out, 'impact', `${t.id}.json`), 'utf8');
      assert.ok(promptA.includes(t.input) && !promptA.includes('依赖分析工具'), 'A 的提示词不出现工具');
      assert.ok(promptB.startsWith(promptA) && promptB.includes(impactRaw.trim()), 'B = A 的正文 + impact 原样输出');
    }
    const cTrial = tasks.trials.find((t) => t.commit === fx.c3 && t.input === 'src/c.js');
    assert.ok(cTrial && cTrial.impactList.includes('src/a.js'), `c.js 引用 a.js，impact 参照列换成相对路径后含 a.js：${JSON.stringify(cTrial && cTrial.impactList)}`);

    ab.main(['run', '--name', name, '--runs', '2', '--agent-cmd', path.join(stubDir, 'agent.js')]);
    const runsFile = path.join(out, 'runs.jsonl');
    const records = fs.readFileSync(runsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.strictEqual(records.length, 17, '4 输入 × 2 条件 × 2 次，加 1 次重跑');
    assert.strictEqual(records[0].invalid, true);
    assert.strictEqual(records[0].invalidReason, 'no-json');
    assert.strictEqual(records[1].attempt, 2, '无效后同一试次立即重跑');
    assert.strictEqual(records[1].trial, records[0].trial);
    assert.strictEqual(records[1].invalid, false);
    assert.ok(fs.existsSync(path.join(out, records[0].transcript)), '保留完整轨迹');

    const calls = fs.readFileSync(path.join(stubDir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.strictEqual(calls.length, 17);
    assert.ok(calls.every((c) => c.argv.includes('--bare') && !c.argv.some((a) => a.includes('mvn'))));
    assert.ok(calls.every((c) => c.baseUrl === null), '默认去掉 ANTHROPIC_BASE_URL，agent 直连 API');
    const real = (p) => fs.realpathSync(p).toLowerCase();
    const workspaces = new Set(tasks.trials.map((t) => real(t.workspace)));
    assert.ok(calls.every((c) => workspaces.has(real(c.cwd))), 'agent 在任务工作区里运行');
    assert.strictEqual(records[1].session.baseUrl, 'direct');
    for (const t of tasks.trials) {
      assert.strictEqual(git(t.workspace, ['status', '--porcelain', '--untracked-files=no']).trim(), `M ${t.input}`, '运行后工作区不变');
    }

    // A 组：./SRC/A.JS 归一成 src/a.js；README.md 在 c3 里是中性文件，在 c4 里是多报。
    for (const rec of records.filter((x) => x.condition === 'A' && !x.invalid)) {
      const t = tasks.trials.find((x) => x.id === rec.trial);
      const expected = t.input === 'src/a.js' ? 0 : (t.truth.includes('src/a.js') ? 1 / t.truth.length : 0);
      close(rec.recall, expected, `${rec.trial} A 召回`);
    }
    // B 组照抄 impact 列表再加一个不存在的文件：召回等于 impact 列表单独的召回。
    for (const rec of records.filter((x) => x.condition === 'B' && !x.invalid)) {
      const t = tasks.trials.find((x) => x.id === rec.trial);
      const impactHits = t.truth.filter((f) => t.impactList.includes(f)).length / t.truth.length;
      close(rec.recall, impactHits, `${rec.trial} B 召回`);
      assert.ok(rec.missing >= 1, '不存在的路径单独计数');
    }

    const again = ab.main(['run', '--name', name, '--runs', '2', '--agent-cmd', path.join(stubDir, 'agent.js')]);
    assert.strictEqual(again, 0);
    assert.strictEqual(fs.readFileSync(runsFile, 'utf8').split('\n').filter(Boolean).length, 17, '重跑时跳过已完成的试次');

    ab.main(['run', '--name', name, '--runs', '3', '--agent-cmd', path.join(stubDir, 'agent.js'), '--max-total-usd', '0.17']);
    assert.strictEqual(fs.readFileSync(runsFile, 'utf8').split('\n').filter(Boolean).length, 17, '已花费达到预算时不再运行');

    fs.writeFileSync(path.join(stubDir, 'not-logged-in.js'), NOT_LOGGED_IN_STUB);
    assert.throws(() => ab.main(['run', '--name', name, '--runs', '3', '--agent-cmd', path.join(stubDir, 'not-logged-in.js')]), /环境问题/);
    assert.strictEqual(fs.readFileSync(runsFile, 'utf8').split('\n').filter(Boolean).length, 17, '环境问题不写 runs.jsonl、不占试次');
    const infra = fs.readFileSync(path.join(out, 'infra-errors.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.strictEqual(infra.length, 1, '第一次环境问题就停，不往下跑');
    assert.strictEqual(infra[0].reason, 'api-error-api_error');

    ab.main(['score', '--name', name]);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
    assert.strictEqual(summary.commits, 2);
    assert.strictEqual(summary.inputs, 4);
    assert.strictEqual(summary.slots, 16);
    close(summary.validRatio, 1, '重跑成功后最终试次全部有效');
    const perInputA = (commit) => tasks.trials.filter((t) => t.commit === commit).map((t) => (t.input === 'src/a.js' ? 0 : (t.truth.includes('src/a.js') ? 1 / t.truth.length : 0)));
    const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    close(summary.meanRecallA, avg([avg(perInputA(fx.c3)), avg(perInputA(fx.c4))]), 'A 两级平均');
    close(summary.meanRecallB, summary.meanImpactRecall, 'B 照抄 impact 时召回等于 impact 列表召回');
    close(summary.meanD, summary.meanRecallB - summary.meanRecallA, 'd = B − A');
    assert.ok(['有增量', '无增量', '不确定'].includes(summary.decision));
    close(summary.variance.sigmaRun, 0, '桩 agent 每次输出相同，σ_run = 0');
    assert.strictEqual(summary.conditions.A.costTotalUsd + summary.conditions.B.costTotalUsd > 0, true);
    assert.ok(fs.readFileSync(path.join(out, 'summary.md'), 'utf8').includes('判定'));
  });
  console.log('[ok] plan → prepare → run → score');
  return { truth, work, name };
}

/* -------------------------------------------------------------------------- */
/* 3) CLI                                                                      */
/* -------------------------------------------------------------------------- */

function testCli(ctx) {
  const env = { ...process.env, WB_AGENT_AB_TRUTH: ctx.truth, WB_AGENT_AB_WORK: ctx.work };
  const cli = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env, timeout: 60000 });
  const frozen = cli(['plan', '--phase', 'formal', '--name', ctx.name]);
  assert.strictEqual(frozen.status, 1);
  assert.ok(frozen.stderr.includes('已冻结'));
  assert.strictEqual(cli(['run', '--name', ctx.name, '--runs', '1.5']).status, 1, '--runs 必须是正整数');
  assert.strictEqual(cli(['bogus', '--name', 'x']).status, 1);
  assert.strictEqual(cli(['--help']).status, 0);
  console.log('[ok] CLI 退出码');
}

function main() {
  testRankInputs();
  testScoreList();
  testExtractFilesJson();
  testOutsideAccesses();
  testInfraFailure();
  testAgentArgsAndOrder();
  testStatistics();

  const realOut = path.join(REPO_ROOT, 'eval', 'truth', 'agent-ab', 'fixture');
  const realBefore = fs.existsSync(realOut);
  const root = makeTempDir('wb-agent-ab-');
  try {
    const fx = buildFixture(root);
    testSampleSelection(fx);
    const ctx = testPipeline(fx, root);
    testCli(ctx);
    assert.strictEqual(fs.existsSync(realOut), realBefore, '真实 eval/truth/agent-ab 未被触碰');
    console.log('agent-ab-test.js: all passed');
  } finally {
    cleanupTempDir(root);
  }
}

main();
