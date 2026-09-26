/**
 * Shared plumbing for eval/run.js, eval/inject-fault.js and eval/score.js:
 * corpus loading, per-language clone/output paths, process spawning, JSON
 * and status/marker files.
 *
 * Layout: clones live at eval/truth/repos/<lang>/<name>, outputs at
 * eval/truth/out/<lang>/<name>. <lang> is the corpus entry's `lang` and must
 * be one of LANG_DIRS — a typo fails loudly instead of creating a stray dir.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EVAL_DIR = __dirname;
const ROOT = path.resolve(EVAL_DIR, '..');
const CLI = path.join(ROOT, 'cli.js');
const TRUTH = path.join(EVAL_DIR, 'truth');
const REPOS_DIR = path.join(TRUTH, 'repos');
const OUT_DIR = path.join(TRUTH, 'out');
const VENVS_DIR = path.join(TRUTH, 'venvs');

const LANG_DIRS = ['python', 'js-ts', 'vue', 'svelte', 'java', 'kotlin', 'go', 'rust', 'c-cpp'];

// Windows installs these as .cmd shims, which spawnSync can only run through a shell.
const WIN_SHELL_SHIMS = new Set(['pnpm', 'npm', 'npx', 'mvn']);
const MAX_BUFFER = 512 * 1024 * 1024;

// Which repo-relative paths count as test files, per fault-injection runner.
// Shared by the truth generator and the scorer so both sides filter alike.
const TEST_FILE_RULES = {
  maven: (f) => f.includes('src/test/') && f.endsWith('.java'),
  vitest: (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f),
  go: (f) => f.endsWith('_test.go'),
  // inline #[cfg(test)] units have no file of their own; only tests/** is file-level
  cargo: (f) => f.startsWith('tests/') && f.endsWith('.rs'),
};

function loadCorpus() {
  const corpus = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'corpus.json'), 'utf8'));
  for (const r of corpus.repos) {
    if (!LANG_DIRS.includes(r.lang)) {
      throw new Error(`corpus.json: repo "${r.name}" has lang "${r.lang}", expected one of ${LANG_DIRS.join(', ')}`);
    }
  }
  return corpus;
}

/** argv names and/or `--lang <lang>` → corpus entries (default: all). */
function selectRepos(corpus, argv) {
  const langIdx = argv.indexOf('--lang');
  const lang = langIdx >= 0 ? argv[langIdx + 1] : null;
  const names = argv.filter((a, i) => !a.startsWith('--') && (langIdx < 0 || i !== langIdx + 1));
  let repos = corpus.repos;
  if (lang) repos = repos.filter((r) => r.lang === lang);
  if (names.length) {
    for (const n of names) {
      if (!corpus.repos.some((r) => r.name === n)) {
        throw new Error(`unknown repo "${n}" (corpus has: ${corpus.repos.map((r) => r.name).join(', ')})`);
      }
    }
    repos = repos.filter((r) => names.includes(r.name));
  }
  return repos;
}

const repoDir = (entry) => path.join(REPOS_DIR, entry.lang, entry.name);

function outDir(entry) {
  const d = path.join(OUT_DIR, entry.lang, entry.name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function sh(cmd, args, opts = {}) {
  const viaShell = process.platform === 'win32' && WIN_SHELL_SHIMS.has(cmd);
  // shell mode takes one pre-joined string (args + shell is deprecated, DEP0190)
  const command = viaShell ? [cmd, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ') : cmd;
  const r = spawnSync(command, viaShell ? [] : args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, shell: viaShell, ...opts });
  if (r.error) {
    return { status: -1, stdout: '', stderr: r.error.code === 'ENOENT' ? `${cmd}: command not found` : String(r.error.message) };
  }
  return r;
}

const toolAvailable = (cmd, args) => sh(cmd, args).status === 0;

const tail = (s, n = 1200) => String(s || '').slice(-n);

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
}

const readMarker = (entry) => readJson(path.join(outDir(entry), 'marker.json'), {});

function writeMarker(entry, patch) {
  const m = { ...readMarker(entry), ...patch };
  writeJson(path.join(outDir(entry), 'marker.json'), m);
  return m;
}

function setStatus(entry, metric, status, extra = {}) {
  const file = path.join(outDir(entry), 'status.json');
  const cur = readJson(file, { metrics: {} });
  cur.repo = entry.name;
  cur.lang = entry.lang;
  cur.commit = entry.commit;
  cur.updatedAt = new Date().toISOString();
  cur.metrics = cur.metrics || {};
  cur.metrics[metric] = { status, ...extra };
  writeJson(file, cur);
  return cur;
}

const toPosix = (p) => String(p || '').replace(/\\/g, '/');

/** Absolute or ./-prefixed path → repo-relative forward-slash path. */
function toRepoRel(dir, p) {
  let f = toPosix(p);
  if (path.isAbsolute(f)) {
    const rel = toPosix(path.relative(dir, f));
    if (rel && !rel.startsWith('..')) f = rel;
  }
  return f.replace(/^\.\//, '');
}

module.exports = {
  EVAL_DIR,
  ROOT,
  CLI,
  TRUTH,
  REPOS_DIR,
  OUT_DIR,
  VENVS_DIR,
  LANG_DIRS,
  TEST_FILE_RULES,
  loadCorpus,
  selectRepos,
  repoDir,
  outDir,
  sh,
  toolAvailable,
  tail,
  readJson,
  writeJson,
  readMarker,
  writeMarker,
  setStatus,
  toPosix,
  toRepoRel,
};
