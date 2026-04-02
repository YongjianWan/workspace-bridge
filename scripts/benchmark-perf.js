#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');
const resultsDir = path.join(repoRoot, 'benchmark', 'results');
const latestResultPath = path.join(resultsDir, 'latest.json');

function parseArgs(argv) {
  const options = {
    files: 620,
    changeCount: 12,
    maxMs: 30000,
    keepFixture: false,
    verbose: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--files') options.files = Number.parseInt(argv[++i] || '', 10);
    else if (arg === '--changes') options.changeCount = Number.parseInt(argv[++i] || '', 10);
    else if (arg === '--max-ms') options.maxMs = Number.parseInt(argv[++i] || '', 10);
    else if (arg === '--keep-fixture') options.keepFixture = true;
    else if (arg === '--verbose') options.verbose = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.files) || options.files < 500) {
    throw new Error('--files must be >= 500');
  }
  if (!Number.isFinite(options.changeCount) || options.changeCount < 1) {
    throw new Error('--changes must be >= 1');
  }
  if (!Number.isFinite(options.maxMs) || options.maxMs < 1) {
    throw new Error('--max-ms must be >= 1');
  }
  return options;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function generateFixture(root, fileTarget) {
  const config = {
    jsModules: 320,
    jsTests: 140,
    pyModules: 100,
    pyTests: 30,
    docs: 20,
    examples: 20,
    prototypes: 20,
  };
  let currentTotal = Object.values(config).reduce((sum, n) => sum + n, 0) + 3;
  while (currentTotal < fileTarget) {
    config.jsModules += 1;
    currentTotal += 1;
  }

  writeFile(root, 'package.json', JSON.stringify({
    name: 'workspace-bridge-benchmark-fixture',
    version: '1.0.0',
    private: true,
    main: 'src/index.js',
    scripts: {
      test: 'echo "fixture tests"',
    },
  }, null, 2));
  writeFile(root, 'package-lock.json', '{}\n');
  writeFile(root, 'pytest.ini', '[pytest]\n');

  for (let i = 0; i < config.jsModules; i += 1) {
    const next = i < config.jsModules - 1 ? `import { fn${i + 1} } from './module-${i + 1}.js';\n` : '';
    const body = i < config.jsModules - 1 ? `return fn${i + 1}() + ${i};` : `return ${i};`;
    writeFile(root, `src/module-${i}.js`, `${next}export function fn${i}() { ${body} }\n`);
  }
  writeFile(root, 'src/index.js', "import { fn0 } from './module-0.js';\nexport function run() { return fn0(); }\n");

  for (let i = 0; i < config.jsTests; i += 1) {
    const mod = i % config.jsModules;
    writeFile(
      root,
      `test/module-${mod}.test.js`,
      `import { fn${mod} } from '../src/module-${mod}.js';\ndescribe('m${mod}', () => { it('ok', () => fn${mod}()); });\n`
    );
  }

  for (let i = 0; i < config.pyModules; i += 1) {
    const next = i < config.pyModules - 1 ? `from .py_mod_${i + 1} import py_fn_${i + 1}\n\n` : '';
    const body = i < config.pyModules - 1 ? `    return py_fn_${i + 1}() + ${i}\n` : `    return ${i}\n`;
    writeFile(root, `api/py_mod_${i}.py`, `${next}def py_fn_${i}():\n${body}`);
  }
  writeFile(root, 'api/__init__.py', '# benchmark fixture\n');

  for (let i = 0; i < config.pyTests; i += 1) {
    const mod = i % config.pyModules;
    writeFile(
      root,
      `tests/test_py_mod_${mod}.py`,
      `from api.py_mod_${mod} import py_fn_${mod}\n\ndef test_py_mod_${mod}():\n    assert py_fn_${mod}() >= 0\n`
    );
  }

  for (let i = 0; i < config.docs; i += 1) {
    writeFile(root, `docs/guide-${i}.md`, `# Guide ${i}\n\nThis is benchmark fixture documentation.\n`);
  }
  for (let i = 0; i < config.examples; i += 1) {
    writeFile(root, `examples/demo/example-${i}.js`, `export const demo${i} = ${i};\n`);
  }
  for (let i = 0; i < config.prototypes; i += 1) {
    writeFile(root, `prototypes/playground/proto-${i}.js`, `export const proto${i} = ${i};\n`);
  }

  return {
    totalFiles: countFiles(root),
    tree: {
      src: config.jsModules + 1,
      test: config.jsTests,
      api: config.pyModules + 1,
      tests: config.pyTests,
      docs: config.docs,
      examples: config.examples,
      prototypes: config.prototypes,
    },
  };
}

function countFiles(root) {
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else total += 1;
    }
  }
  return total;
}

function initFixtureGit(root) {
  run('git', ['init'], root);
  run('git', ['config', 'user.email', 'benchmark@example.com'], root);
  run('git', ['config', 'user.name', 'Benchmark Bot'], root);
  run('git', ['add', '.'], root);
  run('git', ['commit', '-m', 'fixture init'], root);
}

function mutateFiles(root, changeCount) {
  const changed = [];
  for (let i = 0; i < changeCount; i += 1) {
    const jsIndex = i;
    const pyIndex = i;
    writeFile(root, `src/module-${jsIndex}.js`, `import { fn${jsIndex + 1} } from './module-${jsIndex + 1}.js';\nexport function fn${jsIndex}() { return fn${jsIndex + 1}() + ${1000 + i}; }\n`);
    writeFile(root, `api/py_mod_${pyIndex}.py`, `from .py_mod_${pyIndex + 1} import py_fn_${pyIndex + 1}\n\ndef py_fn_${pyIndex}():\n    return py_fn_${pyIndex + 1}() + ${1000 + i}\n`);
    changed.push(`src/module-${jsIndex}.js`, `api/py_mod_${pyIndex}.py`);
  }
  return changed;
}

function removeCache(root) {
  const cachePath = path.join(root, '.workspace-bridge-cache.json');
  if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { force: true });
}

function timeCommand(label, command, args, cwd) {
  const start = process.hrtime.bigint();
  const output = run(command, args, cwd);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { label, elapsedMs: Math.round(elapsedMs), output };
}

function runCliJson(command, fixtureRoot) {
  return ['node', [cliPath, command, '--cwd', fixtureRoot, '--json', '--quiet'], repoRoot];
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse ${label} JSON output: ${error.message}`);
  }
}

function buildSummaryRows(results) {
  return results.map((entry) => `${entry.label.padEnd(24)} ${String(entry.elapsedMs).padStart(6)} ms`).join('\n');
}

function evaluateThresholds(results, maxMs) {
  const violations = results.filter((entry) => entry.elapsedMs > maxMs);
  return {
    pass: violations.length === 0,
    violations: violations.map((entry) => ({
      metric: entry.label,
      elapsedMs: entry.elapsedMs,
      maxMs,
    })),
  };
}

function main() {
  const options = parseArgs(process.argv);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-bridge-bench-'));
  const startedAt = new Date().toISOString();
  let fixtureInfo = null;
  const timings = [];

  try {
    fixtureInfo = generateFixture(fixtureRoot, options.files);
    initFixtureGit(fixtureRoot);
    mutateFiles(fixtureRoot, options.changeCount);

    removeCache(fixtureRoot);
    {
      const [cmd, args, cwd] = runCliJson('audit-summary', fixtureRoot);
      const result = timeCommand('cold.audit-summary', cmd, args, cwd);
      const parsed = parseJson(result.output, result.label);
      result.meta = { severity: parsed.summary?.severity, mainlineFiles: parsed.scope?.counts?.mainlineFiles };
      timings.push(result);
    }
    {
      const [cmd, args, cwd] = runCliJson('audit-diff', fixtureRoot);
      const result = timeCommand('cold.audit-diff', cmd, args, cwd);
      const parsed = parseJson(result.output, result.label);
      result.meta = { changedFiles: parsed.summary?.counts?.changedFiles, severity: parsed.summary?.severity };
      timings.push(result);
    }
    {
      const [cmd, args, cwd] = runCliJson('audit-summary', fixtureRoot);
      const result = timeCommand('hot.audit-summary', cmd, args, cwd);
      timings.push(result);
    }
    {
      const [cmd, args, cwd] = runCliJson('audit-diff', fixtureRoot);
      const result = timeCommand('hot.audit-diff', cmd, args, cwd);
      timings.push(result);
    }

    mutateFiles(fixtureRoot, Math.max(5, Math.floor(options.changeCount / 2)));
    {
      const [cmd, args, cwd] = runCliJson('audit-diff', fixtureRoot);
      const result = timeCommand('incremental.audit-diff', cmd, args, cwd);
      const parsed = parseJson(result.output, result.label);
      result.meta = { changedFiles: parsed.summary?.counts?.changedFiles, severity: parsed.summary?.severity };
      timings.push(result);
    }

    const threshold = evaluateThresholds(
      timings.filter((item) => item.label === 'cold.audit-summary' || item.label === 'cold.audit-diff'),
      options.maxMs
    );
    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      options,
      fixtureRoot,
      fixture: fixtureInfo,
      timings: timings.map((entry) => ({ label: entry.label, elapsedMs: entry.elapsedMs, meta: entry.meta || null })),
      threshold,
    };

    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(latestResultPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`Fixture root: ${fixtureRoot}`);
    console.log(`File count: ${fixtureInfo.totalFiles}`);
    console.log('Tree:');
    for (const [key, value] of Object.entries(fixtureInfo.tree)) {
      console.log(`  ${key}: ${value}`);
    }
    console.log('\nTimings:');
    console.log(buildSummaryRows(timings));
    console.log(`\nResult JSON: ${latestResultPath}`);

    if (!threshold.pass) {
      console.error('\nThreshold check failed:');
      for (const v of threshold.violations) {
        console.error(`  ${v.metric}: ${v.elapsedMs}ms > ${v.maxMs}ms`);
      }
      process.exitCode = 1;
    } else {
      console.log(`\nThreshold check passed (cold audit-summary/audit-diff <= ${options.maxMs}ms).`);
    }
  } finally {
    if (!options.keepFixture) {
      try {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      } catch (error) {
        if (options.verbose) {
          console.error(`Failed to cleanup fixture ${fixtureRoot}: ${error.message}`);
        }
      }
    }
  }
}

main();
