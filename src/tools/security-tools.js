/**
 * Security audit tool — aggregate external scanner findings.
 */
const path = require('path');
const fs = require('fs');
const { getAvailableAdapters, getAllAdapters } = require('../adapters');
const { warningOf } = require('../services/ledger');
const { normalizePathKey } = require('../utils/path');
const { sanitizeForAiOutput, stripBOM } = require('../utils/sanitize');
// A rule group with this lang applies to every scanned file type it lists, whatever --language says.
const CROSS_LANGUAGE_GROUP = 'any';
const COVERAGE_NOTE = 'Pattern rules only (known provider key prefixes, private key headers, connection-string credentials, secret-like variable names). No findings does not mean no secrets.';
const SENSITIVE_RULE_ID = /secret|sensitive|credential|password|token|api[-_]?key|private[-_]?key/i;

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

// The bundled rule file is the only built-in rule source: if it cannot be loaded or compiled the
// scan must fail loudly, because a silent fallback would report "no findings" for a smaller rule set.
function loadAndCompileRules(cwd, configFile = null) {
  const isCustom = Boolean(configFile && typeof configFile === 'string');
  let rulesPath = path.join(__dirname, '..', 'config', 'security-rules.json');
  if (isCustom) {
    rulesPath = path.resolve(cwd, configFile);
    if (!fs.existsSync(rulesPath)) {
      throw new Error(`Security rules config not found: ${rulesPath}`);
    }
  }
  const label = isCustom ? 'custom security rules config' : 'bundled security rules';

  let loadedConfig;
  try {
    loadedConfig = JSON.parse(stripBOM(fs.readFileSync(rulesPath, 'utf8')));
  } catch (err) {
    throw new Error(`Failed to parse ${label}: ${err.message}`, { cause: err });
  }

  try {
    const patterns = (loadedConfig.rules || []).map((group) => ({
      lang: group.lang,
      ext: new RegExp(group.ext),
      rules: (group.rules || []).map((rule) => ({
        id: rule.id,
        pattern: new RegExp(rule.pattern, rule.flags || ''),
        severity: rule.severity,
        message: rule.message,
        sensitive: rule.sensitive,
      })),
    }));

    const allowlist = (loadedConfig.allowlist || []).map((item) => ({
      id: item.id,
      ruleIdContains: item.ruleIdContains || [],
      filePathPattern: item.filePathPattern ? new RegExp(item.filePathPattern, 'i') : null,
      pattern: new RegExp(item.pattern, 'i'),
    }));

    return { patterns, allowlist };
  } catch (err) {
    throw new Error(`Config regex compilation failed (${label}): ${err.message}`, { cause: err });
  }
}

function isMatchAllowlisted(ruleId, filePath, line, list) {
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
    activePatterns = activePatterns.filter((p) => p.lang === targetLang || p.lang === CROSS_LANGUAGE_GROUP);
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

    const rules = activePatterns.filter((g) => g.ext.test(file)).flatMap((g) => g.rules);
    if (rules.length === 0) continue;
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch { continue; }
    const lines = content.split(/\r?\n/);
    const ignorePattern = /\/\/\s*security-scan-ignore\b|\/\*\s*security-scan-ignore\b/;
    for (let i = 0; i < lines.length; i++) {
      for (const rule of rules) {
        if (rule.pattern.test(lines[i]) && !ignorePattern.test(lines[i]) && !isMatchAllowlisted(rule.id, file, lines[i], allowlist)) {
          const match = lines[i].match(rule.pattern);
          let matchedText = match ? match[0] : null;
          if (matchedText) {
            matchedText = rule.sensitive === true || SENSITIVE_RULE_ID.test(rule.id)
              ? '[REDACTED]'
              : sanitizeForAiOutput(matchedText, 120);
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

  const coverage = {
    ruleIds: activePatterns.flatMap((g) => g.rules.map((r) => r.id)),
    note: COVERAGE_NOTE,
  };
  return { findings, summary: { total: findings.length, scanned: files.length, config: config || 'builtin', error: null, coverage } };
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
    // Only the built-in rules ran. If that is because an external tool is missing (not because
    // the caller asked for --builtin-only or a local rule file), say which one.
    const warnings = builtinOnly || isLocalConfigFile
      ? []
      : getAllAdapters().map((adapter) => warningOf('external-tool-unavailable', {
        tool: adapter.name,
        message: `${adapter.name} was not found on PATH; only the built-in rules ran, so "no findings" covers fewer checks`,
      }));
    return {
      ok: true,
      adapters: ['builtin'],
      warnings,
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
    const ruleId = f.ruleId || 'unknown';
    return {
      id,
      ...f,
      ruleId,
      rule: f.rule || ruleId,
      category: f.category || 'security',
    };
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
