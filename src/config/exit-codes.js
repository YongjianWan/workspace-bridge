/**
 * CLI exit codes — the part of the contract CI scripts actually branch on.
 *
 * OK / FINDINGS is the verdict axis: the run completed and either found
 * nothing or found something. CLI_ERROR (2) is every non-config,
 * non-validation runtime failure, including unknown commands; several tests
 * lock that value, so it is not free for reuse.
 *
 * There is deliberately no "gate refused" code. Gates used to refuse to run on
 * replayed snapshot data, but the real defect was the freshness check being
 * too coarse to notice in-place edits (L2-15). Once isSnapshotFresh consults
 * cache.checkFileChanges(), a replay only survives on an unchanged tree, so
 * there is nothing left for a gate to refuse.
 */
const EXIT_CODES = {
  OK: 0,
  FINDINGS: 1,
  CLI_ERROR: 2,
};

module.exports = EXIT_CODES;
