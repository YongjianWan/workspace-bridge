/**
 * CLI exit codes — the part of the contract CI scripts actually branch on.
 *
 * OK / FINDINGS is the verdict axis: the run completed and either found
 * nothing or found something. FINDINGS is also what config and validation
 * errors exit with — same value the CLI has always returned for them, so the
 * name is narrower than its uses; read it as "1", not as "findings were
 * found". CLI_ERROR (2) is every other runtime failure, including unknown
 * commands; several tests lock that value, so it is not free for reuse.
 *
 * There is deliberately no "gate refused" code. Gates used to refuse to run on
 * replayed snapshot data, but the real defect was the freshness check being
 * too coarse to notice in-place edits (L2-15). Once isSnapshotFresh compares
 * cache.getContentSignature() against the stored content_signature, a replay
 * only survives on an unchanged tree, so there is nothing left for a gate to
 * refuse. (Not checkFileChanges() — that is a different, still-live method;
 * the signature column is what freshness actually consults.)
 */
const EXIT_CODES = {
  OK: 0,
  FINDINGS: 1,
  CLI_ERROR: 2,
};

module.exports = EXIT_CODES;
