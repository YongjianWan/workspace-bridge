/**
 * Dead-export confidence thresholds.
 * P87: differentiate explanation when a file has many importers but specific exports are unused.
 */
const DEAD_EXPORT = {
  // "Many importers" — specific exports genuinely unused despite file popularity
  IMPORTER_COUNT_HIGH: 10,
  // "Some importers" — may be internal helpers or barrel re-exports
  IMPORTER_COUNT_MEDIUM: 3,
};

// Numeric confidence values for downstream threshold filtering.
// Tier 1 — same-file / no importer: highest confidence.
// Tier 2 — import-scoped AST: medium confidence (symbol tracking is authoritative but dynamic imports may bypass).
// Tier 3 — global / regex fallback: lowest confidence (high false-positive risk).
const CONFIDENCE = {
  HIGH_VALUE: 0.95,
  MEDIUM_VALUE: 0.9,
  LOW_VALUE: 0.5,
};

module.exports = { DEAD_EXPORT, CONFIDENCE };
