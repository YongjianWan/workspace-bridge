/**
 * Security audit tool — aggregate external scanner findings.
 */
const path = require('path');
const fs = require('fs');
const { getAvailableAdapters } = require('../adapters');
const { normalizePathKey } = require('../utils/path');
const { sanitizeForAiOutput, stripBOM } = require('../utils/sanitize');

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

/**
 * Allowlist dispatch table — each entry is an independent predicate.
 * New rules can add their own allowlist entries without touching the core scan loop.
 */
const DEFAULT_RULES = [
  { lang: 'javascript', ext: /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte)$/, rules: [
    { id: 'js-eval', pattern: /\beval\s*\(/, severity: 'high', message: 'Use of eval() can lead to code injection' },
    { id: 'js-innerHTML', pattern: /\.innerHTML\s*=/, severity: 'medium', message: 'Assignment to innerHTML can lead to XSS' },
    { id: 'js-document-write', pattern: /\bdocument\.write\s*\(/, severity: 'medium', message: 'document.write() is unsafe and blocks rendering' },
    { id: 'js-new-function', pattern: /\bnew\s+Function\s*\(/, severity: 'high', message: 'new Function() is equivalent to eval()' },
    { id: 'js-dangerous-timeout', pattern: /\bsetTimeout\s*\(\s*['"`]/, severity: 'medium', message: 'setTimeout with string argument is like eval()' },
    { id: 'js-dangerous-interval', pattern: /\bsetInterval\s*\(\s*['"`]/, severity: 'medium', message: 'setInterval with string argument is like eval()' },
    { id: 'js-hardcoded-secret', pattern: /(?:password|secret|token|api_key|apikey|access_key|private_key)\s*[:=]\s*['"][^'"]{8,}['"]/i, severity: 'medium', message: 'Possible hardcoded secret — verify if placeholder or test value' },
    { id: 'js-log-sensitive', pattern: /console\.(log|warn|error|info)\s*\([^)]*(?:password|secret|token|credential)/i, severity: 'low', message: 'Potential sensitive data in log statement' },
  ]},
  { lang: 'python', ext: /\.py$/, rules: [
    { id: 'py-exec', pattern: /\bexec\s*\(/, severity: 'high', message: 'exec() can execute arbitrary code' },
    { id: 'py-eval', pattern: /\beval\s*\(/, severity: 'high', message: 'eval() can execute arbitrary code' },
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
  ]}
];

const DEFAULT_ALLOWLIST = [
  {
    id: 'assert-defense',
    ruleIdContains: ['eval', 'exec', 'innerHTML', 'new-function', 'dangerous'],
    pattern: /\bexpect\b.*\btoThrow\b|\bexpect\b.*\bto\.throw\b|\bexpect\b.*\brejects\b|\bassert\.throws?\b|\bassert\.rejects?\b|\.unwrap_err\s*\(/i
  },
  {
    id: 'test-placeholder-secrets',
    ruleIdContains: ['hardcoded-secret'],
    filePathPattern: /[\\/](test|spec|__tests__)[\\/]/i,
    pattern: /(?:\b|_)(test|dummy|placeholder|example|mock|fake)(?:\b|_)/i
  }
];

function loadAndCompileRules(cwd, configFile = null) {
  let loadedConfig = null;
  let isCustom = false;

  if (configFile && typeof configFile === 'string') {
    const resolvedPath = path.resolve(cwd, configFile);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Security rules config not found: ${resolvedPath}`);
    }
    isCustom = true;
    try {
      const fileContent = fs.readFileSync(resolvedPath, 'utf8');
      loadedConfig = JSON.parse(stripBOM(fileContent));
    } catch (err) {
      throw new Error(`Failed to parse custom security rules config: ${err.message}`);
    }
  }

  if (!loadedConfig) {
    const defaultPath = path.join(__dirname, '..', 'config', 'security-rules.json');
    if (fs.existsSync(defaultPath)) {
      try {
        const fileContent = fs.readFileSync(defaultPath, 'utf8');
        loadedConfig = JSON.parse(stripBOM(fileContent));
      } catch (err) {
        // Fallback silently to hardcoded defaults
      }
    }
  }

  if (loadedConfig) {
    try {
      const patterns = (loadedConfig.rules || []).map((group) => {
        return {
          lang: group.lang,
          ext: new RegExp(group.ext),
          rules: (group.rules || []).map((rule) => {
            return {
              id: rule.id,
              pattern: new RegExp(rule.pattern, rule.flags || ''),
              severity: rule.severity,
              message: rule.message,
            };
          }),
        };
      });

      const allowlist = (loadedConfig.allowlist || []).map((item) => {
        return {
          id: item.id,
          ruleIdContains: item.ruleIdContains || [],
          filePathPattern: item.filePathPattern ? new RegExp(item.filePathPattern, 'i') : null,
          pattern: new RegExp(item.pattern, 'i'),
        };
      });

      return { patterns, allowlist };
    } catch (err) {
      if (isCustom) {
        throw new Error(`Config regex compilation failed: ${err.message}`);
      }
      console.error(`[Security Scan] Default config regex compilation failed: ${err.message}. Falling back to default rules.`);
    }
  }

  return { patterns: DEFAULT_RULES, allowlist: DEFAULT_ALLOWLIST };
}

function isMatchAllowlisted(ruleId, filePath, line, compiledAllowlist) {
  const list = compiledAllowlist || DEFAULT_ALLOWLIST;
  return list.some((item) => {
    if (item.ruleIdContains && item.ruleIdContains.length > 0) {
      if (!item.ruleIdContains.some((k) => ruleId.includes(k))) return false;
    }
    if (item.filePathPattern) {
      const regex = typeof item.filePathPattern === 'string' ? new RegExp(item.filePathPattern, 'i') : item.filePathPattern;
      if (!regex.test(filePath)) return false;
    }
    const lineRegex = typeof item.pattern === 'string' ? new RegExp(item.pattern, 'i') : item.pattern;
    return lineRegex.test(line);
  });
}

const TEST_PATH_PATTERNS = [
  '/test/', 'test/', '/tests/', 'tests/',
  '/__tests__/', '__tests__/', '/benchmark/', 'benchmark/',
  '/benchmarks/', 'benchmarks/', '/e2e/', 'e2e/',
  '/mocks/', 'mocks/', '/mock/', 'mock/',
  '/__mocks__/', '__mocks__/',
];

function isTestPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return (
    TEST_PATH_PATTERNS.some((p) => normalized.includes(p) || normalized.startsWith(p)) ||
    /\.test\.[^/]+$/.test(normalized) ||
    /\.spec\.[^/]+$/.test(normalized) ||
    /^[\\/]test_/.test(path.basename(normalized)) ||
    /_test\.[^/]+$/.test(normalized)
  );
}

async function runBuiltinSecurityScan(cwd, targets, container, options = {}) {
  const { language, config } = options;
  const findings = [];
  const { patterns, allowlist } = loadAndCompileRules(cwd, config);
  let activePatterns = patterns;

  if (language) {
    const targetLang = language.toLowerCase();
    activePatterns = activePatterns.filter((p) => p.lang === targetLang);
  }

  const depGraph = container?.snapshot?.graph || container?.depGraph;
  let files = [];
  const hasExplicitTargets = targets.length > 0;
  if (depGraph?.getAllFilePaths) {
    files = depGraph.getAllFilePaths();
    if (hasExplicitTargets) {
      const targetPaths = targets.map((t) => normalizePathKey(path.resolve(cwd, t)));
      const targetSet = new Set();
      const graphPaths = new Set(files);
      for (const tp of targetPaths) {
        const isDir = files.some((f) => f.startsWith(tp + '/'));
        if (isDir) {
          for (const f of files) {
            if (f.startsWith(tp + '/')) targetSet.add(f);
          }
        } else {
          targetSet.add(tp);
          if (!graphPaths.has(tp) && fs.existsSync(tp)) {
            files.push(tp);
          }
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
    const isTest = container?.projectContext
      ? container.projectContext.classifyFile(file).fileRole === 'test'
      : isTestPath(file);
    if (isTest) continue;

    const group = activePatterns.find((g) => g.ext.test(file));
    if (!group) continue;
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch { continue; }
    const lines = content.split(/\r?\n/);
    const ignorePattern = /\/\/\s*security-scan-ignore\b|\/\*\s*security-scan-ignore\b/;
    for (let i = 0; i < lines.length; i++) {
      for (const rule of group.rules) {
        if (rule.pattern.test(lines[i]) && !ignorePattern.test(lines[i]) && !isMatchAllowlisted(rule.id, file, lines[i], allowlist)) {
          const match = lines[i].match(rule.pattern);
          let matchedText = match ? match[0] : null;
          if (matchedText) {
            matchedText = sanitizeForAiOutput(matchedText, 120);
          }
          findings.push({
            ruleId: rule.id,
            rule: rule.id,
            message: rule.message,
            severity: rule.severity,
            category: 'security',
            file: depGraph?._displayPath?.(file) || file,
            lineStart: i + 1,
            lineEnd: i + 1,
            tool: 'builtin',
            matchedText,
          });
        }
      }
    }
  }

  return { findings, summary: { total: findings.length, scanned: files.length, config: config || 'builtin', error: null } };
}

const { loadWorkspaceConfig } = require('../utils/project-context');
const crypto = require('crypto');

function computeFindingId(f) {
  const file = String(f.file || '').replace(/\\/g, '/');
  const key = `${f.tool || 'builtin'}:${f.ruleId || 'unknown'}:${file}:${f.lineStart || 0}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

async function auditSecurity({ cwd, targets, config, language, builtinOnly }, container) {
  const targetList = Array.isArray(targets) ? targets : [];
  const adapters = await getAvailableAdapters(cwd);

  const effectiveTargets = targetList.length > 0 ? targetList : ['.'];

  const wsConfig = loadWorkspaceConfig(cwd) || {};
  const ignoredFindings = new Set(wsConfig.ignore?.findings || []);

  const isLocalConfigFile = config && typeof config === 'string' && fs.existsSync(path.resolve(cwd, config));

  if (builtinOnly || adapters.length === 0 || isLocalConfigFile) {
    const builtin = await runBuiltinSecurityScan(cwd, targetList, container, { language, config });
    const findingsWithId = builtin.findings.map((f) => {
      const id = computeFindingId(f);
      return { id, ...f };
    });
    const filtered = findingsWithId.filter((f) => !ignoredFindings.has(f.id));
    const bySeverity = groupBySeverity(filtered);
    return {
      ok: true,
      adapters: ['builtin'],
      findings: filtered,
      scanMeta: [{ name: 'builtin', summary: { ...builtin.summary, total: filtered.length } }],
      summary: {
        total: filtered.length,
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
  const findingsWithId = deduped.map((f) => {
    const id = computeFindingId(f);
    return { id, ...f, category: f.category || 'security' };
  });
  const filtered = findingsWithId.filter((f) => !ignoredFindings.has(f.id));
  const bySeverity = groupBySeverity(filtered);

  return {
    ok: true,
    adapters: adapters.map((a) => a.name),
    findings: filtered,
    scanMeta,
    summary: {
      total: filtered.length,
      bySeverity,
      message: null,
    },
  };
}

module.exports = { auditSecurity, groupBySeverity, dedupeWithinTool, computeFindingId };
