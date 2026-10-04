// @semantic — Real Jest, real watch subprocess, isolated valid source change.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const modules = process.argv[2] || path.join(__dirname, 'truth/runtime-jest/node_modules');
const out = process.argv[3] || path.join(__dirname, 'truth/watch-real.json');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-watch-real-'));
if (path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe scratch');
const jest = path.join(modules, 'jest/bin/jest.js');
function direct() {
  const run = spawnSync(process.execPath, [jest, '--runInBand', 'test/helper.test.js'],
    { cwd: scratch, encoding: 'utf8', timeout: 60000 });
  return { exitCode: run.status, stdout: run.stdout, stderr: run.stderr };
}
(async () => {
  try {
    for (const dir of ['src', 'test']) fs.mkdirSync(path.join(scratch, dir));
    fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'watch-real',
      scripts: { test: 'jest' }, devDependencies: { jest: '29.7.0' } }));
    fs.writeFileSync(path.join(scratch, '.npmrc'), `offline=true\ncache=${path.join(scratch, '.npm-cache').replaceAll('\\', '/')}\n`);
    fs.symlinkSync(path.resolve(modules), path.join(scratch, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.writeFileSync(path.join(scratch, 'src/helper.js'), 'module.exports=1;\n');
    fs.writeFileSync(path.join(scratch, 'test/helper.test.js'),
      "const value=require('../src/helper'); test('positive',()=>expect(value).toBeGreaterThan(0));\n");
    const baseline = direct();
    if (baseline.exitCode !== 0) throw new Error(baseline.stderr);
    let stdout = '', stderr = '', changed = false, timedOut = false;
    const watch = spawn(process.execPath, [path.join(root, 'cli.js'), 'watch', '--cwd', scratch, '--run-tests'],
      { cwd: root, env: { ...process.env, WB_CACHE_DIR: path.join(scratch, '.wb-cache') } });
    watch.stdout.on('data', chunk => { stdout += chunk; });
    watch.stderr.on('data', chunk => { stderr += chunk; });
    const timeout = setTimeout(() => { timedOut = true; watch.kill('SIGTERM'); }, 60000);
    const timer = setInterval(() => {
      if (!changed && /Watching.*file changes/.test(stderr)) {
        changed = true; fs.writeFileSync(path.join(scratch, 'src/helper.js'), 'module.exports=2;\n');
      }
      const events = stdout.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      if (events.some(event => event.event === 'validationComplete' && event.file.replaceAll('\\', '/') === 'src/helper.js')) watch.kill('SIGTERM');
    }, 200);
    const exit = await new Promise((resolve, reject) => {
      watch.once('error', reject); watch.once('close', (code, signal) => resolve({ code, signal }));
    });
    clearInterval(timer); clearTimeout(timeout);
    const after = direct();
    const events = stdout.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const report = { platform: process.platform, node: process.version, baseline, after,
      ready: changed, timedOut, exit, events, stdout, stderr,
      scope: 'Real Jest29.7, valid source change still passes the mapped test; watch must complete source round.' };
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ platform: report.platform, baselineExit: baseline.exitCode,
      afterExit: after.exitCode, timedOut, commandNames: events.filter(event => event.event === 'commandStart').map(event => event.name),
      complete: events.filter(event => event.event === 'validationComplete' && event.file.replaceAll('\\', '/') === 'src/helper.js') }));
    if (!changed || timedOut || after.exitCode !== 0) throw new Error('Incomplete watch experiment');
  } finally { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
