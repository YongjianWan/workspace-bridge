/**
 * CLI command registry — thin mapping, handlers live in sibling files.
 * Add new commands by creating a file and registering below.
 */

const COMMANDS = {
  'workspace-info': require('./workspace-info'),
  diagnostics: require('./diagnostics'),
  'audit-summary': require('./audit-summary'),
  'audit-file': require('./audit-file'),
  'audit-diff': require('./audit-diff'),
  'audit-overview': require('./audit-overview'),
  'audit-map': require('./audit-map'),
  health: require('./health'),
  'audit-security': require('./audit-security'),
  stats: require('./stats'),
  dependencies: require('./dependencies'),
  dependents: require('./dependents'),
  'dead-exports': require('./dead-exports'),
  unresolved: require('./unresolved'),
  cycles: require('./cycles'),
  impact: require('./impact'),
  'affected-tests': require('./affected-tests'),
  tree: require('./tree'),
  repl: require('./repl'),
  watch: require('./watch'),
  init: require('./init'),
  debug: require('./debug'),
};

module.exports = { COMMANDS };
