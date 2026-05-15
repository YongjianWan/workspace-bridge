/**
 * Security audit tool — aggregate external scanner findings.
 */
const path = require('path');
const fs = require('fs');
const { getAvailableAdapters } = require('../adapters');
const { normalizePathKey } = require('../utils/path');

function groupBySeverity(findings) {
  const map = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const f of findings) {
    const key = map[f.severity] !== undefined ? f.severity : 'unknown';
    map[key]++;
  }
  return map;
}

/**
 * Drop exact-match duplicates within the same tool's results.
 * Cross-tool findings at the same location are intentionally kept —
 * multiple scanners flagging the same line is a confirmation signal,
 * not noise.
 */
function dedupeWithinTool(findings) {
  const seen = new Set();
  const out = [];
  for (const f of findings) {
    const key = `${f.tool}|${f.ruleId}|${f.file}|${f.lineStart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

async function runBuiltinSecurityScan(cwd, targets, container) {
  const findings = [];
  const patterns = [
    { lang: 'javascript', ext: /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte)$/, rules: [
      { id: 'js-eval', pattern: /\beval\s*\(/, severity: 'high', message: 'Use of eval() can lead to code injection' }, // security-scan-ignore
      { id: 'js-innerHTML', pattern: /\.innerHTML\s*=/, severity: 'medium', message: 'Assignment to innerHTML can lead to XSS' },
      { id: 'js-document-write', pattern: /\bdocument\.write\s*\(/, severity: 'medium', message: 'document.write() is unsafe and blocks rendering' }, // security-scan-ignore
      { id: 'js-new-function', pattern: /\bnew\s+Function\s*\(/, severity: 'high', message: 'new Function() is equivalent to eval()' }, // security-scan-ignore
      { id: 'js-dangerous-timeout', pattern: /\bsetTimeout\s*\(\s*['"`]/, severity: 'medium', message: 'setTimeout with string argument is like eval()' }, // security-scan-ignore
      { id: 'js-dangerous-interval', pattern: /\bsetInterval\s*\(\s*['"`]/, severity: 'medium', message: 'setInterval with string argument is like eval()' }, // security-scan-ignore
      { id: 'js-hardcoded-secret', pattern: /(?:password|secret|token|api_key|apikey|access_key|private_key)\s*[:=]\s*['"][^'"]{8,}['"]/i, severity: 'medium', message: 'Possible hardcoded secret — verify if placeholder or test value' },
      { id: 'js-log-sensitive', pattern: /console\.(log|warn|error|info)\s*\([^)]*(?:password|secret|token|credential)/i, severity: 'low', message: 'Potential sensitive data in log statement' },
    ]},
    { lang: 'python', ext: /\.py$/, rules: [
      { id: 'py-exec', pattern: /\bexec\s*\(/, severity: 'high', message: 'exec() can execute arbitrary code' }, // security-scan-ignore
      { id: 'py-eval', pattern: /\beval\s*\(/, severity: 'high', message: 'eval() can execute arbitrary code' }, // security-scan-ignore
      { id: 'py-shell-true', pattern: /subprocess\.\w+\(.*shell\s*=\s*True/, severity: 'high', message: 'subprocess with shell=True is vulnerable to shell injection' },
      { id: 'py-os-system', pattern: /\bos\.system\s*\(/, severity: 'medium', message: 'os.system() is vulnerable to shell injection' },
      { id: 'py-hardcoded-secret', pattern: /(?:password|secret|token|api_key|apikey|access_key|private_key)\s*=\s*['"][^'"]{8,}['"]/i, severity: 'medium', message: 'Possible hardcoded secret — verify if placeholder or test value' },
      { id: 'py-log-sensitive', pattern: /(?:print|logger\.(?:debug|info|warning|error))\s*\([^)]*(?:password|secret|token|credential)/i, severity: 'low', message: 'Potential sensitive data in log statement' },
    ]},
    { lang: 'java', ext: /\.java$/, rules: [
      { id: 'java-runtime-exec', pattern: /Runtime\.getRuntime\(\)\.exec\s*\(/, severity: 'medium', message: 'Runtime.exec() can be vulnerable to command injection' },
      { id: 'java-process-builder', pattern: /new\s+ProcessBuilder\s*\(/, severity: 'low', message: 'Review ProcessBuilder for command injection risks' },
      { id: 'java-file-upload', pattern: /MultipartFile|\.getOriginalFilename\s*\(\)|\.transferTo\s*\(/, severity: 'low', message: 'File upload detected — verify path traversal protection' },
      { id: 'java-hardcoded-secret', pattern: /(?:password|secret|token|apiKey|accessKey|privateKey)\s*[=:]\s*["'][^"']{8,}["']/i, severity: 'medium', message: 'Possible hardcoded secret — verify if placeholder or test value' },
      { id: 'java-log-sensitive', pattern: /(?:System\.out\.print|log\.(?:debug|info|warn|error))\s*\([^)]*(?:password|secret|token|credential)/i, severity: 'low', message: 'Potential sensitive data in log statement' },
    ]},
  ];

  let files = [];
  const hasExplicitTargets = targets.length > 0;
  if (container?.depGraph?.graph) {
    files = Array.from(container.depGraph.graph.keys());
    if (hasExplicitTargets) {
      const targetPaths = targets.map((t) => normalizePathKey(path.resolve(cwd, t)));
      const targetSet = new Set();
      for (const tp of targetPaths) {
        const isDir = files.some((f) => f.startsWith(tp + '/'));
        if (isDir) {
          for (const f of files) {
            if (f.startsWith(tp + '/')) targetSet.add(f);
          }
        } else {
          targetSet.add(tp);
        }
      }
      files = files.filter((f) => targetSet.has(f));
    }
  } else {
    const walk = (dir) => {
      const entries = [];
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'build') {
              entries.push(...walk(full));
            }
          } else {
            entries.push(full);
          }
        }
      } catch { /* ignore */ }
      return entries;
    };
    const targetDirs = hasExplicitTargets ? targets : [cwd];
    for (const t of targetDirs) {
      const resolved = path.resolve(cwd, t);
      try {
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) files.push(...walk(resolved));
        else files.push(resolved);
      } catch { /* ignore */ }
    }
  }

  for (const file of files) {
    const group = patterns.find((g) => g.ext.test(file));
    if (!group) continue;
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch { continue; }
    const lines = content.split(/\r?\n/);
    const ignorePattern = /\/\/\s*security-scan-ignore\b|\/\*\s*security-scan-ignore\b/;
    for (let i = 0; i < lines.length; i++) {
      for (const rule of group.rules) {
        if (rule.pattern.test(lines[i]) && !ignorePattern.test(lines[i])) {
          const match = lines[i].match(rule.pattern);
          let matchedText = match ? match[0] : null;
          if (matchedText && matchedText.length > 120) {
            matchedText = matchedText.slice(0, 117) + '...';
          }
          findings.push({
            ruleId: rule.id,
            message: rule.message,
            severity: rule.severity,
            file: container?.depGraph?._displayPath?.(file) || file,
            lineStart: i + 1,
            lineEnd: i + 1,
            tool: 'builtin',
            matchedText,
          });
        }
      }
    }
  }

  return { findings, summary: { total: findings.length, scanned: files.length, config: 'builtin', error: null } };
}

async function auditSecurity({ cwd, targets, config, language, builtinOnly }, container) {
  const targetList = Array.isArray(targets) ? targets : [];
  const adapters = await getAvailableAdapters(cwd);

  // Default to scanning the workspace root when user gave no targets
  const effectiveTargets = targetList.length > 0 ? targetList : ['.'];

  if (builtinOnly || adapters.length === 0) {
    const builtin = await runBuiltinSecurityScan(cwd, targetList, container);
    const bySeverity = groupBySeverity(builtin.findings);
    return {
      ok: true,
      adapters: ['builtin'],
      findings: builtin.findings,
      scanMeta: [{ name: 'builtin', summary: builtin.summary }],
      summary: {
        total: builtin.findings.length,
        bySeverity,
        message: null,
      },
    };
  }

  const results = await Promise.all(
    adapters.map((adapter) => adapter.scan(effectiveTargets, { cwd, config, language }))
  );
  const scanMeta = adapters.map((a, i) => ({ name: a.name, summary: results[i].summary }));
  const allFindings = results.flatMap((r) => r.findings);

  const deduped = dedupeWithinTool(allFindings);
  const bySeverity = groupBySeverity(deduped);

  return {
    ok: true,
    adapters: adapters.map((a) => a.name),
    findings: deduped,
    scanMeta,
    summary: {
      total: deduped.length,
      bySeverity,
      message: null,
    },
  };
}

module.exports = { auditSecurity, groupBySeverity, dedupeWithinTool };
