/**
 * Diagnostic parsing utilities
 */
const path = require('path');

function normalizeSeverity(value) {
  const source = String(value || '').toLowerCase();
  if (source.includes('error') || source === 'e') return 'error';
  if (source.includes('warn') || source === 'w' || source === 'warning') return 'warning';
  if (source.includes('info') || source === 'i') return 'information';
  if (source.includes('hint')) return 'hint';
  return 'error';
}

function resolveDiagnosticPath(rawPath, cwd) {
  if (!rawPath) return null;
  const cleaned = rawPath.replace(/^\.\//, '').replace(/^\.\\/, '').trim();
  if (!cleaned) return null;
  return path.isAbsolute(cleaned) ? cleaned : path.resolve(cwd, cleaned);
}

const DIAGNOSTIC_PATTERNS = [
  // pyright: file:line:col - error: message (code)
  /^(?<file>.+?):(?<line>\d+):(?<col>\d+)\s*-\s*(?<sev>error|warning|information|hint):\s*(?<msg>.+?)(?:\s*\((?<code>[^)]+)\))?$/i,
  // ruff/tsc/eslint common: file:line:col: message
  /^(?<file>.+?):(?<line>\d+):(?<col>\d+):\s*(?<msg>.+)$/,
  // compile/pytest fallback: file:line: message
  /^(?<file>.+?):(?<line>\d+):\s*(?<msg>.+)$/,
];

function parseLineWithPatterns(line, cwd, source) {
  for (const pattern of DIAGNOSTIC_PATTERNS) {
    const match = line.match(pattern);
    if (!match || !match.groups) continue;

    const file = resolveDiagnosticPath(match.groups.file, cwd);
    if (!file) continue;

    const text = String(match.groups.msg || '').trim();
    if (!text) continue;

    let severity = match.groups.sev ? normalizeSeverity(match.groups.sev) : null;
    let code = match.groups.code ? String(match.groups.code).trim() : null;

    if (!severity) {
      const prefix = text.match(/^(error|warning|info|hint)\b[:\s-]*/i);
      if (prefix) severity = normalizeSeverity(prefix[1]);
    }
    if (!severity) {
      severity = text.toLowerCase().includes('warning') ? 'warning' : 'error';
    }
    if (!code) {
      const codeMatch = text.match(/\b([A-Z]{1,6}\d{2,5}|F\d{3}|E\d{3}|W\d{3}|TS\d{3,5})\b/);
      if (codeMatch) code = codeMatch[1];
    }

    return {
      file,
      line: Number(match.groups.line),
      column: match.groups.col ? Number(match.groups.col) : 1,
      severity,
      source,
      code,
      message: text,
      raw: line,
    };
  }
  return null;
}

function parseDiagnosticsFromText(text, cwd, source) {
  if (!text) return [];
  const diagnostics = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = parseLineWithPatterns(trimmed, cwd, source);
    if (parsed) diagnostics.push(parsed);
  }
  return diagnostics;
}

function uniqueDiagnostics(diagnostics) {
  const seen = new Set();
  const result = [];

  for (const item of diagnostics) {
    const key = [item.file, item.line, item.column, item.severity, item.code || '', item.message].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function summarizeDiagnostics(diagnostics) {
  const summary = { total: diagnostics.length, error: 0, warning: 0, information: 0, hint: 0 };
  for (const item of diagnostics) {
    if (item.severity === 'warning') summary.warning += 1;
    else if (item.severity === 'information') summary.information += 1;
    else if (item.severity === 'hint') summary.hint += 1;
    else summary.error += 1;
  }
  return summary;
}

module.exports = {
  normalizeSeverity,
  resolveDiagnosticPath,
  parseLineWithPatterns,
  parseDiagnosticsFromText,
  uniqueDiagnostics,
  summarizeDiagnostics,
};
