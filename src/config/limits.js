/**
 * Resource limits: buffers, cache sizes, concurrency caps.
 */
const LIMITS = {
  COMMAND_OUTPUT_MAX_BYTES: 10 * 1024 * 1024,
  EXEC_SYNC_MAX_BUFFER_BYTES: 4 * 1024 * 1024,
  WATCH_MAX_STDOUT_BYTES: 1 * 1024 * 1024,
  TRIM_OUTPUT_DEFAULT_CHARS: 12000,
  SEARCH_MAX_FILE_BYTES: 1024 * 1024,
  // Files larger than this are skipped by the AST parser to avoid OOM.
  // Entry content detection (entry-detector.readScanContent) deliberately
  // shares this bound — see the rationale there.
  PARSER_MAX_FILE_BYTES: 1024 * 1024,
  // PEP 263 recognizes a source encoding declaration only on the first two lines.
  PYTHON_ENCODING_HEADER_LINES: 2,
  // Django (~7k files) makes ~8k distinct existence probes per build; a cap
  // below that evicts entries before they are re-asked. 20k stays a few MB.
  RESOLVER_STAT_CACHE_MAX: 20000,
  // Source text the analyzer keeps between a graph update and the end of one dead-exports pass, so
  // entry detection, the glob scan and the symbol scans read each file once. Characters, not
  // bytes: JS holds ASCII at one byte each, so this stays within ~32 MB for typical code.
  SCAN_CONTENT_CACHE_MAX_CHARS: 32 * 1024 * 1024,
  // Go same-package test edges ignore declared names shorter than this: "args", "ok" and the like
  // occur in nearly every test file and would link it to unrelated sources.
  GO_SAME_PACKAGE_MIN_IDENTIFIER_LENGTH: 4,
  GIT_STAT_MAX_CHARS: 8000,
  GIT_PATCH_MAX_CHARS: 12000,
  GIT_FILE_LIST_MAX: 500,
  GIT_COMMIT_MAX: 10,
  GIT_BRANCH_MAX: 10,
  GIT_LOG_MAX: 100,
  GIT_AUTHOR_MAX_LENGTH: 100,
  LINTER_OUTPUT_MAX_CHARS: 3000,
  // Git history concurrency: cap parallel git log --follow to prevent
  // disk/CPU thrashing during hotspot analysis.
  GIT_LOG_CONCURRENCY: 8,
  // Cycle finder recursion limit
  CYCLE_FINDER_MAX_CALLS: 20000,
  // Per-SCC cap on enumerated cycle paths. One dense SCC can produce 100+
  // combinatorial paths that add noise, not signal, and would otherwise
  // exhaust the global 1000-path budget and starve other SCCs. The SCC
  // count (see getCycleMeta) is the curated severity signal; the path
  // list is illustrative, and truncation is flagged via cycleMeta.truncated.
  PER_SCC_CYCLE_CAP: 25,
  // Output formatter list caps. Centralized so human/markdown/ai formatters
  // do not drift independently and so future --limit wiring has one place to
  // read from (L2-6).
  OUTPUT_TINY: 2,
  OUTPUT_SHORT: 3,
  OUTPUT_MEDIUM: 5,
  OUTPUT_LONG: 10,
  OUTPUT_EXTRA_LONG: 20,
  STRING_SNIPPET_MAX_CHARS: 120,
  // Text tree output cap: ~250 lines of <=120 characters stays near 30 KB (about 7k tokens), the size
  // past which one command's output crowds an agent's context. --max-files raises it.
  TREE_TEXT_MAX_LINES: 250,
  // A --json document past this many bytes (about 25k tokens) carries a sizeHint naming the smaller
  // alternatives, so a consumer that did not expect a large payload learns how to shrink it.
  JSON_SIZE_HINT_BYTES: 100000,
};

module.exports = LIMITS;
