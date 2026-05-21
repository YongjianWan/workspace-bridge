/**
 * Shared runtime constants.
 * Keep operational thresholds in one place to reduce magic-number drift.
 *
 * Implementation note: each namespace has been physically split into its own
 * file under src/config/ for better cohesion. This file remains a thin
 * compatibility barrel so that existing `require('../../config/constants')`
 * calls continue to work without modification.
 */
const TIMEOUTS = require('./timeouts');
const LIMITS = require('./limits');
const { DEFAULTS, HIGHLIGHT_SCORES } = require('./defaults');
const SCORING = require('./scoring');
const { DEAD_EXPORT, CONFIDENCE } = require('./dead-export');
const PROBE = require('./probe');
const { SCHEMA_VERSION, CACHE_VERSION } = require('./versions');
const STREAMING = require('./streaming');
const AI_FORMAT = require('./ai-format');

module.exports = {
  TIMEOUTS,
  LIMITS,
  DEFAULTS,
  HIGHLIGHT_SCORES,
  SCORING,
  DEAD_EXPORT,
  CONFIDENCE,
  PROBE,
  CACHE_VERSION,
  SCHEMA_VERSION,
  STREAMING,
  AI_FORMAT,
};
