/**
 * CLI exit codes — the part of the contract CI scripts actually branch on.
 *
 * OK / FINDINGS is the ordinary verdict axis: the run completed and either
 * found nothing or found something. GATE_REFUSED is a different axis entirely
 * — no verdict was produced, because the data a gate was asked to judge could
 * not support a verdict (replayed snapshot, see L2-15). Collapsing it onto
 * FINDINGS would tell CI "your code has problems" when the truth is "re-run
 * me"; those call for opposite responses, so they get different codes.
 */
const EXIT_CODES = {
  OK: 0,
  FINDINGS: 1,
  GATE_REFUSED: 2,
};

module.exports = EXIT_CODES;
