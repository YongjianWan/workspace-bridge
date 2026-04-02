#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function nowIso() {
  return new Date().toISOString();
}

function truncate(text, limit = 4000) {
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n...[truncated]`;
}

function parseArgs(argv) {
  const args = {
    taskPath: '.workflow-task.json',
    reportPath: null,
    dryRun: false,
    verbose: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--task') args.taskPath = argv[++i] || args.taskPath;
    else if (arg === '--report') args.reportPath = argv[++i] || null;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--verbose') args.verbose = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readTask(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Task file not found: ${resolved}`);
  }
  const task = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const asArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
  return {
    resolvedPath: resolved,
    name: task.name || path.basename(resolved),
    workdir: path.resolve(task.workdir || process.cwd()),
    maxLoops: Number.isFinite(task.maxLoops) ? Math.max(1, task.maxLoops) : 3,
    preflight: asArray(task.preflight),
    implement: asArray(task.implement),
    test: asArray(task.test),
    autofix: asArray(task.autofix),
    env: task.env && typeof task.env === 'object' ? task.env : {},
    stopOnPreflightFailure: task.stopOnPreflightFailure !== false,
    reportFile: task.reportFile || null,
  };
}

function runCommand(command, cwd, extraEnv, verbose) {
  const startedAt = nowIso();
  const startedHr = process.hrtime.bigint();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
  const durationMs = Number(process.hrtime.bigint() - startedHr) / 1e6;
  const record = {
    command,
    cwd,
    startedAt,
    finishedAt: nowIso(),
    durationMs: Math.round(durationMs),
    exitCode: typeof result.status === 'number' ? result.status : 1,
    ok: result.status === 0,
    stdout: truncate(result.stdout || ''),
    stderr: truncate(result.stderr || ''),
  };
  if (verbose) {
    console.log(`$ ${command}`);
    console.log(`  exit=${record.exitCode} duration=${record.durationMs}ms`);
  }
  return record;
}

function runPhase(phase, commands, context) {
  const rows = [];
  for (const command of commands) {
    if (context.dryRun) {
      rows.push({
        command,
        cwd: context.task.workdir,
        startedAt: nowIso(),
        finishedAt: nowIso(),
        durationMs: 0,
        exitCode: 0,
        ok: true,
        stdout: '[dry-run]',
        stderr: '',
      });
      continue;
    }
    const row = runCommand(command, context.task.workdir, context.task.env, context.verbose);
    rows.push(row);
    if (!row.ok) {
      return { phase, ok: false, rows };
    }
  }
  return { phase, ok: true, rows };
}

function writeReport(reportPath, report) {
  const fullPath = path.resolve(reportPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(report, null, 2), 'utf8');
  return fullPath;
}

function summarize(report) {
  const lines = [];
  lines.push(`task: ${report.task.name}`);
  lines.push(`status: ${report.status}`);
  lines.push(`loops: ${report.loopsCompleted}/${report.task.maxLoops}`);
  lines.push(`workdir: ${report.task.workdir}`);
  const totalCmds = report.phases.reduce((sum, phase) => sum + phase.rows.length, 0);
  lines.push(`commands: ${totalCmds}`);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  const task = readTask(args.taskPath);
  const reportPath = args.reportPath || task.reportFile || path.join('reports', 'workflow-last.json');
  const context = { task, dryRun: args.dryRun, verbose: args.verbose };
  const report = {
    startedAt: nowIso(),
    finishedAt: null,
    status: 'failed',
    loopsCompleted: 0,
    task: {
      name: task.name,
      workdir: task.workdir,
      maxLoops: task.maxLoops,
      source: task.resolvedPath,
    },
    phases: [],
  };

  const preflight = runPhase('preflight', task.preflight, context);
  report.phases.push(preflight);
  if (!preflight.ok && task.stopOnPreflightFailure) {
    report.status = 'failed-preflight';
    report.finishedAt = nowIso();
    const out = writeReport(reportPath, report);
    console.error(summarize(report));
    console.error(`report: ${out}`);
    process.exit(1);
  }

  const implement = runPhase('implement', task.implement, context);
  report.phases.push(implement);
  if (!implement.ok) {
    report.status = 'failed-implement';
    report.finishedAt = nowIso();
    const out = writeReport(reportPath, report);
    console.error(summarize(report));
    console.error(`report: ${out}`);
    process.exit(1);
  }

  for (let i = 1; i <= task.maxLoops; i += 1) {
    const testPhase = runPhase(`test#${i}`, task.test, context);
    report.phases.push(testPhase);
    report.loopsCompleted = i;
    if (testPhase.ok) {
      report.status = 'passed';
      break;
    }
    if (task.autofix.length === 0) {
      report.status = 'failed-tests';
      break;
    }

    const autofixPhase = runPhase(`autofix#${i}`, task.autofix, context);
    report.phases.push(autofixPhase);
    if (!autofixPhase.ok) {
      report.status = 'failed-autofix';
      break;
    }
  }

  if (report.status === 'failed') {
    report.status = report.loopsCompleted >= task.maxLoops ? 'failed-max-loops' : 'failed';
  }
  report.finishedAt = nowIso();
  const fullReportPath = writeReport(reportPath, report);
  console.log(summarize(report));
  console.log(`report: ${fullReportPath}`);
  if (report.status !== 'passed') {
    process.exit(1);
  }
}

main();
