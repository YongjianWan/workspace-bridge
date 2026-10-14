const path = require('path');
const { spawnSync } = require('child_process');
const { TIMEOUTS, DEFAULTS } = require('../config/constants');
const { DATA_QUALITY } = require('../config/data-quality');
const { normalizePathKey } = require('../utils/path');
const { analyzeCoChanges } = require('./cochange-tools');
const { rankDiffContextRows, readWorkspaceDiff, interleaveDiffFirst } = require('./dep-tools/diff-context');

const histories = new WeakMap();
const STEM_SUFFIXES = [
  'ServiceImpl', 'Service', 'Impl', 'Mapper', 'Controller',
  'VO', 'Vo', 'DTO', 'Dto', 'PO', 'Entity', 'Request', 'Req',
  'Response', 'Resp', 'Query', 'Form', 'Api',
];

function stemName(filePath) {
  const base = String(filePath).replace(/\\/g, '/').split('/').pop();
  const dot = base.lastIndexOf('.');
  const name = dot > 0 ? base.slice(0, dot) : base;
  let stem = name;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of STEM_SUFFIXES) {
      if (stem.endsWith(suffix)) {
        stem = stem.slice(0, stem.length - suffix.length);
        changed = true;
      }
    }
  }
  return stem || name;
}

function readImpactHistory(container, fixedRevision) {
  const root = container.workspaceRoot;
  let head = fixedRevision;
  if (!head) {
    const revision = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', timeout: TIMEOUTS.GIT_LONG_MS,
    });
    if (revision.error || revision.status !== 0) {
      histories.delete(container);
      return { pairCounts: new Map(), dataQuality: DATA_QUALITY.UNAVAILABLE, remediation: null };
    }
    head = revision.stdout.trim();
  }
  const cached = histories.get(container);
  if (cached?.root === root && cached.head === head) return cached.data;
  // Pin the log to the checked HEAD; unstamped disk caches may contain future commits.
  // Only an immutable replay checkout can reuse the container's environment.
  const data = analyzeCoChanges(root, {
    revision: head,
    gitEnvironment: fixedRevision ? container.gitEnvironment : undefined,
  });
  if (data.dataQuality !== DATA_QUALITY.UNAVAILABLE) histories.set(container, { root, head, data });
  else histories.delete(container);
  return data;
}

function curateImpact(container, file, graphRows, direction = DEFAULTS.IMPACT_DEFAULT_DIRECTION, history, diffText) {
  const graph = container.snapshot?.graph || container.depGraph;
  if (direction !== 'all' || !graph.hasFile(file)) return graphRows;
  const data = history || readImpactHistory(container);
  const inputKey = normalizePathKey(file);
  const counts = new Map();
  for (const [pair, count] of data.pairCounts) {
    const [a, b] = pair.split('|').map(f => normalizePathKey(path.resolve(container.workspaceRoot, f)));
    if (a === inputKey) counts.set(b, count);
    if (b === inputKey) counts.set(a, count);
  }
  const inputStem = stemName(graph._displayPath(inputKey) || file);
  const candidates = [];
  for (const key of graph.getAllFilePaths()) {
    if (normalizePathKey(key) === inputKey) continue;
    const display = graph._displayPath(key) || key;
    const count = counts.get(normalizePathKey(key)) || 0;
    const sameStem = stemName(display) === inputStem;
    if (!sameStem && count === 0) continue;
    candidates.push({
      file: display, source: count > 0 ? 'cochange' : 'same-stem',
      confidence: 'low', coChangeCount: count,
      dataQuality: count > 0 ? data.dataQuality : DATA_QUALITY.CERTAIN,
      sameStem,
    });
  }
  candidates.sort((a, b) => Number(b.sameStem) - Number(a.sameStem)
    || b.coChangeCount - a.coChangeCount || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const merged = [];
  const seen = new Set([inputKey]);
  const graphEvidence = new Map(graphRows.map(row => [normalizePathKey(row.file), row]));
  // A duplicate consumes its turn, preserving the frozen alternating-list contract.
  for (let i = 0; i < Math.max(graphRows.length, candidates.length); i++) {
    for (const row of [graphRows[i], candidates[i]]) {
      if (!row) continue;
      const key = normalizePathKey(row.file);
      if (seen.has(key)) continue;
      seen.add(key);
      if (graphEvidence.has(key)) merged.push(graphEvidence.get(key));
      else if (row.sameStem !== undefined) {
        const { sameStem: _sameStem, ...entry } = row;
        merged.push(entry);
      } else merged.push(row);
    }
  }
  // Diff context: only meaningful for the committed-state query path. A fixed
  // revision (replay) passes its diff explicitly — possibly '' — and '' must
  // not fall back to the working tree, whose diff belongs to another revision.
  // Working-tree queries read the whole workspace diff: with several dirty
  // files, identifiers changed in the *other* files are legitimate ranking
  // evidence for this query too (second-known-file conditioning, A4).
  let diff = diffText;
  if (diff == null) diff = readWorkspaceDiff(container);
  if (typeof diff === 'string' && diff.length > 0) {
    // No seen-filter here: a file already in the merged list is exactly what
    // diff context should *promote* — the interleave dedupes, and the diff
    // slot wins over the later merged slot.
    const diffRows = rankDiffContextRows(container, file, diff);
    if (diffRows.length) return interleaveDiffFirst(diffRows, merged);
  }
  return merged;
}

module.exports = { stemName, readImpactHistory, curateImpact };
