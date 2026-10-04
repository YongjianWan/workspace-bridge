// @semantic — Recheck active old claims; distinguish execution from source evidence.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { DependencyGraph } = require('../src/services/dep-graph');
const { GraphDB, acquireLockSync, releaseLockSync } = require('../src/services/graph-db');
const { WorkspaceCache, computeDefaultCacheDir } = require('../src/services/cache');
const { FileIndex } = require('../src/services/file-index');
const { ProjectContext, ENTRY_BASE_NAMES } = require('../src/utils/project-context');
const { resolveWorkspaceFilePath } = require('../src/utils/path');
const { classifyDeadExports } = require('../src/tools/honesty-engine');
const { runCommandSecure } = require('../src/utils/command');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-old-debts-'));
if (path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe scratch');
const report = [];
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function writeCase(name, sources) {
  const dir = path.join(scratch, name);
  for (const [file, content] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}
async function graphCase(name, sources) {
  const dir = writeCase(name, sources);
  const graph = new DependencyGraph(dir, null, { quiet: true });
  await graph.build(Object.keys(sources).map(file => path.join(dir, file)));
  return { dir, graph };
}
async function check(id, fn) {
  try { const result = await fn(); report.push({ id, ...result }); }
  catch (error) { report.push({ id, status: 'unresolved', error: error.stack }); }
  console.log(JSON.stringify(report.at(-1)));
}
function inspect(id, file, predicate, note) {
  return check(id, () => ({ status: predicate(source(file)) ? 'source-confirmed' : 'source-claim-expired',
    evidenceKind: 'source inspection; no workload or crash claim', file, note }));
}
(async () => {
  try {
    await check('L1-18', () => {
      const lock = path.join(scratch, 'race.lock'); fs.writeFileSync(lock, '');
      acquireLockSync(lock); const stolenBlankLock = fs.readFileSync(lock, 'utf8') === String(process.pid);
      releaseLockSync(lock);
      const db = new GraphDB(path.join(scratch, 'busy.db')); db._ensureOpen();
      const busyTimeout = db.db.prepare('PRAGMA busy_timeout').get().timeout; db.close();
      return { status: stolenBlankLock && busyTimeout === 0 ? 'confirmed' : 'changed',
        stolenBlankLock, busyTimeout, scope: 'Simulated zero-byte creation window, not inevitable parallel crash' };
    });
    await check('L1-19', () => ({ status: 'confirmed-part', evidence: require('./truth/platform-boundaries.json').submodule.overview,
      scope: 'Gitignore fallback was observed; OOM and inclusion of default-excluded node_modules are not proved' }));
    await check('L1-21', () => {
      const names = new Set();
      for (const file of fs.readdirSync(path.join(root, 'src/services/dep-graph/parsers'))) {
        if (!file.endsWith('.js')) continue;
        for (const match of source(`src/services/dep-graph/parsers/${file}`).matchAll(/loadLanguage\('([^']+)'\)/g)) names.add(match[1]);
      }
      const framework = source('src/services/dep-graph/framework-patterns.js');
      for (const name of ['javascript', 'typescript', 'tsx']) if (framework.includes(name)) names.add(name);
      return { status: names.size <= 12 ? 'not-reproduced-in-supported-scope' : 'unresolved', names: [...names], cap: 12,
        scope: 'Source reachability of supported callers; no forced out-of-scope language eviction or SIGSEGV' };
    });
    await check('L1-28', () => {
      const item = { file: 'index.js', name: 'publicApi', importerCount: 0, confidence: 'high' };
      classifyDeadExports([item], { getStats: () => ({ files: 1, totalImports: 0 }) });
      return { status: item.safeToDelete === true ? 'confirmed' : 'expired', item,
        scope: 'Classifier ignores public export contract; overlaps existing S-6' };
    });
    await check('L1-33', async () => {
      const { dir, graph } = await graphCase('new-cycle', { 'a.js': 'module.exports=1;', 'b.js': 'module.exports=2;' });
      const before = graph.findCircularDependencies().length;
      fs.writeFileSync(path.join(dir, 'a.js'), "require('./b'); module.exports=1;");
      fs.writeFileSync(path.join(dir, 'b.js'), "require('./a'); module.exports=2;");
      await graph.updateFiles([path.join(dir, 'a.js'), path.join(dir, 'b.js')]);
      const after = graph.findCircularDependencies().length;
      return { status: after === 0 ? 'confirmed' : 'expired', before, after, expectedAfter: 1 };
    });
    await check('L1-34', async () => {
      const { dir, graph } = await graphCase('go-delete', {
        'main.go': 'package sample\nfunc Main(){ Foo() }\n', 'foo.go': 'package sample\nfunc Foo(){}\n' });
      const key = graph.normalizeFilePath(path.join(dir, 'foo.go'));
      const before = graph.getFileInfo(path.join(dir, 'main.go')).imports.includes(key);
      fs.unlinkSync(path.join(dir, 'foo.go')); await graph.updateFiles([path.join(dir, 'foo.go')]);
      const after = graph.getFileInfo(path.join(dir, 'main.go')).imports.includes(key);
      const stalePackageIndex = [...graph.builder.goPackageIndex.values()].some(values => values.has(key));
      return { status: after ? 'confirmed' : 'ghost-edge-claim-expired', before, after, stalePackageIndex };
    });
    await check('L1-39', async () => {
      const { dir, graph } = await graphCase('c-symbols', {
        'a.h': '#define ANSWER 42\n', 'main.c': '#include "a.h"\nint main(){return ANSWER;}\n' });
      const result = graph.getSymbolImpact(path.join(dir, 'a.h'));
      return { status: result.directCount === 0 ? 'confirmed' : 'changed', result };
    });
    await inspect('L1-43', 'src/tools/audit-assembler.js', text => /highCompositeRiskFiles > 0 \|\| result\.summary\?\.counts\?\.affectedTests > 0/.test(text), 'hasFindings excludes incremental cycles/unresolved; actual CLI comparison is required for stronger gating claim');
    await check('L2-22', async () => {
      const { dir, graph } = await graphCase('js-fallback', { 'bad.js': "const dep=require('./other'); function broken( {", 'other.js': 'module.exports=1;' });
      const parsed = await graph.builder.parseFileOnly(path.join(dir, 'bad.js'));
      return { status: parsed.parseModeReason === 'regex-native' ? 'confirmed' : 'expired', parseMode: parsed.parseMode,
        parseModeReason: parsed.parseModeReason,
        cachedUsable: graph.builder._isParseCacheUsable({ hash: 'h', ...parsed }, { hash: 'h' }) };
    });
    await check('L2-23', async () => {
      const { dir, graph } = await graphCase('java-dto', {
        'dto/UserDto.java': 'package dto; public class UserDto {}',
        'app/Use.java': 'package app; import dto.UserDto; class Use { UserDto value; }' });
      const imports = graph.getFileInfo(path.join(dir, 'app/Use.java')).imports;
      const found = imports.includes(graph.normalizeFilePath(path.join(dir, 'dto/UserDto.java')));
      return { status: found ? 'expired' : 'confirmed', found, imports };
    });
    await check('L2-24', () => {
      const input = path.join(scratch, 'cache-case'); fs.mkdirSync(input);
      const paths = [input, input.toUpperCase(), input.replaceAll('\\', '/')].map(value => computeDefaultCacheDir(value));
      return { status: new Set(paths).size > 1 ? 'confirmed' : 'expired', paths };
    });
    await inspect('L2-25', 'cli.js', text => !/process\.(?:on|once)\(['"]SIG(?:INT|TERM)/.test(text), 'Main CLI signal cleanup absent; not proof of WAL corruption');
    await inspect('L2-26', 'src/services/dep-graph/builder.js', text => text.includes('info.importRecords.some'), 'Same-package nested loops retain per-target record scans; workload timing is still bounded');
    await check('L2-27', async () => {
      const relative = Array.from({ length: 14 }, (_, i) => `d${i}`).join('/') + '/deep.js';
      const dir = writeCase('depth', { [relative]: 'module.exports=1;' });
      const cache = new WorkspaceCache(dir, { cacheDir: path.join(scratch, 'depth-cache') });
      const index = new FileIndex(dir, cache); await index.build(undefined, { watch: false });
      const indexed = cache.fileMetadata.size; const warnings = index.warnings; index.stopWatching(); await cache.close();
      return { status: indexed === 0 ? 'confirmed' : 'expired', indexed, warnings };
    });
    await check('L2-30', () => {
      const dir = writeCase('entries', { 'main.py': 'def run(): return 1', 'main.go': 'package main\nfunc main(){}' });
      const context = new ProjectContext(dir);
      const py = context.classifyFile(path.join(dir, 'main.py'));
      const go = context.classifyFile(path.join(dir, 'main.go'));
      return { status: 'partial-source-contract', missingBaseNames: ['main.py', 'main.go', 'main.rs', 'Main.java'].filter(name => !ENTRY_BASE_NAMES.has(name)), py, go,
        scope: 'Root Python standalone-entry handling means the universal orphan claim is overstated' };
    });
    await check('L2-31', async () => {
      const tailProgram = "setTimeout(()=>console.log('TAIL_MARKER'),150)";
      const program = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(tailProgram)}],{stdio:'inherit'}); console.log('HEAD_MARKER'); process.exit(0);`;
      const result = await runCommandSecure(process.execPath, ['-e', program], scratch, 5000);
      return { status: !result.stdout.includes('TAIL_MARKER') ? 'confirmed' : 'expired', stdout: result.stdout, exitCode: result.exitCode,
        scope: 'Grandchild inherits pipes and emits after direct child exit' };
    });
    await inspect('L2-32', 'src/tools/api-contract-tools.js', text => /await frontendContainer\.shutdown\(\);[\s\S]{0,100}await backendContainer\.shutdown\(\);/.test(text), 'Sequential cleanup in finally allows first rejection to prevent second cleanup');
    await check('L2-35', () => {
      const dir = writeCase('paths', { 'src/main.js': 'module.exports=1;' });
      const rooted = resolveWorkspaceFilePath('/src/main.js', dir);
      const validAbsolute = resolveWorkspaceFilePath(path.join(dir, 'src/main.js'), dir);
      const uncRoot = '\\\\localhost\\C$\\Users\\' + require('os').userInfo().username;
      const uncAbsolute = resolveWorkspaceFilePath(uncRoot + '\\Desktop\\fixture.js', uncRoot);
      return { status: process.platform === 'win32' && uncAbsolute === null ? 'confirmed-unc-part' : 'platform-dependent', rooted, validAbsolute, uncAbsolute,
        scope: 'Rejecting drive-root /src outside workspace is expected; rejecting in-root UNC absolute is a distinct limitation' };
    });
    await inspect('L2-36', 'src/services/file-index.js', text => text.includes("type: 'unsupported-source-files'") && !/if \(this\.unsupportedSourceFiles\.length > 0\)/.test(text), 'Emission has no guard after Git filtering empties candidates');
    await check('L2-37', () => {
      const dir = writeCase('case-realpath', { 'src/main.js': 'module.exports=1;' });
      const original = fs.realpathSync(dir); const variant = fs.realpathSync(dir.toUpperCase());
      return { status: original === variant ? 'canonical-case-claim-expired' : 'confirmed-part', original, variant,
        scope: 'Current Windows NTFS realpath canonicalization; symlink loop bounded separately' };
    });
    await inspect('L2-38', 'src/services/dep-graph/ast-rules.js', text => text.includes("id: 'batch-no-transactional'"), 'Semantic transaction rule conflicts with project boundary');
    await check('L2-40', () => {
      const dir = writeCase('guard-missing', { 'main.js': 'module.exports=1;' });
      const cases = ['--file', '--files'].map(flag => {
        const run = spawnSync(process.execPath, [path.join(root, 'cli.js'), 'guard', '--cwd', dir, flag, 'absent.js', '--json', '--quiet'], { encoding: 'utf8', timeout: 60000 });
        return { flag, exitCode: run.status, data: JSON.parse(run.stdout) };
      });
      return { status: cases[1].exitCode === 0 && cases[1].data.passed ? 'silent-pass-on-missing-target' : 'changed', cases,
        scope: 'Compare advertised plural --files with shared singular option; this is not a crash classification test' };
    });
    await inspect('L2-41', 'src/services/dep-graph/api-contracts/client-call-extractor.js', text => !text.includes('__request'), 'Generated-client extractor lacks explicit __request call form');
    await check('L2-42', () => {
      const tracked = spawnSync('git', ['ls-files', '.claude/settings.local.json', 'reference'], { cwd: root, encoding: 'utf8' }).stdout.trim().split(/\r?\n/).filter(Boolean);
      return { status: tracked.length ? 'confirmed' : 'expired', trackedPaths: tracked,
        scope: 'Filename and tracking only; configuration contents are not exposed' };
    });
    await inspect('L2-44', 'src/tools/audit-assembler.js', text => /getImpactRadius\(entry\.resolvedPath, 2\)/.test(text), 'withImpact path hardcodes depth 2');
    await inspect('L3-8', 'src/services/dep-graph/symbol-impact.js', text => text.includes('?.importRecords') && text.includes('return []'), 'Internal missing info turns into empty records; generic item is a touch-point rule, not one concrete crash');
    await inspect('L3-12', 'test/runner.js', text => /readFileSync|readFile/.test(text) && /@slow|layer/.test(text), 'Runner still uses source markers and source heuristics');
    await check('L3-13', () => ({ status: 'open-performance-policy', evidence: 'Full-run historical times are baselines, not a current guarantee; bounded slow-test concurrency remains 2' }));
    await inspect('L3-16', 'src/services/cache.js', text => text.includes('statSync'), 'Path compatibility probes remain; do not preserve obsolete entry-detector count without rerun');
    await check('L3-17', () => ({ status: 'open-performance-policy', evidence: 'Warm pipeline cost remains subject to profiling; old overlapping stage times are not a current timing proof' }));
    await check('L3-18', () => ({ status: 'confirmed', evidence: require('./truth/platform-boundaries.json').cacheAfterWorkspaceDeletion }));
    const out = path.join(__dirname, 'truth/old-debts-review.json');
    fs.writeFileSync(out, JSON.stringify({ cases: report, scope: 'Per-item execution or explicitly labelled source inspection; unresolved entries remain U-28' }, null, 2) + '\n');
    console.log(JSON.stringify({ selected: report.length, unresolved: report.filter(item => item.status === 'unresolved').map(item => item.id), out }));
  } finally { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
