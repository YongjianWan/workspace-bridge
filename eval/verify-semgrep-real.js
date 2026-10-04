// @semantic — Real Semgrep process and explicit local executable search conditions.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SemgrepAdapter } = require('../src/adapters/semgrep');
const real = process.argv[2];
const out = process.argv[3];
if (process.platform === 'win32' || !real || !out) throw new Error('Run in Linux with real Semgrep path and output path');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-semgrep-real-'));
if (path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe scratch');
const originalPath = process.env.PATH;
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
(async () => {
  try {
    fs.writeFileSync(path.join(scratch, 'sample.py'), "print('probe')\n");
    const config = path.join(scratch, 'rules.yaml');
    fs.writeFileSync(config, 'rules:\n- id: probe-print\n  languages: [python]\n  severity: WARNING\n  message: scanner probe\n  pattern: print($X)\n');
    const adapter = new SemgrepAdapter();
    process.env.PATH = path.dirname(real) + ':' + originalPath;
    const available = await adapter.isAvailable(scratch);
    const realScan = await adapter.scan(['sample.py'], { cwd: scratch, config });
    const marker = path.join(scratch, 'executed-args.txt');
    fs.writeFileSync(path.join(scratch, 'semgrep'),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${quote(marker)}\nexec ${quote(real)} "$@"\n`, { mode: 0o755 });
    process.env.PATH = '/usr/bin:/bin';
    const localWithoutPath = await adapter.isAvailable(scratch);
    process.env.PATH = scratch + ':' + path.dirname(real) + ':' + originalPath;
    const localWithPath = await adapter.isAvailable(scratch);
    const wrappedScan = await adapter.scan(['sample.py'], { cwd: scratch, config });
    const args = fs.readFileSync(marker, 'utf8').trim().split('\n');
    const report = { platform: process.platform, available, realScan, localWithoutPath, localWithPath,
      localExecutableRan: fs.existsSync(marker), actualArgs: args, wrappedScan,
      scope: 'Semgrep1.140 real scan with local rules; Linux cwd alone does not enter PATH; explicit PATH does.' };
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ available, findings: realScan.findings.length, localWithoutPath, localWithPath,
      args, wrappedFindings: wrappedScan.findings.length }));
    if (!available || realScan.findings.length !== 1 || localWithoutPath || !localWithPath || wrappedScan.findings.length !== 1) throw new Error('Real scanner contract mismatch');
  } finally {
    process.env.PATH = originalPath;
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
