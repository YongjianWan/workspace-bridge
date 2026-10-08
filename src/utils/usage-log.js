/**
 * Local usage log (ROADMAP T2.0): one JSON line per CLI run when the caller
 * points WB_USAGE_LOG at a file. This module is pure mechanics — it never
 * reads the environment and never decides when a run is logged; the CLI entry
 * owns that. Log lines carry a workspace path hash, never the path itself.
 */
const crypto = require('crypto');
const fs = require('fs');

const { typedError } = require('./failure');

// helped=帮上了, missed=漏了, noisy=噪声多, unused=没用上
const USAGE_MARKERS = Object.freeze(['helped', 'missed', 'noisy', 'unused']);

// Count fields by priority (L2: table, not an if-else chain). `routesCount` is
// what affected-routes actually returns; `affectedRoutesCount` is kept first so
// a result carrying the documented name wins if both ever appear.
const OUTPUT_COUNT_FIELDS = Object.freeze([
  'impactCount',
  'affectedTestsCount',
  'affectedRoutesCount',
  'routesCount',
]);

function hashWorkspace(rootPath) {
  return crypto.createHash('sha256').update(String(rootPath)).digest('hex');
}

function countOutputFiles(result) {
  if (!result || typeof result !== 'object') return 0;
  for (const field of OUTPUT_COUNT_FIELDS) {
    if (Number.isFinite(result[field])) return result[field];
  }
  if (Array.isArray(result.files)) return result.files.length;
  return 0;
}

/** Append one JSON line (object is stringified; a string is used as-is). */
function appendUsageLine(file, line) {
  const text = typeof line === 'string' ? line : JSON.stringify(line);
  fs.appendFileSync(file, text + '\n');
}

/**
 * Rewrite line `lineNo` (1-based) of a JSON-lines log in place: parse it, add
 * `marker` and `note`, write it back. Every other line keeps its exact bytes.
 * Argument problems throw typedError('validation_error') so the CLI reports
 * them as parameter errors; unexpected fs failures propagate untouched.
 */
function markLine(file, lineNo, marker, note) {
  if (!USAGE_MARKERS.includes(marker)) {
    throw typedError('validation_error', `Invalid marker: ${marker}. Expected ${USAGE_MARKERS.join('|')}`);
  }
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw typedError('validation_error', `Usage log not found: ${file}`);
    }
    throw err;
  }

  const lines = raw.split('\n');
  const endsWithNewline = lines[lines.length - 1] === '';
  if (endsWithNewline) lines.pop();

  if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > lines.length) {
    throw typedError('validation_error', `Line number out of range: ${lineNo}. Log has ${lines.length} line(s)`);
  }

  const idx = lineNo - 1;
  const original = lines[idx];
  const hasCR = original.endsWith('\r');
  let entry;
  try {
    entry = JSON.parse(hasCR ? original.slice(0, -1) : original);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('not a JSON object');
    }
  } catch {
    throw typedError('validation_error', `Line ${lineNo} is not valid JSON`);
  }

  entry.marker = marker;
  entry.note = note === undefined || note === null ? null : String(note);
  lines[idx] = JSON.stringify(entry) + (hasCR ? '\r' : '');
  fs.writeFileSync(file, lines.join('\n') + (endsWithNewline ? '\n' : ''), 'utf8');
  return entry;
}

module.exports = {
  USAGE_MARKERS,
  OUTPUT_COUNT_FIELDS,
  hashWorkspace,
  countOutputFiles,
  appendUsageLine,
  markLine,
};
