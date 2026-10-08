/**
 * `usage-log mark` — annotate one line of the local usage log with the run's
 * outcome. The log path is an arbitrary WB_USAGE_LOG location outside the
 * workspace, so --file skips workspace containment checks (see validate-args).
 */
const { typedError } = require('../../utils/failure');
const { markLine, USAGE_MARKERS } = require('../../utils/usage-log');

async function usageLogCmd(parsed, _container) {
  const sub = parsed.targets?.[0];
  if (sub !== 'mark') {
    throw typedError('validation_error', `Unknown usage-log subcommand: ${sub ?? '(missing)'}. Expected: mark`);
  }
  if (!parsed.file) {
    throw typedError('validation_error', 'usage-log mark requires --file <path>');
  }
  if (!Number.isInteger(parsed.line) || parsed.line < 1) {
    throw typedError('validation_error', 'usage-log mark requires --line <n> (1-based line number)');
  }
  if (!parsed.marker) {
    throw typedError('validation_error', `usage-log mark requires --marker <${USAGE_MARKERS.join('|')}>`);
  }

  const note = parsed.note ?? null;
  markLine(parsed.file, parsed.line, parsed.marker, note);
  return { ok: true, line: parsed.line, marker: parsed.marker, note };
}

module.exports = usageLogCmd;
