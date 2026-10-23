#!/usr/bin/env node
/**
 * agent-ab — agent 参与的离线对照回放（设计与口径 v1 见 docs/experiments/agent-offline-ab.md）。
 *
 * 用法：
 *   node eval/agent-ab.js plan    --phase pilot|formal --name <名字> [--m <n>] [--include-holdout <代号,...>]
 *   node eval/agent-ab.js prepare --name <名字> [--no-compile]
 *   node eval/agent-ab.js run     --name <名字> --runs <k> [--agent-cmd <程序或 .js>] [--no-bare] [--keep-base-url] [--max-total-usd <x>]
 *   node eval/agent-ab.js score   --name <名字>
 *
 * plan 冻结样本（已存在 plan.json 时拒绝覆盖）；prepare 建截断历史的工作区、算 B 组的 impact 输出和两组提示词；
 * run 逐次调用 agent（默认 claude -p），中断后重跑会跳过已完成的试次；score 汇总并按文档第 5 节判定。
 *
 * 产出 eval/truth/agent-ab/<名字>/：plan.json、tasks.json、prompts/、impact/、runs.jsonl、transcripts/、
 * summary.json、summary.md。工作区建在系统临时目录 wb-agent-ab/<名字>/（J1 路径深，放进仓库会超长）。
 *
 * 环境变量（测试缝）：
 *   WB_AGENT_AB_TRUTH  覆盖 eval/truth 根目录（targets.json 与产出目录都以它为根）
 *   WB_AGENT_AB_WORK   覆盖工作区根目录
 *
 * 退出码按 AGENTS.md：0 成功；1 参数/业务失败；2 崩溃。
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { CLI, ROOT, TRUTH, toRepoRel, writeJson } = require('./lib');
const { listCommits, isStatFile, selectSamples, recallOf } = require('./replay-impact');

const SPEC_VERSION = 'agent-ab v1';

// ROADMAP 5.2：J1、F1 各留出时间上最新的 20 个可用提交，其余目标不留出。
const HOLDOUT_POOL = { J1: 20, F1: 20 };
const PILOT_COMMITS_PER_REPO = 2;
const PILOT_M = 2;
const FORMAL_M = 3;
const MIN_NON_ADDED_STAT = 3;     // 预实验样本：统计文件 ≥ 3 个（新增不算），每个输入至少 2 个真值

const LIST_CAP = 15;              // 提示词要求最多 15 个，和 impact 默认输出对齐
const TOP_K_EARLY = 5;            // 前 5 召回：排除「B 列得更长」带来的召回
const MODEL = 'claude-opus-5-5';
const EFFORT = 'medium';
const MAX_TURNS = 40;
const MAX_BUDGET_USD_PER_RUN = 3;
// --bare 下 agent 只有 Bash 和 Read（2026-10-23 实测 init 事件），搜索全靠这些只读命令。
const READONLY_BASH = ['git log', 'git show', 'git diff', 'git blame', 'git grep', 'grep', 'rg', 'find', 'ls'];
const COMPILE_CMD = ['mvn', '-o', '-q', '-DskipTests', 'compile'];
const COMPILE_LIMIT_MS = 5 * 60 * 1000;   // 文档第 2 节：单次编译超过 5 分钟则两组都不给编译

const GIT_TIMEOUT_MS = 10 * 60 * 1000;
const IMPACT_TIMEOUT_MS = 10 * 60 * 1000;
const AGENT_TIMEOUT_MS = 30 * 60 * 1000;
const COMPILE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_BUFFER = 256 * 1024 * 1024;

// 文档第 5、6 节：判定线、bootstrap 与样本量推算参数。
const BOOTSTRAP_ITERATIONS = 10000;
const BOOTSTRAP_SEED = 20261022;
const MIN_GAIN = 0.05;
const MAX_EXTRA_FP_PER_INPUT = 3;
const Z_POWER_SUM = 2.8016;       // 双侧 5% 的 1.96 加把握度 80% 的 0.8416
const TARGET_DELTA = 0.15;
const PROXY_SIGMA_C = 0.23;       // 三组「工具 − 笨基线」代理的中位数
const PROXY_SIGMA_IN = 0.24;
const PILOT_MIN_VALID_RATIO = 0.9;
const PILOT_MAX_MEDIAN_COST_USD = 3;

const PROMPT_TEMPLATE = [
  '这个仓库的工作区里，{input} 已经改完，改动可以用 git diff 查看。',
  '为了让这次改动完整，还有哪些已经存在的文件需要一起修改？',
  '只列你判断需要修改的文件，不列只需阅读的文件，不列新文件，最多 15 个，按把握从高到低排列。',
  '不要修改任何文件。最后只输出 JSON：{"files": ["相对仓库根目录的路径", ...]}',
].join('\n');
const IMPACT_PREFIX = '下面是依赖分析工具对这个文件的输出，可作参考：';

class UsageError extends Error {}
class AbError extends Error {}

/* -------------------------------------------------------------------------- */
/* 基础设施                                                                    */
/* -------------------------------------------------------------------------- */

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: opts.encoding === undefined ? 'utf8' : opts.encoding,
    timeout: opts.timeout || GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    cwd: opts.cwd,
    env: opts.env || process.env,
    input: opts.input,
    shell: opts.shell,
  });
  if (r.error && !opts.allowFail) throw new AbError(`${cmd} ${args[0] || ''} 无法执行: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) {
    throw new AbError(`${cmd} ${args.join(' ')} 失败 (exit ${r.status}): ${String(r.stderr || '').slice(0, 400)}`);
  }
  return r;
}

const git = (dir, args, opts = {}) => run('git', ['-c', 'core.longpaths=true', '-C', dir, ...args], opts);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const truthRoot = () => process.env.WB_AGENT_AB_TRUTH || TRUTH;
const outDirOf = (name) => path.join(truthRoot(), 'agent-ab', name);
const workDirOf = (name) => path.join(process.env.WB_AGENT_AB_WORK || path.join(os.tmpdir(), 'wb-agent-ab'), name);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const trialIdOf = (code, hash, i) => `${code}-${hash.slice(0, 7)}-${i}`;

function loadTargets() {
  const file = path.join(truthRoot(), 'targets.json');
  if (!fs.existsSync(file)) throw new AbError(`缺少 ${file}`);
  return readJson(file);
}

/* -------------------------------------------------------------------------- */
/* 1) 样本：真值、输入排序、预实验与正式样本池                                     */
/* -------------------------------------------------------------------------- */

/** 文档 3.3：M 状态、真值非空的统计文件，按 sha256(提交哈希:路径) 升序取前 m 个。真值沿用 5.2。 */
function rankInputs(commit, m) {
  const nonAdded = commit.files.filter((f) => isStatFile(f.path) && f.status !== 'A').map((f) => f.path);
  return commit.files
    .filter((f) => f.status === 'M' && isStatFile(f.path))
    .map((f) => ({ path: f.path, truth: nonAdded.filter((p) => p !== f.path), key: sha256(`${commit.hash}:${f.path}`) }))
    .filter((x) => x.truth.length > 0)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, m)
    .map(({ path: p, truth }) => ({ path: p, truth }));
}

function planEntry(code, commit, m) {
  return {
    code,
    hash: commit.hash,
    parent: commit.parentHash,
    date: new Date(commit.ts * 1000).toISOString().slice(0, 10),
    allChanged: commit.files.map((f) => f.path),
    inputs: rankInputs(commit, m),
  };
}

/** 文档 3.2：J1、F1 各取留出池之前、时间上最近的 2 个满足条件的提交（已被回放用过，不占新鲜样本）。 */
function pilotCommits(code, target) {
  const { usable } = selectSamples(listCommits(target.path, target.cutoff), { holdout: HOLDOUT_POOL[code] || 0 });
  const eligible = usable.filter((c) => {
    const nonAdded = c.files.filter((f) => isStatFile(f.path) && f.status !== 'A');
    return nonAdded.length >= MIN_NON_ADDED_STAT && rankInputs(c, Infinity).length >= PILOT_M;
  });
  return eligible.slice(-PILOT_COMMITS_PER_REPO);
}

/** 文档 3.1：cutoff 之后的可用提交，加上 --include-holdout 点名的留出池；其余留出池已被挑方案用过，不用。 */
function freshCommits(code, target, includeHoldout) {
  const cutoffSet = new Set(listCommits(target.path, target.cutoff).map((c) => c.hash));
  const { usable } = selectSamples(listCommits(target.path, 'HEAD'), { holdout: 0 });
  const pre = usable.filter((c) => cutoffSet.has(c.hash));
  const holdout = includeHoldout.includes(code) ? pre.slice(pre.length - (HOLDOUT_POOL[code] || 0)) : [];
  return [...holdout, ...usable.filter((c) => !cutoffSet.has(c.hash))];
}

function cmdPlan(opts) {
  if (!['pilot', 'formal'].includes(opts.phase)) throw new UsageError('--phase 必须是 pilot 或 formal');
  const out = outDirOf(opts.name);
  const planFile = path.join(out, 'plan.json');
  if (fs.existsSync(planFile)) throw new AbError(`${planFile} 已冻结；要换样本请用新的 --name`);
  const targets = loadTargets();
  const m = opts.phase === 'pilot' ? PILOT_M : (opts.m || FORMAL_M);
  const includeHoldout = opts.includeHoldout || [];
  const codes = opts.phase === 'pilot' ? Object.keys(HOLDOUT_POOL).filter((c) => targets[c]) : Object.keys(targets);
  const commits = [];
  const dropped = [];
  const heads = {};
  for (const code of codes) {
    const target = targets[code];
    heads[code] = git(target.path, ['rev-parse', 'HEAD']).stdout.trim();
    const picked = opts.phase === 'pilot' ? pilotCommits(code, target) : freshCommits(code, target, includeHoldout);
    for (const c of picked) {
      const entry = planEntry(code, c, m);
      if (entry.inputs.length === 0) dropped.push({ code, hash: c.hash, reason: 'no-modified-input' });
      else commits.push(entry);
    }
  }
  const plan = { specVersion: SPEC_VERSION, phase: opts.phase, createdAt: new Date().toISOString(), m, includeHoldout, heads, commits, dropped };
  writeJson(planFile, plan);
  const inputs = commits.reduce((n, c) => n + c.inputs.length, 0);
  console.log(`plan ${opts.name}: ${opts.phase}, ${commits.length} 个提交, ${inputs} 个输入, 丢弃 ${dropped.length}`);
  return plan;
}

/* -------------------------------------------------------------------------- */
/* 2) 工作区：截断历史、写入输入改动、离线编译、impact 输出、提示词                  */
/* -------------------------------------------------------------------------- */

/** ROADMAP 第 7 节 T2.2 的做法：父提交及更早的历史保留，C 及之后的提交不可达，agent 看不到答案。 */
function buildBase(repoPath, entry, baseDir) {
  fs.mkdirSync(path.dirname(baseDir), { recursive: true });
  run('git', ['-c', 'core.longpaths=true', 'clone', '-q', '--no-hardlinks', '--no-checkout', repoPath, baseDir]);
  git(baseDir, ['config', 'core.longpaths', 'true']);
  git(baseDir, ['checkout', '-q', '-B', 'agent-ab', entry.parent]);
  const branches = git(baseDir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).stdout.split('\n').filter((b) => b && b !== 'agent-ab');
  if (branches.length > 0) git(baseDir, ['branch', '-q', '-D', ...branches]);
  const tags = git(baseDir, ['tag', '-l']).stdout.split('\n').filter(Boolean);
  if (tags.length > 0) git(baseDir, ['tag', '-d', ...tags]);
  git(baseDir, ['remote', 'remove', 'origin']);
  git(baseDir, ['reflog', 'expire', '--expire=now', '--all']);
  git(baseDir, ['gc', '-q', '--prune=now']);
  if (git(baseDir, ['cat-file', '-e', `${entry.hash}^{commit}`], { allowFail: true }).status === 0) {
    throw new AbError(`${entry.code} ${entry.hash.slice(0, 7)}：截断后提交 C 仍可达`);
  }
}

function precompile(baseDir, allowCompile) {
  if (!allowCompile || !fs.existsSync(path.join(baseDir, 'pom.xml'))) return { attempted: false, allowed: false };
  const started = Date.now();
  // Windows 上 mvn 是 .cmd 包装，Node 不经 shell 起不了；命令是常量，拼成一整串交给 shell，没有注入面。
  const r = process.platform === 'win32'
    ? run(COMPILE_CMD.join(' '), [], { cwd: baseDir, timeout: COMPILE_TIMEOUT_MS, allowFail: true, shell: true })
    : run(COMPILE_CMD[0], COMPILE_CMD.slice(1), { cwd: baseDir, timeout: COMPILE_TIMEOUT_MS, allowFail: true });
  const ms = Date.now() - started;
  return { attempted: true, exit: r.status, ms, allowed: r.status === 0 && ms <= COMPILE_LIMIT_MS };
}

const trackedStatus = (ws) => git(ws, ['status', '--porcelain', '--untracked-files=no']).stdout;

function writeInputChange(ws, input, afterFile) {
  fs.writeFileSync(path.join(ws, input), fs.readFileSync(afterFile));
}

function buildPrompts(input, impactStdout) {
  const a = PROMPT_TEMPLATE.replace('{input}', input);
  const b = `${a}\n\n${IMPACT_PREFIX}\n\`\`\`json\n${impactStdout.trim()}\n\`\`\``;
  return { A: a, B: b };
}

/** impact 的 JSON 输出给的是绝对路径，参照列要换成相对工作区的写法才能和真值比。 */
function parseImpactList(stdout, ws) {
  try {
    const parsed = JSON.parse(stdout);
    const items = Array.isArray(parsed.impact) ? parsed.impact : [];
    return items.map((x) => (typeof x === 'string' ? x : x && x.file)).filter(Boolean).slice(0, LIST_CAP).map((f) => toRepoRel(ws, f));
  } catch {
    return null;
  }
}

function cmdPrepare(opts) {
  const out = outDirOf(opts.name);
  const plan = readJson(path.join(out, 'plan.json'));
  const targets = loadTargets();
  const work = workDirOf(opts.name);
  const cacheDir = path.join(work, 'wb-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const trials = [];
  for (const entry of plan.commits) {
    const repoPath = targets[entry.code].path;
    const commitDir = path.join(work, `${entry.code}-${entry.hash.slice(0, 7)}`);
    const baseDir = path.join(commitDir, 'base');
    // 输入改动在截断历史之前从原仓库读出（原仓库只读）。
    const afterFiles = entry.inputs.map((inp, i) => {
      const file = path.join(commitDir, `after-${i}`);
      if (!fs.existsSync(file)) {
        fs.mkdirSync(commitDir, { recursive: true });
        fs.writeFileSync(file, git(repoPath, ['show', `${entry.hash}:${inp.path}`], { encoding: 'buffer' }).stdout);
      }
      return file;
    });
    if (!fs.existsSync(baseDir)) buildBase(repoPath, entry, baseDir);
    const compile = precompile(baseDir, !opts.noCompile);
    entry.inputs.forEach((inp, i) => {
      const id = trialIdOf(entry.code, entry.hash, i);
      const ws = path.join(commitDir, `in${i}`);
      fs.rmSync(ws, { recursive: true, force: true });
      fs.cpSync(baseDir, ws, { recursive: true, preserveTimestamps: true });
      writeInputChange(ws, inp.path, afterFiles[i]);
      const baselineStatus = trackedStatus(ws);
      if (baselineStatus.trim() === '') throw new AbError(`${id}：写入输入改动后工作区没有变化`);
      const impact = run(process.execPath, [CLI, 'impact', '--cwd', ws, '--file', inp.path, '--json', '--quiet'], {
        env: { ...process.env, WB_CACHE_DIR: cacheDir },
        timeout: IMPACT_TIMEOUT_MS,
        allowFail: true,
      });
      const impactStdout = String(impact.stdout || '');
      fs.mkdirSync(path.join(out, 'impact'), { recursive: true });
      fs.writeFileSync(path.join(out, 'impact', `${id}.json`), impactStdout);
      const prompts = buildPrompts(inp.path, impactStdout);
      fs.mkdirSync(path.join(out, 'prompts'), { recursive: true });
      for (const cond of ['A', 'B']) fs.writeFileSync(path.join(out, 'prompts', `${id}.${cond}.txt`), prompts[cond]);
      trials.push({
        id,
        code: entry.code,
        commit: entry.hash,
        parent: entry.parent,
        input: inp.path,
        truth: inp.truth,
        allChanged: entry.allChanged,
        workspace: ws,
        afterFile: afterFiles[i],
        baselineStatus,
        compile,
        impactExit: impact.status,
        impactList: parseImpactList(impactStdout, ws),
        promptSha: { A: sha256(prompts.A), B: sha256(prompts.B) },
      });
    });
  }
  const tool = {
    commit: git(ROOT, ['rev-parse', 'HEAD']).stdout.trim(),
    dirty: git(ROOT, ['status', '--porcelain']).stdout.trim() !== '',
  };
  writeJson(path.join(out, 'tasks.json'), { specVersion: SPEC_VERSION, name: opts.name, phase: plan.phase, preparedAt: new Date().toISOString(), tool, trials });
  console.log(`prepare ${opts.name}: ${trials.length} 个输入，工作区 ${work}`);
  return trials;
}

/* -------------------------------------------------------------------------- */
/* 3) 运行：调用 agent、校验、打分                                               */
/* -------------------------------------------------------------------------- */

function buildAgentArgs(trial, opts) {
  const allowed = ['Read', 'Grep', 'Glob', ...READONLY_BASH.map((cmd) => `Bash(${cmd}:*)`)];
  if (trial.compile && trial.compile.allowed) allowed.push(`Bash(${COMPILE_CMD.join(' ')})`);
  return [
    '-p',
    ...(opts.noBare ? [] : ['--bare']),
    '--model', MODEL,
    '--effort', EFFORT,
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--tools', 'Read,Grep,Glob,Bash',
    '--allowedTools', ...allowed,
    '--permission-prompts', 'none',
    '--max-turns', String(MAX_TURNS),
    '--max-budget-usd', String(MAX_BUDGET_USD_PER_RUN),
    '--output-format', 'stream-json',
    '--verbose',
  ];
}

/** 本机 ANTHROPIC_BASE_URL 指向 Headroom 压缩代理；默认去掉，两组都直连 API，token 和 agent 看到的内容不被压缩改写。 */
function agentEnv(opts) {
  const env = { ...process.env };
  if (!opts.keepBaseUrl) delete env.ANTHROPIC_BASE_URL;
  return env;
}

/** 取文本里最后一个带 files 数组的 JSON 对象；agent 常在 JSON 前后加说明或代码围栏。 */
function extractFilesJson(text) {
  const s = String(text || '');
  for (let start = s.lastIndexOf('{'); start >= 0; start = s.lastIndexOf('{', start - 1)) {
    let depth = 0;
    let inStr = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (ch === '\\') i++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try {
          const obj = JSON.parse(s.slice(start, i + 1));
          if (obj && Array.isArray(obj.files)) return obj.files.filter((f) => typeof f === 'string');
        } catch {}
        break;
      }
    }
    if (start === 0) break;
  }
  return null;
}

function parseStream(stdout) {
  const events = [];
  for (const line of String(stdout || '').split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch {}
  }
  const result = [...events].reverse().find((e) => e && e.type === 'result') || null;
  return { events, result };
}

const PATH_KEYS = ['file_path', 'path', 'notebook_path'];
const samePrefix = (child, parent) => {
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const c = norm(child);
  const root = norm(parent);
  return c === root || c.startsWith(root + path.sep);
};
// Bash 命令里的绝对路径，只认词首（行首、空白、引号、= 之后），免得把 src/a/b.js 里的 /a/ 当成盘符。
// Windows 认盘符写法和 git-bash 的 /c/ 写法；其他平台认 / 开头的词。
const ABS_IN_COMMAND = {
  win32: /(?:^|[\s'"=(])((?:[A-Za-z]:[\\/]|\/[A-Za-z]\/)[^\s'"|;&<>()]*)/g,
  posix: /(?:^|[\s'"=(])(\/[^\s'"|;&<>()]+)/g,
};
const IGNORED_ABS = new Set(['/dev/null']);

function absPathsInCommand(command, platform = process.platform) {
  const found = [];
  for (const m of String(command).matchAll(platform === 'win32' ? ABS_IN_COMMAND.win32 : ABS_IN_COMMAND.posix)) {
    const raw = m[1];
    if (IGNORED_ABS.has(raw)) continue;
    found.push(platform === 'win32' && /^\/[A-Za-z]\//.test(raw) ? `${raw[1]}:${raw.slice(2)}` : raw);
  }
  return found;
}

const blocksOf = (e, role) => (e && e.type === role && e.message && Array.isArray(e.message.content) ? e.message.content : []);

/**
 * agent 用 Read/Grep/Glob 读到工作区以外的路径，说明可能看到了答案或无关仓库，该次记为无效。
 * 被权限拒绝的调用（tool_result 带 is_error）没有读到内容，不算。
 */
function outsideAccesses(events, ws) {
  const failed = new Set();
  for (const e of events) {
    for (const block of blocksOf(e, 'user')) {
      if (block && block.type === 'tool_result' && block.is_error) failed.add(block.tool_use_id);
    }
  }
  const hits = [];
  for (const e of events) {
    for (const block of blocksOf(e, 'assistant')) {
      if (!block || block.type !== 'tool_use' || !block.input || failed.has(block.id)) continue;
      for (const key of PATH_KEYS) {
        const v = block.input[key];
        if (typeof v === 'string' && v && !samePrefix(path.resolve(ws, v), ws)) hits.push(`${block.name}:${v}`);
      }
      if (typeof block.input.command === 'string') {
        for (const p of absPathsInCommand(block.input.command)) {
          if (!samePrefix(p, ws)) hits.push(`${block.name}:${p}`);
        }
      }
    }
  }
  return hits;
}

/** 文档第 4 节：路径归一后按 P 的跟踪文件回查真实写法，算召回、精确率、多报和前 5 召回。 */
function scoreList(rawFiles, ctx) {
  const lower = new Map([...ctx.tracked].map((p) => [p.toLowerCase(), p]));
  const seen = new Set();
  const list = [];
  for (const raw of rawFiles) {
    const rel = toRepoRel(ctx.workspace, String(raw).trim());
    const real = ctx.tracked.has(rel) ? rel : lower.get(rel.toLowerCase()) || rel;
    if (real === ctx.input || seen.has(real)) continue;
    seen.add(real);
    list.push(real);
  }
  const overLimit = list.length > LIST_CAP;
  const capped = list.slice(0, LIST_CAP);
  const truth = new Set(ctx.truth);
  const changed = new Set(ctx.allChanged);
  const hits = capped.filter((p) => truth.has(p)).length;
  const neutral = capped.filter((p) => !truth.has(p) && changed.has(p) && !isStatFile(p)).length;
  const missing = capped.filter((p) => !ctx.tracked.has(p)).length;
  const judged = capped.length - neutral;
  return {
    files: capped,
    overLimit,
    recall: recallOf(ctx.truth, capped),
    recallAt5: recallOf(ctx.truth, capped.slice(0, TOP_K_EARLY)),
    precision: judged > 0 ? hits / judged : null,
    hits,
    fp: judged - hits,
    missing,
    neutral,
  };
}

function conditionOrder(trialId, r) {
  return parseInt(sha256(`${trialId}:${r}`).slice(0, 8), 16) % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
}

function loadRuns(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function runOnce(trial, cond, r, attempt, ctx) {
  const prompt = fs.readFileSync(path.join(ctx.out, 'prompts', `${trial.id}.${cond}.txt`), 'utf8');
  const args = buildAgentArgs(trial, ctx.opts);
  const [cmd, argv] = /\.js$/i.test(ctx.opts.agentCmd) ? [process.execPath, [ctx.opts.agentCmd, ...args]] : [ctx.opts.agentCmd, args];
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const res = run(cmd, argv, { cwd: trial.workspace, input: prompt, env: agentEnv(ctx.opts), timeout: AGENT_TIMEOUT_MS, allowFail: true });
  const durationMs = Date.now() - t0;
  const base = `${trial.id}.${cond}.r${r}.a${attempt}`;
  fs.mkdirSync(path.join(ctx.out, 'transcripts'), { recursive: true });
  fs.writeFileSync(path.join(ctx.out, 'transcripts', `${base}.jsonl`), String(res.stdout || ''));
  fs.writeFileSync(path.join(ctx.out, 'transcripts', `${base}.stderr.txt`), String(res.stderr || '') + (res.error ? `\n${res.error.message}` : ''));

  const { events, result } = parseStream(res.stdout);
  const init = events.find((e) => e && e.type === 'system' && e.subtype === 'init') || {};
  const outside = outsideAccesses(events, trial.workspace);
  const statusAfter = trackedStatus(trial.workspace);
  const modified = statusAfter !== trial.baselineStatus;
  if (modified) {
    git(trial.workspace, ['checkout', '--', '.']);
    writeInputChange(trial.workspace, trial.input, trial.afterFile);
  }
  const files = result && typeof result.result === 'string' ? extractFilesJson(result.result) : null;
  let invalidReason = null;
  if (res.error || res.status !== 0) invalidReason = `exit-${res.status === null ? 'killed' : res.status}`;
  else if (!result) invalidReason = 'no-result';
  else if (result.subtype !== 'success' || result.is_error) invalidReason = `result-${result.subtype || 'error'}`;
  else if (files === null) invalidReason = 'no-json';
  else if (outside.length > 0) invalidReason = 'outside-workspace';
  else if (modified) invalidReason = 'workspace-modified';

  const record = {
    trial: trial.id, code: trial.code, commit: trial.commit, input: trial.input, condition: cond, run: r, attempt,
    startedAt, durationMs, exit: res.status,
    session: { model: init.model || null, tools: init.tools || null, apiKeySource: init.apiKeySource || null, baseUrl: ctx.opts.keepBaseUrl ? 'kept' : 'direct' },
    numTurns: result ? result.num_turns : null,
    costUsd: result && typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null,
    usage: result ? result.usage || null : null,
    invalid: invalidReason !== null, invalidReason, outside,
    rawFiles: files,
    ...(files ? scoreList(files, { ...trial, tracked: ctx.trackedOf(trial) }) : {}),
    transcript: path.join('transcripts', `${base}.jsonl`),
  };
  fs.appendFileSync(ctx.runsFile, `${JSON.stringify(record)}\n`);
  return record;
}

function cmdRun(opts) {
  if (!opts.runs) throw new UsageError('run 需要 --runs <k>');
  const out = outDirOf(opts.name);
  const tasks = readJson(path.join(out, 'tasks.json'));
  const runsFile = path.join(out, 'runs.jsonl');
  const records = loadRuns(runsFile);
  const trackedCache = new Map();
  const ctx = {
    out, runsFile, opts,
    trackedOf: (t) => {
      if (!trackedCache.has(t.id)) trackedCache.set(t.id, new Set(git(t.workspace, ['ls-files']).stdout.split('\n').filter(Boolean)));
      return trackedCache.get(t.id);
    },
  };
  let spent = records.reduce((s, x) => s + (x.costUsd || 0), 0);
  let executed = 0;
  for (const trial of tasks.trials) {
    for (let r = 1; r <= opts.runs; r++) {
      for (const cond of conditionOrder(trial.id, r)) {
        const prior = records.filter((x) => x.trial === trial.id && x.condition === cond && x.run === r);
        // 文档第 8 节第 7 条：无效运行原样保存，同一试次只重跑一次。
        if (prior.some((x) => !x.invalid) || prior.length >= 2) continue;
        for (let attempt = prior.length + 1; attempt <= 2; attempt++) {
          if (opts.maxTotalUsd !== undefined && spent >= opts.maxTotalUsd) {
            console.log(`已花 ${spent.toFixed(2)} 美元，达到 --max-total-usd ${opts.maxTotalUsd}，停止`);
            return { executed, spent, stopped: true };
          }
          const rec = runOnce(trial, cond, r, attempt, ctx);
          records.push(rec);
          spent += rec.costUsd || 0;
          executed += 1;
          console.log(`${trial.id} ${cond} r${r} a${attempt}: ${rec.invalid ? `无效 ${rec.invalidReason}` : `召回 ${rec.recall.toFixed(2)}，${rec.files.length} 个`}，${(rec.durationMs / 1000).toFixed(0)}s`);
          if (!rec.invalid) break;
        }
      }
    }
  }
  return { executed, spent, stopped: false };
}

/* -------------------------------------------------------------------------- */
/* 4) 汇总：两级平均、配对 bootstrap、方差与样本量、判定                            */
/* -------------------------------------------------------------------------- */

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const sampleVar = (a) => {
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
};

function bootstrapCI(values) {
  let state = BOOTSTRAP_SEED >>> 0;
  const rand = () => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 2 ** 32);
  const means = [];
  for (let b = 0; b < BOOTSTRAP_ITERATIONS; b++) {
    let s = 0;
    for (let i = 0; i < values.length; i++) s += values[Math.floor(rand() * values.length)];
    means.push(s / values.length);
  }
  means.sort((x, y) => x - y);
  // 两端各去掉 2.5% 的重抽均值。
  const tail = Math.floor(0.025 * BOOTSTRAP_ITERATIONS);
  return [means[tail], means[BOOTSTRAP_ITERATIONS - 1 - tail]];
}

/** 文档第 6 节：Var(d) = σ_c² + σ_in²/m + 2σ_run²/(m·k)，再按把握度公式求检出 15pp 所需提交数。 */
function sampleSizeFor(sigmaRun, m = FORMAL_M) {
  const k = sigmaRun ** 2 <= PROXY_SIGMA_IN ** 2 / 4 ? 1 : 2;
  const sd = Math.sqrt(PROXY_SIGMA_C ** 2 + PROXY_SIGMA_IN ** 2 / m + (2 * sigmaRun ** 2) / (m * k));
  return { k, m, sd, n: Math.ceil((Z_POWER_SUM * sd / TARGET_DELTA) ** 2) };
}

/** 文档第 5 节的三条判定。 */
function decide(meanD, ci, extraFp) {
  if (meanD >= MIN_GAIN && ci[0] > 0 && extraFp <= MAX_EXTRA_FP_PER_INPUT) return '有增量';
  if (ci[1] < MIN_GAIN) return '无增量';
  return '不确定';
}

/** 每个试次（输入 × 条件 × 第几次）取最后一次尝试；重跑后仍无效的召回按 0 计，其他指标不计。 */
function finalSlots(records) {
  const slots = new Map();
  for (const rec of records) {
    const key = `${rec.trial}|${rec.condition}|${rec.run}`;
    const prev = slots.get(key);
    if (!prev || rec.attempt > prev.attempt) slots.set(key, rec);
  }
  return [...slots.values()];
}

function summarize(tasks, records) {
  const slots = finalSlots(records);
  const cell = (trialId, cond) => slots.filter((s) => s.trial === trialId && s.condition === cond);
  const perTrial = tasks.trials.map((t) => {
    const out = { id: t.id, code: t.code, commit: t.commit };
    for (const cond of ['A', 'B']) {
      const xs = cell(t.id, cond);
      const valid = xs.filter((x) => !x.invalid);
      out[cond] = {
        slots: xs.length,
        recall: mean(xs.map((x) => (x.invalid ? 0 : x.recall))),
        recallAt5: mean(valid.map((x) => x.recallAt5)),
        precision: mean(valid.map((x) => x.precision).filter((p) => p !== null)),
        fp: mean(valid.map((x) => x.fp)),
        listLength: mean(valid.map((x) => x.files.length)),
        recalls: valid.map((x) => x.recall),
      };
    }
    out.impactRecall = Array.isArray(t.impactList) ? recallOf(t.truth, t.impactList) : null;
    return out;
  }).filter((t) => t.A.slots > 0 && t.B.slots > 0);

  const commits = [...new Set(perTrial.map((t) => t.commit))].map((hash) => {
    const ts = perTrial.filter((t) => t.commit === hash);
    const avg = (fn) => mean(ts.map(fn).filter((v) => v !== null));
    return {
      code: ts[0].code,
      inputs: ts.length,
      recallA: avg((t) => t.A.recall),
      recallB: avg((t) => t.B.recall),
      d: avg((t) => t.B.recall - t.A.recall),
      dAt5: avg((t) => (t.A.recallAt5 === null || t.B.recallAt5 === null ? null : t.B.recallAt5 - t.A.recallAt5)),
      precisionA: avg((t) => t.A.precision),
      precisionB: avg((t) => t.B.precision),
      impactRecall: avg((t) => t.impactRecall),
    };
  });
  const ds = commits.map((c) => c.d);
  const ci = ds.length ? bootstrapCI(ds) : [null, null];
  const meanD = mean(ds);
  const extraFp = mean(perTrial.filter((t) => t.A.fp !== null && t.B.fp !== null).map((t) => t.B.fp - t.A.fp));

  const cost = (cond) => slots.filter((s) => s.condition === cond && s.costUsd !== null).map((s) => s.costUsd);
  const usageSum = (cond, key) => slots.filter((s) => s.condition === cond && s.usage).reduce((n, s) => n + (s.usage[key] || 0), 0);
  const conditions = {};
  for (const cond of ['A', 'B']) {
    const xs = slots.filter((s) => s.condition === cond);
    conditions[cond] = {
      slots: xs.length,
      invalid: xs.filter((s) => s.invalid).length,
      costMeanUsd: mean(cost(cond)),
      costMedianUsd: median(cost(cond)),
      costTotalUsd: cost(cond).reduce((s, x) => s + x, 0),
      turnsMean: mean(xs.map((s) => s.numTurns).filter((v) => typeof v === 'number')),
      durationMeanMs: mean(xs.map((s) => s.durationMs)),
      tokens: Object.fromEntries(['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens'].map((k) => [k, usageSum(cond, k)])),
    };
  }

  // σ_run：同一输入、同一条件、≥ 2 次有效运行的召回样本方差，按单元合并。
  const cellVars = perTrial.flatMap((t) => ['A', 'B'].map((c) => t[c].recalls)).filter((rs) => rs.length >= 2).map(sampleVar);
  const sigmaRun = cellVars.length ? Math.sqrt(mean(cellVars)) : null;
  const allCosts = [...cost('A'), ...cost('B')];
  const validRatio = slots.length ? slots.filter((s) => !s.invalid).length / slots.length : null;

  const summary = {
    specVersion: SPEC_VERSION,
    name: tasks.name,
    phase: tasks.phase,
    tool: tasks.tool,
    commits: commits.length,
    inputs: perTrial.length,
    slots: slots.length,
    validRatio,
    meanRecallA: mean(commits.map((c) => c.recallA)),
    meanRecallB: mean(commits.map((c) => c.recallB)),
    meanImpactRecall: mean(commits.map((c) => c.impactRecall).filter((v) => v !== null)),
    meanD,
    ci95: ci,
    meanDAt5: mean(commits.map((c) => c.dAt5).filter((v) => v !== null)),
    extraFpPerInput: extraFp,
    byCode: Object.fromEntries([...new Set(commits.map((c) => c.code))].map((code) => {
      const cs = commits.filter((c) => c.code === code);
      return [code, { commits: cs.length, meanD: mean(cs.map((c) => c.d)) }];
    })),
    conditions,
    variance: { sigmaRun, cells: cellVars.length, sdOfD: ds.length >= 2 ? Math.sqrt(sampleVar(ds)) : null },
    perCommit: commits,
  };
  if (tasks.phase === 'pilot') {
    summary.pilot = {
      validOk: validRatio !== null && validRatio >= PILOT_MIN_VALID_RATIO,
      medianCostUsd: median(allCosts),
      costOk: allCosts.length > 0 && median(allCosts) <= PILOT_MAX_MEDIAN_COST_USD,
      formalSize: sigmaRun === null ? null : sampleSizeFor(sigmaRun),
    };
  } else {
    summary.decision = meanD === null ? null : decide(meanD, ci, extraFp);
  }
  return summary;
}

const absent = (v) => v === null || v === undefined;
const pct = (v) => (absent(v) ? '—' : `${(v * 100).toFixed(1)}%`);
const pp = (v) => (absent(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}pp`);
const pts = (v) => (absent(v) ? '—' : `${(v * 100).toFixed(1)}pp`);
const num = (v) => (absent(v) ? '—' : v.toFixed(1));
const usd = (v) => (absent(v) ? '—' : `$${v.toFixed(2)}`);

function renderMarkdown(s) {
  const lines = [
    `# agent-ab ${s.name}（${s.phase}）`,
    '',
    `${s.specVersion}；工具提交 ${s.tool.commit.slice(0, 7)}${s.tool.dirty ? '（工作区有未提交改动）' : ''}；${s.commits} 个提交、${s.inputs} 个输入、${s.slots} 个试次，有效 ${pct(s.validRatio)}。`,
    '',
    '| 指标 | A | B |',
    '|---|---:|---:|',
    `| 召回（两级平均） | ${pct(s.meanRecallA)} | ${pct(s.meanRecallB)} |`,
    `| 无效试次 | ${s.conditions.A.invalid} | ${s.conditions.B.invalid} |`,
    `| 单次成本均值 / 中位数 | ${usd(s.conditions.A.costMeanUsd)} / ${usd(s.conditions.A.costMedianUsd)} | ${usd(s.conditions.B.costMeanUsd)} / ${usd(s.conditions.B.costMedianUsd)} |`,
    `| 平均轮数 | ${num(s.conditions.A.turnsMean)} | ${num(s.conditions.B.turnsMean)} |`,
    '',
    `d = B − A：${pp(s.meanD)}，95% 区间 [${pp(s.ci95[0])}, ${pp(s.ci95[1])}]；前 5 召回差 ${pp(s.meanDAt5)}；B 比 A 每输入多报 ${num(s.extraFpPerInput)} 个；impact 列表单独召回 ${pct(s.meanImpactRecall)}。`,
    '',
    `σ_run = ${pts(s.variance.sigmaRun)}（${s.variance.cells} 个单元），提交级 d 的标准差 ${pts(s.variance.sdOfD)}。`,
  ];
  if (s.pilot) {
    const f = s.pilot.formalSize;
    lines.push('', `预实验检查：有效率 ${s.pilot.validOk ? '达标' : '未达标'}，单次成本中位数 ${usd(s.pilot.medianCostUsd)}（${s.pilot.costOk ? '达标' : '未达标'}）；按文档第 6 节，k = ${f ? f.k : '—'}，SD ${f ? pts(f.sd) : '—'}，检出 15pp 需 ${f ? f.n : '—'} 个提交。`);
  } else {
    lines.push('', `判定（文档第 5 节）：**${s.decision}**`);
  }
  return `${lines.join('\n')}\n`;
}

function cmdScore(opts) {
  const out = outDirOf(opts.name);
  const tasks = readJson(path.join(out, 'tasks.json'));
  const summary = summarize(tasks, loadRuns(path.join(out, 'runs.jsonl')));
  writeJson(path.join(out, 'summary.json'), summary);
  fs.writeFileSync(path.join(out, 'summary.md'), renderMarkdown(summary));
  console.log(renderMarkdown(summary));
  return summary;
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  if (argv[0] === '-h' || argv[0] === '--help') return { help: true };
  const o = { command: argv[0], agentCmd: 'claude' };
  const need = (flag, i) => {
    if (i + 1 >= argv.length) throw new UsageError(`${flag} 缺少取值`);
    return argv[i + 1];
  };
  const positiveNumber = (flag, v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${flag} 必须是正数，收到: ${v}`);
    return n;
  };
  const positiveInt = (flag, v) => {
    const n = positiveNumber(flag, v);
    if (!Number.isInteger(n)) throw new UsageError(`${flag} 必须是正整数，收到: ${v}`);
    return n;
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--name': o.name = need(a, i); i++; break;
      case '--phase': o.phase = need(a, i); i++; break;
      case '--m': o.m = positiveInt(a, need(a, i)); i++; break;
      case '--include-holdout': o.includeHoldout = need(a, i).split(',').map((s) => s.trim()).filter(Boolean); i++; break;
      case '--no-compile': o.noCompile = true; break;
      case '--runs': o.runs = positiveInt(a, need(a, i)); i++; break;
      case '--agent-cmd': o.agentCmd = need(a, i); i++; break;
      case '--no-bare': o.noBare = true; break;
      case '--keep-base-url': o.keepBaseUrl = true; break;
      case '--max-total-usd': o.maxTotalUsd = positiveNumber(a, need(a, i)); i++; break;
      case '-h': case '--help': o.help = true; break;
      default: throw new UsageError(`未知参数: ${a}`);
    }
  }
  if (!o.help && !['plan', 'prepare', 'run', 'score'].includes(o.command)) throw new UsageError(`未知子命令: ${o.command || '（空）'}`);
  if (!o.help && !o.name) throw new UsageError('缺少 --name');
  if (o.name && !/^[\w.-]+$/.test(o.name)) throw new UsageError(`--name 只能含字母、数字、点、下划线和连字符，收到: ${o.name}`);
  return o;
}

function printUsage() {
  console.error([
    '用法:',
    '  node eval/agent-ab.js plan    --phase pilot|formal --name <名字> [--m <n>] [--include-holdout <代号,...>]',
    '  node eval/agent-ab.js prepare --name <名字> [--no-compile]',
    '  node eval/agent-ab.js run     --name <名字> --runs <k> [--agent-cmd <程序或 .js>] [--no-bare] [--keep-base-url] [--max-total-usd <x>]',
    '  node eval/agent-ab.js score   --name <名字>',
  ].join('\n'));
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printUsage();
    return 0;
  }
  const commands = { plan: cmdPlan, prepare: cmdPrepare, run: cmdRun, score: cmdScore };
  commands[opts.command](opts);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}`);
      printUsage();
      process.exitCode = 1;
    } else if (err instanceof AbError) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    } else {
      console.error((err && err.stack) || err);
      process.exitCode = 2;
    }
  }
}

module.exports = {
  rankInputs,
  pilotCommits,
  freshCommits,
  buildPrompts,
  buildAgentArgs,
  extractFilesJson,
  absPathsInCommand,
  outsideAccesses,
  scoreList,
  conditionOrder,
  bootstrapCI,
  sampleSizeFor,
  decide,
  summarize,
  main,
};
