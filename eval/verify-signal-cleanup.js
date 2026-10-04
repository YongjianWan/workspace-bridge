// @semantic — Actual CLI signal path with observable cleanup, no corruption claim.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-signal-cleanup-'));
const root = path.resolve(__dirname, '..');
const ready = path.join(dir, 'ready');
const cleaned = path.join(dir, 'cleaned');
fs.writeFileSync(path.join(dir, 'main.js'), 'module.exports = 1;\n');
const preload = path.join(dir, 'observe.cjs');
fs.writeFileSync(preload, `const fs=require('node:fs');const {ServiceContainer}=require(${JSON.stringify(path.join(root, 'src/services/container'))});const initialize=ServiceContainer.prototype.initialize;const shutdown=ServiceContainer.prototype.shutdown;ServiceContainer.prototype.shutdown=async function(...args){fs.writeFileSync(${JSON.stringify(cleaned)},'called');return shutdown.apply(this,args);};ServiceContainer.prototype.initialize=async function(...args){const result=await initialize.apply(this,args);fs.writeFileSync(${JSON.stringify(ready)},'ready');await new Promise(()=>{setInterval(()=>{},1000);});return result;};`);
(async () => {
  const child = spawn(process.execPath, ['--require', preload, path.join(root, 'cli.js'), 'audit-overview', '--cwd', dir, '--json', '--quiet'], { env: { ...process.env, WB_CACHE_DIR: path.join(dir, 'cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  child.stdout.resume();
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  const start = Date.now();
  while (!fs.existsSync(ready) && Date.now() - start < 60000 && child.exitCode === null) await new Promise((resolve) => setTimeout(resolve, 100));
  const reachedInitialization = fs.existsSync(ready);
  child.kill('SIGTERM');
  const outcome = await exit;
  const report = { reachedInitialization, cleanupObserved: fs.existsSync(cleaned), outcome, stderr, scope: 'Actual initialized CLI held at initialization return for deterministic signalling; Windows SIGTERM semantics; no assertion of WAL corruption or leaked OS handles' };
  fs.writeFileSync(path.join(__dirname, 'truth/signal-cleanup.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
})().catch((error) => { console.error(error); process.exitCode = 1; });
