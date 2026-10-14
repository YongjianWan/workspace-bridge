// Diff-context ranking for `impact`: when the input file has uncommitted changes
// (or a replay passes the commit diff explicitly), extract the changed member
// identifiers and surface files that reference them, interleaved ahead of the
// graph+history merged list. Resolution is a repo-wide identifier occurrence
// index over the files the graph has indexed — reference sites, not just
// export sites, so a MyBatis statement id in a Mapper XML resolves too.
// IDF-weighted by occurrence fan-out (1/filesContaining) so generic names
// (getName, status) cannot swamp the ranking. No free weights.
// The index is built lazily once per container/graph snapshot and kept in
// memory only (WeakMap): no disk cache, so no stale-index consistency risk.
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const TIMEOUTS = require('../../config/timeouts');
const { DEFAULTS } = require('../../config/defaults');
const { DATA_QUALITY } = require('../../config/data-quality');

const JAVA_MEMBER_DEF = /\b(?:public|private|protected)\s+(?:static\s+|final\s+|abstract\s+)*[\w<>[\], ?]+\s+(\w+)\s*[(;=]/g;
const IDENT = /\b([a-zA-Z_][\w$]{2,})\b/g;
// Java keywords and ubiquitous framework annotations: they appear in diffs but
// carry no pointing power. Anything longer/more specific is kept.
const STOPWORDS = new Set((
  'from join into update table select where group order class public private protected static final void return new this ' +
  'null true false import package extends implements interface enum if else for while do switch case try catch finally throw throws ' +
  'int long double float boolean char byte short string integer double boolean override param autowired service component ' +
  'mapper repository controller restcontroller requestmapping getmapping postmapping putmapping deletemapping request response ' +
  'args serializable'
).split(' '));

const occurrenceIndexes = new WeakMap(); // container -> { graph, index: Map(ident -> Set(displayPath)) }

// Build (or reuse) the identifier occurrence index for the current graph
// snapshot. Scoped to graph-known files, so .gitignored content never enters.
function occurrenceIndex(container) {
  const graph = container.snapshot?.graph || container.depGraph;
  if (!graph || typeof graph.getAllFilePaths !== 'function') return new Map();
  const cached = occurrenceIndexes.get(container);
  if (cached && cached.graph === graph) return cached.index;
  const index = new Map();
  for (const filePath of graph.getAllFilePaths()) {
    let text;
    try { text = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
    // Same display spelling as graph rows, so downstream dedupe by file string works.
    const display = String((graph._displayPath?.(filePath)) || filePath).replace(/\\/g, '/');
    let m; IDENT.lastIndex = 0;
    while ((m = IDENT.exec(text))) {
      const ident = m[1];
      if (STOPWORDS.has(ident.toLowerCase())) continue;
      if (!index.has(ident)) index.set(ident, new Set());
      index.get(ident).add(display);
    }
  }
  occurrenceIndexes.set(container, { graph, index });
  return index;
}

function diffTooBig(diffText) {
  return diffText.length > DEFAULTS.DIFF_CONTEXT_MAX_DIFF_CHARS;
}

function extractDiffSymbols(diffText, _fileName) {
  if (!diffText || diffTooBig(diffText)) return [];
  const out = new Set();
  for (const line of diffText.split('\n')) {
    if (!line.startsWith('+') && !line.startsWith('-')) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    // Member definition lines carry the strongest signal; everything else only
    // contributes non-stopword identifiers. XML inputs flow through the same
    // path: statement ids and SQL table names are identifiers like any other,
    // and the stopword list already defangs ubiquitous tag names (select/where).
    const defs = [...line.matchAll(JAVA_MEMBER_DEF)].map((m) => m[1]);
    const idents = defs.length ? defs : (line.match(IDENT) || []);
    for (const ident of idents) {
      if (!STOPWORDS.has(ident.toLowerCase())) out.add(ident);
    }
  }
  return [...out].slice(0, DEFAULTS.DIFF_CONTEXT_MAX_SYMBOLS);
}

// Rank files referencing any changed symbol. DF = number of indexed files
// containing that identifier; score = Σ 1/DF.
function rankDiffContextRows(container, filePath, diffText) {
  const graph = container.snapshot?.graph || container.depGraph;
  const relative = path.relative(container.workspaceRoot, filePath).replace(/\\/g, '/');
  const inputDisplay = String((graph?._displayPath?.(filePath)) || filePath).replace(/\\/g, '/');
  const symbols = extractDiffSymbols(diffText, relative);
  if (!symbols.length) return [];
  const index = occurrenceIndex(container);
  const scores = new Map();
  for (const symbol of symbols) {
    const files = index.get(symbol);
    if (!files || !files.size) continue;
    const weight = 1 / files.size;
    for (const file of files) {
      if (sameFile(file, inputDisplay)) continue;
      scores.set(file, (scores.get(file) || 0) + weight);
    }
  }
  return [...scores.entries()]
    // Near-unique pointer rule (declared a priori): a file must match at least
    // one identifier occurring in ≤ MIN_REFS_DF indexed files — i.e. one
    // near-unique pointer. Single matches on ubiquitous identifiers (getName,
    // status) are exactly the noise that displaced useful graph rows on the
    // holdout replay, and they cannot clear this bar.
    .filter(([, score]) => score >= DEFAULTS.DIFF_CONTEXT_MIN_REFS)
    .map(([file, score]) => ({
      file,
      source: 'diff-context',
      confidence: 'low',
      dataQuality: DATA_QUALITY.CERTAIN,
      diffRefs: Math.round(score * 1000) / 1000,
    }))
    .sort((a, b) => b.diffRefs - a.diffRefs || (a.file < b.file ? -1 : 1));
}

// Working-tree changes vs HEAD; the everyday source of diff context. Returns
// null when unavailable (not a git repo, git missing) — diff context is a
// best-effort ranking hint, never a hard dependency. The file path goes
// through the graph's display spelling first: callers may hand in a
// case-normalized (lowercased on Windows) key, and git pathspecs need the
// true on-disk casing.
function readWorkingTreeDiff(container, filePath) {
  const graph = container.snapshot?.graph || container.depGraph;
  const display = String((graph?._displayPath?.(filePath)) || filePath);
  const relative = path.relative(container.workspaceRoot, display);
  const res = spawnSync('git', ['-C', container.workspaceRoot, 'diff', 'HEAD', '--', relative], {
    encoding: 'utf8', timeout: TIMEOUTS.GIT_LONG_MS, maxBuffer: DEFAULTS.DIFF_CONTEXT_MAX_DIFF_CHARS * 2,
  });
  if (res.error || res.status !== 0) return null;
  return res.stdout;
}

// Workspace-wide changes vs HEAD: the everyday source of diff context when the
// developer has more than one dirty file. Querying file A also surfaces files
// referencing identifiers changed in *other* dirty files — the second known
// file is a strong ranking condition (ROADMAP 诊断第 2 条) and this is its
// free generalization. Single-dirty-file workspaces yield exactly the queried
// file's diff, so solo behavior is unchanged. Same failure contract as
// readWorkingTreeDiff: null when unavailable, never a hard dependency.
function readWorkspaceDiff(container) {
  const res = spawnSync('git', ['-C', container.workspaceRoot, 'diff', 'HEAD'], {
    encoding: 'utf8', timeout: TIMEOUTS.GIT_LONG_MS, maxBuffer: DEFAULTS.DIFF_CONTEXT_MAX_DIFF_CHARS * 2,
  });
  if (res.error || res.status !== 0) return null;
  return res.stdout;
}

function sameFile(a, b) {
  return String(a).replace(/\\/g, '/') === String(b).replace(/\\/g, '/');
}

// Strict 2-way alternation, first-come-wins: slot i takes diff[i] then
// merged[i], duplicates skipped. A merged row that reaches a slot first keeps
// it — diff rows fill gaps and interleave, they do not take over the list.
// This slot-share limit is deliberate, not an oversight: on the holdout replay
// a diff-priority variant (every diff row claiming an even slot) displaced
// useful graph rows and cost Java→Java −0.7pp overall (J1-holdout-diffctx-v3).
// Interleaves to exhaustion; the output cap lives in the caller's truncate.
function interleaveDiffFirst(diffRows, mergedRows) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < diffRows.length || i < mergedRows.length; i++) {
    for (const row of [diffRows[i], mergedRows[i]]) {
      if (!row) continue;
      const key = String(row.file).replace(/\\/g, '/');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

module.exports = { extractDiffSymbols, rankDiffContextRows, readWorkingTreeDiff, readWorkspaceDiff, interleaveDiffFirst, occurrenceIndex };
