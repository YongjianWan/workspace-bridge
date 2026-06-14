/**
 * Scoring weights and thresholds for hotspots, stability, and coupling analysis.
 */
const SCORING = {
  // Hotspot scoring
  HOTSPOT_COMMIT_COUNT_CAP: 10,
  HOTSPOT_COMMIT_COUNT_WEIGHT: 2,
  HOTSPOT_AUTHOR_COUNT_FALLBACK: 1,
  HOTSPOT_AUTHOR_COUNT_WEIGHT: 3,
  HOTSPOT_LAST_MODIFIED_DAYS_CAP: 30,
  HOTSPOT_LAST_MODIFIED_DAYS_MULTIPLIER: 0.5,
  HOTSPOT_REVERT_COUNT_FALLBACK: 0,
  HOTSPOT_REVERT_COUNT_WEIGHT: 5,
  HOTSPOT_SCORE_MAX: 100,
  HOTSPOT_REPORT_THRESHOLD: 30,
  HOTSPOT_MIN_DEPENDENTS: 5,
  HOTSPOT_CONFIG_DISCOUNT: 0.3, // config files naturally have high churn; dampen to avoid false positives
  HOTSPOT_PAGERANK_BOOST: 1.1, // files with above-average global importance get a slight score bump
  PAGERANK_CONFIG: { damping: 0.85, iterations: 20, epsilon: 1e-5 },

  // Stability scoring
  STABILITY_BASE_SCORE: 45,  // raised from 40 to avoid new files defaulting to fragile
  STABILITY_HAS_TESTS_DELTA: 15,
  STABILITY_LOW_IMPACT_DELTA: 15,
  STABILITY_HIGH_IMPACT_DELTA: -10,
  STABILITY_NON_MAINLINE_DELTA: -10,
  STABILITY_IN_CYCLE_DELTA: -15,
  STABILITY_CONFIG_ROLE_DELTA: 5,
  STABILITY_SCORE_MIN: 0,
  STABILITY_SCORE_MAX: 100,
  STABILITY_FRAGILE_THRESHOLD: 40,
  STABILITY_STABLE_THRESHOLD: 70,

  // Coupling thresholds
  COUPLING_HIGH_MIN: 20,
  COUPLING_MEDIUM_MIN: 10,

  // Core module detection
  CORE_MODULE_MIN_DEPENDENTS: 3,

  // Edge break scoring
  BREAK_EDGE_DEPENDENT_WEIGHT: 2,

  // Sampling / display limits
  TOP_N_RECOMMENDATIONS: 3,
  TOP_N_LIST: 10,

  // Knowledge risk: below this effective author count, the metric is noise in
  // personal/single-owner repositories, so we disable it and explain why.
  KNOWLEDGE_RISK_PERSONAL_REPO_MAX_AUTHORS: 2,
};

module.exports = SCORING;
