/**
 * Data quality contract for workspace-bridge signals.
 *
 * Every analysis result item carries a dataQuality field:
 *
 *   CERTAIN    — data is complete and deterministic. Safe for gate decisions.
 *                AST-derived edges are always CERTAIN regardless of environment.
 *
 *   DEGRADED   — data exists but the environment limits its reliability
 *                (shallow clone, sparse checkout, etc.). Gate ignores these;
 *                they appear as warnings in output with a remediation hint.
 *
 *   UNAVAILABLE — no data (git absent, file untracked, etc.).
 *                 Items are omitted from output entirely.
 *
 * Contamination rule: if ANY input to a derived result is DEGRADED,
 * the result is DEGRADED. CERTAIN requires a clean chain end-to-end.
 *
 * Remediation strings map a degradation cause to a user-actionable fix.
 * They are static — the environment cause determines the fix, not the caller.
 */

const DATA_QUALITY = {
  CERTAIN: 'certain',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
};

/** @type {Record<string, string>} Maps degradation cause key to user-actionable instruction */
const REMEDIATION = {
  SHALLOW_CLONE:
    'Add `fetch-depth: 0` to your CI checkout step to enable full git history analysis.',
  SPARSE_CHECKOUT:
    'Use a full checkout (disable sparse-checkout) to enable complete file analysis.',
  SUBMODULE_BOUNDARY:
    'Co-change analysis does not cross submodule boundaries; results reflect the parent repo only.',
  LFS_POINTER:
    'Git LFS pointers detected. Cache freshness checks may be unreliable; run with --no-cache to force reanalysis.',
  MONOREPO_ROOT:
    'workspace-root appears to be a monorepo subpackage. Run from the repository root or set it explicitly to avoid mixing sibling-package co-change signals.',
};

module.exports = { DATA_QUALITY, REMEDIATION };
