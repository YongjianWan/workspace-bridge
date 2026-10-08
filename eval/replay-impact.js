#!/usr/bin/env node
/**
 * ROADMAP 5.4 T0.1 — impact 回放脚本（口径 v1，见 ROADMAP 5.2 / 5.3）。
 *
 * 用法：
 *   node eval/replay-impact.js --repo <仓库路径> --name <名字> [选项]
 *   node eval/replay-impact.js --target <代号> [选项]        （从 eval/truth/targets.json 查路径）
 * 选项：
 *   --holdout <n>            留出任务池大小（默认 0，J1/F1 运行时设 20）
 *   --impact-option <名=值>  原样传给 impact（可重复，如 max-depth=3）
 *   --max-commits <n>        只回放时间上最新的 n 个可用提交（按时间正序处理）
 *   --sample <n|all>         抽样决策（默认 all；sample.json 已存在时沿用不重选）
 *
 * 环境变量：
 *   WB_REPLAY_TRUTH  覆盖 eval/truth 根目录：--target 读的 targets.json 和
 *                    main() 的默认 outDir 都以它为根；未设置时行为不变（测试缝）。
 *
 * 产出 eval/truth/replay/<名字>/{runs.jsonl, summary.json, summary.md, sample.json}。
 * 每个提交一个独立子进程（5.3 第 2 条），同一回放共用临时 cacheDir 走增量缓存（5.3 第 3 条）。
 * 退出码按 AGENTS.md：0 成功；1 参数/路径/业务失败；2 崩溃。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { toRepoRel, writeJson, TRUTH } = require('./lib');

const TOOL_ROOT = path.resolve(__dirname, '..');
const CHILD_MARKER = '@@RESULT@@';

// 回放跑的是真实业务仓库：git log / clone 给足超时；子进程含容器冷启动（J1 冷启动
// 预估 36s+，见 ROADMAP 5.3-6），单提交容器初始化给 300s，避免默认 60s 误杀。
const GIT_TIMEOUT_MS = 120_000;
const INIT_TIMEOUT_MS = 300_000;
const CHILD_TIMEOUT_MS = 600_000;

const DEFAULT_BASELINE_K = 15;      // 5.2：工具输出为空时笨基线取 15 个
const MAX_STAT_PER_COMMIT = 20;     // 5.2：样本与笨基线历史都剔除统计文件超过 20 个的提交
const HUB_DEPENDENT_THRESHOLD = 50; // 5.2 结构上限：被 ≥50 个文件引用的公共文件可作终点、不作中转
const STRUCTURAL_MAX_DEPTH = 3;     // 5.2 结构上限：无向 3 步

const STAT_EXTENSIONS = new Set(['.java', '.xml', '.vue', '.js', '.ts', '.jsx', '.tsx', '.py']);
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'target', 'build']);
const EXCLUDED_FILES = new Set(['pom.xml', 'package.json', 'package-lock.json']);

const STEM_SUFFIXES = [
  'ServiceImpl', 'Service', 'Impl', 'Mapper', 'Controller',
  'VO', 'Vo', 'DTO', 'Dto', 'PO', 'Entity',
  'Request', 'Req', 'Response', 'Resp', 'Query', 'Form', 'Api',
];

const EDGE_TYPES = ['Java→Java', 'Java→Mapper XML', 'Mapper XML→Java', '实体→VO/DTO', '前端内部', 'Python→Python'];
const FRONT_EXTENSIONS = new Set(['.vue', '.js', '.ts', '.jsx', '.tsx']);
const ENTITY_DIRS = new Set(['entity', 'domain', 'po', 'model']);
const VO_SUFFIXES = ['VO', 'Vo', 'DTO', 'Dto'];

class UsageError extends Error {}
class ReplayError extends Error {}

/* -------------------------------------------------------------------------- */
/* git 助手（一律 `git -C`，避免 Windows 下 cwd 含 CJK 路径的编码问题）          */
/* -------------------------------------------------------------------------- */

function gitRun(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new ReplayError(`git ${args[0]} 无法执行: ${r.error.message}`);
  if (r.status !== 0) {
    throw new ReplayError(`git ${args.join(' ')} 失败 (exit ${r.status}): ${String(r.stderr || '').slice(0, 400)}`);
  }
  return r.stdout;
}

function assertGitRepo(dir) {
  if (!fs.existsSync(dir)) throw new UsageError(`路径不存在: ${dir}`);
  gitRun(dir, ['rev-parse', '--git-dir']);
}

/** 按提交时间正序解析 cutoff 及更早的提交（含 A/M/D 文件清单，--no-renames 口径）。 */
function listCommits(repoDir, cutoff) {
  const out = gitRun(repoDir, [
    'log', '--reverse', '--no-renames', '--name-status',
    '--format=%x1e%H%x1f%ct%x1f%P', cutoff,
  ]);
  const commits = [];
  for (const rec of out.split('\x1e')) {
    if (rec.trim() === '') continue;
    const lines = rec.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    const [hash, ct, parents] = lines[0].split('\x1f');
    const files = lines.slice(1)
      .map((l) => { const [status, p] = l.split('\t'); return { path: p, status }; })
      .filter((f) => f.path && f.status);
    const ps = (parents || '').split(' ').filter(Boolean);
    commits.push({ hash, ts: Number(ct), isMerge: ps.length > 1, parentHash: ps[0] || null, files });
  }
  return commits;
}

/** 5.2 笨基线历史：P 及更早的非合并提交的统计文件清单，剔除统计文件超过 20 个的提交。 */
function historyForBaseline(root, parentHash) {
  const out = gitRun(root, ['log', '--no-merges', '--no-renames', '--name-only', '--format=%x1e%H', parentHash]);
  const history = [];
  for (const rec of out.split('\x1e')) {
    if (rec.trim() === '') continue;
    const paths = rec.split('\n').map((l) => l.trim()).filter((l) => l !== '')
      .slice(1).filter((p) => isStatFile(p));
    if (paths.length > MAX_STAT_PER_COMMIT) continue;
    history.push(paths);
  }
  return history;
}

function coChangeCountsAt(history, input) {
  const counts = new Map();
  for (const paths of history) {
    if (!paths.includes(input)) continue;
    for (const p of paths) if (p !== input) counts.set(p, (counts.get(p) || 0) + 1);
  }
  return counts;
}

/* -------------------------------------------------------------------------- */
/* 1) 统计文件与主干名                                                          */
/* -------------------------------------------------------------------------- */

function isStatFile(filePath) {
  const s = String(filePath).replace(/\\/g, '/');
  const parts = s.split('/');
  const base = parts[parts.length - 1];
  if (EXCLUDED_FILES.has(base)) return false;
  for (let i = 0; i < parts.length - 1; i++) {
    if (EXCLUDED_DIRS.has(parts[i])) return false;
  }
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return STAT_EXTENSIONS.has(base.slice(dot));
}

function stemName(filePath) {
  const s = String(filePath).replace(/\\/g, '/');
  const base = s.slice(s.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const name = dot > 0 ? base.slice(0, dot) : base;
  let cur = name;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of STEM_SUFFIXES) {
      if (cur.endsWith(suffix)) {
        cur = cur.slice(0, cur.length - suffix.length);
        changed = true;
      }
    }
  }
  return cur.length > 0 ? cur : name;
}

/* -------------------------------------------------------------------------- */
/* 2) 召回率、两级平均、边类型、抽样公式                                          */
/* -------------------------------------------------------------------------- */

function recallOf(truth, list) {
  if (!Array.isArray(truth) || truth.length === 0) return 0;
  const seen = new Set(list || []);
  let hit = 0;
  for (const t of truth) if (seen.has(t)) hit += 1;
  return hit / truth.length;
}

/** 5.2 两级平均：提交内对输入取平均 → 提交间取平均（空提交不参与）。 */
function twoLevelAverage(perCommit) {
  const commitMeans = [];
  for (const arr of perCommit || []) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    let sum = 0;
    for (const v of arr) sum += v;
    commitMeans.push(sum / arr.length);
  }
  if (commitMeans.length === 0) return 0;
  let sum = 0;
  for (const v of commitMeans) sum += v;
  return sum / commitMeans.length;
}

const extOf = (p) => {
  const s = String(p);
  const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  const dot = s.lastIndexOf('.');
  return dot > slash ? s.slice(dot).toLowerCase() : '';
};
const baseNameOf = (p) => {
  const s = String(p);
  return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1);
};
const dirSegmentsOf = (p) => String(p).replace(/\\/g, '/').split('/').slice(0, -1);

const isJavaFile = (p) => extOf(p) === '.java';
const isPyFile = (p) => extOf(p) === '.py';
const isFrontFile = (p) => FRONT_EXTENSIONS.has(extOf(p));
const isMapperXml = (p) => extOf(p) === '.xml'
  && (dirSegmentsOf(p).includes('mapper') || baseNameOf(p).endsWith('Mapper.xml'));
const isEntityDir = (p) => dirSegmentsOf(p).some((seg) => ENTITY_DIRS.has(seg));
const isVoName = (p) => {
  const base = baseNameOf(p);
  const dot = base.lastIndexOf('.');
  const name = dot > 0 ? base.slice(0, dot) : base;
  return VO_SUFFIXES.some((s) => name.endsWith(s));
};

// 5.2 边类型规则表（类型可重叠：命中多条就返回多个）。顺序即输出顺序。
const EDGE_TYPE_RULES = [
  { type: 'Java→Java', test: (a, b) => isJavaFile(a) && isJavaFile(b) },
  { type: 'Java→Mapper XML', test: (a, b) => isJavaFile(a) && isMapperXml(b) },
  { type: 'Mapper XML→Java', test: (a, b) => isMapperXml(a) && isJavaFile(b) },
  { type: '实体→VO/DTO', test: (a, b) => isJavaFile(a) && isEntityDir(a) && isJavaFile(b) && isVoName(b) },
  { type: '前端内部', test: (a, b) => isFrontFile(a) && isFrontFile(b) },
  { type: 'Python→Python', test: (a, b) => isPyFile(a) && isPyFile(b) },
];

function classifyEdgeType(input, truthFile) {
  const out = [];
  for (const rule of EDGE_TYPE_RULES) {
    if (rule.test(input, truthFile)) out.push(rule.type);
  }
  return out;
}

/** 5.3 第 6 条抽样公式：1 基编号 ⌊i × N ÷ K⌋ + 1，i 从 0 到 K-1（结果非递减，重复只留一个）。 */
function sampleIndices(n, k) {
  if (n <= 0 || k <= 0) return [];
  const out = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor((i * n) / k) + 1;
    if (out.length === 0 || out[out.length - 1] !== idx) out.push(idx);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 3) 样本与留出任务池                                                          */
/* -------------------------------------------------------------------------- */

function byTimeThenHash(a, b) {
  if (a.ts !== b.ts) return a.ts - b.ts;
  return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;
}

/** 5.2 样本口径：非合并、2..20 个统计文件、至少一个输入的真值非空。 */
function isUsableCommit(c) {
  if (c.isMerge) return false;
  const statCount = c.files.reduce((n, f) => (isStatFile(f.path) ? n + 1 : n), 0);
  if (statCount < 2 || statCount > MAX_STAT_PER_COMMIT) return false;
  // 至少存在一个 M/D 输入，其真值（同提交其他非新增统计文件）非空
  return c.files.some((f) => (f.status === 'M' || f.status === 'D') && isStatFile(f.path)
    && c.files.some((t) => t.path !== f.path && t.status !== 'A' && isStatFile(t.path)));
}

/**
 * 返回 { usable, holdoutPool }，均按（提交时间, 哈希）正序。
 * holdout 从可用提交的最新端取；holdout 超过可用数时全部留出。
 */
function selectSamples(commits, opts = {}) {
  const holdout = Number.isFinite(opts.holdout) ? Math.max(0, Math.trunc(opts.holdout)) : 0;
  const sorted = (commits || []).slice().sort(byTimeThenHash);
  const usableAll = sorted.filter(isUsableCommit);
  const take = Math.min(holdout, usableAll.length);
  return {
    usable: usableAll.slice(0, usableAll.length - take),
    holdoutPool: usableAll.slice(usableAll.length - take),
  };
}

/* -------------------------------------------------------------------------- */
/* 4) 结构上限（无向 BFS：3 步内、公共文件不作中转）                              */
/* -------------------------------------------------------------------------- */

function computeStructuralCeiling({ deps, dependents, input, hubThreshold = HUB_DEPENDENT_THRESHOLD }) {
  const neighborsOf = (node) => {
    const a = (typeof deps.get === 'function' ? deps.get(node) : null) || [];
    const b = (typeof dependents.get === 'function' ? dependents.get(node) : null) || [];
    return [...new Set([...a, ...b])];
  };
  const visited = new Set([input]);
  const reach = [];
  const queue = [{ node: input, level: 0 }];
  while (queue.length > 0) {
    const { node, level } = queue.shift();
    if (level >= STRUCTURAL_MAX_DEPTH) continue;
    for (const nb of neighborsOf(node)) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      reach.push(nb);
      const dependentCount = ((typeof dependents.get === 'function' ? dependents.get(nb) : null) || []).length;
      // 公共文件可作终点：已进 reach，但不入队，因此不会被展开成中转。
      if (dependentCount < hubThreshold) queue.push({ node: nb, level: level + 1 });
    }
  }
  return { reach };
}

/* -------------------------------------------------------------------------- */
/* 5) 笨基线（主干名分组 + 共改次数排序 + 篇幅对齐）                              */
/* -------------------------------------------------------------------------- */

function buildNaiveBaseline({ coChangeCounts, pFiles, input, k }) {
  const countOf = (p) => coChangeCounts.get(p) || 0;
  const stem = stemName(input);
  const sameStem = [];
  const others = [];
  for (const p of pFiles || []) {
    if (p === input) continue;
    // 5.2 候选只两类：历史上共改 ≥1 次，或与输入主干名相同。count=0 且不同主干的文件不算。
    const sameStemAsInput = stemName(p) === stem;
    if (countOf(p) === 0 && !sameStemAsInput) continue;
    if (sameStemAsInput) sameStem.push(p);
    else others.push(p);
  }
  const byRule = (a, b) => {
    const diff = countOf(b) - countOf(a);
    if (diff !== 0) return diff;
    return a < b ? -1 : a > b ? 1 : 0;
  };
  sameStem.sort(byRule);
  others.sort(byRule);
  const limit = Number.isFinite(k) ? Math.max(0, Math.trunc(k)) : 0;
  return [...sameStem, ...others].slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* 6) 合并列表（交替取、已出现的跳过且占一次轮次、取满 k 或两边取完）              */
/* -------------------------------------------------------------------------- */

function buildMergedList(tool, baseline, k) {
  const out = [];
  const seen = new Set();
  const limit = Number.isFinite(k) ? Math.max(0, Math.trunc(k)) : 0;
  let i = 0;
  let j = 0;
  while (out.length < limit && (i < tool.length || j < baseline.length)) {
    if (i < tool.length) {
      const x = tool[i++];
      if (!seen.has(x)) {
        seen.add(x);
        out.push(x);
      }
    }
    if (out.length >= limit) break;
    if (j < baseline.length) {
      const y = baseline[j++];
      if (!seen.has(y)) {
        seen.add(y);
        out.push(y);
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 工具层：容器生命周期 + impact 调用（CLI 默认参数复刻）                          */
/* -------------------------------------------------------------------------- */

let _toolLayer = null;
function toolLayer() {
  if (!_toolLayer) {
    _toolLayer = {
      ServiceContainer: require('../src/services/container').ServiceContainer,
      dependencyGraph: require('../src/tools/dep-tools').dependencyGraph,
      DEFAULTS: require('../src/config/constants').DEFAULTS,
      buildSpellingIndex: require('../src/cli/path-spelling').buildSpellingIndex,
      applyPathSpelling: require('../src/cli/path-spelling').applyPathSpelling,
      sanitizeRepositoryText: require('../src/cli/untrusted-text').sanitizeRepositoryText,
    };
  }
  return _toolLayer;
}

async function withContainer(root, cacheDir, fn) {
  const { ServiceContainer } = toolLayer();
  fs.mkdirSync(cacheDir, { recursive: true });
  const container = new ServiceContainer({ quiet: true, cacheDir });
  try {
    const ok = await container.initialize(root, INIT_TIMEOUT_MS);
    if (!ok) {
      throw new ReplayError(`容器初始化失败 ${root}: ${container.initError ? container.initError.message : 'unknown'}`);
    }
    return await fn(container);
  } finally {
    try {
      await container.shutdown();
    } catch (e) {
      console.error(`[replay] shutdown 失败（忽略，不影响已算出的结果）: ${e.message}`);
    }
  }
}

/**
 * 单个输入的 impact。maxDepth 取默认必须复刻 src/cli/commands/index.js 的
 * `parsed.maxDepth ?? DEFAULTS.AFFECTED_TEST_DEPTH`（=5），绝不能落到
 * getImpactRadius 签名默认 3 —— 验收②要求进程内输出与裸 CLI 一致。
 * 返回的路径先过 CLI 同款 path-spelling / untrusted-text 变换，保证与 `--json` 逐字一致。
 */
async function impactOne(container, root, spelling, input, options) {
  const { dependencyGraph, DEFAULTS, applyPathSpelling, sanitizeRepositoryText } = toolLayer();
  if (!fs.existsSync(path.resolve(root, input))) {
    return { files: [], impactCount: 0, warnings: [], outOfScope: false, error: `P 中不存在该文件: ${input}` };
  }
  const args = { operation: 'impact', file: input, ...options };
  if (args.maxDepth === undefined || args.maxDepth === null) args.maxDepth = DEFAULTS.AFFECTED_TEST_DEPTH;
  const res = await dependencyGraph(args, container);
  if (!res || res.ok === false) {
    return { files: [], impactCount: 0, warnings: [], outOfScope: false, error: (res && res.error) || 'impact 调用失败' };
  }
  const out = sanitizeRepositoryText(applyPathSpelling(res, spelling)).result;
  const files = Array.isArray(out.impact) ? out.impact.map((row) => row.file).filter((f) => typeof f === 'string') : [];
  const warnings = Array.isArray(out.warnings) ? out.warnings : [];
  return {
    files,
    impactCount: Number.isFinite(out.impactCount) ? out.impactCount : files.length,
    warnings,
    outOfScope: warnings.some((w) => w && w.type === 'target-not-indexed'),
    error: null,
  };
}

/** 进程内对一批输入跑 impact，返回 { [input]: 仓库相对正斜杠路径[] }（验收②入口）。 */
async function computeToolOutputs(repoDir, inputs) {
  const root = path.resolve(repoDir);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-replay-cache-'));
  try {
    return await withContainer(root, cacheDir, async (container) => {
      const { buildSpellingIndex } = toolLayer();
      const spelling = buildSpellingIndex(container.snapshot.graph, root);
      const out = {};
      for (const input of inputs) {
        const rec = await impactOne(container, root, spelling, input, {});
        out[input] = rec.files;
      }
      return out;
    });
  } finally {
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    } catch { /* 临时缓存清理失败不阻塞结果 */ }
  }
}

/* -------------------------------------------------------------------------- */
/* 子进程：一个提交的全部输入（5.3 第 2 条）                                     */
/* -------------------------------------------------------------------------- */

async function childMain(payloadFile) {
  const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
  const { cloneDir, parentHash, cacheDir, inputs, impactOptions } = payload;
  const root = path.resolve(cloneDir);
  let runs;
  try {
    runs = await withContainer(root, cacheDir, async (container) => {
      const graph = container.snapshot.graph;
      const { buildSpellingIndex } = toolLayer();
      const spelling = buildSpellingIndex(graph, root);
      const pFiles = gitRun(root, ['ls-tree', '-r', '--name-only', parentHash])
        .split('\n').map((l) => l.trim()).filter((p) => p && isStatFile(p));
      const history = historyForBaseline(root, parentHash);
      // computeStructuralCeiling 只用 .get()：懒访问，避免为每个输入物化整张图。
      const deps = { get: (k) => graph.getDependencies(k) || [] };
      const dependents = { get: (k) => graph.getDependents(k) || [] };
      const out = [];
      for (const input of inputs) {
        const t0 = Date.now();
        let rec;
        try {
          rec = await impactOne(container, root, spelling, input, impactOptions || {});
        } catch (e) {
          rec = { files: [], impactCount: 0, warnings: [], outOfScope: false, error: e.message || String(e) };
        }
        const toolList = rec.files.map((f) => toRepoRel(root, f));
        const k = toolList.length > 0 ? toolList.length : DEFAULT_BASELINE_K;
        const baselineFull = buildNaiveBaseline({
          coChangeCounts: coChangeCountsAt(history, input),
          pFiles,
          input,
          k: pFiles.length,
        });
        const mergedList = buildMergedList(toolList, baselineFull, k);
        const normInput = graph.normalizeFilePath(path.resolve(root, input));
        const { reach } = computeStructuralCeiling({ deps, dependents, input: normInput });
        out.push({
          input,
          toolList,
          impactCount: rec.impactCount,
          baselineList: baselineFull.slice(0, k),
          baseline15: baselineFull.slice(0, DEFAULT_BASELINE_K),
          mergedList,
          ceilingList: reach.map((key) => toRepoRel(root, graph._displayPath(key))),
          durationMs: Date.now() - t0,
          warnings: rec.warnings,
          outOfScope: rec.outOfScope,
          error: rec.error || null,
        });
      }
      return out;
    });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    runs = inputs.map((input) => ({
      input,
      toolList: [],
      impactCount: 0,
      baselineList: [],
      baseline15: [],
      mergedList: [],
      ceilingList: [],
      durationMs: 0,
      warnings: [],
      outOfScope: false,
      error: msg,
    }));
  }
  process.stdout.write(`${CHILD_MARKER}${JSON.stringify({ runs })}\n`);
}

function lastMarker(stdout) {
  const matches = String(stdout || '').match(/@@RESULT@@(.*)/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1].slice(CHILD_MARKER.length);
}

/* -------------------------------------------------------------------------- */
/* 真值口径（5.2：输入 M/D、真值排除新增）                                       */
/* -------------------------------------------------------------------------- */

const inputsOf = (commit) => commit.files
  .filter((f) => (f.status === 'M' || f.status === 'D') && isStatFile(f.path))
  .map((f) => f.path);

const truthOf = (commit, input) => commit.files
  .filter((f) => f.path !== input && f.status !== 'A' && isStatFile(f.path))
  .map((f) => f.path);

const addedCountOf = (commit) => commit.files
  .filter((f) => f.status === 'A' && isStatFile(f.path)).length;

function typeTruthOf(input, truth) {
  const out = {};
  for (const t of truth) {
    for (const type of classifyEdgeType(input, t)) {
      if (!out[type]) out[type] = [];
      out[type].push(t);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* runReplay：克隆 → 逐提交子进程 → 四个产出                                    */
/* -------------------------------------------------------------------------- */

function parseImpactOption(raw) {
  const eq = String(raw).indexOf('=');
  if (eq <= 0) throw new UsageError(`--impact-option 需要 名=值 格式，收到: ${raw}`);
  const key = String(raw).slice(0, eq);
  const val = String(raw).slice(eq + 1);
  const camel = key.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  let parsed = val;
  if (val === 'true') parsed = true;
  else if (val === 'false') parsed = false;
  else if (val !== '' && !Number.isNaN(Number(val))) parsed = Number(val);
  return [camel, parsed];
}

async function runReplay(options = {}) {
  if (!options.repoPath) throw new UsageError('runReplay: 缺少 repoPath');
  const tStart = Date.now();
  const startedAt = new Date().toISOString();
  const repoPath = path.resolve(options.repoPath);
  const name = options.name || 'replay';
  const outDir = options.outDir || path.join(TRUTH, 'replay', name);
  const holdout = Number.isInteger(options.holdout) ? Math.max(0, options.holdout) : 0;
  const sample = options.sample === undefined ? 'all' : options.sample;
  const maxCommits = Number.isInteger(options.maxCommits) && options.maxCommits >= 1 ? options.maxCommits : null;
  const impactOptionRaw = Array.isArray(options.impactOptions) ? options.impactOptions : [];
  const impactOpt = {};
  for (const raw of impactOptionRaw) {
    const [k, v] = parseImpactOption(raw);
    impactOpt[k] = v;
  }

  assertGitRepo(repoPath);
  const cutoff = options.cutoff || gitRun(repoPath, ['rev-parse', 'HEAD']).trim();
  const cutoffVerified = gitRun(repoPath, ['rev-parse', '--verify', `${cutoff}^{commit}`]).trim();

  fs.mkdirSync(outDir, { recursive: true });
  const commits = listCommits(repoPath, cutoffVerified);
  const { usable, holdoutPool } = selectSamples(commits, { holdout });

  // sample.json 已存在时沿用提交列表，不再重新抽样（5.3 第 6 条 / 测试锁死）。
  const samplePath = path.join(outDir, 'sample.json');
  let selected;
  if (fs.existsSync(samplePath)) {
    const prev = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    const byHash = new Map(usable.map((c) => [c.hash, c]));
    selected = [];
    for (const h of Array.isArray(prev.commits) ? prev.commits : []) {
      const c = byHash.get(h);
      if (!c) {
        throw new ReplayError(`sample.json 中的提交 ${String(h).slice(0, 12)} 不在当前可用集合（cutoff 或 holdout 变了？删除 sample.json 后重跑）`);
      }
      selected.push(c);
    }
  } else {
    let mode;
    let picked;
    if (sample === 'all') {
      mode = 'all';
      picked = usable;
    } else {
      const n = Number(sample);
      if (!Number.isInteger(n) || n < 1) throw new UsageError(`--sample 必须是 n 或 all，收到: ${sample}`);
      mode = n;
      picked = sampleIndices(usable.length, n).map((i) => usable[i - 1]).filter(Boolean);
    }
    selected = picked;
    writeJson(samplePath, {
      specVersion: 'v1',
      mode,
      holdout,
      cutoff: cutoffVerified,
      count: picked.length,
      commits: picked.map((c) => c.hash),
    });
  }
  if (maxCommits !== null) selected = selected.slice(-maxCommits);

  const runs = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-replay-'));
  const cloneDir = path.join(tmpRoot, 'clone');
  const cacheDir = path.join(tmpRoot, 'cache');
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const clone = spawnSync('git', ['clone', '--no-hardlinks', repoPath, cloneDir], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (clone.error || clone.status !== 0) {
      throw new ReplayError(`git clone 失败: ${clone.error ? clone.error.message : String(clone.stderr || '').slice(0, 400)}`);
    }

    let payloadSeq = 0;
    for (const c of selected) {
      const inputs = inputsOf(c);
      if (!c.parentHash) throw new ReplayError(`提交 ${c.hash.slice(0, 12)} 没有父提交，无法回放`);
      gitRun(cloneDir, ['checkout', '-q', '-f', c.parentHash]);
      const payloadFile = path.join(tmpRoot, `payload-${payloadSeq++}.json`);
      fs.writeFileSync(payloadFile, JSON.stringify({
        cloneDir,
        parentHash: c.parentHash,
        cacheDir,
        inputs,
        impactOptions: impactOpt,
      }));
      const child = spawnSync(process.execPath, [__filename, '--child', payloadFile], {
        encoding: 'utf8',
        timeout: CHILD_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
      });
      const marker = lastMarker(child.stdout);
      let childRuns = null;
      if (child.status === 0 && marker) {
        try {
          const parsed = JSON.parse(marker);
          if (Array.isArray(parsed.runs) && parsed.runs.length === inputs.length) childRuns = parsed.runs;
        } catch {
          childRuns = null;
        }
      }
      if (!childRuns) {
        const why = child.error
          ? child.error.message
          : `exit ${child.status}: ${String(child.stderr || '').slice(-400)}`;
        childRuns = inputs.map((input) => ({
          input,
          toolList: [],
          impactCount: 0,
          baselineList: [],
          baseline15: [],
          mergedList: [],
          ceilingList: [],
          durationMs: 0,
          warnings: [],
          outOfScope: false,
          error: `子进程失败 (${why})`,
        }));
      }
      const addedCount = addedCountOf(c);
      for (const r of childRuns) {
        const truth = truthOf(c, r.input);
        const toolList = Array.isArray(r.toolList) ? r.toolList : [];
        const impactCount = Number.isFinite(r.impactCount) ? r.impactCount : 0;
        runs.push({
          commit: c.hash,
          parent: c.parentHash,
          input: r.input,
          truth,
          addedCount,
          toolList,
          impactCount,
          // 5.2 的“是否截断”只看截断前总数与列表长度，不采信工具层混合字段。
          truncated: impactCount > toolList.length,
          baselineList: Array.isArray(r.baselineList) ? r.baselineList : [],
          baseline15: Array.isArray(r.baseline15) ? r.baseline15 : [],
          mergedList: Array.isArray(r.mergedList) ? r.mergedList : [],
          ceilingList: Array.isArray(r.ceilingList) ? r.ceilingList : [],
          typeTruth: typeTruthOf(r.input, truth),
          durationMs: Number.isFinite(r.durationMs) ? r.durationMs : 0,
          warnings: Array.isArray(r.warnings) ? r.warnings : [],
          outOfScope: !!r.outOfScope,
          error: r.error || null,
        });
      }
      console.log(`[replay] ${c.hash.slice(0, 7)} P=${c.parentHash.slice(0, 7)} inputs=${inputs.length}`);
    }
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch { /* 临时克隆/缓存清理失败不阻塞结果（S1：正常路径不留残留） */ }
  }

  fs.writeFileSync(
    path.join(outDir, 'runs.jsonl'),
    runs.length > 0 ? runs.map((r) => JSON.stringify(r)).join('\n') + '\n' : ''
  );

  const sampleInfo = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const summary = buildSummary({
    name,
    repoPath,
    cutoff: cutoffVerified,
    holdout,
    holdoutPoolHashes: holdoutPool.map((c) => c.hash),
    usableCount: usable.length,
    sampleInfo,
    maxCommits,
    processedCommits: selected.length,
    impactOptionRaw,
    runs,
    startedAt,
    wallMs: Date.now() - tStart,
  });
  writeJson(path.join(outDir, 'summary.json'), summary);
  fs.writeFileSync(path.join(outDir, 'summary.md'), renderMarkdown(summary));
  return summary;
}

/* -------------------------------------------------------------------------- */
/* 汇总（5.2 计算：两级平均、边类型、中位数、空输出占比）                          */
/* -------------------------------------------------------------------------- */

function median(nums) {
  if (!nums || nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function buildSummary(ctx) {
  const toolRepoHead = gitRun(TOOL_ROOT, ['rev-parse', 'HEAD']).trim();
  const toolRepoDirty = gitRun(TOOL_ROOT, ['status', '--porcelain']).trim() !== '';

  const order = [];
  const byCommit = new Map();
  for (const r of ctx.runs) {
    if (!byCommit.has(r.commit)) {
      byCommit.set(r.commit, []);
      order.push(r.commit);
    }
    byCommit.get(r.commit).push(r);
  }
  const withTruth = (rows) => rows.filter((r) => r.truth.length > 0);
  const recallSeries = (key) => order.map((ck) => withTruth(byCommit.get(ck)).map((r) => recallOf(r.truth, r[key])));
  const recalls = {
    tool: twoLevelAverage(recallSeries('toolList')),
    baseline: twoLevelAverage(recallSeries('baselineList')),
    merged: twoLevelAverage(recallSeries('mergedList')),
    ceiling: twoLevelAverage(recallSeries('ceilingList')),
    baselineFixed15: twoLevelAverage(order.map((ck) => withTruth(byCommit.get(ck)).map((r) => recallOf(r.truth, r.baseline15)))),
  };

  const byEdgeType = {};
  for (const type of EDGE_TYPES) {
    const series = { tool: [], baseline: [], merged: [], ceiling: [] };
    let pairs = 0;
    let inputs = 0;
    let empty = 0;
    const outLens = [];
    const impactCounts = [];
    for (const ck of order) {
      const rows = byCommit.get(ck).filter((r) => (r.typeTruth[type] || []).length > 0);
      if (rows.length === 0) continue; // 没有该类型配对的提交不参与该类型的平均
      inputs += rows.length;
      series.tool.push(rows.map((r) => recallOf(r.typeTruth[type], r.toolList)));
      series.baseline.push(rows.map((r) => recallOf(r.typeTruth[type], r.baselineList)));
      series.merged.push(rows.map((r) => recallOf(r.typeTruth[type], r.mergedList)));
      series.ceiling.push(rows.map((r) => recallOf(r.typeTruth[type], r.ceilingList)));
      for (const r of rows) {
        pairs += r.typeTruth[type].length;
        impactCounts.push(r.impactCount);
        if (r.toolList.length > 0) outLens.push(r.toolList.length);
        else empty += 1;
      }
    }
    if (inputs === 0) continue;
    byEdgeType[type] = {
      commits: series.tool.length,
      inputs,
      pairs,
      recall: {
        tool: twoLevelAverage(series.tool),
        baseline: twoLevelAverage(series.baseline),
        merged: twoLevelAverage(series.merged),
        ceiling: twoLevelAverage(series.ceiling),
      },
      outputMedian: median(outLens),
      emptyOutputCount: empty,
      emptyOutputRatio: empty / inputs,
      impactCountMedian: median(impactCounts),
    };
  }

  const totalInputs = ctx.runs.length;
  const outLensAll = ctx.runs.filter((r) => r.toolList.length > 0).map((r) => r.toolList.length);
  const emptyAll = totalInputs - outLensAll.length;
  let addedFiles = 0;
  for (const ck of order) addedFiles += (byCommit.get(ck)[0] || {}).addedCount || 0;
  const pairsTotal = ctx.runs.reduce((sum, r) => sum + r.truth.length, 0);

  const totals = {
    commits: order.length,
    inputs: totalInputs,
    addedFiles,
    errors: ctx.runs.filter((r) => r.error != null).length,
    outOfScope: ctx.runs.filter((r) => r.outOfScope).length,
    emptyToolOutputs: emptyAll,
    emptyToolRatio: totalInputs > 0 ? emptyAll / totalInputs : 0,
    impactCountMedian: median(ctx.runs.map((r) => r.impactCount)),
    reachableMedian: median(ctx.runs.map((r) => r.ceilingList.length)),
    wallMs: ctx.wallMs,
  };

  return {
    specVersion: 'v1',
    name: ctx.name,
    repoPath: ctx.repoPath,
    cutoff: ctx.cutoff,
    holdout: ctx.holdout,
    holdoutPool: ctx.holdoutPoolHashes,
    usableCount: ctx.usableCount,
    processedCommits: ctx.processedCommits,
    sample: { mode: ctx.sampleInfo.mode, commits: (ctx.sampleInfo.commits || []).length },
    maxCommits: ctx.maxCommits,
    impactOptions: ctx.impactOptionRaw,
    toolRepo: { commit: toolRepoHead, dirty: toolRepoDirty },
    startedAt: ctx.startedAt,
    finishedAt: new Date().toISOString(),
    totals,
    overall: {
      commits: order.length,
      pairs: pairsTotal,
      recall: recalls,
      outputMedian: median(outLensAll),
      emptyOutputCount: emptyAll,
      emptyOutputRatio: totals.emptyToolRatio,
      impactCountMedian: totals.impactCountMedian,
      reachableMedian: totals.reachableMedian,
    },
    byEdgeType,
  };
}

function renderMarkdown(s) {
  const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : 'n/a');
  const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a');
  const pp = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? ((a - b) * 100).toFixed(1) : 'n/a');
  const row = (label, e) => `| ${label} | ${e.commits} | ${e.pairs} | ${f3(e.recall.tool)} | ${f3(e.recall.baseline)} | ${f3(e.recall.merged)} | ${f3(e.recall.ceiling)} | ${pp(e.recall.tool, e.recall.baseline)} | ${e.outputMedian ?? '-'} | ${pct(e.emptyOutputRatio)} |`;
  const lines = [
    `# 回放汇总 — ${s.name}`,
    '',
    `- 口径版本：${s.specVersion}`,
    `- cutoff：\`${s.cutoff.slice(0, 12)}\``,
    `- 工具仓库：\`${s.toolRepo.commit.slice(0, 7)}\`（${s.toolRepo.dirty ? '有未提交改动' : '干净'}）`,
    `- 提交：可用 ${s.usableCount}，留出 ${s.holdoutPool.length}，已回放 ${s.totals.commits}；输入 ${s.totals.inputs}；新增文件 ${s.totals.addedFiles}；出错 ${s.totals.errors}；范围外 ${s.totals.outOfScope}`,
    `- impact 选项：${s.impactOptions.length > 0 ? s.impactOptions.join(' ') : '（默认）'}`,
    `- 耗时 ${(s.totals.wallMs / 1000).toFixed(1)}s；impactCount 中位数 ${s.totals.impactCountMedian ?? '-'}；可达文件数中位数 ${s.totals.reachableMedian ?? '-'}；空输出占比 ${pct(s.totals.emptyToolRatio)}`,
    '',
    '| 边类型 | 提交数 | 配对数 | 工具 | 笨基线（对齐） | 合并列表 | 结构上限 | 工具−笨基线(pp) | 输出中位数 | 空输出占比 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const [type, e] of Object.entries(s.byEdgeType)) lines.push(row(type, e));
  lines.push(row('全部类型', s.overall));
  lines.push('');
  lines.push(`笨基线固定 15 个的召回率：${f3(s.overall.recall.baselineFixed15)}`);
  lines.push('');
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const o = { holdout: 0, sample: 'all', impactOptions: [] };
  const need = (flag, i) => {
    if (i + 1 >= argv.length) throw new UsageError(`${flag} 缺少取值`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--child': o.child = need(a, i); i++; break;
      case '--repo': o.repo = need(a, i); i++; break;
      case '--name': o.name = need(a, i); i++; break;
      case '--target': o.target = need(a, i); i++; break;
      case '--impact-option': o.impactOptions.push(need(a, i)); i++; break;
      case '--holdout': {
        const v = Number(need(a, i)); i++;
        if (!Number.isInteger(v) || v < 0) throw new UsageError(`--holdout 必须是非负整数，收到: ${argv[i]}`);
        o.holdout = v;
        break;
      }
      case '--max-commits': {
        const v = Number(need(a, i)); i++;
        if (!Number.isInteger(v) || v < 1) throw new UsageError(`--max-commits 必须是正整数，收到: ${argv[i]}`);
        o.maxCommits = v;
        break;
      }
      case '--sample': {
        const v = need(a, i); i++;
        if (v === 'all') o.sample = 'all';
        else if (/^\d+$/.test(v) && Number(v) >= 1) o.sample = Number(v);
        else throw new UsageError(`--sample 必须是 n 或 all，收到: ${v}`);
        break;
      }
      case '-h': case '--help': o.help = true; break;
      default:
        throw new UsageError(`未知参数: ${a}`);
    }
  }
  return o;
}

function printUsage() {
  console.error([
    '用法:',
    '  node eval/replay-impact.js --repo <仓库路径> --name <名字> [选项]',
    '  node eval/replay-impact.js --target <代号> [选项]',
    '选项:',
    '  --holdout <n>            留出任务池大小（默认 0）',
    '  --impact-option <名=值>  传给 impact 的可选参数，可重复（如 max-depth=3）',
    '  --max-commits <n>        只回放时间上最新的 n 个可用提交',
    '  --sample <n|all>         抽样（默认 all；sample.json 已存在时沿用）',
  ].join('\n'));
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  if (args.child) {
    await childMain(args.child);
    return 0;
  }

  // WB_REPLAY_TRUTH 测试缝：--target 的 targets.json 与下面的默认 outDir 改以
  // 该目录为根，测试因此不会写入真实 eval/truth/；未设置时行为与原来完全一致。
  const truthRoot = process.env.WB_REPLAY_TRUTH || TRUTH;

  let repoPath;
  let name;
  let cutoff = null;
  if (args.target) {
    const targetsFile = path.join(truthRoot, 'targets.json');
    if (!fs.existsSync(targetsFile)) {
      throw new UsageError(`缺少 ${targetsFile}（格式见 ROADMAP 5.1）`);
    }
    let targets;
    try {
      targets = JSON.parse(fs.readFileSync(targetsFile, 'utf8'));
    } catch (e) {
      throw new ReplayError(`targets.json 解析失败: ${e.message}`);
    }
    const entry = targets[args.target];
    if (!entry || !entry.path) {
      throw new UsageError(`targets.json 中没有代号 "${args.target}"（已有: ${Object.keys(targets).join(', ') || '无'}）`);
    }
    repoPath = path.resolve(entry.path);
    name = args.target;
    assertGitRepo(repoPath);
    if (!entry.cutoff) {
      // 5.3 第 1 条：第一次运行时把当时的 HEAD 记为 cutoff，此后所有运行截到它。
      entry.cutoff = gitRun(repoPath, ['rev-parse', 'HEAD']).trim();
      fs.writeFileSync(targetsFile, JSON.stringify(targets, null, 2) + '\n');
      console.error(`targets.json 已记录 ${name} cutoff=${entry.cutoff.slice(0, 12)}`);
    }
    cutoff = entry.cutoff;
  } else {
    if (!args.repo || !args.name) {
      throw new UsageError('--repo 与 --name 必须同时提供（或改用 --target <代号>）');
    }
    repoPath = path.resolve(args.repo);
    name = args.name;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new UsageError(`名字只允许字母数字与 . _ -：${name}`);
  }
  assertGitRepo(repoPath);

  const outDir = path.join(truthRoot, 'replay', name);
  const summary = await runReplay({
    repoPath,
    name,
    outDir,
    cutoff: cutoff || undefined,
    holdout: args.holdout,
    sample: args.sample,
    maxCommits: args.maxCommits,
    impactOptions: args.impactOptions,
  });
  const t = summary.totals;
  console.log(`replay ${name}: commits=${t.commits} inputs=${t.inputs} errors=${t.errors} outOfScope=${t.outOfScope}`);
  console.log(`recall tool=${summary.overall.recall.tool.toFixed(4)} baseline=${summary.overall.recall.baseline.toFixed(4)} merged=${summary.overall.recall.merged.toFixed(4)} ceiling=${summary.overall.recall.ceiling.toFixed(4)}`);
  console.log(`outputs: ${outDir}`);
  if (t.inputs > 0 && t.errors === t.inputs) {
    console.error('全部输入都失败了');
    return 1;
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      if (err instanceof UsageError) {
        console.error(`error: ${err.message}`);
        printUsage();
        process.exitCode = 1;
      } else if (err instanceof ReplayError) {
        console.error(`error: ${err.message}`);
        process.exitCode = 1;
      } else {
        console.error((err && err.stack) || err);
        process.exitCode = 2;
      }
    }
  );
}

module.exports = {
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
};
