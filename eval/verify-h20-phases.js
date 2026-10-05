// @semantic — H-20 evidence: per-phase wall time and hot-function call counts on generated repos.
//
//   node eval/verify-h20-phases.js [--sizes 1000,3000,10000] [--keep]
//
// For each size it generates a repo (same mix as the H-20 report: TS 55% / Python 27% / JS 9% /
// Java 9%, ~40 lines per file, 3 random same-directory imports), then runs the container
// pipeline in a child process three times against one cache dir:
//   cold        no cache; phase times from container._phaseTimes
//   warm        cache present; phase times
//   counted     warm, with call counters on path.relative, normalizePathKey and
//               ProjectContext.classifyDirectory/getRelativePath (timing is NOT read from this run)
// Counts are reported per file so super-linear growth shows up as a rising per-file number.
// cpuMs/wallMs near 1 means the process had the machine to itself; lower means interference.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SIZES = [1000, 3000, 10000];
const FILES_PER_DIR = 50;
const IMPORTS_PER_FILE = 3;
const LINES_PER_FILE = 40;
const CHILD_TIMEOUT_MS = 40 * 60 * 1000;
const STACK_SAMPLE_EVERY = 200;
const STACK_DEPTH = 4;
const LANG_MIX = [['ts', 0.55], ['py', 0.27], ['js', 0.09], ['java', 0.09]];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function pickLang(r) {
  let acc = 0;
  for (const [lang, share] of LANG_MIX) {
    acc += share;
    if (r < acc) return lang;
  }
  return LANG_MIX[0][0];
}

function body(lines) {
  return Array.from({ length: lines }, (_, i) => `  // filler ${i}`).join('\n');
}

function render(lang, dirName, index, siblings) {
  const name = `f${index}`;
  const filler = body(Math.max(0, LINES_PER_FILE - 8 - siblings.length));
  if (lang === 'ts') {
    const imports = siblings.map((s) => `import { v${s.index} } from './${s.name}';`).join('\n');
    return { rel: `${dirName}/${name}.ts`, text: `${imports}\nexport const v${index} = ${siblings.map((s) => `v${s.index}`).join(' + ') || 0};\nexport function fn${index}(): number {\n${filler}\n  return v${index};\n}\n` };
  }
  if (lang === 'js') {
    const imports = siblings.map((s) => `const m${s.index} = require('./${s.name}');`).join('\n');
    return { rel: `${dirName}/${name}.js`, text: `${imports}\nfunction fn${index}() {\n${filler}\n  return ${siblings.map((s) => `m${s.index}.v`).join(' + ') || 0};\n}\nmodule.exports = { v: ${index}, fn${index} };\n` };
  }
  if (lang === 'py') {
    const imports = siblings.map((s) => `from .${s.name} import v${s.index}`).join('\n');
    return { rel: `${dirName}/${name}.py`, text: `${imports}\n\nv${index} = ${siblings.map((s) => `v${s.index}`).join(' + ') || 0}\n\n\ndef fn${index}():\n${filler.replace(/\/\//g, '#')}\n    return v${index}\n` };
  }
  const imports = siblings.map((s) => `import pkg.${dirName}.${s.cls};`).join('\n');
  return { rel: `${dirName}/F${index}.java`, text: `package pkg.${dirName};\n${imports}\npublic class F${index} {\n  public static int v = ${index};\n  public static int fn() {\n${filler}\n    return v;\n  }\n}\n` };
}

function generate(dir, count, seed) {
  const r = rng(seed);
  const dirCount = Math.ceil(count / FILES_PER_DIR);
  const members = Array.from({ length: dirCount }, () => []);
  for (let i = 0; i < count; i++) {
    const d = Math.floor(i / FILES_PER_DIR);
    const lang = pickLang(r());
    members[d].push({ index: i, lang, name: `f${i}`, cls: `F${i}` });
  }
  for (let d = 0; d < dirCount; d++) {
    const dirName = `mod${d}`;
    fs.mkdirSync(path.join(dir, dirName), { recursive: true });
    fs.writeFileSync(path.join(dir, dirName, '__init__.py'), '');
    for (const m of members[d]) {
      const sameLang = members[d].filter((o) => o.lang === m.lang && o !== m);
      const siblings = [];
      for (let k = 0; k < IMPORTS_PER_FILE && sameLang.length; k++) siblings.push(sameLang[Math.floor(r() * sameLang.length)]);
      const out = render(m.lang, dirName, m.index, [...new Set(siblings)]);
      fs.writeFileSync(path.join(dir, out.rel), out.text);
    }
  }
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"h20","version":"1.0.0","private":true}\n');
}

// ---------------------------------------------------------------- child mode

async function childMain(dir, cacheDir, counted) {
  const counters = { pathRelative: 0, normalizePathKey: 0, classifyDirectory: 0, getRelativePath: 0 };
  const callers = {};
  const sample = (key) => {
    if (counters[key] % STACK_SAMPLE_EVERY !== 0) return;
    const frame = new Error().stack.split('\n').slice(3, 3 + STACK_DEPTH)
      .map((line) => line.trim().replace(/^at /, '').replace(ROOT, '.').replace(/\\/g, '/')).join(' <- ');
    callers[key] = callers[key] || {};
    callers[key][frame] = (callers[key][frame] || 0) + 1;
  };
  if (counted) {
    const nodePath = require('node:path');
    const origRelative = nodePath.relative;
    nodePath.relative = function (...args) {
      counters.pathRelative++;
      sample('pathRelative');
      return origRelative.apply(this, args);
    };
    // Patch before any consumer destructures these.
    const pathUtils = require(path.join(ROOT, 'src/utils/path'));
    const origKey = pathUtils.normalizePathKey;
    pathUtils.normalizePathKey = function (...args) {
      counters.normalizePathKey++;
      sample('normalizePathKey');
      return origKey.apply(this, args);
    };
    const { ProjectContext } = require(path.join(ROOT, 'src/utils/project-context'));
    for (const method of ['classifyDirectory', 'getRelativePath']) {
      const orig = ProjectContext.prototype[method];
      ProjectContext.prototype[method] = function (...args) {
        counters[method]++;
        sample(method);
        return orig.apply(this, args);
      };
    }
  }
  const { ServiceContainer } = require(path.join(ROOT, 'src/services/container'));
  const container = new ServiceContainer({ quiet: true, cacheDir });
  const cpu0 = process.cpuUsage();
  const t0 = process.hrtime.bigint();
  const ok = await container.initialize(dir, CHILD_TIMEOUT_MS);
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const cpu = process.cpuUsage(cpu0);
  if (!ok) throw container.initError || new Error("initialize returned false");
  const files = container.fileIndex?.getStats?.().files ?? null;
  const phases = { ...container._phaseTimes };
  await container.shutdown();
  process.stdout.write(`\n@@RESULT@@${JSON.stringify({ ok, files, wallMs: Math.round(wallMs), cpuMs: Math.round((cpu.user + cpu.system) / 1000), maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024), phases, counters, callers })}\n`);
}

// ---------------------------------------------------------------- parent mode

function runChild(dir, cacheDir, counted) {
  const args = [__filename, '--child', dir, cacheDir, counted ? 'counted' : 'plain'];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const m = /@@RESULT@@(.*)/.exec(r.stdout || '');
  if (!m) throw new Error(`child failed (status ${r.status}): ${(r.stderr || '').slice(-400)}`);
  return JSON.parse(m[1]);
}

function topCallers(callers, key) {
  return Object.entries(callers[key] || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([frame, n]) => `${n}× ${frame}`);
}

function measure(count, keep) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `wb-h20-${count}-`));
  const repo = path.join(scratch, 'repo');
  const cacheDir = path.join(scratch, 'cache');
  fs.mkdirSync(repo);
  try {
    generate(repo, count, 20261004);
    const cold = runChild(repo, cacheDir, false);
    const warm = runChild(repo, cacheDir, false);
    const counted = runChild(repo, cacheDir, true);
    const cliStart = Date.now();
    const cli = spawnSync(process.execPath, [path.join(ROOT, 'cli.js'), 'audit-overview', '--cwd', repo, '--json', '--quiet'], {
      env: { ...process.env, WB_CACHE_DIR: cacheDir }, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024,
    });
    const cliWarmMs = Date.now() - cliStart;
    if (cli.status !== 0 && cli.status !== 1) throw new Error(`audit-overview exit ${cli.status}: ${(cli.stderr || '').slice(-300)}`);
    const perFile = Object.fromEntries(Object.entries(counted.counters).map(([k, v]) => [k, Math.round((v / counted.files) * 10) / 10]));
    return { requested: count, files: warm.files, cliWarmMs, cold, warm, countedRun: { wallMs: counted.wallMs, counters: counted.counters, perFile, topCallers: Object.fromEntries(Object.keys(counted.counters).map((k) => [k, topCallers(counted.callers, k)])) } };
  } finally {
    if (!keep) fs.rmSync(scratch, { recursive: true, force: true });
    else console.error(`kept ${scratch}`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const sizesArg = argv.indexOf('--sizes');
  const sizes = sizesArg >= 0 ? argv[sizesArg + 1].split(',').map(Number) : DEFAULT_SIZES;
  const results = [];
  for (const count of sizes) {
    const res = measure(count, argv.includes('--keep'));
    results.push(res);
    const w = res.warm;
    console.log(JSON.stringify({ files: res.files, cliWarmMs: res.cliWarmMs, coldMs: res.cold.wallMs, warmMs: w.wallMs, warmCpuToWall: Math.round((w.cpuMs / w.wallMs) * 100) / 100, coldMaxRssMb: res.cold.maxRssMb, warmMaxRssMb: w.maxRssMb, warmPhases: w.phases, perFileCalls: res.countedRun.perFile, topCallers: res.countedRun.topCallers }));
  }
  if (results.length > 1) {
    const [first, last] = [results[0], results[results.length - 1]];
    console.log(JSON.stringify({ scaling: { fileRatio: last.files / first.files, warmTimeRatio: Math.round((last.warm.wallMs / first.warm.wallMs) * 10) / 10 } }));
  }
}

if (process.argv[2] === '--child') {
  childMain(process.argv[3], process.argv[4], process.argv[5] === 'counted').catch((err) => {
    console.error(err);
    process.exitCode = 2;
  });
} else {
  main();
}
