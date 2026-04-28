#!/usr/bin/env node
/**
 * 官方自审脚本入口
 * 解决 W2T1 (JSON 消费链路稳定性) + W2T2 (一键自审)
 * 使用 spawnSync 安全消费 CLI JSON，避免 PowerShell 管道二次处理问题
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'cli.js');

function runCLI(args) {
  const result = spawnSync('node', [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    return { ok: false, error: result.error.message, stdout: result.stdout, stderr: result.stderr };
  }
  if (result.status !== 0) {
    return { ok: false, error: `exit code ${result.status}`, stdout: result.stdout, stderr: result.stderr };
  }
  try {
    const json = JSON.parse(result.stdout);
    return { ok: true, json };
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${e.message}`, stdout: result.stdout.slice(0, 500), stderr: result.stderr };
  }
}

function runTests() {
  const result = spawnSync('npm', ['run', 'test:all'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: true,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function checkTempPollution() {
  const files = fs.readdirSync(REPO_ROOT);
  const pollution = files.filter((f) =>
    f.startsWith('.tmp-') || f.includes('.workspace-bridge-cache.json.tmp-')
  );
  return pollution;
}

function main() {
  const start = Date.now();
  console.log('workspace-bridge 自审启动...');
  console.log(`repo: ${REPO_ROOT}`);

  const pollution = checkTempPollution();
  if (pollution.length > 0) {
    console.log(`\n⚠️ 临时文件污染 detected: ${pollution.join(', ')}`);
    console.log('建议：清理工作区后重新运行。');
    process.exit(1);
  }

  // 1. audit-summary
  printSection('结构健康度');
  const summary = runCLI(['audit-summary', '--cwd', '.', '--json', '--quiet']);
  if (!summary.ok) {
    console.log(`❌ audit-summary 失败: ${summary.error}`);
    console.log(`stderr: ${summary.stderr?.slice(0, 200) || 'N/A'}`);
  } else {
    const s = summary.json.summary || {};
    const scope = summary.json.scope || {};
    console.log(`severity: ${s.severity || 'unknown'}`);
    console.log(`total files: ${scope.counts?.totalFiles || 'N/A'}`);
    console.log(`dead exports: ${s.counts?.deadExportCount ?? 'N/A'}`);
    console.log(`unresolved: ${s.counts?.unresolvedCount ?? 'N/A'}`);
    console.log(`cycles: ${s.counts?.cycleCount ?? 'N/A'}`);
    if (s.nextSteps?.length) {
      console.log(`next steps: ${s.nextSteps.join('; ')}`);
    }
  }

  // 2. audit-diff (if git workspace)
  printSection('当前改动');
  const diff = runCLI(['audit-diff', '--cwd', '.', '--json', '--quiet']);
  if (!diff.ok) {
    console.log(`⚠️ audit-diff 失败: ${diff.error}`);
  } else {
    const files = diff.json.changedFiles || [];
    const advice = diff.json.validationAdvice || {};
    console.log(`changed files: ${files.length}`);
    if (files.length > 0) {
      console.log(`change type: ${advice.changeType || 'N/A'}`);
      const topRisks = diff.json.summary?.topCompositeRisks || [];
      if (topRisks.length > 0) {
        console.log(`top risk: ${topRisks[0].file} (${topRisks[0].level})`);
      }
      const cmds = advice.commands || {};
      if (cmds.smoke?.length) console.log(`smoke: ${cmds.smoke[0].cmd}`);
      if (cmds.focused?.length) console.log(`focused: ${cmds.focused[0].cmd}`);
      if (cmds.full?.length) console.log(`full: ${cmds.full[0].cmd}`);
    } else {
      console.log('无未提交改动');
    }
  }

  // 3. regression tests
  printSection('回归测试');
  const tests = runTests();
  if (tests.ok) {
    console.log('✅ 全绿');
  } else {
    console.log(`❌ 失败 (exit ${tests.status})`);
    // Show last few lines of stderr
    const lastErr = tests.stderr?.split('\n').filter(Boolean).slice(-5).join('\n');
    if (lastErr) console.log(`stderr tail:\n${lastErr}`);
  }

  // 4. conclusion
  printSection('结论');
  const duration = ((Date.now() - start) / 1000).toFixed(1);
  const allOk = summary.ok && diff.ok && tests.ok;
  if (allOk) {
    console.log(`✅ 自审通过 (${duration}s)`);
    console.log('建议：如无异常可直接提交；如有改动请优先跑 audit-diff 验证。');
    process.exit(0);
  } else {
    console.log(`❌ 自审未通过 (${duration}s)`);
    console.log('建议：修复上述问题后重新运行。');
    process.exit(1);
  }
}

main();
