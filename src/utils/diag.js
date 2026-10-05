/**
 * Diagnostics for a person watching the terminal (progress, a failed listener, a file that did
 * not parse). They go to stderr, and `--quiet` silences them: whatever matters to a consumer is
 * also in the result's warnings[], which is the record. Output that must appear even under
 * --quiet (the "still running" heartbeat, fatal errors) writes to stderr directly instead.
 */
let quiet = false;

function setDiagQuiet(value) {
  quiet = Boolean(value);
}

function diag(...args) {
  if (!quiet) console.error(...args);
}

module.exports = { diag, setDiagQuiet };
