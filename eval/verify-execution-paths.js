// @semantic — Harmless local executables record the production execution path.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-exec-truth-'));
const report = {};
const cli = path.join(root, 'cli.js');

async function main() {
  if (process.platform !== 'win32') throw new Error('This probe targets Windows executable search');
  const security = path.join(scratch, 'security');
  fs.mkdirSync(security);
  fs.writeFileSync(path.join(security, 'app.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(security, '.workspace-bridge.json'), JSON.stringify({ builtinOnly: false }));
  const probe = path.join(scratch, 'Probe.cs');
  fs.writeFileSync(probe, 'using System; using System.IO; class Probe { static void Main(string[] args) {'
    + 'File.WriteAllText("executed.txt", string.Join("\\n",args));'
    + 'Console.WriteLine("{\\"results\\":[],\\"errors\\":[]}"); } }');
  const compiled = spawnSync('C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    ['/nologo', '/target:exe', `/out:${path.join(security, 'semgrep.exe')}`, probe], { encoding: 'utf8' });
  if (compiled.status !== 0) throw new Error(`Probe compilation failed: ${compiled.stdout} ${compiled.stderr}`);
  const { buildSafeEnv } = require('../src/utils/command');
  const normalWhere = spawnSync('where.exe', ['semgrep'], { cwd: security, encoding: 'utf8', env: process.env });
  const safeWhere = spawnSync('where.exe', ['semgrep'], { cwd: security, encoding: 'utf8', env: buildSafeEnv() });
  const extensionWhere = spawnSync('where.exe', ['semgrep.exe'], { cwd: security, encoding: 'utf8', env: buildSafeEnv() });
  report.availability = { normalWhereExit: normalWhere.status, safeWhereExit: safeWhere.status,
    explicitExtensionExit: extensionWhere.status, safeEnvHasPathext: 'PATHEXT' in buildSafeEnv() };
  const result = spawnSync(process.execPath, [cli, 'audit-security', '--cwd', security, '--json', '--quiet'],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, WB_CACHE_DIR: path.join(scratch, 'cache-security') } });
  const data = JSON.parse(result.stdout);
  report.semgrep = { exitCode: result.status, adapters: data.adapters,
    localExecutableRan: fs.existsSync(path.join(security, 'executed.txt')),
    args: fs.existsSync(path.join(security, 'executed.txt'))
      ? fs.readFileSync(path.join(security, 'executed.txt'), 'utf8').split('\n') : [],
    warnings: data.warnings, ok: data.ok };

  const watch = path.join(scratch, 'watch');
  fs.mkdirSync(path.join(watch, 'src'), { recursive: true });
  fs.mkdirSync(path.join(watch, 'test'));
  fs.writeFileSync(path.join(watch, 'package.json'), JSON.stringify({ name: 'execution-probe',
    scripts: { test: 'jest' }, devDependencies: { jest: '*' } }));
  fs.writeFileSync(path.join(watch, 'src', 'helper.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(watch, 'test', 'helper.test.js'), "const helper = require('../src/helper'); test('helper', () => expect(helper).toBe(1));\n");
  fs.mkdirSync(path.join(watch, 'node_modules', 'jest', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(watch, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(watch, 'node_modules', 'jest', 'package.json'), JSON.stringify({
    name: 'jest', version: '1.0.0', bin: { jest: 'bin/jest.js' } }));
  fs.writeFileSync(path.join(watch, 'node_modules', 'jest', 'bin', 'jest.js'),
    "require('node:fs').writeFileSync('test-executed.json', JSON.stringify(process.argv.slice(2))); if (process.argv.slice(2).some(arg => arg.replaceAll('\\\\', '/').endsWith('src/helper.js'))) { console.error('Probe: source path does not match any test'); process.exitCode = 1; }\n");
  fs.writeFileSync(path.join(watch, 'node_modules', '.bin', 'jest.cmd'),
    `@echo off\r\n"${process.execPath}" "%~dp0..\\jest\\bin\\jest.js" %*\r\n`);
  fs.writeFileSync(path.join(watch, '.npmrc'), `offline=true\ncache=${path.join(scratch, 'npm-cache').replaceAll('\\', '/')}\n`);
  fs.writeFileSync(path.join(watch, 'npx.cmd'), '@echo off\r\necho %* >> executed.txt\r\nexit /b 0\r\n');
  const overview = spawnSync(process.execPath, [cli, 'audit-overview', '--cwd', watch, '--json', '--quiet'],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, WB_CACHE_DIR: path.join(scratch, 'cache-overview') } });
  report.readonlyOverview = { exitCode: overview.status,
    localExecutableRan: fs.existsSync(path.join(watch, 'executed.txt')),
    commands: fs.existsSync(path.join(watch, 'executed.txt'))
      ? fs.readFileSync(path.join(watch, 'executed.txt'), 'utf8').trim().split(/\r?\n/) : [] };
  fs.rmSync(path.join(watch, 'executed.txt'), { force: true });
  const child = spawn(process.execPath, [cli, 'watch', '--cwd', watch, '--run-tests'],
    { env: { ...process.env, WB_CACHE_DIR: path.join(scratch, 'cache-watch') }, windowsHide: true });
  let stdout = ''; let stderr = ''; let changed = false;
  child.stdout.on('data', (bytes) => { stdout += bytes; });
  child.stderr.on('data', (bytes) => {
    stderr += bytes;
    if (!changed && /Watching.*file changes/.test(stderr)) {
      changed = true;
      setTimeout(() => fs.writeFileSync(path.join(watch, 'src', 'helper.js'), 'module.exports = 2;\n'), 500);
    }
  });
  await new Promise((resolve) => {
    const deadline = setTimeout(() => { child.kill(); }, 25000);
    const poll = setInterval(() => {
      if (changed && fs.existsSync(path.join(watch, 'test-executed.json'))
        && stdout.split(/\r?\n/).some((line) => {
          try { const event = JSON.parse(line); return event.event === 'validationComplete' && event.file === 'src\\helper.js'; } catch { return false; }
        })) child.kill();
    }, 200);
    child.on('close', (exitCode, signal) => {
      clearTimeout(deadline); clearInterval(poll);
      report.watch = { ready: changed, localExecutableRan: fs.existsSync(path.join(watch, 'executed.txt')),
        command: fs.existsSync(path.join(watch, 'executed.txt'))
          ? fs.readFileSync(path.join(watch, 'executed.txt'), 'utf8').trim() : null,
        actualTestArguments: fs.existsSync(path.join(watch, 'test-executed.json'))
          ? JSON.parse(fs.readFileSync(path.join(watch, 'test-executed.json'), 'utf8')) : [],
        expectedTestArguments: ['test/helper.test.js'], exitCode, signal, stdout, stderr };
      resolve();
    });
  });
  const out = path.join(__dirname, 'truth', 'execution-paths.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ availability: report.availability, readonlyOverview: report.readonlyOverview, semgrep: report.semgrep, watch: { ready: report.watch.ready,
    localExecutableRan: report.watch.localExecutableRan, command: report.watch.command,
    actualTestArguments: report.watch.actualTestArguments, expectedTestArguments: report.watch.expectedTestArguments }, out }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe scratch path');
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
});
